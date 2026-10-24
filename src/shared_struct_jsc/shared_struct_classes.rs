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
            String::from_utf8_lossy(digits.to_utf8().slice()).as_ref(),
        ))
    } else if let Some(block) = block_of(value) {
        Value::Struct(block)
    } else if let Some(mutex) = value.as_class_ref::<MutexObject>() {
        Value::Mutex(mutex.inner.clone())
    } else if let Some(condition) = value.as_class_ref::<ConditionObject>() {
        Value::Condition(condition.inner.clone())
    } else {
        unreachable!("is_shareable")
    }))
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

fn to_js(global: &JSGlobalObject, value: Value) -> JsResult<JSValue> {
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

/// # Safety
/// `block` is live, `index` is below its length, and `global` is live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__SharedBlock__load(
    block: *const c_void,
    index: usize,
    global: *mut JSGlobalObject,
) -> JSValue {
    // SAFETY: forwarded.
    let (block, global) = unsafe { (block_ref(block), &*global) };
    // A plain `obj.field` read is unordered.
    to_js_host_call(global, || to_js(global, block.load_relaxed(index)))
}

/// # Safety
/// As [`Bun__SharedBlock__load`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__SharedBlock__store(
    block: *const c_void,
    index: usize,
    global: *mut JSGlobalObject,
    value: JSValue,
) -> bool {
    // SAFETY: forwarded.
    let (block, global) = unsafe { (block_ref(block), &*global) };
    match to_shared(global, value) {
        Ok(value) => {
            // A plain `obj.field = value` write is unordered.
            block.store_relaxed(index, &value);
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
            (n.fract() == 0.0 && n >= 0.0 && n < block.len() as f64).then(|| n as usize)
        }
    };
    match index {
        Some(index) => Ok((block, index)),
        None => Err(global.throw_invalid_arguments(format_args!("Invalid atomic access index"))),
    }
}

pub(crate) fn atomic_load(
    cx: &mut JsScope<'_>,
    target: JsLocal<'_>,
    key: JsLocal<'_>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let (block, index) = slot_of(global, target.to_js(), key.to_js())?;
    to_js(global, block.load(index))
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
    block.store(index, &to_shared(global, value.to_js())?);
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
    to_js(
        global,
        block.exchange(index, &to_shared(global, value.to_js())?),
    )
}

/// Returns the value the slot held, whether or not it was replaced.
pub(crate) fn atomic_compare_exchange(
    cx: &mut JsScope<'_>,
    target: JsLocal<'_>,
    key: JsLocal<'_>,
    expected: JsLocal<'_>,
    replacement: JsLocal<'_>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let (block, index) = slot_of(global, target.to_js(), key.to_js())?;
    let expected = to_shared(global, expected.to_js())?;
    let replacement = to_shared(global, replacement.to_js())?;
    to_js(
        global,
        block.compare_exchange(index, &expected, &replacement),
    )
}
