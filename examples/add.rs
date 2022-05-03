#[no_mangle]
pub extern "C" fn add(a: i32, b: i32) -> i32 {
    a + b
}

// to compile:
// rustc --crate-type cdylib add.rs
