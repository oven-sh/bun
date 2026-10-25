//! `Mutex`, `Condition`, `SharedArray` and `SharedStruct` for JS, over `bun_shared_struct`.
//!
//! `Mutex` and `Condition` are generated classes: thin wrappers whose waits poll the worker's
//! termination so a blocked worker can still be stopped. `SharedArray` and `SharedStruct` are
//! hand-written C++ views (src/jsc/bindings/SharedStructObject.cpp) that call back here to read and
//! write a slot, because a slot's JS value is made and checked on this side.

use core::ffi::c_void;
use std::sync::Arc;

use bun_core::String as BunString;
use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope};
use bun_jsc::{
    JSBigInt, JSGlobalObject, JSValue, JsResult, StringJsc as _, VirtualMachineRef,
    from_js_host_call, to_js_host_call,
};
use bun_shared_struct::{
    self as shared, Abort, ShapeError, SharedBlock, StructShape, Value, WaitOutcome,
};

use crate::generated_bindgen::shared_struct_classes::{js_Condition, js_Mutex};

// C++ holds a block as the `*const SharedBlock` that `Arc::into_raw` made, spelled `*const c_void` across the boundary.
unsafe extern "C" {
    /// The block of a SharedStruct or SharedArray view, which the view owns; null for any other value.
    safe fn Bun__SharedBlock__fromJS(value: JSValue) -> *const c_void;
    /// A new view of `block`. It takes over a strong count of `block`.
    fn Bun__SharedBlock__wrap(global: &JSGlobalObject, block: *const c_void) -> JSValue;
    /// The wrapper that slot `index` of the view `view` last gave out or took in, if it is the one for the object at `key`; else empty.
    fn Bun__SharedView__cachedWrapper(view: JSValue, index: usize, key: *const c_void) -> JSValue;
    /// Records that slot `index` of `view` holds the object at `key`, whose wrapper is `wrapper`; a null `key` clears the entry.
    fn Bun__SharedView__remember(
        global: &JSGlobalObject,
        view: JSValue,
        index: usize,
        key: *const c_void,
        wrapper: JSValue,
    );
    safe fn Bun__SharedStruct__createConstructors(
        global: &JSGlobalObject,
        mutex: JSValue,
        condition: JSValue,
    ) -> JSValue;
}

// ─────────────────────────────── Mutex and Condition ───────────────────────────────

/// Polled while a lock or a wait blocks: true once the worker was asked to terminate, or the process is
/// shutting down. The termination exception itself is raised at the next safepoint.
fn script_stopped() -> impl Abort {
    let vm = VirtualMachineRef::get();
    move || !vm.script_allowed()
}

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub(crate) struct MutexObject {
    ref_count: bun_ptr::ThreadSafeRefCount<MutexObject>,
    inner: Arc<shared::Mutex>,
}

impl MutexObject {
    fn new(inner: Arc<shared::Mutex>) -> *mut Self {
        bun_ptr::RefPtr::new(Self {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            inner,
        })
        .into_raw()
    }

    pub(crate) fn constructor() -> *mut Self {
        Self::new(shared::Mutex::new())
    }

    pub(crate) fn lock<'a>(
        &self,
        heap: &JsHeap<'a>,
        timeout: Option<f64>,
    ) -> bun_jsc::bindgen::Result<'a, bool> {
        if self.inner.is_owned() {
            return Err(heap.type_error(format_args!("Mutex is already locked by this thread")));
        }
        let timeout = timeout.and_then(shared::timeout_from_millis);
        Ok(self.inner.lock(timeout, &script_stopped()).is_ok())
    }

    pub(crate) fn try_lock(&self) -> bool {
        self.inner.try_lock()
    }

    pub(crate) fn unlock<'a>(&self, heap: &JsHeap<'a>) -> bun_jsc::bindgen::Result<'a, ()> {
        if !self.inner.is_owned() {
            return Err(heap.type_error(format_args!("Mutex is not locked by this thread")));
        }
        self.inner.unlock();
        Ok(())
    }
}

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub(crate) struct ConditionObject {
    ref_count: bun_ptr::ThreadSafeRefCount<ConditionObject>,
    inner: Arc<shared::Condition>,
}

impl ConditionObject {
    fn new(inner: Arc<shared::Condition>) -> *mut Self {
        bun_ptr::RefPtr::new(Self {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            inner,
        })
        .into_raw()
    }

    pub(crate) fn constructor() -> *mut Self {
        Self::new(shared::Condition::new())
    }

    pub(crate) fn wait<'a>(
        &self,
        heap: &JsHeap<'a>,
        mutex: &MutexObject,
        timeout: Option<f64>,
    ) -> bun_jsc::bindgen::Result<'a, bool> {
        if !mutex.inner.is_owned() {
            return Err(heap.type_error(format_args!(
                "Condition.wait needs a mutex that this thread has locked"
            )));
        }
        let timeout = timeout.and_then(shared::timeout_from_millis);
        let outcome = self.inner.wait(&mutex.inner, timeout, &script_stopped());
        Ok(outcome == WaitOutcome::Notified)
    }

    pub(crate) fn notify(&self, count: Option<f64>) -> f64 {
        self.inner.notify(shared::notify_count(count)) as f64
    }
}

// ─────────────────────────── JS values to slots, and back ───────────────────────────

/// The UTF-16 code units of `text`.
fn utf16_of(text: &BunString) -> Vec<u16> {
    if text.is_utf16() {
        text.utf16().to_vec()
    } else {
        text.latin1().iter().map(|&b| u16::from(b)).collect()
    }
}

/// The block behind a SharedStruct or SharedArray view.
fn block_of(value: JSValue) -> Option<Arc<SharedBlock>> {
    let ptr = Bun__SharedBlock__fromJS(value);
    if ptr.is_null() {
        return None;
    }
    let ptr = ptr.cast::<SharedBlock>();
    // SAFETY: `ptr` is the `Arc::into_raw` count that the live view owns, and `value` keeps the view alive.
    unsafe {
        Arc::increment_strong_count(ptr);
        Some(Arc::from_raw(ptr))
    }
}

/// Whether `value` is one that a slot can hold.
fn is_shareable(value: JSValue) -> bool {
    value.is_undefined_or_null()
        || value.is_boolean()
        || value.is_number()
        || value.is_string_literal()
        || value.is_big_int()
        || !Bun__SharedBlock__fromJS(value).is_null()
        || value.as_class_ref::<MutexObject>().is_some()
        || value.as_class_ref::<ConditionObject>().is_some()
}

/// What a slot holds for `value`; `None` if it cannot be shared.
fn to_value(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Value>> {
    if !is_shareable(value) {
        return Ok(None);
    }
    Ok(Some(if value.is_undefined() {
        Value::Undefined
    } else if value.is_null() {
        Value::Null
    } else if value.is_boolean() {
        Value::Bool(value.as_boolean())
    } else if value.is_number() {
        Value::Number(value.as_number())
    } else if value.is_string_literal() {
        Value::String(utf16_of(&value.to_bun_string(global)?).into())
    } else if value.is_big_int() {
        let digits = JSBigInt::from_js(value)
            .expect("is_big_int")
            .to_string(global)?;
        Value::BigInt(Arc::from(
            core::str::from_utf8(digits.to_utf8().slice()).expect("BigInt digits are ASCII"),
        ))
    } else {
        shared_of(value).expect("is_shareable")
    }))
}

/// The object behind a SharedStruct, SharedArray, Mutex or Condition; `None` for any other value.
pub(crate) fn shared_of(value: JSValue) -> Option<Value> {
    if let Some(block) = block_of(value) {
        Some(Value::Struct(block))
    } else if let Some(mutex) = value.as_class_ref::<MutexObject>() {
        Some(Value::Mutex(Arc::clone(&mutex.inner)))
    } else {
        value
            .as_class_ref::<ConditionObject>()
            .map(|condition| Value::Condition(Arc::clone(&condition.inner)))
    }
}

/// `to_value`, or a TypeError for a value that cannot be shared.
fn to_shared(global: &JSGlobalObject, value: JSValue) -> JsResult<Value> {
    to_value(global, value)?.ok_or_else(|| {
        global.throw_type_error(format_args!(
            "Only primitives, SharedStruct, SharedArray, Mutex and Condition can be stored in a shared struct or array"
        ))
    })
}

/// A new view of `block` in this realm.
fn wrap(global: &JSGlobalObject, block: Arc<SharedBlock>) -> JsResult<JSValue> {
    let raw = Arc::into_raw(block).cast::<c_void>();
    // SAFETY: C++ takes over the strong count `into_raw` just made, and returns zero only with an exception pending.
    from_js_host_call(global, || unsafe { Bun__SharedBlock__wrap(global, raw) })
}

pub(crate) fn to_js(global: &JSGlobalObject, value: Value) -> JsResult<JSValue> {
    Ok(match value {
        Value::Undefined => JSValue::UNDEFINED,
        Value::Null => JSValue::NULL,
        Value::Bool(b) => JSValue::js_boolean(b),
        Value::Number(n) => JSValue::js_number(n),
        Value::String(units) => BunString::clone_utf16(&units).to_js(global)?,
        Value::BigInt(digits) => {
            JSValue::big_int_from_decimal(global, digits.as_bytes())?.unwrap_or(JSValue::UNDEFINED)
        }
        Value::Struct(block) => wrap(global, block)?,
        Value::Mutex(inner) => js_Mutex::to_js(MutexObject::new(inner), global),
        Value::Condition(inner) => js_Condition::to_js(ConditionObject::new(inner), global),
    })
}

// ──────────────────────────────── called from C++ ────────────────────────────────
//
// `block` is a `const SharedBlock*` that the calling view owns a strong count of, and `global` is the realm the view
// is running in.

/// # Safety
/// `block` is a live `SharedBlock` that outlives `'a`.
unsafe fn block_ref<'a>(block: *const c_void) -> &'a SharedBlock {
    // SAFETY: forwarded.
    unsafe { &*block.cast::<SharedBlock>() }
}

/// # Safety
/// The view being destroyed owns the count.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__SharedBlock__release(block: *const c_void) {
    // SAFETY: forwarded.
    drop(unsafe { Arc::from_raw(block.cast::<SharedBlock>()) });
}

/// # Safety
/// `block` is live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__SharedBlock__length(block: *const c_void) -> usize {
    // SAFETY: forwarded.
    unsafe { block_ref(block) }.len()
}

/// # Safety
/// `block` is live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__SharedBlock__isStruct(block: *const c_void) -> bool {
    // SAFETY: forwarded.
    unsafe { block_ref(block) }.shape().is_some()
}

/// # Safety
/// `block` is a live shared struct, `index` is below its length, and the out-pointers are valid.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__SharedBlock__fieldName(
    block: *const c_void,
    index: usize,
    chars: *mut *const u16,
    length: *mut usize,
) {
    // SAFETY: forwarded.
    let block = unsafe { block_ref(block) };
    let name = block.shape().expect("a shared struct").name(index);
    // SAFETY: forwarded. The name lives in the block's shape, so it lasts as long as the view.
    unsafe {
        *chars = name.as_ptr();
        *length = name.len();
    }
}

/// The address of the object that `value` refers to, which is what a cached wrapper is checked against; null for a primitive.
fn identity_of(value: &Value) -> *const c_void {
    match value {
        Value::Struct(block) => Arc::as_ptr(block).cast(),
        Value::Mutex(mutex) => Arc::as_ptr(mutex).cast(),
        Value::Condition(condition) => Arc::as_ptr(condition).cast(),
        _ => core::ptr::null(),
    }
}

/// Slot `index` as a JS value. `*key` is set to the address of the object the slot holds, or null for a primitive; when that
/// is `cached_key`, the result is `cached`, the wrapper C++ made for that object, instead of a new one.
///
/// # Safety
/// `block` is live, `index` is below its length, `global` is live, and `key` is valid for a write.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__SharedBlock__load(
    block: *const c_void,
    index: usize,
    global: *mut JSGlobalObject,
    cached_key: *const c_void,
    cached: JSValue,
    key: *mut *const c_void,
) -> JSValue {
    // SAFETY: forwarded.
    let (block, global) = unsafe { (block_ref(block), &*global) };
    // A plain `obj.field` read is unordered.
    let value = block.load_relaxed(index);
    let identity = identity_of(&value);
    // SAFETY: forwarded.
    unsafe { *key = identity };
    if !identity.is_null() && identity == cached_key {
        return cached;
    }
    to_js_host_call(global, || to_js(global, value))
}

/// `*key` is set as for [`Bun__SharedBlock__load`], to the address of the object that was stored.
///
/// # Safety
/// As [`Bun__SharedBlock__load`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__SharedBlock__store(
    block: *const c_void,
    index: usize,
    global: *mut JSGlobalObject,
    value: JSValue,
    key: *mut *const c_void,
) -> bool {
    // SAFETY: forwarded.
    let (block, global) = unsafe { (block_ref(block), &*global) };
    match to_shared(global, value) {
        Ok(value) => {
            // A plain `obj.field = value` write is unordered.
            block.store_relaxed(index, &value);
            // SAFETY: forwarded.
            unsafe { *key = identity_of(&value) };
            true
        }
        // An exception is pending.
        Err(_) => false,
    }
}

fn new_struct_block(global: &JSGlobalObject, names: JSValue) -> JsResult<Arc<SharedBlock>> {
    if !names.is_array() {
        return Err(
            global.throw_type_error(format_args!("SharedStruct needs an array of field names"))
        );
    }
    let mut list = Vec::new();
    for i in 0..names.get_length(global)? {
        let name = names.get_index(global, i as u32)?;
        if !name.is_string_literal() {
            return Err(
                global.throw_type_error(format_args!("SharedStruct field names must be strings"))
            );
        }
        list.push(utf16_of(&name.to_bun_string(global)?));
    }
    match StructShape::new(list) {
        Ok(shape) => Ok(SharedBlock::with_shape(shape)),
        Err(ShapeError::Duplicate(i)) => {
            Err(global.throw_type_error(format_args!("SharedStruct field name {i} is a duplicate")))
        }
        Err(ShapeError::ArrayIndex(i)) => Err(global.throw_type_error(format_args!(
            "SharedStruct field name {i} is an array index"
        ))),
    }
}

/// A block for `new SharedStruct(names)`, or null with an exception pending.
///
/// # Safety
/// `global` is live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__SharedStruct__newBlock(
    global: *mut JSGlobalObject,
    names: JSValue,
) -> *const c_void {
    // SAFETY: forwarded.
    let global = unsafe { &*global };
    match new_struct_block(global, names) {
        Ok(block) => Arc::into_raw(block).cast(),
        Err(_) => core::ptr::null(),
    }
}

/// A block for `new SharedArray(length)`, or null with an exception pending.
///
/// # Safety
/// `global` is live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__SharedArray__newBlock(
    global: *mut JSGlobalObject,
    length: JSValue,
) -> *const c_void {
    // SAFETY: forwarded.
    let global = unsafe { &*global };
    let length = if length.is_undefined() {
        Some(0.0)
    } else {
        length.get_number()
    };
    match length {
        Some(n) if n.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&n) => {
            Arc::into_raw(SharedBlock::new(n as usize)).cast()
        }
        _ => {
            let _ = global.throw_invalid_arguments(format_args!(
                "SharedArray length must be an integer from 0 to 4294967295"
            ));
            core::ptr::null()
        }
    }
}

// ───────────────────────────── bindgen functions ─────────────────────────────

/// `{ Mutex, Condition, SharedArray, SharedStruct }`.
pub(crate) fn classes(cx: &mut JsScope<'_>) -> JSValue {
    let global = cx.global();
    Bun__SharedStruct__createConstructors(
        global,
        js_Mutex::get_constructor(global),
        js_Condition::get_constructor(global),
    )
}

pub(crate) fn can_be_shared(value: JsLocal<'_>) -> bool {
    is_shareable(value.to_js())
}

/// The block and slot that `target[key]` names.
fn slot_of(
    global: &JSGlobalObject,
    target: JSValue,
    key: JSValue,
) -> JsResult<(Arc<SharedBlock>, usize)> {
    let Some(block) = block_of(target) else {
        return Err(global.throw_type_error(format_args!("Expected a SharedStruct or SharedArray")));
    };
    let index = match block.shape() {
        Some(shape) => shape.index_of(&utf16_of(&key.to_bun_string(global)?)),
        None => {
            let n = key.to_number(global)?;
            (n.fract() == 0.0 && n >= 0.0 && n < block.len() as f64).then_some(n as usize)
        }
    };
    match index {
        Some(index) => Ok((block, index)),
        None => Err(global.throw_invalid_arguments(format_args!("Invalid atomic access index"))),
    }
}

/// `value`, which slot `index` of `view` held, as a JS value: the wrapper the view cached for that object, so that
/// `Atomics.load(parent, "child") === parent.child`.
fn to_js_from_slot(
    global: &JSGlobalObject,
    view: JSValue,
    index: usize,
    value: Value,
) -> JsResult<JSValue> {
    let identity = identity_of(&value);
    if !identity.is_null() {
        // SAFETY: `view` is the live view that `slot_of` found `index` in.
        let cached = unsafe { Bun__SharedView__cachedWrapper(view, index, identity) };
        if !cached.is_empty() {
            return Ok(cached);
        }
    }
    to_js(global, value)
}

/// Records for `view` that slot `index` now holds `value`, which `wrapper` is the JS value of.
fn remember_slot(
    global: &JSGlobalObject,
    view: JSValue,
    index: usize,
    value: &Value,
    wrapper: JSValue,
) {
    // SAFETY: `view` is the live view that `slot_of` found `index` in, and `wrapper` is the object behind `value`.
    unsafe { Bun__SharedView__remember(global, view, index, identity_of(value), wrapper) };
}

pub(crate) fn atomic_load(
    cx: &mut JsScope<'_>,
    target: JsLocal<'_>,
    key: JsLocal<'_>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let (block, index) = slot_of(global, target.to_js(), key.to_js())?;
    let value = block.load(index);
    let identity = identity_of(&value);
    let result = to_js_from_slot(global, target.to_js(), index, value)?;
    // A wrapper that was just made is cached too, as a plain read does.
    // SAFETY: as in `remember_slot`; `result` is the wrapper of the object at `identity`, or `identity` is null.
    unsafe { Bun__SharedView__remember(global, target.to_js(), index, identity, result) };
    Ok(result)
}

/// Returns `value`, as `Atomics.store` does.
pub(crate) fn atomic_store(
    cx: &mut JsScope<'_>,
    target: JsLocal<'_>,
    key: JsLocal<'_>,
    value: JsLocal<'_>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let (block, index) = slot_of(global, target.to_js(), key.to_js())?;
    let stored = to_shared(global, value.to_js())?;
    block.store(index, &stored);
    remember_slot(global, target.to_js(), index, &stored, value.to_js());
    Ok(value.to_js())
}

pub(crate) fn atomic_exchange(
    cx: &mut JsScope<'_>,
    target: JsLocal<'_>,
    key: JsLocal<'_>,
    value: JsLocal<'_>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let (block, index) = slot_of(global, target.to_js(), key.to_js())?;
    let stored = to_shared(global, value.to_js())?;
    let old = block.exchange(index, &stored);
    // The old value's wrapper comes from the cache before the cache takes the new one.
    let result = to_js_from_slot(global, target.to_js(), index, old)?;
    remember_slot(global, target.to_js(), index, &stored, value.to_js());
    Ok(result)
}

/// Returns the value the slot held, whether or not it was replaced. Only `replacement` has to be shareable: an `expected`
/// that is not can never equal what a slot holds, so it leaves the slot unchanged.
pub(crate) fn atomic_compare_exchange(
    cx: &mut JsScope<'_>,
    target: JsLocal<'_>,
    key: JsLocal<'_>,
    expected: JsLocal<'_>,
    replacement: JsLocal<'_>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let (block, index) = slot_of(global, target.to_js(), key.to_js())?;
    let expected = to_value(global, expected.to_js())?;
    let stored = to_shared(global, replacement.to_js())?;
    let old = match expected {
        Some(expected) => block.compare_exchange(index, &expected, &stored),
        None => block.load(index),
    };
    // The old value's wrapper comes from the cache before the cache takes the replacement.
    let result = to_js_from_slot(global, target.to_js(), index, old)?;
    let identity = identity_of(&stored);
    // The cache entry for an object is checked on every read, so recording the replacement is right whenever the slot holds it.
    if !identity.is_null() && identity_of(&block.load(index)) == identity {
        remember_slot(global, target.to_js(), index, &stored, replacement.to_js());
    }
    Ok(result)
}
