use core::mem;
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JSValue, JsResult, event_loop::EventLoop};
use bun_sys::{self, Fd, FdExt as _};

use crate::node::types::FdJsc as _;

use crate::api::bun_spawn::stdio::Stdio;
use crate::webcore::ReadableStream;
use bun_io::max_buf::MaxBuf;
use bun_ptr::RefPtr;
use bun_ptr::cow_slice::CowSlice;

use super::subprocess_pipe_reader::PipeReader;
use super::{StdioResult, Subprocess};

// `bun.ptr.CowString` — owned/borrowed byte slice (has
// `init_owned` / `length` / `take_slice`).
pub(crate) type CowString = CowSlice<u8>;

pub(crate) enum Readable {
    Fd(Fd),
    #[cfg_attr(windows, allow(dead_code))]
    Memfd(Fd),
    Pipe(RefPtr<PipeReader>),
    Inherit,
    Ignore,
    Closed,
    /// Eventually we will implement Readables created from blobs and array buffers.
    /// When we do that, `buffer` will be borrowed from those objects.
    ///
    /// When a buffered `pipe` finishes reading from its file descriptor,
    /// the owning `Readable` will be converted into this variant and the pipe's
    /// buffer will be taken as an owned `CowString`.
    Buffer(CowString),
    /// A buffered `pipe` whose read failed: the bytes read before the error, then the error.
    Errored(CowString, bun_sys::Error),
}

impl Readable {
    /// Mutable borrow of the `Pipe` payload's `PipeReader`.
    ///
    /// `RefPtr` deliberately has no `DerefMut`; what makes `&mut` sound here
    /// is that `Readable::Pipe` holds the owning ref for the variant's
    /// lifetime, the reader lives in its own heap allocation disjoint from
    /// `Readable`/`Subprocess`, and access is single-JS-mutator-thread.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(in crate::api) fn pipe_reader_mut(pipe: &RefPtr<PipeReader>) -> &mut PipeReader {
        // SAFETY: see fn doc — owning RefPtr, heap-disjoint, single-thread.
        unsafe { &mut *pipe.as_ptr() }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        match self {
            Readable::Pipe(pipe) => mem::size_of::<PipeReader>() + pipe.memory_cost(),
            Readable::Buffer(buffer) | Readable::Errored(buffer, _) => buffer.length(),
            _ => 0,
        }
    }

    pub(crate) fn has_pending_activity(&self) -> bool {
        match self {
            Readable::Pipe(pipe) => pipe.has_pending_activity(),
            _ => false,
        }
    }

    pub(crate) fn ref_(&mut self) {
        match self {
            Readable::Pipe(pipe) => {
                Self::pipe_reader_mut(pipe).update_ref(true);
            }
            _ => {}
        }
    }

    pub(crate) fn unref(&mut self) {
        match self {
            Readable::Pipe(pipe) => {
                Self::pipe_reader_mut(pipe).update_ref(false);
            }
            _ => {}
        }
    }

    pub(crate) fn init(
        stdio: Stdio,
        event_loop: NonNull<EventLoop>,
        process: NonNull<Subprocess<'static>>,
        result: StdioResult,
        max_size: Option<NonNull<MaxBuf>>,
        _is_sync: bool,
    ) -> Readable {
        super::assert_stdio_result!(result);

        let mut stdio = stdio;
        #[cfg(unix)]
        {
            if matches!(stdio, Stdio::Pipe) {
                let _ = bun_sys::set_nonblocking(result.unwrap());
            }
        }

        match &stdio {
            Stdio::Inherit => Readable::Inherit,
            Stdio::Ignore | Stdio::Ipc | Stdio::Path(..) | Stdio::OwnedFd(..) => Readable::Ignore,
            Stdio::Fd(fd) => {
                #[cfg(unix)]
                {
                    let _ = fd;
                    Readable::Fd(result.unwrap())
                }
                #[cfg(not(unix))]
                {
                    Readable::Fd(*fd)
                }
            }
            Stdio::Memfd(_) => {
                // Ownership of the fd moves into the Readable; `Stdio`'s Drop would close it.
                let memfd = stdio.take_memfd().unwrap();
                #[cfg(unix)]
                {
                    Readable::Memfd(memfd)
                }
                #[cfg(not(unix))]
                {
                    let _ = memfd;
                    Readable::Ignore
                }
            }
            Stdio::Dup2(dup2) => {
                #[cfg(unix)]
                {
                    let _ = dup2;
                    panic!("TODO: implement dup2 support in Stdio readable");
                }
                #[cfg(not(unix))]
                {
                    Readable::Fd(dup2.out.to_fd())
                }
            }
            Stdio::Pipe => {
                Readable::Pipe(PipeReader::create(event_loop, process, result, max_size))
            }
            Stdio::Blob(..) => panic!("TODO: implement Blob support in Stdio readable"),
            Stdio::Capture(..) => panic!("TODO: implement capture support in Stdio readable"),
            // ReadableStream is handled separately
            Stdio::ReadableStream(..) => Readable::Ignore,
            // Rejected at i < 3 in Stdio::extract(); stdout/stderr never see this.
            Stdio::SocketFd => unreachable!("SocketFd at stdout/stderr"),
        }
    }

    pub(crate) fn close(&mut self) {
        match self {
            Readable::Memfd(fd) => {
                let fd = *fd;
                *self = Readable::Closed;
                fd.close();
            }
            Readable::Fd(_) => {
                *self = Readable::Closed;
            }
            Readable::Pipe(pipe) => {
                Self::pipe_reader_mut(pipe).close();
            }
            _ => {}
        }
    }

    pub(crate) fn finalize(&mut self) {
        match self {
            Readable::Memfd(fd) => {
                let fd = *fd;
                *self = Readable::Closed;
                fd.close();
            }
            Readable::Fd(_) => {
                *self = Readable::Closed;
            }
            Readable::Pipe(_) => {
                let Readable::Pipe(pipe) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                #[cfg(unix)]
                {
                    let release_start_ref = {
                        let reader = Self::pipe_reader_mut(&pipe);
                        if reader.process.is_some()
                            && matches!(reader.state, super::subprocess_pipe_reader::State::Pending)
                            && reader.ref_count.get() > 1
                        {
                            reader.reader.deinit();
                            true
                        } else {
                            false
                        }
                    };
                    if release_start_ref {
                        // SAFETY: guard above proved a second ref exists; this deref cannot reach zero.
                        unsafe { PipeReader::deref(pipe.as_ptr()) };
                    }
                }
                Self::pipe_reader_mut(&pipe).process = None;
            }
            Readable::Buffer(_) | Readable::Errored(..) => {
                // Dropping the CowString (via the overwrite) frees the buffer;
                // finalize is terminal.
                *self = Readable::Closed;
            }
            _ => {}
        }
    }

    pub(crate) fn to_js(&mut self, cx: &bun_jsc::JsThread<'_>, _exited: bool) -> JsResult<JSValue> {
        match self {
            // should only be reachable when the entire output is buffered.
            Readable::Memfd(_) => self.to_buffered_value(cx.global()),

            Readable::Fd(fd) => Ok(fd.to_js(cx.global())),
            Readable::Pipe(_) => {
                let Readable::Pipe(pipe) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                let result = Self::pipe_reader_mut(&pipe).to_js(cx);
                Self::pipe_reader_mut(&pipe).process = None;
                result
            }
            Readable::Buffer(_) => {
                let Readable::Buffer(mut buffer) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };

                if buffer.length() == 0 {
                    return ReadableStream::empty(cx.global());
                }

                let own = buffer.take_slice()?;
                ReadableStream::from_owned_slice(cx, own.into_vec(), 0)
            }
            Readable::Errored(..) => {
                let Readable::Errored(mut buffer, err) = mem::replace(self, Readable::Closed)
                else {
                    unreachable!()
                };
                let own = buffer.take_slice()?;
                ReadableStream::from_bytes_then_error(cx, own.into_vec(), err)
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn to_buffered_value(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Readable::Fd(fd) => Ok(fd.to_js(global)),
            Readable::Memfd(fd) => {
                #[cfg(not(unix))]
                {
                    let _ = fd;
                    panic!("memfd is only supported on Linux");
                }
                #[cfg(unix)]
                {
                    let fd = *fd;
                    *self = Readable::Closed;
                    bun_jsc::ArrayBuffer::to_js_buffer_from_memfd(fd, global)
                }
            }
            Readable::Pipe(_) => {
                let Readable::Pipe(pipe) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                let result = Self::pipe_reader_mut(&pipe).to_buffer(global);
                Self::pipe_reader_mut(&pipe).process = None;
                result
            }
            Readable::Buffer(_) => {
                let Readable::Buffer(mut buf) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                let own = match buf.take_slice() {
                    Ok(own) => own,
                    Err(_) => return Err(global.throw_out_of_memory()),
                };

                JSValue::create_buffer_from_box(global, own)
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    /// The error reading this output ended with, taken out of it. `spawnSync` asks before
    /// `to_buffered_value` and throws it: the output that was lost cannot be returned.
    pub(crate) fn take_read_error(&mut self) -> Option<bun_sys::Error> {
        match mem::replace(self, Readable::Closed) {
            Readable::Errored(_, err) => Some(err),
            other => {
                *self = other;
                None
            }
        }
    }
}

use bun_core as _; // bun.Output → bun_core (panics inlined as panic!())
