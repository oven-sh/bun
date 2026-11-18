//! Searches that go straight to the machine code of the pattern.

use bun_engine_asm::{Cond, Size, abi};
use bun_engine_codegen::ir::{
    Access, AccessFlags, Action, EffectFlags, Effects, Heap, Input, Output, PatchpointFlags, Type,
    Value as Ssa,
};
use bun_engine_regexp::Flags;
use bun_engine_text::StringImpl;
use bun_engine_vm::direct::{Form, Gives};
use bun_engine_vm::{GlobalObject, RegExp, RegExpGlobalState, RegExpObject, Value, Vm};

use super::Ways;
use super::views::View;
use crate::graph::{ExitKind, FormCall, heaps};
use crate::lower::emit::{PATTERN, Site};
use crate::lower::ways::Detour;
use crate::lower::{Lowering, Odds};
use crate::runtime::operations::library::MATCH_ARRAY;

const LAST_INDEX: usize = RegExpObject::OFFSET_OF_LAST_INDEX;
const WORD: usize = size_of::<usize>();
/// The start and the end.
const PAIR: usize = 2 * size_of::<u32>();
const NO_MATCH: i32 = -1;

impl Lowering<'_> {
    /// The pattern, and whether it is global or sticky.
    fn pattern_of(&mut self, object: Ssa) -> [Ssa; 2] {
        let offset = RegExpObject::OFFSET_OF_REGEXP_AND_FLAGS;
        let word = self.load(Type::I64, object, offset, heaps::OTHER_FIELDS);
        let pattern = self.ir().and(word, !RegExpObject::FLAG_MASK);
        let access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);
        let flags = self.load_byte(pattern, RegExp::OFFSET_OF_FLAGS, access);
        let mask = u32::from((Flags::GLOBAL | Flags::STICKY).bits());
        [pattern, self.ir().and(flags, mask)]
    }

    fn last_index_within(&mut self, object: Ssa, length: Ssa, slow: &mut Detour) -> Ssa {
        let last_index = self.load(Type::I64, object, LAST_INDEX, heaps::LAST_INDEX);
        let mut ir = self.ir();
        let (distance, length) = (
            ir.sub(last_index, Value::NUMBER_TAG),
            ir.zero_extend(length),
        );
        let is_other = ir.above(distance, length);
        self.detour_if(is_other, Odds::Low, slow);
        distance
    }

    /// The start and the end of the match, as I32. `groups` is zero if they are not wanted.
    fn run_pattern(
        &mut self,
        pattern: Ssa,
        (view, start): (View, Ssa),
        groups: Option<Ssa>,
        slow: &mut Detour,
    ) -> [Ssa; 2] {
        let (latin1_bit, first, vm) = (self.latin1_bit(view), self.int32(0), self.vm());
        let mut ir = self.ir();
        let is_latin1 = ir.shr(latin1_bit, StringImpl::IS_LATIN1.ilog2());
        let is_wide = ir.xor(is_latin1, 1);
        let variant = ir.zero_extend(is_wide);
        let distance = ir.shl(variant, WORD.ilog2());
        let place = ir.add(pattern, distance);
        let entries = RegExp::OFFSET_OF_ENTRIES + usize::from(groups.is_some()) * 2 * WORD;
        let entry = self.load(Type::I64, place, entries, heaps::LAST_MATCH);
        let is_missing = self.ir().is_zero(entry);
        self.detour_if(is_missing, Odds::Low, slow);

        let (units, none) = (self.address_of_unit(view, first, is_wide), self.word(0));
        let length = self.ir().zero_extend(view.length);
        let context = self.ir().add(vm, Vm::OFFSET_OF_REGEXP_CONTEXT);
        let effects = Effects {
            reads: Heap::EVERYTHING,
            writes: heaps::COPIED_VALUES,
            flags: EffectFlags::CONTROL_DEPENDENT,
        };
        let mut data = self.patchpoint(Action::CallIndirect, Site::Search(self.origin), effects);
        data.flags = PatchpointFlags::UNEXTENDED_RESULTS;
        data.clobbers_late = abi::CALLER_SAVED;
        data.clobbers_upper_halves = abi::CALLEE_SAVED_LOW_HALF;
        let argument =
            |position: usize, it| (it, Input::Fixed(abi::ARGUMENT_GPRS[position].into()));
        let inputs = [
            (entry, Input::Register),
            argument(0, units),
            argument(1, start),
            argument(2, length),
            argument(3, groups.unwrap_or(none)),
            argument(4, context),
            (pattern, Input::Fixed(PATTERN.into())),
        ];
        let results = abi::RETURN_GPRS.map(|gpr| (Type::I32, Output::Fixed(gpr.into())));
        let found = self.ir().patchpoint(&data, &inputs, &results);
        [0, 1].map(|position| self.ir().extract(found, position))
    }

    fn record_match(&mut self, realm: Ssa, pattern: Ssa, subject: Ssa, [start, end]: [Ssa; 2]) {
        let (state, heap) = (GlobalObject::OFFSET_OF_REGEXP_STATE, heaps::LAST_MATCH);
        let found = state + RegExpGlobalState::OFFSET_OF_FOUND;
        self.store(
            pattern,
            realm,
            state + RegExpGlobalState::OFFSET_OF_REGEXP,
            heap,
        );
        self.store(
            subject,
            realm,
            state + RegExpGlobalState::OFFSET_OF_SUBJECT,
            heap,
        );
        self.store(start, realm, found, heap);
        self.store(end, realm, found + size_of::<u32>(), heap);
        let (nothing, known) = (self.int32(0), state + RegExpGlobalState::OFFSET_OF_KNOWN);
        (self.ir()).store_sized(Size::S8, nothing, realm, known as i32, heap);
        self.store_barrier(realm, Ssa::NONE);
    }

    pub(super) fn find_match(&mut self, ways: &mut Ways, call: FormCall, passed: &[Ssa]) -> Ssa {
        let realm = self.operands()[0];
        let (regexp, subject) = match call.form {
            Form::search | Form::match_once => (passed[1], passed[0]),
            _ => (passed[0], passed[1]),
        };
        let view = self.view(subject, call.subject, &mut ways.slow);
        let (mut pattern, mut start, mut uses_last_index) = (regexp, self.word(0), self.int32(0));
        if let Form::test_plain | Form::exec_plain = call.form {
            [pattern, uses_last_index] = self.pattern_of(regexp);
            if call.uses_last_index {
                uses_last_index = self.int32(1);
            }
            let (slow, zero) = (&mut ways.slow, start);
            let load = |this: &mut Self| this.last_index_within(regexp, view.length, slow);
            start = self.choose(uses_last_index, Odds::Low, Type::I64, load, |_| zero);
        }
        let set_last_index = |this: &mut Self, index| {
            this.when(uses_last_index, Odds::Low, |this| {
                let index = this.box_int32(index);
                this.store(index, regexp, LAST_INDEX, heaps::LAST_INDEX);
            });
        };
        let offsets = call.groups.map(|groups| {
            let function = &mut self.graph.function;
            let slot = function.add_slot((u32::from(groups) + 1) * PAIR as u32, WORD as u32);
            function.slot_address(slot)
        });
        let groups = offsets.map(|it| self.ir().add(it, PAIR));
        let found = self.run_pattern(pattern, (view, start), groups, &mut ways.slow);

        let (has_none, slow) = (self.ir().less_than(found[0], 0), &mut ways.slow);
        self.give_if(ways.done, has_none, Odds::Even, |this| {
            let has_given_up = this.ir().compare(Cond::Ne, found[0], NO_MATCH);
            this.detour_if(has_given_up, Odds::Low, slow);
            let zero = this.int32(0);
            set_last_index(this, zero);
            match call.form.gives {
                Gives::Boolean => zero,
                Gives::Int32 { .. } => found[0],
                _ => this.word(Value::NULL.to_bits()),
            }
        });
        let result = match (offsets.zip(call.groups), call.form.gives) {
            (Some((offsets, groups)), _) => {
                self.store(found[0], offsets, 0, heaps::COPIED_VALUES);
                self.store(found[1], offsets, size_of::<u32>(), heaps::COPIED_VALUES);
                let count = self.word((u64::from(groups) + 1) * 2);
                let args = [pattern, subject, offsets, count];
                let array = self.call_operation_in(realm, MATCH_ARRAY, &args, &[Type::I64]);
                let has_failed = self.ir().is_zero(array);
                self.exit_if(has_failed, ExitKind::Threw);
                array
            }
            (_, Gives::Boolean) => self.int32(1),
            _ => found[0],
        };
        set_last_index(self, found[1]);
        self.record_match(realm, pattern, subject, found);
        result
    }
}
