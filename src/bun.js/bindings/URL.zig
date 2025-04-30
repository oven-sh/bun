pub const URL = opaque {
    extern fn URL__fromJS(JSValue, *JSC.JSGlobalObject) ?*URL;
    extern fn URL__fromString(*bun.String) ?*URL;
    extern fn URL__protocol(*URL) String;
    extern fn URL__href(*URL) String;
    extern fn URL__username(*URL) String;
    extern fn URL__password(*URL) String;
    extern fn URL__search(*URL) String;
    extern fn URL__host(*URL) String;
    extern fn URL__hostname(*URL) String;
    extern fn URL__port(*URL) u32;
    extern fn URL__deinit(*URL) void;
    extern fn URL__pathname(*URL) String;
    extern fn URL__getHrefFromJS(JSValue, *JSC.JSGlobalObject) String;
    extern fn URL__getHref(*String) String;
    extern fn URL__getFileURLString(*String) String;
    extern fn URL__getHrefJoin(*String, *String) String;
    extern fn URL__pathFromFileURL(*String) String;

    pub fn hrefFromString(str: bun.String) String {
        JSC.markBinding(@src());
        var input = str;
        return URL__getHref(&input);
    }

    pub fn join(base: bun.String, relative: bun.String) String {
        JSC.markBinding(@src());
        var base_str = base;
        var relative_str = relative;
        return URL__getHrefJoin(&base_str, &relative_str);
    }

    pub fn fileURLFromString(str: bun.String) String {
        JSC.markBinding(@src());
        var input = str;
        return URL__getFileURLString(&input);
    }

    pub fn pathFromFileURL(str: bun.String) String {
        JSC.markBinding(@src());
        var input = str;
        return URL__pathFromFileURL(&input);
    }

    /// This percent-encodes the URL, punycode-encodes the hostname, and returns the result
    /// If it fails, the tag is marked Dead
    pub fn hrefFromJS(value: JSValue, globalObject: *JSC.JSGlobalObject) bun.JSError!String {
        JSC.markBinding(@src());
        const result = URL__getHrefFromJS(value, globalObject);
        if (globalObject.hasException()) return error.JSError;
        return result;
    }

    pub fn fromJS(value: JSValue, globalObject: *JSC.JSGlobalObject) bun.JSError!?*URL {
        JSC.markBinding(@src());
        const result = URL__fromJS(value, globalObject);
        if (globalObject.hasException()) return error.JSError;
        return result;
    }

    pub fn fromUTF8(input: []const u8) ?*URL {
        return fromString(String.fromUTF8(input));
    }
    pub fn fromString(str: bun.String) ?*URL {
        JSC.markBinding(@src());
        var input = str;
        return URL__fromString(&input);
    }
    pub fn protocol(url: *URL) String {
        JSC.markBinding(@src());
        return URL__protocol(url);
    }
    pub fn href(url: *URL) String {
        JSC.markBinding(@src());
        return URL__href(url);
    }
    pub fn username(url: *URL) String {
        JSC.markBinding(@src());
        return URL__username(url);
    }
    pub fn password(url: *URL) String {
        JSC.markBinding(@src());
        return URL__password(url);
    }
    pub fn search(url: *URL) String {
        JSC.markBinding(@src());
        return URL__search(url);
    }
    pub fn host(url: *URL) String {
        JSC.markBinding(@src());
        return URL__host(url);
    }
    pub fn hostname(url: *URL) String {
        JSC.markBinding(@src());
        return URL__hostname(url);
    }
    /// Returns `std.math.maxInt(u32)` if the port is not set. Otherwise, `port`
    /// is guaranteed to be within the `u16` range.
    pub fn port(url: *URL) u32 {
        JSC.markBinding(@src());
        return URL__port(url);
    }
    pub fn deinit(url: *URL) void {
        JSC.markBinding(@src());
        return URL__deinit(url);
    }
    pub fn pathname(url: *URL) String {
        JSC.markBinding(@src());
        return URL__pathname(url);
    }

    extern fn URL__originLength(latin1_slice: [*]const u8, len: usize) u32;
    pub fn originFromSlice(slice: []const u8) ?[]const u8 {
        JSC.markBinding(@src());
        // a valid URL will not have ascii in the origin.
        const first_non_ascii = bun.strings.firstNonASCII(slice) orelse slice.len;
        const len = URL__originLength(
            slice[0..first_non_ascii].ptr,
            first_non_ascii,
        );
        if (len == 0) return null;
        return slice[0..len];
    }
};

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const JSError = bun.JSError;
const String = bun.String;
