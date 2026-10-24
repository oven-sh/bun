//! Expressions that only take a few lines each.

use super::binary_like_expression::is_argument_of_angular_pipe;
use super::class::format_grouped_parameters_with_return_type_for_method;
use super::function::FormatFunctionBody;
use super::object_like::ObjectLike;
use super::object_pattern_like::ObjectPatternLike;
use super::return_or_throw_statement::{
    has_argument_leading_comments, has_comment_right_after_keyword,
};
use crate::js::format::{FormatExpr, format_name, format_node};
use crate::js::parentheses::expression::left_edge_end;
use crate::js::utils::array::write_array_node;
use crate::js::utils::assignment_like::AssignmentLike;
use crate::js::utils::conditional::ConditionalLike;
use crate::js::utils::object::{format_computed_or_property_key, should_preserve_quote};
use crate::js::utils::typecast::has_comments_that_count;
use crate::prelude::*;
use crate::{best_fitting, format_args, write};

/// All of `a?.b.c`.
pub(crate) fn write_chain_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    FormatExpr::in_chain_expression(e).fmt(f);
}

/// Prettier's `isFollowedByRightBracket`, for an object between `{{` and `}}` in HTML that's printed without spaces
/// inside its braces. True if another object's `}` follows its own, because `}}` would end the interpolation.
fn is_followed_by_right_bracket_in_html<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    if !f.options().in_html.is_in_interpolation || f.options().bracket_spacing.value() {
        return false;
    }
    let mut current = e;
    loop {
        let parent = current.ast_parent();
        current = match parent {
            AstNodes::ObjectProperty(property) => {
                return property.value() == Some(current)
                    && matches!(parent.parent(), AstNodes::ObjectExpression(object)
                        if matches!(object.kind(), ExprKind::Object(props) if props.last() == Some(property)));
            }
            AstNodes::BinaryExpression(it) | AstNodes::LogicalExpression(it)
                if it.right() == Some(current) =>
            {
                it
            }
            AstNodes::ConditionalExpression(it) if it.alternate() == Some(current) => it,
            AstNodes::UnaryExpression(it) => it,
            // The last argument of an Angular pipe.
            AstNodes::CallExpression(it)
                if f.options().in_html.root.is_angular()
                    && is_argument_of_angular_pipe(current)
                    && it
                        .as_call()
                        .is_some_and(|call| call.args().last() == Some(current)) =>
            {
                match it.parent() {
                    Node::Expr(pipe) => pipe,
                    _ => return false,
                }
            }
            _ => return false,
        };
    }
}

/// `{ a: 1 }`
pub(crate) fn write_object_expression<'a>(
    e: Expr<'a>,
    props: List<'a, Prop<'a>>,
    f: &mut Formatter<'a>,
) {
    if is_followed_by_right_bracket_in_html(e, f) {
        write!(f, "(");
        write_object_expression_without_parentheses(e, props, f);
        return write!(f, ")");
    }
    write_object_expression_without_parentheses(e, props, f);
}

fn write_object_expression_without_parentheses<'a>(
    e: Expr<'a>,
    props: List<'a, Prop<'a>>,
    f: &mut Formatter<'a>,
) {
    let is_consistent = f.options().quote_properties.is_consistent();
    if is_consistent {
        let quote_needed = props.iter().any(|property| {
            property.kind() != PropKind::Spread
                && property
                    .key()
                    .is_some_and(|key| should_preserve_quote(key, f))
        });
        f.context_mut().push_quote_needed(quote_needed);
    }
    ObjectLike::ObjectExpression(e, props).fmt(f);
    if is_consistent {
        f.context_mut().pop_quote_needed();
    }
}

/// A property of an object literal or of a destructuring assignment target, or a JSX attribute.
pub(crate) fn write_property<'a>(property: Prop<'a>, f: &mut Formatter<'a>) {
    let node = property.as_ast_nodes();
    match node {
        AstNodes::JSXAttribute(_) | AstNodes::JSXSpreadAttribute(_) => {
            super::jsx::write_jsx_attribute(property, f)
        }
        AstNodes::SpreadElement(_) | AstNodes::AssignmentTargetRest(_) => {
            write!(f, ["...", property.value()])
        }
        // `{ a }`, `{ a = 1 }`
        AstNodes::AssignmentTargetPropertyIdentifier(_) => write!(f, property.value()),
        AstNodes::AssignmentTargetPropertyProperty(_) => {
            write!(f, AssignmentLike::ObjectProperty(property))
        }
        _ => write_object_property(property, f),
    }
}

/// A property of an object literal that isn't a destructuring assignment target.
#[derive(Copy, Clone)]
pub(crate) struct FormatObjectMember<'a>(pub(crate) Prop<'a>);

impl<'a> Format<'a> for FormatObjectMember<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let property = self.0;
        let write = |f: &mut Formatter<'a>| match property.kind() {
            PropKind::Spread => write!(f, ["...", property.value()]),
            _ => write_object_property(property, f),
        };
        match f.is_quiet() {
            true => write(f),
            false => format_node(property.as_ast_nodes(), f, write),
        }
    }
}

impl Spanned for FormatObjectMember<'_> {
    fn span(&self) -> Span {
        self.0.span()
    }
}

fn write_object_property<'a>(property: Prop<'a>, f: &mut Formatter<'a>) {
    let Some(value) = property.func() else {
        return write!(f, AssignmentLike::ObjectProperty(property));
    };
    match property.kind() {
        PropKind::Getter => write!(f, ["get", space()]),
        PropKind::Setter => write!(f, ["set", space()]),
        _ => {}
    }
    write!(
        f,
        [
            value.is_async().then_some("async "),
            value.is_generator().then_some("*")
        ]
    );
    if let Some(key) = property.key() {
        format_computed_or_property_key(key, AstNodes::ObjectProperty(property), f);
    }
    // An error.
    write!(f, property.is_optional().then_some("?"));
    // `{ a(/* prettier-ignore */) {} }`: with typescript-estree the comment dangles from the `FunctionExpression`.
    let function = AstNodes::Function(value);
    if !f.is_quiet() && f.comments().is_ignored(function) {
        return format_node(function, f, |_| {});
    }
    format_grouped_parameters_with_return_type_for_method(value, f);
    if value.has_body() {
        write!(f, [space(), FormatFunctionBody(value)]);
    }
}

/// `import.meta`, `new.target`. Both words are `Identifier` nodes for Prettier, so comments can be attached to them.
#[inline(never)]
pub(crate) fn write_meta_property<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let span = e.span();
    let is_import_meta = matches!(e.kind(), ExprKind::ImportMeta);
    let meta = if is_import_meta { "import" } else { "new" };
    let property = Span::new(start_of_meta_property_name(e), span.end);
    format_name(
        Span::new(span.start, span.start + meta.len() as u32),
        f,
        |f| {
            write!(f, meta);
        },
    );
    write!(f, ".");
    format_name(property, f, |f| match is_import_meta {
        // `import.m\u0065ta`
        true => write!(f, "meta"),
        // With its escapes. `new.targ` is an error.
        false => write!(f, source_text(property)),
    });
}

/// Returns where the second word of `import.meta` or `new.target` starts. It can have escapes: `new.t\u0061rget`,
/// `new.t\u{61}rget`.
pub(crate) fn start_of_meta_property_name(e: Expr<'_>) -> u32 {
    let is_in_name = |byte: &u8| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | b'\\' | b'{' | b'}' | 0x80..)
    };
    let name = (e.text().iter())
        .rposition(|byte| !is_in_name(byte))
        .map_or(0, |at| at + 1);
    e.span().start + name as u32
}

/// `++a`, `a--`
pub(crate) fn write_update_expression<'a>(op: UnOp, operand: Expr<'a>, f: &mut Formatter<'a>) {
    match op.is_prefix() {
        true => write!(f, [op.as_str(), operand]),
        false => write!(f, [operand, op.as_str()]),
    }
}

/// `!a`, `typeof a`
pub(crate) fn write_unary_expression<'a>(op: UnOp, operand: Expr<'a>, f: &mut Formatter<'a>) {
    write!(f, [op.as_str(), op.is_keyword().then_some(space())]);
    if !f.is_quiet() && has_comments_that_count(operand, f) {
        write!(
            f,
            group(&format_args!("(", soft_block_indent(&operand), ")"))
        );
    } else {
        write!(f, operand);
    }
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
pub(crate) fn write_array_assignment_target<'a>(
    e: Expr<'a>,
    elements: List<'a, Expr<'a>>,
    f: &mut Formatter<'a>,
) {
    write!(f, "[");
    if elements.is_empty() {
        write!(
            f,
            dangling_comments(e.as_ast_nodes()).with_soft_block_indent()
        );
    } else {
        let rest = elements
            .last()
            .filter(|it| matches!(it.kind(), ExprKind::Spread(_)));
        let count = elements.len() - usize::from(rest.is_some());
        write!(
            f,
            group(&soft_block_indent(&format_with(|f| {
                if count > 0 {
                    write_array_node(
                        elements.len(),
                        elements
                            .iter()
                            .take(count)
                            .map(|it| (!matches!(it.kind(), ExprKind::Missing)).then_some(it)),
                        f,
                    );
                }
                write!(f, rest);
            })))
        );
    }
    write!(f, "]");
}

/// `({ a, b } = c)`
pub(crate) fn write_object_assignment_target<'a>(
    e: Expr<'a>,
    props: List<'a, Prop<'a>>,
    f: &mut Formatter<'a>,
) {
    ObjectPatternLike::ObjectAssignmentTarget(e, props).fmt(f);
}

/// `await a`
#[inline(never)]
pub(crate) fn write_await_expression<'a>(e: Expr<'a>, argument: Expr<'a>, f: &mut Formatter<'a>) {
    let format_inner = format_args!("await", space(), argument);
    let is_callee_or_object = match e.ast_parent() {
        AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
        AstNodes::ComputedMemberExpression(member) => member.object() == Some(e),
        AstNodes::CallExpression(call) => call.callee() == Some(e),
        // `new (await a())()`
        AstNodes::NewExpression(new) => new.callee() == Some(e) && f.options().flavor.is_oxfmt(),
        _ => false,
    };
    if !is_callee_or_object {
        return write!(f, format_inner);
    }

    // `await (await a).b`: the parentheses break together with the group that contains the outer `await`.
    let indented = soft_block_indent(&format_inner);
    match left_edge_end(e, AstNodes::AwaitExpression(e)).1 {
        AstNodes::AwaitExpression(_) => write!(f, indented),
        _ => write!(f, group(&indented)),
    }
}

/// `yield a`, `yield* a`
#[inline(never)]
pub(crate) fn write_yield_expression<'a>(
    argument: Option<Expr<'a>>,
    delegate: bool,
    f: &mut Formatter<'a>,
) {
    write!(f, ["yield", delegate.then_some("*")]);
    let Some(argument) = argument else {
        return;
    };
    write!(f, space());
    // A line break after `yield` ends the expression, so without the parentheses `yield ( // a\n b )` would yield
    // nothing. Prettier drops them. A line break after `yield*` is fine.
    if !f.is_quiet()
        && !matches!(argument.kind(), ExprKind::Jsx(_))
        && match yield_prints_argument_like_return(f) {
            true => has_argument_leading_comments(argument, f),
            false => !delegate && has_comment_right_after_keyword(argument, f),
        }
    {
        return write!(f, ["(", block_indent(&argument), ")"]);
    }
    let is_binaryish = matches!(argument.kind(), ExprKind::Binary { op, .. } if op != BinOp::Comma);
    match is_binaryish && yield_prints_argument_like_return(f) {
        true => write!(
            f,
            group(&format_args!(
                if_group_breaks(&"("),
                soft_block_indent(&argument),
                if_group_breaks(&")")
            ))
        ),
        false => write!(f, argument),
    }
}

/// oxfmt, like Prettier 3.8, prints the argument of `yield` like the argument of `return`.
fn yield_prints_argument_like_return(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `<T>a`
#[inline(never)]
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
            format_args!(
                format_cast,
                group(&format_args!("(", block_indent(&format_expression), ")"))
            ),
            format_args!(format_cast, format_expression)
        ]
    );
}
