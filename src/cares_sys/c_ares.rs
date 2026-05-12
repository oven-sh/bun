#![allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    clippy::missing_safety_doc
)]

use core::ffi::{c_char, c_int, c_long, c_short, c_uint, c_ushort, c_void};
use core::ptr;

#[cfg(windows)]
use crate::winsock::{iovec, sockaddr, sockaddr_in, sockaddr_in6, socklen_t, timeval};
#[cfg(not(windows))]
use libc::{iovec, sockaddr, sockaddr_in, sockaddr_in6, socklen_t, timeval};

pub type ares_socklen_t = socklen_t;
pub type ares_ssize_t = isize;

#[cfg(windows)]
pub type ares_socket_t = usize; // Windows `SOCKET` is `UINT_PTR` (integer, not a pointer).
#[cfg(not(windows))]
pub type ares_socket_t = c_int;

pub type ares_sock_state_cb =
    Option<unsafe extern "C" fn(*mut c_void, ares_socket_t, c_int, c_int)>;

bun_opaque::opaque_ffi! {
    /// Nomicon opaque-FFI pattern. `UnsafeCell` makes the type `!Freeze` so a
    /// shared reference does not assert immutability of the C-owned state.
    pub struct struct_apattern;
}

/// Mirror of `std.posix.AF` in Zig — only the address families c-ares
/// actually uses. Kept local so this `*_sys` crate stays leaf-level
/// (no dependency on `bun_sys`). Canonical: `bun_sys::posix::AF`.
pub mod AF {
    use core::ffi::c_int;
    // `libc` does not expose AF_* on Windows MSVC; ws2def.h values are inlined
    // there. Non-Windows targets keep the platform `libc` constants — `AF_INET6`
    // is NOT portable (10 on Linux, 30 on macOS/BSD).
    #[cfg(windows)]
    pub const INET: c_int = 2;
    #[cfg(windows)]
    pub const INET6: c_int = 23;
    #[cfg(not(windows))]
    pub const INET: c_int = libc::AF_INET;
    #[cfg(not(windows))]
    pub const INET6: c_int = libc::AF_INET6;
}

/// Mirror of `std.posix.system.EAI` in Zig. The `libc` crate is missing
/// `EAI_ADDRFAMILY` and the glibc-only async-getaddrinfo extensions, so we
/// hardcode those raw values from `<netdb.h>`.
#[cfg(not(windows))]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct EAI(c_int);

#[cfg(not(windows))]
impl EAI {
    #[inline]
    pub const fn from_raw(rc: i32) -> Self {
        Self(rc as c_int)
    }

    #[cfg(target_os = "linux")]
    pub const ADDRFAMILY: Self = Self(-9);
    #[cfg(not(target_os = "linux"))]
    pub const ADDRFAMILY: Self = Self(1);

    pub const BADFLAGS: Self = Self(libc::EAI_BADFLAGS);
    pub const FAIL: Self = Self(libc::EAI_FAIL);
    pub const FAMILY: Self = Self(libc::EAI_FAMILY);
    pub const MEMORY: Self = Self(libc::EAI_MEMORY);
    // RFC 3493 dropped EAI_NODATA; FreeBSD's <netdb.h> only exposes it under
    // __BSD_VISIBLE (historical value 7) and the libc crate omits it entirely.
    #[cfg(not(any(target_os = "freebsd", target_os = "dragonfly")))]
    pub const NODATA: Self = Self(libc::EAI_NODATA);
    #[cfg(any(target_os = "freebsd", target_os = "dragonfly"))]
    pub const NODATA: Self = Self(7);
    pub const NONAME: Self = Self(libc::EAI_NONAME);
    pub const SERVICE: Self = Self(libc::EAI_SERVICE);
    pub const SOCKTYPE: Self = Self(libc::EAI_SOCKTYPE);
    pub const SYSTEM: Self = Self(libc::EAI_SYSTEM);

    // glibc-only `getaddrinfo_a` / IDN extensions (absent on musl, bionic).
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub const INPROGRESS: Self = Self(-100);
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub const CANCELED: Self = Self(-101);
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub const NOTCANCELED: Self = Self(-102);
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub const ALLDONE: Self = Self(-103);
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub const IDN_ENCODE: Self = Self(-105);
}

#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum NSClass {
    /// Cookie.
    ns_c_invalid = 0,
    /// Internet.
    ns_c_in = 1,
    /// unallocated/unsupported.
    ns_c_2 = 2,
    /// MIT Chaos-net.
    ns_c_chaos = 3,
    /// MIT Hesiod.
    ns_c_hs = 4,
    /// Query class values which do not appear in resource records
    /// for prereq. sections in update requests
    ns_c_none = 254,
    /// Wildcard match.
    ns_c_any = 255,
    ns_c_max = 65536,
}

// Zig: `enum(c_int) { ..., _ }` (non-exhaustive). Values are only ever
// constructed in Rust and passed *to* C, so a plain repr(i32) enum is sound.
// TODO(port): if c-ares ever returns an NSType, switch to a transparent newtype.
#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum NSType {
    /// Cookie.
    ns_t_invalid = 0,
    /// Host address.
    ns_t_a = 1,
    /// Authoritative server.
    ns_t_ns = 2,
    /// Mail destination.
    ns_t_md = 3,
    /// Mail forwarder.
    ns_t_mf = 4,
    /// Canonical name.
    ns_t_cname = 5,
    /// Start of authority zone.
    ns_t_soa = 6,
    /// Mailbox domain name.
    ns_t_mb = 7,
    /// Mail group member.
    ns_t_mg = 8,
    /// Mail rename name.
    ns_t_mr = 9,
    /// Null resource record.
    ns_t_null = 10,
    /// Well known service.
    ns_t_wks = 11,
    /// Domain name pointer.
    ns_t_ptr = 12,
    /// Host information.
    ns_t_hinfo = 13,
    /// Mailbox information.
    ns_t_minfo = 14,
    /// Mail routing information.
    ns_t_mx = 15,
    /// Text strings.
    ns_t_txt = 16,
    /// Responsible person.
    ns_t_rp = 17,
    /// AFS cell database.
    ns_t_afsdb = 18,
    /// X_25 calling address.
    ns_t_x25 = 19,
    /// ISDN calling address.
    ns_t_isdn = 20,
    /// Router.
    ns_t_rt = 21,
    /// NSAP address.
    ns_t_nsap = 22,
    /// Reverse NSAP lookup (deprecated).
    ns_t_nsap_ptr = 23,
    /// Security signature.
    ns_t_sig = 24,
    /// Security key.
    ns_t_key = 25,
    /// X.400 mail mapping.
    ns_t_px = 26,
    /// Geographical position (withdrawn).
    ns_t_gpos = 27,
    /// Ip6 Address.
    ns_t_aaaa = 28,
    /// Location Information.
    ns_t_loc = 29,
    /// Next domain (security).
    ns_t_nxt = 30,
    /// Endpoint identifier.
    ns_t_eid = 31,
    /// Nimrod Locator.
    ns_t_nimloc = 32,
    /// Server Selection.
    ns_t_srv = 33,
    /// ATM Address
    ns_t_atma = 34,
    /// Naming Authority PoinTeR
    ns_t_naptr = 35,
    /// Key Exchange
    ns_t_kx = 36,
    /// Certification record
    ns_t_cert = 37,
    /// IPv6 address (deprecates AAAA)
    ns_t_a6 = 38,
    /// Non-terminal DNAME (for IPv6)
    ns_t_dname = 39,
    /// Kitchen sink (experimentatl)
    ns_t_sink = 40,
    /// EDNS0 option (meta-RR)
    ns_t_opt = 41,
    /// Address prefix list (RFC3123)
    ns_t_apl = 42,
    /// Delegation Signer (RFC4034)
    ns_t_ds = 43,
    /// SSH Key Fingerprint (RFC4255)
    ns_t_sshfp = 44,
    /// Resource Record Signature (RFC4034)
    ns_t_rrsig = 46,
    /// Next Secure (RFC4034)
    ns_t_nsec = 47,
    /// DNS Public Key (RFC4034)
    ns_t_dnskey = 48,
    /// Transaction key
    ns_t_tkey = 249,
    /// Transaction signature.
    ns_t_tsig = 250,
    /// Incremental zone transfer.
    ns_t_ixfr = 251,
    /// Transfer zone of authority.
    ns_t_axfr = 252,
    /// Transfer mailbox records.
    ns_t_mailb = 253,
    /// Transfer mail agent records.
    ns_t_maila = 254,
    /// Wildcard match.
    ns_t_any = 255,
    /// Uniform Resource Identifier (RFC7553)
    ns_t_uri = 256,
    /// Certification Authority Authorization.
    ns_t_caa = 257,
    ns_t_max = 65536,
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct struct_ares_server_failover_options {
    pub retry_chance: c_ushort,
    pub retry_delay: usize,
}

const ARES_EVSYS_DEFAULT: c_int = 0;
const ARES_EVSYS_WIN32: c_int = 1;
const ARES_EVSYS_EPOLL: c_int = 2;
const ARES_EVSYS_KQUEUE: c_int = 3;
const ARES_EVSYS_POLL: c_int = 4;
const ARES_EVSYS_SELECT: c_int = 5;
type ares_evsys_t = c_uint;

#[repr(C)]
pub struct Options {
    pub flags: c_int,
    pub timeout: c_int,
    pub tries: c_int,
    pub ndots: c_int,
    pub udp_port: c_ushort,
    pub tcp_port: c_ushort,
    pub socket_send_buffer_size: c_int,
    pub socket_receive_buffer_size: c_int,
    pub servers: *mut in_addr,
    pub nservers: c_int,
    pub domains: *mut *mut c_char,
    pub ndomains: c_int,
    pub lookups: *mut c_char,
    pub sock_state_cb: ares_sock_state_cb,
    pub sock_state_cb_data: *mut c_void,
    pub sortlist: *mut struct_apattern,
    pub nsort: c_int,
    pub ednspsz: c_int,
    pub resolvconf_path: *mut c_char,
    pub hosts_path: *mut c_char,
    pub udp_max_queries: c_int,
    pub maxtimeout: c_int,
    pub qcache_max_ttl: c_uint,
    pub evsys: ares_evsys_t,
    pub server_failover_opts: struct_ares_server_failover_options,
}

// SAFETY: `#[repr(C)]` POD — every field is an integer, raw pointer, or
// `Option<extern fn>`; all-zero is the documented "no options set" state
// passed to `ares_init_options` (S021).
unsafe impl bun_core::ffi::Zeroable for Options {}
impl Default for Options {
    fn default() -> Self {
        bun_core::ffi::zeroed()
    }
}

// hostent in glibc uses int for h_addrtype and h_length, whereas hostent in
// winsock2.h uses short.
#[cfg(windows)]
pub type hostent_int = c_short;
#[cfg(not(windows))]
pub type hostent_int = c_int;

#[repr(C)]
pub struct struct_hostent {
    pub h_name: *mut c_char,
    pub h_aliases: *mut *mut c_char, // NUL-terminated array of NUL-terminated strings
    pub h_addrtype: hostent_int,
    pub h_length: hostent_int,
    pub h_addr_list: *mut *mut c_char, // NUL-terminated array
}

// ─── callback-wrapper reshaping note ──────────────────────────────────────
// Zig: each reply type defines
//   pub fn Callback(comptime Type) type = fn(*Type, ?Error, i32, ?*Reply) void
//   pub fn callbackWrapper(comptime lookup_name, comptime Type, comptime fn) ares_callback
// which monomorphizes a unique `extern "C"` thunk per (Type, fn) pair via the
// anonymous-struct trick. Rust cannot take a fn pointer as a const generic on
// stable, so the wrappers below are reshaped to a trait: the implementing
// type provides the callback as a trait method, and the `extern "C"` thunk is
// monomorphized per `T: Trait`.
// TODO(port): revisit in Phase B once the dns_jsc consumer is ported — a
// proc-macro may be cleaner if many callsites need distinct callbacks on the
// same `Type`.
// ──────────────────────────────────────────────────────────────────────────

pub trait HostentHandler: Sized {
    fn on_hostent(&mut self, status: Option<Error>, timeouts: i32, results: *mut struct_hostent);
}

impl struct_hostent {
    // toJSResponse alias deleted — lives in bun_runtime::dns_jsc (extension trait).

    pub unsafe extern "C" fn host_callback_wrapper<T: HostentHandler>(
        ctx: *mut c_void,
        status: c_int,
        timeouts: c_int,
        hostent: *mut struct_hostent,
    ) {
        // SAFETY: ctx was passed as `*mut T` to the ares call that registered this thunk.
        let this = unsafe { bun_core::callback_ctx::<T>(ctx) };
        if status != ARES_SUCCESS {
            this.on_hostent(Error::get(status), timeouts, ptr::null_mut());
            return;
        }
        this.on_hostent(None, timeouts, hostent);
    }

    // Zig branched on `comptime lookup_name`; split into one thunk per name.
    pub unsafe extern "C" fn callback_wrapper_cname<T: HostentHandler>(
        ctx: *mut c_void,
        status: c_int,
        timeouts: c_int,
        buffer: *mut u8,
        buffer_length: c_int,
    ) {
        // SAFETY: ctx was passed as *mut T to the ares call that registered this thunk.
        let this = unsafe { bun_core::callback_ctx::<T>(ctx) };
        if status != ARES_SUCCESS {
            this.on_hostent(Error::get(status), timeouts, ptr::null_mut());
            return;
        }
        let mut start: *mut struct_hostent = ptr::null_mut();
        let mut addrttls = [struct_ares_addrttl::default(); 256];
        let mut naddrttls: i32 = 256;
        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        let result = unsafe {
            ares_parse_a_reply(
                buffer,
                buffer_length,
                &raw mut start,
                addrttls.as_mut_ptr(),
                &raw mut naddrttls,
            )
        };
        if result != ARES_SUCCESS {
            this.on_hostent(Error::get(result), timeouts, ptr::null_mut());
            return;
        }
        this.on_hostent(None, timeouts, start);
    }

    pub unsafe extern "C" fn callback_wrapper_ns<T: HostentHandler>(
        ctx: *mut c_void,
        status: c_int,
        timeouts: c_int,
        buffer: *mut u8,
        buffer_length: c_int,
    ) {
        // SAFETY: ctx was passed as *mut T to the ares call that registered this thunk.
        let this = unsafe { bun_core::callback_ctx::<T>(ctx) };
        if status != ARES_SUCCESS {
            this.on_hostent(Error::get(status), timeouts, ptr::null_mut());
            return;
        }
        let mut start: *mut struct_hostent = ptr::null_mut();
        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        let result = unsafe { ares_parse_ns_reply(buffer, buffer_length, &raw mut start) };
        if result != ARES_SUCCESS {
            this.on_hostent(Error::get(result), timeouts, ptr::null_mut());
            return;
        }
        this.on_hostent(None, timeouts, start);
    }

    pub unsafe extern "C" fn callback_wrapper_ptr<T: HostentHandler>(
        ctx: *mut c_void,
        status: c_int,
        timeouts: c_int,
        buffer: *mut u8,
        buffer_length: c_int,
    ) {
        // SAFETY: ctx was passed as *mut T to the ares call that registered this thunk.
        let this = unsafe { bun_core::callback_ctx::<T>(ctx) };
        if status != ARES_SUCCESS {
            this.on_hostent(Error::get(status), timeouts, ptr::null_mut());
            return;
        }
        let mut start: *mut struct_hostent = ptr::null_mut();
        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        let result = unsafe {
            ares_parse_ptr_reply(
                buffer,
                buffer_length,
                ptr::null(),
                0,
                AF::INET,
                &raw mut start,
            )
        };
        if result != ARES_SUCCESS {
            this.on_hostent(Error::get(result), timeouts, ptr::null_mut());
            return;
        }
        this.on_hostent(None, timeouts, start);
    }

    /// FFI destroy — frees a c-ares-allocated hostent.
    pub unsafe fn destroy(this: *mut struct_hostent) {
        unsafe { ares_free_hostent(this) };
    }
}

pub struct hostent_with_ttls {
    pub hostent: *mut struct_hostent,
    pub ttls: [c_int; 256],
}

impl Default for hostent_with_ttls {
    fn default() -> Self {
        Self {
            hostent: ptr::null_mut(),
            ttls: [-1; 256],
        }
    }
}

pub trait HostentWithTtlsHandler: Sized {
    /// `hostent_with_ttls::parse_a` or `parse_aaaa` — selects the c-ares reply
    /// parser for [`hostent_with_ttls::callback_wrapper`]. Mirrors the Zig
    /// `callbackWrapper(comptime lookup_name, ...)` parameterization.
    const PARSE: fn(*mut u8, c_int) -> Result<Box<hostent_with_ttls>, Error>;

    fn on_hostent_with_ttls(
        &mut self,
        status: Option<Error>,
        timeouts: i32,
        results: Option<Box<hostent_with_ttls>>,
    );
}

impl hostent_with_ttls {
    // toJSResponse alias deleted — lives in bun_runtime::dns_jsc.

    pub unsafe extern "C" fn host_callback_wrapper<T: HostentWithTtlsHandler>(
        ctx: *mut c_void,
        status: c_int,
        timeouts: c_int,
        hostent: Option<Box<hostent_with_ttls>>,
    ) {
        // TODO(port): Zig declared this as `ares_host_callback` (4th arg
        // `?*hostent_with_ttls`) but that signature mismatches the C
        // `ares_host_callback` (`?*struct_hostent`). Appears unused; verify.
        // SAFETY: ctx was passed as *mut T to the ares call that registered this thunk.
        let this = unsafe { bun_core::callback_ctx::<T>(ctx) };
        if status != ARES_SUCCESS {
            this.on_hostent_with_ttls(Error::get(status), timeouts, None);
            return;
        }
        this.on_hostent_with_ttls(None, timeouts, hostent);
    }

    pub unsafe extern "C" fn callback_wrapper<T: HostentWithTtlsHandler>(
        ctx: *mut c_void,
        status: c_int,
        timeouts: c_int,
        buffer: *mut u8,
        buffer_length: c_int,
    ) {
        // SAFETY: ctx was passed as *mut T to the ares call that registered this thunk.
        let this = unsafe { bun_core::callback_ctx::<T>(ctx) };
        if status != ARES_SUCCESS {
            this.on_hostent_with_ttls(Error::get(status), timeouts, None);
            return;
        }
        match T::PARSE(buffer, buffer_length) {
            Ok(result) => this.on_hostent_with_ttls(None, timeouts, Some(result)),
            Err(err) => this.on_hostent_with_ttls(Some(err), timeouts, None),
        }
    }

    pub fn parse_a(buffer: *mut u8, buffer_length: c_int) -> Result<Box<hostent_with_ttls>, Error> {
        let mut start: *mut struct_hostent = ptr::null_mut();
        let mut addrttls = [struct_ares_addrttl::default(); 256];
        let mut naddrttls: c_int = 256;
        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        let result = unsafe {
            ares_parse_a_reply(
                buffer,
                buffer_length,
                &raw mut start,
                addrttls.as_mut_ptr(),
                &raw mut naddrttls,
            )
        };
        if result != ARES_SUCCESS {
            return Err(Error::get(result).unwrap());
        }
        let mut with_ttls = Box::new(hostent_with_ttls::default());
        with_ttls.hostent = start;
        for (i, ttl) in addrttls[..usize::try_from(naddrttls).expect("int cast")]
            .iter()
            .enumerate()
        {
            with_ttls.ttls[i] = ttl.ttl;
        }
        Ok(with_ttls)
    }

    pub fn parse_aaaa(
        buffer: *mut u8,
        buffer_length: c_int,
    ) -> Result<Box<hostent_with_ttls>, Error> {
        let mut start: *mut struct_hostent = ptr::null_mut();
        let mut addr6ttls = [struct_ares_addr6ttl::default(); 256];
        let mut naddr6ttls: c_int = 256;
        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        let result = unsafe {
            ares_parse_aaaa_reply(
                buffer,
                buffer_length,
                &raw mut start,
                addr6ttls.as_mut_ptr(),
                &raw mut naddr6ttls,
            )
        };
        if result != ARES_SUCCESS {
            return Err(Error::get(result).unwrap());
        }
        let mut with_ttls = Box::new(hostent_with_ttls::default());
        with_ttls.hostent = start;
        for (i, ttl) in addr6ttls[..usize::try_from(naddr6ttls).expect("int cast")]
            .iter()
            .enumerate()
        {
            with_ttls.ttls[i] = ttl.ttl;
        }
        Ok(with_ttls)
    }
}

impl Drop for hostent_with_ttls {
    fn drop(&mut self) {
        // SAFETY: hostent was allocated by ares_parse_*_reply (or null).
        unsafe { ares_free_hostent(self.hostent) };
    }
}

// Per-record-type newtype aliases. Zig instantiated the resolve machinery over
// the same `struct_hostent` / `hostent_with_ttls` with a comptime `type_name`
// string; Rust callers (`dns.rs`) need distinct type names to monomorphise the
// `CAresRecordType` cache-field constant per record. For now these are plain
// aliases — the trait impls live downstream.
pub type NsHostent = struct_hostent;
pub type PtrHostent = struct_hostent;
pub type CnameHostent = struct_hostent;
pub type AHostentWithTtls = hostent_with_ttls;
pub type AaaaHostentWithTtls = hostent_with_ttls;

#[repr(C)]
pub struct struct_nameinfo {
    pub node: *mut u8,
    pub service: *mut u8,
}

pub trait NameinfoHandler: Sized {
    fn on_nameinfo(&mut self, status: Option<Error>, timeouts: i32, info: Option<struct_nameinfo>);
}

impl struct_nameinfo {
    // toJSResponse alias deleted — lives in bun_runtime::dns_jsc.

    pub unsafe extern "C" fn callback_wrapper<T: NameinfoHandler>(
        ctx: *mut c_void,
        status: c_int,
        timeouts: c_int,
        node: *mut u8,
        service: *mut u8,
    ) {
        // SAFETY: ctx was passed as *mut T to the ares call that registered this thunk.
        let this = unsafe { bun_core::callback_ctx::<T>(ctx) };
        if status != ARES_SUCCESS {
            this.on_nameinfo(Error::get(status), timeouts, None);
            return;
        }
        this.on_nameinfo(None, timeouts, Some(struct_nameinfo { node, service }));
    }
}

pub type struct_timeval = timeval;

bun_opaque::opaque_ffi! { pub struct struct_Channeldata; }

#[repr(C)]
pub struct AddrInfo_cname {
    pub ttl: c_int,
    pub alias: *mut u8,
    pub name: *mut u8,
    pub next: *mut AddrInfo_cname,
}

#[repr(C)]
pub struct AddrInfo_node {
    pub ttl: c_int,
    pub flags: c_int,
    pub family: c_int,
    pub socktype: c_int,
    pub protocol: c_int,
    pub addrlen: ares_socklen_t,
    pub addr: *mut sockaddr,
    pub next: *mut AddrInfo_node,
}

impl AddrInfo_node {
    pub fn count(&self) -> u32 {
        let mut len: u32 = 0;
        let mut node: *const AddrInfo_node = self;
        while !node.is_null() {
            len += 1;
            // SAFETY: node is non-null per loop condition; chain owned by c-ares.
            node = unsafe { (*node).next };
        }
        len
    }
}

#[repr(C)]
pub struct AddrInfo {
    pub cnames_: *mut AddrInfo_cname,
    pub node: *mut AddrInfo_node,
    pub name_: *mut c_char,
}

pub trait AddrInfoHandler: Sized {
    fn on_addr_info(&mut self, status: Option<Error>, timeouts: i32, results: *mut AddrInfo);
}

impl AddrInfo {
    // toJSArray alias deleted — lives in bun_runtime::dns_jsc.

    #[inline]
    pub fn name(&self) -> &[u8] {
        if self.name_.is_null() {
            return b"";
        }
        // SAFETY: name_ is a NUL-terminated string allocated by c-ares.
        unsafe { core::ffi::CStr::from_ptr(self.name_) }.to_bytes()
    }

    #[inline]
    pub fn cnames(&self) -> &[AddrInfo_node] {
        // TODO(port): Zig used `bun.span` on a [*c]AddrInfo_cname (sentinel-
        // terminated linked list), returning `[]const AddrInfo_node` — note
        // the type mismatch (cname vs node) in the original. This appears
        // unused; preserving the empty-slice fast path only.
        if self.cnames_.is_null() {
            return &[];
        }
        &[]
    }

    pub unsafe extern "C" fn callback_wrapper<T: AddrInfoHandler>(
        ctx: *mut c_void,
        status: c_int,
        timeouts: c_int,
        addr_info: *mut AddrInfo,
    ) {
        // SAFETY: ctx was passed as *mut T to the ares call that registered this thunk.
        let this = unsafe { bun_core::callback_ctx::<T>(ctx) };
        this.on_addr_info(Error::get(status), timeouts, addr_info);
    }

    /// FFI destroy — frees a c-ares-allocated addrinfo chain.
    pub unsafe fn destroy(this: *mut AddrInfo) {
        unsafe { ares_freeaddrinfo(this) };
    }
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct AddrInfo_hints {
    pub ai_flags: c_int,
    pub ai_family: c_int,
    pub ai_socktype: c_int,
    pub ai_protocol: c_int,
}
// SAFETY: four `c_int` fields; all-zero is a valid hints value (S021).
unsafe impl bun_core::ffi::Zeroable for AddrInfo_hints {}

impl AddrInfo_hints {
    pub fn is_empty(&self) -> bool {
        self.ai_flags == 0 && self.ai_family == 0 && self.ai_socktype == 0 && self.ai_protocol == 0
    }
}

#[derive(Copy, Clone, Default)]
pub struct ChannelOptions {
    pub timeout: Option<i32>,
    pub tries: Option<i32>,
}

bun_opaque::opaque_ffi! {
    /// Opaque c-ares channel handle. `UnsafeCell` makes the type `!Freeze` so a
    /// `&Channel` does not assert immutability of the C-owned state (c-ares
    /// mutates the channel on every dispatch/process call).
    pub struct Channel;
}
// Load-bearing: `ares_cancel`/`ares_process_fd` are declared `safe fn(&mut Channel)`
// on the basis that re-entrant callbacks re-deriving `&mut Channel` from a raw
// pointer cannot conflict because `Channel` claims zero bytes. If this type ever
// gains a non-ZST field, those signatures must revert to `unsafe fn(*mut Channel)`.
const _: () = assert!(core::mem::size_of::<Channel>() == 0);

/// Implemented by the type that owns a `*mut Channel` and receives socket-
/// state callbacks. Zig: `Container.onDNSSocketState` + `this.channel = ch`.
///
/// R-2: methods take `&self`. The c-ares `sock_state_cb` re-enters the
/// container while a `&self` borrow may already be live in `on_dns_poll`;
/// the implementor routes mutation through interior mutability.
pub trait ChannelContainer: Sized {
    fn on_dns_socket_state(&self, socket: ares_socket_t, readable: bool, writable: bool);
    fn set_channel(&self, channel: *mut Channel);
}

/// Trait for `Channel::resolve`: ties a lookup-name string to its NSType and
/// the `extern "C"` parse-thunk used as the ares_callback.
/// TODO(port): Zig dispatched via `@field(NSType, "ns_t_" ++ lookup_name)` and
/// `cares_type.callbackWrapper(lookup_name, Type, callback)`. This trait is the
/// Phase-A reshaping; the dns_jsc consumer will impl it per (T, record-type).
pub trait ResolveHandler: Sized {
    const LOOKUP_NAME: &'static [u8];
    const NS_TYPE: NSType;
    /// The `ares_callback`-compatible thunk that parses the reply and forwards
    /// to `Self`.
    unsafe extern "C" fn raw_callback(
        ctx: *mut c_void,
        status: c_int,
        timeouts: c_int,
        buffer: *mut u8,
        buffer_length: c_int,
    );
}

/// Copy `src` into the caller-owned stack `buf`, NUL-terminate, and return a
/// `*const c_char` suitable for c-ares FFI. Truncates silently at
/// `buf.len() - 1`; callers that must reject overlong input do so before
/// calling. The buffer lives in the caller's frame so the returned pointer is
/// valid for the FFI call that follows.
#[inline]
fn copy_nul_terminated(buf: &mut [u8], src: &[u8]) -> *const c_char {
    let len = src.len().min(buf.len() - 1);
    buf[..len].copy_from_slice(&src[..len]);
    buf[len] = 0;
    buf.as_ptr().cast::<c_char>()
}

impl Channel {
    pub fn init<C: ChannelContainer>(this: &C, options: ChannelOptions) -> Option<Error> {
        let mut channel: *mut Channel = ptr::null_mut();

        library_init();

        unsafe extern "C" fn on_sock_state<C: ChannelContainer>(
            ctx: *mut c_void,
            socket: ares_socket_t,
            readable: c_int,
            writable: c_int,
        ) {
            // SAFETY: `ctx` is the `&C` registered below; `on_dns_socket_state`
            // takes `&self` (R-2) so the shared borrow is sufficient.
            let container = unsafe { &*ctx.cast_const().cast::<C>() };
            container.on_dns_socket_state(socket, readable != 0, writable != 0);
        }

        let mut opts = Options::default();

        // Android note: c-ares can't auto-discover servers (no /etc/resolv.conf,
        // no JNI), so it falls back to 127.0.0.1 and queries time out. We do
        // NOT set ARES_FLAG_NO_DFLT_SVR here — that makes init fail with
        // ENOSERVER, which breaks dns.setServers() (it needs an initialized
        // channel to call ares_set_servers_ports). Letting the 127.0.0.1
        // default stand means setServers() works as the documented workaround.
        opts.flags = ARES_FLAG_NOCHECKRESP;
        opts.sock_state_cb = Some(on_sock_state::<C>);
        // R-2: `*mut` spelling is signature-only (c-ares stores a `void*`); the
        // callback derefs as shared (`&*const`) and the implementor mutates via
        // interior mutability.
        opts.sock_state_cb_data = (this as *const C).cast_mut().cast::<c_void>();
        opts.timeout = options.timeout.unwrap_or(-1);
        opts.tries = options.tries.unwrap_or(4);

        let optmask: c_int =
            ARES_OPT_FLAGS | ARES_OPT_TIMEOUTMS | ARES_OPT_SOCK_STATE_CB | ARES_OPT_TRIES;

        // SAFETY: c-ares FFI; opts/channel are valid stack pointers.
        if let Some(err) =
            Error::get(unsafe { ares_init_options(&raw mut channel, &raw mut opts, optmask) })
        {
            // SAFETY: init failed before any channel was registered; we hold the
            // library_init reference taken above and no other thread is in c-ares.
            unsafe { ares_library_cleanup() };
            return Some(err);
        }

        this.set_channel(channel);
        None
    }

    /// FFI destroy — `ares_destroy`.
    pub unsafe fn destroy(this: *mut Channel) {
        unsafe { ares_destroy(this) };
    }

    /// See c-ares `ares_getaddrinfo` documentation (mirrored in the Zig source).
    pub fn get_addr_info<T: AddrInfoHandler>(
        &mut self,
        host: &[u8],
        port: u16,
        hints: &[AddrInfo_hints],
        ctx: &mut T,
    ) {
        let mut host_buf = [0u8; 1024];
        let mut port_buf = [0u8; 21];
        let host_ptr = copy_nul_terminated(&mut host_buf, host);

        let port_ptr: *const c_char = if port > 0 {
            bun_core::fmt::itoa_z(&mut port_buf, port as u64).as_ptr()
        } else {
            ptr::null()
        };

        let mut hints_buf = [AddrInfo_hints::default(); 3];
        for (i, hint) in hints[..hints.len().min(2)].iter().enumerate() {
            hints_buf[i] = *hint;
        }
        let hints_: *const AddrInfo_hints = if !hints.is_empty() {
            hints_buf.as_ptr()
        } else {
            ptr::null()
        };
        // SAFETY: c-ares FFI; host/port/hints are NUL-terminated stack buffers or null; ctx outlives the channel.
        unsafe {
            ares_getaddrinfo(
                self,
                host_ptr,
                port_ptr,
                hints_,
                AddrInfo::callback_wrapper::<T>,
                std::ptr::from_mut::<T>(ctx).cast::<c_void>(),
            );
        }
    }

    pub fn resolve<T: ResolveHandler>(&mut self, name: &[u8], ctx: &mut T) {
        if name.len() >= 1023
            || (name.is_empty() && !(T::LOOKUP_NAME == b"ns" || T::LOOKUP_NAME == b"soa"))
        {
            // SAFETY: thunk handles ARES_EBADNAME path.
            unsafe {
                T::raw_callback(
                    std::ptr::from_mut::<T>(ctx).cast::<c_void>(),
                    ARES_EBADNAME,
                    0,
                    ptr::null_mut(),
                    0,
                )
            };
            return;
        }

        let mut name_buf = [0u8; 1024];
        let name_ptr = copy_nul_terminated(&mut name_buf, name);

        // SAFETY: c-ares FFI; name_ptr is a NUL-terminated stack buffer; ctx outlives the channel.
        unsafe {
            ares_query(
                self,
                name_ptr,
                NSClass::ns_c_in,
                T::NS_TYPE,
                Some(T::raw_callback),
                std::ptr::from_mut::<T>(ctx).cast::<c_void>(),
            );
        }
    }

    pub fn get_host_by_addr<T: HostentHandler>(&mut self, ip_addr: &[u8], ctx: &mut T) {
        // "0000:0000:0000:0000:0000:ffff:192.168.100.228".length = 45
        const BUF_SIZE: usize = 46;
        let mut addr_buf = [0u8; BUF_SIZE];
        let addr_ptr: *const c_char = 'brk: {
            if ip_addr.is_empty() || ip_addr.len() >= BUF_SIZE {
                break 'brk ptr::null();
            }
            copy_nul_terminated(&mut addr_buf, ip_addr)
        };

        // https://c-ares.org/ares_inet_pton.html
        // https://github.com/c-ares/c-ares/blob/7f3262312f246556d8c1bdd8ccc1844847f42787/src/lib/ares_gethostbyaddr.c#L71-L72
        // `ares_inet_pton` allows passing raw bytes as `dst`,
        // which can avoid the use of `struct_in_addr` to reduce extra bytes.
        let mut addr = [0u8; 16];
        if !addr_ptr.is_null() {
            // SAFETY: c-ares FFI; addr_ptr is a NUL-terminated stack buffer, addr is 16-byte stack scratch.
            if unsafe { ares_inet_pton(AF::INET, addr_ptr, addr.as_mut_ptr().cast::<c_void>()) } > 0
            {
                // SAFETY: c-ares FFI; addr holds a 4-byte in_addr written by ares_inet_pton; ctx outlives the channel.
                unsafe {
                    ares_gethostbyaddr(
                        self,
                        addr.as_ptr().cast::<c_void>(),
                        4,
                        AF::INET,
                        Some(struct_hostent::host_callback_wrapper::<T>),
                        std::ptr::from_mut::<T>(ctx).cast::<c_void>(),
                    );
                }
                return;
            // SAFETY: c-ares FFI; addr_ptr is a NUL-terminated stack buffer, addr is 16-byte stack scratch.
            } else if unsafe {
                ares_inet_pton(AF::INET6, addr_ptr, addr.as_mut_ptr().cast::<c_void>())
            } > 0
            {
                // SAFETY: c-ares FFI; addr holds a 16-byte in6_addr written by ares_inet_pton; ctx outlives the channel.
                unsafe {
                    ares_gethostbyaddr(
                        self,
                        addr.as_ptr().cast::<c_void>(),
                        16,
                        AF::INET6,
                        Some(struct_hostent::host_callback_wrapper::<T>),
                        std::ptr::from_mut::<T>(ctx).cast::<c_void>(),
                    );
                }
                return;
            }
        }
        // SAFETY: invoking the thunk directly with ENOTIMP.
        unsafe {
            struct_hostent::host_callback_wrapper::<T>(
                std::ptr::from_mut::<T>(ctx).cast::<c_void>(),
                ARES_ENOTIMP,
                0,
                ptr::null_mut(),
            );
        }
    }

    /// https://c-ares.org/ares_getnameinfo.html
    pub fn get_name_info<T: NameinfoHandler>(&mut self, sa: &mut sockaddr, ctx: &mut T) {
        let salen: ares_socklen_t = if sa.sa_family == AF::INET as _ {
            core::mem::size_of::<sockaddr_in>() as ares_socklen_t
        } else {
            core::mem::size_of::<sockaddr_in6>() as ares_socklen_t
        };
        // SAFETY: c-ares FFI; sa is a valid sockaddr of size `salen`; ctx outlives the channel.
        unsafe {
            ares_getnameinfo(
                self,
                std::ptr::from_ref::<sockaddr>(sa),
                salen,
                // node returns ENOTFOUND for addresses like 255.255.255.255:80
                // So, it requires setting the ARES_NI_NAMEREQD flag
                ARES_NI_NAMEREQD | ARES_NI_LOOKUPHOST | ARES_NI_LOOKUPSERVICE,
                Some(struct_nameinfo::callback_wrapper::<T>),
                std::ptr::from_mut::<T>(ctx).cast::<c_void>(),
            );
        }
    }

    #[inline]
    pub fn process(&mut self, fd: ares_socket_t, readable: bool, writable: bool) {
        ares_process_fd(
            self,
            if readable { fd } else { ARES_SOCKET_BAD },
            if writable { fd } else { ARES_SOCKET_BAD },
        );
    }
}

fn library_init() {
    bun_core::run_once! {{
        // SAFETY: c-ares FFI; mimalloc fn pointers have C ABI matching ares_library_init_mem's contract.
        let rc = unsafe {
            ares_library_init_mem(
                ARES_LIB_INIT_ALL,
                Some(bun_alloc::mimalloc::mi_malloc),
                Some(bun_alloc::mimalloc::mi_free),
                Some(bun_alloc::mimalloc::mi_realloc),
            )
        };
        if rc != ARES_SUCCESS {
            panic!("ares_library_init_mem failed: {}", rc);
        }
    }}
}

pub type ares_callback = Option<unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int)>;
pub type ares_host_callback =
    Option<unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut struct_hostent)>;
pub type ares_nameinfo_callback =
    Option<unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, *mut u8)>;
pub type ares_sock_create_callback =
    Option<unsafe extern "C" fn(ares_socket_t, c_int, *mut c_void) -> c_int>;
pub type ares_sock_config_callback =
    Option<unsafe extern "C" fn(ares_socket_t, c_int, *mut c_void) -> c_int>;
pub type ares_addrinfo_callback = unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut AddrInfo);

unsafe extern "C" {
    pub fn ares_library_init(flags: c_int) -> c_int;
    pub fn ares_library_init_mem(
        flags: c_int,
        amalloc: Option<unsafe extern "C" fn(usize) -> *mut c_void>,
        afree: Option<unsafe extern "C" fn(*mut c_void)>,
        arealloc: Option<unsafe extern "C" fn(*mut c_void, usize) -> *mut c_void>,
    ) -> c_int;
    pub safe fn ares_library_initialized() -> c_int;
    // NOT safe: per ares_library_cleanup(3) this is not thread-safe — must only
    // be called after all threads using c-ares have terminated; calling it while
    // a Channel is live or another thread is in c-ares is UB.
    pub fn ares_library_cleanup();
    pub fn ares_version(version: *mut c_int) -> *const u8;
    pub fn ares_init(channelptr: *mut *mut Channel) -> c_int;
    pub fn ares_init_options(
        channelptr: *mut *mut Channel,
        options: *mut Options,
        optmask: c_int,
    ) -> c_int;
    pub fn ares_save_options(
        channel: *mut Channel,
        options: *mut Options,
        optmask: *mut c_int,
    ) -> c_int;
    pub fn ares_destroy_options(options: *mut Options);
    pub fn ares_dup(dest: *mut Channel, src: *mut Channel) -> c_int;
    pub fn ares_destroy(channel: *mut Channel);
    // Opaque handle by exclusive reference only — `Channel` is `!Freeze`/`!Sync`
    // (UnsafeCell + PhantomData<*mut u8>). Note: `ares_cancel`/`ares_process_fd`
    // synchronously invoke stored completion callbacks which may re-enter the
    // resolver and re-derive a `&mut Channel` from a raw pointer; this is sound
    // because `Channel` is a ZST (`UnsafeCell<[u8;0]>`), so `&mut Channel`
    // claims zero bytes and overlapping `&mut` do not conflict under Stacked
    // Borrows — the borrow checker does NOT gate the raw-pointer callbacks.
    pub safe fn ares_cancel(channel: &mut Channel);
    pub safe fn ares_set_local_ip4(channel: &mut Channel, local_ip: c_uint);
    pub fn ares_set_local_ip6(channel: *mut Channel, local_ip6: *const u8);
    pub fn ares_set_local_dev(channel: *mut Channel, local_dev_name: *const u8);
    pub fn ares_set_socket_callback(
        channel: *mut Channel,
        callback: ares_sock_create_callback,
        user_data: *mut c_void,
    );
    pub fn ares_set_socket_configure_callback(
        channel: *mut Channel,
        callback: ares_sock_config_callback,
        user_data: *mut c_void,
    );
    pub fn ares_set_sortlist(channel: *mut Channel, sortstr: *const u8) -> c_int;
    pub fn ares_getaddrinfo(
        channel: *mut Channel,
        node: *const c_char,
        service: *const c_char,
        hints: *const AddrInfo_hints,
        callback: ares_addrinfo_callback,
        arg: *mut c_void,
    );
    pub fn ares_freeaddrinfo(ai: *mut AddrInfo);
}

#[repr(C)]
pub struct ares_socket_functions {
    pub socket: Option<unsafe extern "C" fn(c_int, c_int, c_int, *mut c_void) -> ares_socket_t>,
    pub close: Option<unsafe extern "C" fn(ares_socket_t, *mut c_void) -> c_int>,
    pub connect: Option<
        unsafe extern "C" fn(ares_socket_t, *const sockaddr, ares_socklen_t, *mut c_void) -> c_int,
    >,
    pub recvfrom: Option<
        unsafe extern "C" fn(
            ares_socket_t,
            *mut c_void,
            usize,
            c_int,
            *mut sockaddr,
            *mut ares_socklen_t,
            *mut c_void,
        ) -> ares_ssize_t,
    >,
    pub sendv: Option<
        unsafe extern "C" fn(ares_socket_t, *const iovec, c_int, *mut c_void) -> ares_ssize_t,
    >,
}

unsafe extern "C" {
    pub fn ares_set_socket_functions(
        channel: *mut Channel,
        funcs: *const ares_socket_functions,
        user_data: *mut c_void,
    );
    pub fn ares_send(
        channel: *mut Channel,
        qbuf: *const u8,
        qlen: c_int,
        callback: ares_callback,
        arg: *mut c_void,
    );
    pub fn ares_query(
        channel: *mut Channel,
        name: *const c_char,
        dnsclass: NSClass,
        type_: NSType,
        callback: ares_callback,
        arg: *mut c_void,
    );
    pub fn ares_search(
        channel: *mut Channel,
        name: *const c_char,
        dnsclass: c_int,
        type_: c_int,
        callback: ares_callback,
        arg: *mut c_void,
    );
    pub fn ares_gethostbyname(
        channel: *mut Channel,
        name: *const c_char,
        family: c_int,
        callback: ares_host_callback,
        arg: *mut c_void,
    );
    pub fn ares_gethostbyname_file(
        channel: *mut Channel,
        name: *const c_char,
        family: c_int,
        host: *mut *mut struct_hostent,
    ) -> c_int;
    pub fn ares_gethostbyaddr(
        channel: *mut Channel,
        addr: *const c_void,
        addrlen: c_int,
        family: c_int,
        callback: ares_host_callback,
        arg: *mut c_void,
    );
    pub fn ares_getnameinfo(
        channel: *mut Channel,
        sa: *const sockaddr,
        salen: ares_socklen_t,
        flags: c_int,
        callback: ares_nameinfo_callback,
        arg: *mut c_void,
    );
    // pub fn ares_fds(channel: *mut Channel, read_fds: *mut fd_set, write_fds: *mut fd_set) -> c_int;
    pub fn ares_getsock(channel: *mut Channel, socks: *mut ares_socket_t, numsocks: c_int)
    -> c_int;
    pub fn ares_timeout(
        channel: *mut Channel,
        maxtv: *mut struct_timeval,
        tv: *mut struct_timeval,
    ) -> *mut struct_timeval;
    // pub fn ares_process(channel: *mut Channel, read_fds: *mut fd_set, write_fds: *mut fd_set);
    // Opaque handle by exclusive reference + scalars only.
    pub safe fn ares_process_fd(
        channel: &mut Channel,
        read_fd: ares_socket_t,
        write_fd: ares_socket_t,
    );
    pub fn ares_create_query(
        name: *const c_char,
        dnsclass: c_int,
        type_: c_int,
        id: c_ushort,
        rd: c_int,
        buf: *mut *mut u8,
        buflen: *mut c_int,
        max_udp_size: c_int,
    ) -> c_int;
    pub fn ares_mkquery(
        name: *const c_char,
        dnsclass: c_int,
        type_: c_int,
        id: c_ushort,
        rd: c_int,
        buf: *mut *mut u8,
        buflen: *mut c_int,
    ) -> c_int;
    pub fn ares_expand_name(
        encoded: *const u8,
        abuf: *const u8,
        alen: c_int,
        s: *mut *mut u8,
        enclen: *mut c_long,
    ) -> c_int;
    pub fn ares_expand_string(
        encoded: *const u8,
        abuf: *const u8,
        alen: c_int,
        s: *mut *mut u8,
        enclen: *mut c_long,
    ) -> c_int;
    // Pure read of opaque `!Sync` handle.
    pub safe fn ares_queue_active_queries(channel: &Channel) -> usize;
}

#[repr(C)]
#[derive(Copy, Clone)]
union union_unnamed_2 {
    _S6_u8: [u8; 16],
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct struct_ares_in6_addr {
    _S6_un: union_unnamed_2,
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct struct_ares_addrttl {
    pub ipaddr: u32,
    pub ttl: c_int,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct struct_ares_addr6ttl {
    pub ip6addr: struct_ares_in6_addr,
    pub ttl: c_int,
}

// SAFETY: `#[repr(C)]` POD — 16-byte byte-array union + `c_int`. All-zero is a
// valid bit pattern (matches Zig `std.mem.zeroes`) (S021).
unsafe impl bun_core::ffi::Zeroable for struct_ares_addr6ttl {}
impl Default for struct_ares_addr6ttl {
    #[inline]
    fn default() -> Self {
        bun_core::ffi::zeroed()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Generic reply-record plumbing. The six `struct_ares_{caa,srv,mx,txt,naptr,soa}_reply`
// types share an identical c-ares callback thunk modulo (reply type, parse fn),
// and all six `ares_parse_*_reply` externs share the signature
// `(abuf *const u8, alen c_int, out *mut *mut R) -> c_int`. Collapsed from six
// copy-pasted `callback_wrapper` bodies + six per-type handler traits.
// ──────────────────────────────────────────────────────────────────────────

/// A c-ares reply record whose parser has the canonical 3-arg signature.
pub trait AresReply: Sized {
    /// SAFETY: thin forward to the matching `ares_parse_*_reply` extern.
    unsafe fn parse(abuf: *const u8, alen: c_int, out: *mut *mut Self) -> c_int;
}

/// Receiver for a parsed `R` reply (replaces the per-type `*Handler` traits).
pub trait ReplyHandler<R: AresReply>: Sized {
    fn on_reply(&mut self, status: Option<Error>, timeouts: i32, results: *mut R);
}

/// Generic `ares_callback` thunk. Monomorphized per `(R, T)` to a concrete
/// `unsafe extern "C" fn`, so the fn-pointer ABI passed to `ares_query` is
/// identical to the former hand-rolled `callback_wrapper`s.
pub unsafe extern "C" fn ares_reply_callback<R: AresReply, T: ReplyHandler<R>>(
    ctx: *mut c_void,
    status: c_int,
    timeouts: c_int,
    buffer: *mut u8,
    buffer_length: c_int,
) {
    // SAFETY: ctx was passed as *mut T to the ares call that registered this thunk.
    let this = unsafe { bun_core::callback_ctx::<T>(ctx) };
    if status != ARES_SUCCESS {
        this.on_reply(Error::get(status), timeouts, ptr::null_mut());
        return;
    }
    let mut start: *mut R = ptr::null_mut();
    // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
    let result = unsafe { R::parse(buffer, buffer_length, &raw mut start) };
    if result != ARES_SUCCESS {
        this.on_reply(Error::get(result), timeouts, ptr::null_mut());
        return;
    }
    this.on_reply(None, timeouts, start);
}

#[repr(C)]
pub struct struct_ares_caa_reply {
    pub next: *mut struct_ares_caa_reply,
    pub critical: c_int,
    pub property: *mut u8,
    pub plength: usize,
    pub value: *mut u8,
    pub length: usize,
}

impl AresReply for struct_ares_caa_reply {
    unsafe fn parse(abuf: *const u8, alen: c_int, out: *mut *mut Self) -> c_int {
        unsafe { ares_parse_caa_reply(abuf, alen, out) }
    }
}

impl struct_ares_caa_reply {
    /// Safe view of the c-ares-owned property tag bytes.
    #[inline]
    pub fn property_bytes(&self) -> &[u8] {
        // SAFETY: c-ares allocates `property` as a contiguous buffer of
        // `plength` bytes that lives until `ares_free_data` is called on the
        // list head; the `&self` borrow is shorter than that. c-ares never
        // sets a non-zero length with a null pointer.
        if self.property.is_null() {
            &[]
        } else {
            unsafe { core::slice::from_raw_parts(self.property, self.plength) }
        }
    }
    /// Safe view of the c-ares-owned value bytes.
    #[inline]
    pub fn value_bytes(&self) -> &[u8] {
        // SAFETY: same invariant as `property_bytes` — `value` points to
        // `length` bytes owned by the reply node for `&self`'s lifetime.
        if self.value.is_null() {
            &[]
        } else {
            unsafe { core::slice::from_raw_parts(self.value, self.length) }
        }
    }
}

#[repr(C)]
pub struct struct_ares_srv_reply {
    pub next: *mut struct_ares_srv_reply,
    pub host: *mut u8,
    pub priority: c_ushort,
    pub weight: c_ushort,
    pub port: c_ushort,
}

impl AresReply for struct_ares_srv_reply {
    unsafe fn parse(abuf: *const u8, alen: c_int, out: *mut *mut Self) -> c_int {
        unsafe { ares_parse_srv_reply(abuf, alen, out) }
    }
}

#[repr(C)]
pub struct struct_ares_mx_reply {
    pub next: *mut struct_ares_mx_reply,
    pub host: *mut u8,
    pub priority: c_ushort,
}

impl AresReply for struct_ares_mx_reply {
    unsafe fn parse(abuf: *const u8, alen: c_int, out: *mut *mut Self) -> c_int {
        unsafe { ares_parse_mx_reply(abuf, alen, out) }
    }
}

#[repr(C)]
pub struct struct_ares_txt_reply {
    pub next: *mut struct_ares_txt_reply,
    pub txt: *mut u8,
    pub length: usize,
}

impl AresReply for struct_ares_txt_reply {
    unsafe fn parse(abuf: *const u8, alen: c_int, out: *mut *mut Self) -> c_int {
        unsafe { ares_parse_txt_reply(abuf, alen, out) }
    }
}

impl struct_ares_txt_reply {
    /// Safe view of the c-ares-owned TXT record bytes.
    #[inline]
    pub fn txt_bytes(&self) -> &[u8] {
        // SAFETY: c-ares allocates `txt` as `length` bytes that live until
        // `ares_free_data` on the list head; `&self` is the shorter borrow.
        if self.txt.is_null() {
            &[]
        } else {
            unsafe { core::slice::from_raw_parts(self.txt, self.length) }
        }
    }
}

#[repr(C)]
pub struct struct_ares_txt_ext {
    pub next: *mut struct_ares_txt_ext,
    pub txt: *mut u8,
    pub length: usize,
    pub record_start: u8,
}

impl struct_ares_txt_ext {
    /// Safe view of the c-ares-owned TXT record bytes.
    #[inline]
    pub fn txt_bytes(&self) -> &[u8] {
        // SAFETY: c-ares allocates `txt` as `length` bytes that live until
        // `ares_free_data` on the list head; `&self` is the shorter borrow.
        if self.txt.is_null() {
            &[]
        } else {
            unsafe { core::slice::from_raw_parts(self.txt, self.length) }
        }
    }
}

#[repr(C)]
pub struct struct_ares_naptr_reply {
    pub next: *mut struct_ares_naptr_reply,
    pub flags: *mut u8,
    pub service: *mut u8,
    pub regexp: *mut u8,
    pub replacement: *mut u8,
    pub order: c_ushort,
    pub preference: c_ushort,
}

impl AresReply for struct_ares_naptr_reply {
    unsafe fn parse(abuf: *const u8, alen: c_int, out: *mut *mut Self) -> c_int {
        unsafe { ares_parse_naptr_reply(abuf, alen, out) }
    }
}

#[repr(C)]
pub struct struct_ares_soa_reply {
    pub nsname: *mut u8,
    pub hostmaster: *mut u8,
    pub serial: c_uint,
    pub refresh: c_uint,
    pub retry: c_uint,
    pub expire: c_uint,
    pub minttl: c_uint,
}

impl AresReply for struct_ares_soa_reply {
    unsafe fn parse(abuf: *const u8, alen: c_int, out: *mut *mut Self) -> c_int {
        unsafe { ares_parse_soa_reply(abuf, alen, out) }
    }
}

#[repr(C)]
pub struct struct_ares_uri_reply {
    pub next: *mut struct_ares_uri_reply,
    pub priority: c_ushort,
    pub weight: c_ushort,
    pub uri: *mut u8,
    pub ttl: c_int,
}

pub struct struct_any_reply {
    pub a_reply: Option<Box<hostent_with_ttls>>,
    pub aaaa_reply: Option<Box<hostent_with_ttls>>,
    pub mx_reply: *mut struct_ares_mx_reply,
    pub ns_reply: *mut struct_hostent,
    pub txt_reply: *mut struct_ares_txt_reply,
    pub srv_reply: *mut struct_ares_srv_reply,
    pub ptr_reply: *mut struct_hostent,
    pub naptr_reply: *mut struct_ares_naptr_reply,
    pub soa_reply: *mut struct_ares_soa_reply,
    pub caa_reply: *mut struct_ares_caa_reply,
}

impl Default for struct_any_reply {
    fn default() -> Self {
        Self {
            a_reply: None,
            aaaa_reply: None,
            mx_reply: ptr::null_mut(),
            ns_reply: ptr::null_mut(),
            txt_reply: ptr::null_mut(),
            srv_reply: ptr::null_mut(),
            ptr_reply: ptr::null_mut(),
            naptr_reply: ptr::null_mut(),
            soa_reply: ptr::null_mut(),
            caa_reply: ptr::null_mut(),
        }
    }
}

pub trait AnyHandler: Sized {
    fn on_any(
        &mut self,
        status: Option<Error>,
        timeouts: i32,
        results: Option<Box<struct_any_reply>>,
    );
}

impl struct_any_reply {
    // toJSResponse / toJS aliases deleted.

    pub unsafe extern "C" fn callback_wrapper<T: AnyHandler>(
        ctx: *mut c_void,
        status: c_int,
        timeouts: c_int,
        buffer: *mut u8,
        buffer_length: c_int,
    ) {
        // SAFETY: ctx was passed as *mut T to the ares call that registered this thunk.
        let this = unsafe { bun_core::callback_ctx::<T>(ctx) };
        if status != ARES_SUCCESS {
            this.on_any(Error::get(status), timeouts, None);
            return;
        }
        match Self::parse(buffer, buffer_length) {
            Ok(reply) => this.on_any(None, timeouts, Some(reply)),
            Err(err) => this.on_any(Some(err), timeouts, None),
        }
    }

    /// Parse a DNS `ANY` reply buffer into a heap-allocated aggregate. Returns
    /// the last per-record parse error if no record type parsed successfully.
    pub fn parse(buffer: *mut u8, buffer_length: c_int) -> Result<Box<Self>, Error> {
        let mut any_success = false;
        let mut last_error: Option<c_int> = None;
        let mut reply = Box::new(struct_any_reply::default());

        match hostent_with_ttls::parse_a(buffer, buffer_length) {
            Ok(result) => {
                reply.a_reply = Some(result);
                any_success = true;
            }
            Err(err) => last_error = Some(err as c_int),
        }

        match hostent_with_ttls::parse_aaaa(buffer, buffer_length) {
            Ok(result) => {
                reply.aaaa_reply = Some(result);
                any_success = true;
            }
            Err(err) => last_error = Some(err as c_int),
        }

        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        let mut result =
            unsafe { ares_parse_mx_reply(buffer, buffer_length, &raw mut reply.mx_reply) };
        if result == ARES_SUCCESS {
            any_success = true;
        } else {
            last_error = Some(result);
        }

        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        result = unsafe { ares_parse_ns_reply(buffer, buffer_length, &raw mut reply.ns_reply) };
        if result == ARES_SUCCESS {
            any_success = true;
        } else {
            last_error = Some(result);
        }

        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        result = unsafe { ares_parse_txt_reply(buffer, buffer_length, &raw mut reply.txt_reply) };
        if result == ARES_SUCCESS {
            any_success = true;
        } else {
            last_error = Some(result);
        }

        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        result = unsafe { ares_parse_srv_reply(buffer, buffer_length, &raw mut reply.srv_reply) };
        if result == ARES_SUCCESS {
            any_success = true;
        } else {
            last_error = Some(result);
        }

        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        result = unsafe {
            ares_parse_ptr_reply(
                buffer,
                buffer_length,
                ptr::null(),
                0,
                AF::INET,
                &raw mut reply.ptr_reply,
            )
        };
        if result == ARES_SUCCESS {
            any_success = true;
        } else {
            last_error = Some(result);
        }

        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        result =
            unsafe { ares_parse_naptr_reply(buffer, buffer_length, &raw mut reply.naptr_reply) };
        if result == ARES_SUCCESS {
            any_success = true;
        } else {
            last_error = Some(result);
        }

        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        result = unsafe { ares_parse_soa_reply(buffer, buffer_length, &raw mut reply.soa_reply) };
        if result == ARES_SUCCESS {
            any_success = true;
        } else {
            last_error = Some(result);
        }

        // SAFETY: c-ares FFI; pointers are valid stack/null per contract.
        result = unsafe { ares_parse_caa_reply(buffer, buffer_length, &raw mut reply.caa_reply) };
        if result == ARES_SUCCESS {
            any_success = true;
        } else {
            last_error = Some(result);
        }

        if !any_success {
            return Err(Error::get(last_error.unwrap()).unwrap());
        }
        Ok(reply)
    }
}

impl Drop for struct_any_reply {
    fn drop(&mut self) {
        // Zig: `inline for (@typeInfo(..).fields)` — written out by hand.
        // a_reply / aaaa_reply are Box<hostent_with_ttls>; their Drop frees the
        // inner hostent via ares_free_hostent.
        // SAFETY: each field is either null or a c-ares allocation matching its free fn.
        unsafe {
            if !self.mx_reply.is_null() {
                ares_free_data(self.mx_reply.cast::<c_void>());
            }
            if !self.ns_reply.is_null() {
                ares_free_hostent(self.ns_reply);
            }
            if !self.txt_reply.is_null() {
                ares_free_data(self.txt_reply.cast::<c_void>());
            }
            if !self.srv_reply.is_null() {
                ares_free_data(self.srv_reply.cast::<c_void>());
            }
            if !self.ptr_reply.is_null() {
                ares_free_hostent(self.ptr_reply);
            }
            if !self.naptr_reply.is_null() {
                ares_free_data(self.naptr_reply.cast::<c_void>());
            }
            if !self.soa_reply.is_null() {
                ares_free_data(self.soa_reply.cast::<c_void>());
            }
            if !self.caa_reply.is_null() {
                ares_free_data(self.caa_reply.cast::<c_void>());
            }
        }
    }
}

unsafe extern "C" {
    pub fn ares_parse_a_reply(
        abuf: *const u8,
        alen: c_int,
        host: *mut *mut struct_hostent,
        addrttls: *mut struct_ares_addrttl,
        naddrttls: *mut c_int,
    ) -> c_int;
    pub fn ares_parse_aaaa_reply(
        abuf: *const u8,
        alen: c_int,
        host: *mut *mut struct_hostent,
        addrttls: *mut struct_ares_addr6ttl,
        naddrttls: *mut c_int,
    ) -> c_int;
    pub fn ares_parse_caa_reply(
        abuf: *const u8,
        alen: c_int,
        caa_out: *mut *mut struct_ares_caa_reply,
    ) -> c_int;
    pub fn ares_parse_ptr_reply(
        abuf: *const u8,
        alen: c_int,
        addr: *const c_void,
        addrlen: c_int,
        family: c_int,
        host: *mut *mut struct_hostent,
    ) -> c_int;
    pub fn ares_parse_ns_reply(
        abuf: *const u8,
        alen: c_int,
        host: *mut *mut struct_hostent,
    ) -> c_int;
    pub fn ares_parse_srv_reply(
        abuf: *const u8,
        alen: c_int,
        srv_out: *mut *mut struct_ares_srv_reply,
    ) -> c_int;
    pub fn ares_parse_mx_reply(
        abuf: *const u8,
        alen: c_int,
        mx_out: *mut *mut struct_ares_mx_reply,
    ) -> c_int;
    pub fn ares_parse_txt_reply(
        abuf: *const u8,
        alen: c_int,
        txt_out: *mut *mut struct_ares_txt_reply,
    ) -> c_int;
    pub fn ares_parse_txt_reply_ext(
        abuf: *const u8,
        alen: c_int,
        txt_out: *mut *mut struct_ares_txt_ext,
    ) -> c_int;
    pub fn ares_parse_naptr_reply(
        abuf: *const u8,
        alen: c_int,
        naptr_out: *mut *mut struct_ares_naptr_reply,
    ) -> c_int;
    pub fn ares_parse_soa_reply(
        abuf: *const u8,
        alen: c_int,
        soa_out: *mut *mut struct_ares_soa_reply,
    ) -> c_int;
    pub fn ares_parse_uri_reply(
        abuf: *const u8,
        alen: c_int,
        uri_out: *mut *mut struct_ares_uri_reply,
    ) -> c_int;
    pub fn ares_free_string(str_: *mut c_void);
    pub fn ares_free_hostent(host: *mut struct_hostent);
    pub fn ares_free_data(dataptr: *mut c_void);
    pub safe fn ares_strerror(code: c_int) -> *const u8;
}

#[repr(C)]
#[derive(Copy, Clone)]
union union_unnamed_3 {
    addr4: in_addr,
    addr6: struct_ares_in6_addr,
}

#[repr(C)]
pub struct struct_ares_addr_node {
    pub next: *mut struct_ares_addr_node,
    pub family: c_int,
    addr: union_unnamed_3,
}

#[repr(C)]
#[derive(Copy, Clone)]
union union_unnamed_4 {
    addr4: in_addr,
    addr6: struct_ares_in6_addr,
}

#[repr(C)]
pub struct struct_ares_addr_port_node {
    pub next: *mut struct_ares_addr_port_node,
    pub family: c_int,
    addr: union_unnamed_4,
    pub udp_port: c_int,
    pub tcp_port: c_int,
}
// SAFETY: `#[repr(C)]` POD — raw ptr, `c_int`s, and a byte-array union.
// All-zero is the state callers fill before `ares_inet_pton` (S021).
unsafe impl bun_core::ffi::Zeroable for struct_ares_addr_port_node {}

impl struct_ares_addr_port_node {
    /// Type-erased pointer to the in_addr/in6_addr union, for `ares_inet_ntop`.
    /// The union field stays private (active arm depends on `family`), but
    /// callers need its address to round-trip through c-ares' presentation
    /// converters.
    #[inline]
    pub fn addr_ptr(&self) -> *const c_void {
        ptr::addr_of!(self.addr).cast::<c_void>()
    }
    /// Mutable counterpart of `addr_ptr` for `ares_inet_pton` to fill.
    #[inline]
    pub fn addr_mut_ptr(&mut self) -> *mut c_void {
        ptr::addr_of_mut!(self.addr).cast::<c_void>()
    }
}

unsafe extern "C" {
    pub fn ares_set_servers(channel: *mut Channel, servers: *mut struct_ares_addr_node) -> c_int;
    pub fn ares_set_servers_ports(
        channel: *mut Channel,
        servers: *mut struct_ares_addr_port_node,
    ) -> c_int;
    pub fn ares_set_servers_csv(channel: *mut Channel, servers: *const u8) -> c_int;
    pub fn ares_set_servers_ports_csv(channel: *mut Channel, servers: *const u8) -> c_int;
    pub fn ares_get_servers(
        channel: *mut Channel,
        servers: *mut *mut struct_ares_addr_port_node,
    ) -> c_int;
    pub fn ares_get_servers_ports(
        channel: *mut Channel,
        servers: *mut *mut struct_ares_addr_port_node,
    ) -> c_int;
    /// https://c-ares.org/docs/ares_inet_ntop.html
    pub fn ares_inet_ntop(
        af: c_int,
        src: *const c_void,
        dst: *mut u8,
        size: ares_socklen_t,
    ) -> *const c_char;
    /// https://c-ares.org/docs/ares_inet_pton.html
    ///
    /// ## Returns
    /// - `1` if `src` was valid for the specified address family
    /// - `0` if `src` was not parseable in the specified address family
    /// - `-1` if some system error occurred. `errno` will have been set.
    pub fn ares_inet_pton(af: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
}

pub const ARES_SUCCESS: c_int = 0;
pub const ARES_ENODATA: c_int = 1;
pub const ARES_EFORMERR: c_int = 2;
pub const ARES_ESERVFAIL: c_int = 3;
pub const ARES_ENOTFOUND: c_int = 4;
pub const ARES_ENOTIMP: c_int = 5;
pub const ARES_EREFUSED: c_int = 6;
pub const ARES_EBADQUERY: c_int = 7;
pub const ARES_EBADNAME: c_int = 8;
pub const ARES_EBADFAMILY: c_int = 9;
pub const ARES_EBADRESP: c_int = 10;
pub const ARES_ECONNREFUSED: c_int = 11;
pub const ARES_ETIMEOUT: c_int = 12;
pub const ARES_EOF: c_int = 13;
pub const ARES_EFILE: c_int = 14;
pub const ARES_ENOMEM: c_int = 15;
pub const ARES_EDESTRUCTION: c_int = 16;
pub const ARES_EBADSTR: c_int = 17;
pub const ARES_EBADFLAGS: c_int = 18;
pub const ARES_ENONAME: c_int = 19;
pub const ARES_EBADHINTS: c_int = 20;
pub const ARES_ENOTINITIALIZED: c_int = 21;
pub const ARES_ELOADIPHLPAPI: c_int = 22;
pub const ARES_EADDRGETNETWORKPARAMS: c_int = 23;
pub const ARES_ECANCELLED: c_int = 24;
pub const ARES_ESERVICE: c_int = 25;
pub const ARES_ENOSERVER: c_int = 26;

#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, strum::IntoStaticStr)]
pub enum Error {
    ENODATA = ARES_ENODATA,
    EFORMERR = ARES_EFORMERR,
    ESERVFAIL = ARES_ESERVFAIL,
    ENOTFOUND = ARES_ENOTFOUND,
    ENOTIMP = ARES_ENOTIMP,
    EREFUSED = ARES_EREFUSED,
    EBADQUERY = ARES_EBADQUERY,
    EBADNAME = ARES_EBADNAME,
    EBADFAMILY = ARES_EBADFAMILY,
    EBADRESP = ARES_EBADRESP,
    ECONNREFUSED = ARES_ECONNREFUSED,
    ETIMEOUT = ARES_ETIMEOUT,
    EOF = ARES_EOF,
    EFILE = ARES_EFILE,
    ENOMEM = ARES_ENOMEM,
    EDESTRUCTION = ARES_EDESTRUCTION,
    EBADSTR = ARES_EBADSTR,
    EBADFLAGS = ARES_EBADFLAGS,
    ENONAME = ARES_ENONAME,
    EBADHINTS = ARES_EBADHINTS,
    ENOTINITIALIZED = ARES_ENOTINITIALIZED,
    ELOADIPHLPAPI = ARES_ELOADIPHLPAPI,
    EADDRGETNETWORKPARAMS = ARES_EADDRGETNETWORKPARAMS,
    ECANCELLED = ARES_ECANCELLED,
    ESERVICE = ARES_ESERVICE,
    ENOSERVER = ARES_ENOSERVER,
}

impl Error {
    // Deferred / toDeferred / toJSWithSyscall / toJSWithSyscallAndHostname
    // aliases deleted — live in bun_runtime::dns_jsc (extension trait).

    pub fn init_eai(rc: i32) -> Option<Error> {
        #[cfg(windows)]
        {
            use bun_libuv_sys as libuv;
            // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
            if rc == libuv::UV_EAI_NODATA || rc == libuv::UV_EAI_NONAME {
                return Some(Error::ENOTFOUND);
            }
            // TODO: revisit this
            return match rc {
                0 => None,
                libuv::UV_EAI_AGAIN => Some(Error::ETIMEOUT),
                libuv::UV_EAI_ADDRFAMILY => Some(Error::EBADFAMILY),
                libuv::UV_EAI_BADFLAGS => Some(Error::EBADFLAGS),
                libuv::UV_EAI_BADHINTS => Some(Error::EBADHINTS),
                libuv::UV_EAI_CANCELED => Some(Error::ECANCELLED),
                libuv::UV_EAI_FAIL => Some(Error::ENOTFOUND),
                libuv::UV_EAI_FAMILY => Some(Error::EBADFAMILY),
                libuv::UV_EAI_MEMORY => Some(Error::ENOMEM),
                libuv::UV_EAI_NODATA => Some(Error::ENODATA),
                libuv::UV_EAI_NONAME => Some(Error::ENONAME),
                libuv::UV_EAI_OVERFLOW => Some(Error::ENOMEM),
                libuv::UV_EAI_PROTOCOL => Some(Error::EBADQUERY),
                libuv::UV_EAI_SERVICE => Some(Error::ESERVICE),
                libuv::UV_EAI_SOCKTYPE => Some(Error::ECONNREFUSED),
                _ => Some(Error::ENOTFOUND), // UV_ENOENT and non documented errors
            };
        }

        #[cfg(not(windows))]
        {
            let eai = EAI::from_raw(rc);

            // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
            if eai == EAI::NODATA || eai == EAI::NONAME {
                return Some(Error::ENOTFOUND);
            }

            #[cfg(target_os = "linux")]
            if eai == EAI::SOCKTYPE {
                return Some(Error::ECONNREFUSED);
            }

            // glibc-only async getaddrinfo_a / IDN extensions; absent on
            // musl and bionic.
            #[cfg(all(target_os = "linux", target_env = "gnu"))]
            match eai {
                EAI::IDN_ENCODE => return Some(Error::EBADSTR),
                EAI::ALLDONE => return Some(Error::ENOTFOUND),
                EAI::INPROGRESS => return Some(Error::ETIMEOUT),
                EAI::CANCELED => return Some(Error::ECANCELLED),
                EAI::NOTCANCELED => return Some(Error::ECANCELLED),
                _ => {}
            }

            if rc == 0 {
                return None;
            }
            match eai {
                EAI::ADDRFAMILY => Some(Error::EBADFAMILY),
                EAI::BADFLAGS => Some(Error::EBADFLAGS), // Invalid hints
                EAI::FAIL => Some(Error::EBADRESP),
                EAI::FAMILY => Some(Error::EBADFAMILY),
                EAI::MEMORY => Some(Error::ENOMEM),
                EAI::SERVICE => Some(Error::ESERVICE),
                EAI::SYSTEM => Some(Error::ESERVFAIL),
                _ => {
                    // TODO(port): bun.todo(@src(), Error.ENOTIMP)
                    Some(Error::ENOTIMP)
                }
            }
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Error::ENODATA => "DNS_ENODATA",
            Error::EFORMERR => "DNS_EFORMERR",
            Error::ESERVFAIL => "DNS_ESERVFAIL",
            Error::ENOTFOUND => "DNS_ENOTFOUND",
            Error::ENOTIMP => "DNS_ENOTIMP",
            Error::EREFUSED => "DNS_EREFUSED",
            Error::EBADQUERY => "DNS_EBADQUERY",
            Error::EBADNAME => "DNS_ENOTFOUND",
            Error::EBADFAMILY => "DNS_EBADFAMILY",
            Error::EBADRESP => "DNS_EBADRESP",
            Error::ECONNREFUSED => "DNS_ECONNREFUSED",
            Error::ETIMEOUT => "DNS_ETIMEOUT",
            Error::EOF => "DNS_EOF",
            Error::EFILE => "DNS_EFILE",
            Error::ENOMEM => "DNS_ENOMEM",
            Error::EDESTRUCTION => "DNS_EDESTRUCTION",
            Error::EBADSTR => "DNS_EBADSTR",
            Error::EBADFLAGS => "DNS_EBADFLAGS",
            Error::ENONAME => "DNS_ENOTFOUND",
            Error::EBADHINTS => "DNS_EBADHINTS",
            Error::ENOTINITIALIZED => "DNS_ENOTINITIALIZED",
            Error::ELOADIPHLPAPI => "DNS_ELOADIPHLPAPI",
            Error::EADDRGETNETWORKPARAMS => "DNS_EADDRGETNETWORKPARAMS",
            Error::ECANCELLED => "DNS_ECANCELLED",
            Error::ESERVICE => "DNS_ESERVICE",
            Error::ENOSERVER => "DNS_ENOSERVER",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Error::ENODATA => "No data record of requested type",
            Error::EFORMERR => "Malformed DNS query",
            Error::ESERVFAIL => "Server failed to complete the DNS operation",
            Error::ENOTFOUND => "Domain name not found",
            Error::ENOTIMP => "DNS resolver does not implement requested operation",
            Error::EREFUSED => "DNS operation refused",
            Error::EBADQUERY => "Misformatted DNS query",
            Error::EBADNAME => "Misformatted domain name",
            Error::EBADFAMILY => "Misformatted DNS query (family)",
            Error::EBADRESP => "Misformatted DNS reply",
            Error::ECONNREFUSED => "Could not contact DNS servers",
            Error::ETIMEOUT => "Timeout while contacting DNS servers",
            Error::EOF => "End of file",
            Error::EFILE => "Error reading file",
            Error::ENOMEM => "Out of memory",
            Error::EDESTRUCTION => "Channel is being destroyed",
            Error::EBADSTR => "Misformatted string",
            Error::EBADFLAGS => "Illegal flags specified",
            Error::ENONAME => "Given hostname is not numeric",
            Error::EBADHINTS => "Illegal hints flags specified",
            Error::ENOTINITIALIZED => "Library initialization not yet performed",
            Error::ELOADIPHLPAPI => "ELOADIPHLPAPI TODO WHAT DOES THIS MEAN",
            Error::EADDRGETNETWORKPARAMS => "EADDRGETNETWORKPARAMS",
            Error::ECANCELLED => "DNS query cancelled",
            Error::ESERVICE => "Service not available",
            Error::ENOSERVER => "No DNS servers were configured",
        }
    }

    pub fn get(rc: i32) -> Option<Error> {
        // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
        if rc == ARES_ENODATA || rc == ARES_ENONAME {
            return Self::get(ARES_ENOTFOUND);
        }

        if rc == 0 {
            return None;
        }
        // c-ares returns positive ARES_* codes; Node's wrapper sometimes negates.
        // `unsigned_abs` avoids the i32::MIN overflow that `.abs()` would hit.
        let n = rc.unsigned_abs();
        assert!(
            (1..=ARES_ENOSERVER as u32).contains(&n),
            "c-ares status {rc} out of range",
        );
        // SAFETY: `n` is in `1..=ARES_ENOSERVER`; `Error` is `#[repr(i32)]` with
        // contiguous discriminants `1..=ARES_ENOSERVER`.
        Some(unsafe { core::mem::transmute::<i32, Error>(n as i32) })
    }
}

pub const ARES_FLAG_USEVC: c_int = 1 << 0;
pub const ARES_FLAG_PRIMARY: c_int = 1 << 1;
pub const ARES_FLAG_IGNTC: c_int = 1 << 2;
pub const ARES_FLAG_NORECURSE: c_int = 1 << 3;
pub const ARES_FLAG_STAYOPEN: c_int = 1 << 4;
pub const ARES_FLAG_NOSEARCH: c_int = 1 << 5;
pub const ARES_FLAG_NOALIASES: c_int = 1 << 6;
pub const ARES_FLAG_NOCHECKRESP: c_int = 1 << 7;
pub const ARES_FLAG_NO_DFLT_SVR: c_int = 1 << 9;
pub const ARES_FLAG_EDNS: c_int = 1 << 8;
pub const ARES_OPT_FLAGS: c_int = 1 << 0;
pub const ARES_OPT_TIMEOUT: c_int = 1 << 1;
pub const ARES_OPT_TRIES: c_int = 1 << 2;
pub const ARES_OPT_NDOTS: c_int = 1 << 3;
pub const ARES_OPT_UDP_PORT: c_int = 1 << 4;
pub const ARES_OPT_TCP_PORT: c_int = 1 << 5;
pub const ARES_OPT_SERVERS: c_int = 1 << 6;
pub const ARES_OPT_DOMAINS: c_int = 1 << 7;
pub const ARES_OPT_LOOKUPS: c_int = 1 << 8;
pub const ARES_OPT_SOCK_STATE_CB: c_int = 1 << 9;
pub const ARES_OPT_SORTLIST: c_int = 1 << 10;
pub const ARES_OPT_SOCK_SNDBUF: c_int = 1 << 11;
pub const ARES_OPT_SOCK_RCVBUF: c_int = 1 << 12;
pub const ARES_OPT_TIMEOUTMS: c_int = 1 << 13;
pub const ARES_OPT_ROTATE: c_int = 1 << 14;
pub const ARES_OPT_EDNSPSZ: c_int = 1 << 15;
pub const ARES_OPT_NOROTATE: c_int = 1 << 16;
pub const ARES_OPT_RESOLVCONF: c_int = 1 << 17;
pub const ARES_OPT_HOSTS_FILE: c_int = 1 << 18;
pub const ARES_NI_NOFQDN: c_int = 1 << 0;
pub const ARES_NI_NUMERICHOST: c_int = 1 << 1;
pub const ARES_NI_NAMEREQD: c_int = 1 << 2;
pub const ARES_NI_NUMERICSERV: c_int = 1 << 3;
pub const ARES_NI_DGRAM: c_int = 1 << 4;
pub const ARES_NI_TCP: c_int = 0;
pub const ARES_NI_UDP: c_int = ARES_NI_DGRAM;
pub const ARES_NI_SCTP: c_int = 1 << 5;
pub const ARES_NI_DCCP: c_int = 1 << 6;
pub const ARES_NI_NUMERICSCOPE: c_int = 1 << 7;
pub const ARES_NI_LOOKUPHOST: c_int = 1 << 8;
pub const ARES_NI_LOOKUPSERVICE: c_int = 1 << 9;
pub const ARES_NI_IDN: c_int = 1 << 10;
pub const ARES_NI_IDN_ALLOW_UNASSIGNED: c_int = 1 << 11;
pub const ARES_NI_IDN_USE_STD3_ASCII_RULES: c_int = 1 << 12;
pub const ARES_AI_CANONNAME: c_int = 1 << 0;
pub const ARES_AI_NUMERICHOST: c_int = 1 << 1;
pub const ARES_AI_PASSIVE: c_int = 1 << 2;
pub const ARES_AI_NUMERICSERV: c_int = 1 << 3;
pub const ARES_AI_V4MAPPED: c_int = 1 << 4;
pub const ARES_AI_ALL: c_int = 1 << 5;
pub const ARES_AI_ADDRCONFIG: c_int = 1 << 6;
pub const ARES_AI_NOSORT: c_int = 1 << 7;
pub const ARES_AI_ENVHOSTS: c_int = 1 << 8;
pub const ARES_AI_IDN: c_int = 1 << 10;
pub const ARES_AI_IDN_ALLOW_UNASSIGNED: c_int = 1 << 11;
pub const ARES_AI_IDN_USE_STD3_ASCII_RULES: c_int = 1 << 12;
pub const ARES_AI_CANONIDN: c_int = 1 << 13;
pub const ARES_AI_MASK: c_int = (((((ARES_AI_CANONNAME | ARES_AI_NUMERICHOST) | ARES_AI_PASSIVE)
    | ARES_AI_NUMERICSERV)
    | ARES_AI_V4MAPPED)
    | ARES_AI_ALL)
    | ARES_AI_ADDRCONFIG;
pub const ARES_GETSOCK_MAXNUM: c_int = 16;

#[inline]
pub fn ares_getsock_readable(bits: c_int, num: c_int) -> c_int {
    bits & (1 << num)
}
#[inline]
pub fn ares_getsock_writable(bits: c_int, num: c_int) -> c_int {
    bits & (1 << (num + ARES_GETSOCK_MAXNUM))
}

pub const ARES_LIB_INIT_NONE: c_int = 0;
pub const ARES_LIB_INIT_WIN32: c_int = 1 << 0;
pub const ARES_LIB_INIT_ALL: c_int = ARES_LIB_INIT_WIN32;

#[cfg(windows)]
pub const ARES_SOCKET_BAD: ares_socket_t = usize::MAX; // INVALID_SOCKET
#[cfg(not(windows))]
pub const ARES_SOCKET_BAD: ares_socket_t = -1;

pub const ares_socket_typedef: &str = "";
pub type ares_addrinfo_cname = AddrInfo_cname;
pub type ares_addrinfo_node = AddrInfo_node;
pub type ares_addrinfo = AddrInfo;
pub type ares_addrinfo_hints = AddrInfo_hints;
pub type ares_in6_addr = struct_ares_in6_addr;
pub type ares_addrttl = struct_ares_addrttl;
pub type ares_addr6ttl = struct_ares_addr6ttl;
pub type ares_caa_reply = struct_ares_caa_reply;
pub type ares_srv_reply = struct_ares_srv_reply;
pub type ares_mx_reply = struct_ares_mx_reply;
pub type ares_txt_reply = struct_ares_txt_reply;
pub type ares_txt_ext = struct_ares_txt_ext;
pub type ares_naptr_reply = struct_ares_naptr_reply;
pub type ares_soa_reply = struct_ares_soa_reply;
pub type ares_uri_reply = struct_ares_uri_reply;
pub type ares_addr_node = struct_ares_addr_node;
pub type ares_addr_port_node = struct_ares_addr_port_node;

// Bun__canonicalizeIP_ host fn: see bun_runtime::dns_jsc::cares_jsc

/// Creates a sockaddr structure from an address, port.
///
/// # Parameters
/// - `addr`: A byte slice representing the IP address.
/// - `port`: A 16-bit unsigned integer representing the port number.
/// - `sa`: A pointer to a sockaddr structure where the result will be stored.
///
/// # Returns
///
/// This function returns 0 on success.
pub fn get_sockaddr(addr: &[u8], port: u16, sa: &mut sockaddr) -> c_int {
    const BUF_SIZE: usize = 128;

    let mut buf = [0u8; BUF_SIZE];
    if addr.is_empty() || addr.len() >= BUF_SIZE {
        return -1;
    }
    let addr_ptr = copy_nul_terminated(&mut buf, addr);

    {
        // SAFETY: caller-provided sockaddr storage; reinterpreting as sockaddr_in.
        let in_: &mut sockaddr_in =
            unsafe { &mut *std::ptr::from_mut::<sockaddr>(sa).cast::<sockaddr_in>() };
        if unsafe { ares_inet_pton(AF::INET, addr_ptr, (&raw mut in_.sin_addr).cast::<c_void>()) }
            == 1
        {
            in_.sin_family = AF::INET as _;
            in_.sin_port = port.to_be();
            return 0;
        }
    }
    {
        // SAFETY: caller-provided sockaddr storage; reinterpreting as sockaddr_in6.
        let in6: &mut sockaddr_in6 =
            unsafe { &mut *std::ptr::from_mut::<sockaddr>(sa).cast::<sockaddr_in6>() };
        if unsafe {
            ares_inet_pton(
                AF::INET6,
                addr_ptr,
                (&raw mut in6.sin6_addr).cast::<c_void>(),
            )
        } == 1
        {
            in6.sin6_family = AF::INET6 as _;
            in6.sin6_port = port.to_be();
            return 0;
        }
    }

    -1
}

// Zig: `struct_in_addr = std.posix.sockaddr.in` — note this aliases the full
// sockaddr_in (not the 4-byte in_addr). Preserved for ABI parity in `Options.servers`.
// TODO(port): verify against c-ares header; this looks like a Zig-side misnomer.
type in_addr = sockaddr_in;
#[allow(dead_code)]
type struct_sockaddr = sockaddr;

// ported from: src/cares_sys/c_ares.zig
