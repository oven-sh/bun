//! Features of the runtime that `bun build --compile --compile-exclude-features=<name>` can leave out of an executable.
//!
//! ```ignore
//! match feature::enter::<{ feature::LINT }, _>(|| lint_command::run(ctx)) {
//!     Some(result) => result,
//!     None => built_without_this_command(),
//! }
//! ```
//!
//! [`enter`] runs the closure in bun itself, at the cost of one no-op. In an executable made without the feature it returns
//! `None`, and whatever only the closure reached is gone from the file: every function and constant that nothing left in
//! the executable refers to, the way a linker would drop it had the closure been under an `#[cfg]`.
//!
//! So mark the doors, not the rooms. Nothing says which code belongs to a feature. Code that something else still uses
//! stays, and a door that was missed costs bytes, never correctness.
//!
//! The closure is compiled as a function of its own, which is what makes "only the closure" something that can be told from
//! the machine code. Nothing else about the compiler's output is relied on.
//!
//! [`present`] is the condition alone, for where there is nothing to leave out: an error message, a line of `--help`.

mod ids;
pub use ids::*;

#[cfg(any(target_os = "linux", target_os = "macos", windows))]
pub use marked::{enter, present};

/// Nothing can be excluded on this platform.
#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
#[inline(always)]
pub fn present<const ID: u32>() -> bool {
    true
}

/// Nothing can be excluded on this platform.
#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
#[inline(always)]
pub fn enter<const ID: u32, R>(door: impl FnOnce() -> R) -> Option<R> {
    Some(door())
}

#[cfg(any(target_os = "linux", target_os = "macos", windows))]
mod marked {
    // An instruction that does nothing and holds the feature's id. No other code has it, so the linker cannot fold a
    // function that has one with a function that has none, or with one of another feature. It is as long as a jump.
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

    // A record: where the no-op is, where to jump instead of it (0: nowhere, it is in a door), and the id. Bun's build reads
    // these after linking. ELF: addresses, in a section that is not loaded. Mach-O, PE: distances from the record, in one
    // that is.
    #[cfg(target_os = "linux")]
    macro_rules! record {
        ($otherwise:literal) => {
            concat!(
                ".pushsection .bun_features,\"\",@progbits\n.quad 2b\n.quad ",
                $otherwise,
                "\n.long {id}\n.long 0\n.popsection"
            )
        };
    }
    // On x86-64 Mach-O a label can be subtracted only if a symbol the linker sees comes before it in its section.
    #[cfg(target_os = "macos")]
    macro_rules! record {
        ($otherwise:literal) => {
            concat!(
                ".pushsection __TEXT,__bun_feat,regular,live_support\n.ifndef l_bun_feat\nl_bun_feat:\n.endif\n",
                "3: .long 2b - 3b\n.long ",
                $otherwise,
                "\n.long {id}\n.long 0\n.popsection"
            )
        };
    }
    #[cfg(windows)]
    macro_rules! record {
        ($otherwise:literal) => {
            concat!(
                ".pushsection .bunft,\"dr\"\n3: .long 2b - 3b\n.long ",
                $otherwise,
                "\n.long {id}\n.long 0\n.popsection"
            )
        };
    }
    #[cfg(target_os = "linux")]
    macro_rules! record_with_jump {
        () => {
            record!("{no}")
        };
    }
    #[cfg(not(target_os = "linux"))]
    macro_rules! record_with_jump {
        () => {
            record!("{no} - 3b")
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
        const { assert!(ID > 0 && ID < 1 << 16, "the arm64 no-op holds 16 bits") };
        // SAFETY: does nothing, or jumps to the label.
        unsafe {
            core::arch::asm!(
                no_op!(),
                record_with_jump!(),
                id = const ID,
                no = label { return false },
                options(nomem, nostack, preserves_flags)
            );
        }
        true
    }

    /// Runs `door` if this executable has the feature `ID`.
    #[inline(always)]
    pub fn enter<const ID: u32, R>(door: impl FnOnce() -> R) -> Option<R> {
        if present::<ID>() {
            Some(through::<ID, R>(door))
        } else {
            None
        }
    }

    /// Only [`enter`] calls this, after it asked. So without the feature nothing runs it, whoever refers to it.
    #[inline(never)]
    #[cfg_attr(
        target_os = "macos",
        expect(
            named_asm_labels,
            reason = "`.ifndef` keeps copies of this from defining it twice"
        )
    )]
    fn through<const ID: u32, R>(door: impl FnOnce() -> R) -> R {
        // SAFETY: does nothing.
        unsafe {
            core::arch::asm!(
                no_op!(),
                record!("0"),
                id = const ID,
                options(nomem, nostack, preserves_flags)
            );
        }
        door()
    }
}

/// Room for what Bun's build finds out about the executable once it is linked: which bytes only which features need.
/// `bun build --compile` reads it in the file it copies. Nothing reads it in memory.
#[cfg(any(target_os = "linux", target_os = "macos", windows))]
#[used(linker)]
#[cfg_attr(target_os = "linux", unsafe(link_section = ".bun_feature_table"))]
#[cfg_attr(target_os = "macos", unsafe(link_section = "__TEXT,__bun_feat_tab"))]
#[cfg_attr(windows, unsafe(link_section = ".bunftab"))]
static TABLE: [u8; 1 << 16] = [0; 1 << 16];

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
