use core::array::from_fn;
use core::slice::Iter;
use std::io::BorrowedCursor;

use bun_simd::mem::Output;
use bun_simd::{Isa, Lane, Simd, Width};

/// Where the bytes go that a checksum has read.
pub(super) trait Copies {
    const COPIES: bool;
    const COUNTS: bool = true;
    fn written(&self) -> usize;
    fn write<const N: usize>(&mut self, bytes: [u8; N]);
    /// Writes `bytes`, and goes on behind the first `kept`.
    fn write_vector<S: Isa, W: Width>(&mut self, bytes: Simd<u8, W, S>, kept: usize);
    type Part<'a, 'b: 'a>: Copies;
    /// Parts in a row, which `fill` has to fill.
    fn parts<const K: usize, R>(
        &mut self,
        each: usize,
        fill: impl FnOnce([Self::Part<'_, '_>; K]) -> R,
    ) -> R;
}

impl Copies for () {
    const COPIES: bool = false;
    const COUNTS: bool = false;
    #[inline(always)]
    fn written(&self) -> usize {
        0
    }
    #[inline(always)]
    fn write<const N: usize>(&mut self, _: [u8; N]) {}
    #[inline(always)]
    fn write_vector<S: Isa, W: Width>(&mut self, _: Simd<u8, W, S>, _: usize) {}
    type Part<'a, 'b: 'a> = ();
    #[inline(always)]
    fn parts<const K: usize, R>(&mut self, _: usize, fill: impl FnOnce([(); K]) -> R) -> R {
        fill([(); K])
    }
}

impl Copies for usize {
    const COPIES: bool = false;
    #[inline(always)]
    fn written(&self) -> usize {
        *self
    }
    #[inline(always)]
    fn write<const N: usize>(&mut self, _: [u8; N]) {
        *self += N;
    }
    #[inline(always)]
    fn write_vector<S: Isa, W: Width>(&mut self, _: Simd<u8, W, S>, kept: usize) {
        *self += kept.min(W::BYTES);
    }
    type Part<'a, 'b: 'a> = ();
    #[inline(always)]
    fn parts<const K: usize, R>(&mut self, each: usize, fill: impl FnOnce([(); K]) -> R) -> R {
        *self += K * each;
        fill([(); K])
    }
}

impl Copies for &mut Output<'_, u8> {
    const COPIES: bool = true;
    #[inline(always)]
    fn written(&self) -> usize {
        self.len()
    }
    #[inline(always)]
    fn write<const N: usize>(&mut self, bytes: [u8; N]) {
        self.push(&bytes);
    }
    #[inline(always)]
    fn write_vector<S: Isa, W: Width>(&mut self, bytes: Simd<u8, W, S>, kept: usize) {
        self.push_with_slack(bytes.first_n(kept));
    }
    type Part<'a, 'b: 'a> = &'a mut Output<'b, u8>;
    #[inline(always)]
    fn parts<const K: usize, R>(
        &mut self,
        each: usize,
        fill: impl FnOnce([&mut Output<'_, u8>; K]) -> R,
    ) -> R {
        self.streams(
            each,
            #[inline(always)]
            |parts| fill(parts.each_mut()),
        )
    }
}

/// The bytes to copy. They are passed as an `Iter`, and have to stay one.
pub(super) type Source<'a> = Iter<'a, u8>;

/// Appends to `copy` what `read` takes.
#[inline(always)]
#[expect(clippy::needless_pass_by_value, reason = "it is two pointers")]
#[allow(unsafe_code)]
pub(super) fn copying<R>(
    bytes: Source<'_>,
    mut copy: BorrowedCursor<'_, u8>,
    read: impl FnOnce(&mut Input<'_, &mut Output<'_, u8>>) -> R,
) -> R {
    let bytes = bytes.as_slice();
    // The compiler knows this bound only if the slice is an argument. The assertion spares overflow checks.
    assert!(bytes.len() <= isize::MAX as usize);
    // SAFETY: an `Output` leaves memory initialized if all of it is.
    let mut room = Output::new(unsafe { copy.as_mut() });
    let result = read(&mut Input {
        bytes,
        copy: &mut room.limit(bytes.len()),
    });
    let len = room.len();
    // SAFETY: an `Output` counts what is initialized from its start on.
    unsafe { copy.advance(len) };
    result
}

/// The bytes that a checksum has yet to read. Each byte that it takes goes to `copy` from the same load.
pub(super) struct Input<'a, C> {
    /// If `copy` counts, these are all. Then one comparison is the check for all that is as long.
    bytes: &'a [u8],
    copy: C,
}

impl<'a> Input<'a, ()> {
    #[inline(always)]
    pub(super) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, copy: () }
    }
}

impl<'a> Input<'a, usize> {
    #[inline(always)]
    pub(super) fn counting(bytes: &'a [u8]) -> Self {
        Self { bytes, copy: 0 }
    }
}

impl Input<'_, &mut Output<'_, u8>> {
    /// The copy of all that is left, and of what was read.
    #[inline(always)]
    pub(super) fn copy_all(&mut self) -> &[u8] {
        self.copy.push(self.rest());
        self.copy.filled()
    }
}

impl<'a, C: Copies> Input<'a, C> {
    #[inline(always)]
    fn rest(&self) -> &'a [u8] {
        &self.bytes[self.copy.written()..]
    }

    #[inline(always)]
    fn skip(&mut self, count: usize) {
        if !C::COUNTS {
            self.bytes = &self.bytes[count..];
        }
    }

    /// Whether so many are left.
    #[inline(always)]
    pub(super) fn has(&self, count: usize) -> bool {
        count <= self.bytes.len() && self.copy.written() <= self.bytes.len() - count
    }

    /// `read` has to take the next `len` bytes.
    #[inline(always)]
    pub(super) fn part<R>(
        &mut self,
        len: usize,
        read: impl FnOnce(&mut Input<'_, C::Part<'_, '_>>) -> R,
    ) -> R {
        self.parts(
            len,
            #[inline(always)]
            |[part]| read(part),
        )
    }

    /// `read` has to take `K` consecutive parts of `each` bytes, in any order.
    #[inline(always)]
    pub(super) fn parts<const K: usize, R>(
        &mut self,
        each: usize,
        read: impl FnOnce(&mut [Input<'_, C::Part<'_, '_>>; K]) -> R,
    ) -> R {
        let rest = &mut self.rest();
        self.skip(K * each);
        self.copy.parts(
            each,
            #[inline(always)]
            |copies| {
                read(&mut copies.map(
                    #[inline(always)]
                    |copy| {
                        let bytes;
                        (bytes, *rest) = rest.split_at(each);
                        Input { bytes, copy }
                    },
                ))
            },
        )
    }

    /// Up to a vector, and zeros. It does not copy.
    #[inline(always)]
    pub(super) fn few<S: Isa, W: Width>(&mut self, count: usize) -> Simd<u8, W, S> {
        assert!(!C::COPIES);
        let v = Simd::load_or_default(&self.rest()[..count]);
        self.copy.write_vector(v, count);
        self.skip(count);
        v
    }

    /// What `table`, which is as long as the input was, has at the place of the next vector.
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    #[inline(always)]
    pub(super) fn beside<S: Isa, T: Lane, W: Width>(&self, table: &[u8]) -> Simd<T, W, S> {
        assert!(C::COUNTS && table.len() == self.bytes.len() && self.has(W::BYTES));
        Simd::<u8, W, S>::load(&table[self.copy.written()..]).bitcast()
    }

    /// 4 to 16 bytes as two words from each end, which overlap. It does not copy.
    #[cfg(target_arch = "x86_64")]
    #[inline(always)]
    pub(super) fn quarters(&self) -> [u32; 4] {
        assert!(!C::COPIES);
        let bytes = self.rest();
        let word = |it: Option<&[u8; 4]>| u32::from_le_bytes(*it.unwrap());
        let second = (bytes.len() - 4).min(4);
        [
            word(bytes.first_chunk()),
            word(bytes[second..].first_chunk()),
            word(bytes[..bytes.len() - second].last_chunk()),
            word(bytes.last_chunk()),
        ]
    }

    #[inline(always)]
    pub(super) fn len(&self) -> usize {
        self.bytes.len() - self.copy.written()
    }

    #[inline(always)]
    pub(super) fn vector<S: Isa, T: Lane, W: Width>(&mut self) -> Simd<T, W, S> {
        self.start_of_vector(W::BYTES)
    }

    /// A whole vector, of which no more than `count` bytes are taken.
    #[inline(always)]
    pub(super) fn start_of_vector<S: Isa, T: Lane, W: Width>(
        &mut self,
        count: usize,
    ) -> Simd<T, W, S> {
        assert!(self.has(W::BYTES));
        let mut v = Simd::<u8, W, S>::load(self.rest());
        if C::COPIES && W::BYTES < 16 {
            // It stays in its register.
            v = v.black_box();
        }
        self.copy.write_vector(v, count);
        self.skip(count.min(W::BYTES));
        v.bitcast()
    }

    /// Panics if fewer than `N` words are left.
    #[inline(always)]
    pub(super) fn words<const N: usize>(&mut self) -> [u64; N] {
        assert!(self.has(8 * N));
        let bytes = &self.rest()[..8 * N];
        let words: [_; N] = from_fn(|i| u64::from_le_bytes(bytes.as_chunks().0[i]));
        for word in words {
            self.copy.write(word.to_le_bytes());
        }
        self.skip(8 * N);
        words
    }

    #[inline(always)]
    pub(super) fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        // One copy of what fits no register.
        const { assert!(N <= 8) };
        if !self.has(N) {
            return None;
        }
        let first = *self.rest().first_chunk()?;
        self.copy.write(first);
        self.skip(N);
        Some(first)
    }

    /// Has `read` take `len` bytes at a time for as long as there are so many. A constant spares it all checks.
    #[inline(always)]
    pub(super) fn groups(
        &mut self,
        len: usize,
        mut read: impl FnMut(&mut Input<'_, C::Part<'_, '_>>),
    ) {
        while self.has(len) {
            bun_simd::not_unrolled();
            self.part(
                len,
                #[inline(always)]
                |part| read(part),
            );
        }
    }
}
