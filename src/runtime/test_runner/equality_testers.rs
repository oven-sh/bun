// Copyright (c) Meta Platforms, Inc. and affiliates. MIT license: packages/expect-utils/src/utils.ts of Jest 30.5.2.

//! `this.utils.iterableEquality` and `this.utils.subsetEquality`: Jest's two testers, with `this.equals()` for `equals()`.

use core::ffi::c_void;

use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{self as jsc, JSFunction, JSGlobalObject, JSMap, JSValue, JsResult};

use super::expect_core::expect_deferred::Pass;
use super::pretty_format::{call_method, item, member, member_by_value};
use super::{Expect, ExpectMatcherContext, ExpectMatcherUtils};
use crate::generated_bindgen::expect::{self as generated, js_ExpectMatcherUtils as js};

const IMMUTABLE_KEYED: &str = "@@__IMMUTABLE_KEYED__@@";
const IMMUTABLE_SET: &str = "@@__IMMUTABLE_SET__@@";
const IMMUTABLE_LIST: &str = "@@__IMMUTABLE_LIST__@@";
const IMMUTABLE_ORDERED: &str = "@@__IMMUTABLE_ORDERED__@@";
const IMMUTABLE_RECORD: &str = "@@__IMMUTABLE_RECORD__@@";

impl ExpectMatcherUtils {
    /// `iterableEquality(a, b, customTesters = [])`
    pub(crate) fn iterable_equality(
        cx: &mut JsScope<'_>,
        callee: JsLocal<'_>,
        a: JsLocal<'_>,
        b: JsLocal<'_>,
        custom_testers: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (callee, a, b) = (callee.to_js(), a.to_js(), b.to_js());
        let pass = (!Self::is_asked_by_deep_equality(global, callee)).then(Pass::barrier);
        let _entered = pass.as_ref().map(Pass::enter);
        if !are_iterables(global, a, b)? {
            return Ok(JSValue::UNDEFINED);
        }
        let stacks = [JSValue::create_empty_array(global, 0)?, JSValue::create_empty_array(global, 0)?];
        iterable_equality(global, callee, a, b, custom_testers.to_js(), stacks)
    }

    /// Jest's `iterableEqualityWithStack()`. `bind()` holds the three lists, and `iterableEquality` as `this`.
    pub(crate) fn iterable_equality_with_stack(
        cx: &mut JsScope<'_>,
        this_value: JsLocal<'_>,
        callee: JsLocal<'_>,
        testers: JsLocal<'_>,
        a_stack: JsLocal<'_>,
        b_stack: JsLocal<'_>,
        a: JsLocal<'_>,
        b: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (a, b) = (a.to_js(), b.to_js());
        let pass = (!Self::is_asked_by_deep_equality(global, callee.to_js())).then(Pass::barrier);
        let _entered = pass.as_ref().map(Pass::enter);
        // Most members are no iterables, and need no copy of the three.
        if !are_iterables(global, a, b)? {
            return Ok(JSValue::UNDEFINED);
        }
        let testers = copy(global, testers.to_js())?;
        let stacks = [copy(global, a_stack.to_js())?, copy(global, b_stack.to_js())?];
        iterable_equality(global, this_value.to_js(), a, b, testers, stacks)
    }

    /// `subsetEquality(object, subset, customTesters = [])`
    pub(crate) fn subset_equality(
        cx: &mut JsScope<'_>,
        callee: JsLocal<'_>,
        object: JsLocal<'_>,
        subset: JsLocal<'_>,
        custom_testers: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (callee, subset, custom_testers) = (callee.to_js(), subset.to_js(), custom_testers.to_js());
        let pass = (!Self::is_asked_by_deep_equality(global, callee)).then(Pass::barrier);
        let _entered = pass.as_ref().map(Pass::enter);
        // The reference calls `customTesters.filter()` before it looks at `subset`.
        if !custom_testers.is_undefined() && !custom_testers.is_array() {
            return Err(global.throw_invalid_argument_type_value("customTesters", "array", custom_testers));
        }
        if !is_object_with_keys(global, subset)? {
            return Ok(JSValue::UNDEFINED);
        }
        let testers = if custom_testers.is_undefined() {
            JSValue::create_empty_array(global, 0)?
        } else {
            without(global, custom_testers, callee)?
        };
        subset_equality(global, testers, JSMap::create(global), object.to_js(), subset)
    }

    /// Jest's `subsetEqualityWithContext(seenReferences)`. `bind()` holds the testers and the `Map` of `subset_equality()`.
    pub(crate) fn subset_equality_with_context(
        cx: &mut JsScope<'_>,
        callee: JsLocal<'_>,
        testers: JsLocal<'_>,
        seen: JsLocal<'_>,
        object: JsLocal<'_>,
        subset: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let subset = subset.to_js();
        let pass = (!Self::is_asked_by_deep_equality(global, callee.to_js())).then(Pass::barrier);
        let _entered = pass.as_ref().map(Pass::enter);
        if !is_object_with_keys(global, subset)? {
            return Ok(JSValue::UNDEFINED);
        }
        subset_equality(global, testers.to_js(), seen.to_js(), object.to_js(), subset)
    }

    /// Whether deep equality asks this tester now, as `callee` or as a function bound to it. Any other call is by a matcher or a tester of the user, and is a barrier like `this.equals()`.
    fn is_asked_by_deep_equality(global: &JSGlobalObject, callee: JSValue) -> bool {
        unsafe extern "C" {
            safe fn ExpectEqualityTesters__isBoundTo(function: JSValue, target: JSValue) -> bool;
        }
        let utils = Self::singleton(global);
        let is_asked = js::asked_tester_get_cached(utils)
            .is_some_and(|asked| asked == callee || ExpectEqualityTesters__isBoundTo(asked, callee));
        if is_asked {
            js::asked_tester_set_cached(utils, global, JSValue::ZERO);
        }
        is_asked
    }

    /// Whether the comparison that asked the running tester is `toStrictEqual()`'s.
    fn is_comparing_strictly(global: &JSGlobalObject) -> bool {
        Self::singleton(global).as_class_ref::<Self>().is_some_and(|utils| utils.is_comparing_strictly.get())
    }
}

/// `tester` is `this.utils.iterableEquality`, which the list for the members leaves out. The stacks hold the pairs of the calls further out.
fn iterable_equality(
    global: &JSGlobalObject,
    tester: JSValue,
    a: JSValue,
    b: JSValue,
    custom_testers: JSValue,
    [a_stack, b_stack]: [JSValue; 2],
) -> JsResult<JSValue> {
    let (a_constructor, b_constructor) = (member(global, a, "constructor")?, member(global, b, "constructor")?);
    if !a_constructor.is_strict_equal(b_constructor, global)? && !are_one_native_class(global, a_constructor, b_constructor)? {
        return Ok(JSValue::FALSE);
    }
    if let Some(is_same_cycle) = enter(global, a_stack, b_stack, a, b)? {
        return Ok(JSValue::js_boolean(is_same_cycle));
    }

    let custom_testers = list_or_new(global, custom_testers)?;
    let testers = without(global, custom_testers, tester)?;
    // Jest binds `testers`, and then compares a Set that is reached again until the stack runs out (vitest-dev/vitest#5535).
    testers.push(global, bind(global, with_stack_function(global), tester, &[custom_testers, a_stack, b_stack])?)?;
    // Jest's toStrictEqual() is strict through testers that stay in the list. Bun's is strict through the engine, so the members keep that.
    let is_strict = ExpectMatcherUtils::is_comparing_strictly(global);
    let equals = |a: JSValue, b: JSValue| ExpectMatcherContext::equals_with(global, a, b, testers, is_strict);

    let a_size = member(global, a, "size")?;
    if !a_size.is_undefined() {
        if !a_size.is_strict_equal(member(global, b, "size")?, global)? {
            return Ok(JSValue::FALSE);
        }
        // As in Jest, in Vitest and in `toEqual()`, one member of `b` can stand for two members of `a` (jestjs/jest#16546).
        let tag = collection_tag(global, a)?;
        if tag == CollectionTag::Set || is_unordered(global, a, IMMUTABLE_SET)? {
            let mut all_found = true;
            for_of(global, a, &mut |a_value| {
                if call_method(global, b, "has", &[a_value])?.to_boolean() {
                    return Ok(true);
                }
                let mut has = false;
                for_of(global, b, &mut |b_value| {
                    has |= equals(a_value, b_value)?;
                    Ok(true)
                })?;
                all_found = has;
                Ok(has)
            })?;
            leave(global, a_stack, b_stack)?;
            return Ok(JSValue::js_boolean(all_found));
        }
        if tag == CollectionTag::Map || is_unordered(global, a, IMMUTABLE_KEYED)? {
            let mut all_found = true;
            for_of(global, a, &mut |a_entry| {
                let (a_key, a_value) = (item(global, a_entry, 0)?, item(global, a_entry, 1)?);
                if call_method(global, b, "has", &[a_key])?.to_boolean()
                    && equals(a_value, call_method(global, b, "get", &[a_key])?)?
                {
                    return Ok(true);
                }
                let mut has = false;
                for_of(global, b, &mut |b_entry| {
                    has |= equals(a_key, item(global, b_entry, 0)?)? && equals(a_value, item(global, b_entry, 1)?)?;
                    Ok(true)
                })?;
                all_found = has;
                Ok(has)
            })?;
            leave(global, a_stack, b_stack)?;
            return Ok(JSValue::js_boolean(all_found));
        }
    }

    // These two can be read once, as a generator is: a matcher in a member can't wait for a promise and have its matcher run again.
    let pass = Pass::barrier();
    let _entered = pass.enter();

    // The reference steps both by hand, closes neither, and takes two that it can't open for no iterables.
    let a_iterator = try_open_iterator(global, a)?;
    let b_iterator = if a_iterator.is_some() { try_open_iterator(global, b)? } else { None };
    let (Some(a_iterator), Some(b_iterator)) = (a_iterator, b_iterator) else {
        leave(global, a_stack, b_stack)?;
        return Ok(JSValue::UNDEFINED);
    };
    let is_done = |step: JSValue| -> JsResult<bool> { Ok(member(global, step, "done")?.to_boolean()) };
    let mut a_step = call_method(global, a_iterator, "next", &[])?;
    while !is_done(a_step)? {
        let b_step = call_method(global, b_iterator, "next", &[])?;
        if is_done(b_step)? || !equals(member(global, a_step, "value")?, member(global, b_step, "value")?)? {
            return Ok(JSValue::FALSE);
        }
        a_step = call_method(global, a_iterator, "next", &[])?;
    }
    if !is_done(call_method(global, b_iterator, "next", &[])?)? {
        return Ok(JSValue::FALSE);
    }

    let has = |name: &'static str| -> JsResult<bool> { Ok(member(global, a, name)?.to_boolean()) };
    let compares_own_entries = !has(IMMUTABLE_LIST)?
        && !(has(IMMUTABLE_KEYED)? && has(IMMUTABLE_ORDERED)?)
        && !(has(IMMUTABLE_SET)? && has(IMMUTABLE_ORDERED)?)
        && !has(IMMUTABLE_RECORD)?;
    // The reference compares them without a tester.
    if compares_own_entries
        && !ExpectMatcherContext::equals_with(global, entries(global, a)?, entries(global, b)?, JSValue::UNDEFINED, is_strict)?
    {
        return Ok(JSValue::FALSE);
    }

    leave(global, a_stack, b_stack)?;
    Ok(JSValue::TRUE)
}

/// Two different constructors of one name are one class if both are native, as the `Map` of another realm is.
fn are_one_native_class(global: &JSGlobalObject, a: JSValue, b: JSValue) -> JsResult<bool> {
    if a.is_undefined_or_null() || b.is_undefined_or_null() {
        return Ok(false);
    }
    Ok(member(global, a, "name")?.is_strict_equal(member(global, b, "name")?, global)?
        && is_native_function(global, a)?
        && is_native_function(global, b)?)
}

/// `value[sentinel] && !value["@@__IMMUTABLE_ORDERED__@@"]`: a `Set` or a `Map` of Immutable.js that has no order.
fn is_unordered(global: &JSGlobalObject, value: JSValue, sentinel: &'static str) -> JsResult<bool> {
    Ok(member(global, value, sentinel)?.to_boolean() && !member(global, value, IMMUTABLE_ORDERED)?.to_boolean())
}

/// `testers` has no `this.utils.subsetEquality`. `seen` is Jest's `seenReferences`: a `Map` of the subsets of the calls further out.
fn subset_equality(
    global: &JSGlobalObject,
    testers: JSValue,
    seen: JSValue,
    object: JSValue,
    subset: JSValue,
) -> JsResult<JSValue> {
    let Some(mut seen_map) = JSMap::from_js(seen) else { return Ok(JSValue::UNDEFINED) };
    // SAFETY: `seen` is on the stack, and a `JSMap` is a handle of no bytes to its cell.
    let seen_map = unsafe { seen_map.as_mut() };
    if !seen_map.get(global, subset)?.is_undefined() {
        return Ok(JSValue::UNDEFINED);
    }
    seen_map.set(global, subset, JSValue::TRUE)?;
    let is_strict = ExpectMatcherUtils::is_comparing_strictly(global);

    let mut is_subset = true;
    let mut keys = own_keys(global, subset)?.array_iterator(global)?;
    while is_subset && let Some(key) = keys.next()? {
        let expected = member_by_value(global, subset, key)?;
        // A subset that holds itself: the rest is compared without this tester.
        if is_object_with_keys(global, expected)? && !seen_map.get(global, expected)?.is_undefined() {
            let received = member_by_value(global, object, key)?;
            is_subset = ExpectMatcherContext::equals_with(global, received, expected, testers, is_strict)?;
            continue;
        }
        is_subset = !object.is_undefined_or_null() && has_property_in_object(global, object, key)? && {
            let handed_on = copy(global, testers)?;
            handed_on.push(global, bind(global, with_context_function(global), JSValue::UNDEFINED, &[testers, seen])?)?;
            ExpectMatcherContext::equals_with(global, member_by_value(global, object, key)?, expected, handed_on, is_strict)?
        };
        seen_map.remove(global, expected)?;
    }
    seen_map.remove(global, subset)?;
    Ok(JSValue::js_boolean(is_subset))
}

/// The default of `customTesters`, `[]`, or the array it was given. Jest's `filter()` call throws a `TypeError` for anything else too.
fn list_or_new(global: &JSGlobalObject, custom_testers: JSValue) -> JsResult<JSValue> {
    if custom_testers.is_undefined() {
        return JSValue::create_empty_array(global, 0);
    }
    if !custom_testers.is_array() {
        return Err(global.throw_invalid_argument_type_value("customTesters", "array", custom_testers));
    }
    Ok(custom_testers)
}

fn with_stack_function(global: &JSGlobalObject) -> JSValue {
    let utils = ExpectMatcherUtils::singleton(global);
    js::iterable_equality_with_stack_get_cached(utils).unwrap_or_else(|| {
        let host_function = generated::Bun__ExpectMatcherUtils__iterableEqualityWithStack;
        let function = JSFunction::create(global, "iterableEqualityWithStack", host_function, 5, Default::default());
        js::iterable_equality_with_stack_set_cached(utils, global, function);
        function
    })
}

fn with_context_function(global: &JSGlobalObject) -> JSValue {
    let utils = ExpectMatcherUtils::singleton(global);
    js::subset_equality_with_context_get_cached(utils).unwrap_or_else(|| {
        let host_function = generated::Bun__ExpectMatcherUtils__subsetEqualityWithContext;
        let function = JSFunction::create(global, "subsetEqualityWithContext", host_function, 4, Default::default());
        js::subset_equality_with_context_set_cached(utils, global, function);
        function
    })
}

fn are_iterables(global: &JSGlobalObject, a: JSValue, b: JSValue) -> JsResult<bool> {
    unsafe extern "C" {
        safe fn ExpectEqualityTesters__areIterables(global: &JSGlobalObject, a: JSValue, b: JSValue) -> bool;
    }
    jsc::host_fn::from_js_host_call_generic(global, || ExpectEqualityTesters__areIterables(global, a, b))
}

fn is_native_function(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    unsafe extern "C" {
        safe fn ExpectEqualityTesters__isNativeFunction(global: &JSGlobalObject, value: JSValue) -> bool;
    }
    jsc::host_fn::from_js_host_call_generic(global, || ExpectEqualityTesters__isNativeFunction(global, value))
}

/// `None` if no call further out compares `a`, and the pair is now on the stacks. Else whether that call compares it with `b`.
fn enter(global: &JSGlobalObject, a_stack: JSValue, b_stack: JSValue, a: JSValue, b: JSValue) -> JsResult<Option<bool>> {
    unsafe extern "C" {
        safe fn ExpectEqualityTesters__enter(global: &JSGlobalObject, a_stack: JSValue, b_stack: JSValue, a: JSValue, b: JSValue) -> i8;
    }
    let found = jsc::host_fn::from_js_host_call_generic(global, || ExpectEqualityTesters__enter(global, a_stack, b_stack, a, b))?;
    Ok((found >= 0).then_some(found == 1))
}

/// Takes the pair off the stacks. Like Jest, an answer of false because a size, an item or an own property differs leaves it on.
fn leave(global: &JSGlobalObject, a_stack: JSValue, b_stack: JSValue) -> JsResult<()> {
    unsafe extern "C" {
        safe fn ExpectEqualityTesters__leave(global: &JSGlobalObject, a_stack: JSValue, b_stack: JSValue);
    }
    jsc::host_fn::from_js_host_call_generic(global, || ExpectEqualityTesters__leave(global, a_stack, b_stack))
}

unsafe extern "C" {
    /// An empty `without` leaves nothing out.
    safe fn ExpectEqualityTesters__copy(global: &JSGlobalObject, list: JSValue, without: JSValue) -> JSValue;
}

/// `[...list]`
fn copy(global: &JSGlobalObject, list: JSValue) -> JsResult<JSValue> {
    jsc::host_fn::from_js_host_call(global, || ExpectEqualityTesters__copy(global, list, JSValue::ZERO))
}

/// `list.filter(item => item !== tester)`
fn without(global: &JSGlobalObject, list: JSValue, tester: JSValue) -> JsResult<JSValue> {
    jsc::host_fn::from_js_host_call(global, || ExpectEqualityTesters__copy(global, list, tester))
}

/// A function of two parameters that calls `target` with `this` and with `bound` ahead of its arguments.
fn bind(global: &JSGlobalObject, target: JSValue, this: JSValue, bound: &[JSValue]) -> JsResult<JSValue> {
    unsafe extern "C" {
        fn ExpectEqualityTesters__bind(global: &JSGlobalObject, target: JSValue, this: JSValue, bound: *const JSValue, count: usize) -> JSValue;
    }
    // SAFETY: `bound` outlives the call, which copies it.
    jsc::host_fn::from_js_host_call(global, || unsafe { ExpectEqualityTesters__bind(global, target, this, bound.as_ptr(), bound.len()) })
}

/// What `Object.prototype.toString()` names a value.
#[derive(Copy, Clone, PartialEq, Eq)]
enum CollectionTag {
    Neither,
    Set,
    Map,
}

fn collection_tag(global: &JSGlobalObject, value: JSValue) -> JsResult<CollectionTag> {
    unsafe extern "C" {
        safe fn ExpectEqualityTesters__collectionTag(global: &JSGlobalObject, value: JSValue) -> u8;
    }
    Ok(match jsc::host_fn::from_js_host_call_generic(global, || ExpectEqualityTesters__collectionTag(global, value))? {
        1 => CollectionTag::Set,
        2 => CollectionTag::Map,
        _ => CollectionTag::Neither,
    })
}

/// `for (const value of iterable)`: `each` answers whether the loop goes on, and an early stop or a throw closes the iterator.
fn for_of(global: &JSGlobalObject, iterable: JSValue, each: &mut dyn FnMut(JSValue) -> JsResult<bool>) -> JsResult<()> {
    type Each<'a> = &'a mut dyn FnMut(JSValue) -> JsResult<bool>;
    unsafe extern "C" {
        safe fn ExpectEqualityTesters__forOf(
            global: &JSGlobalObject,
            iterable: JSValue,
            each: *mut c_void,
            call: extern "C" fn(*mut c_void, JSValue) -> bool,
        );
    }
    extern "C" fn call(each: *mut c_void, value: JSValue) -> bool {
        // SAFETY: `each` is the `Each` below, which outlives the loop.
        matches!((unsafe { &mut *each.cast::<Each<'_>>() })(value), Ok(true))
    }
    let mut each: Each<'_> = each;
    jsc::host_fn::from_js_host_call_generic(global, || {
        ExpectEqualityTesters__forOf(global, iterable, (&raw mut each).cast::<c_void>(), call)
    })
}

/// `value[Symbol.iterator]()`, or `None` where the `catch` of the reference takes what that throws.
fn try_open_iterator(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<JSValue>> {
    unsafe extern "C" {
        safe fn ExpectEqualityTesters__tryOpenIterator(global: &JSGlobalObject, value: JSValue) -> JSValue;
    }
    let iterator = jsc::host_fn::from_js_host_call_generic(global, || ExpectEqualityTesters__tryOpenIterator(global, value))?;
    Ok((!iterator.is_empty()).then_some(iterator))
}

/// The reference's `entries()`: every own symbol but `Symbol.iterator` with its value, then `Object.entries(object)`.
fn entries(global: &JSGlobalObject, object: JSValue) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn ExpectEqualityTesters__entries(global: &JSGlobalObject, object: JSValue) -> JSValue;
    }
    jsc::host_fn::from_js_host_call(global, || ExpectEqualityTesters__entries(global, object))
}

/// The reference's `getObjectKeys()`: `Object.keys(object)`, then the enumerable own symbols.
fn own_keys(global: &JSGlobalObject, object: JSValue) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn ExpectEqualityTesters__keys(global: &JSGlobalObject, object: JSValue) -> JSValue;
    }
    jsc::host_fn::from_js_host_call(global, || ExpectEqualityTesters__keys(global, object))
}

fn is_object_with_keys(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    unsafe extern "C" {
        safe fn ExpectEqualityTesters__isObjectWithKeys(global: &JSGlobalObject, value: JSValue) -> bool;
    }
    let is_object = jsc::host_fn::from_js_host_call_generic(global, || ExpectEqualityTesters__isObjectWithKeys(global, value))?;
    // Jest's matchers are objects with keys. Bun's have none, and `this.equals()` asks them before any tester.
    Ok(is_object && !Expect::is_asymmetric_matcher(value))
}

fn has_property_in_object(global: &JSGlobalObject, object: JSValue, key: JSValue) -> JsResult<bool> {
    unsafe extern "C" {
        safe fn ExpectEqualityTesters__hasPropertyInObject(global: &JSGlobalObject, object: JSValue, key: JSValue) -> bool;
    }
    jsc::host_fn::from_js_host_call_generic(global, || ExpectEqualityTesters__hasPropertyInObject(global, object, key))
}
