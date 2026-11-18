//! Fills the elements of a cell that nothing has seen yet, in one pass.

use core::marker::PhantomData;
use core::mem::MaybeUninit;

use crate::{ElementKind, Elements, Value};

/// What a copy has where the original has a hole.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HoleMode {
    Keep,
    FillWithUndefined,
}

/// Each method panics if there is no room, or if the kind cannot represent what it is given.
pub struct ElementWriter<'a> {
    rest: &'a mut [MaybeUninit<u64>],
    kind: ElementKind,
    _on_this_thread: PhantomData<Value>,
}

#[inline(always)]
fn raw_double(value: Option<Value>) -> u64 {
    value.map_or(Value::PURE_NAN_BITS, |int32| {
        f64::from(int32.to_bits() as i32).to_bits()
    })
}

#[inline(always)]
fn boxed_double(number: f64, hole: u64) -> u64 {
    if number.is_nan() {
        hole
    } else {
        number.to_bits().wrapping_add(Value::DOUBLE_OFFSET)
    }
}

#[inline(always)]
fn word_for(kind: ElementKind, value: Value) -> u64 {
    match kind {
        ElementKind::Contiguous => value.to_bits(),
        ElementKind::Double => value.as_number().expect("a number").to_bits(),
        kind => {
            assert!(kind == ElementKind::Int32 && value.is_int32());
            value.to_bits()
        }
    }
}

impl<'a> ElementWriter<'a> {
    #[inline(always)]
    pub(super) fn new(words: &'a mut [MaybeUninit<u64>], kind: ElementKind) -> ElementWriter<'a> {
        ElementWriter {
            rest: words,
            kind,
            _on_this_thread: PhantomData,
        }
    }

    /// For the arguments of a call.
    #[inline(always)]
    pub(crate) fn for_values(values: &'a mut [MaybeUninit<Value>]) -> ElementWriter<'a> {
        // SAFETY: what a value is represented as. None of them counts as initialized.
        let words =
            unsafe { core::slice::from_raw_parts_mut(values.as_mut_ptr().cast(), values.len()) };
        Self::new(words, ElementKind::Contiguous)
    }

    #[inline(always)]
    pub fn kind(&self) -> ElementKind {
        self.kind
    }

    #[inline(always)]
    pub fn remaining(&self) -> usize {
        self.rest.len()
    }

    #[inline(always)]
    fn take(&mut self, count: usize) -> &'a mut [MaybeUninit<u64>] {
        let (taken, rest) = core::mem::take(&mut self.rest).split_at_mut(count);
        self.rest = rest;
        taken
    }

    #[inline(always)]
    fn extend_words(&mut self, words: impl ExactSizeIterator<Item = u64>) {
        let mut written = 0;
        for (target, word) in self.rest[..words.len()].iter_mut().zip(words) {
            target.write(word);
            written += 1;
        }
        self.take(written);
    }

    #[inline(always)]
    pub fn push(&mut self, value: Value) {
        let word = word_for(self.kind, value);
        self.take(1)[0].write(word);
    }

    #[inline(always)]
    pub fn push_holes(&mut self, count: usize) {
        let hole = self.kind.hole();
        self.take(count).write_filled(hole);
    }

    #[inline(always)]
    pub fn push_or_hole(&mut self, value: Option<Value>) {
        match value {
            Some(value) => self.push(value),
            None => self.push_holes(1),
        }
    }

    #[inline]
    pub fn push_repeated(&mut self, value: Value, count: usize) {
        let word = word_for(self.kind, value);
        self.take(count).write_filled(word);
    }

    #[inline(always)]
    pub fn extend_from_slice(&mut self, values: &[Value]) {
        if self.kind == ElementKind::Contiguous {
            self.take(values.len())
                .write_copy_of_slice(Value::slice_as_bits(values));
        } else {
            values.iter().for_each(|&value| self.push(value));
        }
    }

    /// # Safety
    /// They are elements of the kind.
    #[inline(always)]
    pub(super) unsafe fn extend_from_words(&mut self, words: &[u64]) {
        self.take(words.len()).write_copy_of_slice(words);
    }

    #[inline(always)]
    pub fn extend_from_values(&mut self, values: impl ExactSizeIterator<Item = Value>) {
        if self.kind == ElementKind::Contiguous {
            self.extend_words(values.map(Value::to_bits));
        } else {
            values.for_each(|value| self.push(value));
        }
    }

    /// NaN is a hole.
    #[inline(always)]
    pub fn extend_from_doubles(&mut self, numbers: impl ExactSizeIterator<Item = f64>) {
        assert!(self.kind == ElementKind::Double);
        let hole = self.kind.hole();
        self.extend_words(numbers.map(|it| if it.is_nan() { hole } else { it.to_bits() }));
    }

    /// Only contiguous elements can have holes filled.
    #[inline(always)]
    pub fn extend(&mut self, source: Elements<'_>, holes: HoleMode) {
        assert!(source.kind() <= self.kind);
        let is_double = self.kind == ElementKind::Double;
        if is_double != (source.kind() == ElementKind::Double) {
            return self.extend_converting(source, holes, false);
        }
        let copy = self.take(source.len()).write_copy_of_slice(source.words());
        self.fill_holes(copy, holes);
    }

    /// The same, from the last to the first.
    pub fn extend_reversed(&mut self, source: Elements<'_>, holes: HoleMode) {
        assert!(source.kind() <= self.kind);
        let is_double = self.kind == ElementKind::Double;
        if is_double != (source.kind() == ElementKind::Double) {
            return self.extend_converting(source, holes, true);
        }
        let copy = self.take(source.len());
        for (target, &word) in copy.iter_mut().zip(source.words().iter().rev()) {
            target.write(word);
        }
        // SAFETY: as many as there are words.
        self.fill_holes(unsafe { copy.assume_init_mut() }, holes);
    }

    /// Leaves out holes, and ends before the first value that `is_end` holds for. Returns how far it got.
    #[inline(always)]
    pub fn extend_until(
        &mut self,
        values: &[Option<Value>],
        is_end: impl Fn(Value) -> bool,
    ) -> usize {
        if self.kind == ElementKind::Contiguous {
            return self.extend_until_with(values, is_end, Value::to_bits);
        }
        let kind = self.kind;
        self.extend_until_with(values, is_end, |value| word_for(kind, value))
    }

    #[inline(always)]
    fn extend_until_with(
        &mut self,
        values: &[Option<Value>],
        is_end: impl Fn(Value) -> bool,
        word: impl Fn(Value) -> u64,
    ) -> usize {
        let (mut written, mut rest) = (0, values);
        while let [first, following @ ..] = rest {
            if let Some(value) = *first {
                if is_end(value) {
                    break;
                }
                self.rest[written].write(word(value));
                written += 1;
            }
            rest = following;
        }
        self.take(written);
        values.len() - rest.len()
    }

    #[inline(always)]
    pub fn extend_without_holes(&mut self, source: Elements<'_>) {
        /// Up to here, one pass is cheaper than a search and a copy.
        const SHORT: usize = 8;
        match source {
            _ if source.len() > SHORT && !source.has_holes() => self.extend(source, HoleMode::Keep),
            Elements::Int32(values) | Elements::Contiguous(values) => {
                self.extend_until(values, |_| false);
            }
            Elements::Double(_) => source.iter().flatten().for_each(|value| self.push(value)),
        }
    }

    #[inline(always)]
    fn replacement(&self, holes: HoleMode) -> u64 {
        if holes == HoleMode::FillWithUndefined && self.kind == ElementKind::Contiguous {
            Value::UNDEFINED.to_bits()
        } else {
            self.kind.hole()
        }
    }

    #[inline(always)]
    fn fill_holes(&self, copy: &mut [u64], holes: HoleMode) {
        if holes == HoleMode::FillWithUndefined
            && self.kind == ElementKind::Contiguous
            && let Some(first) = bun_highway::elements::index_of_u64(copy, 0)
        {
            for word in &mut copy[first..] {
                *word = if *word == 0 {
                    Value::UNDEFINED.to_bits()
                } else {
                    *word
                };
            }
        }
    }

    fn extend_converting(&mut self, source: Elements<'_>, holes: HoleMode, is_reversed: bool) {
        let hole = self.replacement(holes);
        match (source, is_reversed) {
            (Elements::Double(numbers), false) => {
                self.extend_words(numbers.iter().map(|&it| boxed_double(it, hole)));
            }
            (Elements::Double(numbers), true) => {
                self.extend_words(numbers.iter().rev().map(|&it| boxed_double(it, hole)));
            }
            (Elements::Int32(values) | Elements::Contiguous(values), false) => {
                self.extend_words(values.iter().map(|&it| raw_double(it)));
            }
            (Elements::Int32(values) | Elements::Contiguous(values), true) => {
                self.extend_words(values.iter().rev().map(|&it| raw_double(it)));
            }
        }
    }
}
