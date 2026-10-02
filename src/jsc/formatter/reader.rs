//! Every read the formatter makes on its own account, to find out what a value
//! is or what it holds.
//!
//! They run no user code, so they cannot throw, hang or change the value being
//! printed. The few that do run some return a `JsResult`, say what they run,
//! and bound how long it can go on. What the user asked to have called
//! (`[inspect.custom]`, `toJSON`) is not a read and does not belong here.
//!
//! A stored snapshot holds what an ordinary read gave the formatter that wrote
//! it. The reads that take `stored` make that read for the `snapshot` policy,
//! so that its text does not change. It keeps every bound.
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
    safe fn Bun__FormatterReads__collections(global: &JSGlobalObject) -> u32;
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

/// Changes with every garbage collection.
pub(super) fn collections(global: &JSGlobalObject) -> u32 {
    Bun__FormatterReads__collections(global)
}

/// What a chain of proxies stands for: its innermost target, or the first
/// revoked Proxy in it. However long, it costs no native stack and no trap runs.
pub(super) fn through_proxies(mut value: JSValue) -> JSValue {
    while value.is_cell()
        && value.js_type() == jsc::JSType::ProxyObject
        && value
            .get_proxy_internal_field(jsc::ProxyField::Handler)
            .is_cell()
    {
        value = value.get_proxy_internal_field(jsc::ProxyField::Target);
    }
    value
}

/// The text of a string, a `String` object or a RegExp.
pub(super) fn text(
    global: &JSGlobalObject,
    value: JSValue,
    js_type: jsc::JSType,
    stored: bool,
) -> JsResult<BunString> {
    use crate::StringJsc as _;
    if stored {
        return BunString::from_js(value, global);
    }
    if js_type == jsc::JSType::RegExpObject {
        return Ok(reg_exp_source(value));
    }
    BunString::from_js(boxed_primitive(value), global)
}

/// `object[name]` as the printers of a React element read it.
pub(super) fn field(
    global: &JSGlobalObject,
    object: JSValue,
    name: &'static str,
    stored: bool,
) -> JsResult<Option<JSValue>> {
    if stored {
        return object.get(global, name);
    }
    Ok(own_data(global, object, name))
}

/// `value.$$typeof`, which marks a React element.
pub(super) fn react_typeof(
    global: &JSGlobalObject,
    value: JSValue,
    stored: bool,
) -> JsResult<Option<JSValue>> {
    if stored {
        return value.get_own_truthy(global, "$$typeof");
    }
    Ok(own_data(global, value, "$$typeof"))
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
pub(crate) fn array_length(global: &JSGlobalObject, value: JSValue) -> u64 {
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
pub(crate) struct PresentIndexes {
    sparse: Option<Vec<u32>>,
    pos: usize,
}

impl PresentIndexes {
    /// The smallest index in `from..len` that `array` holds, or `len`.
    pub(crate) fn next(&mut self, array: JSValue, from: u32, len: u32) -> u32 {
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

/// Whether a stored snapshot prints `Map {}`: `value.size`, if it is a number.
pub(super) fn stored_collection_size(global: &JSGlobalObject, value: JSValue) -> JsResult<i32> {
    match value.get(global, "size")? {
        Some(size) if size.is_number() => size.coerce_to_i32(global),
        _ => Ok(0),
    }
}

/// A diff prints a longer run of array holes than this as one line. A hole
/// otherwise prints as a line of `undefined`, and an array can claim 2^32 - 1
/// of them and hold nothing.
pub(super) const MAX_EXPANDED_HOLE_RUN: u32 = 8;

/// The text of a snapshot is a file format, so it lists what the value claims:
/// every hole, and every entry a Map or a Set yields past its size. More of
/// either than this is an error.
pub(super) const MOST_A_SNAPSHOT_LISTS: u32 = 1 << 20;

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
    stored: bool,
) -> JsResult<Option<JSValue>> {
    if stored {
        return match field {
            EventField::Type => Ok(event.get(global, "type")?.filter(|kind| kind.is_string())),
            EventField::Message => event.fast_get(global, jsc::BuiltinName::Message),
            EventField::Data => event.fast_get(global, jsc::BuiltinName::Data),
            EventField::Error => event.fast_get(global, jsc::BuiltinName::Error),
        };
    }
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
/// its `GetterSetter` cell and does not run. A Proxy in the prototype chain runs
/// its traps, and a native property its C++ getter.
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

/// The elements an array holds, in order. Not its holes, of which it can claim
/// 2^32 - 1, not what a replaced iterator yields, and not what is pushed while
/// it is listed.
pub(crate) fn for_each_element(
    array: JSValue,
    global: &JSGlobalObject,
    mut visit: impl FnMut(u32, JSValue) -> JsResult<()>,
) -> JsResult<()> {
    let len = array_length(global, array).min(u64::from(u32::MAX)) as u32;
    let mut present = PresentIndexes::default();
    let mut index = present.next(array, 0, len);
    while index < len {
        let element = array.get_direct_index(global, index)?;
        if !element.is_empty() {
            visit(index, element)?;
        }
        index = present.next(array, index + 1, len);
    }
    Ok(())
}

/// Runs the iterator of an iterable the caller was handed to list
/// (`console.table`, `AggregateError.errors`). `Ok(true)` when it had more to
/// give than a typed array's length, or than `budget`.
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
