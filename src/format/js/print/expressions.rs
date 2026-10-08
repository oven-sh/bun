//! The expressions that take only a few lines each.

use super::class::format_grouped_parameters_with_return_type_for_method;
use super::function::FormatFunctionBody;
use super::object_like::ObjectLike;
use super::object_pattern_like::ObjectPatternLike;
use crate::js::format::FormatExpr;
use crate::js::parentheses::expression::left_edge_end;
use crate::js::utils::array::write_array_node;
use crate::js::utils::assignment_like::AssignmentLike;
use crate::js::utils::conditional::ConditionalLike;
use crate::js::utils::object::{format_computed_or_property_key, should_preserve_quote};
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{best_fitting, format_args, write};

/// All of `a?.b.c`.
pub(crate) fn write_chain_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    FormatExpr::in_chain_expression(e).fmt(f);
}

/// `{ a: 1 }`
pub(crate) fn write_object_expression<'a>(e: Expr<'a>, props: List<'a, Prop<'a>>, f: &mut Formatter<'a>) {
    let is_consistent = f.options().quote_properties.is_consistent();
    if is_consistent {
        let quote_needed = props.iter().any(|property| {
            property.kind() != PropKind::Spread && property.key().is_some_and(|key| should_preserve_quote(key, f))
        });
        f.context_mut().push_quote_needed(quote_needed);
    }
    ObjectLike::ObjectExpression(e, props).fmt(f);
    if is_consistent {
        f.context_mut().pop_quote_needed();
    }
}

/// A property of an object literal, of the target of a destructuring assignment, or an attribute of
/// a JSX element.
pub(crate) fn write_property<'a>(property: Prop<'a>, f: &mut Formatter<'a>) {
    let node = property.as_ast_nodes();
    match node {
        AstNodes::JSXAttribute(_) | AstNodes::JSXSpreadAttribute(_) => super::jsx::write_jsx_attribute(property, f),
        AstNodes::SpreadElement(_) | AstNodes::AssignmentTargetRest(_) => write!(f, ["...", property.value()]),
        // `{ a }`, `{ a = 1 }`
        AstNodes::AssignmentTargetPropertyIdentifier(_) => write!(f, property.value()),
        AstNodes::AssignmentTargetPropertyProperty(_) => write!(f, AssignmentLike::ObjectProperty(property)),
        _ => write_object_property(property, f),
    }
}

fn write_object_property<'a>(property: Prop<'a>, f: &mut Formatter<'a>) {
    if !f.is_quiet() && f.comments().has_trailing_suppression_comment(property.span().end) {
        return write!(f, FormatSuppressedNode(property.span()));
    }
    let Some(value) = property.func() else {
        // Prettier's `handlePropertyComments`: a comment at the end of the line of the key leads
        // the property.
        if !f.is_quiet()
            && property.kind() != PropKind::Shorthand
            && let (Some(key), Some(value)) = (property.key(), property.value())
            && !f.comments().has_comment_in_span(key.span(f.file()))
        {
            let comments = Some(f.comments().end_of_line_comments_after_left_side(key.span(f.file()).end))
                .filter(|comments| comments.last().is_none_or(|last| !last.is_moved() && last.end() <= value.span().start))
                .unwrap_or_default();
            if comments.iter().any(|comment| f.comments().is_suppression_comment(comment)) {
                return write!(f, FormatSuppressedNode(property.span()));
            }
            write!(f, FormatLeadingComments::Comments(comments));
        }
        return write!(f, AssignmentLike::ObjectProperty(property));
    };
    match property.kind() {
        PropKind::Getter => write!(f, ["get", space()]),
        PropKind::Setter => write!(f, ["set", space()]),
        _ => {}
    }
    write!(f, [value.is_async().then_some("async "), value.is_generator().then_some("*")]);
    if let Some(key) = property.key() {
        format_computed_or_property_key(key, AstNodes::ObjectProperty(property), f);
    }
    format_grouped_parameters_with_return_type_for_method(value, f);
    if value.has_body() {
        write!(f, [space(), FormatFunctionBody(value)]);
    }
}

/// `import.meta`, `new.target`
pub(crate) fn write_meta_property<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    match e.kind() {
        ExprKind::ImportMeta => write!(f, "import.meta"),
        _ => write!(f, "new.target"),
    }
}

/// `++a`, `a--`
pub(crate) fn write_update_expression<'a>(op: UnOp, operand: Expr<'a>, f: &mut Formatter<'a>) {
    match op.is_prefix() {
        true => write!(f, [op.as_str(), operand]),
        false => write!(f, [operand, op.as_str()]),
    }
}

/// `!a`, `typeof a`
pub(crate) fn write_unary_expression<'a>(e: Expr<'a>, op: UnOp, operand: Expr<'a>, f: &mut Formatter<'a>) {
    write!(f, [op.as_str(), op.is_keyword().then_some(space())]);
    if !f.is_quiet() && unary_argument_has_comments(e, operand, f) {
        write!(f, group(&format_args!("(", soft_block_indent(&operand), ")")));
    } else {
        write!(f, operand);
    }
}

/// Whether a comment leads or trails `argument`, which is the operand of `unary`. The answer does
/// not depend on which comments are printed already.
pub(crate) fn unary_argument_has_comments<'a>(unary: Expr<'a>, argument: Expr<'a>, f: &Formatter<'a>) -> bool {
    let (outer, inner) = (unary.span(), argument.span());
    let is_leading = |comment: &Comment| comment.start() >= outer.start && comment.end() <= inner.start;
    let comments = f.comments();
    if comments.printed_comments().last().is_some_and(is_leading) {
        return true;
    }
    let unprinted = comments.unprinted_comments();
    match unprinted.first() {
        Some(first) if first.start() < outer.end => {
            if is_leading(first) {
                return true;
            }
        }
        _ => return false,
    }
    let after = unprinted.partition_point(|comment| comment.start() < inner.end);
    unprinted
        .get(after..)
        .unwrap_or_default()
        .iter()
        .take_while(|comment| comment.end() <= outer.end)
        .any(|comment| !is_last_binary_operand_comment(argument, comment, f))
}

/// Prettier's `handleLastBinaryOperatorOperand`: whether `comment`, which is after `argument`, the
/// operand of a unary expression, trails the last operand of `argument` and not all of it:
///
/// ```javascript
/// !(
///   a || // 1
///   b // 2
/// );
/// ```
pub(crate) fn is_last_binary_operand_comment<'a>(argument: Expr<'a>, comment: &Comment, f: &Formatter<'a>) -> bool {
    let ExprKind::Binary { op, right, .. } = argument.kind() else {
        return false;
    };
    let source_text = f.source_text();
    op != BinOp::Comma
        && !comment.preceded_by_newline()
        && comment.followed_by_newline()
        && !comment.is_multiline_block()
        && source_text.contains_newline_between(argument.span().start, right.span().start)
        && !source_text.contains_newline_between(right.span().start, comment.span.start)
}

/// `a = b`, `a += b`. In the target of a destructuring assignment, a target with its default value.
pub(crate) fn write_assignment_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    match (e.as_chain_element(), e.kind()) {
        (AstNodes::AssignmentTargetWithDefault(_), ExprKind::Assign { target, value, .. }) => {
            write!(f, [target, space(), "=", space(), value]);
        }
        _ => AssignmentLike::AssignmentExpression(e).fmt(f),
    }
}

/// `a ? b : c`
pub(crate) fn write_conditional_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    ConditionalLike::ConditionalExpression(e).fmt(f);
}

/// `[a, b] = c`
pub(crate) fn write_array_assignment_target<'a>(e: Expr<'a>, elements: List<'a, Expr<'a>>, f: &mut Formatter<'a>) {
    write!(f, "[");
    if elements.is_empty() {
        write!(f, format_dangling_comments(e.span()).with_soft_block_indent());
    } else {
        let rest = elements.last().filter(|it| matches!(it.kind(), ExprKind::Spread(_)));
        let count = elements.len() - usize::from(rest.is_some());
        write!(
            f,
            group(&soft_block_indent(&format_with(|f| {
                if count > 0 {
                    write_array_node(
                        elements.len(),
                        elements.iter().take(count).map(|it| (!matches!(it.kind(), ExprKind::Missing)).then_some(it)),
                        f,
                    );
                }
                if let Some(rest) = rest {
                    write!(f, [(count > 0).then_some(soft_line_break_or_space()), rest]);
                }
            })))
        );
    }
    write!(f, "]");
}

/// `({ a, b } = c)`
pub(crate) fn write_object_assignment_target<'a>(e: Expr<'a>, props: List<'a, Prop<'a>>, f: &mut Formatter<'a>) {
    ObjectPatternLike::ObjectAssignmentTarget(e, props).fmt(f);
}

/// `await a`
pub(crate) fn write_await_expression<'a>(e: Expr<'a>, argument: Expr<'a>, f: &mut Formatter<'a>) {
    let format_inner = format_args!("await", space(), argument);
    let is_callee_or_object = match e.ast_parent() {
        AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
        AstNodes::ComputedMemberExpression(member) => member.object() == Some(e),
        AstNodes::CallExpression(call) => call.callee() == Some(e),
        _ => false,
    };
    if !is_callee_or_object {
        return write!(f, format_inner);
    }

    // `await (await a).b`: the parentheses break along with what the outer `await` is in.
    let indented = soft_block_indent(&format_inner);
    match left_edge_end(e, AstNodes::AwaitExpression(e)).1 {
        AstNodes::AwaitExpression(_) => write!(f, indented),
        _ => write!(f, group(&indented)),
    }
}

/// `yield a`, `yield* a`
pub(crate) fn write_yield_expression<'a>(argument: Option<Expr<'a>>, delegate: bool, f: &mut Formatter<'a>) {
    write!(f, ["yield", delegate.then_some("*"), argument.map(|_| space()), argument]);
}

/// `<T>a`
pub(crate) fn write_ts_type_assertion<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let Some(expression) = e.expression() else {
        return;
    };
    let format_cast = format_with(|f| match e.type_annotation() {
        Some(ty) => write!(f, ["<", group(&soft_block_indent(&ty)), ">"]),
        None => write!(f, "<const>"),
    });

    if matches!(expression.kind(), ExprKind::Array(_) | ExprKind::Object(_)) {
        return write!(f, [format_cast, expression]);
    }
    let format_cast = format_cast.memoized();
    let format_expression = expression.memoized();
    write!(
        f,
        best_fitting![
            format_args!(format_cast, format_expression),
            format_args!(format_cast, group(&format_args!("(", block_indent(&format_expression), ")"))),
            format_args!(format_cast, format_expression)
        ]
    );
}
