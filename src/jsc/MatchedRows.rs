//! What a `bun:test` printer shows in place of the properties that matched an asymmetric matcher. The C++ half is `bindings/JestMatchedRows.cpp`.

use core::ffi::c_void;

use crate::js_value::ForEachPropertyWithRowsCallback;
use crate::{JSGlobalObject, JSValue, JsResult};

/// The rows of one `JSValue::jest_deep_match` call, or none. It is a GC cell with no `Strong`: the stack roots it, so keep it in locals, arguments and a formatter that is a local.
#[repr(transparent)]
#[derive(Clone, Copy, Default)]
pub struct MatchedRows(JSValue);

impl MatchedRows {
    #[inline]
    pub fn is_empty(self) -> bool {
        self.0.is_empty()
    }

    /// The place of the object that was matched and of the pattern it was matched with. None if there are no rows.
    pub fn root(self) -> MatchedPlace {
        if self.is_empty() {
            return MatchedPlace::default();
        }
        MatchedPlace {
            rows: self,
            handle: crate::cpp::Bun__JestMatchedRows__root(self.0),
        }
    }
}

/// Names a place inside one rows cell. C++ hands them out and answers for any number.
pub type PlaceHandle = u32;

/// The handle that names no place.
const NO_PLACE: PlaceHandle = 0;

/// What to print for a property in place of reading it: the matcher that it matched, or the value that the comparison read. With it comes the place of that value.
pub type MatchedRow = (JSValue, MatchedPlace);

/// An object together with the pattern it was compared with, if that pattern leads to a matcher that passed. Otherwise none.
#[derive(Clone, Copy, Default)]
pub struct MatchedPlace {
    rows: MatchedRows,
    handle: PlaceHandle,
}

impl MatchedPlace {
    #[inline]
    pub fn is_none(self) -> bool {
        self.handle == NO_PLACE
    }

    /// The row of property `name`, if the comparison left one at this place.
    #[inline]
    pub fn row(self, name: &'static str) -> Option<MatchedRow> {
        self.row_named(&bun_core::String::static_(name))
    }

    /// [`Self::row`] for a name that is not a literal.
    #[inline]
    pub fn row_named(self, name: &bun_core::String) -> Option<MatchedRow> {
        if self.is_none() {
            return None;
        }
        let mut child = NO_PLACE;
        let value = Bun__JestMatchedRows__get(self.rows.0, self.handle, name, &mut child);
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
    pub fn element(self, index: u32) -> Option<MatchedRow> {
        if self.is_none() {
            return None;
        }
        let mut child = NO_PLACE;
        let value = Bun__JestMatchedRows__getIndex(self.rows.0, self.handle, index, &mut child);
        self.row_of(value, child)
    }

    fn row_of(self, value: JSValue, child: PlaceHandle) -> Option<MatchedRow> {
        let place = MatchedPlace {
            rows: self.rows,
            handle: child,
        };
        (!value.is_empty()).then_some((value, place))
    }

    /// What snapshot serializers are offered in place of the object of this place, which must not be none: a plain object, or an array for an array, that has the object's own enumerable properties in their order, with each row in place of its property. A function is offered as it is. The rows cell keeps what it builds, so a place is built once. A property whose getter throws is left out.
    pub fn for_serializers(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let (rows, place) = self.cell_and_handle();
        crate::cpp::Bun__JestMatchedRows__forSerializers(global, rows, place)
    }

    /// `JSValue::for_each_property_ordered_calling_getters` on `object`, the object of this place, which must not be none. A row is passed in place of its property, which is not read.
    #[inline(always)]
    #[allow(clippy::not_unsafe_ptr_arg_deref)] // `ctx` is not read here: C++ hands it back to `callback`
    pub fn for_each_property_ordered_calling_getters(
        self,
        object: JSValue,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachPropertyWithRowsCallback,
    ) -> JsResult<bool> {
        let (rows, place) = self.cell_and_handle();
        // SAFETY: a `MatchedRows` is empty or the cell that `jest_deep_match` returned, which its holder keeps on the stack, and `cell_and_handle` asserts that it is not empty.
        unsafe {
            object.for_each_property_ordered_calling_getters_with_rows(
                global, ctx, callback, rows, place,
            )
        }
    }

    /// `JSValue::for_each_property_ordered_with_non_enumerable` on `object`, with rows in place of properties as above.
    #[inline(always)]
    #[allow(clippy::not_unsafe_ptr_arg_deref)] // `ctx` is not read here: C++ hands it back to `callback`
    pub fn for_each_property_ordered_with_non_enumerable(
        self,
        object: JSValue,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: ForEachPropertyWithRowsCallback,
    ) -> JsResult<()> {
        let (rows, place) = self.cell_and_handle();
        // SAFETY: a `MatchedRows` is empty or the cell that `jest_deep_match` returned, which its holder keeps on the stack, and `cell_and_handle` asserts that it is not empty.
        unsafe {
            object.for_each_property_ordered_with_non_enumerable_with_rows(
                global, ctx, callback, rows, place,
            )
        }
    }

    /// The rows cell and the handle of this place, which must not be none. The handle is not checked against the cell: C++ answers for any number.
    #[inline(always)]
    fn cell_and_handle(self) -> (JSValue, PlaceHandle) {
        assert!(!self.is_none() && !self.rows.is_empty());
        (self.rows.0, self.handle)
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
            current: NO_PLACE,
            next: rows.root().handle,
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

    /// [`Self::hand`] for the `child_place` that a [`ForEachPropertyWithRowsCallback`] got.
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
        self.next = NO_PLACE;
    }

    /// The print goes on with another value, which has no rows.
    #[inline]
    pub fn clear(&mut self) {
        self.current = NO_PLACE;
    }
}

unsafe extern "C" {
    // safe: C++ answers for any `rows` and `place`, uses `name` and `child` only during the call, and enters no JS. `crate::cpp` has the accessors that take no pointer.
    safe fn Bun__JestMatchedRows__get(
        rows: JSValue,
        place: PlaceHandle,
        name: &bun_core::String,
        child: &mut PlaceHandle,
    ) -> JSValue;
    safe fn Bun__JestMatchedRows__getIndex(
        rows: JSValue,
        place: PlaceHandle,
        index: u32,
        child: &mut PlaceHandle,
    ) -> JSValue;
}
