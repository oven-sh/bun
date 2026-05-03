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
        ipv4Lower = 4,
        ipv6Lower = 5,
        fetchDefault = 6,
        fetchError = 7,
        fetchInclude = 8,
        buffer = 9,
        binaryTypeArrayBuffer = 10,
        binaryTypeNodeBuffer = 11,
        binaryTypeUint8Array = 12,

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
    pub inline fn ipv4(this: CommonStrings) JSValue {
        return CommonStringsForZig.ipv4Lower.toJS(this.globalObject);
    }
    pub inline fn ipv6(this: CommonStrings) JSValue {
        return CommonStringsForZig.ipv6Lower.toJS(this.globalObject);
    }
    pub inline fn default(this: CommonStrings) JSValue {
        return CommonStringsForZig.fetchDefault.toJS(this.globalObject);
    }
    pub inline fn @"error"(this: CommonStrings) JSValue {
        return CommonStringsForZig.fetchError.toJS(this.globalObject);
    }
    pub inline fn include(this: CommonStrings) JSValue {
        return CommonStringsForZig.fetchInclude.toJS(this.globalObject);
    }
    pub inline fn buffer(this: CommonStrings) JSValue {
        return CommonStringsForZig.buffer.toJS(this.globalObject);
    }
    pub inline fn arraybuffer(this: CommonStrings) JSValue {
        return CommonStringsForZig.binaryTypeArrayBuffer.toJS(this.globalObject);
    }
    pub inline fn nodebuffer(this: CommonStrings) JSValue {
        return CommonStringsForZig.binaryTypeNodeBuffer.toJS(this.globalObject);
    }
    pub inline fn uint8array(this: CommonStrings) JSValue {
        return CommonStringsForZig.binaryTypeUint8Array.toJS(this.globalObject);
    }
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
