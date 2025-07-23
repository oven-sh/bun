/// Common strings from `BunCommonStrings.h`.
///
/// All getters return a `JSC::JSString`;
pub const CommonStrings = struct {
    globalObject: *jsc.JSGlobalObject,

    const CommonStringsForZig = enum(u8) {
        IPv4 = 0,
        IPv6 = 1,
        IN4Loopback = 2,
        IN6Any = 3,

        extern "c" fn Bun__CommonStringsForZig__toJS(commonString: CommonStringsForZig, globalObject: *jsc.JSGlobalObject) jsc.JSValue;
        pub const toJS = Bun__CommonStringsForZig__toJS;
    };

    pub inline fn IPv4(this: CommonStrings) JSValue {
        return CommonStringsForZig.IPv4.toJS(this.globalObject);
    }
    pub inline fn IPv6(this: CommonStrings) JSValue {
        return CommonStringsForZig.IPv6.toJS(this.globalObject);
    }
    pub inline fn @"127.0.0.1"(this: CommonStrings) JSValue {
        return CommonStringsForZig.IN4Loopback.toJS(this.globalObject);
    }
    pub inline fn @"::"(this: CommonStrings) JSValue {
        return CommonStringsForZig.IN6Any.toJS(this.globalObject);
    }
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
