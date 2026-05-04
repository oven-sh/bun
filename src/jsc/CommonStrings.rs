use bun_jsc::{JSGlobalObject, JSValue};

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
    fn Bun__CommonStringsForZig__toJS(
        common_string: CommonStringsForZig,
        global_object: *mut JSGlobalObject,
    ) -> JSValue;
}

impl CommonStringsForZig {
    #[inline]
    fn to_js(self, global_object: &JSGlobalObject) -> JSValue {
        // SAFETY: `global_object` is a valid live JSGlobalObject reference; the C++
        // side reads from its lazily-initialized common-strings table and never
        // retains the pointer past this call.
        unsafe {
            Bun__CommonStringsForZig__toJS(
                self,
                global_object as *const JSGlobalObject as *mut JSGlobalObject,
            )
        }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/CommonStrings.zig (70 lines)
//   confidence: high
//   todos:      1
//   notes:      4 method renames (IPv4/ipv4 snake_case collision; @"127.0.0.1"/@"::" invalid idents) — grep callers in Phase B
// ──────────────────────────────────────────────────────────────────────────
