//! With AVX2 and BMI2. The compiler runs out of registers for this, and does not mix the stages evenly.

use core::arch::asm;
use core::mem::offset_of;

use super::{
    Buffers, CHUNK, Finder, GROUP, GROUP_BYTES_MAX, Group, ORDERS, Periods, Reach, Reader, SLOTS,
    Sequences,
};

/// `r14` points at `ends`, from where a byte is enough for the displacements.
const _: () = assert!(
    offset_of!(Group, bits) == 64
        && offset_of!(Group, ends) == 128
        && offset_of!(Group, match_starts) == 160
        && offset_of!(Group, sources) == 192
        && offset_of!(Group, offsets) == 224
        && offset_of!(Sequences<'_>, groups) == 0
        && offset_of!(Sequences<'_>, reader) + offset_of!(Reader<'_>, repeats) == 512
        && offset_of!(Frame, reach) == 160
        && offset_of!(Constants, periods) == 256
);

#[repr(C, align(64))]
struct Constants {
    numbers: [[u32; GROUP]; 7],
    /// Moves the bits of four numbers to where `vpmovmskb` looks: the lower two in pairs, then the third.
    spread: [[[u16; 4]; 2]; 2],
    periods: Periods,
}

static CONSTANTS: Constants = {
    let bytes = [255, 0, 255, 0, 255, 0, 255, 0];
    Constants {
        numbers: [
            [0; _],
            [15; _],
            [1 << 31; _],
            [CHUNK as u32; _],
            [3; _],
            [31; _],
            bytes,
        ],
        spread: [[[0x4080; _], [0x2000; _]]; _],
        periods: Periods::ALL,
    }
};

/// What finds no register. It is copied to the top of the stack.
#[repr(C)]
struct Frame {
    /// Places in the reach: the last that is detached, and the last from which the span is.
    last_detached: [i32; GROUP],
    last_detached_span: [i32; GROUP],
    gap: [i32; GROUP],
    orders: *const [u8; GROUP],
    literals_end: *const u8,
    out_end: *const u8,
    loaded_min: *const u8,
    span: usize,
    out: *const u8,
    detached_len: usize,
    detached_end: *const u8,
    reach: Reach,
}

impl Frame {
    #[inline(always)]
    fn new(sequences: &Sequences<'_>, buffers: &Buffers<'_>) -> Self {
        let reach = Reach::new(buffers);
        Self {
            last_detached: [reach.detached_len - 1; _],
            last_detached_span: [reach.detached_len - 2 * CHUNK as i32; _],
            gap: [reach.gap; _],
            orders: ORDERS.as_ptr(),
            literals_end: buffers.literals.wrapping_add(buffers.literals_end),
            out_end: buffers.out.wrapping_add(buffers.out_ends[2]),
            loaded_min: sequences.reader.src.as_ptr().wrapping_add(GROUP_BYTES_MAX),
            span: sequences.span(),
            out: buffers.out,
            detached_len: buffers.detached.len(),
            detached_end: buffers.detached.as_ptr_range().end,
            reach,
        }
    }
}

/// With the reach in `ecx`.
macro_rules! enter {
    ($frame:literal) => {
        lines!(
            "push rbx",
            "vmovd xmm14, ecx",
            "vpbroadcastd ymm14, xmm14",
            concat!("vpbroadcastd ymm7, [", $frame, " + 128]"),
            "vmovdqa ymm8, [rip + {constants} + 96]",
            "vpcmpeqd ymm10, ymm10, ymm10",
            "vmovdqa ymm11, [rip + {constants} + 128]",
            "vmovdqa ymm12, [rip + {constants} + 160]",
            "vmovdqa ymm13, [rip + {constants} + 192]",
            "mov rcx, r14",
            "or rcx, 256",
            "vmovdqa ymm15, [rcx + 128]",
        )
    };
}

macro_rules! leave {
    () => {
        lines!(
            "mov rbx, r14",
            "or rbx, 256",
            "vmovdqa [rbx + 128], ymm15",
            "pop rbx",
            "vzeroupper",
        )
    };
}

/// The second stage in parts, for the group at which `r14` does not point.
macro_rules! prepare {
    // ymm1: the upper halves of the sums, ymm3: extra bits
    (0) => {
        lines!(
            "mov rcx, r14",
            "xor rcx, 256",
            "vmovdqa ymm1, [rcx - 128]",
            "vpand ymm3, ymm13, [rcx - 127]",
            "vpand ymm4, ymm13, [rcx - 95]",
            "vshufps ymm1, ymm1, [rcx - 96], 0xDD",
            "vmovdqa ymm5, [rcx - 64]",
            "vmovdqa ymm6, [rcx - 32]",
            "vpsrlvq ymm3, ymm5, ymm3",
            "vpsrlvq ymm4, ymm6, ymm4",
            "vshufps ymm3, ymm3, ymm4, 0x88",
        )
    };
    // ymm3: literal lengths, ymm5: match lengths
    (1) => {
        lines!(
            "vpsrld ymm2, ymm1, 2",
            "vpand ymm2, ymm2, ymm12",
            "vpsrld ymm4, ymm1, 7",
            "vpand ymm4, ymm4, [rip + {constants} + 32]",
            "vpsrlvd ymm5, ymm3, ymm2",
            "vpsubd ymm4, ymm5, ymm4",
            "vpsllvd ymm4, ymm4, ymm2",
            "vpsubd ymm3, ymm3, ymm4",
            "vpsrld ymm2, ymm1, 11",
            "vpand ymm2, ymm2, ymm12",
            "vpsrld ymm4, ymm1, 16",
            "vpand ymm4, ymm4, ymm12",
            "vpsrlvd ymm6, ymm5, ymm2",
            "vpsubd ymm4, ymm6, ymm4",
            "vpsllvd ymm4, ymm4, ymm2",
            "vpsubd ymm5, ymm5, ymm4",
            "vpaddd ymm5, ymm5, ymm11",
        )
    };
    // ymm6: new offsets, ymm2: which are repeated
    (2) => {
        lines!(
            "vpsrld ymm2, ymm1, 21",
            "vpand ymm2, ymm2, ymm12",
            "vpsllvd ymm2, ymm10, ymm2",
            "vpandn ymm6, ymm2, ymm6",
            "vpsubd ymm6, ymm6, ymm2",
            "vpcmpeqd ymm2, ymm3, [rip + {constants}]",
            "vpsubd ymm2, ymm6, ymm2",
            "vpcmpgtd ymm4, ymm6, ymm11",
            "vpandn ymm2, ymm4, ymm2",
            "vpsubd ymm6, ymm6, ymm11",
            "vpackusdw ymm2, ymm2, ymm2",
            "vpmullw ymm2, ymm2, [rip + {constants} + 224]",
        )
    };
    // ymm1: offsets, ymm9: those to repeat
    (3, $frame:literal) => {
        lines!(
            "vpmovmskb ecx, ymm2",
            ".p2align 5, , 12",
            "test ecx, 0xFF00FF00",
            "jnz 28f",
            "25:",
            prepare!(resolve, $frame),
        )
    };
    (resolve, $frame:literal) => {
        lines!(
            "movzx ebx, cl",
            "shr ecx, 13",
            "shl ebx, 3",
            concat!("add rcx, [", $frame, " + 96]"),
            concat!("add rbx, [", $frame, " + 96]"),
            "vpmovzxbd ymm2, qword ptr [rcx]",
            "vpmovzxbd ymm1, qword ptr [rbx]",
            "vpblendd ymm4, ymm6, ymm15, 0xF0",
            "vpermd ymm1, ymm1, ymm4",
            "vperm2i128 ymm4, ymm6, ymm1, 0x31",
            "vpermd ymm9, ymm2, ymm4",
            "vinserti128 ymm1, ymm1, xmm9, 1",
        )
    };
    // One less than the offset before counts as new. Each round gets one more right. It takes 16 bytes of the stack.
    (decrements, $frame:literal) => {
        lines!(
            "28:",
            "vpor ymm0, ymm3, ymm6",
            "vpcmpeqd ymm0, ymm0, [rip + {constants}]",
            "vmovmskps ebx, ymm0",
            "and ecx, 0x00FF00FF",
            "24:",
            "push rbx",
            "push rcx",
            prepare!(resolve, $frame),
            "vperm2i128 ymm2, ymm15, ymm1, 0x21",
            "vpshufd xmm4, xmm2, 0",
            "vpblendd ymm2, ymm2, ymm4, 0x0F",
            "vpalignr ymm1, ymm1, ymm2, 12",
            "vpaddd ymm1, ymm1, ymm10",
            "vpmaxsd ymm1, ymm1, [rip + {constants}]",
            "vpblendvb ymm6, ymm6, ymm1, ymm0",
            "pop rcx",
            "pop rbx",
            "blsr ebx, ebx",
            "jnz 24b",
            "jmp 25b",
        )
    };
    // ymm2: ends in the output, ymm4: starts of matches
    (4) => {
        lines!(
            "vpaddd ymm2, ymm3, ymm5",
            "vpslld ymm2, ymm2, 16",
            "vpor ymm2, ymm2, ymm3",
            "vpslldq ymm4, ymm2, 4",
            "vpaddd ymm2, ymm2, ymm4",
            "vpslldq ymm4, ymm2, 8",
            "vpaddd ymm2, ymm2, ymm4",
            "vpshufd ymm4, ymm2, 0xFF",
            "vperm2i128 ymm4, ymm4, ymm4, 0x08",
            "vpaddd ymm2, ymm2, ymm4",
            "mov rcx, r14",
            "xor rcx, 256",
            "vmovdqa [rcx], ymm2",
            "vmovdqa [rcx + 96], ymm1",
            "vpsrld ymm2, ymm2, 16",
            "vpsubd ymm4, ymm2, ymm5",
        )
    };
    // ymm3: negative for those that are special, ymm6: sources
    (5) => {
        lines!(
            "vpsubd ymm3, ymm8, ymm3",
            "vpsubd ymm6, ymm7, ymm5",
            "vpor ymm3, ymm3, ymm6",
            "vpminsd ymm5, ymm5, ymm8",
            "vpsubd ymm5, ymm1, ymm5",
            "vpor ymm3, ymm3, ymm5",
            "vpsubd ymm6, ymm4, ymm1",
            "vpaddd ymm1, ymm6, ymm14",
            "vpermd ymm2, ymm12, ymm2",
            "vpaddd ymm14, ymm14, ymm2",
            "vpor ymm3, ymm3, ymm1",
        )
    };
    (6, $frame:literal) => {
        lines!(
            concat!("vpcmpgtd ymm2, ymm1, [", $frame, "]"),
            concat!("vpcmpgtd ymm1, ymm1, [", $frame, " + 32]"),
            "vpxor ymm1, ymm1, ymm2",
            "vpor ymm3, ymm3, ymm1",
            concat!("vpandn ymm2, ymm2, [", $frame, " + 64]"),
            "vpaddd ymm6, ymm6, ymm2",
            "vpand ymm3, ymm3, [rip + {constants} + 64]",
            "vpor ymm4, ymm4, ymm3",
            "mov rcx, r14",
            "xor rcx, 256",
            "vmovdqa [rcx + 32], ymm4",
            "vmovdqa [rcx + 64], ymm6",
        )
    };
}

/// From and to `r8 + 8 * r11` and so on. It leaves the sum in `rax` and the bits in `rdx`.
macro_rules! next_rows {
    ($index:literal) => {
        lines!(
            "add rax, [r9 + 8 * r12]",
            "mov rcx, [r10 + 8 * r13]",
            "mov rbx, [r8 + 8 * r11]",
            "add rax, rcx",
            ".p2align 5, , 9",
            "add rax, rbx",
            concat!("jl 3", $index, "f"),
            "mov r8w, [r8 + 8 * r11 + 2]",
            "shrx rdx, rdx, rax",
            "shr ecx, 8",
            "movzx ebx, bh",
            "mov r10w, [r10 + 8 * r13 + 2]",
            "movzx r13d, byte ptr [r9 + 8 * r12 + 1]",
            "mov r9w, [r9 + 8 * r12 + 2]",
            "bzhi r12, rdx, r13",
            "shrx r13, rdx, r13",
            "shrx r11, r13, rcx",
            "bzhi r13, r13, rcx",
            "bzhi r11, r11, rbx",
        )
    };
}

/// For when that gave up, and from label 29 on for when it did not.
macro_rules! settle_rows {
    () => {
        lines!(
            "sub rax, [r9 + 8 * r12]",
            "sub rax, [r10 + 8 * r13]",
            "sub rax, [r8 + 8 * r11]",
            "29:",
            "lea r8, [r8 + 8 * r11]",
            "lea r9, [r9 + 8 * r12]",
            "lea r10, [r10 + 8 * r13]",
        )
    };
}

/// Finds one sequence and runs another. `r15` lags behind by `$index`.
macro_rules! step {
    ($index:literal, $slot:literal) => {
        lines!(
            next_rows!($index),
            concat!("mov [r14 - 128 + 8 * ", $slot, "], rax"),
            concat!("mov [r14 - 64 + 8 * ", $slot, "], rdx"),
            "rorx rcx, rax, 3",
            "or rcx, -8",
            "and eax, 7",
            "add r15, rcx",
            concat!("mov rdx, [r15 + 1 + ", $index, "]"),
            concat!(".if ", $index),
            concat!("movzx ecx, word ptr [r14 - 4 + 4 * ", $index, "]"),
            concat!("movzx ebx, word ptr [r14 - 2 + 4 * ", $index, "]"),
            "vmovdqu ymm0, [rsi + rcx]",
            "vmovdqu [rdi + rbx], ymm0",
            ".else",
            "vmovdqu ymm0, [rsi]",
            "vmovdqu [rdi], ymm0",
            ".endif",
            concat!("movsxd rcx, dword ptr [r14 + 32 + 4 * ", $index, "]"),
            concat!("movsxd rbx, dword ptr [r14 + 64 + 4 * ", $index, "]"),
            ".p2align 5, , 9",
            "add rcx, rdi",
            concat!("jc 4", $index, "f"),
            "vmovdqu ymm0, [rdi + rbx]",
            "vmovdqu [rcx], ymm0",
            ".if {is_wide}",
            "vmovdqu ymm0, [rdi + rbx + 32]",
            "vmovdqu [rcx + 32], ymm0",
            ".endif",
            concat!("5", $index, ":"),
        )
    };
}

/// Like `run_special()`, for the sequence with index `ecx`. Sets the carry flag for `false`.
macro_rules! run_special {
    () => {
        lines!(
            "push rax",
            "push rdx",
            "push r8",
            "xor eax, eax",
            "test ecx, ecx",
            "cmovnz eax, [r14 - 4 + 4 * rcx]",
            "mov r8d, [r14 + 32 + 4 * rcx]",
            "btr r8d, 31",
            "movzx edx, ax",
            "shr eax, 16",
            "add eax, 32",
            "cmp eax, r8d",
            "jae 62f",
            "63:",
            "vmovdqu ymm0, [rsi + rdx + 32]",
            "vmovdqu [rdi + rax], ymm0",
            "prefetcht0 [rdi + rax + 1024]",
            "add edx, 32",
            "add eax, 32",
            "cmp eax, r8d",
            "jb 63b",
            "62:",
            "movzx eax, word ptr [r14 + 2 + 4 * rcx]",
            "mov ebx, [r14 + 96 + 4 * rcx]",
            "add rax, rdi",
            "add r8, rdi",
            "mov rdx, r8",
            "sub rdx, [rsp + 32 + 136]",
            "lea rcx, [rbx - 1]",
            "cmp rcx, rdx",
            "jae 66f",
            "mov rdx, r8",
            "sub rdx, rbx",
            "cmp ebx, 32",
            "jb 64f",
            "63:",
            "vmovdqu ymm0, [rdx]",
            "vmovdqu [r8], ymm0",
            "prefetcht0 [r8 + 1024]",
            "vmovdqu ymm0, [rdx + 32]",
            "vmovdqu [r8 + 32], ymm0",
            "add rdx, 64",
            "add r8, 64",
            "cmp r8, rax",
            "jb 63b",
            "jmp 69f",
            "66:",
            "sub rbx, rdx",
            "cmp [rsp + 32 + 144], rbx",
            "jb 69f",
            "lea rcx, [rax + 64]",
            "sub rcx, r8",
            "cmp rbx, rcx",
            "jb 69f",
            "mov rdx, [rsp + 32 + 152]",
            "sub rdx, rbx",
            "jmp 63b",
            "64:",
            "cmp ebx, 16",
            "jb 65f",
            "vmovdqu ymm0, [rdx]",
            "jmp 67f",
            "65:",
            "vbroadcasti128 ymm0, [rdx]",
            "lea rcx, [rip + {constants} + 256]",
            "mov edx, ebx",
            "shl edx, 5",
            "vpshufb ymm0, ymm0, [rcx + rdx]",
            "movzx ebx, byte ptr [rcx + rbx + 512]",
            "67:",
            "vmovdqu [r8], ymm0",
            "prefetcht0 [r8 + 1024]",
            "add r8, rbx",
            "cmp r8, rax",
            "jb 67b",
            "69:",
            "pop r8",
            "pop rdx",
            "pop rax",
            "ret",
        )
    };
}

macro_rules! asm_with_all_vectors {
    ($($arguments:tt)*) => {
        asm!(
            $($arguments)*
            out("xmm0") _, out("xmm1") _, out("xmm2") _, out("xmm3") _,
            out("xmm4") _, out("xmm5") _, out("xmm6") _, out("xmm7") _,
            out("xmm8") _, out("xmm9") _, out("xmm10") _, out("xmm11") _,
            out("xmm12") _, out("xmm13") _, out("xmm14") _, out("xmm15") _,
        )
    };
}

#[inline(always)]
fn ends_of_running(sequences: &mut Sequences<'_>) -> *mut u8 {
    let offset = sequences.running % 2 * size_of::<Group>() + offset_of!(Group, ends);
    core::ptr::from_mut(sequences)
        .cast::<u8>()
        .wrapping_add(offset)
}

#[target_feature(enable = "avx2,bmi1")]
fn prepare(sequences: &mut Sequences<'_>, frame: &Frame) {
    // SAFETY: it only touches a group, the offsets behind the groups, the constants and one of the orders.
    unsafe {
        asm_with_all_vectors!(
            enter!("rdx"),
            prepare!(0), prepare!(1), prepare!(2), prepare!(3, "rdx"),
            prepare!(4), prepare!(5), prepare!(6, "rdx"),
            "vmovdqa ymm15, ymm9",
            "jmp 29f",
            prepare!(decrements, "rdx"),
            "29:",
            leave!(),
            constants = sym CONSTANTS,
            inout("ecx") frame.reach.len_from(sequences.waiting_position()) => _,
            in("rdx") frame,
            in("r14") ends_of_running(sequences),
        );
    }
}

/// Up to `end` of the group. Returns how far it got. SAFETY: as for `Finder::find()`, with tables that are settled.
#[target_feature(enable = "bmi2")]
unsafe fn find(sequences: &mut Sequences<'_>, finder: &mut Finder, end: usize) -> usize {
    let slots = u64::from_le_bytes(SLOTS.map(|it| it as u8));
    let mut left = end - sequences.found;
    assert!(end <= GROUP);
    // SAFETY: it does what `Sequences::find()` does, as long as it can go back 7 bytes in the source.
    unsafe {
        asm!(
            "push rbx",
            "push rcx",
            "jmp 22f",
            "21:",
            next_rows!(0),
            "movzx ecx, sil",
            "shr rsi, 8",
            "mov [r14 - 128 + 8 * rcx], rax",
            "mov [r14 - 64 + 8 * rcx], rdx",
            "rorx rcx, rax, 3",
            "or rcx, -8",
            "and eax, 7",
            "mov rdx, [r15 + rcx + 1]",
            "lea r15, [r15 + rcx + 1]",
            "dec rdi",
            "22:",
            "test rdi, rdi",
            "jz 29f",
            "cmp r15, [rsp]",
            "jae 21b",
            "jmp 29f",
            "30:",
            settle_rows!(),
            "pop rcx",
            "pop rbx",
            inout("rax") finder.spare,
            inout("rcx") sequences.reader.src.as_ptr().wrapping_add(7) => _,
            inout("rdx") finder.word,
            inout("rsi") slots.wrapping_shr(8 * sequences.found as u32) => _,
            inout("rdi") left,
            inout("r8") finder.rows[0],
            inout("r9") finder.rows[1],
            inout("r10") finder.rows[2],
            inout("r11") 0usize => _,
            inout("r12") 0usize => _,
            inout("r13") 0usize => _,
            in("r14") ends_of_running(sequences),
            inout("r15") finder.loaded,
        );
    }
    end - left
}

/// SAFETY: as `Sequences::run_with()` calls it. The tables are settled, and the output is above the first 2 GB of memory.
#[target_feature(enable = "avx2,bmi1,bmi2")]
#[inline(never)]
unsafe fn overlap<const IS_WIDE: bool, const IS_FAR: bool>(
    sequences: &mut Sequences<'_>,
    buffers: &Buffers<'_>,
    frame: &Frame,
    finder: &mut Finder,
) {
    let mut literals = buffers.literals.wrapping_add(sequences.literal_position);
    let mut out = buffers.out.wrapping_add(sequences.position);
    let mut ends = ends_of_running(sequences);
    let (found_and_ran, mut surplus): (i32, _);
    surplus = sequences.reader.left - GROUP;
    // SAFETY: it does what `Sequences::overlap()` does.
    unsafe {
        asm_with_all_vectors!(
            enter!("r12"),
            "sub rsp, 200",
            ".irp at, 0, 32, 64, 96, 128",
            "vmovdqu ymm0, [r12 + \\at]",
            "vmovdqu [rsp + \\at], ymm0",
            ".endr",
            "mov [rsp + 160], r11",
            "xor r11d, r11d",
            "xor r12d, r12d",
            ".p2align 5",
            "20:",
            "movzx ebx, word ptr [r14 + 28]",
            "movzx ecx, word ptr [r14 + 30]",
            "add rbx, rsi",
            "add rcx, rdi",
            ".p2align 5, , 11",
            "cmp rbx, [rsp + 104]",
            "ja 27f",
            ".p2align 5, , 11",
            "cmp rcx, [rsp + 112]",
            "ja 27f",
            ".p2align 5, , 11",
            "cmp r15, [rsp + 120]",
            "jb 27f",
            "prefetcht0 [rcx + 1024]",
            "prefetcht0 [rcx + 1024 - 64]",
            "prefetcht0 [rcx + 1024 - 128]",
            ".if {is_wide}",
            "prefetcht0 [rcx + 1024 - 192]",
            "prefetcht0 [rcx + 1024 - 256]",
            ".endif",
            ".if {is_far}",
            step!(0, 0), prepare!(0), prepare!(1), prepare!(2),
            step!(1, 1), prepare!(3, "rsp"), prepare!(4),
            step!(2, 4), prepare!(5), prepare!(6, "rsp"),
            "vpbroadcastd ymm2, [r14 + 28]",
            "vpsrld ymm2, ymm2, 16",
            "vpaddd ymm6, ymm6, ymm2",
            "vmovdqu [rsp + 168], ymm6",
            ".irp index, 0, 1, 2, 3, 4, 5, 6, 7",
            "movsxd rbx, dword ptr [rsp + 168 + 4 * \\index]",
            "prefetcht0 [rdi + rbx]",
            "prefetcht0 [rdi + rbx + 31 + 32 * {is_wide}]",
            ".endr",
            step!(3, 5), step!(4, 2), step!(5, 3), step!(6, 6),
            ".else",
            step!(0, 0), prepare!(0),
            step!(1, 1), prepare!(1),
            step!(2, 4), prepare!(2),
            step!(3, 5), prepare!(3, "rsp"),
            step!(4, 2), prepare!(4),
            step!(5, 3), prepare!(5),
            step!(6, 6), prepare!(6, "rsp"),
            ".endif",
            step!(7, 7),
            "vmovdqa ymm15, ymm9",
            "movzx ebx, word ptr [r14 + 28]",
            "movzx ecx, word ptr [r14 + 30]",
            "add r15, 8",
            "add rsi, rbx",
            "add rdi, rcx",
            "xor r14, 256",
            "sub qword ptr [rsp + 160], 8",
            ".p2align 5, , 6",
            "jae 20b",
            "27:",
            "xor ecx, ecx",
            "jmp 29f",
            ".irp index, 0, 1, 2, 3, 4, 5, 6, 7",
            "3\\index:",
            "mov ecx, 0x101 * \\index",
            "jmp 26f",
            "4\\index:",
            "mov ecx, \\index",
            "call 60f",
            "jnc 5\\index\\()b",
            "mov ecx, 0x101 * \\index + 1",
            "jmp 29f",
            ".endr",
            "60:",
            run_special!(),
            prepare!(decrements, "rsp + 16"),
            "26:",
            settle_rows!(),
            "mov r11, [rsp + 160]",
            "add rsp, 200",
            leave!(),
            constants = sym CONSTANTS,
            is_far = const IS_FAR as u8,
            is_wide = const IS_WIDE as u8,
            inout("rax") finder.spare,
            inout("ecx") frame.reach.len_from(sequences.waiting_position()) => found_and_ran,
            inout("rdx") finder.word,
            inout("rsi") literals,
            inout("rdi") out,
            inout("r8") finder.rows[0],
            inout("r9") finder.rows[1],
            inout("r10") finder.rows[2],
            inout("r11") surplus,
            inout("r12") frame => _,
            inout("r13") 0usize => _,
            inout("r14") ends,
            inout("r15") finder.loaded,
        );
    }
    let left = surplus.wrapping_add(GROUP);
    let at = [ends.addr(), literals.addr(), out.addr()];
    sequences.catch_up(buffers, finder, found_and_ran as usize, left, at);
}

pub(super) fn run(sequences: &mut Sequences<'_>, buffers: &Buffers<'_>) {
    /// SAFETY: as for `overlap()`.
    #[target_feature(enable = "avx2,bmi1,bmi2")]
    unsafe fn with_avx2(sequences: &mut Sequences<'_>, buffers: &Buffers<'_>) {
        let overlap = match (sequences.is_wide(), sequences.is_far()) {
            (false, true) => overlap::<false, true>,
            (true, false) => overlap::<true, false>,
            (true, true) => overlap::<true, true>,
            (false, false) => overlap::<false, false>,
        };
        let frame = &Frame::new(sequences, buffers);
        sequences.run_with(
            buffers,
            // SAFETY: see above.
            |sequences, finder, end| unsafe { find(sequences, finder, end) },
            |sequences| prepare(sequences, frame),
            // SAFETY: the same.
            |sequences, finder| unsafe { overlap(sequences, buffers, frame, finder) },
        );
    }

    if buffers.out.addr() >= 1 << 31
        && is_x86_feature_detected!("avx2")
        && is_x86_feature_detected!("bmi1")
        && is_x86_feature_detected!("bmi2")
    {
        // SAFETY: see above.
        unsafe { with_avx2(sequences, buffers) }
    } else {
        crate::out_of_line(|| sequences.run_portably(buffers));
    }
}
