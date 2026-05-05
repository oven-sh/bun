use core::ffi::c_int;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_str::String as BunString;
use bun_wyhash::Wyhash;

// TODO(port): move to dns_sys / verify libc crate exposes these on all targets
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
    pub fn clone(&self) -> GetAddrInfo {
        GetAddrInfo {
            name: Box::<[u8]>::from(&*self.name),
            port: self.port,
            options: self.options,
        }
    }

    pub fn to_cares(&self) -> bun_c_ares::AddrInfoHints {
        // SAFETY: all-zero is a valid AddrInfoHints (C POD struct)
        let mut hints: bun_c_ares::AddrInfoHints = unsafe { core::mem::zeroed() };

        hints.ai_family = self.options.family.to_libc();
        hints.ai_socktype = self.options.socktype.to_libc();
        hints.ai_protocol = self.options.protocol.to_libc();
        hints.ai_flags = self.options.flags;

        hints
    }

    pub fn hash(&self) -> u64 {
        let mut hasher = Wyhash::init(0);
        // TODO(port): Zig used asBytes(&port) ++ asBytes(&options) where Options is
        // packed struct(u64). Rust Options is not bit-packed; verify hash stability
        // is not load-bearing across process boundaries (it isn't — used for in-memory dedupe).
        hasher.update(&self.port.to_ne_bytes());
        hasher.update(&self.options.to_packed_bytes());
        hasher.update(&self.name);

        hasher.final_()
    }
}

// TODO(port): Zig is `packed struct(u64)` — bit layout: family:2, socktype:2,
// protocol:2, backend:2, flags:32 (std.c.AI), _:24. Represented here as a plain
// struct because every use site reads fields by name; only `hash()` cared about
// the raw bytes (handled via `to_packed_bytes`). Phase B: decide if a true
// `#[repr(transparent)] u64` newtype is needed.
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
    pub flags: c_int, // std.c.AI packed flags
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
    pub fn to_libc(&self) -> Option<libc::addrinfo> {
        if self.family == Family::Unspecified
            && self.socktype == SocketType::Unspecified
            && self.protocol == Protocol::Unspecified
            && self.flags == 0
        {
            return None;
        }

        // SAFETY: all-zero is a valid libc::addrinfo (C POD struct)
        let mut hints: libc::addrinfo = unsafe { core::mem::zeroed() };

        hints.ai_family = self.family.to_libc();
        hints.ai_socktype = self.socktype.to_libc();
        hints.ai_protocol = self.protocol.to_libc();
        hints.ai_flags = self.flags;
        Some(hints)
    }

    /// Reconstructs the Zig `packed struct(u64)` byte layout for hashing.
    fn to_packed_bytes(&self) -> [u8; 8] {
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

// TODO(port): FromJSError types are only consumed by the *_jsc extension fns;
// consider moving these to bun_runtime::dns_jsc in Phase B.
#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum OptionsFromJsError {
    #[error("InvalidFamily")]
    InvalidFamily,
    #[error("InvalidSocketType")]
    InvalidSocketType,
    #[error("InvalidProtocol")]
    InvalidProtocol,
    #[error("InvalidBackend")]
    InvalidBackend,
    #[error("InvalidFlags")]
    InvalidFlags,
    #[error("InvalidOptions")]
    InvalidOptions,
    #[error("JSError")]
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Unspecified,
    Inet,
    Inet6,
    Unix,
}

pub static FAMILY_MAP: phf::Map<&'static [u8], Family> = phf::phf_map! {
    b"IPv4" => Family::Inet,
    b"IPv6" => Family::Inet6,
    b"ipv4" => Family::Inet,
    b"ipv6" => Family::Inet6,
    b"any"  => Family::Unspecified,
};

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum FamilyFromJsError {
    #[error("InvalidFamily")]
    InvalidFamily,
    #[error("JSError")]
}

impl Family {
    pub fn to_libc(self) -> i32 {
        match self {
            Family::Unspecified => 0,
            Family::Inet => libc::AF_INET,
            Family::Inet6 => libc::AF_INET6,
            Family::Unix => libc::AF_UNIX,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SocketType {
    Unspecified,
    Stream,
    Dgram,
}

pub static SOCKET_TYPE_MAP: phf::Map<&'static [u8], SocketType> = phf::phf_map! {
    b"stream" => SocketType::Stream,
    b"dgram"  => SocketType::Dgram,
    b"tcp"    => SocketType::Stream,
    b"udp"    => SocketType::Dgram,
};

impl SocketType {
    pub fn to_libc(self) -> i32 {
        match self {
            SocketType::Unspecified => 0,
            SocketType::Stream => libc::SOCK_STREAM,
            SocketType::Dgram => libc::SOCK_DGRAM,
        }
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum SocketTypeFromJsError {
    #[error("InvalidSocketType")]
    InvalidSocketType,
    #[error("JSError")]
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    Unspecified,
    Tcp,
    Udp,
}

pub static PROTOCOL_MAP: phf::Map<&'static [u8], Protocol> = phf::phf_map! {
    b"tcp" => Protocol::Tcp,
    b"udp" => Protocol::Udp,
};

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ProtocolFromJsError {
    #[error("InvalidProtocol")]
    InvalidProtocol,
    #[error("JSError")]
}

impl Protocol {
    pub fn to_libc(self) -> i32 {
        match self {
            Protocol::Unspecified => 0,
            Protocol::Tcp => libc::IPPROTO_TCP,
            Protocol::Udp => libc::IPPROTO_UDP,
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

pub static BACKEND_LABEL: phf::Map<&'static [u8], Backend> = phf::phf_map! {
    b"c-ares"      => Backend::CAres,
    b"c_ares"      => Backend::CAres,
    b"cares"       => Backend::CAres,
    b"async"       => Backend::CAres,
    b"libc"        => Backend::Libc,
    b"system"      => Backend::System,
    b"getaddrinfo" => Backend::Libc,
};

impl Backend {
    #[cfg(any(target_os = "macos", windows))]
    pub const fn default() -> Backend {
        Backend::System
    }

    // Android: c-ares can't discover nameservers (no /etc/resolv.conf,
    // no JNI for ares_library_init_android). bionic getaddrinfo proxies
    // through netd which knows the real resolvers.
    #[cfg(all(not(any(target_os = "macos", windows)), target_os = "android"))]
    pub const fn default() -> Backend {
        Backend::System
    }

    #[cfg(all(not(any(target_os = "macos", windows)), not(target_os = "android")))]
    pub const fn default() -> Backend {
        Backend::CAres
    }
}

impl Default for Backend {
    fn default() -> Self {
        Backend::default()
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum BackendFromJsError {
    #[error("InvalidBackend")]
    InvalidBackend,
    #[error("JSError")]
}

// TODO(port): std.net.Address — std::net is banned. Need a bun_sys (or bun_net)
// SocketAddress wrapper over libc::sockaddr_storage with .in/.in6/.un views.
pub type Address = bun_sys::net::Address;

pub struct GetAddrInfoResult {
    pub address: Address,
    pub ttl: i32,
}

pub type ResultList = Vec<GetAddrInfoResult>;

pub enum ResultAny {
    Addrinfo(*mut libc::addrinfo),
    List(ResultList),
}

impl Drop for ResultAny {
    fn drop(&mut self) {
        match self {
            ResultAny::Addrinfo(addrinfo) => {
                if !addrinfo.is_null() {
                    // SAFETY: addrinfo was allocated by C getaddrinfo (see LIFETIMES.tsv)
                    unsafe { libc::freeaddrinfo(*addrinfo) };
                }
            }
            ResultAny::List(_list) => {
                // Vec drops itself
            }
        }
    }
}

impl GetAddrInfoResult {
    pub fn to_list(addrinfo: &libc::addrinfo) -> Result<ResultList, AllocError> {
        let mut list = ResultList::with_capacity(addr_info_count(addrinfo) as usize);

        let mut addr: *const libc::addrinfo = addrinfo;
        while !addr.is_null() {
            // SAFETY: addr is non-null, points into the getaddrinfo result chain
            let a = unsafe { &*addr };
            if let Some(r) = Self::from_addr_info(a) {
                // PERF(port): was assume_capacity
                list.push(r);
            }
            addr = a.ai_next;
        }

        Ok(list)
    }

    pub fn from_addr_info(addrinfo: &libc::addrinfo) -> Option<GetAddrInfoResult> {
        let sockaddr = addrinfo.ai_addr;
        if sockaddr.is_null() {
            return None;
        }
        Some(GetAddrInfoResult {
            // SAFETY: ai_addr is non-null and points to a valid sockaddr per getaddrinfo contract
            address: unsafe { Address::init_posix(sockaddr) },
            // no TTL in POSIX getaddrinfo()
            ttl: 0,
        })
    }
}

pub fn address_to_string(address: &Address) -> Result<BunString, AllocError> {
    match address.any().family() {
        f if f == libc::AF_INET => {
            let self_ = address.in_();
            let bytes: [u8; 4] = self_.sa_addr_bytes();
            BunString::create_format(format_args!(
                "{}.{}.{}.{}",
                bytes[0], bytes[1], bytes[2], bytes[3]
            ))
        }
        f if f == libc::AF_INET6 => {
            // PERF(port): was stack-fallback alloc — profile in Phase B
            let mut out: Vec<u8> = Vec::new();
            // TODO(port): std.net.Address Display impl — need bun_sys::net::Address Display
            write!(&mut out, "{}", address).map_err(|_| AllocError)?;
            // TODO: this is a hack, fix it
            // This removes [.*]:port
            //              ^  ^^^^^^
            let port = address.in6().get_port();
            let port_digits = {
                let mut buf: Vec<u8> = Vec::new();
                write!(&mut buf, "{}", port).expect("unreachable");
                buf.len()
            };
            Ok(BunString::clone_latin1(
                &out[1..out.len() - 1 - port_digits - 1],
            ))
        }
        f if f == libc::AF_UNIX => {
            #[cfg(unix)]
            {
                return Ok(BunString::clone_latin1(address.un().path()));
            }
            #[allow(unreachable_code)]
            Ok(BunString::empty())
        }
        _ => Ok(BunString::empty()),
    }
}

pub fn addr_info_count(addrinfo: &libc::addrinfo) -> u32 {
    let mut count: u32 = 1;
    let mut current: *mut libc::addrinfo = addrinfo.ai_next;
    while !current.is_null() {
        // SAFETY: current is non-null, points into the getaddrinfo result chain
        let cur = unsafe { &*current };
        count += (!cur.ai_addr.is_null()) as u32;
        current = cur.ai_next;
    }
    count
}

// ──────────────────────────────────────────────────────────────────────────
// Order — DNS result ordering (verbatim/ipv4first/ipv6first).
//
// Moved down from `bun_runtime::api::dns::Resolver::Order` (src/runtime/
// dns_jsc/dns.zig) per CYCLEBREAK §→dns: `cli` (repl_command, Arguments)
// needs `Order::from_string_or_die` to parse `--dns-result-order` before the
// runtime exists. The `toJS` method stays in tier-6 (`bun_runtime::dns_jsc`)
// as an extension; only the pure enum + string parsing live here.
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Order {
    #[strum(serialize = "verbatim")]
    Verbatim = 0,
    #[strum(serialize = "ipv4first")]
    Ipv4first = 4,
    #[strum(serialize = "ipv6first")]
    Ipv6first = 6,
}

impl Default for Order {
    fn default() -> Self {
        Order::Verbatim
    }
}

pub static ORDER_MAP: phf::Map<&'static [u8], Order> = phf::phf_map! {
    b"verbatim"  => Order::Verbatim,
    b"ipv4first" => Order::Ipv4first,
    b"ipv6first" => Order::Ipv6first,
    b"0"         => Order::Verbatim,
    b"4"         => Order::Ipv4first,
    b"6"         => Order::Ipv6first,
};

impl Order {
    pub const DEFAULT: Self = Order::Verbatim;

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

// TODO(port): `pub const internal = bun.api.dns.internal;` — re-export of
// runtime DNS internals. Phase B: decide crate boundary (likely
// `bun_runtime::api::dns::internal`); omitted here to avoid base→runtime dep.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/dns/dns.zig (296 lines)
//   confidence: medium
//   todos:      7
//   notes:      Options kept as plain struct (not packed u64) w/ to_packed_bytes for hash; std.net.Address needs bun_sys::net wrapper; *_jsc aliases dropped per guide
// ──────────────────────────────────────────────────────────────────────────
