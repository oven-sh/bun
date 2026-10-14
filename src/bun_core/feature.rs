//! Features of the runtime that `bun build --compile --compile-exclude-features=<name>` can leave out of an executable.
//!
//! A FEATURE IS CRATES THAT THE REST OF BUN DOES NOT DEPEND ON. They depend on Bun, like a plugin would, and are linked into
//! it like everything else. So nothing outside can name what is in them, which the compiler sees to, and all of it can go:
//! Bun's build has the executable say where everything is that was compiled for those crates
//! (scripts/build/feature-pass.cpp), and `bun build --compile` leaves that out (src/exe_features).
//!
//! There can be any number of features. Nothing about them is a bit in a word or a header of the executable.
//!
//! The crate that a feature starts at says so in its `Cargo.toml`:
//!
//! ```toml
//! [package.metadata.bun]
//! feature = "lint"
//! ```
//!
//! What it depends on and Bun does not goes with it, or, if several features depend on it, once all of them are excluded.
//!
//! Bun gets into a feature through a DOOR: a function of Bun's whose body says what to do without the feature.
//!
//! ```ignore
//! #[feature::door(lint)]
//! pub fn exec_lint(ctx: &Context) -> CmdResult {
//!     built_without_this_command()
//! }
//! ```
//!
//! With the feature, calling it runs the function that the feature put behind it instead:
//!
//! ```ignore
//! #[feature::behind(bun_runtime::features::exec_lint, lint)]
//! fn exec_lint(ctx: &Context) -> CmdResult { ... }
//! ```
//!
//! A door of several features, `door(lint, fmt)`, is open for as long as one of them is there.
//!
//! A door is a no-op and a jump to the feature's function, and `bun build --compile` makes the no-op a jump to the body. So it
//! costs that much, nothing is inlined through it, and it belongs where a feature is entered, not in a loop.
//!
//! [`present!`] is a door with nothing behind it: whether this executable has the feature.

mod ids;
pub use bun_core_macros::{behind, door, present};
use ids::NAMES;

/// What a door starts with, for [`door`]: a no-op as long as a jump, the jump to `{real}`, and for `bun build --compile`, which
/// reads these in the file it copies, where the no-op is and where `{absent}` is, as distances from here. [`door`] has how
/// many features follow, the features, and `.popsection`. A door does not start with the jump, because a linker has what
/// calls a jump call where that goes.
#[doc(hidden)]
#[macro_export]
#[cfg(all(target_arch = "x86_64", not(any(target_os = "macos", windows))))]
macro_rules! __door {
    () => {
        "2: .byte 0x0f, 0x1f, 0x44, 0x00, 0x00\njmp {real}\n.pushsection .bun_feature_doors,\"aR\",@progbits\n3: .long 2b - 3b\n.long {absent} - 3b"
    };
}
#[doc(hidden)]
#[macro_export]
#[cfg(all(target_arch = "aarch64", not(any(target_os = "macos", windows))))]
macro_rules! __door {
    () => {
        "2: nop\nb {real}\n.pushsection .bun_feature_doors,\"aR\",@progbits\n3: .long 2b - 3b\n.long {absent} - 3b"
    };
}
// On x86-64 Mach-O a label can be subtracted only if a symbol the linker sees comes before it in its section.
#[doc(hidden)]
#[macro_export]
#[cfg(all(target_arch = "x86_64", target_os = "macos"))]
macro_rules! __door {
    () => {
        "2: .byte 0x0f, 0x1f, 0x44, 0x00, 0x00\njmp {real}\n.pushsection __TEXT,__bun_feat_door,regular,no_dead_strip\n.ifndef l_bun_feat_door\nl_bun_feat_door:\n.endif\n3: .long 2b - 3b\n.long {absent} - 3b"
    };
}
#[doc(hidden)]
#[macro_export]
#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
macro_rules! __door {
    () => {
        "2: nop\nb {real}\n.pushsection __TEXT,__bun_feat_door,regular,no_dead_strip\n.ifndef l_bun_feat_door\nl_bun_feat_door:\n.endif\n3: .long 2b - 3b\n.long {absent} - 3b"
    };
}
#[doc(hidden)]
#[macro_export]
#[cfg(all(target_arch = "x86_64", windows))]
macro_rules! __door {
    () => {
        "2: .byte 0x0f, 0x1f, 0x44, 0x00, 0x00\njmp {real}\n.pushsection .bunfdor,\"dr\"\n3: .long 2b - 3b\n.long {absent} - 3b"
    };
}
#[doc(hidden)]
#[macro_export]
#[cfg(all(target_arch = "aarch64", windows))]
macro_rules! __door {
    () => {
        "2: nop\nb {real}\n.pushsection .bunfdor,\"dr\"\n3: .long 2b - 3b\n.long {absent} - 3b"
    };
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
#[used(linker)]
#[cfg_attr(
    not(any(target_os = "macos", windows)),
    unsafe(link_section = ".bun_feature_names")
)]
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
