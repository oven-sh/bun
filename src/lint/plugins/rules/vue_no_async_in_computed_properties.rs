use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id};
use crate::oxlint::vue::{
    ComputedContext, EnclosingFunctions, find_computed_context, get_computed_getter_context, is_this_object,
    is_vue_file,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Disallow asynchronous actions in computed properties.
pub struct NoAsyncInComputedProperties {
    ignored_object_names: FxHashSet<Box<[u8]>>,
}

const UNEXPECTED_IN_PROPERTY: Message = Message::new("", "Unexpected {{kind}} in \"{{key}}\" computed property.");
const UNEXPECTED_IN_FUNCTION: Message = Message::new("", "Unexpected {{kind}} in computed function.");

const ASYNC_FUNCTION: &str = "async function declaration";
const AWAIT: &str = "await operator";
const NEW_PROMISE: &str = "Promise object";
const ASYNCHRONOUS: &str = "asynchronous action";
const TIMED: &str = "timed function";

const TIMED_FUNCTIONS: [&str; 4] = ["setTimeout", "setInterval", "setImmediate", "requestAnimationFrame"];

impl Rule for NoAsyncInComputedProperties {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-async-in-computed-properties", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Await, ExprTag::New, ExprTag::Call]).funcs();
    type State<'a> = EnclosingFunctions<'a>;

    fn new(options: &Options) -> Self {
        let names = options.object(0).strings("ignoredObjectNames");
        NoAsyncInComputedProperties { ignored_object_names: names.iter().map(|it| it.as_bytes().into()).collect() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (is_vue_file(file) && file.mentions("computed")).then(EnclosingFunctions::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let kind = match e.kind() {
            ExprKind::Await(_) => AWAIT,
            ExprKind::New(new_expr) if is_specific_id(new_expr.callee(), "Promise") => NEW_PROMISE,
            ExprKind::Call(call) if self.is_promise_method_call(call) || is_next_tick_call(call) => ASYNCHRONOUS,
            ExprKind::Call(call) if is_timed_function_call(call) => TIMED,
            _ => return,
        };
        if let Some(context) = find_computed_context(e, &mut cx.state) {
            report(e.span(), context, kind, cx);
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if func.is_async()
            && let Some(context) = get_computed_getter_context(func)
        {
            report(func.estree_span(), context, ASYNC_FUNCTION, cx);
        }
    }
}

fn report<'a>(span: Span, context: ComputedContext<'a>, kind: &'static str, cx: &Cx<'a, NoAsyncInComputedProperties>) {
    match context {
        ComputedContext::OptionsApi(key) => {
            cx.report(span, UNEXPECTED_IN_PROPERTY).data("kind", kind).data("key", key.map_or(&b"Unknown"[..], Name::bytes))
        }
        ComputedContext::CompositionApi(_) => cx.report(span, UNEXPECTED_IN_FUNCTION).data("kind", kind),
    };
}

/// The name and the object of `object.name`, if that is what is called.
fn callee_static_member(call: Call<'_>) -> Option<(Name<'_>, Expr<'_>)> {
    let callee = get_inner_expression(call.callee());
    match callee.kind() {
        ExprKind::Dot { obj, name, .. } if !callee.is_private_member() => Some((name.name(), obj)),
        _ => None,
    }
}

fn is_timed_function_call(call: Call) -> bool {
    if call.args().is_empty() {
        return false;
    }
    match get_inner_expression(call.callee()).as_ident() {
        Some(name) => name.is_any(&TIMED_FUNCTIONS),
        None => callee_static_member(call)
            .is_some_and(|(name, object)| name.is_any(&TIMED_FUNCTIONS) && is_specific_id(object, "window")),
    }
}

/// `this.$nextTick()`, `Vue.nextTick()`
fn is_next_tick_call(call: Call) -> bool {
    callee_static_member(call).is_some_and(|(name, object)| {
        name.is("$nextTick") && is_this_object(object) || name.is("nextTick") && is_specific_id(object, "Vue")
    })
}

/// The `a` of `a.b().c[d]`.
fn get_root_object_name(expr: Expr<'_>) -> Option<Name<'_>> {
    let mut at = expr;
    loop {
        at = match at.kind() {
            ExprKind::Ident(name) => return Some(name),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            ExprKind::Call(call) => call.callee(),
            ExprKind::As { .. }
            | ExprKind::AsConst(_)
            | ExprKind::Satisfies { .. }
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. } => at.operand()?,
            _ => return None,
        };
    }
}

impl NoAsyncInComputedProperties {
    /// `a.then()`, `a.catch()`, `a.finally()`, `Promise.all()`, ..
    fn is_promise_method_call(&self, call: Call) -> bool {
        let Some((name, object)) = callee_static_member(call) else {
            return false;
        };
        let is_promise_static = || {
            name.is_any(&["all", "allSettled", "any", "race", "reject", "resolve", "try", "withResolvers"])
                && is_specific_id(object, "Promise")
        };
        (name.is_any(&["then", "catch", "finally"]) || is_promise_static())
            && !(!self.ignored_object_names.is_empty()
                && get_root_object_name(object).is_some_and(|root| self.ignored_object_names.contains(root.bytes())))
    }
}
