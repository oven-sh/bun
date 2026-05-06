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
    pub fn on_close(&mut self, _: Option<bun_sys::Error>) {
        // SAFETY: self points to Subprocess.stdin
        let process: &mut Subprocess = unsafe {
            &mut *(self as *mut _ as *mut u8)
                .sub(core::mem::offset_of!(Subprocess, stdin))
                .cast::<Subprocess>()
        };

        if let Some(this_jsvalue) = process.this_value.try_get() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                file_sink::JSSink::set_destroy_callback(existing_value, 0);
            }
        }

        match self {
            Writable::Buffer(buffer) => {
                buffer.deref();
            }
            Writable::Pipe(pipe) => {
                // SAFETY: pipe is live; deref may free it.
                unsafe { FileSink::deref(pipe.as_ptr()) };
            }
            _ => {}
        }

        process.on_stdin_destroyed();

        *self = Writable::Ignore;
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
        super::assert_stdio_result(result);

        // SAFETY: `event_loop.global` is set before any subprocess work.
        let global = unsafe { event_loop.global.unwrap().as_ref() };

        #[cfg(windows)]
        {
            match stdio {
                Stdio::Pipe | Stdio::ReadableStream(_) => {
                    if let StdioResult::Buffer(buffer) = &result {
                        let pipe = FileSink::create_with_pipe(event_loop, buffer);

                        match pipe.writer.start_with_current_pipe() {
                            bun_sys::Result::Ok(()) => {}
                            bun_sys::Result::Err(_err) => {
                                drop(pipe);
                                if let Stdio::ReadableStream(rs) = stdio {
                                    rs.cancel(global);
                                }
                                return Err(err!("UnexpectedCreatingStdin"));
                            }
                        }
                        pipe.writer.set_parent(&pipe);
                        subprocess.weak_file_sink_stdin_ptr = Some(NonNull::from(&*pipe));
                        subprocess.ref_();
                        subprocess.flags.set(Flags::DEREF_ON_STDIN_DESTROYED, true);
                        subprocess.flags.set(Flags::HAS_STDIN_DESTRUCTOR_CALLED, false);

                        if let Stdio::ReadableStream(rs) = stdio {
                            let assign_result = pipe.assign_to_stream(rs, global);
                            if let Some(err_val) = assign_result.to_error() {
                                subprocess.weak_file_sink_stdin_ptr = None;
                                subprocess.flags.set(Flags::DEREF_ON_STDIN_DESTROYED, false);
                                drop(pipe);
                                subprocess.deref();
                                return Err(global.throw_value(err_val).into());
                            }
                            *promise_for_stream = assign_result;
                        }

                        return Ok(Writable::Pipe(pipe));
                    }
                    return Ok(Writable::Inherit);
                }

                Stdio::Blob(_) => {
                    let blob = match core::mem::replace(stdio, Stdio::Ignore) {
                        Stdio::Blob(b) => b,
                        _ => unreachable!(),
                    };
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        super::Source::Blob(blob),
                    )));
                }
                Stdio::ArrayBuffer(array_buffer) => {
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
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

        // CYCLEBREAK: `FileSink::create` / `StaticPipeWriter::create` take
        // `bun_event_loop::EventLoopHandle`, not `&bun_jsc::EventLoop`; erase to
        // the vtable-backed handle once and reuse for all arms.
        #[cfg(not(windows))]
        let evtloop = bun_event_loop::EventLoopHandle::init(
            event_loop as *const EventLoop as *mut (),
        );

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

                pipe.writer.handle.poll.flags.insert(bun_aio::PollFlag::Socket);

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
                let blob = match core::mem::replace(stdio, Stdio::Ignore) {
                    Stdio::Blob(b) => b,
                    _ => unreachable!(),
                };
                Ok(Writable::Buffer(StaticPipeWriter::create(
                    event_loop,
                    subprocess,
                    result,
                    super::Source::Blob(blob),
                )))
            }
            Stdio::ArrayBuffer(array_buffer) => Ok(Writable::Buffer(StaticPipeWriter::create(
                event_loop,
                subprocess,
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

    pub fn to_js(
        &mut self,
        global_this: &JSGlobalObject,
        subprocess: *mut Subprocess,
    ) -> JSValue {
        // PORT NOTE: reshaped for borrowck — `self` is `&mut subprocess.stdin`;
        // take `subprocess` as raw ptr so the caller can pass both halves.
        match core::mem::replace(self, Writable::Ignore) {
            Writable::Fd(fd) => {
                *self = Writable::Fd(fd);
                fd.to_js(global_this)
            }
            Writable::Memfd(fd) => {
                *self = Writable::Memfd(fd);
                JSValue::UNDEFINED
            }
            Writable::Ignore => JSValue::UNDEFINED,
            Writable::Buffer(buffer) => {
                *self = Writable::Buffer(buffer);
                JSValue::UNDEFINED
            }
            Writable::Inherit => {
                *self = Writable::Inherit;
                JSValue::UNDEFINED
            }
            Writable::Pipe(pipe_nn) => {
                // self already replaced with Ignore above (mirrors Zig `this.* = .{ .ignore = {} }`)
                // SAFETY: pipe is live (held a +1 in this enum).
                let pipe = unsafe { &mut *pipe_nn.as_ptr() };
                // SAFETY: caller passes the live `*mut Subprocess` whose `.stdin` is `self`.
                let subprocess = unsafe { &mut *subprocess };
                if subprocess.process.has_exited()
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
                    pipe.on_attached_process_exit(&subprocess.process.status);
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
                        == NonNull::new(subprocess as *mut Subprocess as *mut c_void)
                    {
                        pipe.signal.clear();
                    }
                    pipe.to_js_with_destructor(
                        global_this,
                        Some(sink::destructor_ptr_subprocess(
                            subprocess as *mut Subprocess as *const c_void,
                        )),
                    )
                }
            }
        }
    }

    pub fn finalize(&mut self) {
        // SAFETY: self points to Subprocess.stdin
        let subprocess: &mut Subprocess = unsafe {
            &mut *(self as *mut _ as *mut u8)
                .sub(core::mem::offset_of!(Subprocess, stdin))
                .cast::<Subprocess>()
        };
        if let Some(this_jsvalue) = subprocess.this_value.try_get() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                file_sink::JSSink::set_destroy_callback(existing_value, 0);
            }
        }

        match self {
            Writable::Pipe(pipe_nn) => {
                // SAFETY: pipe is live for the duration of the variant.
                let pipe = unsafe { pipe_nn.as_mut() };
                if pipe.signal.ptr == NonNull::new(self as *mut _ as *mut c_void) {
                    pipe.signal.clear();
                }

                // SAFETY: pipe is live; deref may free it.
                unsafe { FileSink::deref(pipe_nn.as_ptr()) };

                *self = Writable::Ignore;
            }
            Writable::Buffer(buffer) => {
                // SAFETY: RefPtr holds a live ref.
                unsafe { (*buffer.data.as_ptr()).update_ref(false) };
                // PORT NOTE: Zig calls `buffer.deref()` without reassigning to `.ignore`;
                // RefPtr::deref drops the held ref.
                buffer.deref();
                *self = Writable::Ignore;
            }
            Writable::Memfd(fd) => {
                fd.close();
                *self = Writable::Ignore;
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

impl<'a> SignalHandler for Writable<'a> {
    fn on_close(&mut self, err: Option<bun_sys::Error>) {
        Writable::on_close(self, err)
    }
    fn on_ready(&mut self, amount: Option<BlobSizeType>, offset: Option<BlobSizeType>) {
        Writable::on_ready(self, amount, offset)
    }
    fn on_start(&mut self) {
        Writable::on_start(self)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/subprocess/Writable.zig (341 lines)
//   confidence: medium
//   todos:      3
//   notes:      Pipe holds NonNull<FileSink> (intrusive refcount, manual deref) and Buffer holds RefPtr<StaticPipeWriter> per Zig; @fieldParentPtr + aliased &mut Subprocess/&mut self need borrowck reshaping.
// ──────────────────────────────────────────────────────────────────────────
