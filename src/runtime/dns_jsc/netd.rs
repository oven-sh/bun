//! Android: DNS record queries through the platform resolver (netd).
//!
//! Android does not tell native code which nameservers to use — DNS is per
//! network, may be Private DNS (DoT/DoH), and is cached and policed centrally in
//! netd's `DnsResolver`. Address lookups already go there (bionic proxies
//! `getaddrinfo`, and `Backend::default()` is `System` on Android), but c-ares
//! needs a server list, so `resolve*`/`reverse`/`lookupService` used to fall
//! back to `127.0.0.1` and time out. This backend sends those queries through
//! `android_res_nquery` (API 29+, `<android/multinetwork.h>`) instead: netd
//! answers with the raw DNS reply packet, which is handed to the same c-ares
//! `ares_parse_*` code the c-ares transport feeds, so everything above the
//! transport is shared.
//!
//! The symbols are looked up at runtime (we target API 28); when they are not
//! there, or once the user gives a resolver explicit servers with
//! `setServers()`, the c-ares transport is used as before.

use super::*;
use bun_io::FilePoll;

const NETWORK_UNSPECIFIED: u64 = 0;
const NS_C_IN: c_int = 1;
const NS_T_PTR: c_int = 12;
/// Largest DNS message; netd may answer over TCP.
const MAX_ANSWER: usize = 65535;

type ResNquery = unsafe extern "C" fn(
    network: u64,
    dname: *const c_char,
    ns_class: c_int,
    ns_type: c_int,
    flags: u32,
) -> c_int;
type ResNresult =
    unsafe extern "C" fn(fd: c_int, rcode: *mut c_int, answer: *mut u8, anslen: usize) -> c_int;
type ResCancel = unsafe extern "C" fn(fd: c_int);

pub(crate) struct Api {
    nquery: ResNquery,
    nresult: ResNresult,
    cancel: ResCancel,
}

/// The netd resolver entry points, or `None` before API 29.
pub(crate) fn api() -> Option<&'static Api> {
    static API: std::sync::OnceLock<Option<Api>> = std::sync::OnceLock::new();
    API.get_or_init(|| {
        // libandroid_net.so is the small library that carries just these; fall
        // back to libandroid.so, which re-exports them.
        let handle = [
            bun_core::zstr!("libandroid_net.so"),
            bun_core::zstr!("libandroid.so"),
        ]
        .into_iter()
        .find_map(|name| sys::dlopen(name, sys::RTLD::LAZY | sys::RTLD::LOCAL))?;
        Some(Api {
            nquery: sys::dlsym_with_handle!(ResNquery, "android_res_nquery", Some(handle))?,
            nresult: sys::dlsym_with_handle!(ResNresult, "android_res_nresult", Some(handle))?,
            cancel: sys::dlsym_with_handle!(ResCancel, "android_res_cancel", Some(handle))?,
        })
    })
    .as_ref()
}

/// What to do with the answer once netd has it.
pub(crate) enum Completion {
    /// `resolve*()`: hand the raw reply to the record type's `ares_callback`
    /// (`ResolveHandler::raw_callback`), exactly as `ares_query` would.
    Raw {
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut u8, c_int),
    },
    /// `reverse()`: parse the PTR reply into a hostent for `HostentHandler`.
    Reverse {
        request: *mut GetHostByAddrInfoRequest,
        family: c_int,
        addr: [u8; 16],
    },
    /// `lookupService()`: PTR reply → node name; the service name is local.
    NameInfo {
        request: *mut GetNameInfoRequest,
        family: c_int,
        addr: [u8; 16],
        port: u16,
    },
}

/// One in-flight netd query. Heap-allocated; owns its `FilePoll` and holds a
/// reference on the resolver until it completes.
pub(crate) struct Query {
    resolver: *mut Resolver,
    poll: *mut FilePoll,
    fd: c_int,
    completion: Completion,
}

impl Query {
    /// Send `name`/`ns_type` to netd and arm a poll for the answer. On failure
    /// nothing was started and the c-ares status to report is returned; the
    /// caller completes the request with it (synchronously, as c-ares does for
    /// e.g. `ARES_EBADNAME`).
    pub(crate) fn start(
        api: &'static Api,
        resolver: &Resolver,
        name: &[u8],
        ns_type: c_int,
        completion: Completion,
    ) -> Result<(), c_int> {
        if name.len() >= 1023 || strings::contains_char(name, 0) {
            return Err(c_ares::Error::EBADNAME as c_int);
        }
        let mut name_buf = [0u8; 1024];
        name_buf[..name.len()].copy_from_slice(name);

        // SAFETY: `name_buf` is NUL-terminated; plain FFI call.
        let fd = unsafe {
            (api.nquery)(
                NETWORK_UNSPECIFIED,
                name_buf.as_ptr().cast::<c_char>(),
                NS_C_IN,
                ns_type,
                0,
            )
        };
        if fd < 0 {
            return Err(status_from_errno(-fd));
        }

        let resolver_ptr = resolver.as_ctx_ptr();
        let this = bun_core::heap::into_raw(Box::new(Query {
            resolver: resolver_ptr,
            poll: core::ptr::null_mut(),
            fd,
            completion,
        }));
        let ctx = js_event_loop_ctx();
        let poll = FilePoll::init(
            ctx,
            sys::Fd::from_native(fd),
            Default::default(),
            Async::Owner::new(
                Async::posix_event_loop::poll_tag::DNS_NETD_QUERY,
                this.cast::<()>(),
            ),
        );
        // SAFETY: `this` was just allocated above and is not shared yet.
        unsafe { (*this).poll = poll };
        // SAFETY: `event_loop_handle` is set once the VM is initialized; live for its lifetime.
        let loop_ = unsafe { &mut *resolver.vm().event_loop_handle.unwrap() };
        // SAFETY: `poll` is the live slot `FilePoll::init` returned; exclusive here.
        if unsafe { &mut *poll }
            .register(loop_, Async::PollKind::Readable, true)
            .is_err()
        {
            // SAFETY: `poll`/`this` are the allocations made above; the fd is
            // still ours until `cancel` (which closes it).
            unsafe {
                (*poll).deinit_with_vm(ctx);
                (api.cancel)(fd);
                drop(bun_core::heap::take(this));
            }
            return Err(c_ares::Error::ECONNREFUSED as c_int);
        }
        // An outstanding query keeps the process alive (the c-ares transport gets
        // this from its retry timer instead); undone by `deinit_with_vm`.
        // SAFETY: `poll` is live and registered.
        unsafe { (*poll).enable_keeping_process_alive(ctx) };

        resolver.ref_();
        resolver.netd_inflight.set(resolver.netd_inflight.get() + 1);
        Ok(())
    }

    /// `FilePoll` readiness callback: netd has an answer (or an error) for us.
    pub(crate) fn on_poll(this: *mut Query) {
        let api = api().expect("a netd query exists only when the api loaded");
        let ctx = js_event_loop_ctx();
        // SAFETY: `this` is the live allocation registered as the poll owner;
        // it is consumed here and nothing touches it afterwards.
        let Query {
            resolver,
            poll,
            fd,
            completion,
        } = unsafe { *bun_core::heap::take(this) };
        // Unregister while the fd is still open; `nresult` closes it.
        // SAFETY: `poll` is the live slot created in `start`.
        unsafe { (*poll).deinit_with_vm(ctx) };

        let mut answer = vec![0u8; MAX_ANSWER];
        let mut rcode: c_int = 0;
        // SAFETY: `answer` is a writable buffer of the given length; `fd` is the
        // query fd netd handed us and has not been consumed yet.
        let n = unsafe { (api.nresult)(fd, &raw mut rcode, answer.as_mut_ptr(), answer.len()) };
        let (status, len) = if n < 0 {
            (status_from_errno(-n), 0)
        } else {
            (status_from_reply(&answer[..n as usize]), n)
        };

        // SAFETY: `resolver` was ref'd in `start`; the guard releases that ref
        // after the completion (which may re-enter the resolver) has run.
        let resolver_ref = unsafe { &*resolver };
        completion.run(status, &mut answer[..len as usize]);
        resolver_ref
            .netd_inflight
            .set(resolver_ref.netd_inflight.get() - 1);
        resolver_ref.request_completed();
        // SAFETY: balances the `ref_()` in `start`; no borrow of `*resolver`
        // is live past this point.
        unsafe { Resolver::deref(resolver) };
    }
}

impl Completion {
    fn run(self, status: c_int, answer: &mut [u8]) {
        match self {
            Completion::Raw { ctx, callback } => {
                // SAFETY: `ctx`/`callback` are the request and its `ares_callback`
                // thunk, which consumes the request; `answer` outlives the call.
                unsafe {
                    callback(
                        ctx,
                        status,
                        0,
                        answer.as_mut_ptr(),
                        c_int::try_from(answer.len()).expect("int cast"),
                    )
                };
            }
            Completion::Reverse {
                request,
                family,
                addr,
            } => {
                let (err, hostent) = parse_ptr(status, answer, family, &addr);
                // SAFETY: `request` is the live heap request; `on_hostent`
                // consumes it and only borrows `hostent` for the call.
                unsafe {
                    c_ares::HostentHandler::on_hostent(&mut *request, err, 0, hostent);
                    if !hostent.is_null() {
                        c_ares::ares_free_hostent(hostent);
                    }
                }
            }
            Completion::NameInfo {
                request,
                family,
                addr,
                port,
            } => {
                let (err, hostent) = parse_ptr(status, answer, family, &addr);
                let mut service_buf = [0u8; 32];
                let info = if hostent.is_null() {
                    None
                } else {
                    Some(c_ares::struct_nameinfo {
                        // SAFETY: non-null hostent from ares_parse_ptr_reply has a
                        // NUL-terminated h_name.
                        node: unsafe { (*hostent).h_name.cast::<u8>() },
                        service: service_name(port, &mut service_buf),
                    })
                };
                // SAFETY: `request` is the live heap request; `on_nameinfo`
                // consumes it and copies node/service during the call.
                unsafe {
                    c_ares::NameinfoHandler::on_nameinfo(
                        &mut *request,
                        if info.is_some() {
                            None
                        } else {
                            err.or(c_ares::Error::get(c_ares::Error::ENOTFOUND as c_int))
                        },
                        0,
                        info,
                    );
                    if !hostent.is_null() {
                        c_ares::ares_free_hostent(hostent);
                    }
                }
            }
        }
    }
}

fn parse_ptr(
    status: c_int,
    answer: &[u8],
    family: c_int,
    addr: &[u8; 16],
) -> (Option<c_ares::Error>, *mut c_ares::struct_hostent) {
    if status != c_ares::ARES_SUCCESS {
        return (c_ares::Error::get(status), core::ptr::null_mut());
    }
    let addrlen: c_int = if family == libc::AF_INET { 4 } else { 16 };
    let mut hostent: *mut c_ares::struct_hostent = core::ptr::null_mut();
    // SAFETY: `answer` is the reply netd wrote; `addr` holds `addrlen` bytes;
    // `hostent` is a stack out-param.
    let r = unsafe {
        c_ares::ares_parse_ptr_reply(
            answer.as_ptr(),
            c_int::try_from(answer.len()).expect("int cast"),
            addr.as_ptr().cast::<c_void>(),
            addrlen,
            family,
            &raw mut hostent,
        )
    };
    (c_ares::Error::get(r), hostent)
}

/// `getservbyport` name for `port` (what `getnameinfo` reports), else the number.
fn service_name(port: u16, buf: &mut [u8; 32]) -> *mut u8 {
    // SAFETY: plain libc lookup in the services database; the returned record
    // is libc-owned static storage, copied out immediately.
    let ent = unsafe { libc::getservbyport(c_int::from(port.to_be()), core::ptr::null()) };
    let name: &[u8] = if ent.is_null() {
        &[]
    } else {
        // SAFETY: non-null servent has a NUL-terminated s_name.
        unsafe { core::ffi::CStr::from_ptr((*ent).s_name) }.to_bytes()
    };
    if name.is_empty() || name.len() >= buf.len() {
        let mut digits = [0u8; 21];
        let len = bun_core::fmt::itoa_z(&mut digits, u64::from(port))
            .to_bytes()
            .len();
        buf[..=len].copy_from_slice(&digits[..=len]);
        return buf.as_mut_ptr();
    }
    buf[..name.len()].copy_from_slice(name);
    buf[name.len()] = 0;
    buf.as_mut_ptr()
}

/// `getnameinfo` names a v4-mapped IPv6 address by the IPv4 address it embeds.
pub(crate) fn unmap_v4((family, addr): (c_int, [u8; 16])) -> (c_int, [u8; 16]) {
    const MAPPED_PREFIX: [u8; 12] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];
    if family == libc::AF_INET6 && addr[..12] == MAPPED_PREFIX {
        let mut v4 = [0u8; 16];
        v4[..4].copy_from_slice(&addr[12..]);
        return (libc::AF_INET, v4);
    }
    (family, addr)
}

/// The `in-addr.arpa`/`ip6.arpa` owner name for a binary address.
pub(crate) fn reverse_name(family: c_int, addr: &[u8; 16], out: &mut Vec<u8>) {
    use std::io::Write;
    if family == libc::AF_INET {
        write!(
            out,
            "{}.{}.{}.{}.in-addr.arpa",
            addr[3], addr[2], addr[1], addr[0]
        )
        .expect("infallible: in-memory write");
    } else {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for byte in addr.iter().rev() {
            out.extend_from_slice(&[
                HEX[usize::from(byte & 0xf)],
                b'.',
                HEX[usize::from(byte >> 4)],
                b'.',
            ]);
        }
        out.extend_from_slice(b"ip6.arpa");
    }
}

/// `ares_query`'s mapping from a reply's header to a status, so callers see the
/// same codes whichever transport carried the query.
fn status_from_reply(answer: &[u8]) -> c_int {
    if answer.len() < 12 {
        return c_ares::Error::EBADRESP as c_int;
    }
    let rcode = answer[3] & 0x0f;
    let ancount = u16::from_be_bytes([answer[6], answer[7]]);
    match rcode {
        0 if ancount > 0 => c_ares::ARES_SUCCESS,
        0 => c_ares::Error::ENODATA as c_int,
        1 => c_ares::Error::EFORMERR as c_int,
        2 => c_ares::Error::ESERVFAIL as c_int,
        3 => c_ares::Error::ENOTFOUND as c_int,
        4 => c_ares::Error::ENOTIMP as c_int,
        5 => c_ares::Error::EREFUSED as c_int,
        _ => c_ares::Error::EBADRESP as c_int,
    }
}

/// netd reports transport failures as a negative errno from `nquery`/`nresult`.
fn status_from_errno(errno: c_int) -> c_int {
    match errno {
        libc::ETIMEDOUT => c_ares::Error::ETIMEOUT as c_int,
        libc::ENOMEM => c_ares::Error::ENOMEM as c_int,
        libc::EINVAL => c_ares::Error::EBADQUERY as c_int,
        _ => c_ares::Error::ECONNREFUSED as c_int,
    }
}

pub(crate) const PTR: c_int = NS_T_PTR;
