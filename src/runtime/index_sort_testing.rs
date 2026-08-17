//! `bun:internal-for-testing` probe for `index_sort::apply_permutation_in_place`. Its callers all
//! drop the index array right after the call, so the state it is left in is only observable here.
//! Lives in `bun_runtime` like `linear_fifo_testing`: it needs `bun_collections` and `bun_jsc`.

use bun_collections::index_sort;
use bun_core::ZigString;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

/// `applyPermutationInPlaceProbe(order)`: applies `order` to `[0, 10, 20, ...]` and returns
/// `{ items, order }`, the latter as the call left it.
pub(crate) fn apply_permutation_in_place_probe(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let order_value = frame.argument(0);
    if !order_value.is_array() {
        return Err(global.throw_invalid_arguments(format_args!(
            "applyPermutationInPlaceProbe expects an array"
        )));
    }
    let len = order_value.get_length(global)? as usize;
    let mut order: Vec<u32> = Vec::with_capacity(len);
    let mut seen = vec![false; len];
    for i in 0..len {
        let index = order_value.get_index(global, i as u32)?.to_int64();
        let Some(slot) = usize::try_from(index)
            .ok()
            .and_then(|index| seen.get_mut(index))
        else {
            return Err(global.throw_invalid_arguments(format_args!(
                "applyPermutationInPlaceProbe: order[{i}] = {index} is not an index into the array"
            )));
        };
        if core::mem::replace(slot, true) {
            return Err(global.throw_invalid_arguments(format_args!(
                "applyPermutationInPlaceProbe: order contains {index} more than once"
            )));
        }
        order.push(index as u32);
    }

    let mut items: Vec<u32> = (0..len as u32).map(|i| i * 10).collect();
    index_sort::apply_permutation_in_place(&mut items, &mut order);

    let to_js_array = |values: &[u32]| {
        JSValue::create_array_from_iter(global, values.iter(), |&value| {
            Ok(JSValue::js_number_from_uint64(u64::from(value)))
        })
    };
    let items = to_js_array(&items)?;
    let order = to_js_array(&order)?;
    JSValue::create_object2(
        global,
        &ZigString::static_(b"items"),
        &ZigString::static_(b"order"),
        items,
        order,
    )
}
