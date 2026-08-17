//! uSockets calls made from the JS thread that dispatch a socket's callbacks — script — synchronously from
//! inside the call (`close` → `on_close` / `on_connect_error`). `bun_uws` cannot see the VM, so the raw
//! calls return nothing; on the JS thread they are calls that enter script and are made through here,
//! checked, so the caller has a `JsResult` to propagate.

use crate::{JSGlobalObject, JsResult};
use bun_uws::{AnySocket, CloseCode, NewSocketHandler};

pub trait SocketJsc {
    /// `close`, checked: `Err` if the close/connect-error handler it ran left an exception pending.
    fn close_js(&self, global: &JSGlobalObject, code: CloseCode) -> JsResult<()>;
}

impl<const SSL: bool> SocketJsc for NewSocketHandler<SSL> {
    #[inline]
    fn close_js(&self, global: &JSGlobalObject, code: CloseCode) -> JsResult<()> {
        crate::host_fn::from_js_host_call_generic(global, || self.close(code))
    }
}

impl SocketJsc for AnySocket {
    #[inline]
    fn close_js(&self, global: &JSGlobalObject, code: CloseCode) -> JsResult<()> {
        crate::host_fn::from_js_host_call_generic(global, || self.close(code))
    }
}
