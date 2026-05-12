#![allow(unused, clippy::all)]
#![warn(unused_must_use)]

use core::ffi::c_int;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_core::String as BunString;
// Zig used `std.hash.Wyhash`; bun_wyhash exports `Wyhash11` (same iterative
// init/update/final_ surface). Hash is in-memory dedupe only — algorithm
// identity is not load-bearing.
use bun_wyhash::Wyhash11 as Wyhash;

// `libc` does not expose winsock types/constants on Windows; route every
// `libc::AF_*` / `addrinfo` / `sockaddr_*` reference through this shim so
// the body of this crate stays cfg-free.
#[cfg(not(windows))]
mod sock {
    pub use libc::{
        AF_INET, AF_INET6, AF_UNIX, IPPROTO_TCP, IPPROTO_UDP, SOCK_DGRAM, SOCK_STREAM, addrinfo,
        freeaddrinfo, in6_addr, sockaddr_in, sockaddr_in6, sockaddr_un,
    };
}
#[cfg(windows)]
mod sock {
    pub use bun_windows_sys::ws2_32::{
        AF_INET, AF_INET6, AF_UNIX, IPPROTO_TCP, IPPROTO_UDP, SOCK_DGRAM, SOCK_STREAM, addrinfo,
        freeaddrinfo, in6_addr, sockaddr_in, sockaddr_in6,
    };
    // Windows SDK ships <afunix.h> (SOCKADDR_UN) since win10_rs4 but neither
    // windows-sys nor bun_windows_sys export it. Mirror the on-the-wire layout
    // here so address_to_string stays cfg-free below — matches Zig std's
    // `std.os.windows.ws2_32.sockaddr_un { family: u16, path: [108]u8 }`.
    #[repr(C)]
    pub struct sockaddr_un {
        pub sun_family: u16,
        pub sun_path: [u8; 108],
    }
}

// Re-export the cfg-dispatched addrinfo type + matching free so callers don't
// duplicate the POSIX/Windows split (see dns_jsc::dns).
pub use sock::{addrinfo, freeaddrinfo};

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

    pub fn to_cares(&self) -> bun_cares_sys::c_ares_draft::AddrInfo_hints {
        let mut hints: bun_cares_sys::c_ares_draft::AddrInfo_hints = bun_core::ffi::zeroed();

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
    pub fn to_libc(&self) -> Option<sock::addrinfo> {
        if self.family == Family::Unspecified
            && self.socktype == SocketType::Unspecified
            && self.protocol == Protocol::Unspecified
            && self.flags == 0
        {
            return None;
        }

        let mut hints: sock::addrinfo = bun_core::ffi::zeroed();

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
// TODO(b1): thiserror not in deps — dropped Error derive
#[derive(Debug, strum::IntoStaticStr)]
pub enum OptionsFromJsError {
    //     #[error("InvalidFamily")]
    InvalidFamily,
    //     #[error("InvalidSocketType")]
    InvalidSocketType,
    //     #[error("InvalidProtocol")]
    InvalidProtocol,
    //     #[error("InvalidBackend")]
    InvalidBackend,
    //     #[error("InvalidFlags")]
    InvalidFlags,
    //     #[error("InvalidOptions")]
    InvalidOptions,
    //     #[error("JSError")]
    JSError,
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

impl Family {
    pub fn to_libc(self) -> i32 {
        match self {
            Family::Unspecified => 0,
            Family::Inet => sock::AF_INET,
            Family::Inet6 => sock::AF_INET6,
            Family::Unix => sock::AF_UNIX,
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

pub static PROTOCOL_MAP: phf::Map<&'static [u8], Protocol> = phf::phf_map! {
    b"tcp" => Protocol::Tcp,
    b"udp" => Protocol::Udp,
};

impl Protocol {
    pub fn to_libc(self) -> i32 {
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

// TODO(port): std.net.Address — std::net is banned. `bun_sys::net::Address`
// wraps `libc::sockaddr_storage`; `.in/.in6` views go through the typed
// `as_in4()`/`as_in6()` accessors. `.un` still casts on `as_sockaddr()`.
pub type Address = bun_sys::net::Address;

pub struct GetAddrInfoResult {
    pub address: Address,
    pub ttl: i32,
}

pub type ResultList = Vec<GetAddrInfoResult>;

pub enum ResultAny {
    Addrinfo(*mut sock::addrinfo),
    List(ResultList),
}

impl Drop for ResultAny {
    fn drop(&mut self) {
        match self {
            ResultAny::Addrinfo(addrinfo) => {
                if !addrinfo.is_null() {
                    // SAFETY: addrinfo was allocated by C getaddrinfo (see LIFETIMES.tsv)
                    unsafe { sock::freeaddrinfo(*addrinfo) };
                }
            }
            ResultAny::List(_list) => {
                // Vec drops itself
            }
        }
    }
}

impl GetAddrInfoResult {
    pub fn to_list(addrinfo: &sock::addrinfo) -> Result<ResultList, AllocError> {
        let mut list = ResultList::with_capacity(addr_info_count(addrinfo) as usize);

        let mut addr: *const sock::addrinfo = addrinfo;
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

    pub fn from_addr_info(addrinfo: &sock::addrinfo) -> Option<GetAddrInfoResult> {
        let sockaddr = addrinfo.ai_addr;
        if sockaddr.is_null() {
            return None;
        }
        Some(GetAddrInfoResult {
            // SAFETY: `ai_addr` is non-null and points to a valid sockaddr per
            // getaddrinfo's contract. `.cast()` erases the nominal-type
            // mismatch on Windows (ws2_32::sockaddr ↔ the libuv-sys mirror
            // `bun_sys::posix::sockaddr` routes to) — both are the 16-byte
            // ws2def.h `SOCKADDR`.
            address: unsafe { Address::init_posix(sockaddr.cast()) },
            // no TTL in POSIX getaddrinfo()
            ttl: 0,
        })
    }
}

pub fn address_to_string(address: &Address) -> Result<BunString, AllocError> {
    // PORT NOTE: reshaped — bun_sys::net::Address exposes family()/as_in4()/
    // as_in6() rather than .in/.in6/.un union views.
    match address.family() {
        sock::AF_INET => {
            let v4 = address.as_in4().unwrap(); // family() just checked
            let bytes: [u8; 4] = v4.sin_addr.s_addr.to_ne_bytes();
            Ok(BunString::create_format(format_args!(
                "{}.{}.{}.{}",
                bytes[0], bytes[1], bytes[2], bytes[3]
            )))
        }
        sock::AF_INET6 => {
            let v6 = address.as_in6().unwrap(); // family() just checked
            // PERF(port): was stack-fallback alloc — profile in Phase B
            // PORT NOTE: Zig formatted via std.net.Address Display ("[addr%scope]:port")
            // then sliced the brackets/port off ("TODO: this is a hack"). Here we
            // render the bare address directly via ares_inet_ntop, then re-append
            // the `%scope_id` suffix that std.net.Ip6Address.format emits for
            // nonzero scope (e.g. fe80:: link-local from getaddrinfo) — ntop
            // only sees the 16 raw addr bytes and cannot emit it itself.
            let mut buf = [0u8; 64]; // >= INET6_ADDRSTRLEN (46) + "%4294967295" (11)
            // SAFETY: sin6_addr is a valid in6_addr; buf len fits INET6_ADDRSTRLEN.
            let n = match unsafe {
                bun_cares_sys::ntop(sock::AF_INET6, (&raw const v6.sin6_addr).cast(), &mut buf)
            } {
                Some(s) => s.len(),
                None => return Ok(BunString::EMPTY),
            };
            let len = if v6.sin6_scope_id != 0 {
                let mut cursor = &mut buf[n..];
                let before = cursor.len();
                // 64 - 46 = 18 > len("%4294967295") = 11, cannot truncate.
                let _ = write!(cursor, "%{}", v6.sin6_scope_id);
                n + (before - cursor.len())
            } else {
                n
            };
            Ok(BunString::clone_latin1(&buf[..len]))
        }
        sock::AF_UNIX => {
            // Zig spec gates this on `comptime std.net.has_unix_sockets`, which is
            // true on every target Bun ships (Windows 10 rs4+ included), so no cfg.
            // SAFETY: family() == AF_UNIX; sockaddr_storage is >= sizeof(sockaddr_un).
            let un = unsafe { &*address.as_sockaddr().cast::<sock::sockaddr_un>() };
            // SAFETY: reinterpreting [c_char; N] as [u8; N] (same size/align).
            let path: &[u8] = unsafe {
                core::slice::from_raw_parts(un.sun_path.as_ptr().cast::<u8>(), un.sun_path.len())
            };
            Ok(BunString::clone_latin1(path))
        }
        _ => Ok(BunString::EMPTY),
    }
}

pub fn addr_info_count(addrinfo: &sock::addrinfo) -> u32 {
    let mut count: u32 = 1;
    let mut current: *mut sock::addrinfo = addrinfo.ai_next;
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
// dns_jsc/dns.zig): `cli` (repl_command, Arguments)
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

/// Zig: `pub const internal = bun.api.dns.internal;` — the process-wide DNS
/// cache lives in `bun_runtime` (it owns libinfo/libuv worker threads + JSC
/// stat counters). Lower-tier crates (`bun_http`, `bun_install`) reach it via
/// the link-time `Bun__addrinfo_*` family — same mechanism usockets C uses —
/// rather than a `bun_runtime` crate dep, which would cycle.
pub mod internal {
    use core::ffi::c_void;

    unsafe extern "C" {
        // Defined in `bun_runtime::dns_jsc::internal` alongside the other
        // `Bun__addrinfo_*` exports; resolved at link time.
        fn Bun__addrinfo_registerQuic(request: *mut c_void, pc: *mut c_void);
    }

    unsafe extern "Rust" {
        /// `bun.dns.internal.prefetch` — kick off an async DNS resolution for
        /// `(hostname, port)` so the result is cached by the time the connect
        /// path needs it. The resolver/event-loop machinery lives in
        /// `bun_runtime::dns_jsc::internal::prefetch`; lower-tier crates
        /// (`bun_install`) reach it via this link-time extern to avoid a crate
        /// cycle. Defined `#[no_mangle]` in `bun_runtime::dns_jsc`.
        fn __bun_dns_prefetch(loop_: *mut c_void, hostname: *const u8, len: usize, port: u16);
    }

    #[inline]
    pub fn prefetch<L>(loop_: *mut L, hostname: &[u8], port: u16) {
        // SAFETY: link-time extern; `hostname` is NUL-terminated and live for
        // the call. Prefetch is a perf hint — the body short-circuits if no
        // resolver is available.
        unsafe {
            __bun_dns_prefetch(
                loop_.cast::<c_void>(),
                hostname.as_ptr(),
                hostname.len(),
                port,
            )
        }
    }

    /// Register `pc` to be notified when the addrinfo `request` resolves.
    /// Mirrors `us_getaddrinfo_set` for the QUIC client connect path, which
    /// has no `us_connecting_socket_t` to hang the callback on.
    ///
    /// SAFETY: `request` must be the live addrinfo request handle returned by
    /// `us_quic_pending_connect_addrinfo`; `pc` must be a live
    /// `bun_http::H3::PendingConnect` that stays valid until its
    /// `on_dns_resolved[_threadsafe]` fires.
    #[inline]
    pub unsafe fn register_quic(request: *mut c_void, pc: *mut c_void) {
        // SAFETY: forwarded to the runtime export; both pointers are opaque on
        // this side of the crate boundary and re-typed by the callee.
        unsafe { Bun__addrinfo_registerQuic(request, pc) }
    }
}

// ported from: src/dns/dns.zig
