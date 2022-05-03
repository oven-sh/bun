#[no_mangle]
pub extern "C" fn add(a: isize, b: isize) -> isize {
    a + b
}

// to compile:
// rustc --crate-type cdylib add.rs
