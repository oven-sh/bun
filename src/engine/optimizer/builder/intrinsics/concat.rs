//! `String.prototype.concat`, with any number of arguments.

use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::{Intrinsic, RealmSlot, RealmWatchpoint, SpeculatedType as T};
use smallvec::SmallVec;

use crate::builder::Builder;
use crate::builder::calls::CallSite;

/// What ToString takes without throwing a TypeError or running a script.
const PRIMITIVE: T = T::HEAP_TOP
    .difference(T::OBJECT)
    .difference(T::SYMBOL)
    .difference(T::OTHER_CELL);
const WRAPPER: RealmSlot = RealmSlot::string_object_shape;

impl Builder<'_> {
    pub(super) fn quiet_to_string(&mut self, value: Ssa) -> Ssa {
        if self.expects_argument(value, T::STRING) {
            return self.check_argument(value, T::STRING);
        }
        self.check_argument(value, PRIMITIVE);
        self.primitive_to_string(value, self.likely_type(value))
    }

    pub(super) fn concat_intrinsic(
        &mut self,
        which: Intrinsic,
        site: &CallSite<'_>,
    ) -> Option<Ssa> {
        if which != Intrinsic::StringPrototypeConcat {
            return None;
        }
        // What it throws for lack of memory is of the realm of the code.
        let realm = (self.realm_of_callee(site.callee)).filter(|&it| it == self.global())?;
        let mut are_wrapped: SmallVec<[bool; 8]> = SmallVec::new();
        for (position, &value) in site.arguments.iter().enumerate() {
            let plain = if position == 0 { T::STRING } else { PRIMITIVE };
            let is_wrapped = !self.expects_argument(value, plain);
            if is_wrapped && !self.expects_original(value, T::STRING_OBJECT, realm, WRAPPER) {
                return None;
            }
            are_wrapped.push(is_wrapped);
        }
        let needs = [
            RealmWatchpoint::StringSymbolToPrimitive,
            RealmWatchpoint::StringToString,
        ];
        if are_wrapped.contains(&true)
            && !(needs.into_iter()).all(|which| self.watch(realm.watchpoints(self.vm, which)))
        {
            return None;
        }
        if !are_wrapped[0] {
            self.check_argument(site.arguments[0], T::STRING);
        }
        let to_string = |(&value, is_wrapped)| {
            if !is_wrapped {
                return self.quiet_to_string(value);
            }
            let object = self.check_original(value, T::STRING_OBJECT, realm, WRAPPER);
            self.string_in(object)
        };
        let strings: SmallVec<[Ssa; 8]> = (site.arguments.iter().zip(are_wrapped))
            .map(to_string)
            .collect();
        Some(self.concatenate(strings.into_iter().map(|it| (it, T::STRING))))
    }
}
