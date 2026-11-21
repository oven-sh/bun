use core::cell::Cell;
use core::ffi::c_void;
use core::ptr;
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::socket::NewSocket;
use crate::socket::SSLConfig;
use crate::socket::windows_named_pipe::{Handlers as NamedPipeHandlers, WindowsNamedPipe};
use crate::socket::{TCPSocket, TLSSocket};
use bun_boringssl_sys as boringssl;
use bun_core::ZStr;
use bun_event_loop::Task;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, SysErrorJsc};
use bun_ptr::{RefPtr, ThisPtr};
use bun_sys::{self, Error as SysError, Fd, SystemErrno};
use bun_uws::{self as uws, us_bun_verify_error_t};

bun_output::declare_scope!(WindowsNamedPipeContext, visible);

/// Live contexts, read by `bun:internal-for-testing` leak tests: `heapStats()`
/// only sees the JS wrappers, and a failed connect lets those be collected
/// while the context (and its ref on the native socket) stays behind.
pub(crate) static LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = schedule_deinit)]
pub(crate) struct WindowsNamedPipeContext {
    // Intrusive refcount; on zero → `schedule_deinit` (deferred free), not
    // immediate `Box::from_raw`.
    ref_count: Cell<u32>,
    /// Held until the pipe closes, or fails to open.
    pub(super) self_ref: Cell<Option<RefPtr<Self>>>,
    /// `on_close` and `fail_connect` hand it to the socket's last event. Drops before `named_pipe`.
    socket: Option<OwnedSocket>,
    /// `pub(super)` so `WindowsNamedPipeListeningContext::on_client_connect`
    /// (sibling module) can call `get_accepted_by` on the freshly-created
    /// client.
    pub(super) named_pipe: WindowsNamedPipe,

    vm: &'static VirtualMachine,
    global_this: GlobalRef,
    task_event: EventState,
    is_open: bool,
    /// A socket over a Windows named pipe is in no uSockets group: the context
    /// that opened it closes it through this owner when it stops.
    abort_handle: bun_jsc::AbortHandle,
}

bun_jsc::impl_abort_handle_owner!(WindowsNamedPipeContext, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live; `close` re-enters `on_close`,
    // which may free `this`.
    unsafe { (*ptr::addr_of_mut!((*this).named_pipe)).close_or_cancel_connect() }
});

/// Reached from `on_close` while `WindowsNamedPipe::on_close`
/// still holds a live `&mut (*this).named_pipe` and uses it after we return, so
/// project raw fields only — same constraint as the `on_*` handlers below.
fn schedule_deinit(this: *mut WindowsNamedPipeContext) {
    // SAFETY: called from `deref()` at count zero; `this` is live until the task fires.
    // `task_event`/`vm` are disjoint from the caller's `&mut named_pipe`.
    unsafe {
        debug_assert!((*this).task_event != EventState::Deinit);
        (*this).task_event = EventState::Deinit;
        (*this).vm.enqueue_task(Task::init(this));
    }
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum EventState {
    Deinit,
    None,
}

/// The ref a pipe holds on the socket it carries.
pub(crate) enum OwnedSocket {
    Tls(RefPtr<TLSSocket>),
    Tcp(RefPtr<TCPSocket>),
}

/// `Copy` view of [`OwnedSocket`]: a handler can close the pipe, which empties that field.
#[derive(Copy, Clone)]
enum SocketType {
    Tls(bun_ptr::ThisPtr<TLSSocket>),
    Tcp(bun_ptr::ThisPtr<TCPSocket>),
    None,
}

impl SocketType {
    fn of(socket: &Option<OwnedSocket>) -> Self {
        match socket {
            Some(OwnedSocket::Tls(s)) => Self::Tls(s.this_ptr()),
            Some(OwnedSocket::Tcp(s)) => Self::Tcp(s.this_ptr()),
            None => Self::None,
        }
    }
}

/// Build a `uws::NewSocketHandler` from the wrapped named pipe.
///
/// Takes a raw `*mut WindowsNamedPipe` (NOT `&mut`) because every caller is a
/// `NamedPipeHandlers` callback invoked *from* `WindowsNamedPipe::on_*`, which
/// already holds a live `&mut WindowsNamedPipe` to the same field and touches
/// it again after the callback returns. Forming a second `&mut` here would
/// retag the field and invalidate the caller's reference (Stacked Borrows).
/// The handler only needs the raw address to stuff into `InternalSocket::Pipe`.
#[inline]
fn socket_from_named_pipe<const SSL: bool>(
    pipe: *mut WindowsNamedPipe,
) -> uws::NewSocketHandler<SSL> {
    uws::NewSocketHandler {
        socket: uws::InternalSocket::Pipe(pipe.cast()),
    }
}

/// Dispatch a `SocketType` value to a single body written generically over
/// `NewSocket<SSL>`. Binds the inner `ThisPtr<NewSocket<{true|false}>>` as `$s`
/// and a per-arm `const $ssl: bool` so the body can call
/// `NewSocket::on_x($s, socket_from_named_pipe::<$ssl>(..), ..)` once instead
/// of hand-duplicating the `Tls`/`Tcp` arms. `SocketType::None` is a no-op.
///
/// Takes the `SocketType` by *value*: see the Stacked-Borrows note on the `on_*` block below.
macro_rules! match_socket {
    ($scrutinee:expr, |$s:ident: NewSocket<$ssl:ident>| $body:expr) => {
        // This context is the named-pipe sockets' trampoline: what a handler
        // left pending is folded here.
        match $scrutinee {
            SocketType::Tls($s) => {
                const $ssl: bool = true;
                let _ = $ssl;
                crate::dispatch::fold($body)
            }
            SocketType::Tcp($s) => {
                const $ssl: bool = false;
                let _ = $ssl;
                crate::dispatch::fold($body)
            }
            SocketType::None => {}
        }
    };
}

// ── NamedPipeHandlers callbacks ──────────────────────────────────────────────
//
// All eight `on_*` handlers below take `this: *mut Self` (NOT `&mut self`).
// They are invoked from `WindowsNamedPipe::on_*` via `(self.handlers.on_x)(ctx, ..)`
// where the caller already holds a live `&mut WindowsNamedPipe` — i.e. a
// `&mut (*this).named_pipe` — and *uses it again after the handler returns*
// (e.g. `self.incoming.clear()`, `self.close()`, `self.release_resources()`).
//
// Forming `&mut *this` (or `&mut (*this).named_pipe`) here would retag from the
// allocation-root provenance and pop the caller's Unique tag off the borrow
// stack → Stacked Borrows UB / LLVM `noalias` violation when control returns.
//
// Instead each handler projects only the disjoint fields it needs (`socket`,
// `is_open`, `global_this`) via raw-pointer place expressions, and passes
// `addr_of_mut!((*this).named_pipe)` as a raw pointer without retagging.
impl WindowsNamedPipeContext {
    fn on_open(this: *mut Self) {
        // SAFETY: `this` is the live ctx ptr registered in `create()`; `is_open`,
        // `socket` and the `named_pipe` field *address* are all reachable without
        // forming a reference that overlaps the caller's `&mut named_pipe`.
        let (socket, pipe) = unsafe {
            (*this).is_open = true;
            (SocketType::of(&(*this).socket), &raw mut (*this).named_pipe)
        };
        match_socket!(socket, |s: NewSocket<SSL>| NewSocket::on_open(
            s,
            socket_from_named_pipe::<SSL>(pipe)
        ));
    }

    fn on_data(this: *mut Self, decoded_data: &[u8]) {
        // SAFETY: see `on_open`.
        let (socket, pipe) =
            unsafe { (SocketType::of(&(*this).socket), &raw mut (*this).named_pipe) };
        match_socket!(socket, |s: NewSocket<SSL>| NewSocket::on_data(
            s,
            socket_from_named_pipe::<SSL>(pipe),
            decoded_data
        ));
    }

    fn on_session(this: *mut Self, session: &[u8]) {
        // Only the TLS wrapper parks sessions; the TCP arm can never get here.
        // SAFETY: see `on_open`.
        if let SocketType::Tls(s) = SocketType::of(unsafe { &(*this).socket }) {
            crate::dispatch::fold(TLSSocket::on_session(s, session));
        }
    }

    fn server_identity(
        this: *mut Self,
        ssl: &mut bun_boringssl_sys::SSL,
    ) -> bun_boringssl::ServerIdentity {
        // SAFETY: see `on_open`.
        match SocketType::of(unsafe { &(*this).socket }) {
            SocketType::Tls(s) => s.server_identity(ssl),
            _ => bun_boringssl::ServerIdentity::Unchecked,
        }
    }

    fn on_keylog(this: *mut Self, line: &[u8]) {
        // SAFETY: see `on_open`.
        if let SocketType::Tls(s) = SocketType::of(unsafe { &(*this).socket }) {
            crate::dispatch::fold(TLSSocket::on_keylog(s, line));
        }
    }

    fn on_handshake(this: *mut Self, success: bool, ssl_error: us_bun_verify_error_t) {
        // SAFETY: see `on_open`.
        let (socket, pipe) =
            unsafe { (SocketType::of(&(*this).socket), &raw mut (*this).named_pipe) };
        match_socket!(socket, |s: NewSocket<SSL>| NewSocket::on_handshake(
            s,
            socket_from_named_pipe::<SSL>(pipe),
            success as i32,
            ssl_error
        ));
    }

    fn on_end(this: *mut Self) {
        // SAFETY: see `on_open`.
        let (socket, pipe) =
            unsafe { (SocketType::of(&(*this).socket), &raw mut (*this).named_pipe) };
        match_socket!(socket, |s: NewSocket<SSL>| NewSocket::on_end(
            s,
            socket_from_named_pipe::<SSL>(pipe)
        ));
    }

    fn on_writable(this: *mut Self) {
        // SAFETY: see `on_open`.
        let (socket, pipe) =
            unsafe { (SocketType::of(&(*this).socket), &raw mut (*this).named_pipe) };
        match_socket!(socket, |s: NewSocket<SSL>| NewSocket::on_writable(
            s,
            socket_from_named_pipe::<SSL>(pipe)
        ));
    }

    fn on_error(this: *mut Self, err: &SysError) {
        // SAFETY: see `on_open`.
        let (is_open, socket) = unsafe { ((*this).is_open, SocketType::of(&(*this).socket)) };
        if is_open {
            match_socket!(socket, |s: NewSocket<SSL>| {
                // SAFETY: `this` is live; `global_this` is disjoint from the caller's
                // `&mut named_pipe` and the borrow ends before `handle_error` runs JS.
                let js_err = err.to_js(unsafe { &(*this).global_this });
                s.handle_error(js_err)
            });
        } else {
            Self::fail_connect(this, err.errno as i32);
        }
    }

    /// `connectError` is the socket's last event: a later `on_close` of the pipe finds no socket.
    fn fail_connect(this: *mut Self, errno: i32) {
        // SAFETY: see `on_open`. Taken before `connectError` runs JS, which may
        // connect the same socket again through a new context.
        crate::dispatch::fold(match unsafe { (*this).socket.take() } {
            Some(OwnedSocket::Tls(s)) => NewSocket::handle_connect_error(s, errno, 0),
            Some(OwnedSocket::Tcp(s)) => NewSocket::handle_connect_error(s, errno, 0),
            None => Ok(()),
        });
    }

    fn on_timeout(this: *mut Self) {
        // SAFETY: see `on_open`.
        let (socket, pipe) =
            unsafe { (SocketType::of(&(*this).socket), &raw mut (*this).named_pipe) };
        match_socket!(socket, |s: NewSocket<SSL>| NewSocket::on_timeout(
            s,
            socket_from_named_pipe::<SSL>(pipe)
        ));
    }

    fn on_close(this: *mut Self) {
        // SAFETY: see `on_open`.
        let (_self_ref, socket, pipe) = unsafe {
            let pipe = &raw mut (*this).named_pipe;
            ((*this).self_ref.take(), (*this).socket.take(), pipe)
        };
        crate::dispatch::fold(match socket {
            Some(OwnedSocket::Tls(s)) => {
                NewSocket::on_close(s, socket_from_named_pipe(pipe), 0, None)
            }
            Some(OwnedSocket::Tcp(s)) => {
                NewSocket::on_close(s, socket_from_named_pipe(pipe), 0, None)
            }
            None => Ok(()),
        });
    }

    /// # Safety
    /// `this` is the live queued pointer; the call may free it.
    pub(crate) unsafe fn run_event(this: *mut Self) {
        // SAFETY: called from the `task_tag::WindowsNamedPipeContext` dispatch
        // arm; `this` is the live ctx pointer registered in create()
        match unsafe { (*this).task_event } {
            EventState::Deinit => {
                // SAFETY: `this` was allocated via heap::alloc in create(); refcount hit zero
                // and this deferred task is the sole remaining owner. Drop runs field destructors.
                drop(unsafe { bun_core::heap::take(this) });
            }
            EventState::None => panic!("Invalid event state"),
        }
    }

    fn fail_open(this: ThisPtr<Self>) {
        let _self_ref = this.self_ref.take();
        Self::fail_connect(this.as_ptr(), SystemErrno::ENOENT as i32);
    }

    pub(crate) fn create(cx: &bun_jsc::JsThread<'_>, socket: OwnedSocket) -> ThisPtr<Self> {
        let global_this = GlobalRef::from(cx.global());
        let vm: &'static VirtualMachine = global_this.bun_vm();
        let this: *mut WindowsNamedPipeContext = bun_core::heap::into_raw(Box::<
            core::mem::MaybeUninit<WindowsNamedPipeContext>,
        >::new_uninit())
        .cast();

        // named_pipe owns the pipe (PipeWriter owns the pipe and will close and deinit it)
        // Non-capturing closures coerce to `fn(*mut c_void, …)`; each casts the
        // erased ctx ptr back to `*mut Self` and forwards it RAW — the callee
        // must not form `&mut Self` (see the doc-comment on the `on_*` block
        // above for the Stacked-Borrows constraint vs the caller's
        // `&mut WindowsNamedPipe`).
        let handlers = NamedPipeHandlers {
            ctx: this.cast::<c_void>(),
            on_open: |p| Self::on_open(p.cast::<Self>()),
            on_data: |p, d| Self::on_data(p.cast::<Self>(), d),
            on_handshake: |p, ok, err| Self::on_handshake(p.cast::<Self>(), ok, err),
            on_end: |p| Self::on_end(p.cast::<Self>()),
            on_writable: |p| Self::on_writable(p.cast::<Self>()),
            on_error: |p, e| Self::on_error(p.cast::<Self>(), &e),
            on_timeout: |p| Self::on_timeout(p.cast::<Self>()),
            on_close: |p| Self::on_close(p.cast::<Self>()),
            on_session: |p, d| Self::on_session(p.cast::<Self>(), d),
            on_keylog: |p, d| Self::on_keylog(p.cast::<Self>(), d),
            server_identity: |p, ssl| Self::server_identity(p.cast::<Self>(), ssl),
        };
        let named_pipe = WindowsNamedPipe::new(handlers, vm);
        // SAFETY: `this` is freshly allocated uninit storage exclusively owned here; we write
        // every field exactly once before any read.
        unsafe {
            ptr::write(
                this,
                WindowsNamedPipeContext {
                    ref_count: Cell::new(1),
                    self_ref: Cell::new(None),
                    socket: Some(socket),
                    named_pipe,
                    vm,
                    global_this,
                    task_event: EventState::None,
                    is_open: false,
                    abort_handle: bun_jsc::AbortHandle::for_owner::<WindowsNamedPipeContext>(),
                },
            );
            (*ptr::addr_of_mut!((*this).named_pipe))
                .root
                .set(ptr::addr_of_mut!((*this).named_pipe));
        }
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);

        // SAFETY: initialised above with a count of 1, heap-pinned; disarmed when freed.
        let self_ref = unsafe {
            bun_jsc::AbortHandle::arm_owner(this, cx.context());
            RefPtr::from_raw(this)
        };
        let this = self_ref.this_ptr();
        this.self_ref.set(Some(self_ref));
        this
    }

    /// `owned_ctx` is moved into `named_pipe.open`. Prefer it over `ssl_config` so a
    /// memoised `tls.createSecureContext` reaches this path with its trust store intact —
    /// on this branch `[buntls]` returns `{secureContext}` only, so `ssl_config`
    /// alone would be empty.
    pub(crate) fn open(
        cx: &bun_jsc::JsThread<'_>,
        fd: Fd,
        ssl_config: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
        socket: OwnedSocket,
    ) {
        // TODO: reuse the same context for multiple connections when possibles

        let this = WindowsNamedPipeContext::create(cx, socket);
        // On `Ok`, `socket` has had its `on_open`, which hands it the pipe, or its connect error.
        if this.named_pipe.open(fd, ssl_config, owned_ctx).is_err() {
            Self::fail_open(this);
        }
    }

    /// See `open` for `owned_ctx` ownership.
    pub(crate) fn connect(
        cx: &bun_jsc::JsThread<'_>,
        path: &[u8],
        ssl_config: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
        socket: OwnedSocket,
    ) -> Result<*mut WindowsNamedPipe, crate::Error> {
        // TODO: reuse the same context for multiple connections when possibles

        let this = WindowsNamedPipeContext::create(cx, socket);
        let named_pipe = &this.named_pipe;

        if path[path.len() - 1] == 0 {
            // is already null terminated
            let slice_z = ZStr::from_slice_with_nul(path);
            named_pipe.connect(slice_z, ssl_config, owned_ctx)
        } else {
            let mut path_buf = bun_paths::path_buffer_pool::get();
            // we need to null terminate the path
            let len = path.len().min(path_buf.len() - 1);

            path_buf[..len].copy_from_slice(&path[..len]);
            let slice_z = ZStr::nul_terminate(&mut path_buf, len);
            named_pipe.connect(slice_z, ssl_config, owned_ctx)
        }
        .inspect_err(|_| Self::fail_open(this))?;

        Ok(this.named_pipe.root.get())
    }
}

impl Drop for WindowsNamedPipeContext {
    fn drop(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipeContext, "deinit");
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
    }
}

impl bun_event_loop::Taskable for WindowsNamedPipeContext {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::WindowsNamedPipeContext;
    /// A `Deinit` hop (refcount already zero) that will not run: `this` is the
    /// heap context, freed by nobody else — do what the hop does, script-free.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe { Self::run_event(this) }
    }
    /// A socket's own hop; its handlers carry their context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}
