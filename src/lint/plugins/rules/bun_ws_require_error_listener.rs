use crate::bun::module_calls;
use crate::bun_emitters::{Emitter, Known, LISTEN, has_listener, is_handled_or_escapes, method_call};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::eslint_utils::TraceMap;

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
const MODULES: TraceMap<'static, ()> = TraceMap::new(&[("ws", WS)]);

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
        file.mentions("ws").then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut known = Known::default();
        for (e, name) in module_calls(cx.file(), &MODULES) {
            if !name.ends_with("Server") {
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
