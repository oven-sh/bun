//! Regular expression literals, read the way an engine reads them: 1499 to 1538, and what the scanner says of the escapes in them
//! and of what is missing from them: 1005 1125 1126 1198 1199 1487 1488.
//!
//! A port of regexp.go and unicodeproperties.go of TypeScript 7.0.2's scanner, of `ReScanSlashToken`, `scanEscapeSequence`,
//! `scanUnicodeEscape`, `scanIdentifier` and `scanIdentifierParts` of its scanner.go as far as regular expressions use them, and
//! of `checkGrammarRegularExpressionLiteral` of grammarchecks.go, which decides what of all that is reported.
//!
//! tsgo always allows for Annex B, so that its `anyUnicodeModeOrNonAnnexB` is `anyUnicodeMode`. Its suggestions (`Did_you_mean_0`)
//! only ever end up attached to the error before them: they are left out.

use super::errors::Diagnostic;
use super::*;
use crate::resolve::ScriptTarget;
use std::borrow::Cow;

impl Checker<'_> {
    /// `checkRegularExpressionLiteral`, `checkGrammarRegularExpressionLiteral`
    pub(super) fn check_x_regexp_scanner(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if has_parse_diagnostics(hir) {
            return;
        }
        // `GetEmitScriptTarget`
        let target = match self.p.files.options.target {
            ScriptTarget::None => ScriptTarget::ES2025,
            target => target,
        };
        for e in &hir.exprs {
            if matches!(e.kind, ExprKind::Regex) {
                check_regular_expression_literal(&hir.text, e.pos as usize, target, out);
            }
        }
    }
}

/// `hasParseDiagnostics`. What the parser objected to and went on from is kept with what tsgo's binder and checker say of syntax.
/// They are told apart by the code: these are the ones only parser.go and scanner.go give, and 1003 and 1005, which are only ever
/// noted for what the parser expected and did not find.
fn has_parse_diagnostics(hir: &hir::File) -> bool {
    hir.has_errors
        || hir.syntax_errors > 0
        || hir.early_errors.iter().any(|&(_, code)| {
            matches!(
                code,
                1002 | 1003 | 1005 | 1007 | 1010..=1012 | 1034 | 1068 | 1084 | 1109 | 1121 | 1124..=1132 | 1134 | 1135 | 1137..=1140
                    | 1144..=1146 | 1160 | 1161 | 1177..=1181 | 1185 | 1198 | 1199 | 1209 | 1260 | 1351..=1353 | 1357 | 1381 | 1382
                    | 1385..=1390 | 1434..=1443 | 1472 | 1477 | 1478 | 1487..=1490 | 2754 | 2809 | 2819 | 6188 | 6189 | 17002
                    | 17006..=17008 | 17014 | 17015 | 17021 | 18009 | 18026 | 18029 | 18030
            )
        })
}

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
    out: &mut Vec<Diagnostic>,
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
        out,
    };
    p += 1;
    let mut flags = 0u8;
    while p < text.len() {
        let (ch, size) = decode_rune(&text[p..]);
        if ch == RUNE_ERROR || !is_identifier_part(ch) {
            break;
        }
        match regexp_flag(ch) {
            None => parser.error(1499, p),
            Some(flag) if flags & flag != 0 => parser.error(1500, p),
            Some(flag) if (flags | flag) & ANY_UNICODE_MODE == ANY_UNICODE_MODE => {
                parser.error(1502, p)
            }
            Some(flag) => {
                flags |= flag;
                parser.check_flag_availability(flag, p);
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
    /// `\k<name>`: where the name is, and the name.
    group_name_references: Vec<(usize, Cow<'a, [u8]>)>,
    /// `\1`: where the number is, and the number.
    decimal_escapes: Vec<(usize, usize)>,
    /// Which of `group_specifiers` are in the alternatives being read. tsgo has a stack of sets, one for each alternative.
    named_capturing_groups: Vec<usize>,
    /// Without `u` or `v` a character past U+FFFF is two. The first has been given, without moving on: this is the second.
    pending_low_surrogate: u32,
    nesting: u32,
    /// `MAX_NESTING` was reached. Nothing more is said of the literal.
    is_too_deep: bool,
    /// Where the last error that was reported is.
    last_error: Option<usize>,
    out: &'a mut Vec<Diagnostic>,
}

impl<'a> RegExpParser<'a> {
    /// What `checkGrammarRegularExpressionLiteral` makes of what the scanner says: an error where the one before it is adds nothing.
    fn error(&mut self, code: u32, start: usize) {
        if self.last_error != Some(start) && !self.is_too_deep {
            self.last_error = Some(start);
            self.out.push(Diagnostic {
                start: start as u32,
                code,
            });
        }
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
    fn check_flag_availability(&mut self, flag: u8, pos: usize) {
        let available_from = match flag {
            HAS_INDICES => ScriptTarget::ES2022,
            DOT_ALL => ScriptTarget::ES2018,
            UNICODE_SETS => ScriptTarget::ES2024,
            _ => return,
        };
        if self.target < available_from {
            self.error(1501, pos);
        }
    }

    /// `run`
    fn run(&mut self) {
        self.scan_disjunction(false);
        for (pos, name) in &std::mem::take(&mut self.group_name_references) {
            if !self.group_specifiers.contains(name) {
                self.error(1532, *pos);
            }
        }
        // With Annex B a number greater than that of the groups is an octal escape or the digits themselves. Most likely it is
        // a mistake all the same.
        for (pos, value) in std::mem::take(&mut self.decimal_escapes) {
            if value > self.number_of_capturing_groups {
                self.error(
                    if self.number_of_capturing_groups > 0 {
                        1533
                    } else {
                        1534
                    },
                    pos,
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
                                        self.error(1503, group_name_start);
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
                                        self.error(1504, flags_start);
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
                        self.error(1507, start);
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
                        self.error(1508, self.pos);
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
                    self.error(1505, digits_start);
                } else {
                    self.error(1508, start);
                    return false;
                }
            } else if !max.is_empty()
                && compare_decimal_strings(min, max).is_gt()
                && (self.any_unicode_mode || self.peek() == Some(b'}'))
            {
                self.error(1506, digits_start);
            }
        } else if min.is_empty() {
            if self.any_unicode_mode {
                self.error(1508, start);
            }
            return false;
        }
        if self.peek() != Some(b'}') {
            if !self.any_unicode_mode {
                return false;
            }
            self.error(1005, self.pos);
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
                None => self.error(1499, self.pos),
                Some(flag) if curr_flags & flag != 0 => self.error(1500, self.pos),
                Some(flag) if flag & MODIFIERS == 0 => self.error(1509, self.pos),
                Some(flag) => {
                    curr_flags |= flag;
                    self.check_flag_availability(flag, self.pos);
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
                    self.error(1510, self.pos - 2);
                }
            }
            Some(b'q') if self.unicode_sets_mode => {
                self.pos += 1;
                self.error(1511, self.pos - 2);
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
        self.decimal_escapes.push((start, value));
        true
    }

    /// `scanCharacterEscape`: past the backslash, `c` and a letter, a character of the syntax, or what `scan_escape_sequence` knows.
    fn scan_character_escape(&mut self, atom_escape: bool) -> ClassAtom {
        let Some(ch) = self.peek() else {
            self.error(1513, self.pos - 1);
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
                    self.error(1512, self.pos - 2);
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
            self.error(1126, self.pos);
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
                self.error(
                    if !atom_escape && ch != b'0' {
                        1536
                    } else {
                        1487
                    },
                    start,
                );
                ClassAtom::Char(
                    self.text[start + 1..self.pos]
                        .iter()
                        .fold(0u32, |code, &digit| code * 8 + u32::from(digit - b'0')),
                )
            }
            b'8' | b'9' => {
                self.error(if atom_escape { 1488 } else { 1537 }, start);
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
                        self.error(1538, start);
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
                        self.error(1125, self.pos);
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
                    self.error(1535, start);
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
                self.error(1125, self.pos);
            }
            return None;
        }
        let value = parse_hex(&self.text[digits_start..self.pos]);
        if extended {
            let mut is_invalid_extended_escape = false;
            if value > 0x10FFFF {
                if should_emit_invalid_escape_error {
                    self.error(1198, start + 1);
                }
                is_invalid_extended_escape = true;
            }
            match self.peek() {
                Some(b'}') => self.pos += 1,
                next => {
                    if should_emit_invalid_escape_error {
                        self.error(if next.is_none() { 1126 } else { 1199 }, self.pos);
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
            self.error(1514, self.pos);
        } else if is_reference {
            self.group_name_references.push((start, name));
        } else if self
            .named_capturing_groups
            .iter()
            .any(|&group| self.group_specifiers[group] == name)
        {
            self.error(1515, start);
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
                self.error(1516, min_start);
            }
            let max_start = self.pos;
            let max_character = self.scan_class_atom();
            if max_character == ClassAtom::None && self.any_unicode_mode {
                self.error(1516, max_start);
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
                self.error(1517, min_start);
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
        let mut operand = if self.is_at_class_set_operator() {
            self.error(1520, self.pos);
            self.may_contain_strings = false;
            ClassAtom::None
        } else {
            self.scan_class_set_operand()
        };
        match self.peek() {
            Some(b'-') => {
                if self.peek_at(1) == Some(b'-') {
                    if is_character_complement && self.may_contain_strings {
                        self.error(1518, start);
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
                        self.error(1518, start);
                    }
                    self.may_contain_strings = !is_character_complement && self.may_contain_strings;
                    return;
                }
                self.error(1508, self.pos);
            }
            _ => {
                if is_character_complement && self.may_contain_strings {
                    self.error(1518, start);
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
                        self.error(1519, self.pos - 2);
                        start = self.pos - 2;
                        operand = ClassAtom::Text;
                        continue;
                    }
                    if operand == ClassAtom::None {
                        self.error(1516, start);
                    }
                    let second_start = self.pos;
                    let second_operand = self.scan_class_set_operand();
                    if is_character_complement && self.may_contain_strings {
                        self.error(1518, second_start);
                    }
                    expression_may_contain_strings |= self.may_contain_strings;
                    if second_operand == ClassAtom::None {
                        self.error(1516, second_start);
                    } else if let (ClassAtom::Char(min), ClassAtom::Char(max)) =
                        (operand, second_operand)
                        && min > max
                    {
                        self.error(1517, start);
                    }
                }
                b'&' => {
                    start = self.pos;
                    self.pos += 1;
                    if self.peek() == Some(b'&') {
                        self.pos += 1;
                        self.error(1519, self.pos - 2);
                        if self.peek() == Some(b'&') {
                            self.error(1508, self.pos);
                            self.pos += 1;
                        }
                        operand = ClassAtom::Text;
                    } else {
                        self.error(1508, self.pos - 1);
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
                self.error(1519, self.pos);
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
                            self.error(1519, self.pos - 2);
                        }
                    } else {
                        self.error(1519, self.pos - 1);
                    }
                }
                Some(b'&') => {
                    self.pos += 1;
                    if self.peek() == Some(b'&') {
                        self.pos += 1;
                        if expression_type != ClassSetExpressionType::ClassIntersection {
                            self.error(1519, self.pos - 2);
                        }
                        if self.peek() == Some(b'&') {
                            self.error(1508, self.pos);
                            self.pos += 1;
                        }
                    } else {
                        self.error(1508, self.pos - 1);
                    }
                }
                // The operator is expected.
                _ => self.error(1005, self.pos),
            }
            if self.is_class_content_exit() {
                self.error(1520, self.pos);
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
                    self.error(1521, self.pos - 2);
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
            self.error(1522, self.pos);
            self.pos += 2;
            return ClassAtom::Text;
        }
        if matches!(
            ch,
            b'/' | b'(' | b')' | b'[' | b']' | b'{' | b'}' | b'-' | b'|'
        ) {
            self.error(1508, self.pos);
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
                let values = values_of_non_binary_unicode_property(property_name_or_value);
                if self.pos == property_name_or_value_start {
                    self.error(1523, self.pos);
                } else if values.is_none() {
                    self.error(1524, property_name_or_value_start);
                }
                self.pos += 1;
                let property_value_start = self.pos;
                let property_value = self.scan_word_characters();
                if self.pos == property_value_start {
                    self.error(1525, self.pos);
                } else if let Some(values) = values
                    && !has(values, property_value)
                {
                    self.error(1526, property_value_start);
                }
            } else if self.pos == property_name_or_value_start {
                self.error(1527, self.pos);
            } else if has(BINARY_UNICODE_PROPERTIES_OF_STRINGS, property_name_or_value) {
                if !self.unicode_sets_mode {
                    self.error(1528, property_name_or_value_start);
                } else if is_character_complement {
                    self.error(1518, property_name_or_value_start);
                } else {
                    self.may_contain_strings = true;
                }
            } else if !has(GENERAL_CATEGORY_VALUES, property_name_or_value)
                && !has(BINARY_UNICODE_PROPERTIES, property_name_or_value)
            {
                self.error(1529, property_name_or_value_start);
            }
            self.scan_expected_char(b'}');
            if !self.any_unicode_mode {
                self.error(1530, start);
            }
        } else if self.any_unicode_mode {
            self.error(1531, self.pos - 2);
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
            self.error(1005, self.pos);
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

/// `IsIdentifierStart`
pub(crate) fn is_identifier_start(ch: u32) -> bool {
    match u8::try_from(ch) {
        Ok(ch) if ch.is_ascii() => ch.is_ascii_alphabetic() || ch == b'_' || ch == b'$',
        _ => is_in_ranges(ch, ID_START),
    }
}

/// `IsIdentifierPart`
pub(crate) fn is_identifier_part(ch: u32) -> bool {
    match u8::try_from(ch) {
        Ok(ch) if ch.is_ascii() => ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'$',
        _ => is_in_ranges(ch, ID_START) || is_in_ranges(ch, ID_CONTINUE_ONLY),
    }
}

fn is_in_ranges(ch: u32, ranges: &[(u32, u32)]) -> bool {
    let after = ranges.partition_point(|&(first, _)| first <= ch);
    after > 0 && ch <= ranges[after - 1].1
}

fn has(names: &[&str], name: &[u8]) -> bool {
    names.iter().any(|n| n.as_bytes() == name)
}

/// `nonBinaryUnicodeProperties`, `valuesOfNonBinaryUnicodeProperties`: what the property of that name or alias can be.
fn values_of_non_binary_unicode_property(name: &[u8]) -> Option<&'static [&'static str]> {
    match name {
        b"General_Category" | b"gc" => Some(GENERAL_CATEGORY_VALUES),
        // An expression only takes one value, so those of `Script_Extensions` are those of `Script`.
        b"Script" | b"sc" | b"Script_Extensions" | b"scx" => Some(SCRIPT_VALUES),
        _ => None,
    }
}

/// `binaryUnicodeProperties`: https://tc39.es/ecma262/#table-binary-unicode-properties
#[rustfmt::skip]
static BINARY_UNICODE_PROPERTIES: &[&str] = &[
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
];

/// `binaryUnicodePropertiesOfStrings`: https://tc39.es/ecma262/#table-binary-unicode-properties-of-strings
#[rustfmt::skip]
static BINARY_UNICODE_PROPERTIES_OF_STRINGS: &[&str] = &[
    "Basic_Emoji", "Emoji_Keycap_Sequence", "RGI_Emoji_Modifier_Sequence", "RGI_Emoji_Flag_Sequence", "RGI_Emoji_Tag_Sequence",
    "RGI_Emoji_ZWJ_Sequence", "RGI_Emoji",
];

/// `valuesOfNonBinaryUnicodeProperties["General_Category"]`
#[rustfmt::skip]
static GENERAL_CATEGORY_VALUES: &[&str] = &[
    "C", "Other", "Cc", "Control", "cntrl", "Cf", "Format", "Cn", "Unassigned", "Co", "Private_Use", "Cs", "Surrogate", "L",
    "Letter", "LC", "Cased_Letter", "Ll", "Lowercase_Letter", "Lm", "Modifier_Letter", "Lo", "Other_Letter", "Lt",
    "Titlecase_Letter", "Lu", "Uppercase_Letter", "M", "Mark", "Combining_Mark", "Mc", "Spacing_Mark", "Me", "Enclosing_Mark",
    "Mn", "Nonspacing_Mark", "N", "Number", "Nd", "Decimal_Number", "digit", "Nl", "Letter_Number", "No", "Other_Number", "P",
    "Punctuation", "punct", "Pc", "Connector_Punctuation", "Pd", "Dash_Punctuation", "Pe", "Close_Punctuation", "Pf",
    "Final_Punctuation", "Pi", "Initial_Punctuation", "Po", "Other_Punctuation", "Ps", "Open_Punctuation", "S", "Symbol", "Sc",
    "Currency_Symbol", "Sk", "Modifier_Symbol", "Sm", "Math_Symbol", "So", "Other_Symbol", "Z", "Separator", "Zl",
    "Line_Separator", "Zp", "Paragraph_Separator", "Zs", "Space_Separator",
];

/// `scriptValues`: Unicode 15.1
#[rustfmt::skip]
static SCRIPT_VALUES: &[&str] = &[
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
];

/// `IsUnicodeIdentifierStart`: what TypeScript 7.0.2 lets a name start with past ASCII, first and last of each run, in order.
#[rustfmt::skip]
static ID_START: &[(u32, u32)] = &[
    (0xAA, 0xAA), (0xB5, 0xB5), (0xBA, 0xBA), (0xC0, 0xD6), (0xD8, 0xF6), (0xF8, 0x2C1), (0x2C6, 0x2D1), (0x2E0, 0x2E4),
    (0x2EC, 0x2EC), (0x2EE, 0x2EE), (0x370, 0x374), (0x376, 0x377), (0x37A, 0x37D), (0x37F, 0x37F), (0x386, 0x386),
    (0x388, 0x38A), (0x38C, 0x38C), (0x38E, 0x3A1), (0x3A3, 0x3F5), (0x3F7, 0x481), (0x48A, 0x52F), (0x531, 0x556),
    (0x559, 0x559), (0x560, 0x588), (0x5D0, 0x5EA), (0x5EF, 0x5F2), (0x620, 0x64A), (0x66E, 0x66F), (0x671, 0x6D3),
    (0x6D5, 0x6D5), (0x6E5, 0x6E6), (0x6EE, 0x6EF), (0x6FA, 0x6FC), (0x6FF, 0x6FF), (0x710, 0x710), (0x712, 0x72F),
    (0x74D, 0x7A5), (0x7B1, 0x7B1), (0x7CA, 0x7EA), (0x7F4, 0x7F5), (0x7FA, 0x7FA), (0x800, 0x815), (0x81A, 0x81A),
    (0x824, 0x824), (0x828, 0x828), (0x840, 0x858), (0x860, 0x86A), (0x870, 0x887), (0x889, 0x88E), (0x8A0, 0x8C9),
    (0x904, 0x939), (0x93D, 0x93D), (0x950, 0x950), (0x958, 0x961), (0x971, 0x980), (0x985, 0x98C), (0x98F, 0x990),
    (0x993, 0x9A8), (0x9AA, 0x9B0), (0x9B2, 0x9B2), (0x9B6, 0x9B9), (0x9BD, 0x9BD), (0x9CE, 0x9CE), (0x9DC, 0x9DD),
    (0x9DF, 0x9E1), (0x9F0, 0x9F1), (0x9FC, 0x9FC), (0xA05, 0xA0A), (0xA0F, 0xA10), (0xA13, 0xA28), (0xA2A, 0xA30),
    (0xA32, 0xA33), (0xA35, 0xA36), (0xA38, 0xA39), (0xA59, 0xA5C), (0xA5E, 0xA5E), (0xA72, 0xA74), (0xA85, 0xA8D),
    (0xA8F, 0xA91), (0xA93, 0xAA8), (0xAAA, 0xAB0), (0xAB2, 0xAB3), (0xAB5, 0xAB9), (0xABD, 0xABD), (0xAD0, 0xAD0),
    (0xAE0, 0xAE1), (0xAF9, 0xAF9), (0xB05, 0xB0C), (0xB0F, 0xB10), (0xB13, 0xB28), (0xB2A, 0xB30), (0xB32, 0xB33),
    (0xB35, 0xB39), (0xB3D, 0xB3D), (0xB5C, 0xB5D), (0xB5F, 0xB61), (0xB71, 0xB71), (0xB83, 0xB83), (0xB85, 0xB8A),
    (0xB8E, 0xB90), (0xB92, 0xB95), (0xB99, 0xB9A), (0xB9C, 0xB9C), (0xB9E, 0xB9F), (0xBA3, 0xBA4), (0xBA8, 0xBAA),
    (0xBAE, 0xBB9), (0xBD0, 0xBD0), (0xC05, 0xC0C), (0xC0E, 0xC10), (0xC12, 0xC28), (0xC2A, 0xC39), (0xC3D, 0xC3D),
    (0xC58, 0xC5A), (0xC5D, 0xC5D), (0xC60, 0xC61), (0xC80, 0xC80), (0xC85, 0xC8C), (0xC8E, 0xC90), (0xC92, 0xCA8),
    (0xCAA, 0xCB3), (0xCB5, 0xCB9), (0xCBD, 0xCBD), (0xCDD, 0xCDE), (0xCE0, 0xCE1), (0xCF1, 0xCF2), (0xD04, 0xD0C),
    (0xD0E, 0xD10), (0xD12, 0xD3A), (0xD3D, 0xD3D), (0xD4E, 0xD4E), (0xD54, 0xD56), (0xD5F, 0xD61), (0xD7A, 0xD7F),
    (0xD85, 0xD96), (0xD9A, 0xDB1), (0xDB3, 0xDBB), (0xDBD, 0xDBD), (0xDC0, 0xDC6), (0xE01, 0xE30), (0xE32, 0xE33),
    (0xE40, 0xE46), (0xE81, 0xE82), (0xE84, 0xE84), (0xE86, 0xE8A), (0xE8C, 0xEA3), (0xEA5, 0xEA5), (0xEA7, 0xEB0),
    (0xEB2, 0xEB3), (0xEBD, 0xEBD), (0xEC0, 0xEC4), (0xEC6, 0xEC6), (0xEDC, 0xEDF), (0xF00, 0xF00), (0xF40, 0xF47),
    (0xF49, 0xF6C), (0xF88, 0xF8C), (0x1000, 0x102A), (0x103F, 0x103F), (0x1050, 0x1055), (0x105A, 0x105D), (0x1061, 0x1061),
    (0x1065, 0x1066), (0x106E, 0x1070), (0x1075, 0x1081), (0x108E, 0x108E), (0x10A0, 0x10C5), (0x10C7, 0x10C7),
    (0x10CD, 0x10CD), (0x10D0, 0x10FA), (0x10FC, 0x1248), (0x124A, 0x124D), (0x1250, 0x1256), (0x1258, 0x1258),
    (0x125A, 0x125D), (0x1260, 0x1288), (0x128A, 0x128D), (0x1290, 0x12B0), (0x12B2, 0x12B5), (0x12B8, 0x12BE),
    (0x12C0, 0x12C0), (0x12C2, 0x12C5), (0x12C8, 0x12D6), (0x12D8, 0x1310), (0x1312, 0x1315), (0x1318, 0x135A),
    (0x1380, 0x138F), (0x13A0, 0x13F5), (0x13F8, 0x13FD), (0x1401, 0x166C), (0x166F, 0x167F), (0x1681, 0x169A),
    (0x16A0, 0x16EA), (0x16EE, 0x16F8), (0x1700, 0x1711), (0x171F, 0x1731), (0x1740, 0x1751), (0x1760, 0x176C),
    (0x176E, 0x1770), (0x1780, 0x17B3), (0x17D7, 0x17D7), (0x17DC, 0x17DC), (0x1820, 0x1878), (0x1880, 0x18A8),
    (0x18AA, 0x18AA), (0x18B0, 0x18F5), (0x1900, 0x191E), (0x1950, 0x196D), (0x1970, 0x1974), (0x1980, 0x19AB),
    (0x19B0, 0x19C9), (0x1A00, 0x1A16), (0x1A20, 0x1A54), (0x1AA7, 0x1AA7), (0x1B05, 0x1B33), (0x1B45, 0x1B4C),
    (0x1B83, 0x1BA0), (0x1BAE, 0x1BAF), (0x1BBA, 0x1BE5), (0x1C00, 0x1C23), (0x1C4D, 0x1C4F), (0x1C5A, 0x1C7D),
    (0x1C80, 0x1C88), (0x1C90, 0x1CBA), (0x1CBD, 0x1CBF), (0x1CE9, 0x1CEC), (0x1CEE, 0x1CF3), (0x1CF5, 0x1CF6),
    (0x1CFA, 0x1CFA), (0x1D00, 0x1DBF), (0x1E00, 0x1F15), (0x1F18, 0x1F1D), (0x1F20, 0x1F45), (0x1F48, 0x1F4D),
    (0x1F50, 0x1F57), (0x1F59, 0x1F59), (0x1F5B, 0x1F5B), (0x1F5D, 0x1F5D), (0x1F5F, 0x1F7D), (0x1F80, 0x1FB4),
    (0x1FB6, 0x1FBC), (0x1FBE, 0x1FBE), (0x1FC2, 0x1FC4), (0x1FC6, 0x1FCC), (0x1FD0, 0x1FD3), (0x1FD6, 0x1FDB),
    (0x1FE0, 0x1FEC), (0x1FF2, 0x1FF4), (0x1FF6, 0x1FFC), (0x2071, 0x2071), (0x207F, 0x207F), (0x2090, 0x209C),
    (0x2102, 0x2102), (0x2107, 0x2107), (0x210A, 0x2113), (0x2115, 0x2115), (0x2118, 0x211D), (0x2124, 0x2124),
    (0x2126, 0x2126), (0x2128, 0x2128), (0x212A, 0x2139), (0x213C, 0x213F), (0x2145, 0x2149), (0x214E, 0x214E),
    (0x2160, 0x2188), (0x2C00, 0x2CE4), (0x2CEB, 0x2CEE), (0x2CF2, 0x2CF3), (0x2D00, 0x2D25), (0x2D27, 0x2D27),
    (0x2D2D, 0x2D2D), (0x2D30, 0x2D67), (0x2D6F, 0x2D6F), (0x2D80, 0x2D96), (0x2DA0, 0x2DA6), (0x2DA8, 0x2DAE),
    (0x2DB0, 0x2DB6), (0x2DB8, 0x2DBE), (0x2DC0, 0x2DC6), (0x2DC8, 0x2DCE), (0x2DD0, 0x2DD6), (0x2DD8, 0x2DDE),
    (0x3005, 0x3007), (0x3021, 0x3029), (0x3031, 0x3035), (0x3038, 0x303C), (0x3041, 0x3096), (0x309B, 0x309F),
    (0x30A1, 0x30FA), (0x30FC, 0x30FF), (0x3105, 0x312F), (0x3131, 0x318E), (0x31A0, 0x31BF), (0x31F0, 0x31FF),
    (0x3400, 0x4DBF), (0x4E00, 0xA48C), (0xA4D0, 0xA4FD), (0xA500, 0xA60C), (0xA610, 0xA61F), (0xA62A, 0xA62B),
    (0xA640, 0xA66E), (0xA67F, 0xA69D), (0xA6A0, 0xA6EF), (0xA717, 0xA71F), (0xA722, 0xA788), (0xA78B, 0xA7CA),
    (0xA7D0, 0xA7D1), (0xA7D3, 0xA7D3), (0xA7D5, 0xA7D9), (0xA7F2, 0xA801), (0xA803, 0xA805), (0xA807, 0xA80A),
    (0xA80C, 0xA822), (0xA840, 0xA873), (0xA882, 0xA8B3), (0xA8F2, 0xA8F7), (0xA8FB, 0xA8FB), (0xA8FD, 0xA8FE),
    (0xA90A, 0xA925), (0xA930, 0xA946), (0xA960, 0xA97C), (0xA984, 0xA9B2), (0xA9CF, 0xA9CF), (0xA9E0, 0xA9E4),
    (0xA9E6, 0xA9EF), (0xA9FA, 0xA9FE), (0xAA00, 0xAA28), (0xAA40, 0xAA42), (0xAA44, 0xAA4B), (0xAA60, 0xAA76),
    (0xAA7A, 0xAA7A), (0xAA7E, 0xAAAF), (0xAAB1, 0xAAB1), (0xAAB5, 0xAAB6), (0xAAB9, 0xAABD), (0xAAC0, 0xAAC0),
    (0xAAC2, 0xAAC2), (0xAADB, 0xAADD), (0xAAE0, 0xAAEA), (0xAAF2, 0xAAF4), (0xAB01, 0xAB06), (0xAB09, 0xAB0E),
    (0xAB11, 0xAB16), (0xAB20, 0xAB26), (0xAB28, 0xAB2E), (0xAB30, 0xAB5A), (0xAB5C, 0xAB69), (0xAB70, 0xABE2),
    (0xAC00, 0xD7A3), (0xD7B0, 0xD7C6), (0xD7CB, 0xD7FB), (0xF900, 0xFA6D), (0xFA70, 0xFAD9), (0xFB00, 0xFB06),
    (0xFB13, 0xFB17), (0xFB1D, 0xFB1D), (0xFB1F, 0xFB28), (0xFB2A, 0xFB36), (0xFB38, 0xFB3C), (0xFB3E, 0xFB3E),
    (0xFB40, 0xFB41), (0xFB43, 0xFB44), (0xFB46, 0xFBB1), (0xFBD3, 0xFD3D), (0xFD50, 0xFD8F), (0xFD92, 0xFDC7),
    (0xFDF0, 0xFDFB), (0xFE70, 0xFE74), (0xFE76, 0xFEFC), (0xFF21, 0xFF3A), (0xFF41, 0xFF5A), (0xFF66, 0xFFBE),
    (0xFFC2, 0xFFC7), (0xFFCA, 0xFFCF), (0xFFD2, 0xFFD7), (0xFFDA, 0xFFDC), (0x10000, 0x1000B), (0x1000D, 0x10026),
    (0x10028, 0x1003A), (0x1003C, 0x1003D), (0x1003F, 0x1004D), (0x10050, 0x1005D), (0x10080, 0x100FA), (0x10140, 0x10174),
    (0x10280, 0x1029C), (0x102A0, 0x102D0), (0x10300, 0x1031F), (0x1032D, 0x1034A), (0x10350, 0x10375), (0x10380, 0x1039D),
    (0x103A0, 0x103C3), (0x103C8, 0x103CF), (0x103D1, 0x103D5), (0x10400, 0x1049D), (0x104B0, 0x104D3), (0x104D8, 0x104FB),
    (0x10500, 0x10527), (0x10530, 0x10563), (0x10570, 0x1057A), (0x1057C, 0x1058A), (0x1058C, 0x10592), (0x10594, 0x10595),
    (0x10597, 0x105A1), (0x105A3, 0x105B1), (0x105B3, 0x105B9), (0x105BB, 0x105BC), (0x10600, 0x10736), (0x10740, 0x10755),
    (0x10760, 0x10767), (0x10780, 0x10785), (0x10787, 0x107B0), (0x107B2, 0x107BA), (0x10800, 0x10805), (0x10808, 0x10808),
    (0x1080A, 0x10835), (0x10837, 0x10838), (0x1083C, 0x1083C), (0x1083F, 0x10855), (0x10860, 0x10876), (0x10880, 0x1089E),
    (0x108E0, 0x108F2), (0x108F4, 0x108F5), (0x10900, 0x10915), (0x10920, 0x10939), (0x10980, 0x109B7), (0x109BE, 0x109BF),
    (0x10A00, 0x10A00), (0x10A10, 0x10A13), (0x10A15, 0x10A17), (0x10A19, 0x10A35), (0x10A60, 0x10A7C), (0x10A80, 0x10A9C),
    (0x10AC0, 0x10AC7), (0x10AC9, 0x10AE4), (0x10B00, 0x10B35), (0x10B40, 0x10B55), (0x10B60, 0x10B72), (0x10B80, 0x10B91),
    (0x10C00, 0x10C48), (0x10C80, 0x10CB2), (0x10CC0, 0x10CF2), (0x10D00, 0x10D23), (0x10E80, 0x10EA9), (0x10EB0, 0x10EB1),
    (0x10F00, 0x10F1C), (0x10F27, 0x10F27), (0x10F30, 0x10F45), (0x10F70, 0x10F81), (0x10FB0, 0x10FC4), (0x10FE0, 0x10FF6),
    (0x11003, 0x11037), (0x11071, 0x11072), (0x11075, 0x11075), (0x11083, 0x110AF), (0x110D0, 0x110E8), (0x11103, 0x11126),
    (0x11144, 0x11144), (0x11147, 0x11147), (0x11150, 0x11172), (0x11176, 0x11176), (0x11183, 0x111B2), (0x111C1, 0x111C4),
    (0x111DA, 0x111DA), (0x111DC, 0x111DC), (0x11200, 0x11211), (0x11213, 0x1122B), (0x1123F, 0x11240), (0x11280, 0x11286),
    (0x11288, 0x11288), (0x1128A, 0x1128D), (0x1128F, 0x1129D), (0x1129F, 0x112A8), (0x112B0, 0x112DE), (0x11305, 0x1130C),
    (0x1130F, 0x11310), (0x11313, 0x11328), (0x1132A, 0x11330), (0x11332, 0x11333), (0x11335, 0x11339), (0x1133D, 0x1133D),
    (0x11350, 0x11350), (0x1135D, 0x11361), (0x11400, 0x11434), (0x11447, 0x1144A), (0x1145F, 0x11461), (0x11480, 0x114AF),
    (0x114C4, 0x114C5), (0x114C7, 0x114C7), (0x11580, 0x115AE), (0x115D8, 0x115DB), (0x11600, 0x1162F), (0x11644, 0x11644),
    (0x11680, 0x116AA), (0x116B8, 0x116B8), (0x11700, 0x1171A), (0x11740, 0x11746), (0x11800, 0x1182B), (0x118A0, 0x118DF),
    (0x118FF, 0x11906), (0x11909, 0x11909), (0x1190C, 0x11913), (0x11915, 0x11916), (0x11918, 0x1192F), (0x1193F, 0x1193F),
    (0x11941, 0x11941), (0x119A0, 0x119A7), (0x119AA, 0x119D0), (0x119E1, 0x119E1), (0x119E3, 0x119E3), (0x11A00, 0x11A00),
    (0x11A0B, 0x11A32), (0x11A3A, 0x11A3A), (0x11A50, 0x11A50), (0x11A5C, 0x11A89), (0x11A9D, 0x11A9D), (0x11AB0, 0x11AF8),
    (0x11C00, 0x11C08), (0x11C0A, 0x11C2E), (0x11C40, 0x11C40), (0x11C72, 0x11C8F), (0x11D00, 0x11D06), (0x11D08, 0x11D09),
    (0x11D0B, 0x11D30), (0x11D46, 0x11D46), (0x11D60, 0x11D65), (0x11D67, 0x11D68), (0x11D6A, 0x11D89), (0x11D98, 0x11D98),
    (0x11EE0, 0x11EF2), (0x11F02, 0x11F02), (0x11F04, 0x11F10), (0x11F12, 0x11F33), (0x11FB0, 0x11FB0), (0x12000, 0x12399),
    (0x12400, 0x1246E), (0x12480, 0x12543), (0x12F90, 0x12FF0), (0x13000, 0x1342F), (0x13441, 0x13446), (0x14400, 0x14646),
    (0x16800, 0x16A38), (0x16A40, 0x16A5E), (0x16A70, 0x16ABE), (0x16AD0, 0x16AED), (0x16B00, 0x16B2F), (0x16B40, 0x16B43),
    (0x16B63, 0x16B77), (0x16B7D, 0x16B8F), (0x16E40, 0x16E7F), (0x16F00, 0x16F4A), (0x16F50, 0x16F50), (0x16F93, 0x16F9F),
    (0x16FE0, 0x16FE1), (0x16FE3, 0x16FE3), (0x17000, 0x187F7), (0x18800, 0x18CD5), (0x18D00, 0x18D08), (0x1AFF0, 0x1AFF3),
    (0x1AFF5, 0x1AFFB), (0x1AFFD, 0x1AFFE), (0x1B000, 0x1B122), (0x1B132, 0x1B132), (0x1B150, 0x1B152), (0x1B155, 0x1B155),
    (0x1B164, 0x1B167), (0x1B170, 0x1B2FB), (0x1BC00, 0x1BC6A), (0x1BC70, 0x1BC7C), (0x1BC80, 0x1BC88), (0x1BC90, 0x1BC99),
    (0x1D400, 0x1D454), (0x1D456, 0x1D49C), (0x1D49E, 0x1D49F), (0x1D4A2, 0x1D4A2), (0x1D4A5, 0x1D4A6), (0x1D4A9, 0x1D4AC),
    (0x1D4AE, 0x1D4B9), (0x1D4BB, 0x1D4BB), (0x1D4BD, 0x1D4C3), (0x1D4C5, 0x1D505), (0x1D507, 0x1D50A), (0x1D50D, 0x1D514),
    (0x1D516, 0x1D51C), (0x1D51E, 0x1D539), (0x1D53B, 0x1D53E), (0x1D540, 0x1D544), (0x1D546, 0x1D546), (0x1D54A, 0x1D550),
    (0x1D552, 0x1D6A5), (0x1D6A8, 0x1D6C0), (0x1D6C2, 0x1D6DA), (0x1D6DC, 0x1D6FA), (0x1D6FC, 0x1D714), (0x1D716, 0x1D734),
    (0x1D736, 0x1D74E), (0x1D750, 0x1D76E), (0x1D770, 0x1D788), (0x1D78A, 0x1D7A8), (0x1D7AA, 0x1D7C2), (0x1D7C4, 0x1D7CB),
    (0x1DF00, 0x1DF1E), (0x1DF25, 0x1DF2A), (0x1E030, 0x1E06D), (0x1E100, 0x1E12C), (0x1E137, 0x1E13D), (0x1E14E, 0x1E14E),
    (0x1E290, 0x1E2AD), (0x1E2C0, 0x1E2EB), (0x1E4D0, 0x1E4EB), (0x1E7E0, 0x1E7E6), (0x1E7E8, 0x1E7EB), (0x1E7ED, 0x1E7EE),
    (0x1E7F0, 0x1E7FE), (0x1E800, 0x1E8C4), (0x1E900, 0x1E943), (0x1E94B, 0x1E94B), (0x1EE00, 0x1EE03), (0x1EE05, 0x1EE1F),
    (0x1EE21, 0x1EE22), (0x1EE24, 0x1EE24), (0x1EE27, 0x1EE27), (0x1EE29, 0x1EE32), (0x1EE34, 0x1EE37), (0x1EE39, 0x1EE39),
    (0x1EE3B, 0x1EE3B), (0x1EE42, 0x1EE42), (0x1EE47, 0x1EE47), (0x1EE49, 0x1EE49), (0x1EE4B, 0x1EE4B), (0x1EE4D, 0x1EE4F),
    (0x1EE51, 0x1EE52), (0x1EE54, 0x1EE54), (0x1EE57, 0x1EE57), (0x1EE59, 0x1EE59), (0x1EE5B, 0x1EE5B), (0x1EE5D, 0x1EE5D),
    (0x1EE5F, 0x1EE5F), (0x1EE61, 0x1EE62), (0x1EE64, 0x1EE64), (0x1EE67, 0x1EE6A), (0x1EE6C, 0x1EE72), (0x1EE74, 0x1EE77),
    (0x1EE79, 0x1EE7C), (0x1EE7E, 0x1EE7E), (0x1EE80, 0x1EE89), (0x1EE8B, 0x1EE9B), (0x1EEA1, 0x1EEA3), (0x1EEA5, 0x1EEA9),
    (0x1EEAB, 0x1EEBB), (0x20000, 0x2A6DF), (0x2A700, 0x2B739), (0x2B740, 0x2B81D), (0x2B820, 0x2CEA1), (0x2CEB0, 0x2EBE0),
    (0x2EBF0, 0x2EE5D), (0x2F800, 0x2FA1D), (0x30000, 0x3134A), (0x31350, 0x323AF),
];

/// `IsUnicodeIdentifierPart`: what it lets a name go on with but not start with.
#[rustfmt::skip]
static ID_CONTINUE_ONLY: &[(u32, u32)] = &[
    (0xB7, 0xB7), (0x300, 0x36F), (0x387, 0x387), (0x483, 0x487), (0x591, 0x5BD), (0x5BF, 0x5BF), (0x5C1, 0x5C2),
    (0x5C4, 0x5C5), (0x5C7, 0x5C7), (0x610, 0x61A), (0x64B, 0x669), (0x670, 0x670), (0x6D6, 0x6DC), (0x6DF, 0x6E4),
    (0x6E7, 0x6E8), (0x6EA, 0x6ED), (0x6F0, 0x6F9), (0x711, 0x711), (0x730, 0x74A), (0x7A6, 0x7B0), (0x7C0, 0x7C9),
    (0x7EB, 0x7F3), (0x7FD, 0x7FD), (0x816, 0x819), (0x81B, 0x823), (0x825, 0x827), (0x829, 0x82D), (0x859, 0x85B),
    (0x898, 0x89F), (0x8CA, 0x8E1), (0x8E3, 0x903), (0x93A, 0x93C), (0x93E, 0x94F), (0x951, 0x957), (0x962, 0x963),
    (0x966, 0x96F), (0x981, 0x983), (0x9BC, 0x9BC), (0x9BE, 0x9C4), (0x9C7, 0x9C8), (0x9CB, 0x9CD), (0x9D7, 0x9D7),
    (0x9E2, 0x9E3), (0x9E6, 0x9EF), (0x9FE, 0x9FE), (0xA01, 0xA03), (0xA3C, 0xA3C), (0xA3E, 0xA42), (0xA47, 0xA48),
    (0xA4B, 0xA4D), (0xA51, 0xA51), (0xA66, 0xA71), (0xA75, 0xA75), (0xA81, 0xA83), (0xABC, 0xABC), (0xABE, 0xAC5),
    (0xAC7, 0xAC9), (0xACB, 0xACD), (0xAE2, 0xAE3), (0xAE6, 0xAEF), (0xAFA, 0xAFF), (0xB01, 0xB03), (0xB3C, 0xB3C),
    (0xB3E, 0xB44), (0xB47, 0xB48), (0xB4B, 0xB4D), (0xB55, 0xB57), (0xB62, 0xB63), (0xB66, 0xB6F), (0xB82, 0xB82),
    (0xBBE, 0xBC2), (0xBC6, 0xBC8), (0xBCA, 0xBCD), (0xBD7, 0xBD7), (0xBE6, 0xBEF), (0xC00, 0xC04), (0xC3C, 0xC3C),
    (0xC3E, 0xC44), (0xC46, 0xC48), (0xC4A, 0xC4D), (0xC55, 0xC56), (0xC62, 0xC63), (0xC66, 0xC6F), (0xC81, 0xC83),
    (0xCBC, 0xCBC), (0xCBE, 0xCC4), (0xCC6, 0xCC8), (0xCCA, 0xCCD), (0xCD5, 0xCD6), (0xCE2, 0xCE3), (0xCE6, 0xCEF),
    (0xCF3, 0xCF3), (0xD00, 0xD03), (0xD3B, 0xD3C), (0xD3E, 0xD44), (0xD46, 0xD48), (0xD4A, 0xD4D), (0xD57, 0xD57),
    (0xD62, 0xD63), (0xD66, 0xD6F), (0xD81, 0xD83), (0xDCA, 0xDCA), (0xDCF, 0xDD4), (0xDD6, 0xDD6), (0xDD8, 0xDDF),
    (0xDE6, 0xDEF), (0xDF2, 0xDF3), (0xE31, 0xE31), (0xE34, 0xE3A), (0xE47, 0xE4E), (0xE50, 0xE59), (0xEB1, 0xEB1),
    (0xEB4, 0xEBC), (0xEC8, 0xECE), (0xED0, 0xED9), (0xF18, 0xF19), (0xF20, 0xF29), (0xF35, 0xF35), (0xF37, 0xF37),
    (0xF39, 0xF39), (0xF3E, 0xF3F), (0xF71, 0xF84), (0xF86, 0xF87), (0xF8D, 0xF97), (0xF99, 0xFBC), (0xFC6, 0xFC6),
    (0x102B, 0x103E), (0x1040, 0x1049), (0x1056, 0x1059), (0x105E, 0x1060), (0x1062, 0x1064), (0x1067, 0x106D),
    (0x1071, 0x1074), (0x1082, 0x108D), (0x108F, 0x109D), (0x135D, 0x135F), (0x1369, 0x1371), (0x1712, 0x1715),
    (0x1732, 0x1734), (0x1752, 0x1753), (0x1772, 0x1773), (0x17B4, 0x17D3), (0x17DD, 0x17DD), (0x17E0, 0x17E9),
    (0x180B, 0x180D), (0x180F, 0x1819), (0x18A9, 0x18A9), (0x1920, 0x192B), (0x1930, 0x193B), (0x1946, 0x194F),
    (0x19D0, 0x19DA), (0x1A17, 0x1A1B), (0x1A55, 0x1A5E), (0x1A60, 0x1A7C), (0x1A7F, 0x1A89), (0x1A90, 0x1A99),
    (0x1AB0, 0x1ABD), (0x1ABF, 0x1ACE), (0x1B00, 0x1B04), (0x1B34, 0x1B44), (0x1B50, 0x1B59), (0x1B6B, 0x1B73),
    (0x1B80, 0x1B82), (0x1BA1, 0x1BAD), (0x1BB0, 0x1BB9), (0x1BE6, 0x1BF3), (0x1C24, 0x1C37), (0x1C40, 0x1C49),
    (0x1C50, 0x1C59), (0x1CD0, 0x1CD2), (0x1CD4, 0x1CE8), (0x1CED, 0x1CED), (0x1CF4, 0x1CF4), (0x1CF7, 0x1CF9),
    (0x1DC0, 0x1DFF), (0x200C, 0x200D), (0x203F, 0x2040), (0x2054, 0x2054), (0x20D0, 0x20DC), (0x20E1, 0x20E1),
    (0x20E5, 0x20F0), (0x2CEF, 0x2CF1), (0x2D7F, 0x2D7F), (0x2DE0, 0x2DFF), (0x302A, 0x302F), (0x3099, 0x309A),
    (0x30FB, 0x30FB), (0xA620, 0xA629), (0xA66F, 0xA66F), (0xA674, 0xA67D), (0xA69E, 0xA69F), (0xA6F0, 0xA6F1),
    (0xA802, 0xA802), (0xA806, 0xA806), (0xA80B, 0xA80B), (0xA823, 0xA827), (0xA82C, 0xA82C), (0xA880, 0xA881),
    (0xA8B4, 0xA8C5), (0xA8D0, 0xA8D9), (0xA8E0, 0xA8F1), (0xA8FF, 0xA909), (0xA926, 0xA92D), (0xA947, 0xA953),
    (0xA980, 0xA983), (0xA9B3, 0xA9C0), (0xA9D0, 0xA9D9), (0xA9E5, 0xA9E5), (0xA9F0, 0xA9F9), (0xAA29, 0xAA36),
    (0xAA43, 0xAA43), (0xAA4C, 0xAA4D), (0xAA50, 0xAA59), (0xAA7B, 0xAA7D), (0xAAB0, 0xAAB0), (0xAAB2, 0xAAB4),
    (0xAAB7, 0xAAB8), (0xAABE, 0xAABF), (0xAAC1, 0xAAC1), (0xAAEB, 0xAAEF), (0xAAF5, 0xAAF6), (0xABE3, 0xABEA),
    (0xABEC, 0xABED), (0xABF0, 0xABF9), (0xFB1E, 0xFB1E), (0xFE00, 0xFE0F), (0xFE20, 0xFE2F), (0xFE33, 0xFE34),
    (0xFE4D, 0xFE4F), (0xFF10, 0xFF19), (0xFF3F, 0xFF3F), (0xFF65, 0xFF65), (0x101FD, 0x101FD), (0x102E0, 0x102E0),
    (0x10376, 0x1037A), (0x104A0, 0x104A9), (0x10A01, 0x10A03), (0x10A05, 0x10A06), (0x10A0C, 0x10A0F), (0x10A38, 0x10A3A),
    (0x10A3F, 0x10A3F), (0x10AE5, 0x10AE6), (0x10D24, 0x10D27), (0x10D30, 0x10D39), (0x10EAB, 0x10EAC), (0x10EFD, 0x10EFF),
    (0x10F46, 0x10F50), (0x10F82, 0x10F85), (0x11000, 0x11002), (0x11038, 0x11046), (0x11066, 0x11070), (0x11073, 0x11074),
    (0x1107F, 0x11082), (0x110B0, 0x110BA), (0x110C2, 0x110C2), (0x110F0, 0x110F9), (0x11100, 0x11102), (0x11127, 0x11134),
    (0x11136, 0x1113F), (0x11145, 0x11146), (0x11173, 0x11173), (0x11180, 0x11182), (0x111B3, 0x111C0), (0x111C9, 0x111CC),
    (0x111CE, 0x111D9), (0x1122C, 0x11237), (0x1123E, 0x1123E), (0x11241, 0x11241), (0x112DF, 0x112EA), (0x112F0, 0x112F9),
    (0x11300, 0x11303), (0x1133B, 0x1133C), (0x1133E, 0x11344), (0x11347, 0x11348), (0x1134B, 0x1134D), (0x11357, 0x11357),
    (0x11362, 0x11363), (0x11366, 0x1136C), (0x11370, 0x11374), (0x11435, 0x11446), (0x11450, 0x11459), (0x1145E, 0x1145E),
    (0x114B0, 0x114C3), (0x114D0, 0x114D9), (0x115AF, 0x115B5), (0x115B8, 0x115C0), (0x115DC, 0x115DD), (0x11630, 0x11640),
    (0x11650, 0x11659), (0x116AB, 0x116B7), (0x116C0, 0x116C9), (0x1171D, 0x1172B), (0x11730, 0x11739), (0x1182C, 0x1183A),
    (0x118E0, 0x118E9), (0x11930, 0x11935), (0x11937, 0x11938), (0x1193B, 0x1193E), (0x11940, 0x11940), (0x11942, 0x11943),
    (0x11950, 0x11959), (0x119D1, 0x119D7), (0x119DA, 0x119E0), (0x119E4, 0x119E4), (0x11A01, 0x11A0A), (0x11A33, 0x11A39),
    (0x11A3B, 0x11A3E), (0x11A47, 0x11A47), (0x11A51, 0x11A5B), (0x11A8A, 0x11A99), (0x11C2F, 0x11C36), (0x11C38, 0x11C3F),
    (0x11C50, 0x11C59), (0x11C92, 0x11CA7), (0x11CA9, 0x11CB6), (0x11D31, 0x11D36), (0x11D3A, 0x11D3A), (0x11D3C, 0x11D3D),
    (0x11D3F, 0x11D45), (0x11D47, 0x11D47), (0x11D50, 0x11D59), (0x11D8A, 0x11D8E), (0x11D90, 0x11D91), (0x11D93, 0x11D97),
    (0x11DA0, 0x11DA9), (0x11EF3, 0x11EF6), (0x11F00, 0x11F01), (0x11F03, 0x11F03), (0x11F34, 0x11F3A), (0x11F3E, 0x11F42),
    (0x11F50, 0x11F59), (0x13440, 0x13440), (0x13447, 0x13455), (0x16A60, 0x16A69), (0x16AC0, 0x16AC9), (0x16AF0, 0x16AF4),
    (0x16B30, 0x16B36), (0x16B50, 0x16B59), (0x16F4F, 0x16F4F), (0x16F51, 0x16F87), (0x16F8F, 0x16F92), (0x16FE4, 0x16FE4),
    (0x16FF0, 0x16FF1), (0x1BC9D, 0x1BC9E), (0x1CF00, 0x1CF2D), (0x1CF30, 0x1CF46), (0x1D165, 0x1D169), (0x1D16D, 0x1D172),
    (0x1D17B, 0x1D182), (0x1D185, 0x1D18B), (0x1D1AA, 0x1D1AD), (0x1D242, 0x1D244), (0x1D7CE, 0x1D7FF), (0x1DA00, 0x1DA36),
    (0x1DA3B, 0x1DA6C), (0x1DA75, 0x1DA75), (0x1DA84, 0x1DA84), (0x1DA9B, 0x1DA9F), (0x1DAA1, 0x1DAAF), (0x1E000, 0x1E006),
    (0x1E008, 0x1E018), (0x1E01B, 0x1E021), (0x1E023, 0x1E024), (0x1E026, 0x1E02A), (0x1E08F, 0x1E08F), (0x1E130, 0x1E136),
    (0x1E140, 0x1E149), (0x1E2AE, 0x1E2AE), (0x1E2EC, 0x1E2F9), (0x1E4EC, 0x1E4F9), (0x1E8D0, 0x1E8D6), (0x1E944, 0x1E94A),
    (0x1E950, 0x1E959), (0x1FBF0, 0x1FBF9), (0xE0100, 0xE01EF),
];
