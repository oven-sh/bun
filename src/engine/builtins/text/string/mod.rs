mod constructor;
mod html;
mod locale;
mod pattern;
mod prototype;

use bun_engine_vm::{RealmSlot, RealmWatchpoint};
pub(crate) use prototype::initialize_prototype;

use crate::prelude::*;
use crate::watchpoints::Conditions;

pub(super) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    use RealmSlot::*;
    match slot {
        string_constructor => constructor::initialize(cx),
        string_object_shape => constructor::initialize_object_shape(cx),
        _ => return prototype::initialize_slot(cx, slot),
    }
    true
}

pub(super) fn add_conditions(
    cx: &Cx,
    which: RealmWatchpoint,
    conditions: &mut Conditions<'_>,
) -> bool {
    use RealmWatchpoint::*;
    let prototype = cx.string_prototype();
    let absent = match which {
        StringSymbolMatch => symbols::r#match,
        StringSymbolMatchAll => symbols::matchAll,
        StringSymbolReplace => symbols::replace,
        StringSymbolSearch => symbols::search,
        StringSymbolSplit => symbols::split,
        StringSymbolToPrimitive => symbols::toPrimitive,
        StringToString => {
            conditions.pristine(&prototype, names::toString);
            return true;
        }
        StringValueOf => {
            conditions.pristine(&prototype, names::valueOf);
            return true;
        }
        StringPrototypeChainIsSane => {
            conditions.no_elements(&prototype, cx.object_prototype().into());
            conditions.no_elements(&cx.object_prototype(), Value::NULL);
            return true;
        }
        _ => return false,
    };
    conditions.absent(&prototype, absent, cx.object_prototype().into());
    conditions.absent(&cx.object_prototype(), absent, Value::NULL);
    true
}

/// RequireObjectCoercible and ToString of `this`.
#[inline(always)]
fn this_string(cx: &mut Cx, frame: &CallFrame, message: &'static str) -> JsResult<Gc<JsString>> {
    match frame.this_value().as_string() {
        Some(string) => Ok(string),
        None => this_to_string(cx, frame, message),
    }
}

#[inline(never)]
fn this_to_string(cx: &mut Cx, frame: &CallFrame, message: &'static str) -> JsResult<Gc<JsString>> {
    (frame.this_value().require_object_coercible(cx, message)?).to_string(cx)
}
