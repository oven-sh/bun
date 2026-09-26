//! The calling convention of macOS, as far as a call from the image has to know it.
//!
//! The image is compiled for Linux. On x86-64 Linux and macOS pass arguments the same way. On arm64
//! they do not, in three points:
//!
//! 1. A function with a variable number of arguments gets every one of the variable ones on the stack
//!    on macOS, and in registers on Linux. Such a function is never called from the image: the host has
//!    a function with fixed arguments for it (`bun_host_darwin_fcntl3`), and `#[imports]` refuses a
//!    declaration with `...`.
//! 2. An integer of fewer than 32 bits is extended to 32 by the caller on macOS, and by the callee on
//!    Linux. [`Argument::Passed`] is the type that is passed in place of such an integer.
//! 3. Arguments on the stack are packed on macOS and take 8 bytes each on Linux. With at most 8 integer
//!    and 8 floating point arguments nothing is on the stack: [`check_registers`].
//!
//! What a function of macOS returns needs no rule: macOS extends a short result itself.

use core::ffi::c_void;
use core::ptr::NonNull;

/// A type that can be an argument of a function of macOS that the image calls.
///
/// # Safety
///
/// `Passed` is what a C compiler for macOS expects in the place of the argument: the type itself, or for
/// an integer of fewer than 32 bits the integer of 32 bits with the same value. The two numbers are the
/// registers that the argument takes.
pub unsafe trait Argument: Sized {
    type Passed;
    const INTEGER_REGISTERS: usize;
    const FLOAT_REGISTERS: usize;
    fn pass(self) -> Self::Passed;
}

macro_rules! as_it_is {
    ($integer:literal, $float:literal; $($ty:ty),* $(,)?) => {$(
        // SAFETY: a value of 32 or 64 bits, passed as it is, in one register.
        unsafe impl Argument for $ty {
            type Passed = $ty;
            const INTEGER_REGISTERS: usize = $integer;
            const FLOAT_REGISTERS: usize = $float;
            #[inline(always)]
            fn pass(self) -> $ty {
                self
            }
        }
    )*};
}
as_it_is!(1, 0; i32, u32, i64, u64, isize, usize);
as_it_is!(0, 1; f32, f64);

macro_rules! extended {
    ($($ty:ty => $wide:ty),* $(,)?) => {$(
        // SAFETY: the conversion extends by the sign of the type, which is what a caller on macOS does.
        unsafe impl Argument for $ty {
            type Passed = $wide;
            const INTEGER_REGISTERS: usize = 1;
            const FLOAT_REGISTERS: usize = 0;
            #[inline(always)]
            fn pass(self) -> $wide {
                self as $wide
            }
        }
    )*};
}
extended!(i8 => i32, i16 => i32, u8 => u32, u16 => u32, bool => u32);

macro_rules! pointers {
    ($($(#[$attribute:meta])* [$($generics:tt)*] $ty:ty),* $(,)?) => {$(
        // SAFETY: the address of a sized value, or none: 64 bits in one register.
        $(#[$attribute])*
        unsafe impl<$($generics)*> Argument for $ty {
            type Passed = $ty;
            const INTEGER_REGISTERS: usize = 1;
            const FLOAT_REGISTERS: usize = 0;
            #[inline(always)]
            fn pass(self) -> $ty {
                self
            }
        }
    )*};
}
pointers!(
    [T] *const T,
    [T] *mut T,
    [T] NonNull<T>,
    [T] Option<NonNull<T>>,
    ['a, T] &'a T,
    ['a, T] &'a mut T,
    ['a, T] Option<&'a T>,
    ['a, T] Option<&'a mut T>,
);

/// A type that macOS can hand to a function of the image, or take from one, as it is: nothing of fewer
/// than 32 bits. A function of the image returns a short integer with the rest of the register
/// undefined, which macOS does not expect.
///
/// # Safety
///
/// The type is an integer of 32 or 64 bits, a floating point number, a pointer to a sized value, or `()`.
pub unsafe trait CallbackValue {}
macro_rules! callback_values {
    ($([$($generics:tt)*] $ty:ty),* $(,)?) => {$(
        // SAFETY: as the trait asks.
        unsafe impl<$($generics)*> CallbackValue for $ty {}
    )*};
}
callback_values!([] (), [] i32, [] u32, [] i64, [] u64, [] isize, [] usize, [] f32, [] f64, [T] *const T, [T] *mut T, [T] Option<NonNull<T>>, [T] NonNull<T>);

macro_rules! functions {
    ($(($($argument:ident),*)),* $(,)?) => {$(
        pointers!(
            [R: CallbackValue, $($argument: CallbackValue),*] unsafe extern "C" fn($($argument),*) -> R,
            [R: CallbackValue, $($argument: CallbackValue),*] extern "C" fn($($argument),*) -> R,
            [R: CallbackValue, $($argument: CallbackValue),*] Option<unsafe extern "C" fn($($argument),*) -> R>,
            [R: CallbackValue, $($argument: CallbackValue),*] Option<extern "C" fn($($argument),*) -> R>,
        );
    )*};
}
functions!((), (A), (A, B), (A, B, C), (A, B, C, D), (A, B, C, D, E), (A, B, C, D, E, F));

/// Fails, when the image is compiled, for a function whose arguments do not all fit into registers.
pub const fn check_registers(integer: usize, float: usize) {
    assert!(
        integer <= 8,
        "a function of macOS with more than 8 integer arguments: the ninth is on the stack, which macOS and the image lay out differently. The host needs a function for it that takes the arguments in a structure",
    );
    assert!(
        float <= 8,
        "a function of macOS with more than 8 floating point arguments: the ninth is on the stack, which macOS and the image lay out differently. The host needs a function for it that takes the arguments in a structure",
    );
}

/// The address that `c_void` pointers of bindings point at.
pub type Opaque = c_void;
