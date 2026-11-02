use core::fmt;
use core::marker::PhantomData;
use core::ops::{BitAnd, BitAndAssign, BitOr, BitOrAssign, Not};

pub use bun_core_macros::EnumSetType;

/// An enum whose variants can be in an [`EnumSet`]. `#[derive(EnumSetType)]` implements it.
pub trait EnumSetType: Copy + Eq + 'static {
    /// The narrowest unsigned integer with a bit for every variant.
    type Bits: Copy
        + Eq
        + Into<u64>
        + BitAnd<Output = Self::Bits>
        + BitOr<Output = Self::Bits>
        + Not<Output = Self::Bits>;
    const NO_BITS: Self::Bits;
    const ALL_BITS: Self::Bits;
    /// In declaration order, which is also the order of the bits.
    const VARIANTS: &'static [Self];

    fn bit(self) -> Self::Bits;
}

#[doc = include_str!("enum_set.md")]
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct EnumSet<T: EnumSetType>(T::Bits);

impl<T: EnumSetType> EnumSet<T> {
    #[inline(always)]
    pub const fn empty() -> Self {
        Self(T::NO_BITS)
    }

    #[inline(always)]
    pub const fn all() -> Self {
        Self(T::ALL_BITS)
    }

    #[inline(always)]
    pub fn only(value: T) -> Self {
        Self(value.bit())
    }

    /// Bits that belong to no variant are dropped.
    #[inline(always)]
    pub fn from_bits_truncate(bits: T::Bits) -> Self {
        Self(bits & T::ALL_BITS)
    }

    #[inline(always)]
    pub const fn bits(self) -> T::Bits {
        self.0
    }

    #[inline(always)]
    pub fn len(self) -> usize {
        self.0.into().count_ones() as usize
    }

    #[inline(always)]
    pub fn contains(self, value: T) -> bool {
        self.0 & value.bit() != T::NO_BITS
    }

    #[inline(always)]
    pub fn insert(&mut self, value: T) {
        self.0 = self.0 | value.bit();
    }

    #[inline(always)]
    pub fn remove(&mut self, value: T) {
        self.0 = self.0 & !value.bit();
    }

    #[inline(always)]
    pub fn set(&mut self, value: T, present: bool) {
        if present {
            self.insert(value);
        } else {
            self.remove(value);
        }
    }

    /// In declaration order.
    #[inline]
    pub fn iter(self) -> Iter<T> {
        self.into_iter()
    }
}

impl<T: EnumSetType> Default for EnumSet<T> {
    #[inline(always)]
    fn default() -> Self {
        Self::empty()
    }
}

impl<T: EnumSetType> From<T> for EnumSet<T> {
    #[inline(always)]
    fn from(value: T) -> Self {
        Self::only(value)
    }
}

impl<T: EnumSetType, Rhs: Into<EnumSet<T>>> BitOr<Rhs> for EnumSet<T> {
    type Output = Self;

    #[inline(always)]
    fn bitor(self, rhs: Rhs) -> Self {
        Self(self.0 | rhs.into().0)
    }
}

impl<T: EnumSetType, Rhs: Into<EnumSet<T>>> BitOrAssign<Rhs> for EnumSet<T> {
    #[inline(always)]
    fn bitor_assign(&mut self, rhs: Rhs) {
        self.0 = self.0 | rhs.into().0;
    }
}

impl<T: EnumSetType, Rhs: Into<EnumSet<T>>> BitAndAssign<Rhs> for EnumSet<T> {
    #[inline(always)]
    fn bitand_assign(&mut self, rhs: Rhs) {
        self.0 = self.0 & rhs.into().0;
    }
}

impl<T: EnumSetType> Not for EnumSet<T> {
    type Output = Self;

    #[inline(always)]
    fn not(self) -> Self {
        Self(!self.0 & T::ALL_BITS)
    }
}

impl<T: EnumSetType + fmt::Debug> fmt::Debug for EnumSet<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("EnumSet(")?;
        for (i, variant) in self.iter().enumerate() {
            if i != 0 {
                f.write_str(" | ")?;
            }
            variant.fmt(f)?;
        }
        f.write_str(")")
    }
}

pub struct Iter<T>(u64, PhantomData<T>);

impl<T: EnumSetType> Iterator for Iter<T> {
    type Item = T;

    #[inline]
    fn next(&mut self) -> Option<T> {
        // Zero has 64 trailing zeros, which is past the last variant.
        let first = *T::VARIANTS.get(self.0.trailing_zeros() as usize)?;
        self.0 &= self.0 - 1;
        Some(first)
    }
}

impl<T: EnumSetType> IntoIterator for EnumSet<T> {
    type Item = T;
    type IntoIter = Iter<T>;

    #[inline]
    fn into_iter(self) -> Iter<T> {
        Iter(self.0.into(), PhantomData)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Copy, PartialEq, Eq, Debug, EnumSetType)]
    enum Color {
        Red,
        Green,
        Blue,
    }
    use Color::{Blue, Green, Red};

    #[test]
    fn empty_and_all_are_constants() {
        const NONE: EnumSet<Color> = EnumSet::empty();
        const ALL: EnumSet<Color> = EnumSet::all();
        assert_eq!(NONE.bits(), 0);
        assert_eq!(ALL.bits(), 0b111);
        assert_eq!(EnumSet::<Color>::default(), NONE);
        assert_eq!(NONE.len(), 0);
        assert_eq!(ALL.len(), 3);
    }

    #[test]
    fn a_variant_is_the_bit_at_its_position() {
        assert_eq!(EnumSet::only(Red).bits(), 0b001);
        assert_eq!(EnumSet::only(Green).bits(), 0b010);
        assert_eq!(EnumSet::from(Blue).bits(), 0b100);
    }

    #[test]
    fn insert_and_remove_touch_one_variant() {
        let mut set = EnumSet::only(Green);
        set.insert(Blue);
        set.insert(Blue);
        assert_eq!(
            [Red, Green, Blue].map(|color| set.contains(color)),
            [false, true, true]
        );
        set.remove(Green);
        set.remove(Red);
        assert_eq!(set, EnumSet::only(Blue));
    }

    #[test]
    fn set_inserts_or_removes() {
        let mut set = EnumSet::only(Green);
        set.set(Blue, true);
        set.set(Green, false);
        set.set(Red, false);
        set.set(Blue, true);
        assert_eq!(set, EnumSet::only(Blue));
    }

    #[test]
    fn operators_take_a_variant_or_a_set() {
        assert_eq!((Red | Blue).bits(), 0b101);
        assert_eq!((Red | EnumSet::only(Blue)).bits(), 0b101);
        assert_eq!((EnumSet::only(Red) | Blue).bits(), 0b101);
        assert_eq!((EnumSet::only(Red) | EnumSet::only(Blue)).bits(), 0b101);
        assert_eq!((Red | Green | Blue), EnumSet::all());

        let mut set = EnumSet::empty();
        set |= Green;
        set |= Red | Blue;
        assert_eq!(set, EnumSet::all());
        set &= Red | Green;
        assert_eq!(set.bits(), 0b011);
        set &= Green;
        assert_eq!(set.bits(), 0b010);
        set &= !EnumSet::from(Green);
        assert_eq!(set, EnumSet::empty());
    }

    #[test]
    fn complement_stays_within_the_variants() {
        assert_eq!((!EnumSet::<Color>::empty()).bits(), 0b111);
        assert_eq!((!EnumSet::<Color>::all()).bits(), 0);
        assert_eq!((!EnumSet::only(Green)).bits(), 0b101);
    }

    #[test]
    fn from_bits_truncate_drops_bits_of_no_variant() {
        assert_eq!(
            EnumSet::<Color>::from_bits_truncate(0b1111_1010),
            EnumSet::only(Green)
        );
        assert_eq!(EnumSet::<Color>::from_bits_truncate(0b101), Red | Blue);
    }

    #[test]
    fn iterates_in_declaration_order() {
        let set = Blue | Red;
        assert_eq!(set.iter().collect::<Vec<_>>(), [Red, Blue]);
        assert_eq!(set.into_iter().collect::<Vec<_>>(), [Red, Blue]);
        assert_eq!(
            EnumSet::<Color>::all().iter().collect::<Vec<_>>(),
            [Red, Green, Blue]
        );
        assert_eq!(EnumSet::<Color>::empty().iter().next(), None);
    }

    #[test]
    fn debug_lists_the_members() {
        assert_eq!(format!("{:?}", Blue | Red), "EnumSet(Red | Blue)");
        assert_eq!(format!("{:#?}", Blue | Red), "EnumSet(Red | Blue)");
        assert_eq!(format!("{:?}", EnumSet::only(Green)), "EnumSet(Green)");
        assert_eq!(format!("{:?}", EnumSet::<Color>::empty()), "EnumSet()");
    }

    /// `let all: $bits` does not compile if the derive chose another width.
    macro_rules! assert_width {
        ($bits:ty, $all:expr, $last:ident: $($variant:ident)*) => {{
            #[derive(Clone, Copy, PartialEq, Eq, Debug, EnumSetType)]
            enum E { $($variant),* }
            let all: $bits = EnumSet::<E>::all().bits();
            assert_eq!(all, $all);
            assert_eq!(EnumSet::only(E::$last).bits(), all ^ (all >> 1));
            assert_eq!(!EnumSet::<E>::empty(), EnumSet::all());
            assert_eq!(EnumSet::<E>::all().iter().last(), Some(E::$last));
            assert_eq!(EnumSet::<E>::all().len(), E::VARIANTS.len());
        }};
    }

    #[test]
    fn bits_are_the_narrowest_integer_that_fits() {
        assert_width!(u8, 1, A: A);
        assert_width!(u8, u8::MAX, H: A B C D E F G H);
        assert_width!(u16, 0x1ff, I: A B C D E F G H I);
        assert_width!(u16, u16::MAX, P: A B C D E F G H I J K L M N O P);
        assert_width!(u32, 0x1_ffff, Q: A B C D E F G H I J K L M N O P Q);
        assert_width!(u32, u32::MAX, B15:
            A0 A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A14 A15
            B0 B1 B2 B3 B4 B5 B6 B7 B8 B9 B10 B11 B12 B13 B14 B15);
        assert_width!(u64, 0x1_ffff_ffff, C0:
            A0 A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A14 A15
            B0 B1 B2 B3 B4 B5 B6 B7 B8 B9 B10 B11 B12 B13 B14 B15 C0);
        assert_width!(u64, u64::MAX, D15:
            A0 A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A14 A15
            B0 B1 B2 B3 B4 B5 B6 B7 B8 B9 B10 B11 B12 B13 B14 B15
            C0 C1 C2 C3 C4 C5 C6 C7 C8 C9 C10 C11 C12 C13 C14 C15
            D0 D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12 D13 D14 D15);
    }

    #[test]
    fn explicit_discriminants_that_count_up_from_zero_are_accepted() {
        #[repr(u8)]
        #[derive(Clone, Copy, PartialEq, Eq, Debug, EnumSetType)]
        enum Explicit {
            Zero = 0,
            One = 1,
        }
        assert_eq!((Explicit::Zero | Explicit::One).bits(), 0b11);
    }
}
