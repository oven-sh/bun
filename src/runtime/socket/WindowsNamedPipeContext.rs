use core::cell::Cell;
use core::ffi::c_void;
use core::ptr;

use crate::api::{TCPSocket, TLSSocket};
use crate::socket::NewSocket;
use crate::socket::SSLConfig;
use crate::socket::windows_named_pipe::{Handlers as NamedPipeHandlers, WindowsNamedPipe};
use bun_boringssl_sys as boringssl;
use bun_core::ZStr;
use bun_event_loop::AnyTask::AnyTask;
use bun_event_loop::Task;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSGlobalObject, SysErrorJsc};
use bun_paths::PathBuffer;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Error as SysError, Fd, SystemErrno};
use bun_uws::{self as uws, us_bun_verify_error_t};

bun_output::declare_scope!(WindowsNamedPipeContext, visible);

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = schedule_deinit)]
pub struct WindowsNamedPipeContext {
    // Intrusive refcount; on zero → `schedule_deinit` (deferred free), not
    // immediate `Box::from_raw`.
    ref_count: Cell<u32>,
    // `socket` is deref'd manually in `Drop` before the `named_pipe` field
    // drops — teardown order must stay socket.deref() then named_pipe deinit.
    socket: SocketType,
    /// `pub(super)` so `WindowsNamedPipeListeningContext::on_client_connect`
    /// (sibling module) can call `get_accepted_by` on the freshly-created
    /// client.
    pub(super) named_pipe: WindowsNamedPipe,

    // task used to deinit the context in the next tick, vm is used to enqueue the task
    vm: &'static VirtualMachine,
    global_this: GlobalRef,
    task: AnyTask,
    task_event: EventState,
    is_open: bool,
}

/// Reached from `on_close` → `Self::deref` while `WindowsNamedPipe::on_close`
/// still holds a live `&mut (*this).named_pipe` and uses it after we return, so
/// project raw fields only — same constraint as the `on_*` handlers below.
fn schedule_deinit(this: *mut WindowsNamedPipeContext) {
    // SAFETY: called from `deref()` at count zero; `this` is live until the task fires.
    // `task_event`/`vm`/`task` are disjoint from the caller's `&mut named_pipe`, and
    // `vm` is `&'static` (JSC_BORROW) so `enqueue_task`'s `&mut` goes through a raw cast.
    unsafe {
        debug_assert!((*this).task_event != EventState::Deinit);
        (*this).task_event = EventState::Deinit;
        let vm = ptr::from_ref::<VirtualMachine>((*this).vm).cast_mut();
        (*vm).enqueue_task(Task::init(ptr::addr_of_mut!((*this).task)));
    }
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum EventState {
    Deinit,
    None,
}

/// Intrusive-refcounted self-pointers into the wrapped JS socket (a *different*
/// allocation from this context, so `ThisPtr`'s `Deref` is sound on them).
/// `Copy` so matching by value avoids `&self.socket` aliasing `&mut self.named_pipe`.
#[derive(Copy, Clone)]
pub enum SocketType {
    Tls(bun_ptr::ThisPtr<TLSSocket>),
    Tcp(bun_ptr::ThisPtr<TCPSocket>),
    None,
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
    #[cfg(windows)]
    {
        uws::NewSocketHandler {
            socket: uws::InternalSocket::Pipe(pipe.cast()),
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
///
/// Takes the `SocketType` by *value* (Copy) — not `*mut Self` — so callers
/// that must snapshot before mutating (`on_close`) or branch and re-match
/// (`on_error`) pass their saved copy; see the Stacked-Borrows note on the
/// `on_*` block below.
macro_rules! match_socket {
    ($scrutinee:expr, |$s:ident: NewSocket<$ssl:ident>| $body:expr) => {
        match $scrutinee {
            SocketType::Tls($s) => {
                const $ssl: bool = true;
                let _ = $ssl;
                $body
            }
            SocketType::Tcp($s) => {
                const $ssl: bool = false;
                let _ = $ssl;
                $body
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
/// Fails the pending connect and releases `create()`'s sole ref, unless
/// `disarm()` runs first.
struct FailAndRelease(Option<*mut WindowsNamedPipeContext>);

impl FailAndRelease {
    fn get(&mut self) -> *mut WindowsNamedPipeContext {
        self.0.expect("guard already disarmed")
    }

    fn disarm(mut self) -> *mut WindowsNamedPipeContext {
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

impl WindowsNamedPipeContext {
    fn on_open(this: *mut Self) {
        // SAFETY: `this` is the live ctx ptr registered in `create()`; `is_open`,
        // `socket` and the `named_pipe` field *address* are all reachable without
        // forming a reference that overlaps the caller's `&mut named_pipe`.
        let (socket, pipe) = unsafe {
            (*this).is_open = true;
            ((*this).socket, ptr::addr_of_mut!((*this).named_pipe))
        };
        match_socket!(socket, |s: NewSocket<SSL>| NewSocket::on_open(
            s,
            socket_from_named_pipe::<SSL>(pipe)
        ));
    }

    fn on_data(this: *mut Self, decoded_data: &[u8]) {
        // SAFETY: see `on_open`.
        let (socket, pipe) = unsafe { ((*this).socket, ptr::addr_of_mut!((*this).named_pipe)) };
        match_socket!(socket, |s: NewSocket<SSL>| NewSocket::on_data(
            s,
            socket_from_named_pipe::<SSL>(pipe),
            decoded_data
        ));
    }

    fn on_session(this: *mut Self, session: &[u8]) {
        // Only the TLS wrapper parks sessions; the TCP arm can never get here.
        // SAFETY: see `on_open`.
        if let SocketType::Tls(s) = unsafe { (*this).socket } {
            let _ = TLSSocket::on_session(s, session);
        }
    }

    fn on_keylog(this: *mut Self, line: &[u8]) {
        // SAFETY: see `on_open`.
        if let SocketType::Tls(s) = unsafe { (*this).socket } {
            let _ = TLSSocket::on_keylog(s, line);
        }
    }

    fn on_handshake(this: *mut Self, success: bool, ssl_error: us_bun_verify_error_t) {
        // SAFETY: see `on_open`.
        let (socket, pipe) = unsafe { ((*this).socket, ptr::addr_of_mut!((*this).named_pipe)) };
        match_socket!(socket, |s: NewSocket<SSL>| _ = NewSocket::on_handshake(
            s,
            socket_from_named_pipe::<SSL>(pipe),
            success as i32,
            ssl_error
        ));
    }

    fn on_end(this: *mut Self) {
        // SAFETY: see `on_open`.
        let (socket, pipe) = unsafe { ((*this).socket, ptr::addr_of_mut!((*this).named_pipe)) };
        match_socket!(socket, |s: NewSocket<SSL>| NewSocket::on_end(
            s,
            socket_from_named_pipe::<SSL>(pipe)
        ));
    }

    fn on_writable(this: *mut Self) {
        // SAFETY: see `on_open`.
        let (socket, pipe) = unsafe { ((*this).socket, ptr::addr_of_mut!((*this).named_pipe)) };
        match_socket!(socket, |s: NewSocket<SSL>| NewSocket::on_writable(
            s,
            socket_from_named_pipe::<SSL>(pipe)
        ));
    }

    fn on_error(this: *mut Self, err: &SysError) {
        // SAFETY: see `on_open`. `is_open`/`socket` are Copy field reads.
        let (is_open, socket) = unsafe { ((*this).is_open, (*this).socket) };
        if is_open {
            match_socket!(socket, |s: NewSocket<SSL>| {
                // SAFETY: `this` is live; `global_this` is disjoint from the caller's
                // `&mut named_pipe` and the borrow ends before `handle_error` runs JS.
                let js_err = err.to_js(unsafe { &(*this).global_this });
                s.handle_error(js_err);
            });
        } else {
            match_socket!(socket, |s: NewSocket<SSL>| _ =
                NewSocket::handle_connect_error(s, err.errno as i32, 0));
        }
    }

    fn on_timeout(this: *mut Self) {
        // SAFETY: see `on_open`.
        let (socket, pipe) = unsafe { ((*this).socket, ptr::addr_of_mut!((*this).named_pipe)) };
        match_socket!(socket, |s: NewSocket<SSL>| NewSocket::on_timeout(
            s,
            socket_from_named_pipe::<SSL>(pipe)
        ));
    }

    fn on_close(this: *mut Self) {
        // SAFETY: see `on_open`. Snapshot `socket` BEFORE clearing it, then match
        // the snapshot — the macro must not read `(*this).socket` directly here.
        let (socket, pipe) = unsafe {
            let socket = (*this).socket;
            (*this).socket = SocketType::None;
            (socket, ptr::addr_of_mut!((*this).named_pipe))
        };
        match_socket!(socket, |s: NewSocket<SSL>| {
            _ = NewSocket::on_close(s, socket_from_named_pipe::<SSL>(pipe), 0, None);
            // Release the +1 ref taken in `create()`.
            s.get().deref();
        });
        // SAFETY: `this` is the live ctx pointer registered in create();
        // releasing the named-pipe's ref may schedule deinit.
        unsafe { Self::deref(this) };
    }

    #[cfg(windows)]
    fn run_event(this: *mut Self) {
        // SAFETY: called from AnyTask; `this` is the live ctx pointer registered in create()
        match unsafe { (*this).task_event } {
            EventState::Deinit => {
                // SAFETY: `this` was allocated via heap::alloc in create(); refcount hit zero
                // and this deferred task is the sole remaining owner. Drop runs field destructors.
                drop(unsafe { bun_core::heap::take(this) });
            }
            EventState::None => panic!("Invalid event state"),
        }
    }

    /// Owns the freshly-`create()`d context until `disarm()`: on any early
    /// return it fails the pending connect and releases the sole ref.
    fn armed(this: *mut Self) -> FailAndRelease {
        FailAndRelease(Some(this))
    }

    /// errdefer shared by `open`/`connect`: fail the wrapped JS socket, then
    /// release the only ref `create()` handed us.
    fn fail_and_release(this: *mut Self) {
        // SAFETY: `this` is live; `create()` returned it and no deref has fired yet.
        // +1 ref held on the inner socket; live until `Self::deref` below.
        match_socket!(unsafe { (*this).socket }, |s: NewSocket<SSL>| _ =
            NewSocket::handle_connect_error(s, SystemErrno::ENOENT as i32, 0));
        // SAFETY: `this` was just returned from `create()` (refcount==1);
        // release the only ref on the errdefer path.
        unsafe { Self::deref(this) };
    }

    pub fn create(
        global_this: &JSGlobalObject,
        socket: SocketType,
    ) -> *mut WindowsNamedPipeContext {
        let global_this = GlobalRef::from(global_this);
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
            // SAFETY: `p` is the `ctx` set above (`this.cast()`); the
            // WindowsNamedPipe never invokes a handler after `on_close`
            // schedules deinit, so the allocation is live for the call.
            // `rc_ref` projects `ref_count` via raw place — `(*p).ref_()` would
            // autoref `&Self` over the whole struct, but `WindowsNamedPipe::r#ref`
            // holds `&mut (*this).named_pipe` across this callback.
            ref_ctx: |p| unsafe { <Self as bun_ptr::AnyRefCounted>::rc_ref(p.cast::<Self>()) },
            // SAFETY: `p` is the `ctx` set above (`this.cast()`); the allocation is live for the call (see `ref_ctx`).
            deref_ctx: |p| unsafe { Self::deref(p.cast::<Self>()) },
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
        };
        #[cfg(not(windows))]
        {
            // On POSIX `crate::socket::WindowsNamedPipeContext` is aliased to `()` (see mod.rs)
            // so no caller can reach `create()`. This arm exists only so the module
            // type-checks; matches the sibling `WindowsNamedPipe::open`/`connect` POSIX arms.
            let _ = (vm, this, handlers, socket);
            unreachable!("WindowsNamedPipeContext::create is windows-only")
        }
        #[cfg(windows)]
        {
            let named_pipe = {
                let pipe = Box::new(bun_core::ffi::zeroed::<uv::Pipe>());
                WindowsNamedPipe::from(pipe, handlers, vm)
            };
            // Build the erased AnyTask directly.
            let task = AnyTask {
                ctx: ptr::NonNull::new(this.cast::<c_void>()),
                callback: |ctx| {
                    Self::run_event(ctx.cast::<WindowsNamedPipeContext>());
                    Ok(())
                },
                // Owned by the pipe context, not the queue.
                dispose: None,
            };

            // SAFETY: `this` is freshly allocated uninit storage exclusively owned here; we write
            // every field exactly once before any read.
            unsafe {
                ptr::write(
                    this,
                    WindowsNamedPipeContext {
                        ref_count: Cell::new(1),
                        socket,
                        named_pipe,
                        vm,
                        global_this,
                        task,
                        task_event: EventState::None,
                        is_open: false,
                    },
                );
            }

            // Take a +1 intrusive ref so the wrapped JS socket outlives this context.
            match_socket!(socket, |s: NewSocket<SSL>| s.ref_());

            this
        }
    }

    /// `owned_ctx` is one `SSL_CTX_up_ref` ADOPTED by `named_pipe.open` (kept on
    /// success, freed by it on failure). Prefer it over `ssl_config` so a memoised
    /// `tls.createSecureContext` reaches this path with its trust store intact —
    /// on this branch `[buntls]` returns `{secureContext}` only, so `ssl_config`
    /// alone would be empty.
    pub fn open(
        global_this: &JSGlobalObject,
        fd: Fd,
        ssl_config: Option<SSLConfig>,
        owned_ctx: Option<*mut boringssl::SSL_CTX>,
        socket: SocketType,
    ) -> Result<*mut WindowsNamedPipe, crate::Error> {
        // TODO: reuse the same context for multiple connections when possibles

        let this = WindowsNamedPipeContext::create(global_this, socket);

        // The guard reaches `socket` through `this`: `create()` moved it there.
        let mut guard = Self::armed(this);

        // SAFETY: `this` is live and exclusively accessed here
        unsafe { (*guard.get()).named_pipe.open(fd, ssl_config, owned_ctx) }?;

        let this = guard.disarm();
        // SAFETY: `this` is live; returning interior pointer to heap-allocated field (BACKREF)
        Ok(unsafe { ptr::addr_of_mut!((*this).named_pipe) })
    }

    /// See `open` for `owned_ctx` ownership.
    pub fn connect(
        global_this: &JSGlobalObject,
        path: &[u8],
        ssl_config: Option<SSLConfig>,
        owned_ctx: Option<*mut boringssl::SSL_CTX>,
        socket: SocketType,
    ) -> Result<*mut WindowsNamedPipe, crate::Error> {
        // TODO: reuse the same context for multiple connections when possibles

        let this = WindowsNamedPipeContext::create(global_this, socket);
        let mut guard = Self::armed(this);

        // SAFETY: `this` is live and exclusively accessed here
        let named_pipe = unsafe { &mut (*guard.get()).named_pipe };

        if path[path.len() - 1] == 0 {
            // is already null terminated
            // SAFETY: path[path.len()-1] == 0 checked above
            let slice_z = ZStr::from_slice_with_nul(path);
            named_pipe.connect(slice_z, ssl_config, owned_ctx)?;
        } else {
            let mut path_buf = PathBuffer::uninit();
            // we need to null terminate the path
            let len = path.len().min(path_buf.len() - 1);

            path_buf[..len].copy_from_slice(&path[..len]);
            path_buf[len] = 0;
            // SAFETY: path_buf[len] == 0 written above
            let slice_z = ZStr::from_buf(&path_buf[..], len);
            named_pipe.connect(slice_z, ssl_config, owned_ctx)?;
        }

        let this = guard.disarm();
        // SAFETY: `this` is live; returning interior pointer to heap-allocated field (BACKREF)
        Ok(unsafe { ptr::addr_of_mut!((*this).named_pipe) })
    }
}

impl Drop for WindowsNamedPipeContext {
    fn drop(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipeContext, "deinit");
        // Deref the wrapped socket, then let `named_pipe` drop.
        match_socket!(
            core::mem::replace(&mut self.socket, SocketType::None),
            // +1 ref taken in `create()`; this is the matching release.
            |s: NewSocket<SSL>| s.get().deref()
        );
        // `named_pipe` drops via field destructor after this.
    }
}
