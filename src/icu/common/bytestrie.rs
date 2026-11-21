//! The encoding of a trie of bytes. ICU4C: bytestrie.cpp, unicode/bytestrie.h

use crate::common::slice_ext::SliceExt;
use crate::common::ustringtrie::{StringTrie, TrieUnits};

pub(crate) type BytesTrie<'a> = StringTrie<&'a [u8]>;

/// The minimum lead bytes of integers of one, two, three and four bytes. A greater lead byte starts five bytes.
type MinLeads = [i32; 4];

/// Compared with lead bytes that are shifted right by 1.
const VALUE_LEADS: MinLeads = [0x10, 0x51, 0x6c, 0x7e];
const DELTA_LEADS: MinLeads = [0, 0xc0, 0xf0, 0xfe];

#[inline]
fn read_compact_int(
    bytes: &[u8],
    lead: i32,
    pos: usize,
    [one, two, three, four]: MinLeads,
) -> (i32, usize) {
    let byte = |i| bytes.unit(pos + i);
    if lead < two {
        (lead - one, pos)
    } else if lead < three {
        ((lead - two) << 8 | byte(0), pos + 1)
    } else if lead < four {
        ((lead - three) << 16 | byte(0) << 8 | byte(1), pos + 2)
    } else if lead == four {
        (byte(0) << 16 | byte(1) << 8 | byte(2), pos + 3)
    } else {
        (
            byte(0) << 24 | byte(1) << 16 | byte(2) << 8 | byte(3),
            pos + 4,
        )
    }
}

impl TrieUnits for &[u8] {
    const MIN_LINEAR_MATCH: i32 = 0x10;
    const VALUE_IS_FINAL: i32 = 1;

    #[inline]
    fn unit_count(self) -> usize {
        self.len()
    }

    #[inline]
    fn unit(self, pos: usize) -> i32 {
        self.at(pos).into()
    }

    #[inline]
    fn read_value(self, lead: i32, pos: usize) -> (i32, usize) {
        read_compact_int(self, lead >> 1, pos, VALUE_LEADS)
    }

    #[inline]
    fn read_node_value(self, lead: i32, pos: usize) -> (i32, usize) {
        self.read_value(lead, pos)
    }

    #[inline]
    fn read_delta(self, lead_pos: usize) -> (i32, usize) {
        read_compact_int(self, self.unit(lead_pos), lead_pos + 1, DELTA_LEADS)
    }

    #[inline]
    fn skip_node_value(self, lead: i32, pos: usize) -> (i32, usize) {
        let pos = self.read_value(lead, pos).1;
        (self.unit(pos), pos + 1)
    }
}
