use core::mem;
use std::rc::Rc;

use bun_core::output;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult};
use bun_sys::{self, Fd};

// TODO(port): verify path for bun.ptr.CowString — mapped to bun_collections per §Pointers,
// but CowString has takeSlice/length/deinit semantics not covered by std Cow.
use bun_collections::CowString;
// TODO(port): verify path for bun.spawn.Stdio
use crate::spawn::Stdio;
use crate::webcore::blob::SizeType as BlobSizeType;
use crate::webcore::ReadableStream;

use super::{MaxBuf, PipeReader, StdioResult, Subprocess};

pub enum Readable {
    Fd(Fd),
    Memfd(Fd),
    // LIFETIMES.tsv: SHARED → Rc<PipeReader> (PipeReader has intrusive RefCount; detach() → deref()).
    Pipe(Rc<PipeReader>),
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
}

impl Readable {
    pub fn memory_cost(&self) -> usize {
        match self {
            Readable::Pipe(pipe) => mem::size_of::<PipeReader>() + pipe.memory_cost(),
            Readable::Buffer(buffer) => buffer.length(),
            _ => 0,
        }
    }

    pub fn has_pending_activity(&self) -> bool {
        match self {
            Readable::Pipe(pipe) => pipe.has_pending_activity(),
            _ => false,
        }
    }

    pub fn r#ref(&mut self) {
        match self {
            Readable::Pipe(pipe) => {
                pipe.update_ref(true);
            }
            _ => {}
        }
    }

    pub fn unref(&mut self) {
        match self {
            Readable::Pipe(pipe) => {
                pipe.update_ref(false);
            }
            _ => {}
        }
    }

    pub fn init(
        stdio: Stdio,
        event_loop: &jsc::EventLoop,
        process: &mut Subprocess,
        result: StdioResult,
        max_size: Option<&mut MaxBuf>,
        _is_sync: bool,
    ) -> Readable {
        // PORT NOTE: Zig `allocator` param dropped (was unused / autofix); global mimalloc assumed.
        Subprocess::assert_stdio_result(&result);

        #[cfg(unix)]
        {
            if matches!(stdio, Stdio::Pipe { .. }) {
                let _ = bun_sys::set_nonblocking(result.unwrap());
            }
        }

        match stdio {
            Stdio::Inherit => Readable::Inherit,
            Stdio::Ignore | Stdio::Ipc | Stdio::Path(..) => Readable::Ignore,
            Stdio::Fd(fd) => {
                #[cfg(unix)]
                {
                    let _ = fd;
                    Readable::Fd(result.unwrap())
                }
                #[cfg(not(unix))]
                {
                    Readable::Fd(fd)
                }
            }
            Stdio::Memfd(memfd) => {
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
            Stdio::Pipe => Readable::Pipe(PipeReader::create(event_loop, process, result, max_size)),
            Stdio::ArrayBuffer(..) | Stdio::Blob(..) => {
                panic!("TODO: implement ArrayBuffer & Blob support in Stdio readable")
            }
            Stdio::Capture(..) => panic!("TODO: implement capture support in Stdio readable"),
            // ReadableStream is handled separately
            Stdio::ReadableStream(..) => Readable::Ignore,
        }
    }

    pub fn on_close(&mut self, _: Option<bun_sys::Error>) {
        *self = Readable::Closed;
    }

    pub fn on_ready(&mut self, _: Option<BlobSizeType>, _: Option<BlobSizeType>) {}

    pub fn on_start(&mut self) {}

    pub fn close(&mut self) {
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
                pipe.close();
            }
            _ => {}
        }
    }

    pub fn finalize(&mut self) {
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
                // PORT NOTE: reshaped for borrowck — Zig captures `pipe` by-copy then overwrites `this.*`.
                let Readable::Pipe(pipe) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                // TODO(port): detach() must NOT deref under Rc — PipeReader.rs must drop the self.deref() line
                // (Zig detach() = `process = null; deref()`; Rc Drop now owns the deref half).
                pipe.detach();
            }
            Readable::Buffer(_) => {
                // PORT NOTE: Zig calls `buf.deinit(default_allocator)` without resetting the tag.
                // In Rust, dropping the CowString (via overwrite) is the equivalent; finalize is terminal.
                *self = Readable::Closed;
            }
            _ => {}
        }
    }

    pub fn to_js(&mut self, global: &JSGlobalObject, _exited: bool) -> JsResult<JSValue> {
        match self {
            // should only be reachable when the entire output is buffered.
            Readable::Memfd(_) => self.to_buffered_value(global),

            Readable::Fd(fd) => Ok(fd.to_js(global)),
            Readable::Pipe(_) => {
                // PORT NOTE: reshaped for borrowck.
                let Readable::Pipe(pipe) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                let result = pipe.to_js(global);
                // TODO(port): detach() must NOT deref under Rc — PipeReader.rs must drop the self.deref() line
                pipe.detach();
                Ok(result)
            }
            Readable::Buffer(_) => {
                // PORT NOTE: reshaped for borrowck — `defer this.* = .closed` becomes take-then-use.
                let Readable::Buffer(mut buffer) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };

                if buffer.length() == 0 {
                    return ReadableStream::empty(global);
                }

                let own = buffer.take_slice()?;
                ReadableStream::from_owned_slice(global, own, 0)
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    pub fn to_buffered_value(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
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
                    jsc::ArrayBuffer::to_js_buffer_from_memfd(fd, global)
                }
            }
            Readable::Pipe(_) => {
                // PORT NOTE: reshaped for borrowck.
                let Readable::Pipe(pipe) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                let result = pipe.to_buffer(global);
                // TODO(port): detach() must NOT deref under Rc — PipeReader.rs must drop the self.deref() line
                pipe.detach();
                Ok(result)
            }
            Readable::Buffer(_) => {
                // PORT NOTE: reshaped for borrowck.
                let Readable::Buffer(mut buf) = mem::replace(self, Readable::Closed) else {
                    unreachable!()
                };
                let own = match buf.take_slice() {
                    Ok(own) => own,
                    Err(_) => return Err(global.throw_out_of_memory()),
                };

                Ok(jsc::MarkedArrayBuffer::from_bytes(own, jsc::TypedArrayType::Uint8Array)
                    .to_node_buffer(global))
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }
}

#[allow(unused_imports)]
use bun_core as _; // bun.Output → bun_core (panics inlined as panic!())

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/subprocess/Readable.zig (195 lines)
//   confidence: medium
//   todos:      5
//   notes:      Stdio variant payloads guessed; CowString mapped to bun_collections; pipe.detach() flagged at 3 sites — PipeReader.rs must drop self.deref() (Rc owns it) or rename to clear_process().
// ──────────────────────────────────────────────────────────────────────────
