//! A regular expression's pattern as oxlint's rules see it: `run_on_regex_node` from its `utils/regex.rs`, and the way
//! `oxc_regular_expression` reads a pattern written as a string or a template.

use crate::ast_util::get_inner_expression;
use crate::regex_flags::is_regexp_callee;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::Mode;
use bun_lint::utils::char_source::{CharInfo, parse_string_literal, parse_template_token};
use std::borrow::Cow;

pub struct Pattern<'a> {
    text: Cow<'a, [u8]>,
    pub mode: Mode,
    /// The pattern's span: between the slashes of a literal, or including the quotes of a string.
    span: Span,
    /// For a string or a template: the source range of each UTF-16 code unit of `text`, relative to the start of
    /// `span`, and its byte offset in `text`.
    units: Option<(Vec<CharInfo>, Vec<u32>)>,
}

impl<'a> Pattern<'a> {
    /// The pattern of a regular expression literal, in the mode its flags select.
    pub fn from_literal(literal: Expr<'a>) -> Option<Pattern<'a>> {
        let regex = literal.as_regex()?;
        let (start, pattern) = (literal.span().start + 1, regex.pattern());
        Some(Pattern {
            text: Cow::Borrowed(pattern),
            mode: Mode::from_flags(regex.flags()),
            span: Span::new(start, start + pattern.len() as u32),
            units: None,
        })
    }

    /// `Reader::initialize` for a string literal or a template without substitutions. It doesn't decode the string like
    /// JavaScript: `"\n"` is an `n`, a line continuation is a line break, `"\01"` is U+0000 and a `1`, and two escapes
    /// are never combined into one character.
    pub fn read(literal: Expr<'a>, mode: Mode) -> Option<Pattern<'a>> {
        let raw = literal.text();
        let (is_string, cooked) = match literal.kind() {
            ExprKind::String(_) => (true, parse_string_literal(raw)),
            ExprKind::Template(template) if template.exprs().is_empty() => {
                (false, parse_template_token(raw))
            }
            _ => return None,
        };
        let mut units: Vec<CharInfo> = Vec::with_capacity(cooked.len());
        let mut read = 1;
        for unit in cooked {
            push_line_continuations(&mut units, raw, read, unit.start);
            read = unit.end;
            match raw.get(unit.start as usize..unit.end as usize) {
                Some(&[b'\\', letter @ (b'b' | b'f' | b'n' | b'r' | b't' | b'v')]) => {
                    units.push(CharInfo {
                        code_unit: u16::from(letter),
                        ..unit
                    });
                }
                Some([b'\\', b'0', digits @ ..]) if is_string && !digits.is_empty() => {
                    let after_zero = unit.start + 2;
                    units.push(CharInfo {
                        code_unit: 0,
                        start: unit.start,
                        end: after_zero,
                    });
                    units.extend(
                        digits
                            .iter()
                            .zip(after_zero..)
                            .map(|(digit, start)| CharInfo {
                                code_unit: u16::from(*digit),
                                start,
                                end: start + 1,
                            }),
                    );
                }
                _ => units.push(unit),
            }
        }
        push_line_continuations(&mut units, raw, read, raw.len() as u32 - 1);
        let mut text = Vec::with_capacity(units.len());
        let mut offsets: Vec<u32> = Vec::with_capacity(units.len());
        let mut before: Option<CharInfo> = None;
        for unit in &units {
            // The two surrogates of a character that's written as one character in the source. It takes four bytes in
            // `text`.
            match (before.filter(|it| it.start == unit.start), offsets.last()) {
                (Some(_), Some(&lead)) => {
                    offsets.push(lead + 2);
                    strings::push_codepoint_wtf8_joined(&mut text, u32::from(unit.code_unit));
                }
                _ => {
                    offsets.push(text.len() as u32);
                    strings::push_codepoint_wtf8(&mut text, u32::from(unit.code_unit));
                }
            }
            before = Some(*unit);
        }
        Some(Pattern {
            text: Cow::Owned(text),
            mode,
            span: literal.span(),
            units: Some((units, offsets)),
        })
    }

    /// In WTF-8.
    pub fn text(&self) -> &[u8] {
        &self.text
    }

    /// The span in the file of the bytes `start..end` of the text, computed like oxc does.
    pub fn span(&self, start: u32, end: u32) -> Span {
        let Some((units, offsets)) = &self.units else {
            return Span::new(self.span.start + start, self.span.start + end);
        };
        let [first, after] = [start, end].map(|offset| offsets.partition_point(|it| *it < offset));
        let unit = |index: usize| units.get(index);
        let start = match (unit(first), first.checked_sub(1).and_then(unit)) {
            // The low surrogate of a character.
            (Some(it), Some(before)) if before.start == it.start => self.span.start + it.end,
            (Some(it), _) => self.span.start + it.start,
            (None, _) => self.span.end - 1,
        };
        let end = match after.checked_sub(1).and_then(unit) {
            Some(last) if after > first => self.span.start + last.end,
            _ => start,
        };
        Span::new(start, end)
    }
}

/// Adds the line continuations in `from..to`. Nothing else can be between two characters of a string or a template.
fn push_line_continuations(units: &mut Vec<CharInfo>, raw: &[u8], from: u32, to: u32) {
    let mut start = from;
    while start < to {
        let (code_unit, len) = match raw.get(start as usize + 1..).unwrap_or_default() {
            [b'\r', b'\n', ..] => (0x0A, 3),
            [b'\r', ..] => (0x0D, 2),
            [0xE2, 0x80, 0xA8, ..] => (0x2028, 4),
            [0xE2, 0x80, 0xA9, ..] => (0x2029, 4),
            _ => (0x0A, 2),
        };
        units.push(CharInfo {
            code_unit,
            start,
            end: start + len,
        });
        start += len;
    }
}

/// `FlagsParser::parse`: `None` for invalid flags.
fn mode_of_flags(flags: &[u8]) -> Option<Mode> {
    let is_known = |flag: &u8| strings::contains_char(b"dgimsuvy", *flag);
    let is_repeated = |(i, flag): (usize, &u8)| strings::contains_char(&flags[..i], *flag);
    let mode = Mode::from_flags(flags);
    (flags.iter().all(is_known)
        && !flags.iter().enumerate().any(is_repeated)
        && !(mode.unicode && mode.unicode_sets))
        .then_some(mode)
}

/// `run_on_regex_node`: the pattern that oxlint parses for `e`, a regular expression literal or a `RegExp` call with or
/// without `new`. The caller has to check that the pattern is valid.
pub fn run_on_regex_node(e: Expr<'_>) -> Option<Pattern<'_>> {
    match e.kind() {
        ExprKind::Regex(_) => {
            // A literal passed to `RegExp` is handled with the call, whose flags take precedence.
            let mut outer = e.parent();
            while let Node::Expr(it) = outer
                && get_inner_expression(it) != it
            {
                outer = it.parent();
            }
            match outer {
                Node::Expr(it) if is_regexp_call(it) => None,
                _ => Pattern::from_literal(e),
            }
        }
        ExprKind::Call(call) | ExprKind::New(call) if is_regexp_callee(call.callee()) => {
            run_on_arguments(call.args())
        }
        _ => None,
    }
}

fn is_regexp_call(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Call(call) | ExprKind::New(call) if is_regexp_callee(call.callee()))
}

fn run_on_arguments<'a>(args: List<'a, Expr<'a>>) -> Option<Pattern<'a>> {
    let first = args.first().filter(|it| it.tag() != ExprTag::Spread)?;
    // The flags argument, if it's a static string. Its text includes the quotes.
    let flags = match args.get(1).map(get_inner_expression) {
        Some(flags) => match flags.kind() {
            ExprKind::String(_) => Some(flags),
            ExprKind::Template(template) if template.exprs().is_empty() => Some(flags),
            ExprKind::Template(_) => return None,
            _ => None,
        },
        None => None,
    };
    if let Some(mut pattern) = Pattern::from_literal(get_inner_expression(first)) {
        // oxlint tries to read a wrapped literal, like `(/a/)` or `/a/ as T`, as a string, which fails.
        if first.tag() != ExprTag::Regex || first.is_parenthesized() {
            return None;
        }
        let own = pattern.mode;
        if let Some(text) = flags.map(Expr::text)
            && let new = Mode::from_flags(text)
            && (new.unicode, new.unicode_sets) != (own.unicode, own.unicode_sets)
        {
            pattern.mode = mode_of_flags(text.get(1..text.len() - 1)?)?;
        }
        return Some(pattern);
    }
    let mode = match flags {
        Some(flags) => mode_of_flags(Pattern::read(flags, Mode::default())?.text())?,
        None => Mode::default(),
    };
    Pattern::read(get_inner_expression(first), mode)
}
