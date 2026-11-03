//! Code in templates that is printed as it is written, if it is printed on one line.
//!
//! Most of the code in a template is small, and is written the way it will be printed. To find that out by parsing and
//! printing it costs far more than all that is around it. The functions here know a small part of JavaScript in one
//! spelling: the one that the printer gives it on one line. What they accept can be copied wherever it is known to fit
//! on its line. What they do not know for certain they refuse.
//!
//! ```text
//! expression  logical | logical ? logical : logical
//! logical     comparison, or several with the same one of && || ?? between them
//! comparison  unary | unary operator unary              === !== == != > < >= <= + - * / %
//! unary       chain | !unary | -chain
//! chain       name, then .name ?.name [expression] (arguments), two calls at most
//!             | number | 'string' | [arguments] | object | `template`
//! object      { key: expression, name, 'a-key': expression }        in the value of an attribute only
//! template    any text, ${expression}                               the same
//! arrow       () => logical | (name, name) => logical | (name) => (chain = expression)
//!                                                                   the whole value of an attribute only
//! ```
//!
//! One blank on either side of an operator and behind a comma, none elsewhere. No parentheses but those of a call:
//! whether others stay is a long story. More than two calls in a chain can break it whether it fits or not, and so can
//! arrays in an array.

use crate::FormatOptions;
use crate::options::{ArrowParentheses, QuoteProperties, QuoteStyle};

/// The options that the spelling depends on.
#[derive(Copy, Clone)]
pub(crate) struct Spelling {
    has_bracket_spacing: bool,
    has_arrow_parentheses: bool,
    /// Whether a key needs its quotes depends on nothing but the key.
    quotes_keys_one_by_one: bool,
    /// What a string is between where both quotes can be written.
    preferred_quote: u8,
    /// `sortTailwindcss`: several words in a string or a template can be classes, which change places.
    sorts_classes: bool,
}

impl Spelling {
    pub(crate) fn new(options: &FormatOptions) -> Self {
        Spelling {
            has_bracket_spacing: options.bracket_spacing.value(),
            has_arrow_parentheses: matches!(options.arrow_parentheses, ArrowParentheses::Always),
            quotes_keys_one_by_one: matches!(options.quote_properties, QuoteProperties::AsNeeded),
            preferred_quote: match options.quote_style {
                QuoteStyle::Double => b'"',
                QuoteStyle::Single => b'\'',
            },
            sorts_classes: options.tailwind.is_some(),
        }
    }
}

/// A word that is, or may be, more than a name to one of the parsers.
fn is_word_of_the_language(name: &[u8]) -> bool {
    matches!(
        name,
        b"break"
            | b"case"
            | b"catch"
            | b"class"
            | b"const"
            | b"continue"
            | b"debugger"
            | b"default"
            | b"delete"
            | b"do"
            | b"else"
            | b"enum"
            | b"export"
            | b"extends"
            | b"finally"
            | b"for"
            | b"function"
            | b"if"
            | b"import"
            | b"in"
            | b"instanceof"
            | b"new"
            | b"return"
            | b"super"
            | b"switch"
            | b"this"
            | b"throw"
            | b"try"
            | b"typeof"
            | b"var"
            | b"void"
            | b"while"
            | b"with"
            | b"yield"
            | b"let"
            | b"static"
            | b"implements"
            | b"interface"
            | b"package"
            | b"private"
            | b"protected"
            | b"public"
            | b"await"
            | b"async"
            | b"of"
            | b"as"
            | b"satisfies"
            | b"arguments"
            | b"eval"
    )
}

fn starts_name(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$')
}

fn continues_name(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$')
}

/// Reads code. Every function takes the place where its part starts and returns where it ends. None looks for the end
/// of the code: behind it is a `"` or a `}`, which no part can have in it.
struct Reader<'a> {
    text: &'a [u8],
    spelling: Spelling,
    /// What strings are between: `'` in an attribute.
    quote: u8,
    /// Whether braces can be written there: not between `{{` and `}}`.
    can_have_braces: bool,
    /// The operator of what `logical` has read last. 0 for none.
    last_operator: u8,
    /// How many parts are being read in each other.
    depth: u32,
}

impl Reader<'_> {
    #[inline(always)]
    fn at(&self, index: usize) -> u8 {
        self.text.get(index).copied().unwrap_or(0)
    }

    fn is(&self, index: usize, expected: &[u8]) -> bool {
        (self.text.get(index..)).is_some_and(|rest| rest.starts_with(expected))
    }

    /// `is_free`: behind a dot, where any word is a name.
    fn name(&self, start: usize, is_free: bool) -> Option<usize> {
        if !starts_name(self.at(start)) {
            return None;
        }
        let mut end = start + 1;
        while continues_name(self.at(end)) {
            end += 1;
        }
        (is_free || !is_word_of_the_language(self.text.get(start..end)?)).then_some(end)
    }

    /// 0, 12, 0.5, 1.25: no zero in front or at the end, few enough digits to be exact.
    fn number(&self, start: usize) -> Option<usize> {
        let mut at = start;
        match self.at(at) {
            b'0' => at += 1,
            _ => {
                while self.at(at).is_ascii_digit() {
                    at += 1;
                }
            }
        }
        if self.at(at) == b'.' {
            at += 1;
            while self.at(at).is_ascii_digit() {
                at += 1;
            }
            if matches!(self.at(at - 1), b'0' | b'.') {
                return None;
            }
        }
        (at - start <= 15 && !continues_name(self.at(at)) && self.at(at) != b'.').then_some(at)
    }

    /// Expressions with `, ` between them, from behind the opening bracket to behind the closing one.
    fn list(&mut self, mut at: usize, close: u8, is_in_array: bool) -> Option<usize> {
        if self.at(at) == close {
            return Some(at + 1);
        }
        // An array of nothing but objects can break whether it fits or not.
        let (mut has_others, mut count) = (!is_in_array, 0);
        loop {
            if is_in_array && self.at(at) == b'[' {
                return None;
            }
            has_others |= self.at(at) != b'{';
            count += 1;
            at = self.expression(at)?;
            if self.at(at) == close {
                return (has_others || count == 1).then_some(at + 1);
            }
            if !self.is(at, b", ") {
                return None;
            }
            at += 2;
        }
    }

    /// `at` is behind the `{`. Keys are names, or strings that cannot do without their quotes.
    fn object(&mut self, mut at: usize) -> Option<usize> {
        if !self.can_have_braces || !self.spelling.quotes_keys_one_by_one {
            return None;
        }
        if self.at(at) == b'}' {
            return Some(at + 1);
        }
        if self.spelling.has_bracket_spacing {
            if self.at(at) != b' ' {
                return None;
            }
            at += 1;
        }
        loop {
            if self.at(at) == self.quote {
                // A `-` in it, and a letter at its start: neither a name nor a number.
                at += 1;
                if !starts_name(self.at(at)) {
                    return None;
                }
                let mut has_dash = false;
                while self.at(at) != self.quote {
                    match self.at(at) {
                        b'-' => has_dash = true,
                        byte if continues_name(byte) => {}
                        _ => return None,
                    }
                    at += 1;
                }
                at += 1;
                if !has_dash || self.at(at) != b':' {
                    return None;
                }
            } else {
                let start = at;
                at = self.name(at, true)?;
                // Alone it is a variable as well.
                if self.at(at) != b':'
                    && (self.name(start, false).is_none()
                        || matches!(self.text.get(start..at)?, b"true" | b"false" | b"null"))
                {
                    return None;
                }
            }
            if self.at(at) == b':' {
                if self.at(at + 1) != b' ' {
                    return None;
                }
                at = self.expression(at + 2)?;
            }
            if self.is(at, b", ") {
                at += 2;
                continue;
            }
            if self.spelling.has_bracket_spacing {
                if self.at(at) != b' ' {
                    return None;
                }
                at += 1;
            }
            return (self.at(at) == b'}').then_some(at + 1);
        }
    }

    /// `at` is behind the backtick.
    fn template(&mut self, mut at: usize) -> Option<usize> {
        if !self.can_have_braces {
            return None;
        }
        loop {
            match self.at(at) {
                b'`' => return Some(at + 1),
                0..=31 | 127.. | b'\\' | b'"' | b'&' => return None,
                b' ' if self.spelling.sorts_classes => return None,
                b'$' if self.at(at + 1) == b'{' => {
                    at = self.expression(at + 2)?;
                    if self.at(at) != b'}' {
                        return None;
                    }
                }
                _ => {}
            }
            at += 1;
        }
    }

    fn chain(&mut self, start: usize) -> Option<usize> {
        let first = self.at(start);
        if first.is_ascii_digit() {
            return self.number(start);
        }
        if first == self.quote {
            let mut at = start + 1;
            loop {
                match self.at(at) {
                    byte if byte == first => return Some(at + 1),
                    0..=31 | 127.. | b'\\' | b'"' | b'\'' | b'&' | b'<' | b'{' | b'}' => {
                        return None;
                    }
                    b' ' if self.spelling.sorts_classes => return None,
                    _ => at += 1,
                }
            }
        }
        match first {
            b'[' => return self.list(start + 1, b']', true),
            b'{' => return self.object(start + 1),
            b'`' => return self.template(start + 1),
            _ => {}
        }
        let mut at = self.name(start, false)?;
        let mut calls = 0;
        loop {
            at = match self.at(at) {
                b'.' => self.name(at + 1, true)?,
                b'?' if self.at(at + 1) == b'.' => self.name(at + 2, true)?,
                b'(' => {
                    calls += 1;
                    if calls > 2 {
                        return None;
                    }
                    self.list(at + 1, b')', false)?
                }
                b'[' => {
                    let end = self.expression(at + 1)?;
                    if self.at(end) != b']' {
                        return None;
                    }
                    end + 1
                }
                _ => return Some(at),
            };
        }
    }

    fn unary(&mut self, mut at: usize) -> Option<usize> {
        while self.at(at) == b'!' {
            at += 1;
        }
        if self.at(at) == b'-' {
            at += 1;
            if self.at(at) == b'-' {
                return None;
            }
        }
        self.chain(at)
    }

    fn comparison(&mut self, start: usize) -> Option<usize> {
        let at = self.unary(start)?;
        if self.at(at) != b' ' {
            return Some(at);
        }
        let mut operator_end = at + 2;
        match self.at(at + 1) {
            // == === != !==
            b'=' | b'!' => {
                if self.at(operator_end) != b'=' {
                    return Some(at);
                }
                operator_end += 1;
                operator_end += usize::from(self.at(operator_end) == b'=');
            }
            b'>' | b'<' => operator_end += usize::from(self.at(operator_end) == b'='),
            b'+' | b'-' | b'*' | b'/' | b'%' => {}
            _ => return Some(at),
        }
        if self.at(operator_end) != b' ' {
            return None;
        }
        self.unary(operator_end + 1)
    }

    fn logical(&mut self, start: usize) -> Option<usize> {
        let mut at = self.comparison(start)?;
        let mut operator = 0;
        while self.at(at) == b' ' {
            let byte = self.at(at + 1);
            if !matches!(byte, b'&' | b'|' | b'?')
                || self.at(at + 2) != byte
                || self.at(at + 3) != b' '
            {
                break;
            }
            if operator != 0 && operator != byte {
                return None;
            }
            operator = byte;
            at = self.comparison(at + 4)?;
        }
        self.last_operator = operator;
        Some(at)
    }

    fn expression(&mut self, start: usize) -> Option<usize> {
        // What is nested deeper than anybody writes it goes the long way, which asks the stack.
        if self.depth > 16 {
            return None;
        }
        self.depth += 1;
        let end = self.conditional(start);
        self.depth -= 1;
        end
    }

    fn conditional(&mut self, start: usize) -> Option<usize> {
        let at = self.logical(start)?;
        if !self.is(at, b" ? ") {
            return Some(at);
        }
        // `a ?? b` gets parentheses in any of the three places.
        if self.last_operator == b'?' {
            return None;
        }
        let at = self.logical(at + 3)?;
        if self.last_operator == b'?' || !self.is(at, b" : ") {
            return None;
        }
        let at = self.logical(at + 3)?;
        (self.last_operator != b'?').then_some(at)
    }

    /// `a = expression`
    fn assignment(&mut self, start: usize) -> Option<usize> {
        if !starts_name(self.at(start)) {
            return None;
        }
        let at = self.chain(start)?;
        if !self.is(at, b" = ") || self.at(at - 1) == b')' {
            return None;
        }
        self.expression(at + 3)
    }

    fn arrow(&mut self, start: usize) -> Option<usize> {
        let mut at = start;
        if self.at(at) == b'(' {
            at += 1;
            let mut names = 0;
            while self.at(at) != b')' {
                if names != 0 {
                    if !self.is(at, b", ") {
                        return None;
                    }
                    at += 2;
                }
                at = self.name(at, false)?;
                names += 1;
            }
            if names == 1 && !self.spelling.has_arrow_parentheses {
                return None;
            }
            at += 1;
        } else {
            if self.spelling.has_arrow_parentheses {
                return None;
            }
            at = self.name(at, false)?;
        }
        if !self.is(at, b" => ") {
            return None;
        }
        at += 4;
        match self.at(at) {
            b'(' => {
                let end = self.assignment(at + 1)?;
                (self.at(end) == b')').then_some(end + 1)
            }
            // An object would be a block, and `a ? b : c` gets parentheses.
            b'{' => None,
            _ => self.logical(at),
        }
    }

    /// A name, or `{ a, b }`.
    fn binding(&self, mut at: usize) -> Option<usize> {
        if self.at(at) != b'{' {
            return self.name(at, false);
        }
        at += 1;
        if self.spelling.has_bracket_spacing {
            if self.at(at) != b' ' {
                return None;
            }
            at += 1;
        }
        loop {
            at = self.name(at, false)?;
            if !self.is(at, b", ") {
                break;
            }
            at += 2;
        }
        if self.spelling.has_bracket_spacing {
            if self.at(at) != b' ' {
                return None;
            }
            at += 1;
        }
        (self.at(at) == b'}').then_some(at + 1)
    }
}

fn in_attribute(value: &[u8], spelling: Spelling) -> Reader<'_> {
    Reader {
        text: value,
        spelling,
        quote: b'\'',
        can_have_braces: true,
        last_operator: 0,
        depth: 0,
    }
}

/// If an expression starts at `start` in `text`, between `{{` and `}}`, returns where it ends.
pub(crate) fn expression_end(text: &[u8], start: usize, spelling: Spelling) -> Option<usize> {
    let mut reader = Reader {
        text,
        spelling,
        quote: spelling.preferred_quote,
        can_have_braces: false,
        last_operator: 0,
        depth: 0,
    };
    reader.expression(start)
}

/// `value` is the value of an attribute. With `is_handler`, `a.b = expression` will do as well.
fn is_expression(value: &[u8], is_handler: bool, spelling: Spelling) -> bool {
    let mut reader = in_attribute(value, spelling);
    let end = reader.expression(0);
    if end == Some(value.len()) || reader.arrow(0) == Some(value.len()) {
        return true;
    }
    is_handler && reader.assignment(0) == Some(value.len())
}

/// `embed/vue-attributes.js`: whether `value`, which is not empty, is printed as it is written on one line. `None` if it
/// is no code. `name` is the `fullName` of an attribute of an element that is no block of the file.
pub(crate) fn is_vue_attribute(name: &[u8], value: &[u8], spelling: Spelling) -> Option<bool> {
    // Most names are none of these, which their first bytes say.
    Some(match name {
        [b'#', ..] => is_binding(value, spelling),
        [b'@', ..] => is_expression(value, true, spelling),
        [b':' | b'.', ..] => is_expression(value, false, spelling),
        [b'v', b'-', rest @ ..] => match rest {
            b"for" => is_v_for(value, spelling),
            b"slot" | [b's', b'l', b'o', b't', b':', ..] => is_binding(value, spelling),
            [b'o', b'n', b':', ..] => is_expression(value, true, spelling),
            _ => is_expression(value, false, spelling),
        },
        [b's', b'l', ..] if name == b"slot-scope" => is_binding(value, spelling),
        _ => return None,
    })
}

/// A word of small letters, a plain number with a unit of small letters or `%`, a color. With `is_in_call`, `--a-name`
/// too. Returns where it ends.
fn term(text: &[u8], start: usize, is_in_call: bool) -> Option<usize> {
    let at = |index: usize| text.get(index).copied().unwrap_or(0);
    let mut end = start;
    if at(end).is_ascii_lowercase() {
        while at(end).is_ascii_lowercase() || (at(end) == b'-' && at(end + 1).is_ascii_lowercase())
        {
            end += 1;
        }
        if at(end) != b'(' {
            return Some(end);
        }
        // `var(--a)`, `var(--a, 1px)`, `rgb(0, 0, 0)`, `rgba(0, 0, 0, 0.5)`: terms with `, ` between them.
        if is_in_call
            || !matches!(
                &text[start..end],
                b"var" | b"rgb" | b"rgba" | b"hsl" | b"hsla"
            )
        {
            return None;
        }
        end += 1;
        loop {
            end = term(text, end, true)?;
            if at(end) == b')' {
                return Some(end + 1);
            }
            if at(end) != b',' || at(end + 1) != b' ' {
                return None;
            }
            end += 2;
        }
    }
    if at(end) == b'#' {
        let from = end + 1;
        end = from;
        while matches!(at(end), b'0'..=b'9' | b'a'..=b'f') {
            end += 1;
        }
        return matches!(end - from, 3 | 6).then_some(end);
    }
    if at(end) == b'-' {
        end += 1;
        if at(end) == b'-' && is_in_call {
            end += 1;
            if !at(end).is_ascii_lowercase() {
                return None;
            }
            while at(end).is_ascii_lowercase()
                || at(end).is_ascii_digit()
                || (at(end) == b'-' && !matches!(at(end + 1), b'-' | b')' | b','))
            {
                end += 1;
            }
            return Some(end);
        }
    }
    match at(end) {
        b'0' => end += 1,
        b'1'..=b'9' => {
            while at(end).is_ascii_digit() {
                end += 1;
            }
        }
        _ => return None,
    }
    if at(end) == b'.' {
        end += 1;
        while at(end).is_ascii_digit() {
            end += 1;
        }
        if matches!(at(end - 1), b'0' | b'.') {
            return None;
        }
    }
    if at(end) == b'%' {
        return Some(end + 1);
    }
    // `px`, `em`, `rem`, `vh`. Not `e`, which starts an exponent, nor `Q`, `Hz`, `kHz`, which have capital letters.
    let unit = end;
    while at(end).is_ascii_lowercase() {
        end += 1;
    }
    let is_plain = end - unit <= 4
        && (at(unit) != b'e' || end - unit == 2)
        && !matches!(at(unit), b'q' | b'h' | b'k');
    is_plain.then_some(end)
}

/// `width: 100px`, `margin: 0 auto; color: var(--a)`: the value of a `style` attribute that is printed as it is written
/// on one line. Declarations with `; ` between them, whose values are terms with a blank between them.
pub(crate) fn is_style(value: &[u8]) -> bool {
    let at = |index: usize| value.get(index).copied().unwrap_or(0);
    let mut end = 0;
    loop {
        // `--a`
        if at(end) == b'-' && at(end + 1) == b'-' {
            end += 2;
        }
        if !at(end).is_ascii_lowercase() {
            return false;
        }
        while at(end).is_ascii_lowercase() || (at(end) == b'-' && at(end + 1) != b'-') {
            end += 1;
        }
        if at(end) != b':' || at(end - 1) == b'-' || at(end + 1) != b' ' {
            return false;
        }
        end += 2;
        loop {
            match term(value, end, false) {
                Some(it) => end = it,
                None => return false,
            }
            if end == value.len() {
                return true;
            }
            if at(end) != b' ' {
                break;
            }
            end += 1;
        }
        if at(end) != b';' || at(end + 1) != b' ' {
            return false;
        }
        end += 2;
    }
}

/// The value of `#default` or `v-slot`: one parameter.
fn is_binding(value: &[u8], spelling: Spelling) -> bool {
    in_attribute(value, spelling).binding(0) == Some(value.len())
}

/// `a in b`, `(a, b) in c`, `{ a, b } in c`, also with `of`.
fn is_v_for(value: &[u8], spelling: Spelling) -> bool {
    let mut reader = in_attribute(value, spelling);
    let left_end = (|| {
        if reader.at(0) != b'(' {
            return reader.binding(0);
        }
        let (mut at, mut names) = (1, 0);
        loop {
            at = match names {
                0 => reader.binding(at)?,
                _ => reader.name(at, false)?,
            };
            names += 1;
            if reader.at(at) == b')' {
                break;
            }
            if !reader.is(at, b", ") {
                return None;
            }
            at += 2;
        }
        (2..=3).contains(&names).then_some(at + 1)
    })();
    let Some(at) = left_end else {
        return false;
    };
    (reader.is(at, b" in ") || reader.is(at, b" of "))
        && reader.expression(at + 4) == Some(value.len())
}
