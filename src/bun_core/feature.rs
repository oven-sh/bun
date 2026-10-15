//! Features of the runtime that `bun build --compile --compile-exclude-features=<name>` can leave out of an executable.
//!
//! A FEATURE IS CRATES THAT THE REST OF BUN DOES NOT DEPEND ON. They depend on Bun, like a plugin would, and are linked into
//! it like everything else. So nothing outside can name what is in them, which the compiler sees to, and all of it can go.
//!
//! WHAT THE SAME FEATURES NEED IS AN ISLAND: a stretch of the executable that the linker itself says the bounds of, a section
//! or the like. Everything that is compiled for those crates goes there (scripts/build/feature-pass.cpp). Within an island
//! the linker drops, folds and moves what it likes, and nothing is shared between one and what is outside it, which
//! Bun's build checks in what it linked (scripts/build/check-features.ts). So whether a byte stays is a matter of where it
//! is, and `bun build --compile` leaves out the islands that none of the features that stay need (src/exe_features).
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
//! Whether this executable has a feature is `feature!(lint)`, and of several, `feature!(lint, fmt)`, whether it has one of them.
//! It reads a byte that `bun build --compile` clears.
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
//! That is `if feature!(lint) { the function behind it } else { the body }`, and the declaration that it takes to call a function
//! of a crate that this one does not depend on. Nothing is inlined through a door, so it belongs where a feature is entered,
//! not in a loop.

mod ids;
pub use bun_core_macros::{behind, door};
use ids::NAMES;

/// For each feature, whether it is there: 1, which `bun build --compile` makes 0 in the file it writes.
#[used(linker)]
#[cfg_attr(
    not(any(target_os = "macos", windows)),
    unsafe(link_section = ".bun_feature_present")
)]
#[cfg_attr(target_os = "macos", unsafe(link_section = "__TEXT,__bun_feat_pres"))]
#[cfg_attr(windows, unsafe(link_section = ".bunfprs"))]
static PRESENT: [u8; NAMES.len()] = [1; NAMES.len()];

/// For `feature!`. The first feature is number 1.
#[doc(hidden)]
#[inline(always)]
pub fn is_present(number: usize) -> bool {
    // SAFETY: it is a static. Volatile, because all the compiler sees is a 1 that nothing writes to.
    unsafe { (&raw const PRESENT[number - 1]).read_volatile() != 0 }
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

/// The features that need each island, from island 1: `1;1,2,3;2,3`. Bun's build knows (scripts/build/rust/features.ts). It is
/// empty where that cannot make islands, and `bun build --compile` then says that nothing can be left out.
const ISLANDS: &str = match option_env!("BUN_FEATURE_ISLANDS") {
    Some(islands) => islands,
    None => "",
};

#[used(linker)]
#[cfg_attr(
    not(any(target_os = "macos", windows)),
    unsafe(link_section = ".bun_feature_islands")
)]
#[cfg_attr(target_os = "macos", unsafe(link_section = "__TEXT,__bun_feat_isl"))]
#[cfg_attr(windows, unsafe(link_section = ".bunfisl"))]
static ISLANDS_IN_THE_EXECUTABLE: [u8; ISLANDS.len()] = {
    let (mut bytes, mut i) = ([0; ISLANDS.len()], 0);
    while i < bytes.len() {
        bytes[i] = ISLANDS.as_bytes()[i];
        i += 1;
    }
    bytes
};

/// Room for program headers. An ELF file with pages left out has one more for each gap, the table of them cannot grow where
/// the linker put it, and it has to be near the start of the file, where notes are.
#[cfg(not(any(target_os = "macos", windows)))]
#[used(linker)]
#[unsafe(link_section = ".note.bun")]
static PROGRAM_HEADERS: Note = Note {
    name_size: 4,
    size: size_of::<[u64; 7 * 64]>() as u32,
    kind: 1,
    name: *b"Bun\0",
    room: [0; 7 * 64],
};

#[cfg(not(any(target_os = "macos", windows)))]
#[repr(C)]
struct Note {
    name_size: u32,
    size: u32,
    kind: u32,
    name: [u8; 4],
    /// 64 headers of 56 bytes. Older Linux accepts no more than a page of them, which is 73.
    room: [u64; 7 * 64],
}
