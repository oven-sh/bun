//! RFC 9221.

use std::collections::VecDeque;

use super::Connection;
use super::sent::{Frames, SentFrame};
use crate::coding::{Write, varint_len};
use crate::error::{Error, Result};
use crate::event::Event;
use crate::frame::kind;

const MAX_UNDELIVERED_LEN: usize = 1024 * 1024;
/// What a datagram counts for on top of its length.
const OVERHEAD: usize = 64;

#[derive(Default)]
pub(super) struct Datagrams {
    pub(super) unsent: VecDeque<(u64, Vec<u8>)>,
    undelivered_len: usize,
}

fn frame_len(data: &[u8]) -> usize {
    1 + varint_len(data.len() as u64) + data.len()
}

impl Datagrams {
    pub(super) fn on_delivered(&mut self, data: &[u8]) {
        self.undelivered_len = (self.undelivered_len).saturating_sub(data.len() + OVERHEAD);
    }

    /// Returns how many it wrote. What is longer than `max_frame_len` is given up.
    pub(super) fn write_frames(
        &mut self,
        max_frame_len: usize,
        out: &mut Vec<u8>,
        end: usize,
        sent: &mut Frames,
        events: &mut VecDeque<Event>,
    ) -> u64 {
        let mut count = 0;
        while let Some((id, data)) = (self.unsent).pop_front_if(|(_, data)| {
            frame_len(data) > max_frame_len || out.len() + frame_len(data) <= end
        }) {
            if frame_len(&data) > max_frame_len {
                events.push_back(Event::DatagramAbandoned(id));
                continue;
            }
            out.push(kind::DATAGRAM_WITH_LENGTH as u8);
            out.prefixed_bytes(&data);
            sent.push(SentFrame::Datagram(id));
            count += 1;
        }
        count
    }
}

impl Connection {
    pub(super) fn on_datagram(&mut self, data: &[u8], frame_len: usize, is_early: bool) -> Result {
        if frame_len as u64 > self.local.max_datagram_frame_size {
            return Err(Error::violation("DATAGRAM frame is too large"));
        }
        if self.datagrams.undelivered_len < MAX_UNDELIVERED_LEN {
            self.datagrams.undelivered_len += data.len() + OVERHEAD;
            let data = data.to_vec();
            self.emit(Event::Datagram { data, is_early });
        }
        Ok(())
    }

    /// That can be sent (RFC 9297 §2.1.1).
    #[inline]
    pub(super) fn has_datagrams(&self) -> bool {
        !self.datagrams.unsent.is_empty()
            && (self.http3.as_ref()).is_none_or(|it| it.peer_accepts_datagrams.is_some())
    }

    /// `id` comes back in the event that tells what became of it.
    pub fn send_datagram(&mut self, id: u64, data: Vec<u8>) {
        self.streams.state.made_progress = true;
        self.datagrams.unsent.push_back((id, data));
    }

    pub fn unsent_datagrams(&self) -> usize {
        self.datagrams.unsent.len()
    }

    pub fn drop_oldest_datagram(&mut self) -> Option<u64> {
        self.datagrams.unsent.pop_front().map(|it| it.0)
    }
}
