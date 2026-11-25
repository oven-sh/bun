//! With NEON. The compiler does not mix the stages evenly.

use core::arch::asm;
use core::mem::offset_of;

use super::{
    Buffers, Finder, GROUP, GROUP_BYTES_MAX, Group, ORDERS, Periods, Reach, Reader, Sequences,
};

const _: () = assert!(
    offset_of!(Group, bits) == 64
        && offset_of!(Group, ends) == 128
        && offset_of!(Group, match_starts) == 160
        && offset_of!(Group, sources) == 192
        && offset_of!(Group, offsets) == 224
        && offset_of!(Sequences<'_>, groups) == 0
        && offset_of!(Sequences<'_>, reader) + offset_of!(Reader<'_>, repeats) == 512
        && offset_of!(Frame, span) == 64
        && offset_of!(Constants, periods) == 64
);

#[repr(C, align(64))]
struct Constants {
    /// Four times each of the first four bytes, and of the next.
    widen: [[u32; 4]; 2],
    bytes_of_lane: [u32; 4],
    index_shifts: [u16; GROUP],
    periods: Periods,
}

static CONSTANTS: Constants = Constants {
    widen: [
        [0, 0x0101_0101, 0x0202_0202, 0x0303_0303],
        [0x0404_0404, 0x0505_0505, 0x0606_0606, 0x0707_0707],
    ],
    bytes_of_lane: [0x0302_0100; _],
    index_shifts: [0, 2, 4, 6, 8, 10, 12, 14],
    periods: Periods::ALL,
};

/// At `x25`.
#[repr(C)]
struct Frame {
    literals_end: *const u8,
    out_end: *const u8,
    loaded_min: *const u8,
    out: *const u8,
    detached_len: usize,
    detached_end: *const u8,
    orders: *const [u8; GROUP],
    constants: *const Constants,
    span: u32,
    is_far: u32,
    reach: Reach,
}

/// For four sequences, from the upper halves of their sums and their extra bits, which are in `$literal_lens` at first.
macro_rules! numbers {
    ($sums:literal, $literal_lens:literal, $match_lens:literal, $new:literal, $repeated:literal) => {
        lines!(
            concat!("ushr v0.4s, ", $sums, ".4s, #2"),
            "and v0.16b, v0.16b, v31.16b",
            "neg v1.4s, v0.4s",
            concat!("ushl ", $match_lens, ".4s, ", $literal_lens, ".4s, v1.4s"),
            concat!("ushr v1.4s, ", $sums, ".4s, #7"),
            "and v1.16b, v1.16b, v30.16b",
            concat!("sub v1.4s, ", $match_lens, ".4s, v1.4s"),
            "ushl v1.4s, v1.4s, v0.4s",
            concat!("sub ", $literal_lens, ".4s, ", $literal_lens, ".4s, v1.4s"),
            concat!("ushr v0.4s, ", $sums, ".4s, #11"),
            "and v0.16b, v0.16b, v31.16b",
            "neg v1.4s, v0.4s",
            concat!("ushl ", $new, ".4s, ", $match_lens, ".4s, v1.4s"),
            concat!("ushr v1.4s, ", $sums, ".4s, #16"),
            "and v1.16b, v1.16b, v31.16b",
            concat!("sub v1.4s, ", $new, ".4s, v1.4s"),
            "ushl v1.4s, v1.4s, v0.4s",
            concat!("sub ", $match_lens, ".4s, ", $match_lens, ".4s, v1.4s"),
            concat!("add ", $match_lens, ".4s, ", $match_lens, ".4s, v29.4s"),
            concat!("ushr v0.4s, ", $sums, ".4s, #21"),
            "and v0.16b, v0.16b, v31.16b",
            "ushl v0.4s, v28.4s, v0.4s",
            concat!("bic ", $new, ".16b, ", $new, ".16b, v0.16b"),
            concat!("sub ", $new, ".4s, ", $new, ".4s, v0.4s"),
            concat!("cmeq v0.4s, ", $literal_lens, ".4s, #0"),
            concat!("sub v0.4s, ", $new, ".4s, v0.4s"),
            concat!("cmgt v1.4s, ", $new, ".4s, v29.4s"),
            concat!("bic ", $repeated, ".16b, v0.16b, v1.16b"),
            concat!("sub ", $new, ".4s, ", $new, ".4s, v29.4s"),
        )
    };
}

/// With the order at index `$index`, from two registers in a row.
macro_rules! resolve {
    ($index:literal, $from:literal, $offsets:literal, $repeats:literal) => {
        lines!(
            concat!("ldr d0, [x26, ", $index, ", lsl #3]"),
            "shl v0.8b, v0.8b, #2",
            "tbl v1.16b, {{v0.16b}}, v4.16b",
            "tbl v0.16b, {{v0.16b}}, v5.16b",
            "add v1.16b, v1.16b, v6.16b",
            "add v0.16b, v0.16b, v6.16b",
            concat!("tbl ", $offsets, ".16b, {{", $from, "}}, v1.16b"),
            concat!("tbl ", $repeats, ".16b, {{", $from, "}}, v0.16b"),
        )
    };
}

macro_rules! add_up {
    ($literal_lens:literal, $match_lens:literal, $ends:literal) => {
        lines!(
            concat!("add v0.4s, ", $literal_lens, ".4s, ", $match_lens, ".4s"),
            concat!("trn1 ", $ends, ".8h, ", $literal_lens, ".8h, v0.8h"),
            concat!("ext v0.16b, v30.16b, ", $ends, ".16b, #12"),
            concat!("add ", $ends, ".4s, ", $ends, ".4s, v0.4s"),
            concat!("ext v0.16b, v30.16b, ", $ends, ".16b, #8"),
            concat!("add ", $ends, ".4s, ", $ends, ".4s, v0.4s"),
        )
    };
}

/// Turns `$ends` into the starts of the matches, and `$offsets` into their sources.
macro_rules! locate {
    ($literal_lens:literal, $match_lens:literal, $ends:literal, $offsets:literal) => {
        lines!(
            concat!("ushr ", $ends, ".4s, ", $ends, ".4s, #16"),
            concat!("sub ", $ends, ".4s, ", $ends, ".4s, ", $match_lens, ".4s"),
            concat!("cmgt v0.4s, ", $literal_lens, ".4s, v29.4s"),
            concat!("cmgt v1.4s, ", $match_lens, ".4s, v14.4s"),
            "orr v0.16b, v0.16b, v1.16b",
            concat!("smin v1.4s, ", $match_lens, ".4s, v29.4s"),
            concat!("cmgt v1.4s, v1.4s, ", $offsets, ".4s"),
            "orr v0.16b, v0.16b, v1.16b",
            concat!("sub ", $offsets, ".4s, ", $ends, ".4s, ", $offsets, ".4s"),
            concat!("add v1.4s, ", $offsets, ".4s, v10.4s"),
            "orr v0.16b, v0.16b, v1.16b",
            "cmgt v22.4s, v11.4s, v1.4s",
            "cmgt v1.4s, v1.4s, v12.4s",
            "and v1.16b, v1.16b, v22.16b",
            "orr v0.16b, v0.16b, v1.16b",
            "and v22.16b, v22.16b, v13.16b",
            concat!("add ", $offsets, ".4s, ", $offsets, ".4s, v22.4s"),
            concat!("bit ", $ends, ".16b, v0.16b, v28.16b"),
        )
    };
}

/// With the group that runs at `x20`, and the reach in `w12`.
macro_rules! enter {
    () => {
        lines!(
            "eor x21, x20, #256",
            "orr x13, x20, #256",
            "ldr q23, [x13, #272]",
            "ldp x26, x27, [x25, #48]",
            "dup v10.4s, w12",
            "ldr q14, [x25, #64]",
            "dup v11.4s, v14.s[2]",
            "dup v13.4s, v14.s[3]",
            "dup v14.4s, v14.s[0]",
            "movi v12.4s, #64",
            "sub v12.4s, v11.4s, v12.4s",
        )
    };
}

/// The second stage in parts, for the group at `x21`.
macro_rules! prepare {
    (0) => {
        lines!(
            "ldp q0, q1, [x21]",
            "ldp q2, q3, [x21, #32]",
            "ldp q4, q5, [x21, #64]",
            "ldp q6, q7, [x21, #96]",
            "uzp2 v16.4s, v0.4s, v1.4s",
            "uzp2 v17.4s, v2.4s, v3.4s",
            // Shifts only look at the lowest byte.
            ".irp sums, v0, v1, v2, v3",
            "ushr \\sums\\().2d, \\sums\\().2d, #8",
            "neg \\sums\\().2d, \\sums\\().2d",
            ".endr",
            "ushl v4.2d, v4.2d, v0.2d",
            "ushl v5.2d, v5.2d, v1.2d",
            "ushl v6.2d, v6.2d, v2.2d",
            "ushl v7.2d, v7.2d, v3.2d",
            "uzp1 v18.4s, v4.4s, v5.4s",
            "uzp1 v19.4s, v6.4s, v7.4s",
            "movi v28.2d, #-1",
            "movi v29.4s, #3",
            "movi v30.4s, #15",
            "movi v31.4s, #31",
        )
    };
    (1) => {
        numbers!("v16", "v18", "v20", "v22", "v2")
    };
    (2) => {
        lines!(
            numbers!("v17", "v19", "v21", "v24", "v3"),
            "ldp q4, q5, [x27]",
            "ldp q6, q7, [x27, #32]",
            "uzp1 v2.8h, v2.8h, v3.8h",
            "umaxv h3, v2.8h",
            "bic v2.8h, #4",
            "ushl v2.8h, v2.8h, v7.8h",
            "addv h2, v2.8h",
        )
    };
    (3) => {
        lines!(
            "fmov w12, s3",
            "fmov w14, s2",
            "and x13, x14, #255",
            "lsr x14, x14, #8",
            "tbnz w12, #2, 28f",
            "25:",
            prepare!(resolve),
            "stp q26, q27, [x21, #224]",
            "movi v30.2d, #0",
            add_up!("v18", "v20", "v16"),
            add_up!("v19", "v21", "v17"),
            "dup v0.4s, v16.s[3]",
            "add v17.4s, v17.4s, v0.4s",
            "stp q16, q17, [x21, #128]",
        )
    };
    (4) => {
        lines!(
            "movi v28.4s, #128, lsl #24",
            "movi v29.4s, #32",
            "dup v2.4s, v17.s[3]",
            locate!("v18", "v20", "v16", "v26"),
            locate!("v19", "v21", "v17", "v27"),
            "usra v10.4s, v2.4s, #16",
            "stp q16, q17, [x21, #160]",
            "stp q26, q27, [x21, #192]",
        )
    };
    (resolve) => {
        lines!(
            resolve!("x13", "v22.16b, v23.16b", "v26", "v25"),
            resolve!("x14", "v24.16b, v25.16b", "v27", "v15"),
        )
    };
    // One less than the offset before counts as new. Each round gets one more right.
    (decrements) => {
        lines!(
            "28:",
            "orr v16.16b, v18.16b, v22.16b",
            "orr v17.16b, v19.16b, v24.16b",
            "cmeq v16.4s, v16.4s, #0",
            "cmeq v17.4s, v17.4s, #0",
            "add v0.4s, v16.4s, v17.4s",
            "addv s0, v0.4s",
            "fmov w12, s0",
            "movi v2.4s, #1",
            "24:",
            prepare!(resolve),
            "ext v27.16b, v26.16b, v27.16b, #12",
            "ext v26.16b, v26.16b, v26.16b, #12",
            "mov v26.s[0], v23.s[0]",
            "uqsub v26.4s, v26.4s, v2.4s",
            "uqsub v27.4s, v27.4s, v2.4s",
            "bit v22.16b, v26.16b, v16.16b",
            "bit v24.16b, v27.16b, v17.16b",
            "adds w12, w12, #1",
            "b.ne 24b",
            "b 25b",
        )
    };
}

/// Finds one sequence and runs another. The rows are at `x3 + 8 * x6` and so on. `x2` lags behind by `$index`.
macro_rules! step {
    ($index:literal) => {
        lines!(
            "ldr x10, [x4, x7, lsl #3]",
            "ldr x11, [x5, x8, lsl #3]",
            "ldr x9, [x3, x6, lsl #3]",
            "add x12, x0, x10",
            "add x12, x12, x11",
            "adds x12, x12, x9",
            concat!("b.lt 3", $index, "f"),
            "lsr x1, x1, x12",
            "bfxil x4, x10, #16, #16",
            "bfxil x5, x11, #16, #16",
            "bfxil x3, x9, #16, #16",
            "lsr w10, w10, #8",
            "lsr w11, w11, #8",
            "lsr w9, w9, #8",
            "lsr x8, x1, x10",
            "lsr x6, x8, x11",
            "lsl w10, w22, w10",
            "lsl w11, w22, w11",
            "lsl w9, w22, w9",
            "bic w7, w1, w10",
            "bic w8, w8, w11",
            "bic w6, w6, w9",
            concat!("str x12, [x20, #8 * ", $index, "]"),
            concat!("str x1, [x20, #64 + 8 * ", $index, "]"),
            "orr x13, x23, x12, lsr #3",
            "and x0, x12, #7",
            "add x2, x2, x13",
            concat!("ldur x1, [x2, #1 + ", $index, "]"),
            concat!(".if ", $index),
            concat!("ldr w12, [x20, #124 + 4 * ", $index, "]"),
            "add x14, x16, w12, uxth",
            "add x15, x17, x12, lsr #16",
            ".else",
            "mov x14, x16",
            "mov x15, x17",
            ".endif",
            concat!("ldr w12, [x20, #160 + 4 * ", $index, "]"),
            concat!("ldrsw x13, [x20, #192 + 4 * ", $index, "]"),
            "ldp q8, q9, [x14]",
            "stp q8, q9, [x15]",
            concat!("tbnz w12, #31, 4", $index, "f"),
            "add x12, x17, x12",
            "add x13, x17, x13",
            "ldp q8, q9, [x13]",
            "stp q8, q9, [x12]",
            concat!("tbz w28, #6, 5", $index, "f"),
            "ldp q8, q9, [x13, #32]",
            "stp q8, q9, [x12, #32]",
            concat!("5", $index, ":"),
        )
    };
}

/// Like `run_special()`, from `x14` to `x15`, with `x13` as far behind `x20` as the index says. The result is in `x9`.
macro_rules! run_special {
    () => {
        lines!(
            "and w12, w12, #0xFFFF",
            "add x12, x17, x12",
            "b 62f",
            "63:",
            "ldp q8, q9, [x14, #32]!",
            "stp q8, q9, [x15]",
            "prfm pstl1keep, [x15, #1024]",
            "62:",
            "add x15, x15, #32",
            "cmp x15, x12",
            "b.lo 63b",
            "ldrh w15, [x13, #130]",
            "ldr w13, [x13, #224]",
            "ldr x9, [x25, #24]",
            "add x15, x17, x15",
            "sub x9, x12, x9",
            "sub x10, x13, #1",
            "cmp x10, x9",
            "b.hs 66f",
            "sub x14, x12, x13",
            "cmp w13, #32",
            "b.lo 64f",
            "63:",
            "ldp q8, q9, [x14]",
            "stp q8, q9, [x12]",
            "ldp q8, q9, [x14, #32]",
            "stp q8, q9, [x12, #32]",
            "prfm pstl1keep, [x12, #1024]",
            "add x14, x14, #64",
            "add x12, x12, #64",
            "cmp x12, x15",
            "b.lo 63b",
            "mov w9, #1",
            "ret",
            "66:",
            "ldp x10, x14, [x25, #32]",
            "sub x13, x13, x9",
            "sub x11, x15, x12",
            "add x11, x11, #64",
            "sub x14, x14, x13",
            "cmp x10, x13",
            "ccmp x13, x11, #0, hs",
            "b.hs 63b",
            "mov w9, #0",
            "ret",
            "64:",
            "ldp q8, q9, [x14]",
            "tbnz w13, #4, 67f",
            "add x10, x27, x13, lsl #5",
            "add x11, x27, x13",
            "ldr q9, [x10, #64]",
            "ldrb w13, [x11, #64 + 512]",
            "tbl v8.16b, {{v8.16b}}, v9.16b",
            "ldr q9, [x10, #64 + 16]",
            "tbl v9.16b, {{v8.16b}}, v9.16b",
            "67:",
            "stp q8, q9, [x12]",
            "prfm pstl1keep, [x12, #1024]",
            "add x12, x12, x13",
            "cmp x12, x15",
            "b.lo 67b",
            "mov w9, #1",
            "ret",
        )
    };
}

macro_rules! asm_for_prepare {
    ($($arguments:tt)*) => {
        asm!(
            $($arguments)*
            out("x13") _, out("x14") _, out("x21") _, out("x26") _, out("x27") _,
            out("v0") _, out("v1") _, out("v2") _, out("v3") _,
            out("v4") _, out("v5") _, out("v6") _, out("v7") _,
            out("v10") _, out("v11") _, out("v12") _, out("v13") _, out("v14") _, out("v15") _,
            out("v16") _, out("v17") _, out("v18") _, out("v19") _,
            out("v20") _, out("v21") _, out("v22") _, out("v23") _,
            out("v24") _, out("v25") _, out("v26") _, out("v27") _,
            out("v28") _, out("v29") _, out("v30") _, out("v31") _,
            options(nostack),
        )
    };
}

#[inline(always)]
fn running(sequences: &mut Sequences<'_>) -> *mut Group {
    let index = sequences.running % 2;
    core::ptr::from_mut(sequences)
        .cast::<Group>()
        .wrapping_add(index)
}

#[inline(always)]
fn prepare(sequences: &mut Sequences<'_>, frame: &Frame) {
    // SAFETY: it only touches a group, the offsets behind the groups, the constants and two of the orders.
    unsafe {
        asm_for_prepare!(
            enter!(),
            prepare!(0), prepare!(1), prepare!(2), prepare!(3), prepare!(4),
            "orr x13, x20, #256",
            "str q15, [x13, #272]",
            "b 29f",
            prepare!(decrements),
            "29:",
            inout("x12") frame.reach.len_from(sequences.waiting_position()) => _,
            in("x20") running(sequences),
            in("x25") frame,
        );
    }
}

/// SAFETY: as `Sequences::run_with()` calls it, with tables that are settled.
#[inline(always)]
unsafe fn overlap(
    sequences: &mut Sequences<'_>,
    buffers: &Buffers<'_>,
    frame: &Frame,
    finder: &mut Finder,
) {
    let mut literals = buffers.literals.wrapping_add(sequences.literal_position);
    let mut out = buffers.out.wrapping_add(sequences.position);
    let (mut group, mut surplus) = (running(sequences), sequences.reader.left - GROUP);
    let found_and_ran: i32;
    // SAFETY: it does what `Sequences::overlap()` does.
    unsafe {
        asm_for_prepare!(
            enter!(),
            "ldr x28, [x25, #64]",
            "20:",
            "ldr w12, [x20, #156]",
            "ldp x9, x10, [x25]",
            "ldr x11, [x25, #16]",
            "add x14, x16, w12, uxth",
            "add x15, x17, x12, lsr #16",
            "cmp x9, x14",
            "ccmp x10, x15, #0, hs",
            "ccmp x2, x11, #0, hs",
            "b.lo 27f",
            ".irp line, 0, 1, 2, 3",
            "prfm pstl1keep, [x15, #1024 - 64 * \\line]",
            ".endr",
            step!(0), prepare!(0),
            step!(1), prepare!(1),
            step!(2), prepare!(2),
            step!(3), prepare!(3),
            step!(4), prepare!(4),
            step!(5),
            "tbz x28, #32, 21f",
            "ldrh w15, [x20, #158]",
            "add x15, x17, x15",
            ".irp pair, 0, 1, 2, 3",
            "ldpsw x12, x13, [x21, #192 + 8 * \\pair]",
            "prfm pldl1keep, [x15, x12]",
            "prfm pldl1keep, [x15, x13]",
            ".endr",
            "21:",
            step!(6),
            step!(7),
            "ldr w12, [x20, #156]",
            "mov v23.16b, v15.16b",
            "add x2, x2, #8",
            "add x16, x16, w12, uxth",
            "add x17, x17, x12, lsr #16",
            "eor x20, x20, #256",
            "eor x21, x21, #256",
            "subs x24, x24, #8",
            "b.hs 20b",
            "27:",
            "mov w12, #0",
            "b 29f",
            ".irp index, 0, 1, 2, 3, 4, 5, 6, 7",
            "3\\index:",
            "mov w12, #0x101 * \\index",
            "b 29f",
            "4\\index:",
            "add x13, x20, #4 * \\index",
            "bl 60f",
            "cbnz w9, 5\\index\\()b",
            "mov w12, #0x101 * \\index + 1",
            "b 29f",
            ".endr",
            "60:",
            run_special!(),
            prepare!(decrements),
            "29:",
            "add x3, x3, x6, lsl #3",
            "add x4, x4, x7, lsl #3",
            "add x5, x5, x8, lsl #3",
            "orr x13, x20, #256",
            "str q23, [x13, #272]",
            inout("x0") finder.spare,
            inout("x1") finder.word,
            inout("x2") finder.loaded,
            inout("x3") finder.rows[0],
            inout("x4") finder.rows[1],
            inout("x5") finder.rows[2],
            inout("x6") 0usize => _,
            inout("x7") 0usize => _,
            inout("x8") 0usize => _,
            out("x9") _, out("x10") _, out("x11") _,
            inout("x12") frame.reach.len_from(sequences.waiting_position()) => found_and_ran,
            out("x15") _,
            inout("x16") literals,
            inout("x17") out,
            inout("x20") group,
            in("x22") -1isize,
            in("x23") -8isize,
            inout("x24") surplus,
            in("x25") frame,
            out("x28") _, out("x30") _, out("v8") _, out("v9") _,
        );
    }
    let left = surplus.wrapping_add(GROUP);
    let at = [group.addr(), literals.addr(), out.addr()];
    sequences.catch_up(buffers, finder, found_and_ran as usize, left, at);
}

pub(super) fn run(sequences: &mut Sequences<'_>, buffers: &Buffers<'_>) {
    let frame = &Frame {
        literals_end: buffers.literals.wrapping_add(buffers.literals_end),
        out_end: buffers.out.wrapping_add(buffers.out_ends[2]),
        loaded_min: sequences.reader.src.as_ptr().wrapping_add(GROUP_BYTES_MAX),
        out: buffers.out,
        detached_len: buffers.detached.len(),
        detached_end: buffers.detached.as_ptr_range().end,
        orders: ORDERS.as_ptr(),
        constants: &raw const CONSTANTS,
        span: sequences.span() as u32,
        is_far: sequences.is_far().into(),
        reach: Reach::new(buffers),
    };
    sequences.run_with(
        buffers,
        |sequences, _, _| sequences.found,
        |sequences| prepare(sequences, frame),
        // SAFETY: `Sequences::run()` has looked at the tables.
        |sequences, finder| unsafe { overlap(sequences, buffers, frame, finder) },
    );
}
