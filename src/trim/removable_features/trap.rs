// `hlt` and `udf #0`. Not breakpoints: where a program listens for SIGTRAP, a breakpoint stops nothing.
pub const X86_64_TRAP: u8 = 0xf4;
pub const AARCH64_TRAP: [u8; 4] = 0u32.to_le_bytes();
// macOS says too little about a `hlt` for the crash handler to tell it from a fault on data.
pub const X86_64_BREAKPOINT: u8 = 0xcc;

pub const TRAP_OF_REMOVED_CODE: &[u8] = if cfg!(target_arch = "aarch64") {
    &AARCH64_TRAP
} else if cfg!(target_os = "macos") {
    &[X86_64_BREAKPOINT]
} else {
    &[X86_64_TRAP]
};
