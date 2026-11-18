//! Elements.

use bun_engine_codegen::ir::{Action, Input, Output, Type, Value as Ssa};
use bun_engine_text::{OFFSET_OF_SYMBOL_HASH, StringImpl};
use bun_engine_vm::caches::{HasOwnPropertyEntry as Entry, LookupTables, PRIMARY_SHAPE_SHIFTS};
use bun_engine_vm::{
    CellType, IndexingMode, JsCell, JsString, JsSymbol, SpeculatedType as T, Storage, TypeFlags, Vm,
};
use smallvec::SmallVec;

use super::emit::Site;
use super::ways::{Detour, Meeting};
use super::{Lowering, Odds};
use crate::graph::{ExitKind, ModeCheck, Search, heaps};
use crate::runtime::operations::{MAKE_ROOM, Operation, elements as operations, methods};

impl Lowering<'_> {
    /// An integer, and whether it is zero for the modes that are wanted or for the others.
    fn test_modes(&mut self, cell: Ssa, check: ModeCheck) -> (Ssa, bool) {
        let wanted = check.wanted.and(check.known);
        let others = check.known.without(wanted);
        let mode = self.load_byte(cell, JsCell::OFFSET_OF_INDEXING_MODE, heaps::INDEXING_MODE);
        for (members, rest, are_wanted) in [(wanted, others, true), (others, wanted, false)] {
            if let Some((base, mask)) = members.test_against(rest) {
                let difference = self.ir().sub(mode, i32::from(base));
                return (self.ir().and(difference, i32::from(mask)), are_wanted);
            }
        }
        // The shift leaves the bits of the lock aside.
        let [low, high] = [wanted.bits() as u32, (wanted.bits() >> u32::BITS) as u32];
        let table = if low == high {
            self.int32(low as i32)
        } else {
            self.word(wanted.bits())
        };
        let shifted = self.ir().shr(table, mode);
        (self.ir().and(shifted, 1), false)
    }

    pub(super) fn has_modes(&mut self, cell: Ssa, check: ModeCheck) -> Ssa {
        match self.test_modes(cell, check) {
            (bits, true) => self.ir().is_zero(bits),
            (bits, false) => self.ir().is_not_zero(bits),
        }
    }

    pub(super) fn check_modes(&mut self, cell: Ssa, check: ModeCheck) {
        let holds = self.has_modes(cell, check);
        let fails = self.not(holds);
        self.exit_if(fails, check.failure);
    }

    pub(super) fn check_bounds(&mut self, index: Ssa, length: Ssa) {
        let is_outside = self.ir().above_or_equal(index, length);
        self.exit_if(is_outside, ExitKind::OutOfBounds);
    }

    pub(super) fn make_room(&mut self, object: Ssa, storage: Ssa) -> Ssa {
        let (index, offset) = (self.operands()[2], Storage::OFFSET_OF_VECTOR_LENGTH as i32);
        let capacity = (self.ir()).load(Type::I32, storage, offset, heaps::VECTOR_LENGTH);
        let is_full = self.ir().above_or_equal(index, capacity);
        let grow = |this: &mut Self| {
            let grown = this.call_operation(MAKE_ROOM, &[object, index]);
            let has_failed = this.ir().is_zero(grown);
            this.exit_if(has_failed, ExitKind::StoreToHole);
            grown
        };
        self.choose(is_full, Odds::Low, Type::I64, grow, |_| storage)
    }

    pub(super) fn check_text(&mut self, string: Ssa, atom: Ssa) {
        let fiber = self.fiber(string);
        let differs = self.ir().not_equal(fiber, atom);
        self.when(differs, Odds::Even, |this| {
            let is_alike = this.call_operation(operations::HAS_TEXT, &[string, atom]);
            let differs = this.ir().is_zero(is_alike);
            this.exit_if(differs, ExitKind::BadIdentity);
        });
    }

    fn unless_zero(&mut self, result: Ssa) -> Ssa {
        let has_failed = self.ir().is_zero(result);
        self.exit_if(has_failed, ExitKind::ExoticObject);
        result
    }

    /// With the operands, for a function that returns zero if it has done nothing.
    pub(super) fn call_or_exit(&mut self, operation: Operation) -> Ssa {
        let result = self.call_operation(operation, &self.operands());
        self.unless_zero(result)
    }

    pub(super) fn set_length(&mut self, array: Ssa, storage: Ssa, kind: u32) {
        const MOST_IN_LINE: i32 = 64;
        let new = self.operands()[2];
        let (public, vector) = (
            Storage::OFFSET_OF_PUBLIC_LENGTH as i32,
            Storage::OFFSET_OF_VECTOR_LENGTH as i32,
        );
        let mut ir = self.ir();
        let old = ir.load(Type::I32, storage, public, heaps::PUBLIC_LENGTH);
        let room = ir.load(Type::I32, storage, vector, heaps::VECTOR_LENGTH);
        let removed = ir.sub(old, new);
        let (are_many, is_past) = (ir.greater_than(removed, MOST_IN_LINE), ir.above(new, room));
        let takes_more = ir.or(are_many, is_past);
        let call = |this: &mut Self| {
            let is_done = this.call_operation(methods::SET_LENGTH, &[array, new]);
            let has_failed = this.ir().is_zero(is_done);
            this.exit_if(has_failed, ExitKind::OutOfBounds);
            Ssa::NONE
        };
        let clear = |this: &mut Self| {
            let hole = this.word(IndexingMode::from_bits(kind as u8).kind().hole());
            let operands = [
                (storage, Input::LateRegister),
                (new, Input::LateRegister),
                (old, Input::ConsumedRegister),
                (hole, Input::LateRegister),
            ];
            this.write_elements(Site::FillWords, &operands);
            (this.ir()).store(new, storage, public, heaps::PUBLIC_LENGTH);
            Ssa::NONE
        };
        self.choose(takes_more, Odds::Low, Type::Void, call, clear);
    }

    pub(super) fn splice(&mut self) -> Ssa {
        let operands = self.operands();
        let (positions, items) = operands.split_at(3);
        let mut args: SmallVec<[Ssa; 5]> = positions.into();
        args.extend([self.copy_to_memory(items), self.word(items.len() as u64)]);
        let removed = self.call_operation(methods::SPLICE, &args);
        self.unless_zero(removed)
    }

    pub(super) fn find_element(&mut self, how: u32) -> Ssa {
        let operation = match Search::from_data(how) {
            Search::IndexOf => methods::INDEX_OF,
            Search::Includes => methods::INCLUDES,
        };
        let biased = self.call_or_exit(operation);
        self.ir().sub(biased, methods::BIAS)
    }

    pub(super) fn find_word(&mut self) -> Ssa {
        const MOST_IN_LINE: i32 = 12;
        let operands = self.operands();
        let [storage, start, end, word] = *operands else {
            unreachable!("four operands")
        };
        let count = self.ir().sub(end, start);
        let is_long = self.ir().above(count, MOST_IN_LINE);
        let call = |this: &mut Self| this.call_quietly(methods::FIND_WORD, &operands, Type::I32);
        let look = |this: &mut Self| {
            let effects = this.graph.function.effects(this.at);
            let data = this.patchpoint(Action::Custom, Site::FindWord, effects);
            let inputs = [storage, start, end, word].map(|it| (it, Input::LateRegister));
            (this.ir()).patchpoint(&data, &inputs, &[(Type::I32, Output::EarlyRegister)])
        };
        self.choose(is_long, Odds::Even, Type::I32, call, look)
    }

    pub(super) fn look_up_element(&mut self, object: Ssa, index: Ssa) -> Ssa {
        let args = [self.vm(), object, index];
        let value = self.call_quietly(operations::LOOK_UP_ELEMENT, &args, Type::I64);
        self.unless_zero(value)
    }

    pub(super) fn look_up_name(&mut self, object: Ssa, name: Ssa) -> Ssa {
        let value = self.call_quietly(operations::LOOK_UP_NAME, &[object, name], Type::I64);
        self.unless_zero(value)
    }

    pub(super) fn has_element(&mut self, object: Ssa, index: Ssa) -> Ssa {
        let args = [self.vm(), object, index];
        let answer = self.call_quietly(operations::HAS_ELEMENT, &args, Type::I64);
        self.unless_zero(answer)
    }

    pub(super) fn as_name(&mut self, key: Ssa, known: T) {
        if T::SYMBOL.contains(known) {
            return;
        }
        let (meeting, mut slow) = (self.part(Type::Void), Detour::default());
        if known.intersects(T::SYMBOL) {
            let is_symbol = self.has_cell_type(key, CellType::Symbol);
            self.give_if(meeting, is_symbol, Odds::Low, |_| Ssa::NONE);
        }
        let flags = self.load_byte(key, JsCell::OFFSET_OF_FLAGS, heaps::STRING_FIBER);
        let is_atom = self.ir().and(flags, TypeFlags::PER_CELL_BIT.bits());
        let is_other = self.ir().is_zero(is_atom);
        self.detour_if(is_other, Odds::Low, &mut slow);
        let name = self.fiber(key);
        let flags = self.load(
            Type::I32,
            name,
            StringImpl::OFFSET_OF_FLAGS,
            heaps::STRING_FIBER,
        );
        let is_index = self.ir().and(flags, StringImpl::IS_ARRAY_INDEX);
        self.exit_if(is_index, ExitKind::Inconvertible);
        self.give(meeting, Ssa::NONE);
        self.meet_after(meeting, slow, |this| {
            let is_name = this.call_operation(operations::MAKE_NAME, &[key]);
            let has_failed = this.ir().is_zero(is_name);
            this.exit_if(has_failed, ExitKind::Inconvertible);
            Ssa::NONE
        });
    }

    pub(super) fn hash_name(&mut self, name: Ssa, known: T) -> Ssa {
        let heap = heaps::STRING_FIBER;
        let flags = self.load(Type::I32, name, StringImpl::OFFSET_OF_FLAGS, heap);
        let is_symbol = if (T::STRING | T::SYMBOL) & known == T::SYMBOL || T::STRING.contains(known)
        {
            self.int32(known.intersects(T::SYMBOL).into())
        } else {
            self.ir().and(flags, StringImpl::IS_SYMBOL)
        };
        self.choose(
            is_symbol,
            Odds::Low,
            Type::I32,
            |this| this.load(Type::I32, name, OFFSET_OF_SYMBOL_HASH, heap),
            |this| this.ir().shr(flags, StringImpl::FLAG_COUNT),
        )
    }

    pub(super) fn has_own(&mut self, object: Ssa, key: Ssa, known: T) -> Ssa {
        let (meeting, mut slow) = (self.part(Type::I32), Detour::default());
        let expected = self.graph.prediction(self.graph.root(key));
        let names = T::STRING | T::SYMBOL;
        if known.intersects(names) && (expected.is_empty() || expected.intersects(names)) {
            let is_name = self.has_type(key, names & known, known & T::HEAP_TOP);
            let is_other = self.not(is_name);
            self.detour_if(is_other, Odds::Low, &mut slow);
            self.look_into_own_properties(object, key, meeting, &mut slow);
        } else {
            self.take_detour(&mut slow);
        }
        self.meet_after(meeting, slow, |this| {
            let answer = this.call_or_exit(operations::HAS_OWN);
            this.ir().sub(answer, 1)
        })
    }

    /// What the `Vm` remembers of them. It has only atoms and symbols for names.
    fn look_into_own_properties(
        &mut self,
        object: Ssa,
        key: Ssa,
        meeting: Meeting,
        slow: &mut Detour,
    ) {
        let name = self.fiber(key);
        let is_rope = self.is_rope(name);
        self.detour_if(is_rope, Odds::Low, slow);
        let hash = self.hash_name(name, T::STRING | T::SYMBOL);
        let (shape, vm, heap) = (self.shape_id(object), self.vm(), heaps::WORLD);
        let tables = self.load(Type::I64, vm, Vm::OFFSET_OF_LOOKUP_TABLES, heap);
        let epoch = self.load(Type::I32, vm, Vm::OFFSET_OF_PROTOTYPE_CHAIN_EPOCH, heap);
        let mut ir = self.ir();
        let [low, high] = PRIMARY_SHAPE_SHIFTS.map(|shift| ir.shr(shape, shift));
        let mixed = ir.xor(low, high);
        let sum = ir.add(mixed, hash);
        let index = ir.and(sum, Entry::COUNT - 1);
        let index = ir.zero_extend(index);
        let offset = ir.shl(index, size_of::<Entry>().ilog2());
        let entry = ir.add(tables, offset);
        let (now, table) = (ir.shl(epoch, 1), LookupTables::OFFSET_OF_HAS_OWN_PROPERTY);
        for (ty, field, wanted) in [
            (Type::I32, Entry::OFFSET_OF_SHAPE, shape),
            (Type::I64, Entry::OFFSET_OF_NAME, name),
        ] {
            let found = self.load(ty, entry, table + field, heap);
            let differs = self.ir().not_equal(found, wanted);
            self.detour_if(differs, Odds::Low, slow);
        }
        let offset = table + Entry::OFFSET_OF_EPOCH_AND_RESULT;
        let found = self.load(Type::I32, entry, offset, heap);
        let answer = self.ir().xor(found, now);
        let is_stale = self.ir().above(answer, 1);
        self.detour_if(is_stale, Odds::Low, slow);
        self.give(meeting, answer);
    }

    pub(super) fn spread_elements(&mut self, object: Ssa) -> Ssa {
        let list = self.call_operation(operations::SPREAD_ELEMENTS, &[object]);
        self.unless_zero(list)
    }

    pub(super) fn check_species_is_array(&mut self, original: Ssa) {
        let args = [self.global(), original];
        let holds = self.call_quietly(operations::SPECIES_IS_ARRAY, &args, Type::I32);
        self.unless_zero(holds);
    }

    pub(super) fn store_plain_element(&mut self) {
        let operands = self.operands();
        let is_done = self.call_operation(operations::STORE_PLAIN_ELEMENT, &operands);
        self.unless_zero(is_done);
    }
}

const _: () = {
    assert!(JsSymbol::OFFSET_OF_NAME == JsString::OFFSET_OF_FIBER);
    assert!(size_of::<Entry>().is_power_of_two());
};
