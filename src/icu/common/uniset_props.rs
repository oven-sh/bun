//! Builds the code points of a `UnicodeSet` from a pattern. ICU4C: uniset_props.cpp

use crate::common::characterproperties::{binary_property_set, set_by_filter};
use crate::common::charstr::SmallChars;
use crate::common::cstring::until_nul;
use crate::common::memory::{Appendable, fail_on_oom, try_push};
use crate::common::patternprops;
use crate::common::propname::{
    property_names_match, u_get_property_enum, u_get_property_value_enum,
};
use crate::common::ruleiter::RuleCharacterIterator;
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::uchar::{u_char_age, u_get_gc_mask, u_get_numeric_value, uscript_has_script};
use crate::common::uinvchar::invariant_chars;
use crate::common::unames::u_char_from_name;
use crate::common::unicode::uchar::*;
use crate::common::uniset::{MAX_VALUE, UnicodeSet};
use crate::common::unistr::UStr;
use crate::common::uprops::{u_get_int_property_value, u_has_id_type};
use crate::common::utf16;
use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, UErrorCode};
use crate::common::uversion;
use bun_core::strings;
use std::fmt::NumBuffer;
use std::mem::replace;

/// `[a$]` contains this code point.
const U_ETHER: u32 = 0xffff;

const MAX_DEPTH: usize = 100;

enum Token {
    /// `[`, `]`, `^`, `-`, `&`, `$`
    Operator(char),
    CodePoint(u32, Notation),
    /// `{...}` with zero or more than one element. A lead and a trail surrogate add up to a code point.
    String(Option<u32>),
    /// A property query.
    Set(UnicodeSet),
}

#[derive(Clone, Copy)]
enum Notation {
    Literal,
    Escaped,
    /// `\N{LATIN SMALL LETTER A}`, `{a}`
    InBraces,
}

/// Determines which tokens must be separated by white space from the preceding token.
#[derive(Clone, Copy)]
enum SeparationRule {
    Unconstrained,
    /// A literal `:` must be separated.
    AfterOpenBracket,
    AfterEscape {
        /// If true, an escaped trail surrogate must be separated.
        is_lead: bool,
        /// A literal digit below this radix must be separated, because it would look like a part of the escape.
        radix: u32,
    },
}

impl SeparationRule {
    /// `source` is the text of the escape.
    fn after_escape(c: u32, source: &[u16]) -> Self {
        let radix = match char::from_u32(source.char_at(1).into()) {
            Some('x') if source.len() <= 3 => 16,
            Some('0'..='7') if source.len() <= 3 => 8,
            _ => 0,
        };
        Self::AfterEscape {
            is_lead: utf16::is_lead(c),
            radix,
        }
    }

    fn applies_to(self, token: &Token) -> bool {
        match (self, token) {
            (Self::AfterOpenBracket, &Token::CodePoint(c, Notation::Literal)) => c == ':'.into(),
            (Self::AfterEscape { is_lead, .. }, &Token::CodePoint(c, Notation::Escaped)) => {
                is_lead && utf16::is_trail(c)
            }
            (Self::AfterEscape { radix, .. }, &Token::CodePoint(c, Notation::Literal)) => {
                char::from_u32(c)
                    .and_then(|c| c.to_digit(16))
                    .is_some_and(|digit| digit < radix)
            }
            _ => false,
        }
    }
}

struct LexResult {
    /// `None` at the end of the pattern and for an error.
    token: Option<Token>,
    /// The index after the token.
    after: usize,
    /// The rule for the next token.
    separation: SeparationRule,
}

impl LexResult {
    fn is_operator(&self, operator: char) -> bool {
        matches!(self.token, Some(Token::Operator(c)) if c == operator)
    }

    fn starts_set(&self) -> bool {
        matches!(self.token, Some(Token::Operator('[') | Token::Set(_)))
    }

    fn range_element(&self) -> Option<u32> {
        match self.token {
            Some(Token::CodePoint(c, _)) => Some(c),
            Some(Token::Operator('$')) => Some('$'.into()),
            _ => None,
        }
    }
}

/// `separation` is the rule set by the preceding token. ICU4C: uniset_props.cpp, Lexer::nextToken
fn next_token(mut chars: RuleCharacterIterator, separation: SeparationRule) -> LexResult {
    let is_separated = chars.skip_white_space();
    let start = chars.pos;
    let token =
        scan_token(&mut chars).filter(|token| is_separated || !separation.applies_to(token));
    let separation = match token {
        Some(Token::Operator('[')) => SeparationRule::AfterOpenBracket,
        Some(Token::CodePoint(c, Notation::Escaped)) => {
            SeparationRule::after_escape(c, chars.consumed_since(start))
        }
        _ => SeparationRule::Unconstrained,
    };
    LexResult {
        token,
        after: chars.pos,
        separation,
    }
}

struct Lexer<'a> {
    /// Positioned after the last consumed token.
    chars: RuleCharacterIterator<'a>,
    /// The rule set by the last consumed token.
    separation: SeparationRule,
    ahead: Option<LexResult>,
    ahead2: Option<LexResult>,
}

impl Lexer<'_> {
    fn lookahead(&mut self) -> &mut LexResult {
        self.ahead
            .get_or_insert_with(|| next_token(self.chars, self.separation))
    }

    fn lookahead2(&mut self) -> &LexResult {
        let &mut LexResult {
            after, separation, ..
        } = self.lookahead();
        let chars = RuleCharacterIterator {
            pos: after,
            ..self.chars
        };
        self.ahead2
            .get_or_insert_with(|| next_token(chars, separation))
    }

    fn advance(&mut self) {
        let &mut LexResult {
            after, separation, ..
        } = self.lookahead();
        (self.chars.pos, self.separation) = (after, separation);
        self.ahead = self.ahead2.take();
    }

    fn accept(&mut self, operator: char) -> bool {
        let is_next = self.lookahead().is_operator(operator);
        if is_next {
            self.advance();
        }
        is_next
    }

    /// Returns whether the next two tokens are `operator` and `]`.
    fn is_operator_before_close(&mut self, operator: char) -> bool {
        self.lookahead().is_operator(operator) && self.lookahead2().is_operator(']')
    }

    /// Consumes a `-` unless `]` follows, which makes the `-` a literal.
    fn accept_minus(&mut self) -> bool {
        !self.is_operator_before_close('-') && self.accept('-')
    }
}

fn scan_token(chars: &mut RuleCharacterIterator) -> Option<Token> {
    let first = chars.next()?;
    let mut after_second = *chars;
    match (char::from_u32(first), after_second.next_char()) {
        (Some('['), Some(second @ ':')) | (Some('\\'), Some(second @ ('p' | 'P'))) => {
            *chars = after_second;
            scan_property_query(chars, second).map(Token::Set)
        }
        (Some('\\'), Some('N')) => {
            *chars = after_second;
            scan_named_element_brackets(chars).map(|c| Token::CodePoint(c, Notation::InBraces))
        }
        (Some('\\'), _) => Some(Token::CodePoint(chars.next_escape()?, Notation::Escaped)),
        (Some(operator @ ('[' | '&' | '-' | ']' | '^' | '$')), _) => {
            Some(Token::Operator(operator))
        }
        (Some('{'), _) => scan_string_literal(chars),
        _ => Some(Token::CodePoint(first, Notation::Literal)),
    }
}

/// Scans the rest of `{...}` after the opening brace.
fn scan_string_literal(chars: &mut RuleCharacterIterator) -> Option<Token> {
    let (mut count, mut before_last, mut last) = (0, 0, 0);
    loop {
        let c = chars.next()?;
        let after = chars.pos;
        let element = match char::from_u32(c) {
            Some('}') if count == 1 => return Some(Token::CodePoint(last, Notation::InBraces)),
            Some('}') => {
                let is_pair = count == 2 && utf16::is_lead(before_last) && utf16::is_trail(last);
                let pair = is_pair.then(|| utf16::get_supplementary(before_last, last));
                return Some(Token::String(pair));
            }
            Some('\\') => match chars.next_char() {
                Some('N') => scan_named_element_brackets(chars)?,
                Some('p' | 'P') => return None,
                _ => {
                    chars.pos = after;
                    chars.next_escape()?
                }
            },
            _ if patternprops::is_white_space(c) => return None,
            _ => c,
        };
        before_last = replace(&mut last, element);
        count += 1;
    }
}

/// Scans `{name}`, `{41:name}` or `{41:A:name}` after `\N`.
fn scan_named_element_brackets(chars: &mut RuleCharacterIterator) -> Option<u32> {
    if chars.next_char()? != '{' {
        return None;
    }
    let (mut number, mut literal) = (None, None);
    let mut start = chars.pos;
    loop {
        let field = chars.consumed_since(start);
        match char::from_u32(chars.next()?) {
            Some(':') if number.is_none() && !field.is_empty() => {
                number = Some(field.iter().try_fold(0, |number, &c| {
                    let digit = char::from_u32(c.into())?.to_digit(16)?;
                    Some(number << 4 | digit).filter(|&c| c <= MAX_VALUE)
                })?);
            }
            Some(':') if literal.is_none() && field.count_char32() == 1 => {
                literal = Some(char::from_u32(field.char32_at(0))?.into());
            }
            Some(':') => return None,
            Some('}') => {
                return u_char_from_name(until_nul(&to_invariant_chars(field)?)).filter(|&c| {
                    number.is_none_or(|number| number == c)
                        && literal.is_none_or(|literal: u32| literal == c)
                });
            }
            _ => continue,
        }
        start = chars.pos;
    }
}

/// Scans the rest of a query that starts with `[:`, `\p` or `\P`.
fn scan_property_query(chars: &mut RuleCharacterIterator, second: char) -> Option<UnicodeSet> {
    let third = chars.text.char_at(chars.pos);
    let (is_negated_outside, close): (_, &[u16]) = if second == ':' {
        (third == b'^'.into(), &utf16::from_latin1(b":]"))
    } else if third == b'{'.into() {
        (second == 'P', &utf16::from_latin1(b"}"))
    } else {
        return None;
    };
    let start = chars.pos + usize::from(second != ':' || is_negated_outside);
    let limit = chars.text.index_of_from(close, start)?;
    chars.pos = limit + close.len();
    const NOT_EQUAL: u16 = '≠' as u16;
    let expression = chars.text.slice(start..limit);
    let (name, rest) = expression.split_while(|&c| c != b'='.into() && c != NOT_EQUAL);
    let name = to_invariant_chars(name)?;
    let (mut set, is_negated_inside) = match *rest {
        [] => (set_of_alias(until_nul(&name))?, false),
        [_] => return None,
        [NOT_EQUAL, ..] if is_negated_outside => return None,
        [operator, ref value @ ..] => {
            let value = to_invariant_chars(value)?;
            let set = set_of_value_alias(until_nul(&name), until_nul(&value))?;
            (set, operator == NOT_EQUAL)
        }
    };
    if is_negated_outside || is_negated_inside {
        set.complement();
    }
    Some(set)
}

fn to_invariant_chars(name: &[u16]) -> Option<SmallChars> {
    invariant_chars(name.iter().copied()).ok()
}

/// A set whose closing bracket has not been parsed yet.
struct SetFrame {
    is_complement: bool,
    result: UnicodeSet,
    /// Combines `result` with the next nested set.
    operation: fn(&mut UnicodeSet, &UnicodeSet),
}

impl SetFrame {
    fn finish(mut self) -> UnicodeSet {
        if self.is_complement {
            self.result.complement();
        }
        self.result
    }
}

/// The parser.
impl Lexer<'_> {
    fn parse_unicode_set(&mut self) -> Option<UnicodeSet> {
        if let Some(set) = self.accept_set_token() {
            return Some(set);
        }
        // `frame` is the innermost set, `stack` has its ancestors.
        let (mut frame, mut stack) = (self.open_set()?, Vec::new());
        let mut is_after_set = false;
        loop {
            let is_set_next = (is_after_set && self.accept_operation(&mut frame))
                || self.parse_content(&mut frame)?;
            let set = if !is_set_next {
                self.accept(']').then_some(())?;
                match stack.pop() {
                    Some(enclosing) => replace(&mut frame, enclosing).finish(),
                    None => return Some(frame.finish()),
                }
            } else if stack.len() >= MAX_DEPTH {
                return None;
            } else if let Some(set) = self.accept_set_token() {
                set
            } else {
                let inner = self.open_set()?;
                try_push(&mut stack, replace(&mut frame, inner)).ok()?;
                is_after_set = false;
                continue;
            };
            (frame.operation)(&mut frame.result, &set);
            is_after_set = true;
        }
    }

    fn accept_set_token(&mut self) -> Option<UnicodeSet> {
        let Some(Token::Set(set)) = &mut self.lookahead().token else {
            return None;
        };
        let set = replace(set, UnicodeSet::new());
        self.advance();
        Some(set)
    }

    fn open_set(&mut self) -> Option<SetFrame> {
        self.accept('[').then_some(())?;
        let is_complement = self.accept('^');
        let mut result = UnicodeSet::new();
        if self.accept('-') {
            result.add('-'.into());
        }
        Some(SetFrame {
            is_complement,
            result,
            operation: UnicodeSet::add_all,
        })
    }

    /// Parses up to the closing bracket (returns `false`) or up to a nested set (returns `true`).
    fn parse_content(&mut self, frame: &mut SetFrame) -> Option<bool> {
        loop {
            if self.accept('-') {
                frame.result.add('-'.into());
                return Some(false);
            }
            if self.is_operator_before_close('$') {
                self.advance();
                frame.result.add(U_ETHER);
                return Some(false);
            }
            if self.lookahead().is_operator(']') {
                return Some(false);
            }
            if self.lookahead().starts_set() {
                frame.operation = UnicodeSet::add_all;
                return Some(true);
            }
            self.parse_elements(&mut frame.result)?;
        }
    }

    /// Consumes `&` or `-` after a nested set. The left operand is `frame.result`.
    fn accept_operation(&mut self, frame: &mut SetFrame) -> bool {
        frame.operation = if self.accept('&') {
            UnicodeSet::retain_all
        } else if self.accept_minus() {
            UnicodeSet::remove_all
        } else {
            return false;
        };
        true
    }

    /// Parses a string, a code point or a range.
    fn parse_elements(&mut self, result: &mut UnicodeSet) -> Option<()> {
        if let Some(Token::String(pair)) = self.lookahead().token {
            pair.into_iter().for_each(|c| result.add(c));
            self.advance();
            return Some(());
        }
        let first = self.lookahead().range_element()?;
        self.advance();
        let mut last = first;
        if self.accept_minus() {
            last = self.lookahead().range_element()?;
            if last <= first || self.is_operator_before_close('$') {
                return None;
            }
            self.advance();
        }
        result.add_range(first, last);
        Some(())
    }
}

impl UnicodeSet {
    /// Ignores white space. The strings of the pattern are not added.
    #[cold]
    pub(crate) fn from_pattern(pattern: &[u16]) -> Result<Self, UErrorCode> {
        let mut lexer = Lexer {
            chars: RuleCharacterIterator {
                text: pattern,
                pos: 0,
            },
            separation: SeparationRule::Unconstrained,
            ahead: None,
            ahead2: None,
        };
        fail_on_oom(|| {
            let set = lexer.parse_unicode_set();
            set.filter(|_| {
                patternprops::skip_white_space(pattern, lexer.chars.pos) == pattern.len()
            })
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR)
        })
    }
}

// ICU4C: uniset_props.cpp, UnicodeSet::applyIntPropertyValue
fn set_of_value(prop: UProperty, value: i32) -> Option<UnicodeSet> {
    match prop {
        UCHAR_GENERAL_CATEGORY_MASK => set_by_filter(prop, &|c| u_get_gc_mask(c) & value != 0),
        UCHAR_SCRIPT_EXTENSIONS => set_by_filter(prop, &|c| uscript_has_script(c, value)),
        UCHAR_IDENTIFIER_TYPE => set_by_filter(prop, &|c| u_has_id_type(c, value)),
        UCHAR_BINARY_START..UCHAR_BINARY_LIMIT => binary_property_set(prop).map(|set| {
            let mut set = set.clone_as_thawed();
            if value == 0 {
                set.complement();
            }
            set
        }),
        _ => set_by_filter(prop, &|c| u_get_int_property_value(c, prop) == value),
    }
    .ok()
}

/// `\p{pname=vname}`. ICU4C: uniset_props.cpp, UnicodeSet::applyPropertyAlias
fn set_of_value_alias(pname: &[u8], vname: &[u8]) -> Option<UnicodeSet> {
    let prop = match u_get_property_enum(pname)? {
        UCHAR_GENERAL_CATEGORY => UCHAR_GENERAL_CATEGORY_MASK,
        prop => prop,
    };
    let value = match prop {
        UCHAR_CANONICAL_COMBINING_CLASS
        | UCHAR_TRAIL_CANONICAL_COMBINING_CLASS
        | UCHAR_LEAD_CANONICAL_COMBINING_CLASS => {
            u_get_property_value_enum(prop, vname).or_else(|| {
                strtod(vname)
                    .filter(|number| (0.0..=255.0).contains(number) && number.fract() == 0.0)
                    .map(|number| number as i32)
            })?
        }
        UCHAR_SCRIPT_EXTENSIONS => u_get_property_value_enum(UCHAR_SCRIPT, vname)?,
        UCHAR_NUMERIC_VALUE => {
            let number = strtod(vname)?;
            return set_by_filter(prop, &|c| u_get_numeric_value(c) == number).ok();
        }
        UCHAR_NAME => return u_char_from_name(vname).map(|c| set_of_range(c, c)),
        UCHAR_AGE => {
            let version = uversion::parse(vname);
            let is_assigned_by_then = |age| [0; 4] < age && age <= version;
            return set_by_filter(prop, &|c| is_assigned_by_then(u_char_age(c))).ok();
        }
        // The values of the other properties of strings have no names.
        _ => u_get_property_value_enum(prop, vname)?,
    };
    set_of_value(prop, value)
}

/// `\p{pname}`
fn set_of_alias(pname: &[u8]) -> Option<UnicodeSet> {
    for prop in [UCHAR_GENERAL_CATEGORY_MASK, UCHAR_SCRIPT] {
        if let Some(value) = u_get_property_value_enum(prop, pname) {
            return set_of_value(prop, value);
        }
    }
    if let Some(prop @ UCHAR_BINARY_START..UCHAR_BINARY_LIMIT) = u_get_property_enum(pname) {
        set_of_value(prop, 1)
    } else if property_names_match(b"any", pname) {
        Some(set_of_range(0, MAX_VALUE))
    } else if property_names_match(b"ascii", pname) {
        Some(set_of_range(0, 0x7f))
    } else if property_names_match(b"assigned", pname) {
        set_of_value(UCHAR_GENERAL_CATEGORY_MASK, !U_GC_CN_MASK)
    } else {
        None
    }
}

fn set_of_range(start: u32, end: u32) -> UnicodeSet {
    let mut set = UnicodeSet::new();
    set.add_range(start, end);
    set
}

/// Parses all of `s` by the syntax of C's `strtod`. Returns NaN for `inf`, because neither value matches any character.
fn strtod(s: &[u8]) -> Option<f64> {
    if s.is_empty() {
        return Some(0.0);
    }
    let (sign, unsigned) = split_sign(s.split_while(|c| matches!(c, b' ' | 0x9..=0xd)).1);
    let magnitude = match unsigned {
        [b'0', b'x' | b'X', hex @ ..] => FloatLiteral::parse(hex, 16, b"pP")?.hex_value(),
        [b'0'..=b'9' | b'.', ..] => FloatLiteral::parse(unsigned, 10, b"eE")?.decimal_value(),
        _ => is_nan_or_infinity(unsigned).then_some(f64::NAN)?,
    };
    Some(f64::from(sign) * magnitude)
}

fn is_nan_or_infinity(s: &[u8]) -> bool {
    let eq = |s: &[u8], name: &[u8]| s.eq_ignore_ascii_case(name);
    match split_at_any(s, b"(") {
        (name, None) => eq(name, b"nan") || eq(name, b"inf") || eq(name, b"infinity"),
        (name, Some([payload @ .., b')'])) => {
            eq(name, b"nan")
                && payload
                    .iter()
                    .all(|&c| c.is_ascii_alphanumeric() || c == b'_')
        }
        _ => false,
    }
}

fn split_sign(s: &[u8]) -> (i8, &[u8]) {
    match s {
        [b'-', rest @ ..] => (-1, rest),
        [b'+', rest @ ..] | rest => (1, rest),
    }
}

fn split_at_any<'a>(s: &'a [u8], separators: &[u8]) -> (&'a [u8], Option<&'a [u8]>) {
    match strings::index_of_any(s, separators) {
        Some(at) => (s.slice(..at), Some(s.slice(at + 1..))),
        None => (s, None),
    }
}

/// An unsigned number: `digits [. digits] [exponent_mark [sign] decimal digits]`
struct FloatLiteral<'a> {
    integer: &'a [u8],
    fraction: &'a [u8],
    /// Saturates at 10^17.
    exponent: i64,
}

impl<'a> FloatLiteral<'a> {
    fn parse(s: &'a [u8], radix: u32, exponent_marks: &[u8]) -> Option<Self> {
        let (mantissa, exponent) = split_at_any(s, exponent_marks);
        let (sign, exponent) = split_sign(exponent.unwrap_or(b"0"));
        let (integer, fraction) = split_at_any(mantissa, b".");
        let fraction = fraction.unwrap_or_default();
        let is_mantissa = integer
            .iter()
            .chain(fraction)
            .all(|&c| char::from(c).is_digit(radix));
        let has_digits = integer.len() + fraction.len() > 0 && !exponent.is_empty();
        if !(is_mantissa && has_digits && exponent.iter().all(u8::is_ascii_digit)) {
            return None;
        }
        let exponent = exponent.iter().fold(0, |n: i64, &c| {
            (n * 10 + i64::from(c - b'0')).min(10i64.pow(17))
        });
        Some(Self {
            integer,
            fraction,
            exponent: i64::from(sign) * exponent,
        })
    }

    /// Returns the digits without leading zeros, and the position of the radix point relative to the first one.
    fn significant_digits(&self) -> (impl Iterator<Item = u8>, i64) {
        let digits = self.integer.iter().chain(self.fraction).copied();
        let zeros = digits.clone().take_while(|&c| c == b'0').count();
        (digits.skip(zeros), self.integer.len() as i64 - zeros as i64)
    }

    /// Normalizes the number first, because `str::parse` saturates exponents at 65536 even if zeros compensate.
    fn decimal_value(&self) -> f64 {
        let (mut digits, point) = self.significant_digits();
        let exponent = (point + self.exponent).clamp(-999, 999);
        let mut text = SmallChars::of(b"0.");
        // With a sticky digit. A midpoint between two `f64` values has at most 767 digits.
        text.add_each(digits.by_ref().take(800));
        text.add(b'0' + u8::from(digits.any(|c| c != b'0')));
        text.add_all(if exponent < 0 { b"e-" } else { b"e+" });
        text.add_all(
            exponent
                .unsigned_abs()
                .format_into(&mut NumBuffer::new())
                .as_bytes(),
        );
        str::from_utf8(&text)
            .ok()
            .and_then(|text| text.parse().ok())
            .soft_unwrap()
    }

    fn hex_value(&self) -> f64 {
        let (digits, point) = self.significant_digits();
        let mut digits = digits.filter_map(|c| char::from(c).to_digit(16));
        // Sixteen digits and a sticky bit.
        let mantissa = (0..16).fold(0, |n, _| n << 4 | u64::from(digits.next().unwrap_or(0)));
        let mantissa = mantissa | u64::from(digits.any(|digit| digit != 0));
        if mantissa == 0 {
            return 0.0;
        }
        let binary_exponent = self.exponent + 4 * point - 1 - i64::from(mantissa.leading_zeros());
        if binary_exponent > 1023 {
            return f64::INFINITY;
        }
        // Round once to 53 bits, or fewer for subnormals. The implicit bit carries into the exponent field.
        let bits = u128::from(mantissa << mantissa.leading_zeros());
        let dropped_bits = (-1011 - binary_exponent).clamp(11, 65);
        let rounded =
            (bits + (1 << (dropped_bits - 1)) - 1 + (bits >> dropped_bits & 1)) >> dropped_bits;
        f64::from_bits((((binary_exponent + 1022).max(0) as u64) << 52) + rounded as u64)
    }
}
