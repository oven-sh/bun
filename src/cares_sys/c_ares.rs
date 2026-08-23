#![allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    clippy::missing_safety_doc
)]

#[cfg(windows)]
use core::ffi::c_short;
use core::ffi::{c_char, c_int, c_uint, c_ushort, c_void};
use core::ptr::{self, NonNull};

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

// hostent in glibc uses int for h_addrtype and h_length, whereas hostent in
// winsock2.h uses short.
#[cfg(windows)]
type hostent_int = c_short;
#[cfg(not(windows))]
type hostent_int = c_int;

// ──────────────────────────────────────────────────────────────────────────
// Owned c-ares allocations
// ──────────────────────────────────────────────────────────────────────────

/// A reply structure that c-ares allocates and that is released with the
/// matching `ares_free_*` function.
///
/// # Safety
/// `free` must be the deallocator c-ares documents for `Self`.
pub unsafe trait AresAllocated {
    /// # Safety
    /// `this` was allocated by c-ares as a `Self` and is not used afterwards.
    unsafe fn free(this: *mut Self);
}

/// Owning pointer to a c-ares-allocated `T`; frees it on drop.
pub struct AresBox<T: AresAllocated>(NonNull<T>);

impl<T: AresAllocated> AresBox<T> {
    /// # Safety
    /// `raw` is null or a `T` that c-ares handed over for the caller to free.
    #[inline]
    unsafe fn from_raw(raw: *mut T) -> Option<Self> {
        NonNull::new(raw).map(Self)
    }
}

impl<T: AresAllocated> core::ops::Deref for AresBox<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: sole owner of a live c-ares allocation (see `from_raw`).
        unsafe { self.0.as_ref() }
    }
}

impl<T: AresAllocated> core::ops::DerefMut for AresBox<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: as `deref`; `&mut self` is the only access path.
        unsafe { self.0.as_mut() }
    }
}

impl<T: AresAllocated> Drop for AresBox<T> {
    fn drop(&mut self) {
        // SAFETY: `from_raw` contract — c-ares allocated it and we own it.
        unsafe { T::free(self.0.as_ptr()) }
    }
}

macro_rules! ares_free_data_types {
    ($($t:ty),+ $(,)?) => {$(
        // SAFETY: `ares_free_data` is the documented deallocator for every
        // `ares_parse_*_reply` list / `ares_get_servers_ports` result.
        unsafe impl AresAllocated for $t {
            unsafe fn free(this: *mut Self) {
                // SAFETY: trait contract.
                unsafe { ares_free_data(this.cast::<c_void>()) }
            }
        }
    )+};
}
ares_free_data_types!(
    struct_ares_caa_reply,
    struct_ares_srv_reply,
    struct_ares_mx_reply,
    struct_ares_txt_reply,
    struct_ares_naptr_reply,
    struct_ares_soa_reply,
    struct_ares_addr_port_node,
);
// SAFETY: `ares_free_hostent` is the documented deallocator for parsed hostents.
unsafe impl AresAllocated for struct_hostent {
    unsafe fn free(this: *mut Self) {
        // SAFETY: trait contract.
        unsafe { ares_free_hostent(this) }
    }
}
// SAFETY: `ares_freeaddrinfo` is the documented deallocator for `ares_addrinfo`.
unsafe impl AresAllocated for AddrInfo {
    unsafe fn free(this: *mut Self) {
        // SAFETY: trait contract.
        unsafe { ares_freeaddrinfo(this) }
    }
}

/// Bytes of a NUL-terminated string c-ares owns, or `&[]` for null.
///
/// # Safety
/// `p` is null or a NUL-terminated string that lives at least as long as `'a`.
#[inline]
unsafe fn c_str_bytes<'a>(p: *const u8) -> &'a [u8] {
    if p.is_null() {
        &[]
    } else {
        // SAFETY: fn contract.
        unsafe { core::ffi::CStr::from_ptr(p.cast::<c_char>()) }.to_bytes()
    }
}

/// Iterate a null-terminated array of pointers c-ares owns.
///
/// # Safety
/// `p` is null or points at a null-terminated array of pointers that lives at
/// least as long as `'a`.
#[inline]
unsafe fn null_terminated_array<'a, T: 'a>(p: *mut *mut T) -> impl Iterator<Item = *mut T> + 'a {
    let mut i = 0usize;
    core::iter::from_fn(move || {
        if p.is_null() {
            return None;
        }
        // SAFETY: fn contract — in bounds up to and including the terminator.
        let item = unsafe { *p.add(i) };
        if item.is_null() {
            None
        } else {
            i += 1;
            Some(item)
        }
    })
}

macro_rules! ares_linked_list {
    ($($t:ty),+ $(,)?) => {$(
        impl $t {
            /// The next record of this reply, if any.
            #[inline]
            pub fn next(&self) -> Option<&$t> {
                // SAFETY: c-ares links `next` to null or to the following node
                // of the same reply, which lives as long as the head does.
                unsafe { self.next.as_ref() }
            }
            /// This record and every one after it.
            #[inline]
            pub fn iter(&self) -> impl Iterator<Item = &$t> + Clone {
                core::iter::successors(Some(self), |n| n.next())
            }
        }
    )+};
}

// ──────────────────────────────────────────────────────────────────────────
// struct hostent
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct struct_hostent {
    h_name: *mut c_char,
    h_aliases: *mut *mut c_char, // null-terminated array of NUL-terminated strings
    h_addrtype: hostent_int,
    h_length: hostent_int,
    h_addr_list: *mut *mut c_char, // null-terminated array of `h_length`-byte addresses
}

impl struct_hostent {
    /// The official host name.
    #[inline]
    pub fn name(&self) -> Option<&[u8]> {
        if self.h_name.is_null() {
            None
        } else {
            // SAFETY: c-ares sets `h_name` to a NUL-terminated string it owns
            // for the hostent's lifetime.
            Some(unsafe { c_str_bytes(self.h_name.cast::<u8>()) })
        }
    }

    /// Whether the alias array is present at all (an absent array and an
    /// empty one are reported differently by `node:dns`).
    #[inline]
    pub fn has_aliases(&self) -> bool {
        !self.h_aliases.is_null()
    }

    /// The alias names.
    #[inline]
    pub fn aliases(&self) -> impl Iterator<Item = &[u8]> {
        // SAFETY: c-ares sets `h_aliases` to null or a null-terminated array of
        // NUL-terminated strings, all owned for the hostent's lifetime.
        unsafe { null_terminated_array(self.h_aliases) }.map(|p| unsafe { c_str_bytes(p.cast()) })
    }

    /// `AF_INET` or `AF_INET6`.
    #[inline]
    pub fn addrtype(&self) -> c_int {
        c_int::from(self.h_addrtype)
    }

    /// Whether the address array is present at all.
    #[inline]
    pub fn has_addr_list(&self) -> bool {
        !self.h_addr_list.is_null()
    }

    /// The raw network-order addresses, each `h_length` bytes (4 for
    /// `AF_INET`, 16 for `AF_INET6`).
    #[inline]
    pub fn addresses(&self) -> impl Iterator<Item = &[u8]> {
        let len = usize::try_from(self.h_length).unwrap_or(0);
        // SAFETY: c-ares sets `h_addr_list` to null or a null-terminated array
        // of `h_length`-byte buffers, all owned for the hostent's lifetime.
        unsafe { null_terminated_array(self.h_addr_list) }
            .map(move |p| unsafe { core::slice::from_raw_parts(p.cast::<u8>(), len) })
    }

    /// `ares_parse_a_reply` keeping only the hostent (CNAME chain + name).
    pub fn parse_cname(buffer: &[u8]) -> Result<Option<AresBox<Self>>, Error> {
        let mut start: *mut struct_hostent = ptr::null_mut();
        let mut addrttls = [struct_ares_addrttl::default(); 256];
        let mut naddrttls: c_int = 256;
        // SAFETY: `buffer` is a valid slice; out-params are live stack slots.
        let rc = unsafe {
            ares_parse_a_reply(
                buffer.as_ptr(),
                c_len(buffer),
                &raw mut start,
                addrttls.as_mut_ptr(),
                &raw mut naddrttls,
            )
        };
        // SAFETY: on success c-ares hands over `start` for us to free.
        parsed(rc, || unsafe { AresBox::from_raw(start) })
    }

    /// `ares_parse_ns_reply`.
    pub fn parse_ns(buffer: &[u8]) -> Result<Option<AresBox<Self>>, Error> {
        let mut start: *mut struct_hostent = ptr::null_mut();
        // SAFETY: `buffer` is a valid slice; `start` is a live stack slot.
        let rc = unsafe { ares_parse_ns_reply(buffer.as_ptr(), c_len(buffer), &raw mut start) };
        // SAFETY: on success c-ares hands over `start` for us to free.
        parsed(rc, || unsafe { AresBox::from_raw(start) })
    }

    /// `ares_parse_ptr_reply` (no address filter).
    pub fn parse_ptr(buffer: &[u8]) -> Result<Option<AresBox<Self>>, Error> {
        let mut start: *mut struct_hostent = ptr::null_mut();
        // SAFETY: `buffer` is a valid slice; `start` is a live stack slot; a
        // null `addr` with length 0 is the documented "no filter" input.
        let rc = unsafe {
            ares_parse_ptr_reply(
                buffer.as_ptr(),
                c_len(buffer),
                ptr::null(),
                0,
                AF::INET,
                &raw mut start,
            )
        };
        // SAFETY: on success c-ares hands over `start` for us to free.
        parsed(rc, || unsafe { AresBox::from_raw(start) })
    }
}

#[inline]
fn c_len(buffer: &[u8]) -> c_int {
    c_int::try_from(buffer.len()).unwrap_or(c_int::MAX)
}

#[inline]
fn parsed<T>(rc: c_int, take: impl FnOnce() -> Option<T>) -> Result<Option<T>, Error> {
    if rc != ARES_SUCCESS {
        return Err(Error::get(rc).unwrap());
    }
    Ok(take())
}

/// An A/AAAA answer: the parsed hostent plus the per-address TTLs.
pub struct hostent_with_ttls {
    pub hostent: AresBox<struct_hostent>,
    pub ttls: [c_int; 256],
}

impl hostent_with_ttls {
    pub fn parse_a(buffer: &[u8]) -> Result<Box<hostent_with_ttls>, Error> {
        let mut start: *mut struct_hostent = ptr::null_mut();
        let mut addrttls = [struct_ares_addrttl::default(); 256];
        let mut naddrttls: c_int = 256;
        // SAFETY: `buffer` is a valid slice; out-params are live stack slots.
        let rc = unsafe {
            ares_parse_a_reply(
                buffer.as_ptr(),
                c_len(buffer),
                &raw mut start,
                addrttls.as_mut_ptr(),
                &raw mut naddrttls,
            )
        };
        // SAFETY: on success c-ares hands over `start` for us to free.
        let hostent =
            parsed(rc, || unsafe { AresBox::from_raw(start) })?.ok_or(Error::ENOTFOUND)?;
        let mut ttls = [-1; 256];
        let n = usize::try_from(naddrttls).unwrap_or(0).min(256);
        for (dst, src) in ttls.iter_mut().zip(&addrttls[..n]) {
            *dst = src.ttl;
        }
        Ok(Box::new(hostent_with_ttls { hostent, ttls }))
    }

    pub fn parse_aaaa(buffer: &[u8]) -> Result<Box<hostent_with_ttls>, Error> {
        let mut start: *mut struct_hostent = ptr::null_mut();
        let mut addr6ttls = [struct_ares_addr6ttl::default(); 256];
        let mut naddr6ttls: c_int = 256;
        // SAFETY: `buffer` is a valid slice; out-params are live stack slots.
        let rc = unsafe {
            ares_parse_aaaa_reply(
                buffer.as_ptr(),
                c_len(buffer),
                &raw mut start,
                addr6ttls.as_mut_ptr(),
                &raw mut naddr6ttls,
            )
        };
        // SAFETY: on success c-ares hands over `start` for us to free.
        let hostent =
            parsed(rc, || unsafe { AresBox::from_raw(start) })?.ok_or(Error::ENOTFOUND)?;
        let mut ttls = [-1; 256];
        let n = usize::try_from(naddr6ttls).unwrap_or(0).min(256);
        for (dst, src) in ttls.iter_mut().zip(&addr6ttls[..n]) {
            *dst = src.ttl;
        }
        Ok(Box::new(hostent_with_ttls { hostent, ttls }))
    }
}

/// The `(node, service)` strings `ares_getnameinfo` reports; borrowed for the
/// duration of the completion callback.
#[derive(Clone, Copy)]
pub struct NameInfo<'a> {
    pub node: Option<&'a [u8]>,
    pub service: Option<&'a [u8]>,
}

bun_opaque::opaque_ffi! { pub struct struct_Channeldata; }

// ──────────────────────────────────────────────────────────────────────────
// ares_addrinfo
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct AddrInfo_cname {
    ttl: c_int,
    alias: *mut u8,
    name: *mut u8,
    next: *mut AddrInfo_cname,
}

#[repr(C)]
pub struct AddrInfo_node {
    pub ttl: c_int,
    pub flags: c_int,
    pub family: c_int,
    pub socktype: c_int,
    pub protocol: c_int,
    addrlen: ares_socklen_t,
    addr: *mut sockaddr,
    next: *mut AddrInfo_node,
}
ares_linked_list!(AddrInfo_node);

impl AddrInfo_node {
    /// The raw `sockaddr` bytes of this address (`addrlen` of them).
    #[inline]
    pub fn sockaddr_bytes(&self) -> &[u8] {
        if self.addr.is_null() {
            return &[];
        }
        // SAFETY: c-ares allocates `addr` as an `addrlen`-byte sockaddr owned
        // by the enclosing `ares_addrinfo` (which outlives `&self`).
        unsafe { core::slice::from_raw_parts(self.addr.cast::<u8>(), self.addrlen as usize) }
    }
}

#[repr(C)]
pub struct AddrInfo {
    cnames_: *mut AddrInfo_cname,
    node: *mut AddrInfo_node,
    name_: *mut c_char,
}

impl AddrInfo {
    /// The resolved addresses.
    #[inline]
    pub fn nodes(&self) -> impl Iterator<Item = &AddrInfo_node> {
        // SAFETY: c-ares sets `node` to null or the head of a list it owns for
        // this addrinfo's lifetime.
        unsafe { self.node.as_ref() }
            .into_iter()
            .flat_map(AddrInfo_node::iter)
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.node.is_null()
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

// ──────────────────────────────────────────────────────────────────────────
// Completion handlers
//
// Every query hands c-ares a `Box<H>` as its callback argument; c-ares calls
// back exactly once per query (with `ARES_ECANCELLED` / `ARES_EDESTRUCTION`
// on cancel / channel destroy), and the thunk gives the box back to `H`.
// ──────────────────────────────────────────────────────────────────────────

/// Receiver for an `ares_query` reply of one record type.
pub trait QueryHandler: Sized {
    /// Record-type name (`"srv"`, `"ns"`, …) — `ns`/`soa` accept an empty name.
    const LOOKUP_NAME: &'static str;
    const NS_TYPE: NSType;
    /// The parsed reply.
    type Reply;
    /// Parse the raw answer; `Ok(None)` is a well-formed answer with no data.
    fn parse(buffer: &[u8]) -> Result<Option<Self::Reply>, Error>;
    fn on_reply(self: Box<Self>, status: Option<Error>, timeouts: i32, reply: Option<Self::Reply>);
}

/// Receiver for `ares_getaddrinfo`.
pub trait AddrInfoHandler: Sized {
    fn on_addr_info(
        self: Box<Self>,
        status: Option<Error>,
        timeouts: i32,
        result: Option<AresBox<AddrInfo>>,
    );
}

/// Receiver for `ares_gethostbyaddr`. The hostent is c-ares' and only valid
/// during the call.
pub trait HostentHandler: Sized {
    fn on_hostent(
        self: Box<Self>,
        status: Option<Error>,
        timeouts: i32,
        hostent: Option<&struct_hostent>,
    );
}

/// Receiver for `ares_getnameinfo`.
pub trait NameInfoHandler: Sized {
    fn on_nameinfo(
        self: Box<Self>,
        status: Option<Error>,
        timeouts: i32,
        info: Option<NameInfo<'_>>,
    );
}

#[inline]
fn into_arg<H>(ctx: Box<H>) -> *mut c_void {
    Box::into_raw(ctx).cast::<c_void>()
}

unsafe extern "C" fn query_callback<H: QueryHandler>(
    arg: *mut c_void,
    status: c_int,
    timeouts: c_int,
    abuf: *mut u8,
    alen: c_int,
) {
    // SAFETY: `arg` is the `Box<H>` `Channel::query` registered for exactly
    // this one callback.
    let this = unsafe { Box::from_raw(arg.cast::<H>()) };
    if status != ARES_SUCCESS {
        this.on_reply(Error::get(status), timeouts, None);
        return;
    }
    // SAFETY: on success c-ares passes the answer it owns, `alen` bytes long.
    let buffer = unsafe { core::slice::from_raw_parts(abuf, usize::try_from(alen).unwrap_or(0)) };
    match H::parse(buffer) {
        Ok(reply) => this.on_reply(None, timeouts, reply),
        Err(err) => this.on_reply(Some(err), timeouts, None),
    }
}

unsafe extern "C" fn addrinfo_callback<H: AddrInfoHandler>(
    arg: *mut c_void,
    status: c_int,
    timeouts: c_int,
    result: *mut AddrInfo,
) {
    // SAFETY: `arg` is the `Box<H>` `Channel::get_addr_info` registered for
    // exactly this one callback; `result` is null or handed over for us to free.
    let (this, result) = unsafe { (Box::from_raw(arg.cast::<H>()), AresBox::from_raw(result)) };
    this.on_addr_info(Error::get(status), timeouts, result);
}

unsafe extern "C" fn host_callback<H: HostentHandler>(
    arg: *mut c_void,
    status: c_int,
    timeouts: c_int,
    hostent: *mut struct_hostent,
) {
    // SAFETY: `arg` is the `Box<H>` `Channel::get_host_by_addr` registered for
    // exactly this one callback; `hostent` is null or c-ares' own, valid for
    // the call.
    let (this, hostent) = unsafe { (Box::from_raw(arg.cast::<H>()), hostent.as_ref()) };
    if status != ARES_SUCCESS {
        this.on_hostent(Error::get(status), timeouts, None);
        return;
    }
    this.on_hostent(None, timeouts, hostent);
}

unsafe extern "C" fn nameinfo_callback<H: NameInfoHandler>(
    arg: *mut c_void,
    status: c_int,
    timeouts: c_int,
    node: *mut u8,
    service: *mut u8,
) {
    // SAFETY: `arg` is the `Box<H>` `Channel::get_name_info` registered for
    // exactly this one callback.
    let this = unsafe { Box::from_raw(arg.cast::<H>()) };
    if status != ARES_SUCCESS {
        this.on_nameinfo(Error::get(status), timeouts, None);
        return;
    }
    let opt = |p: *mut u8| {
        if p.is_null() {
            None
        } else {
            // SAFETY: c-ares passes NUL-terminated strings valid for the call.
            Some(unsafe { c_str_bytes(p) })
        }
    };
    this.on_nameinfo(
        None,
        timeouts,
        Some(NameInfo {
            node: opt(node),
            service: opt(service),
        }),
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Channel
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Default)]
pub struct ChannelOptions {
    pub timeout: Option<i32>,
    pub tries: Option<i32>,
}

bun_opaque::opaque_ffi! {
    /// Opaque c-ares channel handle. `UnsafeCell` makes the type `!Freeze` so a
    /// `&Channel` does not assert immutability of the C-owned state (c-ares
    /// mutates the channel on every dispatch/process call, and its completion
    /// callbacks re-enter through the same handle).
    pub struct Channel;
}

/// The owner of a live `ares_channel`; `ares_destroy` on drop, which fails
/// every pending query with `ARES_EDESTRUCTION` into its callback and then
/// reports each closed socket through the socket-state callback.
pub struct OwnedChannel(NonNull<Channel>);

impl core::ops::Deref for OwnedChannel {
    type Target = Channel;
    #[inline]
    fn deref(&self) -> &Channel {
        Channel::opaque_ref(self.0.as_ptr())
    }
}

impl Drop for OwnedChannel {
    fn drop(&mut self) {
        // SAFETY: the live channel `ares_init_options` returned to `Channel::init`.
        unsafe { ares_destroy(self.0.as_ptr()) }
    }
}

/// The object a channel reports socket-state changes to. It owns the
/// [`OwnedChannel`] (so outlives it) and is reached re-entrantly from inside
/// `process`/`cancel`/drop, hence the [`ThisPtr`](bun_ptr::ThisPtr) receiver.
pub trait ChannelOwner: Sized {
    fn on_socket_state(
        this: bun_ptr::ThisPtr<Self>,
        socket: ares_socket_t,
        readable: bool,
        writable: bool,
    );
}

unsafe extern "C" fn sock_state_callback<C: ChannelOwner>(
    data: *mut c_void,
    socket: ares_socket_t,
    readable: c_int,
    writable: c_int,
) {
    // SAFETY: `data` is the `owner` `Channel::init` registered, which owns the
    // channel making this call and so is live.
    let this = unsafe { bun_ptr::ThisPtr::new(data.cast::<C>()) };
    C::on_socket_state(this, socket, readable != 0, writable != 0);
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
    /// Create a channel reporting socket state to `*owner`, which must keep
    /// the returned channel (and drop it before going away itself).
    pub fn init<C: ChannelOwner>(
        owner: bun_ptr::ThisPtr<C>,
        options: ChannelOptions,
    ) -> Result<OwnedChannel, Error> {
        let mut channel: *mut Channel = ptr::null_mut();

        library_init();

        let mut opts = Options {
            // Android note: c-ares can't auto-discover servers (no /etc/resolv.conf,
            // no JNI), so it falls back to 127.0.0.1 and queries time out. We do
            // NOT set ARES_FLAG_NO_DFLT_SVR here — that makes init fail with
            // ENOSERVER, which breaks dns.setServers() (it needs an initialized
            // channel to call ares_set_servers_ports). Letting the 127.0.0.1
            // default stand means setServers() works as the documented workaround.
            flags: ARES_FLAG_NOCHECKRESP,
            sock_state_cb: Some(sock_state_callback::<C>),
            sock_state_cb_data: owner.as_ptr().cast::<c_void>(),
            timeout: options.timeout.unwrap_or(-1),
            tries: options.tries.unwrap_or(4),
            ..Default::default()
        };

        let optmask: c_int =
            ARES_OPT_FLAGS | ARES_OPT_TIMEOUTMS | ARES_OPT_SOCK_STATE_CB | ARES_OPT_TRIES;

        // SAFETY: idempotent Winsock init (uv_once); c-ares creates its sockets with
        // ws2_32 directly and libuv otherwise initializes Winsock lazily.
        #[cfg(windows)]
        unsafe {
            bun_libuv_sys::uv__winsock_ensure()
        };
        // SAFETY: c-ares FFI; opts/channel are valid stack pointers.
        let rc = unsafe { ares_init_options(&raw mut channel, &raw mut opts, optmask) };
        if let Some(err) = Error::get(rc) {
            // Don't `ares_library_cleanup()` here: `library_init()` is `run_once!`, so
            // tearing down the library on a per-channel failure would leave every later
            // `Channel::init()` running against an uninitialized c-ares.
            return Err(err);
        }
        Ok(OwnedChannel(NonNull::new(channel).ok_or(Error::ENOMEM)?))
    }

    /// See c-ares `ares_getaddrinfo` documentation.
    pub fn get_addr_info<H: AddrInfoHandler>(
        &self,
        host: &[u8],
        port: u16,
        hints: &[AddrInfo_hints],
        handler: Box<H>,
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
        // SAFETY: c-ares FFI; host/port/hints are NUL-terminated stack buffers
        // or null; `handler` is given back to `addrinfo_callback` exactly once.
        unsafe {
            ares_getaddrinfo(
                self.as_mut_ptr(),
                host_ptr,
                port_ptr,
                hints_,
                addrinfo_callback::<H>,
                into_arg(handler),
            );
        }
    }

    /// `ares_query` for `H`'s record type; names c-ares would reject are
    /// failed synchronously with `EBADNAME` through the same handler.
    pub fn query<H: QueryHandler>(&self, name: &[u8], handler: Box<H>) {
        if name.len() >= 1023
            || bun_core::strings::contains_char(name, 0)
            || (name.is_empty() && !(H::LOOKUP_NAME == "ns" || H::LOOKUP_NAME == "soa"))
        {
            handler.on_reply(Error::get(ARES_EBADNAME), 0, None);
            return;
        }

        let mut name_buf = [0u8; 1024];
        let name_ptr = copy_nul_terminated(&mut name_buf, name);

        // SAFETY: c-ares FFI; `name_ptr` is a NUL-terminated stack buffer;
        // `handler` is given back to `query_callback` exactly once.
        unsafe {
            ares_query(
                self.as_mut_ptr(),
                name_ptr,
                NSClass::ns_c_in,
                H::NS_TYPE,
                Some(query_callback::<H>),
                into_arg(handler),
            );
        }
    }

    /// `ares_gethostbyaddr`; an unparseable address fails synchronously with
    /// `ENOTIMP` through the same handler.
    pub fn get_host_by_addr<H: HostentHandler>(&self, ip_addr: &[u8], handler: Box<H>) {
        // "0000:0000:0000:0000:0000:ffff:192.168.100.228".length = 45
        const BUF_SIZE: usize = 46;
        let mut addr_buf = [0u8; BUF_SIZE];
        if !ip_addr.is_empty() && ip_addr.len() < BUF_SIZE {
            copy_nul_terminated(&mut addr_buf, ip_addr);
            let text = core::ffi::CStr::from_bytes_until_nul(&addr_buf).unwrap();
            // https://c-ares.org/ares_inet_pton.html
            // https://github.com/c-ares/c-ares/blob/7f3262312f246556d8c1bdd8ccc1844847f42787/src/lib/ares_gethostbyaddr.c#L71-L72
            // `ares_inet_pton` allows passing raw bytes as `dst`,
            // which can avoid the use of `struct_in_addr` to reduce extra bytes.
            let mut addr = [0u8; 16];
            for (family, len) in [(AF::INET, 4), (AF::INET6, 16)] {
                if inet_pton(family, text, &mut addr) > 0 {
                    // SAFETY: c-ares FFI; `addr` holds the `len`-byte address
                    // `inet_pton` wrote; `handler` is given back to
                    // `host_callback` exactly once.
                    unsafe {
                        ares_gethostbyaddr(
                            self.as_mut_ptr(),
                            addr.as_ptr().cast::<c_void>(),
                            len,
                            family,
                            Some(host_callback::<H>),
                            into_arg(handler),
                        );
                    }
                    return;
                }
            }
        }
        handler.on_hostent(Error::get(ARES_ENOTIMP), 0, None);
    }

    /// https://c-ares.org/ares_getnameinfo.html
    pub fn get_name_info<H: NameInfoHandler>(&self, sa: &sockaddr_storage, handler: Box<H>) {
        let salen = if c_int::from(sa.ss_family) == AF::INET {
            core::mem::size_of::<sockaddr_in>()
        } else {
            core::mem::size_of::<sockaddr_in6>()
        };
        // SAFETY: c-ares FFI; `sa` is a sockaddr_storage, which holds `salen`
        // bytes for either family; `handler` is given back to
        // `nameinfo_callback` exactly once.
        unsafe {
            ares_getnameinfo(
                self.as_mut_ptr(),
                ptr::from_ref(sa).cast::<sockaddr>(),
                salen as ares_socklen_t,
                // node returns ENOTFOUND for addresses like 255.255.255.255:80
                // So, it requires setting the ARES_NI_NAMEREQD flag
                ARES_NI_NAMEREQD | ARES_NI_LOOKUPHOST | ARES_NI_LOOKUPSERVICE,
                Some(nameinfo_callback::<H>),
                into_arg(handler),
            );
        }
    }

    /// `ares_process_fd` — runs completion callbacks synchronously.
    #[inline]
    pub fn process(&self, fd: ares_socket_t, readable: bool, writable: bool) {
        // SAFETY: live channel handle plus scalars.
        unsafe {
            ares_process_fd(
                self.as_mut_ptr(),
                if readable { fd } else { ARES_SOCKET_BAD },
                if writable { fd } else { ARES_SOCKET_BAD },
            )
        }
    }

    /// `ares_cancel` — fails every pending query with `ECANCELLED` into its callback.
    #[inline]
    pub fn cancel(&self) {
        // SAFETY: live channel handle.
        unsafe { ares_cancel(self.as_mut_ptr()) }
    }

    /// Number of queries not yet completed.
    #[inline]
    pub fn active_queries(&self) -> usize {
        // SAFETY: live channel handle.
        unsafe { ares_queue_active_queries(self.as_mut_ptr()) }
    }

    #[inline]
    pub fn set_local_ip4(&self, ip: u32) {
        // SAFETY: live channel handle plus a scalar.
        unsafe { ares_set_local_ip4(self.as_mut_ptr(), ip) }
    }

    #[inline]
    pub fn set_local_ip6(&self, ip6: &[u8; 16]) {
        // SAFETY: live channel handle; c-ares copies the 16 bytes.
        unsafe { ares_set_local_ip6(self.as_mut_ptr(), ip6.as_ptr()) }
    }

    /// `ares_get_servers_ports`: the configured servers (`None` if there are none).
    pub fn servers(&self) -> Result<Option<AresBox<struct_ares_addr_port_node>>, Error> {
        let mut servers: *mut struct_ares_addr_port_node = ptr::null_mut();
        // SAFETY: live channel handle; `servers` is a stack out-param whose
        // result c-ares hands over for us to free.
        let rc = unsafe { ares_get_servers_ports(self.as_mut_ptr(), &raw mut servers) };
        // SAFETY: as above.
        parsed(rc, || unsafe { AresBox::from_raw(servers) })
    }

    /// `ares_set_servers_ports` with `servers` in order (c-ares copies them);
    /// an empty slice clears the list.
    pub fn set_servers(&self, servers: &mut [struct_ares_addr_port_node]) -> Result<(), Error> {
        let base = servers.as_mut_ptr();
        for i in 0..servers.len() {
            servers[i].next = if i + 1 < servers.len() {
                // SAFETY: `i + 1` is in bounds of `servers`.
                unsafe { base.add(i + 1) }
            } else {
                ptr::null_mut()
            };
        }
        let head = if servers.is_empty() {
            ptr::null_mut()
        } else {
            base
        };
        // SAFETY: live channel handle; `head` is null or a list linked within
        // `servers`, which outlives the call.
        let rc = unsafe { ares_set_servers_ports(self.as_mut_ptr(), head) };
        for server in servers.iter_mut() {
            server.next = ptr::null_mut();
        }
        if rc != ARES_SUCCESS {
            return Err(Error::get(rc).unwrap());
        }
        Ok(())
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
    Option<unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut struct_hostent)>;
type ares_nameinfo_callback =
    Option<unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, *mut u8)>;
type ares_addrinfo_callback = unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut AddrInfo);

unsafe extern "C" {
    fn ares_library_init_mem(
        flags: c_int,
        amalloc: Option<unsafe extern "C" fn(usize) -> *mut c_void>,
        afree: Option<unsafe extern "C" fn(*mut c_void)>,
        arealloc: Option<unsafe extern "C" fn(*mut c_void, usize) -> *mut c_void>,
    ) -> c_int;
    fn ares_init_options(
        channelptr: *mut *mut Channel,
        options: *mut Options,
        optmask: c_int,
    ) -> c_int;
    fn ares_destroy(channel: *mut Channel);
    fn ares_cancel(channel: *mut Channel);
    fn ares_set_local_ip4(channel: *mut Channel, local_ip: c_uint);
    fn ares_set_local_ip6(channel: *mut Channel, local_ip6: *const u8);
    fn ares_getaddrinfo(
        channel: *mut Channel,
        node: *const c_char,
        service: *const c_char,
        hints: *const AddrInfo_hints,
        callback: ares_addrinfo_callback,
        arg: *mut c_void,
    );
    fn ares_freeaddrinfo(ai: *mut AddrInfo);
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
    fn ares_process_fd(channel: *mut Channel, read_fd: ares_socket_t, write_fd: ares_socket_t);
    fn ares_queue_active_queries(channel: *const Channel) -> usize;
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
    pub(crate) ipaddr: u32,
    pub(crate) ttl: c_int,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct struct_ares_addr6ttl {
    pub ip6addr: struct_ares_in6_addr,
    pub(crate) ttl: c_int,
}

// SAFETY: `#[repr(C)]` POD — 16-byte byte-array union + `c_int`. All-zero is a
// valid bit pattern (S021).
unsafe impl bun_core::ffi::Zeroable for struct_ares_addr6ttl {}
impl Default for struct_ares_addr6ttl {
    #[inline]
    fn default() -> Self {
        bun_core::ffi::zeroed()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Reply records. The six `struct_ares_{caa,srv,mx,txt,naptr,soa}_reply`
// parsers share the signature `(abuf, alen, out *mut *mut R) -> c_int`.
// ──────────────────────────────────────────────────────────────────────────

/// A c-ares reply record whose parser has the canonical 3-arg signature.
pub trait AresReply: AresAllocated + Sized {
    /// # Safety
    /// Thin forward to the matching `ares_parse_*_reply` extern.
    unsafe fn parse_raw(abuf: *const u8, alen: c_int, out: *mut *mut Self) -> c_int;

    /// Parse a raw answer into an owned reply (`None`: parsed, but empty).
    fn parse(buffer: &[u8]) -> Result<Option<AresBox<Self>>, Error> {
        let mut start: *mut Self = ptr::null_mut();
        // SAFETY: `buffer` is a valid slice; `start` is a live stack slot.
        let rc = unsafe { Self::parse_raw(buffer.as_ptr(), c_len(buffer), &raw mut start) };
        // SAFETY: on success c-ares hands over `start` for us to free.
        parsed(rc, || unsafe { AresBox::from_raw(start) })
    }
}

macro_rules! ares_reply_parsers {
    ($($t:ty => $parse:ident),+ $(,)?) => {$(
        impl AresReply for $t {
            unsafe fn parse_raw(abuf: *const u8, alen: c_int, out: *mut *mut Self) -> c_int {
                // SAFETY: caller upholds the `parse_raw` contract; thin FFI forward.
                unsafe { $parse(abuf, alen, out) }
            }
        }
    )+};
}
ares_reply_parsers!(
    struct_ares_caa_reply => ares_parse_caa_reply,
    struct_ares_srv_reply => ares_parse_srv_reply,
    struct_ares_mx_reply => ares_parse_mx_reply,
    struct_ares_txt_reply => ares_parse_txt_reply,
    struct_ares_naptr_reply => ares_parse_naptr_reply,
    struct_ares_soa_reply => ares_parse_soa_reply,
);

#[repr(C)]
pub struct struct_ares_caa_reply {
    next: *mut struct_ares_caa_reply,
    pub critical: c_int,
    property: *mut u8,
    plength: usize,
    value: *mut u8,
    length: usize,
}

impl struct_ares_caa_reply {
    /// The property tag bytes.
    #[inline]
    pub fn property_bytes(&self) -> &[u8] {
        if self.property.is_null() {
            &[]
        } else {
            // SAFETY: c-ares allocates `property` as `plength` bytes owned by
            // this node for `&self`'s lifetime.
            unsafe { core::slice::from_raw_parts(self.property, self.plength) }
        }
    }
    /// The value bytes.
    #[inline]
    pub fn value_bytes(&self) -> &[u8] {
        if self.value.is_null() {
            &[]
        } else {
            // SAFETY: as `property_bytes`, for `value`/`length`.
            unsafe { core::slice::from_raw_parts(self.value, self.length) }
        }
    }
}

#[repr(C)]
pub struct struct_ares_srv_reply {
    next: *mut struct_ares_srv_reply,
    host: *mut u8,
    pub priority: c_ushort,
    pub weight: c_ushort,
    pub port: c_ushort,
}

impl struct_ares_srv_reply {
    #[inline]
    pub fn host_bytes(&self) -> &[u8] {
        // SAFETY: c-ares sets `host` to a NUL-terminated string this node owns.
        unsafe { c_str_bytes(self.host) }
    }
}

#[repr(C)]
pub struct struct_ares_mx_reply {
    next: *mut struct_ares_mx_reply,
    host: *mut u8,
    pub priority: c_ushort,
}

impl struct_ares_mx_reply {
    #[inline]
    pub fn host_bytes(&self) -> &[u8] {
        // SAFETY: c-ares sets `host` to a NUL-terminated string this node owns.
        unsafe { c_str_bytes(self.host) }
    }
}

#[repr(C)]
pub struct struct_ares_txt_reply {
    next: *mut struct_ares_txt_reply,
    txt: *mut u8,
    length: usize,
}

impl struct_ares_txt_reply {
    /// The TXT record bytes.
    #[inline]
    pub fn txt_bytes(&self) -> &[u8] {
        if self.txt.is_null() {
            &[]
        } else {
            // SAFETY: c-ares allocates `txt` as `length` bytes owned by this
            // node for `&self`'s lifetime.
            unsafe { core::slice::from_raw_parts(self.txt, self.length) }
        }
    }
}

#[repr(C)]
pub struct struct_ares_naptr_reply {
    next: *mut struct_ares_naptr_reply,
    flags: *mut u8,
    service: *mut u8,
    regexp: *mut u8,
    replacement: *mut u8,
    pub order: c_ushort,
    pub preference: c_ushort,
}

impl struct_ares_naptr_reply {
    #[inline]
    pub fn flags_bytes(&self) -> &[u8] {
        // SAFETY: c-ares sets `flags` to a NUL-terminated string this node owns.
        unsafe { c_str_bytes(self.flags) }
    }
    #[inline]
    pub fn service_bytes(&self) -> &[u8] {
        // SAFETY: c-ares sets `service` to a NUL-terminated string this node owns.
        unsafe { c_str_bytes(self.service) }
    }
    #[inline]
    pub fn regexp_bytes(&self) -> &[u8] {
        // SAFETY: c-ares sets `regexp` to a NUL-terminated string this node owns.
        unsafe { c_str_bytes(self.regexp) }
    }
    #[inline]
    pub fn replacement_bytes(&self) -> &[u8] {
        // SAFETY: c-ares sets `replacement` to a NUL-terminated string this node owns.
        unsafe { c_str_bytes(self.replacement) }
    }
}

#[repr(C)]
pub struct struct_ares_soa_reply {
    nsname: *mut u8,
    hostmaster: *mut u8,
    pub serial: c_uint,
    pub refresh: c_uint,
    pub retry: c_uint,
    pub expire: c_uint,
    pub minttl: c_uint,
}

impl struct_ares_soa_reply {
    #[inline]
    pub fn nsname_bytes(&self) -> &[u8] {
        // SAFETY: c-ares sets `nsname` to a NUL-terminated string this reply owns.
        unsafe { c_str_bytes(self.nsname) }
    }
    #[inline]
    pub fn hostmaster_bytes(&self) -> &[u8] {
        // SAFETY: c-ares sets `hostmaster` to a NUL-terminated string this reply owns.
        unsafe { c_str_bytes(self.hostmaster) }
    }
}

ares_linked_list!(
    struct_ares_caa_reply,
    struct_ares_srv_reply,
    struct_ares_mx_reply,
    struct_ares_txt_reply,
    struct_ares_naptr_reply,
    struct_ares_addr_port_node,
);

/// Everything an `ANY` query answered, per record type.
#[derive(Default)]
pub struct struct_any_reply {
    pub a_reply: Option<Box<hostent_with_ttls>>,
    pub aaaa_reply: Option<Box<hostent_with_ttls>>,
    pub mx_reply: Option<AresBox<struct_ares_mx_reply>>,
    pub ns_reply: Option<AresBox<struct_hostent>>,
    pub txt_reply: Option<AresBox<struct_ares_txt_reply>>,
    pub srv_reply: Option<AresBox<struct_ares_srv_reply>>,
    pub ptr_reply: Option<AresBox<struct_hostent>>,
    pub naptr_reply: Option<AresBox<struct_ares_naptr_reply>>,
    pub soa_reply: Option<AresBox<struct_ares_soa_reply>>,
    pub caa_reply: Option<AresBox<struct_ares_caa_reply>>,
}

impl struct_any_reply {
    /// Parse a DNS `ANY` reply buffer. Returns the last per-record parse error
    /// if no record type parsed successfully.
    pub fn parse(buffer: &[u8]) -> Result<Box<Self>, Error> {
        let mut any_success = false;
        let mut last_error: Option<Error> = None;
        let mut reply = Box::new(struct_any_reply::default());

        fn note<T>(
            r: Result<T, Error>,
            any_success: &mut bool,
            last_error: &mut Option<Error>,
        ) -> Option<T> {
            match r {
                Ok(v) => {
                    *any_success = true;
                    Some(v)
                }
                Err(e) => {
                    *last_error = Some(e);
                    None
                }
            }
        }

        reply.a_reply = note(
            hostent_with_ttls::parse_a(buffer),
            &mut any_success,
            &mut last_error,
        );
        reply.aaaa_reply = note(
            hostent_with_ttls::parse_aaaa(buffer),
            &mut any_success,
            &mut last_error,
        );
        reply.mx_reply = note(
            struct_ares_mx_reply::parse(buffer),
            &mut any_success,
            &mut last_error,
        )
        .flatten();
        reply.ns_reply = note(
            struct_hostent::parse_ns(buffer),
            &mut any_success,
            &mut last_error,
        )
        .flatten();
        reply.txt_reply = note(
            struct_ares_txt_reply::parse(buffer),
            &mut any_success,
            &mut last_error,
        )
        .flatten();
        reply.srv_reply = note(
            struct_ares_srv_reply::parse(buffer),
            &mut any_success,
            &mut last_error,
        )
        .flatten();
        reply.ptr_reply = note(
            struct_hostent::parse_ptr(buffer),
            &mut any_success,
            &mut last_error,
        )
        .flatten();
        reply.naptr_reply = note(
            struct_ares_naptr_reply::parse(buffer),
            &mut any_success,
            &mut last_error,
        )
        .flatten();
        reply.soa_reply = note(
            struct_ares_soa_reply::parse(buffer),
            &mut any_success,
            &mut last_error,
        )
        .flatten();
        reply.caa_reply = note(
            struct_ares_caa_reply::parse(buffer),
            &mut any_success,
            &mut last_error,
        )
        .flatten();

        if !any_success {
            return Err(last_error.unwrap());
        }
        Ok(reply)
    }
}

unsafe extern "C" {
    fn ares_parse_a_reply(
        abuf: *const u8,
        alen: c_int,
        host: *mut *mut struct_hostent,
        addrttls: *mut struct_ares_addrttl,
        naddrttls: *mut c_int,
    ) -> c_int;
    fn ares_parse_aaaa_reply(
        abuf: *const u8,
        alen: c_int,
        host: *mut *mut struct_hostent,
        addrttls: *mut struct_ares_addr6ttl,
        naddrttls: *mut c_int,
    ) -> c_int;
    fn ares_parse_caa_reply(
        abuf: *const u8,
        alen: c_int,
        caa_out: *mut *mut struct_ares_caa_reply,
    ) -> c_int;
    fn ares_parse_ptr_reply(
        abuf: *const u8,
        alen: c_int,
        addr: *const c_void,
        addrlen: c_int,
        family: c_int,
        host: *mut *mut struct_hostent,
    ) -> c_int;
    fn ares_parse_ns_reply(abuf: *const u8, alen: c_int, host: *mut *mut struct_hostent) -> c_int;
    fn ares_parse_srv_reply(
        abuf: *const u8,
        alen: c_int,
        srv_out: *mut *mut struct_ares_srv_reply,
    ) -> c_int;
    fn ares_parse_mx_reply(
        abuf: *const u8,
        alen: c_int,
        mx_out: *mut *mut struct_ares_mx_reply,
    ) -> c_int;
    fn ares_parse_txt_reply(
        abuf: *const u8,
        alen: c_int,
        txt_out: *mut *mut struct_ares_txt_reply,
    ) -> c_int;
    fn ares_parse_naptr_reply(
        abuf: *const u8,
        alen: c_int,
        naptr_out: *mut *mut struct_ares_naptr_reply,
    ) -> c_int;
    fn ares_parse_soa_reply(
        abuf: *const u8,
        alen: c_int,
        soa_out: *mut *mut struct_ares_soa_reply,
    ) -> c_int;
    fn ares_free_hostent(host: *mut struct_hostent);
    fn ares_free_data(dataptr: *mut c_void);
}

#[repr(C)]
#[derive(Copy, Clone)]
union union_unnamed_4 {
    addr4: in_addr,
    addr6: struct_ares_in6_addr,
    bytes: [u8; 16],
}

/// One DNS server entry (`ares_addr_port_node`).
#[repr(C)]
pub struct struct_ares_addr_port_node {
    next: *mut struct_ares_addr_port_node,
    pub family: c_int,
    addr: union_unnamed_4,
    pub udp_port: c_int,
    pub tcp_port: c_int,
}

impl struct_ares_addr_port_node {
    /// An unlinked entry for [`Channel::set_servers`]; `addr` holds the
    /// network-order address (4 bytes used for `AF_INET`).
    pub fn new(family: c_int, addr: &[u8; 16], udp_port: c_int, tcp_port: c_int) -> Self {
        Self {
            next: ptr::null_mut(),
            family,
            addr: union_unnamed_4 { bytes: *addr },
            udp_port,
            tcp_port,
        }
    }

    /// The address in presentation form, written into `dst` (NUL-terminated
    /// there); `None` if `dst` is too small.
    pub fn ip_text<'a>(&self, dst: &'a mut [u8]) -> Option<&'a [u8]> {
        // SAFETY: `addr` is the in_addr/in6_addr union for `family`; `dst` is a
        // slice, so valid for `dst.len()` writes.
        unsafe { crate::ntop(self.family, ptr::addr_of!(self.addr).cast::<c_void>(), dst) }
    }
}

/// https://c-ares.org/docs/ares_inet_pton.html into a 16-byte buffer (4 used
/// for `AF_INET`).
///
/// ## Returns
/// - `1` if `src` was valid for the specified address family
/// - `0` if `src` was not parseable in the specified address family
/// - `-1` if some system error occurred. `errno` will have been set.
#[inline]
pub fn inet_pton(af: c_int, src: &core::ffi::CStr, dst: &mut [u8; 16]) -> c_int {
    if af != AF::INET && af != AF::INET6 {
        return -1;
    }
    // SAFETY: `src` is NUL-terminated; `dst` has room for the largest (16-byte)
    // address `af` can produce.
    unsafe { ares_inet_pton(af, src.as_ptr(), dst.as_mut_ptr().cast::<c_void>()) }
}

unsafe extern "C" {
    fn ares_set_servers_ports(
        channel: *mut Channel,
        servers: *mut struct_ares_addr_port_node,
    ) -> c_int;
    fn ares_get_servers_ports(
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
pub(crate) const ARES_ENODATA: c_int = 1;
const ARES_EFORMERR: c_int = 2;
const ARES_ESERVFAIL: c_int = 3;
pub(crate) const ARES_ENOTFOUND: c_int = 4;
pub(crate) const ARES_ENOTIMP: c_int = 5;
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
                EAI::AGAIN => Some(Error::ETIMEOUT), // transient; matches libuv
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

// Bun__canonicalizeIP_ host fn: see bun_runtime::dns_jsc::cares_jsc

/// Build the `sockaddr_storage` for `addr`:`port`, or `None` if `addr` is not
/// an IPv4/IPv6 literal. IPv4-mapped `::ffff:a.b.c.d` is stored as `AF_INET`:
/// the consumer is `ares_getnameinfo`, which (unlike the OS getnameinfo Node
/// uses) has no v4-mapped handling and would issue an ip6.arpa PTR query that
/// never resolves.
pub fn get_sockaddr(addr: &[u8], port: u16) -> Option<sockaddr_storage> {
    const BUF_SIZE: usize = 128;

    let mut buf = [0u8; BUF_SIZE];
    if addr.is_empty() || addr.len() >= BUF_SIZE {
        return None;
    }
    copy_nul_terminated(&mut buf, addr);
    let text = core::ffi::CStr::from_bytes_until_nul(&buf).ok()?;

    let mut octets = [0u8; 16];
    let mut storage: sockaddr_storage = bun_core::ffi::zeroed();
    if inet_pton(AF::INET, text, &mut octets) == 1 {
        write_in4(
            &mut storage,
            [octets[0], octets[1], octets[2], octets[3]],
            port,
        );
        return Some(storage);
    }
    if inet_pton(AF::INET6, text, &mut octets) != 1 {
        return None;
    }
    if octets[..12] == [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff] {
        write_in4(
            &mut storage,
            [octets[12], octets[13], octets[14], octets[15]],
            port,
        );
        return Some(storage);
    }
    let mut in6: sockaddr_in6 = bun_core::ffi::zeroed();
    in6.sin6_family = AF::INET6 as _;
    in6.sin6_port = port.to_be();
    // SAFETY: `sin6_addr` is 16 bytes of POD on every target.
    unsafe { (&raw mut in6.sin6_addr).cast::<[u8; 16]>().write(octets) };
    // SAFETY: `sockaddr_storage` is at least as large and aligned as `sockaddr_in6`.
    unsafe { (&raw mut storage).cast::<sockaddr_in6>().write(in6) };
    Some(storage)
}

fn write_in4(storage: &mut sockaddr_storage, octets: [u8; 4], port: u16) {
    let mut in4: sockaddr_in = bun_core::ffi::zeroed();
    in4.sin_family = AF::INET as _;
    in4.sin_port = port.to_be();
    // SAFETY: `sin_addr` is 4 bytes of POD on every target.
    unsafe { (&raw mut in4.sin_addr).cast::<[u8; 4]>().write(octets) };
    // SAFETY: `sockaddr_storage` is at least as large and aligned as `sockaddr_in`.
    unsafe { (&raw mut *storage).cast::<sockaddr_in>().write(in4) };
}

/// The C `struct in_addr` (4-byte IPv4 address), as c-ares' `ares_options.servers`
/// and the `ares_addr_node`/`ares_addr_port_node` unions declare it.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct in_addr {
    pub s_addr: u32,
}
