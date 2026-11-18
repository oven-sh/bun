//! The methods that only fix some arguments of another.

use bun_engine_asm::{
    Address, Arm64Features, Cond, FloatAssembly, FloatCond, FloatWidth, Fpr, Gpr, NegativeZero,
    Options, ResultCond, Shift, Sign, Size, TestCond, Width, X64Features, arm64, x64,
};

macro_rules! same {
    ($features:ident, $target:ident; $($alias:ident $given:tt = $general:ident $all:tt;)*) => {
        $({
            let bytes = |emit: &dyn Fn(&mut M, bun_engine_asm::Label)| {
                let mut masm = M::new(Options { features: $features, shorten_jumps: false, seed: 0 });
                let target = masm.here();
                emit(&mut masm, target);
                masm.finish().unwrap().bytes().to_vec()
            };
            assert_eq!(
                bytes(&|masm, $target| { let _ = $target; masm.$alias $given }),
                bytes(&|masm, $target| { let _ = $target; masm.$general $all }),
                stringify!($alias)
            );
        })*
    };
}

fn check<M: FloatAssembly>(features: M::Features) {
    use FloatWidth::{F32, F64};
    use Shift::{Left, RightArithmetic, RightLogical, RotateLeft, RotateRight};
    use Sign::{Signed, Unsigned};
    use Size::{S8, S16, S32, S64};
    use Width::{W32, W64};
    let [a, b, c, d, e] = [3, 6, 7, 8, 9].map(Gpr::new);
    let [f, g, h] = [1, 2, 3].map(Fpr::new);
    let (m, n) = (Address::new(e, 8), Address::new(d, 16));
    let (lt, zero, carry, ne) = (Cond::Lt, TestCond::Zero, ResultCond::Carry, FloatCond::Ne);
    let (overflow, reject) = (ResultCond::Overflow, NegativeZero::Reject);
    same! { features, t;
        move32(a, b) = move_int(W32, a, b);
        move64(a, b) = move_int(W64, a, b);
        load_pair32(a, b, m) = load_pair(W32, a, b, m);
        load_pair64(a, b, m) = load_pair(W64, a, b, m);
        store_pair32(m, a, b) = store_pair(W32, m, a, b);
        store_pair64(m, a, b) = store_pair(W64, m, a, b);
        add32(a, b, c) = add(W32, a, b, c);
        add64(a, b, c) = add(W64, a, b, c);
        sub32(a, b, c) = sub(W32, a, b, c);
        sub64(a, b, c) = sub(W64, a, b, c);
        mul32(a, b, c) = mul(W32, a, b, c);
        mul64(a, b, c) = mul(W64, a, b, c);
        and32(a, b, c) = and(W32, a, b, c);
        and64(a, b, c) = and(W64, a, b, c);
        or32(a, b, c) = or(W32, a, b, c);
        or64(a, b, c) = or(W64, a, b, c);
        xor32(a, b, c) = xor(W32, a, b, c);
        xor64(a, b, c) = xor(W64, a, b, c);
        neg32(a, b) = neg(W32, a, b);
        neg64(a, b) = neg(W64, a, b);
        not32(a, b) = not(W32, a, b);
        not64(a, b) = not(W64, a, b);
        count_leading_zeros32(a, b) = count_leading_zeros(W32, a, b);
        count_leading_zeros64(a, b) = count_leading_zeros(W64, a, b);
        count_trailing_zeros32(a, b) = count_trailing_zeros(W32, a, b);
        count_trailing_zeros64(a, b) = count_trailing_zeros(W64, a, b);
        count_ones32(a, b) = count_ones(W32, a, b);
        count_ones64(a, b) = count_ones(W64, a, b);
        branch32(lt, a, b, t) = branch(W32, lt, a, b, t);
        branch64(lt, a, b, t) = branch(W64, lt, a, b, t);
        branch_test32(zero, a, b, t) = branch_test(W32, zero, a, b, t);
        branch_test64(zero, a, b, t) = branch_test(W64, zero, a, b, t);
        branch_test_bit32(zero, a, b, t) = branch_test_bit(W32, zero, a, b, t);
        branch_test_bit64(zero, a, b, t) = branch_test_bit(W64, zero, a, b, t);
        branch_add32(carry, a, b, c, t) = branch_add(W32, carry, a, b, c, t);
        branch_add64(carry, a, b, c, t) = branch_add(W64, carry, a, b, c, t);
        branch_sub32(carry, a, b, c, t) = branch_sub(W32, carry, a, b, c, t);
        branch_sub64(carry, a, b, c, t) = branch_sub(W64, carry, a, b, c, t);
        branch_mul32_overflow(a, b, c, t) = branch_mul_overflow(W32, a, b, c, t);
        branch_mul64_overflow(a, b, c, t) = branch_mul_overflow(W64, a, b, c, t);
        branch_neg32(overflow, a, b, t) = branch_neg(W32, overflow, a, b, t);
        branch_neg64(overflow, a, b, t) = branch_neg(W64, overflow, a, b, t);
        branch_add32_to_memory(carry, m, 1, t) = branch_add_to_memory(W32, carry, m, 1, t);
        branch_add64_to_memory(carry, m, 1, t) = branch_add_to_memory(W64, carry, m, 1, t);
        compare32(lt, a, b, c) = compare(W32, lt, a, b, c);
        compare64(lt, a, b, c) = compare(W64, lt, a, b, c);
        test32(zero, a, b, c) = test(W32, zero, a, b, c);
        test64(zero, a, b, c) = test(W64, zero, a, b, c);
        select32(lt, a, b, c, d, e) = select(W32, lt, a, b, c, d, e);
        select64(lt, a, b, c, d, e) = select(W64, lt, a, b, c, d, e);
        select_test32(zero, a, b, c, d, e) = select_test(W32, zero, a, b, c, d, e);
        select_test64(zero, a, b, c, d, e) = select_test(W64, zero, a, b, c, d, e);
        shl32(a, b, 3) = shift(Left, W32, a, b, 3);
        shl64(a, b, 3) = shift(Left, W64, a, b, 3);
        shr32(a, b, 3) = shift(RightLogical, W32, a, b, 3);
        shr64(a, b, 3) = shift(RightLogical, W64, a, b, 3);
        sar32(a, b, 3) = shift(RightArithmetic, W32, a, b, 3);
        sar64(a, b, 3) = shift(RightArithmetic, W64, a, b, 3);
        rotl32(a, b, 3) = shift(RotateLeft, W32, a, b, 3);
        rotl64(a, b, 3) = shift(RotateLeft, W64, a, b, 3);
        rotr32(a, b, 3) = shift(RotateRight, W32, a, b, 3);
        rotr64(a, b, 3) = shift(RotateRight, W64, a, b, 3);
        load8_signed32(a, m) = load_signed(S8, W32, a, m);
        load8_signed64(a, m) = load_signed(S8, W64, a, m);
        load16_signed32(a, m) = load_signed(S16, W32, a, m);
        load16_signed64(a, m) = load_signed(S16, W64, a, m);
        load32_signed64(a, m) = load_signed(S32, W64, a, m);
        load8(a, m) = load(S8, a, m);
        load16(a, m) = load(S16, a, m);
        load32(a, m) = load(S32, a, m);
        load64(a, m) = load(S64, a, m);
        store8(m, a) = store(S8, m, a);
        store16(m, a) = store(S16, m, a);
        store32(m, a) = store(S32, m, a);
        store64(m, a) = store(S64, m, a);
        branch8(lt, m, 5, t) = branch_narrow(S8, lt, m, 5, t);
        branch16(lt, m, 5, t) = branch_narrow(S16, lt, m, 5, t);
        branch_test8(zero, m, 5, t) = branch_test_narrow(S8, zero, m, 5, t);
        branch_test16(zero, m, 5, t) = branch_test_narrow(S16, zero, m, 5, t);
        compare8(lt, a, m, 5) = compare_narrow(S8, lt, a, m, 5);
        compare16(lt, a, m, 5) = compare_narrow(S16, lt, a, m, 5);
        test8(zero, a, m, 5) = test_narrow(S8, zero, a, m, 5);
        test16(zero, a, m, 5) = test_narrow(S16, zero, a, m, 5);
        transfer32(m, n) = transfer(S32, m, n);
        transfer64(m, n) = transfer(S64, m, n);
        add32_to_memory(m, a) = add_to_memory(S32, m, a);
        add64_to_memory(m, a) = add_to_memory(S64, m, a);
        zero_extend8(a, b) = extend(S8, Unsigned, W32, a, b);
        zero_extend16(a, b) = extend(S16, Unsigned, W32, a, b);
        zero_extend32(a, b) = extend(S32, Unsigned, W64, a, b);
        sign_extend8_to_32(a, b) = extend(S8, Signed, W32, a, b);
        sign_extend16_to_32(a, b) = extend(S16, Signed, W32, a, b);
        sign_extend32_to_64(a, b) = extend(S32, Signed, W64, a, b);
        move_bits_to_f32(f, a) = move_bits_to_float(F32, f, a);
        move_bits_to_f64(f, a) = move_bits_to_float(F64, f, a);
        move_f32_to_bits(a, f) = move_float_to_bits(F32, a, f);
        move_f64_to_bits(a, f) = move_float_to_bits(F64, a, f);
        load_f32(f, m) = load_float(F32, f, m);
        load_f64(f, m) = load_float(F64, f, m);
        store_f32(m, f) = store_float(F32, m, f);
        store_f64(m, f) = store_float(F64, m, f);
        add_f32(f, g, h) = add_float(F32, f, g, h);
        add_f64(f, g, h) = add_float(F64, f, g, h);
        sub_f32(f, g, h) = sub_float(F32, f, g, h);
        sub_f64(f, g, h) = sub_float(F64, f, g, h);
        mul_f32(f, g, h) = mul_float(F32, f, g, h);
        mul_f64(f, g, h) = mul_float(F64, f, g, h);
        div_f32(f, g, h) = div_float(F32, f, g, h);
        div_f64(f, g, h) = div_float(F64, f, g, h);
        min_f32(f, g, h) = min_float(F32, f, g, h);
        min_f64(f, g, h) = min_float(F64, f, g, h);
        max_f32(f, g, h) = max_float(F32, f, g, h);
        max_f64(f, g, h) = max_float(F64, f, g, h);
        abs_f32(f, g) = abs_float(F32, f, g);
        abs_f64(f, g) = abs_float(F64, f, g);
        neg_f32(f, g) = neg_float(F32, f, g);
        neg_f64(f, g) = neg_float(F64, f, g);
        sqrt_f32(f, g) = sqrt_float(F32, f, g);
        sqrt_f64(f, g) = sqrt_float(F64, f, g);
        branch_f32(ne, f, g, t) = branch_float(F32, ne, f, g, t);
        branch_f64(ne, f, g, t) = branch_float(F64, ne, f, g, t);
        branch_f32_with_zero(ne, f, t) = branch_float_with_zero(F32, ne, f, t);
        branch_f64_with_zero(ne, f, t) = branch_float_with_zero(F64, ne, f, t);
        compare_f32(ne, a, f, g) = compare_float(F32, ne, a, f, g);
        compare_f64(ne, a, f, g) = compare_float(F64, ne, a, f, g);
        convert_i32_to_f64(f, a) = convert_int_to_float(Signed, W32, F64, f, a);
        convert_u32_to_f64(f, a) = convert_int_to_float(Unsigned, W32, F64, f, a);
        convert_i64_to_f64(f, a) = convert_int_to_float(Signed, W64, F64, f, a);
        convert_f64_to_i32_exact(a, f, reject, t) = convert_f64_to_int_exact(W32, a, f, reject, t);
    }
}

#[test]
fn x64() {
    check::<x64::MacroAssembler>(X64Features::empty());
}

#[test]
fn arm64() {
    check::<arm64::MacroAssembler>(Arm64Features::empty());
}
