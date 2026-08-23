//! The connect path's view of Bun's process-wide DNS cache
//! (`packages/bun-usockets/src/internal/internal.h`: `struct addrinfo_result`,
//! `us_internal_dns_callback*`). The cache itself lives in
//! `bun_runtime::dns_jsc::internal`; these are the C-ABI pieces usockets reads
//! and the notify calls it takes.

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

#[cfg(windows)]
use bun_libuv_sys::{addrinfo, sockaddr, sockaddr_storage};
#[cfg(not(windows))]
use libc::{addrinfo, sockaddr, sockaddr_storage};

use crate::ConnectingSocket;

/// `struct addrinfo_result_entry`: one resolved address, its `info.ai_addr`
/// pointing at the inline `addr` and `info.ai_next` at the next entry.
#[repr(C)]
pub struct addrinfo_result_entry {
    pub info: addrinfo,
    pub addr: sockaddr_storage,
}

/// `struct addrinfo_result`.
#[repr(C)]
pub struct addrinfo_result {
    pub entries: *mut addrinfo_result_entry,
    pub error: c_int,
}

/// A resolved (or failed) lookup in the shape usockets consumes: one boxed
/// slice of entries chained through their `addrinfo` headers, plus the
/// `getaddrinfo` error code.
pub struct AddrInfoResult {
    entries: Option<Box<[addrinfo_result_entry]>>,
    c: addrinfo_result,
}

// SAFETY: self-contained — `c.entries` and every `info.ai_next` / `info.ai_addr`
// point into `entries`, which this value owns and never reallocates; nothing
// in it is thread-affine.
unsafe impl Send for AddrInfoResult {}
// SAFETY: as above; immutable once built.
unsafe impl Sync for AddrInfoResult {}

impl addrinfo_result_entry {
    /// An unchained entry: `info`'s pointer fields are rewritten when it is
    /// chained into an [`AddrInfoResult`] (`ai_addr` to this entry's `addr`
    /// when `Some`, else null with `addr` zeroed).
    #[inline]
    pub fn new(mut info: addrinfo, addr: Option<&sockaddr_storage>) -> Self {
        info.ai_canonname = core::ptr::null_mut();
        info.ai_next = core::ptr::null_mut();
        // Placeholder; pointed at `addr` by `AddrInfoResult::new`.
        info.ai_addr = if addr.is_some() {
            NonNull::<sockaddr>::dangling().as_ptr()
        } else {
            core::ptr::null_mut()
        };
        Self {
            info,
            addr: addr.map_or_else(bun_core::ffi::zeroed, |a| *a),
        }
    }
}

impl AddrInfoResult {
    /// Chain `entries` (built with [`addrinfo_result_entry::new`]) in order.
    pub fn new(entries: Vec<addrinfo_result_entry>, error: c_int) -> Self {
        if entries.is_empty() {
            return Self {
                entries: None,
                c: addrinfo_result {
                    entries: core::ptr::null_mut(),
                    error,
                },
            };
        }
        let mut boxed: Box<[addrinfo_result_entry]> = entries.into_boxed_slice();
        // Every pointer usockets will chase derives from this one base, so no
        // later reborrow of the slice invalidates them.
        let len = boxed.len();
        let base: *mut addrinfo_result_entry = boxed.as_mut_ptr();
        for idx in 0..len {
            // SAFETY: `idx` and `idx + 1` (when used) are in bounds of the
            // `len`-element allocation `base` points at.
            unsafe {
                let entry = base.add(idx);
                (*entry).info.ai_next = if idx + 1 < len {
                    &raw mut (*base.add(idx + 1)).info
                } else {
                    core::ptr::null_mut()
                };
                if !(*entry).info.ai_addr.is_null() {
                    (*entry).info.ai_addr = (&raw mut (*entry).addr).cast::<sockaddr>();
                }
            }
        }
        Self {
            entries: Some(boxed),
            c: addrinfo_result {
                entries: base,
                error,
            },
        }
    }

    /// What `Bun__addrinfo_getRequestResult` hands usockets.
    #[inline]
    pub fn as_c(&self) -> &addrinfo_result {
        &self.c
    }

    #[inline]
    pub fn entries(&self) -> &[addrinfo_result_entry] {
        self.entries.as_deref().unwrap_or(&[])
    }
}

/// A `us_connecting_socket_t` parked on a pending lookup: a back-reference
/// whose holder obligation (usockets keeps the socket alive until it is either
/// notified through this handle or withdraws it with `Bun__addrinfo_cancel`)
/// is taken on where the `BackRef` is made. `us_internal_dns_callback_threadsafe`
/// is its cross-thread entry point — hence `Send`.
pub struct DnsWaitingSocket(bun_ptr::BackRef<ConnectingSocket>);

// SAFETY: see the type doc — the only cross-thread use is `notify_threadsafe`,
// which usockets provides for exactly that.
unsafe impl Send for DnsWaitingSocket {}

impl DnsWaitingSocket {
    #[inline]
    pub fn new(socket: bun_ptr::BackRef<ConnectingSocket>) -> Self {
        Self(socket)
    }

    /// Whether this is `socket` (for `Bun__addrinfo_cancel`).
    #[inline]
    pub fn is(&self, socket: &ConnectingSocket) -> bool {
        core::ptr::eq(self.0.as_const_ptr(), socket)
    }

    /// The lookup finished; link the socket into its loop's DNS-ready list
    /// (the loop's thread; does not wake it).
    #[inline]
    pub fn notify(self) {
        us_internal_dns_callback(self.0.get(), core::ptr::null_mut());
    }

    /// [`notify`](Self::notify) from any thread; wakes the loop.
    #[inline]
    pub fn notify_threadsafe(self) {
        us_internal_dns_callback_threadsafe(self.0.get(), core::ptr::null_mut());
    }
}

// `addrinfo_req` is unused by both (the socket already stores it).
unsafe extern "C" {
    safe fn us_internal_dns_callback(s: &ConnectingSocket, addrinfo_req: *mut c_void);
    safe fn us_internal_dns_callback_threadsafe(s: &ConnectingSocket, addrinfo_req: *mut c_void);
}
