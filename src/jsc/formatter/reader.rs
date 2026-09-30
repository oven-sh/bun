//! Every read the formatter makes on its own account, to find out what a value
//! is or what it holds.
//!
//! They run no user code, so they cannot throw, hang or change the value being
//! printed. The few that do run some return a `JsResult`, say what they run,
//! and bound how long it can go on. What the user asked to have called
//! (`[inspect.custom]`, `toJSON`) is not a read and does not belong here.
//! `test/internal/source-lints/formatter-reads.test.ts` keeps observable reads
//! out of the printers.

use super::*;

pub(crate) type EntryCallback = extern "C" fn(ctx: *mut c_void, key: JSValue, value: JSValue);

pub(super) type PropertyCallback = extern "C" fn(
    global: &JSGlobalObject,
    ctx: *mut c_void,
    key: *mut EncodedSlice,
    value: JSValue,
    is_symbol: bool,
    is_private_symbol: bool,
);

/// How to list the properties of an object. Mirrors `PropertyWalk` in
/// `bindings.cpp`.
#[repr(u8)]
#[derive(Copy, Clone)]
pub(super) enum PropertyWalk {
    /// Own properties, then those of up to five prototypes.
    Chain,
    /// Own properties, without the indexes and `length` of an array.
    OwnNonIndexed,
    /// Own properties, sorted by key.
    OwnSorted,
}

unsafe extern "C" {
    safe fn Bun__FormatterReads__ownData(
        value: JSValue,
        global: &JSGlobalObject,
        name: &BunString,
    ) -> JSValue;
    safe fn Bun__FormatterReads__boxedPrimitive(value: JSValue) -> JSValue;
    safe fn Bun__FormatterReads__regExpSource(value: JSValue) -> BunString;
    safe fn Bun__FormatterReads__arrayLength(value: JSValue, global: &JSGlobalObject) -> u64;
    safe fn Bun__FormatterReads__collectionSize(value: JSValue, global: &JSGlobalObject) -> i32;
    safe fn Bun__FormatterReads__eventField(
        value: JSValue,
        global: &JSGlobalObject,
        field: EventField,
    ) -> JSValue;
    // safe: `ctx` is an opaque round-trip pointer that C++ only hands to `callback`.
    safe fn Bun__FormatterReads__forEachEntry(
        value: JSValue,
        global: &JSGlobalObject,
        size: i32,
        ctx: *mut c_void,
        callback: EntryCallback,
    ) -> bool;
    safe fn Bun__FormatterReads__forEachProperty(
        value: JSValue,
        global: &JSGlobalObject,
        walk: PropertyWalk,
        ctx: *mut c_void,
        callback: PropertyCallback,
    );
    safe fn Bun__FormatterReads__forEachLimited(
        iterable: JSValue,
        global: &JSGlobalObject,
        budget: u32,
        ctx: *mut c_void,
        callback: jsc::ForEachCallback,
    ) -> bool;
}

/// An own data property. `None` for an accessor, `undefined`, a Proxy or a
/// module namespace export.
pub(super) fn own_data(
    global: &JSGlobalObject,
    object: JSValue,
    name: &'static str,
) -> Option<JSValue> {
    let value = Bun__FormatterReads__ownData(object, global, &BunString::static_(name));
    (!value.is_empty() && !value.is_undefined()).then_some(value)
}

/// The primitive inside a `Number`, `String`, `Boolean`, `Symbol` or `BigInt`
/// object.
pub(super) fn boxed_primitive(value: JSValue) -> JSValue {
    Bun__FormatterReads__boxedPrimitive(value)
}

/// `/source/flags`.
pub(super) fn reg_exp_source(value: JSValue) -> BunString {
    Bun__FormatterReads__regExpSource(value)
}

/// The length of an array, or the own `length` of an `arguments` object. When
/// that is gone, an accessor or not a number: one past the last index that is
/// present.
pub(super) fn array_length(global: &JSGlobalObject, value: JSValue) -> u64 {
    Bun__FormatterReads__arrayLength(value, global)
}

/// Steps through the indexes an array or an `arguments` object holds, in time
/// linear in what it holds, whatever length it claims.
///
/// The indexes of the sparse map are copied and sorted once, when the walk
/// first goes past the vector. Printing an element can run user code that
/// changes the array. The copy then goes stale: an index stored later counts as
/// a hole, and one deleted later is still reported.
#[derive(Default)]
pub(super) struct PresentIndexes {
    sparse: Option<Vec<u32>>,
    pos: usize,
}

impl PresentIndexes {
    /// The smallest index in `from..len` that `array` holds, or `len`.
    pub(super) fn next(&mut self, array: JSValue, from: u32, len: u32) -> u32 {
        unsafe extern "C" {
            safe fn Bun__JSObject__nextPresentVectorIndex(this: JSValue, start: u32) -> u64;
        }
        if self.sparse.is_none() {
            match Bun__JSObject__nextPresentVectorIndex(array, from) {
                u64::MAX => self.sparse = Some(sorted_sparse_indexes(array, from, len)),
                index => return (index as u32).min(len),
            }
        }
        let Some(sparse) = &self.sparse else {
            return len;
        };
        while sparse.get(self.pos).is_some_and(|&index| index < from) {
            self.pos += 1;
        }
        sparse.get(self.pos).copied().unwrap_or(len)
    }
}

fn sorted_sparse_indexes(array: JSValue, start: u32, end: u32) -> Vec<u32> {
    use bun_core::UnwrapOrOom as _;
    unsafe extern "C" {
        fn Bun__JSObject__copySortedSparseIndexes(
            this: JSValue,
            start: u32,
            end: u32,
            out: *mut u32,
            capacity: u32,
        ) -> u32;
    }
    let mut out: Vec<u32> = Vec::new();
    loop {
        let capacity = u32::try_from(out.capacity()).unwrap_or(u32::MAX);
        // SAFETY: `out` has room for `capacity` u32s and C++ writes at most that many.
        let count = unsafe {
            Bun__JSObject__copySortedSparseIndexes(array, start, end, out.as_mut_ptr(), capacity)
        };
        if count <= capacity {
            // SAFETY: C++ initialized the first `count <= capacity` elements.
            unsafe { out.set_len(count as usize) };
            return out;
        }
        out.try_reserve_exact(count as usize).unwrap_or_oom();
    }
}

/// The entry count of a `Map` or a `Set`. 0 for a `WeakMap` or a `WeakSet`,
/// which cannot be listed.
///
/// A subclass reports its own `size`, which runs its getter: `quick-lru`
/// extends `Map` and keeps its entries elsewhere.
pub(crate) fn collection_size(global: &JSGlobalObject, value: JSValue) -> JsResult<i32> {
    jsc::host_fn::from_js_host_call_generic(global, || {
        Bun__FormatterReads__collectionSize(value, global)
    })
}

#[repr(u8)]
#[derive(Copy, Clone)]
pub(super) enum EventField {
    Type,
    Message,
    Data,
    Error,
}

/// A field of the native event, whatever a subclass put in front of the
/// prototype's getter. `None` when this kind of event has no such field.
pub(super) fn event_field(
    global: &JSGlobalObject,
    event: JSValue,
    field: EventField,
) -> JsResult<Option<JSValue>> {
    let value = jsc::host_fn::from_js_host_call_generic(global, || {
        Bun__FormatterReads__eventField(event, global, field)
    })?;
    Ok((!value.is_empty()).then_some(value))
}

/// Calls back with every `(key, value)` of a `Map`, every `(element, empty)`
/// of a `Set`, and every `(item, empty)` a `Map` or `Set` iterator has left to
/// give. The iterator does not advance. Stops once `callback` leaves an
/// exception pending.
///
/// A subclass, or a collection whose iterator was replaced, is listed by that
/// iterator. Printing an entry can add another, so every listing ends after
/// `size` entries, from [`collection_size`] (an iterator: after as many as
/// its collection holds). `Ok(true)` when there were more.
pub(crate) fn for_each_entry(
    value: JSValue,
    global: &JSGlobalObject,
    size: i32,
    ctx: *mut c_void,
    callback: EntryCallback,
) -> JsResult<bool> {
    jsc::host_fn::from_js_host_call_generic(global, || {
        Bun__FormatterReads__forEachEntry(value, global, size, ctx, callback)
    })
}

/// Calls back with every property the formatter lists. An accessor arrives as
/// its `GetterSetter` cell and does not run. Every walk hides the same keys and
/// turns a property into a value the same way.
///
/// Inlined, so that a level of nesting does not pay for a closure frame.
#[inline(always)]
pub(super) fn for_each_property(
    value: JSValue,
    global: &JSGlobalObject,
    walk: PropertyWalk,
    ctx: *mut c_void,
    callback: PropertyCallback,
) -> JsResult<()> {
    crate::top_scope!(scope, global);
    Bun__FormatterReads__forEachProperty(value, global, walk, ctx, callback);
    scope.return_if_exception()
}

/// The steps given to an iterable only its own iterator can list, such as a
/// generator. It can be endless.
pub(crate) const UNSIZED_ITERABLE_BUDGET: u32 = 1000;

/// Runs the iterator of an iterable the caller was handed to list
/// (`console.table`, `AggregateError.errors`). `Ok(true)` when it had more to
/// give than its length, or than `budget` when it has none.
pub(crate) fn for_each_limited(
    iterable: JSValue,
    global: &JSGlobalObject,
    budget: u32,
    ctx: *mut c_void,
    callback: jsc::ForEachCallback,
) -> JsResult<bool> {
    jsc::host_fn::from_js_host_call_generic(global, || {
        Bun__FormatterReads__forEachLimited(iterable, global, budget, ctx, callback)
    })
}
