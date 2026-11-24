#![allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    clippy::missing_safety_doc
)]

use core::cell::Cell;
#[cfg(windows)]
use core::ffi::c_short;
use core::ffi::{c_char, c_int, c_uint, c_ushort, c_void};
use core::marker::{ConstParamTy, PhantomData};
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
    struct struct_apattern;
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

const ARES_CLASS_IN: c_int = 1;

/// The types that [`Channel::resolve`] asks for, with their values on the wire.
#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, ConstParamTy, enum_map::Enum, strum::IntoStaticStr)]
pub enum RecordType {
    A = 1,
    NS = 2,
    CNAME = 5,
    SOA = 6,
    PTR = 12,
    MX = 15,
    TXT = 16,
    AAAA = 28,
    SRV = 33,
    NAPTR = 35,
    ANY = 255,
    CAA = 257,
}

#[repr(C)]
#[derive(Copy, Clone, Default)]
struct struct_ares_server_failover_options {
    retry_chance: c_ushort,
    retry_delay: usize,
}

type ares_evsys_t = c_uint;

#[repr(C)]
struct Options {
    flags: c_int,
    timeout: c_int,
    tries: c_int,
    ndots: c_int,
    udp_port: c_ushort,
    tcp_port: c_ushort,
    socket_send_buffer_size: c_int,
    socket_receive_buffer_size: c_int,
    servers: *mut in_addr,
    nservers: c_int,
    domains: *mut *mut c_char,
    ndomains: c_int,
    lookups: *mut c_char,
    sock_state_cb: ares_sock_state_cb,
    sock_state_cb_data: *mut c_void,
    sortlist: *mut struct_apattern,
    nsort: c_int,
    ednspsz: c_int,
    resolvconf_path: *mut c_char,
    hosts_path: *mut c_char,
    udp_max_queries: c_int,
    maxtimeout: c_int,
    qcache_max_ttl: c_uint,
    evsys: ares_evsys_t,
    server_failover_opts: struct_ares_server_failover_options,
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
    pub struct OwnedAddrInfo(AddrInfo) => unsafe ares_freeaddrinfo;
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

impl<'a> struct_hostent<'a> {
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
}

/// The `alen` argument of `ares_parse_*_reply`.
fn alen(abuf: &[u8]) -> c_int {
    c_int::try_from(abuf.len()).unwrap_or(c_int::MAX)
}

pub struct hostent_with_ttls {
    pub hostent: OwnedHostent,
    pub ttls: [c_int; 256],
}

/// `ares_addrttl` (`N` is 4) or `ares_addr6ttl` (`N` is 16).
#[repr(C)]
#[derive(Copy, Clone)]
struct AddrTtl<const N: usize> {
    addr: [u8; N],
    ttl: c_int,
}

type ParseAddresses<const N: usize> = unsafe extern "C" fn(
    *const u8,
    c_int,
    &mut Option<OwnedHostent>,
    *mut AddrTtl<N>,
    *mut c_int,
) -> c_int;

impl hostent_with_ttls {
    fn parse<const N: usize>(message: &[u8], parse: ParseAddresses<N>) -> Result<Box<Self>, Error> {
        let mut host = None;
        let mut parsed = [AddrTtl {
            addr: [0; N],
            ttl: 0,
        }; 256];
        let mut len: c_int = 256;
        // SAFETY: c-ares FFI; it reads `alen` bytes of `message` and writes at most `len` TTLs.
        // A failure leaves `host` null.
        Error::check(unsafe {
            parse(
                message.as_ptr(),
                alen(message),
                &mut host,
                parsed.as_mut_ptr(),
                &raw mut len,
            )
        })?;
        let mut this = Box::new(Self {
            hostent: host.ok_or(Error::ENOTFOUND)?,
            ttls: [-1; 256],
        });
        let parsed = parsed.iter().take(usize::try_from(len).unwrap_or(0));
        for (ttl, parsed) in this.ttls.iter_mut().zip(parsed) {
            *ttl = parsed.ttl;
        }
        Ok(this)
    }
}

/// What a query that succeeded is answered with.
pub enum Reply {
    /// A and AAAA.
    Addresses(Box<hostent_with_ttls>),
    /// NS and PTR.
    Aliases(OwnedHostent),
    Cname(OwnedHostent),
    Mx(OwnedMxReply),
    Txt(OwnedTxtReply),
    Srv(OwnedSrvReply),
    Naptr(OwnedNaptrReply),
    Soa(OwnedSoaReply),
    Caa(OwnedCaaReply),
    Any(Vec<(RecordType, Reply)>),
    AddrInfo(OwnedAddrInfo),
    /// The aliases from `get_host_by_addr`, or the node and the service from `get_name_info`.
    Names(Vec<Option<Box<[u8]>>>),
}

impl Reply {
    /// `None`: the message is well formed and has no record of this type.
    fn parse(record: RecordType, message: &[u8]) -> Result<Option<Self>, Error> {
        let (abuf, alen) = (message.as_ptr(), alen(message));
        macro_rules! parse {
            ($variant:ident, |$out:ident| $call:expr) => {{
                let mut reply = None;
                let $out = &mut reply;
                // SAFETY: c-ares FFI; it reads `alen` bytes of `abuf`. A failure leaves the reply null.
                Error::check(unsafe { $call })?;
                reply.map(Self::$variant)
            }};
        }
        let addresses = |parsed| Some(Self::Addresses(parsed));
        Ok(match record {
            RecordType::A => addresses(hostent_with_ttls::parse(message, ares_parse_a_reply)?),
            RecordType::AAAA => {
                addresses(hostent_with_ttls::parse(message, ares_parse_aaaa_reply)?)
            }
            RecordType::CNAME => parse!(Cname, |out| {
                ares_parse_a_reply(abuf, alen, out, ptr::null_mut(), ptr::null_mut())
            }),
            RecordType::PTR => parse!(Aliases, |out| {
                ares_parse_ptr_reply(abuf, alen, ptr::null(), 0, AF::INET, out)
            }),
            RecordType::NS => parse!(Aliases, |out| ares_parse_ns_reply(abuf, alen, out)),
            RecordType::MX => parse!(Mx, |out| ares_parse_mx_reply(abuf, alen, out)),
            RecordType::TXT => parse!(Txt, |out| ares_parse_txt_reply(abuf, alen, out)),
            RecordType::SRV => parse!(Srv, |out| ares_parse_srv_reply(abuf, alen, out)),
            RecordType::NAPTR => parse!(Naptr, |out| ares_parse_naptr_reply(abuf, alen, out)),
            RecordType::SOA => parse!(Soa, |out| ares_parse_soa_reply(abuf, alen, out)),
            RecordType::CAA => parse!(Caa, |out| ares_parse_caa_reply(abuf, alen, out)),
            RecordType::ANY => Some(Self::parse_any(message)?),
        })
    }

    /// Fails with the last error if no type parses.
    fn parse_any(message: &[u8]) -> Result<Self, Error> {
        use RecordType::*;
        let parsed = [A, AAAA, MX, NS, TXT, SRV, PTR, NAPTR, SOA, CAA]
            .map(|record| (record, Self::parse(record, message)));
        if let [.., (_, Err(last))] = parsed
            && parsed.iter().all(|(_, reply)| reply.is_err())
        {
            return Err(last);
        }
        let found = parsed.into_iter();
        let found = found.filter_map(|(record, reply)| Some((record, reply.ok()??)));
        Ok(Self::Any(found.collect()))
    }

    /// Copies what c-ares only lends to a callback.
    fn names<'a>(names: impl Iterator<Item = Option<CStrRef<'a>>>) -> Self {
        let names = names.map(|name| Some(name?.to_cstr().to_bytes().into()));
        Self::Names(names.collect())
    }
}

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

impl<'a> AddrInfo<'a> {
    pub fn nodes(&self) -> impl Iterator<Item = &'a AddrInfo_node<'a>> + Clone {
        core::iter::successors(self.node, |current| current.next)
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct AddrInfo_hints {
    pub ai_flags: c_int,
    pub ai_family: c_int,
    pub ai_socktype: c_int,
    pub ai_protocol: c_int,
}
bun_core::impl_zeroable!(AddrInfo_hints);

#[derive(Copy, Clone)]
pub struct ChannelOptions {
    pub timeout: i32,
    pub tries: i32,
}

impl Default for ChannelOptions {
    fn default() -> Self {
        Self {
            timeout: -1,
            tries: 4,
        }
    }
}

bun_opaque::opaque_ffi! { struct ares_channel_t; }

/// Implemented by the type that holds a [`Channel`].
pub trait ChannelContainer: Sized {
    /// The only code of the container that runs inside c-ares.
    fn on_dns_socket_state(&self, socket: ares_socket_t, readable: bool, writable: bool);
}

pub type Answer = Result<Reply, Error>;

/// c-ares owns it while the query is in flight, then [`Answers`].
struct Query<Q> {
    data: Q,
    channel: NonNull<Channel<Q>>,
    next: Answers<Q>,
}

/// The queries that one call into c-ares answered, in the order it answered them.
#[must_use = "a query is answered once"]
pub struct Answers<Q>(Option<(Answer, Box<Query<Q>>)>);

impl<Q> Iterator for Answers<Q> {
    type Item = (Q, Answer);

    fn next(&mut self) -> Option<Self::Item> {
        let (answer, query) = self.0.take()?;
        *self = query.next;
        Some((query.data, answer))
    }
}

/// # Safety
/// `ctx` is the box that `Channel::send` released for a query, which c-ares answers once.
unsafe fn on_answer<Q>(
    ctx: *mut c_void,
    status: c_int,
    reply: impl FnOnce() -> Result<Option<Reply>, Error>,
) {
    // SAFETY: fn contract.
    let mut query = unsafe { bun_core::heap::take(ctx.cast::<Query<Q>>()) };
    let answer = Error::check(status).and_then(|()| reply()?.ok_or(Error::ENOTFOUND));
    // SAFETY: the channel stays in place until `close`, which answers every query.
    let answered = unsafe { &query.channel.as_ref().answered };
    query.next = answered.replace(Answers(None));
    answered.set(Answers(Some((answer, query))));
}

unsafe extern "C" fn on_message<Q, const RECORD: RecordType>(
    ctx: *mut c_void,
    status: c_int,
    _timeouts: c_int,
    abuf: *mut u8,
    alen: c_int,
) {
    // SAFETY: registered by `resolve`; c-ares lends `alen` bytes at `abuf` until this returns.
    unsafe {
        on_answer::<Q>(ctx, status, || {
            let message = bun_core::ffi::slice(abuf, usize::try_from(alen).unwrap_or(0));
            Reply::parse(RECORD, message)
        })
    }
}

unsafe extern "C" fn on_hostent<Q>(
    ctx: *mut c_void,
    status: c_int,
    _timeouts: c_int,
    host: Option<&struct_hostent<'_>>,
) {
    let reply = || Ok(host.map(|host| Reply::names(host.aliases().map(Some))));
    // SAFETY: registered by `get_host_by_addr`.
    unsafe { on_answer::<Q>(ctx, status, reply) }
}

unsafe extern "C" fn on_nameinfo<Q>(
    ctx: *mut c_void,
    status: c_int,
    _timeouts: c_int,
    node: Option<CStrRef<'_>>,
    service: Option<CStrRef<'_>>,
) {
    let reply = || Ok(Some(Reply::names([node, service].into_iter())));
    // SAFETY: registered by `get_name_info`.
    unsafe { on_answer::<Q>(ctx, status, reply) }
}

unsafe extern "C" fn on_addrinfo<Q>(
    ctx: *mut c_void,
    status: c_int,
    _timeouts: c_int,
    info: Option<OwnedAddrInfo>,
) {
    // SAFETY: registered by `get_addr_info`.
    unsafe { on_answer::<Q>(ctx, status, || Ok(info.map(Reply::AddrInfo))) }
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

/// A query carries a `Q`, which comes back with its answer after c-ares has returned.
pub struct Channel<Q> {
    raw: Cell<Option<NonNull<ares_channel_t>>>,
    /// Newest first. Empty unless c-ares is on the stack.
    answered: Cell<Answers<Q>>,
}

impl<Q> Default for Channel<Q> {
    fn default() -> Self {
        Self {
            raw: Cell::new(None),
            answered: Cell::new(Answers(None)),
        }
    }
}

impl<Q> Drop for Channel<Q> {
    fn drop(&mut self) {
        drop(self.close());
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

impl<Q> Channel<Q> {
    pub fn is_open(&self) -> bool {
        self.raw.get().is_some()
    }

    /// # Safety
    /// While it is open, `self` and `this` stay in place and `this.on_dns_socket_state` does not call it.
    /// Neither is borrowed mutably or starts to drop with a query in flight or a socket open: `close` first.
    pub unsafe fn open<C: ChannelContainer>(
        &self,
        this: &C,
        options: ChannelOptions,
    ) -> Result<(), Error> {
        debug_assert!(!self.is_open());
        let mut channel: *mut ares_channel_t = ptr::null_mut();

        library_init();

        unsafe extern "C" fn on_sock_state<C: ChannelContainer>(
            ctx: *mut c_void,
            socket: ares_socket_t,
            readable: c_int,
            writable: c_int,
        ) {
            // SAFETY: `ctx` is the `&C` registered below, and nothing borrows it mutably while a socket is open.
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
            sock_state_cb_data: std::ptr::from_ref::<C>(this).cast_mut().cast::<c_void>(),
            timeout: options.timeout,
            tries: options.tries,
            ..Default::default()
        };

        let optmask: c_int =
            ARES_OPT_FLAGS | ARES_OPT_TIMEOUTMS | ARES_OPT_SOCK_STATE_CB | ARES_OPT_TRIES;

        // c-ares creates its sockets with ws2_32 directly, and libuv initializes Winsock lazily.
        #[cfg(windows)]
        bun_libuv_sys::uv__winsock_ensure();
        // SAFETY: c-ares FFI; opts/channel are valid stack pointers.
        Error::check(unsafe { ares_init_options(&raw mut channel, &raw mut opts, optmask) })?;
        self.raw.set(NonNull::new(channel));
        Ok(())
    }

    /// Fails every query in flight with `EDESTRUCTION` and closes the sockets.
    pub fn close(&self) -> Answers<Q> {
        if let Some(raw) = self.raw.take() {
            // SAFETY: from `ares_init_options`, and `raw` no longer has it.
            unsafe { ares_destroy(raw.as_ptr()) };
        }
        self.take_answers()
    }

    /// Only for the argument of one call into c-ares.
    fn raw(&self) -> Result<&ares_channel_t, Error> {
        let raw = self.raw.get().ok_or(Error::EDESTRUCTION)?;
        Ok(ares_channel_t::opaque_ref(raw.as_ptr()))
    }

    fn take_answers(&self) -> Answers<Q> {
        let mut newest = self.answered.replace(Answers(None)).0;
        let mut oldest = None;
        while let Some((answer, mut query)) = newest {
            newest = core::mem::replace(&mut query.next.0, oldest);
            oldest = Some((answer, query));
        }
        Answers(oldest)
    }

    /// `call` hands its second argument to c-ares as the `arg` of a query, or fails.
    fn send(
        &self,
        data: Q,
        call: impl FnOnce(&ares_channel_t, *mut c_void) -> Result<(), Error>,
    ) -> Answers<Q> {
        let query = bun_core::heap::into_raw(Box::new(Query {
            data,
            channel: NonNull::from(self),
            next: Answers(None),
        }));
        match self.raw().and_then(|raw| call(raw, query.cast())) {
            Ok(()) => self.take_answers(),
            // SAFETY: c-ares did not get it.
            Err(err) => Answers(Some((Err(err), unsafe { bun_core::heap::take(query) }))),
        }
    }

    pub fn has_active_queries(&self) -> bool {
        self.raw()
            .is_ok_and(|raw| ares_queue_active_queries(raw) != 0)
    }

    pub fn servers(&self) -> Result<Servers, Error> {
        let mut servers = None;
        // SAFETY: c-ares FFI; `servers` is a stack out-param, which a failure leaves null.
        Error::check(unsafe { ares_get_servers_ports(self.raw()?, &mut servers) })?;
        Ok(Servers(servers))
    }

    /// `None` clears the list.
    pub fn set_servers(
        &self,
        servers: Option<&struct_ares_addr_port_node<'_>>,
    ) -> (Result<(), Error>, Answers<Q>) {
        let result = self.raw().and_then(|raw| {
            // SAFETY: c-ares FFI; it copies the list.
            Error::check(unsafe { ares_set_servers_ports(raw, servers) })
        });
        (result, self.take_answers())
    }

    pub fn set_local_ip(&self, ip: IpAddr) {
        match (self.raw(), ip) {
            (Ok(raw), IpAddr::V4(ip)) => ares_set_local_ip4(raw, ip.to_bits()),
            (Ok(raw), IpAddr::V6(ip)) => ares_set_local_ip6(raw, &ip.octets()),
            (Err(_), _) => {}
        }
    }

    pub fn get_addr_info(
        &self,
        host: &[u8],
        port: u16,
        hints: &AddrInfo_hints,
        data: Q,
    ) -> Answers<Q> {
        let mut host_buf = [0u8; 1024];
        let mut port_buf = [0u8; 21];
        let host_ptr = copy_nul_terminated(&mut host_buf, host);

        let port_ptr: *const c_char = if port > 0 {
            bun_core::fmt::itoa_z(&mut port_buf, port as u64).as_ptr()
        } else {
            ptr::null()
        };

        self.send(data, |raw, ctx| {
            // SAFETY: c-ares FFI; host/port are NUL-terminated stack buffers or null.
            unsafe { ares_getaddrinfo(raw, host_ptr, port_ptr, hints, on_addrinfo::<Q>, ctx) };
            Ok(())
        })
    }

    pub fn resolve(&self, record: RecordType, name: &[u8], data: Q) -> Answers<Q> {
        macro_rules! callback {
            ($($record:ident)+) => {
                match record {
                    $(RecordType::$record => on_message::<Q, { RecordType::$record }>,)+
                }
            };
        }
        let callback: ares_callback = callback!(A NS CNAME SOA PTR MX TXT AAAA SRV NAPTR ANY CAA);
        self.send(data, |raw, ctx| {
            if name.len() >= 1023 || bun_core::strings::contains_char(name, 0) {
                return Err(Error::EBADNAME);
            }
            let mut name_buf = [0u8; 1024];
            let name = copy_nul_terminated(&mut name_buf, name);
            // SAFETY: c-ares FFI; `name` is a NUL-terminated stack buffer.
            unsafe { ares_query(raw, name, ARES_CLASS_IN, record, callback, ctx) };
            Ok(())
        })
    }

    pub fn get_host_by_addr(&self, ip_addr: &[u8], data: Q) -> Answers<Q> {
        self.send(data, |raw, ctx| {
            // "0000:0000:0000:0000:0000:ffff:192.168.100.228".length = 45
            let mut addr_buf = [0u8; 46];
            let text = bun_core::strings::copy_z(&mut addr_buf, ip_addr);
            let (v4, v6);
            let (addr, family): (&[u8], c_int) = match text.and_then(crate::parse_ip) {
                Some(IpAddr::V4(ip)) => {
                    v4 = ip.octets();
                    (&v4, AF::INET)
                }
                Some(IpAddr::V6(ip)) => {
                    v6 = ip.octets();
                    (&v6, AF::INET6)
                }
                None => return Err(Error::ENOTIMP),
            };
            let (addr, len) = (addr.as_ptr().cast(), addr.len() as c_int);
            // SAFETY: c-ares FFI; `addr` has the size of an address of `family`.
            unsafe { ares_gethostbyaddr(raw, addr, len, family, on_hostent::<Q>, ctx) };
            Ok(())
        })
    }

    /// https://c-ares.org/ares_getnameinfo.html
    pub fn get_name_info(&self, sa: &sockaddr_storage, data: Q) -> Answers<Q> {
        let salen: ares_socklen_t = if sa.ss_family == AF::INET as _ {
            core::mem::size_of::<sockaddr_in>() as ares_socklen_t
        } else {
            core::mem::size_of::<sockaddr_in6>() as ares_socklen_t
        };
        // NAMEREQD: like Node, ENOTFOUND for an address that has no name.
        let flags = ARES_NI_NAMEREQD | ARES_NI_LOOKUPHOST | ARES_NI_LOOKUPSERVICE;
        let sa = std::ptr::from_ref::<sockaddr_storage>(sa).cast::<sockaddr>();
        self.send(data, |raw, ctx| {
            // SAFETY: c-ares FFI; sa is a valid sockaddr of size `salen`.
            unsafe { ares_getnameinfo(raw, sa, salen, flags, on_nameinfo::<Q>, ctx) };
            Ok(())
        })
    }

    pub fn cancel(&self) -> Answers<Q> {
        if let Ok(raw) = self.raw() {
            ares_cancel(raw);
        }
        self.take_answers()
    }

    pub fn process_timeouts(&self) -> Answers<Q> {
        self.process(ARES_SOCKET_BAD, false, false)
    }

    pub fn process(&self, fd: ares_socket_t, readable: bool, writable: bool) -> Answers<Q> {
        if let Ok(raw) = self.raw() {
            ares_process_fd(
                raw,
                if readable { fd } else { ARES_SOCKET_BAD },
                if writable { fd } else { ARES_SOCKET_BAD },
            );
        }
        self.take_answers()
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

type ares_callback = unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int);
type ares_host_callback =
    unsafe extern "C" fn(*mut c_void, c_int, c_int, Option<&struct_hostent<'_>>);
type ares_nameinfo_callback =
    unsafe extern "C" fn(*mut c_void, c_int, c_int, Option<CStrRef<'_>>, Option<CStrRef<'_>>);
type ares_addrinfo_callback =
    unsafe extern "C" fn(*mut c_void, c_int, c_int, Option<OwnedAddrInfo>);

unsafe extern "C" {
    fn ares_library_init_mem(
        flags: c_int,
        amalloc: Option<unsafe extern "C" fn(usize) -> *mut c_void>,
        afree: Option<unsafe extern "C" fn(*mut c_void)>,
        arealloc: Option<unsafe extern "C" fn(*mut c_void, usize) -> *mut c_void>,
    ) -> c_int;
    fn ares_init_options(
        channelptr: *mut *mut ares_channel_t,
        options: *mut Options,
        optmask: c_int,
    ) -> c_int;
    fn ares_destroy(channel: *mut ares_channel_t);
    safe fn ares_cancel(channel: &ares_channel_t);
    safe fn ares_set_local_ip4(channel: &ares_channel_t, local_ip: c_uint);
    safe fn ares_set_local_ip6(channel: &ares_channel_t, local_ip6: &[u8; 16]);
    fn ares_getaddrinfo(
        channel: &ares_channel_t,
        node: *const c_char,
        service: *const c_char,
        hints: &AddrInfo_hints,
        callback: ares_addrinfo_callback,
        arg: *mut c_void,
    );
    fn ares_freeaddrinfo(ai: *mut AddrInfo<'_>);
    fn ares_query(
        channel: &ares_channel_t,
        name: *const c_char,
        dnsclass: c_int,
        type_: RecordType,
        callback: ares_callback,
        arg: *mut c_void,
    );
    fn ares_gethostbyaddr(
        channel: &ares_channel_t,
        addr: *const c_void,
        addrlen: c_int,
        family: c_int,
        callback: ares_host_callback,
        arg: *mut c_void,
    );
    fn ares_getnameinfo(
        channel: &ares_channel_t,
        sa: *const sockaddr,
        salen: ares_socklen_t,
        flags: c_int,
        callback: ares_nameinfo_callback,
        arg: *mut c_void,
    );
    safe fn ares_process_fd(
        channel: &ares_channel_t,
        read_fd: ares_socket_t,
        write_fd: ares_socket_t,
    );
    safe fn ares_queue_active_queries(channel: &ares_channel_t) -> usize;
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

unsafe extern "C" {
    fn ares_parse_a_reply(
        abuf: *const u8,
        alen: c_int,
        host: &mut Option<OwnedHostent>,
        addrttls: *mut AddrTtl<4>,
        naddrttls: *mut c_int,
    ) -> c_int;
    fn ares_parse_aaaa_reply(
        abuf: *const u8,
        alen: c_int,
        host: &mut Option<OwnedHostent>,
        addrttls: *mut AddrTtl<16>,
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
        channel: &ares_channel_t,
        servers: Option<&struct_ares_addr_port_node<'_>>,
    ) -> c_int;
    fn ares_get_servers_ports(
        channel: &ares_channel_t,
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

/// The `ARES_E*` statuses.
#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, strum::IntoStaticStr)]
pub enum Error {
    ENODATA = 1,
    EFORMERR = 2,
    ESERVFAIL = 3,
    ENOTFOUND = 4,
    ENOTIMP = 5,
    EREFUSED = 6,
    EBADQUERY = 7,
    EBADNAME = 8,
    EBADFAMILY = 9,
    EBADRESP = 10,
    ECONNREFUSED = 11,
    ETIMEOUT = 12,
    EOF = 13,
    EFILE = 14,
    ENOMEM = 15,
    EDESTRUCTION = 16,
    EBADSTR = 17,
    EBADFLAGS = 18,
    ENONAME = 19,
    EBADHINTS = 20,
    ENOTINITIALIZED = 21,
    ELOADIPHLPAPI = 22,
    EADDRGETNETWORKPARAMS = 23,
    ECANCELLED = 24,
    ESERVICE = 25,
    ENOSERVER = 26,
    /// getaddrinfo(3) `EAI_AGAIN`. Not a c-ares status: [`Error::check`] never
    /// produces it, and its errno comes from [`Error::errno`].
    EAI_AGAIN = 27,
}

/// libuv's `UV_EAI_AGAIN`, the `errno` Node reports for getaddrinfo `EAI_AGAIN`.
const UV_EAI_AGAIN: i32 = -3001;

impl Error {
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
        if rc == ARES_SUCCESS {
            return Ok(());
        }
        // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
        if rc == Error::ENODATA as i32 || rc == Error::ENONAME as i32 {
            return Err(Error::ENOTFOUND);
        }
        let n = rc.unsigned_abs();
        assert!(
            n <= Error::ENOSERVER as u32,
            "c-ares status {rc} out of range",
        );
        // SAFETY: `Error` is `#[repr(i32)]`, and every value in `1..=ENOSERVER` is a discriminant.
        Err(unsafe { core::mem::transmute::<i32, Error>(n as i32) })
    }
}

const ARES_FLAG_NOCHECKRESP: c_int = 1 << 7;
const ARES_OPT_FLAGS: c_int = 1 << 0;
const ARES_OPT_TRIES: c_int = 1 << 2;
const ARES_OPT_SOCK_STATE_CB: c_int = 1 << 9;
const ARES_OPT_TIMEOUTMS: c_int = 1 << 13;
const ARES_NI_NAMEREQD: c_int = 1 << 2;
const ARES_NI_LOOKUPHOST: c_int = 1 << 8;
const ARES_NI_LOOKUPSERVICE: c_int = 1 << 9;

const ARES_LIB_INIT_WIN32: c_int = 1 << 0;
const ARES_LIB_INIT_ALL: c_int = ARES_LIB_INIT_WIN32;

#[cfg(windows)]
const ARES_SOCKET_BAD: ares_socket_t = usize::MAX; // INVALID_SOCKET
#[cfg(not(windows))]
const ARES_SOCKET_BAD: ares_socket_t = -1;

/// The C `struct in_addr` (4-byte IPv4 address), as c-ares' `ares_options.servers` declares it.
#[repr(C)]
#[derive(Copy, Clone)]
struct in_addr {
    s_addr: u32,
}

#[cfg(test)]
#[path = "channel_tests.rs"]
mod tests;
