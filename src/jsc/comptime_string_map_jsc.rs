//! JSC bridges for `bun.ComptimeStringMap(V)`. The generic map type stays in
//! `collections/`; only the `JSValue → V` lookup helpers live here.

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_string::{OwnedString, String as BunString, Tag};
// PORT NOTE: `from_js` on `bun_string::String` is provided by the `StringJsc`
// extension trait, which is allowed here because this file lives in `src/jsc/`.
use crate::StringJsc as _;

// PORT NOTE: reshaped for borrowck / Rust generics. Zig took `comptime Map: type`
// (the `ComptimeStringMap(V, ...)` instantiation, a namespace with static
// lookup decls). The Rust port of `ComptimeStringMap` is a `phf::Map` *value*
// (see PORTING.md §Collections), so callers pass a `&'static phf::Map` instead
// of a type parameter, and `Map.Value` becomes the generic `V`.

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
    // Zig used `Map.getWithEql(str, bun.String.eqlComptime)`, comparing a
    // `bun.String` against the map's comptime UTF-8 keys without unconditionally
    // transcoding. `phf` keys are `&[u8]`, so materialize UTF-8 bytes and do a
    // direct phf lookup.
    // PERF(port): avoid the UTF-8 transcode for 8-bit/latin1-backed strings —
    // profile in Phase B.
    let utf8 = str.to_utf8();
    Ok(map.get(utf8.slice()).copied())
}

pub fn from_js_case_insensitive<V: Copy>(
    map: &'static phf::Map<&'static [u8], V>,
    global_this: &JSGlobalObject,
    input: JSValue,
) -> JsResult<Option<V>> {
    // `defer str.deref()` — `OwnedString` releases the +1 ref on Drop.
    let str = OwnedString::new(BunString::from_js(input, global_this)?);
    debug_assert!(str.tag() != Tag::Dead);
    // Zig used `str.inMapCaseInsensitive(Map)`, which dispatches through the
    // map's length-bucketed comptime tables with an ASCII-case-insensitive
    // comparator. `phf` has no case-insensitive mode, so scan entries with the
    // same `eqlCaseInsensitiveASCII` comparator the Zig path used.
    let utf8 = str.to_utf8();
    let probe = utf8.slice();
    // PERF(port): linear ASCII case-insensitive scan over all entries; the Zig
    // path was O(1) via length bucketing — profile in Phase B.
    Ok(map
        .entries()
        .find(|(k, _)| bun_string::strings::eql_case_insensitive_ascii(probe, k, true))
        .map(|(_, v)| *v))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/comptime_string_map_jsc.zig (20 lines)
//   confidence: high
//   notes:      `comptime Map: type` reshaped to `&'static phf::Map<&[u8], V>`
// ──────────────────────────────────────────────────────────────────────────
