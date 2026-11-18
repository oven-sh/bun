//! The Windows counterpart of `packages/bun-usockets/src/eventing/epoll_kqueue.c`.

use core::cell::Cell;
use core::ffi::{c_int, c_long, c_uint, c_void};
use core::ptr::{self, NonNull};
use std::rc::Rc;

use bun_alloc::default_alloc;
use bun_core::{Timespec, TimespecMockMode};
use bun_iocp::{Event, Port, Readiness, SocketWatch, Waker, Watcher};
use bun_ptr::CellExt as _;

use crate::loop_::LoopCb;
use crate::{LIBUS_SOCKET_DESCRIPTOR, Loop};

const READABLE: c_int = 1;
const WRITABLE: c_int = 2;

const POLL_TYPE_SOCKET: u8 = 0;
const POLL_TYPE_SOCKET_SHUT_DOWN: u8 = 1;
const POLL_TYPE_SEMI_SOCKET: u8 = 2;
const POLL_TYPE_POLLING_OUT: u8 = 8;
const POLL_TYPE_POLLING_IN: u8 = 16;
const POLL_TYPE_KIND_MASK: u8 = 0b111;

/// `us_poll_t`
#[repr(C, align(16))]
struct Poll {
    watch: Cell<Option<SocketWatch>>,
    fd: Cell<LIBUS_SOCKET_DESCRIPTOR>,
    poll_type: Cell<u8>,
    /// Since `poll_type` last changed.
    is_eof_reported: Cell<bool>,
}

const _: () = assert!(size_of::<Poll>() == 32);

/// `us_internal_async`
struct Async {
    waker: Waker,
    callback: Cell<Option<LoopCb>>,
}

/// `struct timespec`
#[repr(C)]
struct CTimespec {
    sec: i64,
    nsec: c_long,
}

unsafe extern "C" {
    fn us_internal_loop_data_init(
        loop_: *mut Loop,
        wakeup_cb: Option<LoopCb>,
        pre_cb: Option<LoopCb>,
        post_cb: Option<LoopCb>,
    ) -> c_int;
    fn us_internal_loop_data_free(loop_: *mut Loop);
    fn us_internal_dispatch_ready_poll(p: *mut c_void, error: c_int, eof: c_int, events: c_int);
    safe fn _set_errno(value: c_int) -> c_int;
}

fn allocate<T>(ext_size: c_uint) -> *mut T {
    let block = default_alloc::malloc(size_of::<T>() + ext_size as usize);
    if block.is_null() {
        bun_core::out_of_memory();
    }
    block.cast()
}

impl Loop {
    pub fn port(&self) -> &Rc<Port> {
        // SAFETY: the box that `us_create_loop` made, which is freed with the loop.
        unsafe { &*self.port.get().cast() }
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn us_create_loop(
    wakeup_cb: Option<LoopCb>,
    pre_cb: Option<LoopCb>,
    post_cb: Option<LoopCb>,
    ext_size: c_uint,
) -> *mut Loop {
    let Ok(port) = Port::new() else {
        return ptr::null_mut();
    };
    let loop_ = allocate::<Loop>(ext_size);
    // SAFETY: a new block of that size. Zeroes are what `us_internal_loop_data_init` expects, which only fails where `us_internal_create_async` can.
    unsafe {
        loop_
            .cast::<u8>()
            .write_bytes(0, size_of::<Loop>() + ext_size as usize);
        (*loop_)
            .port
            .set(bun_core::heap::into_raw(Box::new(port)).cast());
        us_internal_loop_data_init(loop_, wakeup_cb, pre_cb, post_cb);
    }
    loop_
}

#[unsafe(no_mangle)]
unsafe extern "C" fn us_loop_free(loop_: *mut Loop) {
    // SAFETY: from `us_create_loop`, and not used again.
    unsafe {
        (*loop_).port().shut_down();
        us_internal_loop_data_free(loop_);
        bun_core::heap::destroy((*loop_).port.get().cast::<Rc<Port>>());
        default_alloc::free(loop_.cast());
    }
}

#[unsafe(no_mangle)]
extern "C" fn us_internal_monotonic_ns() -> u64 {
    Timespec::now(TimespecMockMode::ForceRealTime).ns()
}

#[unsafe(no_mangle)]
extern "C" fn us_internal_loop_has_polls(loop_: &Loop) -> c_int {
    (loop_.poll_count() != 0).into()
}

#[unsafe(no_mangle)]
extern "C" fn us_internal_loop_prepare_wait(loop_: &Loop) -> c_int {
    loop_.port().prepare().into()
}

#[unsafe(no_mangle)]
extern "C" fn us_internal_loop_wait(loop_: &Loop, timeout: Option<&CTimespec>, _will_idle: c_int) {
    let timeout_ns = timeout.map(|timeout| {
        let (sec, nsec) = (timeout.sec, timeout.nsec.into());
        if sec < 0 {
            0
        } else {
            Timespec { sec, nsec }.ns()
        }
    });
    if loop_.has_sent.take() != 0 {
        loop_.port().did_send();
    }
    let ready = loop_.port().wait(timeout_ns);
    loop_.num_ready_polls.set(ready as c_int);
}

#[unsafe(no_mangle)]
unsafe extern "C" fn us_internal_loop_dispatch(loop_: *mut Loop) {
    // SAFETY: the loop that is ticking, which outlasts its tick.
    let (port, wakeup) = unsafe {
        let wakeup = (*loop_).internal_loop_data.wakeup_async.get();
        ((*loop_).port(), &*wakeup.cast::<Async>())
    };
    port.dispatch(|event| match event {
        Event::Wake => {
            if let Some(callback) = wakeup.callback.get() {
                // SAFETY: the `wakeup_cb` of this loop.
                unsafe { callback(loop_) };
            }
        }
        Event::Socket(poll, ready) => {
            // SAFETY: the watch is dropped before the poll that it names is freed.
            let this = unsafe { poll.cast::<Poll>().as_ref() };
            if ready.contains(Readiness::RECEIVE) && this.is_connected_stream() {
                port.did_receive();
            }
            let (error, eof, events) = this.translate(ready);
            // SAFETY: as above.
            unsafe { us_internal_dispatch_ready_poll(poll.as_ptr(), error, eof, events) };
        }
    });
}

#[unsafe(no_mangle)]
extern "C" fn us_internal_create_async(
    loop_: &Loop,
    _fallthrough: c_int,
    _ext_size: c_uint,
) -> *mut Async {
    bun_core::heap::into_raw(Box::new(Async {
        waker: loop_.port().waker(),
        callback: Cell::new(None),
    }))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn us_internal_async_close(a: *mut Async) {
    // SAFETY: from `us_internal_create_async`, and not used again.
    unsafe { bun_core::heap::destroy(a) };
}

#[unsafe(no_mangle)]
extern "C" fn us_internal_async_set(a: &Async, callback: Option<LoopCb>) {
    a.callback.set(callback);
}

#[unsafe(no_mangle)]
unsafe extern "C" fn us_internal_async_wakeup(a: *const Async) {
    // SAFETY: the loop is live. This runs on any thread, and borrows only what is `Sync`.
    unsafe { &(*a).waker }.wake();
}

impl Poll {
    fn kind(&self) -> u8 {
        self.poll_type.get() & POLL_TYPE_KIND_MASK
    }

    fn events(&self) -> c_int {
        let poll_type = self.poll_type.get();
        let readable = poll_type & POLL_TYPE_POLLING_IN != 0;
        let writable = poll_type & POLL_TYPE_POLLING_OUT != 0;
        (if readable { READABLE } else { 0 }) | (if writable { WRITABLE } else { 0 })
    }

    fn set_type(&self, kind: u8, events: c_int) {
        let readable = if events & READABLE != 0 {
            POLL_TYPE_POLLING_IN
        } else {
            0
        };
        let writable = if events & WRITABLE != 0 {
            POLL_TYPE_POLLING_OUT
        } else {
            0
        };
        self.poll_type.set(kind | readable | writable);
        self.is_eof_reported.set(false);
        self.update_interest();
    }

    /// The dispatch of an error closes these.
    fn is_connected_stream(&self) -> bool {
        matches!(self.kind(), POLL_TYPE_SOCKET | POLL_TYPE_SOCKET_SHUT_DOWN)
    }

    fn update_interest(&self) {
        let mut interest = Readiness::empty();
        if self.events() & READABLE != 0 {
            interest |= Readiness::RECEIVE | Readiness::ACCEPT | Readiness::DISCONNECT;
        }
        if self.events() & WRITABLE != 0 {
            interest |= Readiness::SEND | Readiness::CONNECT_FAIL;
        }
        if self.events() != 0 || self.is_connected_stream() {
            interest |= Readiness::ABORT;
        }
        if self.kind() == POLL_TYPE_SOCKET_SHUT_DOWN && !self.is_eof_reported.get() {
            interest |= Readiness::DISCONNECT;
        }
        self.watch.with_taken(|watch| {
            if let Some(watch) = watch {
                watch.set_interest(interest);
            }
        });
    }

    /// The `error`, `eof` and `events` of `us_internal_dispatch_ready_poll`.
    fn translate(&self, ready: Readiness) -> (c_int, c_int, c_int) {
        let is_stream = self.is_connected_stream() || self.kind() == POLL_TYPE_SEMI_SOCKET;
        let error = ready.intersects(Readiness::WATCH_FAILED | Readiness::CONNECT_FAIL)
            || (ready.contains(Readiness::ABORT) && is_stream);
        // Data can still be on its way, so the end of any other socket is for `recv` to find.
        let eof =
            ready.contains(Readiness::DISCONNECT) && self.kind() == POLL_TYPE_SOCKET_SHUT_DOWN;
        if eof && !self.is_eof_reported.replace(true) {
            self.update_interest();
        }
        let mut events = 0;
        if ready.intersects(
            Readiness::RECEIVE | Readiness::ACCEPT | Readiness::DISCONNECT | Readiness::ABORT,
        ) {
            events |= READABLE;
        }
        if ready.intersects(Readiness::SEND | Readiness::CONNECT_FAIL) {
            events |= WRITABLE;
        }
        (error.into(), eof.into(), events & self.events())
    }
}

#[unsafe(no_mangle)]
extern "C" fn us_create_poll(loop_: &Loop, fallthrough: c_int, ext_size: c_uint) -> *mut Poll {
    if fallthrough == 0 {
        loop_.num_polls.update(|count| count + 1);
    }
    let p = allocate::<Poll>(ext_size);
    // SAFETY: a new block that has room for it.
    unsafe {
        p.write(Poll {
            watch: Cell::new(None),
            fd: Cell::new(0),
            poll_type: Cell::new(0),
            is_eof_reported: Cell::new(false),
        });
    }
    p
}

#[unsafe(no_mangle)]
unsafe extern "C" fn us_poll_free(p: *mut Poll, loop_: &Loop) {
    loop_.num_polls.update(|count| count - 1);
    // SAFETY: from `us_create_poll` or `us_poll_resize`, and not used again.
    unsafe {
        p.drop_in_place();
        default_alloc::free(p.cast());
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn us_poll_resize(
    p: *mut Poll,
    loop_: &Loop,
    old_ext_size: c_uint,
    ext_size: c_uint,
) -> *mut Poll {
    if ext_size <= old_ext_size {
        return p;
    }
    // The old one is freed with `us_poll_free`.
    loop_.num_polls.update(|count| count + 1);
    let resized = allocate::<Poll>(ext_size);
    let (old_size, size) = (
        size_of::<Poll>() + old_ext_size as usize,
        size_of::<Poll>() + ext_size as usize,
    );
    // SAFETY: the blocks have those sizes. The watch is out of `p` before the copy, so it has one owner.
    unsafe {
        let watch = (*p).watch.take();
        resized
            .cast::<u8>()
            .copy_from_nonoverlapping(p.cast(), old_size);
        resized
            .byte_add(old_size)
            .cast::<u8>()
            .write_bytes(0, size - old_size);
        if let Some(watch) = &watch {
            watch.set_address(NonNull::new_unchecked(resized).cast());
        }
        (*resized).watch.set(watch);
    }
    resized
}

#[unsafe(no_mangle)]
extern "C" fn us_poll_init(p: &Poll, fd: LIBUS_SOCKET_DESCRIPTOR, poll_type: c_int) {
    p.fd.set(fd);
    p.poll_type.set(poll_type as u8);
}

#[unsafe(no_mangle)]
extern "C" fn us_poll_events(p: &Poll) -> c_int {
    p.events()
}

#[unsafe(no_mangle)]
extern "C" fn us_poll_fd(p: &Poll) -> LIBUS_SOCKET_DESCRIPTOR {
    p.fd.get()
}

#[unsafe(no_mangle)]
extern "C" fn us_internal_poll_type(p: &Poll) -> c_int {
    p.kind().into()
}

#[unsafe(no_mangle)]
extern "C" fn us_internal_poll_set_type(p: &Poll, kind: c_int) {
    p.set_type(kind as u8, p.events());
}

#[unsafe(no_mangle)]
unsafe extern "C" fn us_poll_start_rc(p: NonNull<Poll>, loop_: &Loop, events: c_int) -> c_int {
    // SAFETY: a live poll.
    let poll = unsafe { p.as_ref() };

    #[cfg(socket_fault_injection)]
    {
        use crate::fault_inject::{POLL_START, us_fault_hit};
        let (fd, mut injected, mut unused) = (poll.fd.get() as c_int, 0, 0);
        // SAFETY: two out-params.
        if unsafe { us_fault_hit(POLL_START, fd, &raw mut injected, &raw mut unused) } != 0 {
            return injected as c_int;
        }
    }

    match SocketWatch::new(loop_.port(), poll.fd.get(), Watcher::Foreign(p.cast())) {
        Ok(watch) => {
            poll.watch.set(Some(watch));
            poll.set_type(poll.kind(), events);
            0
        }
        Err(err) => {
            // Callers read either.
            _set_errno(err.0.into());
            bun_windows_sys::kernel32::SetLastError(err.0.into());
            -1
        }
    }
}

#[unsafe(no_mangle)]
extern "C" fn us_poll_change(p: &Poll, _loop: &Loop, events: c_int) -> c_int {
    if p.events() != events {
        p.set_type(p.kind(), events);
    }
    0
}

#[unsafe(no_mangle)]
extern "C" fn us_poll_stop(p: &Poll, _loop: &Loop) {
    p.watch.take();
}

#[unsafe(no_mangle)]
extern "C" fn bsd_winsock_ensure() {
    bun_windows_sys::ws2_32::ensure_started();
}
