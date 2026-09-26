//! Imports of the portable image whose arguments hold a callback. `--cfg=case="good"` compiles. Each of
//! the other cases gives the host OS a pointer to a function with the calling convention of the image,
//! which Windows would call with its own, and does not compile (x86-64).
#![allow(non_snake_case, dead_code)]
use core::ffi::c_void;

/// An alias that `win_abi` did not reach.
pub type OfTheImage = Option<unsafe extern "C" fn(u32) -> i32>;
#[bun_portable_macros::win_abi]
pub type OfWindows = Option<unsafe extern "C" fn(u32) -> i32>;

#[repr(C)]
pub struct HoldsOneOfTheImage {
    pub data: *mut c_void,
    pub callback: OfTheImage,
}
#[repr(C)]
pub struct HoldsOneOfWindows {
    pub data: *mut c_void,
    pub callback: OfWindows,
    pub next: *mut HoldsOneOfWindows,
}

#[cfg(case = "good")]
#[bun_portable_macros::imports(library = "kernel32")]
unsafe extern "system" {
    fn Good(
        callback: OfWindows,
        written_here: Option<unsafe extern "system" fn(*mut c_void)>,
        structure: *mut HoldsOneOfWindows,
        number: i32,
    ) -> OfWindows;
}

#[cfg(case = "argument")]
#[bun_portable_macros::imports(library = "kernel32")]
unsafe extern "system" {
    fn Argument(callback: OfTheImage, number: i32) -> i32;
}

#[cfg(case = "field")]
#[bun_portable_macros::imports(library = "kernel32")]
unsafe extern "system" {
    fn Field(structure: *mut HoldsOneOfTheImage) -> i32;
}

#[cfg(case = "result")]
#[bun_portable_macros::imports(library = "kernel32")]
unsafe extern "system" {
    fn Result(number: i32) -> OfTheImage;
}
