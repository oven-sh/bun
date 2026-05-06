//! JSC bridges for `url/url.zig` `URL`. The struct + parser stay in `url/`.

pub fn urlFromJS(js_value: jsc.JSValue, globalObject: *jsc.JSGlobalObject, allocator: std.mem.Allocator) !URL {
    var href = jsc.URL.hrefFromJS(globalObject, js_value);
    if (href.tag == .Dead) {
        return error.InvalidURL;
    }

    return URL.parse(try href.toOwnedSlice(allocator));
}

const std = @import("std");

const bun = @import("bun");
const URL = bun.URL;
const jsc = bun.jsc;
