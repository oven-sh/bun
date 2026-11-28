/// Between integers. The steps have the sign of `SIGNED`.
#[bun_simd_macros::op]
fn resized<T: Fits<N>, U: Fits<N>, const N: usize, const SIGNED: bool, const SATURATE: bool>(
    v: Simd<T, N>,
) -> Simd<U, N> {
    macro_rules! ways { ($($name:ident<$a:ident $(, $b:ident)+>($v:ident) $body:expr;)*) => {$(
        #[inline(always)]
        fn $name<T: Fits<N>, U: Fits<N>, const N: usize, const SATURATE: bool, $a: Fits<N> $(, $b: Fits<N>)+>(v: Simd<T, N>) -> Simd<U, N> {
            let $v: Simd<$a, N> = Simd::of(cast(v.0));
            Simd::of(cast($body.0))
        }
    )*}; }
    ways! {
        up1<A, B>(v) twice::<A, B, N>(v);
        up2<A, B, C>(v) twice::<B, C, N>(twice(v));
        up3<A, B, C, D>(v) twice::<C, D, N>(twice::<B, C, N>(twice(v)));
        down1<A, B>(v) half::<A, B, N, SATURATE>(v);
        down2<A, B, C>(v) half::<B, C, N, SATURATE>(half::<A, B, N, SATURATE>(v));
        down3<A, B, C, D>(v) half::<C, D, N, SATURATE>(half::<B, C, N, SATURATE>(half::<A, B, N, SATURATE>(v)));
    }
    macro_rules! steps { ($($signed:literal $a:ident $b:ident $c:ident $d:ident)*) => { steps!(@ $(
        $signed 1 2 up1($a $b) $signed 2 4 up1($b $c) $signed 4 8 up1($c $d) $signed 1 4 up2($a $b $c) $signed 2 8 up2($b $c $d) $signed 1 8 up3($a $b $c $d)
        $signed 2 1 down1($b $a) $signed 4 2 down1($c $b) $signed 8 4 down1($d $c) $signed 4 1 down2($c $b $a) $signed 8 2 down2($d $c $b) $signed 8 1 down3($d $c $b $a)
    )*) };
        (@ $($signed:literal $from:literal $to:literal $f:ident($($t:ident)*))*) => {
            chosen!(fn(Simd<T, N>) -> Simd<U, N>: $(SIGNED == $signed && T::SIZE == $from && U::SIZE == $to => $f::<T, U, N, SATURATE, $($t),*>,)* _ => Simd::bits)(v)
        };
    }
    steps!(true i8 i16 i32 i64 false u8 u16 u32 u64)
}
