#![warn(unused_must_use)]

use core::ffi::c_int;
use core::net::SocketAddr;
use core::ptr::{self, NonNull};

use bun_core::ip_address::IpText;
use bun_core::{String as BunString, ZStr};
use bun_dns_client::Error;
// `bun_wyhash` exports `Wyhash11` (iterative init/update/final_ surface).
// Hash is in-memory dedupe only — algorithm identity is not load-bearing.
use bun_wyhash::Wyhash11 as Wyhash;

// `libc` does not expose winsock types/constants on Windows; route every
// `libc::AF_*` / `addrinfo` reference through this shim so
// the body of this crate stays cfg-free.
#[cfg(not(windows))]
mod sock {
    pub use libc::addrinfo;
    pub(crate) use libc::{
        AF_INET, AF_INET6, IPPROTO_TCP, IPPROTO_UDP, SO_RCVBUF, SOCK_DGRAM, SOCK_STREAM,
        SOL_SOCKET, TCP_NODELAY, freeaddrinfo, getaddrinfo, getnameinfo,
    };
    #[cfg(target_os = "freebsd")]
    pub(crate) use libc::{IPPROTO_IPV6, IPV6_V6ONLY};
}
#[cfg(windows)]
mod sock {
    pub use bun_windows_sys::ws2_32::addrinfo;
    pub(crate) use bun_windows_sys::ws2_32::{
        AF_INET, AF_INET6, IPPROTO_IPV6, IPPROTO_TCP, IPPROTO_UDP, IPV6_V6ONLY, SO_RANDOMIZE_PORT,
        SO_RCVBUF, SOCK_DGRAM, SOCK_STREAM, SOL_SOCKET, TCP_NODELAY, freeaddrinfo, getaddrinfo,
        getnameinfo,
    };
}

pub mod os;

pub use bun_dns_client::Family;
pub use sock::addrinfo;

/// What `getaddrinfo` returns.
pub struct AddrInfoList(NonNull<addrinfo>);

impl AddrInfoList {
    /// `Err` is the `EAI_*` status, or 0 for an empty list.
    pub fn lookup(
        host: Option<&ZStr>,
        service: Option<&ZStr>,
        hints: Option<&addrinfo>,
    ) -> Result<Self, c_int> {
        let mut list = ptr::null_mut();
        // SAFETY: each argument is null or valid for the call.
        let status = unsafe {
            sock::getaddrinfo(
                host.map_or(ptr::null(), ZStr::as_ptr),
                service.map_or(ptr::null(), ZStr::as_ptr),
                hints.map_or(ptr::null(), ptr::from_ref),
                &raw mut list,
            )
        };
        // `list` is unspecified on failure.
        match NonNull::new(list) {
            Some(list) if status == 0 => Ok(Self(list)),
            _ => Err(status),
        }
    }

    pub fn addresses(&self) -> Addresses<'_> {
        // SAFETY: live until `drop`.
        Addresses(Some(unsafe { self.0.as_ref() }))
    }

    pub fn to_list(&self) -> ResultList {
        self.addresses().into_list()
    }
}

impl Drop for AddrInfoList {
    fn drop(&mut self) {
        // SAFETY: from `getaddrinfo`.
        unsafe { sock::freeaddrinfo(self.0.as_ptr()) }
    }
}

/// Iterator over the bytes of each non-null `ai_addr` of a `getaddrinfo` result.
#[derive(Clone)]
pub struct Addresses<'a>(Option<&'a addrinfo>);

impl Addresses<'_> {
    fn into_list(self) -> ResultList {
        let mut list = ResultList::with_capacity(self.clone().count());
        list.extend(self.map(|address| GetAddrInfoResult {
            address: Address::from_bytes(address),
            // no TTL in POSIX getaddrinfo()
            ttl: 0,
        }));
        list
    }
}

impl<'a> Iterator for Addresses<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        loop {
            let entry = self.0?;
            // SAFETY: `ai_next` is null or the next entry of the list.
            self.0 = unsafe { entry.ai_next.as_ref() };
            if !entry.ai_addr.is_null() {
                let (addr, len) = (entry.ai_addr.cast::<u8>(), entry.ai_addrlen as usize);
                // SAFETY: `getaddrinfo` initialized `ai_addrlen` bytes at `ai_addr`.
                return Some(unsafe { core::slice::from_raw_parts(addr, len) });
            }
        }
    }
}

#[cfg(unix)]
mod eai {
    use core::ffi::c_int;
    pub(crate) use libc::{EAI_AGAIN as AGAIN, EAI_FAIL as FAIL, EAI_NONAME as NONAME};

    // `libc` lacks these.
    pub(crate) const ADDRFAMILY: c_int = if cfg!(target_os = "linux") { -9 } else { 1 };
    pub(crate) const NODATA: c_int = if cfg!(target_os = "linux") { -5 } else { 7 };
    // Linux has neither, and no status above 0.
    pub(crate) const BADHINTS: c_int = 12;
    pub(crate) const PROTOCOL: c_int = 13;
    #[cfg(target_env = "gnu")]
    pub(crate) const IDN_ENCODE: c_int = -105;
}
#[cfg(windows)]
mod eai {
    pub(crate) use bun_sys::windows::libuv::{
        UV_EAI_AGAIN as AGAIN, UV_EAI_FAIL as FAIL, UV_EAI_NONAME as NONAME,
    };
}

/// `status` is an `EAI_*`, or 0.
#[cfg(unix)]
pub fn getaddrinfo_error(status: c_int) -> Option<Error> {
    Some(match status {
        0 => return None,
        // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
        eai::NODATA | eai::NONAME => Error::ENOTFOUND,
        eai::ADDRFAMILY | libc::EAI_FAMILY => Error::EBADFAMILY,
        eai::AGAIN => Error::EAI_AGAIN,
        eai::FAIL => Error::EBADRESP,
        #[cfg(target_env = "gnu")]
        eai::IDN_ENCODE => Error::EBADSTR,
        libc::EAI_BADFLAGS => Error::EBADFLAGS,
        libc::EAI_MEMORY => Error::ENOMEM,
        libc::EAI_SERVICE => Error::ESERVICE,
        #[cfg(any(target_os = "linux", target_os = "android"))]
        libc::EAI_SOCKTYPE => Error::ECONNREFUSED,
        libc::EAI_SYSTEM => Error::ESERVFAIL,
        _ => Error::ENOTIMP,
    })
}

/// `status` is a `UV_EAI_*`, or 0.
#[cfg(windows)]
pub fn getaddrinfo_error(status: c_int) -> Option<Error> {
    use bun_sys::windows::libuv;
    Some(match status {
        0 => return None,
        eai::AGAIN => Error::EAI_AGAIN,
        libuv::UV_EAI_ADDRFAMILY | libuv::UV_EAI_FAMILY => Error::EBADFAMILY,
        libuv::UV_EAI_BADFLAGS => Error::EBADFLAGS,
        libuv::UV_EAI_BADHINTS => Error::EBADHINTS,
        libuv::UV_EAI_CANCELED => Error::ECANCELLED,
        libuv::UV_EAI_MEMORY | libuv::UV_EAI_OVERFLOW => Error::ENOMEM,
        libuv::UV_EAI_PROTOCOL => Error::EBADQUERY,
        libuv::UV_EAI_SERVICE => Error::ESERVICE,
        libuv::UV_EAI_SOCKTYPE => Error::ECONNREFUSED,
        _ => Error::ENOTFOUND,
    })
}

pub const UV_EAI_NODATA: c_int = -3007;
pub const UV_EAI_NONAME: c_int = -3008;

/// Reads `errno`. https://github.com/nodejs/node/blob/v26.12.1/deps/uv/src/unix/getaddrinfo.c#L39-L92
#[cfg(unix)]
fn to_uv_error(status: c_int) -> c_int {
    match status {
        eai::ADDRFAMILY => -3000,
        eai::AGAIN => -3001,
        libc::EAI_BADFLAGS => -3002,
        libc::EAI_FAMILY => -3005,
        libc::EAI_MEMORY => -3006,
        eai::NODATA => UV_EAI_NODATA,
        eai::NONAME => UV_EAI_NONAME,
        libc::EAI_OVERFLOW => -3009,
        libc::EAI_SERVICE => -3010,
        libc::EAI_SOCKTYPE => -3011,
        eai::BADHINTS => -3013,
        eai::PROTOCOL => -3014,
        libc::EAI_SYSTEM if bun_sys::last_errno() != 0 => -bun_sys::last_errno(),
        // UV_EAI_FAIL
        _ => -3004,
    }
}

/// Why the system's resolver gave no address.
#[derive(Clone, Copy)]
pub struct AddrInfoError {
    pub error: Error,
    /// The `UV_E*` that Node.js has for it.
    pub uv: c_int,
}

impl AddrInfoError {
    pub const NOT_FOUND: Self = Self {
        error: Error::ENOTFOUND,
        uv: UV_EAI_NONAME,
    };

    /// As [`getaddrinfo_error`]. Reads `errno`.
    pub fn new(status: c_int) -> Option<Self> {
        Some(Self {
            error: getaddrinfo_error(status)?,
            #[cfg(unix)]
            uv: to_uv_error(status),
            #[cfg(windows)]
            uv: status,
        })
    }
}

/// In UTF-8.
pub struct NameInfo {
    pub host: Vec<u8>,
    pub service: Vec<u8>,
}

impl NameInfo {
    const MAX_HOST_LEN: usize = 1025;
    const MAX_SERVICE_LEN: usize = 32;

    /// Blocks. `Err` is a `UV_E*`.
    #[cfg(unix)]
    pub fn lookup(address: &Address) -> Result<Self, c_int> {
        let address = address.as_bytes();
        let (mut host, mut service) = ([0u8; Self::MAX_HOST_LEN], [0u8; Self::MAX_SERVICE_LEN]);
        // SAFETY: each buffer is passed with its length.
        let status = unsafe {
            sock::getnameinfo(
                address.as_ptr().cast(),
                address.len() as _,
                host.as_mut_ptr().cast(),
                host.len() as _,
                service.as_mut_ptr().cast(),
                service.len() as _,
                libc::NI_NAMEREQD,
            )
        };
        if status != 0 {
            return Err(to_uv_error(status));
        }
        let [host, service] = [&host[..], &service].map(|it| bun_core::slice_to_nul(it).to_vec());
        Ok(Self { host, service })
    }

    /// Blocks. `Err` is a `UV_E*`.
    #[cfg(windows)]
    pub fn lookup(address: &Address) -> Result<Self, c_int> {
        use bun_core::strings::{index_of_scalar, to_utf8_alloc};
        use bun_sys::windows::libuv;
        use bun_windows_sys::ws2_32::{GetNameInfoW, NI_NAMEREQD};

        libuv::uv__winsock_ensure();
        let address = address.as_bytes();
        let (mut host, mut service) = ([0u16; Self::MAX_HOST_LEN], [0u16; Self::MAX_SERVICE_LEN]);
        // SAFETY: each buffer is passed with its length.
        let status = unsafe {
            GetNameInfoW(
                address.as_ptr().cast(),
                address.len() as _,
                host.as_mut_ptr(),
                host.len() as _,
                service.as_mut_ptr(),
                service.len() as _,
                NI_NAMEREQD,
            )
        };
        if status != 0 {
            return Err(libuv::uv__getaddrinfo_translate_error(status));
        }
        let [host, service] = [&host[..], &service]
            .map(|it| to_utf8_alloc(&it[..index_of_scalar(it, 0).unwrap_or(it.len())]));
        Ok(Self { host, service })
    }
}

/// What [`getaddrinfo_error`] takes for the `EAI_*` called `name`.
pub fn getaddrinfo_status_by_name(name: &[u8]) -> Option<c_int> {
    match name {
        b"EAI_AGAIN" => Some(eai::AGAIN),
        b"EAI_FAIL" => Some(eai::FAIL),
        b"EAI_NONAME" => Some(eai::NONAME),
        _ => None,
    }
}

#[cfg(windows)]
pub const AI_V4MAPPED: c_int = 2048;
#[cfg(not(windows))]
pub const AI_V4MAPPED: c_int = libc::AI_V4MAPPED;

#[cfg(windows)]
pub const AI_ADDRCONFIG: c_int = 1024;
#[cfg(not(windows))]
pub const AI_ADDRCONFIG: c_int = libc::AI_ADDRCONFIG;

#[cfg(windows)]
pub const AI_ALL: c_int = 256;
#[cfg(not(windows))]
pub const AI_ALL: c_int = libc::AI_ALL;

#[derive(Default)]
pub struct GetAddrInfo {
    pub name: Box<[u8]>,
    pub port: u16,
    pub options: Options,
}

impl GetAddrInfo {
    pub fn hash(&self) -> u64 {
        let mut hasher = Wyhash::init(0);
        hasher.update(&self.port.to_ne_bytes());
        hasher.update(&self.options.to_packed_bytes());
        hasher.update(&self.name);

        hasher.final_()
    }
}

// Hashed as a packed u64 — bit layout: family:2, socktype:2, protocol:2,
// backend:2, flags:32 (AI_*), _:24. Represented here as a plain struct
// because every use site reads fields by name; only `hash()` cares about
// the raw bytes, which `to_packed_bytes` reconstructs in that exact layout.
#[derive(Clone, Copy)]
pub struct Options {
    pub family: Family,
    /// Leaving this unset leads to many duplicate addresses returned.
    /// Node hardcodes to `SOCK_STREAM`.
    /// There don't seem to be any issues in Node's repo about this
    /// So I think it's likely that nobody actually needs `SOCK_DGRAM` as a flag
    /// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/cares_wrap.cc#L1609
    pub socktype: SocketType,
    pub protocol: Protocol,
    pub backend: Backend,
    pub flags: c_int, // AI_* packed flags
}

impl Default for Options {
    fn default() -> Self {
        Self {
            family: Family::Unspecified,
            socktype: SocketType::Stream,
            protocol: Protocol::Unspecified,
            backend: Backend::default(),
            flags: 0,
        }
    }
}

impl Options {
    pub fn to_libc(self) -> Option<sock::addrinfo> {
        if self.family == Family::Unspecified
            && self.socktype == SocketType::Unspecified
            && self.protocol == Protocol::Unspecified
            && self.flags == 0
        {
            return None;
        }

        let mut hints: sock::addrinfo = bun_core::ffi::zeroed();

        hints.ai_family = match self.family {
            Family::Unspecified => 0,
            Family::Inet => sock::AF_INET,
            Family::Inet6 => sock::AF_INET6,
        };
        hints.ai_socktype = self.socktype.to_libc();
        hints.ai_protocol = self.protocol.to_libc();
        hints.ai_flags = self.flags;
        Some(hints)
    }

    /// Reconstructs the packed u64 byte layout for hashing.
    fn to_packed_bytes(self) -> [u8; 8] {
        let low: u8 = (self.family as u8 & 0b11)
            | ((self.socktype as u8 & 0b11) << 2)
            | ((self.protocol as u8 & 0b11) << 4)
            | ((self.backend as u8 & 0b11) << 6);
        let mut out = [0u8; 8];
        out[0] = low;
        out[1..5].copy_from_slice(&(self.flags as u32).to_ne_bytes());
        // out[5..8] is the u24 padding = 0
        out
    }
}

// Only consumed by the *_jsc extension fns; messages come from
// `strum::IntoStaticStr` (variant name == message).
#[derive(Debug, strum::IntoStaticStr)]
pub enum OptionsFromJsError {
    InvalidFamily,
    InvalidSocketType,
    InvalidProtocol,
    InvalidBackend,
    InvalidFlags,
}

bun_core::comptime_string_map! {
    pub static FAMILY_MAP: Family = {
        b"IPv4" => Family::Inet,
        b"IPv6" => Family::Inet6,
        b"ipv4" => Family::Inet,
        b"ipv6" => Family::Inet6,
        b"any"  => Family::Unspecified,
    };
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SocketType {
    Unspecified,
    Stream,
    Dgram,
}

bun_core::comptime_string_map! {
    pub static SOCKET_TYPE_MAP: SocketType = {
        b"stream" => SocketType::Stream,
        b"dgram"  => SocketType::Dgram,
        b"tcp"    => SocketType::Stream,
        b"udp"    => SocketType::Dgram,
    };
}

impl SocketType {
    pub(crate) fn to_libc(self) -> i32 {
        match self {
            SocketType::Unspecified => 0,
            SocketType::Stream => sock::SOCK_STREAM,
            SocketType::Dgram => sock::SOCK_DGRAM,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    Unspecified,
    Tcp,
    Udp,
}

bun_core::comptime_string_map! {
    pub static PROTOCOL_MAP: Protocol = {
        b"tcp" => Protocol::Tcp,
        b"udp" => Protocol::Udp,
    };
}

impl Protocol {
    pub(crate) fn to_libc(self) -> i32 {
        match self {
            Protocol::Unspecified => 0,
            Protocol::Tcp => sock::IPPROTO_TCP,
            Protocol::Udp => sock::IPPROTO_UDP,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    CAres,
    System,
    Libc,
}

bun_core::comptime_string_map! {
    pub static BACKEND_LABEL: Backend = {
        b"c-ares"      => Backend::CAres,
        b"c_ares"      => Backend::CAres,
        b"cares"       => Backend::CAres,
        b"async"       => Backend::CAres,
        b"libc"        => Backend::Libc,
        b"system"      => Backend::System,
        b"getaddrinfo" => Backend::Libc,
    };
}

impl Backend {
    #[cfg(any(target_os = "macos", windows))]
    pub const fn default() -> Backend {
        Backend::System
    }

    // Android: the nameservers are known to netd, which bionic's getaddrinfo asks.
    #[cfg(all(not(any(target_os = "macos", windows)), target_os = "android"))]
    pub const fn default() -> Backend {
        Backend::System
    }

    #[cfg(all(not(any(target_os = "macos", windows)), not(target_os = "android")))]
    pub const fn default() -> Backend {
        Backend::CAres
    }
}

pub type Address = bun_sys::net::Address;

pub struct GetAddrInfoResult {
    pub address: Address,
    pub ttl: u32,
}

pub type ResultList = Vec<GetAddrInfoResult>;

#[cfg(windows)]
impl GetAddrInfoResult {
    /// # Safety
    /// `addrinfo` is an entry of a `getaddrinfo` result.
    pub unsafe fn to_list(addrinfo: &sock::addrinfo) -> ResultList {
        Addresses(Some(addrinfo)).into_list()
    }
}

pub fn address_to_string(address: &Address) -> BunString {
    #[cfg(unix)]
    if let Some(un) = address.as_un() {
        return BunString::clone_latin1(bun_core::slice_as_bytes(&un.sun_path));
    }
    match address.to_socket_addr() {
        Some(SocketAddr::V6(v6)) if v6.scope_id() != 0 => {
            let ip = IpText::new((*v6.ip()).into());
            BunString::create_format(format_args!("{ip}%{}", v6.scope_id()))
        }
        Some(address) => BunString::clone_latin1(&IpText::new(address.ip())),
        None => BunString::EMPTY,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Order — DNS result ordering (verbatim/ipv4first/ipv6first).
//
// Moved down from `bun_runtime::api::dns::Resolver::Order`: `cli`
// (repl_command, Arguments)
// needs `Order::from_string_or_die` to parse `--dns-result-order` before the
// runtime exists. The `toJS` method stays in tier-6 (`bun_runtime::dns_jsc`)
// as an extension; only the pure enum + string parsing live here.
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, Default, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Order {
    #[strum(serialize = "verbatim")]
    #[default]
    Verbatim = 0,
    #[strum(serialize = "ipv4first")]
    Ipv4first = 4,
    #[strum(serialize = "ipv6first")]
    Ipv6first = 6,
}

bun_core::comptime_string_map! {
    pub(crate) static ORDER_MAP: Order = {
        b"verbatim"  => Order::Verbatim,
        b"ipv4first" => Order::Ipv4first,
        b"ipv6first" => Order::Ipv6first,
        b"0"         => Order::Verbatim,
        b"4"         => Order::Ipv4first,
        b"6"         => Order::Ipv6first,
    };
}

impl Order {
    pub fn from_string(order: &[u8]) -> Option<Order> {
        ORDER_MAP.get(order).copied()
    }

    pub fn from_string_or_die(order: &[u8]) -> Order {
        Self::from_string(order).unwrap_or_else(|| {
            bun_core::pretty_errorln!("<r><red>error<r><d>:<r> Invalid DNS result order.");
            bun_core::Global::exit(1)
        })
    }
}

/// A numeric address, or a host name within the RFC 1035 limits made of the bytes
/// `bun_dns_client` allows in one or of non-ASCII bytes (UTF-8 mDNS names).
pub fn is_valid_hostname(name: &[u8]) -> bool {
    let is_hostname_byte = |b: u8| bun_dns_client::is_hostname_byte(b) || !b.is_ascii();
    if name.is_empty() || bun_core::strings::contains_char(name, 0) {
        return false;
    }
    if bun_core::ip_address::to_ip_address(name).is_some() {
        return true;
    }
    let name = name.strip_suffix(b".").unwrap_or(name);
    if name.is_empty() || name.len() > 253 {
        return false;
    }
    bun_core::strings::split(name, b".")
        .all(|label| (1..=63).contains(&label.len()) && label.iter().all(|&b| is_hostname_byte(b)))
}

/// The process-wide DNS
/// cache lives in `bun_runtime` (it owns libinfo/libuv worker threads + JSC
/// stat counters). `bun_install` reaches it via a link-time extern
/// rather than a `bun_runtime` crate dep, which would cycle.
pub mod internal {
    use core::ffi::c_void;

    unsafe extern "Rust" {
        /// `bun.dns.internal.prefetch` — kick off an async DNS resolution for
        /// `(hostname, port)` so the result is cached by the time the connect
        /// path needs it. The resolver/event-loop machinery lives in
        /// `bun_runtime::dns_jsc::internal::prefetch`; lower-tier crates
        /// (`bun_install`) reach it via this link-time extern to avoid a crate
        /// cycle. Defined `#[no_mangle]` in `bun_runtime::dns_jsc`.
        fn __bun_dns_prefetch(loop_: *const c_void, hostname: &[u8], port: u16);
    }

    #[inline]
    pub fn prefetch<L>(loop_: *const L, hostname: &[u8], port: u16) {
        // SAFETY: link-time extern of this signature. The macOS body dereferences
        // `loop_`, for which the one caller passes its live uws loop.
        unsafe { __bun_dns_prefetch(loop_.cast::<c_void>(), hostname, port) }
    }
}
