use core::ffi::c_void;
use core::ptr::NonNull;
use std::sync::Arc;

use bun_core::{self, err};
use bun_jsc::{EventLoop, JSGlobalObject, JSValue};
use bun_sys::{self, Fd};

use bun_runtime::webcore::blob::SizeType as BlobSizeType;
use bun_runtime::webcore::file_sink::{self, FileSink};
use bun_runtime::webcore::sink::DestructorPtr;
use bun_spawn::Stdio;

use super::{js, StaticPipeWriter, StdioResult, Subprocess};

pub enum Writable {
    Pipe(Arc<FileSink>),
    Fd(Fd),
    Buffer(Arc<StaticPipeWriter>),
    Memfd(Fd),
    Inherit,
    Ignore,
}

impl Writable {
    pub fn memory_cost(&self) -> usize {
        match self {
            Writable::Pipe(pipe) => pipe.memory_cost(),
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
                pipe.update_ref(true);
            }
            Writable::Buffer(buffer) => {
                buffer.update_ref(true);
            }
            _ => {}
        }
    }

    pub fn unref(&mut self) {
        match self {
            Writable::Pipe(pipe) => {
                pipe.update_ref(false);
            }
            Writable::Buffer(buffer) => {
                buffer.update_ref(false);
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
            Writable::Buffer(_) => {
                // Arc dropped by reassignment below (mirrors Zig `buffer.deref()`).
            }
            Writable::Pipe(_) => {
                // Arc dropped by reassignment below (mirrors Zig `pipe.deref()`).
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
        subprocess: &mut Subprocess,
        result: StdioResult,
        promise_for_stream: &mut JSValue,
    ) -> Result<Writable, bun_core::Error> {
        // TODO(port): narrow error set
        Subprocess::assert_stdio_result(&result);

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
                                    rs.cancel(event_loop.global);
                                }
                                return Err(err!("UnexpectedCreatingStdin"));
                            }
                        }
                        pipe.writer.set_parent(&pipe);
                        subprocess.weak_file_sink_stdin_ptr = Some(NonNull::from(&*pipe));
                        subprocess.r#ref();
                        subprocess.flags.deref_on_stdin_destroyed = true;
                        subprocess.flags.has_stdin_destructor_called = false;

                        if let Stdio::ReadableStream(rs) = stdio {
                            let assign_result = pipe.assign_to_stream(rs, event_loop.global);
                            if let Some(err) = assign_result.to_error() {
                                subprocess.weak_file_sink_stdin_ptr = None;
                                subprocess.flags.deref_on_stdin_destroyed = false;
                                drop(pipe);
                                subprocess.deref();
                                return event_loop.global.throw_value(err);
                            }
                            *promise_for_stream = assign_result;
                        }

                        return Ok(Writable::Pipe(pipe));
                    }
                    return Ok(Writable::Inherit);
                }

                Stdio::Blob(blob) => {
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        super::Source::Blob(blob.clone()),
                    )));
                }
                Stdio::ArrayBuffer(array_buffer) => {
                    return Ok(Writable::Buffer(StaticPipeWriter::create(
                        event_loop,
                        subprocess,
                        result,
                        super::Source::ArrayBuffer(array_buffer.clone()),
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
                let pipe = FileSink::create(event_loop, result.unwrap());

                match pipe.writer.start(pipe.fd, true) {
                    bun_sys::Result::Ok(()) => {}
                    bun_sys::Result::Err(_err) => {
                        drop(pipe);
                        if let Stdio::ReadableStream(rs) = stdio {
                            rs.cancel(event_loop.global);
                        }

                        return Err(err!("UnexpectedCreatingStdin"));
                    }
                }

                pipe.writer.handle.poll.flags.insert(file_sink::PollFlag::Socket);
                // TODO(port): Arc<FileSink> interior mutability for writer.handle.poll.flags

                subprocess.weak_file_sink_stdin_ptr = Some(NonNull::from(&*pipe));
                subprocess.r#ref();
                subprocess.flags.has_stdin_destructor_called = false;
                subprocess.flags.deref_on_stdin_destroyed = true;

                if let Stdio::ReadableStream(rs) = stdio {
                    let assign_result = pipe.assign_to_stream(rs, event_loop.global);
                    if let Some(err) = assign_result.to_error() {
                        subprocess.weak_file_sink_stdin_ptr = None;
                        subprocess.flags.deref_on_stdin_destroyed = false;
                        drop(pipe);
                        subprocess.deref();
                        return event_loop.global.throw_value(err);
                    }
                    *promise_for_stream = assign_result;
                }

                Ok(Writable::Pipe(pipe))
            }

            Stdio::Blob(blob) => Ok(Writable::Buffer(StaticPipeWriter::create(
                event_loop,
                subprocess,
                result,
                super::Source::Blob(blob.clone()),
            ))),
            Stdio::ArrayBuffer(array_buffer) => Ok(Writable::Buffer(StaticPipeWriter::create(
                event_loop,
                subprocess,
                result,
                super::Source::ArrayBuffer(array_buffer.clone()),
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

    pub fn to_js(&mut self, global_this: &JSGlobalObject, subprocess: &mut Subprocess) -> JSValue {
        // PORT NOTE: reshaped for borrowck — `self` is `&mut subprocess.stdin`; Phase B may need to
        // pass `subprocess` as raw ptr or restructure.
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
            Writable::Pipe(pipe) => {
                // self already replaced with Ignore above (mirrors Zig `this.* = .{ .ignore = {} }`)
                // TODO(port): Zig transfers the +1 held by Writable into the JS wrapper here
                // (no `pipe.deref()` after `toJS`/`toJSWithDestructor`). Dropping `pipe: Arc<FileSink>`
                // at scope end is an extra -1 vs Zig — verify FileSink::to_js* ref semantics, or
                // pass the Arc by value / `core::mem::forget(pipe)` to hand ownership to the wrapper.
                if subprocess.process.has_exited() && !subprocess.flags.has_stdin_destructor_called {
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
                    subprocess.flags.has_stdin_destructor_called = false;
                    subprocess.weak_file_sink_stdin_ptr = Some(NonNull::from(&*pipe));
                    if !subprocess.flags.deref_on_stdin_destroyed {
                        // `Writable::init()` already did this for fresh pipes;
                        // only take a new ref if `on_stdin_destroyed()` has since
                        // consumed it.
                        subprocess.r#ref();
                        subprocess.flags.deref_on_stdin_destroyed = true;
                    }
                    if core::ptr::addr_eq(pipe.signal.ptr, subprocess as *mut Subprocess as *const c_void) {
                        pipe.signal.clear();
                    }
                    pipe.to_js_with_destructor(
                        global_this,
                        DestructorPtr::init(subprocess),
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
            Writable::Pipe(pipe) => {
                if core::ptr::addr_eq(pipe.signal.ptr, self as *const _ as *const c_void) {
                    pipe.signal.clear();
                }

                // Arc dropped by reassignment (mirrors Zig `pipe.deref()`).

                *self = Writable::Ignore;
            }
            Writable::Buffer(buffer) => {
                buffer.update_ref(false);
                // PORT NOTE: Zig calls `buffer.deref()` without reassigning to `.ignore`;
                // dropping the Arc here to match the refcount decrement.
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
                let _ = pipe.end(None);
            }
            Writable::Memfd(fd) => {
                fd.close();
                *self = Writable::Ignore;
            }
            Writable::Fd(_) => {
                *self = Writable::Ignore;
            }
            Writable::Buffer(buffer) => {
                buffer.close();
            }
            Writable::Ignore => {}
            Writable::Inherit => {}
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/subprocess/Writable.zig (341 lines)
//   confidence: medium
//   todos:      3
//   notes:      Arc<FileSink>/Arc<StaticPipeWriter> per LIFETIMES.tsv but Zig uses intrusive refcount (.deref()) + heavy mutation through shared ptr — Phase B may need IntrusiveArc or interior mutability; @fieldParentPtr + aliased &mut Subprocess/&mut self need borrowck reshaping.
// ──────────────────────────────────────────────────────────────────────────
