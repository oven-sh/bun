//! JSC bridges for `bun.ComptimeStringMap(V)`. The generic map type stays in
//! `collections/`; only the `JSValue → V` lookup helpers live here.

use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_str::String as BunString;
// PORT NOTE: `from_js` on `bun_str::String` is provided by the `StringJsc`
// extension trait, which is allowed here because this file lives in `src/jsc/`.
use bun_jsc::StringJsc as _;

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
    let str = BunString::from_js(input, global_this)?;
    debug_assert!(str.tag() != bun_str::Tag::Dead);
    // `defer str.deref()` — handled by `Drop` on `bun_str::String`.
    // TODO(port): phf custom hasher — Zig used
    // `Map.getWithEql(str, bun.String.eqlComptime)`, comparing a `bun.String`
    // against the map's comptime UTF-8 keys without unconditionally transcoding.
    // For now, materialize UTF-8 bytes and do a direct phf lookup.
    let utf8 = str.to_utf8();
    Ok(map.get(utf8.as_bytes()).copied())
}

pub fn from_js_case_insensitive<V: Copy>(
    map: &'static phf::Map<&'static [u8], V>,
    global_this: &JSGlobalObject,
    input: JSValue,
) -> JsResult<Option<V>> {
    let str = BunString::from_js(input, global_this)?;
    debug_assert!(str.tag() != bun_str::Tag::Dead);
    // `defer str.deref()` — handled by `Drop` on `bun_str::String`.
    // TODO(port): phf custom hasher — Zig used `str.inMapCaseInsensitive(Map)`,
    // which dispatches through the map's length-bucketed comptime tables with an
    // ASCII-case-insensitive comparator. `phf` has no case-insensitive mode, so
    // Phase B must either (a) lower-case the probe and require lower-case keys
    // at map build time, or (b) keep this linear scan for small maps.
    let utf8 = str.to_utf8();
    // PERF(port): linear ASCII case-insensitive scan over all entries; the Zig
    // path was O(1) via length bucketing — profile in Phase B.
    Ok(map
        .entries()
        .find(|(k, _)| bun_str::strings::eql_case_insensitive_ascii(utf8.as_bytes(), k, true))
        .map(|(_, v)| *v))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/comptime_string_map_jsc.zig (20 lines)
//   confidence: medium
//   todos:      2
//   notes:      `comptime Map: type` reshaped to `&'static phf::Map<&[u8], V>`; getWithEql/case-insensitive need phf-side work in Phase B
// ──────────────────────────────────────────────────────────────────────────
