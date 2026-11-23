//! `Source` and `Place` for shared memory, on top of `shared.rs`.

use crate::endian::ToBytes;
use crate::load::BytesOf;
use crate::memory::{read_in_parts, write_in_parts};
use crate::raw::Raw;
use crate::shared::{self, Shared};
use crate::simd::{u8x16, u64x2};
use crate::tag::{missing, near_absent_page};
use crate::{Isa, Lane, Place, Simd, Source, Tag, Width};
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

const MASKED: bool = cfg!(all(target_arch = "x86_64", not(miri)));

/// For fewer than 16 bytes, with two accesses that overlap.
#[op]
fn load_short(from: &[AtomicU8]) -> u8x16 {
    let n = from.len();
    let words = if let (Some(first), Some(last)) = (from.first_chunk(), from.last_chunk()) {
        [shared::load_8(first), shared::load_8(last) >> 1 >> (127 - 8 * n)]
    } else if let (Some(first), Some(last)) = (from.first_chunk(), from.last_chunk()) {
        [shared::load_4(first) as u64 | (shared::load_4(last) as u64) >> (64 - 8 * n) << 32, 0]
    } else if let (Some(first), Some(last)) = (from.first_chunk(), from.last()) {
        [shared::load_2(first) as u64 | (last.load(Relaxed) as u64) >> (24 - 8 * n) << 16, 0]
    } else {
        [from.first().map_or(0, |it| it.load(Relaxed)) as u64, 0]
    };
    crate::raw::copy::from_array::<u64, 2>(words).to_le_bytes()
}

#[op]
fn store_short(to: &[AtomicU8], v: u8x16) {
    let (n, [low, high]) = (to.len(), crate::raw::copy::to_array(u64x2::from_le_bytes(v)));
    if let (Some(first), Some(last)) = (to.first_chunk(), to.last_chunk()) {
        shared::store_8(first, low);
        shared::store_8(last, ((low as u128 | (high as u128) << 64) >> (8 * n - 64)) as u64);
    } else if let (Some(first), Some(last)) = (to.first_chunk(), to.last_chunk()) {
        shared::store_4(first, low as u32);
        shared::store_4(last, (low >> (8 * n - 32)) as u32);
    } else if let (Some(first), Some(last)) = (to.first_chunk(), to.last()) {
        shared::store_2(first, low as u16);
        last.store((low >> (8 * n - 8)) as u8, Relaxed);
    } else if let Some(first) = to.first() {
        first.store(low as u8, Relaxed);
    }
}

/// The vector starts `skip` bytes before the slice.
#[op]
fn load_masked<S: Isa, W: Width>(from: &[AtomicU8], skip: usize, d: Tag<S, u8, W>) -> Simd<u8, W, S> {
    let s = d.simd();
    Simd::new(
        s,
        if const { W::BYTES == 64 } {
            W::from64(s.load_shared_n_64(from, skip))
        } else if const { W::BYTES == 32 } {
            W::from32(s.load_shared_n_32(from, skip))
        } else {
            W::from16(s.load_shared_n_16(&from[..from.len().min(W::BYTES)], skip))
        },
    )
}

impl Source<u8> for &[AtomicU8] {
    const MASKED: bool = MASKED;
    #[inline(always)]
    fn address(&self) -> usize {
        self.as_ptr().addr()
    }
    #[op]
    fn read<const N: usize>(self, at: usize) -> [u8; N] {
        let (from, mut all, mut at) = (&self[at..][..N], [0; N], 0);
        macro_rules! parts { ($($load:ident $n:literal)*) => {$(
            while N - at >= $n {
                crate::raw::copy::to_start(shared::$load(from[at..].first_chunk().unwrap()).to_le_bytes(), &mut all[at..]);
                at += $n;
            }
        )*}; }
        parts!(load_8 8 load_4 4 load_2 2);
        if at < N {
            all[at] = from[at].load(Relaxed);
        }
        all
    }
    #[op]
    fn read_vector<S: Isa, W: Width>(self, d: Tag<S, u8, W>, at: usize) -> Simd<u8, W, S> {
        let (s, from) = (d.simd(), &self[at..]);
        return_if!(W::BYTES == 128 && S::REGISTER == 64, |d: Tag<S, u8, W> = d, from: &[AtomicU8] = from| {
            let [a, b, ..] = from.read_group(d.part::<W>());
            d.join(a, b)
        });
        halves_if!(W::BYTES > 64, |d: Tag<S, u8, W> = d, from: &[AtomicU8] = from| {
            d.join(from.read_vector(d.part::<W>(), 0), from.read_vector(d.part::<W>(), W::BYTES / 2))
        });
        Simd::new(
            s,
            choose! {
                W::BYTES == 64 && S::REGISTER == 32 => W::from64(s.load_shared_32x2(from.first_chunk().unwrap())),
                W::BYTES == 64 => W::from64(s.load_shared_64(from.first_chunk().unwrap())),
                W::BYTES == 32 => W::from32(s.load_shared_32(from.first_chunk().unwrap())),
                W::BYTES == 16 => W::from16(s.load_shared_16(from.first_chunk().unwrap())),
                _ => Raw::read(self, at),
            },
        )
    }
    #[op]
    fn read_group<S: Isa, W: Width>(self, d: Tag<S, u8, W>) -> [Simd<u8, W, S>; 4] {
        let s = d.simd();
        choose! {
            W::BYTES == 64 => {
                let [a, b] = s.load_shared_64x2(self.first_chunk().unwrap());
                let (a, b) = (Simd::new(s, W::from64(a)), Simd::new(s, W::from64(b)));
                [a, b, a, b]
            },
            W::BYTES == 32 => {
                let [a, b, c, d] = s.load_shared_32x4(self.first_chunk().unwrap());
                let of = always!(|v| Simd::new(s, W::from32(v)));
                [of(a), of(b), of(c), of(d)]
            },
            S::A64 && W::BYTES == 16 => {
                let all = self.read_vector(s.fixed::<u8, crate::B64>(), 0);
                let (a, b) = (all.lower_half(), all.upper_half());
                let of = always!(|v| d.resize_bitcast(v));
                [of(a.lower_half()), of(a.upper_half()), of(b.lower_half()), of(b.upper_half())]
            },
            _ => d.read_one_by_one(self),
        }
    }
    #[inline(always)]
    fn read_vector_n<S: Isa, W: Width>(self, d: Tag<S, u8, W>) -> Simd<u8, W, S> {
        apart!(d.isa(), {
            return_if!(W::BYTES > 64, |this: &[AtomicU8] = self, d: Tag<S, u8, W> = d| {
                let (lower, upper) = this.split_at(this.len().min(W::BYTES / 2));
                d.join(lower.read_vector_n(d.part::<W>()), upper.read_vector_n(d.part::<W>()))
            });
            if MASKED && S::HAS_MASKED_MEMORY {
                if !near_absent_page::<_, W>(self) {
                    return load_masked(self, 0, d);
                }
                // One vector that ends where the slice does, if its bytes move in few steps.
                return_if!(
                    S::AVX512BW && MASKED && W::BYTES >= 16 && W::BYTES <= if S::AVX512VBMI { 64 } else { 32 },
                    {
                        let skip = missing::<u8, W>(self.len());
                        if self.is_empty() { d.zero() } else { load_masked(self, skip, d).down_by(skip) }
                    }
                );
            }
            if W::BYTES <= 16 && self.len() < W::BYTES {
                return Simd::new(d.simd(), W::from16(load_short(self)));
            }
            read_in_parts(self, d)
        })
    }
}

impl Place<u8> for &[AtomicU8] {
    const MASKED: bool = MASKED;
    type Again<'a>
        = Self
    where
        Self: 'a;
    #[inline(always)]
    fn again(&mut self) -> Self {
        self
    }
    #[op]
    fn shared_address(&self) -> Option<usize> {
        Some(self.as_ptr().addr())
    }
    #[op]
    fn write<const N: usize>(&mut self, at: usize, values: [u8; N]) {
        let (to, mut at) = (&self[at..][..N], 0);
        macro_rules! parts { ($($store:ident $t:ident $n:literal)*) => {$(
            while N - at >= $n {
                shared::$store(to[at..].first_chunk().unwrap(), $t::from_le_bytes(*values[at..].first_chunk().unwrap()));
                at += $n;
            }
        )*}; }
        parts!(store_8 u64 8 store_4 u32 4 store_2 u16 2);
        if at < N {
            to[at].store(values[at], Relaxed);
        }
    }
    #[op]
    fn write_vector<S: Isa, W: Width>(&mut self, at: usize, v: Simd<u8, W, S>) {
        let to = &self[at..];
        halves_if!(W::BYTES > 64, |v: Simd<u8, W, S> = v, to: &[AtomicU8] = to| {
            let (mut lower, mut upper) = to[..W::BYTES].split_at(W::BYTES / 2);
            lower.write_vector(0, v.parts::<W>()[0]);
            upper.write_vector(0, v.parts::<W>()[1])
        });
        choose! {
            W::BYTES == 64 => v.s.store_shared_64(to.first_chunk().unwrap(), W::to64(v.raw)),
            W::BYTES == 32 => v.s.store_shared_32(to.first_chunk().unwrap(), W::to32(v.raw)),
            W::BYTES == 16 => v.s.store_shared_16(to.first_chunk().unwrap(), W::to16(v.raw)),
            _ => v.raw.write(self, at),
        }
    }
    #[op]
    fn write_vector_n<S: Isa, W: Width>(&mut self, at: usize, v: Simd<u8, W, S>) {
        let to = &self[at..];
        apart!(v.s, {
            return_if!(W::BYTES > 64, |v: Simd<u8, W, S> = v, to: &[AtomicU8] = to| {
                let (mut lower, mut upper) = to.split_at(to.len().min(W::BYTES / 2));
                lower.write_vector_n(0, v.parts::<W>()[0]);
                upper.write_vector_n(0, v.parts::<W>()[1])
            });
            if !(MASKED && S::HAS_MASKED_MEMORY) || near_absent_page::<_, W>(to) {
                if W::BYTES <= 16 && to.len() < W::BYTES {
                    return store_short(to, W::to16(v.raw));
                }
                return write_in_parts(&mut { to }, 0, v);
            }
            if const { W::BYTES == 64 } {
                v.s.store_shared_n_64(to, W::to64(v.raw))
            } else if const { W::BYTES == 32 } {
                v.s.store_shared_n_32(to, W::to32(v.raw))
            } else {
                v.s.store_shared_n_16(&to[..to.len().min(W::BYTES)], W::to16(v.raw))
            }
        })
    }
}

// A lane is in memory as a `T` is.
#[doc(hidden)]
#[diagnostic::do_not_recommend]
impl<T: Lane, const B: usize> Source<T> for &[Shared<B>]
where
    [u8; B]: BytesOf<T>,
{
    const MASKED: bool = MASKED;
    #[inline(always)]
    fn address(&self) -> usize {
        self.as_ptr().addr()
    }
    #[op]
    fn read<const N: usize>(self, at: usize) -> [T; N] {
        let from = &self[at..][..N];
        core::array::from_fn(
            #[inline(always)]
            |i| <[u8; B]>::native_lane((&from[i][..]).read(0)),
        )
    }
    #[op]
    fn read_vector<S: Isa, W: Width>(self, d: Tag<S, T, W>, at: usize) -> Simd<T, W, S> {
        d.repartition::<u8>().read(self[at..][..d.lanes()].as_flattened(), 0).reinterpret()
    }
    #[op]
    fn read_group<S: Isa, W: Width>(self, d: Tag<S, T, W>) -> [Simd<T, W, S>; 4] {
        let [a, b, c, d] = self.as_flattened().read_group(d.repartition::<u8>());
        [a.reinterpret(), b.reinterpret(), c.reinterpret(), d.reinterpret()]
    }
    #[op]
    fn read_vector_n<S: Isa, W: Width>(self, d: Tag<S, T, W>) -> Simd<T, W, S> {
        d.repartition::<u8>().read_n(self.as_flattened()).reinterpret()
    }
}
#[doc(hidden)]
#[diagnostic::do_not_recommend]
impl<T: Lane, const B: usize> Place<T> for &[Shared<B>]
where
    [u8; B]: BytesOf<T>,
{
    const MASKED: bool = MASKED;
    type Again<'a>
        = Self
    where
        Self: 'a;
    #[inline(always)]
    fn again(&mut self) -> Self {
        self
    }
    #[op]
    fn shared_address(&self) -> Option<usize> {
        Some(self.as_ptr().addr())
    }
    #[op]
    fn write<const N: usize>(&mut self, at: usize, values: [T; N]) {
        for (to, value) in self[at..][..N].iter().zip(values) {
            (&to[..]).write(0, <[u8; B]>::of_native_lane(value))
        }
    }
    #[op]
    fn write_vector<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>) {
        v.reinterpret::<u8>().write(&mut self[at..][..v.tag().lanes()].as_flattened(), 0)
    }
    #[op]
    fn write_vector_n<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>) {
        v.reinterpret::<u8>().write_n(&mut self[at..].as_flattened(), 0)
    }
}
