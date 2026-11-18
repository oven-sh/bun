//! The text of a node as AT-SPI has it: one character stands for each child that is not text.

use super::forest::{Forest, Id};
use super::text::Block;
#[cfg(unix)]
use super::text::Position;

const EMBEDDED: char = '\u{fffc}';

impl Forest {
    pub fn hypertext(&self, id: Id) -> Block {
        if self.is_leaf(id) || self.children(id).next().is_none() {
            return self.field_text(id);
        }
        let mut block = Block::default();
        for (child, node) in self.children(id).filter_map(|it| Some((it, self.get(it)?))) {
            let start = block.text.len();
            match node.is_text() {
                true => block.text.push_str(node.name()),
                false => block.text.push(EMBEDDED),
            }
            block.leaves.push((child, start..block.text.len()));
        }
        block
    }

    /// The node in whose text a position is reported.
    pub fn holder_of_text(&self, leaf: Id) -> Id {
        let is_text = self.get(leaf).is_some_and(|it| it.is_text());
        self.exposed(self.parent(leaf).filter(|_| is_text).unwrap_or(leaf))
    }

    /// In bytes. What is in an embedded node is before its character, or after it if `is_end`.
    #[cfg(unix)]
    pub fn offset_in_hypertext(
        &self,
        block: &Block,
        position: Position,
        is_end: bool,
    ) -> Option<usize> {
        let (child, range) = block
            .leaves
            .iter()
            .find(|it| self.contains(it.0, position.node))?;
        Some(match *child == position.node {
            true => (range.start + position.offset).min(range.end),
            false if is_end && position != self.start_of(*child) => range.end,
            false => range.start,
        })
    }

    #[cfg(unix)]
    pub fn position_in_hypertext(
        &self,
        block: &Block,
        offset: usize,
        is_end: bool,
    ) -> Option<Position> {
        let found = block.position(offset, is_end)?;
        Some(match self.get(found.node)?.is_text() {
            true => found,
            false if found.offset == 0 => self.start_of(found.node),
            false => self.end_of(found.node),
        })
    }
}
