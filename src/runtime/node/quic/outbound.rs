use std::collections::VecDeque;

use bun_jsc::JsCell;
use bun_lsquic_sys as lsquic;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum PendingEnd {
    #[default]
    None,
    Fin,
    Trailers,
}

/// The bytes a stream has not yet given to lsquic, and how its send side ends.
#[derive(Default)]
pub(super) struct Outbound {
    data: VecDeque<u8>,
    pub end: PendingEnd,
    pub started: bool,
}

impl Outbound {
    pub(super) fn len(&self) -> usize {
        self.data.len()
    }

    pub(super) fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub(super) fn push(&mut self, bytes: &[u8]) {
        self.data.extend(bytes);
    }

    pub(super) fn clear(&mut self) {
        self.data.clear();
    }

    /// Returns what `Stream::writev` returns. The queue is out of `cell` while lsquic runs.
    pub(super) fn write_queued(cell: &JsCell<Self>, stream: lsquic::Stream) -> isize {
        let (queue, taken) = cell.take().write_to(stream);
        cell.set(queue);
        taken
    }

    fn write_to(mut self, stream: lsquic::Stream) -> (Self, isize) {
        let (head, tail) = self.data.as_slices();
        let taken = stream.writev([head, tail]);
        if let Ok(taken) = usize::try_from(taken) {
            self.data.drain(..taken.min(self.data.len()));
        }
        (self, taken)
    }
}
