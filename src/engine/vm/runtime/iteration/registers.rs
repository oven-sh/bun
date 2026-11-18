//! The iteration instructions, on the registers of a frame.

use core::cell::Cell;

use bun_engine_bytecode::CloseMode;
use bun_engine_macros::native_abi;
use bun_engine_text::Text;

use crate::code::metadata::{Flags, IteratorNext};
use crate::{
    ArrayModes, Cx, Gc, IterationMode, IteratorRecord, JsArray, JsArrayIterator, JsMapIterator,
    JsResult, JsSetIterator, JsString, JsTypedArray, MapCursor, SetCursor, Value, Vm,
};

/// What an instruction with two ways to go on comes to: a value, or one of these.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub struct Step(u64);

impl Step {
    /// An exception is pending or, of a method that only tries, there is more to it.
    pub const FAILED: Step = Step(0);
    pub const DONE: Step = Step(1);

    #[inline(always)]
    pub const fn bits(self) -> u64 {
        self.0
    }
}

impl From<Value> for Step {
    #[inline(always)]
    fn from(value: Value) -> Step {
        Step(value.to_bits())
    }
}

impl<T: Into<Value>> From<JsResult<Option<T>>> for Step {
    #[inline(always)]
    fn from(result: JsResult<Option<T>>) -> Step {
        match result {
            Ok(Some(value)) => value.into().into(),
            Ok(None) => Step::DONE,
            Err(_) => Step::FAILED,
        }
    }
}

/// An `IteratorRecord` that an instruction has put in a frame.
#[repr(C)]
pub struct IteratorRegisters {
    position: Cell<u64>,
    next: Cell<u64>,
    subject: Cell<u64>,
}

impl IteratorRegisters {
    #[inline(always)]
    pub fn get(&self) -> IteratorRecord {
        let parts = [&self.position, &self.next, &self.subject];
        // SAFETY: from `set`, or from the instructions that open an iterator in the generic mode. Each is read as it has
        // just been written, which is not together with another.
        unsafe {
            IteratorRecord::from_parts(
                parts.map(|it| Value::from_bits(it.as_ptr().read_volatile())),
            )
        }
    }

    #[inline(always)]
    pub fn set(&self, record: IteratorRecord) {
        let cells = [&self.position, &self.next, &self.subject];
        for (cell, part) in cells.into_iter().zip(record.parts()) {
            // SAFETY: as `Cell::set`, and one by one for the same reason.
            unsafe { cell.as_ptr().write_volatile(part.to_bits()) };
        }
    }

    #[inline(always)]
    pub fn mode(&self) -> IterationMode {
        // SAFETY: as above.
        IterationMode::of(unsafe { Value::from_bits(self.next.get()) })
    }

    /// # Safety
    /// The mode says that it is a `T`.
    #[inline(always)]
    unsafe fn subject<T>(&self) -> Gc<T> {
        // SAFETY: the caller's.
        unsafe { Gc::from_address(self.subject.get() as usize) }
    }

    #[inline(always)]
    fn advance_to(&self, index: u32, value: Value) -> Step {
        self.position.set(Value::int32(index as i32).to_bits());
        value.into()
    }

    #[inline(always)]
    fn finish(&self) -> Step {
        self.position.set(IteratorRecord::DONE.to_bits());
        Step::DONE
    }

    /// `IteratorRecord::step_builtin`, if that calls nothing.
    #[inline(always)]
    pub fn try_step(&self, vm: &Vm, entry: &IteratorNext) -> Step {
        let (mode, index) = (self.mode(), self.position.get() as u32);
        entry.modes.record(mode.flag());
        if index == u32::MAX {
            return Step::DONE;
        }
        let or_failed = |value: Option<Value>| value.map_or(Step::FAILED, Step::from);
        // SAFETY: each is what the mode says.
        unsafe {
            match mode {
                IterationMode::Array => {
                    let array = self.subject::<JsArray>();
                    if !entry.array.try_record_shape(&array) {
                        Step::FAILED
                    } else if let Some(value) = array.try_get_dense(index) {
                        self.advance_to(index + 1, value)
                    } else if index >= array.length() {
                        self.finish()
                    } else if array.is_known_to_have_only_own_elements(vm) {
                        entry.array.record(ArrayModes::HOLE);
                        self.advance_to(index + 1, Value::UNDEFINED)
                    } else {
                        Step::FAILED
                    }
                }
                IterationMode::TypedArray => {
                    let array = self.subject::<JsTypedArray>();
                    if !entry.array.try_record_shape(&array) {
                        Step::FAILED
                    } else if (index as usize) < array.known_length() {
                        let element = array.number_at_unchecked(index as usize);
                        element.map_or(Step::FAILED, |it| self.advance_to(index + 1, it))
                    } else if array.is_resizable_or_growable() || array.is_detached() {
                        Step::FAILED
                    } else {
                        self.finish()
                    }
                }
                IterationMode::String => {
                    let Some(string) = self.subject::<JsString>().try_resolved() else {
                        return Step::FAILED;
                    };
                    let unit = match string.text() {
                        Text::Latin1(units) => units.get(index as usize).map(|&it| it.into()),
                        Text::Utf16(units) => units.get(index as usize).copied(),
                    };
                    match unit.map(u8::try_from) {
                        Some(Ok(unit)) => {
                            let character = vm.small_strings.single_character(unit);
                            self.advance_to(index + 1, character.into())
                        }
                        Some(Err(_)) => Step::FAILED,
                        None => self.finish(),
                    }
                }
                IterationMode::Set => {
                    let mut cursor = SetCursor::from_parts_unchecked(self.subject(), index);
                    if !cursor.is_at_current_table() {
                        return Step::FAILED;
                    }
                    match cursor.next_in_current_table() {
                        Some(key) => self.advance_to(cursor.parts().1, key),
                        None => self.finish(),
                    }
                }
                IterationMode::MapKeys => or_failed(
                    self.subject::<JsMapIterator>()
                        .try_next_item()
                        .map(|it| it.0),
                ),
                IterationMode::MapValues => or_failed(
                    self.subject::<JsMapIterator>()
                        .try_next_item()
                        .map(|it| it.1),
                ),
                IterationMode::SetValues => {
                    or_failed(self.subject::<JsSetIterator>().try_next_item())
                }
                IterationMode::ArrayKeys | IterationMode::ArrayValues => {
                    let iterator = self.subject::<JsArrayIterator>();
                    if !entry.array.try_record_shape(&iterator.iterated_object()) {
                        return Step::FAILED;
                    }
                    let is_key = mode == IterationMode::ArrayKeys;
                    or_failed(
                        iterator
                            .try_next()
                            .map(|it| if is_key { it.0 } else { it.1 }),
                    )
                }
                _ => Step::FAILED,
            }
        }
    }

    /// If all it takes is to allocate that. It is not done.
    #[inline(always)]
    fn try_step_to_pair(&self, cx: &Cx, entry: &IteratorNext) -> Option<JsResult<Gc<JsArray>>> {
        // SAFETY: each is what the mode says.
        let (first, second) = unsafe {
            match self.mode() {
                IterationMode::Map => {
                    let index = self.position.get() as u32;
                    let mut cursor = MapCursor::from_parts_unchecked(self.subject(), index);
                    let (key, value) = (cursor.is_at_current_table())
                        .then(|| cursor.next_in_current_table())??;
                    let pair = cx.new_pair(key, value);
                    return Some(
                        pair.inspect(|&it| _ = self.advance_to(cursor.parts().1, it.into())),
                    );
                }
                IterationMode::MapEntries => self.subject::<JsMapIterator>().try_next_item()?,
                IterationMode::SetEntries => {
                    let key = self.subject::<JsSetIterator>().try_next_item()?;
                    (key, key)
                }
                IterationMode::ArrayEntries => {
                    let iterator = self.subject::<JsArrayIterator>();
                    entry.array.record_base(iterator.iterated_object().into());
                    iterator.try_next()?
                }
                _ => return None,
            }
        };
        Some(cx.new_pair(first, second))
    }

    #[inline(always)]
    fn update<T>(&self, step: impl FnOnce(&mut IteratorRecord) -> JsResult<T>) -> JsResult<T> {
        let mut record = self.get();
        let result = step(&mut record)?;
        self.set(record);
        Ok(result)
    }

    fn record_element(&self, vm: &Vm, entry: &IteratorNext) {
        if let Some((object, index)) = self.get().next_element() {
            entry.array.record_base(object.into());
            if index < object.public_length() {
                entry.array.record_index(&object, index, false);
                object.has_only_own_elements(vm);
            }
        }
    }
}

/// True if the iterable is of a built-in kind.
#[native_abi]
pub fn iterator_open(
    cx: &mut Cx,
    state: &IteratorRegisters,
    modes: &Flags,
    iterable: Value,
    method: Value,
) -> JsResult<Value> {
    let opened = IteratorRecord::open(cx, iterable, method)?;
    modes.record(opened.map_or(IterationMode::Generic, |it| it.mode()).flag());
    match opened {
        Some(record) => state.set(record),
        None => state.position.set(IteratorRecord::START.to_bits()),
    }
    Ok(opened.is_some().into())
}

/// The mode is not the generic one.
#[native_abi]
pub fn iterator_next(cx: &mut Cx, state: &IteratorRegisters, entry: &IteratorNext) -> Step {
    match state.try_step(cx, entry) {
        Step::FAILED => iterator_next_slow(cx, state, entry),
        step => step,
    }
}

/// After `try_step`.
#[inline(never)]
pub fn iterator_next_slow(cx: &mut Cx, state: &IteratorRegisters, entry: &IteratorNext) -> Step {
    if let Some(pair) = state.try_step_to_pair(cx, entry) {
        return pair.map(Some).into();
    }
    state.record_element(cx, entry);
    state.update(|record| record.step_builtin(cx)).into()
}

#[native_abi]
pub fn iterator_begin(
    cx: &mut Cx,
    state: &IteratorRegisters,
    modes: &Flags,
    iterable: Value,
) -> JsResult<Value> {
    let record = IteratorRecord::begin(cx, iterable)?;
    modes.record(record.mode().flag());
    state.set(record);
    Ok(Value::UNDEFINED)
}

#[native_abi]
pub fn iterator_step(
    cx: &mut Cx,
    state: &IteratorRegisters,
    entry: &IteratorNext,
) -> JsResult<Value> {
    match state.try_step(cx, entry) {
        Step::FAILED => iterator_step_slow(cx, state, entry),
        Step::DONE => Ok(Value::UNDEFINED),
        // SAFETY: neither of those.
        step => Ok(unsafe { Value::from_bits(step.bits()) }),
    }
}

/// After `try_step`.
#[inline(never)]
pub fn iterator_step_slow(
    cx: &mut Cx,
    state: &IteratorRegisters,
    entry: &IteratorNext,
) -> JsResult<Value> {
    if let Some(pair) = state.try_step_to_pair(cx, entry) {
        return pair.map(Into::into);
    }
    state.record_element(cx, entry);
    state.update(|record| record.step_in_pattern(cx))
}

#[native_abi]
pub fn iterator_skip(cx: &mut Cx, state: &IteratorRegisters) -> JsResult<Value> {
    state.update(|record| record.skip_in_pattern(cx))?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
pub fn iterator_rest(cx: &mut Cx, state: &IteratorRegisters) -> JsResult<Value> {
    (state.update(|record| record.rest_in_pattern(cx))).map(Into::into)
}

#[native_abi]
pub fn iterator_leave(
    cx: &mut Cx,
    state: &IteratorRegisters,
    modes: &Flags,
    is_throwing: bool,
) -> JsResult<Value> {
    let (record, mode) = (
        state.get(),
        if is_throwing {
            CloseMode::Throw
        } else {
            CloseMode::Normal
        },
    );
    modes.record(record.mode().flag());
    record.leave(cx, mode)?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
pub fn spread(cx: &mut Cx, iterable: Value) -> JsResult<Value> {
    super::spread(cx, iterable).map(Into::into)
}

/// # Safety
/// `count` registers, from the one at the lowest address.
#[native_abi]
pub unsafe fn new_array_with_spread(
    cx: &mut Cx,
    lowest: *const Option<Value>,
    count: usize,
) -> JsResult<Value> {
    // SAFETY: the caller's.
    let registers = unsafe { core::slice::from_raw_parts(lowest, count) };
    super::new_array_with_spread(cx, registers).map(Into::into)
}
