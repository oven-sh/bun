//! A write to a blocking pipe or FIFO that cannot wait (Linux).
//!
//! `write(2)` on a pipe without `O_NONBLOCK` returns only once every byte is
//! in the pipe, so a write larger than the free space sleeps until the reader
//! drains it. `pwritev2(RWF_NOWAIT)` covers anonymous pipes from Linux 6.4 and
//! named FIFOs never. `splice(2)` between two pipes does take a per-call
//! no-wait flag: the bytes go into a relay pipe that only this thread holds,
//! and `splice(SPLICE_F_NONBLOCK)` moves as many of them as the target has
//! room for. What the target did not take stays in the relay until it is
//! writable again.

use core::cell::Cell;

use bun_sys::{self as sys, Fd, FdExt as _};

use crate::pipe_writer::WriteResult;

thread_local! {
    /// The empty relay the last writer on this thread finished with. Per
    /// thread and not per VM: an empty pipe carries no state, and only the
    /// thread that writes through a relay touches it.
    static SPARE: Cell<Option<Relay>> = const { Cell::new(None) };
}

/// A pipe with both ends `O_NONBLOCK`.
struct Relay {
    read: Fd,
    write: Fd,
}

impl Relay {
    fn lease() -> Option<Relay> {
        if let Some(relay) = SPARE.take() {
            return Some(relay);
        }
        let [read, write] = sys::pipe_nonblocking().ok()?;
        Some(Relay { read, write })
    }

    /// The next writer to lease the relay splices whatever it holds into its
    /// own fd, so only an empty relay goes back.
    fn release(self) {
        debug_assert!(self.is_empty());
        SPARE.set(Some(self));
    }

    fn is_empty(&self) -> bool {
        let mut len: libc::c_int = 0;
        // SAFETY: FIONREAD on a pipe writes one `int`.
        unsafe { libc::ioctl(self.read.native(), libc::FIONREAD, &raw mut len) };
        len == 0
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        self.read.close();
        self.write.close();
    }
}

pub(crate) enum Spliced {
    Result(WriteResult),
    /// There is no relay, or `splice(2)` is refused. This many bytes went out
    /// before that and nothing is left in a relay.
    Unavailable(usize),
}

/// The bytes one writer has in a relay. The writer has not reported them as
/// written, so they are still the head of its buffer.
#[derive(Default)]
pub(crate) struct StagedWrite {
    /// At most the capacity of a pipe.
    len: Cell<u32>,
    relay: Cell<Option<Relay>>,
}

impl StagedWrite {
    pub(crate) fn is_empty(&self) -> bool {
        self.len.get() == 0
    }

    /// Closes the relay with what it holds. Call this when the head of the
    /// writer's buffer is no longer the bytes that were staged.
    pub(crate) fn discard(&self) {
        if self.len.get() != 0 {
            self.len.set(0);
            drop(self.relay.take());
        }
    }

    /// Moves `buf` into the pipe `fd` and never waits for it. `buf` starts
    /// with the bytes an earlier call left staged.
    pub(crate) fn write(&self, fd: Fd, buf: &[u8]) -> Spliced {
        let mut staged = self.len.replace(0) as usize;
        debug_assert!(staged <= buf.len());
        let Some(relay) = self.relay.take().or_else(Relay::lease) else {
            return Spliced::Unavailable(0);
        };
        let mut offset: usize = 0;
        loop {
            if staged == 0 {
                if offset == buf.len() {
                    relay.release();
                    return Spliced::Result(WriteResult::Wrote(offset));
                }
                // The relay is empty, so it takes at least one page.
                staged = match sys::write(relay.write, &buf[offset..]) {
                    Ok(n) if n > 0 => n,
                    _ => return Spliced::Unavailable(offset),
                };
            }
            // `staged` covers everything in the relay, so only whole pipe
            // buffers move and the relay never keeps part of one.
            match sys::splice_nowait(relay.read, fd, staged) {
                Ok(Some(moved)) if moved > 0 => {
                    staged -= moved;
                    offset += moved;
                    if staged == 0 {
                        continue;
                    }
                }
                Ok(_) => return Spliced::Unavailable(offset),
                Err(err) if err.is_retry() => {}
                Err(err) => return Spliced::Result(WriteResult::Err(err)),
            }
            self.len.set(staged as u32);
            self.relay.set(Some(relay));
            return Spliced::Result(WriteResult::Pending(offset));
        }
    }
}
