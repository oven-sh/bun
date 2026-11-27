use crate::bun::{CALLED, Exports, module_calls, for_each_export_call, exports_option};
use crate::bun_emitters::{Emitter, Known, is_handled_or_escapes};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::eslint_utils::TraceMap;

/// Require an `error` listener on an event emitter that a Node.js function returns.
///
/// Without one the error is thrown. See "Error events" in the `node:events` documentation. The defaults are the Node.js
/// functions that start working as soon as they're called and return an object with a documented `'error'` event.
pub struct NoUnhandledEmitterErrors {
    factories: Exports,
}

const NO_LISTENER: &Message = &Message::new(
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
                && !is_handled_or_escapes(e, Emitter::Plain, Some(&mut known))
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
