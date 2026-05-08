//! Process-global lazily-initialised on the HTTP thread. Owns the lsquic
//! client engine and the live-session registry. Never freed — the engine
//! lives for the process, same as the HTTP thread itself.

use core::ffi::{c_uint, c_void};
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_uws::quic;
use bun_uws::quic::context::ConnectResult;
use bun_uws::Loop as UwsLoop;

use super::callbacks;
use super::client_session::ClientSession;
use super::pending_connect::PendingConnect;
use super::stream::Stream;
use crate::h3_client as H3;
use crate::HTTPClient;

bun_core::declare_scope!(h3_client, hidden);

pub struct ClientContext {
    // FFI handle owned for process lifetime (never freed).
    qctx: NonNull<quic::Context>,
    sessions: Vec<*mut ClientSession>,
}

/// One instance per HTTP-thread loop. Stored as a process global only
/// because `bun.http.http_thread` is itself a process singleton — the
/// underlying lsquic engine is bound to the `loop` passed to
/// `quic.Context.createClient` (it lives on `loop->data.quic_head` and is
/// driven by that loop's pre/post hooks), so a second loop would get its
/// own engine; this var would just need to become per-loop storage.
// PORTING.md §Global mutable state: HTTP-thread-only singleton; RacyCell
// because access is confined to the single HTTP client thread.
static INSTANCE: bun_core::RacyCell<Option<NonNull<ClientContext>>> =
    bun_core::RacyCell::new(None);
static LSQUIC_INIT_ONCE: std::sync::Once = std::sync::Once::new();

impl ClientContext {
    /// Non-null pointer to the leaked process-lifetime singleton, if created.
    /// Callers reborrow per-access — PORTING.md §Global mutable state.
    pub fn get() -> Option<NonNull<ClientContext>> {
        // SAFETY: single-threaded access (HTTP thread only).
        unsafe { INSTANCE.read() }
    }

    pub fn get_or_create(loop_: *mut UwsLoop) -> Option<NonNull<ClientContext>> {
        // SAFETY: single-threaded access (HTTP thread only).
        if let Some(i) = unsafe { INSTANCE.read() } {
            return Some(i);
        }
        LSQUIC_INIT_ONCE.call_once(|| quic::global_init());
        // SAFETY: caller passes the live HTTP-thread uws loop.
        let qctx = unsafe {
            quic::Context::create_client(
                loop_,
                0,
                core::mem::size_of::<*mut ClientSession>() as c_uint,
                core::mem::size_of::<*mut Stream>() as c_uint,
            )
        }?;
        // SAFETY: create_client returns non-null on Some.
        let mut qctx = unsafe { NonNull::new_unchecked(qctx) };
        // SAFETY: qctx is a fresh live us_quic_socket_context_t.
        callbacks::register(unsafe { qctx.as_mut() });

        // Process-lifetime singleton — published into `INSTANCE` below and
        // never torn down (the lsquic engine outlives every request, same as
        // `h3_client.zig`'s process-global `var instance`). `alloc_nn` is the
        // `Box::into_raw`-as-`NonNull` spelling of that one-time hand-off.
        let self_ = bun_core::heap::alloc_nn(ClientContext {
            qctx,
            sessions: Vec::new(),
        });
        // SAFETY: single-threaded access (HTTP thread only).
        unsafe { INSTANCE.write(Some(self_)) };
        Some(self_)
    }

    /// Find or open a connection to `hostname:port` and queue `client` on it.
    pub fn connect(&mut self, client: &mut HTTPClient, hostname: &[u8], port: u16) -> bool {
        let reject = client.flags.reject_unauthorized;
        for &s in self.sessions.iter() {
            // SAFETY: sessions vec holds live ClientSession pointers; removed via unregister() before destroy.
            let s = unsafe { &mut *s };
            if s.matches(hostname, port, reject) && s.has_headroom() {
                bun_core::scoped_log!(
                    h3_client,
                    "reuse session {}:{}",
                    bstr::BStr::new(hostname),
                    port,
                );
                s.enqueue(client);
                return true;
            }
        }

        // Zig: `dupeZ` — owned NUL-terminated buffer. We keep the hostname (no NUL)
        // in the session and build a CString for the FFI call.
        let Ok(host_z) = std::ffi::CString::new(hostname) else {
            return false;
        };
        let session = ClientSession::new(hostname.to_vec(), port, reject);
        let _ = H3::live_sessions.fetch_add(1, Ordering::Relaxed);
        // SAFETY: session was just allocated by ClientSession::new and is live.
        unsafe {
            (*session).registry_index = u32::try_from(self.sessions.len()).expect("int cast");
        }
        self.sessions.push(session);
        // SAFETY: session is live (just pushed into registry).
        unsafe { (*session).enqueue(client) };

        // SAFETY: qctx is the process-lifetime lsquic client engine.
        let result = unsafe {
            (*self.qctx.as_ptr()).connect(&host_z, port, &host_z, reject, session.cast::<c_void>())
        };
        match result {
            ConnectResult::Socket(qs) => {
                // SAFETY: session is live; qs is a fresh quic socket whose ext slot
                // was sized to hold a *mut ClientSession in get_or_create().
                unsafe {
                    (*session).qsocket = NonNull::new(qs);
                    *(*qs).ext::<ClientSession>() = NonNull::new(session);
                }
                bun_core::scoped_log!(
                    h3_client,
                    "connect {}:{} (sync)",
                    bstr::BStr::new(hostname),
                    port,
                );
            }
            ConnectResult::Pending(pending) => {
                bun_core::scoped_log!(
                    h3_client,
                    "connect {}:{} (dns pending)",
                    bstr::BStr::new(hostname),
                    port,
                );
                // SAFETY: qctx is live for the process.
                let l = unsafe { (*self.qctx.as_ptr()).r#loop() };
                PendingConnect::register(session, pending, l.cast::<UwsLoop>());
            }
            ConnectResult::Err => {
                bun_core::scoped_log!(
                    h3_client,
                    "connect {}:{} failed",
                    bstr::BStr::new(hostname),
                    port,
                );
                // SAFETY: session was just allocated above and is live.
                self.unregister(unsafe { &mut *session });
                PendingConnect::fail_session(session, bun_core::err!(ConnectionRefused));
                return false;
            }
        }
        true
    }

    pub fn unregister(&mut self, session: &mut ClientSession) {
        let i = session.registry_index as usize;
        if i >= self.sessions.len() || !core::ptr::eq(self.sessions[i], session) {
            return;
        }
        let _ = self.sessions.swap_remove(i);
        if i < self.sessions.len() {
            // SAFETY: the swapped-in element is a live registered session.
            unsafe { (*self.sessions[i]).registry_index = u32::try_from(i).expect("int cast") };
        }
        session.registry_index = u32::MAX;
    }

    pub fn abort_by_http_id(async_http_id: u32) -> bool {
        let Some(this) = Self::get() else {
            return false;
        };
        // SAFETY: leaked Box, process-lifetime; HTTP-thread only.
        for &s in unsafe { (*this.as_ptr()).sessions.iter() } {
            // SAFETY: registry only holds live sessions.
            if unsafe { (*s).abort_by_http_id(async_http_id) } {
                return true;
            }
        }
        false
    }

    pub fn stream_body_by_http_id(async_http_id: u32, ended: bool) {
        let Some(this) = Self::get() else {
            return;
        };
        // SAFETY: leaked Box, process-lifetime; HTTP-thread only.
        for &s in unsafe { (*this.as_ptr()).sessions.iter() } {
            // SAFETY: registry only holds live sessions.
            unsafe { (*s).stream_body_by_http_id(async_http_id, ended) };
        }
    }
}

// ported from: src/http/h3_client/ClientContext.zig
