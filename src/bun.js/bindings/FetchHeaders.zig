const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const VM = JSC.VM;
const ZigString = JSC.ZigString;
const Api = @import("../../api/schema.zig").Api;
const StringPointer = Api.StringPointer;

pub const FetchHeaders = opaque {
    extern fn WebCore__FetchHeaders__append(arg0: *FetchHeaders, arg1: *const ZigString, arg2: *const ZigString, arg3: *JSGlobalObject) void;
    extern fn WebCore__FetchHeaders__cast_(JSValue0: JSValue, arg1: *VM) ?*FetchHeaders;
    extern fn WebCore__FetchHeaders__clone(arg0: *FetchHeaders, arg1: *JSGlobalObject) JSValue;
    extern fn WebCore__FetchHeaders__cloneThis(arg0: *FetchHeaders, arg1: *JSGlobalObject) *FetchHeaders;
    extern fn WebCore__FetchHeaders__copyTo(arg0: *FetchHeaders, arg1: [*]StringPointer, arg2: [*]StringPointer, arg3: [*]u8) void;
    extern fn WebCore__FetchHeaders__count(arg0: *FetchHeaders, arg1: *u32, arg2: *u32) void;
    extern fn WebCore__FetchHeaders__createEmpty() *FetchHeaders;
    extern fn WebCore__FetchHeaders__createFromPicoHeaders_(arg0: ?*const anyopaque) *FetchHeaders;
    extern fn WebCore__FetchHeaders__createFromUWS(arg1: *anyopaque) *FetchHeaders;
    extern fn WebCore__FetchHeaders__createValue(arg0: *JSGlobalObject, arg1: [*c]StringPointer, arg2: [*c]StringPointer, arg3: [*c]const ZigString, arg4: u32) JSValue;
    extern fn WebCore__FetchHeaders__deref(arg0: *FetchHeaders) void;
    extern fn WebCore__FetchHeaders__fastGet_(arg0: *FetchHeaders, arg1: u8, arg2: [*c]ZigString) void;
    extern fn WebCore__FetchHeaders__fastHas_(arg0: *FetchHeaders, arg1: u8) bool;
    extern fn WebCore__FetchHeaders__fastRemove_(arg0: *FetchHeaders, arg1: u8) void;
    extern fn WebCore__FetchHeaders__get_(arg0: *FetchHeaders, arg1: [*c]const ZigString, arg2: [*c]ZigString, arg3: *JSGlobalObject) void;
    extern fn WebCore__FetchHeaders__has(arg0: *FetchHeaders, arg1: [*c]const ZigString, arg2: *JSGlobalObject) bool;
    extern fn WebCore__FetchHeaders__isEmpty(arg0: *FetchHeaders) bool;
    extern fn WebCore__FetchHeaders__put_(arg0: *FetchHeaders, arg1: [*c]const ZigString, arg2: [*c]const ZigString, arg3: *JSGlobalObject) void;
    extern fn WebCore__FetchHeaders__remove(arg0: *FetchHeaders, arg1: [*c]const ZigString, arg2: *JSGlobalObject) void;
    extern fn WebCore__FetchHeaders__toJS(arg0: *FetchHeaders, arg1: *JSGlobalObject) JSValue;
    extern fn WebCore__FetchHeaders__toUWSResponse(arg0: *FetchHeaders, arg1: bool, arg2: ?*anyopaque) void;

    pub fn createValue(
        global: *JSGlobalObject,
        names: [*c]Api.StringPointer,
        values: [*c]Api.StringPointer,
        buf: *const ZigString,
        count_: u32,
    ) JSValue {
        return WebCore__FetchHeaders__createValue(
            global,
            names,
            values,
            buf,
            count_,
        );
    }

    extern "c" fn WebCore__FetchHeaders__createFromJS(*JSC.JSGlobalObject, JSValue) ?*FetchHeaders;
    /// Construct a `Headers` object from a JSValue.
    ///
    /// This can be:
    /// -  Array<[String, String]>
    /// -  Record<String, String>.
    ///
    /// Throws an exception if invalid.
    ///
    /// If empty, returns null.
    pub fn createFromJS(
        global: *JSGlobalObject,
        value: JSValue,
    ) ?*FetchHeaders {
        return WebCore__FetchHeaders__createFromJS(global, value);
    }

    pub fn putDefault(this: *FetchHeaders, name_: HTTPHeaderName, value: []const u8, global: *JSGlobalObject) void {
        if (this.fastHas(name_)) {
            return;
        }

        this.put(name_, value, global);
    }

    pub fn from(
        global: *JSGlobalObject,
        names: [*c]Api.StringPointer,
        values: [*c]Api.StringPointer,
        buf: *const ZigString,
        count_: u32,
    ) JSValue {
        return WebCore__FetchHeaders__createValue(
            global,
            names,
            values,
            buf,
            count_,
        );
    }

    pub fn isEmpty(this: *FetchHeaders) bool {
        return WebCore__FetchHeaders__isEmpty(this);
    }

    pub fn createFromUWS(
        uws_request: *anyopaque,
    ) *FetchHeaders {
        return WebCore__FetchHeaders__createFromUWS(
            uws_request,
        );
    }

    pub fn toUWSResponse(
        headers: *FetchHeaders,
        is_ssl: bool,
        uws_response: *anyopaque,
    ) void {
        return WebCore__FetchHeaders__toUWSResponse(
            headers,
            is_ssl,
            uws_response,
        );
    }

    const PicoHeaders = extern struct {
        ptr: ?*const anyopaque,
        len: usize,
    };

    pub fn createEmpty() *FetchHeaders {
        return WebCore__FetchHeaders__createEmpty();
    }

    pub fn createFromPicoHeaders(
        pico_headers: anytype,
    ) *FetchHeaders {
        const out = PicoHeaders{ .ptr = pico_headers.list.ptr, .len = pico_headers.list.len };
        const result = WebCore__FetchHeaders__createFromPicoHeaders_(
            &out,
        );
        return result;
    }

    pub fn createFromPicoHeaders_(
        pico_headers: *const anyopaque,
    ) *FetchHeaders {
        return WebCore__FetchHeaders__createFromPicoHeaders_(pico_headers);
    }

    pub fn append(
        this: *FetchHeaders,
        name_: *const ZigString,
        value: *const ZigString,
        global: *JSGlobalObject,
    ) void {
        return WebCore__FetchHeaders__append(
            this,
            name_,
            value,
            global,
        );
    }

    extern fn WebCore__FetchHeaders__put(this: *FetchHeaders, name_: HTTPHeaderName, value: *const ZigString, global: *JSGlobalObject) void;

    pub fn put(
        this: *FetchHeaders,
        name_: HTTPHeaderName,
        value: []const u8,
        global: *JSGlobalObject,
    ) void {
        WebCore__FetchHeaders__put(this, name_, &ZigString.init(value), global);
    }

    pub fn get_(
        this: *FetchHeaders,
        name_: *const ZigString,
        out: *ZigString,
        global: *JSGlobalObject,
    ) void {
        WebCore__FetchHeaders__get_(
            this,
            name_,
            out,
            global,
        );
    }

    pub fn get(
        this: *FetchHeaders,
        name_: []const u8,
        global: *JSGlobalObject,
    ) ?[]const u8 {
        var out = ZigString.Empty;
        get_(this, &ZigString.init(name_), &out, global);
        if (out.len > 0) {
            return out.slice();
        }

        return null;
    }

    pub fn has(
        this: *FetchHeaders,
        name_: *const ZigString,
        global: *JSGlobalObject,
    ) bool {
        return WebCore__FetchHeaders__has(
            this,
            name_,
            global,
        );
    }

    pub fn fastHas(
        this: *FetchHeaders,
        name_: HTTPHeaderName,
    ) bool {
        return fastHas_(this, @intFromEnum(name_));
    }

    pub fn fastGet(
        this: *FetchHeaders,
        name_: HTTPHeaderName,
    ) ?ZigString {
        var str = ZigString.init("");
        fastGet_(this, @intFromEnum(name_), &str);
        if (str.len == 0) {
            return null;
        }

        return str;
    }

    pub fn fastHas_(
        this: *FetchHeaders,
        name_: u8,
    ) bool {
        return WebCore__FetchHeaders__fastHas_(
            this,
            name_,
        );
    }

    pub fn fastGet_(
        this: *FetchHeaders,
        name_: u8,
        str: *ZigString,
    ) void {
        return WebCore__FetchHeaders__fastGet_(
            this,
            name_,
            str,
        );
    }

    pub const HTTPHeaderName = enum(u8) {
        Accept,
        AcceptCharset,
        AcceptEncoding,
        AcceptLanguage,
        AcceptRanges,
        AccessControlAllowCredentials,
        AccessControlAllowHeaders,
        AccessControlAllowMethods,
        AccessControlAllowOrigin,
        AccessControlExposeHeaders,
        AccessControlMaxAge,
        AccessControlRequestHeaders,
        AccessControlRequestMethod,
        Age,
        Authorization,
        CacheControl,
        Connection,
        ContentDisposition,
        ContentEncoding,
        ContentLanguage,
        ContentLength,
        ContentLocation,
        ContentRange,
        ContentSecurityPolicy,
        ContentSecurityPolicyReportOnly,
        ContentType,
        Cookie,
        Cookie2,
        CrossOriginEmbedderPolicy,
        CrossOriginEmbedderPolicyReportOnly,
        CrossOriginOpenerPolicy,
        CrossOriginOpenerPolicyReportOnly,
        CrossOriginResourcePolicy,
        DNT,
        Date,
        DefaultStyle,
        ETag,
        Expect,
        Expires,
        Host,
        IcyMetaInt,
        IcyMetadata,
        IfMatch,
        IfModifiedSince,
        IfNoneMatch,
        IfRange,
        IfUnmodifiedSince,
        KeepAlive,
        LastEventID,
        LastModified,
        Link,
        Location,
        Origin,
        PingFrom,
        PingTo,
        Pragma,
        ProxyAuthorization,
        Purpose,
        Range,
        Referer,
        ReferrerPolicy,
        Refresh,
        ReportTo,
        SecFetchDest,
        SecFetchMode,
        SecWebSocketAccept,
        SecWebSocketExtensions,
        SecWebSocketKey,
        SecWebSocketProtocol,
        SecWebSocketVersion,
        ServerTiming,
        ServiceWorker,
        ServiceWorkerAllowed,
        ServiceWorkerNavigationPreload,
        SetCookie,
        SetCookie2,
        SourceMap,
        StrictTransportSecurity,
        TE,
        TimingAllowOrigin,
        Trailer,
        TransferEncoding,
        Upgrade,
        UpgradeInsecureRequests,
        UserAgent,
        Vary,
        Via,
        XContentTypeOptions,
        XDNSPrefetchControl,
        XFrameOptions,
        XSourceMap,
        XTempTablet,
        XXSSProtection,
    };

    pub fn fastRemove(
        this: *FetchHeaders,
        header: HTTPHeaderName,
    ) void {
        return fastRemove_(this, @intFromEnum(header));
    }

    pub fn fastRemove_(
        this: *FetchHeaders,
        header: u8,
    ) void {
        return WebCore__FetchHeaders__fastRemove_(
            this,
            header,
        );
    }

    pub fn remove(
        this: *FetchHeaders,
        name_: *const ZigString,
        global: *JSGlobalObject,
    ) void {
        return WebCore__FetchHeaders__remove(
            this,
            name_,
            global,
        );
    }

    pub fn cast_(value: JSValue, vm: *VM) ?*FetchHeaders {
        return WebCore__FetchHeaders__cast_(value, vm);
    }

    pub fn cast(value: JSValue) ?*FetchHeaders {
        return cast_(value, JSC.VirtualMachine.get().global.vm());
    }

    pub fn toJS(this: *FetchHeaders, globalThis: *JSGlobalObject) JSValue {
        return WebCore__FetchHeaders__toJS(this, globalThis);
    }

    pub fn count(
        this: *FetchHeaders,
        names: *u32,
        buf_len: *u32,
    ) void {
        return WebCore__FetchHeaders__count(
            this,
            names,
            buf_len,
        );
    }

    pub fn clone(
        this: *FetchHeaders,
        global: *JSGlobalObject,
    ) JSValue {
        return WebCore__FetchHeaders__clone(
            this,
            global,
        );
    }

    pub fn cloneThis(
        this: *FetchHeaders,
        global: *JSGlobalObject,
    ) ?*FetchHeaders {
        return WebCore__FetchHeaders__cloneThis(
            this,
            global,
        );
    }

    pub fn deref(
        this: *FetchHeaders,
    ) void {
        return WebCore__FetchHeaders__deref(this);
    }

    pub fn copyTo(
        this: *FetchHeaders,
        names: [*]Api.StringPointer,
        values: [*]Api.StringPointer,
        buf: [*]u8,
    ) void {
        return WebCore__FetchHeaders__copyTo(
            this,
            names,
            values,
            buf,
        );
    }
};
