//! Families of instructions that share a form.

use crate::family::family;
use crate::operand::{Cond, ResultCond, Shift, TestCond};

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Cc {
    O,
    No,
    B,
    Ae,
    E,
    Ne,
    Be,
    A,
    S,
    Ns,
    P,
    Np,
    L,
    Ge,
    Le,
    G,
}

impl Cc {
    pub const ALL: [Self; 16] = [
        Self::O,
        Self::No,
        Self::B,
        Self::Ae,
        Self::E,
        Self::Ne,
        Self::Be,
        Self::A,
        Self::S,
        Self::Ns,
        Self::P,
        Self::Np,
        Self::L,
        Self::Ge,
        Self::Le,
        Self::G,
    ];

    #[inline]
    pub const fn inverted(self) -> Self {
        Self::ALL[self as usize ^ 1]
    }
}

impl From<Cond> for Cc {
    #[inline]
    fn from(cond: Cond) -> Self {
        match cond {
            Cond::Eq => Self::E,
            Cond::Ne => Self::Ne,
            Cond::Lt => Self::L,
            Cond::Ge => Self::Ge,
            Cond::Le => Self::Le,
            Cond::Gt => Self::G,
            Cond::Below => Self::B,
            Cond::AboveEq => Self::Ae,
            Cond::BelowEq => Self::Be,
            Cond::Above => Self::A,
        }
    }
}

impl From<TestCond> for Cc {
    #[inline]
    fn from(cond: TestCond) -> Self {
        match cond {
            TestCond::Zero => Self::E,
            TestCond::NonZero => Self::Ne,
            TestCond::Negative => Self::S,
            TestCond::NonNegative => Self::Ns,
        }
    }
}

impl From<ResultCond> for Cc {
    #[inline]
    fn from(cond: ResultCond) -> Self {
        match cond {
            ResultCond::Zero => Self::E,
            ResultCond::NonZero => Self::Ne,
            ResultCond::Negative => Self::S,
            ResultCond::NonNegative => Self::Ns,
            ResultCond::Overflow => Self::O,
            ResultCond::NoOverflow => Self::No,
            ResultCond::Carry => Self::B,
            ResultCond::NoCarry => Self::Ae,
        }
    }
}

family! {
    Alu: u8 {
        Add = 0,
        Or = 1,
        Adc = 2,
        Sbb = 3,
        And = 4,
        Sub = 5,
        Xor = 6,
        Cmp = 7,
    }
}

family! {
    /// One operand. `Mul` to `Idiv` also use rax and rdx.
    Unary: u8 {
        Not = 2,
        Neg = 3,
        Mul = 4,
        Imul = 5,
        Div = 6,
        Idiv = 7,
    }
}

family! {
    ShiftOp: u8 {
        Rol = 0,
        Ror = 1,
        Shl = 4,
        Shr = 5,
        Sar = 7,
    }
}

impl From<Shift> for ShiftOp {
    #[inline]
    fn from(shift: Shift) -> Self {
        match shift {
            Shift::Left => Self::Shl,
            Shift::RightLogical => Self::Shr,
            Shift::RightArithmetic => Self::Sar,
            Shift::RotateLeft => Self::Rol,
            Shift::RotateRight => Self::Ror,
        }
    }
}

family! {
    /// Copies a bit to the carry flag and then leaves, sets, clears or flips it.
    BitTest: u8 {
        Bt = 4,
        Bts = 5,
        Btr = 6,
        Btc = 7,
    }
}

const NP: u16 = 0;
const P66: u16 = 1 << 10;
const PF3: u16 = 2 << 10;
const PF2: u16 = 3 << 10;
const M0F: u16 = 1 << 8;
const M38: u16 = 2 << 8;
const M3A: u16 = 3 << 8;
const W1: u16 = 1 << 12;
const COMMUTES: u16 = 1 << 13;

family! {
    /// `dst = f(src)`.
    BitCount: u16 {
        Bsf = NP | M0F | 0xbc,
        Bsr = NP | M0F | 0xbd,
        Popcnt = PF3 | M0F | 0xb8,
        Tzcnt = PF3 | M0F | 0xbc,
        Lzcnt = PF3 | M0F | 0xbd,
    }
}

family! {
    /// `dst = src shifted by a register`.
    ShiftX: u16 {
        Shlx = P66 | M38 | 0xf7,
        Sarx = PF3 | M38 | 0xf7,
        Shrx = PF2 | M38 | 0xf7,
    }
}

family! {
    /// `dst = f(lhs, rhs)` on vector registers. Without AVX `lhs` is `dst`.
    Sse: u16 {
        Addss = PF3 | M0F | 0x58 | COMMUTES,
        Addsd = PF2 | M0F | 0x58 | COMMUTES,
        Addps = NP | M0F | 0x58 | COMMUTES,
        Addpd = P66 | M0F | 0x58 | COMMUTES,
        Subss = PF3 | M0F | 0x5c,
        Subsd = PF2 | M0F | 0x5c,
        Subps = NP | M0F | 0x5c,
        Subpd = P66 | M0F | 0x5c,
        Mulss = PF3 | M0F | 0x59 | COMMUTES,
        Mulsd = PF2 | M0F | 0x59 | COMMUTES,
        Mulps = NP | M0F | 0x59 | COMMUTES,
        Mulpd = P66 | M0F | 0x59 | COMMUTES,
        Divss = PF3 | M0F | 0x5e,
        Divsd = PF2 | M0F | 0x5e,
        Divps = NP | M0F | 0x5e,
        Divpd = P66 | M0F | 0x5e,
        Minss = PF3 | M0F | 0x5d,
        Minsd = PF2 | M0F | 0x5d,
        Minps = NP | M0F | 0x5d,
        Minpd = P66 | M0F | 0x5d,
        Maxss = PF3 | M0F | 0x5f,
        Maxsd = PF2 | M0F | 0x5f,
        Maxps = NP | M0F | 0x5f,
        Maxpd = P66 | M0F | 0x5f,
        Sqrtss = PF3 | M0F | 0x51,
        Sqrtsd = PF2 | M0F | 0x51,
        Cvtss2sd = PF3 | M0F | 0x5a,
        Cvtsd2ss = PF2 | M0F | 0x5a,
        Andps = NP | M0F | 0x54 | COMMUTES,
        Andpd = P66 | M0F | 0x54 | COMMUTES,
        Andnps = NP | M0F | 0x55,
        Andnpd = P66 | M0F | 0x55,
        Orps = NP | M0F | 0x56 | COMMUTES,
        Orpd = P66 | M0F | 0x56 | COMMUTES,
        Xorps = NP | M0F | 0x57 | COMMUTES,
        Xorpd = P66 | M0F | 0x57 | COMMUTES,
        Unpcklps = NP | M0F | 0x14,
        Unpcklpd = P66 | M0F | 0x14,
        Unpckhps = NP | M0F | 0x15,
        Unpckhpd = P66 | M0F | 0x15,
        Punpcklbw = P66 | M0F | 0x60,
        Punpcklwd = P66 | M0F | 0x61,
        Punpckldq = P66 | M0F | 0x62,
        Punpcklqdq = P66 | M0F | 0x6c,
        Punpckhbw = P66 | M0F | 0x68,
        Punpckhwd = P66 | M0F | 0x69,
        Punpckhdq = P66 | M0F | 0x6a,
        Punpckhqdq = P66 | M0F | 0x6d,
        Packsswb = P66 | M0F | 0x63,
        Packuswb = P66 | M0F | 0x67,
        Packssdw = P66 | M0F | 0x6b,
        Packusdw = P66 | M38 | 0x2b,
        Pcmpeqb = P66 | M0F | 0x74 | COMMUTES,
        Pcmpeqw = P66 | M0F | 0x75 | COMMUTES,
        Pcmpeqd = P66 | M0F | 0x76 | COMMUTES,
        Pcmpeqq = P66 | M38 | 0x29 | COMMUTES,
        Pcmpgtb = P66 | M0F | 0x64,
        Pcmpgtw = P66 | M0F | 0x65,
        Pcmpgtd = P66 | M0F | 0x66,
        Pcmpgtq = P66 | M38 | 0x37,
        Paddb = P66 | M0F | 0xfc | COMMUTES,
        Paddw = P66 | M0F | 0xfd | COMMUTES,
        Paddd = P66 | M0F | 0xfe | COMMUTES,
        Paddq = P66 | M0F | 0xd4 | COMMUTES,
        Paddsb = P66 | M0F | 0xec | COMMUTES,
        Paddsw = P66 | M0F | 0xed | COMMUTES,
        Paddusb = P66 | M0F | 0xdc | COMMUTES,
        Paddusw = P66 | M0F | 0xdd | COMMUTES,
        Psubb = P66 | M0F | 0xf8,
        Psubw = P66 | M0F | 0xf9,
        Psubd = P66 | M0F | 0xfa,
        Psubq = P66 | M0F | 0xfb,
        Psubsb = P66 | M0F | 0xe8,
        Psubsw = P66 | M0F | 0xe9,
        Psubusb = P66 | M0F | 0xd8,
        Psubusw = P66 | M0F | 0xd9,
        Pmullw = P66 | M0F | 0xd5 | COMMUTES,
        Pmulld = P66 | M38 | 0x40 | COMMUTES,
        Pmulhw = P66 | M0F | 0xe5 | COMMUTES,
        Pmulhuw = P66 | M0F | 0xe4 | COMMUTES,
        Pmulhrsw = P66 | M38 | 0x0b | COMMUTES,
        Pmuludq = P66 | M0F | 0xf4 | COMMUTES,
        Pmuldq = P66 | M38 | 0x28 | COMMUTES,
        Pmaddwd = P66 | M0F | 0xf5 | COMMUTES,
        Pmaddubsw = P66 | M38 | 0x04,
        Phaddw = P66 | M38 | 0x01,
        Phaddd = P66 | M38 | 0x02,
        Pminsb = P66 | M38 | 0x38 | COMMUTES,
        Pminsw = P66 | M0F | 0xea | COMMUTES,
        Pminsd = P66 | M38 | 0x39 | COMMUTES,
        Pminub = P66 | M0F | 0xda | COMMUTES,
        Pminuw = P66 | M38 | 0x3a | COMMUTES,
        Pminud = P66 | M38 | 0x3b | COMMUTES,
        Pmaxsb = P66 | M38 | 0x3c | COMMUTES,
        Pmaxsw = P66 | M0F | 0xee | COMMUTES,
        Pmaxsd = P66 | M38 | 0x3d | COMMUTES,
        Pmaxub = P66 | M0F | 0xde | COMMUTES,
        Pmaxuw = P66 | M38 | 0x3e | COMMUTES,
        Pmaxud = P66 | M38 | 0x3f | COMMUTES,
        Pavgb = P66 | M0F | 0xe0 | COMMUTES,
        Pavgw = P66 | M0F | 0xe3 | COMMUTES,
        Psadbw = P66 | M0F | 0xf6 | COMMUTES,
        Pand = P66 | M0F | 0xdb | COMMUTES,
        Pandn = P66 | M0F | 0xdf,
        Por = P66 | M0F | 0xeb | COMMUTES,
        Pxor = P66 | M0F | 0xef | COMMUTES,
        Pshufb = P66 | M38,
        Psllw = P66 | M0F | 0xf1,
        Pslld = P66 | M0F | 0xf2,
        Psllq = P66 | M0F | 0xf3,
        Psrlw = P66 | M0F | 0xd1,
        Psrld = P66 | M0F | 0xd2,
        Psrlq = P66 | M0F | 0xd3,
        Psraw = P66 | M0F | 0xe1,
        Psrad = P66 | M0F | 0xe2,
    }
}

impl Sse {
    /// The operands can be exchanged. That may change which NaN results, and what is above a scalar.
    #[inline]
    pub const fn commutes(self) -> bool {
        self as u16 & COMMUTES != 0
    }
}

family! {
    /// `dst = f(lhs, rhs, imm)`. Without AVX `lhs` is `dst`.
    SseImm: u16 {
        Cmpss = PF3 | M0F | 0xc2,
        Cmpsd = PF2 | M0F | 0xc2,
        Cmpps = NP | M0F | 0xc2,
        Cmppd = P66 | M0F | 0xc2,
        Shufps = NP | M0F | 0xc6,
        Shufpd = P66 | M0F | 0xc6,
        Roundss = P66 | M3A | 0x0a,
        Roundsd = P66 | M3A | 0x0b,
        Blendps = P66 | M3A | 0x0c,
        Blendpd = P66 | M3A | 0x0d,
        Pblendw = P66 | M3A | 0x0e,
        Palignr = P66 | M3A | 0x0f,
        Insertps = P66 | M3A | 0x21,
    }
}

family! {
    /// `dst = f(src)`, or for the comparisons `flags = f(dst, src)`.
    SseUnary: u16 {
        Movaps = NP | M0F | 0x28,
        Movups = NP | M0F | 0x10,
        Movdqu = PF3 | M0F | 0x6f,
        Movq = PF3 | M0F | 0x7e,
        Movddup = PF2 | M0F | 0x12,
        Movsldup = PF3 | M0F | 0x12,
        Movshdup = PF3 | M0F | 0x16,
        Sqrtps = NP | M0F | 0x51,
        Sqrtpd = P66 | M0F | 0x51,
        Cvtdq2ps = NP | M0F | 0x5b,
        Cvttps2dq = PF3 | M0F | 0x5b,
        Cvtdq2pd = PF3 | M0F | 0xe6,
        Cvttpd2dq = P66 | M0F | 0xe6,
        Cvtps2pd = NP | M0F | 0x5a,
        Cvtpd2ps = P66 | M0F | 0x5a,
        Ucomiss = NP | M0F | 0x2e,
        Ucomisd = P66 | M0F | 0x2e,
        Ptest = P66 | M38 | 0x17,
        Pabsb = P66 | M38 | 0x1c,
        Pabsw = P66 | M38 | 0x1d,
        Pabsd = P66 | M38 | 0x1e,
        Pmovsxbw = P66 | M38 | 0x20,
        Pmovsxwd = P66 | M38 | 0x23,
        Pmovsxdq = P66 | M38 | 0x25,
        Pmovzxbw = P66 | M38 | 0x30,
        Pmovzxwd = P66 | M38 | 0x33,
        Pmovzxdq = P66 | M38 | 0x35,
        Phminposuw = P66 | M38 | 0x41,
    }
}

family! {
    /// `dst = f(src)`, in the VEX encoding only.
    AvxUnary: u16 {
        Vcvtph2ps = P66 | M38 | 0x13,
        Vbroadcastss = P66 | M38 | 0x18,
        Vpbroadcastd = P66 | M38 | 0x58,
        Vpbroadcastq = P66 | M38 | 0x59,
        Vpbroadcastb = P66 | M38 | 0x78,
        Vpbroadcastw = P66 | M38 | 0x79,
    }
}

family! {
    /// `dst = f(src, imm)`.
    SseUnaryImm: u16 {
        Pshufd = P66 | M0F | 0x70,
        Pshufhw = PF3 | M0F | 0x70,
        Pshuflw = PF2 | M0F | 0x70,
        Roundps = P66 | M3A | 0x08,
        Roundpd = P66 | M3A | 0x09,
    }
}

family! {
    /// The opcode, and above it the extension in the ModRM byte.
    SseShiftImm: u16 {
        Psrlw = 2 << 8 | 0x71,
        Psraw = 4 << 8 | 0x71,
        Psllw = 6 << 8 | 0x71,
        Psrld = 2 << 8 | 0x72,
        Psrad = 4 << 8 | 0x72,
        Pslld = 6 << 8 | 0x72,
        Psrlq = 2 << 8 | 0x73,
        Psrldq = 3 << 8 | 0x73,
        Psllq = 6 << 8 | 0x73,
        Pslldq = 7 << 8 | 0x73,
    }
}

family! {
    /// From memory, clearing the rest of the register.
    SseLoad: u16 {
        Movss = PF3 | M0F | 0x10,
        Movsd = PF2 | M0F | 0x10,
    }
}

family! {
    SseStore: u16 {
        Movss = PF3 | M0F | 0x11,
        Movsd = PF2 | M0F | 0x11,
        Movups = NP | M0F | 0x11,
        Movaps = NP | M0F | 0x29,
        Movdqu = PF3 | M0F | 0x7f,
        Movhps = NP | M0F | 0x17,
    }
}

family! {
    /// One half of `dst` is replaced and the other is that of `lhs`.
    SseMergeLoad: u16 {
        Movlps = NP | M0F | 0x12,
        Movhps = NP | M0F | 0x16,
    }
}

family! {
    /// Part of `dst` is from `rhs` and the rest from `lhs`. Between registers only.
    SseMerge: u16 {
        Movss = PF3 | M0F | 0x10,
        Movsd = PF2 | M0F | 0x10,
        Movhlps = NP | M0F | 0x12,
        Movlhps = NP | M0F | 0x16,
    }
}

family! {
    /// The sign bits of the lanes.
    MoveMask: u16 {
        Movmskps = NP | M0F | 0x50,
        Movmskpd = P66 | M0F | 0x50,
        Pmovmskb = P66 | M0F | 0xd7,
    }
}

family! {
    /// Chooses lanes by the sign bits of a mask, in the VEX encoding only.
    Blendv: u16 {
        Vblendvps = P66 | M3A | 0x4a,
        Vblendvpd = P66 | M3A | 0x4b,
        Vpblendvb = P66 | M3A | 0x4c,
    }
}

family! {
    /// 132: `dst = dst * rhs + lhs`, 213: `dst = lhs * dst + rhs`, 231: `dst = lhs * rhs + dst`.
    Fma: u16 {
        Vfmadd132ps = P66 | M38 | 0x98,
        Vfmadd132pd = P66 | M38 | 0x98 | W1,
        Vfmadd213ps = P66 | M38 | 0xa8,
        Vfmadd213pd = P66 | M38 | 0xa8 | W1,
        Vfmadd231ps = P66 | M38 | 0xb8,
        Vfmadd231pd = P66 | M38 | 0xb8 | W1,
        Vfnmadd132ps = P66 | M38 | 0x9c,
        Vfnmadd132pd = P66 | M38 | 0x9c | W1,
        Vfnmadd213ps = P66 | M38 | 0xac,
        Vfnmadd213pd = P66 | M38 | 0xac | W1,
        Vfnmadd231ps = P66 | M38 | 0xbc,
        Vfnmadd231pd = P66 | M38 | 0xbc | W1,
    }
}

family! {
    /// The predicate of `cmpps` and its relatives.
    FloatPredicate: u8 {
        Eq = 0,
        Lt = 1,
        Le = 2,
        Unordered = 3,
        NeOrUnordered = 4,
        GeOrUnordered = 5,
        Ordered = 7,
    }
}

impl FloatPredicate {
    #[inline]
    pub const fn commutes(self) -> bool {
        !matches!(self, Self::Lt | Self::Le | Self::GeOrUnordered)
    }
}

/// The encoding of an instruction up to its ModRM byte.
#[derive(Clone, Copy)]
pub(super) struct Encoding(pub(super) u16);

impl Encoding {
    pub(super) const PREFIX_66: u16 = P66;
    pub(super) const PREFIX_F3: u16 = PF3;
    pub(super) const PREFIX_F2: u16 = PF2;
    pub(super) const MAP_0F: u16 = M0F;
    pub(super) const MAP_38: u16 = M38;
    pub(super) const MAP_3A: u16 = M3A;
    pub(super) const WIDE: u16 = W1;
    /// The `reg` field names the low byte of a register.
    pub(super) const BYTE_REG: u16 = 1 << 14;
    /// So does the `rm` field.
    pub(super) const BYTE_RM: u16 = 1 << 15;

    #[inline(always)]
    pub(super) fn opcode(self) -> u8 {
        self.0 as u8
    }

    #[inline(always)]
    pub(super) fn map(self) -> u8 {
        (self.0 >> 8 & 3) as u8
    }

    #[inline(always)]
    pub(super) fn prefix(self) -> u8 {
        (self.0 >> 10 & 3) as u8
    }

    #[inline(always)]
    pub(super) fn wide(self) -> u8 {
        (self.0 >> 12 & 1) as u8
    }

    /// Nothing but REX comes before the opcode, and the operands have 32 or 64 bits.
    #[inline(always)]
    pub(super) fn is_plain(self) -> bool {
        self.0 & !(Self::WIDE | 0xff) == 0
    }

    #[inline(always)]
    pub(super) fn has(self, flag: u16) -> bool {
        self.0 & flag != 0
    }
}
