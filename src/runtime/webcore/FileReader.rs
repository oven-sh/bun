use core::mem;

use bun_aio as aio;
use bun_collections::ByteList;
use bun_io::{BufferedReader, FileType, ReadState};
use bun_jsc::{self as jsc, EnsureStillAlive, EventLoopHandle, JSValue, Strong};
use bun_sys::{self as sys, Fd};

use crate::webcore::blob::{self, Blob};
use crate::webcore::readable_stream::{self, ReadableStream};
use crate::webcore::streams;

bun_output::declare_scope!(FileReader, visible);

// TODO(port): `pending_view` and the `Js`/`Temporary` variants below borrow into a
// JS-owned typed-array buffer kept alive by `pending_value: Strong` / `ensure_still_alive`.
// Represented as `&'static mut [u8]` / `&'static [u8]` here to keep function bodies
// readable; Phase B should replace with a proper raw-slice wrapper (BACKREF lifetime).

pub struct FileReader {
    pub reader: IOReader,
    pub done: bool,
    pub pending: streams::result::Pending,
    pub pending_value: Strong, // Strong.Optional
    pub pending_view: &'static mut [u8], // TODO(port): lifetime — see note above
    pub fd: Fd,
    pub start_offset: Option<usize>,
    pub max_size: Option<usize>,
    pub total_readed: usize,
    pub started: bool,
    pub waiting_for_on_reader_done: bool,
    pub event_loop: EventLoopHandle,
    pub lazy: Lazy,
    pub buffered: Vec<u8>,
    pub read_inside_on_pull: ReadDuringJSOnPullResult,
    pub highwater_mark: usize,
    pub flowing: bool,
}

impl Default for FileReader {
    fn default() -> Self {
        Self {
            reader: IOReader::init::<FileReader>(),
            done: false,
            pending: streams::result::Pending::default(),
            pending_value: Strong::empty(),
            pending_view: &mut [],
            fd: Fd::INVALID,
            start_offset: None,
            max_size: None,
            total_readed: 0,
            started: false,
            waiting_for_on_reader_done: false,
            // TODO(port): event_loop has no Zig default; callers must overwrite before use
            event_loop: EventLoopHandle::default(),
            lazy: Lazy::None,
            buffered: Vec::new(),
            read_inside_on_pull: ReadDuringJSOnPullResult::None,
            highwater_mark: 16384,
            flowing: true,
        }
    }
}

pub type IOReader = BufferedReader;
pub type Poll = IOReader;
pub const TAG: ReadableStream::Tag = ReadableStream::Tag::File;

#[derive(strum::IntoStaticStr)]
pub enum ReadDuringJSOnPullResult {
    None,
    Js(&'static mut [u8]), // TODO(port): lifetime — borrows JS typed-array buffer
    AmountRead(usize),
    Temporary(&'static [u8]), // TODO(port): lifetime — borrows reader/JS buffer
    UseBuffered(usize),
}

impl ReadDuringJSOnPullResult {
    fn is_none(&self) -> bool {
        matches!(self, Self::None)
    }
}

pub enum Lazy {
    None,
    Blob(std::sync::Arc<blob::Store>),
}

pub struct OpenedFileBlob {
    pub fd: Fd,
    pub pollable: bool,
    pub nonblocking: bool,
    pub file_type: FileType,
}

impl Default for OpenedFileBlob {
    fn default() -> Self {
        Self {
            fd: Fd::INVALID,
            pollable: false,
            nonblocking: true,
            file_type: FileType::File,
        }
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub fn open_as_nonblocking_tty(fd: i32, flags: i32) -> i32;
}

impl Lazy {
    pub fn open_file_blob(file: &mut blob::store::File) -> sys::Result<OpenedFileBlob> {
        let mut this = OpenedFileBlob { fd: Fd::INVALID, ..Default::default() };
        let mut file_buf = bun_paths::PathBuffer::uninit();
        let mut is_nonblocking = false;

        let fd: Fd = if let blob::PathLike::Fd(pl_fd) = &file.pathlike {
            if pl_fd.stdio_tag().is_some() {
                'brk: {
                    #[cfg(unix)]
                    {
                        // SAFETY: FFI call with valid native fd and O_RDONLY flag
                        let rc = unsafe { open_as_nonblocking_tty(pl_fd.native(), sys::O::RDONLY) };
                        if rc > -1 {
                            is_nonblocking = true;
                            file.is_atty = Some(true);
                            break 'brk Fd::from_native(rc);
                        }
                    }
                    break 'brk *pl_fd;
                }
            } else {
                'brk: {
                    let duped = sys::dup_with_flags(*pl_fd, 0);

                    let fd: Fd = match duped {
                        Ok(fd) => fd,
                        Err(err) => return Err(err.with_fd(*pl_fd)),
                    };

                    #[cfg(unix)]
                    {
                        if fd.stdio_tag().is_none() {
                            is_nonblocking = match fd.get_fcntl_flags() {
                                Ok(flags) => (flags & sys::O::NONBLOCK) != 0,
                                Err(_) => false,
                            };
                        }
                    }

                    break 'brk match fd.make_libuv_owned_for_syscall(sys::Tag::Dup, sys::CloseOnFail::CloseOnFail) {
                        Ok(owned_fd) => owned_fd,
                        Err(err) => return Err(err),
                    };
                }
            }
        } else {
            match sys::open(
                file.pathlike.path().slice_z(&mut file_buf),
                sys::O::RDONLY | sys::O::NONBLOCK | sys::O::CLOEXEC,
                0,
            ) {
                Ok(fd) => {
                    #[cfg(unix)]
                    {
                        is_nonblocking = true;
                    }
                    fd
                }
                Err(err) => {
                    return Err(err.with_path(file.pathlike.path().slice()));
                }
            }
        };

        #[cfg(unix)]
        {
            if file.is_atty.unwrap_or(false)
                || (fd.stdio_tag().is_some() && sys::posix::isatty(fd.cast()))
                || (matches!(&file.pathlike, blob::PathLike::Fd(pl_fd)
                        if pl_fd.stdio_tag().is_some() && sys::posix::isatty(pl_fd.cast())))
            {
                // var termios = std.mem.zeroes(std.posix.termios);
                // _ = std.c.tcgetattr(fd.cast(), &termios);
                // bun.C.cfmakeraw(&termios);
                // _ = std.c.tcsetattr(fd.cast(), std.posix.TCSA.NOW, &termios);
                file.is_atty = Some(true);
            }

            let stat: sys::Stat = match sys::fstat(fd) {
                Ok(result) => result,
                Err(err) => {
                    fd.close();
                    return Err(err);
                }
            };

            if sys::S::isdir(stat.mode) {
                aio::Closer::close(fd, ());
                return Err(sys::Error::from_code(sys::Errno::ISDIR, sys::Tag::Fstat));
            }

            if sys::S::isreg(stat.mode) {
                is_nonblocking = false;
            }

            this.pollable = sys::is_pollable(stat.mode) || is_nonblocking || file.is_atty.unwrap_or(false);
            this.file_type = if sys::S::isfifo(stat.mode) {
                FileType::Pipe
            } else if sys::S::issock(stat.mode) {
                FileType::Socket
            } else {
                FileType::File
            };

            // pretend it's a non-blocking pipe if it's a TTY
            if is_nonblocking && this.file_type != FileType::Socket {
                this.file_type = FileType::NonblockingPipe;
            }

            this.nonblocking = is_nonblocking
                || (this.pollable
                    && !file.is_atty.unwrap_or(false)
                    && this.file_type != FileType::Pipe);

            if this.nonblocking && this.file_type == FileType::Pipe {
                this.file_type = FileType::NonblockingPipe;
            }
        }

        this.fd = fd;

        Ok(this)
    }
}

impl FileReader {
    pub fn event_loop(&self) -> EventLoopHandle {
        self.event_loop
    }

    pub fn loop_(&self) -> *mut aio::Loop {
        #[cfg(windows)]
        {
            self.event_loop().loop_().uv_loop
        }
        #[cfg(not(windows))]
        {
            self.event_loop().loop_()
        }
    }

    // TODO(port): in-place init — `self` is the `context` field of an already-allocated
    // `Source`; the Zig writes `this.* = FileReader{...}` then reads `parent()`. Note the
    // Zig struct literal omits `event_loop` (no default) — likely dead code or relies on
    // a quirk; preserved as-is.
    pub fn setup(&mut self, fd: Fd) {
        *self = FileReader {
            reader: IOReader::default(),
            done: false,
            fd,
            ..Default::default()
        };

        self.event_loop = EventLoopHandle::from(self.parent().global_this().bun_vm().event_loop());
    }

    pub fn on_start(&mut self) -> streams::Start {
        self.reader.set_parent(self);
        let was_lazy = !matches!(self.lazy, Lazy::None);
        let mut pollable = false;
        let mut file_type = FileType::File;
        if let Lazy::Blob(store) = &self.lazy {
            // TODO(port): Arc<Store> interior mutability — `data.file` is mutated below.
            // Phase B: blob::Store likely needs UnsafeCell/RefCell around `data`.
            let store_ptr = std::sync::Arc::as_ptr(store) as *mut blob::Store;
            // SAFETY: Store is single-threaded here and we hold the only mutating ref;
            // matches Zig's `*Blob.Store` direct field access.
            let store_data = unsafe { &mut (*store_ptr).data };
            match store_data {
                blob::store::Data::S3(_) | blob::store::Data::Bytes(_) => {
                    panic!("Invalid state in FileReader: expected file ")
                }
                blob::store::Data::File(file) => {
                    // PORT NOTE: reshaped for borrowck — Zig `defer { deref; lazy = none }`
                    // is hoisted after the match below since both arms fall through.
                    let open_result = Lazy::open_file_blob(file);
                    // drop the Arc (Zig: this.lazy.blob.deref()) and clear lazy
                    self.lazy = Lazy::None;
                    match open_result {
                        Err(err) => {
                            self.fd = Fd::INVALID;
                            return streams::Start::Err(err);
                        }
                        Ok(opened) => {
                            debug_assert!(opened.fd.is_valid());
                            self.fd = opened.fd;
                            pollable = opened.pollable;
                            file_type = opened.file_type;
                            self.reader.flags.nonblocking = opened.nonblocking;
                            self.reader.flags.pollable = pollable;
                        }
                    }
                }
            }
        }

        {
            let reader_fd = self.reader.get_fd();
            if reader_fd != Fd::INVALID && self.fd == Fd::INVALID {
                self.fd = reader_fd;
            }
        }

        self.event_loop = EventLoopHandle::init(self.parent().global_this().bun_vm().event_loop());

        if was_lazy {
            let _ = self.parent().increment_count();
            self.waiting_for_on_reader_done = true;
            if let Some(offset) = self.start_offset {
                match self.reader.start_file_offset(self.fd, pollable, offset) {
                    Ok(()) => {}
                    Err(e) => return streams::Start::Err(e),
                }
            } else {
                match self.reader.start(self.fd, pollable) {
                    Ok(()) => {}
                    Err(e) => return streams::Start::Err(e),
                }
            }
        } else {
            #[cfg(unix)]
            {
                if self.reader.flags.pollable && !self.reader.is_done() {
                    self.waiting_for_on_reader_done = true;
                    let _ = self.parent().increment_count();
                }
            }
        }

        #[cfg(unix)]
        {
            if file_type == FileType::Socket {
                self.reader.flags.socket = true;
            }

            if let Some(poll) = self.reader.handle.get_poll() {
                if file_type == FileType::Socket || self.reader.flags.socket {
                    poll.flags.insert(aio::PollFlag::Socket);
                } else {
                    // if it's a TTY, we report it as a fifo
                    // we want the behavior to be as though it were a blocking pipe.
                    poll.flags.insert(aio::PollFlag::Fifo);
                }

                if self.reader.flags.nonblocking {
                    poll.flags.insert(aio::PollFlag::Nonblocking);
                }
            }
        }

        self.started = true;

        if self.reader.is_done() {
            self.consume_reader_buffer();
            if !self.buffered.is_empty() {
                return streams::Start::OwnedAndDone(ByteList::move_from_vec(&mut self.buffered));
            }
        } else {
            #[cfg(unix)]
            {
                if !was_lazy && self.reader.flags.pollable {
                    self.reader.read();
                }
            }
        }

        streams::Start::Ready
    }

    pub fn parent(&self) -> &mut Source {
        // SAFETY: self is always the `context` field of a heap-allocated `Source`;
        // matches Zig `@fieldParentPtr("context", this)`.
        unsafe {
            &mut *(((self as *const Self as *mut Self) as *mut u8)
                .sub(mem::offset_of!(Source, context))
                .cast::<Source>())
        }
    }

    pub fn on_cancel(&mut self) {
        if self.done {
            return;
        }
        self.done = true;
        self.reader.update_ref(false);
        if !self.reader.is_done() {
            self.reader.close();
        }
    }

    // NOTE: not `impl Drop` — FileReader is embedded as `Source.context` and this is
    // invoked from the Source's JS finalizer path; it also calls `parent().deinit()`.
    // Not `pub`: reached only via the `SourceContext` trait impl below.
    fn deinit(&mut self) {
        // Owned fields (buffered: Vec, reader: BufferedReader, pending_value: Strong,
        // lazy: Arc) drop automatically; only genuine side effects remain.
        self.reader.update_ref(false);
        self.parent().deinit();
    }

    pub fn on_read_chunk(&mut self, init_buf: &[u8], state: ReadState) -> bool {
        let mut buf = init_buf;
        bun_output::scoped_log!(
            FileReader,
            "onReadChunk() = {} ({}) - read_inside_on_pull: {}",
            buf.len(),
            <&'static str>::from(state),
            <&'static str>::from(&self.read_inside_on_pull)
        );

        if self.done {
            self.reader.close();
            return false;
        }
        let mut close = false;
        // PORT NOTE: Zig `defer if (close) this.reader.close();` — handled at each return
        // site below via `close_if_needed`. Reshaped for borrowck (scopeguard would alias &mut self).
        macro_rules! close_if_needed {
            () => {
                if close {
                    self.reader.close();
                }
            };
        }
        let mut has_more = state != ReadState::Eof;

        if !buf.is_empty() {
            if let Some(max_size) = self.max_size {
                if self.total_readed >= max_size {
                    return false;
                }
                let len = (max_size - self.total_readed).min(buf.len());
                if buf.len() > len {
                    buf = &buf[0..len];
                }
                self.total_readed += len;

                if buf.is_empty() {
                    close = true;
                    has_more = false;
                }
            }
        }

        // TODO(port): `reader.buffer()` returns `&mut Vec<u8>`; aliasing with `buf` (which may
        // point into it) is the same hazard as in Zig. Phase B: audit overlap invariants.
        let reader_buffer: *mut Vec<u8> = self.reader.buffer();
        // SAFETY: reader_buffer lives as long as self.reader; we never grow it while
        // `buf` borrows into it (only clear/move which the Zig also does post-copy).
        let reader_buffer = unsafe { &mut *reader_buffer };

        if !self.read_inside_on_pull.is_none() {
            match &mut self.read_inside_on_pull {
                ReadDuringJSOnPullResult::Js(in_progress) => {
                    if in_progress.len() >= buf.len() && !has_more {
                        in_progress[0..buf.len()].copy_from_slice(buf);
                        // SAFETY: lifetime laundering matches the field's TODO(port) note.
                        let remaining: &'static mut [u8] =
                            unsafe { mem::transmute::<&mut [u8], &'static mut [u8]>(&mut in_progress[buf.len()..]) };
                        self.read_inside_on_pull = ReadDuringJSOnPullResult::Js(remaining);
                    } else if !in_progress.is_empty() && !has_more {
                        // SAFETY: buf outlives the on_pull call that consumes this.
                        let temp: &'static [u8] = unsafe { mem::transmute(buf) };
                        self.read_inside_on_pull = ReadDuringJSOnPullResult::Temporary(temp);
                    } else if has_more && !bun_core::is_slice_in_buffer(buf, self.buffered.allocated_slice()) {
                        self.buffered.extend_from_slice(buf);
                        self.read_inside_on_pull = ReadDuringJSOnPullResult::UseBuffered(buf.len());
                    }
                }
                ReadDuringJSOnPullResult::UseBuffered(original) => {
                    let original = *original;
                    self.buffered.extend_from_slice(buf);
                    self.read_inside_on_pull = ReadDuringJSOnPullResult::UseBuffered(buf.len() + original);
                }
                ReadDuringJSOnPullResult::None => unreachable!(),
                _ => panic!("Invalid state"),
            }
        } else if self.pending.state == streams::result::PendingState::Pending {
            // Certain readers (such as pipes) may return 0-byte reads even when
            // not at EOF. Consequently, we need to check whether the reader is
            // actually done or not.
            if buf.is_empty() && state == ReadState::Drained {
                // If the reader is not done, we still want to keep reading.
                close_if_needed!();
                return true;
            }

            // PORT NOTE: reshaped for borrowck — Zig `defer { clear; run() }` becomes a
            // labeled block computing `ret`, then cleanup + run + return.
            let ret: bool = 'pending: {
                if buf.is_empty() {
                    if self.buffered.is_empty() {
                        self.buffered = Vec::new(); // clearAndFree
                        self.buffered = mem::take(reader_buffer); // moveToUnmanaged
                    }

                    // PORT NOTE: nested `defer buffer.clearAndFree` folded into the arms.
                    let mut buffer = mem::take(&mut self.buffered);
                    if !buffer.is_empty() {
                        if self.pending_view.len() >= buffer.len() {
                            self.pending_view[0..buffer.len()].copy_from_slice(&buffer);
                            self.pending.result = streams::Result::IntoArrayAndDone(streams::result::IntoArray {
                                value: self.pending_value.get().unwrap_or(JSValue::ZERO),
                                len: buffer.len() as u32, // @truncate
                            });
                            drop(buffer); // clearAndFree
                        } else {
                            self.pending.result =
                                streams::Result::OwnedAndDone(ByteList::move_from_vec(&mut buffer));
                            // buffer is now empty; drop is no-op
                        }
                    } else {
                        self.pending.result = streams::Result::Done;
                    }
                    break 'pending false;
                }

                let was_done = self.reader.is_done();

                if self.pending_view.len() >= buf.len() {
                    self.pending_view[0..buf.len()].copy_from_slice(buf);
                    reader_buffer.clear();
                    self.buffered.clear();

                    let into_array = streams::result::IntoArray {
                        value: self.pending_value.get().unwrap_or(JSValue::ZERO),
                        len: buf.len() as u32, // @truncate
                    };

                    self.pending.result = if was_done {
                        streams::Result::IntoArrayAndDone(into_array)
                    } else {
                        streams::Result::IntoArray(into_array)
                    };
                    break 'pending !was_done;
                }

                if bun_core::is_slice_in_buffer(buf, reader_buffer.allocated_slice()) {
                    if self.reader.is_done() {
                        debug_assert_eq!(buf.as_ptr(), reader_buffer.as_ptr());
                        let mut buffer = mem::take(reader_buffer);
                        buffer.truncate(buf.len()); // shrinkRetainingCapacity
                        self.pending.result =
                            streams::Result::OwnedAndDone(ByteList::move_from_vec(&mut buffer));
                    } else {
                        reader_buffer.clear();
                        self.pending.result =
                            streams::Result::Temporary(ByteList::from_borrowed_slice_dangerous(buf));
                    }
                    break 'pending !was_done;
                }

                if !bun_core::is_slice_in_buffer(buf, self.buffered.allocated_slice()) {
                    self.pending.result = if self.reader.is_done() {
                        streams::Result::TemporaryAndDone(ByteList::from_borrowed_slice_dangerous(buf))
                    } else {
                        streams::Result::Temporary(ByteList::from_borrowed_slice_dangerous(buf))
                    };
                    break 'pending !was_done;
                }

                debug_assert_eq!(buf.as_ptr(), self.buffered.as_ptr());
                let mut buffered = mem::take(&mut self.buffered);
                buffered.truncate(buf.len()); // shrinkRetainingCapacity

                self.pending.result = if self.reader.is_done() {
                    streams::Result::OwnedAndDone(ByteList::move_from_vec(&mut buffered))
                } else {
                    streams::Result::Owned(ByteList::move_from_vec(&mut buffered))
                };
                break 'pending !was_done;
            };

            self.pending_value.clear_without_deallocation();
            self.pending_view = &mut [];
            self.pending.run();
            close_if_needed!();
            return ret;
        } else if !bun_core::is_slice_in_buffer(buf, self.buffered.allocated_slice()) {
            self.buffered.extend_from_slice(buf);
            if bun_core::is_slice_in_buffer(buf, reader_buffer.allocated_slice()) {
                reader_buffer.clear();
            }
        }

        // For pipes, we have to keep pulling or the other process will block.
        let ret = !matches!(self.read_inside_on_pull, ReadDuringJSOnPullResult::Temporary(_))
            && !(self.buffered.len() + reader_buffer.len() >= self.highwater_mark
                && !self.reader.flags.pollable);
        close_if_needed!();
        ret
    }

    fn is_pulling(&self) -> bool {
        !self.read_inside_on_pull.is_none()
    }

    pub fn on_pull(&mut self, buffer: &'static mut [u8], array: JSValue) -> streams::Result {
        // TODO(port): lifetime — `buffer` borrows a JS typed array kept alive by `array`.
        array.ensure_still_alive();
        let _keep = EnsureStillAlive(array);
        let mut drained = self.drain();

        if drained.len > 0 {
            bun_output::scoped_log!(FileReader, "onPull({}) = {}", buffer.len(), drained.len);

            self.pending_value.clear_without_deallocation();
            self.pending_view = &mut [];

            if buffer.len() >= drained.len as usize {
                let drained_len = drained.len;
                buffer[0..drained_len as usize].copy_from_slice(drained.slice());
                // drain() moved ownership of the allocation into `drained` and
                // left `self.buffered` / the reader buffer empty, so free
                // `drained` here — freeing `self.buffered` would be a no-op.
                drained.deinit();

                if self.reader.is_done() {
                    return streams::Result::IntoArrayAndDone(streams::result::IntoArray {
                        value: array,
                        len: drained_len,
                    });
                } else {
                    return streams::Result::IntoArray(streams::result::IntoArray {
                        value: array,
                        len: drained_len,
                    });
                }
            }

            if self.reader.is_done() {
                return streams::Result::OwnedAndDone(drained);
            } else {
                return streams::Result::Owned(drained);
            }
        }

        if self.reader.is_done() {
            return streams::Result::Done;
        }

        if !self.reader.has_pending_read() {
            // If not flowing (paused), don't initiate new reads
            if !self.flowing {
                bun_output::scoped_log!(FileReader, "onPull({}) = pending (not flowing)", buffer.len());
                self.pending_value.set(self.parent().global_this(), array);
                self.pending_view = buffer;
                return streams::Result::Pending(&mut self.pending);
            }

            let buffer_len = buffer.len();
            self.read_inside_on_pull = ReadDuringJSOnPullResult::Js(buffer);
            self.reader.read();

            // PORT NOTE: Zig `defer this.read_inside_on_pull = .none` — replaced via
            // mem::replace so the field is reset before matching, covering all return paths.
            let pulled = mem::replace(&mut self.read_inside_on_pull, ReadDuringJSOnPullResult::None);
            match pulled {
                ReadDuringJSOnPullResult::Js(remaining_buf) => {
                    let amount_read = buffer_len - remaining_buf.len();

                    bun_output::scoped_log!(FileReader, "onPull({}) = {}", buffer_len, amount_read);

                    if amount_read > 0 {
                        if self.reader.is_done() {
                            return streams::Result::IntoArrayAndDone(streams::result::IntoArray {
                                value: array,
                                len: amount_read as u32, // @truncate
                            });
                        }

                        return streams::Result::IntoArray(streams::result::IntoArray {
                            value: array,
                            len: amount_read as u32, // @truncate
                        });
                    }

                    if self.reader.is_done() {
                        return streams::Result::Done;
                    }
                    // PORT NOTE: fallthrough — but `buffer` was moved into read_inside_on_pull.
                    // Recover it from `remaining_buf` (amount_read == 0 ⇒ same slice).
                    self.pending_value.set(self.parent().global_this(), array);
                    self.pending_view = remaining_buf;
                    bun_output::scoped_log!(FileReader, "onPull({}) = pending", buffer_len);
                    return streams::Result::Pending(&mut self.pending);
                }
                ReadDuringJSOnPullResult::Temporary(buf) => {
                    bun_output::scoped_log!(FileReader, "onPull({}) = {}", buffer_len, buf.len());
                    if self.reader.is_done() {
                        return streams::Result::TemporaryAndDone(ByteList::from_borrowed_slice_dangerous(buf));
                    }

                    return streams::Result::Temporary(ByteList::from_borrowed_slice_dangerous(buf));
                }
                ReadDuringJSOnPullResult::UseBuffered(_) => {
                    bun_output::scoped_log!(FileReader, "onPull({}) = {}", buffer_len, self.buffered.len());
                    if self.reader.is_done() {
                        return streams::Result::OwnedAndDone(ByteList::move_from_vec(&mut self.buffered));
                    }
                    return streams::Result::Owned(ByteList::move_from_vec(&mut self.buffered));
                }
                _ => {}
            }

            if self.reader.is_done() {
                bun_output::scoped_log!(FileReader, "onPull({}) = done", buffer_len);
                return streams::Result::Done;
            }

            // TODO(port): unreachable in practice — `buffer` was moved above and the only
            // non-returning fallthrough is the `_ => {}` arm (None/AmountRead), which the
            // Zig also falls through from. Zig reuses `buffer` here; we cannot. Phase B:
            // verify whether this path is reachable and, if so, recover the slice.
            self.pending_value.set(self.parent().global_this(), array);
            self.pending_view = &mut [];
            bun_output::scoped_log!(FileReader, "onPull({}) = pending", buffer_len);
            return streams::Result::Pending(&mut self.pending);
        }

        let buffer_len = buffer.len();
        self.pending_value.set(self.parent().global_this(), array);
        self.pending_view = buffer;

        bun_output::scoped_log!(FileReader, "onPull({}) = pending", buffer_len);

        streams::Result::Pending(&mut self.pending)
    }

    pub fn drain(&mut self) -> ByteList {
        if !self.buffered.is_empty() {
            let out = ByteList::move_from_vec(&mut self.buffered);
            if cfg!(debug_assertions) {
                debug_assert!(self.reader.buffer().as_ptr() != out.ptr);
            }
            return out;
        }

        if self.reader.has_pending_read() {
            return ByteList::default();
        }

        ByteList::move_from_vec(self.reader.buffer())
    }

    pub fn set_ref_or_unref(&mut self, enable: bool) {
        if self.done {
            return;
        }
        self.reader.update_ref(enable);
    }

    fn consume_reader_buffer(&mut self) {
        if self.buffered.capacity() == 0 {
            self.buffered = mem::take(self.reader.buffer());
        }
    }

    pub fn on_reader_done(&mut self) {
        bun_output::scoped_log!(FileReader, "onReaderDone()");
        if !self.is_pulling() {
            self.consume_reader_buffer();
            if self.pending.state == streams::result::PendingState::Pending {
                if !self.buffered.is_empty() {
                    self.pending.result =
                        streams::Result::OwnedAndDone(ByteList::move_from_vec(&mut self.buffered));
                } else {
                    self.pending.result = streams::Result::Done;
                }
                self.buffered = Vec::new();
                self.pending.run();
            }
            // Don't handle buffered data here - it will be returned on the next onPull
            // This ensures proper ordering of chunks
        }

        // Only close the stream if there's no buffered data left to deliver
        if self.buffered.is_empty() {
            self.parent().on_close();
        }
        if self.waiting_for_on_reader_done {
            self.waiting_for_on_reader_done = false;
            let _ = self.parent().decrement_count();
        }
    }

    pub fn on_reader_error(&mut self, err: sys::Error) {
        self.consume_reader_buffer();
        if self.buffered.capacity() > 0 && self.buffered.is_empty() {
            self.buffered = Vec::new();
        }

        self.pending.result = streams::Result::Err(streams::result::Err::Error(err));
        self.pending.run();
    }

    pub fn set_raw_mode(&mut self, flag: bool) -> sys::Result<()> {
        #[cfg(not(windows))]
        {
            // TODO(port): comptime string concat with Environment.os.displayString()
            panic!("FileReader.setRawMode must not be called on this platform");
        }
        #[cfg(windows)]
        {
            self.reader.set_raw_mode(flag)
        }
    }

    pub fn set_flowing(&mut self, flag: bool) {
        bun_output::scoped_log!(FileReader, "setFlowing({}) was={}", flag, self.flowing);

        if self.flowing == flag {
            return;
        }

        self.flowing = flag;

        if flag {
            self.reader.unpause();
            if !self.reader.is_done() && !self.reader.has_pending_read() {
                // Kick off a new read if needed
                self.reader.read();
            }
        } else {
            self.reader.pause();
        }
    }

    pub fn memory_cost(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(FileReader)
        self.reader.memory_cost() + self.buffered.capacity()
    }
}

// TODO(port): `ReadableStream.NewSource(@This(), "File", onStart, onPull, onCancel, deinit,
// setRefOrUnref, drain, memoryCost, null)` is a comptime type-generator that builds a
// vtable-backed Source struct embedding `context: FileReader`. In Rust this becomes a
// generic `Source<Ctx>` + a `SourceContext` trait impl. Sketch below; Phase B wires the
// trait in `readable_stream`.
pub type Source = readable_stream::Source<FileReader>;

impl readable_stream::SourceContext for FileReader {
    const NAME: &'static str = "File";
    fn on_start(&mut self) -> streams::Start { Self::on_start(self) }
    fn on_pull(&mut self, buf: &'static mut [u8], arr: JSValue) -> streams::Result { Self::on_pull(self, buf, arr) }
    fn on_cancel(&mut self) { Self::on_cancel(self) }
    fn deinit(&mut self) { Self::deinit(self) }
    fn set_ref_or_unref(&mut self, e: bool) { Self::set_ref_or_unref(self, e) }
    fn drain(&mut self) -> ByteList { Self::drain(self) }
    fn memory_cost(&self) -> usize { Self::memory_cost(self) }
    // toBufferedValue: null
}

// TODO(port): Vec<u8> has no `allocated_slice()`; helper trait providing
// `&v.as_ptr()[0..v.capacity()]` semantics needed for `is_slice_in_buffer` checks.
trait AllocatedSlice {
    fn allocated_slice(&self) -> &[u8];
}
impl AllocatedSlice for Vec<u8> {
    fn allocated_slice(&self) -> &[u8] {
        // SAFETY: bytes in [len, capacity) are uninitialized; this slice is only used for
        // pointer-range containment checks in `is_slice_in_buffer`, never read.
        unsafe { core::slice::from_raw_parts(self.as_ptr(), self.capacity()) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/FileReader.zig (682 lines)
//   confidence: medium
//   todos:      15
//   notes:      heavy defer/borrowck reshaping in on_read_chunk/on_pull; pending_view & ReadDuringJSOnPullResult use &'static slices as BACKREF placeholders; Arc<Store> needs interior mutability; Source vtable becomes trait impl
// ──────────────────────────────────────────────────────────────────────────
