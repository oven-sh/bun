//! Pointers, tables, objects and tokens that outlive the kernel that made them.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{generic::*, target::*};
use std::sync::{Mutex, OnceLock};

#[bun_simd::simd(icelake, avx512, avx2 + "adx", avx2, sse4, sve2, neon + crc, neon)]
mod simd {
    use bun_simd::WithToken;
    use bun_simd::prelude::*;
    pub type Shift = fn(&[u32], &mut [u32]) -> usize;
    pub trait Search: Send + Sync {
        fn find(&self, text: &[u8]) -> Option<usize>;
        fn lanes(&self) -> usize;
    }

    fn shift<const BY: u32>(from: &[u32], to: &mut [u32]) -> usize {
        over(from).map_into(to, |v| v >> BY);
        u32xN::LANES
    }
    #[kernel]
    pub fn lanes() -> usize {
        u32xN::LANES
    }
    #[kernel]
    pub fn first<'a>(text: &'a [u8], byte: &u8) -> &'a [u8] {
        &text[..over(text).position(|v| v.simd_eq(*byte)).unwrap_or(text.len())]
    }
    #[kernel]
    pub fn pointer() -> for<'a> fn(&'a [u8], &u8) -> &'a [u8] {
        first
    }
    #[kernel]
    pub fn table() -> &'static [Shift; 3] {
        &[shift::<0, S>, shift::<1, S>, shift::<7, S>]
    }
    #[kernel]
    pub fn closure(a: u8, b: u8) -> Box<dyn Fn(&[u8]) -> Option<usize> + Send + Sync> {
        let (a, b) = (u8xN::splat(a), u8xN::splat(b));
        Box::new(move |text| over(text).position(|v| v.simd_eq(a) | v.simd_eq(b)))
    }

    struct ByPointer {
        all: Vec<u8xN<S>>,
        find: fn(&ByPointer<S>, &[u8]) -> Option<usize>,
    }
    impl ByPointer<S> {
        fn find(&self, text: &[u8]) -> Option<usize> {
            over(text).position(|v| self.all.iter().fold(mask8xN::splat(false), |m, &it| m | v.simd_eq(it)))
        }
    }
    impl Search for ByPointer<S> {
        fn find(&self, text: &[u8]) -> Option<usize> {
            (self.find)(self, text)
        }
        fn lanes(&self) -> usize {
            u32xN::LANES
        }
    }
    struct ByToken(u8xN<S>, u8xN<S>);
    impl Search for ByToken<S> {
        fn find(&self, text: &[u8]) -> Option<usize> {
            let s = self.0.isa();
            s.run(|| s.over(text).position(|v| v.simd_eq(self.0) | v.simd_eq(self.1)))
        }
        fn lanes(&self) -> usize {
            u32xN::LANES
        }
    }
    #[derive(Clone, Copy)]
    struct Polynomial(u64, S);
    impl core::ops::Mul for Polynomial<S> {
        type Output = Self;
        fn mul(self, other: Self) -> Self {
            Polynomial(u64x2::<S>::splat(self.0).carryless_mul_even(other.0)[0], self.1)
        }
    }
    fn sum_by<W: Width>(values: &[u32]) -> u32 {
        Simd::<u32, W, S>::over(values).sum()
    }
    #[kernel]
    pub fn cube(x: u64, values: &[u32]) -> (u64, u32, u32) {
        const { assert!(size_of::<Polynomial<S>>() == 8) };
        let x = Polynomial(x, isa());
        ((x * x * x).0, sum_by::<Native<S>, S>(values), sum_by::<Upto<B32, S>, S>(values))
    }
    #[kernel]
    pub fn objects(a: u8, b: u8) -> [Box<dyn Search>; 2] {
        let (a, b) = (u8xN::splat(a), u8xN::splat(b));
        [Box::new(ByPointer { all: vec![a, b], find: ByPointer::find }), Box::new(ByToken(a, b))]
    }
}

/// For tests that change the CPU, or rely on it.
static CPU: Mutex<()> = Mutex::new(());

#[test]
#[cfg_attr(target_family = "wasm", ignore = "needs threads")]
fn they_keep_their_target() {
    let _cpu = CPU.lock().unwrap();
    let text: Vec<u8> = (0..300u32).map(|i| (i * i % 251) as u8).collect();
    let words: Vec<u32> = text.iter().map(|&it| it as u32 * 0x0101_0101).collect();
    for target in simd::lanes::targets() {
        let lanes = simd::lanes::to(target).unwrap();
        assert_eq!(simd::cube::to(target, 0b11, &[2; 50]), Some((0b1111, 100, 100)));
        assert!(cpu().includes(target) || target.has_word("sve2"));
        let (pointer, table) = (simd::pointer::to(target).unwrap(), simd::table::to(target).unwrap());
        let (closure, objects) = (simd::closure::to(target, 49, 7).unwrap(), simd::objects::to(target, 49, 7).unwrap());
        std::thread::scope(|scope| {
            scope.spawn(|| {
                for from in 0..text.len() {
                    let (text, words) = (&text[from..], &words[from..]);
                    assert_eq!(pointer(text, &49), text.split(|&it| it == 49).next().unwrap());
                    let want = text.iter().position(|&it| it == 49 || it == 7);
                    assert_eq!([closure(text), objects[0].find(text), objects[1].find(text)], [want; 3], "{target:?}");
                    for (f, by) in table.iter().zip([0, 1, 7]) {
                        let mut got = vec![0; words.len()];
                        assert_eq!(f(words, &mut got), lanes);
                        assert!(got.iter().zip(words).all(|(&got, &it)| got == it >> by));
                    }
                }
                assert!(objects.iter().all(|it| it.lanes() == lanes));
            });
        });
    }
}

#[test]
fn in_a_static() {
    static TABLE: OnceLock<&[simd::Shift; 3]> = OnceLock::new();
    let _cpu = CPU.lock().unwrap();
    let lanes = simd::lanes();
    assert_eq!(TABLE.get_or_init(simd::table)[1](&[], &mut []), lanes);
    assert!(set_cpu(Target::Portable));
    assert_eq!(TABLE.get_or_init(simd::table)[1](&[], &mut []), lanes);
    assert_eq!(simd::table()[1](&[], &mut []), simd::lanes::baseline());
    reset_cpu();
}

#[test]
#[should_panic = "in the closure"]
fn run_unwinds() {
    #[kernel]
    fn panics() {
        let s: S = bun_simd::prelude::isa();
        s.run(|| panic!("in the closure"))
    }
    panics()
}
