use core::ffi::c_void;

#[repr(C)]
struct Bytes {
    pointer: *const u8,
    length: usize,
}

// Weak: where the engine itself is linked, its definitions win.
#[unsafe(no_mangle)]
#[linkage = "weak"]
extern "C" fn Bun__AOT__hasCompiler() -> bool {
    false
}

macro_rules! functions_of_no_engine {
    ($(fn $name:ident($($argument:ty),*) $(-> $result:ty)?;)*) => {$(
        #[unsafe(no_mangle)]
        #[linkage = "weak"]
        extern "C" fn $name($(_: $argument),*) $(-> $result)? {
            panic!("{}: this program has no engine", stringify!($name))
        }
    )*};
}

functions_of_no_engine! {
    fn Bun__AOT__initializeOptions(*mut c_void);
    fn Bun__AOT__applyOptionWord(*mut c_void, Bytes, *mut u8, usize) -> usize;
    fn Bun__AOT__compile(
        Bytes,
        *const c_void,
        unsafe extern "C" fn(*mut c_void),
        *mut c_void,
        *const c_void,
        *const c_void
    ) -> *mut c_void;
    fn Bun__AOT__resultSection(*const c_void, u32) -> Bytes;
    fn Bun__AOT__freeResult(*mut c_void);
    fn Bun__AOT__imageAlignment() -> usize;
    fn Bun__AOT__relocateImage(*mut u8, usize, u64);
    fn Bun__AOT__describeDifferenceOfRuntime(*const u8, usize, *mut u8, usize) -> usize;
    fn Bun__AOT__operationCount() -> usize;
    fn Bun__AOT__operationName(usize) -> Bytes;
    fn Bun__AOT__isOptionalPass(u32) -> bool;
}
