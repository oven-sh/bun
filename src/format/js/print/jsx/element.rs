use super::child_list::{FormatChildrenResult, format_children};
use super::opening_element::FormatOpeningElement;
use super::{FormatJsxChild, write_jsx_closing_element, write_jsx_fragment_tag};
use crate::js::attach::Marker;
use crate::js::format::format_node;
use crate::js::parentheses::expression::needs_parentheses;
use crate::js::print::class::dangling_comments_with_marker;
use crate::js::print::flow::is_match_expression_case;
use crate::js::utils::jsx::WrapState;
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

    /// The comments inside `<>`, which have no marker, or inside `</>`.
    fn comments_in_fragment_tag(&self, marker: Marker, f: &Formatter<'a>) -> CommentList<'a> {
        match f.is_quiet() {
            true => CommentList::empty(),
            false => dangling_comments_with_marker(self.expr.as_ast_nodes(), marker, f),
        }
    }

    /// Prettier's `isNoWrapParent`.
    fn get_wrap_state(&self, parent: AstNodes<'a>) -> WrapState {
        match parent {
            AstNodes::ArrayExpression(_)
            | AstNodes::JSXAttribute(_)
            | AstNodes::JSXElement(_)
            | AstNodes::JSXExpressionContainer(_)
            | AstNodes::JSXFragment(_)
            | AstNodes::ConditionalExpression(_)
            | AstNodes::CallExpression(_)
            | AstNodes::NewExpression(_)
            | AstNodes::Program(_) => WrapState::NoWrap,
            AstNodes::ExpressionStatement(statement) if !statement.is_arrow_function_body() => {
                WrapState::NoWrap
            }
            AstNodes::ObjectProperty(case) if is_match_expression_case(case) => WrapState::NoWrap,
            _ => WrapState::WrapOnBreak,
        }
    }

    /// Prettier's `maybeWrapJsxElementInParens`.
    fn fmt_in_parentheses(&self, element: &impl Format<'a>, f: &mut Formatter<'a>) {
        let parent = self.parent();
        match self.get_wrap_state(parent) {
            WrapState::NoWrap => write!(f, element),
            WrapState::WrapOnBreak => {
                let needs_parentheses = needs_parentheses(self.expr, f);
                write!(
                    f,
                    group(&format_args!(
                        (!needs_parentheses).then_some(if_group_breaks(&"(")),
                        soft_block_indent(element),
                        (!needs_parentheses).then_some(if_group_breaks(&")"))
                    ))
                    .should_expand(should_expand(parent))
                );
            }
        }
    }

    fn fmt_opening(&self, f: &mut Formatter<'a>) {
        match self.jsx.is_fragment() {
            true => {
                let comments = self.comments_in_fragment_tag(Marker::None, f);
                write_jsx_fragment_tag(self.jsx.opening_span(), comments, false, f);
            }
            false => FormatOpeningElement {
                expr: self.expr,
                jsx: self.jsx,
            }
            .fmt(f),
        }
    }

    fn fmt_closing(&self, f: &mut Formatter<'a>) {
        match (self.jsx.close_tag(), self.jsx.closing_span()) {
            (Some(name), _) => write_jsx_closing_element(name, f),
            (None, Some(tag)) if self.jsx.is_fragment() => {
                let comments = self.comments_in_fragment_tag(Marker::ClosingFragment, f);
                write_jsx_fragment_tag(tag, comments, true, f);
            }
            _ => {}
        }
    }

    fn layout(&self) -> ElementLayout<'a> {
        let mut children = self.jsx.children_with_whitespace();
        match (children.next(), children.next()) {
            (None, _) if !self.jsx.is_fragment() => ElementLayout::NoChildren,
            (Some(JsxChild::Whitespace(_)), None) if !self.jsx.is_fragment() => {
                ElementLayout::NoChildren
            }
            (Some(JsxChild::Expr(child)), None)
                if child.jsx_container_span().is_some()
                    && matches!(
                        child.kind(),
                        ExprKind::Template(_) | ExprKind::TaggedTemplate(_)
                    ) =>
            {
                ElementLayout::Template(child)
            }
            _ => ElementLayout::Default,
        }
    }
}

impl<'a> AnyJsxTagWithChildren<'a> {
    /// Prettier's `printJsxElementInternal`.
    fn fmt_tags_and_children(&self, f: &mut Formatter<'a>) {
        let format_opening = format_with(|f| self.fmt_opening(f));
        let format_closing = format_with(|f| self.fmt_closing(f));

        match self.layout() {
            ElementLayout::NoChildren => write!(f, [format_opening, format_closing]),
            ElementLayout::Template(expression) => {
                write!(
                    f,
                    [format_opening, FormatJsxChild(expression), format_closing]
                );
            }
            ElementLayout::Default => {
                let format_opening = format_opening.memoized();
                let opening_breaks = format_opening.inspect(f).will_break();
                let multiple_attributes = self.jsx.attrs().len() > 1;

                // Prettier's `isMdxBlock`
                let is_mdx_block = f.options().is_mdx_jsx && self.span().start == 0;
                match format_children(
                    self.jsx,
                    multiple_attributes || opening_breaks,
                    is_mdx_block,
                    f,
                ) {
                    FormatChildrenResult::ForceMultiline(children)
                    | FormatChildrenResult::BestFitting {
                        expanded_children: children,
                        ..
                    } if is_mdx_block => children.fmt_content(f),
                    FormatChildrenResult::SingleChild(child) => {
                        write!(
                            f,
                            group(&format_args!(format_opening, child, format_closing))
                        );
                    }
                    FormatChildrenResult::ForceMultiline(multiline) => {
                        write!(
                            f,
                            group(&format_args!(format_opening, multiline, format_closing))
                        );
                    }
                    FormatChildrenResult::BestFitting {
                        flat_children,
                        expanded_children,
                    } => {
                        let format_closing = format_closing.memoized();
                        write!(
                            f,
                            best_fitting![
                                group(&format_args!(format_opening, flat_children, format_closing)),
                                group(&format_args!(
                                    format_opening,
                                    expanded_children, format_closing
                                ))
                            ]
                        );
                    }
                }
            }
        }
    }

    /// The source text of an element with a `prettier-ignore` comment, along with the element's comments.
    fn fmt_ignored(&self, f: &mut Formatter<'a>) {
        let skip_trailing_comments = f.context_mut().take_skip_trailing_comments();
        let comments = f.comments().of_node(self.expr.as_ast_nodes());
        write!(
            f,
            [
                FormatLeadingComments::Comments(comments.leading),
                FormatSuppressedNode(self.span()),
                (!skip_trailing_comments)
                    .then_some(FormatTrailingComments::Comments(comments.trailing))
            ]
        );
    }
}

impl<'a> Format<'a> for AnyJsxTagWithChildren<'a> {
    /// Prettier's `printJsxElement`: the element's comments go inside the parentheses.
    fn fmt(&self, f: &mut Formatter<'a>) {
        let node = self.expr.as_ast_nodes();
        if !f.is_quiet() && f.comments().is_ignored(node) {
            return self.fmt_in_parentheses(&format_with(|f| self.fmt_ignored(f)), f);
        }
        let format_with_comments =
            format_with(|f| format_node(node, f, |f| self.fmt_tags_and_children(f)));
        self.fmt_in_parentheses(&format_with_comments, f);
    }
}

/// ```jsx
/// a = (                      a =
///   // prettier-ignore         // prettier-ignore
///   <b   />                    <b   />;
/// );
/// ```
///
/// oxfmt is on the left, Prettier on the right.
pub(crate) fn ignored_jsx_gets_no_parentheses(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// `{items.map((item) => <a />)}`: the body of an arrow function that's an argument of a call, where the call is the
/// only thing in the braces.
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
        call @ AstNodes::CallExpression(e) => {
            e.callee()
                .is_none_or(|callee| callee.span() != arrow.span())
                && matches!(
                    call.parent().without_chain_expression(),
                    AstNodes::JSXExpressionContainer(_)
                )
        }
        _ => false,
    }
}

#[derive(Clone, Copy)]
enum ElementLayout<'a> {
    /// `<a></a>`
    NoChildren,
    /// ``<a>{`b`}</a>``: the template is printed right after the tag.
    Template(Expr<'a>),
    Default,
}
