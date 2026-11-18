use bun_alloc::AllocError;
use bun_engine_number::{
    NUMBER_TEXT_CAPACITY, write_f64, write_i32, write_i64, write_u32, write_u64,
};
use bun_engine_text::{CodeUnit, Cursor, MAX_LENGTH, StringBuilder, StringRef, Text};

use crate::{ClampedU8, Cx, Float16, Gc, JsResult, JsString, RootVec, Value, root_vec};

type NumberBuffer = [u8; NUMBER_TEXT_CAPACITY];

pub trait JoinableNumber: Copy {
    /// Returns the length of the decimal text, which starts the buffer.
    fn write(self, out: &mut NumberBuffer) -> usize;
}

macro_rules! joinable_numbers {
    ($($number:ty => $write:ident,)*) => {$(
        impl JoinableNumber for $number {
            #[inline(always)]
            fn write(self, out: &mut NumberBuffer) -> usize {
                $write(self.into(), out)
            }
        }
    )*};
}

joinable_numbers! {
    i8 => write_i32,
    i16 => write_i32,
    u16 => write_u32,
    i32 => write_i32,
    u32 => write_u32,
    i64 => write_i64,
    u64 => write_u64,
    Float16 => write_f64,
    f32 => write_f64,
    f64 => write_f64,
}

impl JoinableNumber for u8 {
    #[inline(always)]
    fn write(self, out: &mut NumberBuffer) -> usize {
        /// The digits, and their number in the last place.
        static TEXTS: [[u8; 4]; 256] = {
            let (mut texts, mut n) = ([[0; 4]; 256], 0);
            while n < texts.len() {
                let (hundreds, tens, ones) = (n / 100, n / 10 % 10, n % 10);
                let [a, b, c] = [b'0' + hundreds as u8, b'0' + tens as u8, b'0' + ones as u8];
                texts[n] = match n {
                    ..10 => [c, 0, 0, 1],
                    10..100 => [b, c, 0, 2],
                    _ => [a, b, c, 3],
                };
                n += 1;
            }
            texts
        };
        let text = TEXTS[usize::from(self)];
        out[..4].copy_from_slice(&text);
        usize::from(text[3] & 3)
    }
}

impl JoinableNumber for ClampedU8 {
    #[inline(always)]
    fn write(self, out: &mut NumberBuffer) -> usize {
        self.0.write(out)
    }
}

/// A separator that is written in one store wherever there is room for that.
#[derive(Clone, Copy)]
pub(super) struct Separator<'a, T> {
    text: Text<'a>,
    padded: [T; SHORT_SEPARATOR],
}

pub(super) const SHORT_SEPARATOR: usize = 8;

impl<'a, T: CodeUnit> Separator<'a, T> {
    #[inline(always)]
    pub(super) fn new(text: Text<'a>) -> Separator<'a, T> {
        let unit = |index| T::from_u16_truncating(text.get(index).unwrap_or_default());
        let padded = core::array::from_fn(unit);
        Separator { text, padded }
    }

    #[inline(always)]
    pub(super) fn write_to(&self, cursor: &mut Cursor<'_, T>) {
        if self.text.len() <= SHORT_SEPARATOR && cursor.has_room(SHORT_SEPARATOR) {
            cursor.push_prefix(&self.padded, self.text.len());
        } else {
            cursor.apart(|cursor| push_apart(self.text, cursor));
        }
    }
}

#[inline(never)]
extern "rust-cold" fn push_apart<T: CodeUnit>(text: Text<'_>, cursor: &mut Cursor<'_, T>) {
    cursor.push_text(text);
}

#[inline(always)]
fn write_number<T: CodeUnit>(number: impl JoinableNumber, cursor: &mut Cursor<'_, T>) {
    if cursor.has_room(NUMBER_TEXT_CAPACITY) {
        return cursor.push_written(|room| number.write(room));
    }
    let mut buffer = [0; NUMBER_TEXT_CAPACITY];
    let length = number.write(&mut buffer);
    cursor.push_text(Text::Latin1(&buffer[..length]));
}

/// Strings of this length are copied only once, when the length of the result is known.
const MIN_DEFERRED_LENGTH: u32 = 256;

/// Puts strings together with a separator between each two.
pub struct StringJoiner<'a> {
    separator: Text<'a>,
    is_empty: bool,
    /// The first element, while it is the only one.
    only: Option<Gc<JsString>>,
    /// All but the deferred strings.
    text: &'a mut StringBuilder,
    /// With the positions in `text` at which they belong.
    deferred: RootVec<(usize, Gc<JsString>)>,
    deferred_length: usize,
}

impl StringJoiner<'_> {
    /// The string of the elements that `push_all` pushes.
    #[inline(always)]
    pub fn join(
        cx: &mut Cx,
        separator: Text<'_>,
        push_all: impl FnOnce(&mut Cx, &mut StringJoiner<'_>) -> JsResult<()>,
    ) -> JsResult<Gc<JsString>> {
        StringBuilder::on_stack::<256, _>(|text| {
            let mut joiner = StringJoiner {
                separator,
                is_empty: true,
                only: None,
                text,
                deferred: root_vec(),
                deferred_length: 0,
            };
            push_all(cx, &mut joiner)?;
            joiner.finish(cx)
        })
    }

    #[inline(always)]
    fn append(&mut self, string: Gc<JsString>) {
        if string.len() < MIN_DEFERRED_LENGTH {
            string.append_to(self.text);
        } else {
            self.defer(string);
        }
    }

    #[inline(never)]
    fn defer(&mut self, string: Gc<JsString>) {
        self.deferred_length += string.len() as usize;
        if self.has_overflowed() || self.deferred.try_reserve(1).is_err() {
            self.deferred_length = MAX_LENGTH + 1;
        } else {
            self.deferred.push((self.text.len(), string));
        }
    }

    /// Whether this is not the first element.
    #[inline(always)]
    fn begin_without_separator(&mut self) -> bool {
        if let Some(first) = self.only.take() {
            self.append(first);
        }
        !core::mem::take(&mut self.is_empty)
    }

    #[inline(always)]
    fn begin(&mut self) {
        if self.begin_without_separator() {
            self.text.push_text(self.separator);
        }
    }

    #[inline(always)]
    fn has_overflowed(&self) -> bool {
        self.text.has_overflowed() || self.text.len() + self.deferred_length > MAX_LENGTH
    }

    #[inline(always)]
    pub fn push_string(&mut self, string: Gc<JsString>) {
        if core::mem::take(&mut self.is_empty) {
            self.only = Some(string);
        } else {
            self.begin();
            self.append(string);
        }
    }

    #[inline(always)]
    pub fn push_number(&mut self, number: impl JoinableNumber) {
        self.begin();
        (self.text).write_latin1(NUMBER_TEXT_CAPACITY, |cursor| write_number(number, cursor));
    }

    /// Asks for each number once.
    pub fn push_numbers(&mut self, mut numbers: impl ExactSizeIterator<Item: JoinableNumber>) {
        const BATCH: usize = 64;

        #[inline(always)]
        fn write_batch<T: CodeUnit>(
            numbers: impl Iterator<Item: JoinableNumber>,
            separator: Text<'_>,
            cursor: &mut Cursor<'_, T>,
        ) {
            let separator = Separator::new(separator);
            for number in numbers {
                separator.write_to(cursor);
                write_number(number, cursor);
            }
        }

        let Some(first) = numbers.next() else { return };
        self.push_number(first);
        let (separator, start, count) = (self.separator, self.text.len(), numbers.len());
        while numbers.len() != 0 && !self.has_overflowed() {
            if count - numbers.len() == BATCH {
                let expected = (self.text.len() - start).saturating_mul(numbers.len()) / BATCH;
                let slack = expected / 16 + BATCH * NUMBER_TEXT_CAPACITY;
                self.text.reserve((expected + slack).min(MAX_LENGTH / 4));
            }
            let batch = numbers.len().min(BATCH);
            let room = batch * (separator.len() + NUMBER_TEXT_CAPACITY);
            let numbers = numbers.by_ref().take(batch);
            if self.text.is_latin1() && separator.is_latin1() {
                (self.text).write_latin1(room, |cursor| write_batch(numbers, separator, cursor));
            } else {
                (self.text).write_utf16(room, |cursor| write_batch(numbers, separator, cursor));
            }
        }
    }

    /// So many empty strings.
    pub fn push_empty(&mut self, count: usize) {
        if count == 0 {
            return;
        }
        let separators = count - usize::from(!self.begin_without_separator());
        let (separator, length) = (
            self.separator,
            separators.saturating_mul(self.separator.len()),
        );
        if length == 0 {
            return;
        }
        if self.text.is_latin1() && separator.is_latin1() {
            (self.text).write_latin1(length, |cursor| cursor.push_pattern(separator, length));
        } else {
            (self.text).write_utf16(length, |cursor| cursor.push_pattern(separator, length));
        }
    }

    /// The empty string for undefined and null, and ToString of anything else.
    #[inline(always)]
    pub fn push(&mut self, cx: &mut Cx, value: Value) -> JsResult<()> {
        if let Some(string) = value.as_string() {
            self.push_string(string);
        } else if let Some(integer) = value.as_int32() {
            self.push_number(integer);
        } else if let Some(number) = value.as_double() {
            self.push_number(number);
        } else if value.is_undefined_or_null() {
            self.begin();
        } else {
            self.push_string(value.to_string(cx)?);
        }
        Ok(())
    }

    fn write_all<T: CodeUnit>(&self) -> Result<StringRef, AllocError> {
        let text = self.text.text();
        StringRef::try_write::<T>(text.len() + self.deferred_length, |cursor| {
            let mut done = 0;
            for &(position, string) in &self.deferred {
                cursor.push_text(text.slice(done..position));
                string.write_to(cursor);
                done = position;
            }
            cursor.push_text(text.slice_from(done));
        })
    }

    fn finish(self, cx: &Cx) -> JsResult<Gc<JsString>> {
        if let Some(only) = self.only {
            return Ok(only);
        }
        let joined = if self.has_overflowed() {
            Err(AllocError)
        } else if self.deferred.is_empty() {
            self.text.take()
        } else if self.text.is_latin1() && self.deferred.iter().all(|it| it.1.is_latin1()) {
            self.write_all::<u8>()
        } else {
            self.write_all::<u16>()
        };
        Ok(JsString::new(cx, cx.or_out_of_memory(joined)?))
    }
}
