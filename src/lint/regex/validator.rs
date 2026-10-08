//! `RegExpValidator` of `@eslint-community/regexpp`: the grammar of regular expressions, the syntax
//! errors with regexpp's messages, and a [`Handler`] that is told what is found.

use super::ast::{EscapeSet, Flags, INFINITY, ModifierFlags, Reference};
use super::{unicode, wtf8};
use bun_core::strings;

/// How deep groups and classes may nest. regexpp has no limit of its own: it overflows the stack.
const MAX_DEPTH: u32 = 250;

/// The options of `RegExpValidator` and `RegExpParser`.
#[derive(Copy, Clone, Debug)]
pub struct Options {
    /// Disables the syntax of Annex B.
    pub strict: bool,
    /// 5, or 2015 to 2025.
    pub ecma_version: u32,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            strict: false,
            ecma_version: 2025,
        }
    }
}

impl Options {
    pub fn ecma_version(ecma_version: u32) -> Self {
        Options {
            strict: false,
            ecma_version,
        }
    }
}

/// The flags that change how a pattern is parsed.
#[derive(Copy, Clone, Default, Debug)]
pub struct Mode {
    /// The `u` flag.
    pub unicode: bool,
    /// The `v` flag.
    pub unicode_sets: bool,
}

impl Mode {
    /// `{ unicode: flags.includes("u"), unicodeSets: flags.includes("v") }`
    pub fn of_flags(flags: &[u8]) -> Self {
        Mode {
            unicode: strings::contains_char(flags, b'u'),
            unicode_sets: strings::contains_char(flags, b'v'),
        }
    }
}

/// regexpp's `RegExpSyntaxError`.
#[derive(Clone, Debug)]
pub struct SyntaxError {
    /// `Invalid regular expression: /(/: Unterminated group`
    pub message: String,
    /// Where, as a byte offset in the source.
    pub offset: u32,
    /// regexpp's `index`: the same as an index in the UTF-16 form of the source.
    pub index: u32,
    reason: u32,
}

impl SyntaxError {
    /// The message without the regular expression: `Unterminated group`.
    pub fn reason(&self) -> &str {
        self.message.get(self.reason as usize..).unwrap_or_default()
    }

    pub(super) fn unsupported(reason: &str) -> SyntaxError {
        let mut message = String::from("Invalid regular expression: ");
        let start = message.len() as u32;
        message.push_str(reason);
        SyntaxError {
            message,
            offset: 0,
            index: 0,
            reason: start,
        }
    }
}

impl std::fmt::Display for SyntaxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SyntaxError {}

/// The callbacks in the options of `RegExpValidator`, with the same names and arguments. `start`
/// and `end` are byte offsets.
///
/// A pattern with named groups is parsed twice without the `u` and `v` flags:
/// [`on_pattern_enter`](Handler::on_pattern_enter) is then called a second time. When the pattern
/// has a syntax error, what precedes the error has been reported.
#[allow(unused_variables)]
pub trait Handler {
    fn on_literal_enter(&mut self, start: u32) {}
    fn on_literal_leave(&mut self, start: u32, end: u32) {}
    fn on_regexp_flags(&mut self, start: u32, end: u32, flags: Flags) {}
    fn on_pattern_enter(&mut self, start: u32) {}
    fn on_pattern_leave(&mut self, start: u32, end: u32) {}
    fn on_disjunction_enter(&mut self, start: u32) {}
    fn on_disjunction_leave(&mut self, start: u32, end: u32) {}
    fn on_alternative_enter(&mut self, start: u32, index: u32) {}
    fn on_alternative_leave(&mut self, start: u32, end: u32, index: u32) {}
    fn on_group_enter(&mut self, start: u32) {}
    fn on_group_leave(&mut self, start: u32, end: u32) {}
    fn on_modifiers_enter(&mut self, start: u32) {}
    fn on_modifiers_leave(&mut self, start: u32, end: u32) {}
    fn on_add_modifiers(&mut self, start: u32, end: u32, flags: ModifierFlags) {}
    fn on_remove_modifiers(&mut self, start: u32, end: u32, flags: ModifierFlags) {}
    fn on_capturing_group_enter(&mut self, start: u32, name: Option<&[u8]>) {}
    fn on_capturing_group_leave(&mut self, start: u32, end: u32, name: Option<&[u8]>) {}
    /// `max` is [`INFINITY`] if there is none.
    fn on_quantifier(&mut self, start: u32, end: u32, min: u32, max: u32, greedy: bool) {}
    fn on_lookaround_assertion_enter(&mut self, start: u32, behind: bool, negate: bool) {}
    fn on_lookaround_assertion_leave(&mut self, start: u32, end: u32, behind: bool, negate: bool) {}
    /// `^`, or `$` if `at_end`.
    fn on_edge_assertion(&mut self, start: u32, end: u32, at_end: bool) {}
    fn on_word_boundary_assertion(&mut self, start: u32, end: u32, negate: bool) {}
    fn on_any_character_set(&mut self, start: u32, end: u32) {}
    fn on_escape_character_set(&mut self, start: u32, end: u32, set: EscapeSet, negate: bool) {}
    fn on_unicode_property_character_set(
        &mut self,
        start: u32,
        end: u32,
        key: &[u8],
        value: Option<&[u8]>,
        negate: bool,
        strings: bool,
    ) {
    }
    fn on_character(&mut self, start: u32, end: u32, value: u32) {}
    fn on_backreference(&mut self, start: u32, end: u32, reference: Reference<'_>) {}
    fn on_character_class_enter(&mut self, start: u32, negate: bool, unicode_sets: bool) {}
    fn on_character_class_leave(&mut self, start: u32, end: u32, negate: bool) {}
    fn on_character_class_range(&mut self, start: u32, end: u32, min: u32, max: u32) {}
    fn on_class_intersection(&mut self, start: u32, end: u32) {}
    fn on_class_subtraction(&mut self, start: u32, end: u32) {}
    fn on_class_string_disjunction_enter(&mut self, start: u32) {}
    fn on_class_string_disjunction_leave(&mut self, start: u32, end: u32) {}
    fn on_string_alternative_enter(&mut self, start: u32, index: u32) {}
    fn on_string_alternative_leave(&mut self, start: u32, end: u32, index: u32) {}
}

/// A [`Handler`] that ignores everything.
pub struct Ignore;

impl Handler for Ignore {}

/// `new RegExpValidator({ ...options, ...handler }).validateLiteral(source)`
pub fn validate_literal(
    source: &[u8],
    options: Options,
    handler: &mut dyn Handler,
) -> Result<(), SyntaxError> {
    let mut validator = Validator::new(source, SourceKind::Literal, options, handler);
    let result = validator
        .check_size()
        .and_then(|()| validator.validate_literal());
    validator.finish(result)
}

/// `new RegExpValidator({ ...options, ...handler }).validatePattern(source, 0, source.length, mode)`
pub fn validate_pattern(
    source: &[u8],
    mode: Mode,
    options: Options,
    handler: &mut dyn Handler,
) -> Result<(), SyntaxError> {
    let mut validator = Validator::new(source, SourceKind::Pattern, options, handler);
    let result = validator
        .check_size()
        .and_then(|()| validator.validate_pattern(0, source.len(), mode));
    validator.finish(result)
}

/// `new RegExpValidator({ ...options, ...handler }).validateFlags(source)`
pub fn validate_flags(
    source: &[u8],
    options: Options,
    handler: &mut dyn Handler,
) -> Result<(), SyntaxError> {
    let mut validator = Validator::new(source, SourceKind::Flags, options, handler);
    let result = validator
        .check_size()
        .and_then(|()| validator.validate_flags(0, source.len()));
    validator.finish(result)
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum SourceKind {
    Flags,
    Literal,
    Pattern,
}

/// The error is in `Validator::error`.
struct Raised;

type Consumed<T = bool> = Result<T, Raised>;

const EOF: i32 = -1;

/// A branch of a disjunction, to tell whether two groups with the same name can both take part in
/// a match.
#[derive(Copy, Clone)]
struct Branch {
    parent: u32,
    /// The first of the branches of the same disjunction.
    base: u32,
}

const NO_BRANCH: u32 = u32::MAX;

#[derive(Copy, Clone)]
struct GroupName {
    start: u32,
    len: u32,
    branch: u32,
}

/// `{ mayContainStrings }`
#[derive(Copy, Clone, Default)]
struct SetResult {
    may_contain_strings: bool,
}

struct PropertyResult {
    /// `None` is `General_Category`.
    key: Option<(usize, usize)>,
    value: Option<(usize, usize)>,
    strings: bool,
}

struct Validator<'s, 'h> {
    source: &'s [u8],
    kind: SourceKind,
    options: Options,
    handler: &'h mut dyn Handler,
    error: Option<SyntaxError>,

    // The reader.
    end: usize,
    index: usize,
    cp: i32,
    width: usize,

    unicode_mode: bool,
    unicode_sets_mode: bool,
    n_flag: bool,
    last_int_value: i32,
    last_number: f64,
    last_range: (f64, f64),
    last_str_value: Vec<u8>,
    last_assertion_is_quantifiable: bool,
    num_capturing_parens: i32,
    depth: u32,

    branches: Vec<Branch>,
    branch: u32,
    names: Vec<u8>,
    group_names: Vec<GroupName>,
    backreference_names: Vec<(u32, u32)>,
}

fn is_syntax_character(cp: i32) -> bool {
    matches!(
        u8::try_from(cp),
        Ok(b'^'
            | b'$'
            | b'\\'
            | b'.'
            | b'*'
            | b'+'
            | b'?'
            | b'('
            | b')'
            | b'['
            | b']'
            | b'{'
            | b'}'
            | b'|')
    )
}

fn is_class_set_reserved_double_punctuator_character(cp: i32) -> bool {
    matches!(
        u8::try_from(cp),
        Ok(b'&'
            | b'!'
            | b'#'
            | b'$'
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
            | b'^'
            | b'`'
            | b'~')
    )
}

fn is_class_set_syntax_character(cp: i32) -> bool {
    matches!(
        u8::try_from(cp),
        Ok(b'(' | b')' | b'[' | b']' | b'{' | b'}' | b'/' | b'-' | b'\\' | b'|')
    )
}

fn is_class_set_reserved_punctuator(cp: i32) -> bool {
    matches!(
        u8::try_from(cp),
        Ok(b'&'
            | b'-'
            | b'!'
            | b'#'
            | b'%'
            | b','
            | b':'
            | b';'
            | b'<'
            | b'='
            | b'>'
            | b'@'
            | b'`'
            | b'~')
    )
}

fn is_id_continue(cp: i32) -> bool {
    cp >= 0
        && cp != i32::from(b'$')
        && cp != 0x200C
        && cp != 0x200D
        && bun_core::lexer::is_identifier_part(cp as u32)
}

fn is_identifier_start_char(cp: i32) -> bool {
    cp >= 0 && bun_core::lexer::is_identifier_start(cp as u32)
}

fn is_identifier_part_char(cp: i32) -> bool {
    cp >= 0 && (bun_core::lexer::is_identifier_part(cp as u32) || cp == 0x200C || cp == 0x200D)
}

fn is_latin_letter(cp: i32) -> bool {
    u8::try_from(cp).is_ok_and(|b| b.is_ascii_alphabetic())
}

fn is_decimal_digit(cp: i32) -> bool {
    u8::try_from(cp).is_ok_and(|b| b.is_ascii_digit())
}

fn is_octal_digit(cp: i32) -> bool {
    (i32::from(b'0')..=i32::from(b'7')).contains(&cp)
}

fn is_hex_digit(cp: i32) -> bool {
    u8::try_from(cp).is_ok_and(|b| b.is_ascii_hexdigit())
}

fn digit_to_int(cp: i32) -> i32 {
    char::from_u32(cp as u32)
        .and_then(|c| c.to_digit(16))
        .unwrap_or(0) as i32
}

fn is_line_terminator(cp: i32) -> bool {
    matches!(cp, 0x0A | 0x0D | 0x2028 | 0x2029)
}

fn is_lead_surrogate(cp: i32) -> bool {
    (0xD800..=0xDBFF).contains(&cp)
}

fn is_trail_surrogate(cp: i32) -> bool {
    (0xDC00..=0xDFFF).contains(&cp)
}

fn combine_surrogate_pair(lead: i32, trail: i32) -> i32 {
    (lead - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000
}

fn is_unicode_property_name_character(cp: i32) -> bool {
    is_latin_letter(cp) || cp == i32::from(b'_')
}

fn is_unicode_property_value_character(cp: i32) -> bool {
    is_unicode_property_name_character(cp) || is_decimal_digit(cp)
}

fn is_regular_expression_modifier(cp: i32) -> bool {
    matches!(u8::try_from(cp), Ok(b'i' | b'm' | b's'))
}

fn count(number: f64) -> u32 {
    if number.is_infinite() {
        INFINITY
    } else {
        number.min(f64::from(INFINITY - 1)) as u32
    }
}

fn push_char(out: &mut String, cp: i32) {
    out.push(
        u32::try_from(cp)
            .ok()
            .and_then(char::from_u32)
            .unwrap_or(char::REPLACEMENT_CHARACTER),
    );
}

impl<'s, 'h> Validator<'s, 'h> {
    fn new(
        source: &'s [u8],
        kind: SourceKind,
        options: Options,
        handler: &'h mut dyn Handler,
    ) -> Self {
        Validator {
            source,
            kind,
            options,
            handler,
            error: None,
            end: 0,
            index: 0,
            cp: EOF,
            width: 1,
            unicode_mode: false,
            unicode_sets_mode: false,
            n_flag: false,
            last_int_value: 0,
            last_number: 0.0,
            last_range: (0.0, f64::INFINITY),
            last_str_value: Vec::new(),
            last_assertion_is_quantifiable: false,
            num_capturing_parens: 0,
            depth: 0,
            branches: Vec::new(),
            branch: NO_BRANCH,
            names: Vec::new(),
            group_names: Vec::new(),
            backreference_names: Vec::new(),
        }
    }

    /// Offsets are `u32`.
    fn check_size(&mut self) -> Consumed<()> {
        if self.source.len() >= u32::MAX as usize / 2 {
            self.source = &[];
            return self.raise("Regular expression too large");
        }
        Ok(())
    }

    fn finish(self, result: Consumed<()>) -> Result<(), SyntaxError> {
        match (result, self.error) {
            (Ok(()), _) => Ok(()),
            (Err(Raised), Some(error)) => Err(error),
            (Err(Raised), None) => Err(SyntaxError::unsupported("Unknown error")),
        }
    }

    fn validate_literal(&mut self) -> Consumed<()> {
        let end = self.source.len();
        self.unicode_sets_mode = false;
        self.unicode_mode = false;
        self.n_flag = false;
        self.reset(0, end);

        self.handler.on_literal_enter(0);
        if self.eat(b'/') && self.eat_regexp_body()? && self.eat(b'/') {
            let flag_start = self.index;
            let mode = Mode::of_flags(self.source.get(flag_start..).unwrap_or_default());
            self.validate_flags(flag_start, end)?;
            self.validate_pattern(1, flag_start - 1, mode)?;
        } else if end == 0 {
            return self.raise("Empty");
        } else {
            return self.raise_unexpected_character();
        }
        self.handler.on_literal_leave(0, end as u32);
        Ok(())
    }

    fn validate_pattern(&mut self, start: usize, end: usize, mode: Mode) -> Consumed<()> {
        let mut unicode = false;
        let mut unicode_sets = false;
        if self.ecma_version() >= 2015 {
            unicode = mode.unicode;
            if self.ecma_version() >= 2024 {
                unicode_sets = mode.unicode_sets;
            }
        }
        if unicode && unicode_sets {
            return self.raise_at(
                "Invalid regular expression flags",
                end + 1,
                Some((true, true)),
            );
        }

        self.unicode_mode = unicode || unicode_sets;
        self.n_flag = (unicode && self.ecma_version() >= 2018)
            || unicode_sets
            || (self.options.strict && self.ecma_version() >= 2023);
        self.unicode_sets_mode = unicode_sets;
        self.reset(start, end);
        self.consume_pattern()?;

        if !self.n_flag && self.ecma_version() >= 2018 && !self.group_names.is_empty() {
            self.n_flag = true;
            self.rewind(start);
            self.consume_pattern()?;
        }
        Ok(())
    }

    fn validate_flags(&mut self, start: usize, end: usize) -> Consumed<()> {
        let flags = self.parse_flags(start, end)?;
        self.handler
            .on_regexp_flags(start as u32, end as u32, flags);
        Ok(())
    }

    #[inline]
    fn strict(&self) -> bool {
        self.options.strict || self.unicode_mode
    }

    #[inline]
    fn ecma_version(&self) -> u32 {
        self.options.ecma_version
    }

    // == the reader ==

    #[inline]
    fn at(&self, index: usize) -> (i32, usize) {
        if index >= self.end {
            return (EOF, 1);
        }
        let (cp, width) = if self.unicode_mode {
            wtf8::code_point_at(self.source, index)
        } else {
            wtf8::unit_at(self.source, index)
        };
        (cp as i32, width)
    }

    fn reset(&mut self, start: usize, end: usize) {
        self.end = end.min(self.source.len());
        self.rewind(start);
    }

    #[inline]
    fn rewind(&mut self, index: usize) {
        self.index = index;
        (self.cp, self.width) = self.at(index);
    }

    #[inline]
    fn advance(&mut self) {
        if self.cp != EOF {
            self.rewind(self.index + self.width);
        }
    }

    #[inline]
    fn pos(&self) -> u32 {
        self.index as u32
    }

    #[inline]
    fn next_code_point(&self) -> i32 {
        self.at(self.index + self.width).0
    }

    fn next_code_points(&self) -> (i32, i32, i32) {
        let (cp2, w2) = self.at(self.index + self.width);
        let (cp3, w3) = self.at(self.index + self.width + w2);
        let (cp4, _) = self.at(self.index + self.width + w2 + w3);
        (cp2, cp3, cp4)
    }

    #[inline]
    fn is(&self, byte: u8) -> bool {
        self.cp == i32::from(byte)
    }

    #[inline]
    fn eat(&mut self, byte: u8) -> bool {
        if self.is(byte) {
            self.advance();
            return true;
        }
        false
    }

    fn eat2(&mut self, a: u8, b: u8) -> bool {
        if self.is(a) && self.next_code_point() == i32::from(b) {
            self.advance();
            self.advance();
            return true;
        }
        false
    }

    fn eat3(&mut self, a: u8, b: u8, c: u8) -> bool {
        if self.is(a) {
            let (cp2, cp3, _) = self.next_code_points();
            if cp2 == i32::from(b) && cp3 == i32::from(c) {
                self.advance();
                self.advance();
                self.advance();
                return true;
            }
        }
        false
    }

    // == errors ==

    fn raise<T>(&mut self, message: &str) -> Consumed<T> {
        self.raise_at(message, self.index, None)
    }

    #[cold]
    fn raise_at<T>(
        &mut self,
        reason: &str,
        index: usize,
        flags: Option<(bool, bool)>,
    ) -> Consumed<T> {
        let (unicode, unicode_sets) = flags.unwrap_or((
            self.unicode_mode && !self.unicode_sets_mode,
            self.unicode_sets_mode,
        ));
        let mut message = String::from("Invalid regular expression");
        match self.kind {
            SourceKind::Literal if !self.source.is_empty() => {
                message.push_str(": ");
                wtf8::push_lossy(&mut message, self.source);
            }
            SourceKind::Pattern => {
                message.push_str(": /");
                wtf8::push_lossy(&mut message, self.source);
                message.push('/');
                if unicode {
                    message.push('u');
                }
                if unicode_sets {
                    message.push('v');
                }
            }
            _ => {}
        }
        message.push_str(": ");
        let start = message.len() as u32;
        message.push_str(reason);
        // An index can be past the end: that of the flags of a pattern that has none.
        let past = index.saturating_sub(self.source.len());
        self.error = Some(SyntaxError {
            message,
            offset: index as u32,
            index: (wtf8::utf16_index(self.source, index) + past) as u32,
            reason: start,
        });
        Err(Raised)
    }

    fn raise_unexpected_character<T>(&mut self) -> Consumed<T> {
        let mut message = String::from("Unexpected character '");
        push_char(&mut message, self.cp);
        message.push('\'');
        self.raise(&message)
    }

    fn enter(&mut self) -> Consumed<()> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return self.raise("Regular expression too large");
        }
        Ok(())
    }

    // == the names of groups ==

    fn clear_group_specifiers(&mut self) {
        self.branches.clear();
        self.branches.push(Branch {
            parent: NO_BRANCH,
            base: 0,
        });
        self.branch = 0;
        self.names.clear();
        self.group_names.clear();
        self.backreference_names.clear();
    }

    fn tracks_branches(&self) -> bool {
        self.ecma_version() >= 2025
    }

    fn new_branch(&mut self, parent: u32, base: Option<u32>) {
        let id = self.branches.len() as u32;
        self.branches.push(Branch {
            parent,
            base: base.unwrap_or(id),
        });
        self.branch = id;
    }

    fn enter_disjunction(&mut self) {
        if self.tracks_branches() {
            self.new_branch(self.branch, None);
        }
    }

    fn enter_alternative(&mut self, index: u32) {
        if self.tracks_branches()
            && index != 0
            && let Some(current) = self.branches.get(self.branch as usize).copied()
        {
            self.new_branch(current.parent, Some(current.base));
        }
    }

    fn leave_disjunction(&mut self) {
        if self.tracks_branches()
            && let Some(current) = self.branches.get(self.branch as usize)
        {
            self.branch = current.parent;
        }
    }

    /// Whether the branches, or any of their ancestors, are different branches of one disjunction.
    fn separated(&self, a: u32, b: u32) -> bool {
        let up = |id: &u32| self.branches.get(*id as usize).map(|branch| branch.parent);
        let base = |id: u32| self.branches.get(id as usize).map(|branch| branch.base);
        std::iter::successors(Some(a), up)
            .take_while(|id| *id != NO_BRANCH)
            .any(|x| {
                std::iter::successors(Some(b), up)
                    .take_while(|id| *id != NO_BRANCH)
                    .any(|y| x != y && base(x) == base(y))
            })
    }

    fn name(&self, start: u32, len: u32) -> &[u8] {
        self.names
            .get(start as usize..(start + len) as usize)
            .unwrap_or_default()
    }

    fn has_in_pattern(&self, name: &[u8]) -> bool {
        self.group_names
            .iter()
            .any(|group| self.name(group.start, group.len) == name)
    }

    fn has_in_scope(&self, name: &[u8]) -> bool {
        self.group_names.iter().any(|group| {
            self.name(group.start, group.len) == name
                && !(self.tracks_branches() && self.separated(group.branch, self.branch))
        })
    }

    fn intern_last_str(&mut self) -> (u32, u32) {
        let start = self.names.len() as u32;
        self.names.extend_from_slice(&self.last_str_value);
        (start, self.last_str_value.len() as u32)
    }

    // == the grammar ==

    fn eat_regexp_body(&mut self) -> Consumed {
        let start = self.index;
        let mut in_class = false;
        let mut escaped = false;
        loop {
            let cp = self.cp;
            if cp == EOF || is_line_terminator(cp) {
                return self.raise(if in_class {
                    "Unterminated character class"
                } else {
                    "Unterminated regular expression"
                });
            }
            if escaped {
                escaped = false;
            } else if self.is(b'\\') {
                escaped = true;
            } else if self.is(b'[') {
                in_class = true;
            } else if self.is(b']') {
                in_class = false;
            } else if (self.is(b'/') && !in_class) || (self.is(b'*') && self.index == start) {
                break;
            }
            self.advance();
        }
        Ok(self.index != start)
    }

    fn consume_pattern(&mut self) -> Consumed<()> {
        let start = self.pos();
        self.num_capturing_parens = self.count_capturing_parens();
        self.clear_group_specifiers();
        self.depth = 0;

        self.handler.on_pattern_enter(start);
        self.consume_disjunction()?;

        if self.cp != EOF {
            if self.is(b')') {
                return self.raise("Unmatched ')'");
            }
            if self.is(b'\\') {
                return self.raise("\\ at end of pattern");
            }
            if self.is(b']') || self.is(b'}') {
                return self.raise("Lone quantifier brackets");
            }
            return self.raise_unexpected_character();
        }
        for i in 0..self.backreference_names.len() {
            let (name_start, len) = self.backreference_names[i];
            if !self.has_in_pattern(self.name(name_start, len)) {
                return self.raise("Invalid named capture referenced");
            }
        }
        self.handler.on_pattern_leave(start, self.pos());
        Ok(())
    }

    fn count_capturing_parens(&mut self) -> i32 {
        let start = self.index;
        let mut in_class = false;
        let mut escaped = false;
        let mut count = 0i32;
        while self.cp != EOF {
            if escaped {
                escaped = false;
            } else if self.is(b'\\') {
                escaped = true;
            } else if self.is(b'[') {
                in_class = true;
            } else if self.is(b']') {
                in_class = false;
            } else if self.is(b'(') && !in_class {
                let (cp2, cp3, cp4) = self.next_code_points();
                if cp2 != i32::from(b'?')
                    || (cp3 == i32::from(b'<') && cp4 != i32::from(b'=') && cp4 != i32::from(b'!'))
                {
                    count = count.saturating_add(1);
                }
            }
            self.advance();
        }
        self.rewind(start);
        count
    }

    fn consume_disjunction(&mut self) -> Consumed<()> {
        let start = self.pos();
        let mut i = 0;

        self.enter()?;
        self.enter_disjunction();
        self.handler.on_disjunction_enter(start);
        loop {
            self.consume_alternative(i)?;
            i += 1;
            if !self.eat(b'|') {
                break;
            }
        }

        if self.consume_quantifier(true)? {
            return self.raise("Nothing to repeat");
        }
        if self.eat(b'{') {
            return self.raise("Lone quantifier brackets");
        }
        self.handler.on_disjunction_leave(start, self.pos());
        self.leave_disjunction();
        self.depth -= 1;
        Ok(())
    }

    fn consume_alternative(&mut self, i: u32) -> Consumed<()> {
        let start = self.pos();
        self.enter_alternative(i);
        self.handler.on_alternative_enter(start, i);
        while self.cp != EOF && self.consume_term()? {}
        self.handler.on_alternative_leave(start, self.pos(), i);
        Ok(())
    }

    fn consume_term(&mut self) -> Consumed {
        if self.strict() {
            return Ok(self.consume_assertion()?
                || (self.consume_atom()? && self.consume_optional_quantifier()?));
        }
        Ok((self.consume_assertion()?
            && (!self.last_assertion_is_quantifiable || self.consume_optional_quantifier()?))
            || (self.consume_extended_atom()? && self.consume_optional_quantifier()?))
    }

    fn consume_optional_quantifier(&mut self) -> Consumed {
        self.consume_quantifier(false)?;
        Ok(true)
    }

    fn consume_assertion(&mut self) -> Consumed {
        let start = self.index;
        self.last_assertion_is_quantifiable = false;

        if self.eat(b'^') {
            self.handler
                .on_edge_assertion(start as u32, self.pos(), false);
            return Ok(true);
        }
        if self.eat(b'$') {
            self.handler
                .on_edge_assertion(start as u32, self.pos(), true);
            return Ok(true);
        }
        if self.eat2(b'\\', b'B') {
            self.handler
                .on_word_boundary_assertion(start as u32, self.pos(), true);
            return Ok(true);
        }
        if self.eat2(b'\\', b'b') {
            self.handler
                .on_word_boundary_assertion(start as u32, self.pos(), false);
            return Ok(true);
        }

        if self.eat2(b'(', b'?') {
            let behind = self.ecma_version() >= 2018 && self.eat(b'<');
            let mut negate = false;
            if self.eat(b'=') || {
                negate = self.eat(b'!');
                negate
            } {
                self.handler
                    .on_lookaround_assertion_enter(start as u32, behind, negate);
                self.consume_disjunction()?;
                if !self.eat(b')') {
                    return self.raise("Unterminated group");
                }
                self.last_assertion_is_quantifiable = !behind && !self.strict();
                self.handler.on_lookaround_assertion_leave(
                    start as u32,
                    self.pos(),
                    behind,
                    negate,
                );
                return Ok(true);
            }
            self.rewind(start);
        }
        Ok(false)
    }

    fn consume_quantifier(&mut self, no_consume: bool) -> Consumed {
        let start = self.pos();
        let (min, max);
        if self.eat(b'*') {
            (min, max) = (0.0, f64::INFINITY);
        } else if self.eat(b'+') {
            (min, max) = (1.0, f64::INFINITY);
        } else if self.eat(b'?') {
            (min, max) = (0.0, 1.0);
        } else if self.eat_braced_quantifier(no_consume)? {
            (min, max) = self.last_range;
        } else {
            return Ok(false);
        }

        let greedy = !self.eat(b'?');
        if !no_consume {
            self.handler
                .on_quantifier(start, self.pos(), count(min), count(max), greedy);
        }
        Ok(true)
    }

    fn eat_braced_quantifier(&mut self, no_error: bool) -> Consumed {
        let start = self.index;
        if self.eat(b'{') {
            if self.eat_decimal_digits() {
                let min = self.last_number;
                let mut max = min;
                if self.eat(b',') {
                    max = if self.eat_decimal_digits() {
                        self.last_number
                    } else {
                        f64::INFINITY
                    };
                }
                if self.eat(b'}') {
                    if !no_error && max < min {
                        return self.raise("numbers out of order in {} quantifier");
                    }
                    self.last_range = (min, max);
                    return Ok(true);
                }
            }
            if !no_error && self.strict() {
                return self.raise("Incomplete quantifier");
            }
            self.rewind(start);
        }
        Ok(false)
    }

    fn consume_atom(&mut self) -> Consumed {
        Ok(self.consume_pattern_character()
            || self.consume_dot()
            || self.consume_reverse_solidus_atom_escape()?
            || self.consume_character_class()?.is_some()
            || self.consume_capturing_group()?
            || self.consume_uncapturing_group()?)
    }

    fn consume_dot(&mut self) -> bool {
        if self.eat(b'.') {
            self.handler
                .on_any_character_set(self.pos() - 1, self.pos());
            return true;
        }
        false
    }

    fn consume_reverse_solidus_atom_escape(&mut self) -> Consumed {
        let start = self.index;
        if self.eat(b'\\') {
            if self.consume_atom_escape()? {
                return Ok(true);
            }
            self.rewind(start);
        }
        Ok(false)
    }

    fn consume_uncapturing_group(&mut self) -> Consumed {
        let start = self.index;
        if self.eat2(b'(', b'?') {
            self.handler.on_group_enter(start as u32);
            if self.ecma_version() >= 2025 {
                self.consume_modifiers()?;
            }
            if !self.eat(b':') {
                self.rewind(start + 1);
                return self.raise("Invalid group");
            }
            self.consume_disjunction()?;
            if !self.eat(b')') {
                return self.raise("Unterminated group");
            }
            self.handler.on_group_leave(start as u32, self.pos());
            return Ok(true);
        }
        Ok(false)
    }

    fn consume_modifiers(&mut self) -> Consumed {
        let start = self.index;
        let has_add_modifiers = self.eat_modifiers();
        let add_modifiers_end = self.index;
        let has_hyphen = self.eat(b'-');
        if !has_add_modifiers && !has_hyphen {
            return Ok(false);
        }
        self.handler.on_modifiers_enter(start as u32);
        let add = self.parse_modifiers(start, add_modifiers_end)?;
        self.handler
            .on_add_modifiers(start as u32, add_modifiers_end as u32, add);

        if has_hyphen {
            let modifiers_start = self.index;
            if !self.eat_modifiers() && !has_add_modifiers && self.is(b':') {
                return self.raise("Invalid empty flags");
            }
            let remove = self.parse_modifiers(modifiers_start, self.index)?;
            for (removed, added, flag) in [
                (remove.ignore_case, add.ignore_case, "Duplicated flag 'i'"),
                (remove.multiline, add.multiline, "Duplicated flag 'm'"),
                (remove.dot_all, add.dot_all, "Duplicated flag 's'"),
            ] {
                if removed && added {
                    return self.raise(flag);
                }
            }
            self.handler
                .on_remove_modifiers(modifiers_start as u32, self.pos(), remove);
        }

        self.handler.on_modifiers_leave(start as u32, self.pos());
        Ok(true)
    }

    fn consume_capturing_group(&mut self) -> Consumed {
        let start = self.index;
        if self.eat(b'(') {
            let mut named = false;
            if self.ecma_version() >= 2018 {
                if self.consume_group_specifier()? {
                    named = true;
                } else if self.is(b'?') {
                    self.rewind(start);
                    return Ok(false);
                }
            } else if self.is(b'?') {
                self.rewind(start);
                return Ok(false);
            }

            // The name outlives the groups inside, which overwrite `last_str_value`.
            let name = named.then(|| self.group_names.last().map_or((0, 0), |g| (g.start, g.len)));
            {
                let text = name.map(|(s, l)| {
                    self.names
                        .get(s as usize..(s + l) as usize)
                        .unwrap_or_default()
                });
                self.handler.on_capturing_group_enter(start as u32, text);
            }
            self.consume_disjunction()?;
            if !self.eat(b')') {
                return self.raise("Unterminated group");
            }
            let text = name.map(|(s, l)| {
                self.names
                    .get(s as usize..(s + l) as usize)
                    .unwrap_or_default()
            });
            self.handler
                .on_capturing_group_leave(start as u32, self.index as u32, text);
            return Ok(true);
        }
        Ok(false)
    }

    fn consume_extended_atom(&mut self) -> Consumed {
        Ok(self.consume_dot()
            || self.consume_reverse_solidus_atom_escape()?
            || self.consume_reverse_solidus_followed_by_c()
            || self.consume_character_class()?.is_some()
            || self.consume_capturing_group()?
            || self.consume_uncapturing_group()?
            || self.consume_invalid_braced_quantifier()?
            || self.consume_extended_pattern_character())
    }

    fn consume_reverse_solidus_followed_by_c(&mut self) -> bool {
        let start = self.pos();
        if self.is(b'\\') && self.next_code_point() == i32::from(b'c') {
            self.last_int_value = self.cp;
            self.advance();
            self.handler
                .on_character(start, self.pos(), u32::from(b'\\'));
            return true;
        }
        false
    }

    fn consume_invalid_braced_quantifier(&mut self) -> Consumed {
        if self.eat_braced_quantifier(true)? {
            return self.raise("Nothing to repeat");
        }
        Ok(false)
    }

    fn consume_pattern_character(&mut self) -> bool {
        let start = self.pos();
        let cp = self.cp;
        if cp != EOF && !is_syntax_character(cp) {
            self.advance();
            self.handler.on_character(start, self.pos(), cp as u32);
            return true;
        }
        false
    }

    fn consume_extended_pattern_character(&mut self) -> bool {
        let start = self.pos();
        let cp = self.cp;
        if cp != EOF
            && !matches!(
                u8::try_from(cp),
                Ok(b'^' | b'$' | b'\\' | b'.' | b'*' | b'+' | b'?' | b'(' | b')' | b'[' | b'|')
            )
        {
            self.advance();
            self.handler.on_character(start, self.pos(), cp as u32);
            return true;
        }
        false
    }

    fn consume_group_specifier(&mut self) -> Consumed {
        let start = self.index;
        if self.eat(b'?') {
            if self.eat_group_name()? {
                if !self.has_in_scope(&self.last_str_value) {
                    let (name_start, len) = self.intern_last_str();
                    self.group_names.push(GroupName {
                        start: name_start,
                        len,
                        branch: self.branch,
                    });
                    return Ok(true);
                }
                return self.raise("Duplicate capture group name");
            }
            self.rewind(start);
        }
        Ok(false)
    }

    fn consume_atom_escape(&mut self) -> Consumed {
        if self.consume_backreference()?
            || self.consume_character_class_escape()?.is_some()
            || self.consume_character_escape()?
            || (self.n_flag && self.consume_k_group_name()?)
        {
            return Ok(true);
        }
        if self.strict() {
            return self.raise("Invalid escape");
        }
        Ok(false)
    }

    fn consume_backreference(&mut self) -> Consumed {
        let start = self.index;
        if self.eat_decimal_escape() {
            let n = self.last_int_value;
            if n <= self.num_capturing_parens {
                self.handler.on_backreference(
                    start as u32 - 1,
                    self.index as u32,
                    Reference::Number(n as u32),
                );
                return Ok(true);
            }
            if self.strict() {
                return self.raise("Invalid escape");
            }
            self.rewind(start);
        }
        Ok(false)
    }

    fn consume_character_class_escape(&mut self) -> Consumed<Option<SetResult>> {
        let start = self.pos();

        for (byte, set, negate) in [
            (b'd', EscapeSet::Digit, false),
            (b'D', EscapeSet::Digit, true),
            (b's', EscapeSet::Space, false),
            (b'S', EscapeSet::Space, true),
            (b'w', EscapeSet::Word, false),
            (b'W', EscapeSet::Word, true),
        ] {
            if self.eat(byte) {
                self.last_int_value = -1;
                self.handler
                    .on_escape_character_set(start - 1, self.pos(), set, negate);
                return Ok(Some(SetResult::default()));
            }
        }

        let mut negate = false;
        if self.unicode_mode
            && self.ecma_version() >= 2018
            && (self.eat(b'p') || {
                negate = self.eat(b'P');
                negate
            })
        {
            self.last_int_value = -1;
            if self.eat(b'{')
                && let Some(result) = self.eat_unicode_property_value_expression()?
                && self.eat(b'}')
            {
                if negate && result.strings {
                    return self.raise("Invalid property name");
                }
                let source = self.source;
                let slice = |(from, to): (usize, usize)| source.get(from..to).unwrap_or_default();
                self.handler.on_unicode_property_character_set(
                    start - 1,
                    self.index as u32,
                    result.key.map_or(b"General_Category", slice),
                    result.value.map(slice),
                    negate,
                    result.strings,
                );
                return Ok(Some(SetResult {
                    may_contain_strings: result.strings,
                }));
            }
            return self.raise("Invalid property name");
        }
        Ok(None)
    }

    fn consume_character_escape(&mut self) -> Consumed {
        let start = self.pos();
        if self.eat_control_escape()
            || self.eat_c_control_letter()
            || self.eat_zero()
            || self.eat_hex_escape_sequence()?
            || self.eat_regexp_unicode_escape_sequence(false)?
            || (!self.strict() && self.eat_legacy_octal_escape_sequence())
            || self.eat_identity_escape()
        {
            self.handler
                .on_character(start - 1, self.pos(), self.last_int_value as u32);
            return Ok(true);
        }
        Ok(false)
    }

    fn consume_k_group_name(&mut self) -> Consumed {
        let start = self.pos();
        if self.eat(b'k') {
            if self.eat_group_name()? {
                let name = self.intern_last_str();
                self.backreference_names.push(name);
                self.handler.on_backreference(
                    start - 1,
                    self.index as u32,
                    Reference::Name(&self.last_str_value),
                );
                return Ok(true);
            }
            return self.raise("Invalid named reference");
        }
        Ok(false)
    }

    fn consume_character_class(&mut self) -> Consumed<Option<SetResult>> {
        let start = self.pos();
        if self.eat(b'[') {
            let negate = self.eat(b'^');
            self.handler
                .on_character_class_enter(start, negate, self.unicode_sets_mode);
            let result = self.consume_class_contents()?;
            if !self.eat(b']') {
                if self.cp == EOF {
                    return self.raise("Unterminated character class");
                }
                return self.raise("Invalid character in character class");
            }
            if negate && result.may_contain_strings {
                return self.raise("Negated character class may contain strings");
            }
            self.handler
                .on_character_class_leave(start, self.pos(), negate);
            return Ok(Some(result));
        }
        Ok(None)
    }

    fn consume_class_contents(&mut self) -> Consumed<SetResult> {
        if self.unicode_sets_mode {
            if self.is(b']') {
                return Ok(SetResult::default());
            }
            return self.consume_class_set_expression();
        }
        let strict = self.strict();
        loop {
            let range_start = self.pos();
            if !self.consume_class_atom()? {
                break;
            }
            let min = self.last_int_value;

            if !self.eat(b'-') {
                continue;
            }
            self.handler
                .on_character(self.pos() - 1, self.pos(), u32::from(b'-'));

            if !self.consume_class_atom()? {
                break;
            }
            let max = self.last_int_value;

            if min == -1 || max == -1 {
                if strict {
                    return self.raise("Invalid character class");
                }
                continue;
            }
            if min > max {
                return self.raise("Range out of order in character class");
            }
            self.handler
                .on_character_class_range(range_start, self.pos(), min as u32, max as u32);
        }
        Ok(SetResult::default())
    }

    fn consume_class_atom(&mut self) -> Consumed {
        let start = self.index;
        let cp = self.cp;

        if cp != EOF && !self.is(b'\\') && !self.is(b']') {
            self.advance();
            self.last_int_value = cp;
            self.handler
                .on_character(start as u32, self.pos(), cp as u32);
            return Ok(true);
        }

        if self.eat(b'\\') {
            if self.consume_class_escape()? {
                return Ok(true);
            }
            if !self.strict() && self.is(b'c') {
                self.last_int_value = i32::from(b'\\');
                self.handler
                    .on_character(start as u32, self.pos(), u32::from(b'\\'));
                return Ok(true);
            }
            if self.strict() {
                return self.raise("Invalid escape");
            }
            self.rewind(start);
        }
        Ok(false)
    }

    fn consume_class_escape(&mut self) -> Consumed {
        let start = self.pos();

        if self.eat(b'b') {
            self.last_int_value = 0x08;
            self.handler.on_character(start - 1, self.pos(), 0x08);
            return Ok(true);
        }

        if self.unicode_mode && self.eat(b'-') {
            self.last_int_value = i32::from(b'-');
            self.handler
                .on_character(start - 1, self.pos(), u32::from(b'-'));
            return Ok(true);
        }

        if !self.strict() && self.is(b'c') {
            let cp = self.next_code_point();
            if is_decimal_digit(cp) || cp == i32::from(b'_') {
                self.advance();
                self.advance();
                self.last_int_value = cp % 0x20;
                self.handler
                    .on_character(start - 1, self.pos(), self.last_int_value as u32);
                return Ok(true);
            }
        }

        Ok(self.consume_character_class_escape()?.is_some() || self.consume_character_escape()?)
    }

    fn consume_class_set_expression(&mut self) -> Consumed<SetResult> {
        let start = self.pos();
        let mut may_contain_strings;
        if self.consume_class_set_character()? {
            if self.consume_class_set_range_from_operator(start)? {
                self.consume_class_union_right(SetResult::default())?;
                return Ok(SetResult::default());
            }
            may_contain_strings = false;
        } else if let Some(result) = self.consume_class_set_operand()? {
            may_contain_strings = result.may_contain_strings;
        } else {
            let cp = self.cp;
            if self.is(b'\\') {
                self.advance();
                return self.raise("Invalid escape");
            }
            if cp == self.next_code_point() && is_class_set_reserved_double_punctuator_character(cp)
            {
                return self.raise("Invalid set operation in character class");
            }
            return self.raise("Invalid character in character class");
        }

        if self.eat2(b'&', b'&') {
            while !self.is(b'&')
                && let Some(result) = self.consume_class_set_operand()?
            {
                self.handler.on_class_intersection(start, self.pos());
                if !result.may_contain_strings {
                    may_contain_strings = false;
                }
                if self.eat2(b'&', b'&') {
                    continue;
                }
                return Ok(SetResult {
                    may_contain_strings,
                });
            }
            return self.raise("Invalid character in character class");
        }
        if self.eat2(b'-', b'-') {
            while self.consume_class_set_operand()?.is_some() {
                self.handler.on_class_subtraction(start, self.pos());
                if self.eat2(b'-', b'-') {
                    continue;
                }
                return Ok(SetResult {
                    may_contain_strings,
                });
            }
            return self.raise("Invalid character in character class");
        }
        self.consume_class_union_right(SetResult {
            may_contain_strings,
        })
    }

    fn consume_class_union_right(&mut self, left: SetResult) -> Consumed<SetResult> {
        let mut may_contain_strings = left.may_contain_strings;
        loop {
            let start = self.pos();
            if self.consume_class_set_character()? {
                self.consume_class_set_range_from_operator(start)?;
                continue;
            }
            if let Some(result) = self.consume_class_set_operand()? {
                if result.may_contain_strings {
                    may_contain_strings = true;
                }
                continue;
            }
            break;
        }
        Ok(SetResult {
            may_contain_strings,
        })
    }

    fn consume_class_set_range_from_operator(&mut self, start: u32) -> Consumed {
        let current_start = self.index;
        let min = self.last_int_value;
        if self.eat(b'-') {
            if self.consume_class_set_character()? {
                let max = self.last_int_value;
                if min == -1 || max == -1 {
                    return self.raise("Invalid character class");
                }
                if min > max {
                    return self.raise("Range out of order in character class");
                }
                self.handler
                    .on_character_class_range(start, self.pos(), min as u32, max as u32);
                return Ok(true);
            }
            self.rewind(current_start);
        }
        Ok(false)
    }

    fn consume_class_set_operand(&mut self) -> Consumed<Option<SetResult>> {
        if let Some(result) = self.consume_nested_class()? {
            return Ok(Some(result));
        }
        if let Some(result) = self.consume_class_string_disjunction()? {
            return Ok(Some(result));
        }
        if self.consume_class_set_character()? {
            return Ok(Some(SetResult::default()));
        }
        Ok(None)
    }

    fn consume_nested_class(&mut self) -> Consumed<Option<SetResult>> {
        let start = self.index;
        if self.eat(b'[') {
            let negate = self.eat(b'^');
            self.enter()?;
            self.handler
                .on_character_class_enter(start as u32, negate, true);
            let result = self.consume_class_contents()?;
            if !self.eat(b']') {
                return self.raise("Unterminated character class");
            }
            if negate && result.may_contain_strings {
                return self.raise("Negated character class may contain strings");
            }
            self.handler
                .on_character_class_leave(start as u32, self.pos(), negate);
            self.depth -= 1;
            return Ok(Some(result));
        }
        if self.eat(b'\\') {
            if let Some(result) = self.consume_character_class_escape()? {
                return Ok(Some(result));
            }
            self.rewind(start);
        }
        Ok(None)
    }

    fn consume_class_string_disjunction(&mut self) -> Consumed<Option<SetResult>> {
        let start = self.pos();
        if self.eat3(b'\\', b'q', b'{') {
            self.handler.on_class_string_disjunction_enter(start);

            let mut i = 0;
            let mut may_contain_strings = false;
            loop {
                if self.consume_class_string(i)?.may_contain_strings {
                    may_contain_strings = true;
                }
                i += 1;
                if !self.eat(b'|') {
                    break;
                }
            }

            if self.eat(b'}') {
                self.handler
                    .on_class_string_disjunction_leave(start, self.pos());
                return Ok(Some(SetResult {
                    may_contain_strings,
                }));
            }
            return self.raise("Unterminated class string disjunction");
        }
        Ok(None)
    }

    fn consume_class_string(&mut self, i: u32) -> Consumed<SetResult> {
        let start = self.pos();
        let mut count = 0u32;
        self.handler.on_string_alternative_enter(start, i);
        while self.cp != EOF && self.consume_class_set_character()? {
            count = count.saturating_add(1);
        }
        self.handler
            .on_string_alternative_leave(start, self.pos(), i);
        Ok(SetResult {
            may_contain_strings: count != 1,
        })
    }

    fn consume_class_set_character(&mut self) -> Consumed {
        let start = self.index;
        let cp = self.cp;
        if (cp != self.next_code_point() || !is_class_set_reserved_double_punctuator_character(cp))
            && cp != EOF
            && !is_class_set_syntax_character(cp)
        {
            self.last_int_value = cp;
            self.advance();
            self.handler
                .on_character(start as u32, self.pos(), cp as u32);
            return Ok(true);
        }
        if self.eat(b'\\') {
            if self.consume_character_escape()? {
                return Ok(true);
            }
            if is_class_set_reserved_punctuator(self.cp) {
                self.last_int_value = self.cp;
                self.advance();
                self.handler
                    .on_character(start as u32, self.pos(), self.last_int_value as u32);
                return Ok(true);
            }
            if self.eat(b'b') {
                self.last_int_value = 0x08;
                self.handler.on_character(start as u32, self.pos(), 0x08);
                return Ok(true);
            }
            self.rewind(start);
        }
        Ok(false)
    }

    fn eat_group_name(&mut self) -> Consumed {
        if self.eat(b'<') {
            if self.eat_regexp_identifier_name()? && self.eat(b'>') {
                return Ok(true);
            }
            return self.raise("Invalid capture group name");
        }
        Ok(false)
    }

    fn eat_regexp_identifier_name(&mut self) -> Consumed {
        if self.eat_regexp_identifier_char(true)? {
            self.last_str_value.clear();
            wtf8::push_code_point(&mut self.last_str_value, self.last_int_value as u32);
            while self.eat_regexp_identifier_char(false)? {
                wtf8::push_code_point(&mut self.last_str_value, self.last_int_value as u32);
            }
            return Ok(true);
        }
        Ok(false)
    }

    /// `eatRegExpIdentifierStart` and `eatRegExpIdentifierPart`
    fn eat_regexp_identifier_char(&mut self, first: bool) -> Consumed {
        let start = self.index;
        let force_u_flag = !self.unicode_mode && self.ecma_version() >= 2020;
        let mut cp = self.cp;
        self.advance();

        if cp == i32::from(b'\\') && self.eat_regexp_unicode_escape_sequence(force_u_flag)? {
            cp = self.last_int_value;
        } else if force_u_flag && is_lead_surrogate(cp) && is_trail_surrogate(self.cp) {
            cp = combine_surrogate_pair(cp, self.cp);
            self.advance();
        }

        if if first {
            is_identifier_start_char(cp)
        } else {
            is_identifier_part_char(cp)
        } {
            self.last_int_value = cp;
            return Ok(true);
        }

        if self.index != start {
            self.rewind(start);
        }
        Ok(false)
    }

    fn eat_c_control_letter(&mut self) -> bool {
        let start = self.index;
        if self.eat(b'c') {
            if self.eat_control_letter() {
                return true;
            }
            self.rewind(start);
        }
        false
    }

    fn eat_zero(&mut self) -> bool {
        if self.is(b'0') && !is_decimal_digit(self.next_code_point()) {
            self.last_int_value = 0;
            self.advance();
            return true;
        }
        false
    }

    fn eat_control_escape(&mut self) -> bool {
        for (byte, value) in [
            (b'f', 0x0C),
            (b'n', 0x0A),
            (b'r', 0x0D),
            (b't', 0x09),
            (b'v', 0x0B),
        ] {
            if self.eat(byte) {
                self.last_int_value = value;
                return true;
            }
        }
        false
    }

    fn eat_control_letter(&mut self) -> bool {
        let cp = self.cp;
        if is_latin_letter(cp) {
            self.advance();
            self.last_int_value = cp % 0x20;
            return true;
        }
        false
    }

    fn eat_regexp_unicode_escape_sequence(&mut self, force_u_flag: bool) -> Consumed {
        let start = self.index;
        let u_flag = force_u_flag || self.unicode_mode;

        if self.eat(b'u') {
            if (u_flag && self.eat_regexp_unicode_surrogate_pair_escape())
                || self.eat_fixed_hex_digits(4)
                || (u_flag && self.eat_regexp_unicode_code_point_escape())
            {
                return Ok(true);
            }
            if self.strict() || u_flag {
                return self.raise("Invalid unicode escape");
            }
            self.rewind(start);
        }
        Ok(false)
    }

    fn eat_regexp_unicode_surrogate_pair_escape(&mut self) -> bool {
        let start = self.index;
        if self.eat_fixed_hex_digits(4) {
            let lead = self.last_int_value;
            if is_lead_surrogate(lead)
                && self.eat(b'\\')
                && self.eat(b'u')
                && self.eat_fixed_hex_digits(4)
            {
                let trail = self.last_int_value;
                if is_trail_surrogate(trail) {
                    self.last_int_value = combine_surrogate_pair(lead, trail);
                    return true;
                }
            }
            self.rewind(start);
        }
        false
    }

    fn eat_regexp_unicode_code_point_escape(&mut self) -> bool {
        let start = self.index;
        if self.eat(b'{')
            && self.eat_hex_digits()
            && self.eat(b'}')
            && (0..=0x10FFFF).contains(&self.last_int_value)
        {
            return true;
        }
        self.rewind(start);
        false
    }

    fn eat_identity_escape(&mut self) -> bool {
        let cp = self.cp;
        if self.is_valid_identity_escape(cp) {
            self.last_int_value = cp;
            self.advance();
            return true;
        }
        false
    }

    fn is_valid_identity_escape(&self, cp: i32) -> bool {
        if cp == EOF {
            return false;
        }
        if self.unicode_mode {
            return is_syntax_character(cp) || cp == i32::from(b'/');
        }
        if self.strict() {
            return !is_id_continue(cp);
        }
        if self.n_flag {
            return !(cp == i32::from(b'c') || cp == i32::from(b'k'));
        }
        cp != i32::from(b'c')
    }

    fn eat_decimal_escape(&mut self) -> bool {
        self.last_int_value = 0;
        if (i32::from(b'1')..=i32::from(b'9')).contains(&self.cp) {
            while is_decimal_digit(self.cp) {
                self.last_int_value = self
                    .last_int_value
                    .saturating_mul(10)
                    .saturating_add(self.cp - i32::from(b'0'));
                self.advance();
            }
            return true;
        }
        false
    }

    fn eat_unicode_property_value_expression(&mut self) -> Consumed<Option<PropertyResult>> {
        let start = self.index;
        let version = self.ecma_version();

        if self.eat_while(is_unicode_property_name_character) && self.is(b'=') {
            let key = (start, self.index);
            self.advance();
            let value_start = self.index;
            if self.eat_while(is_unicode_property_value_character) {
                let value = (value_start, self.index);
                let source = self.source;
                if unicode::is_valid_unicode_property(
                    version,
                    source.get(key.0..key.1).unwrap_or_default(),
                    source.get(value.0..value.1).unwrap_or_default(),
                ) {
                    return Ok(Some(PropertyResult {
                        key: Some(key),
                        value: Some(value),
                        strings: false,
                    }));
                }
                return self.raise("Invalid property name");
            }
        }
        self.rewind(start);

        if self.eat_while(is_unicode_property_value_character) {
            let range = (start, self.index);
            let name = self.source.get(start..self.index).unwrap_or_default();
            if unicode::is_valid_unicode_property(version, b"General_Category", name) {
                return Ok(Some(PropertyResult {
                    key: None,
                    value: Some(range),
                    strings: false,
                }));
            }
            if unicode::is_valid_lone_unicode_property(version, name) {
                return Ok(Some(PropertyResult {
                    key: Some(range),
                    value: None,
                    strings: false,
                }));
            }
            if self.unicode_sets_mode
                && unicode::is_valid_lone_unicode_property_of_string(version, name)
            {
                return Ok(Some(PropertyResult {
                    key: Some(range),
                    value: None,
                    strings: true,
                }));
            }
            return self.raise("Invalid property name");
        }
        Ok(None)
    }

    /// Whether any character was eaten.
    fn eat_while(&mut self, accept: fn(i32) -> bool) -> bool {
        let start = self.index;
        while accept(self.cp) {
            self.advance();
        }
        self.index != start
    }

    fn eat_hex_escape_sequence(&mut self) -> Consumed {
        let start = self.index;
        if self.eat(b'x') {
            if self.eat_fixed_hex_digits(2) {
                return Ok(true);
            }
            if self.strict() {
                return self.raise("Invalid escape");
            }
            self.rewind(start);
        }
        Ok(false)
    }

    fn eat_decimal_digits(&mut self) -> bool {
        let start = self.index;
        self.last_number = 0.0;
        while is_decimal_digit(self.cp) {
            self.last_number = 10.0 * self.last_number + f64::from(digit_to_int(self.cp));
            self.advance();
        }
        self.index != start
    }

    fn eat_hex_digits(&mut self) -> bool {
        let start = self.index;
        self.last_int_value = 0;
        while is_hex_digit(self.cp) {
            self.last_int_value = self
                .last_int_value
                .saturating_mul(16)
                .saturating_add(digit_to_int(self.cp));
            self.advance();
        }
        self.index != start
    }

    fn eat_legacy_octal_escape_sequence(&mut self) -> bool {
        if self.eat_octal_digit() {
            let n1 = self.last_int_value;
            if self.eat_octal_digit() {
                let n2 = self.last_int_value;
                if n1 <= 3 && self.eat_octal_digit() {
                    self.last_int_value += n1 * 64 + n2 * 8;
                } else {
                    self.last_int_value = n1 * 8 + n2;
                }
            } else {
                self.last_int_value = n1;
            }
            return true;
        }
        false
    }

    fn eat_octal_digit(&mut self) -> bool {
        let cp = self.cp;
        if is_octal_digit(cp) {
            self.advance();
            self.last_int_value = cp - i32::from(b'0');
            return true;
        }
        self.last_int_value = 0;
        false
    }

    fn eat_fixed_hex_digits(&mut self, length: u32) -> bool {
        let start = self.index;
        self.last_int_value = 0;
        for _ in 0..length {
            let cp = self.cp;
            if !is_hex_digit(cp) {
                self.rewind(start);
                return false;
            }
            self.last_int_value = 16 * self.last_int_value + digit_to_int(cp);
            self.advance();
        }
        true
    }

    fn eat_modifiers(&mut self) -> bool {
        self.eat_while(is_regular_expression_modifier)
    }

    fn parse_modifiers(&mut self, start: usize, end: usize) -> Consumed<ModifierFlags> {
        let flags = self.parse_flags(start, end)?;
        Ok(ModifierFlags {
            ignore_case: flags.ignore_case,
            multiline: flags.multiline,
            dot_all: flags.dot_all,
        })
    }

    fn parse_flags(&mut self, start: usize, end: usize) -> Consumed<Flags> {
        let mut flags = Flags::default();
        let version = self.ecma_version();
        let mut i = start;
        while i < end {
            let (unit, width) = wtf8::unit_at(self.source, i);
            i += width;
            let flag = match u8::try_from(unit) {
                Ok(b'g') => Some(&mut flags.global),
                Ok(b'i') => Some(&mut flags.ignore_case),
                Ok(b'm') => Some(&mut flags.multiline),
                Ok(b'u') if version >= 2015 => Some(&mut flags.unicode),
                Ok(b'y') if version >= 2015 => Some(&mut flags.sticky),
                Ok(b's') if version >= 2018 => Some(&mut flags.dot_all),
                Ok(b'd') if version >= 2022 => Some(&mut flags.has_indices),
                Ok(b'v') if version >= 2024 => Some(&mut flags.unicode_sets),
                _ => None,
            };
            let mut message = match flag {
                Some(flag) if !*flag => {
                    *flag = true;
                    continue;
                }
                Some(_) => String::from("Duplicated flag '"),
                None => String::from("Invalid flag '"),
            };
            push_char(&mut message, unit as i32);
            message.push('\'');
            return self.raise_at(&message, start, None);
        }
        Ok(flags)
    }
}
