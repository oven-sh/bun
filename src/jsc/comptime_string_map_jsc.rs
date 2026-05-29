//! JSC bridges for `bun.ComptimeStringMap(V)`. The generic map type stays in
//! `collections/`; only the `JSValue → V` lookup helpers live here.

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_core::{OwnedString, String as BunString, Tag};
// PORT NOTE: `from_js` on `bun_core::String` is provided by the `StringJsc`
// extension trait, which is allowed here because this file lives in `src/jsc/`.
use crate::StringJsc as _;

/// `map` is the `phf::Map<&'static [u8], V>` instance (Rust port of
/// `ComptimeStringMap(V, ...)`); `V` is the value type.
pub fn from_js<V: Copy>(
    map: &'static phf::Map<&'static [u8], V>,
    global_this: &JSGlobalObject,
    input: JSValue,
) -> JsResult<Option<V>> {
    // `defer str.deref()` — `OwnedString` releases the +1 ref on Drop.
    let str = OwnedString::new(BunString::from_js(input, global_this)?);
    debug_assert!(str.tag() != Tag::Dead);
    let utf8 = str.to_utf8();
    Ok(map.get(utf8.slice()).copied())
}

// ported from: src/jsc/comptime_string_map_jsc.zig
