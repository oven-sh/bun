use super::child_list::{FormatChildrenResult, FormatJsxChildList, JsxChildListLayout};
use super::opening_element::FormatOpeningElement;
use super::{FormatJsxChild, write_jsx_closing_element, write_jsx_fragment_tag};
use crate::js::format::write_trailing_comments_of;
use crate::js::parentheses::expression::needs_parentheses;
use crate::js::utils::jsx::{WrapState, is_meaningful_jsx_text};
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{best_fitting, format_args, write};

/// An element or a fragment.
#[derive(Clone, Copy)]
pub(super) struct AnyJsxTagWithChildren<'a> {
    pub(super) expr: Expr<'a>,
    pub(super) jsx: Jsx<'a>,
}

impl<'a> AnyJsxTagWithChildren<'a> {
    fn span(&self) -> Span {
        self.expr.span()
    }

    fn parent(&self) -> AstNodes<'a> {
        self.expr.ast_parent()
    }

    fn format_trailing_comments(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() {
            return;
        }
        let parent = self.parent();
        let trailing_comments = if let AstNodes::ExpressionStatement(statement) = parent
            && statement.is_arrow_function_body()
        {
            // All up to the end of the arrow function
            f.comments().comments_before(parent.parent().parent().span().end)
        } else if let AstNodes::ConditionalExpression(conditional) = parent {
            match conditional.alternate() == Some(self.expr) {
                true => f.comments().comments_before(conditional.span().end),
                false => f.comments().end_of_line_comments_after(self.span().end),
            }
        } else if matches!(parent, AstNodes::TemplateLiteral(_) | AstNodes::TSTemplateLiteralType(_)) {
            f.comments().comments_before_character(self.span().end, b'}')
        } else {
            return write_trailing_comments_of(self.expr.as_ast_nodes(), f);
        };
        FormatTrailingComments::Comments(trailing_comments).fmt(f);
    }

    /// Prettier's `maybeWrapJsxElementInParens`.
    fn get_wrap_state(&self) -> WrapState {
        let is_argument = |call: Expr<'a>| call.callee() != Some(self.expr);
        match self.parent() {
            AstNodes::ArrayExpression(_)
            | AstNodes::JSXAttribute(_)
            | AstNodes::JSXExpressionContainer(_)
            | AstNodes::ConditionalExpression(_) => WrapState::NoWrap,
            AstNodes::StaticMemberExpression(member) | AstNodes::ComputedMemberExpression(member)
                if member.is_optional() =>
            {
                WrapState::NoWrap
            }
            AstNodes::CallExpression(call) | AstNodes::NewExpression(call) if is_argument(call) => WrapState::NoWrap,
            AstNodes::ExpressionStatement(statement) if !statement.is_arrow_function_body() => WrapState::NoWrap,
            _ => WrapState::WrapOnBreak,
        }
    }

    fn fmt_opening(&self, f: &mut Formatter<'a>) {
        match self.jsx.is_fragment() {
            true => write_jsx_fragment_tag(self.jsx.opening_span(), false, f),
            false => FormatOpeningElement {
                expr: self.expr,
                jsx: self.jsx,
            }
            .fmt(f),
        }
    }

    fn fmt_closing(&self, f: &mut Formatter<'a>) {
        match (self.jsx.close_tag(), self.jsx.closing_span()) {
            (Some(name), _) => write_jsx_closing_element(self.expr, name, f),
            (None, Some(span)) if self.jsx.is_fragment() => write_jsx_fragment_tag(span, true, f),
            _ => {}
        }
    }

    fn layout(&self) -> ElementLayout<'a> {
        let children = self.jsx.children();
        let Some(child) = children.first() else {
            return ElementLayout::NoChildren;
        };
        if children.len() > 1 {
            return ElementLayout::Default;
        }
        // Whitespace with a line break next to the only child makes it more than one.
        let has_whitespace = self.jsx.children_with_whitespace().count() > 1;
        if child.is_jsx_text() {
            match is_meaningful_jsx_text(child.text()) {
                true => ElementLayout::Default,
                false => ElementLayout::NoChildren,
            }
        } else if !has_whitespace
            && child.jsx_container_span().is_some()
            && matches!(child.kind(), ExprKind::Template(_) | ExprKind::TaggedTemplate(_))
        {
            ElementLayout::Template(child)
        } else {
            ElementLayout::Default
        }
    }
}

impl<'a> Format<'a> for AnyJsxTagWithChildren<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let is_suppressed = f.comments().is_suppressed(self.span().start);

        let format_tag = format_with(|f| {
            if is_suppressed {
                return FormatSuppressedNode(self.span()).fmt(f);
            }
            let format_opening = format_with(|f| self.fmt_opening(f));
            let format_closing = format_with(|f| self.fmt_closing(f));

            match self.layout() {
                ElementLayout::NoChildren => write!(f, [format_opening, format_closing]),
                ElementLayout::Template(expression) => {
                    write!(f, [format_opening, FormatJsxChild(expression), format_closing]);
                }
                ElementLayout::Default => {
                    let format_opening = format_opening.memoized();
                    let opening_breaks = format_opening.inspect(f).will_break();
                    let multiple_attributes = self.jsx.attrs().len() > 1;
                    let list_layout = match multiple_attributes || opening_breaks {
                        true => JsxChildListLayout::Multiline,
                        false => JsxChildListLayout::BestFitting,
                    };

                    match (FormatJsxChildList { layout: list_layout }).fmt_children(self.jsx, f) {
                        FormatChildrenResult::SingleChild(child) => {
                            write!(f, group(&format_args!(format_opening, child, format_closing)));
                        }
                        FormatChildrenResult::ForceMultiline(multiline) => {
                            write!(f, [format_opening, multiline, format_closing]);
                        }
                        FormatChildrenResult::BestFitting {
                            flat_children,
                            expanded_children,
                        } => {
                            let format_closing = format_closing.memoized();
                            write!(
                                f,
                                best_fitting![
                                    format_args!(format_opening, flat_children, format_closing),
                                    format_args!(format_opening, expanded_children, format_closing)
                                ]
                            );
                        }
                    }
                }
            }
        });

        let parent = self.parent();
        if matches!(parent, AstNodes::JSXElement(_) | AstNodes::JSXFragment(_)) {
            return write!(f, format_tag);
        }

        let format_with_comments = format_args!(
            format_leading_comments(self.span()),
            format_tag,
            format_with(|f| self.format_trailing_comments(f))
        );
        match self.get_wrap_state() {
            WrapState::NoWrap => write!(f, format_with_comments),
            WrapState::WrapOnBreak => {
                let needs_parentheses = needs_parentheses(self.expr, f);
                write!(
                    f,
                    group(&format_args!(
                        (!needs_parentheses).then_some(if_group_breaks(&"(")),
                        soft_block_indent(&format_with_comments),
                        (!needs_parentheses).then_some(if_group_breaks(&")"))
                    ))
                    .should_expand(should_expand(parent))
                );
            }
        }
    }
}

/// `{items.map((item) => <a />)}`: the body of an arrow function that is an argument of a call
/// that is all there is in braces.
fn should_expand(parent: AstNodes<'_>) -> bool {
    let AstNodes::ExpressionStatement(statement) = parent else {
        return false;
    };
    if !statement.is_arrow_function_body() {
        return false;
    }
    // The `FunctionBody`, and then the arrow function.
    let arrow = parent.parent().parent();
    match arrow.parent() {
        call @ AstNodes::CallExpression(_) => {
            matches!(call.parent().without_chain_expression(), AstNodes::JSXExpressionContainer(_))
        }
        _ => false,
    }
}

#[derive(Clone, Copy)]
enum ElementLayout<'a> {
    /// `<a></a>`
    NoChildren,
    /// ``<a>{`b`}</a>``: the template is written right after the tag.
    Template(Expr<'a>),
    Default,
}
