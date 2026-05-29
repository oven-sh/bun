use core::ffi::c_void;
use core::ptr::NonNull;

use bun_core::{self, err};
use bun_jsc::{JSGlobalObject, JSValue, event_loop::EventLoop};
use bun_ptr::RefPtr;
use bun_sys::{self, Fd, FdExt};

use crate::api::bun_spawn::stdio::Stdio;
use crate::node::types::FdJsc;
use crate::webcore::blob::SizeType as BlobSizeType;
use crate::webcore::file_sink::{self, FileSink};
use crate::webcore::sink;
use crate::webcore::streams::SignalHandler;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;

use super::{Flags, StaticPipeWriter, StdioResult, Subprocess, js};

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
    #[inline]
    pub(super) fn pipe_sink(pipe: NonNull<FileSink>) -> bun_ptr::BackRef<FileSink> {
        bun_ptr::BackRef::from(pipe)
    }

    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(in crate::api) fn pipe_sink_mut(pipe: &NonNull<FileSink>) -> &mut FileSink {
        // SAFETY: see fn doc — +1-intrusive-ref'd, heap-disjoint, single-thread.
        unsafe { &mut *pipe.as_ptr() }
    }

    #[inline]
    pub(in crate::api) fn pipe_release(pipe: NonNull<FileSink>) {
        // SAFETY: see fn doc — +1-intrusive-ref'd heap allocation with
        // dealloc provenance; `deref` decrements and may free.
        unsafe { FileSink::deref(pipe.as_ptr()) };
    }

    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(in crate::api) fn buffer_writer_mut<'b>(
        buffer: &'b RefPtr<StaticPipeWriter<'a>>,
    ) -> &'b mut StaticPipeWriter<'a> {
        // SAFETY: see fn doc — sole-owning RefPtr, heap-disjoint, single-thread.
        unsafe { &mut *buffer.as_ptr() }
    }

    pub fn memory_cost(&self) -> usize {
        match self {
            Writable::Pipe(pipe) => Self::pipe_sink(*pipe).memory_cost(),
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
                Self::pipe_sink(*pipe).update_ref(true);
            }
            Writable::Buffer(buffer) => {
                Self::buffer_writer_mut(buffer).update_ref(true);
            }
            _ => {}
        }
    }

    pub fn unref(&mut self) {
        match self {
            Writable::Pipe(pipe) => {
                Self::pipe_sink(*pipe).update_ref(false);
            }
            Writable::Buffer(buffer) => {
                Self::buffer_writer_mut(buffer).update_ref(false);
            }
            _ => {}
        }
    }

    pub fn on_close(process: &Subprocess<'a>, _: Option<bun_sys::Error>) {
        if let Some(this_jsvalue) = process.this_value.get().try_get() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                file_sink::JSSink::set_destroy_callback(existing_value, 0);
            }
        }

        match process.stdin.replace(Writable::Ignore) {
            Writable::Buffer(buffer) => {
                buffer.deref();
            }
            Writable::Pipe(pipe) => {
                Self::pipe_release(pipe);
            }
            _ => {}
        }

        // `on_stdin_destroyed` may `deref()` and free `process` as its last
        // act, so this must be the final access.
        process.on_stdin_destroyed();
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
        super::assert_stdio_result!(result);

        let global = event_loop.global_ref();

        let evtloop = bun_event_loop::EventLoopHandle::init(
            std::ptr::from_ref::<EventLoop>(event_loop)
                .cast_mut()
                .cast::<()>(),
        );

        #[cfg(windows)]
        {
            match stdio {
                Stdio::Pipe | Stdio::ReadableStream(_) => {
                    if let StdioResult::Buffer(buffer) = result {
                        // Ownership of the `Box<uv::Pipe>` transfers to the
                        // FileSink's writer (mirrors Zig where `result.buffer`
                        // is a heap pointer the sink takes over).
                        let uv_pipe: *mut _ = bun_core::heap::into_raw(buffer);
                        // `create_with_pipe` returns a freshly-boxed non-null pointer.
                        let pipe_nn = NonNull::new(FileSink::create_with_pipe(evtloop, uv_pipe))
                            .expect("FileSink::create_with_pipe returns non-null");
                        let pipe_ptr = pipe_nn.as_ptr();
                        let pipe = Self::pipe_sink_mut(&pipe_nn);

                        match pipe.writer.with_mut(|w| w.start_with_current_pipe()) {
                            bun_sys::Result::Ok(()) => {}
                            bun_sys::Result::Err(_err) => {
                                Self::pipe_release(pipe_nn);
                                if let Stdio::ReadableStream(rs) = stdio {
                                    rs.cancel(global);
                                }
                                return Err(err!("UnexpectedCreatingStdin"));
                            }
                        }
                        pipe.writer.with_mut(|w| w.set_parent(pipe_ptr));
                        subprocess.weak_file_sink_stdin_ptr.set(Some(pipe_nn));
                        subprocess.ref_();
                        subprocess.update_flags(|f| {
                            f.set(Flags::DEREF_ON_STDIN_DESTROYED, true);
                            f.set(Flags::HAS_STDIN_DESTRUCTOR_CALLED, false);
                        });

                        if let Stdio::ReadableStream(rs) = stdio {
                            let assign_result = pipe.assign_to_stream(rs, global);
                            if let Some(err_val) = assign_result.to_error() {
                                subprocess.weak_file_sink_stdin_ptr.set(None);
                                subprocess.update_flags(|f| {
                                    f.set(Flags::DEREF_ON_STDIN_DESTROYED, false)
                                });
                                Self::pipe_release(pipe_nn);
                                subprocess.deref();
                                let _ = global.throw_value(err_val);
                                return Err(err!(JSError));
                            }
                            *promise_for_stream = assign_result;
                        }

                        return Ok(Writable::Pipe(pipe_nn));
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
                        super::source_from_blob(blob),
                    )));
                }
                Stdio::ArrayBuffer(array_buffer) => {
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        evtloop,
                        subprocess as *mut Subprocess<'a>,
                        result,
                        super::source_from_array_buffer(core::mem::take(array_buffer)),
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
                // `create` returns a freshly-boxed non-null pointer.
                let pipe_nn = NonNull::new(FileSink::create(evtloop, result.unwrap()))
                    .expect("FileSink::create returns non-null");
                let pipe = Self::pipe_sink_mut(&pipe_nn);

                match pipe.writer.with_mut(|w| w.start(pipe.fd.get(), true)) {
                    bun_sys::Result::Ok(()) => {}
                    bun_sys::Result::Err(_err) => {
                        Self::pipe_release(pipe_nn);
                        if let Stdio::ReadableStream(rs) = stdio {
                            rs.cancel(global);
                        }

                        return Err(err!("UnexpectedCreatingStdin"));
                    }
                }

                // Zig: `pipe.writer.handle.poll.flags.insert(.socket);`
                // `handle` is `PollOrFd` (enum) in Rust; flag mutation goes
                // through the FilePoll vtable shim.
                pipe.writer.with_mut(|w| {
                    if let Some(poll) = w.handle.get_poll() {
                        poll.set_flag(bun_io::FilePollFlag::Socket);
                    }
                });

                subprocess.weak_file_sink_stdin_ptr.set(Some(pipe_nn));
                subprocess.ref_();
                subprocess.update_flags(|f| {
                    f.set(Flags::HAS_STDIN_DESTRUCTOR_CALLED, false);
                    f.set(Flags::DEREF_ON_STDIN_DESTROYED, true);
                });

                if let Stdio::ReadableStream(rs) = stdio {
                    let assign_result = pipe.assign_to_stream(rs, global);
                    if let Some(err_val) = assign_result.to_error() {
                        subprocess.weak_file_sink_stdin_ptr.set(None);
                        subprocess.update_flags(|f| f.set(Flags::DEREF_ON_STDIN_DESTROYED, false));
                        Self::pipe_release(pipe_nn);
                        subprocess.deref();
                        let _ = global.throw_value(err_val);
                        return Err(err!(JSError));
                    }
                    *promise_for_stream = assign_result;
                }

                Ok(Writable::Pipe(pipe_nn))
            }

            Stdio::Blob(_) => {
                // `Stdio` has a Drop impl (would `blob.detach()`), so we can't
                // move the payload out by match — take ownership via
                // ManuallyDrop + ptr::read to transfer without detaching.
                let owned = core::mem::ManuallyDrop::new(core::mem::replace(stdio, Stdio::Ignore));
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
                    super::source_from_blob(blob),
                )))
            }
            Stdio::ArrayBuffer(array_buffer) => Ok(Writable::Buffer(StaticPipeWriter::create(
                evtloop,
                std::ptr::from_mut::<Subprocess<'a>>(subprocess),
                result,
                super::source_from_array_buffer(core::mem::take(array_buffer)),
            ))),
            Stdio::Memfd(_) => {
                let owned = core::mem::ManuallyDrop::new(core::mem::replace(stdio, Stdio::Ignore));
                let Stdio::Memfd(fd) = &*owned else {
                    unreachable!()
                };
                debug_assert!(*fd != Fd::INVALID);
                Ok(Writable::Memfd(*fd))
            }
            Stdio::Fd(_) => Ok(Writable::Fd(result.unwrap())),
            Stdio::Inherit => Ok(Writable::Inherit),
            Stdio::Path(_) | Stdio::Ignore => Ok(Writable::Ignore),
            Stdio::Ipc | Stdio::Capture(_) => Ok(Writable::Ignore),
        }
    }

    pub fn to_js(subprocess: &Subprocess<'a>, global_this: &JSGlobalObject) -> JSValue {
        // PORT NOTE: reshaped for borrowck — Zig passed `*Writable` (== `&stdin`)
        // and `*Subprocess` separately, which alias. Take only the parent and
        // project `stdin` here so no two `&mut` overlap at any point.
        match subprocess.stdin.replace(Writable::Ignore) {
            Writable::Fd(fd) => {
                subprocess.stdin.set(Writable::Fd(fd));
                fd.to_js(global_this)
            }
            Writable::Memfd(fd) => {
                subprocess.stdin.set(Writable::Memfd(fd));
                JSValue::UNDEFINED
            }
            Writable::Ignore => JSValue::UNDEFINED,
            Writable::Buffer(buffer) => {
                subprocess.stdin.set(Writable::Buffer(buffer));
                JSValue::UNDEFINED
            }
            Writable::Inherit => {
                subprocess.stdin.set(Writable::Inherit);
                JSValue::UNDEFINED
            }
            Writable::Pipe(pipe_nn) => {
                // stdin already replaced with Ignore above (mirrors Zig `this.* = .{ .ignore = {} }`)
                // pipe is live (held a +1 in this enum); separate allocation
                // from `*subprocess` so the borrows are disjoint.
                if subprocess.has_exited()
                    && !subprocess
                        .flags
                        .get()
                        .contains(Flags::HAS_STDIN_DESTRUCTOR_CALLED)
                {
                    // `Writable::init()` already called `subprocess.ref()` and
                    // set `deref_on_stdin_destroyed`. `on_attached_process_exit()`
                    // → `writer.close()` → `pipe.signal` → `Writable::on_close`
                    // → `on_stdin_destroyed()` balances that ref, so a ref-count
                    // drop across this call is expected (previously these
                    // writes were clobbered by the struct-literal reassignment
                    // in spawn_maybe_sync and this path asserted no ref change;
                    // see https://github.com/oven-sh/bun/pull/14092).
                    //
                    // Pass the canonical `*mut FileSink` straight through — the
                    // call re-enters via the writer backref and may free `this`,
                    // so no `&mut FileSink` is materialized across it.
                    // SAFETY: `pipe_nn` is the canonical heap pointer from
                    // `FileSink::create*` with write+dealloc provenance, held
                    // live by the `Writable::Pipe` +1.
                    unsafe {
                        FileSink::on_attached_process_exit(
                            pipe_nn.as_ptr(),
                            &subprocess.process().status,
                        )
                    };
                    let js = Self::pipe_sink_mut(&pipe_nn).to_js(global_this);
                    Self::pipe_release(pipe_nn);
                    js
                } else {
                    let pipe = Self::pipe_sink_mut(&pipe_nn);
                    subprocess.update_flags(|f| f.set(Flags::HAS_STDIN_DESTRUCTOR_CALLED, false));
                    subprocess.weak_file_sink_stdin_ptr.set(Some(pipe_nn));
                    if !subprocess
                        .flags
                        .get()
                        .contains(Flags::DEREF_ON_STDIN_DESTROYED)
                    {
                        // `Writable::init()` already did this for fresh pipes;
                        // only take a new ref if `on_stdin_destroyed()` has since
                        // consumed it.
                        subprocess.ref_();
                        subprocess.update_flags(|f| f.set(Flags::DEREF_ON_STDIN_DESTROYED, true));
                    }
                    if pipe.signal.get().ptr
                        == NonNull::new(subprocess.as_ctx_ptr().cast::<c_void>())
                    {
                        pipe.signal.with_mut(|s| s.clear());
                    }
                    // Rust `FileSink::to_js_with_destructor` takes its own
                    // per-wrapper +1; release the enum's create-time +1 (see
                    // the has-exited arm above and Blob.rs:1899-1902).
                    let js = pipe.to_js_with_destructor(
                        global_this,
                        Some(sink::destructor_ptr_subprocess(
                            subprocess.as_ctx_ptr().cast::<c_void>(),
                        )),
                    );
                    Self::pipe_release(pipe_nn);
                    js
                }
            }
        }
    }

    pub fn finalize(subprocess: &Subprocess<'a>) {
        if let Some(this_jsvalue) = subprocess.this_value.get().try_get() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                file_sink::JSSink::set_destroy_callback(existing_value, 0);
            }
        }

        // The signal back-pointer is the `*mut Subprocess` (see SignalHandler
        // impl below / `to_js`); compare against that, not the `stdin` address.
        let parent_ptr = NonNull::new(subprocess.as_ctx_ptr().cast::<c_void>());
        match subprocess.stdin.replace(Writable::Ignore) {
            Writable::Pipe(pipe_nn) => {
                let pipe = Self::pipe_sink_mut(&pipe_nn);
                if pipe.signal.get().ptr == parent_ptr {
                    pipe.signal.with_mut(|s| s.clear());
                }

                Self::pipe_release(pipe_nn);
            }
            Writable::Buffer(buffer) => {
                Self::buffer_writer_mut(&buffer).update_ref(false);
                // PORT NOTE: Zig calls `buffer.deref()` without reassigning to `.ignore`;
                // RefPtr::deref drops the held ref.
                buffer.deref();
            }
            Writable::Memfd(fd) => {
                fd.close();
            }
            Writable::Ignore => {}
            Writable::Fd(fd) => {
                subprocess.stdin.set(Writable::Fd(fd));
            }
            Writable::Inherit => {
                subprocess.stdin.set(Writable::Inherit);
            }
        }
    }

    pub fn close(&mut self) {
        match self {
            Writable::Pipe(pipe) => {
                let _ = Self::pipe_sink(*pipe).end(None);
            }
            Writable::Memfd(fd) => {
                fd.close();
                *self = Writable::Ignore;
            }
            Writable::Fd(_) => {
                *self = Writable::Ignore;
            }
            Writable::Buffer(buffer) => {
                Self::buffer_writer_mut(buffer).close();
            }
            Writable::Ignore => {}
            Writable::Inherit => {}
        }
    }
}

impl<'a> SignalHandler for Subprocess<'a> {
    fn on_close(&mut self, err: Option<bun_sys::Error>) {
        Writable::on_close(self, err)
    }
    fn on_ready(&mut self, _: Option<BlobSizeType>, _: Option<BlobSizeType>) {}
    fn on_start(&mut self) {}
}

// ported from: src/runtime/api/bun/subprocess/Writable.zig
