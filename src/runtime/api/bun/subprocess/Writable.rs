use core::ptr::NonNull;

use bun_io::{Owner, PollTag};
#[cfg(not(windows))]
use bun_jsc::SysErrorJsc as _;
use bun_jsc::{JSGlobalObject, JSValue, JsCell, JsResult, event_loop::EventLoop};
use bun_ptr::RefPtr;
use bun_sys::{self, Fd};

use crate::api::bun_spawn::stdio::Stdio;
use crate::node::types::FdJsc;
use crate::webcore::file_sink::{self, FileSink};
use crate::webcore::streams::SourceHandle;

use super::{Flags, StaticPipeWriter, StdioResult, Subprocess, js};

pub(crate) enum Writable {
    Pipe(RefPtr<FileSink>),
    Fd(Fd),
    Buffer(StaticPipeWriter),
    #[cfg(any(target_os = "linux", target_os = "android"))]
    Memfd {
        _file: bun_sys::File,
    },
    Inherit,
    Ignore,
}

impl Writable {
    pub(crate) fn memory_cost(&self) -> usize {
        match self {
            Writable::Pipe(pipe) => pipe.memory_cost(),
            Writable::Buffer(buffer) => buffer.memory_cost(),
            // TODO: memfd
            _ => 0,
        }
    }

    pub(crate) fn has_pending_activity(&self) -> bool {
        match self {
            Writable::Pipe(_) => false,

            // we mark them as .ignore when they are closed, so this must be true
            Writable::Buffer(_) => true,
            _ => false,
        }
    }

    pub(crate) fn r#ref(&mut self) {
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

    pub(crate) fn unref(&mut self) {
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
    //
    // Parent comes via `SourceHandle::Subprocess` (the whole `*mut Subprocess`), not `&mut self`
    // on the `stdin` field; accesses are disjoint so `&Subprocess` suffices.
    pub(crate) fn on_close(process: &Subprocess<'_>, _: Option<bun_sys::Error>) {
        if let Some(this_jsvalue) = process.this_value.get().try_get() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                file_sink::JSSink::forget_subprocess(existing_value);
            }
        }

        // Move the payload out and write `.Ignore` *before*
        // `on_stdin_destroyed` — writing afterwards would follow a `deref()`
        // that may free `process`, a write-after-free. The only observable
        // difference is `has_pending_activity_stdio()` seeing `Ignore`
        // (== false) instead of a `Buffer` (== true) inside
        // `update_has_pending_activity`, which is the state it converges to
        // immediately after anyway.
        process.stdin.set(Writable::Ignore);

        // `on_stdin_destroyed` may `deref()` and free `process` as its last
        // act, so this must be the final access.
        process.on_stdin_destroyed();
    }

    /// Pumps `stream` into `pipe`, which `init` has just made `subprocess`'s stdin. That is undone if it throws.
    fn attach_stream(
        pipe: &RefPtr<FileSink>,
        stream: &mut crate::webcore::ReadableStream,
        subprocess: &Subprocess<'_>,
        global: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        FileSink::assign_to_stream(pipe, stream, global).inspect_err(|_| {
            subprocess.weak_file_sink_stdin_ptr.set(None);
            subprocess.stdin_sink_ref.set(None);
        })
    }

    /// # Safety
    /// The result becomes `subprocess.stdin`.
    pub(crate) unsafe fn init(
        mut stdio: Stdio,
        event_loop: &EventLoop,
        subprocess: &RefPtr<Subprocess<'_>>,
        result: StdioResult,
        promise_for_stream: &mut JSValue,
    ) -> JsResult<Writable> {
        let global = event_loop.global_ref();

        let evtloop = event_loop.as_handle();
        let owner = Owner::new(PollTag::SubprocessStdinWriter, subprocess.as_ptr().cast());
        // SAFETY: fn contract.
        let create_writer = |result, blob| unsafe { StaticPipeWriter::create(owner, result, blob) };

        #[cfg(windows)]
        {
            match stdio {
                Stdio::Pipe | Stdio::ReadableStream(_) => {
                    if let StdioResult::Buffer(buffer) = result {
                        let pipe_ref = FileSink::create_with_pipe(evtloop, buffer);
                        subprocess
                            .weak_file_sink_stdin_ptr
                            .set(Some(pipe_ref.as_non_null()));
                        subprocess.hold_for_stdin_sink();
                        subprocess.update_flags(|f| f.remove(Flags::HAS_STDIN_DESTRUCTOR_CALLED));

                        if let Stdio::ReadableStream(rs) = &mut stdio {
                            *promise_for_stream =
                                Self::attach_stream(&pipe_ref, rs, subprocess, global)?;
                        }

                        return Ok(Writable::Pipe(pipe_ref));
                    }
                    return Ok(Writable::Inherit);
                }

                Stdio::Blob(blob) => {
                    return Ok(Writable::Buffer(create_writer(result, blob)));
                }
                Stdio::Fd(fd) => {
                    return Ok(Writable::Fd(fd));
                }
                Stdio::Dup2(dup2) => {
                    return Ok(Writable::Fd(dup2.to.to_fd()));
                }
                Stdio::Inherit => {
                    return Ok(Writable::Inherit);
                }
                Stdio::Path(_) | Stdio::Ignore => {
                    return Ok(Writable::Ignore);
                }
                Stdio::Ipc | Stdio::Capture => {
                    return Ok(Writable::Ignore);
                }
                // Rejected at i < 3 in Stdio::extract(); stdin never sees this.
                Stdio::SocketFd => unreachable!("SocketFd at stdin"),
            }
        }

        #[cfg(unix)]
        {
            if matches!(stdio, Stdio::Pipe) {
                let _ = bun_sys::set_nonblocking(result.as_ref().unwrap().fd());
            }
        }

        #[cfg(not(windows))]
        match stdio {
            Stdio::Dup2(_) => panic!("TODO dup2 stdio"),
            Stdio::Pipe | Stdio::ReadableStream(_) => {
                let file = result.unwrap();
                let pipe_ref = FileSink::create(evtloop, file.fd());

                let writer = &pipe_ref.writer;
                if let Err(err) = writer.start(&*pipe_ref, evtloop.as_event_loop_ctx(), file, true)
                {
                    if let Stdio::ReadableStream(rs) = &mut stdio {
                        rs.cancel(global)?;
                    }
                    return Err(global.throw_value(err.to_js(global)));
                }

                writer.set_poll_flag(bun_io::FilePollFlag::Socket);

                subprocess
                    .weak_file_sink_stdin_ptr
                    .set(Some(pipe_ref.as_non_null()));
                subprocess.hold_for_stdin_sink();
                subprocess.update_flags(|f| f.remove(Flags::HAS_STDIN_DESTRUCTOR_CALLED));

                if let Stdio::ReadableStream(rs) = &mut stdio {
                    *promise_for_stream = Self::attach_stream(&pipe_ref, rs, subprocess, global)?;
                }

                Ok(Writable::Pipe(pipe_ref))
            }

            Stdio::Blob(blob) => Ok(Writable::Buffer(create_writer(result, blob))),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            Stdio::Memfd(_file) => Ok(Writable::Memfd { _file }),
            Stdio::Fd(fd) => Ok(Writable::Fd(fd)),
            Stdio::Inherit => Ok(Writable::Inherit),
            Stdio::Path(_) | Stdio::Ignore => Ok(Writable::Ignore),
            Stdio::Ipc | Stdio::Capture => Ok(Writable::Ignore),
            // Rejected at i < 3 in Stdio::extract(); stdin never sees this.
            Stdio::SocketFd => unreachable!("SocketFd at stdin"),
        }
    }

    pub(crate) fn to_js(subprocess: &Subprocess<'_>, global_this: &JSGlobalObject) -> JSValue {
        // Take only the parent and project `stdin` here so no two `&mut`
        // overlap at any point.
        match subprocess.stdin.replace(Writable::Ignore) {
            Writable::Fd(fd) => {
                subprocess.stdin.set(Writable::Fd(fd));
                fd.to_js(global_this)
            }
            #[cfg(any(target_os = "linux", target_os = "android"))]
            memfd @ Writable::Memfd { .. } => {
                subprocess.stdin.set(memfd);
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
            Writable::Pipe(pipe_ref) => {
                if let Some(status) = subprocess.process().status()
                    && !subprocess
                        .flags
                        .get()
                        .contains(Flags::HAS_STDIN_DESTRUCTOR_CALLED)
                {
                    // `Writable::init()` set `stdin_sink_ref`. `on_attached_process_exit()`
                    // → `writer.close()` → `pipe.source` → `Writable::on_close`
                    // → `on_stdin_destroyed()` balances that ref, so a ref-count
                    // drop across this call is expected (previously these
                    // writes were clobbered by the struct-literal reassignment
                    // in spawn_maybe_sync and this path asserted no ref change;
                    // see https://github.com/oven-sh/bun/pull/14092).
                    pipe_ref.on_attached_process_exit(status);
                    // The wrapper takes `pipe_ref`'s ref.
                    FileSink::to_js(pipe_ref, global_this)
                } else {
                    subprocess.update_flags(|f| f.set(Flags::HAS_STDIN_DESTRUCTOR_CALLED, false));
                    subprocess
                        .weak_file_sink_stdin_ptr
                        .set(Some(pipe_ref.as_non_null()));
                    if subprocess.stdin_sink_ref.get().is_none() {
                        // `Writable::init()` already did this for fresh pipes;
                        // only take a new ref if `on_stdin_destroyed()` has since
                        // consumed it.
                        subprocess.hold_for_stdin_sink();
                    }
                    let parent_ptr = subprocess.as_ctx_ptr().cast::<Subprocess<'static>>();
                    if matches!(pipe_ref.source.get(), SourceHandle::Subprocess(p) if p.as_const_ptr() == parent_ptr.cast_const())
                    {
                        pipe_ref.source.set(SourceHandle::None);
                    }
                    // The wrapper takes `pipe_ref`'s ref.
                    FileSink::to_js_for_subprocess(
                        pipe_ref,
                        global_this,
                        NonNull::from(subprocess).cast(),
                    )
                }
            }
        }
    }

    // Note: see `on_close` — the caller passes the parent; deriving it from
    // `&mut self` on `Writable` would be out-of-provenance.
    pub(crate) fn finalize(subprocess: &Subprocess<'_>) {
        if let Some(this_jsvalue) = subprocess.this_value.get().try_get() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                file_sink::JSSink::forget_subprocess(existing_value);
            }
        }

        // Source back-pointer is the `*mut Subprocess`, not the `stdin` address.
        let parent_ptr = subprocess.as_ctx_ptr().cast::<Subprocess<'static>>();
        match subprocess.stdin.replace(Writable::Ignore) {
            Writable::Pipe(pipe) => {
                if matches!(pipe.source.get(), SourceHandle::Subprocess(p) if p.as_const_ptr() == parent_ptr.cast_const())
                {
                    pipe.source.set(SourceHandle::None);
                }
            }
            #[cfg(any(target_os = "linux", target_os = "android"))]
            Writable::Memfd { .. } => {}
            Writable::Buffer(_) | Writable::Ignore => {}
            Writable::Fd(fd) => {
                subprocess.stdin.set(Writable::Fd(fd));
            }
            Writable::Inherit => {
                subprocess.stdin.set(Writable::Inherit);
            }
        }
    }

    pub(crate) fn close(this: &JsCell<Self>) {
        match this.get() {
            Writable::Pipe(pipe) => {
                let _ = pipe.clone().end(None);
            }
            #[cfg(any(target_os = "linux", target_os = "android"))]
            Writable::Memfd { .. } => this.set(Writable::Ignore),
            Writable::Fd(_) | Writable::Buffer(_) => this.set(Writable::Ignore),
            Writable::Ignore => {}
            Writable::Inherit => {}
        }
    }
}
