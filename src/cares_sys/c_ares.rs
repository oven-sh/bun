#![allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    clippy::missing_safety_doc
)]

#[cfg(windows)]
use core::ffi::c_short;
use core::ffi::{c_char, c_int, c_uint, c_ushort, c_void};
use core::marker::PhantomData;
use core::net::IpAddr;
use core::ptr::{self, NonNull};

use bun_core::CStrRef;

#[cfg(windows)]
use crate::winsock::{sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage, socklen_t};
#[cfg(not(windows))]
use libc::{sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage, socklen_t};

pub type ares_socklen_t = socklen_t;

#[cfg(windows)]
pub type ares_socket_t = usize; // Windows `SOCKET` is `UINT_PTR` (integer, not a pointer).
#[cfg(not(windows))]
pub type ares_socket_t = c_int;

type ares_sock_state_cb = Option<unsafe extern "C" fn(*mut c_void, ares_socket_t, c_int, c_int)>;

bun_opaque::opaque_ffi! {
    /// Nomicon opaque-FFI pattern. `UnsafeCell` makes the type `!Freeze` so a
    /// shared reference does not assert immutability of the C-owned state.
    pub struct struct_apattern;
}

/// Only the address families c-ares
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

/// `EAI_*` getaddrinfo error codes. The `libc` crate is missing
/// `EAI_ADDRFAMILY` and the glibc-only async-getaddrinfo extensions, so we
/// hardcode those raw values from `<netdb.h>`.
#[cfg(not(windows))]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct EAI(c_int);

#[cfg(not(windows))]
impl EAI {
    #[inline]
    pub(crate) const fn from_raw(rc: i32) -> Self {
        Self(rc as c_int)
    }

    #[cfg(target_os = "linux")]
    pub(crate) const ADDRFAMILY: Self = Self(-9);
    #[cfg(not(target_os = "linux"))]
    pub(crate) const ADDRFAMILY: Self = Self(1);

    pub(crate) const AGAIN: Self = Self(libc::EAI_AGAIN);
    pub(crate) const BADFLAGS: Self = Self(libc::EAI_BADFLAGS);
    pub(crate) const FAIL: Self = Self(libc::EAI_FAIL);
    pub(crate) const FAMILY: Self = Self(libc::EAI_FAMILY);
    pub(crate) const MEMORY: Self = Self(libc::EAI_MEMORY);
    // RFC 3493 dropped EAI_NODATA; FreeBSD's <netdb.h> only exposes it under
    // __BSD_VISIBLE (historical value 7) and the libc crate omits it entirely.
    #[cfg(not(any(target_os = "freebsd", target_os = "dragonfly")))]
    pub(crate) const NODATA: Self = Self(libc::EAI_NODATA);
    #[cfg(any(target_os = "freebsd", target_os = "dragonfly"))]
    pub(crate) const NODATA: Self = Self(7);
    pub(crate) const NONAME: Self = Self(libc::EAI_NONAME);
    pub(crate) const SERVICE: Self = Self(libc::EAI_SERVICE);
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) const SOCKTYPE: Self = Self(libc::EAI_SOCKTYPE);
    pub(crate) const SYSTEM: Self = Self(libc::EAI_SYSTEM);

    // glibc-only `getaddrinfo_a` / IDN extensions (absent on musl, bionic).
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub(crate) const INPROGRESS: Self = Self(-100);
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub(crate) const CANCELED: Self = Self(-101);
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub(crate) const NOTCANCELED: Self = Self(-102);
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub(crate) const ALLDONE: Self = Self(-103);
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub(crate) const IDN_ENCODE: Self = Self(-105);
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

// Values are only ever
// constructed in Rust and passed *to* C, so a plain repr(i32) enum is sound.
// If c-ares ever returns an NSType, this must become a transparent newtype.
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
    pub(crate) retry_chance: c_ushort,
    pub(crate) retry_delay: usize,
}

type ares_evsys_t = c_uint;

#[repr(C)]
pub struct Options {
    pub(crate) flags: c_int,
    pub(crate) timeout: c_int,
    pub(crate) tries: c_int,
    pub(crate) ndots: c_int,
    pub(crate) udp_port: c_ushort,
    pub(crate) tcp_port: c_ushort,
    pub(crate) socket_send_buffer_size: c_int,
    pub(crate) socket_receive_buffer_size: c_int,
    pub(crate) servers: *mut in_addr,
    pub(crate) nservers: c_int,
    pub(crate) domains: *mut *mut c_char,
    pub(crate) ndomains: c_int,
    pub(crate) lookups: *mut c_char,
    pub(crate) sock_state_cb: ares_sock_state_cb,
    pub(crate) sock_state_cb_data: *mut c_void,
    pub(crate) sortlist: *mut struct_apattern,
    pub(crate) nsort: c_int,
    pub(crate) ednspsz: c_int,
    pub(crate) resolvconf_path: *mut c_char,
    pub(crate) hosts_path: *mut c_char,
    pub(crate) udp_max_queries: c_int,
    pub(crate) maxtimeout: c_int,
    pub(crate) qcache_max_ttl: c_uint,
    pub(crate) evsys: ares_evsys_t,
    pub(crate) server_failover_opts: struct_ares_server_failover_options,
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

/// `get` shortens the lifetime of `$data`, which `Deref` cannot.
///
/// # Safety
/// The module only makes a `$name` from a valid `$data` that stays live until `$free` is called on it.
macro_rules! owned_data {
    ($($v:vis struct $name:ident($data:ident) => unsafe $free:ident;)+) => {$(
        #[repr(transparent)]
        $v struct $name(NonNull<$data<'static>>);

        impl $name {
            $v fn get(&self) -> &$data<'_> {
                // SAFETY: the contract of `owned_data!`.
                unsafe { self.0.as_ref() }
            }
        }

        impl Drop for $name {
            fn drop(&mut self) {
                // SAFETY: the contract of `owned_data!`.
                unsafe { $free(self.0.as_ptr().cast()) };
            }
        }
    )+};
}

// SAFETY: only c-ares makes one, and a parser fails rather than leave a `CStrRef` null.
owned_data! {
    pub struct OwnedHostent(struct_hostent) => unsafe ares_free_hostent;
    struct OwnedAddrInfo(AddrInfo) => unsafe ares_freeaddrinfo;
    pub struct OwnedCaaReply(struct_ares_caa_reply) => unsafe ares_free_data;
    pub struct OwnedSrvReply(struct_ares_srv_reply) => unsafe ares_free_data;
    pub struct OwnedMxReply(struct_ares_mx_reply) => unsafe ares_free_data;
    pub struct OwnedTxtReply(struct_ares_txt_reply) => unsafe ares_free_data;
    pub struct OwnedNaptrReply(struct_ares_naptr_reply) => unsafe ares_free_data;
    pub struct OwnedSoaReply(struct_ares_soa_reply) => unsafe ares_free_data;
    struct OwnedAddrPortNode(struct_ares_addr_port_node) => unsafe ares_free_data;
}

/// Iterator over a C array of pointers that ends with null. The array can be null.
#[repr(transparent)]
#[derive(Clone)]
struct NullTerminated<'a, T>(Option<NonNull<Option<T>>>, PhantomData<&'a T>);

impl<T: Copy> Iterator for NullTerminated<'_, T> {
    type Item = T;

    fn next(&mut self) -> Option<T> {
        let current = self.0?;
        // SAFETY: only c-ares makes one, so `current` is in the array, and so is what follows a `Some`.
        unsafe {
            let item = current.read()?;
            self.0 = Some(current.add(1));
            Some(item)
        }
    }
}

// hostent in glibc uses int for h_addrtype and h_length, whereas hostent in
// winsock2.h uses short.
#[cfg(windows)]
type hostent_int = c_short;
#[cfg(not(windows))]
type hostent_int = c_int;

#[repr(C)]
pub struct struct_hostent<'a> {
    pub h_name: Option<CStrRef<'a>>,
    h_aliases: NullTerminated<'a, CStrRef<'a>>,
    h_addrtype: hostent_int,
    h_length: hostent_int,
    h_addr_list: NullTerminated<'a, NonNull<u8>>,
}

// ─── callback-wrapper note ─────────────────────────────────────────────────
// Rust cannot take a fn pointer as a const generic on
// stable, so the wrappers below are expressed as a trait: the implementing
// type provides the callback as a trait method, and the `extern "C"` thunk is
// monomorphized per `T: Trait`.
// ──────────────────────────────────────────────────────────────────────────

pub trait HostentHandler: Sized + 'static {
    fn on_hostent(self: Box<Self>, result: Result<&struct_hostent<'_>, Error>);
}

impl<'a> struct_hostent<'a> {
    // toJSResponse alias deleted — lives in bun_runtime::dns_jsc (extension trait).

    pub fn aliases(&self) -> impl Iterator<Item = CStrRef<'a>> + Clone + use<'a> {
        self.h_aliases.clone()
    }

    pub fn addresses(&self) -> impl Iterator<Item = IpAddr> + Clone + use<'a> {
        let is_ipv6 = self.h_addrtype == AF::INET6 as hostent_int;
        self.h_addr_list.clone().map(move |addr| {
            // SAFETY: c-ares only lists addresses for `AF_INET6` (16 bytes) and `AF_INET` (4 bytes).
            unsafe {
                if is_ipv6 {
                    addr.cast::<[u8; 16]>().read().into()
                } else {
                    addr.cast::<[u8; 4]>().read().into()
                }
            }
        })
    }

    unsafe extern "C" fn host_callback_wrapper<T: HostentHandler>(
        ctx: *mut c_void,
        status: c_int,
        _timeouts: c_int,
        hostent: Option<&struct_hostent<'_>>,
    ) {
        // SAFETY: `ctx` is the box that `Channel` released for this query, which c-ares answers once.
        let this = unsafe { bun_core::heap::take(ctx.cast::<T>()) };
        this.on_hostent(Error::check(status).and_then(|()| hostent.ok_or(Error::ENOTFOUND)));
    }
}

/// The `alen` argument of `ares_parse_*_reply`.
fn alen(abuf: &[u8]) -> c_int {
    c_int::try_from(abuf.len()).unwrap_or(c_int::MAX)
}

impl OwnedHostent {
    pub fn parse_cname(buffer: &[u8]) -> Result<Option<Self>, Error> {
        let mut host = None;
        // SAFETY: c-ares FFI; it reads `alen` bytes of `buffer`, and null asks for no TTLs.
        // A failure leaves `host` null.
        Error::check(unsafe {
            ares_parse_a_reply(
                buffer.as_ptr(),
                alen(buffer),
                &mut host,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        })?;
        Ok(host)
    }

    pub fn parse_ptr(buffer: &[u8]) -> Result<Option<Self>, Error> {
        let mut host = None;
        // SAFETY: c-ares FFI; it reads `alen` bytes of `buffer`, and null adds no address.
        // A failure leaves `host` null.
        Error::check(unsafe {
            ares_parse_ptr_reply(
                buffer.as_ptr(),
                alen(buffer),
                ptr::null(),
                0,
                AF::INET,
                &mut host,
            )
        })?;
        Ok(host)
    }
}

pub struct hostent_with_ttls {
    pub hostent: OwnedHostent,
    pub ttls: [c_int; 256],
}

impl hostent_with_ttls {
    // toJSResponse alias deleted — lives in bun_runtime::dns_jsc.

    pub fn parse_a(buffer: &[u8]) -> Result<Box<hostent_with_ttls>, Error> {
        let mut host = None;
        let mut addrttls = [struct_ares_addrttl::default(); 256];
        let mut naddrttls: c_int = 256;
        // SAFETY: c-ares FFI; it reads `alen` bytes of `buffer` and writes at most `naddrttls` TTLs.
        // A failure leaves `host` null.
        Error::check(unsafe {
            ares_parse_a_reply(
                buffer.as_ptr(),
                alen(buffer),
                &mut host,
                addrttls.as_mut_ptr(),
                &raw mut naddrttls,
            )
        })?;
        let mut with_ttls = Self::new(host)?;
        for (i, ttl) in addrttls[..usize::try_from(naddrttls).expect("int cast")]
            .iter()
            .enumerate()
        {
            with_ttls.ttls[i] = ttl.ttl;
        }
        Ok(with_ttls)
    }

    pub fn parse_aaaa(buffer: &[u8]) -> Result<Box<hostent_with_ttls>, Error> {
        let mut host = None;
        let mut addr6ttls = [struct_ares_addr6ttl::default(); 256];
        let mut naddr6ttls: c_int = 256;
        // SAFETY: c-ares FFI; it reads `alen` bytes of `buffer` and writes at most `naddr6ttls` TTLs.
        // A failure leaves `host` null.
        Error::check(unsafe {
            ares_parse_aaaa_reply(
                buffer.as_ptr(),
                alen(buffer),
                &mut host,
                addr6ttls.as_mut_ptr(),
                &raw mut naddr6ttls,
            )
        })?;
        let mut with_ttls = Self::new(host)?;
        for (i, ttl) in addr6ttls[..usize::try_from(naddr6ttls).expect("int cast")]
            .iter()
            .enumerate()
        {
            with_ttls.ttls[i] = ttl.ttl;
        }
        Ok(with_ttls)
    }

    fn new(hostent: Option<OwnedHostent>) -> Result<Box<Self>, Error> {
        Ok(Box::new(Self {
            hostent: hostent.ok_or(Error::ENOTFOUND)?,
            ttls: [-1; 256],
        }))
    }
}

pub struct struct_nameinfo<'a> {
    pub node: Option<CStrRef<'a>>,
    pub service: Option<CStrRef<'a>>,
}

pub trait NameinfoHandler: Sized + 'static {
    fn on_nameinfo(self: Box<Self>, result: Result<struct_nameinfo<'_>, Error>);
}

impl struct_nameinfo<'_> {
    // toJSResponse alias deleted — lives in bun_runtime::dns_jsc.

    unsafe extern "C" fn callback_wrapper<T: NameinfoHandler>(
        ctx: *mut c_void,
        status: c_int,
        _timeouts: c_int,
        node: Option<CStrRef<'_>>,
        service: Option<CStrRef<'_>>,
    ) {
        // SAFETY: `ctx` is the box that `Channel` released for this query, which c-ares answers once.
        let this = unsafe { bun_core::heap::take(ctx.cast::<T>()) };
        this.on_nameinfo(Error::check(status).map(|()| struct_nameinfo { node, service }));
    }
}

bun_opaque::opaque_ffi! { pub struct struct_Channeldata; }

#[repr(C)]
struct AddrInfo_cname<'a> {
    ttl: c_int,
    alias: Option<CStrRef<'a>>,
    name: Option<CStrRef<'a>>,
    next: Option<&'a Self>,
}

#[repr(C)]
pub struct AddrInfo_node<'a> {
    pub ttl: c_int,
    flags: c_int,
    family: c_int,
    socktype: c_int,
    protocol: c_int,
    addrlen: ares_socklen_t,
    addr: *mut sockaddr,
    next: Option<&'a Self>,
}

impl AddrInfo_node<'_> {
    pub fn address_bytes(&self) -> &[u8] {
        // SAFETY: `ares_append_ai_node`, which makes every node, initializes `addrlen` bytes at `addr`.
        unsafe { core::slice::from_raw_parts(self.addr.cast::<u8>(), self.addrlen as usize) }
    }
}

#[repr(C)]
pub struct AddrInfo<'a> {
    cnames_: Option<&'a AddrInfo_cname<'a>>,
    node: Option<&'a AddrInfo_node<'a>>,
    name_: Option<CStrRef<'a>>,
}

pub trait AddrInfoHandler: Sized + 'static {
    fn on_addr_info(self: Box<Self>, result: Result<&AddrInfo<'_>, Error>);
}

impl<'a> AddrInfo<'a> {
    // toJSArray alias deleted — lives in bun_runtime::dns_jsc.

    pub fn nodes(&self) -> impl Iterator<Item = &'a AddrInfo_node<'a>> {
        core::iter::successors(self.node, |current| current.next)
    }

    unsafe extern "C" fn callback_wrapper<T: AddrInfoHandler>(
        ctx: *mut c_void,
        status: c_int,
        _timeouts: c_int,
        addr_info: Option<OwnedAddrInfo>,
    ) {
        // SAFETY: `ctx` is the box that `Channel` released for this query, which c-ares answers once.
        let this = unsafe { bun_core::heap::take(ctx.cast::<T>()) };
        // A failure comes without an `addr_info`.
        let result = Error::check(status).and_then(|()| addr_info.ok_or(Error::ENOTFOUND));
        this.on_addr_info(result.as_ref().map(OwnedAddrInfo::get).map_err(|&err| err));
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
bun_core::impl_zeroable!(AddrInfo_hints);

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

/// Implemented by the type that holds an [`OwnedChannel`] and receives socket-
/// state callbacks.
///
/// R-2: methods take `&self`. The c-ares `sock_state_cb` re-enters the
/// container while a `&self` borrow may already be live in `on_dns_poll`;
/// the implementor routes mutation through interior mutability.
pub trait ChannelContainer: Sized {
    fn on_dns_socket_state(&self, socket: ares_socket_t, readable: bool, writable: bool);
}

/// Trait for `Channel::resolve`: ties a lookup-name string to its NSType.
/// The dns_jsc consumer impls it per (T, record-type).
pub trait ResolveHandler: Sized + 'static {
    const LOOKUP_NAME: &'static [u8];
    const NS_TYPE: NSType;
    /// `Ok` is the DNS message, for one of the `parse` functions.
    fn on_reply(self: Box<Self>, result: Result<&[u8], Error>);
}

unsafe extern "C" fn ares_reply_callback<T: ResolveHandler>(
    ctx: *mut c_void,
    status: c_int,
    _timeouts: c_int,
    buffer: *mut u8,
    buffer_length: c_int,
) {
    // SAFETY: `ctx` is the box that `Channel` released for this query, which c-ares answers once.
    let this = unsafe { bun_core::heap::take(ctx.cast::<T>()) };
    this.on_reply(Error::check(status).map(|()| {
        // SAFETY: c-ares lends `buffer_length` bytes at `buffer` until this returns.
        unsafe { bun_core::ffi::slice(buffer, usize::try_from(buffer_length).unwrap_or(0)) }
    }));
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

/// Dropping it fails every pending query into its callback and closes its sockets.
pub struct OwnedChannel(ptr::NonNull<Channel>);

impl Drop for OwnedChannel {
    fn drop(&mut self) {
        // SAFETY: from `ares_init_options`, destroyed once.
        unsafe { ares_destroy(self.as_ptr()) };
    }
}

/// The list that `ares_get_servers_ports` allocated.
pub struct Servers(Option<OwnedAddrPortNode>);

impl Servers {
    pub fn iter(&self) -> impl Iterator<Item = &struct_ares_addr_port_node<'_>> {
        let head = self.0.as_ref().map(OwnedAddrPortNode::get);
        core::iter::successors(head, |current| current.next)
    }
}

impl OwnedChannel {
    pub fn as_ptr(&self) -> *mut Channel {
        self.0.as_ptr()
    }

    /// # Safety
    /// `this` stays in place and outlives the channel.
    pub unsafe fn new<C: ChannelContainer>(
        this: &C,
        options: ChannelOptions,
    ) -> Result<Self, Error> {
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

        let mut opts = Options {
            // Android note: c-ares can't auto-discover servers (no /etc/resolv.conf,
            // no JNI), so it falls back to 127.0.0.1 and queries time out. We do
            // NOT set ARES_FLAG_NO_DFLT_SVR here — that makes init fail with
            // ENOSERVER, which breaks dns.setServers() (it needs an initialized
            // channel to call ares_set_servers_ports). Letting the 127.0.0.1
            // default stand means setServers() works as the documented workaround.
            flags: ARES_FLAG_NOCHECKRESP,
            sock_state_cb: Some(on_sock_state::<C>),
            // R-2: `*mut` spelling is signature-only (c-ares stores a `void*`); the
            // callback derefs as shared (`&*const`) and the implementor mutates via
            // interior mutability.
            sock_state_cb_data: std::ptr::from_ref::<C>(this).cast_mut().cast::<c_void>(),
            timeout: options.timeout.unwrap_or(-1),
            tries: options.tries.unwrap_or(4),
            ..Default::default()
        };

        let optmask: c_int =
            ARES_OPT_FLAGS | ARES_OPT_TIMEOUTMS | ARES_OPT_SOCK_STATE_CB | ARES_OPT_TRIES;

        // c-ares creates its sockets with ws2_32 directly, and libuv initializes Winsock lazily.
        #[cfg(windows)]
        bun_libuv_sys::uv__winsock_ensure();
        // SAFETY: c-ares FFI; opts/channel are valid stack pointers.
        let rc = unsafe { ares_init_options(&raw mut channel, &raw mut opts, optmask) };
        if let Some(err) = Error::get(rc) {
            // Don't `ares_library_cleanup()` here: `library_init()` is `run_once!`, so
            // tearing down the library on a per-channel failure would leave every later
            // `OwnedChannel::new()` running against an uninitialized c-ares.
            return Err(err);
        }

        Ok(Self(ptr::NonNull::from(Channel::opaque_mut(channel))))
    }
}

impl Channel {
    pub fn servers(&mut self) -> Result<Servers, Error> {
        let mut servers = None;
        // SAFETY: c-ares FFI; `servers` is a stack out-param, which a failure leaves null.
        Error::check(unsafe { ares_get_servers_ports(self, &mut servers) })?;
        Ok(Servers(servers))
    }

    /// `None` clears the list.
    pub fn set_servers(
        &mut self,
        servers: Option<&struct_ares_addr_port_node<'_>>,
    ) -> Result<(), Error> {
        // SAFETY: c-ares FFI; it copies the list.
        Error::check(unsafe { ares_set_servers_ports(self, servers) })
    }

    /// See c-ares `ares_getaddrinfo` documentation.
    pub fn get_addr_info<T: AddrInfoHandler>(
        &mut self,
        host: &[u8],
        port: u16,
        hints: &[AddrInfo_hints],
        ctx: Box<T>,
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
        // SAFETY: c-ares FFI; host/port/hints are NUL-terminated stack buffers or null; the thunk takes `ctx` back.
        unsafe {
            ares_getaddrinfo(
                self,
                host_ptr,
                port_ptr,
                hints_,
                AddrInfo::callback_wrapper::<T>,
                bun_core::heap::into_raw(ctx).cast::<c_void>(),
            );
        }
    }

    pub fn resolve<T: ResolveHandler>(&mut self, name: &[u8], ctx: Box<T>) {
        if name.len() >= 1023
            || bun_core::strings::contains_char(name, 0)
            || (name.is_empty() && !(T::LOOKUP_NAME == b"ns" || T::LOOKUP_NAME == b"soa"))
        {
            return ctx.on_reply(Err(Error::EBADNAME));
        }

        let mut name_buf = [0u8; 1024];
        let name_ptr = copy_nul_terminated(&mut name_buf, name);

        // SAFETY: c-ares FFI; name_ptr is a NUL-terminated stack buffer; the thunk takes `ctx` back.
        unsafe {
            ares_query(
                self,
                name_ptr,
                NSClass::ns_c_in,
                T::NS_TYPE,
                Some(ares_reply_callback::<T>),
                bun_core::heap::into_raw(ctx).cast::<c_void>(),
            );
        }
    }

    pub fn get_host_by_addr<T: HostentHandler>(&mut self, ip_addr: &[u8], ctx: Box<T>) {
        // "0000:0000:0000:0000:0000:ffff:192.168.100.228".length = 45
        const BUF_SIZE: usize = 46;
        let mut addr_buf = [0u8; BUF_SIZE];
        let text =
            bun_core::strings::copy_z(&mut addr_buf, ip_addr).filter(|text| !text.is_empty());

        let (v4, v6);
        let (addr, family): (&[u8], c_int) = if let Some(addr) = text.and_then(crate::pton::<4>) {
            v4 = addr;
            (&v4, AF::INET)
        } else if let Some(addr) = text.and_then(crate::pton::<16>) {
            v6 = addr;
            (&v6, AF::INET6)
        } else {
            return ctx.on_hostent(Err(Error::ENOTIMP));
        };
        // SAFETY: c-ares FFI; `addr` has the size of an address of `family`; the thunk takes `ctx` back.
        unsafe {
            ares_gethostbyaddr(
                self,
                addr.as_ptr().cast::<c_void>(),
                addr.len() as c_int,
                family,
                Some(struct_hostent::host_callback_wrapper::<T>),
                bun_core::heap::into_raw(ctx).cast::<c_void>(),
            );
        }
    }

    /// https://c-ares.org/ares_getnameinfo.html
    pub fn get_name_info<T: NameinfoHandler>(&mut self, sa: &sockaddr_storage, ctx: Box<T>) {
        let salen: ares_socklen_t = if sa.ss_family == AF::INET as _ {
            core::mem::size_of::<sockaddr_in>() as ares_socklen_t
        } else {
            core::mem::size_of::<sockaddr_in6>() as ares_socklen_t
        };
        // SAFETY: c-ares FFI; sa is a valid sockaddr of size `salen`; the thunk takes `ctx` back.
        unsafe {
            ares_getnameinfo(
                self,
                std::ptr::from_ref::<sockaddr_storage>(sa).cast::<sockaddr>(),
                salen,
                // node returns ENOTFOUND for addresses like 255.255.255.255:80
                // So, it requires setting the ARES_NI_NAMEREQD flag
                ARES_NI_NAMEREQD | ARES_NI_LOOKUPHOST | ARES_NI_LOOKUPSERVICE,
                Some(struct_nameinfo::callback_wrapper::<T>),
                bun_core::heap::into_raw(ctx).cast::<c_void>(),
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

type ares_callback = Option<unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int)>;
type ares_host_callback =
    Option<unsafe extern "C" fn(*mut c_void, c_int, c_int, Option<&struct_hostent<'_>>)>;
type ares_nameinfo_callback = Option<
    unsafe extern "C" fn(*mut c_void, c_int, c_int, Option<CStrRef<'_>>, Option<CStrRef<'_>>),
>;
type ares_addrinfo_callback =
    unsafe extern "C" fn(*mut c_void, c_int, c_int, Option<OwnedAddrInfo>);

unsafe extern "C" {
    fn ares_library_init_mem(
        flags: c_int,
        amalloc: Option<unsafe extern "C" fn(usize) -> *mut c_void>,
        afree: Option<unsafe extern "C" fn(*mut c_void)>,
        arealloc: Option<unsafe extern "C" fn(*mut c_void, usize) -> *mut c_void>,
    ) -> c_int;
    pub fn ares_init_options(
        channelptr: *mut *mut Channel,
        options: *mut Options,
        optmask: c_int,
    ) -> c_int;
    fn ares_destroy(channel: *mut Channel);
    // Opaque handle by exclusive reference only — `Channel` is `!Freeze`/`!Sync`
    // (UnsafeCell + PhantomData<*mut u8>). Note: `ares_cancel`/`ares_process_fd`
    // synchronously invoke stored completion callbacks which may re-enter the
    // resolver and re-derive a `&mut Channel` from a raw pointer; this is sound
    // because `Channel` is a ZST (`UnsafeCell<[u8;0]>`), so `&mut Channel`
    // claims zero bytes and overlapping `&mut` do not conflict under Stacked
    // Borrows — the borrow checker does NOT gate the raw-pointer callbacks.
    pub safe fn ares_cancel(channel: &mut Channel);
    pub safe fn ares_set_local_ip4(channel: &mut Channel, local_ip: c_uint);
    pub safe fn ares_set_local_ip6(channel: &mut Channel, local_ip6: &[u8; 16]);
    fn ares_getaddrinfo(
        channel: *mut Channel,
        node: *const c_char,
        service: *const c_char,
        hints: *const AddrInfo_hints,
        callback: ares_addrinfo_callback,
        arg: *mut c_void,
    );
    fn ares_freeaddrinfo(ai: *mut AddrInfo<'_>);
}

unsafe extern "C" {
    fn ares_query(
        channel: *mut Channel,
        name: *const c_char,
        dnsclass: NSClass,
        type_: NSType,
        callback: ares_callback,
        arg: *mut c_void,
    );
    fn ares_gethostbyaddr(
        channel: *mut Channel,
        addr: *const c_void,
        addrlen: c_int,
        family: c_int,
        callback: ares_host_callback,
        arg: *mut c_void,
    );
    fn ares_getnameinfo(
        channel: *mut Channel,
        sa: *const sockaddr,
        salen: ares_socklen_t,
        flags: c_int,
        callback: ares_nameinfo_callback,
        arg: *mut c_void,
    );
    // Opaque handle by exclusive reference + scalars only.
    pub safe fn ares_process_fd(
        channel: &mut Channel,
        read_fd: ares_socket_t,
        write_fd: ares_socket_t,
    );
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
struct struct_ares_in6_addr {
    _S6_un: union_unnamed_2,
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
struct struct_ares_addrttl {
    ipaddr: u32,
    ttl: c_int,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct struct_ares_addr6ttl {
    ip6addr: struct_ares_in6_addr,
    ttl: c_int,
}

bun_core::impl_zeroable!(struct_ares_addr6ttl);
impl Default for struct_ares_addr6ttl {
    #[inline]
    fn default() -> Self {
        bun_core::ffi::zeroed()
    }
}

/// For the `ares_parse_*_reply` functions that take `(abuf, alen, out)`.
macro_rules! impl_parse {
    ($($name:ident::$method:ident => $parse:ident;)+) => {$(
        impl $name {
            pub fn $method(buffer: &[u8]) -> Result<Option<Self>, Error> {
                let mut reply = None;
                // SAFETY: c-ares FFI; it reads `alen` bytes of `buffer`. A failure leaves `reply` null.
                Error::check(unsafe { $parse(buffer.as_ptr(), alen(buffer), &mut reply) })?;
                Ok(reply)
            }
        }
    )+};
}

impl_parse! {
    OwnedHostent::parse_ns => ares_parse_ns_reply;
    OwnedCaaReply::parse => ares_parse_caa_reply;
    OwnedSrvReply::parse => ares_parse_srv_reply;
    OwnedMxReply::parse => ares_parse_mx_reply;
    OwnedTxtReply::parse => ares_parse_txt_reply;
    OwnedNaptrReply::parse => ares_parse_naptr_reply;
    OwnedSoaReply::parse => ares_parse_soa_reply;
}

#[repr(C)]
pub struct struct_ares_caa_reply<'a> {
    pub next: Option<&'a Self>,
    pub critical: c_int,
    property: *mut u8,
    plength: usize,
    value: *mut u8,
    length: usize,
}

impl struct_ares_caa_reply<'_> {
    /// Safe view of the c-ares-owned property tag bytes.
    #[inline]
    pub fn property_bytes(&self) -> &[u8] {
        if self.property.is_null() {
            &[]
        } else {
            // SAFETY: c-ares allocates `property` as a contiguous buffer of
            // `plength` bytes that lives until `ares_free_data` is called on the
            // list head; the `&self` borrow is shorter than that. c-ares never
            // sets a non-zero length with a null pointer.
            unsafe { core::slice::from_raw_parts(self.property, self.plength) }
        }
    }
    /// Safe view of the c-ares-owned value bytes.
    #[inline]
    pub fn value_bytes(&self) -> &[u8] {
        if self.value.is_null() {
            &[]
        } else {
            // SAFETY: same invariant as `property_bytes` — `value` points to
            // `length` bytes owned by the reply node for `&self`'s lifetime.
            unsafe { core::slice::from_raw_parts(self.value, self.length) }
        }
    }
}

#[repr(C)]
pub struct struct_ares_srv_reply<'a> {
    pub next: Option<&'a Self>,
    pub host: CStrRef<'a>,
    pub priority: c_ushort,
    pub weight: c_ushort,
    pub port: c_ushort,
}

#[repr(C)]
pub struct struct_ares_mx_reply<'a> {
    pub next: Option<&'a Self>,
    pub host: CStrRef<'a>,
    pub priority: c_ushort,
}

#[repr(C)]
pub struct struct_ares_txt_reply<'a> {
    pub next: Option<&'a Self>,
    txt: *mut u8,
    length: usize,
}

impl struct_ares_txt_reply<'_> {
    /// Safe view of the c-ares-owned TXT record bytes.
    #[inline]
    pub fn txt_bytes(&self) -> &[u8] {
        if self.txt.is_null() {
            &[]
        } else {
            // SAFETY: c-ares allocates `txt` as `length` bytes that live until
            // `ares_free_data` on the list head; `&self` is the shorter borrow.
            unsafe { core::slice::from_raw_parts(self.txt, self.length) }
        }
    }
}

#[repr(C)]
pub struct struct_ares_naptr_reply<'a> {
    pub next: Option<&'a Self>,
    pub flags: CStrRef<'a>,
    pub service: CStrRef<'a>,
    pub regexp: CStrRef<'a>,
    pub replacement: CStrRef<'a>,
    pub order: c_ushort,
    pub preference: c_ushort,
}

#[repr(C)]
pub struct struct_ares_soa_reply<'a> {
    pub nsname: CStrRef<'a>,
    pub hostmaster: CStrRef<'a>,
    pub serial: c_uint,
    pub refresh: c_uint,
    pub retry: c_uint,
    pub expire: c_uint,
    pub minttl: c_uint,
}

pub struct struct_any_reply {
    pub a_reply: Option<Box<hostent_with_ttls>>,
    pub aaaa_reply: Option<Box<hostent_with_ttls>>,
    pub mx_reply: Option<OwnedMxReply>,
    pub ns_reply: Option<OwnedHostent>,
    pub txt_reply: Option<OwnedTxtReply>,
    pub srv_reply: Option<OwnedSrvReply>,
    pub ptr_reply: Option<OwnedHostent>,
    pub naptr_reply: Option<OwnedNaptrReply>,
    pub soa_reply: Option<OwnedSoaReply>,
    pub caa_reply: Option<OwnedCaaReply>,
}

impl struct_any_reply {
    // toJSResponse / toJS aliases deleted.

    /// Parse a DNS `ANY` reply buffer. Returns
    /// the last per-record parse error if no record type parsed successfully.
    pub fn parse(buffer: &[u8]) -> Result<Self, Error> {
        let a = hostent_with_ttls::parse_a(buffer);
        let aaaa = hostent_with_ttls::parse_aaaa(buffer);
        let mx = OwnedMxReply::parse(buffer);
        let ns = OwnedHostent::parse_ns(buffer);
        let txt = OwnedTxtReply::parse(buffer);
        let srv = OwnedSrvReply::parse(buffer);
        let ptr = OwnedHostent::parse_ptr(buffer);
        let naptr = OwnedNaptrReply::parse(buffer);
        let soa = OwnedSoaReply::parse(buffer);
        let caa = OwnedCaaReply::parse(buffer);

        if let (
            Err(_),
            Err(_),
            Err(_),
            Err(_),
            Err(_),
            Err(_),
            Err(_),
            Err(_),
            Err(_),
            Err(last_error),
        ) = (&a, &aaaa, &mx, &ns, &txt, &srv, &ptr, &naptr, &soa, &caa)
        {
            return Err(*last_error);
        }
        Ok(Self {
            a_reply: a.ok(),
            aaaa_reply: aaaa.ok(),
            mx_reply: mx.ok().flatten(),
            ns_reply: ns.ok().flatten(),
            txt_reply: txt.ok().flatten(),
            srv_reply: srv.ok().flatten(),
            ptr_reply: ptr.ok().flatten(),
            naptr_reply: naptr.ok().flatten(),
            soa_reply: soa.ok().flatten(),
            caa_reply: caa.ok().flatten(),
        })
    }
}

unsafe extern "C" {
    fn ares_parse_a_reply(
        abuf: *const u8,
        alen: c_int,
        host: &mut Option<OwnedHostent>,
        addrttls: *mut struct_ares_addrttl,
        naddrttls: *mut c_int,
    ) -> c_int;
    fn ares_parse_aaaa_reply(
        abuf: *const u8,
        alen: c_int,
        host: &mut Option<OwnedHostent>,
        addrttls: *mut struct_ares_addr6ttl,
        naddrttls: *mut c_int,
    ) -> c_int;
    fn ares_parse_caa_reply(
        abuf: *const u8,
        alen: c_int,
        caa_out: &mut Option<OwnedCaaReply>,
    ) -> c_int;
    fn ares_parse_ptr_reply(
        abuf: *const u8,
        alen: c_int,
        addr: *const c_void,
        addrlen: c_int,
        family: c_int,
        host: &mut Option<OwnedHostent>,
    ) -> c_int;
    fn ares_parse_ns_reply(abuf: *const u8, alen: c_int, host: &mut Option<OwnedHostent>) -> c_int;
    fn ares_parse_srv_reply(
        abuf: *const u8,
        alen: c_int,
        srv_out: &mut Option<OwnedSrvReply>,
    ) -> c_int;
    fn ares_parse_mx_reply(
        abuf: *const u8,
        alen: c_int,
        mx_out: &mut Option<OwnedMxReply>,
    ) -> c_int;
    fn ares_parse_txt_reply(
        abuf: *const u8,
        alen: c_int,
        txt_out: &mut Option<OwnedTxtReply>,
    ) -> c_int;
    fn ares_parse_naptr_reply(
        abuf: *const u8,
        alen: c_int,
        naptr_out: &mut Option<OwnedNaptrReply>,
    ) -> c_int;
    fn ares_parse_soa_reply(
        abuf: *const u8,
        alen: c_int,
        soa_out: &mut Option<OwnedSoaReply>,
    ) -> c_int;
    fn ares_free_hostent(host: *mut struct_hostent<'_>);
    fn ares_free_data(dataptr: *mut c_void);
}

#[repr(C)]
pub struct struct_ares_addr_port_node<'a> {
    pub next: Option<&'a Self>,
    pub family: c_int,
    /// A union of `in_addr` and `ares_in6_addr` in C, where nodes are allocated zeroed.
    pub addr: [u8; 16],
    pub udp_port: c_int,
    pub tcp_port: c_int,
}
// SAFETY: `#[repr(C)]` POD — `Option<&Self>`, `c_int`s, and a byte array.
unsafe impl bun_core::ffi::Zeroable for struct_ares_addr_port_node<'_> {}

unsafe extern "C" {
    fn ares_set_servers_ports(
        channel: *mut Channel,
        servers: Option<&struct_ares_addr_port_node<'_>>,
    ) -> c_int;
    fn ares_get_servers_ports(
        channel: *mut Channel,
        servers: &mut Option<OwnedAddrPortNode>,
    ) -> c_int;
    /// https://c-ares.org/docs/ares_inet_ntop.html
    pub(crate) fn ares_inet_ntop(
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
    pub(crate) fn ares_inet_pton(af: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
}

const ARES_SUCCESS: c_int = 0;
pub(crate) const ARES_ENODATA: c_int = 1;
const ARES_EFORMERR: c_int = 2;
const ARES_ESERVFAIL: c_int = 3;
pub(crate) const ARES_ENOTFOUND: c_int = 4;
const ARES_ENOTIMP: c_int = 5;
const ARES_EREFUSED: c_int = 6;
const ARES_EBADQUERY: c_int = 7;
pub(crate) const ARES_EBADNAME: c_int = 8;
const ARES_EBADFAMILY: c_int = 9;
const ARES_EBADRESP: c_int = 10;
const ARES_ECONNREFUSED: c_int = 11;
const ARES_ETIMEOUT: c_int = 12;
const ARES_EOF: c_int = 13;
const ARES_EFILE: c_int = 14;
const ARES_ENOMEM: c_int = 15;
pub const ARES_EDESTRUCTION: c_int = 16;
const ARES_EBADSTR: c_int = 17;
const ARES_EBADFLAGS: c_int = 18;
pub(crate) const ARES_ENONAME: c_int = 19;
const ARES_EBADHINTS: c_int = 20;
const ARES_ENOTINITIALIZED: c_int = 21;
const ARES_ELOADIPHLPAPI: c_int = 22;
const ARES_EADDRGETNETWORKPARAMS: c_int = 23;
const ARES_ECANCELLED: c_int = 24;
const ARES_ESERVICE: c_int = 25;
pub(crate) const ARES_ENOSERVER: c_int = 26;

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
    /// getaddrinfo(3) `EAI_AGAIN`. Not a c-ares status: [`Error::get`] never
    /// produces it, and its errno comes from [`Error::errno`].
    EAI_AGAIN = ARES_ENOSERVER + 1,
}

/// libuv's `UV_EAI_AGAIN`, the `errno` Node reports for getaddrinfo `EAI_AGAIN`.
const UV_EAI_AGAIN: i32 = -3001;

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
                libuv::UV_EAI_AGAIN => Some(Error::EAI_AGAIN),
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

            #[cfg(any(target_os = "linux", target_os = "android"))]
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
                EAI::AGAIN => Some(Error::EAI_AGAIN),
                EAI::BADFLAGS => Some(Error::EBADFLAGS), // Invalid hints
                EAI::FAIL => Some(Error::EBADRESP),
                EAI::FAMILY => Some(Error::EBADFAMILY),
                EAI::MEMORY => Some(Error::ENOMEM),
                EAI::SERVICE => Some(Error::ESERVICE),
                EAI::SYSTEM => Some(Error::ESERVFAIL),
                // Any EAI code not mapped above is reported as "not implemented".
                _ => Some(Error::ENOTIMP),
            }
        }
    }

    /// This platform's raw getaddrinfo(3) status for the `EAI_*` code named `name`.
    pub fn eai_raw_by_name(name: &[u8]) -> Option<i32> {
        #[cfg(windows)]
        {
            use bun_libuv_sys as libuv;
            match name {
                b"EAI_AGAIN" => Some(libuv::UV_EAI_AGAIN),
                b"EAI_FAIL" => Some(libuv::UV_EAI_FAIL),
                b"EAI_NONAME" => Some(libuv::UV_EAI_NONAME),
                _ => None,
            }
        }
        #[cfg(not(windows))]
        {
            match name {
                b"EAI_AGAIN" => Some(EAI::AGAIN.0),
                b"EAI_FAIL" => Some(EAI::FAIL.0),
                b"EAI_NONAME" => Some(EAI::NONAME.0),
                _ => None,
            }
        }
    }

    /// The JS-visible `errno` for this status.
    pub fn errno(self) -> i32 {
        match self {
            Error::EAI_AGAIN => UV_EAI_AGAIN,
            _ => self as i32,
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
            Error::EAI_AGAIN => "DNS_EAI_AGAIN",
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
            Error::EAI_AGAIN => "Temporary failure in name resolution",
        }
    }

    fn check(rc: i32) -> Result<(), Error> {
        Self::get(rc).map_or(Ok(()), Err)
    }

    fn get(rc: i32) -> Option<Error> {
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
        // contiguous discriminants `1..=ARES_ENOSERVER + 1`, so every value in
        // the asserted range is a valid discriminant.
        Some(unsafe { core::mem::transmute::<i32, Error>(n as i32) })
    }
}

pub(crate) const ARES_FLAG_NOCHECKRESP: c_int = 1 << 7;
pub(crate) const ARES_OPT_FLAGS: c_int = 1 << 0;
pub(crate) const ARES_OPT_TRIES: c_int = 1 << 2;
pub(crate) const ARES_OPT_SOCK_STATE_CB: c_int = 1 << 9;
pub(crate) const ARES_OPT_TIMEOUTMS: c_int = 1 << 13;
pub(crate) const ARES_NI_NAMEREQD: c_int = 1 << 2;
pub(crate) const ARES_NI_LOOKUPHOST: c_int = 1 << 8;
pub(crate) const ARES_NI_LOOKUPSERVICE: c_int = 1 << 9;

pub(crate) const ARES_LIB_INIT_WIN32: c_int = 1 << 0;
pub(crate) const ARES_LIB_INIT_ALL: c_int = ARES_LIB_INIT_WIN32;

#[cfg(windows)]
pub const ARES_SOCKET_BAD: ares_socket_t = usize::MAX; // INVALID_SOCKET
#[cfg(not(windows))]
pub const ARES_SOCKET_BAD: ares_socket_t = -1;

/// The C `struct in_addr` (4-byte IPv4 address), as c-ares' `ares_options.servers` declares it.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct in_addr {
    pub s_addr: u32,
}
