/// ECMA-262 §21.4.1.1 Time Value range bound (±8.64e15 ms). Mirrors
/// `WTF::maxECMAScriptTime`; a static_assert in wtf-bindings.cpp keeps them in sync.
pub const MAX_ECMASCRIPT_TIME: f64 = 8.64e15;

pub use crate::string_builder::StringBuilder;
