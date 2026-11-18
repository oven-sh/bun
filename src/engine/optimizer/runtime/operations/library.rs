//! For what is done in place of a call of a built-in.

use bun_engine_date::DateFields;
use bun_engine_macros::native_abi;
use bun_engine_vm::{Cx, DateInstance, Gc, JsArray, JsString, RegExp, Vm};

use super::{Address, Operation, Returned};

operations! {
    MATCH_ARRAY: fn match_array(
        cx: &Cx, regexp: Gc<RegExp>, input: Gc<JsString>, offsets: *const u32, count: usize
    ) -> Option<Gc<JsArray>> {
        // SAFETY: the code of the pattern and its caller have put that many there.
        let offsets = unsafe { core::slice::from_raw_parts(offsets, count) };
        let array = regexp.array_for_offsets(cx, input, offsets);
        array.map_err(|it| cx.discard_unless_termination(it)).ok()
    }
}

leaves! {
    LOCAL_FIELDS: fn local_fields(vm: &Vm, date: &DateInstance) -> u64 {
        date.local_fields(vm).map_or(0, DateFields::to_bits)
    }
    UTC_FIELDS: fn utc_fields(vm: &Vm, date: &DateInstance) -> u64 {
        date.utc_fields(vm).map_or(0, DateFields::to_bits)
    }
}
