//! Pipes and consoles have no readiness polling on Windows, so jobs use blocking calls on the device pool.

use std::sync::Arc;

use bun_core::vec::BorrowedCursor;
use bun_iocp::blocking::CancelToken;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{Completion, JobContext};
use bun_sys::windows::named_pipe;
use bun_sys::{self as sys, E, Fd, Tag};
use bun_threading::Guarded;
use bun_threading::work_pool::DEVICE_POOL;

/// NPFS copies a pending write into nonpaged pool.
const MAX_WRITE_LEN: usize = 64 * 1024 * 1024;

/// The blocking phase of a job, and its result for [`JobContext::then`].
pub(super) struct BlockingTask<T> {
    result: Arc<Guarded<Option<sys::Result<T>>>>,
    io: BlockingIo,
}

impl<T> Default for BlockingTask<T> {
    fn default() -> Self {
        Self {
            result: Arc::default(),
            io: BlockingIo::default(),
        }
    }
}

impl<T: Send + 'static> BlockingTask<T> {
    /// Must be the tail call of [`JobContext::run`].
    pub(super) fn run<C: JobContext + 'static>(
        &self,
        done: Completion<C>,
        work: impl FnOnce(&BlockingIo) -> sys::Result<T> + Send + 'static,
    ) -> Option<Completion<C>> {
        let result_slot = Arc::clone(&self.result);
        let io = self.io.clone();
        let task = move || {
            let result = work(&io);
            *result_slot.lock() = Some(result);
            done
        };
        if DEVICE_POOL.has_current_thread() {
            return Some(task());
        }
        DEVICE_POOL.go(|| task().finish());
        None
    }

    pub(super) fn take_result(&self) -> Option<sys::Result<T>> {
        self.result.lock().take()
    }

    /// Writes are cancelled only at shutdown, after `VirtualMachine::on_exit` has waited for them.
    pub(super) fn cancel(&self) {
        self.io.read_cancel_token.cancel();
        if VirtualMachine::get().is_shutting_down() {
            self.io.write_cancel_token.cancel();
        }
    }
}

/// Cancellable blocking calls, for use inside [`BlockingTask::run`] only.
#[derive(Clone, Default)]
pub(super) struct BlockingIo {
    read_cancel_token: CancelToken,
    write_cancel_token: CancelToken,
}

impl BlockingIo {
    /// An overlapped device rejects a read without an offset.
    pub(super) fn read(
        &self,
        fd: Fd,
        buf: BorrowedCursor<'_, u8>,
        offset: Option<u64>,
    ) -> sys::Result<usize> {
        let result = self.read_cancel_token.run(|| match offset {
            Some(offset) => sys::pread_buf(fd, buf, offset as i64),
            None => sys::read_buf(fd, buf),
        });
        result.unwrap_or_else(|| Err(sys::Error::from_code(E::ECANCELED, Tag::read)))
    }

    /// Writes at least one byte; `bytes` must not be empty.
    pub(super) fn write(&self, fd: Fd, bytes: &[u8]) -> sys::Result<usize> {
        let len = bytes.len().min(MAX_WRITE_LEN);
        loop {
            let result = self
                .write_cancel_token
                .run(|| sys::write(fd, &bytes[..len]));
            match result.unwrap_or_else(|| Err(sys::Error::from_code(E::ECANCELED, Tag::write)))? {
                0 => named_pipe::set_blocking(fd.native())
                    .map_err(|_| sys::Error::from_code(E::EAGAIN, Tag::write))?,
                written => return Ok(written),
            }
        }
    }
}
