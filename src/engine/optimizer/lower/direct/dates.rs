//! Dates.

use bun_engine_codegen::ir::{EffectFlags, Effects, Type, Value as Ssa};
use bun_engine_vm::DateInstance;

use crate::graph::heaps;
use crate::lower::{Lowering, Odds};
use crate::runtime::operations::library::{LOCAL_FIELDS, UTC_FIELDS};

impl Lowering<'_> {
    pub(in crate::lower) fn date_fields(&mut self, date: Ssa, offset: usize) -> Ssa {
        let kept = self.load(Type::I64, date, offset, heaps::DATE_FIELDS);
        let is_missing = self.ir().is_zero(kept);
        let compute = |this: &mut Self| {
            let function = match offset {
                DateInstance::OFFSET_OF_UTC_FIELDS => UTC_FIELDS,
                _ => LOCAL_FIELDS,
            };
            let effects = Effects {
                reads: heaps::WORLD,
                writes: heaps::DATE_FIELDS,
                flags: EffectFlags::CONTROL_DEPENDENT,
            };
            let vm = this.vm();
            this.call_with_effects(function, &[vm, date], &[Type::I64], effects)
        };
        self.choose(is_missing, Odds::Low, Type::I64, compute, |_| kept)
    }

    pub(in crate::lower) fn set_time(&mut self, date: Ssa, time: Ssa) {
        let none = self.word(0);
        for offset in [
            DateInstance::OFFSET_OF_LOCAL_FIELDS,
            DateInstance::OFFSET_OF_UTC_FIELDS,
        ] {
            self.store(none, date, offset, heaps::DATE_FIELDS);
        }
        self.store(time, date, DateInstance::OFFSET_OF_TIME, heaps::DATES);
    }
}
