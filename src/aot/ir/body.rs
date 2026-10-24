use core::cell::Cell;

use super::body_decode::{read_block, read_target, read_terminator, read_value, walk_body};
pub use super::generated::Body;
use super::generated::{BlockFrequency, BlockRole, InternalErrorKind, Opcode, TerminatorKind};
use super::ids::{BlockId, TypeId, ValueId, optional_id_from_word};
use super::references::{IdMap, Reference, ReferenceKind};

pub(super) const WELL_FORMED: &str = "the stream is well formed";

pub trait Words {
    fn get(&self, at: usize) -> Option<u32>;
}

impl Words for [u32] {
    #[inline]
    fn get(&self, at: usize) -> Option<u32> {
        <[u32]>::get(self, at).copied()
    }
}

impl Words for [Cell<u32>] {
    #[inline]
    fn get(&self, at: usize) -> Option<u32> {
        <[Cell<u32>]>::get(self, at).map(Cell::get)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FieldWord {
    Operand,
    Reference(ReferenceKind),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct StreamError {
    pub kind: InternalErrorKind,
    pub block: Option<BlockId>,
    pub value: Option<ValueId>,
}

impl Body {
    pub fn blocks(&self) -> Blocks<'_> {
        Blocks {
            rest: &self.code,
            next_block: 0,
            block_count: self.block_count,
            next_value: 0,
        }
    }

    pub fn check_stream(&self) -> Result<(), StreamError> {
        let mut blocks = self.blocks();
        while blocks.read_next()?.is_some() {}
        if blocks.rest.is_empty() && blocks.next_value == self.value_count {
            return Ok(());
        }
        Err(StreamError {
            kind: InternalErrorKind::ListOutOfBounds,
            block: None,
            value: None,
        })
    }

    pub fn for_each_reference(&self, visit: &mut dyn FnMut(Reference)) {
        let words = &*self.code;
        walk_body(words, self.block_count, &mut |field, at| match field {
            FieldWord::Operand => {}
            FieldWord::Reference(kind) => {
                if let Some(reference) = Reference::from_word(kind, words[at]) {
                    visit(reference);
                }
            }
        });
    }

    pub fn remap_ids(&mut self, map: &IdMap<'_>) {
        let cells = Cell::from_mut(&mut *self.code).as_slice_of_cells();
        walk_body(cells, self.block_count, &mut |field, at| match field {
            FieldWord::Operand => {}
            FieldWord::Reference(kind) => cells[at].set(map.remap_word(kind, cells[at].get())),
        });
    }
}

pub struct Blocks<'a> {
    rest: &'a [u32],
    next_block: u32,
    block_count: u32,
    next_value: u32,
}

impl<'a> Blocks<'a> {
    fn read_next(&mut self) -> Result<Option<BlockView<'a>>, StreamError> {
        if self.next_block == self.block_count {
            return Ok(None);
        }
        let id = BlockId::from_word(self.next_block);
        let (block, rest) = read_block(self.rest, id, self.next_value)?;
        self.rest = rest;
        self.next_block += 1;
        self.next_value = block.first_value().to_word() + block.value_count;
        Ok(Some(block))
    }
}

impl<'a> Iterator for Blocks<'a> {
    type Item = BlockView<'a>;

    fn next(&mut self) -> Option<BlockView<'a>> {
        self.read_next().expect(WELL_FORMED)
    }
}

#[derive(Copy, Clone)]
pub struct BlockView<'a> {
    pub id: BlockId,
    pub first_parameter: ValueId,
    pub role: BlockRole,
    pub subject: Option<ValueId>,
    pub frequency: BlockFrequency,
    pub(super) parameter_types: &'a [u32],
    pub(super) handler: &'a [u32],
    pub(super) value_count: u32,
    pub(super) values: &'a [u32],
    pub(super) terminator: &'a [u32],
}

impl<'a> BlockView<'a> {
    pub fn parameter_count(&self) -> usize {
        self.parameter_types.len()
    }

    pub fn parameter_types(&self) -> impl ExactSizeIterator<Item = Option<TypeId>> + use<'a> {
        let types = self.parameter_types.iter();
        types.map(|&word| optional_id_from_word(word))
    }

    pub fn first_value(&self) -> ValueId {
        let parameter_count = self.parameter_types.len() as u32;
        ValueId::from_word(self.first_parameter.to_word() + parameter_count)
    }

    pub fn value_count(&self) -> usize {
        self.value_count as usize
    }

    pub fn handler(&self) -> Option<TargetView<'a>> {
        if self.handler.is_empty() {
            return None;
        }
        Some(read_target(self.handler).expect(WELL_FORMED).0)
    }

    pub fn values(&self) -> Values<'a> {
        Values {
            rest: self.values,
            next_value: self.first_value().to_word(),
        }
    }

    pub fn terminator(&self) -> TerminatorView<'a> {
        read_terminator(self.terminator).expect(WELL_FORMED).0
    }
}

pub struct Values<'a> {
    rest: &'a [u32],
    next_value: u32,
}

impl<'a> Iterator for Values<'a> {
    type Item = ValueView<'a>;

    fn next(&mut self) -> Option<ValueView<'a>> {
        if self.rest.is_empty() {
            return None;
        }
        let id = ValueId::from_word(self.next_value);
        let (value, rest) = read_value(self.rest, id).expect(WELL_FORMED);
        self.rest = rest;
        self.next_value += 1;
        Some(value)
    }
}

#[derive(Copy, Clone)]
pub struct ValueView<'a> {
    pub id: ValueId,
    pub opcode: Opcode,
    pub position: Option<u32>,
    pub fields: &'a [u32],
}

#[derive(Copy, Clone)]
pub struct TerminatorView<'a> {
    pub kind: TerminatorKind,
    pub position: Option<u32>,
    pub fields: &'a [u32],
    pub(super) target_count: u32,
    pub(super) targets: &'a [u32],
}

impl<'a> TerminatorView<'a> {
    pub fn target_count(&self) -> usize {
        self.target_count as usize
    }

    pub fn targets(&self) -> Targets<'a> {
        Targets { rest: self.targets }
    }
}

pub struct Targets<'a> {
    rest: &'a [u32],
}

impl<'a> Iterator for Targets<'a> {
    type Item = TargetView<'a>;

    fn next(&mut self) -> Option<TargetView<'a>> {
        if self.rest.is_empty() {
            return None;
        }
        let (target, rest) = read_target(self.rest).expect(WELL_FORMED);
        self.rest = rest;
        Some(target)
    }
}

#[derive(Copy, Clone)]
pub struct TargetView<'a> {
    pub block: BlockId,
    pub(super) arguments: &'a [u32],
    pub proofs: &'a [u32],
}

impl<'a> TargetView<'a> {
    pub fn arguments(&self) -> impl ExactSizeIterator<Item = ValueId> + use<'a> {
        self.arguments.iter().map(|&word| ValueId::from_word(word))
    }
}
