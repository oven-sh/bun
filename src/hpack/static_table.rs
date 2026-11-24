//! RFC 7541 Appendix A.

use crate::{equal, wrapped};

pub(crate) const LEN: usize = 61;

/// From index 1 on.
const ENTRIES: [(&str, &str); LEN] = [
    (":authority", ""),
    (":method", "GET"),
    (":method", "POST"),
    (":path", "/"),
    (":path", "/index.html"),
    (":scheme", "http"),
    (":scheme", "https"),
    (":status", "200"),
    (":status", "204"),
    (":status", "206"),
    (":status", "304"),
    (":status", "400"),
    (":status", "404"),
    (":status", "500"),
    ("accept-charset", ""),
    ("accept-encoding", "gzip, deflate"),
    ("accept-language", ""),
    ("accept-ranges", ""),
    ("accept", ""),
    ("access-control-allow-origin", ""),
    ("age", ""),
    ("allow", ""),
    ("authorization", ""),
    ("cache-control", ""),
    ("content-disposition", ""),
    ("content-encoding", ""),
    ("content-language", ""),
    ("content-length", ""),
    ("content-location", ""),
    ("content-range", ""),
    ("content-type", ""),
    ("cookie", ""),
    ("date", ""),
    ("etag", ""),
    ("expect", ""),
    ("expires", ""),
    ("from", ""),
    ("host", ""),
    ("if-match", ""),
    ("if-modified-since", ""),
    ("if-none-match", ""),
    ("if-range", ""),
    ("if-unmodified-since", ""),
    ("last-modified", ""),
    ("link", ""),
    ("location", ""),
    ("max-forwards", ""),
    ("proxy-authenticate", ""),
    ("proxy-authorization", ""),
    ("range", ""),
    ("referer", ""),
    ("refresh", ""),
    ("retry-after", ""),
    ("server", ""),
    ("set-cookie", ""),
    ("strict-transport-security", ""),
    ("transfer-encoding", ""),
    ("user-agent", ""),
    ("vary", ""),
    ("via", ""),
    ("www-authenticate", ""),
];

/// By index. The others are empty.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static BY_INDEX: [(&[u8], &[u8]); 64] = {
    let mut table: [(&[u8], &[u8]); 64] = [(b"", b""); 64];
    let mut at = 0;
    while at < LEN {
        table[at + 1] = (ENTRIES[at].0.as_bytes(), ENTRIES[at].1.as_bytes());
        at += 1;
    }
    table
};

const SLOTS: usize = 128;

/// Differs for all names of the table.
#[inline(always)]
const fn slot(name: &[u8]) -> usize {
    let [first, .., last] = *name else { return 0 };
    let key = (first as u32) << 16 | (last as u32) << 8 | name.len() as u8 as u32;
    (key.wrapping_mul(0xdc58_fbb5) >> (32 - SLOTS.ilog2())) as usize
}

/// The first index of a name and how many entries have it, or zeros.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static BY_SLOT: [(u8, u8); SLOTS] = {
    let mut table = [(0, 0); SLOTS];
    let mut at = 0;
    while at < LEN {
        let (first, count) = &mut table[slot(ENTRIES[at].0.as_bytes())];
        if *count == 0 {
            *first = at as u8 + 1;
        }
        assert!((*first + *count) as usize == at + 1);
        *count += 1;
        at += 1;
    }
    table
};

/// For a [`Field::static_index`](crate::Field::static_index) other than 0.
#[inline(always)]
pub fn name(index: u8) -> &'static [u8] {
    wrapped(&BY_INDEX, index.into()).0
}

#[inline(always)]
pub(crate) fn value(index: u8) -> &'static [u8] {
    wrapped(&BY_INDEX, index.into()).1
}

/// The indexes of the entries with this name.
#[inline(always)]
pub(crate) fn find(wanted: &[u8]) -> core::ops::Range<u8> {
    let &(first, count) = wrapped(&BY_SLOT, slot(wanted));
    if equal(name(first), wanted) {
        first..first + count
    } else {
        0..0
    }
}
