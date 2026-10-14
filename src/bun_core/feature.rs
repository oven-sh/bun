//! Features of the runtime that `bun build --compile --compile-exclude-features=<name>` can leave out of an executable.
//!
//! ```ignore
//! if feature::present::<{ feature::LINT }>() {
//!     lint_command::run(ctx);
//! } else {
//!     built_without_this_command();
//! }
//! ```
//!
//! [`present`] is an ordinary condition whose value is chosen when the executable is made, not when bun is built. In bun
//! itself it is `true` and costs one no-op. In an executable made without the feature it is `false`, and whatever only
//! the `true` side reached is gone from the file: `bun_exe_features` drops every function and constant that nothing left
//! in the executable refers to, the way a linker would.
//!
//! So mark the doors, not the rooms. Nothing says which code belongs to a feature. Code that something else still uses
//! stays, and a door that was missed costs bytes, never correctness.
//!
//! - Ask in the function that enters the feature, and branch on the answer there. An answer that is stored in a field and
//!   read elsewhere is a value like any other at run time, and both sides stay.
//! - Not in a loop that should vectorize: the compiler cannot see through it.

mod ids;
pub use ids::*;

// The marker: an instruction that does nothing and holds the feature's id, so that no two markers of different features
// are alike and the linker cannot fold the functions around them. It is as long as the jump that may replace it.
#[cfg(target_arch = "x86_64")]
macro_rules! no_op {
    () => {
        "2: .byte 0x0f, 0x1f, 0x80\n.long {id}" // nopl id(%rax)
    };
}
#[cfg(target_arch = "aarch64")]
macro_rules! no_op {
    () => {
        "2: movz xzr, #{id}"
    };
}

// The record: where the marker is, where the `false` side is, and the id. Bun's build reads these after linking.
// ELF: addresses, in a section that is not loaded. Mach-O, PE: distances from the record, in one that is.
#[cfg(target_os = "linux")]
macro_rules! record {
    () => {
        ".pushsection .bun_features,\"\",@progbits\n.quad 2b\n.quad {no}\n.long {id}\n.long 0\n.popsection"
    };
}
// On x86-64 Mach-O a label can be subtracted only if a symbol the linker sees comes before it in its section.
#[cfg(target_os = "macos")]
macro_rules! record {
    () => {
        ".pushsection __TEXT,__bun_feat,regular,live_support\n.ifndef l_bun_feat\nl_bun_feat:\n.endif\n3: .long 2b - 3b\n.long {no} - 3b\n.long {id}\n.long 0\n.popsection"
    };
}
#[cfg(windows)]
macro_rules! record {
    () => {
        ".pushsection .bunft,\"dr\"\n3: .long 2b - 3b\n.long {no} - 3b\n.long {id}\n.long 0\n.popsection"
    };
}

/// Whether this executable has the feature `ID`.
#[inline(always)]
#[cfg_attr(
    target_os = "macos",
    expect(
        named_asm_labels,
        reason = "`.ifndef` keeps copies of this from defining it twice"
    )
)]
pub fn present<const ID: u32>() -> bool {
    const { assert!(ID > 0 && ID < 1 << 16, "the arm64 marker holds 16 bits") };
    // Elsewhere nothing can be excluded, and this is the constant `true`.
    #[cfg(any(target_os = "linux", target_os = "macos", windows))]
    // SAFETY: does nothing, or jumps to the label.
    unsafe {
        core::arch::asm!(
            no_op!(),
            record!(),
            id = const ID,
            no = label { return false },
            options(nomem, nostack, preserves_flags)
        );
    }
    true
}
