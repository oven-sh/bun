use crate::{JSGlobalObject, JSValue};

pub use bun_http_types::FetchRedirect::CommonAbortReason;

pub trait CommonAbortReasonExt {
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
}

impl CommonAbortReasonExt for CommonAbortReason {
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        WebCore__CommonAbortReason__toJS(global, self)
    }
}

unsafe extern "C" {
    safe fn WebCore__CommonAbortReason__toJS(
        global: &JSGlobalObject,
        reason: CommonAbortReason,
    ) -> JSValue;
}

// ported from: src/jsc/CommonAbortReason.zig
