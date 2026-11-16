//! What the CSS object model of scripts needs parsed and serialized.

use bun_core::strings;
use bun_css::Token;

use crate::calc::{Kind, Node, Options};
use crate::condition;
use crate::custom::{Registered, Signature};
use crate::grammar::Mode;
use crate::properties::{Id, Prop};
use crate::scan::{self, Next};
use crate::selector::List;
use crate::selector_parser::{Namespaces, Parser};
use crate::sheet::{self, AtKind, Declared, Within};
use crate::shorthand;
use crate::types::RangeName;
use crate::values::*;

/// Empty if it is invalid. Otherwise "var" if there is something to substitute, and then for each longhand the source and the
/// serialization. `rule` is the keyword of the rule that it is in.
pub(crate) fn expand(rule: &[u8], name: &[u8], value: &[u8], important: bool) -> Option<Vec<Out>> {
    let value = scan::trim(value);
    let one = |written: Out| Some(vec![Out::new(), value.to_vec(), written]);
    let within = match rule {
        b"keyframes" => Within::Keyframe,
        b"position-try" => Within::PositionTry,
        b"" | b"page" => Within::Style,
        b"quirks" => Within::Quirks,
        _ if important => return None,
        b"function" if eq(name, "result") || name.starts_with(b"--") => {
            return Declared::custom(value).and_then(|_| one(value.to_vec()));
        }
        b"property" if eq(name, "initial-value") => return one(value.to_vec()),
        _ => return one(sheet::descriptor(text(rule), name, value)?),
    };
    let prop = Prop::from_name(name).filter(|it| within.allows(*it, important))?;
    let count = longhands(prop).len();
    let declared = Declared::parse_within(prop, value, within)?;
    let value = if let Declared::Text(it) = &declared {
        it
    } else {
        value
    };
    let one = |written: Out| Some(vec![Out::new(), value.to_vec(), written]);
    let (kind, written): (&[u8], &[u8]) = match (&declared, prop) {
        (Declared::Wide(wide), _) => (b"", wide.name().as_bytes()),
        (Declared::Template(_), _) => (b"var", value),
        (_, Prop::Short(index)) => {
            let shorthand = shorthand::get(index);
            let parts = shorthand
                .ids(Flow::DEFAULT)
                .iter()
                .zip(shorthand.expand(value)?)
                .flat_map(|(id, part)| {
                    let part = part.as_deref().unwrap_or(id.initial_source().as_bytes());
                    [
                        part.to_vec(),
                        id.syntax().write(part, Mode::Specified).unwrap_or_default(),
                    ]
                });
            return Some([Out::new()].into_iter().chain(parts).collect());
        }
        (_, prop) => {
            return one(prop.id(Flow::DEFAULT).map_or(Some(value.to_vec()), |id| {
                id.syntax().write(value, Mode::Specified)
            })?);
        }
    };
    Some(
        [kind]
            .into_iter()
            .chain(core::iter::repeat_n(written, count * 2))
            .map(<[u8]>::to_vec)
            .collect(),
    )
}

pub(crate) fn longhands(prop: Prop) -> Vec<Prop> {
    match prop {
        Prop::Short(index) => shorthand::get(index).longhands().collect(),
        Prop::All => Id::ALL
            .iter()
            .filter(|it| it.is_in_all())
            .map(|it| Prop::Long(*it))
            .chain(crate::properties::logical_props())
            .collect(),
        prop => vec![prop],
    }
}

/// Those that set the most properties come first.
pub(crate) fn shorthands_of(longhand: Prop) -> Vec<&'static str> {
    let mut all: Vec<_> = (0..)
        .zip(shorthand::definitions())
        .map(|(index, it)| {
            (
                it.name,
                shorthand::get(index).longhands().collect::<Vec<_>>(),
            )
        })
        .filter(|it| it.1.len() > 1 && it.1.contains(&longhand) && it.0 != "-webkit-border-radius")
        .collect();
    all.sort_by_key(|it| core::cmp::Reverse(it.1.len()));
    all.into_iter().map(|it| it.0).collect()
}

/// For each rule its prelude, "{" or ";", and its block. A run of declarations has "" instead, and no block.
pub(crate) fn split(source: &[u8], has_declarations: bool, is_nested: bool) -> Vec<&[u8]> {
    let (mut all, mut at): (Vec<&[u8]>, _) = (Vec::new(), 0);
    loop {
        match if has_declarations {
            scan::next_item(source, at)
        } else {
            scan::next_rule(source, at, is_nested)
        } {
            Next::End(_) => return all,
            Next::Statement { start, end } => {
                let statement = &source[start..end];
                match statement[0] == b'@' {
                    true => {
                        all.extend([statement.strip_suffix(b";").unwrap_or(statement), b";", b""])
                    }
                    false => all.extend([statement, b"", b""]),
                }
                at = end;
            }
            Next::Block { start, brace } => {
                let end = scan::end_of_block(source, brace).0;
                all.extend([&source[start..brace], b"{", &source[brace + 1..end]]);
                at = end + 1;
            }
        }
    }
}

/// From pairs of a prefix and a URL, which are all ended by NUL.
pub(crate) fn namespaces(source: &[u8]) -> Namespaces {
    let mut parts = strings::split(source, b"\0");
    core::iter::from_fn(|| Some((parts.next()?.into(), text(parts.next()?).into()))).collect()
}

fn written(write: impl FnOnce(&mut Out)) -> Out {
    let mut out = Out::new();
    write(&mut out);
    out
}

fn collapsed(source: &[u8]) -> Out {
    with_parser(source, |p| {
        let (mut out, mut start) = (Out::new(), 0);
        loop {
            let before = p.slice_from(start);
            match p.next_including_whitespace_and_comments().copied() {
                Ok(Token::Whitespace(_)) => {
                    out.extend([before, b" "].concat());
                    start = p.position();
                }
                Ok(_) => {}
                Err(_) => return [&out[..], p.slice_from(start)].concat(),
            }
        }
    })
}

fn page_selector(source: &[u8]) -> Option<Out> {
    parse_all(source, |p| {
        let mut out = written(|out| ident(p).into_iter().for_each(|it| write_ident(it, out)));
        let start = p.position();
        if attempt(p, |p| p.expect_colon().ok()).is_some() {
            let name = ident(p)
                .filter(|it| ["first", "left", "right"].iter().any(|known| eq(it, known)))?
                .to_ascii_lowercase();
            (out.is_empty() || p.slice_from(start).len() == name.len() + 1).then_some(())?;
            out.extend([b":", &name[..]].concat());
        }
        Some(out)
    })
}

/// The keyword, the serialization of what follows it, and the parts of that. `parent` is "style" if `&` is a style rule's, or
/// else the keyword of the nearest rule that changes what is allowed. `body` is `None` for a statement.
pub(crate) fn prelude(
    source: &[u8],
    parent: &[u8],
    body: Option<&[u8]>,
    namespaces: &Namespaces,
) -> Option<Vec<Out>> {
    const MARGINS: &str = "top-left-corner top-left top-center top-right top-right-corner bottom-left-corner bottom-left bottom-center \
        bottom-right bottom-right-corner left-top left-middle left-bottom right-top right-middle right-bottom";
    let nothing: List = List::default();
    let parser = Parser {
        parent: (parent == b"style").then_some(&nothing),
        in_scope_rule: parent == b"scope",
        namespaces,
        ..Parser::default()
    };
    let is_in =
        |all: &str, name: &[u8]| all.split_ascii_whitespace().any(|it| it.as_bytes() == name);
    if source.first() != Some(&b'@') {
        body?;
        return Some(vec![
            Out::new(),
            match parent {
                b"keyframes" => written(|out| {
                    write_list(
                        &sheet::keyframe_selectors(source).unwrap_or_default(),
                        ", ",
                        out,
                        |(range, offset), out| {
                            out.extend(range.iter().flat_map(|it| it.name().bytes().chain([b' '])));
                            Lp::Fraction(*offset).write(out);
                        },
                    );
                }),
                b"function" | b"page" | b"font-feature-values" => return None,
                _ => parser.serialize(source)?,
            },
        ])
        .filter(|it| !it[1].is_empty());
    }
    let (keyword, rest) = sheet::at_rule(source);
    let path =
        |it: &Vec<Out>| written(|out| write_list(it, ".", out, |it, out| write_ident(it, out)));
    let is_allowed = match parent {
        b"style" => {
            is_in(
                "media supports container layer scope starting-style",
                &keyword,
            ) && body.is_some()
        }
        b"function" => is_in("media supports container", &keyword),
        b"page" => is_in(MARGINS, &keyword),
        b"font-feature-values" => is_in(
            "annotation character-variant ornaments styleset stylistic swash",
            &keyword,
        ),
        _ => parent != b"keyframes",
    };
    is_allowed.then_some(())?;
    let parts = match (&keyword[..], body) {
        (b"import", None) => {
            let rule = sheet::import_rule(rest)?;
            let media = condition::media_list(&rule.media).1.join(&b", "[..]);
            let mut head = written(|out| write_url(text(&rule.url), out));
            let layer = rule.layer.as_ref().map(path);
            head.extend(layer.iter().flat_map(|it| {
                if it.is_empty() {
                    b" layer".to_vec()
                } else {
                    [b" layer(", &it[..], b")"].concat()
                }
            }));
            head.extend(
                rule.supports
                    .iter()
                    .flat_map(|it| [b" supports(", &it[..], b")"].concat()),
            );
            let optional = |it: Option<Out>| it.unwrap_or(vec![0]);
            vec![
                head,
                rule.url,
                optional(layer),
                optional(rule.supports),
                media,
            ]
        }
        (b"namespace", None) => {
            let (prefix, url) = sheet::namespace_rule(rest)?;
            let head = written(|out| {
                write_ident(&prefix, out);
                out.extend_from_slice(if prefix.is_empty() { b"" } else { b" " });
                write_url(&url, out);
            });
            vec![head, prefix.into(), url.as_bytes().into()]
        }
        (b"layer", Some(_)) if rest.is_empty() => vec![Out::new()],
        (b"layer", _) => {
            let names: Vec<_> = parse_all(rest, sheet::layer_names)?
                .iter()
                .map(path)
                .collect();
            (body.is_none() || names.len() == 1)
                .then(|| [vec![names.join(&b", "[..])], names].concat())?
        }
        (_, None) => return None,
        (b"media", _) => vec![condition::media_list(rest).1.join(&b", "[..])],
        (b"supports", _) => condition::supports(
            rest,
            Parser {
                namespaces,
                ..Parser::default()
            },
        )
        .map(|_| vec![collapsed(rest)])?,
        (b"container", _) => {
            let name = |it: &Option<Str>| written(|out| it.iter().for_each(|it| it.write(out)));
            let parts: Vec<_> = condition::container_list(rest)?
                .into_iter()
                .map(|it| [name(&it.name), it.text])
                .collect();
            let head = parts
                .iter()
                .map(|it| it.join(&b' ').trim_ascii().to_vec())
                .collect::<Vec<_>>()
                .join(&b", "[..]);
            [head]
                .into_iter()
                .chain(parts.into_iter().flatten())
                .collect()
        }
        (b"scope", _) => {
            let [start, end] = sheet::scope_limits(rest, parser)?.map(|it| it.map(|it| it.1));
            let head = [
                start.as_ref().map(|it| [b"(", &it[..], b")"].concat()),
                end.as_ref().map(|it| [b"to (", &it[..], b")"].concat()),
            ];
            vec![
                head.into_iter().flatten().collect::<Vec<_>>().join(&b' '),
                start.unwrap_or(vec![0]),
                end.unwrap_or(vec![0]),
            ]
        }
        (b"page", _) => vec![page_selector(rest)?],
        (b"starting-style", _) => rest.is_empty().then(|| vec![Out::new()])?,
        _ if matches!(parent, b"page" | b"font-feature-values") => {
            rest.is_empty().then(|| vec![Out::new()])?
        }
        (_, Some(body)) => {
            let kind = AtKind::from_name(&keyword)?;
            let name = sheet::defined_name(kind, rest)?;
            let mut head = written(|out| {
                if kind == AtKind::FontFeatureValues {
                    out.extend(name.bytes())
                } else {
                    name.write(out)
                }
            });
            let mut parts = vec![name.as_bytes().to_vec()];
            if kind == AtKind::Property {
                Registered::from_rule(body, b"")?;
            } else if kind == AtKind::Function {
                let signature = Signature::parse(rest)?;
                signature.write(&mut head);
                parts.push(written(|out| signature.returns.write(out)));
                for it in signature.parameters {
                    parts.extend([
                        it.name.to_vec(),
                        written(|out| it.syntax.write(out)),
                        it.default.map_or(vec![0], |it| it.0.to_vec()),
                    ]);
                }
            }
            [vec![head], parts].concat()
        }
    };
    Some([vec![keyword], parts].concat())
}

/// The name of the range, and the offset.
pub(crate) fn keyframe_offset(source: &[u8]) -> Option<[Out; 2]> {
    let cx = Ctx::dummy();
    let value = |p: &mut P, kind| {
        attempt(p, |p| Node::parse(p, &Options::new(kind))).map(|it| it.compute(&cx, 1.0))
    };
    let (range, offset) = parse_all(source, |p| match RangeName::parse(p, &cx) {
        Some(range) => Some((range.name(), value(p, Kind::Percentage)?)),
        None => Some((
            "",
            value(p, Kind::Number).or_else(|| value(p, Kind::Percentage))?,
        )),
    })?;
    cx.deps
        .get()
        .is_empty()
        .then(|| [range.into(), offset.to_string().into()])
}

pub(crate) fn pseudo_element(source: &[u8]) -> Option<Out> {
    let written = Parser::default()
        .serialize(source)
        .filter(|it| source.starts_with(b":") && it.starts_with(b"::"))?;
    let name = &written[2..strings::index_of_char_usize(&written, b'(').unwrap_or(written.len())];
    let is_unknown = name.starts_with(b"-webkit-")
        && !name.starts_with(b"-webkit-scrollbar")
        && name != b"-webkit-resizer";
    let is_alone = name
        .iter()
        .all(|it| it.is_ascii_alphabetic() || *it == b'-')
        && (name.len() + 2 == written.len() || written.ends_with(b")"));
    (is_alone && !is_unknown && !matches!(name, b"part" | b"slotted" | b"cue")).then_some(written)
}

/// For each `var()` what is before it, the name, and the fallback or else NUL. What follows the last comes with "" twice.
pub(crate) fn split_variables(source: &[u8]) -> Vec<Out> {
    fn scan(p: &mut P, start: &mut usize, all: &mut Vec<Out>, depth: u8) {
        loop {
            let before = p.slice_from(*start);
            match p.next_including_whitespace_and_comments().copied() {
                Ok(Token::Function(name)) if eq(name, "var") => {
                    all.push(before.to_vec());
                    nested(p, |p| {
                        all.push(ident(p).unwrap_or_default().to_vec());
                        let (has_fallback, from) = (comma(p), p.position());
                        while p.next_including_whitespace_and_comments().is_ok() {}
                        all.push(if has_fallback {
                            p.slice_from(from).to_vec()
                        } else {
                            vec![0]
                        });
                        Some(())
                    });
                    *start = p.position();
                }
                Ok(
                    Token::Function(_) | Token::OpenParen | Token::OpenSquare | Token::OpenCurly,
                ) if depth < 128 => {
                    nested(p, |p| Some(scan(p, start, all, depth + 1)));
                }
                Ok(_) => {}
                Err(_) => return,
            }
        }
    }
    let (mut all, mut start) = (Vec::new(), 0);
    with_parser(source, |p| scan(p, &mut start, &mut all, 0));
    all.extend([source[start..].to_vec(), Out::new(), Out::new()]);
    all
}

/// Of any type.
pub(crate) fn simplify_math(source: &[u8]) -> Option<Out> {
    parse_all(source, |p| Node::parse_untyped(p))
        .map(|it| written(|out| it.as_specified(false).write_specified(out)))
}
