//! Reads a value in the small language that most values are written in: names, numbers, colors, variables, strings and
//! calls, with blanks, commas and operators between them, and lists and maps in parentheses, on any number of lines.
//!
//! What's left of the value is its flat text, which is the value as it's printed on one line, and a record for each
//! parenthesis, comma, colon of a pair and comment. `layout.rs` needs no more than that.
//!
//! Anything else is refused. Each thing that's taken is taken because the parsers make of it what it looks like, and
//! the printer prints that as it stands. So this may refuse too much, and must never take what they'd treat in another
//! way.

use super::super::Parser as Syntax;
use super::super::selector_parser::has_comment;
use super::layout::Page;
use super::{
    BLANK, DASH, DIGIT, HIGHEST_BITS, INDENTATION, LOWER, PLAIN, Shape, UNDERSCORE, UPPER, byte,
    class, in_classes, is_asked_for_by_name, may_end_with_white_space, skip, skip_long,
};
use bun_core::strings;

/// Parentheses that are nested deeper than this are refused. It also bounds how deep `layout.rs` calls itself.
const MAX_DEPTH: usize = 32;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(super) enum Kind {
    Open,
    Close,
    Comma,
    /// The colon of `key: value`.
    Colon,
    /// A `//` comment.
    Comment,
}

/// `Open`: a name is right before it.
pub(super) const CALL: u8 = 1;
/// `Open`: its first item is `key: value`, with no comment before it.
pub(super) const FIRST_PAIR: u8 = 2;
/// `Open`: something in it can force a line break: a pair, parentheses without a name, a comment, an empty line.
pub(super) const COMPLEX: u8 = 4;
/// `Comma`: an empty line follows.
pub(super) const EMPTY_LINE: u8 = 8;

#[derive(Debug, Copy, Clone)]
pub(super) struct Record {
    pub(super) kind: Kind,
    pub(super) flags: u8,
    /// Where it is in the flat text. For a comment: where it starts in the source.
    pub(super) at: u32,
    /// `Open`: the index of the record of its `)`. `Close`: the number of items. `Comment`: where it ends in the
    /// source.
    pub(super) link: u32,
}

/// A parenthesis that isn't closed yet.
#[derive(Copy, Clone)]
struct Open {
    record: u32,
    /// Where it is in the source.
    paren: u32,
    commas: u32,
}

/// What can come next.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Place {
    /// A term: at the start, after the colon of a pair.
    First,
    /// A term.
    AfterOperator,
    /// After `(`: a term or `)`.
    Open,
    /// After a term and a blank: a term or an operator.
    Next,
    AfterComma,
}

/// What a value is part of.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Owner {
    Declaration,
    /// Its strings and numbers are printed as they're written.
    CustomProperty,
    AtRule,
    /// `.name(words)` of Less, which is an at-rule to the parser and a selector to the printer. For `read_simple_value`.
    MixinCall,
}

/// The buffers, and what's known about the value that was read last.
#[derive(Default)]
pub(super) struct Values {
    /// The flat text, unless `is_as_written`.
    pub(super) flat: Vec<u8>,
    pub(super) records: Vec<Record>,
    opens: Vec<Open>,
    /// The flat text is the value as it's in the source.
    pub(super) is_as_written: bool,
    /// The flat text differs from the source by more than its quotes.
    pub(super) is_reshaped: bool,
    /// Where the value starts and ends in the source.
    pub(super) start: usize,
    pub(super) end: usize,
    /// The number of commas outside of all parentheses.
    pub(super) top_commas: u32,
    /// It ends with `as *`.
    pub(super) ends_with_star: bool,
    /// It has the `a-*` of `@forward "b" as a-*`.
    pub(super) has_wildcard: bool,
    /// It has a record with `COMPLEX`.
    pub(super) has_complex: bool,
    /// It has a `//` comment.
    pub(super) has_comments: bool,
    /// It has a line break.
    pub(super) has_line_breaks: bool,
    /// It's more than one word.
    pub(super) has_blanks: bool,
    /// It has a `/` without blanks around it, which is a node of its own.
    pub(super) has_tight_slash: bool,
}

impl Values {
    pub(super) fn flat<'a>(&'a self, css: &'a [u8]) -> &'a [u8] {
        match self.is_as_written {
            true => css.get(self.start..self.end).unwrap_or_default(),
            false => &self.flat,
        }
    }
}

struct Scanner<'a> {
    css: &'a [u8],
    syntax: Syntax,
    owner: Owner,
    /// The quote that strings are printed with.
    quote: u8,
    values: &'a mut Values,
    /// Where the part of the source starts that hasn't been copied to the flat text.
    segment: usize,
    has_other_quotes: bool,
    /// A string has a quote in it.
    has_inner_quotes: bool,
    /// The number of parentheses that were open at the `#{name(` that's being read.
    interpolation: Option<usize>,
}

const NAME: u8 = LOWER | DIGIT | DASH | UNDERSCORE;
const ANY_NAME: u8 = NAME | UPPER;

/// True for the bytes of the name of a function: a name, a variable, a member of a module.
pub(super) fn is_call_name_byte(byte: u8) -> bool {
    class(byte) & ANY_NAME != 0 || matches!(byte, b'$' | b'.')
}

/// `postcss` remembers a word `url` until the next `(`, wherever that is, so no name that could be one is taken.
#[inline]
pub(super) fn starts_with_url(css: &[u8], at: usize) -> bool {
    matches!(
        css.get(at..at + 3),
        Some([b'u' | b'U', b'r' | b'R', b'l' | b'L'])
    )
}

/// What ends a `//` comment that's taken. The parsers have ideas of their own about a backslash and an asterisk in one.
fn end_of_line_comment(css: &[u8], from: usize) -> usize {
    let rest = css.get(from..).unwrap_or_default();
    from + rest
        .iter()
        .take_while(|it| !matches!(it, 0 | b'\n' | b'\r' | 0x0C | b'\\' | b'*'))
        .count()
}

/// A number that's printed as it's written, from the digit at `p`. Returns its end.
pub(super) fn number(css: &[u8], p: usize) -> Option<usize> {
    // Most of the time, the number, its unit and the byte after them are within eight bytes.
    if let Some(bytes) = css.get(p..p + 8).and_then(|it| it.first_chunk::<8>()) {
        let word = u64::from_le_bytes(*bytes);
        let no_digits = in_classes(word, DIGIT) ^ HIGHEST_BITS;
        let no_letters = in_classes(word, LOWER) ^ HIGHEST_BITS;
        // The index of the first byte from `from` on that has its bit in `stops`, or 8.
        let next = |stops: u64, from: usize| match stops.checked_shr(8 * from as u32) {
            Some(rest) if rest != 0 => from + (rest.trailing_zeros() / 8) as usize,
            _ => 8,
        };
        let mut end = next(no_digits, 0);
        let mut is_as_printed = true;
        if bytes.get(end) == Some(&b'.') {
            let dot = end;
            end = next(no_digits, dot + 1);
            is_as_printed = end > dot + 1 && bytes[end - 1] != b'0';
        }
        if bytes.get(end) == Some(&b'%') {
            return is_as_printed.then_some(p + end + 1);
        }
        let unit_end = next(no_letters, end);
        if unit_end < 8 {
            let unit = &bytes[end..unit_end];
            return (is_as_printed && unit.last() != Some(&b'z') && unit != b"q")
                .then_some(p + unit_end);
        }
    }
    number_of_any_length(css, p)
}

fn number_of_any_length(css: &[u8], p: usize) -> Option<usize> {
    let p = skip_long(css, p, DIGIT);
    match byte(css, p) {
        b'.' => fraction(css, p),
        _ => unit(css, p),
    }
}

/// The rest of a number, from its `.` on.
fn fraction(css: &[u8], dot: usize) -> Option<usize> {
    let end = skip_long(css, dot + 1, DIGIT);
    if end == dot + 1 || css[end - 1] == b'0' {
        return None;
    }
    unit(css, end)
}

/// What follows the digits of a number.
fn unit(css: &[u8], start: usize) -> Option<usize> {
    if byte(css, start) == b'%' {
        return Some(start + 1);
    }
    let end = skip_long(css, start, LOWER);
    // `Q`, `Hz` and `kHz` have capitals.
    let is_as_printed = end == start || !(css[end - 1] == b'z' || &css[start..end] == b"q");
    is_as_printed.then_some(end)
}

/// True for the first byte of most terms, and for nothing that `Scanner::gap` looks at.
#[inline]
fn is_start_of_term(byte: u8) -> bool {
    class(byte) & (LOWER | UPPER | DIGIT | UNDERSCORE | DASH) != 0
        || matches!(byte, b'$' | b'@' | b'#' | b'"' | b'\'')
}

/// What's attached to the `}` of a `#{..}`, from `p` on. Returns its end. Dashes alone are an operator, a number is
/// printed like one, and `url` is a word of its own to `postcss`.
fn end_of_tail(css: &[u8], p: usize) -> Option<usize> {
    let end = skip_long(css, p, NAME);
    let first = skip(css, p, DASH);
    let is_name = first < end && !css[first].is_ascii_digit() && !starts_with_url(css, p);
    (end == p || is_name).then_some(end)
}

struct StringRead {
    /// After the closing quote.
    end: usize,
    /// It's like a word to all that looks at it. One that isn't can't have a neighbor.
    is_plain: bool,
    has_inner_quotes: bool,
    /// False if it can be narrower than it's long.
    is_ascii: bool,
}

/// The string that starts at `start`.
fn read_string(css: &[u8], start: usize) -> Option<StringRead> {
    let quote = css[start];
    let (mut is_plain, mut has_inner_quotes, mut is_ascii) = (true, false, true);
    let mut p = start + 1;
    loop {
        p = skip_long(css, p, PLAIN);
        let c = byte(css, p);
        if c == quote {
            break;
        }
        match c {
            // The other quote.
            b'"' | b'\'' => (has_inner_quotes, is_plain) = (true, false),
            // `\2014`
            b'\\' if byte(css, p + 1).is_ascii_alphanumeric() => is_plain = false,
            b'\\' | b'!' => return None,
            b'#' if byte(css, p + 1) == b'{' => return None,
            // `postcss-less` looks for `extend(..)` in all of a value's text.
            b'(' if p >= 6 && css[p - 6..p].eq_ignore_ascii_case(b"extend") => return None,
            // In the params of an at-rule of SCSS, the blanks between what follows a `$` and `...` move, wherever that is.
            b'$' => {
                let rest = &css[p..];
                let len = strings::index_of_char_usize(rest, quote).unwrap_or(rest.len());
                if strings::contains(&rest[..len], b"...") {
                    return None;
                }
                is_plain = false;
            }
            0x20..=0x7E => is_plain = false,
            0x80.. => (is_plain, is_ascii) = (false, false),
            _ => return None,
        }
        p += 1;
    }
    is_plain = is_plain
        && match css[start + 1..p] {
            [] => false,
            [only] => only.is_ascii_alphanumeric(),
            [first, last] => first.is_ascii_alphanumeric() && last.is_ascii_alphanumeric(),
            [first, .., last] => {
                last.is_ascii_alphanumeric() && !matches!(first, b' ' | b'-' | b'_')
            }
        };
    Some(StringRead {
        end: p + 1,
        is_plain,
        has_inner_quotes,
        is_ascii,
    })
}

/// Is a call of `name` printed in a way of its own?
fn is_special_call(name: &[u8], syntax: Syntax) -> bool {
    let special: &[&[u8]] = match name.len() {
        2 => &[b"or"],
        3 => &[b"url", b"not", b"and"],
        4 => &[b"type"],
        8 => &[b"selector"],
        _ => &[],
    };
    special.iter().any(|it| name.eq_ignore_ascii_case(it))
        || name.starts_with(b"$$")
        || (syntax == Syntax::Less
            && name.len() >= 6
            && name[name.len() - 6..].eq_ignore_ascii_case(b"extend"))
}

/// In a selector the digits of a color are numbers, so that `#31b0e0` loses its `e0`. `color` starts behind the `#`.
fn has_exponent(color: &[u8]) -> bool {
    // A number, its unit, the next number. After a letter at the start, all that follows is one word.
    let mut at = 0;
    loop {
        let digits_end = skip(color, at, DIGIT);
        if digits_end == at {
            return false;
        }
        if byte(color, digits_end) == b'e' && byte(color, digits_end + 1).is_ascii_digit() {
            return true;
        }
        at = skip(color, digits_end, LOWER);
    }
}

/// The call of a mixin of Less, `.name(words)`, is a selector to the printer. False if that shows in `call`, which has
/// been read as a value: its colors, and what the parser of selectors takes for a comment, with which it's printed as it's
/// written.
pub(super) fn is_mixin_call_printed_like_value(call: &[u8]) -> bool {
    let mut from = 0;
    while let Some(hash) = strings::index_of_char_pos(call, b'#', from) {
        from = hash + 1;
        if has_exponent(&call[from..]) {
            return false;
        }
    }
    !has_comment(call)
}

/// `a/b` outside of all parentheses, from its `/`. Returns its end.
fn end_of_name_behind_slash(css: &[u8], slash: usize, syntax: Syntax) -> Option<usize> {
    let name = slash + 1;
    let is_name =
        syntax == Syntax::Css && class(byte(css, name)) & LOWER != 0 && !starts_with_url(css, name);
    is_name.then(|| skip_long(css, name, NAME))
}

/// True for the words that are printed in lower case.
fn is_keyword_in_any_case(name: &[u8]) -> bool {
    const KEYWORDS: [&[u8]; 5] = [b"initial", b"inherit", b"unset", b"revert", b"revert-layer"];
    KEYWORDS.iter().any(|it| name.eq_ignore_ascii_case(it))
}

/// `url(..)` without quotes, from the `(`. Returns where the `)` is. All three tokenizers and the parser of values
/// take what's in it for one text.
fn end_of_unquoted_url(css: &[u8], paren: usize, is_inside: bool) -> Option<usize> {
    let mut p = paren + 1;
    loop {
        match byte(css, p) {
            b')' => return (p > paren + 1).then_some(p),
            // Between other parentheses, the parser of values takes this for a comment.
            b'/' if byte(css, p + 1) == b'/' && is_inside => return None,
            // It takes this for one everywhere.
            b'/' if byte(css, p + 1) == b'*' => return None,
            0..=0x20 | 0x7F.. => return None,
            b'"' | b'\'' | b'(' | b'\\' | b'$' | b'+' | b'{' | b'}' | b'@' | b'#' | b'!' => {
                return None;
            }
            _ => p += 1,
        }
    }
}

/// The name of a variable of SCSS, from behind its `$`. Returns its end.
fn end_of_variable(css: &[u8], p: usize) -> Option<usize> {
    if class(byte(css, p)) & (LOWER | UPPER | UNDERSCORE | DASH) == 0 || starts_with_url(css, p) {
        return None;
    }
    Some(skip_long(css, p, ANY_NAME))
}

/// `@name` or `@@name` of Less, from its `@`. Returns its end.
fn end_of_less_variable(css: &[u8], at: usize) -> Option<usize> {
    let name = at + 1 + usize::from(byte(css, at + 1) == b'@');
    if class(byte(css, name)) & (LOWER | UPPER | UNDERSCORE) == 0 {
        return None;
    }
    Some(skip_long(css, name, ANY_NAME))
}

/// `#{$name}` or `#{module.$name}` of SCSS with what's attached to it, any number of times, from the `#` at `p`. Returns
/// where that ends. It's a part of what `Scanner::interpolation` takes.
fn end_of_simple_interpolations(css: &[u8], mut p: usize) -> Option<usize> {
    while byte(css, p) == b'#' && byte(css, p + 1) == b'{' {
        p += 2;
        loop {
            while byte(css, p) == b'$' {
                p += 1;
            }
            if class(byte(css, p)) & (LOWER | UNDERSCORE | DASH) == 0 || starts_with_url(css, p) {
                return None;
            }
            p = skip_long(css, p, NAME);
            match byte(css, p) {
                b'.' | b'$' => p += 1,
                b'}' => break,
                _ => return None,
            }
        }
        p = end_of_tail(css, p + 1)?;
    }
    Some(p)
}

// ───────────────────────────── simple values ─────────────────────────────

/// What `read_simple_value` has found.
struct Simple {
    /// Where the `;` is, the blank before a `!` or a `{`, or a `,` outside of all parentheses at the end of the line.
    end: usize,
    /// No line can break in it.
    is_word: bool,
    /// It's one call and nothing else.
    is_call: bool,
    has_top_commas: bool,
    /// Where the first item of the list at the top ends.
    first_item_end: usize,
    /// Each item of the list at the top is one term.
    has_items_of_one_term: bool,
    /// `Layout::is_several_nodes` can't tell whether a term is one node, or says that it isn't: an item other than the
    /// first starts with a sign, or there's `@@a`, `~"a"` or `#{$a}`.
    has_unclear_term: bool,
    /// It has `12px/1.5` or `a/b`.
    has_tight_slash: bool,
    /// It has parentheses without a name before them.
    has_groups: bool,
    /// False if it can be narrower than it's long.
    is_ascii: bool,
    /// It ends with `as *`.
    ends_with_star: bool,
}

/// Reads a value on one line that's written as it's printed on one line: names, numbers, colors, variables, strings,
/// urls and calls, with one blank, an operator between blanks or a comma and a blank between them. Whatever this takes,
/// `Scanner::scan` takes too, finds nothing to change in it and nothing that makes it break if it fits. It's a shorter
/// way to the same end, for most values are like that. `is_inside`: it's an item between parentheses, which also ends
/// with its line.
fn read_simple_value(
    css: &[u8],
    start: usize,
    syntax: Syntax,
    quote: u8,
    owner: Owner,
    is_inside: bool,
) -> Option<Simple> {
    let mut p = start;
    let mut depth = 0;
    let (mut is_word, mut has_tight_slash) = (true, false);
    // The number of terms and of commas outside of all parentheses.
    let (mut top_terms, mut top_commas) = (0, 0);
    let mut has_unclear_term = false;
    let mut first_item_end = 0;
    let (mut has_groups, mut is_ascii, mut ends_with_star) = (false, true, false);
    let mut follows_blank = false;
    loop {
        // ───────────── a term
        top_terms += usize::from(depth == 0);
        let term_start = p;
        let sign = usize::from(byte(css, p) == b'-');
        let first = p + sign;
        let mut is_lonely_string = false;
        match byte(css, first) {
            b'a'..=b'z' | b'A'..=b'Z' | b'_' if starts_with_url(css, first) => {
                let paren = first + 3;
                if sign > 0
                    || matches!(owner, Owner::AtRule | Owner::MixinCall)
                    || css.get(first..paren + 1) != Some(b"url(")
                {
                    return None;
                }
                p = match byte(css, paren + 1) {
                    it @ (b'"' | b'\'') => {
                        let string = read_string(css, paren + 1)?;
                        is_ascii &= string.is_ascii;
                        if !(it == quote
                            || owner == Owner::CustomProperty
                            || string.has_inner_quotes)
                        {
                            return None;
                        }
                        string.end
                    }
                    _ => end_of_unquoted_url(css, paren, depth > 0 || is_inside)?,
                };
                if byte(css, p) != b')' {
                    return None;
                }
                p += 1;
            }
            b'a'..=b'z' | b'A'..=b'Z' | b'_' => {
                let term = p;
                let mut is_variable = false;
                p = skip_long(css, first, NAME);
                // (Not for a name with a sign.)
                let name_end = p + sign;
                let has_upper = class(byte(css, p)) & UPPER != 0;
                if has_upper {
                    if sign > 0 {
                        return None;
                    }
                    p = skip_long(css, p, ANY_NAME);
                }
                while sign == 0 && !has_upper && byte(css, p) == b'.' {
                    // `module.name`, `module.$name`
                    p += 1;
                    if byte(css, p) == b'$' {
                        p = end_of_variable(css, p + 1)?;
                        is_variable = true;
                        break;
                    }
                    if class(byte(css, p)) & (LOWER | UNDERSCORE) == 0 || starts_with_url(css, p) {
                        return None;
                    }
                    p = skip_long(css, p, NAME);
                }
                if byte(css, p) == b'(' && !is_variable {
                    if depth >= MAX_DEPTH || is_special_call(&css[term..p], syntax) {
                        return None;
                    }
                    (depth, is_word, p) = (depth + 1, false, p + 1);
                    if byte(css, p) != b')' {
                        follows_blank = false;
                        continue;
                    }
                } else if has_upper && is_keyword_in_any_case(&css[term..p]) {
                    return None;
                } else if byte(css, p) == b'/' && p == name_end && depth == 0 && !is_inside {
                    p = end_of_name_behind_slash(css, p, syntax)?;
                    has_tight_slash = true;
                }
            }
            // `--name`
            b'-' if sign > 0 => {
                let name = first + 1;
                let is_interpolation =
                    syntax == Syntax::Scss && css.get(name..name + 2) == Some(b"#{");
                if (class(byte(css, name)) & (LOWER | UNDERSCORE) == 0 && !is_interpolation)
                    || starts_with_url(css, name)
                {
                    return None;
                }
                p = skip_long(css, name, NAME);
            }
            b'0'..=b'9' => {
                p = number(css, first)?;
                if sign == 0
                    && depth == 0
                    && !is_inside
                    && byte(css, p) == b'/'
                    && byte(css, p + 1).is_ascii_digit()
                {
                    // `12px/1.5`
                    p = number(css, p + 1)?;
                    has_tight_slash = true;
                }
            }
            _ if sign > 0 => return None,
            b'+' if depth > 0
                && byte(css, p.wrapping_sub(1)) == b'('
                && byte(css, p + 1).is_ascii_digit() =>
            {
                p = number(css, p + 1)?;
            }
            b'#' if syntax == Syntax::Scss && byte(css, p + 1) == b'{' => {}
            b'#' => {
                p = skip_long(css, p + 1, LOWER | DIGIT);
                if p == first + 1 || (owner == Owner::MixinCall && has_exponent(&css[first + 1..p]))
                {
                    return None;
                }
            }
            // `@use "a" as *;`
            b'*' if owner == Owner::AtRule
                && syntax == Syntax::Scss
                && depth == 0
                && !is_inside
                && byte(css, p + 1) == b';'
                && css[..p].ends_with(b" as ") =>
            {
                ends_with_star = true;
                p += 1;
            }
            b'$' => p = end_of_variable(css, p + 1)?,
            b'@' if syntax == Syntax::Less => {
                has_unclear_term |= byte(css, p + 1) == b'@';
                p = end_of_less_variable(css, p)?;
            }
            it @ (b'"' | b'\'') => {
                let string = read_string(css, p)?;
                let keeps_quotes =
                    it == quote || owner == Owner::CustomProperty || string.has_inner_quotes;
                // (Behind an empty string, the parser of selectors takes what's in a string for a comment.)
                if !keeps_quotes
                    || (!string.is_plain && follows_blank)
                    || (owner == Owner::MixinCall && string.end == p + 2)
                {
                    return None;
                }
                is_ascii &= string.is_ascii;
                (p, is_lonely_string) = (string.end, !string.is_plain);
            }
            // `~"a"`
            b'~' if syntax == Syntax::Less && !follows_blank => {
                let it = byte(css, p + 1);
                if !matches!(it, b'"' | b'\'') {
                    return None;
                }
                let string = read_string(css, p + 1).filter(|it| it.is_ascii)?;
                if !(it == quote || owner == Owner::CustomProperty || string.has_inner_quotes)
                    || (owner == Owner::MixinCall && string.end == p + 3)
                {
                    return None;
                }
                has_unclear_term = true;
                (p, is_lonely_string) = (string.end, !string.is_plain);
            }
            // (Without a pair in it, it's no map.)
            b'(' => {
                if depth >= MAX_DEPTH || css[..p].trim_ascii_end().ends_with(b"with") {
                    return None;
                }
                (depth, is_word, has_groups, p) = (depth + 1, false, true, p + 1);
                if byte(css, p) != b')' {
                    follows_blank = false;
                    continue;
                }
            }
            _ => return None,
        }

        // ───────────── after a term
        loop {
            match byte(css, p) {
                b')' if depth > 0 => {
                    (depth, p) = (depth - 1, p + 1);
                    is_lonely_string = false;
                    continue;
                }
                // More of the same word. See `Scanner::scan`.
                b'#' if syntax == Syntax::Scss && byte(css, p + 1) == b'{' => {
                    let word = &css[term_start..p];
                    let is_attachable = match word.first() {
                        None => true,
                        Some(b'a'..=b'z' | b'_' | b'-' | b'$') => !word
                            .iter()
                            .any(|it| it.is_ascii_uppercase() || matches!(it, b'.' | b')')),
                        Some(_) => false,
                    };
                    if !is_attachable {
                        return None;
                    }
                    p = end_of_simple_interpolations(css, p)?;
                    has_unclear_term = true;
                    continue;
                }
                b',' if byte(css, p + 1) == b' ' => {
                    if depth == 0 {
                        if top_commas == 0 {
                            first_item_end = p;
                        }
                        top_commas += 1;
                        has_unclear_term |= byte(css, p + 2) == b'-';
                    }
                    (p, is_word, follows_blank) = (p + 2, false, false);
                    break;
                }
                b';' if depth == 0 => {}
                b',' if depth == 0 && byte(css, p + 1) == b'\n' => {}
                b'\n' if depth == 0 && is_inside => {}
                b' ' if depth == 0 && matches!(byte(css, p + 1), b'!' | b'{') => {}
                b' ' if !is_lonely_string => {
                    let is_operator = matches!(byte(css, p + 1), b'+' | b'-' | b'*' | b'/')
                        && byte(css, p + 2) == b' ';
                    p += if is_operator { 3 } else { 1 };
                    (is_word, follows_blank) = (false, true);
                    break;
                }
                _ => return None,
            }
            if has_tight_slash && top_commas > 0 {
                return None;
            }
            return Some(Simple {
                end: p,
                is_word,
                is_call: top_terms == 1 && css[p - 1] == b')',
                has_top_commas: top_commas > 0,
                first_item_end: if top_commas > 0 { first_item_end } else { p },
                has_items_of_one_term: top_terms == top_commas + 1,
                has_unclear_term,
                has_tight_slash,
                has_groups,
                is_ascii,
                ends_with_star,
            });
        }
    }
}

/// The params of an at-rule of SCSS from `start` on, if they're a simple value. Returns where they end, and whether that's
/// with `as *`.
pub(super) fn end_of_simple_value(
    css: &[u8],
    start: usize,
    syntax: Syntax,
    quote: u8,
) -> Option<(usize, bool)> {
    let simple = read_simple_value(css, start, syntax, quote, Owner::AtRule, false)?;
    (!simple.has_groups).then_some((simple.end, simple.ends_with_star))
}

/// What follows the value of a declaration, which ends at `end`: its length, through the `;`. `is_variable`: it's a
/// `$variable`.
fn tail_len(css: &[u8], end: usize, is_variable: bool) -> Option<usize> {
    let rest = css.get(end..)?;
    if rest.first() == Some(&b';') {
        Some(1)
    } else if rest.starts_with(b" !important;") {
        Some(12)
    } else if rest.starts_with(b" !default;") && is_variable {
        Some(10)
    } else if rest.starts_with(b" !global;") && is_variable {
        Some(9)
    } else {
        None
    }
}

/// See `Parser::read_value`.
fn ends_with_important(css: &[u8], start: usize, end: usize) -> bool {
    end - start >= 9 && css[end - 9..end].eq_ignore_ascii_case(b"important")
}

/// The value of a declaration `level` blocks deep, whose name starts at `start` and whose colon is at the end of its
/// line, if it's a list of simple values that's written as `Layout::write_list` writes it: an item on each line if one
/// of them is several nodes, else as many on each line as fit, where they don't fit behind the colon. Returns where the
/// declaration ends. The list of a custom property, which `layout.rs` isn't asked about, is never written the first way.
fn end_of_standing_list(
    css: &[u8],
    (start, colon): (usize, usize),
    syntax: Syntax,
    quote: u8,
    owner: Owner,
    page: Page,
    level: usize,
) -> Option<usize> {
    let is_custom = owner == Owner::CustomProperty;
    if css[start..colon].starts_with(b"grid") {
        return None;
    }
    let indentation = page.indentation_len(level + 1);
    let room = page.width.checked_sub((level + 1) * page.tab_width)?;
    // An item is several nodes. The list is written like one with such an item, and like one without.
    let (mut has_several, mut is_on_lines, mut is_filled) = (false, true, true);
    // How long the value is on one line, and how long the line before this one is.
    let (mut flat_len, mut previous_len) = (0, 0);
    let mut line_break = colon + 1;
    loop {
        let line = line_break + 1 + indentation;
        if !page.is_line_break(css.get(line_break..line)?, level + 1) {
            return None;
        }
        let is_first = line_break == colon + 1;
        let simple = read_simple_value(css, line, syntax, quote, owner, false)?;
        // A sign is a node of its own in most places.
        if simple.has_tight_slash
            || simple.has_groups
            || !simple.is_ascii
            || (simple.has_items_of_one_term
                && !is_custom
                && (simple.has_unclear_term || (css[line] == b'-' && !is_first)))
        {
            return None;
        }
        let is_last = css[simple.end] != b',';
        let tail = match is_last {
            true => tail_len(css, simple.end, css[start] == b'$')?,
            false => 1,
        };
        let len = simple.end - line;
        let comma = usize::from(!is_last);
        let first_item_len =
            simple.first_item_end - line + usize::from(!is_last || simple.has_top_commas);
        has_several |= !simple.has_items_of_one_term && !is_custom;
        is_on_lines &= !simple.has_top_commas && len + tail <= room;
        // A `fill` doesn't look at what follows it.
        is_filled &= (simple.has_items_of_one_term || is_custom)
            && len + comma <= room
            && (is_first || previous_len + 1 + first_item_len > room);
        flat_len += usize::from(!is_first) + len + comma;
        previous_len = len + comma;
        if is_last {
            let is_list = !is_first || simple.has_top_commas;
            let fits = level * page.tab_width + (colon + 2 - start) + flat_len + tail <= page.width;
            let is_as_printed = match has_several {
                true => is_on_lines,
                false => is_filled && !fits,
            };
            let is_taken = is_list && is_as_printed && !ends_with_important(css, line, simple.end);
            return is_taken.then_some(simple.end + tail);
        }
        line_break = simple.end + 1;
    }
}

/// The value of a statement that starts at `start`, `level` blocks deep, from `value` on, if it's the call of a function
/// with a simple argument on each line, written as `Layout::write_group` writes one that doesn't fit on a line. Returns
/// where its `)` is, and how long the statement is on one line up to there.
pub(super) fn end_of_standing_call(
    css: &[u8],
    (start, value): (usize, usize),
    syntax: Syntax,
    quote: u8,
    owner: Owner,
    page: Page,
    level: usize,
) -> Option<(usize, usize)> {
    // `name(`, `module.name(`
    let mut paren = value;
    loop {
        if class(byte(css, paren)) & (LOWER | UNDERSCORE) == 0 || starts_with_url(css, paren) {
            return None;
        }
        paren = skip_long(css, paren, NAME);
        if byte(css, paren) != b'.' {
            break;
        }
        paren += 1;
    }
    if css.get(paren..paren + 2) != Some(b"(\n") || is_special_call(&css[value..paren], syntax) {
        return None;
    }
    let indentation = page.indentation_len(level + 1);
    let room = page.width.checked_sub((level + 1) * page.tab_width)?;
    let mut flat_len = paren + 1 - start;
    let mut line_break = paren + 1;
    loop {
        let line = line_break + 1 + indentation;
        if !page.is_line_break(css.get(line_break..line)?, level + 1) {
            return None;
        }
        let simple = read_simple_value(css, line, syntax, quote, owner, true)?;
        let is_last = match css[simple.end] {
            b',' => false,
            b'\n' => true,
            _ => return None,
        };
        let len = simple.end - line;
        if simple.has_top_commas
            || simple.has_groups
            || !simple.is_ascii
            || len + usize::from(!is_last) > room
        {
            return None;
        }
        flat_len += len;
        if is_last {
            let close = simple.end + 1 + page.indentation_len(level);
            let is_closed =
                page.is_line_break(css.get(simple.end..close)?, level) && byte(css, close) == b')';
            return is_closed.then_some((close, flat_len + 1));
        }
        flat_len += 2;
        line_break = simple.end + 1;
    }
}

/// A statement from `start` on that's written as it's printed: a declaration, or a variable or the call of a mixin of
/// Less, with a simple value. Returns where it ends, and its shape. The third value is true for the definition of a mixin
/// of Less, which ends where ` {` follows. `is_in_declaration`: one of the blocks around it is that of a declaration.
/// `lists`: the page and the number of blocks around it, or `None` where `layout.rs` isn't asked. This is no more than a
/// shorter way to what `Parser::read_declaration` and the like find.
pub(super) fn end_of_simple_statement(
    css: &[u8],
    start: usize,
    syntax: Syntax,
    quote: u8,
    is_in_declaration: bool,
    lists: Option<(Page, usize)>,
) -> Option<(usize, Shape, bool)> {
    let first = byte(css, start);
    if first == b'@' {
        if is_in_declaration {
            return None;
        }
        let colon = skip_long(css, start + 1, ANY_NAME);
        if syntax != Syntax::Less
            || colon == start + 1
            || css.get(colon..colon + 2) != Some(b": ")
            || is_asked_for_by_name(&css[start + 1..colon])
        {
            return None;
        }
        let simple = read_simple_value(css, colon + 2, syntax, quote, Owner::AtRule, false)?;
        // A list can have an item on each line.
        let is_taken = css[simple.end] == b';' && !simple.has_top_commas && !simple.has_groups;
        return is_taken.then_some((simple.end + 1, Shape::Line, false));
    }
    if first == b'.' {
        // `.name;`, `.name(words);`
        let name = skip(css, start + 1, DASH);
        if syntax != Syntax::Less
            || class(byte(css, name)) & (LOWER | UNDERSCORE) == 0
            || starts_with_url(css, name)
        {
            return None;
        }
        let end = skip_long(css, name, NAME);
        return match byte(css, end) {
            _ if is_asked_for_by_name(&css[start + 1..end]) => None,
            b';' => Some((end + 1, Shape::Word, false)),
            b'(' => {
                let simple =
                    read_simple_value(css, start + 1, syntax, quote, Owner::MixinCall, false)?;
                match css[simple.end] {
                    _ if !simple.is_call || simple.has_groups || !simple.is_ascii => None,
                    b';' => Some((simple.end + 1, Shape::Word, false)),
                    // `.name(words) {`: a rule.
                    b' ' if byte(css, simple.end + 1) == b'{' => {
                        Some((simple.end, Shape::Word, true))
                    }
                    _ => None,
                }
            }
            _ => None,
        };
    }

    // ───────────── a declaration
    let (name, owner) = match (first, byte(css, start + 1)) {
        (b'$', next) if syntax == Syntax::Scss && !next.is_ascii_digit() => {
            (start + 1, Owner::Declaration)
        }
        (b'-', b'-') => (start + 2, Owner::CustomProperty),
        (b'-', _) => (start + 1, Owner::Declaration),
        (b'a'..=b'z', _) => (start, Owner::Declaration),
        _ => return None,
    };
    let colon = match first {
        b'$' => skip_long(css, name, ANY_NAME),
        _ => skip_long(css, name, NAME),
    };
    if colon == name
        || (first != b'$' && class(css[name]) & LOWER == 0)
        || starts_with_url(css, name)
        || byte(css, colon) != b':'
        || &css[start..colon] == b"composes"
    {
        return None;
    }
    match byte(css, colon + 1) {
        b' ' => {}
        b'\n' => {
            let (page, level) = lists?;
            let names = (start, colon);
            let end = end_of_standing_list(css, names, syntax, quote, owner, page, level)?;
            return Some((end, Shape::Lines, false));
        }
        _ => return None,
    }
    let value = colon + 2;
    let Some(simple) = read_simple_value(css, value, syntax, quote, owner, false) else {
        let (page, level) = lists.filter(|_| owner == Owner::Declaration)?;
        if css[start..colon].starts_with(b"grid") {
            return None;
        }
        let places = (start, value);
        let (close, flat_len) =
            end_of_standing_call(css, places, syntax, quote, owner, page, level)?;
        let tail = tail_len(css, close + 1, first == b'$')?;
        let fits = level * page.tab_width + flat_len + tail <= page.width;
        return (!fits).then_some((close + 1 + tail, Shape::Lines, false));
    };
    let tail = tail_len(css, simple.end, first == b'$')?;
    // A list with an item of several nodes has an item on each line. Where there's a list or parentheses without a name,
    // `layout.rs` is asked.
    if (simple.has_top_commas && owner == Owner::Declaration) || simple.has_groups {
        let is_flat =
            !simple.has_top_commas || (simple.has_items_of_one_term && !simple.has_unclear_term);
        if !is_flat
            || lists.is_none()
            || css[start..colon].starts_with(b"grid")
            || (simple.has_groups
                && (simple.has_top_commas || simple.has_tight_slash || owner != Owner::Declaration))
        {
            return None;
        }
    }
    if ends_with_important(css, value, simple.end) {
        return None;
    }
    let shape = match simple.is_word && tail == 1 {
        true => Shape::Word,
        false => Shape::Line,
    };
    Some((simple.end + tail, shape, false))
}

impl Scanner<'_> {
    fn depth(&self) -> usize {
        self.values.opens.len()
    }

    /// Where the byte at `p` of the source is going to be in the flat text.
    fn position(&self, p: usize) -> u32 {
        (self.values.flat.len() + (p - self.segment)) as u32
    }

    /// The flat text goes on with the source up to `to`, and then with what's from `next` on.
    fn cut(&mut self, to: usize, next: usize) {
        let part = self.css.get(self.segment..to).unwrap_or_default();
        self.values.flat.extend_from_slice(part);
        self.values.is_as_written = false;
        self.segment = next;
    }

    fn record(&mut self, kind: Kind, flags: u8, at: u32, link: u32) {
        self.values.records.push(Record {
            kind,
            flags,
            at,
            link,
        });
    }

    fn mark_complex(&mut self) {
        self.values.has_complex = true;
        let Values { opens, records, .. } = &mut *self.values;
        for open in opens {
            if let Some(record) = records.get_mut(open.record as usize) {
                record.flags |= COMPLEX;
            }
        }
    }

    /// `p` is where the `(` is.
    fn open(&mut self, p: usize, flags: u8) -> Option<()> {
        if self.depth() >= MAX_DEPTH {
            return None;
        }
        self.values.opens.push(Open {
            record: self.values.records.len() as u32,
            paren: p as u32,
            commas: 0,
        });
        let at = self.position(p);
        self.record(Kind::Open, flags, at, 0);
        Some(())
    }

    /// `p` is where the `)` is.
    fn close(&mut self, p: usize) -> Option<()> {
        let open = self.values.opens.pop()?;
        let at = self.position(p);
        let close = self.values.records.len() as u32;
        let record = self.values.records.get_mut(open.record as usize)?;
        record.link = close;
        let count = match at == record.at + 1 {
            true => 0,
            false => open.commas + 1,
        };
        self.record(Kind::Close, 0, at, count);
        Some(())
    }

    /// Takes back the comma that was read last, because the `)` follows it. It's printed or not whether it's there or
    /// not, except in `var(--a,)`.
    fn drop_comma(&mut self) -> Option<()> {
        let open = self.values.opens.last_mut()?;
        let paren = open.paren as usize;
        if paren >= 3 && self.css[paren - 3..paren].eq_ignore_ascii_case(b"var") {
            return None;
        }
        open.commas = open.commas.checked_sub(1)?;
        let last = self.values.records.pop()?;
        (last.kind == Kind::Comma).then_some(())
    }

    /// A string that's printed as it's written, except for its quotes, from the quote at `start`. Returns its end, and
    /// whether it can have a neighbor: many rules about the blank between two nodes look at a node's text whatever kind
    /// of node it is.
    fn string(&mut self, start: usize) -> Option<(usize, bool)> {
        // All that's measured here is measured in bytes.
        let string = read_string(self.css, start).filter(|it| it.is_ascii)?;
        // With the quote that's asked for in it, it keeps the other one.
        let keeps_quotes = self.css[start] == self.quote
            || self.owner == Owner::CustomProperty
            || string.has_inner_quotes;
        self.has_inner_quotes |= string.has_inner_quotes;
        self.has_other_quotes |= !keeps_quotes;
        Some((string.end, string.is_plain))
    }

    /// `#{..}` of SCSS, from its `#`. Returns where to go on: after the `}`, or after the `(` of `#{name(`, and then
    /// the second value is true.
    fn interpolation(&mut self, hash: usize) -> Option<(usize, bool)> {
        let css = self.css;
        let mut p = hash + 2;
        if let quote @ (b'"' | b'\'') = byte(css, p) {
            // `#{"/"}`
            let from = p + 1;
            p = from;
            while matches!(byte(css, p), b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b' ' | b'/' | b'_' | b'.' | b',' | b':' | b'-')
            {
                p += 1;
            }
            if byte(css, p) != quote || p == from || byte(css, p + 1) != b'}' {
                return None;
            }
            if quote != self.quote {
                self.has_other_quotes = true;
            }
            return Some((p + 2, false));
        }
        loop {
            // The start of a name.
            while byte(css, p) == b'$' {
                p += 1;
            }
            let c = byte(css, p);
            if !(class(c) & (LOWER | UNDERSCORE | DASH) != 0) || starts_with_url(css, p) {
                return None;
            }
            p = skip_long(css, p, NAME);
            match byte(css, p) {
                b'.' | b'$' => p += 1,
                b'}' => return Some((p + 1, false)),
                c => {
                    if class(c) & UPPER != 0 {
                        p = skip_long(css, p, ANY_NAME);
                    }
                    if byte(css, p) != b'(' || self.interpolation.is_some() {
                        return None;
                    }
                    self.end_of_interpolation(hash)?;
                    self.call(hash + 2, p)?;
                    self.interpolation = Some(self.depth() - 1);
                    return Some((p + 1, true));
                }
            }
        }
    }

    /// Makes sure that `postcss-scss` finds the end of the `#{` at `hash` where it seems to be.
    fn end_of_interpolation(&self, hash: usize) -> Option<usize> {
        let css = self.css;
        let (mut deep, mut parens, mut quote) = (1, 0, 0u8);
        let mut p = hash + 2;
        while let Some(&c) = css.get(p) {
            if quote != 0 {
                match c {
                    b'\\' | b'!' => return None,
                    _ if c == quote => quote = 0,
                    _ => {}
                }
            } else {
                match c {
                    b'"' | b'\'' => quote = c,
                    b'}' => {
                        deep -= 1;
                        if deep == 0 {
                            return (parens == 0).then_some(p);
                        }
                    }
                    b'#' if byte(css, p + 1) == b'{' => deep += 1,
                    b'(' => parens += 1,
                    b')' => {
                        if parens == 0 {
                            return None;
                        }
                        parens -= 1;
                    }
                    // `!default` is looked for in all of a value's text.
                    b'\\' | b'/' | b'!' | 0..=0x1F => return None,
                    _ => {}
                }
            }
            p += 1;
        }
        None
    }

    /// The `(` at `p` follows a name that starts at `start`.
    fn call(&mut self, start: usize, p: usize) -> Option<()> {
        if is_special_call(&self.css[start..p], self.syntax) {
            return None;
        }
        self.open(p, CALL)
    }

    /// Blanks, line breaks and `//` comments from `from` on, after something that `place` follows. Returns where to go
    /// on, and false if what's there isn't a term but what can follow one.
    fn gap(&mut self, from: usize, place: Place) -> Option<(usize, bool)> {
        let css = self.css;
        let is_inside = self.depth() > 0;
        // Most of the time: a line break and the indentation.
        let mut lines = u32::from(byte(css, from) == b'\n');
        let mut q = skip_long(css, from + lines as usize, INDENTATION);
        while class(byte(css, q)) & BLANK != 0 {
            lines += u32::from(css[q] == b'\n');
            q += 1;
        }
        self.values.has_line_breaks |= lines > 0;
        if lines > 1 && place == Place::AfterComma && is_inside {
            self.values.records.last_mut()?.flags |= EMPTY_LINE;
            self.mark_complex();
        }
        let mut has_comments = false;
        if byte(css, q) == b'/' && (lines > 0 || byte(css, q + 1) == b'/') {
            if self.syntax != Syntax::Scss || !is_inside || place == Place::First || q == from {
                return None;
            }
            has_comments = true;
            if place == Place::Next {
                // One comment between the last item and the `)` belongs to that item.
                if byte(css, q + 1) != b'/' || lines > 1 {
                    return None;
                }
                let end = end_of_line_comment(css, q + 2);
                let after = skip(css, end + 1, BLANK & !super::NEWLINE);
                if byte(css, end) != b'\n'
                    || byte(css, after) != b')'
                    || may_end_with_white_space(&css[q..end])
                {
                    return None;
                }
                self.cut(from, after);
                self.record(Kind::Comment, 0, q as u32, end as u32);
                self.values.has_comments = true;
                self.values.has_line_breaks = true;
                self.mark_complex();
                return Some((after, false));
            }
        }
        if place == Place::AfterComma && byte(css, q) == b')' && is_inside {
            self.drop_comma()?;
            self.cut(from - 1, q);
            return Some((q, false));
        }
        if has_comments {
            loop {
                if byte(css, q + 1) != b'/' {
                    return None;
                }
                let end = end_of_line_comment(css, q + 2);
                if byte(css, end) != b'\n' || may_end_with_white_space(&css[q..end]) {
                    return None;
                }
                self.record(Kind::Comment, 0, q as u32, end as u32);
                q = skip(css, end + 1, BLANK & !super::NEWLINE);
                if byte(css, q) != b'/' {
                    break;
                }
            }
            if matches!(byte(css, q), b'\n' | b')' | 0) {
                return None;
            }
            self.values.has_comments = true;
            self.values.has_line_breaks = true;
            self.mark_complex();
        }
        let next = byte(css, q);
        let is_end = match place {
            Place::Open => {
                if q > from {
                    self.cut(from, q);
                }
                return Some((q, true));
            }
            Place::Next => match next {
                b')' if is_inside => true,
                b'!' if !is_inside => byte(css, q + 1) != b'=',
                b'{' | b'}' if !is_inside => true,
                _ => false,
            },
            Place::First | Place::AfterOperator | Place::AfterComma => false,
        };
        if is_end {
            // Outside of all parentheses, the value ends before the blanks.
            if is_inside {
                self.cut(from, q);
            }
            return Some((q, false));
        }
        if !(q == from + 1 && css[from] == b' ') {
            self.cut(from, q);
            self.values.flat.push(b' ');
        }
        Some((q, true))
    }

    /// Reads the value from `start`. Returns where it ends.
    fn scan(&mut self, start: usize) -> Option<usize> {
        let css = self.css;
        let is_scss = self.syntax == Syntax::Scss;
        let is_less = self.syntax == Syntax::Less;
        let mut p = start;
        let mut place = Place::First;
        // The term before the blank is a string that can't have a neighbor.
        let mut is_after_lonely_string = false;
        // Where the first blank of the value is, once that has been asked.
        let mut first_word_end = None;
        loop {
            // ───────────── a term
            let is_inside = self.depth() > 0;
            let is_item_start = is_inside && matches!(place, Place::Open | Place::AfterComma);
            // The term can be the key of a pair.
            let mut is_key = false;
            // `...` can follow.
            let mut takes_dots = false;
            let mut is_lonely_string = false;
            if place == Place::Open && class(byte(css, p)) & BLANK != 0 {
                p = self.gap(p, Place::Open)?.0;
            }
            let term = p;
            let c = byte(css, p);
            if is_after_lonely_string {
                return None;
            }
            match c {
                b'a'..=b'z' | b'A'..=b'Z' | b'_' => {
                    let mut has_upper = false;
                    let mut segments = 1;
                    loop {
                        if starts_with_url(css, p) {
                            let paren = p + 3;
                            if segments > 1
                                || &css[p..paren] != b"url"
                                || byte(css, paren) != b'('
                                || self.owner == Owner::AtRule
                            {
                                return None;
                            }
                            break;
                        }
                        p = skip_long(css, p, NAME);
                        if class(byte(css, p)) & UPPER != 0 {
                            has_upper = true;
                            p = skip_long(css, p, ANY_NAME);
                            break;
                        }
                        if byte(css, p) != b'.' {
                            break;
                        }
                        segments += 1;
                        p += 1;
                        match byte(css, p) {
                            b'a'..=b'z' | b'A'..=b'Z' | b'_' => {}
                            b'$' => break,
                            _ => return None,
                        }
                    }
                    if p == term {
                        // `url(..)`: no line can break in it, so it's a word like any other.
                        let paren = p + 3;
                        p = match byte(css, paren + 1) {
                            b'"' | b'\'' => self.string(paren + 1)?.0,
                            _ => end_of_unquoted_url(css, paren, is_inside)?,
                        };
                        if byte(css, p) != b')' {
                            return None;
                        }
                        p += 1;
                    } else if byte(css, p) == b'$' {
                        p = end_of_variable(css, p + 1)?;
                    } else if byte(css, p) == b'(' {
                        self.call(term, p)?;
                        (p, place) = (p + 1, Place::Open);
                        continue;
                    } else if has_upper {
                        if is_keyword_in_any_case(&css[term..p]) {
                            return None;
                        }
                        is_key = segments == 1;
                    } else if byte(css, p) == b'/' && segments == 1 && !is_inside {
                        p = end_of_name_behind_slash(css, p, self.syntax)?;
                        self.values.has_tight_slash = true;
                    } else if byte(css, p) == b'*'
                        && css[p - 1] == b'-'
                        && self.owner == Owner::AtRule
                        && is_scss
                        && !is_inside
                        && css[..term].ends_with(b" as ")
                    {
                        // `@forward "a" as b-*`
                        self.values.has_wildcard = true;
                        p += 1;
                    } else {
                        is_key = segments == 1;
                    }
                }
                b'0'..=b'9' => {
                    p = number(css, p)?;
                    is_key = css[term..p].iter().all(u8::is_ascii_digit);
                    if byte(css, p) == b'/' && !is_inside && byte(css, p + 1).is_ascii_digit() {
                        // `12px/1.5`
                        p = number(css, p + 1)?;
                        self.values.has_tight_slash = true;
                        is_key = false;
                    }
                }
                b'.' if byte(css, p + 1).is_ascii_digit()
                    && self.owner != Owner::CustomProperty =>
                {
                    // The zero is missing.
                    self.cut(p, p);
                    self.values.flat.push(b'0');
                    p = fraction(css, p)?;
                }
                b'-' => {
                    p += 1;
                    match byte(css, p) {
                        b' ' | b'\n' if place == Place::Next => {
                            // An operator.
                            let (next, is_term) = self.gap(p, Place::First)?;
                            if !is_term {
                                return None;
                            }
                            (p, place) = (next, Place::AfterOperator);
                            continue;
                        }
                        b'0'..=b'9' => {
                            p = number(css, p)?;
                            // (The first key of a map can't have a sign.)
                            is_key = place == Place::AfterComma
                                && css[term + 1..p].iter().all(u8::is_ascii_digit);
                        }
                        b'.' if byte(css, p + 1).is_ascii_digit()
                            && self.owner != Owner::CustomProperty =>
                        {
                            self.cut(p, p);
                            self.values.flat.push(b'0');
                            p = fraction(css, p)?;
                        }
                        b'#' if is_scss && byte(css, p + 1) == b'{' => {}
                        b'@' if is_less => p = end_of_less_variable(css, p)?,
                        first => {
                            match first {
                                b'$' => {
                                    p += 1;
                                    if class(byte(css, p)) & (LOWER | UNDERSCORE | DASH) == 0 {
                                        return None;
                                    }
                                }
                                b'-' => {
                                    p += 1;
                                    let c = byte(css, p);
                                    if !(class(c) & (LOWER | UNDERSCORE) != 0
                                        || (is_scss && c == b'#' && byte(css, p + 1) == b'{'))
                                    {
                                        return None;
                                    }
                                }
                                b'a'..=b'z' | b'_' => {}
                                _ => return None,
                            }
                            if starts_with_url(css, p) {
                                return None;
                            }
                            p = skip_long(css, p, NAME);
                            if byte(css, p) == b'(' {
                                // Where `--a()` ends isn't where a call ends: see `Layout::keeps_empty_line`.
                                if first == b'-' {
                                    return None;
                                }
                                self.call(term, p)?;
                                (p, place) = (p + 1, Place::Open);
                                continue;
                            }
                        }
                    }
                }
                b'#' if is_scss && byte(css, p + 1) == b'{' => {}
                b'#' => {
                    p = skip(css, p + 1, LOWER | DIGIT);
                    if p == term + 1 {
                        return None;
                    }
                }
                b'$' => {
                    p = end_of_variable(css, p + 1)?;
                    is_key = true;
                    takes_dots = true;
                }
                b'@' if is_less => p = end_of_less_variable(css, p)?,
                b'~' if is_less
                    && byte(css, p + 1) == b'`'
                    && self.owner == Owner::AtRule
                    && is_inside =>
                {
                    // "~`name(..) `": to the parser of values, the call of a function and a word.
                    p = skip_long(css, p + 2, ANY_NAME);
                    if p == term + 2 || byte(css, p) != b'(' {
                        return None;
                    }
                    self.open(p, CALL)?;
                    (p, place) = (p + 1, Place::Open);
                    continue;
                }
                b'`' if is_less
                    && place == Place::Next
                    && self.owner == Owner::AtRule
                    && is_inside =>
                {
                    p += 1;
                }
                b'~' if is_less && place != Place::Next => {
                    if !matches!(byte(css, p + 1), b'"' | b'\'') {
                        return None;
                    }
                    let (end, is_plain) = self.string(p + 1)?;
                    if !is_plain && place == Place::AfterOperator {
                        return None;
                    }
                    (p, is_lonely_string) = (end, !is_plain);
                }
                b'"' | b'\'' => {
                    let (end, is_plain) = self.string(p)?;
                    if !is_plain && matches!(place, Place::Next | Place::AfterOperator) {
                        return None;
                    }
                    (p, is_lonely_string, is_key) = (end, !is_plain, true);
                }
                b'(' => {
                    let before = css[..p].trim_ascii_end();
                    // In the params of an at-rule of SCSS, the blanks between the first word and a `(` move. A word is
                    // all that's up to a blank there: `a,b`.
                    if !is_inside && p > start && self.owner == Owner::AtRule && is_scss {
                        let first_word_end = *first_word_end.get_or_insert_with(|| {
                            let rest = &css[start..p];
                            start
                                + rest
                                    .iter()
                                    .position(u8::is_ascii_whitespace)
                                    .unwrap_or(rest.len())
                        });
                        if first_word_end >= before.len() {
                            return None;
                        }
                    }
                    // `with (..)` is broken whatever is in it.
                    if before.ends_with(b"with") {
                        return None;
                    }
                    self.open(p, 0)?;
                    self.mark_complex();
                    (p, place) = (p + 1, Place::Open);
                    continue;
                }
                b')' if place == Place::Open => {}
                b'*' if place == Place::Next
                    && !is_inside
                    && self.owner == Owner::AtRule
                    && is_scss
                    && byte(css, p + 1) == b';'
                    && css[..p].ends_with(b" as ") =>
                {
                    // `@use "a" as *;`
                    self.values.ends_with_star = true;
                    p += 1;
                }
                b'+' if place == Place::Open
                    && byte(css, p.wrapping_sub(1)) == b'('
                    && byte(css, p + 1).is_ascii_digit() =>
                {
                    // Right behind the `(`, it's the sign of the number.
                    p = number(css, p + 1)?;
                }
                b'+' | b'/' | b'*' if place == Place::Next => {
                    if class(byte(css, p + 1)) & BLANK == 0 || (c == b'*' && css[p + 1] != b' ') {
                        return None;
                    }
                    let (next, is_term) = self.gap(p + 1, Place::First)?;
                    if !is_term {
                        return None;
                    }
                    (p, place) = (next, Place::AfterOperator);
                    continue;
                }
                b'=' | b'!' | b'<' | b'>' if is_scss && place == Place::Next => {
                    // `==`, `!=`, `<`, `>`, `<=`, `>=` are words to the parser.
                    p += 1;
                    match (c, byte(css, p)) {
                        (_, b'=') => p += 1,
                        (b'<' | b'>', _) => {}
                        _ => return None,
                    }
                    if class(byte(css, p)) & BLANK == 0 {
                        return None;
                    }
                }
                _ => return None,
            }

            // ───────────── more of the same word: `#{..}` and what's attached to it
            if is_scss && byte(css, p) == b'#' && byte(css, p + 1) == b'{' {
                // Not after a number, a color, a string, a name with capitals or `url(..)`.
                let is_attachable = p == term
                    || (matches!(c, b'a'..=b'z' | b'_' | b'-' | b'$')
                        && !css[term..p]
                            .iter()
                            .any(|it| it.is_ascii_uppercase() || matches!(it, b'.' | b')')));
                if !is_attachable {
                    return None;
                }
                (is_key, takes_dots) = (false, false);
                let mut is_call = false;
                while byte(css, p) == b'#' && byte(css, p + 1) == b'{' {
                    let (next, opened) = self.interpolation(p)?;
                    p = next;
                    if opened {
                        is_call = true;
                        break;
                    }
                    p = end_of_tail(css, p)?;
                }
                if is_call {
                    place = Place::Open;
                    continue;
                }
            }

            // ───────────── after a term
            loop {
                let is_inside = self.depth() > 0;
                match byte(css, p) {
                    b')' if is_inside => {
                        self.close(p)?;
                        p += 1;
                        (is_key, is_lonely_string) = (false, false);
                        takes_dots = is_scss;
                        if self.interpolation == Some(self.depth()) {
                            self.interpolation = None;
                            if byte(css, p) != b'}' {
                                return None;
                            }
                            p = end_of_tail(css, p + 1)?;
                            takes_dots = false;
                            while byte(css, p) == b'#' && byte(css, p + 1) == b'{' {
                                let (next, opened) = self.interpolation(p)?;
                                if opened {
                                    return None;
                                }
                                p = end_of_tail(css, next)?;
                            }
                        }
                    }
                    b'.' if takes_dots && is_inside && is_scss => {
                        // `$rest...)`
                        if css.get(p..p + 3) != Some(b"...") {
                            return None;
                        }
                        p += 3;
                        if class(byte(css, p)) & BLANK != 0 {
                            let (next, _) = self.gap(p, Place::Open)?;
                            p = next;
                        }
                        if byte(css, p) != b')' {
                            return None;
                        }
                        (is_key, takes_dots) = (false, false);
                    }
                    b',' => {
                        let at = self.position(p);
                        self.record(Kind::Comma, 0, at, 0);
                        match self.values.opens.last_mut() {
                            Some(open) => open.commas += 1,
                            None => self.values.top_commas += 1,
                        }
                        p += 1;
                        match byte(css, p) {
                            b')' if is_inside => {
                                self.drop_comma()?;
                                self.cut(p - 1, p);
                                continue;
                            }
                            // Nearly always, one blank follows, and a term.
                            b' ' if is_start_of_term(byte(css, p + 1)) => p += 1,
                            next if class(next) & BLANK != 0 => {
                                let (next, is_term) = self.gap(p, Place::AfterComma)?;
                                p = next;
                                if !is_term {
                                    continue;
                                }
                            }
                            b'/' | 0 => return None,
                            _ if self.owner == Owner::CustomProperty => return None,
                            // To `postcss` the comma is part of the word, which isn't `url` then.
                            _ if starts_with_url(css, p) => return None,
                            _ => {
                                // The blank is missing.
                                self.cut(p, p);
                                self.values.flat.push(b' ');
                            }
                        }
                        place = Place::AfterComma;
                        is_after_lonely_string = false;
                        break;
                    }
                    b':' if is_key && is_item_start => {
                        let group = self.values.opens.last()?.record as usize;
                        if self.values.records.len() == group + 1 {
                            self.values.records.get_mut(group)?.flags |= FIRST_PAIR;
                        }
                        let at = self.position(p);
                        self.record(Kind::Colon, 0, at, 0);
                        self.mark_complex();
                        p += 1;
                        if class(byte(css, p)) & BLANK == 0 {
                            return None;
                        }
                        let (next, is_term) = self.gap(p, Place::First)?;
                        if !is_term {
                            return None;
                        }
                        (p, place) = (next, Place::First);
                        is_after_lonely_string = false;
                        break;
                    }
                    b';' | b'}' if !is_inside => return Some(p),
                    b' ' if is_start_of_term(byte(css, p + 1)) => {
                        p += 1;
                        self.values.has_blanks = true;
                        place = Place::Next;
                        is_after_lonely_string = is_lonely_string;
                        break;
                    }
                    next if class(next) & BLANK != 0 => {
                        let end = p;
                        let (next, is_term) = self.gap(p, Place::Next)?;
                        p = next;
                        if !is_term {
                            if self.depth() == 0 {
                                return Some(end);
                            }
                            continue;
                        }
                        self.values.has_blanks = true;
                        place = Place::Next;
                        is_after_lonely_string = is_lonely_string;
                        break;
                    }
                    _ => return None,
                }
            }
        }
    }
}

impl Values {
    /// Reads the value that starts at `start`: up to a `;` or a `}` outside of all parentheses, or to the blanks before
    /// a `!`, a `{` or a `}`. False if it isn't in the language.
    pub(super) fn read(
        &mut self,
        css: &[u8],
        start: usize,
        syntax: Syntax,
        owner: Owner,
        quote: u8,
    ) -> bool {
        self.flat.clear();
        self.records.clear();
        self.opens.clear();
        self.is_as_written = true;
        self.start = start;
        self.top_commas = 0;
        self.ends_with_star = false;
        self.has_wildcard = false;
        self.has_complex = false;
        self.has_comments = false;
        self.has_line_breaks = false;
        self.has_blanks = false;
        self.has_tight_slash = false;
        let mut scanner = Scanner {
            css,
            syntax,
            owner,
            quote,
            values: self,
            segment: start,
            has_other_quotes: false,
            has_inner_quotes: false,
            interpolation: None,
        };
        let Some(end) = scanner.scan(start) else {
            return false;
        };
        if scanner.depth() > 0
            || scanner.interpolation.is_some()
            || (scanner.has_other_quotes && scanner.has_inner_quotes)
        {
            return false;
        }
        let has_other_quotes = scanner.has_other_quotes;
        scanner.values.is_reshaped = !scanner.values.is_as_written;
        if !scanner.values.is_as_written || has_other_quotes {
            scanner.cut(end, end);
        }
        self.end = end;
        if has_other_quotes {
            // There's no quote in any of the strings.
            for byte in &mut self.flat {
                if matches!(byte, b'"' | b'\'') {
                    *byte = quote;
                }
            }
        }
        true
    }
}
