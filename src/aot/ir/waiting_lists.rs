//! Lists of plain records that nothing reads for a while, packed.

use bun_core::ffi::zeroed;
use bun_core::{Pod, slice_as_bytes, slice_as_bytes_mut};

/// The 64 bits at `index`, with zeros behind the end.
#[inline]
fn group_at(plain: &[u8], index: usize) -> u64 {
    match plain[8 * index..].first_chunk::<8>() {
        Some(group) => u64::from_le_bytes(*group),
        None => {
            let mut group = [0; 8];
            group[..plain.len() - 8 * index].copy_from_slice(&plain[8 * index..]);
            u64::from_le_bytes(group)
        }
    }
}

/// The records hold small numbers and ids that are none more than anything else. For each 16 bits, two bits say what
/// follows: nothing for 0, nothing for 0xffff, one byte, or two. The bits of all come first, a byte for 64 bits. Two
/// bytes that mean nothing come last, so that two can be read wherever one counts.
fn pack(plain: &[u8]) -> Box<[u8]> {
    let groups = plain.len().div_ceil(8);
    let mut packed: Vec<u8> = Vec::with_capacity(groups + 8 * groups + 2);
    let first = packed.as_mut_ptr();
    // SAFETY: there is room for the bits, for two bytes for each 16 bits, and for two more. All that counts is written.
    unsafe {
        let mut next = first.add(groups);
        for index in 0..groups {
            let group = group_at(plain, index);
            let mut codes = 0;
            for place in 0..4 {
                let number = (group >> (16 * place)) as u16;
                let is_written = usize::from(number.wrapping_add(1) > 1);
                let is_wide = usize::from(number > 0xff) & is_written;
                codes |= (is_written << 1 | is_wide | usize::from(number == 0xffff)) << (2 * place);
                next.cast::<[u8; 2]>().write_unaligned(number.to_le_bytes());
                next = next.add(is_written + is_wide);
            }
            first.add(index).write(codes as u8);
        }
        next.cast::<[u8; 2]>().write_unaligned([0; 2]);
        packed.set_len(next.offset_from_unsigned(first) + 2);
    }
    packed.into_boxed_slice()
}

fn unpack(packed: &[u8], plain: &mut [u8]) {
    const KEPT: [u16; 4] = [0, 0, 0xff, 0xffff];
    const ADDED: [u16; 4] = [0, 0xffff, 0, 0];
    const LENGTH: [usize; 4] = [0, 0, 1, 2];
    let groups = plain.len().div_ceil(8);
    let mut next = groups;
    for index in 0..groups {
        let codes = packed[index] as usize;
        let mut group = 0u64;
        for place in 0..4 {
            let code = codes >> (2 * place) & 3;
            let read = u16::from_le_bytes([packed[next], packed[next + 1]]);
            group |= u64::from(read & KEPT[code] | ADDED[code]) << (16 * place);
            next += LENGTH[code];
        }
        let rest = &mut plain[8 * index..];
        let count = rest.len().min(8);
        rest[..count].copy_from_slice(&group.to_le_bytes()[..count]);
    }
}

/// A record with room between its fields, or with fields that only some of its values have. Nobody may read those bytes,
/// and packing reads every byte, so the record waits as numbers.
pub trait AsNumbers: Copy {
    type Numbers: Pod;

    fn to_numbers(self) -> Self::Numbers;
    fn from_numbers(numbers: Self::Numbers) -> Self;
}

/// What `take` and `take_as_numbers` have taken, in order. `give_back` and `give_back_from_numbers` are called as often,
/// in the same order, for lists of the same types.
#[derive(Clone, Default)]
pub struct WaitingLists {
    /// Each with the number of its records.
    lists: Vec<(Box<[u8]>, usize)>,
    given_back: usize,
}

impl WaitingLists {
    pub fn take<T: Pod>(&mut self, list: &mut Vec<T>) {
        self.lists.push((pack(slice_as_bytes(list)), list.len()));
        *list = Vec::new();
    }

    pub fn give_back<T: Pod>(&mut self, list: &mut Vec<T>) {
        let (packed, count) = core::mem::take(&mut self.lists[self.given_back]);
        self.given_back += 1;
        *list = vec![zeroed(); count];
        unpack(&packed, slice_as_bytes_mut(list));
    }

    pub fn take_as_numbers<T: AsNumbers>(&mut self, list: &mut Vec<T>) {
        let records = core::mem::take(list).into_iter();
        self.take(&mut records.map(T::to_numbers).collect());
    }

    pub fn give_back_from_numbers<T: AsNumbers>(&mut self, list: &mut Vec<T>) {
        let mut numbers = Vec::new();
        self.give_back(&mut numbers);
        *list = numbers.into_iter().map(T::from_numbers).collect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_come_back_as_they_were() {
        let numbers: Vec<u32> = vec![0, 1, 0xff, 0x100, 0xffff, 0x1_0000, u32::MAX, u32::MAX - 1];
        let pairs: Vec<[u16; 3]> = vec![[1, 2, 3], [0, 0xffff, 0], [0xff, 0x100, 0xfffe]];
        let bytes: Vec<u8> = vec![7, 0, 0xff];
        let none: Vec<u64> = Vec::new();
        let (mut a, mut b, mut c, mut d) =
            (numbers.clone(), pairs.clone(), bytes.clone(), none.clone());
        let mut waiting = WaitingLists::default();
        waiting.take(&mut a);
        waiting.take(&mut b);
        waiting.take(&mut c);
        waiting.take(&mut d);
        assert!(a.is_empty() && b.is_empty() && c.is_empty());
        waiting.give_back(&mut a);
        waiting.give_back(&mut b);
        waiting.give_back(&mut c);
        waiting.give_back(&mut d);
        assert_eq!((a, b, c, d), (numbers, pairs, bytes, none));
    }

    /// A byte of padding, and a number that only `Some` has.
    #[derive(Copy, Clone, PartialEq, Debug)]
    struct WithGaps(u8, u16, Option<u32>);

    impl AsNumbers for WithGaps {
        type Numbers = [u32; 3];

        fn to_numbers(self) -> [u32; 3] {
            let WithGaps(byte, short, optional) = self;
            let small =
                u32::from(byte) | u32::from(short) << 8 | u32::from(optional.is_some()) << 24;
            [small, optional.unwrap_or(0), 0]
        }

        fn from_numbers([small, optional, _]: [u32; 3]) -> WithGaps {
            WithGaps(
                small as u8,
                (small >> 8) as u16,
                (small >> 24 != 0).then_some(optional),
            )
        }
    }

    #[test]
    fn records_with_gaps_come_back_as_they_were() {
        let records = vec![
            WithGaps(1, 2, None),
            WithGaps(0xff, 0xffff, Some(0)),
            WithGaps(0, 0, Some(u32::MAX)),
        ];
        let numbers: Vec<u32> = vec![5, 6];
        let (mut a, mut b, mut c) = (records.clone(), numbers.clone(), Vec::<WithGaps>::new());
        let mut waiting = WaitingLists::default();
        waiting.take_as_numbers(&mut a);
        waiting.take(&mut b);
        waiting.take_as_numbers(&mut c);
        assert!(a.is_empty() && b.is_empty());
        waiting.give_back_from_numbers(&mut a);
        waiting.give_back(&mut b);
        waiting.give_back_from_numbers(&mut c);
        assert_eq!((a, b, c), (records, numbers, Vec::new()));
    }

    #[test]
    fn small_numbers_take_a_third() {
        let packed = pack(&[5u32; 400].map(u32::to_le_bytes).concat());
        assert_eq!(packed.len(), 200 + 400 + 2);
    }
}
