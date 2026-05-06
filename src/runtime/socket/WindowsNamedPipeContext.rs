use core::cell::Cell;
use core::ffi::c_void;
use core::ptr;
use core::ptr::NonNull;

use bun_core::Output;
use bun_jsc::{self as jsc, JSGlobalObject, SysErrorJsc};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_event_loop::AnyTask::AnyTask;
use bun_event_loop::Task;
use bun_uws::{self as uws, us_bun_verify_error_t};
use bun_sys::{self, Error as SysError, Fd, SystemErrno};
use bun_boringssl_sys as boringssl;
use bun_paths::PathBuffer;
use bun_str::ZStr;
use crate::socket::SSLConfig;
use crate::socket::windows_named_pipe::{WindowsNamedPipe, Handlers as NamedPipeHandlers};
use crate::api::{TCPSocket, TLSSocket};
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(not(windows))]
mod uv {
    //! libuv shim for non-Windows builds. `WindowsNamedPipeContext` is only
    //! reachable at runtime on Windows; on POSIX `crate::socket::WindowsNamedPipeContext`
    //! is aliased to `()` in `mod.rs`, but this module still type-checks.
    pub type Pipe = core::ffi::c_void;
}

bun_output::declare_scope!(WindowsNamedPipeContext, visible);

pub struct WindowsNamedPipeContext {
    // TODO(port): lifetime — intrusive refcount with custom drop = schedule_deinit
    ref_count: Cell<u32>,
    // PORT NOTE: `socket` deref'd manually in `Drop` before `named_pipe` field-drop
    // — matches Zig `deinit` order (socket.deref() then named_pipe.deinit()).
    socket: SocketType,
    named_pipe: WindowsNamedPipe,

    // task used to deinit the context in the next tick, vm is used to enqueue the task
    vm: &'static VirtualMachine,
    global_this: &'static JSGlobalObject,
    task: AnyTask,
    task_event: EventState,
    is_open: bool,
}

// Intrusive refcount: when count hits zero, calls `schedule_deinit` (NOT immediate free).
// TODO(port): bun_ptr::IntrusiveRc<Self> with custom on_zero = schedule_deinit
pub type RefCount = bun_ptr::IntrusiveRc<WindowsNamedPipeContext>;

impl WindowsNamedPipeContext {
    pub fn ref_(this: *mut Self) {
        // SAFETY: intrusive refcount; `this` is a live heap allocation managed by IntrusiveRc
        unsafe { (*this).ref_count.set((*this).ref_count.get() + 1) };
    }

    pub fn deref(this: *mut Self) {
        // SAFETY: intrusive refcount; `this` is a live heap allocation managed by IntrusiveRc
        unsafe {
            let n = (*this).ref_count.get() - 1;
            (*this).ref_count.set(n);
            if n == 0 {
                schedule_deinit(this);
            }
        }
    }
}

fn schedule_deinit(this: *mut WindowsNamedPipeContext) {
    // SAFETY: called from deref() when count hits zero; `this` still live until deinit_in_next_tick fires
    unsafe { (*this).deinit_in_next_tick() };
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum EventState {
    Deinit,
    None,
}

/// Zig: `union(enum) { tls: *TLSSocket, tcp: *TCPSocket, none }` — raw
/// intrusive-refcounted pointers (see `NewSocket::ref_`/`deref`). `Copy` so
/// matching by value avoids `&self.socket` aliasing `&mut self.named_pipe`.
#[derive(Copy, Clone)]
pub enum SocketType {
    Tls(*mut TLSSocket),
    Tcp(*mut TCPSocket),
    None,
}

/// Zig: `TLSSocket.Socket.fromNamedPipe(&this.named_pipe)` where
/// `Socket = uws.NewSocketHandler(ssl)`. `bun_uws::NewSocketHandler` stores the
/// pipe as a type-erased `*mut c_void` (the real `WindowsNamedPipe` lives in a
/// higher tier), so build the variant directly here.
#[inline]
fn socket_from_named_pipe<const SSL: bool>(pipe: &mut WindowsNamedPipe) -> uws::NewSocketHandler<SSL> {
    #[cfg(windows)]
    {
        uws::NewSocketHandler { socket: uws::InternalSocket::Pipe(pipe as *mut _ as *mut c_void) }
    }
    #[cfg(not(windows))]
    {
        let _ = pipe;
        uws::NewSocketHandler { socket: uws::InternalSocket::Pipe }
    }
}

impl WindowsNamedPipeContext {
    fn on_open(&mut self) {
        self.is_open = true;
        match self.socket {
            SocketType::Tls(tls) => {
                let socket = socket_from_named_pipe::<true>(&mut self.named_pipe);
                // SAFETY: `tls` is kept alive by the +1 ref taken in `create()`.
                unsafe { (*tls).on_open(socket) };
            }
            SocketType::Tcp(tcp) => {
                let socket = socket_from_named_pipe::<false>(&mut self.named_pipe);
                // SAFETY: `tcp` is kept alive by the +1 ref taken in `create()`.
                unsafe { (*tcp).on_open(socket) };
            }
            SocketType::None => {}
        }
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        match self.socket {
            SocketType::Tls(tls) => {
                let socket = socket_from_named_pipe::<true>(&mut self.named_pipe);
                // SAFETY: see `on_open`.
                unsafe { (*tls).on_data(socket, decoded_data) };
            }
            SocketType::Tcp(tcp) => {
                let socket = socket_from_named_pipe::<false>(&mut self.named_pipe);
                // SAFETY: see `on_open`.
                unsafe { (*tcp).on_data(socket, decoded_data) };
            }
            SocketType::None => {}
        }
    }

    fn on_handshake(&mut self, success: bool, ssl_error: us_bun_verify_error_t) {
        match self.socket {
            SocketType::Tls(tls) => {
                let socket = socket_from_named_pipe::<true>(&mut self.named_pipe);
                // SAFETY: see `on_open`.
                let _ = unsafe { (*tls).on_handshake(socket, success as i32, ssl_error) };
            }
            SocketType::Tcp(tcp) => {
                let socket = socket_from_named_pipe::<false>(&mut self.named_pipe);
                // SAFETY: see `on_open`.
                let _ = unsafe { (*tcp).on_handshake(socket, success as i32, ssl_error) };
            }
            SocketType::None => {}
        }
    }

    fn on_end(&mut self) {
        match self.socket {
            SocketType::Tls(tls) => {
                let socket = socket_from_named_pipe::<true>(&mut self.named_pipe);
                // SAFETY: see `on_open`.
                unsafe { (*tls).on_end(socket) };
            }
            SocketType::Tcp(tcp) => {
                let socket = socket_from_named_pipe::<false>(&mut self.named_pipe);
                // SAFETY: see `on_open`.
                unsafe { (*tcp).on_end(socket) };
            }
            SocketType::None => {}
        }
    }

    fn on_writable(&mut self) {
        match self.socket {
            SocketType::Tls(tls) => {
                let socket = socket_from_named_pipe::<true>(&mut self.named_pipe);
                // SAFETY: see `on_open`.
                unsafe { (*tls).on_writable(socket) };
            }
            SocketType::Tcp(tcp) => {
                let socket = socket_from_named_pipe::<false>(&mut self.named_pipe);
                // SAFETY: see `on_open`.
                unsafe { (*tcp).on_writable(socket) };
            }
            SocketType::None => {}
        }
    }

    fn on_error(&mut self, err: SysError) {
        if self.is_open {
            match self.socket {
                SocketType::Tls(tls) => {
                    let js_err = err.to_js(self.global_this);
                    // SAFETY: see `on_open`.
                    unsafe { (*tls).handle_error(js_err) };
                }
                SocketType::Tcp(tcp) => {
                    let js_err = err.to_js(self.global_this);
                    // SAFETY: see `on_open`.
                    unsafe { (*tcp).handle_error(js_err) };
                }
                SocketType::None => {}
            }
        } else {
            match self.socket {
                SocketType::Tls(tls) => {
                    // SAFETY: see `on_open`.
                    let _ = unsafe { (*tls).handle_connect_error(err.errno as i32) };
                }
                SocketType::Tcp(tcp) => {
                    // SAFETY: see `on_open`.
                    let _ = unsafe { (*tcp).handle_connect_error(err.errno as i32) };
                }
                SocketType::None => {}
            }
        }
    }

    fn on_timeout(&mut self) {
        match self.socket {
            SocketType::Tls(tls) => {
                let socket = socket_from_named_pipe::<true>(&mut self.named_pipe);
                // SAFETY: see `on_open`.
                unsafe { (*tls).on_timeout(socket) };
            }
            SocketType::Tcp(tcp) => {
                let socket = socket_from_named_pipe::<false>(&mut self.named_pipe);
                // SAFETY: see `on_open`.
                unsafe { (*tcp).on_timeout(socket) };
            }
            SocketType::None => {}
        }
    }

    fn on_close(this: *mut Self) {
        // SAFETY: called from named_pipe callback; `this` is the live ctx pointer registered in create()
        let this_ref = unsafe { &mut *this };
        let socket = core::mem::replace(&mut this_ref.socket, SocketType::None);
        match socket {
            SocketType::Tls(tls) => {
                // SAFETY: `tls` held a +1 ref from `create()`; release it after dispatch.
                unsafe {
                    let _ = (*tls).on_close(socket_from_named_pipe::<true>(&mut this_ref.named_pipe), 0, None);
                    (*tls).deref();
                }
            }
            SocketType::Tcp(tcp) => {
                // SAFETY: `tcp` held a +1 ref from `create()`; release it after dispatch.
                unsafe {
                    let _ = (*tcp).on_close(socket_from_named_pipe::<false>(&mut this_ref.named_pipe), 0, None);
                    (*tcp).deref();
                }
            }
            SocketType::None => {}
        }

        Self::deref(this);
    }

    fn run_event(this: *mut Self) {
        // SAFETY: called from AnyTask; `this` is the live ctx pointer registered in create()
        match unsafe { (*this).task_event } {
            EventState::Deinit => {
                // SAFETY: `this` was allocated via Box::into_raw in create(); refcount hit zero
                // and this deferred task is the sole remaining owner. Drop runs field destructors.
                drop(unsafe { Box::from_raw(this) });
            }
            EventState::None => panic!("Invalid event state"),
        }
    }

    fn deinit_in_next_tick(&mut self) {
        debug_assert!(self.task_event != EventState::Deinit);
        self.task_event = EventState::Deinit;
        // SAFETY: `vm` is the process-global VirtualMachine; `enqueue_task` mutates
        // its task queue. We hold `&'static VirtualMachine` (JSC_BORROW) so cast
        // through a raw pointer to obtain the `&mut` the upstream API requires.
        let vm = self.vm as *const VirtualMachine as *mut VirtualMachine;
        unsafe { (*vm).enqueue_task(Task::init(&mut self.task)) };
    }

    pub fn create(global_this: &JSGlobalObject, socket: SocketType) -> *mut WindowsNamedPipeContext {
        // SAFETY: JSC_BORROW — the global object / VM are process-global singletons
        // that outlive every `WindowsNamedPipeContext`; extend the borrow to `'static`
        // so they can be stored in the heap-allocated struct.
        let global_this: &'static JSGlobalObject = unsafe { &*(global_this as *const JSGlobalObject) };
        let vm: &'static VirtualMachine = unsafe { &*global_this.bun_vm() };
        // TODO(port): in-place init — `named_pipe`/`task` capture `this` (self-referential), so
        // allocate uninit, derive the stable pointer, build the fields, then ptr::write the whole
        // struct. Avoids `mem::zeroed()` on non-POD AnyTask/WindowsNamedPipe.
        let this: *mut WindowsNamedPipeContext =
            Box::into_raw(Box::<core::mem::MaybeUninit<WindowsNamedPipeContext>>::new_uninit()).cast();

        // named_pipe owns the pipe (PipeWriter owns the pipe and will close and deinit it)
        let handlers = NamedPipeHandlers {
            ctx: this as *mut c_void,
            // SAFETY: fn pointers cast to erased callback ABI; receiver layout matches ctx type
            ref_ctx: unsafe { core::mem::transmute(Self::ref_ as fn(*mut Self)) },
            deref_ctx: unsafe { core::mem::transmute(Self::deref as fn(*mut Self)) },
            on_open: unsafe { core::mem::transmute(Self::on_open as fn(&mut Self)) },
            on_data: unsafe { core::mem::transmute(Self::on_data as fn(&mut Self, &[u8])) },
            on_handshake: unsafe { core::mem::transmute(Self::on_handshake as fn(&mut Self, bool, us_bun_verify_error_t)) },
            on_end: unsafe { core::mem::transmute(Self::on_end as fn(&mut Self)) },
            on_writable: unsafe { core::mem::transmute(Self::on_writable as fn(&mut Self)) },
            on_error: unsafe { core::mem::transmute(Self::on_error as fn(&mut Self, SysError)) },
            on_timeout: unsafe { core::mem::transmute(Self::on_timeout as fn(&mut Self)) },
            on_close: unsafe { core::mem::transmute(Self::on_close as fn(*mut Self)) },
        };
        #[cfg(windows)]
        let named_pipe = {
            // SAFETY: all-zero is a valid uv::Pipe (#[repr(C)] POD)
            let pipe = Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() });
            WindowsNamedPipe::from(pipe, handlers, vm)
        };
        #[cfg(not(windows))]
        let named_pipe: WindowsNamedPipe = {
            // Unreachable at runtime on POSIX (`crate::socket::WindowsNamedPipeContext`
            // is aliased to `()`); keep the module type-checking by leaving the
            // Windows-only constructor out of the call graph.
            let _ = handlers;
            todo!("blocked_on: WindowsNamedPipe::from (windows-only)")
        };
        // Zig: `jsc.AnyTask.New(WindowsNamedPipeContext, runEvent).init(this)` — the
        // comptime-callback `New<T>` wrapper is not yet expressible on stable Rust,
        // so build the erased AnyTask directly.
        let task = AnyTask {
            ctx: NonNull::new(this.cast::<c_void>()),
            callback: |ctx| {
                Self::run_event(ctx.cast::<WindowsNamedPipeContext>());
                Ok(())
            },
        };

        // SAFETY: `this` is freshly allocated uninit storage exclusively owned here; we write
        // every field exactly once before any read.
        unsafe {
            ptr::write(this, WindowsNamedPipeContext {
                ref_count: Cell::new(1),
                socket,
                named_pipe,
                vm,
                global_this,
                task,
                task_event: EventState::None,
                is_open: false,
            });
        }

        // Zig: `switch (socket) { .tls => |tls| tls.ref(), .tcp => |tcp| tcp.ref(), ... }`
        // — take a +1 intrusive ref so the wrapped JS socket outlives this context.
        match socket {
            // SAFETY: caller passes a live socket pointer; `ref_` only bumps the count.
            SocketType::Tls(tls) => unsafe { (*tls).ref_() },
            SocketType::Tcp(tcp) => unsafe { (*tcp).ref_() },
            SocketType::None => {}
        }

        this
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
    ) -> Result<*mut WindowsNamedPipe, bun_core::Error> {
        // TODO: reuse the same context for multiple connections when possibles

        let this = WindowsNamedPipeContext::create(global_this, socket);

        // PORT NOTE: reshaped for borrowck — errdefer references `socket` which was moved into `this`
        let mut guard = scopeguard::guard(this, |this| {
            // SAFETY: `this` is live; create() returned it and no deref has fired yet
            match unsafe { (*this).socket } {
                SocketType::Tls(tls) => {
                    // SAFETY: +1 ref held; live until `Self::deref` below.
                    let _ = unsafe { (*tls).handle_connect_error(SystemErrno::ENOENT as i32) };
                }
                SocketType::Tcp(tcp) => {
                    // SAFETY: +1 ref held; live until `Self::deref` below.
                    let _ = unsafe { (*tcp).handle_connect_error(SystemErrno::ENOENT as i32) };
                }
                SocketType::None => {}
            }
            Self::deref(this);
        });

        // SAFETY: `this` is live and exclusively accessed here
        unsafe { (**guard).named_pipe.open(fd, ssl_config, owned_ctx) }?;

        let this = scopeguard::ScopeGuard::into_inner(guard);
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
    ) -> Result<*mut WindowsNamedPipe, bun_core::Error> {
        // TODO: reuse the same context for multiple connections when possibles

        let this = WindowsNamedPipeContext::create(global_this, socket);
        let mut guard = scopeguard::guard(this, |this| {
            // SAFETY: `this` is live; create() returned it and no deref has fired yet
            match unsafe { (*this).socket } {
                SocketType::Tls(tls) => {
                    // SAFETY: +1 ref held; live until `Self::deref` below.
                    let _ = unsafe { (*tls).handle_connect_error(SystemErrno::ENOENT as i32) };
                }
                SocketType::Tcp(tcp) => {
                    // SAFETY: +1 ref held; live until `Self::deref` below.
                    let _ = unsafe { (*tcp).handle_connect_error(SystemErrno::ENOENT as i32) };
                }
                SocketType::None => {}
            }
            Self::deref(this);
        });

        // SAFETY: `this` is live and exclusively accessed here
        let named_pipe = unsafe { &mut (**guard).named_pipe };

        if path[path.len() - 1] == 0 {
            // is already null terminated
            // SAFETY: path[path.len()-1] == 0 checked above
            let slice_z = unsafe { ZStr::from_raw(path.as_ptr(), path.len() - 1) };
            named_pipe.connect(slice_z, ssl_config, owned_ctx)?;
        } else {
            let mut path_buf = PathBuffer::uninit();
            // we need to null terminate the path
            let len = path.len().min(path_buf.len() - 1);

            path_buf[..len].copy_from_slice(&path[..len]);
            path_buf[len] = 0;
            // SAFETY: path_buf[len] == 0 written above
            let slice_z = unsafe { ZStr::from_raw(path_buf.as_ptr(), len) };
            named_pipe.connect(slice_z, ssl_config, owned_ctx)?;
        }

        let this = scopeguard::ScopeGuard::into_inner(guard);
        // SAFETY: `this` is live; returning interior pointer to heap-allocated field (BACKREF)
        Ok(unsafe { ptr::addr_of_mut!((*this).named_pipe) })
    }

}

impl Drop for WindowsNamedPipeContext {
    fn drop(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipeContext, "deinit");
        // Zig `deinit`: deref the wrapped socket, then `named_pipe.deinit()`.
        match core::mem::replace(&mut self.socket, SocketType::None) {
            // SAFETY: +1 ref taken in `create()`; this is the matching release.
            SocketType::Tls(tls) => unsafe { (*tls).deref() },
            SocketType::Tcp(tcp) => unsafe { (*tcp).deref() },
            SocketType::None => {}
        }
        // `named_pipe` drops via field destructor after this.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/WindowsNamedPipeContext.zig (307 lines)
//   confidence: medium
//   todos:      4
//   notes:      intrusive refcount w/ deferred-task self-destroy + raw ctx ptr through uws callbacks; create() uses MaybeUninit+ptr::write for self-referential init; TLSSocket/TCPSocket Arc semantics need verification vs IntrusiveArc; &'static JSGlobalObject/VirtualMachine fields are JSC_BORROW
// ──────────────────────────────────────────────────────────────────────────
