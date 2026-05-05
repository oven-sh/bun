//! Abstraction to allow multiple writers that can write to a file descriptor.
//!
//! This exists because kqueue/epoll does not work when registering multiple
//! poll events on the same file descriptor.
//!
//! One way to get around this limitation is to just call `.dup()` on the file
//! descriptor, which we do for the top-level stdin/stdout/stderr. But calling
//! `.dup()` for every concurrent writer is expensive.
//!
//! So `IOWriter` is essentially a writer queue to a file descriptor.
//!
//! We also make `*IOWriter` reference counted, this simplifies management of
//! the file descriptor.

use core::cell::Cell;
use core::ffi::c_void;
use core::fmt;
use core::mem::offset_of;

use bun_collections::{BabyList as ByteList, TaggedPtrUnion};
use bun_core::MovableIfWindowsFd;
use bun_io::{BufferedWriter, WriteResult, WriteStatus};
use bun_jsc::{EventLoopHandle, EventLoopTask, SystemError};
use bun_output::{declare_scope, scoped_log};
use bun_ptr::IntrusiveRc;
use crate::shell::{subproc, Interpreter, SmolList, Yield};
use bun_sys::{self, Fd};

declare_scope!(IOWriter, hidden);

// TODO(port): `bun.ptr.RefCount(@This(), "ref_count", asyncDeinit, .{})` — intrusive
// single-thread refcount whose drop-to-zero callback is `async_deinit`. Model as
// `IntrusiveRc<IOWriter>` over the `ref_count: Cell<u32>` field; `deref()` calls
// `async_deinit()` instead of dropping in place.
pub type RefCount = IntrusiveRc<IOWriter>;

/// `bun.io.BufferedWriter(IOWriter, struct { onWrite, onError, onClose, getBuffer, onWritable=null })`
// TODO(port): Zig passes a comptime vtable struct of callback decls. In Rust the
// `BufferedWriter<Parent>` impl should locate callbacks via a trait that `IOWriter`
// implements (`on_write_pollable`, `on_error`, `on_close`, `get_buffer`). Phase B wires the
// trait; here we name the type and assume the trait impl exists below.
pub type WriterImpl = BufferedWriter<IOWriter>;
pub type Poll = WriterImpl;

pub type ChildPtr = IOWriterChildPtr;

/// ~128kb
/// We shrunk the `buf` when we reach the last writer,
/// but if this never happens, we shrink `buf` when it exceeds this threshold
const SHRINK_THRESHOLD: usize = 1024 * 128;

#[allow(dead_code)]
struct CallstackChild {
    child: ChildPtr,
    completed: bool,
}

impl Default for CallstackChild {
    fn default() -> Self {
        Self { child: ChildPtr { ptr: ChildPtrRaw::NULL }, completed: false }
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    #[repr(transparent)]
    pub struct Flags: u8 {
        const POLLABLE     = 1 << 0;
        const NONBLOCKING  = 1 << 1;
        const IS_SOCKET    = 1 << 2;
        const BROKEN_PIPE  = 1 << 3;
        // __unused: u4 = 0
    }
}

impl Flags {
    #[inline] pub fn pollable(&self) -> bool { self.contains(Self::POLLABLE) }
    #[inline] pub fn set_pollable(&mut self, v: bool) { self.set(Self::POLLABLE, v) }
    #[inline] pub fn nonblocking(&self) -> bool { self.contains(Self::NONBLOCKING) }
    #[inline] pub fn set_nonblocking(&mut self, v: bool) { self.set(Self::NONBLOCKING, v) }
    #[inline] pub fn is_socket(&self) -> bool { self.contains(Self::IS_SOCKET) }
    #[inline] pub fn set_is_socket(&mut self, v: bool) { self.set(Self::IS_SOCKET, v) }
    #[inline] pub fn broken_pipe(&self) -> bool { self.contains(Self::BROKEN_PIPE) }
    #[inline] pub fn set_broken_pipe(&mut self, v: bool) { self.set(Self::BROKEN_PIPE, v) }
}

pub struct IOWriter {
    ref_count: Cell<u32>,
    pub writer: WriterImpl,
    pub fd: MovableIfWindowsFd,
    pub writers: Writers,
    pub buf: Vec<u8>,
    /// quick hack to get windows working
    /// ideally this should be removed
    #[cfg(windows)]
    pub winbuf: Vec<u8>,
    #[cfg(not(windows))]
    pub winbuf: (), // u0 in Zig
    pub writer_idx: usize,
    pub total_bytes_written: usize,
    pub err: Option<SystemError>,
    pub evtloop: EventLoopHandle,
    pub concurrent_task: EventLoopTask,
    pub concurrent_task2: EventLoopTask,
    pub is_writing: bool,
    pub async_deinit: AsyncDeinitWriter,
    pub started: bool,
    pub flags: Flags,
}

// pub fn __on_close(_: *IOWriter) void {}
// pub fn __flush(_: *IOWriter) void {}

pub struct Writer<'a> {
    pub ptr: ChildPtr,
    pub len: usize,
    pub written: usize,
    // LIFETIMES.tsv: BORROW_PARAM — set from enqueue() param; deinit never frees it.
    // TODO(port): lifetime `'a` propagates into `Writers`/`IOWriter`; Phase B may need to
    // store this as `Option<NonNull<ByteList>>` if the borrow outlives the enqueue frame.
    pub bytelist: Option<&'a mut ByteList<u8>>,
}

impl<'a> fmt::Display for Writer<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Writer(0x{:x}, {})",
            self.ptr.ptr.repr_ptr(),
            <&'static str>::from(self.ptr.ptr.tag()),
        )
    }
}

impl<'a> Writer<'a> {
    pub fn wrote_everything(&self) -> bool {
        self.written >= self.len
    }

    pub fn raw_ptr(&self) -> Option<*mut c_void> {
        self.ptr.ptr.ptr()
    }

    pub fn is_dead(&self) -> bool {
        self.ptr.ptr.is_null()
    }

    pub fn set_dead(&mut self) {
        scoped_log!(
            IOWriter,
            "Writer setDead {}(0x{:x})",
            <&'static str>::from(self.ptr.ptr.tag()),
            self.ptr.ptr.repr_ptr()
        );
        self.ptr.ptr = ChildPtrRaw::NULL;
    }
}

// TODO(port): `'static` is a placeholder; see note on `Writer::bytelist`.
pub type Writers = SmolList<Writer<'static>, 2>;

/// Return type of `IOWriter::write` (was an anonymous Zig enum literal).
enum WriteOutcome {
    Suspended,
    Failed,
    IsActuallyFile,
}

impl IOWriter {
    // RefCount glue (intrusive). `deref` reaching zero calls `async_deinit`.
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }
    pub fn deref(&mut self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            self.async_deinit_impl();
        }
    }

    pub fn dupe_ref(&mut self) -> *mut IOWriter {
        self.ref_();
        self as *mut IOWriter
    }

    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = core::mem::size_of::<IOWriter>();
        cost += self.buf.capacity();
        #[cfg(windows)]
        {
            cost += self.winbuf.capacity();
        }
        cost += self.writers.memory_cost();
        cost += self.writer.memory_cost();
        cost
    }

    pub fn init(fd: Fd, flags: Flags, evtloop: EventLoopHandle) -> *mut IOWriter {
        // Tell the Windows PipeWriter impl to *not* close the file descriptor,
        // unfortunately this won't work if it creates a uv_pipe or uv_tty as those
        // types own their file descriptor
        #[cfg(windows)]
        let writer = WriterImpl { owns_fd: false, ..Default::default() };
        #[cfg(not(windows))]
        let writer = WriterImpl { close_fd: false, ..Default::default() };

        let this = Box::into_raw(Box::new(IOWriter {
            ref_count: Cell::new(1),
            writer,
            fd: MovableIfWindowsFd::init(fd),
            writers: Writers::inlined_default(),
            buf: Vec::new(),
            #[cfg(windows)]
            winbuf: Vec::new(),
            #[cfg(not(windows))]
            winbuf: (),
            writer_idx: 0,
            total_bytes_written: 0,
            err: None,
            evtloop,
            concurrent_task: EventLoopTask::from_event_loop(evtloop),
            concurrent_task2: EventLoopTask::from_event_loop(evtloop),
            is_writing: false,
            async_deinit: AsyncDeinitWriter::default(),
            started: false,
            flags,
        }));

        // SAFETY: just allocated above; non-null.
        let this_ref = unsafe { &mut *this };
        this_ref.writer.parent = this;
        this_ref.flags = flags;

        scoped_log!(
            IOWriter,
            "IOWriter(0x{:x}, fd={}) init flags={:?}",
            this as usize,
            fd,
            flags
        );

        this
    }

    pub fn __start(&mut self) -> bun_sys::Result<()> {
        debug_assert!(self.fd.is_owned());
        scoped_log!(
            IOWriter,
            "IOWriter(0x{:x}, fd={}) __start()",
            self as *mut _ as usize,
            self.fd
        );
        if let Some(e_) = self.writer.start(&mut self.fd, self.flags.pollable()).as_err() {
            let e: bun_sys::Error = e_;
            #[cfg(unix)]
            {
                // We get this if we pass in a file descriptor that is not
                // pollable, for example a special character device like
                // /dev/null. If so, restart with polling disabled.
                //
                // It's also possible on Linux for EINVAL to be returned
                // when registering multiple writable/readable polls for the
                // same file descriptor. The shell code here makes sure to
                // _not_ run into that case, but it is possible.
                if e.get_errno() == bun_sys::Errno::INVAL {
                    scoped_log!(
                        IOWriter,
                        "IOWriter(0x{:x}, fd={}) got EINVAL",
                        self as *mut _ as usize,
                        self.fd
                    );
                    self.flags.set_pollable(false);
                    self.flags.set_nonblocking(false);
                    self.flags.set_is_socket(false);
                    if self.writer.handle.is_poll() {
                        self.writer.handle.close_impl(None, (), false);
                    }
                    self.writer.handle = bun_io::Handle::Closed;
                    return self.__start();
                }

                #[cfg(target_os = "linux")]
                {
                    // On linux regular files are not pollable and return EPERM,
                    // so restart if that's the case with polling disabled.
                    if e.get_errno() == bun_sys::Errno::PERM {
                        self.flags.set_pollable(false);
                        self.flags.set_nonblocking(false);
                        self.flags.set_is_socket(false);
                        if self.writer.handle.is_poll() {
                            self.writer.handle.close_impl(None, (), false);
                        }
                        self.writer.handle = bun_io::Handle::Closed;
                        return self.__start();
                    }
                }
            }

            #[cfg(windows)]
            {
                // This might happen if the file descriptor points to NUL.
                // On Windows GetFileType(NUL) returns FILE_TYPE_CHAR, so
                // `this.writer.start()` will try to open it as a tty with
                // uv_tty_init, but this returns EBADF. As a workaround,
                // we'll try opening the file descriptor as a file.
                if e.get_errno() == bun_sys::Errno::BADF {
                    self.flags.set_pollable(false);
                    self.flags.set_nonblocking(false);
                    self.flags.set_is_socket(false);
                    return self.writer.start_with_file(self.fd.get().unwrap());
                }
            }
            return bun_sys::Result::Err(e);
        }
        #[cfg(unix)]
        {
            if self.flags.nonblocking() {
                self.writer.get_poll().unwrap().flags.insert(bun_aio::PollFlag::Nonblocking);
            }

            const SENDTO_MSG_NOWAIT_BLOCKS: bool = cfg!(target_os = "macos");

            if self.flags.is_socket() && (!SENDTO_MSG_NOWAIT_BLOCKS || self.flags.nonblocking()) {
                self.writer.get_poll().unwrap().flags.insert(bun_aio::PollFlag::Socket);
            } else if self.flags.pollable() {
                self.writer.get_poll().unwrap().flags.insert(bun_aio::PollFlag::Fifo);
            }
        }

        #[cfg(windows)]
        {
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, {}) starting with source={}",
                self as *mut _ as usize,
                self.fd,
                if let Some(ref src) = self.writer.source {
                    <&'static str>::from(src)
                } else {
                    "no source lol"
                }
            );
        }

        bun_sys::Result::Ok(())
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

    /// Idempotent write call
    fn write(&mut self) -> WriteOutcome {
        #[cfg(unix)]
        debug_assert!(self.flags.pollable());

        if !self.started {
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) starting",
                self as *mut _ as usize,
                self.fd
            );
            // Set before onError: the callback chain may deref to 0 and asyncDeinit's
            // never-started fast-path would synchronously destroy us mid-onError.
            self.started = true;
            if let Some(e) = self.__start().as_err() {
                self.on_error(e);
                return WriteOutcome::Failed;
            }
            #[cfg(unix)]
            {
                // if `handle == .fd` it means it's a file which does not
                // support polling for writeability and we should just
                // write to it
                if self.writer.handle.is_fd() {
                    debug_assert!(!self.flags.pollable());
                    return WriteOutcome::IsActuallyFile;
                }
                return WriteOutcome::Suspended;
            }
            #[allow(unreachable_code)]
            return WriteOutcome::Suspended;
        }

        #[cfg(windows)]
        {
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) write() is_writing={}",
                self as *mut _ as usize,
                self.fd,
                self.is_writing
            );
            if self.is_writing {
                return WriteOutcome::Suspended;
            }
            self.is_writing = true;
            if let Some(e) = self.writer.start_with_current_pipe().as_err() {
                self.on_error(e);
                return WriteOutcome::Failed;
            }
            return WriteOutcome::Suspended;
        }

        #[cfg(not(windows))]
        {
            debug_assert!(self.writer.handle.is_poll());
            if self.writer.handle.poll().is_watching() {
                return WriteOutcome::Suspended;
            }
            // TODO(port): Zig calls `start(self.fd, ...)` (by value) here vs `&self.fd`
            // above; verify the Rust `BufferedWriter::start` overload signature.
            match self.writer.start(&mut self.fd, self.flags.pollable()) {
                bun_sys::Result::Ok(_) => {}
                bun_sys::Result::Err(err) => {
                    self.on_error(err);
                    return WriteOutcome::Failed;
                }
            }
            WriteOutcome::Suspended
        }
    }

    /// Cancel the chunks enqueued by the given writer by
    /// marking them as dead
    pub fn cancel_chunks<P: Into<ChildPtr>>(&mut self, ptr_: P) {
        let ptr: ChildPtr = ptr_.into();
        let actual_ptr = ptr.ptr.repr_ptr();
        if self.writers.len() == 0 {
            return;
        }
        let idx = self.writer_idx;
        let slice: &mut [Writer] = self.writers.slice_mutable();
        if idx >= slice.len() {
            return;
        }
        for w in &mut slice[idx..] {
            if w.ptr.ptr.repr_ptr() == actual_ptr {
                w.set_dead();
            }
        }
    }

    /// Skips over dead children and increments `total_bytes_written` by the
    /// amount they would have written so the buf is skipped as well
    pub fn skip_dead(&mut self) {
        // PORT NOTE: reshaped for borrowck — capture writer_idx locally to avoid
        // overlapping &mut on self.writers and self fields.
        let mut idx = self.writer_idx;
        let mut total = self.total_bytes_written;
        {
            let slice = self.writers.slice();
            for w in &slice[idx..] {
                if w.is_dead() {
                    idx += 1;
                    total += w.len - w.written;
                    continue;
                }
                break;
            }
        }
        self.writer_idx = idx;
        self.total_bytes_written = total;
    }

    pub fn do_file_write(&mut self) -> Yield {
        debug_assert!(cfg!(unix));
        debug_assert!(!self.flags.pollable());
        debug_assert!(self.writer_idx < self.writers.len());

        // PORT NOTE: Zig has `defer this.setWriting(false)` here. set_writing is a no-op on
        // posix and do_file_write is posix-only (asserted above), so the defer is dropped.
        self.skip_dead();

        // PORT NOTE: reshaped for borrowck — split borrow of writers entry around get_buffer().
        let idx = self.writer_idx;
        debug_assert!(!self.writers.get(idx).is_dead());

        let buf = self.get_buffer();
        debug_assert!(!buf.is_empty());

        let mut done = false;
        // TODO(port): borrowck — get_buffer borrows self; pass slice as raw ptr+len or
        // restructure drain_buffered_data to take (&mut self) and recompute buffer.
        let write_result = self.drain_buffered_data(buf, u32::MAX as usize, false);
        let amt = match write_result {
            WriteResult::Done(amt) => {
                done = true;
                amt
            }
            // .wrote can be returned if an error was encountered but there we wrote
            // some data before it happened. In that case, onError will also be
            // called so we should just return.
            WriteResult::Wrote(amt) => {
                if self.err.is_some() {
                    return Yield::Done;
                }
                amt
            }
            // This is returned when we hit EAGAIN which should not be the case
            // when writing to files unless we opened the file with non-blocking
            // mode
            WriteResult::Pending(_) => unreachable!(
                "drainBufferedData returning .pending in IOWriter.doFileWrite should not happen"
            ),
            WriteResult::Err(e) => {
                self.on_error(e);
                return Yield::Done;
            }
        };
        let _ = done;

        let child = self.writers.get_mut(idx);
        if let Some(bl) = child.bytelist.as_deref_mut() {
            let written_slice =
                &self.buf[self.total_bytes_written..self.total_bytes_written + amt];
            bl.append_slice(written_slice);
        }
        self.total_bytes_written += amt;
        let child = self.writers.get_mut(idx);
        child.written += amt;
        if !child.wrote_everything() {
            debug_assert!(matches!(write_result, WriteResult::Done(_)));
            // This should never happen if we are here. The only case where we get
            // partial writes is when an error is encountered
            unreachable!(
                "IOWriter.doFileWrite: child.wroteEverything() is false. This is unexpected \
                 behavior and indicates a bug in Bun. Please file a GitHub issue."
            );
        }
        // PORT NOTE: reshaped for borrowck — pass index instead of &mut Writer to bump.
        self.bump(idx)
    }

    pub fn on_write_pollable(&mut self, amount: usize, status: WriteStatus) {
        #[cfg(unix)]
        debug_assert!(self.flags.pollable());

        self.set_writing(false);
        scoped_log!(
            IOWriter,
            "IOWriter(0x{:x}, fd={}) onWrite({}, {:?})",
            self as *mut _ as usize,
            self.fd,
            amount,
            status
        );
        if self.writer_idx >= self.writers.len() {
            return;
        }
        let idx = self.writer_idx;
        let child_is_dead = self.writers.get(idx).is_dead();
        if child_is_dead {
            self.bump(idx).run();
        } else {
            {
                let total = self.total_bytes_written;
                let child = self.writers.get_mut(idx);
                if let Some(bl) = child.bytelist.as_deref_mut() {
                    let written_slice = &self.buf[total..total + amount];
                    bl.append_slice(written_slice);
                }
            }
            self.total_bytes_written += amount;
            let (child_written, child_len) = {
                let child = self.writers.get_mut(idx);
                child.written += amount;
                (child.written, child.len)
            };
            if status == WriteStatus::EndOfFile {
                let not_fully_written = if self.is_last_idx(self.writer_idx) {
                    true
                } else {
                    child_written < child_len
                };
                // We wrote everything
                if !not_fully_written {
                    return;
                }

                // We did not write everything. This means the other end of the
                // socket/pipe closed and we got EPIPE.
                //
                // An example:
                //
                // Example: `ls . | echo hi`
                //
                // 1. We call `socketpair()` and give `ls .` a socket to _write_ to and `echo hi` a socket to _read_ from
                // 2. `ls .` executes first, but has to do some async work and so is suspended
                // 3. `echo hi` then executes and finishes first (since it does less work) and closes its socket
                // 4. `ls .` does its thing and then tries to write to its socket
                // 5. Because `echo hi` closed its socket, when `ls .` does `send(...)` it will return EPIPE
                // 6. Inside our PipeWriter abstraction this gets returned as bun.io.WriteStatus.end_of_file
                //
                // So what should we do? In a normal shell, `ls .` would receive the SIGPIPE signal and exit.
                // We don't support signals right now. In fact we don't even have a way to kill the shell.
                //
                // So for a quick hack we're just going to have all writes return an error.
                bun_core::Output::debug_warn(format_args!(
                    "IOWriter(0x{:x}, fd={}) received done without fully writing data",
                    self as *mut _ as usize, self.fd
                ));
                self.flags.set_broken_pipe(true);
                self.broken_pipe_for_writers();
                return;
            }

            if child_written >= child_len {
                self.bump(idx).run();
            }
        }

        let wrote_everything: bool = self.wrote_everything();

        scoped_log!(
            IOWriter,
            "IOWriter(0x{:x}, fd={}) wrote_everything={}, idx={} writers={} next_len={}",
            self as *mut _ as usize,
            self.fd,
            wrote_everything,
            self.writer_idx,
            self.writers.len(),
            if self.writers.len() >= 1 { self.writers.get(0).len } else { 0 }
        );
        if !wrote_everything && self.writer_idx < self.writers.len() {
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) poll again",
                self as *mut _ as usize,
                self.fd
            );
            #[cfg(windows)]
            {
                self.set_writing(true);
                self.writer.write();
            }
            #[cfg(not(windows))]
            {
                debug_assert!(self.writer.handle.is_poll());
                self.writer.register_poll();
            }
        }
    }

    pub fn broken_pipe_for_writers(&mut self) {
        debug_assert!(self.flags.broken_pipe());
        let mut offset: usize = 0;
        // PORT NOTE: reshaped for borrowck — collect targets first since
        // `cancel_chunks` re-borrows `self.writers`.
        let start = self.writer_idx;
        let mut i = start;
        while i < self.writers.len() {
            let (is_dead, len, ptr) = {
                let w = self.writers.get(i);
                (w.is_dead(), w.len, w.ptr)
            };
            if is_dead {
                offset += len;
                i += 1;
                continue;
            }
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) brokenPipeForWriters Writer(0x{:x}) {}(0x{:x})",
                self as *mut _ as usize,
                self.fd,
                self.writers.get(i) as *const _ as usize,
                <&'static str>::from(ptr.ptr.tag()),
                ptr.ptr.repr_ptr()
            );
            let err: SystemError =
                bun_sys::Error::from_code(bun_sys::Errno::PIPE, bun_sys::Syscall::Write)
                    .to_system_error();
            ptr.on_io_writer_chunk(0, Some(err)).run();
            offset += len;
            self.cancel_chunks(ptr);
            i += 1;
        }
        let _ = offset;

        self.total_bytes_written = 0;
        self.writers.clear_retaining_capacity();
        self.buf.clear();
        self.writer_idx = 0;
    }

    pub fn wrote_everything(&self) -> bool {
        self.total_bytes_written >= self.buf.len()
    }

    pub fn on_close(&mut self) {
        self.set_writing(false);
    }

    pub fn on_error(&mut self, err__: bun_sys::Error) {
        self.set_writing(false);
        let ee = err__.to_shell_system_error();
        self.err = Some(ee);
        // Track broken pipe state for future enqueue calls
        if err__.get_errno() == bun_sys::Errno::PIPE {
            self.flags.set_broken_pipe(true);
        }
        scoped_log!(
            IOWriter,
            "IOWriter(0x{:x}, fd={}) onError errno={} errmsg={} errsyscall={}",
            self as *mut _ as usize,
            self.fd,
            <&'static str>::from(ee.get_errno()),
            ee.message,
            ee.syscall
        );
        // PERF(port): was stack-fallback (std.heap.stackFallback(@sizeOf(usize) * 64))
        let mut seen: Vec<usize> = Vec::with_capacity(64);
        // Writers before writer_idx have already had their onIOWriterChunk callback fired and may
        // have been freed; only notify the still-pending ones.
        let start = self.writer_idx;
        'writer_loop: for i in start..self.writers.len() {
            // PORT NOTE: reshaped for borrowck — Writer is not Copy (holds &mut bytelist);
            // capture only the scalars we need.
            let (is_dead, child_ptr) = {
                let w = self.writers.get(i);
                (w.is_dead(), w.ptr)
            };
            if is_dead {
                continue;
            }
            let ptr_u = child_ptr.ptr.ptr().map_or(0usize, |p| p as usize);
            if seen.len() < 8 {
                for item in &seen {
                    if *item == ptr_u {
                        continue 'writer_loop;
                    }
                }
            } else if seen.iter().position(|&x| x == ptr_u).is_some() {
                continue 'writer_loop;
            }

            seen.push(ptr_u);
            // Callee consumes the error (derefs it). Ref before each pass so deinitOnMainThread's
            // deref of this.err is balanced and multiple callees don't over-deref. Matches IOReader.
            if let Some(e) = self.err.as_mut() {
                e.ref_();
            }
            // TODO: This probably shouldn't call .run()
            child_ptr.on_io_writer_chunk(0, self.err).run();
        }

        self.total_bytes_written = 0;
        self.writer_idx = 0;
        self.buf.clear();
        self.writers.clear_retaining_capacity();
    }

    /// Returns the buffer of data that needs to be written
    /// for the *current* writer.
    pub fn get_buffer(&mut self) -> &[u8] {
        let result = self.get_buffer_impl();
        #[cfg(windows)]
        {
            self.winbuf.clear();
            self.winbuf.extend_from_slice(result);
            return self.winbuf.as_slice();
        }
        #[cfg(not(windows))]
        {
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) getBuffer = {} bytes",
                self as *const _ as usize,
                self.fd,
                result.len()
            );
            result
        }
    }

    fn get_buffer_impl(&mut self) -> &[u8] {
        let writer = 'brk: {
            if self.writer_idx >= self.writers.len() {
                scoped_log!(
                    IOWriter,
                    "IOWriter(0x{:x}, fd={}) getBufferImpl all writes done",
                    self as *const _ as usize,
                    self.fd
                );
                return b"";
            }
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) getBufferImpl idx={} writer_len={}",
                self as *const _ as usize,
                self.fd,
                self.writer_idx,
                self.writers.len()
            );
            let writer = self.writers.get(self.writer_idx);
            if !writer.is_dead() {
                break 'brk (writer.len, writer.written);
            }
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) skipping dead",
                self as *const _ as usize,
                self.fd
            );
            self.skip_dead();
            if self.writer_idx >= self.writers.len() {
                scoped_log!(
                    IOWriter,
                    "IOWriter(0x{:x}, fd={}) getBufferImpl all writes done",
                    self as *const _ as usize,
                    self.fd
                );
                return b"";
            }
            let writer = self.writers.get(self.writer_idx);
            (writer.len, writer.written)
        };
        let (writer_len, writer_written) = writer;
        scoped_log!(
            IOWriter,
            "IOWriter(0x{:x}, fd={}) getBufferImpl writer_len={} writer_written={}",
            self as *const _ as usize,
            self.fd,
            writer_len,
            writer_written
        );
        let remaining = writer_len - writer_written;
        if cfg!(debug_assertions) {
            debug_assert!(!(writer_len == writer_written));
        }
        &self.buf[self.total_bytes_written..self.total_bytes_written + remaining]
    }

    // PORT NOTE: reshaped for borrowck — takes index instead of `*Writer` to avoid
    // overlapping &mut self with &mut Writer.
    pub fn bump(&mut self, current_writer_idx: usize) -> Yield {
        let (is_dead, written, child_ptr, current_len) = {
            let current_writer = self.writers.get(current_writer_idx);
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) bump(0x{:x} {})",
                self as *const _ as usize,
                self.fd,
                current_writer as *const _ as usize,
                <&'static str>::from(current_writer.ptr.ptr.tag())
            );
            (
                current_writer.is_dead(),
                current_writer.written,
                current_writer.ptr,
                current_writer.len,
            )
        };

        if is_dead {
            self.skip_dead();
        } else {
            if cfg!(debug_assertions) {
                if !is_dead {
                    debug_assert!(written == current_len);
                }
            }
            self.writer_idx += 1;
        }

        if self.writer_idx >= self.writers.len() {
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) all writers complete: truncating",
                self as *const _ as usize,
                self.fd
            );
            self.buf.clear();
            self.writer_idx = 0;
            self.writers.clear_retaining_capacity();
            self.total_bytes_written = 0;
        } else if self.total_bytes_written >= SHRINK_THRESHOLD {
            let remaining_len = self.buf.len() - self.total_bytes_written;
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) exceeded shrink threshold: truncating (new_len={}, writer_starting_idx={})",
                self as *const _ as usize,
                self.fd,
                remaining_len,
                self.writer_idx
            );
            if remaining_len == 0 {
                self.buf.clear();
                self.total_bytes_written = 0;
            } else {
                // bun.copy(u8, dst, src) — src/dst overlap (shifting buf left).
                self.buf.copy_within(self.total_bytes_written.., 0);
                self.buf.truncate(remaining_len);
                self.total_bytes_written = 0;
            }
            self.writers.truncate(self.writer_idx);
            self.writer_idx = 0;
            if cfg!(debug_assertions) {
                if self.writers.len() > 0 {
                    let first = self.writers.get_const(self.writer_idx);
                    debug_assert!(self.buf.len() >= first.len);
                }
            }
        }

        // If the writer was not dead then call its `onIOWriterChunk` callback
        if !is_dead {
            return child_ptr.on_io_writer_chunk(written, None);
        }

        Yield::Done
    }

    fn enqueue_file(&mut self) -> Yield {
        if self.is_writing {
            return Yield::Suspended;
        }
        // The pollable path sets `started` in write(); the non-pollable file path bypasses
        // write() entirely, so set it here. asyncDeinit's never-started fast-path must not
        // fire for a writer that actually wrote — bump()'s onIOWriterChunk callback can deref
        // us while doFileWrite is still on the stack.
        self.started = true;
        self.set_writing(true);

        self.do_file_write()
    }

    /// `writer` is the new writer to queue
    ///
    /// You MUST have already added the data to `this.buf`!!
    pub fn enqueue_internal(&mut self) -> Yield {
        debug_assert!(!self.flags.broken_pipe());
        if !self.flags.pollable() && cfg!(unix) {
            return self.enqueue_file();
        }
        match self.write() {
            WriteOutcome::Suspended => Yield::Suspended,
            WriteOutcome::IsActuallyFile => {
                debug_assert!(cfg!(unix));
                self.enqueue_file()
            }
            // FIXME
            WriteOutcome::Failed => Yield::Failed,
        }
    }

    pub fn handle_broken_pipe(&mut self, ptr: ChildPtr) -> Option<Yield> {
        if self.flags.broken_pipe() {
            let err: SystemError =
                bun_sys::Error::from_code(bun_sys::Errno::PIPE, bun_sys::Syscall::Write)
                    .to_system_error();
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) broken pipe {}(0x{:x})",
                self as *const _ as usize,
                self.fd,
                <&'static str>::from(ptr.ptr.tag()),
                ptr.ptr.ptr().map_or(0usize, |p| p as usize)
            );
            return Some(Yield::OnIoWriterChunk {
                child: ptr.as_any_opaque(),
                written: 0,
                err: Some(err),
            });
        }
        None
    }

    pub fn enqueue<P: Into<ChildPtr>>(
        &mut self,
        ptr: P,
        bytelist: Option<&mut ByteList<u8>>,
        buf: &[u8],
    ) -> Yield {
        let childptr: ChildPtr = ptr.into();
        if let Some(yield_) = self.handle_broken_pipe(childptr) {
            return yield_;
        }

        if buf.is_empty() {
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) enqueue EMPTY",
                self as *const _ as usize,
                self.fd
            );
            return Yield::OnIoWriterChunk {
                child: childptr.as_any_opaque(),
                written: 0,
                err: None,
            };
        }
        let writer = Writer {
            ptr: childptr,
            len: buf.len(),
            written: 0,
            bytelist,
        };
        scoped_log!(
            IOWriter,
            "IOWriter(0x{:x}, fd={}) enqueue(0x{:x} {}, buf_len={}, buf={}, writer_len={})",
            self as *const _ as usize,
            self.fd,
            writer.raw_ptr().map_or(0usize, |p| p as usize),
            <&'static str>::from(writer.ptr.ptr.tag()),
            buf.len(),
            bstr::BStr::new(&buf[..buf.len().min(128)]),
            self.writers.len() + 1
        );
        self.buf.extend_from_slice(buf);
        // TODO(port): lifetime — `bytelist` borrow stored into `Writers` outlives this fn.
        self.writers.append(writer);
        self.enqueue_internal()
    }

    // PERF(port): was comptime monomorphization (`comptime kind: ?Interpreter.Builtin.Kind`).
    // TODO(port): Zig builds `@tagName(k) ++ ": " ++ fmt` at comptime; Rust cannot concat a
    // runtime tag into a &'static str. Phase B should expose `enqueue_fmt_bltn!` macro that
    // expands to `enqueue_fmt(.., format_args!("{tag}: " ++ fmt, ..))`.
    pub fn enqueue_fmt_bltn<P: Into<ChildPtr>>(
        &mut self,
        ptr: P,
        kind: Option<Interpreter::builtin::Kind>,
        bytelist: Option<&mut ByteList<u8>>,
        args: fmt::Arguments<'_>,
    ) -> Yield {
        let _ = kind;
        self.enqueue_fmt(ptr, bytelist, args)
    }

    pub fn enqueue_fmt<P: Into<ChildPtr>>(
        &mut self,
        ptr: P,
        bytelist: Option<&mut ByteList<u8>>,
        args: fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        let start = self.buf.len();
        // bun.handleOom(buf_writer.print(fmt, args)) — Rust write! to Vec<u8> is infallible.
        let _ = self.buf.write_fmt(args);

        let childptr: ChildPtr = ptr.into();
        if let Some(yield_) = self.handle_broken_pipe(childptr) {
            return yield_;
        }

        let end = self.buf.len();
        let writer = Writer {
            ptr: childptr,
            len: end - start,
            written: 0,
            bytelist,
        };
        scoped_log!(
            IOWriter,
            "IOWriter(0x{:x}, fd={}) enqueue(0x{:x} {}, {})",
            self as *const _ as usize,
            self.fd,
            writer.raw_ptr().map_or(0usize, |p| p as usize),
            <&'static str>::from(writer.ptr.ptr.tag()),
            bstr::BStr::new(&self.buf[start..end])
        );
        self.writers.append(writer);
        self.enqueue_internal()
    }

    fn async_deinit_impl(&mut self) {
        scoped_log!(
            IOWriter,
            "IOWriter(0x{:x}, fd={}) asyncDeinit",
            self as *const _ as usize,
            self.fd
        );
        debug_assert!(!self.is_writing);
        // The async hop guards against being deref'd from inside a write callback while
        // PipeWriter is still on the stack. If we never started, no callback can be in
        // flight, so close synchronously to avoid holding the fd until the next tick.
        if !self.started {
            self.deinit_on_main_thread();
            return;
        }
        self.async_deinit.enqueue();
    }

    pub fn deinit_on_main_thread(&mut self) {
        scoped_log!(
            IOWriter,
            "IOWriter(0x{:x}, fd={}) deinit",
            self as *const _ as usize,
            self.fd
        );
        if cfg!(debug_assertions) {
            // TODO(port): RefCount.assertNoRefs()
            debug_assert_eq!(self.ref_count.get(), 0);
        }
        // self.buf / self.writers freed by Drop below.
        if let Some(e) = self.err.as_mut() {
            e.deref();
        }
        #[cfg(unix)]
        {
            if self.writer.handle.is_poll() {
                self.writer.handle.close_impl(None, (), false);
            }
        }
        #[cfg(not(unix))]
        {
            self.writer.close();
            // self.winbuf freed by Drop.
        }
        if self.fd.is_valid() {
            self.fd.close();
        }
        self.writer.disable_keeping_process_alive(self.evtloop);
        // SAFETY: `self` was allocated via Box::into_raw in `init`; refcount is zero.
        unsafe {
            drop(Box::from_raw(self as *mut IOWriter));
        }
    }

    pub fn is_last_idx(&self, idx: usize) -> bool {
        idx == self.writers.len().saturating_sub(1)
    }

    /// Only does things on windows
    #[inline]
    pub fn set_writing(&mut self, writing: bool) {
        #[cfg(windows)]
        {
            scoped_log!(
                IOWriter,
                "IOWriter(0x{:x}, fd={}) setWriting({})",
                self as *const _ as usize,
                self.fd,
                writing
            );
            self.is_writing = writing;
        }
        #[cfg(not(windows))]
        let _ = writing;
    }

    // this is unused
    pub fn run_from_main_thread(&mut self) {}

    // this is unused
    pub fn run_from_main_thread_mini(&mut self, _: &mut ()) {}

    pub fn drain_buffered_data(
        &mut self,
        buf: &[u8],
        max_write_size: usize,
        received_hup: bool,
    ) -> WriteResult {
        debug_assert!(cfg!(unix));
        let _ = received_hup;

        let trimmed = if max_write_size < buf.len() && max_write_size > 0 {
            &buf[0..max_write_size]
        } else {
            buf
        };

        let mut drained: usize = 0;

        while drained < trimmed.len() {
            let attempt =
                try_write_with_write_fn(self.fd.get().unwrap(), buf, bun_sys::write);
            match attempt {
                WriteResult::Pending(pending) => {
                    drained += pending;
                    return WriteResult::Pending(drained);
                }
                WriteResult::Wrote(amt) => {
                    drained += amt;
                }
                WriteResult::Err(err) => {
                    if drained > 0 {
                        self.on_error(err);
                        return WriteResult::Wrote(drained);
                    } else {
                        return WriteResult::Err(err);
                    }
                }
                WriteResult::Done(amt) => {
                    drained += amt;
                    return WriteResult::Done(drained);
                }
            }
        }

        WriteResult::Wrote(drained)
    }
}

/// Anything which uses `*IOWriter` to write to a file descriptor needs to
/// register itself here so we know how to call its callback on completion.
#[derive(Clone, Copy)]
pub struct IOWriterChildPtr {
    pub ptr: ChildPtrRaw,
}

impl IOWriterChildPtr {
    pub fn init<P>(p: *mut P) -> IOWriterChildPtr {
        IOWriterChildPtr {
            ptr: ChildPtrRaw::init(p),
        }
    }

    pub fn as_any_opaque(self) -> *mut c_void {
        // TODO(port): ChildPtrRaw.ptr() returns ?*anyopaque in Zig; here we unwrap.
        self.ptr.ptr().unwrap_or(core::ptr::null_mut())
    }

    pub fn from_any_opaque(p: *mut c_void) -> IOWriterChildPtr {
        IOWriterChildPtr { ptr: ChildPtrRaw::from(p) }
    }

    /// Called when the IOWriter writes a complete chunk of data the child enqueued
    pub fn on_io_writer_chunk(self, amount: usize, err: Option<SystemError>) -> Yield {
        // TODO(port): Zig `this.ptr.call("onIOWriterChunk", .{amount, err}, Yield)` is a
        // comptime-reflected dispatch over the union variants. Phase B implements
        // `TaggedPtrUnion::call` via a trait that all variant types implement.
        self.ptr.call_on_io_writer_chunk(amount, err)
    }
}

impl<P> From<*mut P> for IOWriterChildPtr {
    fn from(p: *mut P) -> Self {
        Self::init(p)
    }
}

pub type ChildPtrRaw = TaggedPtrUnion<(
    Interpreter::Cmd,
    Interpreter::Pipeline,
    Interpreter::CondExpr,
    Interpreter::Subshell,
    Interpreter::builtin::Cd,
    Interpreter::builtin::Echo,
    Interpreter::builtin::Export,
    Interpreter::builtin::Ls,
    Interpreter::builtin::ls::ShellLsOutputTask,
    Interpreter::builtin::Mv,
    Interpreter::builtin::Pwd,
    Interpreter::builtin::Rm,
    Interpreter::builtin::Which,
    Interpreter::builtin::Mkdir,
    Interpreter::builtin::mkdir::ShellMkdirOutputTask,
    Interpreter::builtin::Touch,
    Interpreter::builtin::touch::ShellTouchOutputTask,
    Interpreter::builtin::Cat,
    Interpreter::builtin::Exit,
    Interpreter::builtin::True,
    Interpreter::builtin::False,
    Interpreter::builtin::Yes,
    Interpreter::builtin::Seq,
    Interpreter::builtin::Dirname,
    Interpreter::builtin::Basename,
    Interpreter::builtin::Cp,
    Interpreter::builtin::cp::ShellCpOutputTask,
    subproc::pipe_reader::CapturedWriter,
)>;

/// TODO: This function and `drainBufferedData` are copy pastes from
/// `PipeWriter.zig`, it would be nice to not have to do that
fn try_write_with_write_fn(
    fd: Fd,
    buf: &[u8],
    write_fn: fn(Fd, &[u8]) -> bun_sys::Result<usize>,
) -> WriteResult {
    // PERF(port): was comptime monomorphization (`comptime write_fn: *const fn`) — profile in Phase B
    let mut offset: usize = 0;

    while offset < buf.len() {
        match write_fn(fd, &buf[offset..]) {
            bun_sys::Result::Err(err) => {
                if err.is_retry() {
                    return WriteResult::Pending(offset);
                }

                // Return EPIPE as an error so it propagates properly.
                return WriteResult::Err(err);
            }

            bun_sys::Result::Ok(wrote) => {
                offset += wrote;
                if wrote == 0 {
                    return WriteResult::Done(offset);
                }
            }
        }
    }

    WriteResult::Wrote(offset)
}

/// TODO: Investigate what we need to do to remove this since we did most of the leg
///       work in removing recursion in the shell. That is what caused the need for
///       making deinitialization asynchronous in the first place.
///
///       There are two areas which need to change:
///
///       1. `IOWriter.onWritePollable` calls `this.bump(child).run()` which could
///          deinitialize the child which will deref and potentially deinitalize the
///          `IOWriter`. Simple solution is to ref and defer ref the `IOWriter`
///
///       2. `PipeWriter` seems to try to use this struct after IOWriter
///          deinitializes. We might not be able to get around this.
#[derive(Default)]
pub struct AsyncDeinitWriter {
    pub ran: bool,
}

impl AsyncDeinitWriter {
    pub fn enqueue(&mut self) {
        if self.ran {
            return;
        }
        self.ran = true;

        let iowriter = self.writer();

        // TODO(port): EventLoopHandle is a tagged union { js, mini } in Zig.
        match iowriter.evtloop {
            EventLoopHandle::Js(js) => {
                js.enqueue_task_concurrent(
                    iowriter.concurrent_task.js().from(self, bun_jsc::TaskDeinit::Manual),
                );
            }
            EventLoopHandle::Mini(mini) => {
                mini.enqueue_task_concurrent(
                    iowriter
                        .concurrent_task
                        .mini()
                        .from(self, "runFromMainThreadMini"),
                );
            }
        }
    }

    pub fn writer(&mut self) -> &mut IOWriter {
        // SAFETY: `self` points to the `async_deinit` field of an `IOWriter`.
        unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(offset_of!(IOWriter, async_deinit))
                .cast::<IOWriter>()
        }
    }

    pub fn run_from_main_thread(&mut self) {
        self.writer().deinit_on_main_thread();
    }

    pub fn run_from_main_thread_mini(&mut self, _: &mut ()) {
        self.run_from_main_thread();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/IOWriter.zig (914 lines)
//   confidence: medium
//   todos:      12
//   notes:      bytelist field is BORROW_PARAM but stored long-lived in Writers; bump()/on_write_pollable reshaped to take index for borrowck; BufferedWriter callback vtable + TaggedPtrUnion.call need trait wiring in Phase B; enqueue_fmt_bltn needs macro for comptime tag prefix
// ──────────────────────────────────────────────────────────────────────────
