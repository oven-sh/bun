use core::ffi::c_void;

use bun_jsc::{JSGlobalObject, JSValue, event_loop::EventLoop};
use bun_ptr::RefPtr;
use bun_sys::{self, Fd, FdExt};

use crate::api::bun_spawn::stdio::Stdio;
use crate::node::types::FdJsc;
use crate::webcore::file_sink::{self, FileSink};
use crate::webcore::sink;
use crate::webcore::streams::SourceHandle;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;

use super::{Flags, StaticPipeWriter, StdioResult, Subprocess, js};

pub enum Writable<'a> {
    Pipe(RefPtr<FileSink>),
    Fd(Fd),
    Buffer(RefPtr<StaticPipeWriter<'a>>),
    Memfd(Fd),
    Inherit,
    Ignore,
}

impl<'a> Writable<'a> {
    /// Mutable borrow of the `Pipe` payload's `FileSink`.
    ///
    /// `RefPtr` deliberately has no `DerefMut`; what makes `&mut` sound here
    /// is that `Writable::Pipe` holds a ref for the variant's lifetime, the
    /// sink lives in its own heap allocation disjoint from
    /// `Writable`/`Subprocess`, and access is single-JS-mutator-thread.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn pipe_sink_mut(pipe: &RefPtr<FileSink>) -> &mut FileSink {
        // SAFETY: see fn doc.
        unsafe { &mut *pipe.as_ptr() }
    }

    /// Mutable borrow of the `Buffer` payload's `StaticPipeWriter`; same
    /// invariant as [`pipe_sink_mut`](Self::pipe_sink_mut).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(in crate::api) fn buffer_writer_mut<'b>(
        buffer: &'b RefPtr<StaticPipeWriter<'a>>,
    ) -> &'b mut StaticPipeWriter<'a> {
        // SAFETY: see fn doc.
        unsafe { &mut *buffer.as_ptr() }
    }

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
                Self::buffer_writer_mut(buffer).update_ref(true);
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
                Self::buffer_writer_mut(buffer).update_ref(false);
            }
            _ => {}
        }
    }

    // When the stream has closed we need to be notified to prevent a use-after-free
    // We can test for this use-after-free by enabling hot module reloading on a file and then saving it twice
    //
    // Parent comes via `SourceHandle::Subprocess` (the whole `*mut Subprocess`), not `&mut self`
    // on the `stdin` field; accesses are disjoint so `&Subprocess` suffices.
    pub fn on_close(process: &Subprocess<'a>, _: Option<bun_sys::Error>) {
        if let Some(this_jsvalue) = process.this_value.get().try_get() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                file_sink::JSSink::set_destroy_callback(existing_value, 0);
            }
        }

        // Move the payload out and write `.Ignore` *before*
        // `on_stdin_destroyed` — writing afterwards would follow a `deref()`
        // that may free `process`, a write-after-free. The only observable
        // difference is `has_pending_activity_stdio()` seeing `Ignore`
        // (== false) instead of a just-deref'd `Buffer` (== true) inside
        // `update_has_pending_activity`, which is the state it converges to
        // immediately after anyway.
        process.stdin.set(Writable::Ignore);

        // `on_stdin_destroyed` may `deref()` and free `process` as its last
        // act, so this must be the final access.
        process.on_stdin_destroyed();
    }

    pub(crate) fn init(
        stdio: &mut Stdio,
        event_loop: &EventLoop,
        subprocess: &mut Subprocess<'a>,
        result: StdioResult,
        promise_for_stream: &mut JSValue,
    ) -> crate::Result<Writable<'a>> {
        super::assert_stdio_result!(result);

        let global = event_loop.global_ref();

        // `FileSink::create` / `StaticPipeWriter::create` take
        // `bun_event_loop::EventLoopHandle`, not `&bun_jsc::EventLoop`; erase to
        // the vtable-backed handle once and reuse for all arms (both platforms).
        // `event_loop` is a `&jsc::EventLoop` for the live per-thread loop;
        // erasing to `*mut ()` and back is the `EventLoopHandle::init` contract.
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
                        // FileSink's writer (the sink takes over the heap
                        // pointer).
                        let uv_pipe: *mut _ = bun_core::heap::into_raw(buffer);
                        let pipe_ref = FileSink::create_with_pipe(evtloop, uv_pipe);
                        let pipe = Self::pipe_sink_mut(&pipe_ref);

                        match pipe.writer.with_mut(|w| w.start_with_current_pipe()) {
                            bun_sys::Result::Ok(()) => {}
                            bun_sys::Result::Err(_err) => {
                                if let Stdio::ReadableStream(rs) = stdio {
                                    rs.cancel(global)?;
                                }
                                return Err(crate::Error::UnexpectedCreatingStdin);
                            }
                        }
                        pipe.writer.with_mut(|w| w.set_parent(pipe_ref.as_ptr()));
                        subprocess
                            .weak_file_sink_stdin_ptr
                            .set(Some(pipe_ref.as_non_null()));
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
                                subprocess.deref();
                                let _ = global.throw_value(err_val);
                                return Err(crate::Error::JSError);
                            }
                            *promise_for_stream = assign_result;
                        }

                        return Ok(Writable::Pipe(pipe_ref));
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
                // Rejected at i < 3 in Stdio::extract(); stdin never sees this.
                Stdio::SocketFd => unreachable!("SocketFd at stdin"),
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
                let pipe_ref = FileSink::create(evtloop, result.unwrap());
                let pipe = Self::pipe_sink_mut(&pipe_ref);

                match pipe.writer.with_mut(|w| w.start(pipe.fd.get(), true)) {
                    bun_sys::Result::Ok(()) => {}
                    bun_sys::Result::Err(_err) => {
                        if let Stdio::ReadableStream(rs) = stdio {
                            rs.cancel(global)?;
                        }
                        return Err(crate::Error::UnexpectedCreatingStdin);
                    }
                }

                // `handle` is `PollOrFd` (enum); flag mutation goes
                // through the FilePoll vtable shim.
                pipe.writer.with_mut(|w| {
                    if let Some(poll) = w.handle.get_poll() {
                        poll.set_flag(bun_io::FilePollFlag::Socket);
                    }
                });

                subprocess
                    .weak_file_sink_stdin_ptr
                    .set(Some(pipe_ref.as_non_null()));
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
                        subprocess.deref();
                        let _ = global.throw_value(err_val);
                        return Err(crate::Error::JSError);
                    }
                    *promise_for_stream = assign_result;
                }

                Ok(Writable::Pipe(pipe_ref))
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
            Stdio::Memfd(_) => {
                // Transfer ownership: `Stdio`'s Drop would close the memfd, so
                // take it out via ManuallyDrop (same pattern as the Blob arm)
                // to keep the caller's `stdio[0]` drop from double-closing the
                // fd that Writable now owns.
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
            // Rejected at i < 3 in Stdio::extract(); stdin never sees this.
            Stdio::SocketFd => unreachable!("SocketFd at stdin"),
        }
    }

    pub fn to_js(subprocess: &Subprocess<'a>, global_this: &JSGlobalObject) -> JSValue {
        // Take only the parent and project `stdin` here so no two `&mut`
        // overlap at any point.
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
            Writable::Pipe(pipe_ref) => {
                if subprocess.has_exited()
                    && !subprocess
                        .flags
                        .get()
                        .contains(Flags::HAS_STDIN_DESTRUCTOR_CALLED)
                {
                    // `Writable::init()` already called `subprocess.ref()` and
                    // set `DEREF_ON_STDIN_DESTROYED`. `on_attached_process_exit()`
                    // → `writer.close()` → `pipe.source` → `Writable::on_close`
                    // → `on_stdin_destroyed()` balances that ref, so a ref-count
                    // drop across this call is expected (previously these
                    // writes were clobbered by the struct-literal reassignment
                    // in spawn_maybe_sync and this path asserted no ref change;
                    // see https://github.com/oven-sh/bun/pull/14092).
                    //
                    // The call re-enters via the writer backref, so no `&mut
                    // FileSink` is materialized across it.
                    // SAFETY: `pipe_ref` keeps the sink live.
                    unsafe {
                        FileSink::on_attached_process_exit(
                            pipe_ref.as_ptr(),
                            &subprocess.process().status,
                        )
                    };
                    // The wrapper takes its own ref; `pipe_ref` drops after.
                    Self::pipe_sink_mut(&pipe_ref).to_js(global_this)
                } else {
                    let pipe = Self::pipe_sink_mut(&pipe_ref);
                    subprocess.update_flags(|f| f.set(Flags::HAS_STDIN_DESTRUCTOR_CALLED, false));
                    subprocess
                        .weak_file_sink_stdin_ptr
                        .set(Some(pipe_ref.as_non_null()));
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
                    let parent_ptr = subprocess.as_ctx_ptr().cast::<Subprocess<'static>>();
                    if matches!(*pipe.source.get(), SourceHandle::Subprocess(p) if p.as_const_ptr() == parent_ptr.cast_const())
                    {
                        pipe.source.with_mut(|s| s.clear());
                    }
                    // The wrapper takes its own ref; `pipe_ref` drops after.
                    pipe.to_js_with_destructor(
                        global_this,
                        Some(sink::destructor_ptr_subprocess(
                            subprocess.as_ctx_ptr().cast::<c_void>(),
                        )),
                    )
                }
            }
        }
    }

    // Note: see `on_close` — the caller passes the parent; deriving it from
    // `&mut self` on `Writable` would be out-of-provenance.
    pub fn finalize(subprocess: &Subprocess<'a>) {
        if let Some(this_jsvalue) = subprocess.this_value.get().try_get() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                file_sink::JSSink::set_destroy_callback(existing_value, 0);
            }
        }

        // Source back-pointer is the `*mut Subprocess`, not the `stdin` address.
        let parent_ptr = subprocess.as_ctx_ptr().cast::<Subprocess<'static>>();
        match subprocess.stdin.replace(Writable::Ignore) {
            Writable::Pipe(pipe) => {
                if matches!(*pipe.source.get(), SourceHandle::Subprocess(p) if p.as_const_ptr() == parent_ptr.cast_const())
                {
                    pipe.source.with_mut(|s| s.clear());
                }
            }
            Writable::Buffer(buffer) => {
                Self::buffer_writer_mut(&buffer).update_ref(false);
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
                Self::buffer_writer_mut(buffer).close();
            }
            Writable::Ignore => {}
            Writable::Inherit => {}
        }
    }
}
