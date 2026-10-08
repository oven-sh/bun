//! GraphQL in the templates of JavaScript: Prettier's `language-js/embed/graphql.js`.

use super::comments::{self, Attached};
use super::parser::{self, Tree};
use super::printer::Builder;
use super::{is_blank, trim};
use crate::ir::element::LineMode;
use crate::js::print::template::write_embedded_template_expression;
use crate::prelude::*;
use smallvec::SmallVec;

fn is_identifier(e: Expr<'_>, names: &[&[u8]]) -> bool {
    matches!(e.kind(), ExprKind::Ident(_)) && names.contains(&e.text())
}

/// Whether a block comment with exactly `language` in it, like ` GraphQL `, is right before `start`, with nothing
/// but other comments between. `is_statement`: a statement starts at `start`, and empty statements before it are
/// nothing either.
fn follows_language_comment(
    start: u32,
    is_statement: bool,
    language: &[u8],
    f: &Formatter<'_>,
) -> bool {
    let source = f.source_text();
    let unprinted = f.comments().comments_before(start);
    let (mut position, mut has_empty_statement) = (start, false);
    let mut comments = unprinted
        .iter()
        .rev()
        .chain(f.comments().printed_comments().iter().rev());
    while let Some(comment) = comments.next() {
        if comment.span.end > position {
            return false;
        }
        let between = source.text_for(&Span::after(comment.span, position));
        if !is_blank(between) {
            if !is_statement || !bun_core::strings::split(between, b";").all(is_blank) {
                return false;
            }
            has_empty_statement = true;
        }
        position = comment.span.start;
        if !comment.is_block() || source.text_for(&comment.content_span()) != language {
            continue;
        }
        if !has_empty_statement {
            return true;
        }
        // Behind a statement on the same line, it trails that. So do the comments before it.
        let mut first = comment;
        for previous in comments {
            if first.preceded_by_newline()
                || !is_blank(source.text_for(&previous.span.between(first.span)))
            {
                break;
            }
            first = previous;
        }
        return first.preceded_by_newline()
            || matches!(
                trim(source.text_for(&Span::before(0, first.span))),
                [] | [.., b'{']
            );
    }
    false
}

/// Whether the comment leads `e`. A comment leads the outermost of the nodes that start behind it, and
/// parentheses are not nodes.
fn is_led_by_language_comment<'a>(
    e: Expr<'a>,
    parent: AstNodes<'a>,
    language: &[u8],
    f: &Formatter<'a>,
) -> bool {
    let outer_start = e.outer_span().start;
    (e.is_parenthesized() && follows_language_comment(e.span().start, false, language, f))
        || (parent.span().start != outer_start
            && follows_language_comment(outer_start, false, language, f))
}

/// Whether a comment is before `e`, with nothing but white space, `(`, `;` and comments between. No other comment says what
/// language the template `e` is in.
pub(crate) fn is_behind_comment<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let start = e.span().start;
    let comments = f.comments();
    let nearest = comments
        .comments_before(start)
        .last()
        .or_else(|| comments.printed_comments().last());
    nearest.is_some_and(|comment| {
        comment.span.end > start
            || f.source_text()
                .text_for(&Span::after(comment.span, start))
                .iter()
                .all(|byte| matches!(byte, b'(' | b';' | 0x80..) || byte.is_ascii_whitespace())
    })
}

/// Prettier's `hasLanguageComment`. `language`: what is between the `/*` and the `*/`.
pub(crate) fn has_language_comment<'a>(
    e: Expr<'a>,
    parent: AstNodes<'a>,
    language: &[u8],
    f: &Formatter<'a>,
) -> bool {
    is_behind_comment(e, f)
        && (is_led_by_language_comment(e, parent, language, f)
            || match parent {
                AstNodes::ExpressionStatement(_) => {
                    follows_language_comment(parent.span().start, true, language, f)
                }
                AstNodes::TSAsExpression(cast) => {
                    matches!(cast.kind(), ExprKind::AsConst(_))
                        && is_led_by_language_comment(cast, parent.parent(), language, f)
                }
                _ => false,
            })
}

/// Prettier's `isEmbedGraphQL`. `e`: a template.
pub(crate) fn is_embed_graphql<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let parent = e.ast_parent();
    let is_marked = match parent {
        AstNodes::TaggedTemplateExpression(tagged) => match tagged.kind() {
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

/// `None`: Prettier leaves the template as it is.
fn parse_part<'a>(template: Template<'a>, index: usize) -> Option<Part<'a>> {
    let raw = template.raw(index);
    let is_as_written = bun_core::strings::index_of_any(raw, b"\\\r").is_none();
    let text = if is_as_written {
        raw
    } else {
        template.cooked(index)?.bytes()
    };
    // Half of a surrogate pair, which an escape can stand for, is no character of GraphQL.
    if !is_as_written && std::str::from_utf8(text).is_err() {
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
        .all(|line| matches!(trim(line), [] | [b'#', ..]));
    let content = if !has_only_comments {
        let (mut tree, mut attached) = (Tree::default(), Vec::new());
        parser::parse(text, &mut tree).ok()?;
        comments::attach(text, &tree, &mut attached);
        Content::Document(tree, attached)
    } else if is_blank(text) {
        Content::Nothing
    } else {
        Content::Comments
    };
    Some(Part {
        text,
        content,
        starts_with_blank_line: count > 2 && all.clone().take(2).all(is_blank),
        ends_with_blank_line: count > 2 && all.rev().take(2).all(is_blank),
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
    template.quasi_count() == 1 && is_blank(template.raw(0))
}

fn parse<'a>(template: Template<'a>) -> Option<SmallVec<[Part<'a>; 2]>> {
    (0..template.quasi_count())
        .map(|index| parse_part(template, index))
        .collect()
}

/// Whether `e` is a template, with or without a tag, that is written as GraphQL and is more than ` `` `:
/// for Prettier, its document has the label `embed`.
pub(crate) fn has_embed_label<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let quasi = match e.kind() {
        ExprKind::TaggedTemplate(call) => call.template(),
        _ => Some(e),
    };
    let Some((quasi, ExprKind::Template(template))) = quasi.map(|quasi| (quasi, quasi.kind()))
    else {
        return false;
    };
    is_candidate(quasi, template, f) && !is_blank_template(template) && parse(template).is_some()
}

/// The line breaks between what Prettier's `printEmbedGraphQL` joins.
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

/// Writes the template `e` as GraphQL, if that is what Prettier takes it for. Returns whether it has.
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
