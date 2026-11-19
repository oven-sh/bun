//! What the tests of HTTP/3 have in common.

use bun_quic::{Direction, Http3Config, Layer, Side, StreamId};

use super::http3;
use super::raw::Raw;
use super::wire::{fields, groups, show_hex};

pub(crate) const GET: &str = ":method=GET :scheme=https :authority=a :path=/";
pub(crate) const OK: &str = ":status=200";

/// A HEADERS frame, once with the help of the static table and once with short names and values spelled out.
pub(crate) fn encodings(text: &str) -> [String; 2] {
    let mut section = vec![0, 0];
    for (name, value, _) in fields(&groups(text).concat()) {
        section.push(0x20 | name.len().min(7) as u8);
        section.extend(name.len().checked_sub(7).map(|it| it as u8));
        section.extend([name, vec![value.len() as u8], value].concat());
    }
    [text.into(), show_hex(&section)].map(|it| format!("headers {it}"))
}

impl Raw {
    /// Before the handshake.
    pub(crate) fn http3(side: Side) -> Self {
        let [client, server] = Self::both();
        (if side.is_client() { client } else { server }).config(http3)
    }

    pub(crate) fn http3_config(self, change: impl FnOnce(&mut Http3Config)) -> Self {
        self.config(|it| change(it.http3.as_mut().unwrap()))
    }

    /// Up to where it is our turn to write to stream 0, about which the application knows.
    pub(crate) fn exchange(mut self) -> Self {
        self = self.connected_with("");
        match self.side {
            Side::Client => self.write(0, &[], false),
            Side::Server => drop(self.request(GET)),
        }
        self.send("ack");
        self.forget();
        self
    }

    /// The fields that a message of ours can start with.
    pub(crate) fn head(&self) -> &'static str {
        [GET, OK][self.side as usize]
    }

    /// The peer sends one that has no content.
    pub(crate) fn request(&mut self, fields: &str) -> u64 {
        let id = self.peer.open(Direction::Bidirectional);
        assert!(self.peer.send_headers(id, fields));
        self.connection().finish(StreamId(id));
        self.process();
        id
    }

    pub(crate) fn write_control(&mut self, frames: &str) {
        self.write_http3(self.unidirectional(0), frames, false);
    }

    pub(crate) fn write_encoder(&mut self, instructions: &str) {
        self.write_http3(self.unidirectional(1), instructions, false);
    }

    pub(crate) fn read_control(&mut self) -> String {
        self.read_http3(2 | !self.side as u64)
    }

    /// Instructions of one byte.
    pub(crate) fn read_decoder(&mut self) -> String {
        self.advance(5);
        let id = 1 << 2 | 2 | !self.side as u64;
        let read = self.read.insert(id, self.streams[&id].len()).unwrap_or(1);
        let instructions = self.streams[&id][read..].iter().map(|it| match it {
            0x80.. => format!("ack {}", it & 0x7f),
            0x40.. => format!("cancel {}", it & 0x3f),
            _ => format!("increment {it}"),
        });
        instructions.collect::<Vec<_>>().join(", ")
    }

    #[track_caller]
    pub(crate) fn http3_error(&mut self) -> Option<u64> {
        let error = self.error();
        assert!(error.is_none_or(|it| it.0 == Layer::Application));
        error.map(|it| it.1)
    }
}
