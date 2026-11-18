//! The instructions that operations come down to.

#![allow(clippy::disallowed_methods)]

mod support;

use bun_engine_asm::arm64::*;
use bun_engine_asm::{
    Absolute, Address, Arm64Features, AtomicOp, CallAssembly, Cond, FloatAssembly, FloatCond,
    FloatWidth, Gpr, MacroAssembly, NegativeZero, Options, RegisterSet, ResultCond, Scale, Shift,
    Sign, Size, Src, TestCond, Untrusted, ValueAssembly, Width, X64Features, x64,
};

const INTEL: [&str; 2] = ["-triple=x86_64", "--output-asm-variant=1"];

fn assembler<M: MacroAssembly>(features: M::Features) -> M {
    M::new(Options {
        features,
        shorten_jumps: false,
        seed: 0,
    })
}

/// `$target` is the first instruction of the operation.
macro_rules! sequences {
    ($features:expr, $target:ident; $($method:ident $arguments:tt => $expected:literal,)*) => {{
        let mut masm: MacroAssembler = assembler($features);
        let mut lines: Vec<String> = Vec::new();
        $({
            let (start, $target) = (masm.size(), masm.here());
            let _ = $target;
            masm.$method $arguments;
            let expected = $expected.split("; ").filter(|line| !line.is_empty());
            let count = expected.clone().count();
            assert_eq!(masm.size() - start, 4 * count, "{}", $expected);
            lines.extend(expected.map(String::from));
        })*
        let code = masm.finish().unwrap();
        support::assert_arm64_assembly(&code.bytes()[..4 * lines.len()], &lines);
    }};
}

#[test]
fn constants() {
    sequences! { Arm64Features::empty(), t;
        move64(X1, 0) => "movz w1, #0",
        move64(X1, -1) => "movn x1, #0",
        move32(X1, -1) => "movn w1, #0",
        move64(X1, 0xffff_1234u32) => "movn w1, #0xedcb",
        move64(X1, Untrusted(0x1234_5678)) => "movz w1, #0x5678; movk w1, #0x1234, lsl #16",
        move64(X1, 0x5555_5555u32) => "orr w1, wzr, #0x55555555",
        move64(X1, 0xfffe_0000_0000_0000u64) => "movz x1, #0xfffe, lsl #48",
        move64(X1, 0xfffe_0000_ffff_ffffu64) => "orr x1, xzr, #0xfffe0000ffffffff",
        move64(X1, 0xfffe_0000_ffff_fc18u64) => "movn w1, #0x3e7; movk x1, #0xfffe, lsl #48",
        move64(X1, 0.1f64.to_bits())
            => "orr x1, xzr, #0x9999999999999999; movk x1, #0x999a; movk x1, #0x3fb9, lsl #48",
        move_f64_constant(V1, 0.0) => "movi v1.2d, #0",
        move_f64_constant(V1, -1.5) => "fmov d1, #-1.5",
        move_f64_constant(V1, 1000.0)
            => "movz x17, #0x4000, lsl #32; movk x17, #0x408f, lsl #48; fmov d1, x17",
        move_float_constant(FloatWidth::F32, V1, 0x8000_0000)
            => "movz w17, #0x8000, lsl #16; fmov s1, w17",
        load_tags() => "movz x22, #0xfffe, lsl #48; add x23, x22, #2",
        move_f64_constant(V1, 1.2345) => "ldr d1, #4",
    }
}

#[test]
fn arithmetic() {
    sequences! { Arm64Features::empty(), t;
        move64(X1, X1) => "",
        move32(X1, X1) => "mov w1, w1",
        move64(SP, FP) => "mov sp, x29",
        add64(X1, X1, 0) => "",
        add64(X1, X2, -16) => "sub x1, x2, #16",
        add32(X1, X2, u32::MAX) => "sub w1, w2, #1",
        sub64(X1, X2, -0x5000) => "add x1, x2, #5, lsl #12",
        add64(X1, X1, 0x12_3456) => "add x1, x1, #0x123, lsl #12; add x1, x1, #0x456",
        add64(SP, SP, 0x1010) => "add sp, sp, #1, lsl #12; add sp, sp, #0x10",
        sub64(SP, FP, 0x1010) => "movn x17, #0x100f; add sp, x29, x17",
        sub64(SP, FP, 0x1_1010) => "sub x17, x29, #0x11, lsl #12; sub sp, x17, #0x10",
        sub32(X1, X2, 0xd800) => "movn w1, #0xd7ff; add w1, w2, w1",
        add64(X1, X2, 1i64 << 32) => "movz x1, #1, lsl #32; add x1, x2, x1",
        add64(X1, X1, 1i64 << 32) => "movz x17, #1, lsl #32; add x1, x1, x17",
        add_constant(Width::W64, X17, X17, 0x1010) => "add x17, x17, #1, lsl #12; add x17, x17, #0x10",
        add64(X1, X2, SP) => "add x1, sp, x2",
        sub64(SP, FP, X2) => "sub sp, x29, x2",
        add64(X1, X2, Address::new(X3, 8)) => "ldr x16, [x3, #8]; add x1, x2, x16",
        mul32(X1, X2, 8) => "lsl w1, w2, #3",
        mul32(X1, X2, 9) => "add w1, w2, w2, lsl #3",
        mul32(X1, X2, -7) => "sub w1, w2, w2, lsl #3",
        mul32(X1, X2, -8) => "neg w1, w2, lsl #3",
        mul32(X1, X2, 10) => "movz w16, #10; mul w1, w2, w16",
        and64(X1, X2, -16) => "and x1, x2, #0xfffffffffffffff0",
        and64(X1, X2, u32::MAX) => "mov w1, w2",
        and64(X1, X2, 0xf000_000fu32) => "and w1, w2, #0xf000000f",
        and64(SP, X2, -16) => "and sp, x2, #0xfffffffffffffff0",
        and64(SP, SP, -16) => "mov x16, sp; and sp, x16, #0xfffffffffffffff0",
        xor32(X1, X2, -1) => "mvn w1, w2",
        or64(X1, X1, 0) => "",
        rotl32(X1, X2, 5) => "ror w1, w2, #27",
        rotl64(X1, X2, X3) => "neg w16, w3; ror x1, x2, x16",
        rem(Sign::Signed, Width::W32, X1, X2, X3) => "sdiv w16, w2, w3; msub w1, w16, w3, w2",
        mul_wide64(Sign::Unsigned, X1, X2, X1, X3) => "umulh x2, x1, x3; mul x1, x1, x3",
        add_shifted(Width::W64, X1, X2, X3, Shift::RightLogical, 7) => "add x1, x2, x3, lsr #7",
        count_ones32(X1, X2) => "fmov s31, w2; cnt v31.8b, v31.8b; addv b31, v31.8b; fmov w1, s31",
        swap_bytes(Size::S16, X1, X2) => "rev w1, w2; lsr w1, w1, #16",
        branch_add32(ResultCond::Overflow, X1, X2, -1, t) => "subs w1, w2, #1; b.vs #-4",
        branch_sub32(ResultCond::Carry, X1, X2, X3, t) => "subs w1, w2, w3; b.lo #-4",
        branch_mul32_overflow(X1, X2, X3, t)
            => "smull x1, w2, w3; cmp x1, w1, sxtw; mov w1, w1; b.ne #-12",
        branch_mul64_overflow(X1, X2, X3, t)
            => "smulh x17, x2, x3; mul x1, x2, x3; cmp x17, x1, asr #63; b.ne #-12",
    }
}

#[test]
fn addresses() {
    let at = |offset| Address::new(X2, offset);
    let indexed = |scale, offset| Address::indexed(X2, X3, scale, offset);
    sequences! { Arm64Features::empty(), t;
        load64(X1, at(32_760)) => "ldr x1, [x2, #32760]",
        load64(X1, at(-256)) => "ldur x1, [x2, #-256]",
        load64(X1, at(4)) => "ldur x1, [x2, #4]",
        load64(X1, at(32_768)) => "movz w1, #0x8000; ldr x1, [x2, x1]",
        load64(X2, at(-264)) => "movn x17, #263; ldr x2, [x2, x17]",
        load64(X1, at(0x1_2348)) => "add x1, x2, #0x12, lsl #12; ldr x1, [x1, #0x348]",
        store64(at(-0x1_2348), X1) => "sub x17, x2, #0x13, lsl #12; str x1, [x17, #0xcb8]",
        store64(at(0x1234_5678), X1)
            => "movz w17, #0x5678; movk w17, #0x1234, lsl #16; str x1, [x2, x17]",
        load64(X1, indexed(Scale::Eight, 0)) => "ldr x1, [x2, x3, lsl #3]",
        load64(X1, indexed(Scale::One, 0)) => "ldr x1, [x2, x3]",
        load32(X1, indexed(Scale::Four, -8)) => "sub x1, x2, #8; ldr w1, [x1, x3, lsl #2]",
        load32(X1, indexed(Scale::Eight, 4)) => "add x1, x2, x3, lsl #3; ldr w1, [x1, #4]",
        load64(X1, indexed(Scale::Eight, 4104)) => "add x1, x2, x3, lsl #3; ldr x1, [x1, #4104]",
        load8(X1, Address::indexed(SP, X3, Scale::Two, 0)) => "add x1, sp, x3, lsl #1; ldrb w1, [x1]",
        load64(X1, Absolute(0x7f12_3456_1238))
            => "movz x1, #0x3456, lsl #16; movk x1, #0x7f12, lsl #32; ldr x1, [x1, #0x1238]",
        store64(at(8), 0) => "str xzr, [x2, #8]",
        store8(at(8), 0x100) => "strb wzr, [x2, #8]",
        store32(at(8), 7) => "movz w16, #7; str w16, [x2, #8]",
        load_pair64(X1, X2, at(-512)) => "ldp x1, x2, [x2, #-512]",
        store_pair64(at(512), X1, X4) => "add x17, x2, #512; stp x1, x4, [x17]",
        store_pair32(indexed(Scale::Two, 8), X1, X4)
            => "add x17, x2, x3, lsl #1; stp w1, w4, [x17, #8]",
        load_vector(V1, at(65_520)) => "ldr q1, [x2, #65520]",
        compute_address(X1, indexed(Scale::Four, 0)) => "add x1, x2, x3, lsl #2",
        compute_address(X1, indexed(Scale::Four, 8)) => "add x1, x2, #8; add x1, x1, x3, lsl #2",
        add32_to_memory(at(8), -1) => "ldr w16, [x2, #8]; sub w16, w16, #1; str w16, [x2, #8]",
        and_to_memory(Size::S8, at(1), 0x81)
            => "ldrb w16, [x2, #1]; and w16, w16, #0x81818181; strb w16, [x2, #1]",
        transfer64(at(8), at(16)) => "ldr x16, [x2, #16]; str x16, [x2, #8]",
        prefetch(at(-8)) => "prfum pldl1keep, [x2, #-8]",
        store_registers(RegisterSet::of(&[X19, X20, X24], &[V9, V10, V11]), 8, Address::new(SP, 0))
            => "stp x19, x20, [sp]; str x24, [sp, #16]; stp d9, d10, [sp, #24]; str d11, [sp, #40]",
        enter_frame() => "stp x29, x30, [sp, #-16]!; mov x29, sp",
        leave_frame() => "mov sp, x29; ldp x29, x30, [sp], #16",
    }
}

#[test]
fn comparisons() {
    let byte = Address::new(X2, 5);
    sequences! { Arm64Features::empty(), t;
        branch32(Cond::Eq, X1, 0, t) => "cbz w1, #0",
        branch64(Cond::Above, X1, 0, t) => "cbnz x1, #0",
        branch32(Cond::Lt, X1, 0, t) => "tbnz w1, #31, #0",
        branch64(Cond::Ge, X1, 0, t) => "tbz x1, #63, #0",
        branch32(Cond::Gt, X1, 0, t) => "cmp w1, #0; b.gt #-4",
        branch64(Cond::Eq, SP, 0, t) => "cmp sp, #0; b.eq #-4",
        branch64(Cond::Below, SP, X1, t) => "cmp sp, x1; b.lo #-4",
        branch32(Cond::Eq, X1, -5, t) => "cmn w1, #5; b.eq #-4",
        branch32(Cond::Above, X1, 0xffff, t) => "cmp w1, #16, lsl #12; b.hs #-4",
        branch32(Cond::Lt, X1, 4097, t) => "cmp w1, #1, lsl #12; b.le #-4",
        branch32(Cond::Eq, X1, 0xffff, t) => "movz w16, #0xffff; cmp w1, w16; b.eq #-8",
        branch32(Cond::Eq, X1, 0x1_f600, t)
            => "sub w16, w1, #0x1f, lsl #12; cmp w16, #0x600; b.eq #-8",
        branch64(Cond::Ne, X1, -0x1_2345, t)
            => "add x16, x1, #0x13, lsl #12; cmp x16, #0xcbb; b.ne #-8",
        branch32(Cond::Ne, Address::new(X2, 0), 0xffff, t)
            => "ldr w16, [x2]; movz w17, #0xffff; cmp w16, w17; b.ne #-12",
        branch8(Cond::Eq, byte, 0, t) => "ldrb w16, [x2, #5]; cbz w16, #-4",
        branch8(Cond::Below, byte, 200, t) => "ldrb w16, [x2, #5]; cmp w16, #200; b.lo #-8",
        branch8(Cond::Lt, byte, 200, t) => "ldrsb w16, [x2, #5]; cmn w16, #56; b.lt #-8",
        branch16(Cond::Eq, byte, 0xffff, t) => "ldursh w16, [x2, #5]; cmn w16, #1; b.eq #-8",
        branch_test64(TestCond::Zero, X1, X1, t) => "cbz x1, #0",
        branch_test64(TestCond::NonZero, X1, u32::MAX, t) => "cbnz w1, #0",
        branch_test64(TestCond::Zero, X1, 1i64 << 40, t) => "tbz x1, #40, #0",
        branch_test32(TestCond::Negative, X1, -1, t) => "tbnz w1, #31, #0",
        branch_test64(TestCond::Zero, X1, -2, t) => "tst x1, #0xfffffffffffffffe; b.eq #-4",
        branch_test64(TestCond::Zero, X1, 0xf000_000fu32, t) => "tst w1, #0xf000000f; b.eq #-4",
        branch_test8(TestCond::NonZero, byte, 4, t) => "ldrb w16, [x2, #5]; tbnz w16, #2, #-4",
        branch_test8(TestCond::Zero, byte, -1, t) => "ldrb w16, [x2, #5]; cbz w16, #-4",
        branch_test8(TestCond::Zero, byte, 0xaa, t)
            => "ldrb w16, [x2, #5]; tst w16, #0xaaaaaaaa; b.eq #-8",
        branch_test_bit32(TestCond::Zero, X1, X2, t) => "lsr w16, w1, w2; tbz w16, #0, #-4",
        test32(TestCond::NonZero, X1, X2, 8) => "ubfx w1, w2, #3, #1",
        test64(TestCond::Negative, X1, X2, -1) => "lsr x1, x2, #63",
        compare32(Cond::Eq, X1, X2, 0) => "cmp w2, #0; cset w1, eq",
        select32(Cond::Lt, X1, X2, X3, X4, X5) => "cmp w2, w3; csel x1, x4, x5, lt",
        branch_if_not_int32(X1, t) => "cmp x1, x22; b.lo #-4",
        branch_if_not_cell(X1, t) => "tst x1, x23; b.ne #-4",
        branch_if_not_boolean(X1, X2, t)
            => "eor x2, x1, #6; tst x2, #0xfffffffffffffffe; b.ne #-8",
    }
}

#[test]
fn floats() {
    let (accept, reject) = (NegativeZero::Accept, NegativeZero::Reject);
    let double = FloatWidth::F64;
    sequences! { Arm64Features::empty(), t;
        branch_f64(FloatCond::Ne, V1, V2, t) => "fcmp d1, d2; b.mi #-4; b.gt #-8",
        branch_f64_with_zero(FloatCond::Lt, V1, t) => "fcmp d1, #0.0; b.mi #-4",
        copysign_float(FloatWidth::F32, V1, V2, V3)
            => "movi v1.2s, #0x80, lsl #24; bsl v1.16b, v3.16b, v2.16b",
        select_float_test(Width::W32, TestCond::Zero, V1, X1, -1, V2, V3)
            => "tst w1, w1; fcsel d1, d2, d3, eq",
        convert_f64_to_f16_bits(X1, V1) => "fcvt h31, d1; fmov w1, s31",
        convert_f16_bits_to_f64(V1, X1) => "fmov s1, w1; fcvt d1, h1",
        truncate_f64_to_int32_modular(X1, V1, t)
            => "fcvtzs x1, d1; cmn x1, #1; ccmp x1, #1, #1, vc; b.vs #-12; mov w1, w1",
        truncate_float_or_branch(double, Sign::Unsigned, Width::W32, X1, V1, t)
            => "fcvtzs x1, d1; cmp x1, w1, uxtw; fccmp d1, d1, #0, eq; b.ne #-12",
        convert_f64_to_i32_exact(X1, V1, accept, t)
            => "fcvtzs w1, d1; scvtf d31, w1; fcmp d1, d31; b.ne #-12",
        convert_f64_to_i32_exact(X1, V1, reject, t)
            => "fcvtzs w1, d1; scvtf d31, w1; eor v31.16b, v31.16b, v1.16b; fmov x16, d31; cbnz x16, #-16",
    }
    sequences! { Arm64Features::all(), t;
        truncate_f64_to_int32_modular(X1, V1, t) => "fjcvtzs w1, d1",
        convert_f64_to_i32_exact(X1, V1, reject, t) => "fjcvtzs w1, d1; b.ne #-4",
        convert_f64_to_int_exact(Width::W64, X1, V1, accept, t)
            => "fcvtzs x1, d1; frint64z d31, d1; fcmp d1, d31; b.ne #-12",
    }
}

#[test]
fn half_precision_is_supported_where_there_are_instructions() {
    assert!(assembler::<MacroAssembler>(Arm64Features::empty()).supports_f16());
    let on_x64 = |features| assembler::<x64::MacroAssembler>(features).supports_f16();
    assert!(on_x64(X64Features::AVX | X64Features::F16C));
    assert!(!on_x64(X64Features::all() - X64Features::F16C));
}

#[test]
fn atomics() {
    let (at, near) = (Address::new(X2, 0), Address::new(X2, 8));
    sequences! { Arm64Features::empty(), t;
        atomic_load(Size::S32, X1, at) => "ldar w1, [x2]",
        atomic_store(Size::S8, near, X1) => "add x17, x2, #8; stlrb w1, [x17]",
        atomic_update(AtomicOp::Add, Size::S64, X1, at, X3, X4)
            => "ldaxr x1, [x2]; add x4, x1, x3; stlxr w16, x4, [x2]; cbnz w16, #-12",
        atomic_update(AtomicOp::Exchange, Size::S16, X1, at, X3, X4)
            => "ldaxrh w1, [x2]; stlxrh w4, w3, [x2]; cbnz w4, #-8",
        atomic_compare_exchange(Size::S8, X1, at, X3, X5, X4)
            => "ldaxrb w1, [x2]; cmp w1, w3, uxtb; b.ne #12; stlxrb w16, w5, [x2]; cbnz w16, #-16",
        memory_fence() => "dmb ish",
        store_fence() => "dmb ishst",
        load_fence() => "dmb ishld",
    }
    sequences! { Arm64Features::LSE, t;
        atomic_update(AtomicOp::Add, Size::S64, X1, at, X3, X4) => "ldaddal x3, x1, [x2]",
        atomic_update(AtomicOp::And, Size::S8, X1, at, X3, X4) => "mvn w4, w3; ldclralb w4, w1, [x2]",
        atomic_compare_exchange(Size::S32, X1, at, X1, X5, X4) => "casal w1, w5, [x2]",
    }
}

/// `name` is what the stack pointer is called in a listing.
fn stack_pointer_is_written_once<M: MacroAssembly>(
    features: M::Features,
    arguments: &[&str],
    name: &str,
) {
    let (sp, a, b) = (M::STACK_POINTER, M::FRAME_POINTER, Gpr::new(3));
    let mut masm: M = assembler(features);
    let mut check = |emit: &dyn Fn(&mut M)| {
        emit(&mut masm);
        masm.ret();
    };
    let constants = [
        0,
        16,
        -16,
        0x1_1010,
        0x1010,
        -0x1010,
        0x1234_5670,
        i32::MIN.into(),
        0x55 << 40,
    ];
    for constant in constants {
        check(&|masm| masm.and64(sp, a, constant | 1 << 62));
        check(&|masm| masm.and64(sp, a, -16));
        let offset = constant as i32;
        check(&|masm| masm.compute_address(sp, Address::new(a, offset)));
        check(&|masm| masm.compute_address(sp, Address::indexed(a, b, Scale::Eight, offset)));
    }
    let others = [
        b.into(),
        a.into(),
        sp.into(),
        Address::new(b, 8).into(),
        Absolute(1 << 40).into(),
    ];
    for rhs in constants.map(Src::Imm).into_iter().chain(others) {
        check(&|masm| masm.add64(sp, a, rhs));
        check(&|masm| masm.sub64(sp, a, rhs));
    }
    let lines = support::disassemble(arguments, masm.finish().unwrap().bytes());
    for lines in lines
        .unwrap_or_default()
        .split_inclusive(|line| line == "ret")
    {
        let operands = lines
            .iter()
            .filter_map(|line| line.split([' ', ',']).nth(1));
        assert_eq!(
            operands.filter(|&first| first == name).count(),
            1,
            "{lines:?}"
        );
    }
}

#[test]
fn the_stack_pointer_gets_no_value_in_between() {
    stack_pointer_is_written_once::<x64::MacroAssembler>(X64Features::empty(), &INTEL, "rsp");
    stack_pointer_is_written_once::<MacroAssembler>(Arm64Features::empty(), &support::ARM64, "sp");
}

#[test]
fn x64_hints_and_fences() {
    let mut masm: x64::MacroAssembler = assembler(X64Features::empty());
    masm.prefetch(Address::new(x64::RBX, 64));
    masm.store_fence();
    masm.load_fence();
    masm.memory_fence();
    masm.atomic_store(Size::S32, Address::new(x64::RBX, 0), x64::RCX);
    let expected = [
        "prefetcht0 byte ptr [rbx + 64]",
        "lock",
        "or dword ptr [rsp], 0",
        "mov r11d, ecx",
        "xchg dword ptr [rbx], r11d",
    ];
    let code = masm.finish().unwrap();
    support::assert_disassembly(&INTEL, code.bytes(), &expected.map(String::from));
}

#[test]
fn x64_keeps_some_untrusted_constants_out_of_the_code() {
    const SEEDS: u64 = 640;
    let (a, b, m) = (x64::RBX, x64::RCX, Address::new(x64::RSI, 8));
    let check = |width: Width, value: i64, may_be_kept_out: bool| {
        let (size, src) = (width.size(), Untrusted(value));
        let operations: [&dyn Fn(&mut x64::MacroAssembler); 12] = [
            &|masm| masm.move_int(width, a, src),
            &|masm| masm.store(size, m, src),
            &|masm| masm.add_to_memory(size, m, src),
            &|masm| masm.add(width, a, b, src),
            &|masm| masm.sub(width, a, a, src),
            &|masm| masm.mul(width, a, b, src),
            &|masm| masm.and(width, a, b, src),
            &|masm| masm.xor(width, a, b, src),
            &|masm| masm.compare(width, Cond::Lt, a, b, src),
            &|masm| masm.compare(width, Cond::Lt, a, m, src),
            &|masm| masm.test(width, TestCond::Zero, a, b, src),
            &|masm| masm.test(width, TestCond::Zero, a, m, src),
        ];
        for (index, emit) in operations.into_iter().enumerate() {
            let is_kept_out = |&seed: &u64| {
                let mut masm = x64::MacroAssembler::new(Options {
                    features: X64Features::empty(),
                    shorten_jumps: false,
                    seed,
                });
                emit(&mut masm);
                let code = masm.finish().unwrap();
                let low_bytes = &value.to_le_bytes()[..3];
                !code.bytes().windows(3).any(|bytes| bytes == low_bytes)
            };
            let count = (0..SEEDS).filter(is_kept_out).count();
            let expected = if may_be_kept_out { 3..30 } else { 0..1 };
            assert!(
                expected.contains(&count),
                "{index} {width:?} {value:x} {count}"
            );
        }
    };
    for width in [Width::W32, Width::W64] {
        check(width, 0x1234_5678, true);
        check(width, -0x1234_5678, true);
        check(width, 0x12_3456, false);
    }
    check(Width::W64, 0x1234_5678_9abc_def1, true);
}
