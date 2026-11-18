//! The root collation of CLDR for ASCII and the accented letters of Latin-1.

use core::cmp::Ordering;

use bun_engine_text::{CodeUnit, Text, with_text};
use bun_pod::slice_as_bytes;

use crate::latin1::split_accent;

const PRIMARY_ORDER: &[u8] =
    b"\t\n\x0b\x0c\r _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyz";

const PRIMARY_SHIFT: u32 = 8;
const ACCENT_SHIFT: u32 = 1;
const IS_UPPER_CASE: u16 = 1;

/// Zero for a character that this does not order.
static WEIGHTS: [u16; 256] = {
    let mut weights = [0; 256];
    let mut rank = 0;
    while rank < PRIMARY_ORDER.len() {
        let (character, primary) = (PRIMARY_ORDER[rank], (rank as u16 + 1) << PRIMARY_SHIFT);
        weights[character.to_ascii_uppercase() as usize] = primary | IS_UPPER_CASE;
        weights[character as usize] = primary;
        rank += 1;
    }
    let mut character = 0x80;
    while character < weights.len() {
        if let Some((base, accent)) = split_accent(character as u8) {
            weights[character] = weights[base as usize] | (accent as u16 + 1) << ACCENT_SHIFT;
        }
        character += 1;
    }
    weights
};

#[inline(always)]
fn weight<T: CodeUnit>(unit: T) -> Option<u16> {
    let weight = *WEIGHTS.get(usize::from(unit.to_u16()))?;
    (weight != 0).then_some(weight)
}

#[derive(Clone, Copy)]
pub(super) struct RootOrder {
    pub(super) compares_accents: bool,
    /// How a letter in lower case compares to itself in upper case.
    pub(super) lower_to_upper: Ordering,
    pub(super) is_numeric: bool,
}

impl RootOrder {
    /// `None` unless the first characters of two Latin-1 strings that differ decide their order.
    #[inline(always)]
    pub(super) fn decide(self, x: u8, y: u8) -> Option<Ordering> {
        let (x, y) = (WEIGHTS[usize::from(x)], WEIGHTS[usize::from(y)]);
        (x.min(y) != 0 && (x ^ y) >> PRIMARY_SHIFT != 0 && !self.is_numeric).then(|| x.cmp(&y))
    }

    /// `None` if it depends on a character that this does not order.
    #[inline(always)]
    pub(super) fn compare(self, a: Text<'_>, b: Text<'_>) -> Option<Ordering> {
        let (Text::Latin1(a), Text::Latin1(b)) = (a, b) else {
            return self.compare_wide(a, b);
        };
        let common = bun_highway::common_prefix_length(a, b);
        if let (Some(&x), Some(&y)) = (a.get(common), b.get(common))
            && let Some(order) = self.decide(x, y)
        {
            return Some(order);
        }
        self.compare_from(common, a, b)
    }

    fn compare_wide(self, a: Text<'_>, b: Text<'_>) -> Option<Ordering> {
        let common = match (a, b) {
            (Text::Utf16(a), Text::Utf16(b)) => {
                bun_highway::common_prefix_length(slice_as_bytes(a), slice_as_bytes(b)) / 2
            }
            _ => (a.code_units().zip(b.code_units()))
                .take_while(|(a, b)| a == b)
                .count(),
        };
        with_text!(a, |a| with_text!(b, |b| self.compare_from(common, a, b)))
    }

    /// The first `start` units are the same.
    fn compare_from<A: CodeUnit, B: CodeUnit>(
        self,
        mut start: usize,
        a: &[A],
        b: &[B],
    ) -> Option<Ordering> {
        if start == a.len() && start == b.len() {
            return Some(Ordering::Equal);
        }
        if self.is_numeric {
            start -= (a[..start].iter().rev())
                .take_while(|unit| unit.is_ascii_digit())
                .count();
        }
        // Any other character can be the start of a contraction or of a number.
        if !a[..start].last().is_none_or(|unit| unit.is_latin1()) {
            return None;
        }

        let (mut a, mut b) = (&a[start..], &b[start..]);
        let (mut accent_order, mut case_order) = (Ordering::Equal, Ordering::Equal);
        while let ([x, a_rest @ ..], [y, b_rest @ ..]) = (a, b) {
            if self.is_numeric && x.is_ascii_digit() && y.is_ascii_digit() {
                match compare_numbers(take_number(&mut a)?, take_number(&mut b)?) {
                    Ordering::Equal => continue,
                    order => return Some(order),
                }
            }
            let (x, y) = (weight(*x)?, weight(*y)?);
            if (x ^ y) >> PRIMARY_SHIFT != 0 {
                return (is_final(a_rest) && is_final(b_rest)).then(|| x.cmp(&y));
            }
            accent_order = accent_order.then((x >> ACCENT_SHIFT).cmp(&(y >> ACCENT_SHIFT)));
            case_order = case_order.then((x & IS_UPPER_CASE).cmp(&(y & IS_UPPER_CASE)));
            (a, b) = (a_rest, b_rest);
        }
        match (a, b) {
            ([x, ..], _) => weight(*x).map(|_| Ordering::Greater),
            (_, [y, ..]) => weight(*y).map(|_| Ordering::Less),
            _ if self.compares_accents && accent_order.is_ne() => Some(accent_order),
            _ => Some(match case_order {
                Ordering::Less => self.lower_to_upper,
                Ordering::Equal => Ordering::Equal,
                Ordering::Greater => self.lower_to_upper.reverse(),
            }),
        }
    }
}

/// Whether what precedes `rest` cannot combine with it.
#[inline(always)]
fn is_final<T: CodeUnit>(rest: &[T]) -> bool {
    rest.first().is_none_or(|unit| unit.is_latin1())
}

/// The digits that `units` start with, without leading zeros.
fn take_number<'a, T: CodeUnit>(units: &mut &'a [T]) -> Option<&'a [T]> {
    /// A longer number is ordered in pieces.
    const MAX_DIGITS: usize = 254;

    let length = units.iter().take_while(|it| it.is_ascii_digit()).count();
    let (digits, rest) = units.split_at(length);
    let zeros = digits.iter().take_while(|it| it.is(b'0')).count();
    *units = rest;
    (length - zeros <= MAX_DIGITS && is_final(rest)).then_some(&digits[zeros..])
}

fn compare_numbers<A: CodeUnit, B: CodeUnit>(a: &[A], b: &[B]) -> Ordering {
    (a.len().cmp(&b.len())).then_with(|| A::text(a).cmp(&B::text(b)))
}
