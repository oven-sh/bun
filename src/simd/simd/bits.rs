//! The same bits as another type.

/// # Safety
/// All bits are valid, there is no padding, and none is an address.
#[allow(unsafe_code)]
pub unsafe trait Pod: Copy {}
macro_rules! pod {
    ([$($generics:tt)*] $t:ty $(, where $($bounds:tt)*)?) => {
        // SAFETY: each use has numbers, registers, or what consists of these.
        #[allow(unsafe_code)]
        unsafe impl<$($generics)*> crate::simd::Pod for $t $(where $($bounds)*)? {}
    };
    ($($t:ident)*) => { $(crate::simd::bits::pod!([] $t);)* };
}
pub(super) use pod;
pod!(u8 i8 u16 i16 u32 i32 u64 i64 u128 usize isize f32 f64);
pod!([T: Pod, const N: usize] [T; N]);
pod!([T: super::Fits<N>, const N: usize] super::Simd<T, N>);
pod!([T: super::Fits<N>, const N: usize] super::Mask<T, N>);

#[repr(C)]
union Both<A: Copy, B: Copy> {
    a: A,
    b: B,
}

/// The first bytes of `a`.
#[inline(always)]
pub const fn start<A: Pod, B: Pod>(a: A) -> B {
    if const { size_of::<B>() <= size_of::<A>() } {
        // SAFETY: these bytes are initialized, and valid.
        #[allow(unsafe_code)]
        return unsafe { Both { a }.b };
    }
    unreachable!()
}
#[inline(always)]
pub const fn cast<A: Pod, B: Pod>(a: A) -> B {
    if const { size_of::<B>() == size_of::<A>() } { start(a) } else { unreachable!() }
}
/// `a`, and then zeros.
#[inline(always)]
pub const fn widened<A: Pod, R: super::Reg>(a: A) -> R {
    if const { size_of::<A>() == size_of::<R>() } {
        return cast(a);
    }
    if const { cfg!(target_endian = "little") && size_of::<A>() <= 8 && size_of::<R>() <= 16 } {
        // As a lane, which is loaded without a detour.
        if const { cfg!(target_arch = "aarch64") && size_of::<A>() < 8 } {
            return match size_of::<A>() {
                1 => start([[cast::<A, u8>(a), 0, 0, 0], [0; 4], [0; 4], [0; 4]]),
                2 => start([cast::<A, u16>(a), 0, 0, 0, 0, 0, 0, 0]),
                _ => start([cast::<A, u32>(a), 0, 0, 0]),
            };
        }
        if const { size_of::<A>() < 8 } {
            return start([
                match size_of::<A>() {
                    1 => cast::<A, u8>(a) as u32,
                    2 => cast::<A, u16>(a) as u32,
                    _ => cast(a),
                },
                0,
                0,
                0,
            ]);
        }
        return start([cast::<A, u64>(a), 0]);
    }
    let mut all = R::ZERO;
    set_part(&mut all, 0, a);
    all
}
const fn count<A, B>() -> usize {
    if align_of::<B>() <= align_of::<A>() { size_of::<A>() / size_of::<B>() } else { 0 }
}
/// Number `i` of the values of `B` in `a`.
macro_rules! views { ($($name:ident $pointer:ident $($unique:ident)?;)*) => {$(
    #[inline(always)]
    pub const fn $name<A: Pod, B: Pod>(a: &$($unique)? A, i: usize) -> &$($unique)? B {
        if i < const { count::<A, B>() } {
            // SAFETY: it is within, aligned and valid, both ways.
            #[allow(unsafe_code)]
            return unsafe { &$($unique)? *(a as *$pointer A).cast::<B>().add(i) };
        }
        unreachable!()
    }
)*}; }
views!(view const; view_mut mut mut;);
#[inline(always)]
pub const fn part<A: Pod, B: Pod>(a: &A, i: usize) -> B {
    *view(a, i)
}
#[inline(always)]
pub const fn set_part<A: Pod, B: Pod>(a: &mut A, i: usize, value: B) {
    *view_mut(a, i) = value
}
