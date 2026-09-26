//! What `bun_runtime` gives the crates below it.
//!
//! bun's crates for the event loop, for sockets, for pipes and for child processes call back into the
//! crate at the top, `bun_runtime`, through symbols that the linker resolves: that is how a crate at the
//! bottom reaches the owner of a socket or of a poll without naming it. `bun_runtime` is bun's JavaScript
//! runtime and is not part of this program, so the program answers those symbols for the owners it has.
//! Each function here is the one of `bun_runtime` for the cases this program has, and says which.

use core::ffi::{c_char, c_int, c_void};

use bun_uws_sys::socket_group::VTable;
use bun_uws_sys::{ConnectingSocket, SocketKind, us_bun_verify_error_t, us_socket_t};

#[cfg(not(windows))]
use bun_io::pipe_writer::PosixPipeWriter as _;

// ---- src/runtime/socket/uws_dispatch.rs: socket events, for sockets whose group has the table ----

#[inline]
fn table_of_socket(s: *mut us_socket_t) -> &'static VTable {
    let s = us_socket_t::opaque_mut(s);
    match s.kind() {
        SocketKind::Dynamic => s.raw_group().vtable.expect("group vtable"),
        kind => panic!(
            "a socket of kind {} in a program without bun's runtime",
            kind as u8
        ),
    }
}

#[inline]
fn table_of_connecting_socket(c: *mut ConnectingSocket) -> &'static VTable {
    let c = ConnectingSocket::opaque_mut(c);
    match c.kind() {
        // SAFETY: the group of a socket with a kind is there.
        SocketKind::Dynamic => unsafe { (*c.raw_group()).vtable.expect("group vtable") },
        kind => panic!(
            "a socket of kind {} in a program without bun's runtime",
            kind as u8
        ),
    }
}

macro_rules! us_dispatch_shims {
    ($(
        fn $name:ident($recv:ident: *mut $Recv:ty $(, $a:ident: $t:ty)* $(,)?) -> $ret:ty
            = $lookup:ident.$field:ident($($call:expr),* $(,)?) or $default:expr;
    )*) => {$(
        /// # Safety
        /// `loop.c` passes a live socket, and a buffer that is valid for the call.
        #[unsafe(no_mangle)]
        #[allow(clippy::unused_unit)]
        pub unsafe extern "C" fn $name($recv: *mut $Recv $(, $a: $t)*) -> $ret {
            match $lookup($recv).$field {
                // SAFETY: the entry of the table of this socket, with what `loop.c` passed.
                Some(f) => unsafe { f($($call),*) },
                None => $default,
            }
        }
    )*};
}

us_dispatch_shims! {
    fn us_dispatch_open(s: *mut us_socket_t, is_client: c_int, ip: *mut u8, ip_len: c_int) -> *mut us_socket_t
        = table_of_socket.on_open(s, is_client, ip, ip_len) or s;
    fn us_dispatch_data(s: *mut us_socket_t, data: *mut u8, len: c_int) -> *mut us_socket_t
        = table_of_socket.on_data(s, data, len) or s;
    fn us_dispatch_fd(s: *mut us_socket_t, fd: c_int) -> *mut us_socket_t
        = table_of_socket.on_fd(s, fd) or s;
    fn us_dispatch_writable(s: *mut us_socket_t) -> *mut us_socket_t
        = table_of_socket.on_writable(s) or s;
    fn us_dispatch_close(s: *mut us_socket_t, code: c_int, reason: *mut c_void) -> *mut us_socket_t
        = table_of_socket.on_close(s, code, reason) or s;
    fn us_dispatch_timeout(s: *mut us_socket_t) -> *mut us_socket_t
        = table_of_socket.on_timeout(s) or s;
    fn us_dispatch_long_timeout(s: *mut us_socket_t) -> *mut us_socket_t
        = table_of_socket.on_long_timeout(s) or s;
    fn us_dispatch_end(s: *mut us_socket_t) -> *mut us_socket_t
        = table_of_socket.on_end(s) or s;
    fn us_dispatch_connect_error(s: *mut us_socket_t, code: c_int) -> *mut us_socket_t
        = table_of_socket.on_connect_error(s, code) or s;
    fn us_dispatch_connecting_error(c: *mut ConnectingSocket, code: c_int) -> *mut ConnectingSocket
        = table_of_connecting_socket.on_connecting_error(c, code) or c;
    fn us_dispatch_handshake(s: *mut us_socket_t, ok: c_int, err: us_bun_verify_error_t) -> ()
        = table_of_socket.on_handshake(s, ok, err, core::ptr::null_mut()) or ();
}

// ---- src/uws_sys/libuwsockets.cpp: the loop of a thread ----
//
// bun's Rust asks the C wrapper of uWebSockets for the loop of the thread. uWebSockets is bun's HTTP
// server, in C++, and is not part of this program; what it does for the loop is one call of uSockets.

unsafe extern "C" {
    fn us_create_loop(
        hint: *mut c_void,
        wakeup: Option<unsafe extern "C" fn(*mut bun_uws_sys::Loop)>,
        pre: Option<unsafe extern "C" fn(*mut bun_uws_sys::Loop)>,
        post: Option<unsafe extern "C" fn(*mut bun_uws_sys::Loop)>,
        ext_size: core::ffi::c_uint,
    ) -> *mut bun_uws_sys::Loop;
}

unsafe extern "C" fn nothing_to_do(_: *mut bun_uws_sys::Loop) {}

thread_local! {
    static LOOP_OF_THIS_THREAD: core::cell::Cell<*mut bun_uws_sys::Loop> = const { core::cell::Cell::new(core::ptr::null_mut()) };
}

/// `native`: the loop of libuv that uSockets runs on, on Windows. Null: uSockets makes what it needs.
fn loop_of_this_thread(native: *mut c_void) -> *mut bun_uws_sys::Loop {
    LOOP_OF_THIS_THREAD.with(|slot| {
        if slot.get().is_null() {
            // SAFETY: the callbacks are functions of this program, and uSockets takes a null hint.
            let created = unsafe {
                us_create_loop(
                    native,
                    Some(nothing_to_do),
                    Some(nothing_to_do),
                    Some(nothing_to_do),
                    0,
                )
            };
            assert!(!created.is_null(), "failed to create the event loop");
            slot.set(created);
        }
        slot.get()
    })
}

#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub extern "C" fn uws_get_loop() -> *mut bun_uws_sys::Loop {
    loop_of_this_thread(core::ptr::null_mut())
}

#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn uws_get_loop_with_native(native: *mut c_void) -> *mut bun_uws_sys::Loop {
    loop_of_this_thread(native)
}

// ---- src/runtime/socket/SocketAddress.rs: a host that is a number is not looked up ----

/// Fills `out` with `host`:`port` when `host` is numeric and returns 1, or 0 when it is a name.
///
/// # Safety
/// `host` is NUL-terminated and `out` is writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__parseIpAddress(
    host: *const c_char,
    port: u16,
    out: *mut bun_sys::posix::sockaddr_storage,
) -> c_int {
    if host.is_null() || out.is_null() {
        return 0;
    }
    // SAFETY: the contract of the function.
    let bytes = unsafe { core::ffi::CStr::from_ptr(host) }.to_bytes();
    let Some(ip) = bun_core::ip_address::to_ip_address(bytes) else {
        return 0;
    };
    let addr = bun_sys::net::Address::from_ip(ip, port);
    // SAFETY: the contract of the function.
    unsafe { *out = addr.into_storage() };
    1
}

// ---- src/runtime/timer/DateHeaderTimer.rs ----

/// uSockets asks for the timer of the `Date` header of `Bun.serve` when the first socket is there.
/// `bun_runtime` starts it when the thread has a JavaScript VM, and this program has none.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__internal_ensureDateHeaderTimerIsEnabled(_loop: *mut bun_uws_sys::Loop) {}

// ---- src/runtime/bin_entry/c_abi_exports.rs ----

#[unsafe(no_mangle)]
pub extern "C" fn Bun__outOfMemory() -> ! {
    bun_core::out_of_memory()
}

// ---- src/runtime/jsc_hooks.rs: the loop that a poll or a pipe of this thread belongs to ----

/// The loop of `bun install` is the only one here: the other is the loop of a JavaScript VM.
#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub fn __bun_get_vm_ctx(kind: bun_io::AllocatorType) -> bun_io::EventLoopCtx {
    match kind {
        bun_io::AllocatorType::Js => {
            panic!("the loop of a JavaScript VM in a program without bun's runtime")
        }
        bun_io::AllocatorType::Mini => {
            let mini = bun_event_loop::MiniEventLoop::GLOBAL.with(|global| global.get());
            // SAFETY: `Loop::get` made the loop before anything asks for it, and it lives as long
            // as the process.
            bun_event_loop::MiniEventLoop::MiniEventLoop::as_event_loop_ctx(unsafe { &mut *mini })
        }
    }
}

// ---- src/runtime/dispatch.rs: a file descriptor is ready, for the owners this program has ----

/// # Safety
/// `poll` is live for the call.
#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub unsafe fn __bun_run_file_poll(poll: *mut bun_io::FilePoll, size_or_offset: i64) {
    use bun_io::posix_event_loop::poll_tag;
    // SAFETY: the contract of the function.
    let poll_ref = unsafe { &mut *poll };
    let owner = poll_ref.owner;
    let hup = poll_ref.flags.contains(bun_io::FilePollFlag::Hup);
    match owner.tag() {
        poll_tag::BUFFERED_READER => {
            let reader = owner.ptr.cast::<bun_io::BufferedReader>();
            // SAFETY: the tag was set with this type. The reader is passed as a pointer because its
            // callbacks may come back to it.
            unsafe { bun_io::BufferedReader::on_poll(reader, size_or_offset as isize, hup) }
        }
        poll_tag::PROCESS => {
            let process = owner.ptr.cast::<bun_spawn::Process>();
            // SAFETY: `process` carries the reference that was taken when the poll was made.
            unsafe { bun_spawn::Process::on_wait_pid_from_event_loop_task(process) };
        }
        poll_tag::STATIC_PIPE_WRITER => {
            let writer = owner
                .ptr
                .cast::<bun_spawn::static_pipe_writer::Poll<crate::child::Child>>();
            // SAFETY: the tag was set with this type, and the writer is this dispatch's alone.
            unsafe { (*writer).on_poll(size_or_offset as isize, hup) };
        }
        poll_tag::NULL => {}
        _ => panic!("a poll of an owner that this program does not have"),
    }
}
