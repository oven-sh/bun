//! Where `node:quic` folds an exception it cannot hand back to a caller.
//!
//! Two shapes reach here. The session's event drain (`process_events`) is a
//! dispatcher of its own: each queued lsquic event is delivered to JS as a
//! top-level call, and an event whose arguments cannot be built returns the
//! exception to the drain, which folds it once ([`drained_event`]). And node's
//! lifecycle callbacks (`onSessionClose`, `onSessionHandshake`, …) run behind
//! state that is latched *before* their arguments are built — bailing would
//! leave `closed`/`opened` never settling — so an argument that cannot be built
//! is reported and replaced with `undefined` ([`OrReport`]). Both can run
//! beneath a host function as well as at loop entry, so neither drains
//! microtasks itself.

use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult};

#[cold]
pub(super) fn drained_event(global: &JSGlobalObject, err: JsError) {
    let _ = bun_jsc::task::report_error_or_terminate(global, err);
}

/// The lsquic / UDP-socket callbacks (`on_new_conn`, `on_new_stream`, the
/// endpoint's `on_data`) return into C, some with a value lsquic needs: what
/// they could not hand back is folded at that boundary.
#[cold]
pub(super) fn at_boundary(global: &JSGlobalObject, err: JsError) {
    let _ = bun_jsc::task::report_error_or_terminate(global, err);
}

pub(crate) trait OrReport {
    fn or_report(self, global: &JSGlobalObject) -> JSValue;
}

impl OrReport for JsResult<JSValue> {
    #[inline]
    fn or_report(self, global: &JSGlobalObject) -> JSValue {
        match self {
            Ok(v) => v,
            Err(e) => {
                at_boundary(global, e);
                JSValue::UNDEFINED
            }
        }
    }
}
