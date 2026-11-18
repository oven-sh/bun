//! Strings whose characters are in one piece.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_text::StringImpl;
use bun_engine_vm::JsRopeString;

use crate::graph::{Fibers, heaps};
use crate::lower::ways::Detour;
use crate::lower::{Lowering, Odds};

/// Only the base may be used after a collection.
#[derive(Clone, Copy)]
pub(super) struct View {
    /// The string that has the characters. It is no rope.
    pub(super) base: Ssa,
    characters: Ssa,
    /// In code units. This and the length are I32.
    pub(super) offset: Ssa,
    pub(super) length: Ssa,
}

impl Lowering<'_> {
    /// Of a string that is no rope.
    pub(super) fn characters(&mut self, string: Ssa) -> Ssa {
        match (self.graph.text_of_constant(string)).and_then(|it| it.atom) {
            Some(address) => self.word(address as u64),
            None => self.fiber(string),
        }
    }

    pub(super) fn view(&mut self, string: Ssa, fibers: Fibers, slow: &mut Detour) -> View {
        let (fiber, heap) = (self.characters(string), heaps::STRING_FIBER);
        let of_flat = |this: &mut Self| {
            let length = match this.graph.text_of_constant(string) {
                Some(text) => this.int32(text.length as i32),
                None => this.load(Type::I32, fiber, StringImpl::OFFSET_OF_LENGTH, heap),
            };
            [string, fiber, this.int32(0), length]
        };
        let of_rope = |this: &mut Self| {
            let bit = this.ir().and(fiber, JsRopeString::IS_SUBSTRING);
            let is_concatenation = this.ir().is_zero(bit);
            this.detour_if(is_concatenation, Odds::Low, slow);
            let [first, second] = [
                JsRopeString::OFFSET_OF_LENGTH,
                JsRopeString::OFFSET_OF_FIBER2,
            ]
            .map(|offset| this.load(Type::I64, string, offset, heap));
            let mut ir = this.ir();
            let (low, high) = (ir.shr(first, 32), ir.and(second, 0xffff));
            let (high, offset) = (ir.shl(high, 32), ir.shr(second, 16));
            let (base, offset, length) = (ir.or(low, high), ir.wrap(offset), ir.wrap(first));
            [base, this.fiber(base), offset, length]
        };
        let [base, characters, offset, length] = if fibers.contains(Fibers::IS_FLAT) {
            of_flat(self)
        } else {
            let is_rope = self.is_rope(fiber);
            let odds = Odds::low_unless(fibers.contains(Fibers::MAY_WELL_BE_ROPE));
            let types = [Type::I64, Type::I64, Type::I32, Type::I32];
            self.choose_all(is_rope, odds, types, of_rope, of_flat)
        };
        View {
            base,
            characters,
            offset,
            length,
        }
    }

    /// An I32 that is `StringImpl::IS_LATIN1` or zero.
    pub(super) fn latin1_bit(&mut self, view: View) -> Ssa {
        let (offset, heap) = (StringImpl::OFFSET_OF_FLAGS, heaps::STRING_FIBER);
        let flags = self.load(Type::I32, view.characters, offset, heap);
        self.ir().and(flags, StringImpl::IS_LATIN1 as i32)
    }

    /// Of the code unit at an I32 index, if each has two to the power of `shift` bytes.
    pub(super) fn address_of_unit(&mut self, view: View, index: Ssa, shift: Ssa) -> Ssa {
        let (offset, heap) = (StringImpl::OFFSET_OF_DATA, heaps::STRING_FIBER);
        let units = self.load(Type::I64, view.characters, offset, heap);
        let mut ir = self.ir();
        let index = ir.add(index, view.offset);
        let index = ir.zero_extend(index);
        let distance = ir.shl(index, shift);
        ir.add(units, distance)
    }

    /// The same, for Latin-1.
    pub(super) fn latin1_address(&mut self, view: View, index: Ssa, slow: &mut Detour) -> Ssa {
        let (bit, no_shift) = (self.latin1_bit(view), self.int32(0));
        let is_wide = self.ir().is_zero(bit);
        self.detour_if(is_wide, Odds::Low, slow);
        self.address_of_unit(view, index, no_shift)
    }

    pub(super) fn load_units(&mut self, size: Size, address: Ssa, offset: usize) -> Ssa {
        let heap = heaps::STRING_FIBER;
        match size {
            Size::S64 => self.load(Type::I64, address, offset, heap),
            Size::S32 => self.load(Type::I32, address, offset, heap),
            _ => (self.ir()).load_narrow(size, Sign::Unsigned, address, offset as i32, heap),
        }
    }
}
