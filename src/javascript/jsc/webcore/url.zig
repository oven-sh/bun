const URL = @import("../../../url.zig").URL;
const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const RequestContext = @import("../../../http.zig").RequestContext;
const MimeType = @import("../../../http.zig").MimeType;
const ZigURL = @import("../../../url.zig").URL;
const HTTPClient = @import("http");
const NetworkThread = HTTPClient.NetworkThread;

const JSC = @import("../../../jsc.zig");
const js = JSC.C;

const Method = @import("../../../http/method.zig").Method;

const ObjectPool = @import("../../../pool.zig").ObjectPool;

const Output = @import("../../../global.zig").Output;
const MutableString = @import("../../../global.zig").MutableString;
const strings = @import("../../../global.zig").strings;
const string = @import("../../../global.zig").string;
const default_allocator = @import("../../../global.zig").default_allocator;
const FeatureFlags = @import("../../../global.zig").FeatureFlags;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const Properties = @import("../base.zig").Properties;
const NewClass = @import("../base.zig").NewClass;
const d = @import("../base.zig").d;
const castObj = @import("../base.zig").castObj;
const getAllocator = @import("../base.zig").getAllocator;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const GetJSPrivateData = @import("../base.zig").GetJSPrivateData;
const Environment = @import("../../../env.zig");
const ZigString = JSC.ZigString;
const JSInternalPromise = JSC.JSInternalPromise;
const JSPromise = JSC.JSPromise;
const JSValue = JSC.JSValue;
const JSError = JSC.JSError;
const JSGlobalObject = JSC.JSGlobalObject;

const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const Task = @import("../javascript.zig").Task;

const picohttp = @import("picohttp");

pub const DOMURL = struct {
    url: URL = URL{},
    m_string: *JSC.RefString,

    pub const Class = JSC.NewClass(
        DOMURL,
        .{
            .name = "URL",
        },
        .{},
        .{
            .base = .{
                .get = JSC.getterWrap(DOMURL, "getBase"),
            },
            .href = .{
                .get = JSC.getterWrap(DOMURL, "getHref"),
                .set = JSC.setterWrap(DOMURL, "setHref"),
            },
            .protocol = .{
                .get = JSC.getterWrap(DOMURL, "getProtocol"),
                .set = JSC.setterWrap(DOMURL, "setProtocol"),
            },
            .username = .{
                .get = JSC.getterWrap(DOMURL, "getUsername"),
                .set = JSC.setterWrap(DOMURL, "setUsername"),
            },
            .password = .{
                .get = JSC.getterWrap(DOMURL, "getPassword"),
                .set = JSC.setterWrap(DOMURL, "setPassword"),
            },
            .host = .{
                .get = JSC.getterWrap(DOMURL, "getHost"),
                .set = JSC.setterWrap(DOMURL, "setHost"),
            },
            .hostname = .{
                .get = JSC.getterWrap(DOMURL, "getHostname"),
                .set = JSC.setterWrap(DOMURL, "setHostname"),
            },
            .port = .{
                .get = JSC.getterWrap(DOMURL, "getPort"),
                .set = JSC.setterWrap(DOMURL, "setPort"),
            },
            .pathname = .{
                .get = JSC.getterWrap(DOMURL, "getPathname"),
                .set = JSC.setterWrap(DOMURL, "setPathname"),
            },
            .search = .{
                .get = JSC.getterWrap(DOMURL, "getSearch"),
                .set = JSC.setterWrap(DOMURL, "setSearch"),
            },
        },
    );

    pub fn getBase(this: *DOMURL, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.ZigString.init(this.url.origin).toValue(globalThis);
    }

    pub fn getHost(this: *DOMURL, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.ZigString.init(this.url.host).toValue(globalThis);
    }
    pub fn getHostname(this: *DOMURL, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.ZigString.init(this.url.hostname).toValue(globalThis);
    }
    pub fn getHref(this: *DOMURL, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.ZigString.init(this.url.href).toValue(globalThis);
    }
    pub fn getPassword(this: *DOMURL, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.ZigString.init(this.url.password).toValue(globalThis);
    }
    pub fn getPathname(this: *DOMURL, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.ZigString.init(this.url.pathname).toValue(globalThis);
    }
    pub fn getPort(this: *DOMURL) JSC.JSValue {
        return JSC.JSValue.jsNumber(this.url.getPortAuto());
    }
    pub fn getProtocol(this: *DOMURL, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.ZigString.init(this.url.displayProtocol()).toValue(globalThis);
    }
    pub fn getSearch(this: *DOMURL, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.ZigString.init(this.url.search).toValue(globalThis);
    }
    pub fn getUsername(this: *DOMURL, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.ZigString.init(this.url.username).toValue(globalThis);
    }

    pub fn setHost(this: *DOMURL, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) bool {
        var copy = this.url;
        var input = value.toSlice(globalThis, bun.default_allocator);
        defer input.deinit();
        const buf = input.slice();
        const host_len = copy.parseHost(buf) orelse return false;
        var temp_clone = std.fmt.allocPrint("{}://{s}/{s}", .{ this.url.displayProtocol(), copy.displayHost(), strings.trimLeadingChar(this.url.pathname, '/') }) catch return false;
        this.m_string = JSC.VirtualMachine.vm.refCountedString(temp_clone, null, false);
        if (this.m_string.ptr != temp_clone.ptr) {
            bun.default_allocator.free(temp_clone);
        }
        return true;
    }
    pub fn setHostname(this: *DOMURL, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) bool {}
    pub fn setHref(this: *DOMURL, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) bool {}
    pub fn setPassword(this: *DOMURL, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) bool {}
    pub fn setPathname(this: *DOMURL, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) bool {}
    pub fn setPort(this: *DOMURL, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) bool {}
    pub fn setProtocol(this: *DOMURL, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) bool {}
    pub fn setSearch(this: *DOMURL, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) bool {}
    pub fn setUsername(this: *DOMURL, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) bool {}
};
