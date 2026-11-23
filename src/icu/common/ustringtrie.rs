//! Lookup in a serialized map from strings to integers. ICU4C: unicode/ustringtrie.h, bytestrie.cpp, ucharstrie.cpp

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum UStringTrieResult {
    NoMatch = 0,
    NoValue = 1,
    FinalValue = 2,
    IntermediateValue = 3,
}

impl UStringTrieResult {
    #[inline]
    pub(crate) fn has_value(self) -> bool {
        self >= Self::FinalValue
    }

    #[inline]
    pub(crate) fn has_next(self) -> bool {
        self as u8 & 1 != 0
    }
}

pub(crate) const MAX_BRANCH_LINEAR_SUB_NODE_LENGTH: usize = 5;
const MAX_LINEAR_MATCH_LENGTH: i32 = 0x10;

/// The encoding of a trie. `pos` is the position after `lead`. The second result is the position after what was read.
pub(crate) trait TrieUnits: Copy {
    const MIN_LINEAR_MATCH: i32;
    const MIN_VALUE_LEAD: i32 = Self::MIN_LINEAR_MATCH + MAX_LINEAR_MATCH_LENGTH;
    const VALUE_IS_FINAL: i32;

    fn unit_count(self) -> usize;
    /// Returns 0 if `pos` is out of bounds, as it can be in an item of another format that is named as a dictionary.
    fn unit(self, pos: usize) -> i32;
    /// Reads a final value, or a jump delta in a linear list.
    fn read_value(self, lead: i32, pos: usize) -> (i32, usize);
    /// Reads an intermediate value.
    fn read_node_value(self, lead: i32, pos: usize) -> (i32, usize);
    /// Reads the jump delta to the less-than half of a split branch.
    fn read_delta(self, lead_pos: usize) -> (i32, usize);
    /// Skips an intermediate value and returns the type of the match node to which the value belongs.
    fn skip_node_value(self, lead: i32, pos: usize) -> (i32, usize);

    fn value_at(self, pos: usize) -> i32 {
        match self.unit(pos) {
            lead if lead & Self::VALUE_IS_FINAL != 0 => self.read_value(lead, pos + 1).0,
            lead => self.read_node_value(lead, pos + 1).0,
        }
    }

    #[inline]
    fn read_branch_length(self, node: i32, pos: usize) -> (usize, usize) {
        if node == 0 {
            (self.unit(pos) as usize + 1, pos + 1)
        } else {
            (node as usize + 1, pos)
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct StringTrie<U> {
    units: U,
    pos: usize,
    /// Remaining length of a linear-match node, 0 if `pos` is the start of a node. `None` after a mismatch.
    remaining: Option<u8>,
}

impl<U: TrieUnits> StringTrie<U> {
    /// `units` may extend past the trie.
    pub(crate) fn new(units: U) -> Self {
        Self::with_root(units, 0)
    }

    pub(crate) fn with_root(units: U, root: usize) -> Self {
        Self {
            units,
            pos: root,
            remaining: Some(0),
        }
    }

    /// Returns the value of the string so far. Requires that the last result has a value.
    #[inline]
    pub(crate) fn get_value(&self) -> i32 {
        self.units.value_at(self.pos)
    }

    pub(crate) fn next(&mut self, unit: i32) -> UStringTrieResult {
        match self.remaining {
            None => UStringTrieResult::NoMatch,
            Some(0) => self.next_impl(unit),
            Some(remaining) => self.linear_match_next(self.pos, remaining, unit),
        }
    }

    fn stop(&mut self) -> UStringTrieResult {
        self.remaining = None;
        UStringTrieResult::NoMatch
    }

    fn result_at_node(&self) -> UStringTrieResult {
        match self.units.unit(self.pos) {
            node if node < U::MIN_VALUE_LEAD => UStringTrieResult::NoValue,
            node if node & U::VALUE_IS_FINAL != 0 => UStringTrieResult::FinalValue,
            _ => UStringTrieResult::IntermediateValue,
        }
    }

    /// Returns `pos + delta`, or the end if that is out of bounds. Jumps backward if `delta` is negative.
    fn jump(&self, (delta, pos): (i32, usize)) -> usize {
        pos.wrapping_add_signed(delta as isize)
            .min(self.units.unit_count())
    }

    fn next_impl(&mut self, unit: i32) -> UStringTrieResult {
        let (mut node, mut pos) = (self.units.unit(self.pos), self.pos + 1);
        while node >= U::MIN_VALUE_LEAD {
            if node & U::VALUE_IS_FINAL != 0 {
                return self.stop();
            }
            (node, pos) = self.units.skip_node_value(node, pos);
        }
        if node < U::MIN_LINEAR_MATCH {
            self.branch_next(node, pos, unit)
        } else {
            self.linear_match_next(pos, (node - U::MIN_LINEAR_MATCH + 1) as u8, unit)
        }
    }

    /// Requires `remaining > 0`.
    fn linear_match_next(&mut self, pos: usize, remaining: u8, unit: i32) -> UStringTrieResult {
        if unit != self.units.unit(pos) {
            return self.stop();
        }
        (self.pos, self.remaining) = (pos + 1, Some(remaining - 1));
        if remaining == 1 {
            self.result_at_node()
        } else {
            UStringTrieResult::NoValue
        }
    }

    fn branch_next(&mut self, node: i32, pos: usize, unit: i32) -> UStringTrieResult {
        let units = self.units;
        let (mut length, mut pos) = units.read_branch_length(node, pos);
        while length > MAX_BRANCH_LINEAR_SUB_NODE_LENGTH {
            if unit < units.unit(pos) {
                length /= 2;
                pos = self.jump(units.read_delta(pos + 1));
            } else {
                length -= length / 2;
                pos = units.read_delta(pos + 1).1;
            }
        }
        // `length - 1` pairs of a unit and a value or delta, then one more unit. A length of 1 counts as 2.
        for _ in 1..length.max(2) {
            if unit == units.unit(pos) {
                let lead = units.unit(pos + 1);
                if lead & U::VALUE_IS_FINAL != 0 {
                    self.pos = pos + 1;
                    return UStringTrieResult::FinalValue;
                }
                self.pos = self.jump(units.read_value(lead, pos + 2));
                return self.result_at_node();
            }
            pos = units.read_value(units.unit(pos + 1), pos + 2).1;
        }
        self.linear_match_next(pos, 1, unit)
    }
}
