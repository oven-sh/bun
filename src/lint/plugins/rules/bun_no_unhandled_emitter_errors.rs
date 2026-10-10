use crate::bun::{CALLED, Exports, calls_of_modules, each_call_of_exports, exports_option};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::eslint_utils::TraceMap;
use bun_lint_oxlint::ast_util::static_string;
use rustc_hash::FxHashMap;

/// Require a listener for `error` on an event emitter that a function of Node.js returns.
///
/// Without one the error is thrown: see "Error events" in the documentation of `node:events`. By default the functions
/// of Node.js that begin to work when they are called and return an object for which an `'error'` event is documented.
pub struct NoUnhandledEmitterErrors {
    factories: Exports,
}

const NO_LISTENER: Message = Message::new(
    "noListener",
    "What `{{name}}()` returns emits `error` when it fails, and without a listener for that event the process ends.",
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

/// They return the emitter.
const LISTEN: [&str; 5] = ["addListener", "on", "once", "prependListener", "prependOnceListener"];

/// `receiver.name(..)`: the name, the call, and all of it.
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

/// Which variables have a listener, by [`Symbol::key`]: many emitters can be the value of one.
type Known = FxHashMap<usize, bool>;

fn has_listener(variable: Symbol) -> bool {
    // What is no expression, as in `export { a }`, cannot be followed.
    let mut uses = variable.references().filter(|it| !it.is_init()).map(Reference::expr);
    uses.any(|it| it.is_none_or(|e| is_taken_care_of(e, None)))
}

/// Whether the emitter `e` gets a listener for `error`, or goes where that cannot be seen. `known`: it is not the name
/// of a variable, so that a variable which it is the value of is looked at.
fn is_taken_care_of(mut e: Expr, mut known: Option<&mut Known>) -> bool {
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
        // It returns the other stream.
        if name.is("pipe") {
            return false;
        }
        is_emitter &= listens;
        e = whole;
    }
    let mut of_variable = |variable: Option<Symbol>| match (variable, known.as_deref_mut()) {
        (Some(variable), Some(known)) if is_emitter => {
            *known.entry(variable.key()).or_insert_with(|| has_listener(variable))
        }
        _ => true,
    };
    match e.parent() {
        Node::Stmt(statement) => statement.tag() != StmtTag::Expr,
        // What a pattern takes out of it is not the emitter.
        Node::VarDecl(declaration) => declaration.pat().symbol().is_some_and(|it| of_variable(Some(it))),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj != e,
            ExprKind::Assign { target, value, .. } => value == e && of_variable(target.symbol()),
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
                && !is_taken_care_of(e, Some(&mut known))
            {
                cx.report(callee, NO_LISTENER).data("name", name.to_owned());
            }
        };
        if NODE.members.iter().any(|it| file.mentions(it.0)) {
            for (e, name) in calls_of_modules(file, &NODE) {
                check(e, name);
            }
        }
        each_call_of_exports(file, &self.factories, CALLED, &mut check);
    }
}
