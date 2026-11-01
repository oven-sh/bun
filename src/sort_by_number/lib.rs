use core::mem::MaybeUninit;

pub trait SortByNumber<T> {
    fn sort_by_u32(&mut self, number: impl FnMut(&T) -> u32);
    fn sort_by_u64(&mut self, number: impl FnMut(&T) -> u64);
    fn sort_by_u128(&mut self, number: impl FnMut(&T) -> u128);
}

const VERY_SHORT: usize = 8;
const SHORT: usize = 16;

trait Numbered: Copy + Ord {
    const ZERO: Self;
    fn index(self) -> u32;
    fn set_index(&mut self, index: u32);
}

impl Numbered for u64 {
    const ZERO: u64 = 0;
    #[inline]
    fn index(self) -> u32 {
        self as u32
    }
    #[inline]
    fn set_index(&mut self, index: u32) {
        *self = number_of_pair((*self >> 32) as u32, index);
    }
}

macro_rules! pair_is_numbered {
    ($number:ty) => {
        impl Numbered for ($number, u32) {
            const ZERO: ($number, u32) = (0, 0);
            #[inline]
            fn index(self) -> u32 {
                self.1
            }
            #[inline]
            fn set_index(&mut self, index: u32) {
                self.1 = index;
            }
        }
    };
}
pair_is_numbered!(u64);
pair_is_numbered!(u128);

macro_rules! sort {
    ($list:ident, $number:ident, $numbered:ty, $join:expr, $sort_and_move:ident) => {{
        if $list.len() <= VERY_SHORT {
            for end in 1..$list.len() {
                let mut at = end;
                while at > 0 && $number(&$list[at - 1]) > $number(&$list[at]) {
                    $list.swap(at - 1, at);
                    at -= 1;
                }
            }
            return;
        }
        let mut short = [<$numbered>::ZERO; SHORT];
        let mut long = Vec::new();
        let numbered = match short.get_mut(..$list.len()) {
            Some(numbered) => numbered,
            None => {
                long.resize($list.len(), <$numbered>::ZERO);
                &mut long[..]
            }
        };
        for ((element, index), entry) in $list.iter().zip(0..).zip(numbered.iter_mut()) {
            *entry = $join($number(element), index);
        }
        // SAFETY: `numbered` has the index of every element of the list once.
        unsafe { $sort_and_move(numbered, $list.as_mut_ptr().cast(), size_of::<T>()) };
    }};
}

impl<T> SortByNumber<T> for [T] {
    fn sort_by_u32(&mut self, mut number: impl FnMut(&T) -> u32) {
        sort!(self, number, u64, number_of_pair, sort_and_move_by_u32)
    }

    fn sort_by_u64(&mut self, mut number: impl FnMut(&T) -> u64) {
        sort!(
            self,
            number,
            (u64, u32),
            |number, index| (number, index),
            sort_and_move_by_u64
        )
    }

    fn sort_by_u128(&mut self, mut number: impl FnMut(&T) -> u128) {
        sort!(
            self,
            number,
            (u128, u32),
            |number, index| (number, index),
            sort_and_move_by_u128
        )
    }
}

#[inline]
pub const fn number_of_pair(high: u32, low: u32) -> u64 {
    (high as u64) << 32 | low as u64
}

#[inline]
pub const fn wide_number_of_pair(high: u64, low: u64) -> u128 {
    (high as u128) << 64 | low as u128
}

#[inline]
pub const fn number_of_signed(value: i64) -> u64 {
    value as u64 ^ 1 << 63
}

macro_rules! sort_and_move {
    ($name:ident, $numbered:ty) => {
        #[inline(never)]
        unsafe fn $name(numbered: &mut [$numbered], first: *mut MaybeUninit<u8>, size: usize) {
            assert!(u32::try_from(numbered.len()).is_ok());
            numbered.sort_unstable();
            // SAFETY: the caller's.
            unsafe { move_to_places(numbered, first, size) };
        }
    };
}
sort_and_move!(sort_and_move_by_u32, u64);
sort_and_move!(sort_and_move_by_u64, (u64, u32));
sort_and_move!(sort_and_move_by_u128, (u128, u32));

unsafe fn move_to_places<N: Numbered>(order: &mut [N], first: *mut MaybeUninit<u8>, size: usize) {
    // SAFETY: the caller's. An array of bytes has the size of the value and needs no alignment.
    unsafe {
        match size {
            4 => follow_cycles(order, first.cast::<[MaybeUninit<u8>; 4]>(), 1),
            8 => follow_cycles(order, first.cast::<[MaybeUninit<u8>; 8]>(), 1),
            12 => follow_cycles(order, first.cast::<[MaybeUninit<u8>; 12]>(), 1),
            16 => follow_cycles(order, first.cast::<[MaybeUninit<u8>; 16]>(), 1),
            24 => follow_cycles(order, first.cast::<[MaybeUninit<u8>; 24]>(), 1),
            _ => follow_cycles(order, first, size),
        }
    }
}

#[inline(always)]
unsafe fn follow_cycles<N: Numbered, Part>(order: &mut [N], first: *mut Part, count: usize) {
    for start in 0..order.len() {
        let mut place = start;
        loop {
            let from = order[place].index() as usize;
            order[place].set_index(place as u32);
            if from == start {
                break;
            }
            // SAFETY: two different elements of the list. A value is moved by copying its bytes, and nothing runs in between.
            unsafe {
                core::ptr::swap_nonoverlapping(
                    first.add(place * count),
                    first.add(from * count),
                    count,
                )
            };
            place = from;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scrambled(length: u32) -> Vec<u32> {
        (0..length)
            .map(|index| index.wrapping_mul(2_654_435_761) % 97)
            .collect()
    }

    fn agrees_with_the_standard_library<T: Clone + PartialEq + core::fmt::Debug>(
        make: impl Fn(u32, u32) -> T,
        number: impl Fn(&T) -> u32,
    ) {
        for length in [0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 64, 1000] {
            let list: Vec<T> = scrambled(length)
                .into_iter()
                .zip(0..)
                .map(|(number, index)| make(number, index))
                .collect();
            let mut expected = list.clone();
            expected.sort_by_key(&number);
            let mut by_u32 = list.clone();
            by_u32.sort_by_u32(&number);
            assert_eq!(by_u32, expected);
            let mut by_u64 = list.clone();
            by_u64.sort_by_u64(|element| u64::from(number(element)) << 20);
            assert_eq!(by_u64, expected);
            let mut by_u128 = list;
            by_u128.sort_by_u128(|element| u128::from(number(element)) << 70);
            assert_eq!(by_u128, expected);
        }
    }

    #[test]
    fn elements_of_every_size_come_out_as_from_the_stable_sort_of_the_standard_library() {
        agrees_with_the_standard_library(|number, _| number, |&element| element);
        agrees_with_the_standard_library(
            |number, index| (number as u8, index as u16),
            |element| u32::from(element.0),
        );
        agrees_with_the_standard_library(|number, index| (number, index), |element| element.0);
        agrees_with_the_standard_library(
            |number, index| (number, index, index),
            |element| element.0,
        );
        agrees_with_the_standard_library(
            |number, index| (number, u64::from(index)),
            |element| element.0,
        );
        agrees_with_the_standard_library(
            |number, index| (number, u64::from(index), u64::from(index)),
            |element| element.0,
        );
        agrees_with_the_standard_library(|number, index| (number, [index; 9]), |element| element.0);
        agrees_with_the_standard_library(
            |number, index| (number, format!("{index} and a tail that lies on the heap")),
            |element| element.0,
        );
    }

    #[test]
    fn a_number_that_panics_leaves_the_list_as_it_was() {
        let mut texts: Vec<String> = scrambled(100)
            .into_iter()
            .map(|number| number.to_string())
            .collect();
        let before = texts.clone();
        let mut left = 50;
        let outcome = std::panic::catch_unwind(core::panic::AssertUnwindSafe(|| {
            texts.sort_by_u32(|text| {
                left -= 1;
                assert!(left > 0);
                text.len() as u32
            });
        }));
        assert!(outcome.is_err());
        assert_eq!(texts, before);
    }

    #[test]
    fn values_without_size_and_the_numbers_of_pairs() {
        [(); 20].sort_by_u32(|()| 0);
        assert!(number_of_pair(1, 0) > number_of_pair(0, u32::MAX));
        assert!(number_of_pair(7, 2) > number_of_pair(7, 1));
        assert!(wide_number_of_pair(1, 0) > wide_number_of_pair(0, u64::MAX));
        assert!(number_of_signed(i64::MIN) < number_of_signed(-1));
        assert!(number_of_signed(-1) < number_of_signed(0));
        assert!(number_of_signed(0) < number_of_signed(i64::MAX));
    }
}
