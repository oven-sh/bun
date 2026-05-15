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
enum CommonStringsForBun {
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
    safe fn Bun__CommonStringsForBun__toJS(
        common_string: CommonStringsForBun,
        global_object: &JSGlobalObject,
    ) -> JSValue;
}

impl CommonStringsForBun {
    #[inline]
    fn to_js(self, global_object: &JSGlobalObject) -> JSValue {
        Bun__CommonStringsForBun__toJS(self, global_object)
    }
}

impl<'a> CommonStrings<'a> {
    // PORT NOTE: there were originally both `IPv4`/`IPv6` and `ipv4`/`ipv6`
    // methods, which collide under snake_case. The lowercase variants are
    // exposed as `ipv4_lower`/`ipv6_lower` here (matching their enum variants).
    #[inline]
    pub fn ipv4(self) -> JSValue {
        CommonStringsForBun::IPv4.to_js(self.global_object)
    }
    #[inline]
    pub fn ipv6(self) -> JSValue {
        CommonStringsForBun::IPv6.to_js(self.global_object)
    }
    // PORT NOTE: getter for the `"127.0.0.1"` common string; named to match
    // the enum variant.
    #[inline]
    pub fn in4_loopback(self) -> JSValue {
        CommonStringsForBun::IN4Loopback.to_js(self.global_object)
    }
    // PORT NOTE: getter for the `"::"` common string; named to match the enum
    // variant.
    #[inline]
    pub fn in6_any(self) -> JSValue {
        CommonStringsForBun::IN6Any.to_js(self.global_object)
    }
    #[inline]
    pub fn ipv4_lower(self) -> JSValue {
        CommonStringsForBun::Ipv4Lower.to_js(self.global_object)
    }
    #[inline]
    pub fn ipv6_lower(self) -> JSValue {
        CommonStringsForBun::Ipv6Lower.to_js(self.global_object)
    }
    #[inline]
    pub fn default(self) -> JSValue {
        CommonStringsForBun::FetchDefault.to_js(self.global_object)
    }
    #[inline]
    pub fn error(self) -> JSValue {
        CommonStringsForBun::FetchError.to_js(self.global_object)
    }
    #[inline]
    pub fn include(self) -> JSValue {
        CommonStringsForBun::FetchInclude.to_js(self.global_object)
    }
    #[inline]
    pub fn buffer(self) -> JSValue {
        CommonStringsForBun::Buffer.to_js(self.global_object)
    }
    #[inline]
    pub fn arraybuffer(self) -> JSValue {
        CommonStringsForBun::BinaryTypeArrayBuffer.to_js(self.global_object)
    }
    #[inline]
    pub fn nodebuffer(self) -> JSValue {
        CommonStringsForBun::BinaryTypeNodeBuffer.to_js(self.global_object)
    }
    #[inline]
    pub fn uint8array(self) -> JSValue {
        CommonStringsForBun::BinaryTypeUint8Array.to_js(self.global_object)
    }
}
