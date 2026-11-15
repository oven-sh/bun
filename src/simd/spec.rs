//! What the ops mean, at each width. Where the targets are free to differ, these panic.

macro_rules! portable {
    ($bytes:literal, $name:ident) => {
        pub use super::portable as x128;
        use core::marker::PhantomData;
        every_target!(portable, $bytes, false, $name);
        interleave_in_registers!(portable);
        bits_of_each_mask!(portable);

        #[derive(Clone, Copy)]
        pub struct Vec<T>([u8; BYTES], PhantomData<T>);

        #[derive(Clone, Copy)]
        pub struct F32([f32; BYTES / 4]);

        /// One bit per lane.
        #[derive(Clone, Copy)]
        pub struct Mask<T>(u64, PhantomData<T>);

        /// Bit `i` of the result is the parity of bits `0..=i`.
        #[ops(portable)]
        pub fn prefix_xor(bits: u64) -> u64 {
            (0..64).fold(0, |parity, shift| parity ^ bits << shift)
        }

        #[ops(portable)]
        impl<T: Lane> Vec<T> {
            fn from_fn(f: impl Fn(usize) -> u64) -> Self {
                let mut bytes = [0; BYTES];
                for (i, lane) in bytes.chunks_exact_mut(size_of::<T>()).enumerate() {
                    lane.copy_from_slice(&f(i).to_le_bytes()[..size_of::<T>()]);
                }
                Self(bytes, PhantomData)
            }
            fn bits(self, i: usize) -> u64 {
                let mut bytes = [0; 8];
                bytes[..size_of::<T>()]
                    .copy_from_slice(&self.0[i * size_of::<T>()..][..size_of::<T>()]);
                u64::from_le_bytes(bytes)
            }
            fn value(self, i: usize) -> i128 {
                let unused = 64 - T::BITS;
                if T::SIGNED {
                    ((self.bits(i) << unused) as i64 >> unused).into()
                } else {
                    self.bits(i).into()
                }
            }
            fn zip(self, other: impl Operand<T>, f: impl Fn(i128, i128) -> i128) -> Self {
                let other = Self::of(other);
                Self::from_fn(|i| f(self.value(i), other.value(i)) as u64)
            }
            fn test(self, other: impl Operand<T>, f: impl Fn(i128, i128) -> bool) -> Mask<T> {
                let other = Self::of(other);
                Mask(
                    (0..Self::LANES)
                        .map(|i| u64::from(f(self.value(i), other.value(i))) << i)
                        .sum(),
                    PhantomData,
                )
            }

            fn load_nth<S: Source<BYTES, T>, const K: usize, const I: usize>(
                from: &[S; K],
            ) -> Self {
                match S::either(from) {
                    Ok(lanes) => Self::from_fn(|i| lanes[I].as_ref()[i].bits()),
                    Err(bytes) => Self(bytes[I].each_ref().map(Unit::get), PhantomData),
                }
            }
            pub fn lanes(self) -> Lanes<T> {
                let mut lanes = Lanes::<T>::zeros();
                for (i, lane) in lanes.as_mut().iter_mut().enumerate() {
                    *lane = T::from_bits(self.bits(i));
                }
                lanes
            }
            pub fn zero() -> Self {
                Self([0; BYTES], PhantomData)
            }
            fn filled(lane: T) -> Self {
                Self::from_fn(|_| lane.bits())
            }
            pub fn splat(lane: T) -> Self {
                Self::filled(lane)
            }
            /// The same bytes.
            pub fn cast<U: Lane>(self) -> Vec<U> {
                Vec(self.0, PhantomData)
            }
            fn and(self, other: impl Operand<T>) -> Self {
                self.zip(other, |a, b| a & b)
            }
            fn or(self, other: impl Operand<T>) -> Self {
                self.zip(other, |a, b| a | b)
            }
            fn xor(self, other: impl Operand<T>) -> Self {
                self.zip(other, |a, b| a ^ b)
            }
            fn add(self, other: impl Operand<T>) -> Self {
                self.zip(other, |a, b| a + b)
            }
            fn sub(self, other: impl Operand<T>) -> Self {
                self.zip(other, |a, b| a - b)
            }
            pub fn min(self, other: impl Operand<T>) -> Self {
                self.zip(other, i128::min)
            }
            pub fn max(self, other: impl Operand<T>) -> Self {
                self.zip(other, i128::max)
            }
            fn saturated(value: i128) -> i128 {
                let min = if T::SIGNED { -1 << (T::BITS - 1) } else { 0 };
                value.clamp(min, min + (1 << T::BITS) - 1)
            }
            pub fn saturating_add(self, other: impl Operand<T>) -> Self {
                self.zip(other, |a, b| Self::saturated(a + b))
            }
            pub fn saturating_sub(self, other: impl Operand<T>) -> Self {
                self.zip(other, |a, b| Self::saturated(a - b))
            }
            /// By fewer bits than a lane has.
            fn shl(self, bits: u32) -> Self {
                assert!(bits < T::BITS);
                Self::from_fn(|i| self.bits(i) << bits)
            }
            /// By fewer bits than a lane has.
            fn shr(self, bits: u32) -> Self {
                assert!(bits < T::BITS);
                Self::from_fn(|i| (self.value(i) >> bits) as u64)
            }
            /// a0 b0 a1 b1 .., the first half of it and the second.
            pub fn interleave(self, other: Self) -> (Self, Self) {
                let from =
                    |first: usize| Self::from_fn(|i| [self, other][i % 2].bits(first + i / 2));
                (from(0), from(Self::LANES / 2))
            }
            pub fn eq(self, other: impl Operand<T>) -> Mask<T> {
                self.test(other, |a, b| a == b)
            }
            pub fn gt(self, other: impl Operand<T>) -> Mask<T> {
                self.test(other, |a, b| a > b)
            }
        }

        #[ops(portable)]
        impl<T: Lane> Mask<T> {
            const ALL: u64 = u64::MAX >> (64 - Vec::<T>::LANES);
            pub fn cast<U: Lane>(self) -> Mask<U> {
                const { assert!(T::BITS == U::BITS) };
                Mask(self.0, PhantomData)
            }
            fn and(self, other: Self) -> Self {
                Self(self.0 & other.0, PhantomData)
            }
            fn or(self, other: Self) -> Self {
                Self(self.0 | other.0, PhantomData)
            }
            fn xor(self, other: Self) -> Self {
                Self(self.0 ^ other.0, PhantomData)
            }
            fn not(self) -> Self {
                Self(self.0 ^ Self::ALL, PhantomData)
            }
            pub fn any(self) -> bool {
                self.0 != 0
            }
            pub fn all(self) -> bool {
                self.0 == Self::ALL
            }
            pub fn first_true(self) -> Option<usize> {
                self.any().then(|| self.0.trailing_zeros() as usize)
            }
            pub fn last_true(self) -> Option<usize> {
                self.0.checked_ilog2().map(|lane| lane as usize)
            }
            pub fn select(self, yes: impl Operand<T>, no: impl Operand<T>) -> Vec<T> {
                let (yes, no) = (Vec::of(yes), Vec::of(no));
                Vec::from_fn(|i| {
                    if self.0 >> i & 1 != 0 {
                        yes.bits(i)
                    } else {
                        no.bits(i)
                    }
                })
            }
            /// All bits of a lane, or none.
            pub fn to_vec(self) -> Vec<T> {
                self.select(T::from_bits(u64::MAX), T::from_bits(0))
            }
        }

        #[ops(portable)]
        impl M8 {
            /// One bit per lane.
            pub fn bits(self) -> u64 {
                self.0
            }
        }

        #[ops(portable)]
        impl U8 {
            /// `first <= lane <= last`, which some byte is not.
            pub fn in_range(self, first: u8, last: u8) -> M8 {
                assert!(last - first < 255);
                self.test(self, |a, _| (first..=last).contains(&(a as u8)))
            }
            fn store_nth<const K: usize, const I: usize>(self, to: &[[AtomicU8; BYTES]; K]) {
                to[I]
                    .iter()
                    .zip(self.0)
                    .for_each(|(to, lane)| to.store(lane, Relaxed))
            }
            /// The first bytes, and zeros if there are too few.
            pub fn load_first(bytes: &[u8]) -> Self {
                Self::from_fn(|i| bytes.get(i).map_or(0, |&b| b.into()))
            }
            /// In every block of 16 bytes.
            pub fn table(bytes: &[u8; 16]) -> Self {
                Self::from_fn(|i| bytes[i % 16].into())
            }
            /// The sum of the products of two neighbours, clamped.
            pub fn mul_add_pairs(self, other: I8) -> I16 {
                let product = |i: usize| self.value(i) * other.value(i);
                Vec::from_fn(|i| (product(2 * i) + product(2 * i + 1)).clamp(-32768, 32767) as u64)
            }
            /// The products of the first half of the lanes, and of the second.
            pub fn widening_mul(self, other: Self) -> (U16, U16) {
                let from =
                    |first: usize| Vec::from_fn(|i| self.bits(first + i) * other.bits(first + i));
                (from(0), from(U16::LANES))
            }
            pub fn abs_diff(self, other: Self) -> Self {
                self.zip(other, |a, b| (a - b).abs())
            }
            pub fn average_round(self, other: Self) -> Self {
                self.zip(other, |a, b| (a + b + 1) / 2)
            }
            pub fn sums_of_8(self) -> U64 {
                Vec::from_fn(|i| (8 * i..8 * i + 8).map(|i| self.bits(i)).sum())
            }
            /// In each block of 16 bytes. An index is below 16, or has its top bit set and gives 0.
            pub fn lookup(self, indices: Self) -> Self {
                Self::from_fn(|i| match indices.0[i] {
                    at @ ..16 => self.bits(i / 16 * 16 + usize::from(at)),
                    128.. => 0,
                    at => panic!("lookup at {at}"),
                })
            }
            /// The even bytes of both, and the odd ones.
            pub fn deinterleave(self, other: Self) -> (Self, Self) {
                let from = |first: usize| {
                    Self::from_fn(|i| {
                        [self, other][i / U16::LANES].bits(first + 2 * (i % U16::LANES))
                    })
                };
                (from(0), from(1))
            }
            pub fn widen_lower(self) -> U16 {
                Vec::from_fn(|i| self.bits(i))
            }
        }

        #[ops(portable)]
        impl F32 {
            fn from_fn(f: impl Fn(usize) -> f32) -> Self {
                Self(core::array::from_fn(f))
            }
            pub fn splat(lane: f32) -> Self {
                Self([lane; BYTES / 4])
            }
            pub fn from_i32(v: I32) -> Self {
                Self(v.lanes().map(|lane| lane as f32))
            }
            /// Towards zero, of lanes that fit.
            pub fn to_i32(self) -> I32 {
                I32::load(&self.0.map(|lane| {
                    assert!(lane.abs() < 2147483648.0);
                    lane as i32
                }))
            }
            fn add(self, other: Self) -> Self {
                Self::from_fn(|i| self.0[i] + other.0[i])
            }
            fn sub(self, other: Self) -> Self {
                Self::from_fn(|i| self.0[i] - other.0[i])
            }
            fn mul(self, other: Self) -> Self {
                Self::from_fn(|i| self.0[i] * other.0[i])
            }
            /// Rounds once where the target can.
            pub fn mul_add(self, by: Self, plus: Self) -> Self {
                Self::from_fn(|i| {
                    if BYTES > 16 || cfg!(target_arch = "aarch64") {
                        core::f32::math::mul_add(self.0[i], by.0[i], plus.0[i])
                    } else {
                        self.0[i] * by.0[i] + plus.0[i]
                    }
                })
            }
            /// Of numbers.
            pub fn clamp(self, low: f32, high: f32) -> Self {
                Self(self.0.map(|lane| {
                    assert!(!lane.is_nan());
                    lane.clamp(low, high)
                }))
            }
        }

        #[ops(portable)]
        impl U16 {
            /// `first <= lane <= last`, which some number is not.
            pub fn in_range(self, first: u16, last: u16) -> Mask<u16> {
                assert!(last - first < u16::MAX);
                self.test(self, |a, _| (first..=last).contains(&(a as u16)))
            }
            fn mul(self, other: Self) -> Self {
                self.zip(other, |a, b| a * b)
            }
            /// The low bytes of both.
            pub fn truncate(self, other: Self) -> U8 {
                Vec::from_fn(|i| [self, other][i / Self::LANES].bits(i % Self::LANES))
            }
        }

        #[ops(portable)]
        impl I16 {
            /// Both, clamped to bytes.
            pub fn demote(self, other: Self) -> U8 {
                Vec::from_fn(|i| {
                    [self, other][i / Self::LANES]
                        .value(i % Self::LANES)
                        .clamp(0, 255) as u64
                })
            }
            /// The sum of the products of two neighbours.
            pub fn mul_add_pairs(self, other: Self) -> I32 {
                let product = |i: usize| self.value(i) * other.value(i);
                Vec::from_fn(|i| (product(2 * i) + product(2 * i + 1)) as u64)
            }
        }

        #[ops(portable)]
        impl U32 {
            /// The lanes whose bits are set come first. What follows them is unspecified.
            pub fn compress(self, bits: u64) -> Self {
                Self::from_fn(|i| {
                    (0..Self::LANES)
                        .filter(|lane| bits >> lane & 1 != 0)
                        .nth(i)
                        .map_or(0xDEAD, |lane| self.bits(lane))
                })
            }
            /// Up by `lanes`, with zeros below.
            pub fn slide_up(self, lanes: usize) -> Self {
                assert!(lanes < Self::LANES);
                Self::from_fn(|i| i.checked_sub(lanes).map_or(0, |i| self.bits(i)))
            }
            /// With zeros above.
            pub fn from_first(lane: u32) -> Self {
                Self::from_fn(|i| if i == 0 { lane.into() } else { 0 })
            }
        }

        #[ops(portable)]
        impl I32 {
            pub fn load_bytes(bytes: &[u8; BYTES / 4]) -> Self {
                Self::load(&bytes.map(i32::from))
            }
            pub fn clamped_to_bytes(self) -> [u8; BYTES / 4] {
                self.lanes().map(|lane| lane.clamp(0, 255) as u8)
            }
        }

        #[ops(portable)]
        impl U64 {
            /// Of the low 32 bits of each lane.
            pub fn mul_low32(self, other: Self) -> Self {
                self.zip(other, |a, b| (a & 0xFFFF_FFFF) * (b & 0xFFFF_FFFF))
            }
            pub fn swap_pairs(self) -> Self {
                Self::from_fn(|i| self.bits(i ^ 1))
            }
        }
    };
}

macro_rules! in_pieces {
    () => {
        store_first_in_pieces!(portable);

        #[ops(portable)]
        impl<T: Lane> Vec<T> {
            fn repeat<U>(first: &[U], last: &[U], get: impl Fn(&U) -> T) -> Self {
                Self::from_fn(|i| get(&[first, last][i / first.len() % 2][i % first.len()]).bits())
            }
            fn repeat_8s(ends: [u64; 2]) -> Self {
                U64::repeat(&ends[..1], &ends[1..], |&end| end).cast()
            }
            fn repeat_16s<U: Unit<Lane = T>>(
                first: &ChunkOf<U, 16>,
                last: &ChunkOf<U, 16>,
            ) -> Self {
                Self::repeat(first.as_ref(), last.as_ref(), U::get)
            }
        }
    };
}

pub mod portable {
    portable!(16, portable);
    in_pieces!();
}

pub mod portable32 {
    portable!(32, portable32);
    in_pieces!();
}

pub mod portable64 {
    portable!(64, portable64);

    #[derive(Clone, Copy)]
    pub struct Short<T> {
        /// The text, and then zeros.
        pub lanes: Vec<T>,
        len: usize,
    }

    #[ops(portable)]
    impl<T: Lane> Short<T> {
        pub fn load<U: Unit<Lane = T>>(text: &[U]) -> Option<Self> {
            assert!(text.len() < Vec::<T>::LANES);
            let lanes = Vec::from_fn(|i| text.get(i).map_or(0, |unit| unit.get().bits()));
            let len = text.len();
            (len != 0).then_some(Self { lanes, len })
        }
        pub fn first(self, mask: Mask<T>) -> Option<usize> {
            (0..self.len).find(|i| mask.0 >> i & 1 != 0)
        }
        pub fn last(self, mask: Mask<T>) -> Option<usize> {
            (0..self.len).rfind(|i| mask.0 >> i & 1 != 0)
        }
        pub fn store(lanes: Vec<T>, to: &mut [T]) {
            assert!(to.len() < Vec::<T>::LANES);
            to.copy_from_slice(&lanes.lanes().as_ref()[..to.len()]);
        }
    }

    #[ops(portable)]
    impl Short<u8> {
        pub fn store_shared(lanes: U8, to: &[AtomicU8]) {
            assert!(to.len() < BYTES);
            for (to, lane) in to.iter().zip(lanes.0) {
                to.store(lane, Relaxed);
            }
        }
        pub fn bits(self, mask: M8) -> u64 {
            mask.0 & ((1 << self.len) - 1)
        }
    }

    #[ops(portable)]
    impl U8 {
        pub fn store_first(self, to: &mut [u8]) {
            assert!(to.len() < BYTES);
            to.copy_from_slice(&self.0[..to.len()]);
        }
    }
}
