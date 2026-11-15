use core::mem;
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JSValue, JsCell, JsResult, event_loop::EventLoop};
use bun_sys::{self, Fd};

use crate::node::types::FdJsc as _;

use crate::api::bun_spawn::stdio::Stdio;
use crate::webcore::ReadableStream;
use bun_io::max_buf;
use bun_ptr::RefPtr;

use super::subprocess_pipe_reader::PipeReader;
use super::{StdioResult, Subprocess};

pub(crate) enum Readable {
    Fd(Fd),
    /// Becomes `Buffer` or `Errored` when the read ends.
    Pipe(RefPtr<PipeReader>),
    Inherit,
    Ignore,
    Closed,
    /// What a buffered `pipe` read, once it has finished reading.
    Buffer(Box<[u8]>),
    /// A buffered `pipe` whose read failed: the bytes read before the error, then the error.
    Errored(Box<[u8]>, bun_sys::Error),
}

impl Readable {
    /// A ref of the caller's own, for a call that can end the read and so replace `self`.
    pub(crate) fn pipe(&self) -> Option<RefPtr<PipeReader>> {
        match self {
            Readable::Pipe(pipe) => Some(pipe.clone()),
            _ => None,
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        match self {
            Readable::Pipe(pipe) => mem::size_of::<PipeReader>() + pipe.memory_cost(),
            Readable::Buffer(buffer) | Readable::Errored(buffer, _) => buffer.len(),
            _ => 0,
        }
    }

    pub(crate) fn has_pending_activity(&self) -> bool {
        matches!(self, Readable::Pipe(_))
    }

    pub(crate) fn ref_(&self) {
        if let Readable::Pipe(pipe) = self {
            pipe.update_ref(true);
        }
    }

    pub(crate) fn unref(&self) {
        if let Readable::Pipe(pipe) = self {
            pipe.update_ref(false);
        }
    }

    pub(crate) fn init(
        stdio: &Stdio,
        event_loop: &EventLoop,
        process: NonNull<Subprocess<'static>>,
        result: StdioResult,
        max_size: Option<&max_buf::OwnerRef>,
        _is_sync: bool,
    ) -> Readable {
        #[cfg(unix)]
        {
            if matches!(stdio, Stdio::Pipe) {
                let _ = bun_sys::set_nonblocking(result.as_ref().unwrap().fd());
            }
        }

        match stdio {
            Stdio::Inherit => Readable::Inherit,
            Stdio::Ignore | Stdio::Ipc | Stdio::Path(..) => Readable::Ignore,
            Stdio::Fd(fd) => Readable::Fd(*fd),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            Stdio::Memfd(_) => unreachable!("Memfd at stdout/stderr"),
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
            Stdio::Capture => panic!("TODO: implement capture support in Stdio readable"),
            Stdio::ReadableStream(..) => {
                // Nothing reads it, but closing it would fail the child's writes.
                #[cfg(unix)]
                let _ = result.map(bun_sys::File::into_raw);
                #[cfg(windows)]
                if let StdioResult::Buffer(pipe) = result {
                    let _ = pipe.into_raw();
                }
                Readable::Ignore
            }
            // Rejected at i < 3 in Stdio::extract(); stdout/stderr never see this.
            Stdio::SocketFd => unreachable!("SocketFd at stdout/stderr"),
        }
    }

    pub(crate) fn close(this: &JsCell<Self>) {
        match this.get() {
            Readable::Fd(_) => this.set(Readable::Closed),
            Readable::Pipe(pipe) => PipeReader::close(&pipe.clone()),
            _ => {}
        }
    }

    pub(crate) fn finalize(&mut self) {
        match self {
            Readable::Fd(_) => {
                *self = Readable::Closed;
            }
            Readable::Pipe(_) => {
                let Readable::Pipe(pipe) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                pipe.finalize();
            }
            Readable::Buffer(_) | Readable::Errored(..) => {
                *self = Readable::Closed;
            }
            _ => {}
        }
    }

    pub(crate) fn to_js(&mut self, cx: &bun_jsc::JsThread<'_>, _exited: bool) -> JsResult<JSValue> {
        match self {
            Readable::Fd(fd) => Ok(fd.to_js(cx.global())),
            Readable::Pipe(_) => {
                let Readable::Pipe(pipe) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                pipe.to_js(cx)
            }
            Readable::Buffer(_) => {
                let Readable::Buffer(buffer) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };

                if buffer.is_empty() {
                    return ReadableStream::empty(cx.global());
                }

                ReadableStream::from_owned_slice(cx, buffer.into_vec(), 0)
            }
            Readable::Errored(..) => {
                let Readable::Errored(buffer, err) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                ReadableStream::from_bytes_then_error(cx, buffer.into_vec(), err)
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn to_buffered_value(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Readable::Fd(fd) => Ok(fd.to_js(global)),
            Readable::Pipe(_) => {
                let Readable::Pipe(pipe) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                pipe.detach();
                Ok(JSValue::UNDEFINED)
            }
            Readable::Buffer(_) => {
                let Readable::Buffer(buffer) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                JSValue::create_buffer_from_box(global, buffer)
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
