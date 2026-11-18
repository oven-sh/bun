use std::ffi::{CStr, c_void};

pub fn find(_: &CStr) -> *mut c_void {
    std::ptr::null_mut()
}

pub enum Context {}

impl Context {
    pub fn new(_: bool) -> Option<Context> {
        None
    }
}
