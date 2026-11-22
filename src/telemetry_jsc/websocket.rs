//! The `message` handler of a `ServerWebSocket`.

use bun_jsc::JSGlobalObject;
use bun_ptr::JsCell;
use bun_removable_features::removable_body_behind_value;
use bun_telemetry::{Instrument, SpanContext, SpanKind, StatusCode};

use crate::context::Parent;
use crate::held::HeldSpan;
use crate::native;

struct Traced {
    /// Messages link to the request that was upgraded. As its children they would make a trace without an end.
    upgrade: Option<SpanContext>,
    /// The handler returned a promise. The newest: an older span is left to its promise, and is collected with it.
    unsettled: Vec<HeldSpan>,
}

impl Traced {
    const MAX_UNSETTLED: usize = 32;

    fn keep(&mut self, span: HeldSpan) {
        self.unsettled.push(span);
        self.unsettled.retain(|span| !span.has_ended());
        if self.unsettled.len() > Self::MAX_UNSETTLED {
            self.unsettled.remove(0);
        }
    }
}

/// One word, null while tracing is off.
pub struct TracedSocket(JsCell<Option<Box<Traced>>>);

fn abandon(span: &HeldSpan) {
    let message = b"connection closed before the message handler settled";
    span.describe(|r| r.set_status(StatusCode::Error, message));
    span.end();
}

impl TracedSocket {
    /// While the handler of the upgrade runs.
    #[inline(always)]
    pub fn new(global: &JSGlobalObject) -> TracedSocket {
        TracedSocket(JsCell::new(
            bun_telemetry::enabled(Instrument::WebSocket).then(|| {
                removable_body_behind_value!(Telemetry, {
                    Box::new(Traced {
                        upgrade: native::active_span_context(global),
                        unsettled: Vec::new(),
                    })
                })
            }),
        ))
    }

    #[inline(always)]
    pub fn begin_message(&self, global: &JSGlobalObject, is_binary: bool, len: usize) -> HeldSpan {
        let Some(traced) = self.0.get() else {
            return HeldSpan::default();
        };
        removable_body_behind_value!(Telemetry, {
            let instrument = Instrument::WebSocket;
            let is_wanted = bun_telemetry::enabled(instrument)
                && (traced.upgrade.is_some() || bun_telemetry::allows_root(instrument));
            let Some(data) = is_wanted
                .then(|| {
                    native::start_under(global, Parent::default(), instrument, SpanKind::Server)
                })
                .flatten()
            else {
                return HeldSpan::default();
            };
            let span = HeldSpan::new(global, data);
            span.describe(|r| {
                r.set_name(b"websocket.message");
                // There is no semantic convention yet. These are the names of dd-trace's plugin for ws.
                r.attr(
                    "websocket.message.type",
                    if is_binary { "binary" } else { "text" },
                );
                r.attr("websocket.message.length", len as i64);
                if let Some(upgrade) = &traced.upgrade {
                    r.begin_link(upgrade, b"");
                }
            });
            span
        })
    }

    /// After [`HeldSpan::end_with_result`].
    #[inline(always)]
    pub fn keep_if_unsettled(&self, span: HeldSpan) {
        if span.is_some() {
            removable_body_behind_value!(Telemetry, {
                self.0.with_mut(|traced| match traced {
                    Some(traced) => traced.keep(span),
                    None => abandon(&span),
                });
            });
        }
    }

    #[inline(always)]
    pub fn closed(&self) {
        if let Some(traced) = self.0.take() {
            removable_body_behind_value!(Telemetry, { traced.unsettled.iter().for_each(abandon) });
        }
    }
}
