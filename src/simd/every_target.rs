//! What every target has in common, given its `Vec` and `Mask`.

macro_rules! operators {
    (@ [$($generics:tt)*] $Type:ty, $Other:ty, $Trait:ident $method:ident $op:ident) => {
        impl<$($generics)*> core::ops::$Trait<$Other> for $Type {
            type Output = Self;
            #[inline(always)]
            fn $method(self, other: $Other) -> Self {
                Self::$op(self, other)
            }
        }
    };
    ($generics:tt $Type:ty, $Other:ty: $($Trait:ident $method:ident $op:ident),*) => {
        $(operators!(@ $generics $Type, $Other, $Trait $method $op);)*
    };
}

macro_rules! four {
    (|$i:ident| $e:expr) => {
        [four!($i 0 $e), four!($i 1 $e), four!($i 2 $e), four!($i 3 $e)]
    };
    ($i:ident $n:literal $e:expr) => {{
        #[allow(non_upper_case_globals)]
        const $i: usize = $n;
        $e
    }};
}

macro_rules! every_target {
    ($target:ident, $bytes:literal, $x86:literal, $spec:ident) => {
        use crate::lanes::{Array, ArrayOf, ChunkOf, Source};
        /// What the ops of this width mean.
        pub use crate::$spec as spec;
        pub use crate::{Chunk, Lane, Unit};
        use bun_simd_macros::ops;
        use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

        pub const BYTES: usize = $bytes;
        pub const IS_X86: bool = $x86;
        pub type Lanes<T> = ArrayOf<T, BYTES>;
        pub type Units<T> = ChunkOf<T, BYTES>;
        pub type U8 = Vec<u8>;
        pub type I8 = Vec<i8>;
        pub type U16 = Vec<u16>;
        pub type I16 = Vec<i16>;
        pub type U32 = Vec<u32>;
        pub type I32 = Vec<i32>;
        pub type U64 = Vec<u64>;
        pub type M8 = Mask<u8>;

        /// A vector, or what to fill one with.
        pub trait Operand<T>: Copy {
            fn either(self) -> Result<Vec<T>, T>;
        }
        impl<T: Lane> Operand<T> for T {
            #[inline(always)]
            fn either(self) -> Result<Vec<T>, T> {
                Err(self)
            }
        }
        impl<T: Lane> Operand<T> for Vec<T> {
            #[inline(always)]
            fn either(self) -> Result<Vec<T>, T> {
                Ok(self)
            }
        }

        impl<T: Lane> Vec<T> {
            #[inline(always)]
            fn of(operand: impl Operand<T>) -> Self {
                match operand.either() {
                    Ok(v) => v,
                    Err(lane) => Self::filled(lane),
                }
            }
        }

        operators! {
            [T: Lane, O: Operand<T>] Vec<T>, O:
            Add add add, Sub sub sub, BitAnd bitand and, BitOr bitor or, BitXor bitxor xor
        }
        operators! { [T: Lane] Vec<T>, u32: Shl shl shl, Shr shr shr }
        operators! {
            [T: Lane] Mask<T>, Self: BitAnd bitand and, BitOr bitor or, BitXor bitxor xor
        }
        operators! { [] U16, Self: Mul mul mul }
        operators! { [] F32, Self: Add add add, Sub sub sub, Mul mul mul }
        impl<T: Lane> core::ops::Not for Mask<T> {
            type Output = Self;
            #[inline(always)]
            fn not(self) -> Self {
                Self::not(self)
            }
        }

        /// Index of the first unit that `test` holds for, or the length of `text`.
        #[ops($target)]
        pub fn find_first<T: Unit>(
            text: &[T],
            test: impl Fn(Vec<T::Lane>) -> Mask<T::Lane>,
        ) -> usize {
            let Some((_, last)) = Units::<T>::split_last(text) else {
                let found = Short::load(text).and_then(|short| short.first(test(short.lanes)));
                return found.unwrap_or(text.len());
            };
            let (n, start) = (Vec::<T::Lane>::LANES, text.as_ptr().addr());
            let index = |of: &Units<T>| (of.as_ref().as_ptr().addr() - start) / size_of::<T>();
            let body = &text[..text.len() - 1];
            let mut rest = Units::<T>::chunks(body);
            if let Some(near) = rest.first_chunk::<4>() {
                for (i, chunk) in near.iter().enumerate() {
                    if let Some(lane) = test(Vec::load(chunk)).first_true() {
                        return i * n + lane;
                    }
                }
                // On from where loads cross no cache line.
                let (fours, seen);
                seen = 4 * n - start % BYTES / size_of::<T>();
                (fours, rest) =
                    Units::<T>::chunks(body.get(seen..).unwrap_or(body)).as_chunks::<4>();
                for four in fours {
                    let [a, b, c, d] = four!(|i| test(Vec::load_nth::<_, 4, i>(four)));
                    let (near, all) = (a | b, (a | b) | (c | d));
                    if all.any() {
                        if !T::SHARED {
                            rest = four;
                            break;
                        }
                        // What was seen may be gone by now.
                        let (i, mask) = if a.any() {
                            (0, a)
                        } else if near.any() {
                            (1, near)
                        } else if c.any() {
                            (2, c)
                        } else {
                            (3, all)
                        };
                        // Keeps LLVM from counting the index up in the loop.
                        return index(core::hint::black_box(&four[0]))
                            + i * n
                            + mask.first_true().unwrap_or(0);
                    }
                }
            }
            for chunk in rest {
                if let Some(lane) = test(Vec::load(chunk)).first_true() {
                    return index(chunk) + lane;
                }
            }
            test(Vec::load(last))
                .first_true()
                .map_or(text.len(), |lane| text.len() - n + lane)
        }

        /// The same for the first `len` units. It may read on, so a short `len` takes no branch.
        #[ops($target)]
        pub fn find_first_within<T: Unit>(
            text: &[T],
            len: usize,
            test: impl Fn(Vec<T::Lane>) -> Mask<T::Lane>,
        ) -> usize {
            if let Some(first) = Units::<T>::first(text) {
                let n = Vec::<T::Lane>::LANES;
                let lane = test(Vec::load(first)).first_true().unwrap_or(n);
                if lane < n || len <= n {
                    return lane.min(len);
                }
            }
            find_first(&text[..len.min(text.len())], test)
        }

        /// Index of the last unit that `test` holds for, or the length of `text`.
        #[ops($target)]
        pub fn find_last<T: Unit>(
            text: &[T],
            test: impl Fn(Vec<T::Lane>) -> Mask<T::Lane>,
        ) -> usize {
            let Some(first) = Units::<T>::first(text) else {
                let found = Short::load(text).and_then(|short| short.last(test(short.lanes)));
                return found.unwrap_or(text.len());
            };
            let (n, start) = (Vec::<T::Lane>::LANES, text.as_ptr().addr());
            let index = |of: &Units<T>| (of.as_ref().as_ptr().addr() - start) / size_of::<T>();
            let body = &text[1..];
            let mut rest = Units::<T>::rchunks(body);
            if let Some((_, near)) = rest.split_last_chunk::<4>() {
                for chunk in near.iter().rev() {
                    if let Some(lane) = test(Vec::load(chunk)).last_true() {
                        return index(chunk) + lane;
                    }
                }
                let (fours, seen);
                seen =
                    4 * n - text.as_ptr_range().end.addr().wrapping_neg() % BYTES / size_of::<T>();
                (rest, fours) = Units::<T>::rchunks(body.get(..body.len() - seen).unwrap_or(body))
                    .as_rchunks::<4>();
                for four in fours.iter().rev() {
                    let [a, b, c, d] = four!(|i| test(Vec::load_nth::<_, 4, i>(four)));
                    let (near, all) = (c | d, (a | b) | (c | d));
                    if all.any() {
                        if !T::SHARED {
                            rest = four;
                            break;
                        }
                        let (i, mask) = if d.any() {
                            (3, d)
                        } else if near.any() {
                            (2, near)
                        } else if b.any() {
                            (1, b)
                        } else {
                            (0, all)
                        };
                        return index(&four[i]) + mask.last_true().unwrap_or(0);
                    }
                }
            }
            for chunk in rest.iter().rev() {
                if let Some(lane) = test(Vec::load(chunk)).last_true() {
                    return index(chunk) + lane;
                }
            }
            test(Vec::load(first)).last_true().unwrap_or(text.len())
        }

        /// How many bytes `test` holds for.
        #[ops($target)]
        pub fn count<T: Unit<Lane = u8>>(text: &[T], test: impl Fn(U8) -> M8) -> usize {
            let Some((_, last)) = Units::<T>::split_last(text) else {
                return Short::load(text).map_or(0, |short| {
                    short.bits(test(short.lanes)).count_ones() as usize
                });
            };
            let whole = Units::<T>::chunks(&text[..text.len() - 1]);
            let not_seen = I8::iota()
                .gt(BYTES as i8 - 2 - ((text.len() - 1) % BYTES) as i8)
                .cast();
            let mut sums = test(U8::load(last))
                .and(not_seen)
                .to_vec()
                .and(1)
                .sums_of_8();
            for mut block in whole.chunks(if T::SHARED { 252 } else { 255 }) {
                let mut counts = U8::zero();
                // LLVM unrolls no loop with `asm!` in it.
                if T::SHARED {
                    let fours;
                    (fours, block) = block.as_chunks();
                    for four in fours {
                        let [a, b, c, d] = four!(|i| test(U8::load_nth::<_, 4, i>(four)).to_vec());
                        counts = counts - ((a + b) + (c + d));
                    }
                }
                for chunk in block {
                    counts = counts.sub(test(U8::load(chunk)).to_vec());
                }
                sums = sums.add(counts.sums_of_8());
            }
            sums.reduce_sum() as usize
        }

        /// `to[i] = f(from[i])`, as far as both go.
        #[ops($target)]
        pub fn map<T: Unit>(
            from: &[T],
            to: &mut [T::Lane],
            f: impl Fn(Vec<T::Lane>) -> Vec<T::Lane>,
        ) {
            let len = from.len().min(to.len());
            let (from, to) = (&from[..len], &mut to[..len]);
            let Some((_, last)) = Units::<T>::split_last(from) else {
                if let Some(short) = Short::load(from) {
                    Short::store(f(short.lanes), to);
                }
                return;
            };
            for (from, to) in Units::<T>::chunks(&from[..len - 1])
                .iter()
                .zip(Chunk::chunks_mut(to))
            {
                f(Vec::load(from)).store(to);
            }
            if let Some((_, to)) = Chunk::split_last_mut(to) {
                f(Vec::load(last)).store(to);
            }
        }

        /// `text[i] = f(text[i])`
        #[ops($target)]
        pub fn map_in_place<T: Lane + Unit<Lane = T>>(
            text: &mut [T],
            f: impl Fn(Vec<T>) -> Vec<T>,
        ) {
            let Some((_, last)) = Lanes::<T>::split_last(text) else {
                if let Some(short) = Short::load(text) {
                    Short::store(f(short.lanes), text);
                }
                return;
            };
            // It overlaps the one before it.
            let last = f(Vec::load(last));
            let len = text.len();
            for chunk in Lanes::<T>::chunks_mut(&mut text[..len - 1]) {
                f(Vec::load(chunk)).store(chunk);
            }
            if let Some((_, to)) = Chunk::split_last_mut(text) {
                last.store(to);
            }
        }

        /// The same as `map`. `from` may be `to`.
        #[ops($target)]
        pub fn map_to_shared<T: Unit<Lane = u8>>(
            from: &[T],
            to: &[AtomicU8],
            f: impl Fn(U8) -> U8,
        ) {
            let len = from.len().min(to.len());
            let (from, to) = (&from[..len], &to[..len]);
            let (Some((_, last)), Some((_, to_last))) =
                (Units::<T>::split_last(from), to.split_last_chunk())
            else {
                if let Some(short) = Short::load(from) {
                    Short::store_shared(f(short.lanes), to);
                }
                return;
            };
            let last = f(U8::load(last));
            let ((fours, from), (to_fours, to)) = (
                Units::<T>::chunks(&from[..len - 1]).as_chunks(),
                to[..len - 1].as_chunks().0.as_chunks(),
            );
            for (from, to) in fours.iter().zip(to_fours) {
                four!(|i| f(U8::load_nth::<_, 4, i>(from)).store_nth::<4, i>(to));
            }
            for (from, to) in from.iter().zip(to) {
                f(U8::load(from)).store_shared(to);
            }
            last.store_shared(to_last);
        }

        #[ops($target)]
        impl<T: Lane> Vec<T> {
            pub const LANES: usize = BYTES / size_of::<T>();

            pub fn load(from: &impl Source<BYTES, T>) -> Self {
                Self::load_nth::<_, 1, 0>(core::array::from_ref(from))
            }
            /// The first lanes. Panics if there are too few.
            pub fn load_from(lanes: &[T]) -> Self {
                Self::load(Lanes::<T>::first(lanes).unwrap())
            }
            pub fn store(self, lanes: &mut Lanes<T>) {
                *lanes = self.lanes();
            }
            /// To the first lanes. Panics if there are too few.
            pub fn store_to(self, lanes: &mut [T]) {
                self.store(Chunk::first_mut(lanes).unwrap());
            }
            /// To the first lanes. Panics if there are too few.
            pub fn write_to(self, lanes: &mut [core::mem::MaybeUninit<T>]) {
                lanes[..Self::LANES].write_copy_of_slice(self.lanes().as_ref());
            }
            /// 0, 1, 2, ..
            pub fn iota() -> Self {
                let mut lanes = Lanes::<T>::zeros();
                for (i, lane) in lanes.as_mut().iter_mut().enumerate() {
                    *lane = T::from_bits(i as u64);
                }
                Self::load(&lanes)
            }
            pub fn ne(self, other: impl Operand<T>) -> Mask<T> {
                self.eq(other).not()
            }
            pub fn lt(self, other: impl Operand<T>) -> Mask<T> {
                Self::of(other).gt(self)
            }
        }

        #[ops($target)]
        impl U8 {
            pub fn store_shared(self, to: &[AtomicU8; BYTES]) {
                self.store_nth::<1, 0>(core::array::from_ref(to))
            }
        }

        #[ops($target)]
        impl U32 {
            pub fn first(self) -> u32 {
                self.lanes()[0]
            }
            pub fn splat_last(self) -> Self {
                Self::splat(self.lanes()[Self::LANES - 1])
            }
        }

        #[ops($target)]
        impl U64 {
            pub fn reduce_sum(self) -> u64 {
                self.lanes()
                    .iter()
                    .fold(0, |sum, &lane| sum.wrapping_add(lane))
            }
        }

        #[ops($target)]
        impl<T: Lane> Mask<T> {
            pub fn none(self) -> bool {
                !self.any()
            }
        }
    };
}

/// For targets that have the bits of a mask at hand.
macro_rules! bits_of_each_mask {
    ($target:ident) => {
        /// One bit for each byte, for each of `K` tests.
        #[ops($target)]
        pub fn bits_of<const K: usize>(
            block: &[u8; 64],
            tests: impl Fn(U8) -> [M8; K],
        ) -> [u64; K] {
            let (chunks, mut bits) = (block.as_chunks().0, [0; K]);
            for i in 0..64 / BYTES {
                let masks = tests(U8::load(&chunks[i]));
                for k in 0..K {
                    bits[k] |= masks[k].bits() << (i * BYTES);
                }
            }
            bits
        }
    };
}

/// For targets that have no instruction for it, or none that can be reached.
macro_rules! interleave_in_registers {
    ($target:ident) => {
        #[ops($target)]
        impl U8 {
            pub fn store_interleaved(self, other: Self, to: &mut [[u8; 2]; BYTES]) {
                let (first, second) = self.interleave(other);
                first.store_to(to.as_flattened_mut());
                second.store_to(&mut to.as_flattened_mut()[BYTES..]);
            }
            pub fn load_interleaved4(from: &[[u8; 4]; BYTES]) -> [Self; 4] {
                let load = |i: usize| Self::load_from(&from.as_flattened()[i * BYTES..]);
                let ((even, odd), (more_even, more_odd)) =
                    (load(0).deinterleave(load(1)), load(2).deinterleave(load(3)));
                let ((a, c), (b, d)) = (even.deinterleave(more_even), odd.deinterleave(more_odd));
                [a, b, c, d]
            }
            pub fn store_interleaved4([a, b, c, d]: [Self; 4], to: &mut [[u8; 4]; BYTES]) {
                let ((even, more_even), (odd, more_odd)) = (a.interleave(c), b.interleave(d));
                let ((first, second), (third, fourth)) =
                    (even.interleave(odd), more_even.interleave(more_odd));
                for (v, to) in [first, second, third, fourth]
                    .into_iter()
                    .zip(to.as_flattened_mut().as_chunks_mut().0)
                {
                    v.store(to);
                }
            }
        }
    };
}

/// For targets whose loads and stores take no mask.
macro_rules! store_first_in_pieces {
    ($target:ident) => {
        /// A text shorter than a vector. Which lane has what depends on the target and the length.
        #[derive(Clone, Copy)]
        pub struct Short<T> {
            /// The first `half` units, the last `half` units, and so on in turns.
            pub lanes: Vec<T>,
            half: usize,
            len: usize,
        }

        #[ops($target)]
        impl<T: Lane> Short<T> {
            /// `None` if there is no text.
            pub fn load<U: Unit<Lane = T>>(text: &[U]) -> Option<Self> {
                debug_assert!(text.len() < Vec::<T>::LANES);
                let (lanes, bytes) = if let Some(ends_8) = U::ends_8(text) {
                    if BYTES > 16
                        && let (Some(first), Some((_, last))) =
                            (Chunk::first(text), Chunk::split_last(text))
                    {
                        (Vec::repeat_16s::<U>(first, last), 16)
                    } else {
                        (Vec::repeat_8s(ends_8), 8)
                    }
                } else if let Some(ends) = U::ends_4(text) {
                    (U64::splat(ends).cast(), 4)
                } else if let Some(ends) = U::ends_2(text) {
                    (U32::splat(ends).cast(), 2)
                } else {
                    (Vec::splat(text.first()?.get()), size_of::<T>())
                };
                Some(Self {
                    lanes,
                    half: bytes / size_of::<T>(),
                    len: text.len(),
                })
            }
            fn index(self, lane: usize) -> usize {
                let lane = lane & (2 * self.half - 1);
                if lane < self.half {
                    lane
                } else {
                    lane + self.len - 2 * self.half
                }
            }
            /// Index of the first unit of the text that `mask` has.
            pub fn first(self, mask: Mask<T>) -> Option<usize> {
                mask.first_true().map(|lane| self.index(lane))
            }
            /// Index of the last unit of the text that `mask` has.
            pub fn last(self, mask: Mask<T>) -> Option<usize> {
                mask.last_true().map(|lane| self.index(lane))
            }
            /// To where in a text of this length the lanes are from.
            pub fn store(lanes: Vec<T>, to: &mut [T]) {
                fn put<T: Copy, const HALF: usize>(lanes: &[T], to: &mut [T]) -> bool {
                    let [first, last, ..] = *lanes.as_chunks::<HALF>().0 else {
                        return false;
                    };
                    let Some(start) = to.first_chunk_mut() else {
                        return false;
                    };
                    *start = first;
                    to.split_last_chunk_mut()
                        .map(|(_, end)| *end = last)
                        .is_some()
                }
                debug_assert!(to.len() < Vec::<T>::LANES);
                let lanes = lanes.lanes();
                let lanes = lanes.as_ref();
                _ = put::<_, 16>(lanes, to)
                    || put::<_, 8>(lanes, to)
                    || put::<_, 4>(lanes, to)
                    || put::<_, 2>(lanes, to)
                    || put::<_, 1>(lanes, to);
            }
        }

        #[ops($target)]
        impl Short<u8> {
            pub fn store_shared(lanes: U8, to: &[AtomicU8]) {
                use bun_simd_trusted::shared::{store4, store8};
                fn put<const HALF: usize>(
                    lanes: &[u8],
                    to: &[AtomicU8],
                    store: impl Fn([u8; HALF], &[AtomicU8; HALF]),
                ) -> bool {
                    let [first, last, ..] = *lanes.as_chunks().0 else {
                        return false;
                    };
                    crate::lanes::ends(to)
                        .map(|(start, end)| (store(first, start), store(last, end)))
                        .is_some()
                }
                fn each<const HALF: usize>(lanes: [u8; HALF], to: &[AtomicU8; HALF]) {
                    to.iter()
                        .zip(lanes)
                        .for_each(|(to, lane)| to.store(lane, Relaxed));
                }
                debug_assert!(to.len() < BYTES);
                let lanes = &lanes.lanes();
                _ = put(lanes, to, |lanes, to| {
                    x128::U8::load(&lanes).store_shared(to)
                }) || put(lanes, to, |lanes, to| {
                    store8::<1, 0>(u64::from_ne_bytes(lanes), core::array::from_ref(to))
                }) || put(lanes, to, |lanes, to| {
                    store4::<1, 0>(u32::from_ne_bytes(lanes), core::array::from_ref(to))
                }) || put::<2>(lanes, to, |lanes, to| each(lanes, to))
                    || put::<1>(lanes, to, |lanes, to| each(lanes, to));
            }
            /// One bit for each byte of the text.
            pub fn bits(self, mask: M8) -> u64 {
                let (bits, half) = (mask.bits(), (1 << self.half) - 1);
                bits & half | (bits >> self.half & half) << (self.len - self.half)
            }
        }

        #[ops($target)]
        impl U8 {
            /// To fewer bytes than the vector has.
            pub fn store_first(self, mut to: &mut [u8]) {
                debug_assert!(to.len() < BYTES);
                let lanes = self.lanes();
                let (mut from, mut size) = (&lanes[..], BYTES / 2);
                while size != 0 {
                    if to.len() >= size {
                        let (piece, source);
                        (piece, to) = to.split_at_mut(size);
                        (source, from) = from.split_at(size);
                        piece.copy_from_slice(source);
                    }
                    size /= 2;
                }
            }
        }
    };
}
