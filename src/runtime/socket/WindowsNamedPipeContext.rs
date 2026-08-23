use core::cell::Cell;
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::api::{TCPSocket, TLSSocket};
use crate::socket::NewSocket;
use crate::socket::SSLConfig;
use crate::socket::windows_named_pipe::WindowsNamedPipe;
use bun_boringssl_sys as boringssl;
use bun_core::ZStr;
use bun_io::WriteStatus;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSGlobalObject, SysErrorJsc};
use bun_paths::PathBuffer;
use bun_ptr::{BackRef, OwnedThis, RefPtr, ThisPtr};
use bun_sys::{self, Error as SysError, Fd, SystemErrno};
use bun_uws::{self as uws, us_bun_verify_error_t};

bun_output::declare_scope!(WindowsNamedPipeContext, visible);

/// Live contexts, read by `bun:internal-for-testing` leak tests: `heapStats()`
/// only sees the JS wrappers, and a failed connect lets those be collected
/// while the context (and its ref on the native socket) stays behind.
pub(crate) static LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Refs: the connection's (`conn_ref`, released by `on_close` /
/// `fail_and_release`), each in-flight write's (the writer, through
/// `WindowsWriterParent`), an in-flight connect's, and short keep-alives held
/// by pipe callbacks that dispatch into JS. At zero the free is deferred to a
/// queued task (`schedule_deinit` → `run_event`).
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(release = WindowsNamedPipeContext::schedule_deinit)]
pub struct WindowsNamedPipeContext {
    ref_count: Cell<u32>,
    // The wrapped JS socket, which holds `create()`'s +1 (`named_pipe_ref`)
    // while not `None`. `on_close` and `fail_connect` release it and clear
    // this; anything still here is released in `Drop` before the `named_pipe`
    // field drops — teardown order must stay socket release then named_pipe
    // deinit.
    socket: Cell<SocketType>,
    /// `pub(super)` so `WindowsNamedPipeListeningContext::on_connection`
    /// (sibling module) can accept the freshly-created client on it.
    pub(super) named_pipe: WindowsNamedPipe,

    vm: &'static VirtualMachine,
    global_this: GlobalRef,
    task_event: Cell<EventState>,
    is_open: Cell<bool>,
    /// `create()`'s ref, held on behalf of the open pipe until `on_close` /
    /// `fail_and_release`.
    conn_ref: Cell<Option<RefPtr<WindowsNamedPipeContext>>>,
    /// Set by `schedule_deinit` once the last ref is gone: the allocation,
    /// owned by the queued deinit task until `run_event` drops it.
    self_own: Cell<Option<OwnedThis<WindowsNamedPipeContext>>>,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum EventState {
    Deinit,
    None,
}

/// Intrusive-refcounted self-pointers into the wrapped JS socket (a *different*
/// allocation from this context, so `ThisPtr`'s `Deref` is sound on them).
#[derive(Copy, Clone)]
pub enum SocketType {
    Tls(ThisPtr<TLSSocket>),
    Tcp(ThisPtr<TCPSocket>),
    None,
}

/// Build a `uws::NewSocketHandler` naming the wrapped named pipe. The handler
/// only carries its address (as the opaque `bun_uws` shim type) to stuff into
/// `InternalSocket::Pipe`; `bun_uws` calls back through the exported
/// `WindowsNamedPipe__*` thunks, which take `&self`.
#[inline]
fn socket_from_named_pipe<const SSL: bool>(pipe: &WindowsNamedPipe) -> uws::NewSocketHandler<SSL> {
    #[cfg(windows)]
    {
        uws::NewSocketHandler {
            socket: uws::InternalSocket::Pipe(core::ptr::from_ref(pipe).cast_mut().cast()),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = pipe;
        uws::NewSocketHandler {
            socket: uws::InternalSocket::Pipe,
        }
    }
}

/// Dispatch a `SocketType` value to a single body written generically over
/// `NewSocket<SSL>`. Binds the inner `ThisPtr<NewSocket<{true|false}>>` as `$s`
/// and a per-arm `const $ssl: bool` so the body can call
/// `NewSocket::on_x($s, socket_from_named_pipe::<$ssl>(..), ..)` once instead
/// of hand-duplicating the `Tls`/`Tcp` arms. `SocketType::None` is a no-op.
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

/// Fails the pending connect and releases `create()`'s ref, unless
/// `disarm()` runs first.
struct FailAndRelease(Option<ThisPtr<WindowsNamedPipeContext>>);

impl FailAndRelease {
    fn get(&self) -> ThisPtr<WindowsNamedPipeContext> {
        self.0.expect("guard already disarmed")
    }

    fn disarm(mut self) -> ThisPtr<WindowsNamedPipeContext> {
        self.0.take().expect("guard already disarmed")
    }
}

impl Drop for FailAndRelease {
    fn drop(&mut self) {
        if let Some(this) = self.0.take() {
            WindowsNamedPipeContext::fail_and_release(this);
        }
    }
}

// ── Named-pipe events ────────────────────────────────────────────────────────
//
// Called by `WindowsNamedPipe` (our `named_pipe` field) from inside its own
// `&self` methods, which keep using it after we return, so every handler works
// through a `ThisPtr` and shared borrows only.
impl WindowsNamedPipeContext {
    pub(crate) fn on_open(this: ThisPtr<Self>) {
        this.is_open.set(true);
        match_socket!(this.socket.get(), |s: NewSocket<SSL>| NewSocket::on_open(
            s,
            socket_from_named_pipe::<SSL>(&this.named_pipe)
        ));
    }

    pub(crate) fn on_data(this: ThisPtr<Self>, decoded_data: &[u8]) {
        match_socket!(this.socket.get(), |s: NewSocket<SSL>| NewSocket::on_data(
            s,
            socket_from_named_pipe::<SSL>(&this.named_pipe),
            decoded_data
        ));
    }

    pub(crate) fn on_session(this: ThisPtr<Self>, session: &[u8]) {
        // Only the TLS wrapper parks sessions; the TCP arm can never get here.
        if let SocketType::Tls(s) = this.socket.get() {
            crate::dispatch::fold(TLSSocket::on_session(s, session));
        }
    }

    pub(crate) fn on_keylog(this: ThisPtr<Self>, line: &[u8]) {
        if let SocketType::Tls(s) = this.socket.get() {
            crate::dispatch::fold(TLSSocket::on_keylog(s, line));
        }
    }

    pub(crate) fn on_handshake(
        this: ThisPtr<Self>,
        success: bool,
        ssl_error: us_bun_verify_error_t,
    ) {
        match_socket!(this.socket.get(), |s: NewSocket<SSL>| {
            NewSocket::on_handshake(
                s,
                socket_from_named_pipe::<SSL>(&this.named_pipe),
                success as i32,
                ssl_error,
            )
        });
    }

    pub(crate) fn on_end(this: ThisPtr<Self>) {
        match_socket!(this.socket.get(), |s: NewSocket<SSL>| NewSocket::on_end(
            s,
            socket_from_named_pipe::<SSL>(&this.named_pipe)
        ));
    }

    pub(crate) fn on_writable(this: ThisPtr<Self>) {
        match_socket!(this.socket.get(), |s: NewSocket<SSL>| {
            NewSocket::on_writable(s, socket_from_named_pipe::<SSL>(&this.named_pipe))
        });
    }

    /// VM stop phase: close the pipe now (its socket's close/error handlers run
    /// while script is still allowed) instead of during the final collection.
    /// `close` re-enters `on_close`, which may schedule the free of `this`.
    pub(crate) fn stop_for_vm_teardown(this: ThisPtr<Self>) {
        this.named_pipe.close();
    }

    pub(crate) fn on_error(this: ThisPtr<Self>, err: &SysError) {
        if this.is_open.get() {
            match_socket!(this.socket.get(), |s: NewSocket<SSL>| {
                let js_err = err.to_js(&this.global_this);
                s.handle_error(js_err)
            });
        } else {
            Self::fail_connect(this, err.errno as i32);
        }
    }

    /// `connectError` is the last event a socket whose connect failed receives:
    /// `handle_connect_error` releases its connecting ref, and no `on_close`
    /// follows for it. So this context is done with the socket too: release
    /// `create()`'s +1 now and forget the socket, so that neither the pipe's
    /// `on_close` (which still fires on the async failure path) nor `Drop`
    /// touches it again.
    fn fail_connect(this: ThisPtr<Self>, errno: i32) {
        // Cleared before `connectError` runs JS, which may connect the same
        // socket again through a new context.
        let socket = this.socket.replace(SocketType::None);
        match_socket!(socket, |s: NewSocket<SSL>| {
            // `create()`'s ref, taken out first so a reconnect from the
            // handler can install its own; released once the handler is done.
            let ours = s.named_pipe_ref.take();
            let failed = NewSocket::handle_connect_error(s, errno, 0);
            drop(ours);
            failed
        });
    }

    pub(crate) fn on_timeout(this: ThisPtr<Self>) {
        match_socket!(
            this.socket.get(),
            |s: NewSocket<SSL>| NewSocket::on_timeout(
                s,
                socket_from_named_pipe::<SSL>(&this.named_pipe)
            )
        );
    }

    pub(crate) fn on_close(this: ThisPtr<Self>) {
        // Snapshot `socket` before clearing it, then match the snapshot.
        let socket = this.socket.replace(SocketType::None);
        match_socket!(socket, |s: NewSocket<SSL>| {
            // See `fail_connect`.
            let ours = s.named_pipe_ref.take();
            let closed =
                NewSocket::on_close(s, socket_from_named_pipe::<SSL>(&this.named_pipe), 0, None);
            drop(ours);
            closed
        });
        // The pipe is closed: release the connection's ref.
        Self::release_conn_ref(this);
    }

    /// Last ref gone: free on a later tick (a pipe callback may still be on
    /// the stack above us). The queued task owns the allocation until
    /// `run_event`.
    fn schedule_deinit(this: OwnedThis<Self>) {
        debug_assert!(this.task_event.get() != EventState::Deinit);
        this.task_event.set(EventState::Deinit);
        let ptr = this.this_ptr();
        ptr.self_own.set(Some(this));
        // Dispatched by `task_tag::WindowsNamedPipeContext` to `run_event` /
        // `release_unrun`.
        ptr.vm.event_loop_mut().enqueue_task(bun_jsc::Task::new(
            bun_event_loop::task_tag::WindowsNamedPipeContext,
            ptr.as_ptr().cast(),
        ));
    }

    /// The queued hop (see [`schedule_deinit`](Self::schedule_deinit)); frees
    /// `this`, so nothing may touch it afterwards.
    pub(crate) fn run_event(this: ThisPtr<Self>) {
        match this.task_event.get() {
            EventState::Deinit => {
                crate::jsc_hooks::ActiveHandle::WindowsNamedPipe(core::ptr::NonNull::from(this))
                    .unregister();
                drop(this.self_own.take());
            }
            EventState::None => panic!("Invalid event state"),
        }
    }

    /// A `Deinit` hop (refcount already zero) that will not run: `this` is the
    /// heap context, freed by nobody else — do what the hop does, script-free.
    pub(crate) fn release_unrun(this: ThisPtr<Self>) {
        Self::run_event(this)
    }

    /// Release `create()`'s ref (`conn_ref`) — from `on_close`,
    /// `fail_and_release`, or an accept that failed before the pipe started;
    /// may schedule deinit.
    pub(crate) fn release_conn_ref(this: ThisPtr<Self>) {
        if let Some(conn) = this.conn_ref.take() {
            conn.deref();
        }
    }

    /// Owns the freshly-`create()`d context until `disarm()`: on any early
    /// return it fails the pending connect and releases the sole ref.
    fn armed(this: ThisPtr<Self>) -> FailAndRelease {
        FailAndRelease(Some(this))
    }

    /// errdefer shared by `open`/`connect`: fail the wrapped JS socket, then
    /// release the only ref `create()` handed us.
    fn fail_and_release(this: ThisPtr<Self>) {
        Self::fail_connect(this, SystemErrno::ENOENT as i32);
        Self::release_conn_ref(this);
    }

    /// Allocate a context wrapping `socket` (taking a +1 on it). The returned
    /// handle is backed by `conn_ref` — `create()`'s ref, held until the pipe
    /// closes or the connect fails.
    pub(crate) fn create(global_this: &JSGlobalObject, socket: SocketType) -> ThisPtr<Self> {
        let global_this = GlobalRef::from(global_this);
        let vm: &'static VirtualMachine = global_this.bun_vm();

        #[cfg(not(windows))]
        {
            // On POSIX `crate::socket::WindowsNamedPipeContext` is aliased to `()` (see mod.rs)
            // so no caller can reach `create()`. This arm exists only so the module
            // type-checks; matches the sibling `WindowsNamedPipe::open`/`connect` POSIX arms.
            let _ = (vm, global_this, socket);
            unreachable!("WindowsNamedPipeContext::create is windows-only")
        }
        #[cfg(windows)]
        {
            // named_pipe owns the pipe (PipeWriter owns the pipe and will close and deinit it)
            let this = RefPtr::new(WindowsNamedPipeContext {
                ref_count: Cell::new(1),
                socket: Cell::new(socket),
                named_pipe: WindowsNamedPipe::new(vm),
                vm,
                global_this,
                task_event: Cell::new(EventState::None),
                is_open: Cell::new(false),
                conn_ref: Cell::new(None),
                self_own: Cell::new(None),
            });
            this.named_pipe
                .owner
                .set(Some(BackRef::from(this.this_ptr())));
            LIVE_COUNT.fetch_add(1, Ordering::Relaxed);

            // Take a +1 intrusive ref so the wrapped JS socket outlives this context.
            match_socket!(socket, |s: NewSocket<SSL>| {
                NewSocket::hold_named_pipe_ref(s);
                Ok(())
            });

            // A socket over a Windows named pipe is in no uSockets group: the VM's
            // stop phase closes it through this owner (unregistered when freed).
            let ptr = this.this_ptr();
            crate::jsc_hooks::ActiveHandle::WindowsNamedPipe(core::ptr::NonNull::from(ptr))
                .register();

            ptr.conn_ref.set(Some(this));
            ptr
        }
    }

    /// The wrapped pipe's address as the opaque `bun_uws` shim type, for
    /// `InternalSocket::Pipe`.
    fn named_pipe_handle(this: ThisPtr<Self>) -> *mut bun_uws_sys::WindowsNamedPipe {
        core::ptr::from_ref(&this.named_pipe).cast_mut().cast()
    }

    /// `owned_ctx` is moved into `named_pipe.open`. Prefer it over `ssl_config` so a
    /// memoised `tls.createSecureContext` reaches this path with its trust store intact —
    /// on this branch `[buntls]` returns `{secureContext}` only, so `ssl_config`
    /// alone would be empty.
    pub(crate) fn open(
        global_this: &JSGlobalObject,
        fd: Fd,
        ssl_config: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
        socket: SocketType,
    ) -> Result<*mut bun_uws_sys::WindowsNamedPipe, crate::Error> {
        // TODO: reuse the same context for multiple connections when possibles

        let this = WindowsNamedPipeContext::create(global_this, socket);

        // The guard reaches `socket` through `this`: `create()` moved it there.
        let guard = Self::armed(this);

        guard.get().named_pipe.open(fd, ssl_config, owned_ctx)?;

        let this = guard.disarm();
        Ok(Self::named_pipe_handle(this))
    }

    /// See `open` for `owned_ctx` ownership.
    pub(crate) fn connect(
        global_this: &JSGlobalObject,
        path: &[u8],
        ssl_config: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
        socket: SocketType,
    ) -> Result<*mut bun_uws_sys::WindowsNamedPipe, crate::Error> {
        // TODO: reuse the same context for multiple connections when possibles

        let this = WindowsNamedPipeContext::create(global_this, socket);
        let guard = Self::armed(this);

        let named_pipe = &guard.get().named_pipe;

        if path[path.len() - 1] == 0 {
            // is already null terminated
            let slice_z = ZStr::from_slice_with_nul(path);
            named_pipe.connect(slice_z, ssl_config, owned_ctx)?;
        } else {
            let mut path_buf = PathBuffer::uninit();
            // we need to null terminate the path
            let len = path.len().min(path_buf.len() - 1);

            path_buf[..len].copy_from_slice(&path[..len]);
            path_buf[len] = 0;
            let slice_z = ZStr::from_buf(&path_buf[..], len);
            named_pipe.connect(slice_z, ssl_config, owned_ctx)?;
        }

        let this = guard.disarm();
        Ok(Self::named_pipe_handle(this))
    }

    // ── `WindowsWriterParent` (the named pipe's streaming writer) ────────────
    fn writer_on_write(this: ThisPtr<Self>, amount: usize, status: WriteStatus) {
        this.named_pipe.on_write(amount, status)
    }
    fn writer_on_error(this: ThisPtr<Self>, err: bun_sys::Error) {
        this.named_pipe.on_error(err)
    }
    fn writer_on_writable(this: ThisPtr<Self>) {
        this.named_pipe.on_writable()
    }
    fn writer_on_close(this: ThisPtr<Self>) {
        this.named_pipe.on_close()
    }
}

impl Drop for WindowsNamedPipeContext {
    fn drop(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipeContext, "deinit");
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        // Deref the wrapped socket, then let `named_pipe` drop.
        match_socket!(
            self.socket.replace(SocketType::None),
            // +1 ref taken in `create()`; this is the matching release.
            |s: NewSocket<SSL>| {
                s.release_named_pipe_ref();
                Ok(())
            }
        );
        // `named_pipe` drops via field destructor after this.
    }
}

// Windows-only at runtime; the POSIX impl exists purely so the
// `StreamingWriter<WindowsNamedPipeContext>` field type-checks (poll_tag::NULL
// keeps the dispatch table from being silently wrong if a poll is ever created).
bun_io::impl_streaming_writer_parent! {
    WindowsNamedPipeContext;
    poll_tag   = bun_io::posix_event_loop::poll_tag::NULL,
    borrow     = this,
    on_write   = writer_on_write,
    on_error   = writer_on_error,
    on_ready   = writer_on_writable,
    on_close   = writer_on_close,
    event_loop = |this| this.named_pipe.event_loop_handle.as_event_loop_ctx(),
    uws_loop   = |this| this.named_pipe.vm.uws_loop(),
    uv_loop    = |this| this.named_pipe.vm.uv_loop(),
}
