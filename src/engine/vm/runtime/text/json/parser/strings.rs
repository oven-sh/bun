//! The strings that have been made since the last collection, because values repeat.

use bun_alloc::AllocError;
use bun_engine_text::{Atom, CodeUnit, StringRef, Text, equal_units, with_text};

use crate::{Gc, JsString, Vm};

pub(super) const SHORT: usize = 16;
const LONGEST: usize = 256;
const COUNT: usize = 256;

/// ASCII without control characters, and zeros after it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct ShortText([u64; 2]);

impl ShortText {
    /// The first `length` characters, none of which is a control character.
    #[inline(always)]
    pub(super) fn new(characters: &[u8; SHORT], length: u32) -> ShortText {
        let kept = u128::from_le_bytes(*characters) & KEPT[length as usize];
        ShortText([kept as u64, (kept >> 64) as u64])
    }

    #[inline(always)]
    fn slot(self) -> usize {
        let folded = self.0[0] ^ self.0[1].rotate_left(29);
        (folded.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> (u64::BITS - COUNT.ilog2())) as usize
    }
}

#[derive(Clone, Copy)]
#[repr(C, align(32))]
struct Short {
    text: ShortText,
    string: usize,
}

pub(super) struct Strings {
    short: [Short; COUNT],
    /// The address, under some more bits of the hash.
    long: [u64; COUNT],
}

const VACANT: Short = Short {
    text: ShortText([1, 0]),
    string: 0,
};

impl Default for Strings {
    fn default() -> Strings {
        Strings {
            short: [VACANT; COUNT],
            long: [0; COUNT],
        }
    }
}

#[inline(always)]
fn mix(a: u64, b: u64) -> u64 {
    let product = u128::from(a ^ 0x2d35_8dcc_aa6c_78a5) * u128::from(b ^ 0x8bb8_4b93_962e_acc9);
    product as u64 ^ (product >> 64) as u64
}

static KEPT: [u128; SHORT + 1] = {
    let mut masks = [u128::MAX; SHORT + 1];
    let mut length = 0;
    while length < SHORT {
        masks[length] = (1 << (8 * length)) - 1;
        length += 1;
    }
    masks
};

impl Strings {
    pub(super) fn clear(&mut self) {
        self.short.fill(VACANT);
        self.long.fill(0);
    }

    #[inline(always)]
    pub(super) fn find_short(&self, text: ShortText) -> Option<Gc<JsString>> {
        let entry = &self.short[text.slot()];
        // SAFETY: made since the last collection.
        (entry.text == text).then(|| unsafe { Gc::from_address(entry.string) })
    }

    #[inline(always)]
    pub(super) fn add_short(
        &mut self,
        vm: &Vm,
        text: ShortText,
    ) -> Result<Gc<JsString>, AllocError> {
        /// What fills the two smallest blocks that have room for the header.
        const SMALL: usize = 12;
        const LARGE: usize = 28;
        let characters = u128::from(text.0[1]) << 64 | u128::from(text.0[0]);
        let length = SHORT - characters.leading_zeros() as usize / 8;
        let mut bytes = [0; LARGE];
        bytes[..SHORT].copy_from_slice(&characters.to_le_bytes());
        // What a script compares it with, or uses it for, is likely to be a name.
        let string = match (
            Atom::find(Text::Latin1(&bytes[..length])),
            bytes.first_chunk(),
        ) {
            (Some(atom), _) => atom.into_string(),
            (None, Some(few)) if length <= SMALL => {
                StringRef::try_from_prefix::<_, SMALL>(few, length)?
            }
            _ => StringRef::try_from_prefix(&bytes, length)?,
        };
        let string = JsString::new(vm, string);
        self.short[text.slot()] = Short {
            text,
            string: string.address(),
        };
        Ok(string)
    }

    /// UTF-16 if `is_wide` and it is neither short nor known as a key, or else Latin-1 if the characters allow it.
    #[inline(always)]
    pub(super) fn any(
        &mut self,
        vm: &Vm,
        text: Text<'_>,
        is_wide: bool,
    ) -> Result<Gc<JsString>, AllocError> {
        with_text!(text, |units| self.of_units(vm, units, is_wide))
    }

    #[inline(always)]
    fn of_units<T: CodeUnit>(
        &mut self,
        vm: &Vm,
        units: &[T],
        is_wide: bool,
    ) -> Result<Gc<JsString>, AllocError> {
        const ADDRESS_BITS: u32 = 48;
        let (text, is_short) = (T::text(units), units.len() <= SHORT);
        let create = || {
            let string = if is_wide && !is_short {
                StringRef::try_write::<u16>(text.len(), |cursor| cursor.push_text(text))
            } else {
                StringRef::try_narrowed(text)
            };
            Ok(JsString::new(vm, string?))
        };
        if !(2..=LONGEST).contains(&units.len()) {
            return create();
        }
        let hash = sample(bun_pod::slice_as_bytes(units));
        let entry = &mut self.long[hash as usize % COUNT];
        let address = *entry ^ hash >> ADDRESS_BITS << ADDRESS_BITS;
        if address >> ADDRESS_BITS == 0 && address != 0 {
            // SAFETY: made since the last collection.
            let string = unsafe { Gc::<JsString>::from_address(address as usize) };
            let fits = |cached: Text<'_>| {
                (is_short || cached.is_latin1() != is_wide || string.is_atom())
                    && with_text!(cached, |cached| equal_units(cached, units))
            };
            if string.try_impl().is_some_and(|it| fits(it.text())) {
                return Ok(string);
            }
        }
        let string = create()?;
        *entry = hash >> ADDRESS_BITS << ADDRESS_BITS | string.address() as u64;
        Ok(string)
    }
}

/// A hash of the length and of some of the bytes, which are two or more.
#[inline(always)]
fn sample(bytes: &[u8]) -> u64 {
    let length = bytes.len();
    let (Some(head), Some(tail)) = (bytes.first_chunk(), bytes.last_chunk()) else {
        let few = [0, 1, length / 2 - 1, length / 2, length - 2, length - 1];
        let few = few
            .iter()
            .fold(0, |word, &at| word << 8 | u64::from(bytes[at]));
        return mix(few, length as u64);
    };
    let middle = bytes[length / 2 - 4..].first_chunk().unwrap_or(head);
    let [head, middle, tail] = [head, middle, tail].map(|it| u64::from_le_bytes(*it));
    mix(head ^ middle.rotate_left(20), tail ^ (length as u64) << 7)
}
