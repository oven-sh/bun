//! JSC bridge for lol-html `HTMLString`. Keeps `src/lolhtml_sys/` free of JSC types.

pub fn htmlStringToJS(this: HTMLString, globalThis: *bun.jsc.JSGlobalObject) bun.JSError!bun.jsc.JSValue {
    var str = this.toString();
    defer str.deref();
    return try str.toJS(globalThis);
}

const bun = @import("bun");
const HTMLString = bun.LOLHTML.HTMLString;
