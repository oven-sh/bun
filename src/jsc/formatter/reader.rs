//! Every read the formatter makes on its own account, to find out what a value
//! is or what it holds.
//!
//! None of them runs user code, so none of them can throw, hang or change the
//! value being printed. The rule is `util.inspect`'s: what it does not run, the
//! formatter does not run. What the user asked to have called
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
    safe fn Bun__FormatterReads__collectionSize(value: JSValue) -> u32;
    safe fn Bun__FormatterReads__eventField(
        value: JSValue,
        global: &JSGlobalObject,
        field: EventField,
    ) -> JSValue;
    // safe: `ctx` is an opaque round-trip pointer that C++ only hands to `callback`.
    safe fn Bun__FormatterReads__forEachEntry(
        value: JSValue,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: EntryCallback,
    );
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

/// The length of an array, or the own `length` of an `arguments` object. 0
/// when that is gone or is not a number.
pub(super) fn array_length(global: &JSGlobalObject, value: JSValue) -> u64 {
    Bun__FormatterReads__arrayLength(value, global)
}

/// The entry count of a `Map` or a `Set`. 0 for a `WeakMap` or a `WeakSet`,
/// which cannot be listed.
pub(super) fn collection_size(value: JSValue) -> u32 {
    Bun__FormatterReads__collectionSize(value)
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
pub(crate) fn for_each_entry(
    value: JSValue,
    global: &JSGlobalObject,
    ctx: *mut c_void,
    callback: EntryCallback,
) -> JsResult<()> {
    jsc::host_fn::from_js_host_call_generic(global, || {
        Bun__FormatterReads__forEachEntry(value, global, ctx, callback)
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

/// The one read that does run user code, for the callers that were handed an
/// iterable to list (`console.table`, `AggregateError.errors`). `Ok(true)`
/// when the iterable had more to give than `budget`.
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
