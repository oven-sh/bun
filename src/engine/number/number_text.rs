use core::fmt;
use core::ops::Deref;

use bun_engine_text::Text;

use crate::{write_f64, write_i32, write_i64, write_u32, write_u64};

/// The room that the `write_*` functions need. They store whole words, so this is more than the longest text.
pub const NUMBER_TEXT_CAPACITY: usize = 32;

/// Number::toString of ECMA-262 in radix 10, made by `from`.
#[derive(Clone, Copy)]
pub struct NumberText {
    bytes: [u8; NUMBER_TEXT_CAPACITY],
    length: usize,
}

impl NumberText {
    #[inline(always)]
    fn written_by(write: impl FnOnce(&mut [u8; NUMBER_TEXT_CAPACITY]) -> usize) -> NumberText {
        let mut scratch = [[0; NUMBER_TEXT_CAPACITY]; 2];
        let length = write(&mut scratch[0]);
        // Always the first. Loads that wait for the length are not mistaken for reads of the zeros and then redone.
        let bytes = scratch[length / NUMBER_TEXT_CAPACITY % 2];
        NumberText { bytes, length }
    }

    #[inline]
    pub fn text(&self) -> Text<'_> {
        Text::Latin1(self)
    }
}

impl Deref for NumberText {
    type Target = [u8];

    #[inline]
    fn deref(&self) -> &[u8] {
        &self.bytes[..self.length]
    }
}

impl fmt::Display for NumberText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.text().fmt(formatter)
    }
}

macro_rules! from_numbers {
    ($($number:ty => $write:ident,)*) => {$(
        impl From<$number> for NumberText {
            #[inline]
            fn from(number: $number) -> NumberText {
                NumberText::written_by(|out| $write(number, out))
            }
        }
    )*};
}

from_numbers! {
    f64 => write_f64,
    i32 => write_i32,
    u32 => write_u32,
    i64 => write_i64,
    u64 => write_u64,
}
