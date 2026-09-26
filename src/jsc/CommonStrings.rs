use crate::{JSGlobalObject, JSValue};

/// Common strings from `BunCommonStrings.h`.
///
/// All getters return a `JSC::JSString`.
#[derive(Copy, Clone)]
pub struct CommonStrings<'a> {
    pub(crate) global_object: &'a JSGlobalObject,
}

/// Must be kept in sync with `CommonStringsForRust` in `BunCommonStrings.cpp`.
#[repr(u8)]
#[derive(Copy, Clone)]
enum CommonStringsForRust {
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
    BinaryTypeBlob = 13,
    Unknown = 14,
    ProtocolHttp = 15,
    ProtocolHttps = 16,
    AlpnH2 = 17,
    AlpnHttp11 = 18,
    Utf8WithDash = 19,
    QuicDatagramAbandoned = 20,
    QuicDatagramAcknowledged = 21,
    QuicDatagramLost = 22,
    Base64 = 23,
}

unsafe extern "C" {
    // `JSGlobalObject` is an opaque `UnsafeCell`-backed FFI handle; `&T` is
    // ABI-identical to non-null `*const T` and the C++ side's lazy init of its
    // common-strings table (interior mutation) is invisible to Rust.
    safe fn Bun__CommonStringsForRust__toJS(
        common_string: CommonStringsForRust,
        global_object: &JSGlobalObject,
    ) -> JSValue;
}

impl CommonStringsForRust {
    #[inline]
    fn to_js(self, global_object: &JSGlobalObject) -> JSValue {
        Bun__CommonStringsForRust__toJS(self, global_object)
    }
}

impl<'a> CommonStrings<'a> {
    /// `"IPv4"`
    #[inline]
    pub fn ipv4(self) -> JSValue {
        CommonStringsForRust::IPv4.to_js(self.global_object)
    }
    /// `"IPv6"`
    #[inline]
    pub fn ipv6(self) -> JSValue {
        CommonStringsForRust::IPv6.to_js(self.global_object)
    }
    /// `"127.0.0.1"`
    #[inline]
    pub fn in4_loopback(self) -> JSValue {
        CommonStringsForRust::IN4Loopback.to_js(self.global_object)
    }
    /// `"::"`
    #[inline]
    pub fn in6_any(self) -> JSValue {
        CommonStringsForRust::IN6Any.to_js(self.global_object)
    }
    /// `"ipv4"`
    #[inline]
    pub fn ipv4_lower(self) -> JSValue {
        CommonStringsForRust::Ipv4Lower.to_js(self.global_object)
    }
    /// `"ipv6"`
    #[inline]
    pub fn ipv6_lower(self) -> JSValue {
        CommonStringsForRust::Ipv6Lower.to_js(self.global_object)
    }
    /// `"default"`
    #[inline]
    pub fn default(self) -> JSValue {
        CommonStringsForRust::FetchDefault.to_js(self.global_object)
    }
    /// `"error"`
    #[inline]
    pub fn error(self) -> JSValue {
        CommonStringsForRust::FetchError.to_js(self.global_object)
    }
    /// `"include"`
    #[inline]
    pub fn include(self) -> JSValue {
        CommonStringsForRust::FetchInclude.to_js(self.global_object)
    }
    /// `"buffer"`
    #[inline]
    pub fn buffer(self) -> JSValue {
        CommonStringsForRust::Buffer.to_js(self.global_object)
    }
    /// `"arraybuffer"`
    #[inline]
    pub fn arraybuffer(self) -> JSValue {
        CommonStringsForRust::BinaryTypeArrayBuffer.to_js(self.global_object)
    }
    /// `"nodebuffer"`
    #[inline]
    pub fn nodebuffer(self) -> JSValue {
        CommonStringsForRust::BinaryTypeNodeBuffer.to_js(self.global_object)
    }
    /// `"uint8array"`
    #[inline]
    pub fn uint8array(self) -> JSValue {
        CommonStringsForRust::BinaryTypeUint8Array.to_js(self.global_object)
    }
    /// `"blob"`
    #[inline]
    pub fn blob(self) -> JSValue {
        CommonStringsForRust::BinaryTypeBlob.to_js(self.global_object)
    }
    /// `"unknown"`
    #[inline]
    pub fn unknown(self) -> JSValue {
        CommonStringsForRust::Unknown.to_js(self.global_object)
    }
    /// `"http"`
    #[inline]
    pub fn http(self) -> JSValue {
        CommonStringsForRust::ProtocolHttp.to_js(self.global_object)
    }
    /// `"https"`
    #[inline]
    pub fn https(self) -> JSValue {
        CommonStringsForRust::ProtocolHttps.to_js(self.global_object)
    }
    /// `"h2"`
    #[inline]
    pub fn alpn_h2(self) -> JSValue {
        CommonStringsForRust::AlpnH2.to_js(self.global_object)
    }
    /// `"http/1.1"`
    #[inline]
    pub fn alpn_http11(self) -> JSValue {
        CommonStringsForRust::AlpnHttp11.to_js(self.global_object)
    }
    /// `"utf-8"` (the WHATWG encoding name; `"utf8"` is the node one)
    #[inline]
    pub fn utf8_with_dash(self) -> JSValue {
        CommonStringsForRust::Utf8WithDash.to_js(self.global_object)
    }
    /// `"abandoned"`
    #[inline]
    pub fn quic_datagram_abandoned(self) -> JSValue {
        CommonStringsForRust::QuicDatagramAbandoned.to_js(self.global_object)
    }
    /// `"acknowledged"`
    #[inline]
    pub fn quic_datagram_acknowledged(self) -> JSValue {
        CommonStringsForRust::QuicDatagramAcknowledged.to_js(self.global_object)
    }
    /// `"lost"`
    #[inline]
    pub fn quic_datagram_lost(self) -> JSValue {
        CommonStringsForRust::QuicDatagramLost.to_js(self.global_object)
    }
    /// `"base64"`
    #[inline]
    pub fn base64(self) -> JSValue {
        CommonStringsForRust::Base64.to_js(self.global_object)
    }
}
