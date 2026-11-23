//! The views of a lane as an unsigned integer.

use crate::lane::{AsBits, Repr};

macro_rules! views { ($($t:ident $u:ident;)*) => {$(
    #[test]
    fn $t() {
        let bits: [$u; 3] = [1, 0x41 << (<$u>::BITS - 8) | 2, 0xc1 << (<$u>::BITS - 8) | 3];
        let values = bits.map(|it| $t::from_ne_bytes(it.to_ne_bytes()));
        assert_eq!((values.map(AsBits::as_bits), bits.map($t::of_bits)), (bits, values));
        assert_eq!(($t::unsigned(&values), $t::of_unsigned(&bits)), (&bits[..], &values[..]));
        let (mut a, mut b) = (values, bits);
        $t::unsigned_mut(&mut a).reverse();
        $t::of_unsigned_mut(&mut b)[0] = values[2];
        assert_eq!((a, b), ([values[2], values[1], values[0]], [bits[2], bits[1], bits[2]]));
    }
)*}; }
views! { u8 u8; i8 u8; u16 u16; i16 u16; u32 u32; i32 u32; f32 u32; u64 u64; i64 u64; f64 u64; }
