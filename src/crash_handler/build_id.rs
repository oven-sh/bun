//! The name that `bun build --compile --aot` gives an executable: 16 bytes made of the compiled program and of this build of
//! Bun. `bun_exe_format::build_id` writes them into the copy of this executable that gets the program. In Bun itself they
//! are zero. Nothing compares them with anything when the process starts.

const NOTE_SIZE: usize = 32;
const ID_OFFSET: usize = 16;

#[cfg(all(not(miri), target_vendor = "apple"))]
core::arch::global_asm!(
    ".section __TEXT,__bun_build_id",
    ".globl _Bun__buildIdNote",
    ".p2align 2",
    "_Bun__buildIdNote:",
    ".long 4, 16, 1",
    ".asciz \"Bun\"",
    ".zero 16",
    ".text",
);

#[cfg(all(not(miri), windows))]
core::arch::global_asm!(
    ".section .bunid,\"dr\"",
    ".globl Bun__buildIdNote",
    ".p2align 2",
    "Bun__buildIdNote:",
    ".long 4, 16, 1",
    ".asciz \"Bun\"",
    ".zero 16",
    ".text",
);

// A note in an allocated section: `readelf -n` shows it, and `strip` keeps it.
#[cfg(not(any(miri, target_vendor = "apple", windows)))]
core::arch::global_asm!(
    ".section .note.bun,\"aR\",@note",
    ".p2align 3",
    ".long 4, 3584, 1",
    ".asciz \"Bun\"",
    ".zero 3584",
    ".section .note.bun.build-id,\"a\",@note",
    ".globl Bun__buildIdNote",
    ".type Bun__buildIdNote,@object",
    ".size Bun__buildIdNote, 32",
    ".p2align 2",
    "Bun__buildIdNote:",
    ".long 4, 16, 1",
    ".asciz \"Bun\"",
    ".zero 16",
    ".text",
);

#[cfg(not(miri))]
unsafe extern "C" {
    #[link_name = "Bun__buildIdNote"]
    static NOTE: [u8; NOTE_SIZE];
}

#[cfg(not(miri))]
#[inline(always)]
fn note() -> &'static [u8; NOTE_SIZE] {
    // SAFETY: the symbol is defined in this file, has this size, and nothing writes it after the executable is built.
    unsafe { &NOTE }
}

#[cfg(miri)]
fn note() -> &'static [u8; NOTE_SIZE] {
    &[0; NOTE_SIZE]
}

/// `None` in an executable that holds no compiled program.
pub fn build_id() -> Option<[u8; 16]> {
    let mut id = [0u8; 16];
    id.copy_from_slice(&note()[ID_OFFSET..]);
    (id != [0; 16]).then_some(id)
}

pub fn write_hexadecimal(id: &[u8]) -> [u8; 32] {
    let mut text = [b'0'; 32];
    for (byte, digits) in id.iter().zip(text.chunks_exact_mut(2)) {
        digits[0] = b"0123456789abcdef"[usize::from(byte >> 4)];
        digits[1] = b"0123456789abcdef"[usize::from(byte & 15)];
    }
    text
}
