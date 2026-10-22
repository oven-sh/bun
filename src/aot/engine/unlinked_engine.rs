use core::ffi::c_void;

use super::BunAOTBytes;

fn no_engine(symbol: &str) -> ! {
    panic!("{symbol}: the unit tests of bun_aot link no engine")
}

#[unsafe(no_mangle)]
extern "C" fn Bun__AOT__hasCompiler() -> bool {
    false
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__AOT__initializeOptions(_options: *mut c_void) {
    no_engine("Bun__AOT__initializeOptions")
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__AOT__applyOptionWord(
    _options: *mut c_void,
    _word: BunAOTBytes,
    _message: *mut u8,
    _capacity: usize,
) -> usize {
    no_engine("Bun__AOT__applyOptionWord")
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__AOT__compile(
    _program: BunAOTBytes,
    _external_bodies: *const c_void,
    _release_program: unsafe extern "C" fn(*mut c_void),
    _program_owner: *mut c_void,
    _options: *const c_void,
    _thread_pool: *const c_void,
) -> *mut c_void {
    no_engine("Bun__AOT__compile")
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__AOT__resultSection(_result: *const c_void, _section: u32) -> BunAOTBytes {
    no_engine("Bun__AOT__resultSection")
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__AOT__freeResult(_result: *mut c_void) {
    no_engine("Bun__AOT__freeResult")
}

#[unsafe(no_mangle)]
extern "C" fn Bun__AOT__imageAlignment() -> usize {
    no_engine("Bun__AOT__imageAlignment")
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__AOT__relocateImage(_image: *mut u8, _size: usize, _address: u64) {
    no_engine("Bun__AOT__relocateImage")
}

#[unsafe(no_mangle)]
extern "C" fn Bun__AOT__operationCount() -> usize {
    no_engine("Bun__AOT__operationCount")
}

#[unsafe(no_mangle)]
extern "C" fn Bun__AOT__operationName(_index: usize) -> BunAOTBytes {
    no_engine("Bun__AOT__operationName")
}

#[unsafe(no_mangle)]
extern "C" fn Bun__AOT__isOptionalPass(_pass: u32) -> bool {
    no_engine("Bun__AOT__isOptionalPass")
}
