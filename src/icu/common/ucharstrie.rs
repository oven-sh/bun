//! The encoding of a trie of 16-bit code units, and an iterator over its strings. ICU4C: ucharstrie.cpp, ucharstrieiterator.cpp

use crate::common::bytes::U16s;
use crate::common::memory::{Appendable, is_oom};
use crate::common::slice_ext::to_index;
use crate::common::soft_assert::soft_unreachable;
use crate::common::ustringtrie::{
    MAX_BRANCH_LINEAR_SUB_NODE_LENGTH, StringTrie, TrieUnits, UStringTrieResult,
};
use crate::common::utf16;

pub(crate) type UCharsTrie<'a> = StringTrie<U16s<'a>>;

const MIN_LINEAR_MATCH: i32 = 0x30;
const VALUE_IS_FINAL: i32 = 0x8000;

const MIN_TWO_UNIT_VALUE_LEAD: i32 = 0x4000;
const THREE_UNIT_VALUE_LEAD: i32 = 0x7fff;

/// Number of low bits that hold the type of a match node, which shares its lead unit with an intermediate value.
const NODE_TYPE_BITS: u32 = 6;
const MIN_TWO_UNIT_NODE_VALUE_LEAD: i32 = 0x4040;
const THREE_UNIT_NODE_VALUE_LEAD: i32 = 0x7fc0;

const MIN_TWO_UNIT_DELTA_LEAD: i32 = 0xfc00;
const THREE_UNIT_DELTA_LEAD: i32 = 0xffff;

/// `two` and `three` are the minimum lead units of integers of two and three units.
#[inline]
fn read_compact_int(units: U16s, lead: i32, pos: usize, two: i32, three: i32) -> (i32, usize) {
    if lead < two {
        (lead, pos)
    } else if lead < three {
        ((lead - two) << 16 | units.unit(pos), pos + 1)
    } else {
        (units.unit(pos) << 16 | units.unit(pos + 1), pos + 2)
    }
}

impl TrieUnits for U16s<'_> {
    const MIN_LINEAR_MATCH: i32 = MIN_LINEAR_MATCH;
    const VALUE_IS_FINAL: i32 = VALUE_IS_FINAL;

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
        read_compact_int(
            self,
            lead & !VALUE_IS_FINAL,
            pos,
            MIN_TWO_UNIT_VALUE_LEAD,
            THREE_UNIT_VALUE_LEAD,
        )
    }

    #[inline]
    fn read_node_value(self, lead: i32, pos: usize) -> (i32, usize) {
        let value_bits = |lead| (lead >> NODE_TYPE_BITS) - 1;
        let (two, three) = (
            value_bits(MIN_TWO_UNIT_NODE_VALUE_LEAD),
            value_bits(THREE_UNIT_NODE_VALUE_LEAD),
        );
        read_compact_int(self, value_bits(lead), pos, two, three)
    }

    #[inline]
    fn read_delta(self, lead_pos: usize) -> (i32, usize) {
        read_compact_int(
            self,
            self.unit(lead_pos),
            lead_pos + 1,
            MIN_TWO_UNIT_DELTA_LEAD,
            THREE_UNIT_DELTA_LEAD,
        )
    }

    #[inline]
    fn skip_node_value(self, lead: i32, pos: usize) -> (i32, usize) {
        (
            lead & ((1 << NODE_TYPE_BITS) - 1),
            self.read_node_value(lead, pos).1,
        )
    }
}

impl UCharsTrie<'_> {
    pub(crate) fn next_for_code_point(&mut self, c: u32) -> UStringTrieResult {
        if c <= 0xffff {
            return self.next(c as i32);
        }
        // If the lead surrogate ends the match, the trail surrogate does not match.
        self.next(utf16::lead(c).into());
        self.next(utf16::trail(c).into())
    }
}

/// The unvisited edges of a branch.
struct PendingEdges {
    pos: usize,
    count: usize,
    string_length: usize,
}

pub(crate) struct Iterator<'a> {
    units: U16s<'a>,
    /// The node at which `next` continues. If `None`, `next` pops `stack`.
    pos: Option<usize>,
    /// True if the intermediate value at `pos` has been returned.
    skip_value: bool,
    stack: Vec<PendingEdges>,
    string: Vec<u16>,
    value: i32,
}

impl<'a> Iterator<'a> {
    pub(crate) fn new(units: U16s<'a>) -> Self {
        Self {
            units,
            pos: Some(0),
            skip_value: false,
            stack: Vec::new(),
            string: Vec::new(),
            value: 0,
        }
    }

    /// Advances to the next string. Returns false at the end and after an allocation failure.
    pub(crate) fn next(&mut self) -> bool {
        self.find_next() && !is_oom()
    }

    pub(crate) fn get_string(&self) -> &[u16] {
        &self.string
    }

    pub(crate) fn get_value(&self) -> i32 {
        self.value
    }

    fn find_next(&mut self) -> bool {
        let units = self.units;
        let mut pos = match self.pos.take() {
            Some(pos) => pos,
            None => {
                let Some(PendingEdges {
                    pos,
                    count,
                    string_length,
                }) = self.stack.pop()
                else {
                    return false;
                };
                self.string.truncate(string_length);
                if count > 1 {
                    self.branch_next(count, pos)
                } else {
                    self.string.add(units.at(pos));
                    pos + 1
                }
            }
        };
        loop {
            let Some(mut node) = units.get(pos).map(i32::from) else {
                soft_unreachable();
                self.value = -1;
                return true;
            };
            if node >= U16s::MIN_VALUE_LEAD && !self.skip_value {
                self.value = units.value_at(pos);
                self.skip_value = node & VALUE_IS_FINAL == 0;
                self.pos = self.skip_value.then_some(pos);
                return true;
            }
            pos += 1;
            if std::mem::take(&mut self.skip_value) {
                (node, pos) = units.skip_node_value(node, pos);
            }
            if node < MIN_LINEAR_MATCH {
                let (count, edges) = units.read_branch_length(node, pos);
                pos = self.branch_next(count, edges);
            } else {
                let limit = pos + (node - MIN_LINEAR_MATCH + 1) as usize;
                self.string.add_each(units.slice(pos..limit).iter());
                pos = limit;
            }
        }
    }

    /// Pushes all edges except the first. Returns the position of the first edge's node or final value.
    fn branch_next(&mut self, mut count: usize, mut pos: usize) -> usize {
        let (units, string_length) = (self.units, self.string.len());
        // A negative delta jumps to the end.
        let jump =
            |(delta, pos): (i32, usize)| pos.saturating_add(to_index(delta)).min(units.len());
        while count > MAX_BRANCH_LINEAR_SUB_NODE_LENGTH {
            let delta = units.read_delta(pos + 1);
            self.stack.add(PendingEdges {
                pos: delta.1,
                count: count - count / 2,
                string_length,
            });
            count /= 2;
            pos = jump(delta);
        }
        let lead = units.unit(pos + 1);
        let value = units.read_value(lead, pos + 2);
        self.stack.add(PendingEdges {
            pos: value.1,
            count: count - 1,
            string_length,
        });
        self.string.add(units.at(pos));
        if lead & VALUE_IS_FINAL != 0 {
            pos + 1
        } else {
            jump(value)
        }
    }
}
