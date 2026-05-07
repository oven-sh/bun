use core::ffi::c_void;
use core::ptr::NonNull;

use bun_core::{self, err};
use bun_jsc::{event_loop::EventLoop, JSGlobalObject, JSValue};
use bun_ptr::RefPtr;
use bun_sys::{self, Fd, FdExt};

use crate::node::types::FdJsc;
use crate::webcore::blob::SizeType as BlobSizeType;
use crate::webcore::file_sink::{self, FileSink};
use crate::webcore::sink;
use crate::webcore::streams::SignalHandler;
use crate::api::bun_spawn::stdio::Stdio;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;

use super::{js, Flags, StaticPipeWriter, StdioResult, Subprocess};

pub enum Writable<'a> {
    // PORT NOTE: Zig uses intrusive-refcounted `*FileSink` (manual ref/deref).
    // Keep a raw NonNull and call `FileSink::deref` explicitly to mirror that.
    Pipe(NonNull<FileSink>),
    Fd(Fd),
    Buffer(RefPtr<StaticPipeWriter<'a>>),
    Memfd(Fd),
    Inherit,
    Ignore,
}

impl<'a> Writable<'a> {
    pub fn memory_cost(&self) -> usize {
        match self {
            // SAFETY: pipe is live for the duration of the variant.
            Writable::Pipe(pipe) => unsafe { pipe.as_ref() }.memory_cost(),
            Writable::Buffer(buffer) => buffer.memory_cost(),
            // TODO: memfd
            _ => 0,
        }
    }

    pub fn has_pending_activity(&self) -> bool {
        match self {
            Writable::Pipe(_) => false,

            // we mark them as .ignore when they are closed, so this must be true
            Writable::Buffer(_) => true,
            _ => false,
        }
    }

    pub fn r#ref(&mut self) {
        match self {
            Writable::Pipe(pipe) => {
                // SAFETY: pipe is live for the duration of the variant.
                unsafe { pipe.as_mut() }.update_ref(true);
            }
            Writable::Buffer(buffer) => {
                // SAFETY: RefPtr holds a live ref; intrusive refcount permits
                // shared mutation (mirrors Zig `*StaticPipeWriter`).
                unsafe { (*buffer.data.as_ptr()).update_ref(true) };
            }
            _ => {}
        }
    }

    pub fn unref(&mut self) {
        match self {
            Writable::Pipe(pipe) => {
                // SAFETY: pipe is live for the duration of the variant.
                unsafe { pipe.as_mut() }.update_ref(false);
            }
            Writable::Buffer(buffer) => {
                // SAFETY: RefPtr holds a live ref.
                unsafe { (*buffer.data.as_ptr()).update_ref(false) };
            }
            _ => {}
        }
    }

    // When the stream has closed we need to be notified to prevent a use-after-free
    // We can test for this use-after-free by enabling hot module reloading on a file and then saving it twice
    //
    // PORT NOTE: reshaped for borrowck — Zig `@fieldParentPtr("stdin", this)`
    // recovers `*Subprocess` from `*Writable` and freely interleaves access to
    // both. In Rust, deriving the parent from `&mut self` is out-of-provenance
    // (the `&mut` only covers the `stdin` field) and yields two overlapping
    // unique borrows. Instead the `SignalHandler` impl is on `Subprocess` and
    // hands us the parent pointer directly; we raw-project `stdin` and never
    // hold `&mut Subprocess` and `&mut Writable` at the same time.
    pub fn on_close(process: *mut Subprocess<'a>, _: Option<bun_sys::Error>) {
        // SAFETY: `process` is the live boxed `Subprocess`; raw place
        // projection forms no intermediate reference.
        let stdin: *mut Writable<'a> = unsafe { core::ptr::addr_of_mut!((*process).stdin) };

        // SAFETY: `this_value` and `stdin` are disjoint fields; this short-lived
        // borrow ends before any whole-struct reborrow.
        if let Some(this_jsvalue) = unsafe { (*process).this_value.try_get() } {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                file_sink::JSSink::set_destroy_callback(existing_value, 0);
            }
        }

        // SAFETY: `stdin` is a valid `*mut Writable`; the `&mut` lives only for
        // the duration of `replace`. Moving the payload out and writing `.Ignore`
        // here hoists Zig's trailing `this.* = .{.ignore}` ahead of
        // `on_stdin_destroyed` — in Zig that write follows a `deref()` that may
        // free `process`, which would be a write-after-free. The only observable
        // difference is `has_pending_activity_stdio()` seeing `Ignore` (== false)
        // instead of a just-deref'd `Buffer` (== true) inside
        // `update_has_pending_activity`, which is the state it converges to
        // immediately after anyway.
        match core::mem::replace(unsafe { &mut *stdin }, Writable::Ignore) {
            Writable::Buffer(buffer) => {
                buffer.deref();
            }
            Writable::Pipe(pipe) => {
                // SAFETY: pipe is live; deref may free it.
                unsafe { FileSink::deref(pipe.as_ptr()) };
            }
            _ => {}
        }

        // SAFETY: `process` is live and no borrow of `*process` is outstanding;
        // `on_stdin_destroyed` may `deref()` and free it as its last act, so
        // this must be the final access.
        unsafe { (*process).on_stdin_destroyed() };
    }
    pub fn on_ready(&mut self, _: Option<BlobSizeType>, _: Option<BlobSizeType>) {}
    pub fn on_start(&mut self) {}

    pub fn init(
        stdio: &mut Stdio,
        event_loop: &EventLoop,
        subprocess: &mut Subprocess<'a>,
        result: StdioResult,
        promise_for_stream: &mut JSValue,
    ) -> Result<Writable<'a>, bun_core::Error> {
        // TODO(port): narrow error set
        Subprocess::assert_stdio_result(&result);

        // SAFETY: `event_loop.global` is set before any subprocess work.
        let global = unsafe { event_loop.global.unwrap().as_ref() };

        // CYCLEBREAK: `FileSink::create` / `StaticPipeWriter::create` take
        // `bun_event_loop::EventLoopHandle`, not `&bun_jsc::EventLoop`; erase to
        // the vtable-backed handle once and reuse for all arms (both platforms).
        let evtloop = bun_event_loop::EventLoopHandle::init(
            std::ptr::from_ref::<EventLoop>(event_loop).cast_mut().cast::<()>(),
        );

        #[cfg(windows)]
        {
            match stdio {
                Stdio::Pipe | Stdio::ReadableStream(_) => {
                    if let StdioResult::Buffer(buffer) = result {
                        // Ownership of the `Box<uv::Pipe>` transfers to the
                        // FileSink's writer (mirrors Zig where `result.buffer`
                        // is a heap pointer the sink takes over).
                        let uv_pipe: *mut _ = Box::into_raw(buffer);
                        let pipe_ptr = FileSink::create_with_pipe(evtloop, uv_pipe);
                        // SAFETY: `create_with_pipe` returns a freshly-boxed non-null pointer.
                        let pipe = unsafe { &mut *pipe_ptr };

                        match pipe.writer.start_with_current_pipe() {
                            bun_sys::Result::Ok(()) => {}
                            bun_sys::Result::Err(_err) => {
                                // SAFETY: pipe was just created with refcount 1.
                                unsafe { FileSink::deref(pipe_ptr) };
                                if let Stdio::ReadableStream(rs) = stdio {
                                    rs.cancel(global);
                                }
                                return Err(err!("UnexpectedCreatingStdin"));
                            }
                        }
                        pipe.writer.set_parent(pipe_ptr);
                        subprocess.weak_file_sink_stdin_ptr = NonNull::new(pipe_ptr);
                        subprocess.ref_();
                        subprocess.flags.set(Flags::DEREF_ON_STDIN_DESTROYED, true);
                        subprocess.flags.set(Flags::HAS_STDIN_DESTRUCTOR_CALLED, false);

                        if let Stdio::ReadableStream(rs) = stdio {
                            let assign_result = pipe.assign_to_stream(rs, global);
                            if let Some(err_val) = assign_result.to_error() {
                                subprocess.weak_file_sink_stdin_ptr = None;
                                subprocess.flags.set(Flags::DEREF_ON_STDIN_DESTROYED, false);
                                // SAFETY: pipe is live; deref may free it.
                                unsafe { FileSink::deref(pipe_ptr) };
                                subprocess.deref();
                                let _ = global.throw_value(err_val);
                                return Err(err!(JSError));
                            }
                            *promise_for_stream = assign_result;
                        }

                        // SAFETY: `create_with_pipe` returns non-null.
                        return Ok(Writable::Pipe(unsafe { NonNull::new_unchecked(pipe_ptr) }));
                    }
                    return Ok(Writable::Inherit);
                }

                Stdio::Blob(_) => {
                    // See the unix arm below: Stdio has Drop, so move the
                    // payload out via ManuallyDrop + ptr::read.
                    let owned =
                        core::mem::ManuallyDrop::new(core::mem::replace(stdio, Stdio::Ignore));
                    let blob = match &*owned {
                        // SAFETY: owned is ManuallyDrop; payload moved exactly once.
                        Stdio::Blob(b) => unsafe { core::ptr::read(b) },
                        _ => unreachable!(),
                    };
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        evtloop,
                        subprocess as *mut Subprocess<'a>,
                        result,
                        super::Source::Blob(blob),
                    )));
                }
                Stdio::ArrayBuffer(array_buffer) => {
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        evtloop,
                        subprocess as *mut Subprocess<'a>,
                        result,
                        super::Source::ArrayBuffer(core::mem::take(array_buffer)),
                    )));
                }
                Stdio::Fd(fd) => {
                    return Ok(Writable::Fd(*fd));
                }
                Stdio::Dup2(dup2) => {
                    return Ok(Writable::Fd(dup2.to.to_fd()));
                }
                Stdio::Inherit => {
                    return Ok(Writable::Inherit);
                }
                Stdio::Memfd(_) | Stdio::Path(_) | Stdio::Ignore => {
                    return Ok(Writable::Ignore);
                }
                Stdio::Ipc | Stdio::Capture(_) => {
                    return Ok(Writable::Ignore);
                }
            }
        }

        #[cfg(unix)]
        {
            if matches!(stdio, Stdio::Pipe) {
                let _ = bun_sys::set_nonblocking(result.unwrap());
            }
        }

        #[cfg(not(windows))]
        match stdio {
            Stdio::Dup2(_) => panic!("TODO dup2 stdio"),
            Stdio::Pipe | Stdio::ReadableStream(_) => {
                let pipe_ptr = FileSink::create(evtloop, result.unwrap());
                // SAFETY: `create` returns a freshly-boxed non-null pointer.
                let pipe = unsafe { &mut *pipe_ptr };

                match pipe.writer.start(pipe.fd, true) {
                    bun_sys::Result::Ok(()) => {}
                    bun_sys::Result::Err(_err) => {
                        // SAFETY: pipe was just created with refcount 1.
                        unsafe { FileSink::deref(pipe_ptr) };
                        if let Stdio::ReadableStream(rs) = stdio {
                            rs.cancel(global);
                        }

                        return Err(err!("UnexpectedCreatingStdin"));
                    }
                }

                // Zig: `pipe.writer.handle.poll.flags.insert(.socket);`
                // `handle` is `PollOrFd` (enum) in Rust; flag mutation goes
                // through the FilePoll vtable shim.
                if let Some(poll) = pipe.writer.handle.get_poll() {
                    poll.set_flag(bun_io::FilePollFlag::Socket);
                }

                subprocess.weak_file_sink_stdin_ptr = NonNull::new(pipe_ptr);
                subprocess.ref_();
                subprocess.flags.set(Flags::HAS_STDIN_DESTRUCTOR_CALLED, false);
                subprocess.flags.set(Flags::DEREF_ON_STDIN_DESTROYED, true);

                if let Stdio::ReadableStream(rs) = stdio {
                    let assign_result = pipe.assign_to_stream(rs, global);
                    if let Some(err_val) = assign_result.to_error() {
                        subprocess.weak_file_sink_stdin_ptr = None;
                        subprocess.flags.set(Flags::DEREF_ON_STDIN_DESTROYED, false);
                        // SAFETY: pipe is live; deref may free it.
                        unsafe { FileSink::deref(pipe_ptr) };
                        subprocess.deref();
                        let _ = global.throw_value(err_val);
                        return Err(err!(JSError));
                    }
                    *promise_for_stream = assign_result;
                }

                // SAFETY: `create` returns non-null.
                Ok(Writable::Pipe(unsafe { NonNull::new_unchecked(pipe_ptr) }))
            }

            Stdio::Blob(_) => {
                // `Stdio` has a Drop impl (would `blob.detach()`), so we can't
                // move the payload out by match — take ownership via
                // ManuallyDrop + ptr::read to transfer without detaching.
                let owned =
                    core::mem::ManuallyDrop::new(core::mem::replace(stdio, Stdio::Ignore));
                let blob = match &*owned {
                    // SAFETY: `owned` is ManuallyDrop and discarded after this
                    // read; the Blob payload is moved out exactly once.
                    Stdio::Blob(b) => unsafe { core::ptr::read(b) },
                    _ => unreachable!(),
                };
                Ok(Writable::Buffer(StaticPipeWriter::create(
                    evtloop,
                    std::ptr::from_mut::<Subprocess<'a>>(subprocess),
                    result,
                    super::Source::Blob(blob),
                )))
            }
            Stdio::ArrayBuffer(array_buffer) => Ok(Writable::Buffer(StaticPipeWriter::create(
                evtloop,
                std::ptr::from_mut::<Subprocess<'a>>(subprocess),
                result,
                super::Source::ArrayBuffer(core::mem::take(array_buffer)),
            ))),
            Stdio::Memfd(memfd) => {
                debug_assert!(*memfd != Fd::INVALID);
                Ok(Writable::Memfd(*memfd))
            }
            Stdio::Fd(_) => Ok(Writable::Fd(result.unwrap())),
            Stdio::Inherit => Ok(Writable::Inherit),
            Stdio::Path(_) | Stdio::Ignore => Ok(Writable::Ignore),
            Stdio::Ipc | Stdio::Capture(_) => Ok(Writable::Ignore),
        }
    }

    pub fn to_js(subprocess: *mut Subprocess, global_this: &JSGlobalObject) -> JSValue {
        // PORT NOTE: reshaped for borrowck — Zig passed `*Writable` (== `&stdin`)
        // and `*Subprocess` separately, which alias. Take only the parent raw
        // pointer and project `stdin` here so no two `&mut` overlap at any point.
        // SAFETY: caller passes a live `*mut Subprocess`; raw projection of `stdin`.
        let stdin = unsafe { core::ptr::addr_of_mut!((*subprocess).stdin) };
        // SAFETY: `stdin` is a valid `*mut Writable`; the `&mut` is dropped at the
        // end of `replace`, before `*subprocess` is reborrowed below.
        match core::mem::replace(unsafe { &mut *stdin }, Writable::Ignore) {
            Writable::Fd(fd) => {
                // SAFETY: see above; sole live borrow.
                unsafe { *stdin = Writable::Fd(fd) };
                fd.to_js(global_this)
            }
            Writable::Memfd(fd) => {
                // SAFETY: see above; sole live borrow.
                unsafe { *stdin = Writable::Memfd(fd) };
                JSValue::UNDEFINED
            }
            Writable::Ignore => JSValue::UNDEFINED,
            Writable::Buffer(buffer) => {
                // SAFETY: see above; sole live borrow.
                unsafe { *stdin = Writable::Buffer(buffer) };
                JSValue::UNDEFINED
            }
            Writable::Inherit => {
                // SAFETY: see above; sole live borrow.
                unsafe { *stdin = Writable::Inherit };
                JSValue::UNDEFINED
            }
            Writable::Pipe(pipe_nn) => {
                // stdin already replaced with Ignore above (mirrors Zig `this.* = .{ .ignore = {} }`)
                // SAFETY: pipe is live (held a +1 in this enum).
                let pipe = unsafe { &mut *pipe_nn.as_ptr() };
                // SAFETY: caller passes a live `*mut Subprocess`; the `&mut *stdin`
                // borrow above has ended, so this whole-struct reborrow is unique.
                let subprocess = unsafe { &mut *subprocess };
                if subprocess.has_exited()
                    && !subprocess.flags.contains(Flags::HAS_STDIN_DESTRUCTOR_CALLED)
                {
                    // `Writable::init()` already called `subprocess.ref()` and
                    // set `deref_on_stdin_destroyed`. `on_attached_process_exit()`
                    // → `writer.close()` → `pipe.signal` → `Writable::on_close`
                    // → `on_stdin_destroyed()` balances that ref, so a ref-count
                    // drop across this call is expected (previously these
                    // writes were clobbered by the struct-literal reassignment
                    // in spawn_maybe_sync and this path asserted no ref change;
                    // see https://github.com/oven-sh/bun/pull/14092).
                    pipe.on_attached_process_exit(&subprocess.process().status);
                    pipe.to_js(global_this)
                } else {
                    subprocess.flags.set(Flags::HAS_STDIN_DESTRUCTOR_CALLED, false);
                    subprocess.weak_file_sink_stdin_ptr = Some(pipe_nn);
                    if !subprocess.flags.contains(Flags::DEREF_ON_STDIN_DESTROYED) {
                        // `Writable::init()` already did this for fresh pipes;
                        // only take a new ref if `on_stdin_destroyed()` has since
                        // consumed it.
                        subprocess.ref_();
                        subprocess.flags.set(Flags::DEREF_ON_STDIN_DESTROYED, true);
                    }
                    if pipe.signal.ptr
                        == NonNull::new(std::ptr::from_mut::<Subprocess>(subprocess).cast::<c_void>())
                    {
                        pipe.signal.clear();
                    }
                    pipe.to_js_with_destructor(
                        global_this,
                        Some(sink::destructor_ptr_subprocess(
                            std::ptr::from_mut::<Subprocess>(subprocess).cast::<c_void>(),
                        )),
                    )
                }
            }
        }
    }

    // PORT NOTE: reshaped for borrowck — see `on_close`. Zig
    // `@fieldParentPtr("stdin", this)` is replaced by the caller passing the
    // parent pointer; deriving it from `&mut self` would be out-of-provenance.
    pub fn finalize(subprocess: *mut Subprocess<'a>) {
        // SAFETY: `subprocess` is live; raw place projection.
        let stdin: *mut Writable<'a> =
            unsafe { core::ptr::addr_of_mut!((*subprocess).stdin) };

        // SAFETY: `this_value` and `stdin` are disjoint fields; short-lived
        // borrow ends before `stdin` is touched.
        if let Some(this_jsvalue) = unsafe { (*subprocess).this_value.try_get() } {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                file_sink::JSSink::set_destroy_callback(existing_value, 0);
            }
        }

        // The signal back-pointer is the `*mut Subprocess` (see SignalHandler
        // impl below / `to_js`); compare against that, not the `stdin` address.
        let parent_ptr = NonNull::new(subprocess.cast::<c_void>());
        // SAFETY: sole live borrow of `stdin`.
        match unsafe { &mut *stdin } {
            Writable::Pipe(pipe_nn) => {
                // Copy the NonNull out so the match binding's borrow of `*stdin`
                // ends, allowing `*stdin = Ignore` below.
                let pipe_nn = *pipe_nn;
                // SAFETY: pipe is live for the duration of the variant.
                let pipe = unsafe { &mut *pipe_nn.as_ptr() };
                if pipe.signal.ptr == parent_ptr {
                    pipe.signal.clear();
                }

                // SAFETY: pipe is live; deref may free it.
                unsafe { FileSink::deref(pipe_nn.as_ptr()) };

                // SAFETY: sole live borrow of `stdin`.
                unsafe { *stdin = Writable::Ignore };
            }
            Writable::Buffer(buffer) => {
                // SAFETY: RefPtr holds a live ref.
                unsafe { (*buffer.data.as_ptr()).update_ref(false) };
                // PORT NOTE: Zig calls `buffer.deref()` without reassigning to `.ignore`;
                // RefPtr::deref drops the held ref.
                buffer.deref();
                // SAFETY: sole live borrow of `stdin`.
                unsafe { *stdin = Writable::Ignore };
            }
            Writable::Memfd(fd) => {
                fd.close();
                // SAFETY: sole live borrow of `stdin`.
                unsafe { *stdin = Writable::Ignore };
            }
            Writable::Ignore => {}
            Writable::Fd(_) | Writable::Inherit => {}
        }
    }

    pub fn close(&mut self) {
        match self {
            Writable::Pipe(pipe) => {
                // SAFETY: pipe is live for the duration of the variant.
                let _ = unsafe { pipe.as_mut() }.end(None);
            }
            Writable::Memfd(fd) => {
                fd.close();
                *self = Writable::Ignore;
            }
            Writable::Fd(_) => {
                *self = Writable::Ignore;
            }
            Writable::Buffer(buffer) => {
                // SAFETY: RefPtr holds a live ref.
                unsafe { (*buffer.data.as_ptr()).close() };
            }
            Writable::Ignore => {}
            Writable::Inherit => {}
        }
    }
}

// PORT NOTE: Zig wires `pipe.signal = Signal.init(&subprocess.stdin)` and the
// callbacks then `@fieldParentPtr` back to the `Subprocess`. Registering the
// `*mut Writable` and recovering the parent inside the callback is
// out-of-provenance in Rust (the `&mut Writable` formed by the vtable thunk
// only carries provenance for the `stdin` field). Register the `*mut
// Subprocess` instead — `signal.ptr` carries whole-allocation provenance and
// `on_close`/`finalize`/`to_js` raw-project `stdin` from it.
impl<'a> SignalHandler for Subprocess<'a> {
    fn on_close(&mut self, err: Option<bun_sys::Error>) {
        // Decay to a raw pointer immediately; `on_close` reborrows disjoint
        // fields and the whole struct in sequence, never overlapping.
        Writable::on_close(std::ptr::from_mut::<Self>(self), err)
    }
    fn on_ready(&mut self, _: Option<BlobSizeType>, _: Option<BlobSizeType>) {}
    fn on_start(&mut self) {}
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/subprocess/Writable.zig (341 lines)
//   confidence: medium
//   todos:      1
//   notes:      Pipe holds NonNull<FileSink> (intrusive refcount, manual deref) and Buffer holds RefPtr<StaticPipeWriter>. @fieldParentPtr reshaped: SignalHandler is on Subprocess; on_close/finalize take *mut Subprocess and raw-project stdin.
// ──────────────────────────────────────────────────────────────────────────
