use crate::js::format::identifier;
use crate::js::utils::call_expression::strip_chain_element_wrappers;
use crate::js::utils::member_chain::chain_member::FormatComputedMemberExpressionWithoutObject;
use crate::js::utils::typecast::is_cast_target;
use crate::prelude::*;
use crate::{format_args, write};

/// `a.b`, `a?.b`, `a.#b`, `a[b]`, `a?.[b]`. Prettier's `printMemberExpression`.
pub(crate) fn write_member_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let Some(object) = e.object() else {
        return;
    };
    match e.tag() {
        ExprTag::Index => write!(f, [object, line_suffix_boundary(), FormatComputedMemberExpressionWithoutObject(e)]),
        _ => write_static_member_expression(e, object, f),
    }
}

fn write_static_member_expression<'a>(e: Expr<'a>, object: Expr<'a>, f: &mut Formatter<'a>) {
    let start = f.elements().len();
    write!(f, [object, line_suffix_boundary()]);

    if f.is_quiet() {
        let lookup = format_with(|f| write_lookup_without_comments(e, f));
        return match should_inline(e, object, start, f) {
            true => write!(f, lookup),
            false => write!(f, group(&indent(&format_args!(soft_line_break(), lookup)))),
        };
    }

    let Some(property) = e.member_name() else {
        return;
    };
    let operator = if e.is_optional() { "?." } else { "." };
    let property_start = property.start();
    let has_own_line_comment = f.comments().has_leading_own_line_comment(property_start);
    let is_inline = !has_own_line_comment && should_inline(e, object, start, f);
    let property = identifier(property, e.as_chain_element());

    if is_inline {
        return write!(f, [operator, property]);
    }
    write!(
        f,
        group(&indent(&format_args!(
            soft_line_break(),
            format_with(|f| {
                if has_own_line_comment {
                    let comments = f.comments().comments_before(property_start);
                    write!(f, [FormatLeadingComments::Comments(comments), soft_line_break()]);
                }
            }),
            operator,
            property,
        )))
    );
}

/// The `.b` or `?.b` of `member`, where there are no comments.
pub(crate) fn write_lookup_without_comments<'a>(member: Expr<'a>, f: &mut Formatter<'a>) {
    let Some(start) = member.member_name_start() else {
        return;
    };
    // The member access ends with the name.
    let name = Span::new(start, member.span().end);
    let byte_before = |count: u32| name.start.checked_sub(count).and_then(|at| f.source_text().byte_at(at));
    // As a rule nothing is between the operator and the name, and they are one piece of the source
    // text.
    let (operator, is_before_name) = match member.is_optional() {
        true => ("?.", byte_before(1) == Some(b'.') && byte_before(2) == Some(b'?')),
        false => (".", byte_before(1) == Some(b'.')),
    };
    match is_before_name {
        true => write!(f, source_text(Span::new(name.start - operator.len() as u32, name.end))),
        false => write!(f, [operator, source_text(name)]),
    }
}

fn is_member(node: AstNodes<'_>) -> bool {
    matches!(
        node,
        AstNodes::StaticMemberExpression(_) | AstNodes::ComputedMemberExpression(_) | AstNodes::PrivateFieldExpression(_)
    )
}

/// Whether there is no line break between the object and the `.`, however long the line.
///
/// `object_start`: where the elements of the object start in what is written.
fn should_inline<'a>(e: Expr<'a>, object: Expr<'a>, object_start: usize, f: &Formatter<'a>) -> bool {
    let is_private = e.is_private_member();
    if is_private && never_breaks_before_private_name(f) {
        return true;
    }

    // What follows comes to this unless the member accesses and `!`s around `e` are in one of a few
    // kinds of nodes.
    let is_wrapper = |node: Node<'a>| matches!(node, Node::Expr(it) if it.tag() == ExprTag::NonNull);
    let is_member_or_wrapper =
        |node: Node<'a>| matches!(node, Node::Expr(it) if matches!(it.tag(), ExprTag::Dot | ExprTag::Index | ExprTag::NonNull));
    let mut outer = e.parent();
    while is_wrapper(outer) {
        outer = outer.parent();
    }
    let is_in_member = is_member_or_wrapper(outer);
    if !is_in_member && !is_private && object.tag() == ExprTag::Ident && !is_cast_target(object, f) {
        return true;
    }
    let mut steps = 0;
    while is_member_or_wrapper(outer) {
        outer = outer.parent();
        steps += 1;
        if steps == LONG_CHAIN
            && let Some(answer) = answer_for_object(object, f)
        {
            f.context().long_member_chain.set(Some((e, answer)));
            return answer;
        }
    }
    let answer = should_inline_in(e, object, object_start, outer, is_in_member, f);
    if steps >= LONG_CHAIN {
        f.context().long_member_chain.set(Some((e, answer)));
    }
    answer
}

/// With so many member accesses and `!`s around one, the way up is not gone for each of them.
const LONG_CHAIN: u32 = 16;

/// What [`should_inline`] came to for the member access that `object` is, or is an `[..]` or a `!`
/// of, if that is the last one in a long chain that it was asked about. The way up from there leads
/// through what `object` is the object of, unless a `ChainExpression` is in between.
fn answer_for_object<'a>(object: Expr<'a>, f: &Formatter<'a>) -> Option<bool> {
    let (last, answer) = f.context().long_member_chain.get()?;
    let mut at = object;
    loop {
        if is_chain_root(at) {
            return None;
        }
        if at == last {
            return Some(answer);
        }
        at = match at.tag() {
            ExprTag::Index => at.object()?,
            ExprTag::Dot if at.is_private_member() => at.object()?,
            ExprTag::NonNull => at.operand()?,
            _ => return None,
        };
    }
}

/// `outer`: the first thing around `e` that is neither a member access nor a `!`. `is_in_member`:
/// `e`, with the `!`s after it, is in a member access.
fn should_inline_in<'a>(
    e: Expr<'a>,
    object: Expr<'a>,
    object_start: usize,
    outer: Node<'a>,
    is_in_member: bool,
    f: &Formatter<'a>,
) -> bool {
    match outer {
        Node::Expr(it) if !matches!(it.tag(), ExprTag::Assign | ExprTag::New) => return false,
        Node::VarDecl(_) if is_in_member => return false,
        Node::Stmt(_) | Node::Prop(_) | Node::Func(_) => return false,
        _ => {}
    }

    let parent = e.as_chain_element().parent();

    let mut first_non_wrapper_parent = parent;
    while matches!(first_non_wrapper_parent, AstNodes::TSNonNullExpression(_) | AstNodes::ChainExpression(_)) {
        first_non_wrapper_parent = first_non_wrapper_parent.parent();
    }

    if is_member(first_non_wrapper_parent) {
        // `a.b` of `a.b.c`
    } else if matches!(first_non_wrapper_parent, AstNodes::AssignmentExpression(_) | AstNodes::VariableDeclarator(_))
        // The parentheses of a type cast are a node for Prettier, which is neither.
        && !is_cast_target(object, f)
        && (matches!(strip_chain_element_wrappers(object).kind(), ExprKind::Call(call) if !call.args().is_empty())
            || (is_member_chain_or_member_of_one(object)
                && f.elements_from(object_start).has_label(LabelId::of(JsLabels::MemberChain))))
    {
        return true;
    }

    // Babel, which reads JavaScript for Prettier, has no `ChainExpression`.
    let is_javascript = f.file().is_javascript() || has_no_chain_expression_in_the_way(f);
    let is_transparent = |node: AstNodes<'a>| is_javascript && matches!(node, AstNodes::ChainExpression(_));

    let mut first_non_member_parent = parent;
    while is_member(first_non_member_parent)
        || matches!(first_non_member_parent, AstNodes::TSNonNullExpression(_))
        || is_transparent(first_non_member_parent)
    {
        first_non_member_parent = first_non_member_parent.parent();
    }
    match first_non_member_parent {
        AstNodes::AssignmentExpression(assignment) => {
            !assignment.left().is_some_and(|left| matches!(left.kind(), ExprKind::Ident(_)))
        }
        // `typeof a.b.c` has a `TSQualifiedName`.
        AstNodes::TSTypeQuery(_) => true,
        // Prettier's `shouldInlineNewExpressionCallee`: it is on the left edge of the callee.
        AstNodes::NewExpression(new) => {
            let mut child = e;
            let mut ancestor = parent;
            loop {
                match ancestor {
                    AstNodes::NewExpression(_) => return new.callee() == Some(child),
                    AstNodes::ChainExpression(_) => {}
                    AstNodes::TSNonNullExpression(it) => child = it,
                    AstNodes::StaticMemberExpression(it)
                    | AstNodes::ComputedMemberExpression(it)
                    | AstNodes::PrivateFieldExpression(it)
                        if it.object() == Some(child) =>
                    {
                        child = it;
                    }
                    _ => return false,
                }
                ancestor = ancestor.parent();
            }
        }
        _ => false,
    }
}

/// oxfmt looks through a `ChainExpression` for what a member expression is in, in TypeScript as well.
fn has_no_chain_expression_in_the_way(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// oxfmt writes `a.#b` without a way to break. For Prettier it is a member expression like any other.
fn never_breaks_before_private_name(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Whether what is written for `object` has the label of what is at its left edge: it is a call
/// of a member, which may be written as a member chain, or a member of that.
fn is_member_chain_or_member_of_one(mut object: Expr<'_>) -> bool {
    loop {
        match object.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => object = obj,
            ExprKind::Call(call) => return matches!(call.callee().kind(), ExprKind::Dot { .. } | ExprKind::Index { .. }),
            _ => return false,
        }
    }
}
