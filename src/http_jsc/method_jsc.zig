//! JSC bridge for `bun.http.Method`. Keeps `src/http_types/` free of JSC types.

extern "c" fn Bun__HTTPMethod__toJS(method: Method, globalObject: *jsc.JSGlobalObject) jsc.JSValue;

pub const toJS = Bun__HTTPMethod__toJS;

const Method = @import("../http_types/Method.zig").Method;

const bun = @import("bun");
const jsc = bun.jsc;
