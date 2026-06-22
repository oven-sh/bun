//! JSC bridges for `bun.ComptimeStringMap(V)`. The generic map type stays in
//! `collections/`; only the `JSValue → V` lookup helpers live here.

/// `Map` is the `ComptimeStringMap(V, ...)` instantiation; `Map.Value` is the value type.
pub fn fromJS(comptime Map: type, globalThis: *jsc.JSGlobalObject, input: jsc.JSValue) bun.JSError!?Map.Value {
    const str = try bun.String.fromJS(input, globalThis);
    bun.assert(str.tag != .Dead);
    defer str.deref();
    return Map.getWithEql(str, bun.String.eqlComptime);
}

pub fn fromJSCaseInsensitive(comptime Map: type, globalThis: *jsc.JSGlobalObject, input: jsc.JSValue) bun.JSError!?Map.Value {
    const str = try bun.String.fromJS(input, globalThis);
    bun.assert(str.tag != .Dead);
    defer str.deref();
    return str.inMapCaseInsensitive(Map);
}

const bun = @import("bun");
const jsc = bun.jsc;
