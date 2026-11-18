//! What is before the block of a rule.

use bun_css::Token;

use crate::condition;
use crate::custom::{Registered, Signature};
use crate::selector::List;
use crate::selector_parser::{Namespaces, Parser};
use crate::sheet::{self, AtKind};
use crate::values::*;

keywords! {
    Margin { TopLeftCorner = "top-left-corner", TopLeft = "top-left", TopCenter = "top-center", TopRight = "top-right",
        TopRightCorner = "top-right-corner", BottomLeftCorner = "bottom-left-corner", BottomLeft = "bottom-left",
        BottomCenter = "bottom-center", BottomRight = "bottom-right", BottomRightCorner = "bottom-right-corner", LeftTop = "left-top",
        LeftMiddle = "left-middle", LeftBottom = "left-bottom", RightTop = "right-top", RightMiddle = "right-middle",
        RightBottom = "right-bottom" }
    FeatureKind { Annotation = "annotation", Ornaments = "ornaments", Stylistic = "stylistic", Swash = "swash",
        CharacterVariant = "character-variant", Styleset = "styleset" }
}

/// The nearest rule around that changes what is allowed.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Inside {
    Sheet,
    Style,
    Scope,
    Keyframes,
    Function,
    Page,
    FontFeatureValues,
    Descriptors,
}

impl Inside {
    pub(crate) fn has_declarations(self) -> bool {
        !matches!(self, Inside::Sheet | Inside::Keyframes)
    }
}

pub(crate) struct Import {
    pub(crate) href: Out,
    modifiers: Out,
    pub(crate) layer: Option<Out>,
    pub(crate) supports: Option<Out>,
    pub(crate) media: Vec<Out>,
}

pub(crate) enum Prelude {
    Style(Out),
    Keyframe(Out),
    /// They have none.
    Declarations,
    Import(Box<Import>),
    Namespace {
        prefix: Box<[u8]>,
        url: Str,
    },
    LayerStatement(Vec<Out>),
    LayerBlock(Out),
    Media(Vec<Out>),
    Supports(Out),
    /// Each with a name and a query.
    Container(Vec<[Out; 2]>),
    Scope([Option<Out>; 2]),
    StartingStyle,
    Page(Out),
    Margin(Margin),
    Feature(FeatureKind),
    Function(Str, Signature),
    Defines(AtKind, Str),
}

pub(crate) fn written(write: impl FnOnce(&mut Out)) -> Out {
    let mut out = Out::new();
    write(&mut out);
    out
}

fn collapsed(source: &[u8]) -> Out {
    with_parser(source, |p| {
        let (mut out, mut start) = (Out::new(), 0);
        loop {
            match p.next_including_whitespace_and_comments().copied() {
                Ok(Token::Whitespace(space)) => {
                    let read = p.slice_from(start);
                    out.extend([&read[..read.len() - space.len()], b" "].concat());
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

pub(crate) fn keyframe_selector(source: &[u8]) -> Option<Out> {
    let selectors = sheet::keyframe_selectors(source)?;
    Some(written(|out| {
        write_list(&selectors, ", ", out, |(range, offset), out| {
            out.extend(range.iter().flat_map(|it| it.name().bytes().chain(*b" ")));
            Lp::Fraction(*offset).write(out);
        });
    }))
}

impl Prelude {
    /// `body` is `None` for a statement.
    pub(crate) fn parse(
        source: &[u8],
        inside: Inside,
        body: Option<&[u8]>,
        namespaces: &Namespaces,
    ) -> Option<Prelude> {
        if source.first() == Some(&b'@') {
            let (keyword, rest) = sheet::at_rule(source);
            return Prelude::parse_at_rule(&keyword, rest, inside, body, namespaces);
        }
        body?;
        match inside {
            Inside::Keyframes => keyframe_selector(source).map(Prelude::Keyframe),
            Inside::Sheet | Inside::Style | Inside::Scope => {
                Prelude::with_parser(inside, namespaces, |it| it.serialize(source))
                    .filter(|it| !it.is_empty())
                    .map(Prelude::Style)
            }
            _ => None,
        }
    }

    fn with_parser<R>(inside: Inside, namespaces: &Namespaces, run: impl FnOnce(Parser) -> R) -> R {
        let nothing = List::default();
        run(Parser {
            parent: (inside == Inside::Style).then_some(&nothing),
            in_scope_rule: inside == Inside::Scope,
            namespaces,
            ..Parser::default()
        })
    }

    pub(crate) fn parse_at_rule(
        keyword: &[u8],
        rest: &[u8],
        inside: Inside,
        body: Option<&[u8]>,
        namespaces: &Namespaces,
    ) -> Option<Prelude> {
        let is_conditional = matches!(keyword, b"media" | b"supports" | b"container");
        match inside {
            Inside::Sheet | Inside::Scope => {}
            Inside::Style => ((is_conditional
                || matches!(keyword, b"layer" | b"scope" | b"starting-style"))
                && body.is_some())
            .then_some(())?,
            Inside::Function => is_conditional.then_some(())?,
            Inside::Page => {
                return Margin::from_name(keyword)
                    .filter(|_| rest.is_empty() && body.is_some())
                    .map(Prelude::Margin);
            }
            Inside::FontFeatureValues => {
                return FeatureKind::from_name(keyword)
                    .filter(|_| rest.is_empty() && body.is_some())
                    .map(Prelude::Feature);
            }
            Inside::Keyframes | Inside::Descriptors => return None,
        }
        let path =
            |it: &Vec<Out>| written(|out| write_list(it, ".", out, |it, out| write_ident(it, out)));
        Some(match (keyword, body) {
            (b"import", None) => {
                let sheet::ImportRule {
                    url: href,
                    modifiers,
                    layer,
                    supports,
                    media,
                } = sheet::import_rule(rest)?;
                Prelude::Import(Box::new(Import {
                    href,
                    modifiers,
                    layer: layer.as_ref().map(path),
                    supports,
                    media: condition::media_list(&media).1,
                }))
            }
            (b"namespace", None) => sheet::namespace_rule(rest)
                .map(|(prefix, url)| Prelude::Namespace { prefix, url })?,
            (b"layer", Some(_)) if rest.is_empty() => Prelude::LayerBlock(Out::new()),
            (b"layer", None) => Prelude::LayerStatement(
                parse_all(rest, sheet::layer_names)?
                    .iter()
                    .map(path)
                    .collect(),
            ),
            (b"layer", _) => {
                Prelude::LayerBlock(if let [name] = &parse_all(rest, sheet::layer_names)?[..] {
                    path(name)
                } else {
                    return None;
                })
            }
            (_, None) => return None,
            (b"media", _) => Prelude::Media(condition::media_list(rest).1),
            (b"supports", _) => condition::supports(
                rest,
                Parser {
                    namespaces,
                    ..Parser::default()
                },
            )
            .map(|_| Prelude::Supports(collapsed(rest)))?,
            (b"container", _) => {
                let name = |it: &Option<Str>| written(|out| it.iter().for_each(|it| it.write(out)));
                Prelude::Container(
                    condition::container_list(rest)?
                        .into_iter()
                        .map(|it| [name(&it.name), it.text])
                        .collect(),
                )
            }
            (b"scope", _) => Prelude::Scope(
                Prelude::with_parser(inside, namespaces, |it| sheet::scope_limits(rest, it))?
                    .map(|it| it.map(|it| it.1)),
            ),
            (b"page", _) => Prelude::Page(page_selector(rest)?),
            (b"starting-style", _) => rest.is_empty().then_some(Prelude::StartingStyle)?,
            (_, Some(body)) => {
                let kind = AtKind::from_name(keyword)?;
                let name = sheet::defined_name(kind, rest)?;
                match kind {
                    AtKind::Function => Prelude::Function(name, Signature::parse(rest)?),
                    AtKind::Property => {
                        Registered::from_rule(body, b"").map(|_| Prelude::Defines(kind, name))?
                    }
                    _ => Prelude::Defines(kind, name),
                }
            }
        })
    }

    /// Without the `@`.
    pub(crate) fn keyword(&self) -> &'static str {
        match self {
            Prelude::Style(_) | Prelude::Keyframe(_) | Prelude::Declarations => "",
            Prelude::Import(_) => "import",
            Prelude::Namespace { .. } => "namespace",
            Prelude::LayerStatement(_) | Prelude::LayerBlock(_) => "layer",
            Prelude::Media(_) => "media",
            Prelude::Supports(_) => "supports",
            Prelude::Container(_) => "container",
            Prelude::Scope(_) => "scope",
            Prelude::StartingStyle => "starting-style",
            Prelude::Page(_) => "page",
            Prelude::Margin(it) => it.name(),
            Prelude::Feature(it) => it.name(),
            Prelude::Function(..) => "function",
            Prelude::Defines(kind, _) => kind.name(),
        }
    }

    /// What follows the keyword.
    pub(crate) fn write_rest(&self, out: &mut Out) {
        match self {
            Prelude::Style(it)
            | Prelude::Keyframe(it)
            | Prelude::LayerBlock(it)
            | Prelude::Supports(it)
            | Prelude::Page(it) => out.extend(it),
            Prelude::Declarations
            | Prelude::StartingStyle
            | Prelude::Margin(_)
            | Prelude::Feature(_) => {}
            Prelude::LayerStatement(all) | Prelude::Media(all) => out.extend(all.join(&b", "[..])),
            Prelude::Import(it) => {
                write_url(text(&it.href), out);
                if !it.modifiers.is_empty() {
                    out.pop();
                    out.extend([b" ", &it.modifiers[..], b")"].concat());
                }
                out.extend(it.layer.iter().flat_map(|it| {
                    if it.is_empty() {
                        b" layer".to_vec()
                    } else {
                        [b" layer(", &it[..], b")"].concat()
                    }
                }));
                out.extend(
                    it.supports
                        .iter()
                        .flat_map(|it| [b" supports(", &it[..], b")"].concat()),
                );
                out.extend_from_slice(if it.media.is_empty() { b"" } else { b" " });
                out.extend(it.media.join(&b", "[..]));
            }
            Prelude::Namespace { prefix, url } => {
                write_ident(prefix, out);
                out.extend_from_slice(if prefix.is_empty() { b"" } else { b" " });
                write_url(url, out);
            }
            Prelude::Container(all) => write_list(all, ", ", out, |it, out| {
                out.extend(it.join(&b' ').trim_ascii())
            }),
            Prelude::Scope([start, end]) => {
                let parts = [
                    start.as_ref().map(|it| [b"(", &it[..], b")"].concat()),
                    end.as_ref().map(|it| [b"to (", &it[..], b")"].concat()),
                ];
                out.extend(parts.into_iter().flatten().collect::<Vec<_>>().join(&b' '));
            }
            Prelude::Function(name, signature) => {
                name.write(out);
                signature.write(out);
            }
            Prelude::Defines(AtKind::FontFeatureValues, families) => out.extend(families.bytes()),
            Prelude::Defines(AtKind::Keyframes, name)
                if name.is_empty()
                    || crate::grammar::is_reserved(name.as_bytes())
                    || eq(name.as_bytes(), "none") =>
            {
                write_string(name.as_bytes(), out);
            }
            Prelude::Defines(_, name) => name.write(out),
        }
    }

    pub(crate) fn write(&self, out: &mut Out) {
        let keyword = self.keyword();
        if keyword.is_empty() {
            return self.write_rest(out);
        }
        out.extend([b"@", keyword.as_bytes(), b" "].concat());
        let start = out.len();
        self.write_rest(out);
        out.truncate(
            out.len() - usize::from(out.len() == start && !matches!(self, Prelude::Media(_))),
        );
    }

    /// It has rules, and no declarations of its own.
    pub(crate) fn is_group(&self) -> bool {
        use Prelude as P;
        matches!(
            self,
            P::Media(_)
                | P::Supports(_)
                | P::Container(_)
                | P::LayerBlock(_)
                | P::Scope(_)
                | P::StartingStyle
                | P::Defines(AtKind::Keyframes, _)
        )
    }

    /// What its rules are inside of.
    pub(crate) fn contents_inside(&self, outer: Inside) -> Inside {
        match self {
            Prelude::Style(_) | Prelude::Keyframe(_) | Prelude::Declarations => Inside::Style,
            Prelude::Scope(_) => Inside::Scope,
            Prelude::Page(_) => Inside::Page,
            Prelude::Function(..) => Inside::Function,
            Prelude::Defines(AtKind::Keyframes, _) => Inside::Keyframes,
            Prelude::Defines(AtKind::FontFeatureValues, _) => Inside::FontFeatureValues,
            _ if self.is_group() => outer,
            _ => Inside::Descriptors,
        }
    }
}
