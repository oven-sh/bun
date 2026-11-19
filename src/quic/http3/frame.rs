//! RFC 9114 §7.

use crate::coding::PartialVarint;

pub(super) mod kind {
    pub(crate) const DATA: u64 = 0x00;
    pub(crate) const HEADERS: u64 = 0x01;
    pub(crate) const CANCEL_PUSH: u64 = 0x03;
    pub(crate) const SETTINGS: u64 = 0x04;
    pub(crate) const PUSH_PROMISE: u64 = 0x05;
    pub(crate) const GOAWAY: u64 = 0x07;
    /// RFC 9412 §2.
    pub(crate) const ORIGIN: u64 = 0x0c;
    pub(crate) const MAX_PUSH_ID: u64 = 0x0d;
    /// RFC 9218 §7.2.
    pub(crate) const PRIORITY_UPDATE_REQUEST: u64 = 0xf0700;
    pub(crate) const PRIORITY_UPDATE_PUSH: u64 = 0xf0701;

    /// RFC 9114 §7.2.8.
    pub(crate) fn is_from_http2(kind: u64) -> bool {
        matches!(kind, 0x02 | 0x06 | 0x08 | 0x09)
    }
}

/// Where a stream is in its sequence of frames.
#[derive(Default)]
pub(super) struct Cursor {
    integer: PartialVarint,
    kind: Option<u64>,
    /// Of the payload, once its length is known.
    left: Option<u64>,
}

impl Cursor {
    /// The type of the frame whose payload is being read, and how much is left.
    #[inline]
    pub(super) fn current(&self) -> Option<(u64, u64)> {
        self.kind.zip(self.left)
    }

    #[inline]
    pub(super) fn is_between_frames(&self) -> bool {
        self.kind.is_none() && !self.integer.is_started()
    }

    /// Returns the type and the length, or takes all of `input`.
    #[inline]
    pub(super) fn read_header(&mut self, input: &mut &[u8]) -> Option<(u64, u64)> {
        if self.kind.is_none() {
            self.kind = Some(self.integer.read(input)?);
        }
        self.left = Some(self.integer.read(input)?);
        self.current()
    }

    /// Returns what `input` has of the payload, and whether that is the end of it.
    #[inline]
    pub(super) fn read_payload<'a>(&mut self, input: &mut &'a [u8]) -> (&'a [u8], bool) {
        let left = self.left.unwrap_or(0);
        let len = left.min(input.len() as u64);
        let is_end = len == left;
        if is_end {
            (self.kind, self.left) = (None, None);
        } else {
            self.left = Some(left - len);
        }
        (input.split_off(..len as usize).unwrap_or_default(), is_end)
    }
}
