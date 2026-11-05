//! Reads the selectors of a rule in the small language that most selectors are written in, and writes them the way
//! `Printer::print_selector` and `doc.rs` print them.
//!
//! A compound selector (`a.b:hover`, `&-c`, `[d="e"]`) is printed as it's written. A selector is `group(indent(..))`
//! with a possible line break before each combinator. If it doesn't fit on its line, together with the `,` or the ` {`
//! after it, all of them break. The parentheses of `:not(..)` are groups of their own. The selectors of a list are on a
//! line each.

use super::super::Parser as Syntax;
use super::layout::Page;
use super::value::starts_with_url;
use super::{BLANK, DASH, DIGIT, LOWER, Shape, UNDERSCORE, UPPER, byte, class, skip, skip_long};

pub(super) struct Read {
    /// Where the selectors end in the source, and where the `{` is.
    pub(super) end: usize,
    pub(super) brace: usize,
    pub(super) shape: Shape,
}

const NAME: u8 = LOWER | DIGIT | DASH | UNDERSCORE;
const ANY_NAME: u8 = NAME | UPPER;

struct Scanner<'a> {
    css: &'a [u8],
    syntax: Syntax,
    quote: u8,
    has_upper: bool,
    /// The compound selector that's being read has a string in the quotes that aren't printed.
    has_other_quotes: bool,
}

/// A compound selector of the most common kind: names in lower case, with `.`, `#`, `:`, `::` or `&` before them.
/// Returns its end. This is no more than a shorter way to what `Scanner::compound` finds.
#[inline]
fn end_of_simple_compound(css: &[u8], start: usize, syntax: Syntax) -> Option<usize> {
    let mut p = start;
    if class(byte(css, p)) & (LOWER | UNDERSCORE) != 0 {
        if starts_with_url(css, p) {
            return None;
        }
        p = skip_long(css, p, NAME);
    }
    loop {
        let (name, starts_name) = match byte(css, p) {
            b'.' | b'#' => (p + 1, LOWER | UNDERSCORE),
            b'&' if class(byte(css, p + 1)) & NAME == 0 => {
                p += 1;
                continue;
            }
            b'&' => (p + 1, LOWER | UNDERSCORE),
            b':' => (p + 1 + usize::from(byte(css, p + 1) == b':'), LOWER),
            b' ' | b',' | b'{' | b'\n' | b'>' | b'+' | b'~' if p > start => return Some(p),
            _ => return None,
        };
        let is_pseudo = css[p] == b':';
        let first = skip(css, name, DASH);
        if class(byte(css, first)) & starts_name != 0 && !(is_pseudo && starts_with_url(css, first))
        {
            p = skip_long(css, first, NAME);
        } else if is_pseudo {
            return None;
        } else {
            // An interpolation has to follow.
            p = first;
        }
        // The rest of the name: `@{a}-b@{c}`, `#{$a}-b`.
        let mut is_complete = p > first;
        loop {
            p = match (syntax, byte(css, p), byte(css, p + 1)) {
                _ if is_pseudo => break,
                (Syntax::Less, b'@', b'{') => {
                    let end = skip_long(css, p + 2, ANY_NAME);
                    if class(byte(css, p + 2)) & LOWER == 0
                        || starts_with_url(css, p + 2)
                        || byte(css, end) != b'}'
                    {
                        return None;
                    }
                    end + 1
                }
                (Syntax::Scss, b'#', b'{') if byte(css, p + 2) == b'$' => {
                    let end = skip_long(css, p + 3, NAME);
                    if end == p + 3 || starts_with_url(css, p + 3) || byte(css, end) != b'}' {
                        return None;
                    }
                    end + 1
                }
                _ => break,
            };
            let first = skip(css, p, DASH);
            is_complete = true;
            if class(byte(css, first)) & (LOWER | UNDERSCORE) != 0 {
                if starts_with_url(css, first) {
                    return None;
                }
                p = skip_long(css, first, NAME);
            } else if first > p {
                (p, is_complete) = (first, false);
            }
        }
        if !is_complete {
            return None;
        }
    }
}

/// What `end_of_standing_selectors` has found.
pub(super) struct Standing {
    pub(super) end: usize,
    pub(super) shape: Shape,
    /// A name has a capital in it. See `read`.
    pub(super) has_upper: bool,
}

/// The selectors of a rule from `start` on, `level` blocks deep, with ` {` after them, written as they're printed: each
/// on a line that it fits on, or else with a line for each of its compound selectors. This is no more than a shorter way
/// to what `read` finds.
pub(super) fn end_of_standing_selectors(
    css: &[u8],
    start: usize,
    syntax: Syntax,
    quote: u8,
    page: Page,
    level: usize,
) -> Option<Standing> {
    let room = page.width.saturating_sub(level * page.tab_width);
    let mut shape = Shape::Line;
    let mut has_upper = false;
    let (mut selector, mut p) = (start, start);
    // Of the selector that's being read: the number of compound selectors and of line breaks, and where the line starts.
    let (mut compounds, mut breaks, mut line) = (0, 0, start);
    // See `break_selector`. `tail` is the width of what follows the line.
    let is_line_of_broken = |line: usize, end: usize, tail: usize, breaks: usize| {
        let column = (level + usize::from(breaks > 0)) * page.tab_width;
        !css[line..end].contains(&b'(') || column + (end - line) + tail <= page.width
    };
    let is_broken = |selector: usize, end: usize, tail: usize, compounds: usize, breaks: usize| {
        let flat_len = end - selector - breaks * page.indentation_len(level + 1);
        compounds == breaks + 1 && flat_len + tail > room
    };
    loop {
        compounds += 1;
        p = match end_of_simple_compound(css, p, syntax) {
            Some(end) => end,
            None => {
                // See `Parser::read_rule`.
                if css.get(p..p + 2) == Some(b"--") {
                    return None;
                }
                let mut scanner = Scanner {
                    css,
                    syntax,
                    quote,
                    has_upper: false,
                    has_other_quotes: false,
                };
                let end = match byte(css, p) {
                    b'0'..=b'9' => scanner.percentage(p)?,
                    _ => scanner.any_compound(p)?,
                };
                if scanner.has_other_quotes {
                    return None;
                }
                has_upper |= scanner.has_upper;
                end
            }
        };
        match (byte(css, p), byte(css, p + 1)) {
            (b' ', b'{') => {
                let is_as_printed = match breaks {
                    0 => p + 2 - selector <= room,
                    _ => {
                        is_broken(selector, p, 2, compounds, breaks)
                            && is_line_of_broken(line, p, 2, breaks)
                    }
                };
                return is_as_printed.then_some(Standing {
                    end: p,
                    shape,
                    has_upper,
                });
            }
            (b' ', b'>' | b'+' | b'~') if byte(css, p + 2) == b' ' => p += 3,
            (b' ', _) => p += 1,
            (b',', b'\n') => {
                let is_as_printed = match breaks {
                    0 => p + 1 - selector <= room,
                    _ => {
                        is_broken(selector, p, 1, compounds, breaks)
                            && is_line_of_broken(line, p, 1, breaks)
                    }
                };
                let next = p + 2 + page.indentation_len(level);
                if !is_as_printed || !page.is_line_break(css.get(p + 1..next)?, level) {
                    return None;
                }
                (selector, p, shape) = (next, next, Shape::Lines);
                (compounds, breaks, line) = (0, 0, next);
            }
            (b'\n', _) => {
                let next = p + 1 + page.indentation_len(level + 1);
                if !page.is_line_break(css.get(p..next)?, level + 1)
                    || !is_line_of_broken(line, p, 0, breaks)
                {
                    return None;
                }
                (p, line, shape) = (next, next, Shape::Lines);
                breaks += 1;
                // A combinator is on the line of what follows it.
                if matches!(byte(css, p), b'>' | b'+' | b'~') && byte(css, p + 1) == b' ' {
                    p += 2;
                }
            }
            _ => return None,
        }
    }
}

impl Scanner<'_> {
    /// `@{name}` of Less, from its `@`. Returns its end.
    fn less_interpolation(&self, at: usize) -> Option<usize> {
        let css = self.css;
        let name = at + 2;
        if class(byte(css, name)) & LOWER == 0 || starts_with_url(css, name) {
            return None;
        }
        let end = skip_long(css, name, ANY_NAME);
        (byte(css, end) == b'}').then_some(end + 1)
    }

    /// `#{$name}` of SCSS, from its `#`. Returns its end.
    fn scss_interpolation(&self, hash: usize) -> Option<usize> {
        let css = self.css;
        let mut p = hash + 2;
        loop {
            while matches!(byte(css, p), b'$' | b'.') {
                p += 1;
            }
            if byte(css, p) == b'}' && p > hash + 2 {
                return Some(p + 1);
            }
            if class(byte(css, p)) & NAME == 0 || starts_with_url(css, p) {
                return None;
            }
            p = skip_long(css, p, NAME);
        }
    }

    /// The name of a tag, a class or an id, with the interpolations in it. A name that starts with a number, or with
    /// dashes and a number, is refused: its numbers are printed like those of values. Returns its end.
    fn name(&mut self, start: usize) -> Option<usize> {
        let css = self.css;
        let mut p = start;
        loop {
            let first = skip(css, p, DASH);
            let c = byte(css, first);
            if class(c) & (LOWER | UPPER | UNDERSCORE) != 0 {
                // After one of these, it's in the middle of a word of `postcss`.
                let is_in_word = p == start
                    && first > 0
                    && matches!(css[first - 1], b'.' | b'#' | b'&' | b'%' | b'-');
                if !is_in_word && starts_with_url(css, first) {
                    return None;
                }
                p = skip_long(css, first, NAME);
                if class(byte(css, p)) & UPPER != 0 {
                    self.has_upper = true;
                    p = skip_long(css, p, ANY_NAME);
                }
            } else if first > p || p == start {
                // Dashes, or nothing at all: an interpolation has to follow.
                p = first;
                let is_interpolation = byte(css, p + 1) == b'{'
                    && match c {
                        b'@' => self.syntax == Syntax::Less,
                        b'#' => self.syntax == Syntax::Scss,
                        _ => false,
                    };
                if !is_interpolation {
                    return None;
                }
            }
            p = match (byte(css, p), byte(css, p + 1)) {
                (b'@', b'{') if self.syntax == Syntax::Less => self.less_interpolation(p)?,
                (b'#', b'{') if self.syntax == Syntax::Scss => self.scss_interpolation(p)?,
                _ => return Some(p),
            };
        }
    }

    /// `[name]`, `[name="value"]`, from the `[`. Returns its end.
    fn attribute(&mut self, start: usize) -> Option<usize> {
        let css = self.css;
        if class(byte(css, start + 1)) & LOWER == 0 || starts_with_url(css, start + 1) {
            return None;
        }
        let mut p = skip_long(css, start + 1, ANY_NAME);
        if matches!(byte(css, p), b'~' | b'|' | b'^' | b'$' | b'*') {
            p += 1;
            if byte(css, p) != b'=' {
                return None;
            }
        }
        if byte(css, p) == b'=' {
            p += 1;
            let quote = byte(css, p);
            if !matches!(quote, b'"' | b'\'') {
                return None;
            }
            self.has_other_quotes |= quote != self.quote;
            p += 1;
            while !matches!(
                byte(css, p),
                0..=0x1F | 0x7F.. | b'"' | b'\'' | b'\\' | b'{' | b'}'
            ) {
                p += 1;
            }
            if byte(css, p) != quote {
                return None;
            }
            p += 1;
        }
        (byte(css, p) == b']').then_some(p + 1)
    }

    /// A compound selector, with all that's between the parentheses of its pseudo-classes, which has to be written as
    /// it's printed. Returns its end.
    fn compound(&mut self, start: usize) -> Option<usize> {
        match end_of_simple_compound(self.css, start, self.syntax) {
            Some(end) => Some(end),
            None => self.any_compound(start),
        }
    }

    /// `compound` for one that isn't of the most common kind.
    fn any_compound(&mut self, start: usize) -> Option<usize> {
        let css = self.css;
        let mut p = start;
        // The number of open parentheses, and whether a compound selector has to start here.
        let mut depth = 0u32;
        let mut is_at_start = true;
        // An interpolation can't follow the name of a pseudo-class.
        let mut is_after_pseudo = false;
        loop {
            let c = byte(css, p);
            let was_at_start = std::mem::take(&mut is_at_start);
            let was_after_pseudo = std::mem::take(&mut is_after_pseudo);
            match c {
                b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'-' if was_at_start => p = self.name(p)?,
                b'%' if was_at_start && self.syntax == Syntax::Scss => p = self.name(p + 1)?,
                b'.' => {
                    p = self.name(p + 1)?;
                }
                b'#' => {
                    if byte(css, p + 1) == b'{' {
                        if was_after_pseudo || self.syntax != Syntax::Scss {
                            return None;
                        }
                        p = self.name(p)?;
                    } else {
                        p = self.name(p + 1)?;
                    }
                }
                b'&' => {
                    p += 1;
                    if class(byte(css, p)) & (LOWER | UPPER | UNDERSCORE | DASH) != 0 {
                        p = self.name(p)?;
                    }
                }
                b'*' if was_at_start => p += 1,
                b'[' => {
                    p = self.attribute(p)?;
                    is_after_pseudo = true;
                }
                b':' => {
                    p += 1 + usize::from(byte(css, p + 1) == b':');
                    let name = skip(css, p, DASH);
                    if class(byte(css, name)) & LOWER == 0 || starts_with_url(css, name) {
                        return None;
                    }
                    let end = skip_long(css, name, NAME);
                    is_after_pseudo = true;
                    if byte(css, end) == b'(' {
                        if self.syntax == Syntax::Less && &css[p..end] == b"extend" {
                            return None;
                        }
                        depth += 1;
                        p = end + 1;
                        is_at_start = true;
                        match byte(css, p) {
                            b'0'..=b'9' => {
                                // `2n + 1`: a tag, a combinator, a tag.
                                p = skip(css, p, DIGIT);
                                if byte(css, p) == b'n' {
                                    p += 1;
                                    if css.get(p..p + 3) == Some(b" + ") {
                                        let digits = skip(css, p + 3, DIGIT);
                                        if digits == p + 3 {
                                            return None;
                                        }
                                        p = digits;
                                    }
                                }
                                if byte(css, p) != b')' {
                                    return None;
                                }
                                is_at_start = false;
                            }
                            b'>' | b'+' | b'~' => {
                                if byte(css, p + 1) != b' ' {
                                    return None;
                                }
                                p += 2;
                            }
                            _ => {}
                        }
                    } else {
                        p = end;
                    }
                }
                _ if was_at_start => return None,
                b')' if depth > 0 => {
                    depth -= 1;
                    p += 1;
                    is_after_pseudo = true;
                }
                b',' if depth > 0 => {
                    if byte(css, p + 1) != b' ' {
                        return None;
                    }
                    p += 2;
                    is_at_start = true;
                }
                b' ' if depth > 0 => {
                    p += 1;
                    if matches!(byte(css, p), b'>' | b'+' | b'~') {
                        if byte(css, p + 1) != b' ' {
                            return None;
                        }
                        p += 2;
                    }
                    is_at_start = true;
                }
                _ if depth > 0 => return None,
                _ => return Some(p),
            }
        }
    }

    /// `(@a = b)` after `when`, `and`, `not` or `or`: a guard of Less, from its `(`. To the parser of selectors it's a
    /// combinator that goes on to the `)`, which is printed as it's written, except for its strings and numbers.
    /// Returns its end.
    fn guard(&self, start: usize) -> Option<usize> {
        let css = self.css;
        let mut depth = 0;
        let mut p = start;
        loop {
            match byte(css, p) {
                b'a'..=b'z'
                | b'A'..=b'Z'
                | b'@'
                | b'='
                | b'<'
                | b'>'
                | b' '
                | b'-'
                | b'_'
                | b',' => {}
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(p + 1);
                    }
                }
                b'0'..=b'9' => {
                    // Whole numbers only.
                    p = skip(css, p, DIGIT);
                    if !matches!(byte(css, p), b' ' | b',' | b'(' | b')') {
                        return None;
                    }
                    continue;
                }
                _ => return None,
            }
            p += 1;
        }
    }

    /// `12.5%`, a selector of `@keyframes`. Returns its end.
    fn percentage(&self, start: usize) -> Option<usize> {
        let css = self.css;
        let mut p = skip(css, start, DIGIT);
        if byte(css, p) == b'.' {
            let fraction = p + 1;
            p = skip(css, fraction, DIGIT);
            if p == fraction || css[p - 1] == b'0' {
                return None;
            }
        }
        (byte(css, p) == b'%').then_some(p + 1)
    }
}

/// Returns the end of the part of `text` from `from` on that has no blank outside of parentheses and strings, and
/// whether it has parentheses.
fn end_of_part(text: &[u8], from: usize) -> (usize, bool) {
    let (mut depth, mut has_parens) = (0, false);
    let mut p = from;
    while let Some(&c) = text.get(p) {
        match c {
            b' ' if depth == 0 => break,
            b'(' => {
                depth += 1;
                has_parens = true;
            }
            b')' => depth -= 1,
            b'"' | b'\'' => {
                p += 1;
                while text.get(p).is_some_and(|it| *it != c) {
                    p += 1;
                }
            }
            _ => {}
        }
        p += 1;
    }
    (p.min(text.len()), has_parens)
}

/// `out[start..]` is a selector on one line that doesn't fit. Breaks it before each combinator. `tail` is the width of
/// the `,` or the ` {` after it.
fn break_selector(
    out: &mut Vec<u8>,
    start: usize,
    page: Page,
    level: usize,
    tail: usize,
) -> Option<()> {
    let flat = out.get(start..)?.to_vec();
    out.truncate(start);
    let mut column = level * page.tab_width;
    let mut p = 0;
    loop {
        let from = p;
        // A combinator is on the line of what follows it.
        if matches!(flat.get(p), Some(b'>' | b'+' | b'~')) && flat.get(p + 1) == Some(&b' ') {
            p += 2;
        }
        let (end, has_parens) = end_of_part(&flat, p);
        if from > 0 {
            page.break_line(out, level + 1);
            column = (level + 1) * page.tab_width;
        }
        let is_last = end >= flat.len();
        if has_parens && column + (end - from) + if is_last { tail } else { 0 } > page.width {
            return None;
        }
        out.extend_from_slice(&flat[from..end]);
        if is_last {
            return Some(());
        }
        p = end + 1;
    }
}

/// Where a rule is, and how it's printed.
#[derive(Copy, Clone)]
pub(super) struct Context {
    pub(super) syntax: Syntax,
    /// The quote that strings are printed with.
    pub(super) quote: u8,
    pub(super) is_in_at_rule: bool,
    pub(super) page: Page,
    /// The number of blocks around the rule.
    pub(super) level: usize,
}

/// Reads the selectors of the rule that starts at `start`, and appends `css[copy_from..start]` and what's printed for
/// the selectors to `out`, through the `{`. With `None`, anything can be in `out`.
pub(super) fn read(
    css: &[u8],
    copy_from: usize,
    start: usize,
    context: Context,
    out: &mut Vec<u8>,
) -> Option<Read> {
    let Context {
        syntax,
        quote,
        is_in_at_rule,
        page,
        level,
    } = context;
    let mut scanner = Scanner {
        css,
        syntax,
        quote,
        has_upper: false,
        has_other_quotes: false,
    };
    // What's printed is copied from the source in pieces that are as long as possible. This is where the next one
    // starts.
    let mut segment = copy_from;
    let mut p = start;
    let mut has_lines = false;
    loop {
        // ───────────── a selector
        // How wide it is on one line.
        let mut width = 0;
        if matches!(byte(css, p), b'>' | b'+' | b'~') {
            if byte(css, p + 1) != b' ' {
                return None;
            }
            let next = skip(css, p + 2, BLANK);
            if next > p + 2 {
                out.extend_from_slice(&css[segment..p + 2]);
                segment = next;
            }
            (p, width) = (next, 2);
        }
        // The compound selector before the one that's being read.
        let mut previous: &[u8] = b"";
        let mut has_guard = false;
        let (end, next) = loop {
            let end = match byte(css, p) {
                b'0'..=b'9' => scanner.percentage(p)?,
                b'(' if syntax == Syntax::Less
                    && matches!(previous, b"when" | b"and" | b"not" | b"or") =>
                {
                    has_guard = true;
                    scanner.guard(p)?
                }
                _ => scanner.compound(p)?,
            };
            previous = &css[p..end];
            width += end - p;
            if std::mem::take(&mut scanner.has_other_quotes) {
                out.extend_from_slice(&css[segment..end]);
                segment = end;
                // There's no quote in a string that's taken.
                let compound = out.len() - (end - p);
                for byte in &mut out[compound..] {
                    if matches!(byte, b'"' | b'\'') {
                        *byte = quote;
                    }
                }
            }
            let next = skip(css, end, BLANK);
            let is_one_blank = next == end + 1 && css[end] == b' ';
            match byte(css, next) {
                b'{' => break (end, next),
                b',' if next == end => break (end, next),
                c @ (b'>' | b'+' | b'~') => {
                    previous = b"";
                    p = skip(css, next + 1, BLANK);
                    // `>>>`, `~=`
                    if matches!(byte(css, p), b'>' | b'+' | b'~' | b'=') {
                        return None;
                    }
                    if !(is_one_blank && p == next + 2 && css[next + 1] == b' ') {
                        out.extend_from_slice(&css[segment..end]);
                        out.extend_from_slice(&[b' ', c, b' ']);
                        segment = p;
                    }
                    width += 3;
                }
                _ if next > end => {
                    if !is_one_blank {
                        out.extend_from_slice(&css[segment..end]);
                        out.push(b' ');
                        segment = next;
                    }
                    width += 1;
                    p = next;
                }
                _ => return None,
            }
        };
        let is_last = css[next] == b'{';
        let tail = if is_last { 2 } else { 1 };
        if level * page.tab_width + width + tail > page.width {
            if has_guard {
                return None;
            }
            out.extend_from_slice(&css[segment..end]);
            segment = end;
            let selector = out.len() - width;
            if out[selector..].iter().any(|it| matches!(it, b' ' | b'(')) {
                break_selector(out, selector, page, level, tail)?;
                has_lines = true;
            }
        }
        if is_last {
            // `FROM` is printed in lower case in `@keyframes`.
            if scanner.has_upper && is_in_at_rule {
                return None;
            }
            if !(next == end + 1 && css[end] == b' ') {
                out.extend_from_slice(&css[segment..end]);
                out.push(b' ');
                segment = next;
            }
            out.extend_from_slice(&css[segment..next + 1]);
            return Some(Read {
                end,
                brace: next,
                shape: match has_lines {
                    true => Shape::Lines,
                    false => Shape::Line,
                },
            });
        }
        // The next selector is on the next line.
        has_lines = true;
        p = skip(css, next + 1, BLANK);
        if !page.is_line_break(&css[next + 1..p], level) {
            out.extend_from_slice(&css[segment..next + 1]);
            page.break_line(out, level);
            segment = p;
            if crate::is_too_long(out.len()) {
                return None;
            }
        }
    }
}
