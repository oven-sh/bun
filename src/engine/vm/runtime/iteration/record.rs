use core::mem::offset_of;

use bun_engine_bytecode::CloseMode;
use bun_engine_macros::Trace;
use bun_engine_text::{names, symbols};

use super::protocol::{Caller, iterator_close_on_throw, iterator_close_quietly};
use super::spread::list_of_code_points;
use super::string_iterator::code_point_string_at;
use crate::caches::get_megamorphic;
use crate::{
    CellType, ClonedArguments, Cx, ElementKind, Gc, HoleMode, IterationKind, IterationMode,
    JsArray, JsArrayIterator, JsCell, JsMap, JsMapIterator, JsObject, JsResult, JsSet,
    JsSetIterator, JsString, JsStringIterator, JsTypedArray, MapKind, MappedArguments,
    OrderedCursor, RealmSlot, RealmWatchpoint, SetKind, TableKind, Thrown, Value, errors,
    iterator_complete, iterator_value, throw_not_iterable,
};

/// The Iterator Record of ECMA-262. Where nothing can tell the difference it has no iterator, or does not call its
/// `next`: see `IterationMode`. The three registers of the iteration instructions are one, the last at the lowest
/// address. It belongs to the realm in which it was made.
#[derive(Clone, Copy, Trace)]
#[repr(C)]
pub struct IteratorRecord {
    /// An int32 whose bits are unsigned. `DONE` in any mode, and otherwise zero in those that have no use for it.
    position: Value,
    next: Value,
    subject: Value,
}

/// The subject and `next` of a record that is at the start. They fit in registers.
type Opened = (Value, Value);

fn is_slot(cx: &Cx, slot: RealmSlot, value: Value) -> bool {
    let cell = cx.global().slot_if_initialized(slot);
    cell.is_some_and(|cell| value == cell.into())
}

/// And to iterate over it is to go through its elements.
#[inline(always)]
fn is_original_array(cx: &Cx, value: Value) -> bool {
    value.as_exact_array().is_some_and(|array| {
        cx.global().array_iterator_protocol_is_pristine()
            && cx.global().is_original_array_shape(&array.shape())
    })
}

impl IteratorRecord {
    pub const OFFSET_OF_POSITION: usize = offset_of!(IteratorRecord, position);
    pub const OFFSET_OF_NEXT: usize = offset_of!(IteratorRecord, next);
    pub const OFFSET_OF_SUBJECT: usize = offset_of!(IteratorRecord, subject);
    pub const START: Value = Value::ZERO;
    /// As an index it is past the end of anything.
    pub const DONE: Value = Value::int32(-1);

    #[inline(always)]
    fn new((subject, next): Opened) -> IteratorRecord {
        IteratorRecord {
            position: Self::START,
            next,
            subject,
        }
    }

    /// `next` has been read from `iterator`.
    pub fn generic(iterator: Value, next: Value) -> IteratorRecord {
        assert!(!IterationMode::is_marker(next));
        Self::new((iterator, next))
    }

    /// For a cell that keeps the record in its fields.
    #[inline(always)]
    pub fn parts(self) -> [Value; 3] {
        [self.position, self.next, self.subject]
    }

    /// # Safety
    /// From `parts`.
    #[inline(always)]
    pub unsafe fn from_parts([position, next, subject]: [Value; 3]) -> IteratorRecord {
        IteratorRecord {
            position,
            next,
            subject,
        }
    }

    /// GetIterator(iterable, sync)
    #[inline]
    pub fn for_iterable(cx: &mut Cx, iterable: Value) -> JsResult<IteratorRecord> {
        Self::get_iterator(cx, iterable, Caller::Library).map(Self::new)
    }

    /// GetIteratorFromMethod
    #[inline]
    pub fn from_method(cx: &mut Cx, iterable: Value, method: Value) -> JsResult<IteratorRecord> {
        Self::get_iterator_from_method(cx, iterable, method, Caller::Library).map(Self::new)
    }

    /// GetIteratorDirect
    #[inline]
    pub fn direct(cx: &mut Cx, iterator: Value) -> JsResult<IteratorRecord> {
        Self::get_iterator_direct(cx, iterator).map(Self::new)
    }

    fn get_iterator_direct(cx: &mut Cx, iterator: Value) -> JsResult<Opened> {
        Ok(
            match iterator.as_cell().and_then(|it| mode_of_iterator(cx, it)) {
                Some(mode) => (iterator, mode.marker()),
                None => (iterator, get_megamorphic(cx, iterator, names::next)?),
            },
        )
    }

    /// GetIterator(iterable, sync), if that runs no script and neither does `next`.
    #[inline]
    pub fn for_pristine_iterable(cx: &Cx, iterable: Value) -> Option<IteratorRecord> {
        if is_original_array(cx, iterable) {
            return Some(Self::new((iterable, IterationMode::Array.marker())));
        }
        Self::open_pristine_iterable(cx, iterable).map(Self::new)
    }

    fn open_pristine_iterable(cx: &Cx, iterable: Value) -> Option<Opened> {
        let cell = iterable.as_cell()?;
        let is_of_realm = || cell.shape().global() == Some(cx.global());
        let slot = match cell.cell_type() {
            CellType::Array => (cell.cast::<JsArray>().is_iteration_pristine() && is_of_realm())
                .then_some(RealmSlot::array_prototype_values)?,
            CellType::Map => (cell.cast::<JsMap>().is_iteration_pristine(cx) && is_of_realm())
                .then_some(RealmSlot::map_prototype_entries)?,
            CellType::Set => (cell.cast::<JsSet>().is_iteration_pristine(cx) && is_of_realm())
                .then_some(RealmSlot::set_prototype_values)?,
            CellType::String => RealmSlot::string_prototype_iterator,
            CellType::DirectArguments | CellType::ScopedArguments | CellType::ClonedArguments => {
                let is_pristine = match cell.downcast::<MappedArguments>() {
                    Some(arguments) => arguments.is_iteration_pristine(),
                    None => cell.cast::<ClonedArguments>().is_iteration_pristine(),
                };
                return (is_pristine && is_of_realm()).then(|| {
                    let iterator = JsArrayIterator::create(cx, cell.cast(), IterationKind::Values);
                    (iterator.into(), IterationMode::ArrayValues.marker())
                });
            }
            _ => match cell.downcast::<JsTypedArray>() {
                Some(array) => (array.is_iteration_pristine(cx) && is_of_realm())
                    .then_some(RealmSlot::typed_array_prototype_values)?,
                None => return Some((iterable, mode_of_iterator(cx, cell)?.marker())),
            },
        };
        Self::of_builtin_kind(cx, iterable, cx.global().slot(cx, slot).into())
    }

    #[inline(always)]
    fn get_iterator(cx: &mut Cx, iterable: Value, caller: Caller) -> JsResult<Opened> {
        if is_original_array(cx, iterable) {
            return Ok((iterable, IterationMode::Array.marker()));
        }
        Self::get_iterator_slow(cx, iterable, caller)
    }

    #[inline(never)]
    fn get_iterator_slow(cx: &mut Cx, iterable: Value, caller: Caller) -> JsResult<Opened> {
        if let Some(opened) = Self::open_pristine_iterable(cx, iterable) {
            return Ok(opened);
        }
        let method = get_megamorphic(cx, iterable, symbols::iterator)?;
        Self::get_iterator_from_method(cx, iterable, method, caller)
    }

    fn get_iterator_from_method(
        cx: &mut Cx,
        iterable: Value,
        method: Value,
        caller: Caller,
    ) -> JsResult<Opened> {
        if let Some(opened) = Self::of_builtin_kind(cx, iterable, method) {
            return Ok(opened);
        }
        if caller == Caller::Syntax && !method.is_callable() {
            return Err(throw_not_iterable(cx, iterable));
        }
        let iterator = caller.call(cx, method, iterable, [])?;
        if !iterator.is_object() {
            return Err(cx.throw_type_error(match caller {
                Caller::Library => errors::TYPE_ERROR,
                Caller::Syntax => errors::ITERATOR_RESULT_NOT_OBJECT,
            }));
        }
        Self::get_iterator_direct(cx, iterator)
    }

    #[inline(always)]
    fn of_builtin_kind(cx: &Cx, iterable: Value, method: Value) -> Option<Opened> {
        let cell = iterable.as_cell()?;
        if cell.cell_type() == CellType::Array {
            let global = cx.global();
            return (method == global.array_prototype_values().into()
                && global.array_iterator_protocol_is_pristine())
            .then_some((iterable, IterationMode::Array.marker()));
        }
        Self::of_other_builtin_kind(cx, cell, method)
    }

    #[inline(never)]
    fn of_other_builtin_kind(cx: &Cx, cell: Gc<JsCell>, method: Value) -> Option<Opened> {
        let mode = match cell.cell_type() {
            CellType::String => (is_slot(cx, RealmSlot::string_prototype_iterator, method)
                && cx.holds(RealmWatchpoint::StringIteratorProtocol))
            .then_some(IterationMode::String),
            CellType::ArrayIterator => {
                let iterator = cell.cast::<JsArrayIterator>();
                // Compiled code does better with the method for anything else.
                (iterator.iterated_object().cell_type() == CellType::Array
                    && is_slot(cx, RealmSlot::iterator_prototype_iterator, method))
                .then(|| mode_of_iterator(cx, cell))?
            }
            CellType::MapIterator | CellType::SetIterator | CellType::StringIterator => {
                is_slot(cx, RealmSlot::iterator_prototype_iterator, method)
                    .then(|| mode_of_iterator(cx, cell))?
            }
            CellType::Map => {
                return (is_slot(cx, RealmSlot::map_prototype_entries, method)
                    && cx.holds(RealmWatchpoint::MapIteratorProtocol))
                .then(|| at_start(cell.cast::<JsMap>().cursor(), IterationMode::Map));
            }
            CellType::Set => {
                return (is_slot(cx, RealmSlot::set_prototype_values, method)
                    && cx.holds(RealmWatchpoint::SetIteratorProtocol))
                .then(|| at_start(cell.cast::<JsSet>().cursor(), IterationMode::Set));
            }
            _ => (is_slot(cx, RealmSlot::typed_array_prototype_values, method)
                && cx.global().array_iterator_protocol_is_pristine()
                && (cell.downcast::<JsTypedArray>()).is_some_and(|it| {
                    !it.is_out_of_bounds() && it.max_length() < u32::MAX as usize
                }))
            .then_some(IterationMode::TypedArray),
        }?;
        Some((cell.into(), mode.marker()))
    }

    #[inline(always)]
    fn set_cursor<K: TableKind>(&mut self, cursor: OrderedCursor<K>) {
        let (place, number) = cursor.parts();
        self.subject = place.into();
        self.set_index(number);
    }

    /// # Safety
    /// The mode says that it is one of that kind, and it is not done.
    #[inline(always)]
    unsafe fn cursor<K: TableKind>(&self) -> OrderedCursor<K> {
        // SAFETY: the caller's.
        unsafe { OrderedCursor::from_parts_unchecked(self.subject_as(), self.index()) }
    }

    #[inline(always)]
    pub fn mode(&self) -> IterationMode {
        IterationMode::of(self.next)
    }

    #[inline(always)]
    pub fn subject(&self) -> Value {
        self.subject
    }

    #[inline(always)]
    pub fn is_done(&self) -> bool {
        self.position == Self::DONE
    }

    #[inline(always)]
    fn index(&self) -> u32 {
        self.position.to_bits() as u32
    }

    #[inline(always)]
    fn set_index(&mut self, index: u32) {
        self.position = Value::int32(index as i32);
    }

    /// # Safety
    /// The mode says that it is a `T`.
    #[inline(always)]
    unsafe fn subject_as<T>(&self) -> Gc<T> {
        // SAFETY: the caller's.
        unsafe { Gc::from_address(self.subject.to_bits() as usize) }
    }

    /// `[[Iterator]]`. If there is none, each call makes one that is where the record is. Panics if it is done.
    pub fn iterator(&self, cx: &Cx) -> Value {
        assert!(!self.is_done());
        match self.mode() {
            IterationMode::Array | IterationMode::TypedArray => {
                let (object, kind) = (self.subject.cast(), IterationKind::Values);
                let iterator = JsArrayIterator::create(cx, object, kind);
                iterator.set_index(Some(self.index().into()));
                iterator.into()
            }
            IterationMode::Map => {
                // SAFETY: of that mode.
                let cursor = unsafe { self.cursor() };
                JsMapIterator::create_at(cx, cursor, IterationKind::Entries).into()
            }
            IterationMode::Set => {
                // SAFETY: as above.
                let cursor = unsafe { self.cursor() };
                JsSetIterator::create_at(cx, cursor, IterationKind::Values).into()
            }
            IterationMode::String => {
                let iterator = JsStringIterator::create(cx, self.subject.cast());
                iterator.set_index(self.index());
                iterator.into()
            }
            _ => self.subject,
        }
    }

    /// The object whose elements it yields, and the index of the next one.
    pub fn next_element(&self) -> Option<(Gc<JsObject>, u32)> {
        match self.mode() {
            IterationMode::Array | IterationMode::TypedArray => {
                Some((self.subject.cast(), self.index()))
            }
            IterationMode::ArrayKeys | IterationMode::ArrayValues | IterationMode::ArrayEntries => {
                let iterator = self.subject.cast::<JsArrayIterator>();
                let index = iterator.index().and_then(|it| u32::try_from(it).ok());
                Some((iterator.iterated_object(), index.unwrap_or(u32::MAX)))
            }
            _ => None,
        }
    }

    /// The next element of an array, if it is there and is plain data.
    #[inline(always)]
    pub fn try_step_array(&mut self) -> Option<Value> {
        if self.next != IterationMode::Array.marker() {
            return None;
        }
        // SAFETY: of that mode.
        let value = unsafe { self.subject_as::<JsArray>() }.try_get_dense(self.index())?;
        self.set_index(self.index() + 1);
        Some(value)
    }

    /// Writes nothing if it throws.
    #[inline(always)]
    fn advance(&mut self, cx: &mut Cx, caller: Caller) -> JsResult<Option<Value>> {
        match self.try_step_array() {
            Some(value) => Ok(Some(value)),
            None => self.advance_slow(cx, caller),
        }
    }

    #[inline(never)]
    fn advance_slow(&mut self, cx: &mut Cx, caller: Caller) -> JsResult<Option<Value>> {
        if IterationMode::is_marker(self.next) {
            cx.check_traps()?;
            return self.step_builtin(cx);
        }
        match self.next_result(cx, caller)? {
            Some(result) => iterator_value(cx, &result).map(Some),
            None => Ok(None),
        }
    }

    #[inline(always)]
    fn next_result(&mut self, cx: &mut Cx, caller: Caller) -> JsResult<Option<Gc<JsObject>>> {
        if self.is_done() {
            return Ok(None);
        }
        let result = caller.next(cx, self.subject, self.next, [])?;
        if iterator_complete(cx, &result)? {
            self.position = Self::DONE;
            return Ok(None);
        }
        Ok(Some(result))
    }

    /// False if there was nothing left. Writes nothing if it throws.
    fn pass(&mut self, cx: &mut Cx, caller: Caller) -> JsResult<bool> {
        if self.try_step_array().is_some() {
            return Ok(true);
        }
        if IterationMode::is_marker(self.next) {
            cx.check_traps()?;
            return Ok(self.step_builtin(cx)?.is_some());
        }
        Ok(self.next_result(cx, caller)?.is_some())
    }

    #[inline(always)]
    fn done_if_abrupt<T>(&mut self, result: JsResult<T>) -> JsResult<T> {
        if result.is_err() {
            self.position = Self::DONE;
        }
        result
    }

    /// IteratorStepValue. `None` stands for done, also from then on.
    #[inline(always)]
    pub fn step_value(&mut self, cx: &mut Cx) -> JsResult<Option<Value>> {
        let result = self.advance(cx, Caller::Library);
        self.done_if_abrupt(result)
    }

    /// IteratorStep, for a caller that does not want the value. False stands for done.
    pub fn step(&mut self, cx: &mut Cx) -> JsResult<bool> {
        let result = self.pass(cx, Caller::Library);
        self.done_if_abrupt(result)
    }

    /// Whether IteratorClose is known to do nothing.
    #[inline(always)]
    pub fn has_nothing_to_close(&self, cx: &Cx) -> bool {
        use IterationMode::{Array, Generic, Map, Set, String, TypedArray};
        let holds = |which| cx.global().watchpoints_unchecked(which).is_still_valid();
        self.is_done()
            || match self.mode() {
                Array | TypedArray => holds(RealmWatchpoint::ArrayIteratorProtocol),
                String => holds(RealmWatchpoint::StringIteratorProtocol),
                Map => holds(RealmWatchpoint::MapIteratorProtocol),
                Set => holds(RealmWatchpoint::SetIteratorProtocol),
                Generic => false,
                _ => mode_of_iterator(cx, self.subject.cast()).is_some(),
            }
    }

    /// IteratorClose with a normal completion, unless it is done.
    #[inline]
    pub fn close(&self, cx: &mut Cx) -> JsResult<()> {
        if self.has_nothing_to_close(cx) {
            return Ok(());
        }
        let iterator = self.iterator(cx);
        Caller::Library.close(cx, iterator)
    }

    /// IteratorClose with a throw completion, unless it is done.
    #[cold]
    pub fn close_on_throw(&self, cx: &mut Cx, thrown: Thrown) -> Thrown {
        if self.has_nothing_to_close(cx) {
            return thrown;
        }
        let iterator = self.iterator(cx);
        iterator_close_on_throw(cx, iterator, thrown)
    }

    /// IfAbruptCloseIterator
    #[inline(always)]
    pub fn close_if_abrupt<T>(&self, cx: &mut Cx, result: JsResult<T>) -> JsResult<T> {
        result.map_err(|thrown| self.close_on_throw(cx, thrown))
    }

    /// Closes the iterator if `visit` throws.
    #[inline(always)]
    pub fn for_each(
        mut self,
        cx: &mut Cx,
        mut visit: impl FnMut(&mut Cx, Value) -> JsResult<()>,
    ) -> JsResult<()> {
        while let Some(value) = self.advance(cx, Caller::Library)? {
            let result = visit(cx, value);
            self.close_if_abrupt(cx, result)?;
        }
        Ok(())
    }

    /// An array of what is left.
    #[inline]
    pub fn to_array(mut self, cx: &mut Cx) -> JsResult<Gc<JsArray>> {
        self.collect(cx, Caller::Library)
    }

    fn collect(&mut self, cx: &mut Cx, caller: Caller) -> JsResult<Gc<JsArray>> {
        let array = match self.collect_at_once(cx)? {
            Some(array) => array,
            None => {
                let mut rest = *self;
                let array = cx.new_array_with_capacity(ElementKind::Undecided, 0)?;
                while let Some(value) = rest.advance(cx, caller)? {
                    if let Err(thrown) = array.append(cx, value) {
                        return Err(rest.close_on_throw(cx, thrown));
                    }
                }
                array
            }
        };
        self.position = Self::DONE;
        Ok(array)
    }

    /// What is left, if getting it runs no script.
    pub(super) fn collect_at_once(&self, cx: &mut Cx) -> JsResult<Option<Gc<JsArray>>> {
        let copy_from = |cx: &mut Cx, source: Gc<JsObject>, index: u64| {
            let Some(length) = plain_length(&source) else {
                return Ok(None);
            };
            let range = index.min(length)..length;
            JsArray::try_copy(cx, &source, range, HoleMode::FillWithUndefined)
        };
        // SAFETY: each is what the mode says.
        unsafe {
            match self.mode() {
                _ if self.is_done() => Ok(None),
                IterationMode::Array | IterationMode::TypedArray => {
                    copy_from(cx, self.subject_as(), self.index().into())
                }
                IterationMode::ArrayValues => {
                    let iterator = self.subject_as::<JsArrayIterator>();
                    let Some(index) = iterator.index() else {
                        return Ok(None);
                    };
                    let array = copy_from(cx, iterator.iterated_object(), index)?;
                    Ok(array.inspect(|_| iterator.set_index(None)))
                }
                IterationMode::String if self.position == Self::START => {
                    let list = list_of_code_points(cx, &self.subject_as::<JsString>())?;
                    JsArray::from_immutable(cx, list).map(Some)
                }
                IterationMode::Map => {
                    JsMapIterator::rest_to_array(cx, self.cursor(), IterationKind::Entries)
                        .map(Some)
                }
                IterationMode::Set => {
                    JsSetIterator::rest_to_array(cx, self.cursor(), IterationKind::Values).map(Some)
                }
                IterationMode::MapKeys | IterationMode::MapValues | IterationMode::MapEntries => {
                    (self.subject_as::<JsMapIterator>().drain_to_array(cx)).map(Some)
                }
                IterationMode::SetValues | IterationMode::SetEntries => {
                    (self.subject_as::<JsSetIterator>().drain_to_array(cx)).map(Some)
                }
                _ => Ok(None),
            }
        }
    }
}

/// What the instructions do.
impl IteratorRecord {
    /// `iterator_open`. `None` for the generic mode, in which the position is `START`.
    #[inline(always)]
    pub fn open(cx: &Cx, iterable: Value, method: Value) -> JsResult<Option<IteratorRecord>> {
        let opened = Self::of_builtin_kind(cx, iterable, method);
        if opened.is_none() && !method.is_callable() {
            return Err(throw_not_iterable(cx, iterable));
        }
        Ok(opened.map(Self::new))
    }

    /// `iterator_next`. Panics in the generic mode.
    pub fn step_builtin(&mut self, cx: &mut Cx) -> JsResult<Option<Value>> {
        let index = self.index();
        // SAFETY: each is what the mode says.
        let step = unsafe {
            match self.mode() {
                IterationMode::Array => {
                    let array = self.subject_as::<JsArray>();
                    if index < array.length() {
                        Some((array.get_index(cx, index.into())?, index + 1))
                    } else {
                        None
                    }
                }
                IterationMode::String => {
                    code_point_string_at(cx, &self.subject_as::<JsString>(), index)?
                        .map(|(string, next)| (string.into(), next))
                }
                _ if self.is_done() => None,
                IterationMode::TypedArray => {
                    let array = self.subject_as::<JsTypedArray>();
                    array.validate(cx)?;
                    let element = array.get_element(cx, index as usize);
                    element.map(|element| (element, index + 1))
                }
                IterationMode::Map => {
                    let mut cursor = self.cursor::<MapKind>();
                    if let Some((key, value)) = cursor.next() {
                        let entry = cx.new_pair(key, value)?;
                        self.set_cursor(cursor);
                        return Ok(Some(entry.into()));
                    }
                    None
                }
                IterationMode::Set => {
                    let mut cursor = self.cursor::<SetKind>();
                    if let Some(key) = cursor.next() {
                        self.set_cursor(cursor);
                        return Ok(Some(key));
                    }
                    None
                }
                IterationMode::MapKeys | IterationMode::MapValues | IterationMode::MapEntries => {
                    let value = self.subject_as::<JsMapIterator>().next(cx)?;
                    value.map(|value| (value, 0))
                }
                IterationMode::SetValues | IterationMode::SetEntries => {
                    let value = self.subject_as::<JsSetIterator>().next(cx)?;
                    value.map(|value| (value, 0))
                }
                IterationMode::ArrayKeys
                | IterationMode::ArrayValues
                | IterationMode::ArrayEntries => {
                    let value = self.subject_as::<JsArrayIterator>().next(cx)?;
                    value.map(|value| (value, 0))
                }
                IterationMode::StringIterator => {
                    let string = self.subject_as::<JsStringIterator>().next(cx)?;
                    string.map(|string| (string.into(), 0))
                }
                _ => unreachable!(),
            }
        };
        self.set_index(step.map_or(u32::MAX, |(_, next)| next));
        Ok(step.map(|(value, _)| value))
    }

    /// `iterator_begin`
    #[inline(always)]
    pub fn begin(cx: &mut Cx, iterable: Value) -> JsResult<IteratorRecord> {
        Self::get_iterator(cx, iterable, Caller::Syntax).map(Self::new)
    }

    /// `iterator_step`
    #[inline]
    pub fn step_in_pattern(&mut self, cx: &mut Cx) -> JsResult<Value> {
        Ok(self.advance(cx, Caller::Syntax)?.unwrap_or_default())
    }

    /// `iterator_skip`
    pub fn skip_in_pattern(&mut self, cx: &mut Cx) -> JsResult<()> {
        self.pass(cx, Caller::Syntax).map(|_| ())
    }

    /// `iterator_rest`
    pub fn rest_in_pattern(&mut self, cx: &mut Cx) -> JsResult<Gc<JsArray>> {
        self.collect(cx, Caller::Syntax)
    }

    /// `iterator_close`
    #[inline]
    pub fn leave(&self, cx: &mut Cx, mode: CloseMode) -> JsResult<()> {
        if self.has_nothing_to_close(cx) {
            return Ok(());
        }
        let iterator = self.iterator(cx);
        match mode {
            CloseMode::Normal => Caller::Syntax.close(cx, iterator),
            CloseMode::Throw => iterator_close_quietly(cx, iterator),
        }
    }
}

fn at_start<K: TableKind>(cursor: OrderedCursor<K>, mode: IterationMode) -> Opened {
    let (place, number) = cursor.parts();
    debug_assert!(number == 0);
    (place.into(), mode.marker())
}

/// The length that an array iterator goes by, if getting it runs no script and throws nothing.
pub(super) fn plain_length(object: &JsObject) -> Option<u64> {
    if let Some(array) = object.as_exact_array() {
        Some(array.length().into())
    } else if let Some(array) = object.downcast::<JsTypedArray>() {
        array.checked_length().map(|length| length as u64)
    } else if let Some(arguments) = object.downcast::<MappedArguments>() {
        arguments.original_length().map(u64::from)
    } else {
        (object.downcast::<ClonedArguments>()?.try_length()).map(u64::from)
    }
}

/// `None` unless its `next` is the original one, it is its own iterator, and it has no `return`.
fn mode_of_iterator(cx: &Cx, iterator: Gc<JsCell>) -> Option<IterationMode> {
    let has_shape = |slot| is_slot(cx, slot, iterator.shape().into());
    match iterator.cell_type() {
        CellType::ArrayIterator => (has_shape(RealmSlot::array_iterator_shape)
            && cx.global().array_iterator_protocol_is_pristine())
        .then(|| match iterator.cast::<JsArrayIterator>().kind() {
            IterationKind::Keys => IterationMode::ArrayKeys,
            IterationKind::Values => IterationMode::ArrayValues,
            IterationKind::Entries => IterationMode::ArrayEntries,
        }),
        CellType::MapIterator => (has_shape(RealmSlot::map_iterator_shape)
            && cx.holds(RealmWatchpoint::MapIteratorProtocol))
        .then(|| match iterator.cast::<JsMapIterator>().kind() {
            IterationKind::Keys => IterationMode::MapKeys,
            IterationKind::Values => IterationMode::MapValues,
            IterationKind::Entries => IterationMode::MapEntries,
        }),
        CellType::SetIterator => (has_shape(RealmSlot::set_iterator_shape)
            && cx.holds(RealmWatchpoint::SetIteratorProtocol))
        .then(|| match iterator.cast::<JsSetIterator>().kind() {
            IterationKind::Keys | IterationKind::Values => IterationMode::SetValues,
            IterationKind::Entries => IterationMode::SetEntries,
        }),
        CellType::StringIterator => (has_shape(RealmSlot::string_iterator_shape)
            && cx.holds(RealmWatchpoint::StringIteratorProtocol))
        .then_some(IterationMode::StringIterator),
        _ => None,
    }
}

/// Closes the iterator if `visit` throws.
#[inline(always)]
pub fn for_each_in_iterable(
    cx: &mut Cx,
    iterable: Value,
    visit: impl FnMut(&mut Cx, Value) -> JsResult<()>,
) -> JsResult<()> {
    IteratorRecord::for_iterable(cx, iterable)?.for_each(cx, visit)
}
