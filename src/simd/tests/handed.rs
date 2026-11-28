//! Vectors as arguments and results of calls by pointers and `dyn`.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![allow(clippy::all)]
#[bun_simd::simd(icelake, avx512, avx2, sse4, sve2, neon)]
mod far {
    use bun_simd::prelude::*;
    pub fn helper(v: u32xN<S>) -> u32xN<S> {
        v + 1
    }
    pub fn built() -> crate::simd::B<S> {
        crate::simd::boxed(|v| v + 1)
    }
    pub fn rec(v: u32xN<S>, n: u32) -> u32xN<S> {
        if n == 0 { v } else { rec(v + 1, std::hint::black_box(n - 1)) + 0x100 }
    }
    #[cold]
    pub fn cold(v: u32xN<S>) -> u32xN<S> {
        v + 1
    }
    #[inline(never)]
    pub fn never(v: u32xN<S>) -> u32xN<S> {
        v + 1
    }
    pub struct G(pub u32xN<S>);
    impl crate::simd::St<S> for G<S> {
        fn run(&self, v: u32xN<S>) -> u32xN<S> {
            v + self.0
        }
    }
}
#[bun_simd::simd(icelake, avx512, avx2, sse4, sve2, neon)]
mod simd {
    use {crate::far, bun_simd::prelude::*, std::hint::black_box as b};
    type V = u32xN<S>;
    pub type B = Box<dyn Fn(V<S>) -> V<S>>;
    pub fn boxed(f: impl Fn(V<S>) -> V<S> + 'static) -> B<S> {
        Box::new(f)
    }
    pub trait St {
        fn run(&self, v: V<S>) -> V<S>;
        fn default_run(&self, v: V<S>) -> V<S> {
            v + 1
        }
    }
    fn h(v: V<S>) -> V<S> {
        v + 1
    }
    #[inline(never)]
    fn m(v: mask32xN<S>) -> mask32xN<S> {
        !v
    }
    #[derive(Clone, Copy)]
    struct C {
        a: V<S>,
        b: V<S>,
    }
    struct N {
        a: V<S>,
        b: V<S>,
    }
    struct N1(V<S>);
    #[derive(Clone, Copy)]
    struct C1(V<S>);
    impl C1<S> {
        fn by_self(self) -> Self {
            C1(self.0 + 1)
        }
    }
    fn c(v: C<S>) -> C<S> {
        C { a: v.a + 1, b: v.b }
    }
    #[cold]
    fn n(v: N<S>) -> N<S> {
        N { a: v.a + 1, b: v.b }
    }
    fn n1(v: N1<S>) -> N1<S> {
        N1(v.0 + 1)
    }
    fn arr(v: [V<S>; 2]) -> [V<S>; 2] {
        [v[0] + 1, v[1]]
    }
    #[inline(never)]
    fn tup((x, k): (V<S>, u32)) -> (V<S>, u32) {
        (x + k, k)
    }
    fn wide(v: u32x32<S>) -> u32x32<S> {
        v + 1
    }
    #[only(icelake)]
    fn twin(v: V<S>) -> V<S> {
        v + 1
    }
    fn twin(v: V<S>) -> V<S> {
        v + 1
    }
    #[inline(never)]
    fn generic<T: core::ops::Add<u32, Output = T> + Copy>(v: T) -> T {
        v + 1
    }
    fn level(v: [V<S>; 64 / u32xN::<S>::LANES]) -> [V<S>; 64 / u32xN::<S>::LANES] {
        array::map(v, |v| v + 1)
    }
    #[inline(never)]
    fn many(v: V<S>, a: u8, b: u8, c: u8, d: u8, e: u8, f: u8, g: u8, h: u8, i: u8, j: u8, k: u8) -> V<S> {
        v + (a + b + c + d + e + f + g + h + i + j + k) as u32
    }
    fn opt(v: &V<S>) -> Option<V<S>> {
        Some(*v + 1)
    }
    fn by_ref(v: &mut V<S>) {
        *v += 1
    }
    fn chain<T>(mut v: T, f: fn(T) -> T) -> T {
        let f = b(f);
        for _ in 0..1000 {
            v = f(v)
        }
        v
    }
    #[kernel]
    #[simd(by_level)]
    pub fn run(k: usize) -> (&'static str, bool) {
        let z = V::iota(b(0x0101_0101));
        let mut v = z;
        macro_rules! each {
            ($e:expr) => {{
                for _ in 0..1000 {
                    v = $e
                }
                v
            }};
        }
        let (name, v) = match k {
            0 => ("&mut by pointer", {
                let f: fn(&mut V<S>) = b(by_ref);
                for _ in 0..1000 {
                    f(&mut v)
                }
                v
            }),
            1 => ("dyn method", {
                let g = far::G(V::splat(1));
                let g: &dyn St<S> = b(&g);
                each!(g.run(v))
            }),
            2 => ("dyn default method", {
                let g = far::G(V::splat(1));
                let g: &dyn St<S> = b(&g);
                each!(g.default_run(v))
            }),
            3 => ("fn pointer", chain(z, h)),
            4 => ("closure as fn pointer", chain(z, |v| v + 1)),
            5 => ("fn item as dyn Fn", {
                let f: B<S> = b(Box::new(h));
                each!(f(v))
            }),
            6 => ("Box dyn Fn", {
                let f: B<S> = b(Box::new(move |v| v + 1));
                each!(f(v))
            }),
            7 => ("&dyn Fn", {
                let g = |v| v + 1;
                let f: &dyn Fn(V<S>) -> V<S> = b(&g);
                each!(f(v))
            }),
            8 => ("&mut dyn FnMut", {
                let mut s = 0;
                let mut g = |v| {
                    s += 1;
                    v + 1
                };
                let f: &mut dyn FnMut(V<S>) -> V<S> = b(&mut g);
                each!(f(v))
            }),
            9 => ("Box dyn FnOnce", {
                for _ in 0..1000 {
                    let f: Box<dyn FnOnce(V<S>) -> V<S>> = b(Box::new(|v| v + 1));
                    v = f(v)
                }
                v
            }),
            10 => ("recursion", {
                for _ in 0..100 {
                    v = far::rec(v, b(10))
                }
                v - 0x100 * 1000
            }),
            11 => ("cold", each!(far::cold(v))),
            12 => ("never", each!(far::never(v))),
            13 => ("never by pointer", chain(z, far::never)),
            14 => ("mask", chain(z.any_bits(1), m).select(z + 1000, z.any_bits(1).select(0, z + 1000))),
            15 => ("Copy struct", chain(C { a: z, b: z }, c).a),
            16 => ("struct", chain(N { a: z, b: z }, n).a),
            17 => ("newtype, not Copy", chain(N1(z), n1).0),
            18 => ("self by value", chain(C1(z), C1::by_self).0),
            19 => ("array", chain([z; 2], arr)[0]),
            20 => ("tuple", chain((z, 1), tup).0),
            21 => ("u32x32", chain(z.resize(), wide).resize()),
            22 => ("twins", chain(z, twin)),
            23 => ("generic T", chain(z, generic)),
            24 => ("length by level", chain([z; 64 / u32xN::<S>::LANES], level)[0]),
            25 => ("12 arguments", {
                let f: fn(V<S>, u8, u8, u8, u8, u8, u8, u8, u8, u8, u8, u8) -> V<S> = b(many);
                each!(f(v, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
            }),
            26 => ("Option result", {
                let f: fn(&V<S>) -> Option<V<S>> = b(opt);
                each!(f(&v).unwrap())
            }),
            27 => ("helper of another module", chain(z, far::helper)),
            28 => ("closure boxed elsewhere", {
                let f = b(far::built());
                each!(f(v))
            }),
            29 => ("dyn Iterator map", {
                let mut i = core::iter::repeat(1).map(|k| V::splat(k));
                let i: &mut dyn Iterator<Item = V<S>> = b(&mut i);
                each!(v + i.next().unwrap())
            }),
            30 => ("Box<Box<dyn Fn>> as dyn", {
                let f: B<S> = b(Box::new(|v| v + 1));
                let f: &dyn Fn(V<S>) -> V<S> = b(&f);
                each!(f(v))
            }),
            _ => return ("", true),
        };
        (name, v == z + 1000)
    }
}
/// Parameters are dropped last to first, after the variables, whatever the pattern.
#[test]
fn drops_keep_their_order() {
    use {bun_simd::prelude::*, std::cell::RefCell};
    struct Loud<'a>(u8, &'a RefCell<Vec<u8>>);
    impl Drop for Loud<'_> {
        fn drop(&mut self) {
            self.1.borrow_mut().push(self.0)
        }
    }
    #[simd]
    #[inline(never)]
    fn f(a: Loud, _: (Loud, u8xN<S>), mut v: u8xN<S>, (_, _c): (Loud, Loud), x: &mut u8) {
        let _local = Loud(5, a.1);
        v += 1;
        *x = v[0]
    }
    #[kernel]
    fn run() -> (Vec<u8>, u8, u8) {
        let (all, v, mut x) = (RefCell::default(), u8xN::splat(7), 0);
        f(Loud(1, &all), (Loud(2, &all), v), v, (Loud(3, &all), Loud(4, &all)), &mut x);
        (all.take(), v[0], x)
    }
    for target in run::targets() {
        assert!(run::to(target).is_none_or(|it| it == (vec![5, 4, 3, 2, 1], 7, 8)));
    }
}
#[test]
fn all_lanes_arrive() {
    for target in simd::run::targets() {
        for k in 0..31 {
            let Some((name, right)) = simd::run::to(target, k) else { break };
            assert!(right && !name.is_empty(), "{name} {target:?}");
        }
    }
}
