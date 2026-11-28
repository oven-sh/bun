use std::ops::Range;

use super::raw::{RTT, Raw};

/// The address of the client.
pub(crate) const OLD: &str = "192.0.2.1:1000";
pub(crate) const NEW: &str = "192.0.2.2:2000";
/// 198.51.100.2:444 and [2001:db8::2]:444, with what `new_id` has for 1.
pub(crate) const PREFERRED: &str = "preferred_address=#c633640201bc20010db80000000000000000000000020\
    1bc087261772d69642d31746f6b656e3030303030303030303031";

pub(crate) fn new_id(sequence: u64, retire_prior_to: u64) -> String {
    let (id, token) = (format!("raw-id-{sequence}"), format!("token{sequence:011}"));
    format!("new_connection_id {sequence} {retire_prior_to} {id} {token}")
}

pub(crate) fn new_ids(sequences: Range<u64>) -> String {
    let frames = sequences.map(|it| new_id(it, 0));
    frames.collect::<Vec<_>>().join(", ")
}

impl Raw {
    pub(crate) fn move_to(&mut self, address: &str) {
        self.addresses.peer = address.parse().unwrap();
    }

    /// In a datagram of more than 1200 bytes.
    pub(crate) fn send_expanded(&mut self, frames: &str) {
        self.send(&format!("{frames}, padding 1200"));
    }

    /// Each side has given the other an ID that is not in use.
    pub(crate) fn connected_with_spare_id(self) -> Self {
        let mut raw = self.connected();
        raw.send(&new_id(1, 0));
        raw.advance(RTT);
        raw.forget();
        raw
    }

    pub(crate) fn use_id(&mut self, sequence: u64) {
        self.destination = self.ids[&sequence].0.clone();
    }
}
