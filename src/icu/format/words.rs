//! Reads that give 0 past the end, where sound data never lead.

/// Little-endian 16-bit units.
#[derive(Clone, Copy, Default)]
pub struct Words<'a>(&'a [[u8; 2]]);

impl<'a> Words<'a> {
    #[inline]
    pub fn of(bytes: &'a [u8]) -> Self {
        Self(bytes.as_chunks().0)
    }

    #[inline]
    pub(crate) fn get(self, index: usize) -> Option<u16> {
        self.0.get(index).map(|&unit| u16::from_le_bytes(unit))
    }

    #[inline]
    pub fn at(self, index: usize) -> u16 {
        self.get(index).unwrap_or(0)
    }

    #[inline]
    pub fn index_at(self, index: usize) -> usize {
        self.at(index).into()
    }

    #[inline]
    pub fn from(self, start: usize) -> Self {
        Self(self.0.get(start..).unwrap_or_default())
    }

    #[inline]
    pub(crate) fn part(self, start: usize, length: usize) -> Self {
        Self(self.0.get(start..start + length).unwrap_or_default())
    }

    #[inline]
    pub fn iter(self) -> impl ExactSizeIterator<Item = u16> {
        self.0.iter().map(|&unit| u16::from_le_bytes(unit))
    }

    #[inline]
    pub(crate) fn chunk_at<const N: usize>(self, start: usize) -> Option<&'a [[u8; 2]; N]> {
        self.0.get(start..start + N)?.first_chunk()
    }

    #[inline]
    pub fn as_bytes(self) -> &'a [u8] {
        self.0.as_flattened()
    }
}

pub(crate) trait Slots<T> {
    fn at(&self, index: usize) -> T;
    fn put(&mut self, index: usize, value: T);
}

impl<T: Copy + Default> Slots<T> for [T] {
    #[inline(always)]
    fn at(&self, index: usize) -> T {
        self.get(index).copied().unwrap_or_default()
    }

    #[inline(always)]
    fn put(&mut self, index: usize, value: T) {
        debug_assert!(index < self.len());
        if let Some(slot) = self.get_mut(index) {
            *slot = value;
        }
    }
}

/// Takes a length from the start of `bytes`: the sum of the bytes up to the first that is not 255.
#[inline]
pub(crate) fn take_length(bytes: &mut &[u8]) -> usize {
    let mut length = 0;
    while let Some((&byte, rest)) = bytes.split_first() {
        (*bytes, length) = (rest, length + usize::from(byte));
        if byte != 255 {
            break;
        }
    }
    length
}

/// Takes a number from the start of `bytes`: seven bits a byte, the lowest first, and the top bit if more follow.
#[inline]
pub(crate) fn take_number(bytes: &mut &[u8]) -> usize {
    let (mut number, mut shift) = (0, 0);
    while let Some((&byte, rest)) = bytes.split_first() {
        *bytes = rest;
        number |= usize::from(byte & 0x7f).wrapping_shl(shift);
        shift += 7;
        if byte < 0x80 {
            break;
        }
    }
    number
}

#[inline]
pub(crate) fn take_bytes<'a>(bytes: &mut &'a [u8], count: usize) -> &'a [u8] {
    let taken;
    (taken, *bytes) = bytes.split_at_checked(count).unwrap_or_default();
    taken
}
