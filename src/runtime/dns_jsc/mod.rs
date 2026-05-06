//! DNS resolver — JSC bindings (`node:dns`, `Bun.dns`).
//!
//! B-2 un-gate: type surface for `Resolver` (the `.classes.ts` payload of
//! `JSDNSResolver`), the per-record-type request structs, and the
//! process-wide `internal` cache used by the usockets connect path. The full
//! Phase-A draft (`dns.rs`, ~4.1k lines) stays gated — it needs the c-ares
//! channel surface, libinfo/libuv backends, and `bun_jsc` host-fn plumbing.

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use bun_collections::HiveArray;

use crate::jsc::{JSGlobalObject, JSValue};
use crate::timer::EventLoopTimer;

// ─── gated Phase-A drafts (preserved on disk, not compiled) ──────────────────

#[path = "dns.rs"]
mod dns_body; // full Phase-A draft of dns.zig (Resolver methods, all backends)

#[path = "cares_jsc.rs"]
pub mod cares_jsc; // c-ares reply struct → JSValue bridges

#[path = "options_jsc.rs"]
pub mod options_jsc; // GetAddrInfo.Options ↔ JSValue

// ─── real type surface (B-2 struct/state un-gate) ────────────────────────────
// Method bodies remain in the gated drafts above — they need:
//   TODO(b2-blocked): bun_cares_sys::{Channel, ChannelOptions, ares_socket_t,
//                     struct_ares_*_reply, struct_hostent, AddrInfo}
//   TODO(b2-blocked): bun_jsc::{host_fn, SystemError method surface}
//   TODO(b2-blocked): bun_aio::FilePoll method surface (register/one-shot)
//   TODO(b2-blocked): bun_sys::{mach_port, windows::libuv}
//   TODO(b2-blocked): bun_dns::get_addr_info::{options::FromJSError, backend::FromJSError}

pub type GetAddrInfoAsyncCallback =
    unsafe extern "C" fn(i32, *mut c_void /* libc::addrinfo */, *mut c_void);

#[cfg(windows)]
pub const INET6_ADDRSTRLEN: usize = 65;
#[cfg(not(windows))]
pub const INET6_ADDRSTRLEN: usize = 46;

pub const IANA_DNS_PORT: i32 = 53;

/// `packed struct(u16)` shared by all request types.
#[repr(transparent)]
#[derive(Copy, Clone, Default)]
pub struct CacheConfig(pub u16);
impl CacheConfig {
    #[inline] pub const fn pending_cache(self) -> bool { self.0 & 0x0001 != 0 }
    #[inline] pub const fn entry_cache(self) -> bool { self.0 & 0x0002 != 0 }
    #[inline] pub const fn pos_in_pending(self) -> u8 { ((self.0 >> 2) & 0x1F) as u8 }
    #[inline] pub const fn name_len(self) -> u16 { (self.0 >> 7) & 0x1FF }
    #[inline]
    pub const fn new(pending_cache: bool, entry_cache: bool, pos_in_pending: u8, name_len: u16) -> Self {
        Self(
            (pending_cache as u16)
                | ((entry_cache as u16) << 1)
                | (((pos_in_pending as u16) & 0x1F) << 2)
                | ((name_len & 0x1FF) << 7),
        )
    }
}

/// Field selector standing in for Zig's `comptime cache_field: []const u8` /
/// `std.meta.FieldEnum(Resolver)`.
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum PendingCacheField {
    PendingHostCacheCares,
    PendingHostCacheNative,
    PendingSrvCacheCares,
    PendingSoaCacheCares,
    PendingTxtCacheCares,
    PendingNaptrCacheCares,
    PendingMxCacheCares,
    PendingCaaCacheCares,
    PendingNsCacheCares,
    PendingPtrCacheCares,
    PendingCnameCacheCares,
    PendingACacheCares,
    PendingAaaaCacheCares,
    PendingAnyCacheCares,
    PendingAddrCacheCares,
    PendingNameinfoCacheCares,
}

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
impl Order {
    pub const DEFAULT: Self = Order::Verbatim;
    pub const MAP: phf::Map<&'static [u8], Order> = phf::phf_map! {
        b"verbatim" => Order::Verbatim,
        b"ipv4first" => Order::Ipv4first,
        b"ipv6first" => Order::Ipv6first,
        b"0" => Order::Verbatim,
        b"4" => Order::Ipv4first,
        b"6" => Order::Ipv6first,
    };
    #[inline]
    pub fn from_string(order: &[u8]) -> Option<Order> {
        Self::MAP.get(order).copied()
    }
}

#[repr(C)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum RecordType {
    A = 1,
    AAAA = 28,
    CAA = 257,
    CNAME = 5,
    MX = 15,
    NS = 2,
    PTR = 12,
    SOA = 6,
    SRV = 33,
    TXT = 16,
    ANY = 255,
}
impl RecordType {
    pub const DEFAULT: Self = RecordType::A;
    pub const MAP: phf::Map<&'static [u8], RecordType> = phf::phf_map! {
        b"A" => RecordType::A, b"AAAA" => RecordType::AAAA, b"ANY" => RecordType::ANY,
        b"CAA" => RecordType::CAA, b"CNAME" => RecordType::CNAME, b"MX" => RecordType::MX,
        b"NS" => RecordType::NS, b"PTR" => RecordType::PTR, b"SOA" => RecordType::SOA,
        b"SRV" => RecordType::SRV, b"TXT" => RecordType::TXT,
        b"a" => RecordType::A, b"aaaa" => RecordType::AAAA, b"any" => RecordType::ANY,
        b"caa" => RecordType::CAA, b"cname" => RecordType::CNAME, b"mx" => RecordType::MX,
        b"ns" => RecordType::NS, b"ptr" => RecordType::PTR, b"soa" => RecordType::SOA,
        b"srv" => RecordType::SRV, b"txt" => RecordType::TXT,
    };
}

// ── request types ────────────────────────────────────────────────────────────
// All `pending_*_cache` fields on `Resolver` are `HiveArray<PendingCacheKey, 32>`.
// The c-ares reply payloads are erased here — `bun_cares_sys` types are not
// reachable from this crate yet, and the only consumers are the gated method
// bodies. Re-type once `bun_cares_sys` is wired.

pub mod get_addr_info_request {
    pub struct PendingCacheKey {
        pub hash: u64,
        pub len: u16,
        pub lookup: *mut super::GetAddrInfoRequest,
    }
}
pub mod resolve_info_request {
    pub struct PendingCacheKey {
        pub hash: u64,
        pub len: u16,
        // TODO(b2-blocked): generic over `T: CAresRecordType` — erased.
        pub lookup: *mut core::ffi::c_void,
    }
}
pub mod get_host_by_addr_info_request {
    pub struct PendingCacheKey {
        pub hash: u64,
        pub len: u16,
        pub lookup: *mut core::ffi::c_void,
    }
}
pub mod get_name_info_request {
    pub struct PendingCacheKey {
        pub hash: u64,
        pub len: u16,
        pub lookup: *mut core::ffi::c_void,
    }
}

pub struct GetAddrInfoRequest {
    pub resolver_for_caching: Option<*mut Resolver>,
    pub hash: u64,
    pub cache: CacheConfig,
    // TODO(b2-blocked): DNSLookup head/tail intrusive list — erased.
    _priv: (),
}

pub type PendingCache = HiveArray<get_addr_info_request::PendingCacheKey, 32>;

pub enum CacheHit {
    Inflight(*mut get_addr_info_request::PendingCacheKey),
    New(*mut get_addr_info_request::PendingCacheKey),
    Disabled,
}

// ── Resolver (`.classes.ts` payload of JSDNSResolver) ────────────────────────

/// Per-VM `dns.Resolver`. Full method surface (resolve/reverse/getServers/
/// setServers/cancel, c-ares socket polling, libinfo/libuv getaddrinfo
/// dispatch) lives in the gated `dns.rs` draft.
pub struct Resolver {
    // bun.ptr.RefCount(@This(), "ref_count", deinit, .{})
    // TODO(b2-blocked): bun_ptr::IntrusiveRcField — erased.
    pub ref_count: core::cell::Cell<u32>,
    // TODO(b2-blocked): bun_cares_sys::{Channel, ChannelOptions} — erased.
    pub channel: Option<*mut c_void>,
    // TODO(port): lifetime — JSC_BORROW; raw ptr until &'static lands.
    pub vm: *mut c_void,
    // TODO(b2-blocked): ArrayHashMap<ares_socket_t, *mut PollType> — erased.
    pub polls: (),
    pub options: (),

    pub event_loop_timer: EventLoopTimer,

    pub pending_host_cache_cares: PendingCache,
    pub pending_host_cache_native: PendingCache,
    // Per-record-type caches collapsed to the erased `resolve_info_request::PendingCacheKey`
    // until `bun_cares_sys` reply structs are reachable.
    pub pending_srv_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_soa_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_txt_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_naptr_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_mx_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_caa_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_ns_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_ptr_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_cname_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_a_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_aaaa_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_any_cache_cares: HiveArray<resolve_info_request::PendingCacheKey, 32>,
    pub pending_addr_cache_cares: HiveArray<get_host_by_addr_info_request::PendingCacheKey, 32>,
    pub pending_nameinfo_cache_cares: HiveArray<get_name_info_request::PendingCacheKey, 32>,
}

impl Resolver {
    /// Spec dns.zig `onDNSPoll` — drive `ares_process_fd` for the readable
    /// socket behind `poll`. Body lives in the gated `dns_body` draft.
    pub fn on_dns_poll(&mut self, _poll: &mut bun_aio::posix_event_loop::FilePoll) {
        todo!("blocked_on: crate::dns_jsc::dns_body::Resolver::on_dns_poll")
    }

    /// Spec dns.zig `checkTimeouts` — `ares_process_fd(ARES_SOCKET_BAD, …)`
    /// to time out stale queries, then reschedule. Body in gated `dns_body`.
    pub fn check_timeouts(
        &mut self,
        _now: &bun_event_loop::EventLoopTimer::Timespec,
        _vm: &bun_jsc::VirtualMachine,
    ) {
        todo!("blocked_on: crate::dns_jsc::dns_body::Resolver::check_timeouts")
    }
}

pub struct GlobalData {
    pub resolver: Resolver,
}

// ── internal — process-wide DNS cache used by the usockets connect path ──────
pub mod internal {
    use super::*;

    /// Crosses FFI to usockets via `Bun__addrinfo_getRequestResult` — layout
    /// MUST match Zig's `extern struct { info: ?[*]ResultEntry, err: c_int }`.
    #[repr(C)]
    pub struct RequestResult {
        pub info: Option<NonNull<ResultEntry>>,
        pub err: c_int,
    }

    #[repr(C)]
    pub struct ResultEntry {
        // TODO(b2-blocked): libc::{addrinfo, sockaddr_storage} — sized opaque
        // until libc layout is verified cross-platform from this crate.
        _info: [u8; 48],
        _addr: [u8; 128],
    }

    pub struct RequestKeyOwned {
        pub host: Option<Box<[u8]>>,
        pub port: u16,
        pub hash: u64,
    }

    pub enum DNSRequestOwner {
        // `bun.uws.ConnectingSocket*` — usockets connect-path consumer.
        Socket(*mut c_void),
        // `*bun.uws.Loop` — `Bun.dns.prefetch()` consumer.
        Prefetch(*mut c_void),
        // `*bun.http.H3.PendingConnect` — QUIC connect-path consumer.
        Quic(*mut c_void),
    }

    pub struct Request {
        pub key: RequestKeyOwned,
        pub result: Option<RequestResult>,
        pub notify: Vec<DNSRequestOwner>,
        /// Number of sockets that have a reference to result or are waiting
        /// for it. While non-zero, this entry cannot be freed.
        pub refcount: u32,
        /// Seconds since the epoch when this request was created.
        pub created_at: u32,
        pub valid: bool,
        // TODO(b2-blocked): MacAsyncDNS { FilePoll, mach_port } — erased.
        pub libinfo: (),
        pub can_retry_for_addrconfig: bool,
    }
}
pub use internal::Request as InternalDNSRequest;
