//! Instructions that `core::arch` lacks on stable Rust.

use core::arch::aarch64::*;

macro_rules! run { ([$($template:literal),+] $how:ident $v:ident $($a:ident)+) => {
    // SAFETY: these write the first register and the flags in FPSR, and read the others, and the first if it is `inout`.
    #[allow(unsafe_code)]
    unsafe { core::arch::asm!($($template),+, $how(vreg) $v, $(in(vreg) $a,)+ options(pure, nomem, nostack)) }
}; }
macro_rules! rows { ($($features:literal { $($name:ident($v:ident, $a:ident, $b:ident) = $($template:literal),+;)* })*) => {$($(
    #[inline]
    #[target_feature(enable = $features)]
    pub fn $name(mut v: $v, a: $a, b: $b) -> $v {
        run!([$($template),+] inout v a b);
        v
    }
)*)*}; }
macro_rules! of_operands { ($($features:literal { $($name:ident($($a:ident),+: $t:ident) = $template:literal;)* })*) => {$($(
    #[inline]
    #[target_feature(enable = $features)]
    pub fn $name($($a: $t),+) -> $t {
        let v;
        run!([$template] lateout v $($a)+);
        v
    }
)*)*}; }
rows! {
    "neon,bf16" {
        dot(uint8x16_t, uint8x16_t, uint8x16_t) = "bfdot {0:v}.4s, {1:v}.8h, {2:v}.8h";
        fused_dot(uint8x16_t, uint8x16_t, uint8x16_t) = "bfmlalt {0:v}.4s, {1:v}.8h, {2:v}.8h", "bfmlalb {0:v}.4s, {1:v}.8h, {2:v}.8h";
        mat_mul(uint8x16_t, uint8x16_t, uint8x16_t) = "bfmmla {0:v}.4s, {1:v}.8h, {2:v}.8h";
        narrow(uint8x16_t, uint8x16_t, uint8x16_t) = "bfcvtn {0:v}.4h, {0:v}.4s", "bfcvtn2 {0:v}.8h, {1:v}.4s /* {2:v} */";
    }
    "neon,i8mm" {
        vmmlaq_s32(int32x4_t, int8x16_t, int8x16_t) = "smmla {0:v}.4s, {1:v}.16b, {2:v}.16b";
        vmmlaq_u32(uint32x4_t, uint8x16_t, uint8x16_t) = "ummla {0:v}.4s, {1:v}.16b, {2:v}.16b";
        vusmmlaq_s32(int32x4_t, uint8x16_t, int8x16_t) = "usmmla {0:v}.4s, {1:v}.16b, {2:v}.16b";
        vusdotq_s32(int32x4_t, uint8x16_t, int8x16_t) = "usdot {0:v}.4s, {1:v}.16b, {2:v}.16b";
    }
    "neon,fcma" {
        vcmlaq_f32(float32x4_t, float32x4_t, float32x4_t) = "fcmla {0:v}.4s, {1:v}.4s, {2:v}.4s, #0";
        vcmlaq_rot90_f32(float32x4_t, float32x4_t, float32x4_t) = "fcmla {0:v}.4s, {1:v}.4s, {2:v}.4s, #90";
        vcmlaq_rot270_f32(float32x4_t, float32x4_t, float32x4_t) = "fcmla {0:v}.4s, {1:v}.4s, {2:v}.4s, #270";
        vcmlaq_f64(float64x2_t, float64x2_t, float64x2_t) = "fcmla {0:v}.2d, {1:v}.2d, {2:v}.2d, #0";
        vcmlaq_rot90_f64(float64x2_t, float64x2_t, float64x2_t) = "fcmla {0:v}.2d, {1:v}.2d, {2:v}.2d, #90";
        vcmlaq_rot270_f64(float64x2_t, float64x2_t, float64x2_t) = "fcmla {0:v}.2d, {1:v}.2d, {2:v}.2d, #270";
    }
    "neon,fp16,fcma" {
        vcmlaq_f16(float16x8_t, float16x8_t, float16x8_t) = "fcmla {0:v}.8h, {1:v}.8h, {2:v}.8h, #0";
        vcmlaq_rot90_f16(float16x8_t, float16x8_t, float16x8_t) = "fcmla {0:v}.8h, {1:v}.8h, {2:v}.8h, #90";
        vcmlaq_rot270_f16(float16x8_t, float16x8_t, float16x8_t) = "fcmla {0:v}.8h, {1:v}.8h, {2:v}.8h, #270";
    }
    "neon,sm4" {
        vsm3partw1q_u32(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3partw1 {0:v}.4s, {1:v}.4s, {2:v}.4s";
        vsm3partw2q_u32(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3partw2 {0:v}.4s, {1:v}.4s, {2:v}.4s";
        sm4e(uint32x4_t, uint32x4_t, uint32x4_t) = "sm4e {0:v}.4s, {1:v}.4s /* {2:v} */";
        tt1a_0(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt1a {0:v}.4s, {1:v}.4s, {2:v}.s[0]";
        tt1a_1(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt1a {0:v}.4s, {1:v}.4s, {2:v}.s[1]";
        tt1a_2(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt1a {0:v}.4s, {1:v}.4s, {2:v}.s[2]";
        tt1a_3(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt1a {0:v}.4s, {1:v}.4s, {2:v}.s[3]";
        tt1b_0(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt1b {0:v}.4s, {1:v}.4s, {2:v}.s[0]";
        tt1b_1(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt1b {0:v}.4s, {1:v}.4s, {2:v}.s[1]";
        tt1b_2(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt1b {0:v}.4s, {1:v}.4s, {2:v}.s[2]";
        tt1b_3(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt1b {0:v}.4s, {1:v}.4s, {2:v}.s[3]";
        tt2a_0(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt2a {0:v}.4s, {1:v}.4s, {2:v}.s[0]";
        tt2a_1(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt2a {0:v}.4s, {1:v}.4s, {2:v}.s[1]";
        tt2a_2(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt2a {0:v}.4s, {1:v}.4s, {2:v}.s[2]";
        tt2a_3(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt2a {0:v}.4s, {1:v}.4s, {2:v}.s[3]";
        tt2b_0(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt2b {0:v}.4s, {1:v}.4s, {2:v}.s[0]";
        tt2b_1(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt2b {0:v}.4s, {1:v}.4s, {2:v}.s[1]";
        tt2b_2(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt2b {0:v}.4s, {1:v}.4s, {2:v}.s[2]";
        tt2b_3(uint32x4_t, uint32x4_t, uint32x4_t) = "sm3tt2b {0:v}.4s, {1:v}.4s, {2:v}.s[3]";
    }
}
of_operands! {
    "neon,fcma" {
        vcaddq_rot90_f32(a, b: float32x4_t) = "fcadd {0:v}.4s, {1:v}.4s, {2:v}.4s, #90";
        vcaddq_rot270_f32(a, b: float32x4_t) = "fcadd {0:v}.4s, {1:v}.4s, {2:v}.4s, #270";
        vcaddq_rot90_f64(a, b: float64x2_t) = "fcadd {0:v}.2d, {1:v}.2d, {2:v}.2d, #90";
        vcaddq_rot270_f64(a, b: float64x2_t) = "fcadd {0:v}.2d, {1:v}.2d, {2:v}.2d, #270";
    }
    "neon,fp16,fcma" {
        vcaddq_rot90_f16(a, b: float16x8_t) = "fcadd {0:v}.8h, {1:v}.8h, {2:v}.8h, #90";
        vcaddq_rot270_f16(a, b: float16x8_t) = "fcadd {0:v}.8h, {1:v}.8h, {2:v}.8h, #270";
    }
    "neon,sm4" {
        vsm4ekeyq_u32(a, b: uint32x4_t) = "sm4ekey {0:v}.4s, {1:v}.4s, {2:v}.4s";
        vsm3ss1q_u32(a, b, c: uint32x4_t) = "sm3ss1 {0:v}.4s, {1:v}.4s, {2:v}.4s, {3:v}.4s";
    }
    // From `f16`, toward zero.
    "neon,fp16" {
        truncate_s16(a: uint8x16_t) = "fcvtzs {0:v}.8h, {1:v}.8h";
        truncate_u16(a: uint8x16_t) = "fcvtzu {0:v}.8h, {1:v}.8h";
    }
}
