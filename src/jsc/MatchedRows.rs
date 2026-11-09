//! What a `bun:test` printer shows in place of the properties that matched an asymmetric matcher. The C++ half is `bindings/JestMatchedRows.cpp`.

use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult};

/// The rows of one `JSValue::jest_deep_match` call, or none. It is a GC cell that only the stack roots: keep it in locals, arguments and a formatter's field.
#[repr(transparent)]
#[derive(Clone, Copy, Default)]
pub struct MatchedRows(JSValue);

impl MatchedRows {
    #[inline]
    fn is_empty(self) -> bool {
        self.0.is_empty()
    }
}

/// Names a place inside one rows cell. C++ numbers them: 0 is no place and 1 is the object that was matched.
#[repr(transparent)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct PlaceHandle(u32);

impl PlaceHandle {
    const NONE: Self = Self(0);
    const ROOT: Self = Self(1);
}

/// `ForEachPropertyCallback` plus the place of `value`, which is none unless `value` was compared with a pattern that leads to a matcher.
pub(crate) type ForEachMatchedRowCallback = extern "C" fn(
    global: &JSGlobalObject,
    ctx: *mut c_void,
    key: &bun_core::EncodedSlice,
    value: JSValue,
    is_symbol: bool,
    is_private_symbol: bool,
    child: PlaceHandle,
);

/// An object together with the pattern it was compared with, if that pattern leads to a matcher that passed. Otherwise none.
#[derive(Clone, Copy, Default)]
pub struct MatchedPlace {
    rows: MatchedRows,
    handle: PlaceHandle,
}

impl MatchedPlace {
    #[inline]
    pub fn is_none(self) -> bool {
        self.handle == PlaceHandle::NONE
    }

    /// The pattern of the pair.
    pub fn pattern(self) -> Option<JSValue> {
        if self.is_none() {
            return None;
        }
        Some(Bun__JestMatchedRows__pattern(self.rows, self.handle))
    }

    /// What to print for property `name` in place of reading it: the matcher it matched, or the value that the comparison read, and the place of that value.
    #[inline]
    pub fn row(self, name: &'static str) -> Option<(JSValue, MatchedPlace)> {
        if self.is_none() {
            return None;
        }
        self.row_named(&bun_core::String::static_(name))
    }

    /// [`Self::row`] for a name that is not a literal.
    pub fn row_named(self, name: &bun_core::String) -> Option<(JSValue, MatchedPlace)> {
        if self.is_none() {
            return None;
        }
        let mut child = PlaceHandle::NONE;
        let value = Bun__JestMatchedRows__get(self.rows, self.handle, name, &mut child);
        self.row_of(value, child)
    }

    /// [`Self::row`], or what `read` returns for a property that has no row.
    #[inline]
    pub fn row_or(
        self,
        name: &'static str,
        read: impl FnOnce() -> JsResult<Option<JSValue>>,
    ) -> JsResult<(Option<JSValue>, MatchedPlace)> {
        match self.row(name) {
            Some((value, place)) => Ok((Some(value), place)),
            None => Ok((read()?, MatchedPlace::default())),
        }
    }

    /// [`Self::row`] for the element at `index` of an array.
    #[inline]
    pub fn element(self, index: u32) -> Option<(JSValue, MatchedPlace)> {
        if self.is_none() {
            return None;
        }
        let mut child = PlaceHandle::NONE;
        let value = Bun__JestMatchedRows__getIndex(self.rows, self.handle, index, &mut child);
        self.row_of(value, child)
    }

    fn row_of(self, value: JSValue, child: PlaceHandle) -> Option<(JSValue, MatchedPlace)> {
        let place = MatchedPlace {
            rows: self.rows,
            handle: child,
        };
        (!value.is_empty()).then_some((value, place))
    }

    /// What `set_merged` stored for this place.
    pub fn merged(self) -> Option<JSValue> {
        if self.is_none() {
            return None;
        }
        let merged = Bun__JestMatchedRows__merged(self.rows, self.handle);
        (!merged.is_empty()).then_some(merged)
    }

    /// Keeps the object that snapshot serializers are offered for this place, so it is built once.
    pub fn set_merged(self, merged: JSValue) {
        if !self.is_none() {
            Bun__JestMatchedRows__setMerged(self.rows, self.handle, merged);
        }
    }

    /// `JSValue::for_each_property_ordered_calling_getters` on `object`, the object of the pair. A row is passed in place of its property, which is not read.
    #[inline(always)]
    pub fn for_each_property_ordered_calling_getters(
        self,
        object: JSValue,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachMatchedRowCallback,
    ) -> JsResult<bool> {
        debug_assert!(!self.is_none());
        crate::top_scope!(scope, global);
        let is_same = Bun__JestMatchedRows__forEachPropertyOrderedCallingGetters(
            object,
            global,
            ctx,
            callback,
            self.rows,
            self.handle,
        );
        scope.return_if_exception().map(|()| is_same)
    }

    /// `JSValue::for_each_property_ordered_with_non_enumerable` on `object`, with rows in place of properties.
    #[inline(always)]
    pub fn for_each_property_ordered_with_non_enumerable(
        self,
        object: JSValue,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachMatchedRowCallback,
    ) -> JsResult<()> {
        debug_assert!(!self.is_none());
        crate::top_scope!(scope, global);
        Bun__JestMatchedRows__forEachPropertyOrderedWithNonEnumerable(
            object,
            global,
            ctx,
            callback,
            self.rows,
            self.handle,
        );
        scope.return_if_exception()
    }
}

/// Which place a printer is at: the place of the value it prints, and the place it handed to the value it prints next.
#[derive(Clone, Copy, Default)]
pub struct MatchedPlaceScope {
    rows: MatchedRows,
    current: PlaceHandle,
    next: PlaceHandle,
}

impl MatchedPlaceScope {
    /// For a printer whose first value is the object that `rows` was matched on.
    pub fn at_root(rows: MatchedRows) -> Self {
        Self {
            rows,
            current: PlaceHandle::NONE,
            next: if rows.is_empty() {
                PlaceHandle::NONE
            } else {
                PlaceHandle::ROOT
            },
        }
    }

    /// The place of the value that is being printed.
    #[inline]
    pub fn current(&self) -> MatchedPlace {
        MatchedPlace {
            rows: self.rows,
            handle: self.current,
        }
    }

    /// The next value to enter is at `place`. A value that enters without this has no place.
    #[inline]
    pub fn hand(&mut self, place: MatchedPlace) {
        self.next = place.handle;
    }

    /// [`Self::hand`] for the `child` that a [`ForEachMatchedRowCallback`] got.
    #[inline]
    pub fn hand_child(&mut self, child: PlaceHandle) {
        self.next = child;
    }

    /// The print of a value starts: the place handed for it becomes current. Give the result to [`Self::leave`] on every way out.
    #[inline]
    #[must_use]
    pub fn enter(&mut self) -> PlaceHandle {
        let outer = self.current;
        self.current = core::mem::take(&mut self.next);
        outer
    }

    /// The print that `enter` started is over: the caller's place is current again and nothing is handed.
    #[inline]
    pub fn leave(&mut self, outer: PlaceHandle) {
        self.current = outer;
        self.next = PlaceHandle::NONE;
    }

    /// The print goes on with another value, which has no rows.
    #[inline]
    pub fn clear(&mut self) {
        self.current = PlaceHandle::NONE;
    }
}

unsafe extern "C" {
    // safe: a place that is not none carries the cell that `JSC__JSValue__jestDeepMatch` built, C++ answers any handle for that cell, and none of these enters JS.
    safe fn Bun__JestMatchedRows__pattern(rows: MatchedRows, place: PlaceHandle) -> JSValue;
    safe fn Bun__JestMatchedRows__get(
        rows: MatchedRows,
        place: PlaceHandle,
        name: &bun_core::String,
        child: &mut PlaceHandle,
    ) -> JSValue;
    safe fn Bun__JestMatchedRows__getIndex(
        rows: MatchedRows,
        place: PlaceHandle,
        index: u32,
        child: &mut PlaceHandle,
    ) -> JSValue;
    safe fn Bun__JestMatchedRows__merged(rows: MatchedRows, place: PlaceHandle) -> JSValue;
    safe fn Bun__JestMatchedRows__setMerged(rows: MatchedRows, place: PlaceHandle, merged: JSValue);
    // safe: same contract as `JSC__JSValue__forEachProperty` in JSValue.rs.
    safe fn Bun__JestMatchedRows__forEachPropertyOrderedCallingGetters(
        object: JSValue,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachMatchedRowCallback,
        rows: MatchedRows,
        place: PlaceHandle,
    ) -> bool;
    safe fn Bun__JestMatchedRows__forEachPropertyOrderedWithNonEnumerable(
        object: JSValue,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachMatchedRowCallback,
        rows: MatchedRows,
        place: PlaceHandle,
    );
}
