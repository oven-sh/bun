//! JSC bridge for `bun.css.Err(T)`. Keeps `src/css/` free of JSC types.

/// `this` is `*const css.Err(T)` for any `T`; only `.kind` is accessed.
pub fn toErrorInstance(this: anytype, globalThis: *bun.jsc.JSGlobalObject) !bun.jsc.JSValue {
    var str = try bun.String.createFormat("{f}", .{this.kind});
    defer str.deref();
    return str.toErrorInstance(globalThis);
}

const bun = @import("bun");
