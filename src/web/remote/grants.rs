//! The files that a page process has been given.

use bun_threading::Guarded;

use super::{HOST, Peer};
use crate::Bytes;

static GRANTED: Guarded<Vec<(Peer, Bytes)>> = Guarded::new(Vec::new());

pub fn grant(to: Peer, path: &[u8]) {
    if !is_granted(to, path) {
        GRANTED.lock().push((to, path.into()));
    }
}

pub fn is_granted(to: Peer, path: &[u8]) -> bool {
    to == HOST || (GRANTED.lock().iter()).any(|it| it.0 == to && *it.1 == *path)
}

pub(super) fn forget(peer: Peer) {
    GRANTED.lock().retain(|it| it.0 != peer);
}
