//! `Number`, `BigInt`, `Math` and `Date`.

mod bigint;
mod date_constructor;
mod date_prototype;
mod math;
mod number_constructor;
mod number_functions;
mod number_prototype;

use bun_engine_vm::{RealmSlot, RealmWatchpoint};

use crate::prelude::*;
use crate::watchpoints::Conditions;

pub(crate) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    use RealmSlot::*;
    match slot {
        bigint_prototype | bigint_constructor | bigint_object_shape => bigint::initialize(cx),
        date_prototype | date_constructor | date_shape => self::date_constructor::initialize(cx),
        number_prototype | number_constructor | number_object_shape => {
            self::number_constructor::initialize(cx);
        }
        math_object => math::initialize(cx),
        _ => return number_functions::initialize_slot(cx, slot),
    }
    true
}

pub(crate) fn add_conditions(
    cx: &Cx,
    which: RealmWatchpoint,
    conditions: &mut Conditions<'_>,
) -> bool {
    match which {
        RealmWatchpoint::DateConversions => {
            for name in [
                symbols::toPrimitive,
                names::valueOf,
                names::toString,
                names::toJSON,
                names::toISOString,
            ] {
                conditions.pristine(&cx.date_prototype(), name);
            }
        }
        RealmWatchpoint::NumberToString => {
            conditions.pristine(&cx.number_prototype(), names::toString);
        }
        _ => return false,
    }
    true
}
