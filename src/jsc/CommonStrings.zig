/// Common strings from `BunCommonStrings.h`.
///
/// All getters return a `JSC::JSString`;
pub const CommonStrings = struct {
    globalObject: *jsc.JSGlobalObject,

    const CommonStringsForRust = enum(u8) {
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

        extern "c" fn Bun__CommonStringsForRust__toJS(commonString: CommonStringsForRust, globalObject: *jsc.JSGlobalObject) jsc.JSValue;
        pub const toJS = Bun__CommonStringsForRust__toJS;
    };

    pub inline fn IPv4(this: CommonStrings) JSValue {
        return CommonStringsForRust.IPv4.toJS(this.globalObject);
    }
    pub inline fn IPv6(this: CommonStrings) JSValue {
        return CommonStringsForRust.IPv6.toJS(this.globalObject);
    }
    pub inline fn @"127.0.0.1"(this: CommonStrings) JSValue {
        return CommonStringsForRust.IN4Loopback.toJS(this.globalObject);
    }
    pub inline fn @"::"(this: CommonStrings) JSValue {
        return CommonStringsForRust.IN6Any.toJS(this.globalObject);
    }
    pub inline fn ipv4(this: CommonStrings) JSValue {
        return CommonStringsForRust.ipv4Lower.toJS(this.globalObject);
    }
    pub inline fn ipv6(this: CommonStrings) JSValue {
        return CommonStringsForRust.ipv6Lower.toJS(this.globalObject);
    }
    pub inline fn default(this: CommonStrings) JSValue {
        return CommonStringsForRust.fetchDefault.toJS(this.globalObject);
    }
    pub inline fn @"error"(this: CommonStrings) JSValue {
        return CommonStringsForRust.fetchError.toJS(this.globalObject);
    }
    pub inline fn include(this: CommonStrings) JSValue {
        return CommonStringsForRust.fetchInclude.toJS(this.globalObject);
    }
    pub inline fn buffer(this: CommonStrings) JSValue {
        return CommonStringsForRust.buffer.toJS(this.globalObject);
    }
    pub inline fn arraybuffer(this: CommonStrings) JSValue {
        return CommonStringsForRust.binaryTypeArrayBuffer.toJS(this.globalObject);
    }
    pub inline fn nodebuffer(this: CommonStrings) JSValue {
        return CommonStringsForRust.binaryTypeNodeBuffer.toJS(this.globalObject);
    }
    pub inline fn uint8array(this: CommonStrings) JSValue {
        return CommonStringsForRust.binaryTypeUint8Array.toJS(this.globalObject);
    }
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
