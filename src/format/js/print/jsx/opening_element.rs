use super::FormatJsxName;
use crate::js::print::type_parameters::type_arguments;
use crate::js::utils::tailwindcss::loses_line_breaks;
use crate::prelude::*;
use crate::text::is_next_line_empty;
use crate::{format_args, write};

/// `<a b="c">`, `<a b="c" />`
pub(super) struct FormatOpeningElement<'a> {
    pub(super) expr: Expr<'a>,
    pub(super) jsx: Jsx<'a>,
}

/// The value in `a="b"`.
fn as_string_literal_attribute_value(attribute: Prop<'_>) -> Option<Expr<'_>> {
    attribute.value().filter(|value| {
        attribute.kind() != PropKind::Spread
            && value.jsx_container_span().is_none()
            && matches!(value.kind(), ExprKind::String(_))
    })
}

fn has_line_break<'a>(string: Expr<'a>, f: &Formatter<'a>) -> bool {
    bun_core::strings::index_of_any(string.text(), b"\r\n").is_some()
        && !loses_line_breaks(string, f)
}

/// ```jsx
/// <// comment       <// comment
/// a                 a />
/// />
/// ```
///
/// Prettier is on the left: any comment on the name or the type arguments counts. oxfmt is on the right.
fn only_comment_after_name_counts(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

impl<'a> FormatOpeningElement<'a> {
    /// `<a b /⏎// comment⏎>`. oxfmt only: see `handle_comment_after_slash_of_jsx_tag_for_oxfmt`.
    fn comments_after_slash(&self, f: &Formatter<'a>) -> CommentList<'a> {
        (f.comments())
            .of_node(AstNodes::JSXOpeningElement(self.expr))
            .dangling
    }

    fn compute_layout(&self, f: &Formatter<'a>) -> OpeningElementLayout {
        let attributes = self.jsx.attrs();
        let comments = f.comments();
        let (mut name_has_comments, mut last_attribute_has_trailing_comments) = (false, false);
        let mut only_attribute_has_comments = false;
        if !f.is_quiet() {
            let type_arguments = AstNodes::TSTypeParameterInstantiation(Node::Expr(self.expr));
            let name = self.jsx.tag().map(|name| name.as_ast_nodes());
            name_has_comments = match only_comment_after_name_counts(f) {
                true => (!self.jsx.type_args().is_empty())
                    .then_some(type_arguments)
                    .or(name)
                    .is_some_and(|last| !comments.of_node(last).trailing.is_empty()),
                false => {
                    name.is_some_and(|name| comments.has_comments(name))
                        || comments.has_comments(type_arguments)
                }
            };
            if let Some(last) = attributes.last() {
                let comments = comments.of_node(last.as_ast_nodes());
                let has_comments_after_slash = !self.comments_after_slash(f).is_empty();
                last_attribute_has_trailing_comments =
                    !comments.trailing.is_empty() || has_comments_after_slash;
                only_attribute_has_comments = !comments.is_empty() || has_comments_after_slash;
            }
        }

        if self.jsx.is_self_closing() && attributes.is_empty() && !name_has_comments {
            OpeningElementLayout::Inline
        } else if attributes.len() == 1
            && !name_has_comments
            && !only_attribute_has_comments
            && attributes
                .first()
                .and_then(as_string_literal_attribute_value)
                .is_some_and(|it| !has_line_break(it, f))
        {
            OpeningElementLayout::SingleStringAttribute
        } else {
            OpeningElementLayout::IndentAttributes {
                name_has_comments,
                last_attribute_has_trailing_comments,
            }
        }
    }
}

impl<'a> Format<'a> for FormatOpeningElement<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (e, jsx) = (self.expr, self.jsx);
        let is_self_closing = jsx.is_self_closing();
        let attributes = jsx.attrs();

        let format_open = format_args!(
            "<",
            jsx.tag().map(FormatJsxName),
            type_arguments(jsx.type_args(), Node::Expr(e))
        );
        let format_close = format_args!(is_self_closing.then_some("/"), ">");
        let format_attributes = format_with(|f| {
            let line_break = match f.options().attribute_position {
                AttributePosition::Multiline if attributes.len() > 1 => hard_line_break(),
                _ => soft_line_break_or_space(),
            };
            let mut previous: Option<Prop<'a>> = None;
            for attribute in attributes {
                // Keep an empty line between two attributes.
                match previous.replace(attribute) {
                    Some(previous)
                        if is_next_line_empty(
                            f.source_text().as_bytes(),
                            previous.span().end as usize,
                        ) =>
                    {
                        write!(f, empty_line());
                    }
                    Some(_) => write!(f, line_break),
                    None => {}
                }
                write!(f, attribute);
            }
        });

        match self.compute_layout(f) {
            OpeningElementLayout::Inline => write!(f, [format_open, space(), format_close]),
            OpeningElementLayout::SingleStringAttribute => {
                // Nothing in the group breaks. It's a group because that's what a fill measures after a line break.
                write!(
                    f,
                    group(&format_args!(
                        format_open,
                        space(),
                        format_attributes,
                        is_self_closing.then_some(space()),
                        format_close
                    ))
                );
            }
            OpeningElementLayout::IndentAttributes {
                name_has_comments,
                last_attribute_has_trailing_comments,
            } => {
                let format_inner = format_with(|f| {
                    write!(f, format_open);
                    if !attributes.is_empty() {
                        write!(f, soft_line_indent_or_space(&format_attributes));
                    }
                    if !f.is_quiet() {
                        write!(
                            f,
                            FormatTrailingComments::Comments(self.comments_after_slash(f))
                        );
                    }
                    // Prettier's `shouldPrintBracketSameLine`
                    let bracket_same_line = match attributes.is_empty() {
                        true => !name_has_comments,
                        false => {
                            f.options().bracket_same_line.value()
                                && !last_attribute_has_trailing_comments
                        }
                    };
                    if is_self_closing {
                        write!(f, [soft_line_break_or_space(), format_close]);
                    } else if bracket_same_line {
                        write!(f, format_close);
                    } else {
                        write!(f, [soft_line_break(), format_close]);
                    }
                });

                let has_multiline_string_attribute = attributes
                    .iter()
                    .filter_map(as_string_literal_attribute_value)
                    .any(|it| has_line_break(it, f));
                write!(
                    f,
                    group(&format_inner).should_expand(has_multiline_string_attribute)
                );
            }
        }
    }
}

#[derive(Copy, Clone, Debug)]
enum OpeningElementLayout {
    /// `<a />`
    Inline,
    /// `<a b="c">`, which never breaks.
    SingleStringAttribute,
    /// Each attribute goes on its own line if they don't all fit on one.
    IndentAttributes {
        name_has_comments: bool,
        last_attribute_has_trailing_comments: bool,
    },
}
