//! An IP socket address meant to be used by both native and JS code.
//!
//! JS getters are named `getFoo`, while native getters are named `foo`.
//!
//! TODO: add a inspect method (under `Symbol.for("nodejs.util.inspect.custom")`).
//! Requires updating bindgen.

use core::ffi::{c_int, c_void};
use core::mem;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, JsError};
use bun_str::{self as strings, String as BunString, ZStr};
// TODO(port): move to <area>_sys — c-ares FFI lives in bun_c_ares
use bun_c_ares as ares;
use bun_jsc::URL;

// `pub const js = jsc.Codegen.JSSocketAddress;` + toJS/fromJS/fromJSDirect
// → handled by the JsClass derive; codegen wires toJS/fromJS/fromJSDirect.
#[bun_jsc::JsClass]
pub struct SocketAddress {
    // NOTE: not std.net.Address b/c .un is huge and we don't use it.
    // NOTE: not C.sockaddr_storage b/c it's _huge_. we need >= 28 bytes for sockaddr_in6,
    // but sockaddr_storage is 128 bytes.
    /// @internal
    _addr: sockaddr,
    /// Cached address in presentation format. Prevents repeated conversion between
    /// strings and bytes.
    ///
    /// - `.Dead` is used as an alternative to `null`
    /// - `.Empty` is used for default ipv4 and ipv6 addresses (`127.0.0.1` and `::`, respectively).
    ///
    /// @internal
    _presentation: BunString,
}

impl Default for SocketAddress {
    fn default() -> Self {
        Self { _addr: sockaddr::LOOPBACK_V4, _presentation: BunString::dead() }
    }
}

impl SocketAddress {
    // `pub const new = bun.TrivialNew(SocketAddress);`
    pub fn new(init: SocketAddress) -> Box<SocketAddress> {
        Box::new(init)
    }
}

pub struct Options {
    pub family: AF,
    /// When `None`, default is determined by address family.
    /// - `127.0.0.1` for IPv4
    /// - `::1` for IPv6
    pub address: Option<BunString>,
    pub port: u16,
    /// IPv6 flow label. JS getters for v4 addresses always return `0`.
    pub flowlabel: Option<u32>,
}

impl Default for Options {
    fn default() -> Self {
        Self { family: AF::INET, address: None, port: 0, flowlabel: None }
    }
}

impl Options {
    /// NOTE: assumes options object has been normalized and validated by JS code.
    pub fn from_js(global: &JSGlobalObject, obj: JSValue) -> JsResult<Options> {
        if !obj.is_object() {
            return Err(global.throw_invalid_argument_type_value("options", "object", obj));
        }

        let address_str: Option<BunString> = if let Some(a) = obj.get(global, "address")? {
            if !a.is_string() {
                return Err(global.throw_invalid_argument_type_value("options.address", "string", a));
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
            if !p.is_finite() {
                return Err(Self::throw_bad_port(global, p));
            }
            let port32 = p.to_int32();
            if port32 < 0 || port32 > i32::from(u16::MAX) {
                return Err(Self::throw_bad_port(global, p));
            }
            u16::try_from(port32).unwrap()
        } else {
            0
        };

        let _flowlabel = if let Some(fl) = obj.get(global, "flowlabel")? {
            if !fl.is_number() {
                return Err(global.throw_invalid_argument_type_value("options.flowlabel", "number", fl));
            }
            if !fl.is_uint32_as_any_int() {
                return Err(global.throw_range_error(
                    fl.as_number(),
                    bun_jsc::RangeErrorOptions {
                        field_name: "options.flowlabel",
                        min: 0,
                        max: i64::from(u32::MAX),
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
        let Ok(ty) = global.determine_specific_type(port_) else {
            return global
                .err(bun_jsc::ErrorCode::SOCKET_BAD_PORT, format_args!("The \"options.port\" argument must be a valid IP port number."))
                .throw();
        };
        // `defer ty.deref()` → BunString drops at scope exit
        global
            .err(
                bun_jsc::ErrorCode::SOCKET_BAD_PORT,
                format_args!("The \"options.port\" argument must be a valid IP port number. Got {}.", ty),
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
    #[bun_jsc::host_fn]
    pub fn parse(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let input = {
            let input_arg = callframe.argument(0);
            if !input_arg.is_string() {
                return Err(global.throw_invalid_argument_type_value("input", "string", input_arg));
            }
            BunString::from_js(input_arg, global)?
        };
        // `defer input.deref()` → drops at scope exit

        const PREFIX: &str = "http://";
        // PERF(port): was comptime bool dispatch (`switch (input.is8Bit()) { inline else => |is_8_bit| ... }`) — profile in Phase B
        let url_str = if input.is_8bit() {
            let from_chars = input.latin1();
            let (str, to_chars) = BunString::create_uninitialized_latin1(from_chars.len() + PREFIX.len());
            to_chars[..PREFIX.len()].copy_from_slice(PREFIX.as_bytes());
            to_chars[PREFIX.len()..].copy_from_slice(from_chars);
            str
        } else {
            let from_chars = input.utf16();
            let (str, to_chars) = BunString::create_uninitialized_utf16(from_chars.len() + PREFIX.len());
            // bun.strings.literal(u16, "http://")
            to_chars[..PREFIX.len()].copy_from_slice(bun_str::w!("http://"));
            to_chars[PREFIX.len()..].copy_from_slice(from_chars);
            str
        };
        // `defer url_str.deref()` → drops at scope exit

        let Some(url) = URL::from_string(&url_str) else {
            return Ok(JSValue::UNDEFINED);
        };
        // `defer url.deinit()` → URL impls Drop
        let host = url.host();
        let port_: u16 = {
            let port32 = url.port();
            if port32 > u32::from(u16::MAX) { 0 } else { u16::try_from(port32).unwrap() }
        };
        debug_assert!(host.tag() != bun_str::Tag::Dead);
        debug_assert!(host.length() >= 2);

        // NOTE: parsed host cannot be used as presentation string. e.g.
        // - "[::1]" -> "::1"
        // - "0x.0x.0" -> "0.0.0.0"
        let paddr = host.latin1(); // presentation address
        let addr = if paddr[0] == b'[' && paddr[paddr.len() - 1] == b']' {
            // TODO(port): std::net is banned; need bun_net::Ip6Address::parse equivalent
            let Ok(v6) = bun_net::Ip6Address::parse(&paddr[1..paddr.len() - 1], port_) else {
                return Ok(JSValue::UNDEFINED);
            };
            SocketAddress { _addr: sockaddr { sin6: v6.sa }, _presentation: BunString::dead() }
        } else {
            // TODO(port): std::net is banned; need bun_net::Ip4Address::parse equivalent
            let Ok(v4) = bun_net::Ip4Address::parse(paddr, port_) else {
                return Ok(JSValue::UNDEFINED);
            };
            SocketAddress { _addr: sockaddr { sin: v4.sa }, _presentation: BunString::dead() }
        };

        Ok(SocketAddress::new(addr).to_js(global))
    }

    /// ### `SocketAddress.isSocketAddress(value: unknown): value is SocketAddress`
    /// Returns `true` if `value` is a `SocketAddress`. Subclasses and similarly-shaped
    /// objects are not considered `SocketAddress`s.
    #[bun_jsc::host_fn]
    pub fn is_socket_address(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let value = callframe.argument(0);
        Ok(JSValue::from(value.is_cell() && SocketAddress::from_js_direct(value).is_some()))
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
    #[bun_jsc::host_fn]
    pub fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<SocketAddress>> {
        let options_obj = frame.argument(0);
        if options_obj.is_undefined() {
            return Ok(SocketAddress::new(SocketAddress {
                _addr: sockaddr::LOOPBACK_V4,
                _presentation: BunString::empty(),
                // ._presentation = WellKnownAddress::loopback_v4(),
                // ._presentation = BunString::from_js(global.common_strings().loopback_v4()) catch unreachable,
            }));
        }
        options_obj.ensure_still_alive();

        let options = Options::from_js(global, options_obj)?;

        // fast path for { family: 'ipv6' }
        if options.family == AF::INET6 && options.address.is_none() && options.flowlabel.is_none() && options.port == 0 {
            return Ok(SocketAddress::new(SocketAddress {
                _addr: sockaddr::ANY_V6,
                _presentation: BunString::empty(),
                // ._presentation = WellKnownAddress::any_v6(),
            }));
        }

        SocketAddress::create(global, options)
    }

    pub fn init_from_addr_family(global: &JSGlobalObject, address_js: JSValue, family_js: JSValue) -> JsResult<SocketAddress> {
        if !address_js.is_string() {
            return Err(global.throw_invalid_argument_type_value("options.address", "string", address_js));
        }
        let address_: BunString = BunString::from_js(address_js, global)?;
        let family_: AF = AF::from_js(global, family_js)?;
        Self::init_js(global, Options {
            address: Some(address_),
            family: family_,
            ..Default::default()
        })
    }

    /// Semi-structured JS api for creating a `SocketAddress`. If you have raw
    /// socket address data, prefer `SocketAddress::new`.
    ///
    /// ## Safety
    /// - `options.address` gets moved, much like `adoptRef`. Do not `deref` it
    ///   after passing it in.
    pub fn create(global: &JSGlobalObject, options: Options) -> JsResult<Box<SocketAddress>> {
        Ok(Self::new(Self::init_js(global, options)?))
    }

    pub fn init_js(global: &JSGlobalObject, options: Options) -> JsResult<SocketAddress> {
        let mut presentation: BunString = BunString::empty();

        // We need a zero-terminated cstring for `ares_inet_pton`, which forces us to
        // copy the string.
        // PERF(port): was stack-fallback — profile in Phase B
        // (Zig used std.heap.stackFallback(64, bun.default_allocator))

        // NOTE: `zig translate-c` creates semantically invalid code for `C.ntohs`.
        // Switch back to `htons(options.port)` when this issue gets resolved:
        // https://github.com/ziglang/zig/issues/22804
        let addr: sockaddr = match options.family {
            AF::INET => {
                let mut sin: inet::sockaddr_in = inet::sockaddr_in {
                    family: options.family.int(),
                    port: options.port.to_be(),
                    addr: 0, // undefined → overwritten below
                    ..unsafe { mem::zeroed() } // SAFETY: sockaddr_in is #[repr(C)] POD
                };
                if let Some(address_str) = options.address {
                    presentation = address_str;
                    let slice = presentation.to_owned_slice_z();
                    // `defer alloc.free(slice)` → Box<ZStr> drops at scope exit
                    pton(global, inet::AF_INET, &slice, (&mut sin.addr) as *mut _ as *mut c_void)?;
                } else {
                    // SAFETY: LOOPBACK_V4 is initialized as .sin
                    sin.addr = unsafe { sockaddr::LOOPBACK_V4.sin.addr };
                }
                sockaddr { sin }
            }
            AF::INET6 => {
                let mut sin6: inet::sockaddr_in6 = inet::sockaddr_in6 {
                    family: options.family.int(),
                    port: options.port.to_be(),
                    flowinfo: options.flowlabel.unwrap_or(0),
                    addr: [0u8; 16], // undefined → overwritten below
                    scope_id: 0,
                    ..unsafe { mem::zeroed() } // SAFETY: sockaddr_in6 is #[repr(C)] POD
                };
                if let Some(address_str) = options.address {
                    presentation = address_str;
                    let slice = presentation.to_owned_slice_z();
                    pton(global, inet::AF_INET6, &slice, (&mut sin6.addr) as *mut _ as *mut c_void)?;
                } else {
                    sin6.addr = inet::IN6ADDR_ANY_INIT;
                }
                sockaddr { sin6 }
            }
        };

        Ok(SocketAddress {
            _addr: addr,
            _presentation: presentation,
        })
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum AddressError {
    /// Too long or short to be an IPv4 or IPv6 address.
    #[error("InvalidLength")]
    InvalidLength,
}
impl From<AddressError> for bun_core::Error {
    fn from(e: AddressError) -> Self { bun_core::Error::from_name(<&'static str>::from(e)) }
}

impl SocketAddress {
    /// Create a new IP socket address. `addr` is assumed to be a valid ipv4 or ipv6
    /// address. Port is in host byte order.
    ///
    /// ## Errors
    /// - If `addr` is not 4 or 16 bytes long.
    pub fn init(addr: &[u8], port_: u16) -> Result<SocketAddress, AddressError> {
        match addr.len() {
            4 => Ok(Self::init_ipv4(<[u8; 4]>::try_from(&addr[..4]).unwrap(), port_)),
            16 => Ok(Self::init_ipv6(<[u8; 16]>::try_from(&addr[..16]).unwrap(), port_, 0, 0)),
            _ => Err(AddressError::InvalidLength),
        }
    }

    /// Create an IPv4 socket address. `addr` is assumed to be valid. Port is in host byte order.
    pub fn init_ipv4(addr: [u8; 4], port_: u16) -> SocketAddress {
        // TODO: make sure casting doesn't swap byte order on us.
        SocketAddress {
            _addr: sockaddr::v4(port_.to_be(), u32::from_ne_bytes(addr)),
            _presentation: BunString::dead(),
        }
    }

    /// Create an IPv6 socket address. `addr` is assumed to be valid. Port is in
    /// host byte order.
    ///
    /// Use `0` for `flowinfo` and `scope_id` if you don't know or care about their
    /// values.
    pub fn init_ipv6(addr: [u8; 16], port_: u16, flowinfo: u32, scope_id: u32) -> SocketAddress {
        SocketAddress {
            _addr: sockaddr::v6(port_.to_be(), addr, flowinfo, scope_id),
            _presentation: BunString::dead(),
        }
    }
}

// =============================================================================
// ================================ DESTRUCTORS ================================
// =============================================================================

impl SocketAddress {
    // Zig `deinit` only freed owned fields (`_presentation.deref()` + destroy(this)).
    // Per PORTING.md idiom map: body that only frees owned fields → delete; Box drop
    // runs `_presentation: BunString`'s Drop (which derefs). Keeping the explicit
    // `.deref()` here would double-deref.
    pub fn finalize(this: *mut SocketAddress) {
        bun_jsc::mark_binding!();
        // SAFETY: called from JSC finalizer on the mutator thread; `this` is the m_ctx payload
        unsafe { drop(Box::from_raw(this)); }
    }
}

// =============================================================================

impl SocketAddress {
    /// Turn this address into a DTO. `this` is consumed and undefined after this call.
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
    pub fn into_dto(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let mut addr_str = self.address();
        let port = self.port();
        let is_v6 = self.family() == AF::INET6;
        // `defer this._presentation = .dead;`
        let guard = scopeguard::guard(&mut self._presentation, |p| *p = BunString::dead());
        let _ = &*guard;
        // SAFETY: FFI call into C++ JSSocketAddressDTO__create
        Ok(unsafe { JSSocketAddressDTO__create(global, addr_str.transfer_to_js(global)?, port, is_v6) })
    }

    /// Directly create a socket address DTO. This is a POJO with address, port, and family properties.
    /// Used for hot paths that provide existing, pre-formatted/validated address
    /// data to JS.
    ///
    /// - The address string is assumed to be ASCII and a valid IP address (either v4 or v6).
    /// - Port is a valid `in_port_t` (between 0 and 2^16) in host byte order.
    pub fn create_dto(global_object: &JSGlobalObject, addr_: &[u8], port_: u16, is_ipv6: bool) -> JsResult<JSValue> {
        if cfg!(debug_assertions) {
            debug_assert!(!addr_.is_empty());
        }

        // SAFETY: FFI call into C++ JSSocketAddressDTO__create
        Ok(unsafe { JSSocketAddressDTO__create(global_object, BunString::create_utf8_for_js(global_object, addr_)?, port_, is_ipv6) })
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn JSSocketAddressDTO__create(global_object: *const JSGlobalObject, address_: JSValue, port_: u16, is_ipv6: bool) -> JSValue;
}

// =============================================================================

impl SocketAddress {
    #[bun_jsc::host_fn(getter)]
    pub fn get_address(this: &mut Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // toJS increments ref count
        let addr_ = this.address();
        Ok(match addr_.tag() {
            bun_str::Tag::Dead => unreachable!(),
            bun_str::Tag::Empty => match this.family() {
                AF::INET => global.common_strings().loopback_127_0_0_1(),
                AF::INET6 => global.common_strings().in6_any(),
            },
            _ => addr_.to_js(global),
        })
    }

    /// Get the address in presentation format. Does not include the port.
    ///
    /// Returns an `.Empty` string for default ipv4 and ipv6 addresses (`127.0.0.1`
    /// and `::`, respectively).
    ///
    /// ### TODO
    /// - replace `addressToString` in `dns.zig` w this
    /// - use this impl in server.zig
    pub fn address(&mut self) -> BunString {
        if self._presentation.tag() != bun_str::Tag::Dead {
            return self._presentation;
        }
        let mut buf = [0u8; inet::INET6_ADDRSTRLEN as usize];
        let formatted = self._addr.fmt(&mut buf);
        let presentation = bun_runtime::webcore::encoding::to_bun_string_comptime(formatted.as_bytes(), bun_str::Encoding::Latin1);
        debug_assert!(presentation.tag() != bun_str::Tag::Dead);
        self._presentation = presentation;
        presentation
    }

    /// `sockaddr.family`
    ///
    /// Returns a string representation of this address' family. Use `getAddrFamily`
    /// for the numeric value.
    ///
    /// NOTE: node's `net.SocketAddress` wants `"ipv4"` and `"ipv6"` while Bun's APIs
    /// use `"IPv4"` and `"IPv6"`. This is annoying.
    #[bun_jsc::host_fn(getter)]
    pub fn get_family(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match this.family() {
            AF::INET => global.common_strings().ipv4(),
            AF::INET6 => global.common_strings().ipv6(),
        })
    }

    /// `sockaddr.addrfamily`
    #[bun_jsc::host_fn(getter)]
    pub fn get_addr_family(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.family().int())
    }

    /// NOTE: zig std uses posix values only, while this returns whatever the
    /// system uses. Do not compare to `std.posix.AF`.
    pub fn family(&self) -> AF {
        // NOTE: sockaddr_in and sockaddr_in6 have the same layout for family.
        // SAFETY: family field is at the same offset in both union variants
        unsafe { mem::transmute::<inet::sa_family_t, AF>(self._addr.sin.family) }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_port(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.port())
    }

    /// Get the port number in host byte order.
    pub fn port(&self) -> u16 {
        // NOTE: sockaddr_in and sockaddr_in6 have the same layout for port.
        // NOTE: `zig translate-c` creates semantically invalid code for `C.ntohs`.
        // Switch back to `ntohs` when this issue gets resolved: https://github.com/ziglang/zig/issues/22804
        // SAFETY: port field is at the same offset in both union variants
        u16::from_be(unsafe { self._addr.sin.port })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_flow_label(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.flow_label().unwrap_or(0))
    }

    /// Returns `None` for non-IPv6 addresses.
    ///
    /// ## References
    /// - [RFC 6437](https://tools.ietf.org/html/rfc6437)
    pub fn flow_label(&self) -> Option<u32> {
        if self.family() == AF::INET6 {
            // SAFETY: family() == INET6 guarantees sin6 variant is active; same-size POD bitcast
            let in6: inet::sockaddr_in6 = unsafe { mem::transmute_copy(&self._addr) };
            Some(in6.flowinfo)
        } else {
            None
        }
    }

    pub fn socklen(&self) -> inet::socklen_t {
        match self._addr.family() {
            AF::INET => mem::size_of::<inet::sockaddr_in>() as inet::socklen_t,
            AF::INET6 => mem::size_of::<inet::sockaddr_in6>() as inet::socklen_t,
        }
    }

    pub fn estimated_size(&self) -> usize {
        mem::size_of::<SocketAddress>() + self._presentation.estimated_size()
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_json(this: &mut Self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        // TODO(port): jsc.JSObject.create with anon struct → need bun_jsc::JSObject builder API
        Ok(bun_jsc::JSObject::create(global, &[
            ("address", Self::get_address(this, global)?),
            ("family", Self::get_family(this, global)?),
            ("port", JSValue::js_number(this.port())),
            ("flowlabel", JSValue::js_number(this.flow_label().unwrap_or(0))),
        ])?.to_js())
    }
}

// PERF(port): was comptime monomorphization (`comptime af: c_int`) — profile in Phase B
fn pton(global: &JSGlobalObject, af: c_int, addr: &ZStr, dst: *mut c_void) -> JsResult<()> {
    // SAFETY: addr is NUL-terminated, dst points to a valid in_addr/in6_addr
    match unsafe { ares::ares_inet_pton(af, addr.as_ptr(), dst) } {
        0 => Err(global.throw_sys_error(
            bun_jsc::SysErrorOptions { code: bun_jsc::ErrorCode::ERR_INVALID_IP_ADDRESS, ..Default::default() },
            format_args!("Invalid socket address"),
        )),

        // TODO: figure out proper way to convert a c errno into a js exception
        -1 => Err(global.throw_sys_error(
            bun_jsc::SysErrorOptions {
                code: bun_jsc::ErrorCode::ERR_INVALID_IP_ADDRESS,
                // SAFETY: std.c._errno() returns thread-local errno pointer
                errno: unsafe { *bun_sys::errno() },
                ..Default::default()
            },
            format_args!("Invalid socket address"),
        )),
        1 => Ok(()),
        _ => unreachable!(),
    }
}

impl SocketAddress {
    #[inline]
    fn as_v4(&self) -> &inet::sockaddr_in {
        debug_assert!(self.family() == AF::INET);
        // SAFETY: family() == INET guarantees sin variant is active
        unsafe { &self._addr.sin }
    }

    #[inline]
    fn as_v6(&self) -> &inet::sockaddr_in6 {
        debug_assert!(self.family() == AF::INET6);
        // SAFETY: family() == INET6 guarantees sin6 variant is active
        unsafe { &self._addr.sin6 }
    }
}

// =============================================================================

// WTF::StringImpl and WTF::StaticStringImpl have the same shape
// (StringImplShape) so this is fine. We should probably add StaticStringImpl
// bindings though.
// TODO(port): move to <area>_sys
unsafe extern "C" {
    static IPv4: bun_str::StaticStringImpl;
    static IPv6: bun_str::StaticStringImpl;
}
// TODO(port): const bun.String construction from extern static — needs runtime init or const-fn wrapper
// const ipv4: BunString = BunString { tag: .WTFStringImpl, value: .{ .WTFStringImpl = IPv4 } };
// const ipv6: BunString = BunString { tag: .WTFStringImpl, value: .{ .WTFStringImpl = IPv6 } };

// FIXME: c-headers-for-zig casts AF_* and PF_* to `c_int` when it should be `comptime_int`
#[repr(u16)] // TODO(port): repr should be inet::sa_family_t but Rust requires concrete int; sa_family_t is u16 on posix+win
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AF {
    INET = inet::AF_INET as u16,
    INET6 = inet::AF_INET6 as u16,
}

impl AF {
    #[inline]
    pub fn int(self) -> inet::sa_family_t {
        self as inet::sa_family_t
    }

    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<AF> {
        if value.is_string() {
            let fam_str = BunString::from_js(value, global)?;
            // `defer fam_str.deref()` → drops at scope exit
            if fam_str.length() != 4 {
                return Err(global.throw_invalid_argument_property_value("options.family", "'ipv4' or 'ipv6'", value));
            }

            if fam_str.is_8bit() {
                let slice = fam_str.latin1();
                if slice[..4].eq_ignore_ascii_case(b"ipv4") { return Ok(AF::INET); }
                if slice[..4].eq_ignore_ascii_case(b"ipv6") { return Ok(AF::INET6); }
                Err(global.throw_invalid_argument_property_value("options.family", "'ipv4' or 'ipv6'", value))
            } else {
                // not full ignore-case since that would require converting
                // utf16 -> latin1 and the allocation isn't worth it.
                if fam_str.eql_comptime("ipv4") || fam_str.eql_comptime("IPv4") { return Ok(AF::INET); }
                if fam_str.eql_comptime("ipv6") || fam_str.eql_comptime("IPv6") { return Ok(AF::INET6); }
                Err(global.throw_invalid_argument_property_value("options.family", "'ipv4' or 'ipv6'", value))
            }
        } else if value.is_uint32_as_any_int() {
            match value.to_u32() {
                v if v == AF::INET.int() as u32 => Ok(AF::INET),
                v if v == AF::INET6.int() as u32 => Ok(AF::INET6),
                _ => Err(global.throw_invalid_argument_property_value("options.family", "AF_INET or AF_INET6", value)),
            }
        } else {
            Err(global.throw_invalid_argument_property_value("options.family", "a string or number", value))
        }
    }

    pub fn upper(self) -> &'static ZStr {
        match self {
            AF::INET => ZStr::from_lit(b"IPv4\0"),
            AF::INET6 => ZStr::from_lit(b"IPv6\0"),
        }
    }
}

/// ## Notes
/// - Linux broke compat between `sockaddr_in` and `sockaddr_in6` in v2.4.
///   They're no longer the same size.
/// - This replaces `sockaddr_storage` because it's huge. This is 28 bytes,
///   while `sockaddr_storage` is 128 bytes.
#[allow(non_camel_case_types)]
#[repr(C)]
pub union sockaddr {
    pub sin: inet::sockaddr_in,
    pub sin6: inet::sockaddr_in6,
}

impl sockaddr {
    pub fn v4(port_: inet::in_port_t, addr: u32) -> sockaddr {
        sockaddr {
            sin: inet::sockaddr_in {
                family: AF::INET.int(),
                port: port_,
                addr,
                ..unsafe { mem::zeroed() } // SAFETY: sockaddr_in is #[repr(C)] POD; covers .zero padding
            },
        }
    }

    pub fn v6(
        port_: inet::in_port_t,
        addr: [u8; 16],
        /// set to 0 if you don't care
        flowinfo: u32,
        /// set to 0 if you don't care
        scope_id: u32,
    ) -> sockaddr {
        sockaddr {
            sin6: inet::sockaddr_in6 {
                family: AF::INET6.int(),
                port: port_,
                flowinfo,
                scope_id,
                addr,
                ..unsafe { mem::zeroed() } // SAFETY: sockaddr_in6 is #[repr(C)] POD
            },
        }
    }

    pub fn as_v4(&self) -> Option<u32> {
        // SAFETY: family field is at the same offset in both variants
        let fam = unsafe { self.sin.family };
        if fam == bun_sys::posix::AF_INET {
            // SAFETY: fam == INET guarantees sin variant is active
            return Some(unsafe { self.sin.addr });
        }
        if fam == bun_sys::posix::AF_INET6 {
            // SAFETY: fam == INET6 guarantees sin6 variant is active
            let sin6_addr = unsafe { &self.sin6.addr };
            if !sin6_addr[0..10].iter().all(|&b| b == 0) { return None; }
            if sin6_addr[10] != 255 { return None; }
            if sin6_addr[11] != 255 { return None; }
            return Some(u32::from_ne_bytes(<[u8; 4]>::try_from(&sin6_addr[12..16]).unwrap()));
        }
        None
    }

    pub fn family(&self) -> AF {
        // SAFETY: family field is at the same offset in both variants
        match unsafe { self.sin.family } {
            v if v == bun_sys::posix::AF_INET => AF::INET,
            v if v == bun_sys::posix::AF_INET6 => AF::INET6,
            _ => unreachable!(),
        }
    }

    pub fn fmt<'a>(&self, buf: &'a mut [u8; inet::INET6_ADDRSTRLEN as usize]) -> &'a ZStr {
        // SAFETY: family() guarantees correct variant; pointer is to valid in_addr/in6_addr
        let addr_src: *const c_void = if self.family() == AF::INET {
            unsafe { (&self.sin.addr) as *const _ as *const c_void }
        } else {
            unsafe { (&self.sin6.addr) as *const _ as *const c_void }
        };
        // SAFETY: buf is INET6_ADDRSTRLEN bytes; ares_inet_ntop writes NUL-terminated string
        let result = unsafe { ares::ares_inet_ntop(self.family().int() as c_int, addr_src, buf.as_mut_ptr(), buf.len() as ares::socklen_t) };
        let Some(ptr) = (unsafe { result.as_ref() }) else {
            panic!("Invariant violation: SocketAddress created with invalid IPv6 address");
        };
        // std.mem.sliceTo(..., 0)
        let len = buf.iter().position(|&b| b == 0).unwrap();
        // SAFETY: buf[len] == 0 written by ares_inet_ntop above
        let formatted = unsafe { ZStr::from_raw(buf.as_ptr(), len) };
        let _ = ptr;
        if cfg!(debug_assertions) {
            debug_assert!(bun_str::strings::is_all_ascii(formatted.as_bytes()));
        }
        formatted
    }

    // I'd bet money endianness is going to screw us here.
    // Zig name: `@"127.0.0.1"`
    pub const LOOPBACK_V4: sockaddr = {
        // TODO(port): const-eval — sockaddr::v4 isn't const fn; inline manually if needed in Phase B
        sockaddr {
            sin: inet::sockaddr_in {
                family: inet::AF_INET as inet::sa_family_t,
                port: 0,
                addr: u32::from_ne_bytes([127, 0, 0, 1]),
                zero: [0; 8],
            },
        }
    };
    // TODO: check that `::` is all zeroes on all platforms. Should correspond
    // to `IN6ADDR_ANY_INIT`.
    // Zig name: `@"::"`
    pub const ANY_V6: sockaddr = {
        sockaddr {
            sin6: inet::sockaddr_in6 {
                family: inet::AF_INET6 as inet::sa_family_t,
                port: 0,
                flowinfo: 0,
                scope_id: 0,
                addr: inet::IN6ADDR_ANY_INIT,
            },
        }
    };

    // pub const in = inet::sockaddr_in;
    // pub const in6 = inet::sockaddr_in6;
    // → use inet::sockaddr_in / inet::sockaddr_in6 directly (Rust has no associated type aliases on inherent impls)
}

#[allow(non_snake_case)]
mod WellKnownAddress {
    use super::*;
    // TODO(port): move to <area>_sys
    unsafe extern "C" {
        static INET_LOOPBACK: bun_str::StaticStringImpl;
        static INET6_ANY: bun_str::StaticStringImpl;
    }
    #[inline]
    pub fn loopback_v4() -> BunString {
        // SAFETY: INET_LOOPBACK is a static StringImpl initialized at load time
        BunString::from_wtf_string_impl(unsafe { INET_LOOPBACK })
    }
    #[inline]
    pub fn any_v6() -> BunString {
        // SAFETY: INET6_ANY is a static StringImpl initialized at load time
        BunString::from_wtf_string_impl(unsafe { INET6_ANY })
    }
}

// =============================================================================

// The same types are defined in a bunch of different places. We should probably unify them.
// TODO(port): comptime static asserts — Rust const_assert! once inet types are concrete
// const _: () = assert!(mem::size_of::<inet::socklen_t>() == mem::size_of::<bun_sys::posix::socklen_t>());
// const _: () = assert!(mem::align_of::<inet::socklen_t>() == mem::align_of::<bun_sys::posix::socklen_t>());
// const _: () = assert!(AF::INET.int() == ares::AF::INET);
// const _: () = assert!(AF::INET6.int() == ares::AF::INET6);

#[cfg(windows)]
pub mod inet {
    use bun_sys::windows::ws2_32 as ws2;
    pub use ws2::IN4ADDR_LOOPBACK;
    pub use ws2::INET6_ADDRSTRLEN;
    pub const IN6ADDR_ANY_INIT: [u8; 16] = [0; 16];
    pub use ws2::AF_INET;
    pub use ws2::AF_INET6;
    pub type sa_family_t = ws2::ADDRESS_FAMILY;
    pub type in_port_t = bun_sys::windows::USHORT;
    pub type socklen_t = super::ares::socklen_t;
    pub type sockaddr_in = bun_sys::posix::sockaddr_in;
    pub type sockaddr_in6 = bun_sys::posix::sockaddr_in6;
}

#[cfg(not(windows))]
pub mod inet {
    use bun_sys::c as C; // bun.c → translated-c-headers
    pub use C::IN4ADDR_LOOPBACK;
    pub use C::INET6_ADDRSTRLEN;
    // Make sure this is in line with IN6ADDR_ANY_INIT in `netinet/in.h` on all platforms.
    pub const IN6ADDR_ANY_INIT: [u8; 16] = [0; 16];
    pub use C::AF_INET;
    pub use C::AF_INET6;
    pub type sa_family_t = C::sa_family_t;
    pub type in_port_t = C::in_port_t;
    pub type socklen_t = super::ares::socklen_t;
    pub type sockaddr_in = bun_sys::posix::sockaddr_in;
    pub type sockaddr_in6 = bun_sys::posix::sockaddr_in6;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/SocketAddress.zig (693 lines)
//   confidence: medium
//   todos:      11
//   notes:      .classes.ts payload; std.net IP parsing needs bun_net replacement; sockaddr const init may need const fn; common_strings()."127.0.0.1"/"::"/ipv4/ipv6 method names guessed
// ──────────────────────────────────────────────────────────────────────────
