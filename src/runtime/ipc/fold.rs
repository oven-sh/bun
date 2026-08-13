//! The IPC message drain is a dispatcher of its own: every decoded message is
//! delivered to JS as a top-level call (node: a throwing `'message'` listener
//! is an uncaught exception and later messages still arrive), so what one
//! delivery leaves pending is folded here, per message, and the drain goes on —
//! unless the VM is stopping, which ends it.

use bun_jsc::{JSGlobalObject, JsError, Stopped};

#[cold]
pub(super) fn delivered_message(global: &JSGlobalObject, err: JsError) -> Result<(), Stopped> {
    bun_jsc::task::report_error_or_terminate(global, err)
}
