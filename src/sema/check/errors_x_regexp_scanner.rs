//! Regular expression literals, read the way an engine reads them: 1499 to 1538, and what the scanner says of the escapes in them
//! and of what is missing from them: 1005 1125 1126 1198 1199 1487 1488.
//!
//! A port of regexp.go and unicodeproperties.go of TypeScript 7.0.2's scanner, of `ReScanSlashToken`, `scanEscapeSequence`,
//! `scanUnicodeEscape`, `scanIdentifier` and `scanIdentifierParts` of its scanner.go as far as regular expressions use them, and
//! of `checkGrammarRegularExpressionLiteral` of grammarchecks.go, which decides what of all that is reported.
//!
//! tsgo always allows for Annex B, so that its `anyUnicodeModeOrNonAnnexB` is `anyUnicodeMode`.

use super::explain::NOWHERE;
use super::sink::held;
use super::*;
use crate::resolve::ScriptTarget;
use bun_core::lexer::{is_identifier_part, is_identifier_start};
use std::borrow::Cow;

impl Checker<'_> {
    /// `checkRegularExpressionLiteral`, `checkGrammarRegularExpressionLiteral`
    pub(super) fn check_grammar_regular_expression_literal(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        if has_parse_diagnostics(hir) {
            return;
        }
        // `GetEmitScriptTarget`
        let target = match self.p.files.options.target {
            ScriptTarget::None => ScriptTarget::ES2025,
            target => target,
        };
        let mut noted: Vec<Noted> = Vec::new();
        check_regular_expression_literal(&hir.text, hir[e].pos as usize, target, &mut noted);
        for (start, end, code, args) in noted {
            // `Did_you_mean_0` goes with the error before it, and is in no file.
            match self.reported.last_mut() {
                Some(last) if code == 1369 => {
                    last.add_related_info(Reported::new(NOWHERE, code, held(args)));
                }
                _ => {
                    self.add_diagnostic(Reported::new((file, start, end), code, held(args)));
                }
            }
        }
    }
}

/// Of an error: where it starts, where it ends, its code, and the arguments of its message.
type Noted = (u32, u32, u32, Vec<String>);

const HAS_INDICES: u8 = 1 << 0; // d
const GLOBAL: u8 = 1 << 1; // g
const IGNORE_CASE: u8 = 1 << 2; // i
const MULTILINE: u8 = 1 << 3; // m
const DOT_ALL: u8 = 1 << 4; // s
const UNICODE: u8 = 1 << 5; // u
const UNICODE_SETS: u8 = 1 << 6; // v
const STICKY: u8 = 1 << 7; // y
const ANY_UNICODE_MODE: u8 = UNICODE | UNICODE_SETS;
const MODIFIERS: u8 = IGNORE_CASE | MULTILINE | DOT_ALL;

/// `charCodeToRegExpFlag`
fn regexp_flag(ch: u32) -> Option<u8> {
    Some(match u8::try_from(ch).ok()? {
        b'd' => HAS_INDICES,
        b'g' => GLOBAL,
        b'i' => IGNORE_CASE,
        b'm' => MULTILINE,
        b's' => DOT_ALL,
        b'u' => UNICODE,
        b'v' => UNICODE_SETS,
        b'y' => STICKY,
        _ => return None,
    })
}

/// `utf8.RuneError`
const RUNE_ERROR: u32 = 0xFFFD;
const BACKSLASH: u32 = b'\\' as u32;

/// How many groups or classes may be inside one another. tsgo has no limit: its stack grows.
const MAX_NESTING: u32 = 200;

/// What a member of a character class stands for. tsgo has a string.
#[derive(Copy, Clone, PartialEq, Eq)]
enum ClassAtom {
    /// `""`: a class of its own, such as `\d`.
    None,
    /// One character. Half of a surrogate pair is one.
    Char(u32),
    /// More than one character.
    Text,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum ClassSetExpressionType {
    ClassIntersection,
    ClassSubtraction,
}

/// `ReScanSlashToken` when it reports errors. The first `/` is at `token_start`.
fn check_regular_expression_literal(
    text: &[u8],
    token_start: usize,
    target: ScriptTarget,
    noted: &mut Vec<Noted>,
) {
    if text.get(token_start) != Some(&b'/') {
        return;
    }
    // To the end first, for the flags. A `[` inside a class does nothing here and a `]` always closes it, even with `v`.
    let start_of_body = token_start + 1;
    let mut p = start_of_body;
    let (mut in_escape, mut in_character_class, mut named_capture_groups) = (false, false, false);
    loop {
        // What does not end is for the parser to complain of.
        let Some(&ch) = text.get(p) else { return };
        match ch {
            b'\n' | b'\r' => return,
            _ if in_escape => in_escape = false,
            b'/' if !in_character_class => break,
            b'[' => in_character_class = true,
            b'\\' => in_escape = true,
            b']' => in_character_class = false,
            b'(' if !in_character_class
                && text.get(p + 1) == Some(&b'?')
                && text.get(p + 2) == Some(&b'<')
                && !matches!(text.get(p + 3), Some(b'=' | b'!')) =>
            {
                named_capture_groups = true;
            }
            _ => {}
        }
        p += 1;
    }
    let mut parser = RegExpParser {
        text,
        pos: start_of_body,
        end: p,
        target,
        any_unicode_mode: false,
        unicode_sets_mode: false,
        named_capture_groups,
        may_contain_strings: false,
        number_of_capturing_groups: 0,
        group_specifiers: Vec::new(),
        group_name_references: Vec::new(),
        decimal_escapes: Vec::new(),
        named_capturing_groups: Vec::new(),
        pending_low_surrogate: 0,
        nesting: 0,
        is_too_deep: false,
        last_error: None,
        noted,
    };
    p += 1;
    let mut flags = 0u8;
    while p < text.len() {
        let (ch, size) = decode_rune(&text[p..]);
        if ch == RUNE_ERROR || !is_identifier_part(ch) {
            break;
        }
        match regexp_flag(ch) {
            None => parser.error(1499, p, size),
            Some(flag) if flags & flag != 0 => parser.error(1500, p, size),
            Some(flag) if (flags | flag) & ANY_UNICODE_MODE == ANY_UNICODE_MODE => {
                parser.error(1502, p, size)
            }
            Some(flag) => {
                flags |= flag;
                parser.check_flag_availability(flag, p, size);
            }
        }
        p += size;
    }
    parser.any_unicode_mode = flags & ANY_UNICODE_MODE != 0;
    parser.unicode_sets_mode = flags & UNICODE_SETS != 0;
    parser.run();
}

/// `regExpParser`, and what it uses of the `Scanner` it sits on.
struct RegExpParser<'a> {
    text: &'a [u8],
    pos: usize,
    /// Where the `/` that ends the body is.
    end: usize,
    target: ScriptTarget,
    any_unicode_mode: bool,
    unicode_sets_mode: bool,
    /// There is a `(?<name>` somewhere.
    named_capture_groups: bool,
    /// See `scan_class_set_expression`.
    may_contain_strings: bool,
    /// Named or not.
    number_of_capturing_groups: usize,
    /// The names of all named capturing groups.
    group_specifiers: Vec<Cow<'a, [u8]>>,
    /// `\k<name>`: where the name starts and ends, and the name.
    group_name_references: Vec<(usize, usize, Cow<'a, [u8]>)>,
    /// `\1`: where the number starts and ends, and the number.
    decimal_escapes: Vec<(usize, usize, usize)>,
    /// Which of `group_specifiers` are in the alternatives being read. tsgo has a stack of sets, one for each alternative.
    named_capturing_groups: Vec<usize>,
    /// Without `u` or `v` a character past U+FFFF is two. The first has been given, without moving on: this is the second.
    pending_low_surrogate: u32,
    nesting: u32,
    /// `MAX_NESTING` was reached. Nothing more is said of the literal.
    is_too_deep: bool,
    /// Where the last error that was reported is.
    last_error: Option<usize>,
    noted: &'a mut Vec<Noted>,
}

impl<'a> RegExpParser<'a> {
    /// What `checkGrammarRegularExpressionLiteral` makes of what the scanner says: an error where the one before it is adds nothing.
    fn error(&mut self, code: u32, start: usize, length: usize) {
        self.error_with(code, start, length, Vec::new);
    }

    /// The same, of an error whose message takes arguments.
    fn error_with(
        &mut self,
        code: u32,
        start: usize,
        length: usize,
        args: impl FnOnce() -> Vec<String>,
    ) {
        if self.last_error != Some(start) && !self.is_too_deep {
            self.last_error = Some(start);
            let end = match length {
                0 => super::explain::NO_LENGTH,
                _ => (start + length) as u32,
            };
            self.noted.push((start as u32, end, code, args()));
        }
    }

    /// `Did_you_mean_0`, which `checkGrammarRegularExpressionLiteral` adds to the error before it if that is about the same text:
    /// which of `candidates` may have been meant by `name`.
    fn suggest<'c>(
        &mut self,
        start: usize,
        length: usize,
        name: &[u8],
        candidates: impl Iterator<Item = &'c [u8]>,
    ) {
        let (start, end) = (start as u32, (start + length) as u32);
        if self
            .noted
            .last()
            .is_some_and(|last| (last.0, last.1) == (start, end))
            && let Some(suggestion) = spelling_suggestion(name, candidates)
        {
            self.noted.push((start, end, 1369, vec![suggestion]));
        }
    }

    /// 1508, of the character `ch` at `start`.
    fn error_unexpected(&mut self, start: usize, ch: u8) {
        self.error_with(1508, start, 1, || vec![char::from(ch).to_string()]);
    }

    /// `char`. `None` for its -1: the body is over.
    #[inline]
    fn peek(&self) -> Option<u8> {
        self.peek_at(0)
    }

    /// `charAt`
    #[inline]
    fn peek_at(&self, offset: usize) -> Option<u8> {
        if self.pos + offset < self.end {
            Some(self.text[self.pos + offset])
        } else {
            None
        }
    }

    /// Whether there is room for one more group or class inside those being read.
    fn enter(&mut self) -> bool {
        if self.nesting == MAX_NESTING {
            self.is_too_deep = true;
            self.pos = self.end;
            return false;
        }
        self.nesting += 1;
        true
    }

    /// `checkRegularExpressionFlagAvailability`
    fn check_flag_availability(&mut self, flag: u8, pos: usize, size: usize) {
        let (available_from, name) = match flag {
            HAS_INDICES => (ScriptTarget::ES2022, "es2022"),
            DOT_ALL => (ScriptTarget::ES2018, "es2018"),
            UNICODE_SETS => (ScriptTarget::ES2024, "es2024"),
            _ => return,
        };
        if self.target < available_from {
            self.error_with(1501, pos, size, || vec![name.to_owned()]);
        }
    }

    /// `run`
    fn run(&mut self) {
        self.scan_disjunction(false);
        let group_specifiers = std::mem::take(&mut self.group_specifiers);
        for (pos, end, name) in &std::mem::take(&mut self.group_name_references) {
            if !group_specifiers.contains(name) {
                self.error_with(1532, *pos, *end - *pos, || {
                    vec![String::from_utf8_lossy(name).into_owned()]
                });
                let names = group_specifiers.iter().map(|specifier| &specifier[..]);
                self.suggest(*pos, *end - *pos, name, names);
            }
        }
        // With Annex B a number greater than that of the groups is an octal escape or the digits themselves. Most likely it is
        // a mistake all the same.
        for (pos, end, value) in std::mem::take(&mut self.decimal_escapes) {
            if value > self.number_of_capturing_groups {
                let groups = self.number_of_capturing_groups;
                self.error_with(
                    if self.number_of_capturing_groups > 0 {
                        1533
                    } else {
                        1534
                    },
                    pos,
                    end - pos,
                    || vec![groups.to_string()],
                );
            }
        }
    }

    /// `scanDisjunction`: `Alternative ('|' Alternative)*`
    fn scan_disjunction(&mut self, is_in_group: bool) {
        loop {
            let outer = self.named_capturing_groups.len();
            self.scan_alternative(is_in_group);
            self.named_capturing_groups.truncate(outer);
            if self.peek() != Some(b'|') {
                return;
            }
            self.pos += 1;
        }
    }

    /// `scanAlternative`: `Term*`, a term being an assertion, or an atom and perhaps a quantifier.
    fn scan_alternative(&mut self, is_in_group: bool) {
        let mut is_previous_term_quantifiable = false;
        while let Some(ch) = self.peek() {
            let start = self.pos;
            match ch {
                b'^' | b'$' => {
                    self.pos += 1;
                    is_previous_term_quantifiable = false;
                }
                b'\\' => {
                    self.pos += 1;
                    if matches!(self.peek(), Some(b'b' | b'B')) {
                        self.pos += 1;
                        is_previous_term_quantifiable = false;
                    } else {
                        self.scan_atom_escape();
                        is_previous_term_quantifiable = true;
                    }
                }
                b'(' => {
                    self.pos += 1;
                    if self.peek() == Some(b'?') {
                        self.pos += 1;
                        match self.peek() {
                            Some(b'=' | b'!') => {
                                self.pos += 1;
                                // In Annex B, `(?=Disjunction)` and `(?!Disjunction)` are quantifiable.
                                is_previous_term_quantifiable = !self.any_unicode_mode;
                            }
                            Some(b'<') => {
                                let group_name_start = self.pos;
                                self.pos += 1;
                                if matches!(self.peek(), Some(b'=' | b'!')) {
                                    self.pos += 1;
                                    is_previous_term_quantifiable = false;
                                } else {
                                    self.scan_group_name(false);
                                    self.scan_expected_char(b'>');
                                    if self.target < ScriptTarget::ES2018 {
                                        self.error(
                                            1503,
                                            group_name_start,
                                            self.pos - group_name_start,
                                        );
                                    }
                                    self.number_of_capturing_groups += 1;
                                    is_previous_term_quantifiable = true;
                                }
                            }
                            _ => {
                                let flags_start = self.pos;
                                let set_flags = self.scan_pattern_modifiers(0);
                                if self.peek() == Some(b'-') {
                                    self.pos += 1;
                                    self.scan_pattern_modifiers(set_flags);
                                    if self.pos == flags_start + 1 {
                                        self.error(1504, flags_start, self.pos - flags_start);
                                    }
                                }
                                self.scan_expected_char(b':');
                                is_previous_term_quantifiable = true;
                            }
                        }
                    } else {
                        self.number_of_capturing_groups += 1;
                        is_previous_term_quantifiable = true;
                    }
                    if self.enter() {
                        self.scan_disjunction(true);
                        self.nesting -= 1;
                    }
                    self.scan_expected_char(b')');
                }
                b'{' | b'*' | b'+' | b'?' => {
                    if ch == b'{' && !self.scan_braced_quantifier() {
                        is_previous_term_quantifiable = true;
                        continue;
                    }
                    self.pos += 1;
                    if self.peek() == Some(b'?') {
                        // Non-greedy
                        self.pos += 1;
                    }
                    if !is_previous_term_quantifiable {
                        self.error(1507, start, self.pos - start);
                    }
                    is_previous_term_quantifiable = false;
                }
                b'.' => {
                    self.pos += 1;
                    is_previous_term_quantifiable = true;
                }
                b'[' => {
                    self.pos += 1;
                    if self.unicode_sets_mode {
                        self.scan_class_set_expression();
                    } else {
                        self.scan_class_ranges();
                        self.pending_low_surrogate = 0;
                    }
                    self.scan_expected_char(b']');
                    is_previous_term_quantifiable = true;
                }
                b')' if is_in_group => return,
                b')' | b']' | b'}' => {
                    if self.any_unicode_mode || ch == b')' {
                        self.error_unexpected(self.pos, ch);
                    }
                    self.pos += 1;
                    is_previous_term_quantifiable = true;
                }
                b'/' | b'|' => return,
                _ => {
                    self.scan_source_character();
                    is_previous_term_quantifiable = true;
                }
            }
        }
    }

    /// What `scanAlternative` does at a `{`. True: it opens a quantifier, and what closes that is next. False: it is a character
    /// like any other, and so is what was read after it.
    fn scan_braced_quantifier(&mut self) -> bool {
        let start = self.pos;
        self.pos += 1;
        let digits_start = self.pos;
        let min = self.scan_digits();
        if !self.any_unicode_mode && min.is_empty() {
            return false;
        }
        if self.peek() == Some(b',') {
            self.pos += 1;
            let max = self.scan_digits();
            if min.is_empty() {
                if !max.is_empty() || self.peek() == Some(b'}') {
                    self.error(1505, digits_start, 0);
                } else {
                    self.error_unexpected(start, b'{');
                    return false;
                }
            } else if !max.is_empty()
                && compare_decimal_strings(min, max).is_gt()
                && (self.any_unicode_mode || self.peek() == Some(b'}'))
            {
                self.error(1506, digits_start, self.pos - digits_start);
            }
        } else if min.is_empty() {
            if self.any_unicode_mode {
                self.error_unexpected(start, b'{');
            }
            return false;
        }
        if self.peek() != Some(b'}') {
            if !self.any_unicode_mode {
                return false;
            }
            self.error_with(1005, self.pos, 0, || vec!["}".to_owned()]);
            self.pos -= 1;
        }
        true
    }

    /// `scanPatternModifiers`: the flags of `(?ims-ims:`
    fn scan_pattern_modifiers(&mut self, mut curr_flags: u8) -> u8 {
        while self.pos < self.end {
            let (ch, size) = decode_rune(&self.text[self.pos..]);
            if ch == RUNE_ERROR || !is_identifier_part(ch) {
                break;
            }
            match regexp_flag(ch) {
                None => self.error(1499, self.pos, size),
                Some(flag) if curr_flags & flag != 0 => self.error(1500, self.pos, size),
                Some(flag) if flag & MODIFIERS == 0 => self.error(1509, self.pos, size),
                Some(flag) => {
                    curr_flags |= flag;
                    self.check_flag_availability(flag, self.pos, size);
                }
            }
            self.pos += size;
        }
        curr_flags
    }

    /// `scanAtomEscape`: past the backslash, a number, a class, a character, or `k<name>`.
    fn scan_atom_escape(&mut self) {
        match self.peek() {
            Some(b'k') => {
                self.pos += 1;
                if self.peek() == Some(b'<') {
                    self.pos += 1;
                    self.scan_group_name(true);
                    self.scan_expected_char(b'>');
                } else if self.any_unicode_mode || self.named_capture_groups {
                    self.error(1510, self.pos - 2, 2);
                }
            }
            Some(b'q') if self.unicode_sets_mode => {
                self.pos += 1;
                self.error(1511, self.pos - 2, 2);
            }
            _ => {
                if !self.scan_character_class_escape() && !self.scan_decimal_escape() {
                    self.scan_character_escape(true);
                }
            }
        }
    }

    /// `scanDecimalEscape`: `[1-9] [0-9]*`
    fn scan_decimal_escape(&mut self) -> bool {
        if !matches!(self.peek(), Some(b'1'..=b'9')) {
            return false;
        }
        let start = self.pos;
        let digits = self.scan_digits();
        let value = digits.iter().fold(0usize, |value, &digit| {
            value
                .saturating_mul(10)
                .saturating_add(usize::from(digit - b'0'))
        });
        self.decimal_escapes.push((start, self.pos, value));
        true
    }

    /// `scanCharacterEscape`: past the backslash, `c` and a letter, a character of the syntax, or what `scan_escape_sequence` knows.
    fn scan_character_escape(&mut self, atom_escape: bool) -> ClassAtom {
        let Some(ch) = self.peek() else {
            self.error(1513, self.pos - 1, 1);
            return ClassAtom::Char(BACKSLASH);
        };
        match ch {
            b'c' => {
                self.pos += 1;
                let ch = self.peek();
                if let Some(letter) = ch
                    && letter.is_ascii_alphabetic()
                {
                    self.pos += 1;
                    return ClassAtom::Char(u32::from(letter & 0x1f));
                }
                if self.any_unicode_mode {
                    self.error(1512, self.pos - 2, 2);
                } else if atom_escape {
                    self.pos -= 1;
                    return ClassAtom::Char(BACKSLASH);
                }
                ClassAtom::Char(ch.map_or(RUNE_ERROR, u32::from))
            }
            b'^' | b'$' | b'/' | b'\\' | b'.' | b'*' | b'+' | b'?' | b'(' | b')' | b'[' | b']'
            | b'{' | b'}' | b'|' => {
                self.pos += 1;
                ClassAtom::Char(u32::from(ch))
            }
            _ => {
                // Back to the backslash.
                self.pos -= 1;
                self.scan_escape_sequence(atom_escape)
            }
        }
    }

    /// `scanEscapeSequence`, at the backslash, with the flags `scanCharacterEscape` gives it: `RegularExpression`, `AnnexB`,
    /// `AnyUnicodeMode` if that is the mode, and `AtomEscape` outside a class.
    fn scan_escape_sequence(&mut self, atom_escape: bool) -> ClassAtom {
        let start = self.pos;
        self.pos += 1;
        let Some(ch) = self.peek() else {
            self.error(1126, self.pos, 0);
            return ClassAtom::None;
        };
        self.pos += 1;
        let is_octal_digit = |ch: Option<u8>| matches!(ch, Some(b'0'..=b'7'));
        match ch {
            b'0'..=b'7' => {
                // `\08` is `\0` and `8`, though a zero before any digit makes an octal escape.
                if ch == b'0' && !self.peek().is_some_and(|next| next.is_ascii_digit()) {
                    return ClassAtom::Char(0);
                }
                // `\1`, `\17`, `\177`; `\4`, `\47`, but not `\477`.
                if ch <= b'3' && is_octal_digit(self.peek()) {
                    self.pos += 1;
                }
                if is_octal_digit(self.peek()) {
                    self.pos += 1;
                }
                let code = self.text[start + 1..self.pos]
                    .iter()
                    .fold(0u32, |code, &digit| code * 8 + u32::from(digit - b'0'));
                self.error_with(
                    if !atom_escape && ch != b'0' {
                        1536
                    } else {
                        1487
                    },
                    start,
                    self.pos - start,
                    || vec![format!("\\x{code:02x}")],
                );
                ClassAtom::Char(code)
            }
            b'8' | b'9' => {
                let text = self.text;
                let end = self.pos;
                self.error_with(
                    if atom_escape { 1488 } else { 1537 },
                    start,
                    end - start,
                    || vec![String::from_utf8_lossy(&text[start..end]).into_owned()],
                );
                ClassAtom::Char(u32::from(ch))
            }
            b'b' => ClassAtom::Char(0x08),
            b't' => ClassAtom::Char(0x09),
            b'n' => ClassAtom::Char(0x0A),
            b'v' => ClassAtom::Char(0x0B),
            b'f' => ClassAtom::Char(0x0C),
            b'r' => ClassAtom::Char(0x0D),
            b'\'' | b'"' => ClassAtom::Char(u32::from(ch)),
            b'u' => {
                let extended = self.peek() == Some(b'{');
                self.pos -= 2;
                let code_point = self.scan_unicode_escape(true);
                if extended {
                    if !self.any_unicode_mode {
                        self.error(1538, start, self.pos - start);
                    }
                    return code_point.map_or(ClassAtom::Text, ClassAtom::Char);
                }
                let Some(code_point) = code_point else {
                    return ClassAtom::Text;
                };
                // With `u` or `v`, two escapes of four digits that make a surrogate pair are one character. Those in braces never
                // pair up, and without the flags nothing does.
                if (0xD800..=0xDBFF).contains(&code_point)
                    && self.any_unicode_mode
                    && self.peek() == Some(b'\\')
                    && self.peek_at(1) == Some(b'u')
                    && self.peek_at(2) != Some(b'{')
                {
                    let saved_pos = self.pos;
                    if let Some(next) = self.scan_unicode_escape(true)
                        && (0xDC00..=0xDFFF).contains(&next)
                    {
                        return ClassAtom::Char(
                            0x10000 + ((code_point - 0xD800) << 10) + (next - 0xDC00),
                        );
                    }
                    self.pos = saved_pos;
                }
                ClassAtom::Char(code_point)
            }
            b'x' => {
                while self.pos < start + 4 {
                    if !self.peek().is_some_and(|digit| digit.is_ascii_hexdigit()) {
                        self.error(1125, self.pos, 0);
                        return ClassAtom::Text;
                    }
                    self.pos += 1;
                }
                ClassAtom::Char(parse_hex(&self.text[start + 2..self.pos]))
            }
            b'\r' => {
                if self.peek() == Some(b'\n') {
                    self.pos += 1;
                }
                ClassAtom::None
            }
            b'\n' => ClassAtom::None,
            _ => {
                let mut ch = u32::from(ch);
                if ch >= 0x80 {
                    self.pos -= 1;
                    let (decoded, size) = decode_rune(&self.text[self.pos..]);
                    ch = decoded;
                    self.pos += size;
                }
                if ch == 0x2028 || ch == 0x2029 {
                    return ClassAtom::None;
                }
                if self.any_unicode_mode {
                    self.error(1535, start, self.pos - start);
                }
                ClassAtom::Char(ch)
            }
        }
    }

    /// `scanUnicodeEscape`, at the backslash of a `\u`. `None` for its -1.
    fn scan_unicode_escape(&mut self, should_emit_invalid_escape_error: bool) -> Option<u32> {
        self.pos += 2;
        let start = self.pos;
        let extended = self.peek() == Some(b'{');
        if extended {
            self.pos += 1;
        }
        // `scanHexDigits`: four, or in braces as many as there are and at least one.
        let digits_start = self.pos;
        while (extended || self.pos < digits_start + 4)
            && self.peek().is_some_and(|digit| digit.is_ascii_hexdigit())
        {
            self.pos += 1;
        }
        let min_count = if extended { 1 } else { 4 };
        if self.pos - digits_start < min_count {
            if should_emit_invalid_escape_error {
                self.error(1125, self.pos, 0);
            }
            return None;
        }
        let value = parse_hex(&self.text[digits_start..self.pos]);
        if extended {
            let mut is_invalid_extended_escape = false;
            if value > 0x10FFFF {
                if should_emit_invalid_escape_error {
                    self.error(1198, start + 1, self.pos - start - 1);
                }
                is_invalid_extended_escape = true;
            }
            match self.peek() {
                Some(b'}') => self.pos += 1,
                next => {
                    if should_emit_invalid_escape_error {
                        self.error(if next.is_none() { 1126 } else { 1199 }, self.pos, 0);
                    }
                    is_invalid_extended_escape = true;
                }
            }
            if is_invalid_extended_escape {
                return None;
            }
        }
        Some(value)
    }

    /// `peekUnicodeEscape`, at a backslash.
    fn peek_unicode_escape(&mut self) -> Option<u32> {
        if self.peek_at(1) != Some(b'u') {
            return None;
        }
        let save_pos = self.pos;
        let code_point = self.scan_unicode_escape(false);
        self.pos = save_pos;
        code_point
    }

    /// `scanGroupName`, past the `<`.
    fn scan_group_name(&mut self, is_reference: bool) {
        let start = self.pos;
        let name = self.scan_identifier();
        if self.pos == start {
            self.error(1514, self.pos, 0);
        } else if is_reference {
            self.group_name_references.push((start, self.pos, name));
        } else if self
            .named_capturing_groups
            .iter()
            .any(|&group| self.group_specifiers[group] == name)
        {
            self.error(1515, start, self.pos - start);
        } else {
            self.named_capturing_groups
                .push(self.group_specifiers.len());
            self.group_specifiers.push(name);
        }
    }

    /// `scanIdentifier`, `scanIdentifierParts`: the name, with what is escaped in it spelled out. It cannot start with an escape.
    fn scan_identifier(&mut self) -> Cow<'a, [u8]> {
        let text = self.text;
        let start = self.pos;
        let (mut ch, mut size) = decode_rune(&text[self.pos..]);
        if !is_identifier_start(ch) {
            return Cow::Borrowed(&text[start..start]);
        }
        loop {
            self.pos += size;
            (ch, size) = decode_rune(&text[self.pos..]);
            if !is_identifier_part(ch) {
                break;
            }
        }
        if ch != BACKSLASH {
            return Cow::Borrowed(&text[start..self.pos]);
        }
        let mut name = text[start..self.pos].to_vec();
        let mut start = self.pos;
        loop {
            let (ch, size) = decode_rune(&text[self.pos..]);
            if is_identifier_part(ch) {
                self.pos += size;
                continue;
            }
            if ch == BACKSLASH
                && let Some(escaped) = self.peek_unicode_escape()
                && is_identifier_part(escaped)
                && let Some(escaped) = char::from_u32(escaped)
            {
                name.extend_from_slice(&text[start..self.pos]);
                name.extend_from_slice(escaped.encode_utf8(&mut [0; 4]).as_bytes());
                self.scan_unicode_escape(true);
                start = self.pos;
                continue;
            }
            break;
        }
        name.extend_from_slice(&text[start..self.pos]);
        Cow::Owned(name)
    }

    /// `isClassContentExit`, of the character that is next.
    fn is_class_content_exit(&self) -> bool {
        matches!(self.peek(), None | Some(b']'))
    }

    /// `scanClassRanges`: `'^'? (ClassAtom ('-' ClassAtom)?)*`
    fn scan_class_ranges(&mut self) {
        self.pending_low_surrogate = 0;
        if self.peek() == Some(b'^') {
            self.pos += 1;
        }
        while !self.is_class_content_exit() {
            let min_start = self.pos;
            let min_character = self.scan_class_atom();
            if self.peek() != Some(b'-') {
                continue;
            }
            self.pos += 1;
            if self.is_class_content_exit() {
                return;
            }
            if min_character == ClassAtom::None && self.any_unicode_mode {
                self.error(1516, min_start, self.pos - 1 - min_start);
            }
            let max_start = self.pos;
            let max_character = self.scan_class_atom();
            if max_character == ClassAtom::None && self.any_unicode_mode {
                self.error(1516, max_start, self.pos - max_start);
                continue;
            }
            // The empty string decodes as U+FFFD, no bytes long, which is as long as it is: it is compared like a character.
            let max_character = if max_character == ClassAtom::None {
                ClassAtom::Char(RUNE_ERROR)
            } else {
                max_character
            };
            if let (ClassAtom::Char(min), ClassAtom::Char(max)) = (min_character, max_character)
                && min > max
            {
                self.error(1517, min_start, self.pos - min_start);
            }
        }
    }

    /// `--` or `&&` is next.
    fn is_at_class_set_operator(&self) -> bool {
        matches!(
            (self.peek(), self.peek_at(1)),
            (Some(b'-'), Some(b'-')) | (Some(b'&'), Some(b'&'))
        )
    }

    /// `scanClassSetExpression`: `'^'? (ClassUnion | ClassIntersection | ClassSubtraction)`, what is in brackets with `v`.
    ///
    /// Leaves in `may_contain_strings` whether it can match more than one character at once. A union can if any of its operands
    /// can, an intersection if all of them can, a subtraction if the first can; `\q{..}` can unless each alternative is one
    /// character, `\p{..}` if it is a property of strings.
    fn scan_class_set_expression(&mut self) {
        let mut is_character_complement = false;
        if self.peek() == Some(b'^') {
            self.pos += 1;
            is_character_complement = true;
        }
        let mut expression_may_contain_strings = false;
        if self.is_class_content_exit() {
            return;
        }
        let mut start = self.pos;
        let first = self.text[start];
        let mut operand = if self.is_at_class_set_operator() {
            self.error(1520, self.pos, 0);
            self.may_contain_strings = false;
            ClassAtom::None
        } else {
            self.scan_class_set_operand()
        };
        match self.peek() {
            Some(b'-') => {
                if self.peek_at(1) == Some(b'-') {
                    if is_character_complement && self.may_contain_strings {
                        self.error(1518, start, self.pos - start);
                    }
                    let first_may_contain_strings = self.may_contain_strings;
                    self.scan_class_set_sub_expression(ClassSetExpressionType::ClassSubtraction);
                    self.may_contain_strings =
                        !is_character_complement && first_may_contain_strings;
                    return;
                }
            }
            Some(b'&') => {
                if self.peek_at(1) == Some(b'&') {
                    self.scan_class_set_sub_expression(ClassSetExpressionType::ClassIntersection);
                    if is_character_complement && self.may_contain_strings {
                        self.error(1518, start, self.pos - start);
                    }
                    self.may_contain_strings = !is_character_complement && self.may_contain_strings;
                    return;
                }
                // tsgo names the character the expression starts with, not the `&`.
                self.error_unexpected(self.pos, first);
            }
            _ => {
                if is_character_complement && self.may_contain_strings {
                    self.error(1518, start, self.pos - start);
                }
                expression_may_contain_strings = self.may_contain_strings;
            }
        }
        while let Some(ch) = self.peek() {
            match ch {
                b'-' => {
                    self.pos += 1;
                    if self.is_class_content_exit() {
                        break;
                    }
                    if self.peek() == Some(b'-') {
                        self.pos += 1;
                        self.error(1519, self.pos - 2, 2);
                        start = self.pos - 2;
                        operand = ClassAtom::Text;
                        continue;
                    }
                    if operand == ClassAtom::None {
                        self.error(1516, start, self.pos - 1 - start);
                    }
                    let second_start = self.pos;
                    let second_operand = self.scan_class_set_operand();
                    if is_character_complement && self.may_contain_strings {
                        self.error(1518, second_start, self.pos - second_start);
                    }
                    expression_may_contain_strings |= self.may_contain_strings;
                    if second_operand == ClassAtom::None {
                        self.error(1516, second_start, self.pos - second_start);
                    } else if let (ClassAtom::Char(min), ClassAtom::Char(max)) =
                        (operand, second_operand)
                        && min > max
                    {
                        self.error(1517, start, self.pos - start);
                    }
                }
                b'&' => {
                    start = self.pos;
                    self.pos += 1;
                    if self.peek() == Some(b'&') {
                        self.pos += 1;
                        self.error(1519, self.pos - 2, 2);
                        if self.peek() == Some(b'&') {
                            self.error_unexpected(self.pos, ch);
                            self.pos += 1;
                        }
                        operand = ClassAtom::Text;
                    } else {
                        self.error_unexpected(self.pos - 1, ch);
                        operand = ClassAtom::Char(u32::from(ch));
                    }
                    continue;
                }
                _ => {}
            }
            if self.is_class_content_exit() {
                break;
            }
            start = self.pos;
            if self.is_at_class_set_operator() {
                self.error(1519, self.pos, 2);
                self.pos += 2;
                operand = ClassAtom::Text;
            } else {
                operand = self.scan_class_set_operand();
            }
        }
        self.may_contain_strings = !is_character_complement && expression_may_contain_strings;
    }

    /// `scanClassSetSubExpression`: `('&&' ClassSetOperand)+` or `('--' ClassSetOperand)+`, after the first operand.
    fn scan_class_set_sub_expression(&mut self, expression_type: ClassSetExpressionType) {
        let mut expression_may_contain_strings = self.may_contain_strings;
        while !self.is_class_content_exit() {
            match self.peek() {
                Some(b'-') => {
                    self.pos += 1;
                    if self.peek() == Some(b'-') {
                        self.pos += 1;
                        if expression_type != ClassSetExpressionType::ClassSubtraction {
                            self.error(1519, self.pos - 2, 2);
                        }
                    } else {
                        self.error(1519, self.pos - 1, 1);
                    }
                }
                Some(b'&') => {
                    self.pos += 1;
                    if self.peek() == Some(b'&') {
                        self.pos += 1;
                        if expression_type != ClassSetExpressionType::ClassIntersection {
                            self.error(1519, self.pos - 2, 2);
                        }
                        if self.peek() == Some(b'&') {
                            self.error_unexpected(self.pos, b'&');
                            self.pos += 1;
                        }
                    } else {
                        self.error_unexpected(self.pos - 1, b'&');
                    }
                }
                // The operator is expected.
                _ => self.error_with(1005, self.pos, 0, || {
                    vec![
                        match expression_type {
                            ClassSetExpressionType::ClassSubtraction => "--",
                            ClassSetExpressionType::ClassIntersection => "&&",
                        }
                        .to_owned(),
                    ]
                }),
            }
            if self.is_class_content_exit() {
                self.error(1520, self.pos, 0);
                break;
            }
            self.scan_class_set_operand();
            if expression_type == ClassSetExpressionType::ClassIntersection {
                expression_may_contain_strings &= self.may_contain_strings;
            }
        }
        self.may_contain_strings = expression_may_contain_strings;
    }

    /// `scanClassSetOperand`: a class in brackets, a class escape, `\q{..}`, or a character.
    fn scan_class_set_operand(&mut self) -> ClassAtom {
        self.may_contain_strings = false;
        match self.peek() {
            Some(b'[') => {
                self.pos += 1;
                if self.enter() {
                    self.scan_class_set_expression();
                    self.nesting -= 1;
                }
                self.scan_expected_char(b']');
                ClassAtom::None
            }
            Some(b'\\') => {
                self.pos += 1;
                if self.scan_character_class_escape() {
                    return ClassAtom::None;
                }
                if self.peek() == Some(b'q') {
                    self.pos += 1;
                    if self.peek() == Some(b'{') {
                        self.pos += 1;
                        self.scan_class_string_disjunction_contents();
                        self.scan_expected_char(b'}');
                        return ClassAtom::None;
                    }
                    self.error(1521, self.pos - 2, 2);
                    return ClassAtom::Char(u32::from(b'q'));
                }
                self.pos -= 1;
                self.scan_class_set_character()
            }
            _ => self.scan_class_set_character(),
        }
    }

    /// `scanClassStringDisjunctionContents`: `ClassSetCharacter* ('|' ClassSetCharacter*)*`, past the `{` of `\q{`.
    fn scan_class_string_disjunction_contents(&mut self) {
        let mut character_count = 0;
        while let Some(ch) = self.peek() {
            match ch {
                b'}' => {
                    if character_count != 1 {
                        self.may_contain_strings = true;
                    }
                    return;
                }
                b'|' => {
                    if character_count != 1 {
                        self.may_contain_strings = true;
                    }
                    self.pos += 1;
                    character_count = 0;
                }
                _ => {
                    self.scan_class_set_character();
                    character_count += 1;
                }
            }
        }
    }

    /// `scanClassSetCharacter`: a character that means nothing to the syntax of classes and is not doubled punctuation, or an escape.
    fn scan_class_set_character(&mut self) -> ClassAtom {
        let Some(ch) = self.peek() else {
            return ClassAtom::None;
        };
        if ch == b'\\' {
            self.pos += 1;
            return match self.peek() {
                Some(b'b') => {
                    self.pos += 1;
                    ClassAtom::Char(0x08)
                }
                Some(
                    inner @ (b'&' | b'-' | b'!' | b'#' | b'%' | b',' | b':' | b';' | b'<' | b'='
                    | b'>' | b'@' | b'`' | b'~'),
                ) => {
                    self.pos += 1;
                    ClassAtom::Char(u32::from(inner))
                }
                _ => self.scan_character_escape(false),
            };
        }
        if self.peek_at(1) == Some(ch)
            && matches!(
                ch,
                b'&' | b'!'
                    | b'#'
                    | b'%'
                    | b'*'
                    | b'+'
                    | b','
                    | b'.'
                    | b':'
                    | b';'
                    | b'<'
                    | b'='
                    | b'>'
                    | b'?'
                    | b'@'
                    | b'`'
                    | b'~'
            )
        {
            self.error(1522, self.pos, 2);
            self.pos += 2;
            return ClassAtom::Text;
        }
        if matches!(
            ch,
            b'/' | b'(' | b')' | b'[' | b']' | b'{' | b'}' | b'-' | b'|'
        ) {
            self.error_unexpected(self.pos, ch);
            self.pos += 1;
            return ClassAtom::Char(u32::from(ch));
        }
        self.scan_source_character()
    }

    /// `scanClassAtom`: any character but `\` and `]`, or an escape: `\b`, `\-`, a class, a character.
    fn scan_class_atom(&mut self) -> ClassAtom {
        if self.peek() != Some(b'\\') {
            return self.scan_source_character();
        }
        self.pos += 1;
        match self.peek() {
            Some(b'b') => {
                self.pos += 1;
                ClassAtom::Char(0x08)
            }
            Some(b'-') => {
                self.pos += 1;
                ClassAtom::Char(u32::from(b'-'))
            }
            _ if self.scan_character_class_escape() => ClassAtom::None,
            _ => self.scan_character_escape(false),
        }
    }

    /// `scanCharacterClassEscape`: past the backslash, one of `dDsSwW`, or `p` or `P` and a property in braces.
    fn scan_character_class_escape(&mut self) -> bool {
        let start = self.pos - 1;
        let is_character_complement = match self.peek() {
            Some(b'd' | b'D' | b's' | b'S' | b'w' | b'W') => {
                self.pos += 1;
                return true;
            }
            Some(b'P') => true,
            Some(b'p') => false,
            _ => return false,
        };
        self.pos += 1;
        if self.peek() == Some(b'{') {
            self.pos += 1;
            let property_name_or_value_start = self.pos;
            let property_name_or_value = self.scan_word_characters();
            if self.peek() == Some(b'=') {
                let values = NON_BINARY_UNICODE_PROPERTIES.get(property_name_or_value);
                if self.pos == property_name_or_value_start {
                    self.error(1523, self.pos, 0);
                } else if values.is_none() {
                    self.error(
                        1524,
                        property_name_or_value_start,
                        property_name_or_value.len(),
                    );
                    // `getSpellingSuggestionForUnicodePropertyName`
                    self.suggest(
                        property_name_or_value_start,
                        property_name_or_value.len(),
                        property_name_or_value,
                        NON_BINARY_UNICODE_PROPERTIES.keys(),
                    );
                }
                self.pos += 1;
                let property_value_start = self.pos;
                let property_value = self.scan_word_characters();
                if self.pos == property_value_start {
                    self.error(1525, self.pos, 0);
                } else if let Some(&is_general_category) = values
                    && !match is_general_category {
                        true => GENERAL_CATEGORY_VALUES.contains(property_value),
                        false => SCRIPT_VALUES.contains(property_value),
                    }
                {
                    let (start, length) = (property_value_start, property_value.len());
                    self.error(1526, start, length);
                    // `getSpellingSuggestionForUnicodePropertyValue`
                    match is_general_category {
                        true => self.suggest(
                            start,
                            length,
                            property_value,
                            GENERAL_CATEGORY_VALUES.iter(),
                        ),
                        false => self.suggest(start, length, property_value, SCRIPT_VALUES.iter()),
                    }
                }
            } else if self.pos == property_name_or_value_start {
                self.error(1527, self.pos, 0);
            } else if BINARY_UNICODE_PROPERTIES_OF_STRINGS.contains(property_name_or_value) {
                if !self.unicode_sets_mode {
                    self.error(
                        1528,
                        property_name_or_value_start,
                        property_name_or_value.len(),
                    );
                } else if is_character_complement {
                    self.error(
                        1518,
                        property_name_or_value_start,
                        property_name_or_value.len(),
                    );
                } else {
                    self.may_contain_strings = true;
                }
            } else if !GENERAL_CATEGORY_VALUES.contains(property_name_or_value)
                && !BINARY_UNICODE_PROPERTIES.contains(property_name_or_value)
            {
                self.error(
                    1529,
                    property_name_or_value_start,
                    property_name_or_value.len(),
                );
                // `getSpellingSuggestionForUnicodePropertyNameOrValue`
                self.suggest(
                    property_name_or_value_start,
                    property_name_or_value.len(),
                    property_name_or_value,
                    GENERAL_CATEGORY_VALUES
                        .iter()
                        .chain(BINARY_UNICODE_PROPERTIES.iter())
                        .chain(BINARY_UNICODE_PROPERTIES_OF_STRINGS.iter()),
                );
            }
            self.scan_expected_char(b'}');
            if !self.any_unicode_mode {
                self.error(1530, start, self.pos - start);
            }
        } else if self.any_unicode_mode {
            self.error_with(1531, self.pos - 2, 2, || {
                vec![if is_character_complement { "P" } else { "p" }.to_owned()]
            });
        } else {
            self.pos -= 1;
            return false;
        }
        true
    }

    /// `scanWordCharacters`
    fn scan_word_characters(&mut self) -> &'a [u8] {
        let text = self.text;
        let start = self.pos;
        while self
            .peek()
            .is_some_and(|ch| ch.is_ascii_alphanumeric() || ch == b'_')
        {
            self.pos += 1;
        }
        &text[start..self.pos]
    }

    /// `scanSourceCharacter`
    fn scan_source_character(&mut self) -> ClassAtom {
        if self.pos >= self.end {
            return ClassAtom::None;
        }
        let (ch, size) = decode_rune(&self.text[self.pos..]);
        if self.any_unicode_mode {
            self.pos += size;
            return if ch == RUNE_ERROR {
                ClassAtom::None
            } else {
                ClassAtom::Char(ch)
            };
        }
        if self.pending_low_surrogate != 0 {
            self.pos += size;
            return ClassAtom::Char(std::mem::take(&mut self.pending_low_surrogate));
        }
        if ch == RUNE_ERROR {
            // One byte of it.
            self.pos += 1;
            return ClassAtom::Char(u32::from(self.text[self.pos - 1]));
        }
        if ch > 0xFFFF {
            self.pending_low_surrogate = 0xDC00 + ((ch - 0x10000) & 0x3FF);
            return ClassAtom::Char(0xD800 + ((ch - 0x10000) >> 10));
        }
        self.pos += size;
        ClassAtom::Char(ch)
    }

    /// `scanExpectedChar`
    fn scan_expected_char(&mut self, ch: u8) {
        if self.peek() == Some(ch) {
            self.pos += 1;
        } else {
            self.error_with(1005, self.pos, 0, || vec![char::from(ch).to_string()]);
        }
    }

    /// `scanDigits`
    fn scan_digits(&mut self) -> &'a [u8] {
        let text = self.text;
        let start = self.pos;
        while self.peek().is_some_and(|ch| ch.is_ascii_digit()) {
            self.pos += 1;
        }
        &text[start..self.pos]
    }
}

/// `compareDecimalStrings`: numbers of any length.
fn compare_decimal_strings(a: &[u8], b: &[u8]) -> std::cmp::Ordering {
    fn without_leading_zeros(digits: &[u8]) -> &[u8] {
        &digits[digits
            .iter()
            .position(|&digit| digit != b'0')
            .unwrap_or(digits.len())..]
    }
    let (a, b) = (without_leading_zeros(a), without_leading_zeros(b));
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

/// `strconv.ParseInt(digits, 16, 32)`: what is too great to be told is only known to be great.
fn parse_hex(digits: &[u8]) -> u32 {
    digits.iter().fold(0u32, |value, &digit| {
        value
            .saturating_mul(16)
            .saturating_add(char::from(digit).to_digit(16).unwrap_or(0))
    })
}

/// `utf8.DecodeRuneInString`: the first character and how many bytes it takes. What is not UTF-8 is U+FFFD and takes one; nothing
/// at all is U+FFFD and takes none.
fn decode_rune(text: &[u8]) -> (u32, usize) {
    let Some(&first) = text.first() else {
        return (RUNE_ERROR, 0);
    };
    let (size, least, bits) = match first {
        0x00..=0x7F => return (u32::from(first), 1),
        0xC2..=0xDF => (2, 0x80, first & 0x1F),
        0xE0..=0xEF => (3, 0x800, first & 0x0F),
        0xF0..=0xF4 => (4, 0x10000, first & 0x07),
        _ => return (RUNE_ERROR, 1),
    };
    let Some(rest) = text.get(1..size) else {
        return (RUNE_ERROR, 1);
    };
    let mut ch = u32::from(bits);
    for &byte in rest {
        if byte & 0xC0 != 0x80 {
            return (RUNE_ERROR, 1);
        }
        ch = (ch << 6) | u32::from(byte & 0x3F);
    }
    if ch < least || char::from_u32(ch).is_none() {
        return (RUNE_ERROR, 1);
    }
    (ch, size)
}

/// `GetSpellingSuggestion`
pub fn get_spelling_suggestion<'c, T: Copy>(
    name: &[u8],
    candidates: impl Iterator<Item = T>,
    get_name: impl Fn(T) -> &'c [u8],
    compare: impl Fn(T, T) -> std::cmp::Ordering,
) -> Option<T> {
    let runes = |text: &[u8]| -> Vec<char> {
        let invalid = |chunk: &std::str::Utf8Chunk| !chunk.invalid().is_empty();
        text.utf8_chunks()
            .flat_map(|c| c.valid().chars().chain(invalid(&c).then_some('\u{FFFD}')))
            .collect()
    };
    let name_runes = runes(name);
    let maximum_length_difference = 2.max((name_runes.len() as f64 * 0.34) as usize);
    // Anything worse than this is not worth saying.
    let mut best_distance = (name_runes.len() as f64 * 0.4).floor() + 0.9;
    let mut best: Option<T> = None;
    for candidate in candidates {
        let candidate_name = get_name(candidate);
        if candidate_name.is_empty()
            || candidate_name.len().abs_diff(name_runes.len()) > maximum_length_difference
            || candidate_name == name
        {
            continue;
        }
        let candidate_runes = runes(candidate_name);
        // Two letters are told apart at a glance, unless it is by their case.
        let lower = |runes: &[char]| {
            runes
                .iter()
                .flat_map(|c| c.to_lowercase())
                .collect::<Vec<_>>()
        };
        if candidate_name.len() < 3 && lower(&candidate_runes) != lower(&name_runes) {
            continue;
        }
        let Some(distance) = levenshtein_with_max(&name_runes, &candidate_runes, best_distance)
        else {
            continue;
        };
        if distance < best_distance {
            best_distance = distance;
            best = Some(candidate);
        } else if best.is_none_or(|best| compare(candidate, best).is_lt()) {
            best = Some(candidate);
        }
    }
    best
}

/// `GetSpellingSuggestionForStrings`
pub(super) fn spelling_suggestion<'c>(
    name: &[u8],
    candidates: impl Iterator<Item = &'c [u8]>,
) -> Option<String> {
    get_spelling_suggestion(name, candidates, |c| c, |a, b| a.cmp(b))
        .map(|best| String::from_utf8_lossy(best).into_owned())
}

/// `levenshteinWithMax`: changing a letter costs two, and changing its case next to nothing. `None` for its -1: more than `max_value`.
fn levenshtein_with_max(s1: &[char], s2: &[char], max_value: f64) -> Option<f64> {
    let mut previous: Vec<f64> = (0..=s2.len()).map(|j| j as f64).collect();
    let mut current = vec![0.0; s2.len() + 1];
    let big = max_value + 0.01;
    for (i, &c1) in s1.iter().enumerate() {
        let row = (i + 1) as f64;
        let min_j = if row > max_value {
            (row - max_value).ceil() as usize
        } else {
            1
        };
        let max_j = ((max_value + row).floor() as usize).min(s2.len());
        let mut col_min = row;
        current[0] = row;
        for cell in &mut current[1..min_j.min(s2.len() + 1)] {
            *cell = big;
        }
        for j in min_j..=max_j {
            let c2 = s2[j - 1];
            let distance = if c1 == c2 {
                previous[j - 1]
            } else {
                let substitution = previous[j - 1]
                    + if c1.to_lowercase().eq(c2.to_lowercase()) {
                        0.1
                    } else {
                        2.0
                    };
                (previous[j] + 1.0)
                    .min(current[j - 1] + 1.0)
                    .min(substitution)
            };
            current[j] = distance;
            col_min = col_min.min(distance);
        }
        for cell in &mut current[(max_j + 1).min(s2.len() + 1)..] {
            *cell = big;
        }
        if col_min > max_value {
            return None;
        }
        std::mem::swap(&mut previous, &mut current);
    }
    let distance = previous[s2.len()];
    (distance <= max_value).then_some(distance)
}

bun_core::comptime_string_map! {
    /// `nonBinaryUnicodeProperties`: maps a property name or alias to its value set. `true`: `General_Category` values. `false`:
    /// `Script` values, which `Script_Extensions` also accepts.
    static NON_BINARY_UNICODE_PROPERTIES: bool = {
        b"General_Category" => true, b"gc" => true,
        b"Script" => false, b"sc" => false, b"Script_Extensions" => false, b"scx" => false,
    };
}

bun_core::comptime_string_set! {
    /// `binaryUnicodeProperties`: https://tc39.es/ecma262/#table-binary-unicode-properties
    static BINARY_UNICODE_PROPERTIES = {
        "ASCII", "ASCII_Hex_Digit", "AHex", "Alphabetic", "Alpha", "Any", "Assigned", "Bidi_Control", "Bidi_C", "Bidi_Mirrored",
        "Bidi_M", "Case_Ignorable", "CI", "Cased", "Changes_When_Casefolded", "CWCF", "Changes_When_Casemapped", "CWCM",
        "Changes_When_Lowercased", "CWL", "Changes_When_NFKC_Casefolded", "CWKCF", "Changes_When_Titlecased", "CWT",
        "Changes_When_Uppercased", "CWU", "Dash", "Default_Ignorable_Code_Point", "DI", "Deprecated", "Dep", "Diacritic", "Dia",
        "Emoji", "Emoji_Component", "EComp", "Emoji_Modifier", "EMod", "Emoji_Modifier_Base", "EBase", "Emoji_Presentation",
        "EPres", "Extended_Pictographic", "ExtPict", "Extender", "Ext", "Grapheme_Base", "Gr_Base", "Grapheme_Extend", "Gr_Ext",
        "Hex_Digit", "Hex", "IDS_Binary_Operator", "IDSB", "IDS_Trinary_Operator", "IDST", "ID_Continue", "IDC", "ID_Start", "IDS",
        "Ideographic", "Ideo", "Join_Control", "Join_C", "Logical_Order_Exception", "LOE", "Lowercase", "Lower", "Math",
        "Noncharacter_Code_Point", "NChar", "Pattern_Syntax", "Pat_Syn", "Pattern_White_Space", "Pat_WS", "Quotation_Mark", "QMark",
        "Radical", "Regional_Indicator", "RI", "Sentence_Terminal", "STerm", "Soft_Dotted", "SD", "Terminal_Punctuation", "Term",
        "Unified_Ideograph", "UIdeo", "Uppercase", "Upper", "Variation_Selector", "VS", "White_Space", "space", "XID_Continue",
        "XIDC", "XID_Start", "XIDS",
    };
}

bun_core::comptime_string_set! {
    /// `binaryUnicodePropertiesOfStrings`: https://tc39.es/ecma262/#table-binary-unicode-properties-of-strings
    static BINARY_UNICODE_PROPERTIES_OF_STRINGS = {
        "Basic_Emoji", "Emoji_Keycap_Sequence", "RGI_Emoji_Modifier_Sequence", "RGI_Emoji_Flag_Sequence", "RGI_Emoji_Tag_Sequence",
        "RGI_Emoji_ZWJ_Sequence", "RGI_Emoji",
    };
}

bun_core::comptime_string_set! {
    /// `valuesOfNonBinaryUnicodeProperties["General_Category"]`
    static GENERAL_CATEGORY_VALUES = {
        "C", "Other", "Cc", "Control", "cntrl", "Cf", "Format", "Cn", "Unassigned", "Co", "Private_Use", "Cs", "Surrogate", "L",
        "Letter", "LC", "Cased_Letter", "Ll", "Lowercase_Letter", "Lm", "Modifier_Letter", "Lo", "Other_Letter", "Lt",
        "Titlecase_Letter", "Lu", "Uppercase_Letter", "M", "Mark", "Combining_Mark", "Mc", "Spacing_Mark", "Me", "Enclosing_Mark",
        "Mn", "Nonspacing_Mark", "N", "Number", "Nd", "Decimal_Number", "digit", "Nl", "Letter_Number", "No", "Other_Number", "P",
        "Punctuation", "punct", "Pc", "Connector_Punctuation", "Pd", "Dash_Punctuation", "Pe", "Close_Punctuation", "Pf",
        "Final_Punctuation", "Pi", "Initial_Punctuation", "Po", "Other_Punctuation", "Ps", "Open_Punctuation", "S", "Symbol", "Sc",
        "Currency_Symbol", "Sk", "Modifier_Symbol", "Sm", "Math_Symbol", "So", "Other_Symbol", "Z", "Separator", "Zl",
        "Line_Separator", "Zp", "Paragraph_Separator", "Zs", "Space_Separator",
    };
}

bun_core::comptime_string_set! {
    /// `scriptValues`: Unicode 15.1
    static SCRIPT_VALUES = {
        "Adlm", "Adlam", "Aghb", "Caucasian_Albanian", "Ahom", "Arab", "Arabic", "Armi", "Imperial_Aramaic", "Armn", "Armenian",
        "Avst", "Avestan", "Bali", "Balinese", "Bamu", "Bamum", "Bass", "Bassa_Vah", "Batk", "Batak", "Beng", "Bengali", "Bhks",
        "Bhaiksuki", "Bopo", "Bopomofo", "Brah", "Brahmi", "Brai", "Braille", "Bugi", "Buginese", "Buhd", "Buhid", "Cakm", "Chakma",
        "Cans", "Canadian_Aboriginal", "Cari", "Carian", "Cham", "Cher", "Cherokee", "Chrs", "Chorasmian", "Copt", "Coptic", "Qaac",
        "Cpmn", "Cypro_Minoan", "Cprt", "Cypriot", "Cyrl", "Cyrillic", "Deva", "Devanagari", "Diak", "Dives_Akuru", "Dogr", "Dogra",
        "Dsrt", "Deseret", "Dupl", "Duployan", "Egyp", "Egyptian_Hieroglyphs", "Elba", "Elbasan", "Elym", "Elymaic", "Ethi",
        "Ethiopic", "Geor", "Georgian", "Glag", "Glagolitic", "Gong", "Gunjala_Gondi", "Gonm", "Masaram_Gondi", "Goth", "Gothic",
        "Gran", "Grantha", "Grek", "Greek", "Gujr", "Gujarati", "Guru", "Gurmukhi", "Hang", "Hangul", "Hani", "Han", "Hano",
        "Hanunoo", "Hatr", "Hatran", "Hebr", "Hebrew", "Hira", "Hiragana", "Hluw", "Anatolian_Hieroglyphs", "Hmng", "Pahawh_Hmong",
        "Hmnp", "Nyiakeng_Puachue_Hmong", "Hrkt", "Katakana_Or_Hiragana", "Hung", "Old_Hungarian", "Ital", "Old_Italic", "Java",
        "Javanese", "Kali", "Kayah_Li", "Kana", "Katakana", "Kawi", "Khar", "Kharoshthi", "Khmr", "Khmer", "Khoj", "Khojki", "Kits",
        "Khitan_Small_Script", "Knda", "Kannada", "Kthi", "Kaithi", "Lana", "Tai_Tham", "Laoo", "Lao", "Latn", "Latin", "Lepc",
        "Lepcha", "Limb", "Limbu", "Lina", "Linear_A", "Linb", "Linear_B", "Lisu", "Lyci", "Lycian", "Lydi", "Lydian", "Mahj",
        "Mahajani", "Maka", "Makasar", "Mand", "Mandaic", "Mani", "Manichaean", "Marc", "Marchen", "Medf", "Medefaidrin", "Mend",
        "Mende_Kikakui", "Merc", "Meroitic_Cursive", "Mero", "Meroitic_Hieroglyphs", "Mlym", "Malayalam", "Modi", "Mong",
        "Mongolian", "Mroo", "Mro", "Mtei", "Meetei_Mayek", "Mult", "Multani", "Mymr", "Myanmar", "Nagm", "Nag_Mundari", "Nand",
        "Nandinagari", "Narb", "Old_North_Arabian", "Nbat", "Nabataean", "Newa", "Nkoo", "Nko", "Nshu", "Nushu", "Ogam", "Ogham",
        "Olck", "Ol_Chiki", "Orkh", "Old_Turkic", "Orya", "Oriya", "Osge", "Osage", "Osma", "Osmanya", "Ougr", "Old_Uyghur", "Palm",
        "Palmyrene", "Pauc", "Pau_Cin_Hau", "Perm", "Old_Permic", "Phag", "Phags_Pa", "Phli", "Inscriptional_Pahlavi", "Phlp",
        "Psalter_Pahlavi", "Phnx", "Phoenician", "Plrd", "Miao", "Prti", "Inscriptional_Parthian", "Rjng", "Rejang", "Rohg",
        "Hanifi_Rohingya", "Runr", "Runic", "Samr", "Samaritan", "Sarb", "Old_South_Arabian", "Saur", "Saurashtra", "Sgnw",
        "SignWriting", "Shaw", "Shavian", "Shrd", "Sharada", "Sidd", "Siddham", "Sind", "Khudawadi", "Sinh", "Sinhala", "Sogd",
        "Sogdian", "Sogo", "Old_Sogdian", "Sora", "Sora_Sompeng", "Soyo", "Soyombo", "Sund", "Sundanese", "Sylo", "Syloti_Nagri",
        "Syrc", "Syriac", "Tagb", "Tagbanwa", "Takr", "Takri", "Tale", "Tai_Le", "Talu", "New_Tai_Lue", "Taml", "Tamil", "Tang",
        "Tangut", "Tavt", "Tai_Viet", "Telu", "Telugu", "Tfng", "Tifinagh", "Tglg", "Tagalog", "Thaa", "Thaana", "Thai", "Tibt",
        "Tibetan", "Tirh", "Tirhuta", "Tnsa", "Tangsa", "Toto", "Ugar", "Ugaritic", "Vaii", "Vai", "Vith", "Vithkuqi", "Wara",
        "Warang_Citi", "Wcho", "Wancho", "Xpeo", "Old_Persian", "Xsux", "Cuneiform", "Yezi", "Yezidi", "Yiii", "Yi", "Zanb",
        "Zanabazar_Square", "Zinh", "Inherited", "Qaai", "Zyyy", "Common", "Zzzz", "Unknown",
    };
}
