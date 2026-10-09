use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, is_method_call, is_new_expression};
use crate::unicorn::outermost_wrapper;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow unnecessary `.toArray()` on iterators.
pub struct NoUselessIteratorToArray;

const ITERABLE_ACCEPTING: Message =
    Message::new("", "`{{description}}` accepts an iterable, `.toArray()` is unnecessary.");
const FOR_OF: Message = Message::new("", "`for…of` can iterate over an iterable, `.toArray()` is unnecessary.");
const YIELD_STAR: Message = Message::new("", "`yield*` can delegate to an iterable, `.toArray()` is unnecessary.");
const SPREAD: Message = Message::new("", "Spread works on iterables, `.toArray()` is unnecessary.");
const ITERATOR_METHOD: Message =
    Message::new("", "`Iterator` has a `.{{method}}()` method, `.toArray()` is unnecessary.");
const REMOVE_TO_ARRAY: Message = Message::new("", "Remove `.toArray()`.");

const TYPED_ARRAYS: &[&str] = &[
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
];

/// The `a.method` of `a.method(..)`, if neither has a `?.` and the name is not computed.
fn plain_method_callee(call: Call<'_>) -> Option<Expr<'_>> {
    get_member_expr(call.callee()).filter(|it| it.tag() == ExprTag::Dot && !it.is_optional() && !call.is_optional())
}

/// What is wrong with a `.toArray()`, and whether it is safe to remove it.
enum Problem<'a> {
    /// `new Set(..)`, `Array.from(..)`
    IterableAccepting { description: Vec<u8>, is_safe: bool },
    ForOf,
    YieldStar,
    Spread,
    IteratorMethod(Name<'a>),
}

/// `to_array`: a `.toArray()` with what is around it that does not count.
fn problem_of(to_array: Expr<'_>) -> Option<Problem<'_>> {
    let parent = match to_array.parent() {
        Node::Stmt(parent) => {
            return matches!(parent.kind(), StmtKind::ForOf { expr, .. } if expr == to_array).then_some(Problem::ForOf);
        }
        Node::Expr(parent) => parent,
        _ => return None,
    };
    match parent.kind() {
        ExprKind::New(new) if new.args().first() == Some(to_array) => {
            let is_iterable_accepting = is_new_expression(new, &["Map", "WeakMap", "Set", "WeakSet"], Some(1), Some(1))
                || is_new_expression(new, TYPED_ARRAYS, Some(1), None);
            let name = get_inner_expression(new.callee()).as_ident().filter(|_| is_iterable_accepting)?;
            let description = [&b"new "[..], name.bytes(), "(…)".as_bytes()].concat();
            Some(Problem::IterableAccepting { description, is_safe: true })
        }
        ExprKind::Call(call) if call.args().first() == Some(to_array) => {
            let is_safe = is_method_call(call, Some(&["Array"]), Some(&["from"]), Some(1), None)
                || is_method_call(call, Some(TYPED_ARRAYS), Some(&["from"]), Some(1), None)
                || is_method_call(call, Some(&["Object"]), Some(&["fromEntries"]), Some(1), None);
            let methods_of_promise = ["all", "allSettled", "any", "race"];
            if !is_safe && !is_method_call(call, Some(&["Promise"]), Some(&methods_of_promise), Some(1), Some(1)) {
                return None;
            }
            let callee = plain_method_callee(call)?;
            let (object, method) = (get_inner_expression(callee.object()?).as_ident()?, callee.member_name()?);
            let description = [object.bytes(), b".", method.bytes(), "(…)".as_bytes()].concat();
            Some(Problem::IterableAccepting { description, is_safe })
        }
        ExprKind::Yield { star: true, .. } => Some(Problem::YieldStar),
        ExprKind::Spread(_) if parent.jsx_container_span().is_none() => {
            let list = parent.parent().as_expr()?;
            matches!(list.tag(), ExprTag::Array | ExprTag::Call | ExprTag::New).then_some(Problem::Spread)
        }
        // `iterator.toArray().every(fn)`
        ExprKind::Dot { name, .. } => {
            let mut callee = parent;
            while let Node::Expr(wrapper) = callee.parent()
                && matches!(
                    wrapper.tag(),
                    ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies | ExprTag::NonNull | ExprTag::Instantiation
                )
            {
                callee = wrapper;
            }
            let call = callee.parent().as_expr()?.as_call().filter(|it| plain_method_callee(*it) == Some(parent))?;
            let array_parameter_index = match name.bytes() {
                b"every" | b"find" | b"forEach" | b"some" if call.args().len() <= 1 => 2,
                b"reduce" if call.args().len() == 2 => 3,
                _ => return None,
            };
            let callback = call.args().first().and_then(|it| get_inner_expression(it).as_fn());
            // The array is passed to the callback.
            (!callback.is_some_and(|it| it.params().len() > array_parameter_index))
                .then_some(Problem::IteratorMethod(name.name()))
        }
        _ => None,
    }
}

impl Rule for NoUselessIteratorToArray {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-useless-iterator-to-array", Kind::Problem)
        .fixable(Fixable::Code)
        .has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUselessIteratorToArray
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("toArray") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call().filter(|it| it.args().is_empty()) else {
                return;
            };
            let Some(member) = plain_method_callee(call) else {
                return;
            };
            let (Some(object), Some(property)) = (member.object(), member.member_name()) else {
                return;
            };
            if !property.name().is("toArray") {
                return;
            }
            let Some(problem) = outermost_wrapper(e).and_then(problem_of) else {
                return;
            };
            let fix = |fixer: Fixer<'a>| {
                [
                    // `.toArray`
                    fixer.remove(Span::after(object.outer_span(), member.span().end)),
                    // `()`
                    fixer.remove(Span::after(call.callee().outer_span(), e.span().end)),
                ]
            };
            match problem {
                Problem::IterableAccepting { description, is_safe } => {
                    let report = cx.report(property, ITERABLE_ACCEPTING).data("description", description);
                    if is_safe { report.fix(fix) } else { report.suggest(REMOVE_TO_ARRAY, fix) }
                }
                Problem::ForOf => cx.report(property, FOR_OF).fix(fix),
                Problem::YieldStar => cx.report(property, YIELD_STAR).fix(fix),
                Problem::Spread => cx.report(property, SPREAD).fix(fix),
                Problem::IteratorMethod(method) => {
                    cx.report(property, ITERATOR_METHOD).data("method", method).suggest(REMOVE_TO_ARRAY, fix)
                }
            };
        });
    }
}
