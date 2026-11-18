//! What `Bun.secrets` keeps. The system may ask the user.

use core::ffi::{c_char, c_void};

use bun_core::ZBox;

use crate::prelude::*;

type Receive =
    unsafe extern "C" fn(context: *mut c_void, is_error: bool, bytes: *const u8, length: usize);

unsafe extern "C" {
    fn Bun__Desktop__getSecret(
        service: *const c_char,
        name: *const c_char,
        context: *mut c_void,
        receive: Receive,
    );
    fn Bun__Desktop__setSecret(
        service: *const c_char,
        name: *const c_char,
        secret: *const c_char,
        context: *mut c_void,
        receive: Receive,
    );
}

pub(crate) type Found = Result<Option<String>, String>;

unsafe extern "C" fn receive(
    context: *mut c_void,
    is_error: bool,
    bytes: *const u8,
    length: usize,
) {
    // SAFETY: what the functions below pass, and bytes that last until this returns.
    let (found, text) = unsafe {
        (
            &mut *context.cast::<Found>(),
            string(bun_core::ffi::slice(bytes, length)),
        )
    };
    *found = if is_error { Err(text) } else { Ok(Some(text)) };
}

/// Blocks.
pub(crate) fn get(service: &str, name: &str) -> Found {
    let ([service, name], mut found) = ([service, name].map(ZBox::from_bytes), Ok(None));
    // SAFETY: it calls `receive` before it returns, if at all.
    unsafe {
        Bun__Desktop__getSecret(
            service.as_ptr(),
            name.as_ptr(),
            (&raw mut found).cast(),
            receive,
        )
    };
    found
}

/// Blocks.
pub(crate) fn set(service: &str, name: &str, secret: &str) -> Result<(), String> {
    let ([service, name, secret], mut found) = (
        [service, name, secret].map(ZBox::from_bytes),
        Found::Ok(None),
    );
    // SAFETY: as above.
    unsafe {
        Bun__Desktop__setSecret(
            service.as_ptr(),
            name.as_ptr(),
            secret.as_ptr(),
            (&raw mut found).cast(),
            receive,
        );
    }
    found.map(drop)
}
