//! Pipes and consoles have no readiness polling on Windows, so jobs use blocking calls on the device pool.

use bun_core::vec::BorrowedCursor;
use bun_iocp::blocking::CancelToken;
use bun_jsc::JsThread;
use bun_jsc::job::{CancelTokens, OwnedJob, Running};
use bun_sys::windows::named_pipe;
use bun_sys::{self as sys, E, Fd, Tag};
use bun_threading::work_pool::DEVICE_POOL;

use super::job_file::JobFile;

/// NPFS copies a pending write into nonpaged pool.
const MAX_WRITE_LEN: usize = 64 * 1024 * 1024;

/// Runs `work`, on the device pool if it can block, and then finishes the job.
pub(super) fn run_and_finish<C: OwnedJob>(
    mut job: Running<C>,
    can_block: bool,
    work: impl FnOnce(&mut C::OffThread) + Send + 'static,
) {
    let task = move || {
        work(job.off());
        job.finish();
    };
    if can_block && !DEVICE_POOL.has_current_thread() {
        DEVICE_POOL.go(task);
    } else {
        task();
    }
}

/// Cancellable blocking calls, for the device pool only.
#[derive(Default)]
pub(super) struct BlockingIo {
    read_cancel_token: CancelToken,
    write_cancel_token: CancelToken,
}

impl BlockingIo {
    /// A Worker waits for its writes, as for those of `node:fs`.
    pub(super) fn cancel_tokens(&self, cx: &JsThread<'_>) -> CancelTokens {
        CancelTokens {
            on_stop: Some(self.read_cancel_token.clone()),
            on_teardown: (cx.vm().is_main_thread.get()).then(|| self.write_cancel_token.clone()),
        }
    }

    /// An overlapped device rejects a read without an offset.
    pub(super) fn read(
        &self,
        file: &JobFile,
        buf: BorrowedCursor<'_, u8>,
        offset: Option<u64>,
    ) -> sys::Result<usize> {
        let read = || match offset {
            Some(offset) => sys::pread_buf(file.fd(), buf, offset as i64),
            None => sys::read_buf(file.fd(), buf),
        };
        let result = self.read_cancel_token.run(|| match file {
            JobFile::Opened(_) => read(),
            JobFile::Borrowed(file) => file.run_blocking(read),
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
