//! JSC bridge for `bun.Semver.String`. Keeps `src/semver/` free of JSC types.

pub fn toJS(this: *const String, buffer: []const u8, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    return bun.String.createUTF8ForJS(globalThis, this.slice(buffer));
}

const bun = @import("bun");
const jsc = bun.jsc;
const String = bun.Semver.String;
