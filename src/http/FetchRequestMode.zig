/// https://developer.mozilla.org/en-US/docs/Web/API/Request/mode
pub const FetchRequestMode = enum(u2) {
    @"same-origin",
    @"no-cors",
    cors,
    navigate,

    pub const Map = bun.ComptimeStringMap(FetchRequestMode, .{
        .{ "same-origin", .@"same-origin" },
        .{ "no-cors", .@"no-cors" },
        .{ "cors", .cors },
        .{ "navigate", .navigate },
    });

    extern "c" fn Bun__FetchRequestMode__toJS(mode: u8, globalObject: *jsc.JSGlobalObject) jsc.JSValue;
    pub inline fn toJS(this: FetchRequestMode, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        return Bun__FetchRequestMode__toJS(@intFromEnum(this), globalObject);
    }
};

const bun = @import("bun");
const jsc = bun.jsc;
