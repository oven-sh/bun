//! `<dns_sd.h>` — the mDNSResponder client API. libsystem_dnssd is part of the
//! libSystem umbrella and always linked on macOS.

use core::ffi::{CStr, c_char, c_int, c_void};
use core::ptr::NonNull;

use crate::net::Address;

pub type DNSServiceFlags = u32;
pub type DNSServiceErrorType = i32;
pub type DNSServiceProtocol = u32;

pub const FLAGS_MORE_COMING: DNSServiceFlags = 0x1;
pub const FLAGS_ADD: DNSServiceFlags = 0x2;
pub const FLAGS_RETURN_INTERMEDIATES: DNSServiceFlags = 0x1000;
pub const FLAGS_SHARE_CONNECTION: DNSServiceFlags = 0x4000;
pub const FLAGS_SUPPRESS_UNUSABLE: DNSServiceFlags = 0x8000;
pub const FLAGS_TIMEOUT: DNSServiceFlags = 0x10000;

pub const PROTOCOL_IPV4: DNSServiceProtocol = 0x01;
pub const PROTOCOL_IPV6: DNSServiceProtocol = 0x02;

pub const ERR_NO_ERROR: DNSServiceErrorType = 0;
pub const ERR_NO_MEMORY: DNSServiceErrorType = -65539;
pub const ERR_NO_SUCH_RECORD: DNSServiceErrorType = -65554;
pub const ERR_TIMEOUT: DNSServiceErrorType = -65568;
pub const ERR_DEFUNCT_CONNECTION: DNSServiceErrorType = -65569;

bun_opaque::opaque_ffi! {
    /// `struct _DNSServiceRef_t`.
    pub struct DNSServiceRefOpaque;
}
type DNSServiceRef = *mut DNSServiceRefOpaque;

type DNSServiceGetAddrInfoReply = unsafe extern "C" fn(
    sd_ref: DNSServiceRef,
    flags: DNSServiceFlags,
    interface_index: u32,
    error_code: DNSServiceErrorType,
    hostname: *const c_char,
    address: *const crate::posix::sockaddr,
    ttl: u32,
    context: *mut c_void,
);

unsafe extern "C" {
    fn DNSServiceCreateConnection(sd_ref: *mut DNSServiceRef) -> DNSServiceErrorType;
    fn DNSServiceRefSockFD(sd_ref: DNSServiceRef) -> c_int;
    fn DNSServiceProcessResult(sd_ref: DNSServiceRef) -> DNSServiceErrorType;
    fn DNSServiceRefDeallocate(sd_ref: DNSServiceRef);
    // SPI (macOS 12+): DNSServiceGetAddrInfo plus the attribute libinfo's getaddrinfo passes.
    fn DNSServiceGetAddrInfoEx(
        sd_ref: *mut DNSServiceRef,
        flags: DNSServiceFlags,
        interface_index: u32,
        protocol: DNSServiceProtocol,
        hostname: *const c_char,
        attr: *const DNSServiceAttribute,
        callback: DNSServiceGetAddrInfoReply,
        context: *mut c_void,
    ) -> DNSServiceErrorType;
    /// Lets mDNSResponder fail a query over to other resolvers (scoped/supplemental), as getaddrinfo does.
    #[allow(non_upper_case_globals)]
    static kDNSServiceAttrAllowFailover: DNSServiceAttribute;
}

#[repr(C)]
struct DNSServiceAttribute {
    _opaque: [u8; 0],
}

/// One `DNSServiceGetAddrInfo` reply, as seen inside [`Connection::process_result`].
pub struct Reply<'a> {
    pub flags: DNSServiceFlags,
    pub interface_index: u32,
    pub error_code: DNSServiceErrorType,
    pub hostname: Option<&'a CStr>,
    /// `None` only for replies that carry no address (e.g. `PolicyDenied`).
    pub address: Option<Address>,
    pub ttl: u32,
}

/// The object a query's replies are delivered to.
pub trait GetAddrInfoReply {
    /// Runs inside [`Connection::process_result`] on the connection's thread,
    /// once per reply, while the [`Query`] is alive.
    fn on_reply(&self, reply: &Reply<'_>);
}

/// The primary `DNSServiceCreateConnection` ref. Deallocating it invalidates
/// every subordinate made on it (dns_sd.h), so each [`Query`] holds a share and
/// it is deallocated only once the [`Connection`] and every `Query` are gone.
struct PrimaryRef(NonNull<DNSServiceRefOpaque>);

impl Drop for PrimaryRef {
    fn drop(&mut self) {
        // SAFETY: the live ref `DNSServiceCreateConnection` returned; no
        // subordinate is left (each held an `Rc` to this).
        unsafe { DNSServiceRefDeallocate(self.0.as_ptr()) }
    }
}

/// The primary connection to mDNSResponder (`DNSServiceCreateConnection`).
pub struct Connection(std::rc::Rc<PrimaryRef>);

impl Connection {
    pub fn create() -> Result<Self, DNSServiceErrorType> {
        let mut sd_ref: DNSServiceRef = core::ptr::null_mut();
        // SAFETY: `sd_ref` is a stack out-param.
        let err = unsafe { DNSServiceCreateConnection(&raw mut sd_ref) };
        if err != ERR_NO_ERROR {
            return Err(err);
        }
        let primary = NonNull::new(sd_ref).ok_or(ERR_NO_MEMORY)?;
        Ok(Self(std::rc::Rc::new(PrimaryRef(primary))))
    }

    #[inline]
    fn raw(&self) -> DNSServiceRef {
        (self.0).0.as_ptr()
    }

    /// The connection's socket; readable when replies are buffered.
    #[inline]
    pub fn sock_fd(&self) -> c_int {
        // SAFETY: live connection ref.
        unsafe { DNSServiceRefSockFD(self.raw()) }
    }

    /// Read one batch of replies off the socket, running each query's
    /// [`GetAddrInfoReply::on_reply`] inline.
    #[inline]
    pub fn process_result(&self) -> DNSServiceErrorType {
        // SAFETY: live connection ref.
        unsafe { DNSServiceProcessResult(self.raw()) }
    }

    /// Start a `kDNSServiceFlagsShareConnection` address query (allowed to fail
    /// over to other resolvers, as `getaddrinfo` is) whose replies go to
    /// `*context`. The holder of `context` keeps it alive for as long as the
    /// returned [`Query`].
    pub fn get_addr_info<C: GetAddrInfoReply>(
        &self,
        flags: DNSServiceFlags,
        interface_index: u32,
        protocol: DNSServiceProtocol,
        hostname: &CStr,
        context: bun_ptr::BackRef<C>,
    ) -> Result<Query, DNSServiceErrorType> {
        // ShareConnection requires `sub` to start as a copy of the primary ref.
        let mut sub: DNSServiceRef = self.raw();
        // SAFETY: `hostname` is NUL-terminated (dns_sd copies it); `context` is
        // only stored, and handed back to `reply_callback::<C>`.
        let err = unsafe {
            DNSServiceGetAddrInfoEx(
                &raw mut sub,
                flags | FLAGS_SHARE_CONNECTION,
                interface_index,
                protocol,
                hostname.as_ptr(),
                &raw const kDNSServiceAttrAllowFailover,
                reply_callback::<C>,
                context.as_const_ptr().cast_mut().cast::<c_void>(),
            )
        };
        if err != ERR_NO_ERROR {
            return Err(err);
        }
        let sub = NonNull::new(sub).ok_or(ERR_NO_MEMORY)?;
        Ok(Query {
            sub,
            _primary: std::rc::Rc::clone(&self.0),
        })
    }
}

/// A subordinate query on a [`Connection`]; deallocated on drop (on the
/// connection's thread, like every other use of the connection), after which
/// no more replies are delivered for it. Keeps the primary ref alive.
pub struct Query {
    sub: NonNull<DNSServiceRefOpaque>,
    _primary: std::rc::Rc<PrimaryRef>,
}

impl Drop for Query {
    fn drop(&mut self) {
        // SAFETY: the live subordinate ref `DNSServiceGetAddrInfoEx` returned; its
        // primary is still alive (`_primary`, dropped after this).
        unsafe { DNSServiceRefDeallocate(self.sub.as_ptr()) }
    }
}

unsafe extern "C" fn reply_callback<C: GetAddrInfoReply>(
    _sd_ref: DNSServiceRef,
    flags: DNSServiceFlags,
    interface_index: u32,
    error_code: DNSServiceErrorType,
    hostname: *const c_char,
    address: *const crate::posix::sockaddr,
    ttl: u32,
    context: *mut c_void,
) {
    // SAFETY: `context` is the `BackRef<C>` `get_addr_info` registered, whose
    // holder keeps `*context` alive while the `Query` is; replies are only
    // delivered while it is.
    let this = unsafe { &*context.cast::<C>() };
    let hostname = if hostname.is_null() {
        None
    } else {
        // SAFETY: dns_sd passes a NUL-terminated name valid for the call.
        Some(unsafe { CStr::from_ptr(hostname) })
    };
    let address = if address.is_null() {
        None
    } else {
        // SAFETY: dnssd_clientstub passes a sockaddr of the family it declares.
        Some(unsafe { Address::init_posix(address.cast()) })
    };
    this.on_reply(&Reply {
        flags,
        interface_index,
        error_code,
        hostname,
        address,
        ttl,
    });
}
