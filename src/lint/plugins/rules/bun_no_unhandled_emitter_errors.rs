use crate::bun::{CALLED, Exports, module_calls, for_each_export_call, exports_option};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::eslint_utils::TraceMap;
use bun_lint_oxlint::ast_util::static_string;
use rustc_hash::FxHashMap;

/// Require an `error` listener on an event emitter that a Node.js function returns.
///
/// Without one the error is thrown. See "Error events" in the `node:events` documentation. The defaults are the Node.js
/// functions that start working as soon as they're called and return an object with a documented `'error'` event.
pub struct NoUnhandledEmitterErrors {
    factories: Exports,
}

const NO_LISTENER: Message = Message::new(
    "noListener",
    "`{{name}}()` emits `error` when it fails, which crashes the process if nothing listens. Add an `error` listener.",
);

const FORK: TraceMap<'static, ()> = TraceMap::new(&[("fork", CALLED)]);
const PROCESS: TraceMap<'static, ()> = TraceMap::new(&[("fork", CALLED), ("spawn", CALLED)]);
const FILE: TraceMap<'static, ()> =
    TraceMap::new(&[("createReadStream", CALLED), ("createWriteStream", CALLED), ("watch", CALLED)]);
const REQUEST: TraceMap<'static, ()> = TraceMap::new(&[("get", CALLED), ("request", CALLED)]);
const CONNECT: TraceMap<'static, ()> = TraceMap::new(&[("connect", CALLED)]);
const SOCKET: TraceMap<'static, ()> = TraceMap::new(&[("connect", CALLED), ("createConnection", CALLED)]);
const NODE: TraceMap<'static, ()> = TraceMap::new(&[
    ("child_process", PROCESS),
    ("cluster", FORK),
    ("fs", FILE),
    ("http", REQUEST),
    ("http2", CONNECT),
    ("https", REQUEST),
    ("net", SOCKET),
    ("tls", CONNECT),
    ("node:child_process", PROCESS),
    ("node:cluster", FORK),
    ("node:fs", FILE),
    ("node:http", REQUEST),
    ("node:http2", CONNECT),
    ("node:https", REQUEST),
    ("node:net", SOCKET),
    ("node:tls", CONNECT),
]);

/// The methods that add a listener. They return the emitter.
const LISTEN: [&str; 5] = ["addListener", "on", "once", "prependListener", "prependOnceListener"];

/// For `receiver.name(..)`, returns the name, the call, and the whole call expression.
fn method_call<'a>(receiver: Expr<'a>) -> Option<(Name<'a>, Call<'a>, Expr<'a>)> {
    let member = receiver.parent().as_expr()?;
    let whole = member.parent().as_expr()?;
    match (member.kind(), whole.as_call()) {
        (ExprKind::Dot { obj, name, .. }, Some(call)) if obj == receiver && call.callee() == member => {
            Some((name.name(), call, whole))
        }
        _ => None,
    }
}

/// Caches whether a variable has a listener, by [`Symbol::key`]. Many emitters can be assigned to one variable.
type Known = FxHashMap<usize, bool>;

fn has_listener(variable: Symbol) -> bool {
    let is_exported = |it: Declaration| matches!(it.parent(), Some(Node::Stmt(statement)) if statement.is_exported());
    // A reference that isn't an expression, as in `export { a }`, can't be followed.
    let mut uses = variable.references().filter(|it| !it.is_init()).map(Reference::expr);
    variable.declarations().any(is_exported) || uses.any(|it| it.is_none_or(|e| is_handled_or_escapes(e, None)))
}

/// True if the emitter `e` gets an `error` listener, or escapes to where we can't tell. `known` is passed if `e` isn't
/// itself a reference to a variable. In that case, a variable that `e` is assigned to is checked too.
fn is_handled_or_escapes(mut e: Expr, mut known: Option<&mut Known>) -> bool {
    let mut is_emitter = true;
    loop {
        if let Node::Expr(wrapper) = e.parent()
            && matches!(wrapper.tag(), ExprTag::As | ExprTag::Satisfies | ExprTag::NonNull)
        {
            e = wrapper;
            continue;
        }
        let Some((name, call, whole)) = method_call(e) else {
            break;
        };
        let listens = name.is_any(&LISTEN);
        if listens && call.args().first().and_then(static_string).is_some_and(|it| it.is("error")) {
            return true;
        }
        // `pipe` returns the destination stream, not the emitter.
        if name.is("pipe") {
            return false;
        }
        is_emitter &= listens;
        e = whole;
    }
    let mut variable_has_listener = |variable: Option<Symbol>| match (variable, known.as_deref_mut()) {
        (Some(variable), Some(known)) if is_emitter => {
            *known.entry(variable.key()).or_insert_with(|| has_listener(variable))
        }
        _ => true,
    };
    match e.parent() {
        Node::Stmt(statement) => statement.tag() != StmtTag::Expr,
        // A destructured property isn't the emitter.
        Node::VarDecl(declaration) => declaration.pat().symbol().is_some_and(|it| variable_has_listener(Some(it))),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj != e,
            ExprKind::Assign { target, value, .. } => value == e && variable_has_listener(target.symbol()),
            _ => true,
        },
        _ => true,
    }
}

impl Rule for NoUnhandledEmitterErrors {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-unhandled-emitter-errors", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoUnhandledEmitterErrors { factories: exports_option(options, "factories") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!self.factories.is_empty() || NODE.members.iter().any(|it| file.mentions(it.0))).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let mut known = Known::default();
        let mut check = |e: Expr<'a>, name: &str| {
            if let Some(callee) = e.callee()
                && !is_handled_or_escapes(e, Some(&mut known))
            {
                cx.report(callee, NO_LISTENER).data("name", name.to_owned());
            }
        };
        if NODE.members.iter().any(|it| file.mentions(it.0)) {
            for (e, name) in module_calls(file, &NODE) {
                check(e, name);
            }
        }
        for_each_export_call(file, &self.factories, CALLED, &mut check);
    }
}
