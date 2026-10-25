//! The name that `bun build --compile --aot` gives an executable: 16 bytes made of the compiled program and of this build of Bun.

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
    ".long 4, 4088, 1",
    ".asciz \"Bun\"",
    ".zero 4088",
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

/// The build ID as a UUID: the debug ID that ties an external source map to this executable.
pub fn write_uuid(id: &[u8; 16]) -> [u8; 36] {
    let digits = write_hexadecimal(id);
    let mut text = [b'-'; 36];
    for (group, start) in [
        (0..8, 0),
        (8..12, 9),
        (12..16, 14),
        (16..20, 19),
        (20..32, 24),
    ] {
        text[start..start + group.len()].copy_from_slice(&digits[group]);
    }
    text
}

pub fn write_hexadecimal(id: &[u8]) -> [u8; 32] {
    let mut text = [b'0'; 32];
    for (byte, digits) in id.iter().zip(text.as_chunks_mut::<2>().0.iter_mut()) {
        digits[0] = b"0123456789abcdef"[usize::from(byte >> 4)];
        digits[1] = b"0123456789abcdef"[usize::from(byte & 15)];
    }
    text
}
