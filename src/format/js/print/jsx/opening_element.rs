use super::FormatJsxName;
use crate::js::utils::array::is_next_line_empty;
use crate::js::print::type_parameters::type_arguments;
use crate::prelude::*;
use crate::{format_args, write};

/// `<a b="c">`, `<a b="c" />`
pub(super) struct FormatOpeningElement<'a> {
    pub(super) expr: Expr<'a>,
    pub(super) jsx: Jsx<'a>,
}

/// The value of `a="b"`.
fn as_string_literal_attribute_value(attribute: Prop<'_>) -> Option<Expr<'_>> {
    attribute.value().filter(|value| {
        attribute.kind() != PropKind::Spread
            && value.jsx_container_span().is_none()
            && matches!(value.kind(), ExprKind::String(_))
    })
}

fn has_line_break(string: Expr<'_>) -> bool {
    bun_core::strings::contains_char(string.text(), b'\n')
}

impl<'a> FormatOpeningElement<'a> {
    fn compute_layout(&self, f: &Formatter<'a>) -> OpeningElementLayout {
        let attributes = self.jsx.attrs();
        let span = self.jsx.opening_span();
        let comments = f.comments();

        let last_attribute_has_comment =
            attributes.last().is_some_and(|a| comments.has_comment_in_range(a.span().end, span.end));
        let type_arguments_or_name_end = (self.jsx.type_args().angle_brackets_span())
            .or_else(|| self.jsx.tag().map(|it| it.span()))
            .map_or(span.start, |it| it.end);
        let first_attribute_start_or_element_end = attributes.first().map_or(span.end, |a| a.span().start);
        let name_has_comment =
            comments.has_comment_in_range(type_arguments_or_name_end, first_attribute_start_or_element_end);

        if self.jsx.is_self_closing() && attributes.is_empty() && !name_has_comment {
            OpeningElementLayout::Inline
        } else if attributes.len() == 1
            && !name_has_comment
            && !last_attribute_has_comment
            && attributes.first().and_then(as_string_literal_attribute_value).is_some_and(|it| !has_line_break(it))
        {
            OpeningElementLayout::SingleStringAttribute
        } else {
            OpeningElementLayout::IndentAttributes {
                name_has_comment,
                last_attribute_has_comment,
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
            jsx.tag().map(|name| FormatJsxName {
                name,
                parent: AstNodes::JSXOpeningElement(e)
            }),
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
                // An empty line between two attributes is kept.
                match previous.replace(attribute) {
                    Some(previous) if is_next_line_empty(f.source_text().as_bytes(), previous.span().end as usize) => {
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
                write!(f, [format_open, space(), format_attributes, is_self_closing.then_some(space()), format_close]);
            }
            OpeningElementLayout::IndentAttributes {
                name_has_comment,
                last_attribute_has_comment,
            } => {
                let format_inner = format_with(|f| {
                    write!(f, format_open);
                    if !attributes.is_empty() {
                        write!(f, soft_line_indent_or_space(&format_attributes));
                    }
                    let comments = f.comments().comments_before(jsx.opening_span().end);
                    FormatTrailingComments::Comments(comments).fmt(f);

                    let force_bracket_same_line = f.options().bracket_same_line.value();
                    let wants_bracket_same_line = attributes.is_empty() && !name_has_comment;

                    if is_self_closing {
                        write!(f, [soft_line_break_or_space(), format_close]);
                    } else if last_attribute_has_comment {
                        write!(f, [soft_line_break(), format_close]);
                    } else if (force_bracket_same_line && !attributes.is_empty()) || wants_bracket_same_line {
                        write!(f, format_close);
                    } else {
                        write!(f, [soft_line_break(), format_close]);
                    }
                });

                let has_multiline_string_attribute =
                    attributes.iter().any(|it| as_string_literal_attribute_value(it).is_some_and(has_line_break));
                write!(f, group(&format_inner).should_expand(has_multiline_string_attribute));
            }
        }
    }
}

#[derive(Copy, Clone, Debug)]
enum OpeningElementLayout {
    /// `<a />`
    Inline,
    /// `<a b="c">`: it never breaks.
    SingleStringAttribute,
    /// Each attribute is on its own line if they do not fit on one.
    IndentAttributes {
        name_has_comment: bool,
        last_attribute_has_comment: bool,
    },
}
