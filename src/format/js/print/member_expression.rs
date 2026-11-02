use crate::js::format::{identifier, name_without_comments};
use crate::js::utils::call_expression::strip_chain_element_wrappers;
use crate::js::utils::member_chain::chain_member::FormatComputedMemberExpressionWithoutObject;
use crate::js::utils::typecast::{is_cast_target, is_cast_target_that_hides_its_kind};
use crate::prelude::*;
use crate::{format_args, write};

/// `a.b`, `a?.b`, `a.#b`, `a[b]`, `a?.[b]`. Prettier's `printMemberExpression`.
pub(crate) fn write_member_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let Some(object) = e.object() else {
        return;
    };
    match e.tag() {
        ExprTag::Index => write!(
            f,
            [
                object,
                boundary_after_object(f),
                FormatComputedMemberExpressionWithoutObject(e)
            ]
        ),
        _ => write_static_member_expression(e, object, f),
    }
}

/// Prettier keeps a comment at the end of the object's line there. oxfmt, like Prettier 3.8, moves it after the member:
/// `a // comment` with `.b` on the next line becomes `a.b // comment`.
fn boundary_after_object(f: &Formatter<'_>) -> Option<LineSuffixBoundary> {
    (!f.options().flavor.is_oxfmt()).then_some(line_suffix_boundary())
}

fn write_static_member_expression<'a>(e: Expr<'a>, object: Expr<'a>, f: &mut Formatter<'a>) {
    let start = f.elements().len();
    write!(f, [object, boundary_after_object(f)]);
    write_property_after_object(e, object, start, f);
}

/// Not inlined: `a.b.c.d` nests as deep as it is long, and inlining would add this function's stack use to every level.
#[inline(never)]
fn write_property_after_object<'a>(
    e: Expr<'a>,
    object: Expr<'a>,
    start: usize,
    f: &mut Formatter<'a>,
) {
    let comments = comments_on_lines_before_property(e, f);
    let lookup = format_with(|f| match comments.is_empty() {
        true => write_lookup(e, f),
        false => write_lookup_after_its_comments(e, f),
    });
    if comments.is_empty() && should_inline(e, object, start, f) {
        return write!(f, lookup);
    }
    write!(
        f,
        group(&indent(&format_args!(
            soft_line_break(),
            FormatLeadingComments::Comments(comments),
            (!comments.is_empty()).then_some(soft_line_break()),
            lookup
        )))
    );
}

/// Prettier attaches an own-line comment in `a.b` or `a[b]` to the member access, so it's printed before `a`. oxfmt
/// leaves it in place.
///
/// ```js
/// a                // comment
///   // comment     a.b;
///   .b;
/// ```
pub(crate) fn comments_in_member_access_stay(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// See [`comments_in_member_access_stay`]. Returns the comments on `member`'s property if one of them ends its line.
/// They're printed before the `.`. Skips `a.#b`, which oxfmt never breaks.
fn comments_on_lines_before_property<'a>(member: Expr<'a>, f: &Formatter<'a>) -> CommentList<'a> {
    if f.is_quiet() || !comments_in_member_access_stay(f) || member.is_private_member() {
        return CommentList::empty();
    }
    (member.member_name_start())
        .map(|start| f.comments().of_name(start).leading)
        .filter(|comments| comments.iter().any(|comment| comment.has_newline_after()))
        .unwrap_or_default()
}

/// `member`'s `.b` or `?.b`. Prettier's `printMemberLookup`.
pub(crate) fn write_lookup<'a>(member: Expr<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return write_lookup_without_comments(member, f);
    }
    let Some(property) = member.member_name() else {
        return;
    };
    let operator = if member.is_optional() { "?." } else { "." };
    write!(f, [operator, identifier(property)]);
}

/// [`write_lookup`] for when the name's leading comments were already printed before the `.`, as oxfmt does. A
/// `prettier-ignore` comment among them then no longer applies to the name.
pub(crate) fn write_lookup_after_its_comments<'a>(member: Expr<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return write_lookup_without_comments(member, f);
    }
    let Some(start) = member.member_name_start() else {
        return;
    };
    let operator = if member.is_optional() { "?." } else { "." };
    // The member access ends with the name.
    let name = name_without_comments(Span::new(start, member.span().end));
    let trailing_comments = FormatTrailingComments::Comments(f.comments().of_name(start).trailing);
    write!(f, [operator, name, trailing_comments]);
}

/// `member`'s `.b` or `?.b` when there are no comments.
fn write_lookup_without_comments<'a>(member: Expr<'a>, f: &mut Formatter<'a>) {
    let Some(start) = member.member_name_start() else {
        return;
    };
    // The member access ends with the name.
    let name = Span::new(start, member.span().end);
    let byte_before = |count: u32| {
        name.start
            .checked_sub(count)
            .and_then(|at| f.source_text().byte_at(at))
    };
    // Usually nothing is between the operator and the name, so both are one slice of the source text.
    let (operator, is_before_name) = match member.is_optional() {
        true => (
            "?.",
            byte_before(1) == Some(b'.') && byte_before(2) == Some(b'?'),
        ),
        false => (".", byte_before(1) == Some(b'.')),
    };
    match is_before_name {
        true => write!(
            f,
            source_text(Span::new(name.start - operator.len() as u32, name.end))
        ),
        false => write!(f, [operator, source_text(name)]),
    }
}

fn is_member(node: AstNodes<'_>) -> bool {
    matches!(
        node,
        AstNodes::StaticMemberExpression(_)
            | AstNodes::ComputedMemberExpression(_)
            | AstNodes::PrivateFieldExpression(_)
    )
}

/// True if there's never a line break between the object and the `.`, however long the line is.
///
/// `object_start` is where the object's elements start in the formatter's buffer.
fn should_inline<'a>(
    e: Expr<'a>,
    object: Expr<'a>,
    object_start: usize,
    f: &Formatter<'a>,
) -> bool {
    let is_private = e.is_private_member();
    if is_private && never_breaks_before_private_name(f) {
        return true;
    }

    // Fast path: the rest boils down to this check unless the member accesses and `!`s around `e` are inside one of a
    // few node kinds.
    let is_wrapper =
        |node: Node<'a>| matches!(node, Node::Expr(it) if it.tag() == ExprTag::NonNull);
    let is_member_or_wrapper = |node: Node<'a>| matches!(node, Node::Expr(it) if matches!(it.tag(), ExprTag::Dot | ExprTag::Index | ExprTag::NonNull));
    let mut outer = e.parent();
    while is_wrapper(outer) {
        outer = outer.parent();
    }
    // In that case Prettier sees `e` inside a type cast's parentheses.
    let is_in_member = is_member_or_wrapper(outer) && !is_cast_target_that_hides_its_kind(e, f);
    if !is_in_member && !is_private && object.tag() == ExprTag::Ident && !is_cast_target(object, f)
    {
        return true;
    }
    let mut steps = 0;
    while is_member_or_wrapper(outer) {
        outer = outer.parent();
        steps += 1;
        if steps == LONG_CHAIN
            && let Some(answer) = cached_answer_for_object(object, f)
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

/// With this many member accesses and `!`s around an expression, the walk up the chain is cached instead of repeated
/// for each one.
const LONG_CHAIN: u32 = 16;

/// Returns the answer [`should_inline`] cached for the last member access of a long chain, if `object` is that access
/// or an `[..]` or `!` applied to it. The walk up from there passes through `object`'s parent, so it ends at the same
/// node, unless a `ChainExpression` is in between.
fn cached_answer_for_object<'a>(object: Expr<'a>, f: &Formatter<'a>) -> Option<bool> {
    let (last, answer) = f.context().long_member_chain.get()?;
    let mut at = object;
    loop {
        if at.is_chain_root() {
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

/// `outer` is the first ancestor of `e` that's neither a member access nor a `!`. `is_in_member` means `e`, with the
/// `!`s after it, is inside a member access.
fn should_inline_in<'a>(
    e: Expr<'a>,
    object: Expr<'a>,
    object_start: usize,
    outer: Node<'a>,
    is_in_member: bool,
    f: &Formatter<'a>,
) -> bool {
    // In Prettier a type cast's parentheses are a node, and not one of the kinds that matter here.
    if f.comments().has_type_cast_comments() {
        let mut inner = e;
        loop {
            if is_cast_target_that_hides_its_kind(inner, f) {
                return false;
            }
            match inner.parent() {
                Node::Expr(it)
                    if matches!(it.tag(), ExprTag::Dot | ExprTag::Index | ExprTag::NonNull) =>
                {
                    inner = it;
                }
                _ => break,
            }
        }
    }
    match outer {
        Node::Expr(it) if !matches!(it.tag(), ExprTag::Assign | ExprTag::New) => return false,
        Node::VarDecl(_) if is_in_member => return false,
        Node::Stmt(_) | Node::Prop(_) | Node::Func(_) => return false,
        _ => {}
    }

    let parent = e.as_chain_element().parent();

    let mut first_non_wrapper_parent = parent;
    while matches!(
        first_non_wrapper_parent,
        AstNodes::TSNonNullExpression(_) | AstNodes::ChainExpression(_)
    ) {
        first_non_wrapper_parent = first_non_wrapper_parent.parent();
    }

    if is_member(first_non_wrapper_parent) {
        // `a.b` of `a.b.c`
    } else if matches!(first_non_wrapper_parent, AstNodes::AssignmentExpression(_) | AstNodes::VariableDeclarator(_))
        // In Prettier a type cast's parentheses are a node, which is neither of those.
        && !is_cast_target(object, f)
        && (matches!(strip_chain_element_wrappers(object).kind(), ExprKind::Call(call) if !call.args().is_empty())
            || (is_member_chain_or_member_of_one(object, f)
                && f.elements_from(object_start).has_label(LabelId::of(JsLabels::MemberChain))))
    {
        return true;
    }

    // Babel, which Prettier uses to parse JavaScript, has no `ChainExpression`.
    let is_javascript = f.context().has_babel_tree() || looks_through_chain_expression(f);
    let is_transparent =
        |node: AstNodes<'a>| is_javascript && matches!(node, AstNodes::ChainExpression(_));

    let mut first_non_member_parent = parent;
    while is_member(first_non_member_parent)
        || matches!(first_non_member_parent, AstNodes::TSNonNullExpression(_))
        || is_transparent(first_non_member_parent)
    {
        first_non_member_parent = first_non_member_parent.parent();
    }
    match first_non_member_parent {
        AstNodes::AssignmentExpression(assignment) => !assignment
            .left()
            .is_some_and(|left| matches!(left.kind(), ExprKind::Ident(_))),
        // `typeof a.b.c` has a `TSQualifiedName`.
        AstNodes::TSTypeQuery(_) => true,
        // Prettier's `shouldInlineNewExpressionCallee`: `e` is on the callee's left edge.
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

/// oxfmt looks through a `ChainExpression` to find a member expression's parent, in TypeScript too.
fn looks_through_chain_expression(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// oxfmt never lets `a.#b` break. Prettier treats it like any other member expression.
fn never_breaks_before_private_name(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `a.b().c!.d`: in Prettier the doc for `a.b().c!` has no label. oxfmt looks at how it starts.
fn non_null_mark_keeps_label(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// True if `object`'s output carries the label of its left edge: it's a call of a member, which may be printed as a
/// member chain, or a member of such a call.
fn is_member_chain_or_member_of_one(mut object: Expr<'_>, f: &Formatter<'_>) -> bool {
    loop {
        match object.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => object = obj,
            ExprKind::NonNull(operand) if non_null_mark_keeps_label(f) => object = operand,
            ExprKind::Call(call) => {
                return matches!(
                    call.callee().kind(),
                    ExprKind::Dot { .. } | ExprKind::Index { .. }
                );
            }
            _ => return false,
        }
    }
}
