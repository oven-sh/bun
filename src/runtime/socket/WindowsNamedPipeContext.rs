use core::cell::Cell;
use core::ffi::c_void;
use core::ptr;
use std::sync::Arc;

use bun_core::Output;
use bun_jsc::{self as jsc, AnyTask, JSGlobalObject, Task, VirtualMachine};
use bun_uws::{self as uws, us_bun_verify_error_t, WindowsNamedPipe};
use bun_sys::{self, Error as SysError, Fd, SystemErrno};
use bun_boringssl_sys as boringssl;
use bun_paths::PathBuffer;
use bun_str::ZStr;
use bun_runtime::api::server_config::SSLConfig;
use bun_runtime::api::{TCPSocket, TLSSocket};
use bun_sys::windows::libuv as uv;

bun_output::declare_scope!(WindowsNamedPipeContext, visible);

pub struct WindowsNamedPipeContext {
    // TODO(port): lifetime — intrusive refcount with custom drop = schedule_deinit
    ref_count: Cell<u32>,
    // PORT NOTE: `socket` declared before `named_pipe` so Drop releases the Arc before
    // tearing down the pipe — matches Zig `deinit` order (socket.deref() then named_pipe.deinit()).
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
                Self::schedule_deinit(this);
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

pub enum SocketType {
    Tls(Arc<TLSSocket>),
    Tcp(Arc<TCPSocket>),
    None,
}

impl WindowsNamedPipeContext {
    fn on_open(&mut self) {
        self.is_open = true;
        match &self.socket {
            SocketType::Tls(tls) => {
                let socket = <TLSSocket as jsc::api::SocketWrapper>::Socket::from_named_pipe(&mut self.named_pipe);
                tls.on_open(socket);
            }
            SocketType::Tcp(tcp) => {
                let socket = <TCPSocket as jsc::api::SocketWrapper>::Socket::from_named_pipe(&mut self.named_pipe);
                tcp.on_open(socket);
            }
            SocketType::None => {}
        }
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        match &self.socket {
            SocketType::Tls(tls) => {
                let socket = TLSSocket::Socket::from_named_pipe(&mut self.named_pipe);
                tls.on_data(socket, decoded_data);
            }
            SocketType::Tcp(tcp) => {
                let socket = TCPSocket::Socket::from_named_pipe(&mut self.named_pipe);
                tcp.on_data(socket, decoded_data);
            }
            SocketType::None => {}
        }
    }

    fn on_handshake(&mut self, success: bool, ssl_error: us_bun_verify_error_t) {
        match &self.socket {
            SocketType::Tls(tls) => {
                let socket = TLSSocket::Socket::from_named_pipe(&mut self.named_pipe);
                let _ = tls.on_handshake(socket, success as i32, ssl_error);
            }
            SocketType::Tcp(tcp) => {
                let socket = TCPSocket::Socket::from_named_pipe(&mut self.named_pipe);
                let _ = tcp.on_handshake(socket, success as i32, ssl_error);
            }
            SocketType::None => {}
        }
    }

    fn on_end(&mut self) {
        match &self.socket {
            SocketType::Tls(tls) => {
                let socket = TLSSocket::Socket::from_named_pipe(&mut self.named_pipe);
                tls.on_end(socket);
            }
            SocketType::Tcp(tcp) => {
                let socket = TCPSocket::Socket::from_named_pipe(&mut self.named_pipe);
                tcp.on_end(socket);
            }
            SocketType::None => {}
        }
    }

    fn on_writable(&mut self) {
        match &self.socket {
            SocketType::Tls(tls) => {
                let socket = TLSSocket::Socket::from_named_pipe(&mut self.named_pipe);
                tls.on_writable(socket);
            }
            SocketType::Tcp(tcp) => {
                let socket = TCPSocket::Socket::from_named_pipe(&mut self.named_pipe);
                tcp.on_writable(socket);
            }
            SocketType::None => {}
        }
    }

    fn on_error(&mut self, err: SysError) {
        if self.is_open {
            match &self.socket {
                SocketType::Tls(tls) => {
                    let Ok(js_err) = err.to_js(self.global_this) else { return };
                    tls.handle_error(js_err);
                }
                SocketType::Tcp(tcp) => {
                    let Ok(js_err) = err.to_js(self.global_this) else { return };
                    tcp.handle_error(js_err);
                }
                SocketType::None => {}
            }
        } else {
            match &self.socket {
                SocketType::Tls(tls) => {
                    let _ = tls.handle_connect_error(err.errno);
                }
                SocketType::Tcp(tcp) => {
                    let _ = tcp.handle_connect_error(err.errno);
                }
                SocketType::None => {}
            }
        }
    }

    fn on_timeout(&mut self) {
        match &self.socket {
            SocketType::Tls(tls) => {
                let socket = TLSSocket::Socket::from_named_pipe(&mut self.named_pipe);
                tls.on_timeout(socket);
            }
            SocketType::Tcp(tcp) => {
                let socket = TCPSocket::Socket::from_named_pipe(&mut self.named_pipe);
                tcp.on_timeout(socket);
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
                let _ = tls.on_close(TLSSocket::Socket::from_named_pipe(&mut this_ref.named_pipe), 0, None);
                drop(tls); // deref
            }
            SocketType::Tcp(tcp) => {
                let _ = tcp.on_close(TCPSocket::Socket::from_named_pipe(&mut this_ref.named_pipe), 0, None);
                drop(tcp); // deref
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
        self.vm.enqueue_task(Task::init(&mut self.task));
    }

    pub fn create(global_this: &JSGlobalObject, socket: SocketType) -> *mut WindowsNamedPipeContext {
        let vm = global_this.bun_vm();
        // TODO(port): in-place init — `named_pipe`/`task` capture `this` (self-referential), so
        // allocate uninit, derive the stable pointer, build the fields, then ptr::write the whole
        // struct. Avoids `mem::zeroed()` on non-POD AnyTask/WindowsNamedPipe.
        let this: *mut WindowsNamedPipeContext =
            Box::into_raw(Box::<core::mem::MaybeUninit<WindowsNamedPipeContext>>::new_uninit()).cast();

        // named_pipe owns the pipe (PipeWriter owns the pipe and will close and deinit it)
        // SAFETY: all-zero is a valid uv::Pipe (#[repr(C)] POD)
        let pipe = Box::into_raw(Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() }));
        let named_pipe = WindowsNamedPipe::from(
            pipe,
            uws::WindowsNamedPipeHandlers {
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
            },
            vm,
        );
        // TODO(port): jsc.AnyTask.New(T, callback).init(this) — typed task wrapper
        let task = AnyTask::new::<WindowsNamedPipeContext>(Self::run_event, this);

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

        // Arc<TLSSocket>/Arc<TCPSocket> already hold a strong ref by being stored in `socket`;
        // the Zig `tls.ref()` / `tcp.ref()` is implicit in Arc move-into-struct.

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
        let guard = scopeguard::guard(this, |this| {
            // SAFETY: `this` is live; create() returned it and no deref has fired yet
            let this_ref = unsafe { &mut *this };
            match &this_ref.socket {
                SocketType::Tls(tls) => {
                    let _ = tls.handle_connect_error(SystemErrno::ENOENT as i32);
                }
                SocketType::Tcp(tcp) => {
                    let _ = tcp.handle_connect_error(SystemErrno::ENOENT as i32);
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
        let guard = scopeguard::guard(this, |this| {
            // SAFETY: `this` is live; create() returned it and no deref has fired yet
            let this_ref = unsafe { &mut *this };
            match &this_ref.socket {
                SocketType::Tls(tls) => {
                    let _ = tls.handle_connect_error(SystemErrno::ENOENT as i32);
                }
                SocketType::Tcp(tcp) => {
                    let _ = tcp.handle_connect_error(SystemErrno::ENOENT as i32);
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
        // `socket` (Arc deref) and `named_pipe` drop automatically via field destructors;
        // declaration order above guarantees socket goes first (matches Zig deinit).
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/WindowsNamedPipeContext.zig (307 lines)
//   confidence: medium
//   todos:      4
//   notes:      intrusive refcount w/ deferred-task self-destroy + raw ctx ptr through uws callbacks; create() uses MaybeUninit+ptr::write for self-referential init; TLSSocket/TCPSocket Arc semantics need verification vs IntrusiveArc; &'static JSGlobalObject/VirtualMachine fields are JSC_BORROW
// ──────────────────────────────────────────────────────────────────────────
