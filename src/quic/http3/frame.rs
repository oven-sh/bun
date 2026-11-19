//! RFC 9114 §7.

use crate::coding::{PartialVarint, Write, varint_len};

pub(super) const MAX_HEADER_LEN: usize = 1 + 8;

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

/// For a type of one byte.
#[inline]
pub(super) fn header(kind: u64, len: u64) -> ([u8; MAX_HEADER_LEN], usize) {
    let len_len = varint_len(len);
    let tagged = len | u64::from(len_len.trailing_zeros()) << (8 * len_len - 2);
    let [a, b, c, d, e, f, g, h] = (tagged << (64 - 8 * len_len)).to_be_bytes();
    ([kind as u8, a, b, c, d, e, f, g, h], 1 + len_len)
}

#[inline]
pub(crate) fn data_frame_header(len: u64) -> ([u8; MAX_HEADER_LEN], usize) {
    header(kind::DATA, len)
}

pub(super) fn write(kind: u64, payload: &[u8], out: &mut Vec<u8>) {
    out.varint(kind);
    out.prefixed_bytes(payload);
}

pub(super) struct Header {
    pub(super) kind: u64,
    pub(super) len: u64,
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
    /// The type of the frame whose payload is being read.
    #[inline]
    pub(super) fn current(&self) -> Option<u64> {
        self.left.and(self.kind)
    }

    #[inline]
    pub(super) fn is_between_frames(&self) -> bool {
        self.kind.is_none() && !self.integer.is_started()
    }

    /// Takes all of `input` if it ends before the header does.
    #[inline]
    pub(super) fn read_header(&mut self, input: &mut &[u8]) -> Option<Header> {
        let kind = match self.kind {
            Some(kind) => kind,
            None => *self.kind.insert(self.integer.read(input)?),
        };
        let len = *self.left.insert(self.integer.read(input)?);
        Some(Header { kind, len })
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
