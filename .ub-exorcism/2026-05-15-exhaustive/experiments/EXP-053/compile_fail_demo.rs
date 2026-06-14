//! Compile-fail witness for EXP-053.
//!
//! This file is a standalone `rustc` script: it is identical to `main.rs`
//! except the `get_handle_via_trait(&mut broken)` call is uncommented at the
//! bottom of `main()`. The intent is that `rustc --edition 2021` rejects this
//! with "the trait bound `BrokenPipe: UvHandle` is not satisfied" — proving
//! the trait discipline catches the layout drift that `.cast()` silently
//! accepts.
//!
//! Run:   rustc --edition 2021 compile_fail_demo.rs -o /dev/null

use core::ffi::c_void;

#[repr(C)]
#[derive(Default)]
pub struct uv_handle_t {
    pub data: *mut c_void,
    pub loop_ptr: *mut c_void,
    pub r#type: u32,
    pub _flags: u32,
}

pub unsafe trait UvHandle {
    fn as_handle_mut(&mut self) -> *mut uv_handle_t {
        (self as *mut Self).cast::<uv_handle_t>()
    }
}

#[repr(C)]
pub struct GoodPipe {
    pub handle: uv_handle_t,
    pub queue: [usize; 2],
    pub flags: u32,
}
unsafe impl UvHandle for GoodPipe {}

#[repr(C)]
pub struct BrokenPipe {
    pub generation: u64,
    pub handle: uv_handle_t,
    pub queue: [usize; 2],
}
// NOTE: deliberately NO `unsafe impl UvHandle for BrokenPipe`.

fn get_handle_via_cast<T>(pipe: &mut T) -> *mut uv_handle_t {
    core::ptr::from_mut::<T>(pipe).cast()
}

fn get_handle_via_trait<T: UvHandle>(pipe: &mut T) -> *mut uv_handle_t {
    pipe.as_handle_mut()
}

fn main() {
    let mut broken = BrokenPipe {
        generation: 0xdead_beef,
        handle: uv_handle_t::default(),
        queue: [0; 2],
    };

    // The bypass — compiles silently:
    let _ = get_handle_via_cast(&mut broken);

    // The discipline — must NOT compile because `BrokenPipe: UvHandle` is unmet.
    let _ = get_handle_via_trait(&mut broken);
}
