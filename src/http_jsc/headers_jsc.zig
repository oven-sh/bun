//! JSC bridges for `bun.http.{Headers,H2Client,H3Client}`. Keeps `src/http/`
//! free of JSC types.

pub fn toFetchHeaders(this: *Headers, global: *bun.jsc.JSGlobalObject) bun.JSError!*FetchHeaders {
    if (this.entries.len == 0) {
        return FetchHeaders.createEmpty();
    }
    const headers = FetchHeaders.create(
        global,
        this.entries.items(.name).ptr,
        this.entries.items(.value).ptr,
        &bun.ZigString.fromBytes(this.buf.items),
        @truncate(this.entries.len),
    ) orelse return error.JSError;
    return headers;
}

pub const H2TestingAPIs = struct {
    pub fn liveCounts(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const obj = jsc.JSValue.createEmptyObject(globalThis, 2);
        obj.put(globalThis, jsc.ZigString.static("sessions"), .jsNumber(H2Client.live_sessions.load(.monotonic)));
        obj.put(globalThis, jsc.ZigString.static("streams"), .jsNumber(H2Client.live_streams.load(.monotonic)));
        return obj;
    }
};

pub const H3TestingAPIs = struct {
    /// Named distinctly from H2's `liveCounts` because generate-js2native.ts
    /// mangles `[^A-Za-z]` to `_`, so `H2Client.zig` and `H3Client.zig` produce
    /// the same path prefix and the function name has to differ.
    pub fn quicLiveCounts(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const obj = jsc.JSValue.createEmptyObject(globalThis, 2);
        obj.put(globalThis, jsc.ZigString.static("sessions"), .jsNumber(H3Client.live_sessions.load(.monotonic)));
        obj.put(globalThis, jsc.ZigString.static("streams"), .jsNumber(H3Client.live_streams.load(.monotonic)));
        return obj;
    }
};

const H2Client = @import("../http/H2Client.zig");
const H3Client = @import("../http/H3Client.zig");

const bun = @import("bun");
const jsc = bun.jsc;
const FetchHeaders = bun.webcore.FetchHeaders;
const Headers = bun.http.Headers;
