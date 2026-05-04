//! Similar to `IOWriter` but for reading
//!
//! *NOTE* This type is reference counted, but deinitialization is queued onto
//! the event loop. This was done to prevent bugs.

use core::cell::Cell;
use core::ffi::c_void;
use core::mem::offset_of;

use bun_collections::TaggedPtrUnion;
use bun_io::{BufferedReader, ReadState};
use bun_jsc::{EventLoopHandle, EventLoopTask, SystemError};
use bun_ptr::IntrusiveRc;
use bun_sys::Fd;

use crate::interpreter::builtin::Cat;
use crate::{SmolList, Yield};

// TODO(port): `log` is `bun.shell.interpret.log` (an Output.scoped fn). Re-export
// the scope from `crate::interpret` once that module is ported; for now forward
// to scoped_log! with the SHELL scope.
macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(SHELL, $($arg)*) };
}

pub struct IOReader {
    pub fd: Fd,
    pub reader: ReaderImpl,
    pub buf: Vec<u8>,
    pub readers: Readers,
    pub read: usize,
    ref_count: Cell<u32>,
    pub err: Option<SystemError>,
    pub evtloop: EventLoopHandle,
    pub concurrent_task: EventLoopTask,
    pub async_deinit: AsyncDeinitReader,
    #[cfg(windows)]
    pub is_reading: bool,
    // on posix this was a `u0` (zero-sized); omit the field entirely
    pub started: bool,
}

// Intrusive refcount: `bun.ptr.RefCount(@This(), "ref_count", asyncDeinit, .{})`.
// `ref`/`deref` are provided by IntrusiveRc; the destructor hook is `async_deinit`.
// TODO(port): wire IntrusiveRc's drop hook to `IOReader::async_deinit` (the Zig
// RefCount called `asyncDeinit` instead of freeing directly).
pub type IOReaderRc = IntrusiveRc<IOReader>;

pub type ChildPtr = IOReaderChildPtr;
pub type ReaderImpl = BufferedReader;

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Default, Clone, Copy)]
    struct InitFlags: u8 {
        const POLLABLE    = 1 << 0;
        const NONBLOCKING = 1 << 1;
        const SOCKET      = 1 << 2;
        // remaining 5 bits unused
    }
}

impl IOReader {
    pub fn dupe_ref(&self) -> IntrusiveRc<IOReader> {
        self.ref_();
        // SAFETY: ref_count was just incremented; from_raw adopts that strong ref
        // without touching the count. `self` is a live heap allocation created by
        // `init` (Box::into_raw).
        unsafe { IntrusiveRc::from_raw(self as *const IOReader as *mut IOReader) }
    }

    pub fn memory_cost(&self) -> usize {
        let mut size: usize = core::mem::size_of::<IOReader>();
        size += self.buf.capacity();
        size += self.readers.memory_cost();
        size
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        self.evtloop
    }

    pub fn loop_(&self) -> *mut bun_aio::Loop {
        #[cfg(windows)]
        {
            self.evtloop.loop_().uv_loop
        }
        #[cfg(not(windows))]
        {
            self.evtloop.loop_()
        }
    }

    pub fn init(fd: Fd, evtloop: EventLoopHandle) -> IntrusiveRc<IOReader> {
        let this = Box::into_raw(Box::new(IOReader {
            ref_count: Cell::new(1),
            fd,
            reader: ReaderImpl::init::<IOReader>(),
            buf: Vec::new(),
            readers: Readers::default(),
            read: 0,
            err: None,
            evtloop,
            concurrent_task: EventLoopTask::from_event_loop(evtloop),
            async_deinit: AsyncDeinitReader::default(),
            #[cfg(windows)]
            is_reading: false,
            started: false,
        }));
        log!("IOReader(0x{:x}, fd={}) create", this as usize, fd);

        // SAFETY: `this` was just allocated via Box::into_raw and is non-null & unique.
        let this_ref = unsafe { &mut *this };

        #[cfg(unix)]
        {
            this_ref.reader.flags.close_handle = false;
        }

        #[cfg(windows)]
        {
            this_ref.reader.source = Some(bun_io::Source::File(bun_io::Source::open_file(fd)));
        }
        this_ref.reader.set_parent(this);

        // SAFETY: `this` came from Box::into_raw above with ref_count == 1; from_raw
        // adopts that initial strong ref. Raw `this` was only needed locally for
        // set_parent (FFI back-pointer).
        unsafe { IntrusiveRc::from_raw(this) }
    }

    /// Idempotent function to start the reading
    pub fn start(&mut self) -> Yield {
        self.started = true;
        #[cfg(unix)]
        {
            if self.reader.handle.is_closed() || !self.reader.handle.poll().is_registered() {
                if let Some(e) = self.reader.start(self.fd, true).as_err() {
                    self.on_reader_error(e);
                }
            }
            return Yield::Suspended;
        }

        #[cfg(windows)]
        {
            if self.is_reading {
                return Yield::Suspended;
            }
            self.is_reading = true;
            if let Some(e) = self.reader.start_with_current_pipe().as_err() {
                self.on_reader_error(e);
                return Yield::Failed;
            }
            Yield::Suspended
        }
    }

    /// Only does things on windows
    #[inline]
    pub fn set_reading(&mut self, reading: bool) {
        #[cfg(windows)]
        {
            log!(
                "IOReader(0x{:x}) setReading({})",
                self as *const _ as usize,
                reading
            );
            self.is_reading = reading;
        }
        #[cfg(not(windows))]
        {
            let _ = reading;
        }
    }

    pub fn add_reader(&mut self, reader_: impl Into<ChildPtr>) {
        let reader: ChildPtr = reader_.into();

        let slice = self.readers.slice();
        // SAFETY: ChildPtr is #[repr(transparent)] over a TaggedPtrUnion which is
        // #[repr(transparent)] over u64; on all supported targets usize == u64 so
        // reinterpreting the slice as &[usize] is layout-valid (matches the Zig
        // @ptrCast). // TODO(port): consider comparing TaggedPtr addresses directly
        // instead of the usize reinterpret.
        let usize_slice: &[usize] =
            unsafe { core::slice::from_raw_parts(slice.as_ptr().cast::<usize>(), slice.len()) };
        let ptr_usize: usize = reader.ptr.ptr() as usize;
        // Only add if it hasn't been added yet
        if !usize_slice.iter().any(|&v| v == ptr_usize) {
            self.readers.append(reader);
        }
    }

    pub fn remove_reader(&mut self, reader_: impl Into<ChildPtr>) {
        let reader: ChildPtr = reader_.into();
        let slice = self.readers.slice();
        // SAFETY: see add_reader.
        let usize_slice: &[usize] =
            unsafe { core::slice::from_raw_parts(slice.as_ptr().cast::<usize>(), slice.len()) };
        let ptr_usize: usize = reader.ptr.ptr() as usize;
        if let Some(idx) = usize_slice.iter().position(|&v| v == ptr_usize) {
            self.readers.swap_remove(idx);
        }
    }

    pub fn on_read_chunk(ptr: *mut c_void, chunk: &[u8], has_more: ReadState) -> bool {
        // SAFETY: `ptr` was set via `reader.set_parent(this)` in `init` and is a
        // live `*mut IOReader` for the duration of the BufferedReader callback.
        let this: &mut IOReader = unsafe { &mut *ptr.cast::<IOReader>() };
        log!(
            "IOReader(0x{:x}, fd={}) onReadChunk(chunk_len={}, has_more={})",
            this as *const _ as usize,
            this.fd,
            chunk.len(),
            <&'static str>::from(has_more)
        );
        this.set_reading(false);

        let mut i: usize = 0;
        while i < this.readers.len() {
            let r = this.readers.get(i);
            let mut remove = false;
            r.on_read_chunk(chunk, &mut remove).run();
            if remove {
                this.readers.swap_remove(i);
            } else {
                i += 1;
            }
        }

        let should_continue = has_more != ReadState::Eof;
        if should_continue {
            if this.readers.len() > 0 {
                this.set_reading(true);
                #[cfg(unix)]
                {
                    this.reader.register_poll();
                }
                #[cfg(not(unix))]
                {
                    match this.reader.start_with_current_pipe() {
                        bun_sys::Result::Err(e) => {
                            this.on_reader_error(e);
                            return false;
                        }
                        _ => {}
                    }
                }
            }
        }

        should_continue
    }

    pub fn on_reader_error(&mut self, err: bun_sys::Error) {
        log!(
            "IOReader(0x{:x}.onReaderError({}) ",
            self as *const _ as usize,
            err
        );
        self.set_reading(false);
        self.err = Some(err.to_shell_system_error());
        // PORT NOTE: reshaped for borrowck — clone err per-iteration instead of
        // taking `&mut self.err` while iterating `self.readers`.
        let len = self.readers.len();
        for i in 0..len {
            let r = self.readers.get(i);
            let e = self.err.as_mut().map(|e| {
                e.ref_();
                *e
            });
            r.on_reader_done(e).run();
        }
    }

    pub fn on_reader_done(&mut self) {
        log!("IOReader(0x{:x}) done", self as *const _ as usize);
        self.set_reading(false);
        let len = self.readers.len();
        for i in 0..len {
            let r = self.readers.get(i);
            let e = self.err.as_mut().map(|err| {
                err.ref_();
                *err
            });
            r.on_reader_done(e).run();
        }
    }

    fn async_deinit(&mut self) {
        log!("IOReader(0x{:x}) asyncDeinit", self as *const _ as usize);
        // The async hop guards against being deref'd from inside a read callback while
        // BufferedReader is still iterating. If we never started reading, no callback can be
        // in flight, so close synchronously to avoid holding the fd until the next tick.
        if !self.started {
            self.async_deinit_callback();
            return;
        }
        self.async_deinit.enqueue(); // calls `async_deinit_callback`
    }

    fn async_deinit_callback(&mut self) {
        if self.fd != Fd::INVALID {
            // windows reader closes the file descriptor
            #[cfg(windows)]
            {
                if self.reader.source.is_some() && !self.reader.source.as_ref().unwrap().is_closed()
                {
                    self.reader.close_impl(false);
                }
            }
            #[cfg(not(windows))]
            {
                // We set reader.flags.close_handle=false in init(), so reader.deinit() will not
                // return the FilePoll to its pool. Do it explicitly (without closing the fd —
                // we own that and close it ourselves below).
                if self.reader.handle.is_poll() {
                    self.reader.handle.close_impl(None, (), false);
                }
                log!(
                    "IOReader(0x{:x}) __deinit fd={}",
                    self as *const _ as usize,
                    self.fd
                );
                self.fd.close();
            }
        }
        if let Some(e) = self.err.as_mut() {
            e.deref();
        }
        // self.readers / self.buf are dropped by Box::from_raw below.
        self.reader.disable_keeping_process_alive(());
        // TODO(port): BufferedReader teardown — Zig called `this.reader.deinit()`
        // explicitly; in Rust this should be Drop on ReaderImpl, but it lives
        // inline in `self` so it will run when the Box is dropped.
        // SAFETY: `self` was allocated via Box::into_raw in `init`; refcount has
        // reached zero so we are the sole owner.
        unsafe {
            drop(Box::from_raw(self as *mut IOReader));
        }
    }

    // Intrusive refcount helpers (mirrors `pub const ref = RefCount.ref;` etc.)
    #[inline]
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    #[inline]
    pub fn deref(&mut self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            self.async_deinit();
        }
    }
}

pub struct Reader {
    pub ptr: ChildPtr,
}

pub type Readers = SmolList<ChildPtr, 4>;

#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct IOReaderChildPtr {
    pub ptr: ChildPtrRaw,
}

pub type ChildPtrRaw = TaggedPtrUnion<(Cat,)>;

impl IOReaderChildPtr {
    pub fn init<P>(p: *mut P) -> IOReaderChildPtr
    where
        ChildPtrRaw: From<*mut P>,
    {
        IOReaderChildPtr {
            ptr: ChildPtrRaw::from(p),
            // .ptr = @ptrCast(p),
        }
    }

    pub fn memory_cost(self) -> usize {
        if self.ptr.is::<Cat>() {
            // TODO:
            return core::mem::size_of::<Cat>();
        }
        0
    }

    /// Return true if the child should be deleted
    pub fn on_read_chunk(self, chunk: &[u8], remove: &mut bool) -> Yield {
        // TODO(port): TaggedPtrUnion dynamic dispatch — Zig used
        // `this.ptr.call("onIOReaderChunk", .{chunk, remove}, Yield)` which
        // reflects over the union members. With a single variant, dispatch
        // directly; revisit when more variants are added.
        // SAFETY: ptr was constructed from a live *mut Cat via init().
        let cat = unsafe { &mut *self.ptr.get::<Cat>() };
        cat.on_io_reader_chunk(chunk, remove)
    }

    pub fn on_reader_done(self, err: Option<SystemError>) -> Yield {
        // TODO(port): see on_read_chunk re: TaggedPtrUnion dispatch.
        // SAFETY: ptr was constructed from a live *mut Cat via init().
        let cat = unsafe { &mut *self.ptr.get::<Cat>() };
        cat.on_io_reader_done(err)
    }
}

// Reflexive `From<ChildPtr> for ChildPtr` is provided by std's blanket impl,
// covering the `ChildPtr => reader_` arm of add_reader/remove_reader.
// TODO(port): blanket `impl<P> From<*mut P> for IOReaderChildPtr` once
// TaggedPtrUnion's tag-registration trait is available; covers the
// `else => ChildPtr.init(reader_)` arm of add_reader/remove_reader.

#[derive(Default)]
pub struct AsyncDeinitReader {
    pub ran: bool,
}

impl AsyncDeinitReader {
    pub fn enqueue(&mut self) {
        if self.ran {
            return;
        }
        self.ran = true;

        let ioreader = self.reader();
        match &ioreader.evtloop {
            EventLoopHandle::Js(js) => {
                js.enqueue_task_concurrent(
                    ioreader
                        .concurrent_task
                        .js()
                        .from(self as *mut _, bun_jsc::TaskDeinit::Manual),
                );
            }
            EventLoopHandle::Mini(mini) => {
                mini.enqueue_task_concurrent(
                    ioreader
                        .concurrent_task
                        .mini()
                        .from(self as *mut _, "runFromMainThreadMini"),
                );
            }
        }
    }

    pub fn reader(&mut self) -> &mut IOReader {
        // SAFETY: self points to IOReader.async_deinit; recover the parent via offset_of.
        unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(offset_of!(IOReader, async_deinit))
                .cast::<IOReader>()
        }
    }

    pub fn run_from_main_thread(&mut self) {
        // SAFETY: self points to IOReader.async_deinit; recover the parent via offset_of.
        let ioreader: &mut IOReader = unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(offset_of!(IOReader, async_deinit))
                .cast::<IOReader>()
        };
        ioreader.async_deinit_callback();
    }

    pub fn run_from_main_thread_mini(&mut self, _: &mut ()) {
        self.run_from_main_thread();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/IOReader.zig (311 lines)
//   confidence: medium
//   todos:      6
//   notes:      IntrusiveRc drop-hook → async_deinit wiring (init/dupe_ref now return IntrusiveRc; from_raw adopts existing count); TaggedPtrUnion .call() dispatch hand-expanded for single Cat variant; EventLoopHandle/EventLoopTask enum shapes assumed.
// ──────────────────────────────────────────────────────────────────────────
