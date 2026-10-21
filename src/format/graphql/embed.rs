//! GraphQL in JavaScript templates: Prettier's `language-js/embed/graphql.js`.

use super::comments::{self, Attached};
use super::parser::{self, Tree};
use super::printer::Builder;
use crate::ir::element::LineMode;
use crate::js::print::template::write_embedded_template_expression;
use crate::prelude::*;
use smallvec::SmallVec;

fn is_identifier(e: Expr<'_>, names: &[&[u8]]) -> bool {
    matches!(e.kind(), ExprKind::Ident(_)) && names.contains(&e.text())
}

/// Returns the nodes whose leading comments can specify the language of the template `e`: the template itself, and an
/// expression statement or an `as const` directly around it.
fn nodes_with_language_comment<'a>(e: Expr<'a>, parent: AstNodes<'a>) -> [Option<AstNodes<'a>>; 2] {
    let includes_parent = match parent {
        AstNodes::ExpressionStatement(_) => true,
        AstNodes::TSAsExpression(cast) => matches!(cast.kind(), ExprKind::AsConst(_)),
        _ => false,
    };
    [Some(e.as_ast_nodes()), includes_parent.then_some(parent)]
}

/// True if a comment could specify the language of the template `e`. A cheap check before trying each embedded
/// language.
pub(crate) fn may_have_language_comment<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    (nodes_with_language_comment(e, e.ast_parent())
        .into_iter()
        .flatten())
    .any(|node| !f.comments().of_node(node).leading.is_empty())
}

/// Prettier's `hasLanguageComment`: `/* GraphQL */ `..``. `language` is the text between the `/*` and the `*/`.
pub(crate) fn has_language_comment<'a>(
    e: Expr<'a>,
    parent: AstNodes<'a>,
    language: &[u8],
    f: &Formatter<'a>,
) -> bool {
    (nodes_with_language_comment(e, parent).into_iter().flatten()).any(|node| {
        (f.comments().of_node(node).leading.iter())
            .any(|comment| comment.is_block() && comment.content() == language)
    })
}

/// Prettier's `isEmbedGraphQL`. `e` is a template.
pub(crate) fn is_embed_graphql<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let parent = e.ast_parent();
    let is_marked = match parent {
        AstNodes::TaggedTemplateExpression(tagged) => match tagged.kind() {
            ExprKind::TaggedTemplate(call) if f.options().flavor.is_oxfmt() => matches!(
                crate::css::embed::root_name_of_tag(call.callee()),
                Some(b"gql" | b"graphql")
            ),
            ExprKind::TaggedTemplate(call) => match call.callee().kind() {
                ExprKind::Dot { obj, name, .. } => {
                    matches!(
                        call.callee().as_ast_nodes(),
                        AstNodes::StaticMemberExpression(_)
                    ) && is_identifier(obj, &[b"graphql"])
                        && name.bytes() == b"experimental"
                }
                _ => is_identifier(call.callee(), &[b"gql", b"graphql"]),
            },
            _ => false,
        },
        AstNodes::CallExpression(call) => call
            .callee()
            .is_some_and(|callee| is_identifier(callee, &[b"graphql"])),
        _ => false,
    };
    is_marked || has_language_comment(e, parent, b" GraphQL ", f)
}

/// The text between two substitutions.
struct Part<'a> {
    text: &'a [u8],
    content: Content,
    starts_with_blank_line: bool,
    ends_with_blank_line: bool,
}

enum Content {
    Nothing,
    Comments,
    Document(Tree, Vec<Attached>),
}

fn lines(text: &[u8]) -> impl DoubleEndedIterator<Item = &[u8]> + Clone {
    bun_core::strings::split(text, b"\n")
        .collect::<SmallVec<[&[u8]; 16]>>()
        .into_iter()
}

/// Returns `None` if Prettier leaves the template as it is.
fn parse_part<'a>(template: Template<'a>, index: usize) -> Option<Part<'a>> {
    let raw = template.raw(index);
    let raw_equals_cooked = bun_core::strings::index_of_any(raw, b"\\\r").is_none();
    let text = if raw_equals_cooked {
        raw
    } else {
        template.cooked(index)?.bytes()
    };
    // An escape can produce a lone surrogate, which isn't a valid GraphQL character.
    if !raw_equals_cooked && std::str::from_utf8(text).is_err() {
        return None;
    }
    let is_last = index + 1 == template.quasi_count();

    let all = lines(text);
    // A substitution in a comment.
    if !is_last
        && all
            .clone()
            .next_back()
            .is_some_and(|line| bun_core::strings::contains_char(line, b'#'))
    {
        return None;
    }
    let count = all.clone().count();
    let has_only_comments = all
        .clone()
        .all(|line| matches!(bun_core::strings::trim_js_whitespace(line), [] | [b'#', ..]));
    let content = if !has_only_comments {
        let (mut tree, mut attached) = (Tree::default(), Vec::new());
        parser::parse(text, &mut tree).ok()?;
        comments::attach(text, &tree, &mut attached);
        Content::Document(tree, attached)
    } else if bun_core::strings::is_all_js_whitespace(text) {
        Content::Nothing
    } else {
        Content::Comments
    };
    Some(Part {
        text,
        content,
        starts_with_blank_line: count > 2
            && all
                .clone()
                .take(2)
                .all(bun_core::strings::is_all_js_whitespace),
        ends_with_blank_line: count > 2
            && all
                .rev()
                .take(2)
                .all(bun_core::strings::is_all_js_whitespace),
    })
}

fn is_candidate<'a>(e: Expr<'a>, template: Template<'a>, f: &Formatter<'a>) -> bool {
    matches!(
        f.options().embedded_language_formatting,
        EmbeddedLanguageFormatting::Auto
    ) && is_embed_graphql(e, f)
        && (0..template.quasi_count()).all(|index| template.cooked(index).is_some())
}

fn is_blank_template(template: Template<'_>) -> bool {
    template.quasi_count() == 1 && bun_core::strings::is_all_js_whitespace(template.raw(0))
}

fn parse<'a>(template: Template<'a>) -> Option<SmallVec<[Part<'a>; 2]>> {
    (0..template.quasi_count())
        .map(|index| parse_part(template, index))
        .collect()
}

/// True if `e` is a template, tagged or not, that's formatted as GraphQL and isn't just ` `` `. In Prettier, its
/// document then has the label `embed`.
pub(crate) fn has_embed_label<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let quasi = match e.kind() {
        ExprKind::TaggedTemplate(call) => call.template(),
        _ => Some(e),
    };
    let Some((quasi, ExprKind::Template(template))) = quasi.map(|quasi| (quasi, quasi.kind()))
    else {
        return false;
    };
    is_candidate(quasi, template, f)
        && (crate::css::embed::tag_alone_decides_template_layout(f)
            || (!is_blank_template(template) && parse(template).is_some()))
}

/// The line breaks between the parts that Prettier's `printEmbedGraphQL` joins.
#[derive(Default)]
struct Separator {
    is_needed: bool,
    has_blank_line: bool,
}

impl Separator {
    fn write(&mut self, f: &mut Formatter<'_>) {
        if self.is_needed {
            let mode = if self.has_blank_line {
                LineMode::Empty
            } else {
                LineMode::Hard
            };
            f.write_element(FormatElement::Line(mode));
        }
        *self = Separator {
            is_needed: true,
            has_blank_line: false,
        };
    }
}

/// Writes the template `e` as GraphQL if Prettier treats it as GraphQL. Returns true if it did.
pub(crate) fn write_template<'a>(
    e: Expr<'a>,
    template: Template<'a>,
    f: &mut Formatter<'a>,
) -> bool {
    if !is_candidate(e, template, f) {
        return false;
    }
    if is_blank_template(template) {
        f.write_token("``");
        return true;
    }
    let Some(parts) = parse(template) else {
        return false;
    };

    f.write_token("`");
    f.write_element(FormatElement::Tag(Tag::StartIndent));
    f.write_element(FormatElement::Line(LineMode::Hard));
    let mut separator = Separator::default();
    let empty = Tree::default();
    for (index, part) in parts.iter().enumerate() {
        let (is_first, is_last) = (index == 0, index + 1 == parts.len());
        let (tree, attached) = match &part.content {
            Content::Document(tree, attached) => (tree, attached.as_slice()),
            _ => (&empty, [].as_slice()),
        };
        if matches!(part.content, Content::Nothing) {
            separator.has_blank_line |= !is_first && !is_last && part.starts_with_blank_line;
        } else {
            separator.has_blank_line |= !is_first && part.starts_with_blank_line;
            separator.write(f);
            let mut builder = Builder {
                text: part.text,
                tree,
                attached,
                f,
                is_in_template: true,
            };
            match part.content {
                Content::Document(..) => builder.print_definitions(),
                _ => builder.print_comment_lines(),
            }
            separator.has_blank_line |= !is_last && part.ends_with_blank_line;
        }
        if !is_last {
            separator.write(f);
            write_embedded_template_expression(template, index, f);
        }
    }
    f.write_element(FormatElement::Tag(Tag::EndIndent));
    f.write_element(FormatElement::Line(LineMode::Hard));
    f.write_token("`");
    true
}
