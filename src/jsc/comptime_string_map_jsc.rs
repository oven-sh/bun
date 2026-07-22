//! JSC bridges for `bun.ComptimeStringMap(V)`. The generic map type stays in
//! `bun_core::comptime_string_map`; only the `JSValue → V` lookup helpers live
//! here.

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_core::{OwnedString, String as BunString, Tag};
// `from_js` on `bun_core::String` is provided by the `StringJsc` extension
// trait, which is allowed here because this file lives in `src/jsc/`.
use crate::StringJsc as _;

/// `map` is a [`bun_core::comptime_string_map::ComptimeStringMap`] instance
/// (Rust port of `ComptimeStringMap(V, ...)`); `M::Value` is the value type.
pub(crate) fn from_js<M>(
    map: &'static M,
    global_this: &JSGlobalObject,
    input: JSValue,
) -> JsResult<Option<M::Value>>
where
    M: bun_core::comptime_string_map::ComptimeStringMap,
    M::Value: Copy,
{
    // `defer str.deref()` — `OwnedString` releases the +1 ref on Drop.
    let str = OwnedString::new(BunString::from_js(input, global_this)?);
    debug_assert!(str.tag() != Tag::Dead);
    // Map keys are `&[u8]`, so materialize UTF-8 bytes and do a direct
    // lookup.
    // PERF: avoid the UTF-8 transcode for 8-bit/latin1-backed strings —
    // profile if hot.
    let utf8 = str.to_utf8();
    Ok(map.lookup(utf8.slice()).copied())
}
