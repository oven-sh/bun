//! Windows cannot poll a pipe or a console, so a job waits for one inside the call.

use std::sync::Arc;

use bun_core::vec::BorrowedCursor;
use bun_iocp::blocking::Cancel;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{Completion, JobContext};
use bun_sys::windows::named_pipe;
use bun_sys::{self as sys, E, Fd, Tag};
use bun_threading::Guarded;
use bun_threading::work_pool::DEVICE_POOL;

/// The system copies a whole write to a pipe into memory that it cannot page out.
const MAX_WRITE: usize = 64 * 1024 * 1024;

/// The part of a job that can block, and what it leaves for [`JobContext::then`].
pub(super) struct BlockingPart<T> {
    result: Arc<Guarded<Option<sys::Result<T>>>>,
    blocking: Blocking,
}

impl<T> Default for BlockingPart<T> {
    fn default() -> Self {
        Self {
            result: Arc::default(),
            blocking: Blocking::default(),
        }
    }
}

impl<T: Send + 'static> BlockingPart<T> {
    /// The end of [`JobContext::run`].
    pub(super) fn run<C: JobContext + 'static>(
        &self,
        done: Completion<C>,
        work: impl FnOnce(&Blocking) -> sys::Result<T> + Send + 'static,
    ) -> Option<Completion<C>> {
        let (result, blocking) = (Arc::clone(&self.result), self.blocking.clone());
        let work = move || {
            let outcome = work(&blocking);
            *result.lock() = Some(outcome);
            done
        };
        if DEVICE_POOL.has_this_thread() {
            return Some(work());
        }
        DEVICE_POOL.go(|| work().finish());
        None
    }

    pub(super) fn take_result(&self) -> Option<sys::Result<T>> {
        self.result.lock().take()
    }

    /// Ends a read. What a script wrote still arrives, until `VirtualMachine::on_exit` has waited for it.
    pub(super) fn cancel(&self) {
        self.blocking.reads.cancel();
        if VirtualMachine::get().is_shutting_down() {
            self.blocking.writes.cancel();
        }
    }
}

/// The calls that only [`BlockingPart::run`] may wait for.
#[derive(Clone, Default)]
pub(super) struct Blocking {
    reads: Cancel,
    writes: Cancel,
}

impl Blocking {
    /// An overlapped device refuses a request without an offset.
    pub(super) fn read(
        &self,
        fd: Fd,
        buf: BorrowedCursor<'_, u8>,
        offset: Option<u64>,
    ) -> sys::Result<usize> {
        let read = self.reads.run(|| match offset {
            Some(offset) => sys::pread_buf(fd, buf, offset as i64),
            None => sys::read_buf(fd, buf),
        });
        read.unwrap_or_else(|| Err(sys::Error::from_code(E::ECANCELED, Tag::read)))
    }

    /// Writes at least one byte. `bytes` is not empty.
    pub(super) fn write(&self, fd: Fd, bytes: &[u8]) -> sys::Result<usize> {
        let len = bytes.len().min(MAX_WRITE);
        loop {
            let wrote = self.writes.run(|| sys::write(fd, &bytes[..len]));
            match wrote.unwrap_or_else(|| Err(sys::Error::from_code(E::ECANCELED, Tag::write)))? {
                0 => named_pipe::set_blocking(fd.native())
                    .map_err(|_| sys::Error::from_code(E::EAGAIN, Tag::write))?,
                wrote => return Ok(wrote),
            }
        }
    }
}
