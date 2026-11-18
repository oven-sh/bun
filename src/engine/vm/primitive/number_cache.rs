//! The decimal strings of the numbers that have been converted lately.

use core::cell::{Cell, OnceCell};
use core::mem::offset_of;

use bun_engine_number::{
    INTEGER_TEXT_SLACK, NUMBER_TEXT_CAPACITY, i32_text_length, push_i32, write_f64,
};
use bun_engine_text::StringRef;

use crate::heap::{Scope, Survivors};
use crate::vm::StartsZeroed;
use crate::{Gc, JsString, Value, Visitor, Vm};

#[repr(C)]
pub struct NumberStringEntry {
    /// The bits of the `Value`, or zero.
    key: Cell<u64>,
    string: Cell<usize>,
}

impl NumberStringEntry {
    /// A collection sets it to zero, so both words are read with none in between.
    pub const OFFSET_OF_KEY: usize = offset_of!(NumberStringEntry, key);
    /// No rope. Alive only if the key is the one that is looked for.
    pub const OFFSET_OF_STRING: usize = offset_of!(NumberStringEntry, string);

    #[inline(always)]
    fn get(&self, key: Value) -> Option<Gc<JsString>> {
        // SAFETY: made since the last collection.
        (self.key.get() == key.to_bits()).then(|| unsafe { Gc::from_address(self.string.get()) })
    }
}

#[repr(C)]
pub struct NumberStrings {
    /// By value, or zero. Only a full collection lets them die.
    small: [Cell<usize>; Self::SMALL_COUNT],
    /// By `int32_index`. Forgotten at each collection, as the doubles are.
    int32s: [NumberStringEntry; Self::INT32_COUNT],
    doubles: OnceCell<Box<[NumberStringEntry; Self::DOUBLE_COUNT]>>,
    has_young_small: Cell<bool>,
    has_int32s: Cell<bool>,
    has_doubles: Cell<bool>,
}

// SAFETY: the others are integers and `bool`s.
unsafe impl StartsZeroed for NumberStrings {
    unsafe fn complete(this: *mut NumberStrings) {
        // SAFETY: the caller's.
        unsafe { (&raw mut (*this).doubles).write(OnceCell::new()) }
    }
}

impl NumberStrings {
    /// `SMALL_COUNT` words, each a string that is no rope or zero. A collection can set one to zero.
    pub const OFFSET_OF_SMALL: usize = offset_of!(NumberStrings, small);
    /// `INT32_COUNT` entries. That of a number is at its 32-bit product with `INT32_MULTIPLIER`, shifted right without
    /// sign by `INT32_SHIFT`.
    pub const OFFSET_OF_INT32S: usize = offset_of!(NumberStrings, int32s);
    pub const SMALL_COUNT: usize = 1024;
    pub const INT32_COUNT: usize = 1024;
    pub const INT32_MULTIPLIER: u32 = 0x9e37_79b1;
    pub const INT32_SHIFT: u32 = u32::BITS - Self::INT32_COUNT.ilog2();
    const DOUBLE_COUNT: usize = 4096;

    pub(crate) fn initialize(&self, vm: &Vm) {
        for (entry, digit) in self.small.iter().zip(b'0'..=b'9') {
            entry.set(vm.small_strings.single_character(digit).address());
        }
    }

    #[inline(always)]
    const fn int32_index(number: i32) -> usize {
        ((number as u32).wrapping_mul(Self::INT32_MULTIPLIER) >> Self::INT32_SHIFT) as usize
    }

    #[inline(always)]
    const fn double_index(number: f64) -> usize {
        let shift = u64::BITS - Self::DOUBLE_COUNT.ilog2();
        let bits = number.to_bits();
        ((bits ^ bits >> 32).wrapping_mul(0x9e37_79b9_7f4a_7c15) >> shift) as usize
    }

    pub(crate) fn visit(&self, visitor: &mut Visitor) {
        if self.has_young_small.take() && visitor.scope() == Scope::Eden {
            for string in &self.small {
                // SAFETY: zero, or a string that has survived all collections.
                unsafe { visitor.append_hidden_word(string.get() as u64) };
            }
        }
    }

    pub(crate) fn reconcile(&self, survivors: &Survivors) {
        if survivors.scope() == Scope::Full {
            for entry in self.small.iter().filter(|entry| entry.get() != 0) {
                // SAFETY: only the address is looked at.
                if !survivors.contains(unsafe { Gc::<JsString>::from_address(entry.get()) }) {
                    entry.set(0);
                }
            }
        }
        if self.has_int32s.take() {
            self.int32s.iter().for_each(|entry| entry.key.set(0));
        }
        if self.has_doubles.take()
            && let Some(doubles) = self.doubles.get()
        {
            doubles.iter().for_each(|entry| entry.key.set(0));
        }
    }
}

impl JsString {
    #[inline(always)]
    pub fn from_int32(vm: &Vm, number: i32) -> Gc<JsString> {
        Self::existing_for_int32(vm, number).unwrap_or_else(|| Self::cache_int32(vm, number))
    }

    #[inline(always)]
    pub fn existing_for_int32(vm: &Vm, number: i32) -> Option<Gc<JsString>> {
        let strings = &vm.number_strings;
        match strings.small.get(number as u32 as usize).map(Cell::get) {
            Some(0) => None,
            // SAFETY: cleared before the string is freed.
            Some(address) => Some(unsafe { Gc::from_address(address) }),
            None => strings.int32s[NumberStrings::int32_index(number)].get(Value::int32(number)),
        }
    }

    #[inline(never)]
    fn cache_int32(vm: &Vm, number: i32) -> Gc<JsString> {
        let length = i32_text_length(number);
        let digits = StringRef::try_write_with_slack::<u8, INTEGER_TEXT_SLACK>(length, |to| {
            push_i32(number, to);
        });
        let string = Self::allocate(vm, digits.unwrap_or_else(|_| bun_alloc::out_of_memory()));
        let strings = &vm.number_strings;
        if let Some(entry) = strings.small.get(number as u32 as usize) {
            entry.set(string.address());
            strings.has_young_small.set(true);
        } else {
            let entry = &strings.int32s[NumberStrings::int32_index(number)];
            entry.key.set(Value::int32(number).to_bits());
            entry.string.set(string.address());
            strings.has_int32s.set(true);
        }
        string
    }

    /// Number::toString in radix 10.
    #[inline]
    pub fn from_number(vm: &Vm, number: f64) -> Gc<JsString> {
        let integer = number as i32;
        if f64::from(integer) == number {
            return Self::from_int32(vm, integer);
        }
        (vm.number_strings.doubles.get())
            .and_then(|it| it[NumberStrings::double_index(number)].get(Value::double(number)))
            .unwrap_or_else(|| Self::cache_double(vm, number))
    }

    #[inline(never)]
    fn cache_double(vm: &Vm, number: f64) -> Gc<JsString> {
        let mut text = [0; NUMBER_TEXT_CAPACITY];
        let length = write_f64(number, &mut text);
        let string = Self::allocate(vm, StringRef::from_latin1(&text[..length]));
        let strings = &vm.number_strings;
        let doubles = strings.doubles.get_or_init(|| {
            // SAFETY: empty entries.
            unsafe { Box::new_zeroed().assume_init() }
        });
        let entry = &doubles[NumberStrings::double_index(number)];
        entry.key.set(Value::double(number).to_bits());
        entry.string.set(string.address());
        strings.has_doubles.set(true);
        string
    }
}
