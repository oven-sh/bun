//! Output that is a `str` without a check.

use crate::output::Tail;
use crate::{Isa, Output, Place, Simd, Width};

pub use crate::checked::Ascii;

#[op]
fn lower_bits<const N: usize>(mut bytes: [u8; N]) -> [Ascii; N] {
    macro_rules! clear { ($from:expr, $($n:literal)*) => {
        let rest = $from;
        $(
            let (parts, rest) = rest.as_chunks_mut::<$n>();
            for part in parts {
                let v = crate::simd::Simd::from_array(*part);
                let v = if crate::WASM && !cfg!(miri) { v.average::<crate::Portable>(v) } else { v };
                *part = v.and::<crate::Portable>(const { crate::simd::Simd::repeated(127) }).to_array();
            }
        )*
        let _ = rest;
    }; }
    clear!(&mut bytes[..], 64 32 16 8 4 2 1);
    // LLVM sees that the check passes.
    *Ascii::from_seen(&bytes).unwrap().as_array().unwrap()
}

/// Clears the highest bit of each byte.
impl<'b> Place<u8> for Tail<'_, 'b, Ascii> {
    const CHANGES: bool = true;
    #[inline(always)]
    fn ahead<S: Isa, W: Width>(v: Simd<u8, W, S>) -> Simd<u8, W, S> {
        v & 127
    }
    const SHARED: bool = false;
    type Again<'a>
        = Tail<'a, 'b, Ascii>
    where
        Self: 'a;
    #[op]
    fn again(&mut self) -> Self::Again<'_> {
        Place::<Ascii>::again(self)
    }
    #[op]
    fn address(&mut self) -> Option<usize> {
        Place::<Ascii>::address(self)
    }
    #[op]
    fn keep(&mut self, n: usize) {
        Place::<Ascii>::keep(self, n)
    }
    #[inline(always)]
    fn mapped<S: Isa, F: crate::Lane, W: Width, X: Width>(
        self,
        d: crate::Tag<S, F, W>,
        from: impl crate::Source<F>,
        f: impl Fn(Simd<F, W, S>) -> Simd<u8, X, S>,
    ) {
        self.map(d, from, f)
    }
    #[op]
    fn write<const N: usize>(&mut self, at: usize, values: [u8; N]) {
        Place::<Ascii>::write(self, at, lower_bits(values))
    }
    /// In the registers of the target. LLVM drops the repetition.
    #[op]
    fn write_vector<S: Isa, W: Width>(&mut self, at: usize, v: Simd<u8, W, S>) {
        crate::raw::Raw::write((v & 127).raw, self, at)
    }
    #[inline(always)]
    fn write_vector_n<S: Isa, W: Width>(&mut self, at: usize, v: Simd<u8, W, S>) {
        self.write_ends(at, v)
    }
}

/// Clears the highest bit of each byte.
#[sealed]
impl crate::Sink<u8> for [Ascii] {
    type Place<'a> = &'a mut [Ascii];
    #[inline(always)]
    fn place(&mut self) -> &mut [Ascii] {
        self
    }
}
/// Clears the highest bit of each byte.
#[sealed]
impl<'b> crate::Sink<u8> for Output<'b, Ascii> {
    type Place<'a>
        = Tail<'a, 'b, Ascii>
    where
        Self: 'a;
    #[inline(always)]
    fn place(&mut self) -> Tail<'_, 'b, Ascii> {
        self.tail()
    }
}
impl Place<u8> for &mut [Ascii] {
    const CHANGES: bool = true;
    #[inline(always)]
    fn ahead<S: Isa, W: Width>(v: Simd<u8, W, S>) -> Simd<u8, W, S> {
        v & 127
    }
    const SHARED: bool = false;
    type Again<'a>
        = &'a mut [Ascii]
    where
        Self: 'a;
    #[inline(always)]
    fn again(&mut self) -> &mut [Ascii] {
        self
    }
    #[op]
    fn write<const N: usize>(&mut self, at: usize, values: [u8; N]) {
        *self[at..].first_chunk_mut().unwrap() = lower_bits(values);
    }
    /// In the registers of the target. LLVM drops the repetition.
    #[op]
    fn write_vector<S: Isa, W: Width>(&mut self, at: usize, v: Simd<u8, W, S>) {
        crate::raw::Raw::write((v & 127).raw, self, at)
    }
    #[op]
    fn write_vector_n<S: Isa, W: Width>(&mut self, at: usize, v: Simd<u8, W, S>) {
        crate::memory::write_ends(&mut &mut self[at..], 0, v)
    }
}

impl<'a> Output<'a, Ascii> {
    /// Adds all lanes, without their highest bits.
    #[op]
    #[track_caller]
    pub(crate) fn push_ascii<S: Isa, W: Width>(&mut self, v: Simd<u8, W, S>) {
        v.write(&mut self.tail(), 0)
    }
    /// What was written.
    #[op]
    pub fn into_str(self) -> &'a str {
        Ascii::as_str(self.into_filled())
    }
}
