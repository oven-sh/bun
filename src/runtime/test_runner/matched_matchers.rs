//! The asymmetric matchers that passed in one `toMatchObject` or snapshot
//! property-matcher walk.
//!
//! A passing matcher is printed in place of the property it was checked
//! against: `"id": Any<Number>` in a snapshot, and a common line in a failure
//! diff. The walk records where each one passed and the formatter reads the
//! record. Neither operand is written to. The C++ half is
//! `src/jsc/bindings/JestMatchedMatchers.cpp`.

use bun_jsc::{JSGlobalObject, JSValue, JsResult};

/// Every object with a property that a matcher passed on, or empty when no
/// matcher passed. Keep it on the stack: that is what roots it.
#[derive(Copy, Clone, Default)]
pub(crate) struct MatchedMatchers(JSValue);

impl MatchedMatchers {
    /// `received.jest_deep_match(subset, global)` that also records the
    /// matchers that pass before the walk returns.
    pub(crate) fn deep_match(
        received: JSValue,
        subset: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<(bool, MatchedMatchers)> {
        let mut matched_matchers = JSValue::ZERO;
        // SAFETY: `matched_matchers` is a live out-param for the whole call.
        let matched = unsafe {
            bun_jsc::cpp::Bun__JestMatchedMatchers__deepMatch(
                received,
                subset,
                global,
                &raw mut matched_matchers,
            )
        }?;
        Ok((matched, MatchedMatchers(matched_matchers)))
    }

    #[inline]
    pub(crate) fn is_empty(self) -> bool {
        self.0.is_empty()
    }

    /// The matchers recorded for the properties of `object`.
    #[inline]
    pub(crate) fn of(self, global: &JSGlobalObject, object: JSValue) -> Recorded {
        if self.0.is_empty() || !object.is_object() {
            return Recorded::default();
        }
        Recorded(bun_jsc::cpp::Bun__JestMatchedMatchers__of(global, self.0, object))
    }

    /// `value.json_stringify(global, indent)` in which a recorded property is
    /// serialized as its matcher. Must not be called on an empty record.
    pub(crate) fn json_stringify(
        self,
        value: JSValue,
        global: &JSGlobalObject,
        indent: u32,
    ) -> JsResult<bun_core::String> {
        debug_assert!(!self.0.is_empty());
        let mut out = bun_core::String::EMPTY;
        // SAFETY: `out` is a live out-param for the whole call.
        unsafe {
            bun_jsc::cpp::Bun__JestMatchedMatchers__jsonStringify(
                value,
                global,
                indent,
                self.0,
                &raw mut out,
            )
        }?;
        Ok(out)
    }
}

/// The matchers of one object, by property. The formatter asks it before
/// each read of a property of the object that it prints.
#[derive(Copy, Clone, Default)]
pub(crate) struct Recorded(JSValue);

impl Recorded {
    #[inline]
    pub(crate) fn is_empty(self) -> bool {
        self.0.is_empty()
    }

    /// The argument of `JSValue::for_each_property_ordered_with_matchers`.
    #[inline]
    pub(crate) fn as_js(self) -> JSValue {
        self.0
    }

    pub(crate) fn get_string(
        self,
        global: &JSGlobalObject,
        property: &bun_core::String,
    ) -> Option<JSValue> {
        if self.0.is_empty() {
            return None;
        }
        // SAFETY: `global` and `property` are live for the whole call, and C++
        // only reads `property`.
        let matcher = unsafe {
            bun_jsc::cpp::Bun__JestMatchedMatchers__get(
                core::ptr::from_ref(global).cast_mut(),
                self.0,
                core::ptr::from_ref(property),
            )
        };
        (!matcher.is_empty()).then_some(matcher)
    }

    #[inline]
    pub(crate) fn get(self, global: &JSGlobalObject, property: &'static str) -> Option<JSValue> {
        if self.0.is_empty() {
            return None;
        }
        self.get_string(global, &bun_core::String::static_(property))
    }

    #[inline]
    pub(crate) fn index(self, global: &JSGlobalObject, index: u32) -> Option<JSValue> {
        if self.0.is_empty() {
            return None;
        }
        let matcher = bun_jsc::cpp::Bun__JestMatchedMatchers__getIndex(global, self.0, index);
        (!matcher.is_empty()).then_some(matcher)
    }

    /// The matcher recorded for `property`, or what `read` returns.
    #[inline]
    pub(crate) fn get_or(
        self,
        global: &JSGlobalObject,
        property: &'static str,
        read: impl FnOnce() -> JsResult<Option<JSValue>>,
    ) -> JsResult<Option<JSValue>> {
        match self.get(global, property) {
            Some(matcher) => Ok(Some(matcher)),
            None => read(),
        }
    }

    /// The matcher recorded for `index`, or what `read` returns.
    #[inline]
    pub(crate) fn index_or(
        self,
        global: &JSGlobalObject,
        index: u32,
        read: impl FnOnce() -> JsResult<JSValue>,
    ) -> JsResult<JSValue> {
        match self.index(global, index) {
            Some(matcher) => Ok(matcher),
            None => read(),
        }
    }
}
