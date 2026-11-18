use bun_engine_macros::export;
use bun_engine_vm::{
    Cx, Gc, IteratorRecord, JsAsyncFromSyncIterator, JsObject, JsResult, Value, iterator_method,
    iterator_next, throw_not_iterable,
};

#[export]
unsafe fn iterator_record_for_iterable(
    place: *mut IteratorRecord,
    cx: &mut Cx,
    iterable: Value,
) -> JsResult<()> {
    let record = IteratorRecord::for_iterable(cx, iterable)?;
    // SAFETY: a local of the caller.
    unsafe { place.write(record) };
    Ok(())
}

#[export]
unsafe fn iterator_record_from_method(
    place: *mut IteratorRecord,
    cx: &mut Cx,
    iterable: Value,
    method: Value,
) -> JsResult<()> {
    if !method.is_callable() {
        return Err(throw_not_iterable(cx, iterable));
    }
    let record = IteratorRecord::from_method(cx, iterable, method)?;
    // SAFETY: as above.
    unsafe { place.write(record) };
    Ok(())
}

#[export]
fn iterator_record_step_value(record: &mut IteratorRecord, cx: &mut Cx) -> JsResult<Option<Value>> {
    record.step_value(cx)
}

/// The exception is pending.
#[export]
fn iterator_record_close_on_throw(record: &IteratorRecord, cx: &mut Cx) -> JsResult<()> {
    let thrown = cx.check_exception();
    record.close_if_abrupt(cx, thrown)
}

#[export]
fn iterator_result_create(cx: &Cx, value: Value, done: bool) -> Gc<JsObject> {
    cx.new_iterator_result(value, done)
}

#[export]
fn iterator_method_or_undefined(cx: &mut Cx, object: Value) -> JsResult<Value> {
    Ok(iterator_method(cx, object)
        .ok()
        .flatten()
        .unwrap_or_default())
}

#[export]
fn object_has_iterator_method(cx: &mut Cx, object: Value) -> JsResult<bool> {
    Ok(iterator_method(cx, object)?.is_some())
}

#[export]
fn iterator_call_next(
    cx: &mut Cx,
    iterator: Value,
    next: Value,
    argument: Option<Value>,
) -> JsResult<Value> {
    iterator_next(cx, iterator, next, argument).map(Value::from)
}

#[export]
fn async_from_sync_iterator_create(
    cx: &Cx,
    sync_iterator: Gc<JsObject>,
    next_method: Value,
) -> Gc<JsAsyncFromSyncIterator> {
    JsAsyncFromSyncIterator::create(cx, sync_iterator, next_method)
}
