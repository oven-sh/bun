use core::cell::Cell;

#[cfg(any(test, feature = "ir_text"))]
use super::body_decode::{read_block, read_target, read_terminator, read_value};
use super::body_walk::walk_body;
pub use super::generated::Body;
#[cfg(any(test, feature = "ir_text"))]
use super::generated::{BlockFrequency, BlockRole, InternalErrorKind, Opcode, TerminatorKind};
#[cfg(any(test, feature = "ir_text"))]
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

#[cfg(any(test, feature = "ir_text"))]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct StreamError {
    pub kind: InternalErrorKind,
    pub block: Option<BlockId>,
    pub value: Option<ValueId>,
}

impl Body {
    #[cfg(any(test, feature = "ir_text"))]
    pub fn blocks(&self) -> impl Iterator<Item = BlockView<'_>> {
        let (mut rest, mut next_value) = (&*self.code, 0);
        (0..self.block_count).map(move |id| {
            let read = read_block(rest, BlockId::from_word(id), next_value);
            let (block, after) = read.expect(WELL_FORMED);
            (rest, next_value) = (after, block.first_value().to_word() + block.value_count);
            block
        })
    }

    #[cfg(any(test, feature = "ir_text"))]
    pub fn check_stream(&self) -> Result<(), StreamError> {
        let (mut rest, mut next_value) = (&*self.code, 0);
        for id in 0..self.block_count {
            let (block, after) = read_block(rest, BlockId::from_word(id), next_value)?;
            (rest, next_value) = (after, block.first_value().to_word() + block.value_count);
        }
        if rest.is_empty() && next_value == self.value_count {
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

    /// Nothing reads the code between the end of lowering and the hand-over to the engine, while the code of the whole
    /// program piles up beside the trees and the types. Most words are small numbers: until `unpack_code` each takes
    /// seven bits a byte. The first word is the number of words.
    pub fn pack_code(&mut self, scratch: &mut Vec<u8>) {
        if self.code.is_empty() {
            return;
        }
        scratch.clear();
        for &word in &self.code {
            let mut rest = word;
            while rest >= 0x80 {
                scratch.push(rest as u8 | 0x80);
                rest >>= 7;
            }
            scratch.push(rest as u8);
        }
        let mut packed = Vec::with_capacity(1 + scratch.len().div_ceil(4));
        packed.push(u32::try_from(self.code.len()).expect("a body fits 32 bits"));
        let (words, last) = scratch.as_chunks::<4>();
        packed.extend(words.iter().map(|&bytes| u32::from_le_bytes(bytes)));
        if !last.is_empty() {
            let mut bytes = [0; 4];
            bytes[..last.len()].copy_from_slice(last);
            packed.push(u32::from_le_bytes(bytes));
        }
        self.code = packed;
    }

    pub fn unpack_code(&mut self) {
        let Some((&count, packed)) = self.code.split_first() else {
            return;
        };
        let mut code = Vec::with_capacity(count as usize);
        let mut bytes = packed.iter().flat_map(|word| word.to_le_bytes());
        for _ in 0..count {
            let (mut word, mut shift) = (0, 0);
            loop {
                let byte = bytes.next().expect(WELL_FORMED);
                word |= u32::from(byte & 0x7f) << shift;
                if byte < 0x80 {
                    break;
                }
                shift += 7;
            }
            code.push(word);
        }
        self.code = code;
    }

    pub fn remap_ids(&mut self, map: &IdMap<'_>) {
        let cells = Cell::from_mut(&mut *self.code).as_slice_of_cells();
        walk_body(cells, self.block_count, &mut |field, at| match field {
            FieldWord::Operand => {}
            FieldWord::Reference(kind) => cells[at].set(map.remap_word(kind, cells[at].get())),
        });
    }
}

#[cfg(any(test, feature = "ir_text"))]
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

#[cfg(any(test, feature = "ir_text"))]
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

    pub fn values(&self) -> impl Iterator<Item = ValueView<'a>> + use<'a> {
        let (mut rest, mut next_value) = (self.values, self.first_value().to_word());
        core::iter::from_fn(move || {
            if rest.is_empty() {
                return None;
            }
            let id = ValueId::from_word(next_value);
            let (value, after) = read_value(rest, id).expect(WELL_FORMED);
            (rest, next_value) = (after, next_value + 1);
            Some(value)
        })
    }

    pub fn terminator(&self) -> TerminatorView<'a> {
        read_terminator(self.terminator).expect(WELL_FORMED).0
    }
}

#[cfg(any(test, feature = "ir_text"))]
#[derive(Copy, Clone)]
pub struct ValueView<'a> {
    pub id: ValueId,
    pub opcode: Opcode,
    pub position: Option<u32>,
    pub written_position: Option<u32>,
    pub is_written_position_for_callers: bool,
    pub fields: &'a [u32],
}

#[cfg(any(test, feature = "ir_text"))]
#[derive(Copy, Clone)]
pub struct TerminatorView<'a> {
    pub kind: TerminatorKind,
    pub position: Option<u32>,
    pub fields: &'a [u32],
    pub(super) target_count: u32,
    pub(super) targets: &'a [u32],
}

#[cfg(any(test, feature = "ir_text"))]
impl<'a> TerminatorView<'a> {
    pub fn target_count(&self) -> usize {
        self.target_count as usize
    }

    pub fn targets(&self) -> impl Iterator<Item = TargetView<'a>> + use<'a> {
        let mut rest = self.targets;
        core::iter::from_fn(move || {
            if rest.is_empty() {
                return None;
            }
            let (target, after) = read_target(rest).expect(WELL_FORMED);
            rest = after;
            Some(target)
        })
    }
}

#[cfg(any(test, feature = "ir_text"))]
#[derive(Copy, Clone)]
pub struct TargetView<'a> {
    pub block: BlockId,
    pub(super) arguments: &'a [u32],
    pub proofs: &'a [u32],
}

#[cfg(any(test, feature = "ir_text"))]
impl<'a> TargetView<'a> {
    pub fn arguments(&self) -> impl ExactSizeIterator<Item = ValueId> + use<'a> {
        self.arguments.iter().map(|&word| ValueId::from_word(word))
    }
}
