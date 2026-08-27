//! Lazily initialised per HTTP thread. Owns the lsquic client engine and the
//! live-session registry. Never freed — the engine lives for the process, same
//! as the HTTP thread itself.

use core::cell::RefCell;
use core::ffi::c_uint;
use core::ptr::NonNull;

use bun_ptr::RefPtr;
use bun_uws::quic;
use bun_uws::quic::context::ConnectResult;

use super::callbacks;
use super::client_session::ClientSession;
use super::pending_connect::PendingConnect;
use super::stream::Stream;
use crate::HTTPClient;
use crate::http_thread::ThreadState;

use crate::h3_client::h3_client;

pub(crate) struct ClientContext {
    thread: &'static ThreadState,
    /// The lsquic engine (an opaque handle), bound to the thread's loop and
    /// owned for its lifetime (never freed).
    qctx: NonNull<quic::Context>,
    /// Live sessions; each entry is a reference.
    sessions: RefCell<Vec<RefPtr<ClientSession>>>,
}

static LSQUIC_INIT_ONCE: std::sync::Once = std::sync::Once::new();

impl ClientContext {
    #[inline]
    fn qctx<'a>(&self) -> &'a mut quic::Context {
        quic::Context::opaque_mut(self.qctx.as_ptr())
    }

    pub(crate) fn get(thread: &ThreadState) -> Option<&ClientContext> {
        thread.h3.get().map(|ctx| &**ctx)
    }

    pub(crate) fn get_or_create(thread: &'static ThreadState) -> Option<&'static ClientContext> {
        if let Some(ctx) = thread.h3.get() {
            return Some(ctx);
        }
        LSQUIC_INIT_ONCE.call_once(quic::global_init);
        let qctx = quic::Context::create_client_for_current_thread(
            0,
            core::mem::size_of::<*mut ClientSession>() as c_uint,
            core::mem::size_of::<*mut Stream>() as c_uint,
        )?;
        // Callbacks don't fire until the loop runs, so registering after
        // construction is order-neutral.
        quic::Context::opaque_mut(qctx.as_ptr()).register_client_handler::<callbacks::Handler>();
        let ctx = thread.h3.get_or_init(|| {
            Box::new(ClientContext {
                thread,
                qctx,
                sessions: RefCell::new(Vec::new()),
            })
        });
        Some(ctx)
    }

    /// Find or open a connection to `hostname:port` and queue `client` on it.
    pub(crate) fn connect(&self, client: &mut HTTPClient, hostname: &[u8], port: u16) -> bool {
        let reject = client.flags.reject_unauthorized;
        let reusable = self
            .sessions
            .borrow()
            .iter()
            .find(|s| s.matches(hostname, port, reject) && s.has_headroom())
            .map(|s| s.this_ptr());
        if let Some(session) = reusable {
            bun_core::scoped_log!(
                h3_client,
                "reuse session {}:{}",
                bstr::BStr::new(hostname),
                port,
            );
            session.enqueue(client);
            return true;
        }

        // Owned NUL-terminated buffer: copy the bytes
        // verbatim (interior NUL allowed) then append a sentinel; lsquic reads
        // it as a C string so an interior NUL truncates on the C side. This is
        // deliberately not `CString::new`, which would reject interior NUL
        // and diverge by returning `false`.
        let mut host_buf = hostname.to_vec();
        host_buf.push(0);
        let host_z = std::ffi::CStr::from_bytes_until_nul(&host_buf).expect("nul appended above");
        // The registry's reference.
        let session = ClientSession::new(self.thread, hostname.to_vec(), port, reject);
        let this = session.this_ptr();
        session
            .registry_index
            .set(u32::try_from(self.sessions.borrow().len()).expect("int cast"));
        self.sessions.borrow_mut().push(session);

        // The connection's ext slot points at the session; cleared in
        // `on_conn_close`, until which the session's own reference keeps it
        // alive.
        let session_ptr: *mut ClientSession = this.as_ptr();
        let result = self
            .qctx()
            .connect(host_z, port, host_z, reject, session_ptr.cast());
        match result {
            ConnectResult::Socket(qs) => {
                this.qsocket.set(NonNull::new(qs));
                *quic::Socket::opaque_mut(qs).ext::<ClientSession>() = NonNull::new(session_ptr);
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
                PendingConnect::register(self.thread, this, pending);
            }
            ConnectResult::Err => {
                bun_core::scoped_log!(
                    h3_client,
                    "connect {}:{} failed",
                    bstr::BStr::new(hostname),
                    port,
                );
                // `client` was never queued on the session; the caller fails it.
                ClientSession::enter(this, |s| {
                    s.close_with(|_| crate::Error::ConnectionRefused, false)
                });
                return false;
            }
        }
        // The handshake completes (and `on_stream_open` fires) only once the
        // loop runs, so queueing after `connect` is equivalent to before.
        this.enqueue(client);
        true
    }

    pub(crate) fn unregister(&self, session: &ClientSession) {
        let i = session.registry_index.get() as usize;
        let entry = {
            let mut sessions = self.sessions.borrow_mut();
            if i >= sessions.len() || !core::ptr::eq(&raw const *sessions[i], session) {
                return;
            }
            let entry = sessions.swap_remove(i);
            if i < sessions.len() {
                // The swapped-in element is a live registered session.
                sessions[i]
                    .registry_index
                    .set(u32::try_from(i).expect("int cast"));
            }
            entry
        };
        session.registry_index.set(u32::MAX);
        // Never the last reference: the connection's own is released after.
        drop(entry);
    }

    /// Handles to every live session, so a callee may unregister one while
    /// the caller walks them.
    fn session_handles(&self) -> Vec<bun_ptr::ThisPtr<ClientSession>> {
        self.sessions
            .borrow()
            .iter()
            .map(|s| s.this_ptr())
            .collect()
    }

    pub(crate) fn abort_by_http_id(thread: &ThreadState, async_http_id: u32) -> bool {
        let Some(ctx) = Self::get(thread) else {
            return false;
        };
        for session in ctx.session_handles() {
            let mut found = false;
            ClientSession::enter(session, |s| found = s.abort_by_http_id(async_http_id));
            if found {
                return true;
            }
        }
        false
    }

    pub(crate) fn stream_body_by_http_id(thread: &ThreadState, async_http_id: u32, ended: bool) {
        let Some(ctx) = Self::get(thread) else {
            return;
        };
        for session in ctx.session_handles() {
            let mut found = false;
            ClientSession::enter(session, |s| {
                found = s.stream_body_by_http_id(async_http_id, ended)
            });
            if found {
                return;
            }
        }
    }

    pub(crate) fn resume_receive_by_http_id(thread: &ThreadState, async_http_id: u32) {
        let Some(ctx) = Self::get(thread) else {
            return;
        };
        for session in ctx.session_handles() {
            let mut found = false;
            ClientSession::enter(session, |s| {
                found = s.resume_receive_by_http_id(async_http_id)
            });
            if found {
                return;
            }
        }
    }
}
