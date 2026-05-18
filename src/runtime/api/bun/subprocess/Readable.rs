use core::mem;
use core::ptr::NonNull;

use bun_core::output;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult, event_loop::EventLoop};
use bun_sys::{self, Fd, FdExt as _};

use crate::node::types::FdJsc as _;

use crate::api::bun_spawn::stdio::Stdio;
use crate::webcore::ReadableStream;
use crate::webcore::blob::SizeType as BlobSizeType;
use bun_io::max_buf::MaxBuf;
use bun_ptr::IntrusiveRc;
use bun_ptr::cow_slice::CowSlice;

use super::subprocess_pipe_reader::PipeReader;
use super::{StdioResult, Subprocess};

// `bun.ptr.CowString` — the Zig-shaped owned/borrowed byte slice (has
// `init_owned` / `length` / `take_slice`). Distinct from the std `Cow` alias
// re-exported at `bun_ptr::CowString`.
pub type CowString = CowSlice<u8>;

pub enum Readable {
    Fd(Fd),
    Memfd(Fd),
    // LIFETIMES.tsv: SHARED → IntrusiveRc<PipeReader> (PipeReader has intrusive RefCount; detach() → deref()).
    Pipe(IntrusiveRc<PipeReader>),
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
    /// Mutable borrow of the `Pipe` payload's `PipeReader`.
    ///
    /// Centralises the `IntrusiveRc → &mut T` deref so the per-match-arm
    /// `unsafe` blocks (`ref_`/`unref`/`close` and the `Subprocess` callers in
    /// `on_close_io`/`on_process_exit`/`testing_apis`) collapse to this one
    /// site. `IntrusiveRc` (= `RefPtr`) deliberately has no `DerefMut`; the
    /// invariant that makes `&mut` sound here is that `Readable::Pipe` holds
    /// the owning strong ref for the variant's lifetime (created by
    /// `PipeReader::create`, released by `detach()`/`deref()` only after the
    /// variant is moved out), the reader lives in its own heap allocation
    /// disjoint from `Readable`/`Subprocess`, and access is
    /// single-JS-mutator-thread.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(in crate::api) fn pipe_reader_mut(pipe: &IntrusiveRc<PipeReader>) -> &mut PipeReader {
        // SAFETY: see fn doc — owning IntrusiveRc, heap-disjoint, single-thread.
        unsafe { &mut *pipe.as_ptr() }
    }

    /// Consume an owned `IntrusiveRc<PipeReader>`, clear its `process` backref,
    /// and release the ref (Zig: `pipe.detach()`). Centralises what was the
    /// `into_raw()` + `unsafe { PipeReader::detach(raw) }` dance so the three
    /// callers in `finalize` / `to_js` / `to_buffered_value` stay safe — the
    /// owned `IntrusiveRc` already encodes the "live + one ref" invariant
    /// `detach()` needs, and `RefPtr::deref` is the safe drop.
    #[inline]
    fn pipe_detach(pipe: IntrusiveRc<PipeReader>) {
        Self::pipe_reader_mut(&pipe).process = None;
        pipe.deref();
    }

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

    pub fn ref_(&mut self) {
        match self {
            Readable::Pipe(pipe) => {
                Self::pipe_reader_mut(pipe).update_ref(true);
            }
            _ => {}
        }
    }

    pub fn unref(&mut self) {
        match self {
            Readable::Pipe(pipe) => {
                Self::pipe_reader_mut(pipe).update_ref(false);
            }
            _ => {}
        }
    }

    pub fn init(
        stdio: Stdio,
        event_loop: NonNull<EventLoop>,
        process: NonNull<Subprocess<'static>>,
        result: StdioResult,
        max_size: Option<NonNull<MaxBuf>>,
        _is_sync: bool,
    ) -> Readable {
        // PORT NOTE: Zig `allocator` param dropped (was unused / autofix); global mimalloc assumed.
        Subprocess::assert_stdio_result(&result);

        // Ownership of any resource inside `stdio` (notably `.memfd`) is being
        // *transferred* into the returned `Readable` — Zig's `Readable.init`
        // never calls `stdio.deinit()`. `Stdio` has a Rust `Drop` impl that
        // would close the memfd, so suppress it here to avoid a double-close
        // (EBADF) when the Readable later closes the same fd.
        let stdio = mem::ManuallyDrop::new(stdio);

        #[cfg(unix)]
        {
            if matches!(*stdio, Stdio::Pipe) {
                let _ = bun_sys::set_nonblocking(result.unwrap());
            }
        }

        match &*stdio {
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
                    Readable::Fd(*fd)
                }
            }
            Stdio::Memfd(memfd) => {
                #[cfg(unix)]
                {
                    Readable::Memfd(*memfd)
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
                Self::pipe_reader_mut(pipe).close();
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
                Self::pipe_detach(pipe);
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
                let result = Self::pipe_reader_mut(&pipe).to_js(global);
                Self::pipe_detach(pipe);
                result
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
                ReadableStream::from_owned_slice(global, own.into_vec(), 0)
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
                let result = Self::pipe_reader_mut(&pipe).to_buffer(global);
                Self::pipe_detach(pipe);
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

                // PORT NOTE: ownership of the mimalloc-backed buffer transfers to
                // JSC (freed via `MarkedArrayBuffer_deallocator`) — matches Zig
                // `fromBytes(own, .Uint8Array)`.
                Ok(jsc::MarkedArrayBuffer {
                    buffer: jsc::ArrayBuffer::from_owned_bytes(own, jsc::JSType::Uint8Array),
                    owns_buffer: true,
                }
                .to_node_buffer(global))
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }
}

#[allow(unused_imports)]
use bun_core as _; // bun.Output → bun_core (panics inlined as panic!())

// ported from: src/runtime/api/bun/subprocess/Readable.zig
