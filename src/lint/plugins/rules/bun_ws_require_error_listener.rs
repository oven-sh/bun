use crate::bun::{loads_ws, module_calls, module_loads};
use crate::bun_emitters::{Emitter, Known, LISTEN, has_listener, is_handled_or_escapes, method_call};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::IdSet;
use bun_lint::utils::eslint_utils::{ReferenceKind, ReferenceTracker, Trace, TraceMap};

/// Require an `error` listener on the sockets of the `ws` package.
pub struct WsRequireErrorListener;

const NO_LISTENER: &Message = &Message::new(
    "noListener",
    "This socket emits `error` when it fails, which crashes the process if nothing listens. Add an `error` listener.",
);

const CONSTRUCTED: TraceMap<'static, ()> = TraceMap::EMPTY.construct(());
const SERVERS: [(&str, TraceMap<'static, ()>); 2] = [("Server", CONSTRUCTED), ("WebSocketServer", CONSTRUCTED)];
const WS: TraceMap<'static, ()> =
    TraceMap::new(&[SERVERS[0], SERVERS[1], ("WebSocket", TraceMap::new(&SERVERS).construct(()))]).construct(());
const NAMESPACE: TraceMap<'static, ()> = TraceMap::new(&[SERVERS[0], SERVERS[1], ("WebSocket", WS), ("default", WS)]);
const SERVER_FILES: [&str; 2] = ["ws/lib/websocket-server", "ws/lib/websocket-server.js"];
/// The other files of the package, like `ws/lib/receiver`, don't export a socket.
const MODULES: TraceMap<'static, ()> = TraceMap::new(&[
    ("ws", WS),
    ("ws/index.js", WS),
    ("ws/lib/websocket", WS),
    ("ws/lib/websocket.js", WS),
    ("ws/wrapper.mjs", WS),
    (SERVER_FILES[0], CONSTRUCTED),
    (SERVER_FILES[1], CONSTRUCTED),
]);

/// [`module_calls`], and the same for `await import("ws")`, `import WebSocket = require("ws")` and a local `require`.
fn constructions<'a>(file: &'a File<'a>) -> Vec<(Expr<'a>, &'static str)> {
    let mut found = module_calls(file, &MODULES);
    let tracker = ReferenceTracker::new(file);
    let mut follow = |e: Expr<'a>, module: &'static str, map: &'static dyn Trace<'static>| {
        let constructed = tracker.iterate_property_references(e, map).into_iter().filter(|it| it.kind == ReferenceKind::Construct);
        found.extend(constructed.filter_map(|it| Some((it.expr()?, it.path.last().copied().filter(|it| *it != "default").unwrap_or(module)))));
    };
    for (e, specifier) in module_loads(file) {
        let Some((module, map)) = MODULES.get(specifier.bytes()) else {
            continue;
        };
        if e.tag() == ExprTag::Call {
            follow(e, module, map);
            continue;
        }
        let mut around = Node::Expr(e).ancestors().map_while(Node::as_expr);
        if let Some(awaited) = around.find(|it| it.skip_type_wrappers() != e).filter(|it| it.tag() == ExprTag::Await) {
            follow(awaited, module, &NAMESPACE);
        }
    }
    for symbol in file.top_level_scope().symbols() {
        if let Some(Declaration::ImportEquals(it)) = symbol.declarations().next()
            && let ImportEqualsTarget::Require(Some(specifier)) = it.target()
            && let Some((module, map)) = MODULES.get(specifier.bytes())
        {
            symbol.references().filter_map(Reference::expr).for_each(|it| follow(it, module, map));
        }
    }
    let mut seen = IdSet::new();
    found.retain(|it| seen.insert(it.0));
    found
}

/// Reports the `socket` of `server.on("connection", socket => ..)`, also further down a chain of `on(..)` calls.
fn check_connections<'a>(mut server: Expr<'a>, cx: &Cx<'a, WsRequireErrorListener>) {
    while let Some((name, call, whole)) = method_call(server)
        && name.is_any(&LISTEN)
    {
        if call.args().first().and_then(Expr::as_string).is_some_and(|it| it.is("connection"))
            && let Some(socket) = call.args().get(1).and_then(Expr::as_fn).and_then(|it| it.params().first())
            && !socket.is_rest()
            && socket.pat().symbol().is_some_and(|it| !has_listener(it, Emitter::EventTarget))
        {
            cx.report(socket.pat(), NO_LISTENER);
        }
        server = whole;
    }
}

impl Rule for WsRequireErrorListener {
    const META: Meta = Meta::plugin(Plugin::Bun, "ws-require-error-listener", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        WsRequireErrorListener
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.has_exprs([ExprTag::New]) && loads_ws(file)).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut known = Known::default();
        for (e, name) in constructions(cx.file()) {
            if !name.ends_with("Server") && !SERVER_FILES.contains(&name) {
                if !is_handled_or_escapes(e, Emitter::EventTarget, Some(&mut known)) {
                    cx.report(e, NO_LISTENER);
                }
                continue;
            }
            check_connections(e, cx);
            if let Node::VarDecl(it) = e.parent()
                && let Some(server) = it.pat().symbol()
            {
                server.references().filter_map(Reference::expr).for_each(|it| check_connections(it, cx));
            }
        }
    }
}
