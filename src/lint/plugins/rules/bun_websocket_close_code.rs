use crate::bun::{compared_with, is_named_code};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow checking a WebSocket's close code for 1000 alone where `close()` is called without a code.
pub struct WebsocketCloseCode;

const CAN_BE_1005: &Message = &Message::new(
    "canBe1005",
    "`close()` without a code reports 1005, not 1000. Call `close(1000)`, or accept 1005 here.",
);

impl Rule for WebsocketCloseCode {
    const META: Meta = Meta::plugin(Plugin::Bun, "websocket-close-code", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        WebsocketCloseCode
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions_any(&["WebSocket", "websocket", "WebSocketServer"]).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let numbers = |value: f64| file.exprs_of_kind(ExprTag::Number).filter(move |it| it.as_number() == Some(value));
        let mut checks = numbers(1000.0).filter(|it| compared_with(*it).is_some_and(is_named_code)).peekable();
        if checks.peek().is_none() || numbers(1005.0).next().is_some() {
            return;
        }
        let closes = || {
            let calls = file.exprs_of_kind(ExprTag::Call).filter_map(Expr::as_call);
            calls.filter(|it| it.callee().member_name().is_some_and(|it| it.name().is("close")))
        };
        // Without any call it's the other end that closes, and that's in another file.
        if closes().next().is_none() || closes().any(|it| it.args().is_empty()) {
            for check in checks {
                cx.report(check, CAN_BE_1005);
            }
        }
    }
}
