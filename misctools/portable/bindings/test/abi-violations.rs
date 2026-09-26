// Bindings that break the rules of check-darwin.ts, one rule each. Nothing compiles this file:
//   bun check-darwin.ts --fixture test/abi-violations.rs
// has to fail and name each of them.

#[cfg_attr(bun_portable, bun_portable_macros::imports(library = "libSystem"))]
unsafe extern "C" {
    // R1: the block does not say host = "macos".
    fn getpid() -> i32;
}

#[cfg_attr(bun_portable, bun_portable_macros::imports(library = "libSystem", host = "macos"))]
unsafe extern "C" {
    // R2: declared with a variable number of arguments.
    fn my_printf(format: *const c_char, ...) -> c_int;
    // R2: fcntl takes a variable number of arguments on macOS, also when it is declared with three.
    fn fcntl(fd: c_int, cmd: c_int, argument: isize) -> c_int;
    // R2: and so does its form that is no point of cancellation.
    #[link_name = "open$NOCANCEL"]
    fn open_nocancel(path: *const c_char, flags: c_int, mode: c_int) -> c_int;
    // R3: the host has no such function.
    #[link_name = "bun_host_darwin_execl5"]
    fn execl(path: *const c_char, a: *const c_char, b: *const c_char, c: *const c_char, d: *const c_char) -> c_int;
    // R3: the host has the function with three arguments.
    #[link_name = "bun_host_darwin_fcntl3"]
    fn fcntl2(fd: c_int, cmd: c_int) -> c_int;
    // R4: nine integer arguments.
    fn nine(a: i32, b: i32, c: i32, d: i32, e: i32, f: i32, g: i32, h: i32, i: i32) -> i32;
    // R5: a structure by value.
    fn by_value(time: timespec) -> i32;
    // R6: macOS calls a function of the image that returns a bool.
    fn with_a_function(context: *mut c_void, compare: unsafe extern "C" fn(*const c_void, *const c_void) -> bool) -> i32;
    // Allowed: macOS calls a function of the image that takes pointers and returns an int.
    fn with_another_function(context: *mut c_void, compare: Option<unsafe extern "C" fn(*const c_void, *const c_void) -> i32>) -> i32;
    // Allowed, and listed: an integer of 16 bits is passed as 32.
    fn fchmod(fd: c_int, mode: u16) -> c_int;
}
