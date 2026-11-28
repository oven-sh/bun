//! An IP socket address meant to be used by both native and JS code.
//!
//! JS getters are named `getFoo`, while native getters are named `foo`.
//!
//! TODO: add a inspect method (under `Symbol.for("nodejs.util.inspect.custom")`).
//! Requires updating bindgen.

use core::ffi::c_int;
use core::mem::{self, MaybeUninit};
use core::net::{IpAddr, Ipv4Addr};

use bun_core::ip_address::{self, IpText};
use bun_core::{CStrRef, String as BunString, strings};
use bun_jsc::bindgen::{JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::bun_string_jsc;
use bun_jsc::{CommonString, JSGlobalObject, JSString, JSValue, JsError, JsResult, StringJsc};
use bun_ptr::JsCell;

pub(crate) struct SocketAddress {
    // NOTE: not C.sockaddr_storage b/c it's _huge_. we need >= 28 bytes for sockaddr_in6,
    // but sockaddr_storage is 128 bytes.
    /// @internal
    pub(crate) _addr: sockaddr,
    /// Cached address in presentation format. Prevents repeated conversion between
    /// strings and bytes.
    ///
    /// - `.Dead` is used as an alternative to `null`
    /// - `.Empty` is used for default ipv4 and ipv6 addresses (`127.0.0.1` and `::`, respectively).
    ///
    /// @internal
    _presentation: JsCell<BunString>,
}

pub(crate) struct Options {
    pub(crate) family: AF,
    /// When `None`, default is determined by address family.
    /// - `127.0.0.1` for IPv4
    /// - `::1` for IPv6
    pub(crate) address: Option<BunString>,
    pub(crate) port: u16,
    /// IPv6 flow label. JS getters for v4 addresses always return `0`.
    pub(crate) flowlabel: Option<u32>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            family: AF::INET,
            address: None,
            port: 0,
            flowlabel: None,
        }
    }
}

impl Options {
    /// NOTE: assumes options object has been normalized and validated by JS code.
    pub(crate) fn from_js(global: &JSGlobalObject, obj: JSValue) -> JsResult<Options> {
        if !obj.is_object() {
            return Err(global.throw_invalid_argument_type_value(b"options", b"object", obj));
        }

        let address_str: Option<BunString> = if let Some(a) = obj.get(global, "address")? {
            if !a.is_string() {
                return Err(global.throw_invalid_argument_type_value(
                    b"options.address",
                    b"string",
                    a,
                ));
            }
            Some(BunString::from_js(a, global)?)
        } else {
            None
        };

        let _family: AF = if let Some(fam) = obj.get(global, "family")? {
            // "ipv4" or "ipv6", ignoring case
            AF::from_js(global, fam)?
        } else {
            AF::INET
        };

        // required. Validated by `validatePort`.
        let _port: u16 = if let Some(p) = obj.get(global, "port")? {
            // Note: shim until `JSValue::is_finite` lands in bun_jsc.
            if !(p.is_number() && p.as_number().is_finite()) {
                return Err(Self::throw_bad_port(global, p));
            }
            let port32 = p.to_int32();
            if port32 < 0 || port32 > i32::from(u16::MAX) {
                return Err(Self::throw_bad_port(global, p));
            }
            u16::try_from(port32).expect("int cast")
        } else {
            0
        };

        let _flowlabel = if let Some(fl) = obj.get(global, "flowlabel")? {
            if !fl.is_number() {
                return Err(global.throw_invalid_argument_type_value(
                    b"options.flowlabel",
                    b"number",
                    fl,
                ));
            }
            if !fl.is_uint32_as_any_int() {
                return Err(global.throw_range_error(
                    fl.as_number(),
                    bun_jsc::RangeErrorOptions {
                        field_name: b"options.flowlabel",
                        min: 0,
                        max: i64::from(u32::MAX),
                        msg: b"",
                    },
                ));
            }
            Some(fl.to_u32())
        } else {
            None
        };

        Ok(Options {
            family: _family,
            address: address_str,
            port: _port,
            flowlabel: _flowlabel,
        })
    }

    fn throw_bad_port(global: &JSGlobalObject, port_: JSValue) -> JsError {
        let Ok(ty) = JSGlobalObject::determine_specific_type(global, port_) else {
            return global
                .err(
                    bun_jsc::ErrorCode::SOCKET_BAD_PORT,
                    format_args!("The \"options.port\" argument must be a valid IP port number."),
                )
                .throw();
        };
        global
            .err(
                bun_jsc::ErrorCode::SOCKET_BAD_PORT,
                format_args!(
                    "The \"options.port\" argument must be a valid IP port number. Got {ty}."
                ),
            )
            .throw()
    }
}

// =============================================================================
// ============================== STATIC METHODS ===============================
// =============================================================================

impl SocketAddress {
    /// ### `SocketAddress.parse(input: string): SocketAddress | undefined`
    /// Parse an address string (with an optional `:port`) into a `SocketAddress`.
    /// Returns `undefined` if the input is invalid.
    pub(crate) fn parse<'a>(heap: &JsHeap<'a>, input: &BunString) -> Option<JsWrapper<'a, Self>> {
        const PREFIX: &str = "http://";
        let url_str: BunString = if input.is_8bit() {
            let from_chars = input.latin1();
            let (str, to_chars) =
                BunString::create_uninitialized_latin1(from_chars.len() + PREFIX.len());
            to_chars[..PREFIX.len()].copy_from_slice(PREFIX.as_bytes());
            to_chars[PREFIX.len()..].copy_from_slice(from_chars);
            str
        } else {
            let from_chars = input.utf16();
            let (str, to_chars) =
                BunString::create_uninitialized_utf16(from_chars.len() + PREFIX.len());
            // bun.strings.literal(u16, "http://")
            to_chars[..PREFIX.len()].copy_from_slice(bun_core::w!("http://"));
            to_chars[PREFIX.len()..].copy_from_slice(from_chars);
            str
        };

        let url = bun_jsc::url::Parsed::from_string(&url_str)?;
        let host = url.host().to_utf8();
        let port_: u16 = {
            let port32 = url.port();
            if port32 > u32::from(u16::MAX) {
                0
            } else {
                u16::try_from(port32).expect("int cast")
            }
        };

        // NOTE: parsed host cannot be used as presentation string. e.g.
        // - "[::1]" -> "::1"
        // - "0x.0x.0" -> "0.0.0.0"
        let paddr = host.slice(); // presentation address
        let addr = match ip_address::parse_strict(ip_address::strip_ipv6_brackets(paddr))? {
            IpAddr::V4(ip) => Self::init_ipv4(ip.octets(), port_),
            IpAddr::V6(ip) => Self::init_ipv6(ip.octets(), port_, 0, 0),
        };

        Some(addr.into_js(heap))
    }

    /// ### `SocketAddress.isSocketAddress(value: unknown): value is SocketAddress`
    /// Returns `true` if `value` is a `SocketAddress`. Subclasses and similarly-shaped
    /// objects are not considered `SocketAddress`s.
    pub(crate) fn is_socket_address(value: JsLocal<'_>) -> bool {
        value.to_js().is_direct::<Self>()
    }
}

// =============================================================================
// =============================== CONSTRUCTORS ================================
// =============================================================================

impl SocketAddress {
    /// `new SocketAddress([options])`
    ///
    /// ## Safety
    /// Constructor assumes that options object has already been sanitized and validated
    /// by JS wrapper.
    ///
    /// ## References
    /// - [Node docs](https://nodejs.org/api/net.html#new-netsocketaddressoptions)
    pub(crate) fn constructor(cx: &mut JsScope<'_>, options: JsLocal<'_>) -> JsResult<Self> {
        let global = cx.global();
        if options.is_undefined() {
            return Ok(SocketAddress {
                _addr: sockaddr::LOOPBACK_V4,
                _presentation: JsCell::new(BunString::EMPTY),
                // ._presentation = WellKnownAddress::loopback_v4(),
            });
        }

        let options = Options::from_js(global, options.to_js())?;

        // fast path for { family: 'ipv6' }
        if options.family == AF::INET6
            && options.address.is_none()
            && options.flowlabel.is_none()
            && options.port == 0
        {
            return Ok(SocketAddress {
                _addr: sockaddr::ANY_V6,
                _presentation: JsCell::new(BunString::EMPTY),
                // ._presentation = WellKnownAddress::any_v6(),
            });
        }

        SocketAddress::init_js(global, options)
    }

    pub(crate) fn init_from_addr_family(
        global: &JSGlobalObject,
        address_js: JSValue,
        family_js: JSValue,
    ) -> JsResult<SocketAddress> {
        if !address_js.is_string() {
            return Err(global.throw_invalid_argument_type_value(
                b"options.address",
                b"string",
                address_js,
            ));
        }
        let address_: BunString = BunString::from_js(address_js, global)?;
        let family_: AF = AF::from_js(global, family_js)?;
        Self::init_js(
            global,
            Options {
                address: Some(address_),
                family: family_,
                ..Default::default()
            },
        )
    }

    /// Semi-structured JS api for creating a `SocketAddress`. If you have raw
    /// socket address data, prefer `SocketAddress::init`.
    pub(crate) fn init_js(global: &JSGlobalObject, options: Options) -> JsResult<SocketAddress> {
        let (ip, presentation) = match (options.address, options.family) {
            (Some(address), _) => {
                let text = address.to_utf8();
                let ip = ip_address::parse_uv_inet_pton(&text);
                let goes_on = strings::index_of_any(&text, b"%\0").is_some();
                drop(text);
                (ip, if goes_on { BunString::DEAD } else { address })
            }
            (None, AF::INET) => (Some(Ipv4Addr::LOCALHOST.into()), BunString::EMPTY),
            (None, AF::INET6) => (Some(inet::IN6ADDR_ANY_INIT.into()), BunString::EMPTY),
        };

        let port = options.port.to_be();
        let addr = match (options.family, ip) {
            (AF::INET, Some(IpAddr::V4(ip))) => sockaddr::v4(port, u32::from_ne_bytes(ip.octets())),
            (AF::INET6, Some(IpAddr::V6(ip))) => {
                sockaddr::v6(port, ip.octets(), options.flowlabel.unwrap_or(0), 0)
            }
            _ => return Err(throw_invalid_address(global)),
        };

        Ok(SocketAddress {
            _addr: addr,
            _presentation: JsCell::new(presentation),
        })
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum AddressError {
    /// Too long or short to be an IPv4 or IPv6 address.
    #[error("InvalidLength")]
    InvalidLength,
}

impl SocketAddress {
    /// Create a new IP socket address. `addr` is assumed to be a valid ipv4 or ipv6
    /// address. Port is in host byte order.
    ///
    /// ## Errors
    /// - If `addr` is not 4 or 16 bytes long.
    pub(crate) fn init(addr: &[u8], port_: u16) -> Result<SocketAddress, AddressError> {
        match addr.len() {
            4 => Ok(Self::init_ipv4(
                <[u8; 4]>::try_from(&addr[..4]).unwrap(),
                port_,
            )),
            16 => Ok(Self::init_ipv6(
                <[u8; 16]>::try_from(&addr[..16]).unwrap(),
                port_,
                0,
                0,
            )),
            _ => Err(AddressError::InvalidLength),
        }
    }

    /// Create an IPv4 socket address. `addr` is assumed to be valid. Port is in host byte order.
    pub(crate) fn init_ipv4(addr: [u8; 4], port_: u16) -> SocketAddress {
        // TODO: make sure casting doesn't swap byte order on us.
        SocketAddress {
            _addr: sockaddr::v4(port_.to_be(), u32::from_ne_bytes(addr)),
            _presentation: JsCell::new(BunString::DEAD),
        }
    }

    /// Create an IPv6 socket address. `addr` is assumed to be valid. Port is in
    /// host byte order.
    ///
    /// Use `0` for `flowinfo` and `scope_id` if you don't know or care about their
    /// values.
    pub(crate) fn init_ipv6(
        addr: [u8; 16],
        port_: u16,
        flowinfo: u32,
        scope_id: u32,
    ) -> SocketAddress {
        SocketAddress {
            _addr: sockaddr::v6(port_.to_be(), addr, flowinfo, scope_id),
            _presentation: JsCell::new(BunString::DEAD),
        }
    }
}

// =============================================================================
// ================================ DESTRUCTORS ================================
// =============================================================================

impl SocketAddress {
    /// Turn this address into a DTO.
    ///
    /// This is similar to `.toJS`, but differs in the following ways:
    /// - `this` is consumed
    /// - result object is not an instance of `SocketAddress`, so
    ///   `SocketAddress.isSocketAddress(dto) === false`
    /// - address, port, etc. are put directly onto the object instead of being
    ///   accessed via getters on the prototype.
    ///
    /// This method is slightly faster if you are creating a lot of socket addresses
    /// that will not be around for very long. `createDTO` is even faster, but
    /// requires callers to already have a presentation-formatted address.
    pub(crate) fn into_dto(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let address = match self._presentation.take() {
            cached if cached.tag() != bun_core::Tag::Dead => cached,
            _ => self.fmt_presentation(),
        };
        Ok(JSSocketAddressDTO__create(
            global,
            address.into_js(global)?,
            self.port(),
            self.family() == AF::INET6,
        ))
    }

    /// Directly create a socket address DTO. This is a POJO with address, port, and family properties.
    /// Used for hot paths that provide existing, pre-formatted/validated address
    /// data to JS.
    ///
    /// - The address string is assumed to be ASCII and a valid IP address (either v4 or v6).
    /// - Port is a valid `in_port_t` (between 0 and 2^16) in host byte order.
    pub(crate) fn create_dto(
        global_object: &JSGlobalObject,
        addr_: &[u8],
        port_: u16,
        is_ipv6: bool,
    ) -> JsResult<JSValue> {
        debug_assert!(!addr_.is_empty());

        Ok(JSSocketAddressDTO__create(
            global_object,
            bun_string_jsc::create_utf8_for_js(global_object, addr_)?,
            port_,
            is_ipv6,
        ))
    }
}

unsafe extern "C" {
    safe fn JSSocketAddressDTO__create(
        global_object: &JSGlobalObject,
        address_: JSValue,
        port_: u16,
        is_ipv6: bool,
    ) -> JSValue;
}

// =============================================================================

impl SocketAddress {
    pub(crate) fn get_address(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        // toJS increments ref count
        let addr_ = self.address();
        Ok(match addr_.tag() {
            bun_core::Tag::Dead => unreachable!(),
            bun_core::Tag::Empty => match self.family() {
                AF::INET => global.common_strings().in4_loopback(),
                AF::INET6 => global.common_strings().in6_any(),
            },
            _ => addr_.to_js(global)?,
        })
    }

    /// Get the address in presentation format. Does not include the port.
    ///
    /// Returns an `.Empty` string for default ipv4 and ipv6 addresses (`127.0.0.1`
    /// and `::`, respectively).
    ///
    /// ### TODO
    /// - replace `addressToString` in the dns module with this
    /// - use this impl in the server module
    pub(crate) fn address(&self) -> &BunString {
        if self._presentation.get().tag() == bun_core::Tag::Dead {
            self._presentation.set(self.fmt_presentation());
        }
        self._presentation.get()
    }

    fn fmt_presentation(&self) -> BunString {
        let presentation = crate::webcore::encoding::to_bun_string(
            &self._addr.text(),
            crate::node::types::Encoding::Latin1,
        );
        debug_assert!(presentation.tag() != bun_core::Tag::Dead);
        presentation
    }

    /// `sockaddr.family`
    ///
    /// Returns a string representation of this address' family. Use `getAddrFamily`
    /// for the numeric value.
    ///
    /// NOTE: node's `net.SocketAddress` wants `"ipv4"` and `"ipv6"` while Bun's APIs
    /// use `"IPv4"` and `"IPv6"`. This is annoying.
    pub(crate) fn get_family<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        heap.common_string(match self.family() {
            AF::INET => CommonString::Ipv4Lower,
            AF::INET6 => CommonString::Ipv6Lower,
        })
    }

    /// `sockaddr.addrfamily`
    pub(crate) fn get_addrfamily(&self) -> u16 {
        self.family() as u16
    }

    /// NOTE: this returns whatever address-family value the system uses,
    /// which may differ across platforms.
    pub(crate) fn family(&self) -> AF {
        // NOTE: sockaddr_in and sockaddr_in6 have the same layout for family.
        // `sa_family_t` width varies (u8 on Darwin/the BSDs, u16 on Linux/
        // Windows); widen to u16 and compare. `family` is always one of the
        // AF discriminants we constructed.
        let raw = self._addr.family_raw() as u16;
        if raw == inet::AF_INET6 as u16 {
            AF::INET6
        } else {
            AF::INET
        }
    }

    pub(crate) fn get_port(&self) -> u16 {
        self.port()
    }

    /// Get the port number in host byte order.
    pub(crate) fn port(&self) -> u16 {
        // NOTE: sockaddr_in and sockaddr_in6 have the same layout for port.
        u16::from_be(self._addr.port_raw())
    }

    pub(crate) fn get_flowlabel(&self) -> u32 {
        self.flow_label().unwrap_or(0)
    }

    /// Returns `None` for non-IPv6 addresses.
    ///
    /// ## References
    /// - [RFC 6437](https://tools.ietf.org/html/rfc6437)
    pub(crate) fn flow_label(&self) -> Option<u32> {
        self._addr.as_sin6().map(|s| s.flowinfo)
    }

    pub(crate) fn socklen(&self) -> inet::socklen_t {
        match self._addr.family() {
            AF::INET => mem::size_of::<inet::sockaddr_in>() as inet::socklen_t,
            AF::INET6 => mem::size_of::<inet::sockaddr_in6>() as inet::socklen_t,
        }
    }

    pub(crate) fn to_json(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // `jsc.JSObject.create` requires a `PojoFields` impl, so use a local
        // struct.
        struct ToJson {
            address: JSValue,
            family: JSValue,
            port: JSValue,
            flowlabel: JSValue,
        }
        impl bun_jsc::js_object::PojoFields for ToJson {
            const FIELD_COUNT: usize = 4;
            fn put_fields(
                &self,
                _global: &JSGlobalObject,
                mut put: impl FnMut(&'static [u8], JSValue) -> JsResult<()>,
            ) -> JsResult<()> {
                put(b"address", self.address)?;
                put(b"family", self.family)?;
                put(b"port", self.port)?;
                put(b"flowlabel", self.flowlabel)?;
                Ok(())
            }
        }
        let family = self.get_family(&cx.heap).to_js();
        let address = self.get_address(cx)?;
        let global = cx.global();
        let pojo = ToJson {
            address,
            family,
            port: JSValue::js_number(f64::from(self.port())),
            flowlabel: JSValue::js_number(f64::from(self.get_flowlabel())),
        };
        Ok(bun_jsc::JSObject::create(&pojo, global)?.to_js())
    }
}

fn throw_invalid_address(global: &JSGlobalObject) -> JsError {
    global.throw_sys_error(
        bun_jsc::ErrorCode::ERR_INVALID_ADDRESS,
        format_args!("Invalid socket address"),
    )
}

// =============================================================================

#[repr(u16)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum AF {
    INET = inet::AF_INET as u16,
    INET6 = inet::AF_INET6 as u16,
}

impl AF {
    #[inline]
    fn int(self) -> inet::sa_family_t {
        self as inet::sa_family_t
    }

    fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<AF> {
        if value.is_string() {
            let fam_str = BunString::from_js(value, global)?;
            if fam_str.length() != 4 {
                return Err(global.throw_invalid_argument_property_value(
                    b"options.family",
                    Some("'ipv4' or 'ipv6'"),
                    value,
                ));
            }

            if fam_str.is_8bit() {
                let slice = fam_str.latin1();
                if bun_core::strings::eql_case_insensitive_ascii_check_length(slice, b"ipv4") {
                    return Ok(AF::INET);
                }
                if bun_core::strings::eql_case_insensitive_ascii_check_length(slice, b"ipv6") {
                    return Ok(AF::INET6);
                }
                Err(global.throw_invalid_argument_property_value(
                    b"options.family",
                    Some("'ipv4' or 'ipv6'"),
                    value,
                ))
            } else {
                // not full ignore-case since that would require converting
                // utf16 -> latin1 and the allocation isn't worth it.
                if fam_str.eq_ascii(b"ipv4") || fam_str.eq_ascii(b"IPv4") {
                    return Ok(AF::INET);
                }
                if fam_str.eq_ascii(b"ipv6") || fam_str.eq_ascii(b"IPv6") {
                    return Ok(AF::INET6);
                }
                Err(global.throw_invalid_argument_property_value(
                    b"options.family",
                    Some("'ipv4' or 'ipv6'"),
                    value,
                ))
            }
        } else if value.is_uint32_as_any_int() {
            match value.to_u32() {
                v if v == AF::INET.int() as u32 => Ok(AF::INET),
                v if v == AF::INET6.int() as u32 => Ok(AF::INET6),
                _ => Err(global.throw_invalid_argument_property_value(
                    b"options.family",
                    Some("AF_INET or AF_INET6"),
                    value,
                )),
            }
        } else {
            Err(global.throw_invalid_argument_property_value(
                b"options.family",
                Some("a string or number"),
                value,
            ))
        }
    }

    pub(crate) fn upper(self) -> &'static str {
        match self {
            AF::INET => "IPv4",
            AF::INET6 => "IPv6",
        }
    }
}

/// ## Notes
/// - Linux broke compat between `sockaddr_in` and `sockaddr_in6` in v2.4.
///   They're no longer the same size.
/// - This replaces `sockaddr_storage` because it's huge. This is 28 bytes,
///   while `sockaddr_storage` is 128 bytes.
#[repr(C)]
#[derive(Copy, Clone)]
pub(crate) struct sockaddr {
    /// Or the start of a `sockaddr_in6`: `family` and `port` have the same offsets in both.
    sin: inet::sockaddr_in,
    /// Initialized if the family is `AF_INET6`.
    rest_of_sin6: MaybeUninit<[u8; REST_OF_SIN6_LEN]>,
}

const REST_OF_SIN6_LEN: usize =
    mem::size_of::<inet::sockaddr_in6>() - mem::size_of::<inet::sockaddr_in>();

impl sockaddr {
    /// Raw `sa_family_t` from the shared prefix — valid for either variant.
    #[inline]
    pub(crate) fn family_raw(&self) -> inet::sa_family_t {
        self.sin.family
    }

    /// Raw network-byte-order port from the shared prefix — valid for either variant.
    #[inline]
    fn port_raw(&self) -> inet::in_port_t {
        self.sin.port
    }

    /// Tag-checked borrow of the IPv4 payload.
    #[inline]
    pub(crate) fn as_sin(&self) -> Option<&inet::sockaddr_in> {
        if self.family_raw() as u16 == inet::AF_INET as u16 {
            Some(&self.sin)
        } else {
            None
        }
    }

    /// Tag-checked borrow of the IPv6 payload.
    #[inline]
    pub(crate) fn as_sin6(&self) -> Option<&inet::sockaddr_in6> {
        if self.family_raw() as u16 == inet::AF_INET6 as u16 {
            // SAFETY: same size and alignment, and `rest_of_sin6` is initialized for this family.
            Some(unsafe { &*core::ptr::from_ref(self).cast::<inet::sockaddr_in6>() })
        } else {
            None
        }
    }

    const fn v4(port_: inet::in_port_t, addr: u32) -> sockaddr {
        sockaddr {
            sin: inet::sockaddr_in {
                family: inet::AF_INET as inet::sa_family_t,
                port: port_,
                addr,
                ..inet::sockaddr_in::ZEROED
            },
            rest_of_sin6: MaybeUninit::uninit(),
        }
    }

    const fn v6(
        port_: inet::in_port_t,
        addr: [u8; 16],
        // set to 0 if you don't care
        flowinfo: u32,
        // set to 0 if you don't care
        scope_id: u32,
    ) -> sockaddr {
        let sin6 = inet::sockaddr_in6 {
            family: inet::AF_INET6 as inet::sa_family_t,
            port: port_,
            flowinfo,
            scope_id,
            addr,
            ..inet::sockaddr_in6::ZEROED
        };
        let (mut sin, mut rest_of_sin6) = (inet::sockaddr_in::ZEROED, [0; REST_OF_SIN6_LEN]);
        let (start, rest) = bun_core::bytes_of(&sin6).split_at(size_of_val(&sin));
        bun_core::bytes_of_mut(&mut sin).copy_from_slice(start);
        rest_of_sin6.copy_from_slice(rest);
        sockaddr {
            sin,
            rest_of_sin6: MaybeUninit::new(rest_of_sin6),
        }
    }

    pub(crate) fn as_v4(&self) -> Option<u32> {
        if let Some(sin) = self.as_sin() {
            return Some(sin.addr);
        }
        if let Some(sin6) = self.as_sin6() {
            let sin6_addr = &sin6.addr;
            if !sin6_addr[0..10].iter().all(|&b| b == 0) {
                return None;
            }
            if sin6_addr[10] != 255 {
                return None;
            }
            if sin6_addr[11] != 255 {
                return None;
            }
            return Some(u32::from_ne_bytes(
                <[u8; 4]>::try_from(&sin6_addr[12..16]).unwrap(),
            ));
        }
        None
    }

    pub(crate) fn family(&self) -> AF {
        match self.family_raw() {
            v if v == inet::AF_INET as inet::sa_family_t => AF::INET,
            v if v == inet::AF_INET6 as inet::sa_family_t => AF::INET6,
            _ => unreachable!(),
        }
    }

    pub(crate) fn text(&self) -> IpText {
        IpText::new(match self.as_sin6() {
            Some(sin6) => sin6.addr.into(),
            None => self.sin.addr.to_ne_bytes().into(),
        })
    }

    // I'd bet money endianness is going to screw us here.
    const LOOPBACK_V4: sockaddr = sockaddr::v4(0, u32::from_ne_bytes([127, 0, 0, 1]));
    // TODO: check that `::` is all zeroes on all platforms. Should correspond
    // to `IN6ADDR_ANY_INIT`.
    const ANY_V6: sockaddr = sockaddr::v6(0, inet::IN6ADDR_ANY_INIT, 0, 0);

    // pub const in = inet::sockaddr_in;
    // pub const in6 = inet::sockaddr_in6;
    // → use inet::sockaddr_in / inet::sockaddr_in6 directly (Rust has no associated type aliases on inherent impls)
}

// =============================================================================

// The same types are defined in a bunch of different places. We should probably unify them.
const _: () = {
    use inet::{sockaddr_in, sockaddr_in6};
    assert!(mem::size_of::<sockaddr>() == mem::size_of::<sockaddr_in6>());
    assert!(mem::align_of::<sockaddr>() == mem::align_of::<sockaddr_in6>());
    assert!(mem::offset_of!(sockaddr_in, family) == mem::offset_of!(sockaddr_in6, family));
    assert!(mem::offset_of!(sockaddr_in, port) == mem::offset_of!(sockaddr_in6, port));
};

/// Fills `out` with `host`:`port` when `host` is numeric (inet_aton shorthand and `%zone` included) and returns 1, or 0 when it is a name — the one parse behind uSockets' connect paths, so a literal never reaches the resolver.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__parseIpAddress(
    host: Option<CStrRef<'_>>,
    port: u16,
    out: Option<&mut MaybeUninit<bun_sys::posix::sockaddr_storage>>,
) -> c_int {
    let (Some(host), Some(out)) = (host, out) else {
        return 0;
    };
    let bytes = host.to_cstr().to_bytes();
    let Some(ip) = bun_core::ip_address::to_ip_address(bytes) else {
        return 0;
    };
    let mut addr = bun_sys::net::Address::from_ip(ip, port);
    if ip.is_ipv6() {
        if let Some(pct) = strings::index_of_char_usize(bytes, b'%') {
            addr.set_scope_id(scope_index(&bytes[pct + 1..]));
        }
    }
    out.write(addr.into_storage());
    1
}

/// Replaces the octets at the start of `buffer` with their NUL-terminated text, and returns its length.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__formatIpAddress(buffer: &mut [u8; 64], is_ipv6: bool) -> usize {
    let octets: [u8; 16] = core::array::from_fn(|i| buffer[i]);
    let [a, b, c, d, ..] = octets;
    let text = IpText::new(if is_ipv6 {
        octets.into()
    } else {
        [a, b, c, d].into()
    });
    buffer[..text.len()].copy_from_slice(&text);
    buffer[text.len()] = 0;
    text.len()
}

/// A `%zone` is an interface name (`en0`) everywhere but Windows, where it is already the index.
fn scope_index(zone: &[u8]) -> u32 {
    #[cfg(not(windows))]
    {
        let mut buf = [0u8; 64];
        if !zone.is_empty() && zone.len() < buf.len() {
            buf[..zone.len()].copy_from_slice(zone);
            let idx = bun_sys::net::if_nametoindex(bun_core::ZStr::from_buf(&buf, zone.len()));
            if idx != 0 {
                return idx;
            }
        }
    }
    let mut idx: u32 = 0;
    for &b in zone {
        if !b.is_ascii_digit() {
            return 0;
        }
        idx = idx.wrapping_mul(10).wrapping_add((b - b'0') as u32);
    }
    idx
}

#[cfg(windows)]
pub(crate) mod inet {
    #![allow(non_camel_case_types)]
    use bun_sys::windows::ws2_32 as ws2;
    pub(crate) const IN6ADDR_ANY_INIT: [u8; 16] = [0; 16];
    pub(crate) use bun_sys::net::{in_port_t, sa_family_t, sockaddr_in, sockaddr_in6};
    pub(crate) use ws2::{AF_INET, AF_INET6, socklen_t};
}

#[cfg(not(windows))]
pub(crate) mod inet {
    #![allow(non_camel_case_types)]
    // Make sure this is in line with IN6ADDR_ANY_INIT in `netinet/in.h` on all platforms.
    pub(crate) const IN6ADDR_ANY_INIT: [u8; 16] = [0; 16];
    pub(crate) use bun_sys::net::{in_port_t, sa_family_t, sockaddr_in, sockaddr_in6};
    pub(crate) use bun_sys::posix::AF::{INET as AF_INET, INET6 as AF_INET6};
    pub(crate) use libc::socklen_t;
}
