//! Features of the runtime that `bun build --compile --compile-exclude-features=<name>` can leave out of an executable.
//!
//! They work like `#ifdef`: what is gated is gone, what is not gated stays, whoever used it. Two things can be gated.
//!
//! A FUNCTION, or a method:
//!
//! ```ignore
//! #[feature::gate(lint)]
//! fn run_lint(ctx: &Context) -> CmdResult { ... }
//! ```
//!
//! A CRATE, in its `Cargo.toml`, which is everything that rustc emits when it compiles the crate:
//!
//! ```toml
//! [package.metadata.bun]
//! gate = ["lint", "fmt"]
//! ```
//!
//! A gate names the features that need the code: it goes once all of them are excluded. A function in a gated crate may have
//! a gate of its own, with fewer of them.
//!
//! Nothing else can be gated. A closure is a function of its own to the compiler and does not go with the function it is
//! written in (it does go with its crate). Neither do constants, or what the function calls.
//!
//! What is not gated reaches what is through [`enter!`], which is the `#ifdef ... #else`:
//!
//! ```ignore
//! match feature::enter!(lint, run_lint(ctx)) {
//!     Some(result) => result,
//!     None => built_without_this_command(),
//! }
//! ```
//!
//! In bun itself that costs one no-op. [`present!`] is the condition alone.
//!
//! Naming gated code anywhere else runs into what is gone. `bun run rust:check-gates` finds that: it type-checks Bun with
//! each feature compiled out for real, which is what these three macros also do under `--cfg bun_without="<name>"`.

mod ids;
pub use bun_core_macros::{enter, gate, present};
use ids::NAMES;

/// Nothing can be excluded on this platform.
#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
#[doc(hidden)]
#[inline(always)]
pub fn is_present<const ID: u32>() -> bool {
    true
}

// An instruction that does nothing and holds the feature's number. It is as long as a jump.
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

// Where the no-op is and where to jump instead of it, as distances from here, and the number. `bun build --compile` reads
// these in the file it copies.
#[cfg(target_os = "linux")]
macro_rules! marker {
    () => {
        ".pushsection .bun_feature_markers,\"aR\",@progbits\n3: .long 2b - 3b\n.long {no} - 3b\n.long {id}\n.long 0\n.popsection"
    };
}
// On x86-64 Mach-O a label can be subtracted only if a symbol the linker sees comes before it in its section.
#[cfg(target_os = "macos")]
macro_rules! marker {
    () => {
        concat!(
            ".pushsection __TEXT,__bun_feat_marks,regular,live_support\n.ifndef l_bun_feat_marks\nl_bun_feat_marks:\n.endif\n",
            "3: .long 2b - 3b\n.long {no} - 3b\n.long {id}\n.long 0\n.popsection"
        )
    };
}
#[cfg(windows)]
macro_rules! marker {
    () => {
        ".pushsection .bunfmrk,\"dr\"\n3: .long 2b - 3b\n.long {no} - 3b\n.long {id}\n.long 0\n.popsection"
    };
}

/// [`present!`], by number.
#[cfg(any(target_os = "linux", target_os = "macos", windows))]
#[doc(hidden)]
#[inline(always)]
#[cfg_attr(
    target_os = "macos",
    expect(
        named_asm_labels,
        reason = "`.ifndef` keeps copies of this from defining it twice"
    )
)]
pub fn is_present<const ID: u32>() -> bool {
    // SAFETY: does nothing, or jumps to the label.
    unsafe {
        core::arch::asm!(
            no_op!(),
            marker!(),
            id = const ID,
            no = label { return false },
            options(nomem, nostack, preserves_flags)
        );
    }
    true
}

const NAMES_LENGTH: usize = {
    let (mut length, mut i) = (0, 0);
    while i < NAMES.len() {
        length += NAMES[i].len() + 1;
        i += 1;
    }
    length
};

/// The names, each with a 0 after it. `bun build --compile` reads them in the file it copies.
#[cfg(any(target_os = "linux", target_os = "macos", windows))]
#[used(linker)]
#[cfg_attr(target_os = "linux", unsafe(link_section = ".bun_feature_names"))]
#[cfg_attr(target_os = "macos", unsafe(link_section = "__TEXT,__bun_feat_names"))]
#[cfg_attr(windows, unsafe(link_section = ".bunfnam"))]
static NAMES_IN_THE_EXECUTABLE: [u8; NAMES_LENGTH] = {
    let (mut bytes, mut at, mut i) = ([0; NAMES_LENGTH], 0, 0);
    while i < NAMES.len() {
        let (name, mut j) = (NAMES[i].as_bytes(), 0);
        while j < name.len() {
            bytes[at] = name[j];
            (at, j) = (at + 1, j + 1);
        }
        (at, i) = (at + 1, i + 1);
    }
    bytes
};

/// Room for program headers. An ELF file with pages left out has one more for each gap, the table of them cannot grow where
/// the linker put it, and it has to be near the start of the file, where notes are.
#[cfg(target_os = "linux")]
#[used(linker)]
#[unsafe(link_section = ".note.bun")]
static PROGRAM_HEADERS: Note = Note {
    name_size: 4,
    size: size_of::<[u64; 7 * 64]>() as u32,
    kind: 1,
    name: *b"Bun\0",
    room: [0; 7 * 64],
};

#[cfg(target_os = "linux")]
#[repr(C)]
struct Note {
    name_size: u32,
    size: u32,
    kind: u32,
    name: [u8; 4],
    /// 64 headers of 56 bytes. Older Linux accepts no more than a page of them, which is 73.
    room: [u64; 7 * 64],
}
