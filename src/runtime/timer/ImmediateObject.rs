use bun_jsc::JSValue;

use super::Kind;

// `Immediate`, declared in `Timer.bind.ts`.
super::impl_timer_object!(ImmediateObject);

impl ImmediateObject {
    pub(crate) fn init(
        cx: &bun_jsc::JsThread<'_>,
        id: u64,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        Self::init_with(cx, id, Kind::SetImmediate, 0, callback, arguments)
    }
}
