use crate::{JSGlobalObject, JSValue};

/// Common strings from `BunCommonStrings.h`.
///
/// All getters return a `JSC::JSString`.
#[derive(Copy, Clone)]
pub struct CommonStrings<'a> {
    pub global_object: &'a JSGlobalObject,
}

#[repr(u8)]
#[derive(Copy, Clone)]
enum CommonStringsForZig {
    IPv4 = 0,
    IPv6 = 1,
    IN4Loopback = 2,
    IN6Any = 3,
    Ipv4Lower = 4,
    Ipv6Lower = 5,
    FetchDefault = 6,
    FetchError = 7,
    FetchInclude = 8,
    Buffer = 9,
    BinaryTypeArrayBuffer = 10,
    BinaryTypeNodeBuffer = 11,
    BinaryTypeUint8Array = 12,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    // `JSGlobalObject` is an opaque `UnsafeCell`-backed FFI handle; `&T` is
    // ABI-identical to non-null `*const T` and the C++ side's lazy init of its
    // common-strings table (interior mutation) is invisible to Rust.
    safe fn Bun__CommonStringsForZig__toJS(
        common_string: CommonStringsForZig,
        global_object: &JSGlobalObject,
    ) -> JSValue;
}

impl CommonStringsForZig {
    #[inline]
    fn to_js(self, global_object: &JSGlobalObject) -> JSValue {
        Bun__CommonStringsForZig__toJS(self, global_object)
    }
}

impl<'a> CommonStrings<'a> {
    // PORT NOTE: Zig had both `IPv4`/`IPv6` and `ipv4`/`ipv6` methods, which
    // collide under snake_case. The lowercase Zig methods are renamed to
    // `ipv4_lower`/`ipv6_lower` here (matching their enum variants).
    #[inline]
    pub fn ipv4(self) -> JSValue {
        CommonStringsForZig::IPv4.to_js(self.global_object)
    }
    #[inline]
    pub fn ipv6(self) -> JSValue {
        CommonStringsForZig::IPv6.to_js(self.global_object)
    }
    // PORT NOTE: Zig `@"127.0.0.1"` — not a valid Rust identifier; renamed to
    // match the enum variant.
    #[inline]
    pub fn in4_loopback(self) -> JSValue {
        CommonStringsForZig::IN4Loopback.to_js(self.global_object)
    }
    // PORT NOTE: Zig `@"::"` — not a valid Rust identifier; renamed to match
    // the enum variant.
    #[inline]
    pub fn in6_any(self) -> JSValue {
        CommonStringsForZig::IN6Any.to_js(self.global_object)
    }
    #[inline]
    pub fn ipv4_lower(self) -> JSValue {
        CommonStringsForZig::Ipv4Lower.to_js(self.global_object)
    }
    #[inline]
    pub fn ipv6_lower(self) -> JSValue {
        CommonStringsForZig::Ipv6Lower.to_js(self.global_object)
    }
    #[inline]
    pub fn default(self) -> JSValue {
        CommonStringsForZig::FetchDefault.to_js(self.global_object)
    }
    #[inline]
    pub fn error(self) -> JSValue {
        CommonStringsForZig::FetchError.to_js(self.global_object)
    }
    #[inline]
    pub fn include(self) -> JSValue {
        CommonStringsForZig::FetchInclude.to_js(self.global_object)
    }
    #[inline]
    pub fn buffer(self) -> JSValue {
        CommonStringsForZig::Buffer.to_js(self.global_object)
    }
    #[inline]
    pub fn arraybuffer(self) -> JSValue {
        CommonStringsForZig::BinaryTypeArrayBuffer.to_js(self.global_object)
    }
    #[inline]
    pub fn nodebuffer(self) -> JSValue {
        CommonStringsForZig::BinaryTypeNodeBuffer.to_js(self.global_object)
    }
    #[inline]
    pub fn uint8array(self) -> JSValue {
        CommonStringsForZig::BinaryTypeUint8Array.to_js(self.global_object)
    }
}

// ported from: src/jsc/CommonStrings.zig
