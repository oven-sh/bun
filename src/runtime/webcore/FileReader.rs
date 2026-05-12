use core::cell::{Cell, UnsafeCell};
use core::mem;

use bun_collections::{ByteVecExt, VecExt};
use bun_io as aio;
use bun_io::{BufferedReader, FileType, ReadState};
use bun_jsc::JsCell;
use bun_ptr::AsCtxPtr;
use bun_sys::{self as sys, Fd, FdExt};

use crate::webcore::blob::{self, Blob};
use crate::webcore::jsc::{self as jsc, EventLoopHandle, JSValue};
use crate::webcore::jsc::{EnsureStillAlive, strong::Optional as Strong};
use crate::webcore::node_types::PathOrFileDescriptor;
use crate::webcore::readable_stream::{self, ReadableStream};
use crate::webcore::streams;

bun_core::declare_scope!(FileReader, visible);

// TODO(port): `pending_view` and the `Js`/`Temporary` variants below borrow into a
// JS-owned typed-array buffer kept alive by `pending_value: Strong` / `ensure_still_alive`.
// Represented as unbounded `&mut [u8]` / `&[u8]` here to keep function bodies
// readable; Phase B should replace with a proper raw-slice wrapper (BACKREF lifetime).

// R-2 (host-fn re-entrancy): every JS-exposed / vtable-reachable method takes
// `&self`; per-field interior mutability via `Cell` (Copy) / `JsCell` (non-
// Copy). The `SourceContext` trait and `BufferedReaderParent` shims still
// hand in `&mut Self` / `*mut Self` until those layers are migrated — `&mut T`
// auto-derefs to `&T` so the impls below compile against either. `Cell<T>` and
// `JsCell<T>` are both `#[repr(transparent)]`, so the embedded layout (offset
// 0 of `NewSource<FileReader>`) is unchanged.
pub struct FileReader {
    /// Wrapped in `UnsafeCell` so that the back-ref `*mut FileReader` (vtable
    /// `parent`) and the reader's own `&mut self` both derive from a
    /// SharedReadWrite root — see `BufferedReaderParent` aliasing contract
    /// (PipeReader.rs). The vtable callbacks fire while a `&mut BufferedReader`
    /// is live on the caller's stack and re-enter `self.reader` (close/buffer/
    /// is_done); without `UnsafeCell` materializing `&mut FileReader` there is
    /// Stacked-Borrows UB. Matches sibling `IOReader` (shell) port.
    pub reader: UnsafeCell<IOReader>,
    pub done: Cell<bool>,
    pub pending: JsCell<streams::Pending>,
    pub pending_value: JsCell<Strong>, // Strong.Optional
    // TODO(port): `&'static mut [u8]` forge — borrows a JS typed-array buffer
    // that GC can move/collect, and `&'static mut` asserts uniqueness the GC
    // does not honour. `bun_ptr::Interned` is read-only by construction so
    // does NOT cover this; tracked under the sibling `static-widen-mut`
    // pattern (field should become `*mut [u8]` / `RawSliceMut<u8>`).
    pub pending_view: JsCell<&'static mut [u8]>,
    pub fd: Cell<Fd>,
    /// Read-only after construction (set via struct literal in `from_blob_*`).
    pub start_offset: Option<usize>,
    /// Read-only after construction.
    pub max_size: Option<usize>,
    pub total_readed: Cell<usize>,
    pub started: Cell<bool>,
    pub waiting_for_on_reader_done: Cell<bool>,
    pub event_loop: Cell<EventLoopHandle>,
    pub lazy: JsCell<Lazy>,
    pub buffered: JsCell<Vec<u8>>,
    pub read_inside_on_pull: JsCell<ReadDuringJSOnPullResult>,
    /// Read-only after construction.
    pub highwater_mark: usize,
    pub flowing: Cell<bool>,
}

impl Default for FileReader {
    fn default() -> Self {
        Self {
            reader: UnsafeCell::new(IOReader::init::<FileReader>()),
            done: Cell::new(false),
            pending: JsCell::new(streams::Pending::default()),
            pending_value: JsCell::new(Strong::empty()),
            pending_view: JsCell::new(&mut []),
            fd: Cell::new(Fd::INVALID),
            start_offset: None,
            max_size: None,
            total_readed: Cell::new(0),
            started: Cell::new(false),
            waiting_for_on_reader_done: Cell::new(false),
            // TODO(port): event_loop has no Zig default; callers must overwrite before use
            event_loop: Cell::new(EventLoopHandle::init(core::ptr::null_mut())),
            lazy: JsCell::new(Lazy::None),
            buffered: JsCell::new(Vec::new()),
            read_inside_on_pull: JsCell::new(ReadDuringJSOnPullResult::None),
            highwater_mark: 16384,
            flowing: Cell::new(true),
        }
    }
}

pub type IOReader = BufferedReader;
pub type Poll = IOReader;
pub const TAG: readable_stream::Tag = readable_stream::Tag::File;

#[derive(strum::IntoStaticStr)]
pub enum ReadDuringJSOnPullResult {
    None,
    // TODO(port): `&'static mut` forge — sibling `static-widen-mut` pattern;
    // see note on `FileReader::pending_view`.
    Js(&'static mut [u8]),
    AmountRead(usize),
    /// Borrows the reader/JS buffer for the duration of one `on_pull` call
    /// only. Holder-lifetime, not process-lifetime — `RawSlice<u8>` per
    /// `bun_ptr::Interned` Population-B triage.
    Temporary(bun_ptr::RawSlice<u8>),
    UseBuffered(usize),
}

impl ReadDuringJSOnPullResult {
    fn is_none(&self) -> bool {
        matches!(self, Self::None)
    }
}

pub enum Lazy {
    None,
    /// Intrusively-refcounted `*Blob.Store`. Uses `StoreRef` (not `Arc`) so the
    /// raw pointer carries mutable provenance from `heap::alloc`, matching
    /// Zig's `*Blob.Store` direct-field-write usage in `openFileBlob`.
    Blob(blob::StoreRef),
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
    pub safe fn open_as_nonblocking_tty(fd: i32, flags: i32) -> i32;
}

impl Lazy {
    pub fn open_file_blob(file: &mut blob::store::File) -> sys::Result<OpenedFileBlob> {
        let mut this = OpenedFileBlob {
            fd: Fd::INVALID,
            ..Default::default()
        };
        let mut file_buf = bun_paths::PathBuffer::uninit();
        let mut is_nonblocking = false;

        let fd: Fd = match &file.pathlike {
            PathOrFileDescriptor::Fd(pl_fd) => {
                if pl_fd.stdio_tag().is_some() {
                    'brk: {
                        #[cfg(unix)]
                        {
                            let rc = open_as_nonblocking_tty(pl_fd.native(), sys::O::RDONLY);
                            if rc > -1 {
                                is_nonblocking = true;
                                file.is_atty = Some(true);
                                break 'brk Fd::from_native(rc);
                            }
                        }
                        break 'brk *pl_fd;
                    }
                } else {
                    let duped = sys::dup_with_flags(*pl_fd, 0);

                    let fd: Fd = match duped {
                        Ok(fd) => fd,
                        Err(err) => return Err(err.with_fd(*pl_fd)),
                    };

                    #[cfg(unix)]
                    {
                        if fd.stdio_tag().is_none() {
                            is_nonblocking = match sys::get_fcntl_flags(fd) {
                                Ok(flags) => (flags & sys::O::NONBLOCK as isize) != 0,
                                Err(_) => false,
                            };
                        }
                    }

                    match fd
                        .make_lib_uv_owned_for_syscall(sys::Tag::dup, sys::ErrorCase::CloseOnFail)
                    {
                        Ok(owned_fd) => owned_fd,
                        Err(err) => return Err(err),
                    }
                }
            }
            PathOrFileDescriptor::Path(path) => {
                match sys::open(
                    bun_paths::resolve_path::z(path.slice(), &mut file_buf),
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
                        return Err(err.with_path(path.slice()));
                    }
                }
            }
        };

        #[cfg(unix)]
        {
            if file.is_atty.unwrap_or(false)
                || (fd.stdio_tag().is_some() && sys::isatty(fd))
                || (matches!(&file.pathlike, PathOrFileDescriptor::Fd(pl_fd)
                        if pl_fd.stdio_tag().is_some() && sys::isatty(*pl_fd)))
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

            let mode = stat.st_mode as _;
            if sys::S::ISDIR(mode) {
                aio::Closer::close(fd, ());
                return Err(sys::Error::from_code(sys::Errno::EISDIR, sys::Tag::fstat));
            }

            if sys::S::ISREG(mode) {
                is_nonblocking = false;
            }

            // sys.zig:isPollable — `S.ISFIFO(mode) or S.ISSOCK(mode)`
            this.pollable = (sys::S::ISFIFO(mode) || sys::S::ISSOCK(mode))
                || is_nonblocking
                || file.is_atty.unwrap_or(false);
            this.file_type = if sys::S::ISFIFO(mode) {
                FileType::Pipe
            } else if sys::S::ISSOCK(mode) {
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

// `bun.io.BufferedReader.init(@This())` — vtable parent. Maps the Zig
// `onReadChunk`/`onReaderDone`/`onReaderError`/`loop`/`eventLoop` decls.
//
// R-2: every mutated field on `FileReader` is `Cell`/`JsCell`/`UnsafeCell`-
// backed, so materializing `&FileReader` via `(&*this)` does not assert Unique
// over any byte the caller may have borrowed (SharedReadWrite root); the
// inherent impls re-derive any reader access through `reader()`
// (`UnsafeCell::get`).
bun_io::impl_buffered_reader_parent! {
    FileReader for FileReader;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, state| (&*this).on_read_chunk(chunk, state);
    on_reader_done  = |this| (&*this).on_reader_done();
    on_reader_error = |this, err| (&*this).on_reader_error(err);
    loop_ = |this| {
        let ev = (&*this).event_loop.get();
        // Spec FileReader.zig:163: `this.eventLoop().loop()` → libuv
        // `uv_loop_t*` on Windows. `.cast()` reconciles the impl-declared
        // `bun_uws_sys::Loop` nominal with `bun_io::Loop` (= `uv::Loop`).
        #[cfg(windows)] { ev.uv_loop().cast() }
        #[cfg(not(windows))] { ev.r#loop() }
    };
    event_loop = |this| (&*this).event_loop.get().as_event_loop_ctx();
}

impl FileReader {
    /// SharedReadWrite accessor for the embedded `BufferedReader`. See the
    /// `UnsafeCell` note on the field declaration — this is the single point
    /// through which all `self.reader` access flows so vtable-callback
    /// re-entrancy and outer `&mut FileReader` borrows both root at the cell.
    /// SAFETY: single-threaded; matches Zig `*FileReader` aliasing model.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn reader(&self) -> &mut IOReader {
        unsafe { &mut *self.reader.get() }
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        self.event_loop.get()
    }

    /// Returns the platform's `bun.Async.Loop` (`uv_loop_t*` on Windows,
    /// `us_loop_t*` on POSIX). See `aio/{posix,windows}_event_loop.rs`.
    pub fn loop_(&self) -> *mut bun_io::Loop {
        self.event_loop().native_loop()
    }

    // TODO(port): in-place init — `self` is the `context` field of an already-allocated
    // `Source`; the Zig writes `this.* = FileReader{...}` then reads `parent()`. Note the
    // Zig struct literal omits `event_loop` (no default) — likely dead code or relies on
    // a quirk; preserved as-is.
    // R-2: kept `&mut self` — init-time constructor that runs before any
    // host-fn could re-enter; `*self =` requires unique access.
    pub fn setup(&mut self, fd: Fd) {
        *self = FileReader {
            reader: UnsafeCell::new(IOReader::init::<FileReader>()),
            done: Cell::new(false),
            fd: Cell::new(fd),
            ..Default::default()
        };

        // `bun_vm()` returns a raw `*mut VirtualMachine` (never null for a Bun
        // global); deref to call `event_loop()`.
        let global = self.parent_global();
        self.event_loop.set(EventLoopHandle::init(
            global.bun_vm().as_mut().event_loop().cast::<()>(),
        ));
    }

    pub fn on_start(&self) -> streams::Start {
        self.reader().set_parent(self.as_ctx_ptr().cast());
        let was_lazy = !matches!(self.lazy.get(), Lazy::None);
        let mut pollable = false;
        let mut file_type = FileType::File;
        // R-2: move the `Lazy` out of the cell up-front (it's reset to `None`
        // on every path through the original `if let` body) so the `StoreRef`
        // is owned locally and the cell borrow is released immediately.
        if let Lazy::Blob(store) = self.lazy.replace(Lazy::None) {
            // `StoreRef::data_mut` encapsulates the raw-pointer deref under the
            // `StoreRef` liveness invariant (single-threaded JS event loop; we
            // hold the only mutating handle). Matches Zig's `*Blob.Store`
            // direct field access.
            match store.data_mut() {
                blob::store::Data::S3(_) | blob::store::Data::Bytes(_) => {
                    panic!("Invalid state in FileReader: expected file ")
                }
                blob::store::Data::File(file) => {
                    // PORT NOTE: reshaped for borrowck — Zig `defer { deref; lazy = none }`
                    // is hoisted after the match below since both arms fall through.
                    let open_result = Lazy::open_file_blob(file);
                    // drop the StoreRef (Zig: this.lazy.blob.deref()); `lazy` was already cleared above
                    drop(store);
                    match open_result {
                        Err(err) => {
                            self.fd.set(Fd::INVALID);
                            return streams::Start::Err(err);
                        }
                        Ok(opened) => {
                            debug_assert!(opened.fd.is_valid());
                            self.fd.set(opened.fd);
                            pollable = opened.pollable;
                            file_type = opened.file_type;
                            #[cfg(unix)]
                            {
                                use bun_io::pipe_reader::PosixFlags;
                                self.reader()
                                    .flags
                                    .set(PosixFlags::NONBLOCKING, opened.nonblocking);
                                self.reader().flags.set(PosixFlags::POLLABLE, pollable);
                            }
                            #[cfg(windows)]
                            {
                                use bun_io::pipe_reader::WindowsFlags;
                                self.reader()
                                    .flags
                                    .set(WindowsFlags::NONBLOCKING, opened.nonblocking);
                                self.reader().flags.set(WindowsFlags::POLLABLE, pollable);
                            }
                        }
                    }
                }
            }
        }

        {
            let reader_fd = self.reader().get_fd();
            if reader_fd != Fd::INVALID && self.fd.get() == Fd::INVALID {
                self.fd.set(reader_fd);
            }
        }

        // `bun_vm()` returns a raw `*mut VirtualMachine` (never null for a Bun
        // global); deref to call `event_loop()`.
        {
            let global = self.parent_global();
            self.event_loop.set(EventLoopHandle::init(
                global.bun_vm().as_mut().event_loop().cast::<()>(),
            ));
        }

        if was_lazy {
            // SAFETY: see `parent()`.
            unsafe { (*self.parent()).increment_count() };
            self.waiting_for_on_reader_done.set(true);
            if let Some(offset) = self.start_offset {
                match self
                    .reader()
                    .start_file_offset(self.fd.get(), pollable, offset)
                {
                    Ok(()) => {}
                    Err(e) => return streams::Start::Err(e),
                }
            } else {
                match self.reader().start(self.fd.get(), pollable) {
                    Ok(()) => {}
                    Err(e) => return streams::Start::Err(e),
                }
            }
        } else {
            #[cfg(unix)]
            {
                use bun_io::pipe_reader::PosixFlags;
                if self.reader().flags.contains(PosixFlags::POLLABLE) && !self.reader().is_done() {
                    self.waiting_for_on_reader_done.set(true);
                    // SAFETY: see `parent()`.
                    unsafe { (*self.parent()).increment_count() };
                }
            }
        }

        #[cfg(unix)]
        {
            use bun_io::pipe_reader::PosixFlags;
            if file_type == FileType::Socket {
                self.reader().flags.insert(PosixFlags::SOCKET);
            }

            let r = self.reader();
            if let Some(poll) = r.handle.get_poll() {
                // `bun_io::FilePoll` is an opaque vtable wrapper; flag
                // mutation goes through `set_flag(FilePollFlag)` instead of the
                // direct `aio::FilePoll.flags.insert(...)` field write in Zig.
                if file_type == FileType::Socket || r.flags.contains(PosixFlags::SOCKET) {
                    poll.set_flag(bun_io::FilePollFlag::Socket);
                } else {
                    // if it's a TTY, we report it as a fifo
                    // we want the behavior to be as though it were a blocking pipe.
                    poll.set_flag(bun_io::FilePollFlag::Fifo);
                }

                if r.flags.contains(PosixFlags::NONBLOCKING) {
                    poll.set_flag(bun_io::FilePollFlag::Nonblocking);
                }
            }
        }

        self.started.set(true);

        if self.reader().is_done() {
            self.consume_reader_buffer();
            if !self.buffered.get().is_empty() {
                return streams::Start::OwnedAndDone(Vec::<u8>::move_from_list(
                    self.buffered.replace(Vec::new()),
                ));
            }
        } else {
            #[cfg(unix)]
            {
                use bun_io::pipe_reader::PosixFlags;
                if !was_lazy && self.reader().flags.contains(PosixFlags::POLLABLE) {
                    self.reader().read();
                }
            }
        }

        streams::Start::Ready
    }

    /// Safe accessor for the parent `NewSource.global_this` back-reference.
    ///
    /// One unsafe (`from_field_ptr` raw-place projection of a `Copy` field —
    /// no `&Source` is materialized so no aliasing with `&self`); callers
    /// then `Deref` the returned `BackRef` with no unsafe.
    #[inline]
    fn parent_global(&self) -> bun_ptr::BackRef<jsc::JSGlobalObject> {
        // SAFETY: see `parent()` — `self` is the `context` field of a live
        // heap-allocated `Source`. Reading the `Copy` `global_this` via
        // `(*ptr).field` is a raw-place read, not a `&Source` borrow.
        unsafe { (*self.parent()).global_this }.expect("NewSource.global_this set before use")
    }

    pub fn on_cancel(&self) {
        if self.done.get() {
            return;
        }
        self.done.set(true);
        self.reader().update_ref(false);
        if !self.reader().is_done() {
            self.reader().close();
        }
    }

    // NOTE: not `impl Drop` — FileReader is embedded as `Source.context` and this is
    // invoked from the Source's JS finalizer path via `SourceContext::deinit_fn`.
    // Not `pub`: reached only via the `SourceContext` trait impl below.
    //
    // Only side-effect teardown lives here. Owned fields (buffered: Vec, reader:
    // BufferedReader, pending_value: Strong, lazy: Arc) drop when the caller
    // (`NewSource::decrement_count`) reclaims the `Box<Source>` *after* this
    // returns. Freeing the parent here (Zig: `this.parent().deinit()`) would
    // deallocate the storage backing `&self` while the borrow is still live
    // — a dangling-reference UAF — so ownership release stays with the caller.
    fn deinit(&self) {
        self.reader().update_ref(false);
    }

    #[inline]
    fn reader_is_pollable(&self) -> bool {
        #[cfg(unix)]
        {
            self.reader()
                .flags
                .contains(bun_io::pipe_reader::PosixFlags::POLLABLE)
        }
        #[cfg(windows)]
        {
            self.reader()
                .flags
                .contains(bun_io::pipe_reader::WindowsFlags::POLLABLE)
        }
    }

    pub fn on_read_chunk(&self, init_buf: &[u8], state: ReadState) -> bool {
        let mut buf = init_buf;
        bun_core::scoped_log!(
            FileReader,
            "onReadChunk() = {} ({}) - read_inside_on_pull: {}",
            buf.len(),
            read_state_tag(state),
            <&'static str>::from(self.read_inside_on_pull.get())
        );

        if self.done.get() {
            self.reader().close();
            return false;
        }
        let mut close = false;
        // PORT NOTE: Zig `defer if (close) this.reader.close();` — handled at each return
        // site below via `close_if_needed`. Reshaped for borrowck (scopeguard would alias &mut self).
        macro_rules! close_if_needed {
            () => {
                if close {
                    self.reader().close();
                }
            };
        }
        let mut has_more = state != ReadState::Eof;

        if !buf.is_empty() {
            if let Some(max_size) = self.max_size {
                let total_readed = self.total_readed.get();
                if total_readed >= max_size {
                    return false;
                }
                let len = (max_size - total_readed).min(buf.len());
                if buf.len() > len {
                    buf = &buf[0..len];
                }
                self.total_readed.set(total_readed + len);

                if buf.is_empty() {
                    close = true;
                    has_more = false;
                }
            }
        }

        // Kept as a RAW `*mut Vec<u8>` for the lifetime of this fn — never bound to a
        // long-lived `&mut Vec<u8>`. `reader_buffer` points inside `self.reader` while
        // we still hold `&self` and mutate `self.buffered`/`self.pending` etc.
        // interleaved with reads/clears of `*reader_buffer`. Holding a `&mut Vec` here
        // would be the aliased-&mut forbidden pattern (PORTING.md §Forbidden patterns).
        // Spec FileReader.zig:337 `const reader_buffer = this.reader.buffer();` is a Zig
        // raw `*std.ArrayList(u8)` with no aliasing rules; we mirror that with a raw ptr
        // and deref only at the exact use sites below.
        let reader_buffer: *mut Vec<u8> = self.reader().buffer();

        if !self.read_inside_on_pull.get().is_none() {
            // R-2: `with_mut` projects `&mut ReadDuringJSOnPullResult` from
            // `&self`; `self.buffered` is a disjoint `JsCell` so nested access
            // inside the closure is sound.
            self.read_inside_on_pull.with_mut(|riop| match riop {
                ReadDuringJSOnPullResult::Js(in_progress) => {
                    if in_progress.len() >= buf.len() && !has_more {
                        in_progress[0..buf.len()].copy_from_slice(buf);
                        // SAFETY: lifetime laundering matches the field's TODO(port) note.
                        let remaining =
                            unsafe { &mut *(&mut in_progress[buf.len()..] as *mut [u8]) };
                        *riop = ReadDuringJSOnPullResult::Js(remaining);
                    } else if !in_progress.is_empty() && !has_more {
                        // `buf` outlives the `on_pull` call that consumes this
                        // variant; holder-lifetime, encoded as `RawSlice<u8>`.
                        *riop = ReadDuringJSOnPullResult::Temporary(bun_ptr::RawSlice::new(buf));
                    } else if has_more && !is_slice_in_vec_capacity(buf, self.buffered.get()) {
                        self.buffered.with_mut(|b| b.extend_from_slice(buf));
                        *riop = ReadDuringJSOnPullResult::UseBuffered(buf.len());
                    }
                }
                ReadDuringJSOnPullResult::UseBuffered(original) => {
                    let original = *original;
                    self.buffered.with_mut(|b| b.extend_from_slice(buf));
                    *riop = ReadDuringJSOnPullResult::UseBuffered(buf.len() + original);
                }
                ReadDuringJSOnPullResult::None => unreachable!(),
                _ => panic!("Invalid state"),
            });
        } else if self.pending.get().state == streams::PendingState::Pending {
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
                    if self.buffered.get().is_empty() {
                        self.buffered.set(Vec::new()); // clearAndFree
                        // SAFETY: see `reader_buffer` decl — tight deref, no &mut held across.
                        self.buffered.set(unsafe { mem::take(&mut *reader_buffer) }); // moveToUnmanaged
                    }

                    // PORT NOTE: nested `defer buffer.clearAndFree` folded into the arms.
                    let mut buffer = self.buffered.replace(Vec::new());
                    if !buffer.is_empty() {
                        if self.pending_view.get().len() >= buffer.len() {
                            self.pending_view
                                .with_mut(|v| v[0..buffer.len()].copy_from_slice(&buffer));
                            self.pending.with_mut(|p| {
                                p.result = streams::Result::IntoArrayAndDone(streams::IntoArray {
                                    value: self.pending_value.get().get().unwrap_or(JSValue::ZERO),
                                    len: buffer.len() as u64, // @truncate
                                })
                            });
                            drop(buffer); // clearAndFree
                        } else {
                            self.pending.with_mut(|p| {
                                p.result =
                                    streams::Result::OwnedAndDone(Vec::<u8>::move_from_list(buffer))
                            });
                        }
                    } else {
                        self.pending.with_mut(|p| p.result = streams::Result::Done);
                    }
                    break 'pending false;
                }

                let was_done = self.reader().is_done();

                if self.pending_view.get().len() >= buf.len() {
                    self.pending_view
                        .with_mut(|v| v[0..buf.len()].copy_from_slice(buf));
                    // SAFETY: see `reader_buffer` decl.
                    unsafe { (*reader_buffer).clear() };
                    self.buffered.with_mut(|b| b.clear());

                    let into_array = streams::IntoArray {
                        value: self.pending_value.get().get().unwrap_or(JSValue::ZERO),
                        len: buf.len() as u64, // @truncate
                    };

                    self.pending.with_mut(|p| {
                        p.result = if was_done {
                            streams::Result::IntoArrayAndDone(into_array)
                        } else {
                            streams::Result::IntoArray(into_array)
                        }
                    });
                    break 'pending !was_done;
                }

                // SAFETY: see `reader_buffer` decl — tight deref.
                if is_slice_in_vec_capacity(buf, unsafe { &*reader_buffer }) {
                    if self.reader().is_done() {
                        // SAFETY: see `reader_buffer` decl.
                        debug_assert_eq!(buf.as_ptr(), unsafe { (*reader_buffer).as_ptr() });
                        let mut buffer = unsafe { mem::take(&mut *reader_buffer) };
                        buffer.truncate(buf.len()); // shrinkRetainingCapacity
                        self.pending.with_mut(|p| {
                            p.result =
                                streams::Result::OwnedAndDone(Vec::<u8>::move_from_list(buffer))
                        });
                    } else {
                        // SAFETY: see `reader_buffer` decl.
                        unsafe { (*reader_buffer).clear() };
                        self.pending.with_mut(|p| {
                            p.result = streams::Result::Temporary(bun_ptr::RawSlice::new(buf))
                        });
                    }
                    break 'pending !was_done;
                }

                if !is_slice_in_vec_capacity(buf, self.buffered.get()) {
                    self.pending.with_mut(|p| {
                        p.result = if self.reader().is_done() {
                            streams::Result::TemporaryAndDone(bun_ptr::RawSlice::new(buf))
                        } else {
                            streams::Result::Temporary(bun_ptr::RawSlice::new(buf))
                        }
                    });
                    break 'pending !was_done;
                }

                debug_assert_eq!(buf.as_ptr(), self.buffered.get().as_ptr());
                let mut buffered = self.buffered.replace(Vec::new());
                buffered.truncate(buf.len()); // shrinkRetainingCapacity

                self.pending.with_mut(|p| {
                    p.result = if self.reader().is_done() {
                        streams::Result::OwnedAndDone(Vec::<u8>::move_from_list(buffered))
                    } else {
                        streams::Result::Owned(Vec::<u8>::move_from_list(buffered))
                    }
                });
                break 'pending !was_done;
            };

            self.pending_value
                .with_mut(|p| p.clear_without_deallocation());
            self.pending_view.set(&mut []);
            self.pending.with_mut(|p| p.run());
            close_if_needed!();
            return ret;
        } else if !is_slice_in_vec_capacity(buf, self.buffered.get()) {
            self.buffered.with_mut(|b| b.extend_from_slice(buf));
            // SAFETY: see `reader_buffer` decl.
            if is_slice_in_vec_capacity(buf, unsafe { &*reader_buffer }) {
                unsafe { (*reader_buffer).clear() };
            }
        }

        // For pipes, we have to keep pulling or the other process will block.
        // SAFETY: see `reader_buffer` decl.
        let reader_buffer_len = unsafe { (*reader_buffer).len() };
        let ret = !matches!(
            self.read_inside_on_pull.get(),
            ReadDuringJSOnPullResult::Temporary(_)
        ) && !(self.buffered.get().len() + reader_buffer_len >= self.highwater_mark
            && !self.reader_is_pollable());
        close_if_needed!();
        ret
    }

    fn is_pulling(&self) -> bool {
        !self.read_inside_on_pull.get().is_none()
    }

    pub fn on_pull(&self, buffer: &'static mut [u8], array: JSValue) -> streams::Result {
        // TODO(port): lifetime — `buffer` borrows a JS typed array kept alive by `array`.
        array.ensure_still_alive();
        let _keep = EnsureStillAlive(array);
        let mut drained = self.drain();

        if drained.len() > 0 {
            bun_core::scoped_log!(FileReader, "onPull({}) = {}", buffer.len(), drained.len());

            self.pending_value
                .with_mut(|p| p.clear_without_deallocation());
            self.pending_view.set(&mut []);

            if buffer.len() >= drained.len() as usize {
                let drained_len = drained.len();
                buffer[0..drained_len as usize].copy_from_slice(drained.slice());
                // drain() moved ownership of the allocation into `drained` and
                // left `self.buffered` / the reader buffer empty, so free
                // `drained` here — freeing `self.buffered` would be a no-op.
                drop(drained);

                if self.reader().is_done() {
                    return streams::Result::IntoArrayAndDone(streams::IntoArray {
                        value: array,
                        len: drained_len as u64,
                    });
                } else {
                    return streams::Result::IntoArray(streams::IntoArray {
                        value: array,
                        len: drained_len as u64,
                    });
                }
            }

            if self.reader().is_done() {
                return streams::Result::OwnedAndDone(drained);
            } else {
                return streams::Result::Owned(drained);
            }
        }

        if self.reader().is_done() {
            return streams::Result::Done;
        }

        if !self.reader().has_pending_read() {
            // If not flowing (paused), don't initiate new reads
            if !self.flowing.get() {
                bun_core::scoped_log!(
                    FileReader,
                    "onPull({}) = pending (not flowing)",
                    buffer.len()
                );
                let global = self.parent_global();
                self.pending_value.with_mut(|p| p.set(&global, array));
                self.pending_view.set(buffer);
                return streams::Result::Pending(self.pending.as_ptr());
            }

            let buffer_len = buffer.len();
            self.read_inside_on_pull
                .set(ReadDuringJSOnPullResult::Js(buffer));
            self.reader().read();

            // PORT NOTE: Zig `defer this.read_inside_on_pull = .none` — replaced via
            // replace so the field is reset before matching, covering all return paths.
            let pulled = self
                .read_inside_on_pull
                .replace(ReadDuringJSOnPullResult::None);
            match pulled {
                ReadDuringJSOnPullResult::Js(remaining_buf) => {
                    let amount_read = buffer_len - remaining_buf.len();

                    bun_core::scoped_log!(FileReader, "onPull({}) = {}", buffer_len, amount_read);

                    if amount_read > 0 {
                        if self.reader().is_done() {
                            return streams::Result::IntoArrayAndDone(streams::IntoArray {
                                value: array,
                                len: amount_read as u64, // @truncate
                            });
                        }

                        return streams::Result::IntoArray(streams::IntoArray {
                            value: array,
                            len: amount_read as u64, // @truncate
                        });
                    }

                    if self.reader().is_done() {
                        return streams::Result::Done;
                    }
                    // PORT NOTE: fallthrough — but `buffer` was moved into read_inside_on_pull.
                    // Recover it from `remaining_buf` (amount_read == 0 ⇒ same slice).
                    let global = self.parent_global();
                    self.pending_value.with_mut(|p| p.set(&global, array));
                    self.pending_view.set(remaining_buf);
                    bun_core::scoped_log!(FileReader, "onPull({}) = pending", buffer_len);
                    return streams::Result::Pending(self.pending.as_ptr());
                }
                ReadDuringJSOnPullResult::Temporary(buf) => {
                    bun_core::scoped_log!(FileReader, "onPull({}) = {}", buffer_len, buf.len());
                    if self.reader().is_done() {
                        return streams::Result::TemporaryAndDone(buf);
                    }

                    return streams::Result::Temporary(buf);
                }
                ReadDuringJSOnPullResult::UseBuffered(_) => {
                    bun_core::scoped_log!(
                        FileReader,
                        "onPull({}) = {}",
                        buffer_len,
                        self.buffered.get().len()
                    );
                    let buffered = self.buffered.replace(Vec::new());
                    if self.reader().is_done() {
                        return streams::Result::OwnedAndDone(Vec::<u8>::move_from_list(buffered));
                    }
                    return streams::Result::Owned(Vec::<u8>::move_from_list(buffered));
                }
                _ => {
                    // Spec FileReader.zig:544 `else => {}` falls through to set
                    // `pending_view = buffer`. The only variants reaching this arm
                    // are `None` (impossible — we just stored `Js(buffer)` above and
                    // `on_read_chunk` never sets `None`) and `AmountRead` (never
                    // produced by `on_read_chunk`). Unreachable in the current state
                    // machine; if that invariant ever changes, the buffer slice must
                    // be recovered from a captured raw ptr+len before the move.
                    unreachable!(
                        "on_read_chunk never yields None/AmountRead while read_inside_on_pull == Js"
                    );
                }
            }
        }

        let buffer_len = buffer.len();
        let global = self.parent_global();
        self.pending_value.with_mut(|p| p.set(&global, array));
        self.pending_view.set(buffer);

        bun_core::scoped_log!(FileReader, "onPull({}) = pending", buffer_len);

        streams::Result::Pending(self.pending.as_ptr())
    }

    pub fn drain(&self) -> Vec<u8> {
        if !self.buffered.get().is_empty() {
            let out = Vec::<u8>::move_from_list(self.buffered.replace(Vec::new()));
            if cfg!(debug_assertions) {
                debug_assert!(self.reader().buffer().as_ptr() != out.as_ptr());
            }
            return out;
        }

        if self.reader().has_pending_read() {
            return Vec::<u8>::default();
        }

        Vec::<u8>::move_from_list(mem::take(self.reader().buffer()))
    }

    pub fn set_ref_or_unref(&self, enable: bool) {
        if self.done.get() {
            return;
        }
        self.reader().update_ref(enable);
    }

    fn consume_reader_buffer(&self) {
        if self.buffered.get().capacity() == 0 {
            self.buffered.set(mem::take(self.reader().buffer()));
        }
    }

    pub fn on_reader_done(&self) {
        bun_core::scoped_log!(FileReader, "onReaderDone()");
        if !self.is_pulling() {
            self.consume_reader_buffer();
            if self.pending.get().state == streams::PendingState::Pending {
                if !self.buffered.get().is_empty() {
                    let buffered = self.buffered.replace(Vec::new());
                    self.pending.with_mut(|p| {
                        p.result =
                            streams::Result::OwnedAndDone(Vec::<u8>::move_from_list(buffered))
                    });
                } else {
                    self.pending.with_mut(|p| p.result = streams::Result::Done);
                }
                self.buffered.set(Vec::new());
                self.pending.with_mut(|p| p.run());
            }
            // Don't handle buffered data here - it will be returned on the next onPull
            // This ensures proper ordering of chunks
        }

        // Only close the stream if there's no buffered data left to deliver
        if self.buffered.get().is_empty() {
            // SAFETY: see `parent()`.
            unsafe { (*self.parent()).on_close() };
        }
        if self.waiting_for_on_reader_done.get() {
            self.waiting_for_on_reader_done.set(false);
            let parent = self.parent();
            // SAFETY: `parent` was produced by `Source::new` (`Box::into_raw`).
            // Tail position — `self` (a field of `*parent`) is not accessed
            // after this call, which may free the allocation when the refcount
            // hits zero.
            let _ = unsafe { Source::decrement_count(parent) };
        }
    }

    pub fn on_reader_error(&self, err: sys::Error) {
        self.consume_reader_buffer();
        if self.buffered.get().capacity() > 0 && self.buffered.get().is_empty() {
            self.buffered.set(Vec::new());
        }

        self.pending.with_mut(|p| {
            p.result = streams::Result::Err(streams::StreamError::Error(err));
        });
        self.pending.with_mut(|p| p.run());
    }

    pub fn set_raw_mode(&self, flag: bool) -> sys::Result<()> {
        #[cfg(not(windows))]
        {
            // TODO(port): comptime string concat with Environment.os.displayString()
            panic!("FileReader.setRawMode must not be called on this platform");
        }
        #[cfg(windows)]
        {
            self.reader().set_raw_mode(flag)
        }
    }

    pub fn set_flowing(&self, flag: bool) {
        bun_core::scoped_log!(
            FileReader,
            "setFlowing({}) was={}",
            flag,
            self.flowing.get()
        );

        if self.flowing.get() == flag {
            return;
        }

        self.flowing.set(flag);

        if flag {
            self.reader().unpause();
            if !self.reader().is_done() && !self.reader().has_pending_read() {
                // Kick off a new read if needed
                self.reader().read();
            }
        } else {
            self.reader().pause();
        }
    }

    pub fn memory_cost(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(FileReader)
        self.reader().memory_cost() + self.buffered.get().capacity()
    }
}

// TODO(port): `ReadableStream.NewSource(@This(), "File", onStart, onPull, onCancel, deinit,
// setRefOrUnref, drain, memoryCost, null)` is a comptime type-generator that builds a
// vtable-backed Source struct embedding `context: FileReader`. In Rust this becomes a
// generic `NewSource<C>` + a `SourceContext` trait impl.
pub type Source = readable_stream::NewSource<FileReader>;

// Intrusive backref: `self` is always the `context` field of a heap-allocated
// `Source` (Zig `@fieldParentPtr("context", this)`). Returns `*mut Source`
// (NOT `&mut Source`) because `self` IS the `context` field — materializing
// `&mut Source` would alias the live `&self` borrow. Callers deref in a tight
// `unsafe { (*ptr).method() }` scope and never hold `&mut Source` across other
// `self.*` accesses.
bun_core::impl_field_parent! { FileReader => Source.context; pub fn raw parent; }

impl readable_stream::SourceContext for FileReader {
    const NAME: &'static str = "File";
    const SUPPORTS_REF: bool = true;
    crate::source_context_codegen!(js_FileInternalReadableStreamSource);
    // R-2: trait sigs are still `&mut self` (shared with ByteBlobLoader/
    // ByteStream — separate migration); the inherent impls take `&self`, so
    // these forward via auto-deref. The `&mut` here is what the codegen shim
    // currently emits; once `NewSource` is celled the trait flips to `&self`
    // and these become straight `Self::*(self, ..)` calls.
    fn on_start(&mut self) -> streams::Start {
        Self::on_start(self)
    }
    fn on_pull(&mut self, buf: &mut [u8], arr: JSValue) -> streams::Result {
        // SAFETY: lifetime laundering — `buf` borrows a JS typed array kept alive
        // by `arr` (see TODO(port) note at top of file).
        let buf = unsafe { &mut *(buf as *mut [u8]) };
        Self::on_pull(self, buf, arr)
    }
    fn on_cancel(&mut self) {
        Self::on_cancel(self)
    }
    fn deinit_fn(&mut self) {
        Self::deinit(self)
    }
    fn set_ref_unref(&mut self, e: bool) {
        Self::set_ref_or_unref(self, e)
    }
    fn drain_internal_buffer(&mut self) -> Vec<u8> {
        Self::drain(self)
    }
    fn memory_cost_fn(&self) -> usize {
        Self::memory_cost(self)
    }
    fn set_raw_mode(&mut self, flag: bool) -> Option<sys::Result<()>> {
        Some(Self::set_raw_mode(self, flag))
    }
    fn set_flowing(&mut self, flag: bool) {
        Self::set_flowing(self, flag)
    }
    // toBufferedValue: null
}

// Local shim: `bun_io::ReadState` doesn't derive `IntoStaticStr` (upstream crate);
// mirrors Zig `@tagName(state)` for the scoped log only.
#[inline]
fn read_state_tag(state: ReadState) -> &'static str {
    match state {
        ReadState::Progress => "progress",
        ReadState::Eof => "eof",
        ReadState::Drained => "drained",
    }
}

/// Checks whether `slice` lies within `vec`'s allocation (including spare
/// capacity). Replaces the previous `AllocatedSlice` trait, which materialised
/// a `&[u8]` over `[len, capacity)` — uninitialised memory — purely to feed
/// `bun_core::is_slice_in_buffer`. That was UB-adjacent (a `&[u8]` asserts its
/// bytes are initialised); this helper does the same containment check with
/// pure address arithmetic and never forms a reference over uninit bytes.
#[inline]
fn is_slice_in_vec_capacity(slice: &[u8], vec: &Vec<u8>) -> bool {
    let slice_start = slice.as_ptr() as usize;
    let buf_start = vec.as_ptr() as usize;
    buf_start <= slice_start && (slice_start + slice.len()) <= (buf_start + vec.capacity())
}

// ported from: src/runtime/webcore/FileReader.zig
