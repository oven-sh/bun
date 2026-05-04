//! Process-global lazily-initialised on the HTTP thread. Owns the lsquic
//! client engine and the live-session registry. Never freed — the engine
//! lives for the process, same as the HTTP thread itself.

use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_uws::quic;
use bun_uws::Loop as UwsLoop;

use super::callbacks;
use super::client_session::ClientSession;
use super::pending_connect::PendingConnect;
use super::stream::Stream;
use crate::h3_client as H3;
// TODO(port): `const HTTPClient = bun.http;` — Zig file-as-struct; in Rust the
// top-level client struct lives at the crate root. Adjust path in Phase B.
use crate::HttpClient;

bun_output::declare_scope!(h3_client, hidden);

pub struct ClientContext {
    // TODO(port): lifetime — FFI handle owned for process lifetime (never freed).
    qctx: *mut quic::Context,
    sessions: Vec<*mut ClientSession>,
}

/// One instance per HTTP-thread loop. Stored as a process global only
/// because `bun.http.http_thread` is itself a process singleton — the
/// underlying lsquic engine is bound to the `loop` passed to
/// `quic.Context.createClient` (it lives on `loop->data.quic_head` and is
/// driven by that loop's pre/post hooks), so a second loop would get its
/// own engine; this var would just need to become per-loop storage.
// SAFETY: only ever accessed from the single HTTP thread.
static mut INSTANCE: Option<NonNull<ClientContext>> = None;
static LSQUIC_INIT_ONCE: std::sync::Once = std::sync::Once::new();

impl ClientContext {
    pub fn get() -> Option<&'static mut ClientContext> {
        // SAFETY: single-threaded access (HTTP thread only).
        unsafe { INSTANCE.map(|p| &mut *p.as_ptr()) }
    }

    pub fn get_or_create(loop_: &mut UwsLoop) -> Option<&'static mut ClientContext> {
        // SAFETY: single-threaded access (HTTP thread only).
        if let Some(i) = unsafe { INSTANCE } {
            // SAFETY: INSTANCE points to a leaked Box that lives for the process.
            return Some(unsafe { &mut *i.as_ptr() });
        }
        LSQUIC_INIT_ONCE.call_once(|| quic::global_init());
        let qctx = quic::Context::create_client(
            loop_,
            0,
            core::mem::size_of::<*mut ClientSession>(),
            core::mem::size_of::<*mut Stream>(),
        )?;
        callbacks::register(qctx);

        let self_ = Box::leak(Box::new(ClientContext {
            qctx,
            sessions: Vec::new(),
        }));
        // SAFETY: single-threaded access (HTTP thread only).
        unsafe {
            INSTANCE = Some(NonNull::from(&mut *self_));
        }
        Some(self_)
    }

    /// Find or open a connection to `hostname:port` and queue `client` on it.
    pub fn connect(&mut self, client: *mut HttpClient, hostname: &[u8], port: u16) -> bool {
        // SAFETY: caller passes a live HTTPClient; only reading a flag.
        let reject = unsafe { (*client).flags.reject_unauthorized };
        for &s in self.sessions.iter() {
            // SAFETY: sessions vec holds live ClientSession pointers; removed via unregister() before destroy.
            let s = unsafe { &mut *s };
            if s.matches(hostname, port, reject) && s.has_headroom() {
                bun_output::scoped_log!(
                    h3_client,
                    "reuse session {}:{}",
                    bstr::BStr::new(hostname),
                    port
                );
                s.enqueue(client);
                return true;
            }
        }

        // TODO(port): ownership — host_z is moved into ClientSession.hostname; ZStr::from_bytes
        // must yield an owned NUL-terminated buffer here (Zig was allocator.dupeZ).
        let host_z = bun_str::ZStr::from_bytes(hostname);
        let session = ClientSession::new(ClientSession {
            qsocket: None,
            hostname: host_z,
            port,
            reject_unauthorized: reject,
            ..Default::default()
        });
        let _ = H3::live_sessions().fetch_add(1, Ordering::Relaxed);
        // SAFETY: session was just allocated by ClientSession::new and is live.
        unsafe {
            (*session).registry_index = u32::try_from(self.sessions.len()).unwrap();
        }
        self.sessions.push(session);
        // SAFETY: session is live (just pushed into registry).
        unsafe { (*session).enqueue(client) };

        // SAFETY: qctx is the process-lifetime lsquic client engine.
        match unsafe {
            (*self.qctx).connect(host_z.as_ptr(), port, host_z.as_ptr(), reject, session)
        } {
            quic::ConnectResult::Socket(qs) => {
                // SAFETY: session is live; qs is a fresh quic socket whose ext slot
                // was sized to hold a *mut ClientSession in get_or_create().
                unsafe {
                    (*session).qsocket = Some(qs);
                    *qs.ext::<*mut ClientSession>() = session;
                }
                bun_output::scoped_log!(
                    h3_client,
                    "connect {}:{} (sync)",
                    bstr::BStr::new(hostname),
                    port
                );
            }
            quic::ConnectResult::Pending(pending) => {
                bun_output::scoped_log!(
                    h3_client,
                    "connect {}:{} (dns pending)",
                    bstr::BStr::new(hostname),
                    port
                );
                // SAFETY: qctx is live for the process.
                PendingConnect::register(session, pending, unsafe { (*self.qctx).loop_() });
            }
            quic::ConnectResult::Err => {
                bun_output::scoped_log!(
                    h3_client,
                    "connect {}:{} failed",
                    bstr::BStr::new(hostname),
                    port
                );
                self.unregister(session);
                PendingConnect::fail_session(session, bun_core::err!("ConnectionRefused"));
                return false;
            }
        }
        true
    }

    pub fn unregister(&mut self, session: *mut ClientSession) {
        // SAFETY: caller guarantees session is live (it is being torn down).
        let i = unsafe { (*session).registry_index } as usize;
        if i >= self.sessions.len() || self.sessions[i] != session {
            return;
        }
        let _ = self.sessions.swap_remove(i);
        if i < self.sessions.len() {
            // SAFETY: the swapped-in element is a live registered session.
            unsafe { (*self.sessions[i]).registry_index = i as u32 };
        }
        // SAFETY: session is still live; we are detaching it from the registry.
        unsafe { (*session).registry_index = u32::MAX };
    }

    pub fn abort_by_http_id(async_http_id: u32) -> bool {
        let Some(this) = Self::get() else {
            return false;
        };
        for &s in this.sessions.iter() {
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
        for &s in this.sessions.iter() {
            // SAFETY: registry only holds live sessions.
            unsafe { (*s).stream_body_by_http_id(async_http_id, ended) };
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/h3_client/ClientContext.zig (117 lines)
//   confidence: medium
//   todos:      3
//   notes:      mutable global INSTANCE uses static mut (HTTP-thread-only); quic::ConnectResult enum & ZStr owned-dupeZ shape assumed; ClientSession/HttpClient kept as raw *mut (FFI ext-slot back-refs)
// ──────────────────────────────────────────────────────────────────────────
