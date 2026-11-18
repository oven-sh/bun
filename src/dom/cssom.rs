//! What the CSS object model of scripts needs parsed and serialized.

use bun_core::strings;
use bun_css::Token;

use crate::calc::{Kind, Node, Options};
use crate::selector_parser::Parser;
use crate::types::RangeName;
use crate::values::*;

/// The name of the range, and the offset.
pub(crate) fn keyframe_offset(source: &[u8]) -> Option<(Option<RangeName>, f64)> {
    let cx = Ctx::dummy();
    let value = |p: &mut P, kind| {
        attempt(p, |p| Node::parse(p, &Options::new(kind))).map(|it| it.compute(&cx, 1.0))
    };
    let (range, offset) = parse_all(source, |p| match RangeName::parse(p, &cx) {
        Some(range) => Some((Some(range), value(p, Kind::Percentage)?)),
        None => Some((
            None,
            value(p, Kind::Number).or_else(|| value(p, Kind::Percentage))?,
        )),
    })?;
    cx.deps.get().is_empty().then_some((range, offset))
}

pub(crate) fn pseudo_element(source: &[u8]) -> Option<Out> {
    let written = Parser::default()
        .serialize(source)
        .filter(|it| source.starts_with(b":") && it.starts_with(b"::"))?;
    let name = &written[2..strings::index_of_char_usize(&written, b'(').unwrap_or(written.len())];
    let has_trailing_space = source.last()?.is_ascii_whitespace()
        && (name.len() + 2 == written.len() || source.trim_ascii_end().ends_with(b")"));
    let is_unknown = has_trailing_space
        || name.starts_with(b"-webkit-")
            && !name.starts_with(b"-webkit-scrollbar")
            && name != b"-webkit-resizer";
    let is_alone = name
        .iter()
        .all(|it| it.is_ascii_alphabetic() || *it == b'-')
        && (name.len() + 2 == written.len() || written.ends_with(b")"));
    (is_alone && !is_unknown && !matches!(name, b"part" | b"slotted" | b"cue")).then_some(written)
}

pub(crate) enum Segment<'a> {
    Text(&'a [u8]),
    /// With the fallback.
    Variable(Out, Option<Vec<Segment<'a>>>),
}

pub(crate) fn segments(source: &[u8]) -> Vec<Segment<'_>> {
    segments_within(source, 0)
}

fn segments_within(source: &[u8], depth: u8) -> Vec<Segment<'_>> {
    fn scan<'a>(
        p: &mut P,
        source: &'a [u8],
        start: &mut usize,
        all: &mut Vec<Segment<'a>>,
        depth: u8,
    ) {
        loop {
            let before = *start..p.position();
            match p.next_including_whitespace_and_comments().copied() {
                Ok(Token::Function(name)) if eq(name, "var") && depth < 128 => {
                    all.extend((!before.is_empty()).then(|| Segment::Text(&source[before])));
                    crate::values::visit_nested(p, |p| {
                        let (name, has_fallback, from) = (
                            ident(p).unwrap_or_default().to_vec(),
                            comma(p),
                            p.position(),
                        );
                        while p.next_including_whitespace_and_comments().is_ok() {}
                        all.push(Segment::Variable(
                            name,
                            has_fallback
                                .then(|| segments_within(&source[from..p.position()], depth + 1)),
                        ));
                    });
                    *start = p.position();
                }
                Ok(
                    Token::Function(_) | Token::OpenParen | Token::OpenSquare | Token::OpenCurly,
                ) if depth < 128 => {
                    crate::values::visit_nested(p, |p| scan(p, source, start, all, depth + 1));
                }
                Ok(_) => {}
                Err(_) => return,
            }
        }
    }
    let (mut all, mut start) = (Vec::new(), 0);
    with_parser(source, |p| scan(p, source, &mut start, &mut all, depth));
    all.extend((start < source.len()).then(|| Segment::Text(&source[start..])));
    all
}

pub(crate) fn has_variables(source: &[u8]) -> bool {
    segments(source)
        .iter()
        .any(|it| matches!(it, Segment::Variable(..)))
}
