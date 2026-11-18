//! One method for each form of instruction. Operands are in the order of Intel's manual.

use super::opcode::*;
use super::registers::{RAX, RBP};
use crate::buffer::{CodeBuffer, WINDOW};
use crate::features::X64Features;
use crate::label::Label;
use crate::operand::{Address, FloatWidth, Scale, Size, Width};
use crate::register::{Fpr, Gpr};

/// Keeps every distance within the code well inside 32 bits.
/// In the `vvvv` argument of the VEX paths: the operands have 256 bits.
const LONG_VECTOR: u8 = 16;

const MAX_CODE_SIZE: usize = 1 << 30;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SiteKind {
    /// The start of a `jmp` with a distance of 32 bits, which may shrink.
    Jump,
    /// The start of a `jcc` with a distance of 32 bits, which may shrink.
    ConditionalJump,
    /// The start of a `Jump` that shrinks.
    ShrunkJump,
    /// The start of a `ConditionalJump` that shrinks.
    ShrunkConditionalJump,
    /// One byte at the end of an instruction.
    Distance8,
    /// Four bytes that `trailing` more of the instruction follow.
    Distance32 {
        trailing: u8,
    },
    /// The start of as much padding as may be needed. The label is not used.
    Padding {
        log2: u8,
        bias: u8,
        max: u8,
    },
    /// The same, to keep the code up to the label together.
    PaddingOfStretch {
        max: u8,
    },
    TableEntry {
        table: Label,
    },
}

/// The operand of the `rm` field: a register of the bank `R`, or memory.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Rm<R> {
    Reg(R),
    Mem(Address),
}

pub type GprMem = Rm<Gpr>;
pub type FprMem = Rm<Fpr>;

impl From<Gpr> for GprMem {
    #[inline]
    fn from(reg: Gpr) -> Self {
        Self::Reg(reg)
    }
}

impl From<Fpr> for FprMem {
    #[inline]
    fn from(reg: Fpr) -> Self {
        Self::Reg(reg)
    }
}

impl<R> From<Address> for Rm<R> {
    #[inline]
    fn from(address: Address) -> Self {
        Self::Mem(address)
    }
}

impl GprMem {
    #[inline(always)]
    fn untyped(self) -> Rm<u8> {
        match self {
            Self::Reg(reg) => Rm::Reg(reg.0),
            Self::Mem(address) => Rm::Mem(address),
        }
    }

    #[inline]
    pub fn uses(self, reg: Gpr) -> bool {
        match self {
            Self::Reg(own) => own == reg,
            Self::Mem(address) => address.uses(reg),
        }
    }
}

impl FprMem {
    #[inline(always)]
    fn untyped(self) -> Rm<u8> {
        match self {
            Self::Reg(reg) => Rm::Reg(reg.0),
            Self::Mem(address) => Rm::Mem(address),
        }
    }
}

#[derive(Clone, Copy)]
struct Immediate {
    value: i32,
    len: u8,
}

impl Immediate {
    const NONE: Self = Self { value: 0, len: 0 };

    #[inline(always)]
    fn byte(value: u8) -> Self {
        Self {
            value: value.into(),
            len: 1,
        }
    }

    /// An operation on 64 bits extends the sign of 32.
    #[inline(always)]
    fn sized(size: Size, value: i32) -> Self {
        Self {
            value,
            len: size.bytes().min(4),
        }
    }
}

struct Cursor<'a> {
    out: &'a mut [u8; WINDOW],
    len: usize,
}

impl Cursor<'_> {
    const MASK: usize = WINDOW / 2 - 1;

    #[inline(always)]
    fn byte(&mut self, byte: u8) {
        self.byte_if(true, byte);
    }

    #[inline(always)]
    fn byte_if(&mut self, wanted: bool, byte: u8) {
        self.out[self.len & Self::MASK] = byte;
        self.len += usize::from(wanted);
    }

    #[inline(always)]
    fn word(&mut self, value: i32, len: u8) {
        self.out[self.len & Self::MASK..][..4].copy_from_slice(&value.to_le_bytes());
        self.len += usize::from(len);
    }

    #[inline(always)]
    fn legacy_opcode(&mut self, encoding: Encoding, rex: u8) {
        const PREFIXES: [u8; 4] = [0, 0x66, 0xf3, 0xf2];
        const ESCAPES: [u8; 4] = [0, 0, 0x38, 0x3a];
        let (prefix, map) = (encoding.prefix(), encoding.map());
        self.byte_if(prefix != 0, PREFIXES[prefix as usize]);
        self.byte_if(rex != 0, 0x40 | rex);
        self.byte_if(map != 0, 0x0f);
        self.byte_if(map > 1, ESCAPES[map as usize]);
        self.byte(encoding.opcode());
    }

    /// `rxb` holds the three bits that extend the register numbers, and `vvvv` may have [`LONG_VECTOR`].
    #[inline(always)]
    fn vex_opcode(&mut self, encoding: Encoding, rxb: u8, vvvv: u8) {
        let last = (!vvvv & 15) << 3 | (vvvv & LONG_VECTOR) >> 2 | encoding.prefix();
        if rxb & 3 == 0 && encoding.map() == 1 && encoding.wide() == 0 {
            self.byte(0xc5);
            self.byte((!rxb & 4) << 5 | last);
        } else {
            self.byte(0xc4);
            self.byte((!rxb & 7) << 5 | encoding.map());
            self.byte(encoding.wide() << 7 | last);
        }
        self.byte(encoding.opcode());
    }

    #[inline(always)]
    fn modrm_direct(&mut self, reg: u8, rm: u8) {
        self.byte(0xc0 | (reg & 7) << 3 | rm & 7);
    }

    #[inline(always)]
    fn modrm_memory(&mut self, reg: u8, address: Address) {
        let reg = (reg & 7) << 3;
        let base = address.base.0 & 7;
        let sib = address.scale.log2() << 6 | (address.index.0 & 7) << 3 | base;
        if address.base.0 >= Address::NO_BASE.0 {
            let has_sib = address.base == Address::NO_BASE;
            self.byte(reg | if has_sib { SIB } else { ALWAYS_HAS_OFFSET });
            self.byte_if(has_sib, sib);
            self.word(address.offset, 4);
            return;
        }
        let (mode, len) = mode_and_offset_len(base, address.offset);
        let has_sib = address.has_index() || base == SIB;
        self.byte(mode | reg | if has_sib { SIB } else { base });
        self.byte_if(has_sib, sib);
        self.word(address.offset, len);
    }
}

const SIB: u8 = 4;
const ALWAYS_HAS_OFFSET: u8 = 5;

/// `base` is the low three bits of the number.
#[inline(always)]
fn mode_and_offset_len(base: u8, offset: i32) -> (u8, u8) {
    if offset == 0 && base != ALWAYS_HAS_OFFSET {
        (0x00, 0)
    } else if is_byte(offset) {
        (0x40, 1)
    } else {
        (0x80, 4)
    }
}

#[inline(always)]
fn is_byte(value: i32) -> bool {
    value == i32::from(value as i8)
}

#[inline(always)]
fn high_bit(reg: u8) -> u8 {
    reg >> 3 & 1
}

#[inline(always)]
fn extension_bits(reg: u8, address: Address) -> u8 {
    debug_assert!(address.index.0 != 4, "rsp is no index");
    high_bit(reg) << 2 | high_bit(address.index.0) << 1 | high_bit(address.base.0)
}

/// Without a REX prefix the numbers 4 to 7 name ah, ch, dh and bh.
#[inline(always)]
fn byte_register_rex(encoding: Encoding, flag: u16, reg: u8) -> u8 {
    u8::from(encoding.has(flag) && reg >= 4) << 6
}

/// `opcode` is that for bytes. The next one is for the other sizes.
#[inline(always)]
fn sized(size: Size, opcode: u16) -> Encoding {
    Encoding(match size {
        Size::S8 => opcode | Encoding::BYTE_REG | Encoding::BYTE_RM,
        Size::S16 => opcode | 1 | Encoding::PREFIX_66,
        Size::S32 => opcode | 1,
        Size::S64 => opcode | 1 | Encoding::WIDE,
    })
}

/// For the forms whose `reg` field extends the opcode.
#[inline(always)]
fn sized_group(size: Size, opcode: u16) -> Encoding {
    Encoding(sized(size, opcode).0 & !Encoding::BYTE_REG)
}

#[inline(always)]
fn wide(width: Width, encoding: u16) -> Encoding {
    Encoding(
        encoding
            | if width == Width::W64 {
                Encoding::WIDE
            } else {
                0
            },
    )
}

#[inline(always)]
fn scalar_prefix(width: FloatWidth) -> u16 {
    match width {
        FloatWidth::F32 => Encoding::PREFIX_F3,
        FloatWidth::F64 => Encoding::PREFIX_F2,
    }
}

const NOPS: [&[u8]; 10] = [
    &[],
    &[0x90],
    &[0x66, 0x90],
    &[0x0f, 0x1f, 0x00],
    &[0x0f, 0x1f, 0x40, 0x00],
    &[0x0f, 0x1f, 0x44, 0x00, 0x00],
    &[0x66, 0x0f, 0x1f, 0x44, 0x00, 0x00],
    &[0x0f, 0x1f, 0x80, 0x00, 0x00, 0x00, 0x00],
    &[0x0f, 0x1f, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00],
    &[0x66, 0x0f, 0x1f, 0x84, 0x00, 0x00, 0x00, 0x00, 0x00],
];

pub(crate) fn fill_with_nops(mut bytes: &mut [u8]) {
    while !bytes.is_empty() {
        let nop = NOPS[bytes.len().min(NOPS.len() - 1)];
        let (head, rest) = bytes.split_at_mut(nop.len());
        head.copy_from_slice(nop);
        bytes = rest;
    }
}

pub(crate) fn padding(offset: u32, log2: u8, bias: u8, max: u8) -> u32 {
    let needed = (offset + u32::from(bias)).wrapping_neg() & ((1 << log2) - 1);
    if needed > u32::from(max) { 0 } else { needed }
}

pub(crate) const LINE_SIZE_LOG2: u8 = 6;
pub(crate) const JUMP_SIZE: u32 = 5;
pub(crate) const CONDITIONAL_JUMP_SIZE: u32 = 6;
pub(crate) const SHORT_JUMP_SIZE: u32 = 2;
pub(crate) const JUMP_OPCODE: u8 = 0xe9;
pub(crate) const SHORT_JUMP_OPCODE: u8 = 0xeb;
pub(crate) const SHORT_CONDITIONAL_JUMP_OPCODE: u8 = 0x70;

pub struct Assembler {
    pub(crate) buffer: CodeBuffer<SiteKind>,
    pub(crate) features: X64Features,
    pub(crate) shorten_jumps: bool,
    long_vectors: bool,
}

impl Assembler {
    pub fn new(features: X64Features, shorten_jumps: bool) -> Self {
        Self {
            buffer: CodeBuffer::new(MAX_CODE_SIZE),
            features,
            shorten_jumps,
            long_vectors: false,
        }
    }

    /// Operations on whole vector registers inside `body` are on 256 bits. Needs AVX2.
    pub fn with_long_vectors<R>(&mut self, body: impl FnOnce(&mut Assembler) -> R) -> R {
        assert!(self.has(X64Features::AVX2), "256-bit operands need AVX2");
        let before = core::mem::replace(&mut self.long_vectors, true);
        let result = body(self);
        self.long_vectors = before;
        result
    }

    #[inline(always)]
    fn long_bit(&self) -> u8 {
        if self.long_vectors { LONG_VECTOR } else { 0 }
    }

    /// Reading a long vector register after code that has written only its low half costs many cycles, so code that
    /// leaves `with_long_vectors` ends with this.
    pub fn vzeroupper(&mut self) {
        assert!(self.has(X64Features::AVX), "vzeroupper needs AVX");
        self.write(|cursor| cursor.vex_opcode(Encoding(Encoding::MAP_0F | 0x77), 0, 0));
    }

    /// Both halves of `dst` get the 16 bytes at `src`.
    pub fn broadcast_vector(&mut self, dst: Fpr, src: Address) {
        assert!(self.has(X64Features::AVX2), "a long broadcast needs AVX2");
        let encoding = Encoding(Encoding::PREFIX_66 | Encoding::MAP_38 | 0x5a);
        self.vex_memory(encoding, dst.0, LONG_VECTOR, src, Immediate::NONE);
    }

    #[inline]
    pub fn has(&self, features: X64Features) -> bool {
        self.features.contains(features)
    }

    #[inline(always)]
    fn write(&mut self, write: impl FnOnce(&mut Cursor<'_>)) {
        let mut cursor = Cursor {
            out: self.buffer.window(),
            len: 0,
        };
        write(&mut cursor);
        let len = cursor.len;
        self.buffer.len += len as u32;
    }

    #[inline(always)]
    fn note_label_operand(&mut self, address: Address, imm: Immediate) {
        if address.base == Address::LABEL_BASE {
            let at = self.buffer.len - u32::from(imm.len) - 4;
            self.buffer.record(
                at,
                Label(address.offset as u32),
                SiteKind::Distance32 { trailing: imm.len },
            );
        }
    }

    #[inline]
    fn legacy_direct(&mut self, encoding: Encoding, reg: u8, rm: u8, imm: Immediate) {
        let rex = encoding.wide() << 3
            | high_bit(reg) << 2
            | high_bit(rm)
            | byte_register_rex(encoding, Encoding::BYTE_REG, reg)
            | byte_register_rex(encoding, Encoding::BYTE_RM, rm);
        self.write(|cursor| {
            cursor.legacy_opcode(encoding, rex);
            cursor.modrm_direct(reg, rm);
            cursor.word(imm.value, imm.len);
        });
    }

    #[inline(always)]
    fn legacy_memory(&mut self, encoding: Encoding, reg: u8, address: Address, imm: Immediate) {
        if !encoding.is_plain() || address.base >= Address::NO_BASE {
            return self.any_legacy_memory(encoding, reg, address, imm);
        }
        if address.has_index() {
            self.plain_indexed(encoding, reg, address);
        } else if address.base == RBP {
            self.plain_in_frame(encoding, reg, address.offset);
        } else {
            self.plain_based(encoding, reg, address.base, address.offset);
        }
        if imm.len != 0 {
            (self.buffer).put_first(imm.value.to_le_bytes(), imm.len.into());
        }
    }

    // The most frequent forms fit in one write.

    /// `rest` has the `len` bytes that follow the opcode.
    #[inline(always)]
    fn put_plain(&mut self, encoding: Encoding, rex: u8, rest: u64, len: u32) {
        let bytes = rest << 16 | u64::from(encoding.opcode()) << 8 | u64::from(0x40 | rex);
        let has_no_rex = u32::from(rex == 0);
        (self.buffer).put_first(
            (bytes >> (8 * has_no_rex)).to_le_bytes(),
            2 + len - has_no_rex,
        );
    }

    fn plain_in_frame(&mut self, encoding: Encoding, reg: u8, offset: i32) {
        let (mode, offset_len) = if is_byte(offset) {
            (0x40, 1)
        } else {
            (0x80, 4)
        };
        let modrm = mode | (reg & 7) << 3 | RBP.0;
        let rest = u64::from(offset as u32) << 8 | u64::from(modrm);
        let rex = encoding.wide() << 3 | high_bit(reg) << 2;
        self.put_plain(encoding, rex, rest, 1 + offset_len);
    }

    fn plain_based(&mut self, encoding: Encoding, reg: u8, base: Gpr, offset: i32) {
        const ONLY_BASE: u8 = SIB << 3 | SIB;
        let rex = encoding.wide() << 3 | high_bit(reg) << 2 | high_bit(base.0);
        let base = base.0 & 7;
        let (mode, offset_len) = mode_and_offset_len(base, offset);
        let (modrm, mut rest) = (mode | (reg & 7) << 3 | base, u64::from(offset as u32));
        let has_sib = base == SIB;
        if has_sib {
            rest = rest << 8 | u64::from(ONLY_BASE);
        }
        let len = 1 + u32::from(has_sib) + u32::from(offset_len);
        self.put_plain(encoding, rex, rest << 8 | u64::from(modrm), len);
    }

    fn plain_indexed(&mut self, encoding: Encoding, reg: u8, address: Address) {
        let base = address.base.0 & 7;
        let (mode, offset_len) = mode_and_offset_len(base, address.offset);
        let modrm = mode | (reg & 7) << 3 | SIB;
        let sib = address.scale.log2() << 6 | (address.index.0 & 7) << 3 | base;
        let rest = u64::from(address.offset as u32) << 16 | u64::from(sib) << 8 | u64::from(modrm);
        let rex = encoding.wide() << 3 | extension_bits(reg, address);
        self.put_plain(encoding, rex, rest, 2 + u32::from(offset_len));
    }

    fn any_legacy_memory(&mut self, encoding: Encoding, reg: u8, address: Address, imm: Immediate) {
        let rex = encoding.wide() << 3
            | extension_bits(reg, address)
            | byte_register_rex(encoding, Encoding::BYTE_REG, reg);
        self.write(|cursor| {
            cursor.legacy_opcode(encoding, rex);
            cursor.modrm_memory(reg, address);
            cursor.word(imm.value, imm.len);
        });
        self.note_label_operand(address, imm);
    }

    #[inline(always)]
    fn legacy(&mut self, encoding: Encoding, reg: u8, rm: Rm<u8>, imm: Immediate) {
        match rm {
            Rm::Reg(rm) => self.legacy_direct(encoding, reg, rm, imm),
            Rm::Mem(address) => self.legacy_memory(encoding, reg, address, imm),
        }
    }

    #[inline]
    fn vex_direct(&mut self, encoding: Encoding, reg: u8, vvvv: u8, rm: u8, imm: Immediate) {
        self.write(|cursor| {
            cursor.vex_opcode(encoding, high_bit(reg) << 2 | high_bit(rm), vvvv);
            cursor.modrm_direct(reg, rm);
            cursor.word(imm.value, imm.len);
        });
    }

    fn vex_memory(
        &mut self,
        encoding: Encoding,
        reg: u8,
        vvvv: u8,
        address: Address,
        imm: Immediate,
    ) {
        self.write(|cursor| {
            cursor.vex_opcode(encoding, extension_bits(reg, address), vvvv);
            cursor.modrm_memory(reg, address);
            cursor.word(imm.value, imm.len);
        });
        self.note_label_operand(address, imm);
    }

    #[inline(always)]
    fn vex(&mut self, encoding: Encoding, reg: u8, vvvv: u8, rm: Rm<u8>, imm: Immediate) {
        let vvvv = vvvv | self.long_bit();
        match rm {
            Rm::Reg(rm) => self.vex_direct(encoding, reg, vvvv, rm, imm),
            Rm::Mem(address) => self.vex_memory(encoding, reg, vvvv, address, imm),
        }
    }

    #[inline(always)]
    fn sse_two(&mut self, encoding: Encoding, reg: u8, rm: Rm<u8>, imm: Immediate) {
        if self.has(X64Features::AVX) {
            self.vex(encoding, reg, 0, rm, imm);
        } else {
            self.legacy(encoding, reg, rm, imm);
        }
    }

    #[inline(always)]
    fn sse_three(&mut self, encoding: Encoding, dst: Fpr, lhs: Fpr, rm: Rm<u8>, imm: Immediate) {
        if self.has(X64Features::AVX) {
            self.vex(encoding, dst.0, lhs.0, rm, imm);
        } else {
            assert!(
                dst == lhs,
                "without AVX the destination is the first source"
            );
            self.legacy(encoding, dst.0, rm, imm);
        }
    }

    /// For the forms that add the register number to the opcode.
    #[inline(always)]
    fn register_in_opcode(&mut self, encoding: Encoding, reg: Gpr, imm: Immediate) {
        self.write(|cursor| {
            cursor.legacy_opcode(
                Encoding(encoding.0 + u16::from(reg.0 & 7)),
                encoding.wide() << 3 | high_bit(reg.0),
            );
            cursor.word(imm.value, imm.len);
        });
    }

    // Moves

    #[inline]
    pub fn mov(&mut self, width: Width, dst: Gpr, src: impl Into<GprMem>) {
        self.legacy(
            wide(width, 0x8b),
            dst.0,
            src.into().untyped(),
            Immediate::NONE,
        );
    }

    #[inline]
    pub fn mov_store(&mut self, size: Size, dst: Address, src: Gpr) {
        self.legacy_memory(sized(size, 0x88), src.0, dst, Immediate::NONE);
    }

    #[inline]
    pub fn mov_store_imm(&mut self, size: Size, dst: Address, imm: i32) {
        self.legacy_memory(sized_group(size, 0xc6), 0, dst, Immediate::sized(size, imm));
    }

    /// The shortest form that leaves the flags alone.
    #[inline]
    pub fn mov_imm(&mut self, dst: Gpr, imm: i64) {
        if let Ok(imm) = u32::try_from(imm) {
            self.register_in_opcode(Encoding(0xb8), dst, Immediate::sized(Size::S32, imm as i32));
        } else if let Ok(imm) = i32::try_from(imm) {
            self.legacy_direct(
                wide(Width::W64, 0xc7),
                0,
                dst.0,
                Immediate::sized(Size::S32, imm),
            );
        } else {
            self.movabs(dst, imm as u64);
        }
    }

    /// The constant is the last 8 bytes.
    pub fn movabs(&mut self, dst: Gpr, imm: u64) {
        self.buffer.put([0x48 | high_bit(dst.0), 0xb8 | dst.0 & 7]);
        self.buffer.put(imm.to_le_bytes());
    }

    /// From 8 or 16 bits.
    #[inline]
    pub fn movzx(&mut self, from: Size, dst: Gpr, src: impl Into<GprMem>) {
        let opcode = match from {
            Size::S8 => 0xb6 | Encoding::BYTE_RM,
            Size::S16 => 0xb7,
            Size::S32 | Size::S64 => unreachable!("mov extends these"),
        };
        self.legacy(
            Encoding(Encoding::MAP_0F | opcode),
            dst.0,
            src.into().untyped(),
            Immediate::NONE,
        );
    }

    #[inline]
    pub fn movsx(&mut self, from: Size, to: Width, dst: Gpr, src: impl Into<GprMem>) {
        let opcode = match (from, to) {
            (Size::S8, _) => Encoding::MAP_0F | 0xbe | Encoding::BYTE_RM,
            (Size::S16, _) => Encoding::MAP_0F | 0xbf,
            (Size::S32, Width::W64) => 0x63,
            _ => unreachable!("nothing to extend"),
        };
        self.legacy(
            wide(to, opcode),
            dst.0,
            src.into().untyped(),
            Immediate::NONE,
        );
    }

    #[inline]
    pub fn lea(&mut self, width: Width, dst: Gpr, address: Address) {
        self.legacy_memory(wide(width, 0x8d), dst.0, address, Immediate::NONE);
    }

    #[inline]
    pub fn cmov(&mut self, cc: Cc, width: Width, dst: Gpr, src: impl Into<GprMem>) {
        self.legacy(
            wide(width, Encoding::MAP_0F | 0x40 | cc as u16),
            dst.0,
            src.into().untyped(),
            Immediate::NONE,
        );
    }

    /// Writes the low byte only.
    #[inline]
    pub fn setcc(&mut self, cc: Cc, dst: Gpr) {
        let encoding = Encoding(Encoding::MAP_0F | 0x90 | cc as u16 | Encoding::BYTE_RM);
        self.legacy_direct(encoding, 0, dst.0, Immediate::NONE);
    }

    /// Atomic when an operand is in memory.
    #[inline]
    pub fn xchg(&mut self, size: Size, a: impl Into<GprMem>, b: Gpr) {
        self.legacy(sized(size, 0x86), b.0, a.into().untyped(), Immediate::NONE);
    }

    #[inline]
    pub fn push(&mut self, src: Gpr) {
        self.register_in_opcode(Encoding(0x50), src, Immediate::NONE);
    }

    #[inline]
    pub fn pop(&mut self, dst: Gpr) {
        self.register_in_opcode(Encoding(0x58), dst, Immediate::NONE);
    }

    pub fn push_mem(&mut self, src: Address) {
        self.legacy_memory(Encoding(0xff), 6, src, Immediate::NONE);
    }

    /// An address based on rsp is computed after rsp has moved.
    pub fn pop_mem(&mut self, dst: Address) {
        self.legacy_memory(Encoding(0x8f), 0, dst, Immediate::NONE);
    }

    pub fn push_imm(&mut self, imm: i32) {
        self.write(|cursor| {
            let short = is_byte(imm);
            cursor.byte(if short { 0x6a } else { 0x68 });
            cursor.word(imm, if short { 1 } else { 4 });
        });
    }

    // Integers

    #[inline]
    pub fn alu(&mut self, op: Alu, size: Size, dst: Gpr, src: impl Into<GprMem>) {
        self.legacy(
            sized(size, (op as u16) << 3 | 2),
            dst.0,
            src.into().untyped(),
            Immediate::NONE,
        );
    }

    #[inline]
    pub fn alu_mem(&mut self, op: Alu, size: Size, dst: Address, src: Gpr) {
        self.legacy_memory(sized(size, (op as u16) << 3), src.0, dst, Immediate::NONE);
    }

    /// Uses as much of `imm` as `size` says.
    #[inline]
    pub fn alu_imm(&mut self, op: Alu, size: Size, dst: impl Into<GprMem>, imm: i32) {
        let dst = dst.into();
        let imm = if size == Size::S16 {
            i32::from(imm as i16)
        } else {
            imm
        };
        if size != Size::S8 && is_byte(imm) {
            self.legacy(
                sized_group(size, 0x82),
                op as u8,
                dst.untyped(),
                Immediate::byte(imm as u8),
            );
        } else if dst == Rm::Reg(RAX) {
            self.accumulator(
                sized_group(size, (op as u16) << 3 | 4),
                Immediate::sized(size, imm),
            );
        } else {
            self.legacy(
                sized_group(size, 0x80),
                op as u8,
                dst.untyped(),
                Immediate::sized(size, imm),
            );
        }
    }

    fn accumulator(&mut self, encoding: Encoding, imm: Immediate) {
        self.write(|cursor| {
            cursor.legacy_opcode(encoding, encoding.wide() << 3);
            cursor.word(imm.value, imm.len);
        });
    }

    #[inline]
    pub fn test(&mut self, size: Size, lhs: impl Into<GprMem>, rhs: Gpr) {
        self.legacy(
            sized(size, 0x84),
            rhs.0,
            lhs.into().untyped(),
            Immediate::NONE,
        );
    }

    #[inline]
    pub fn test_imm(&mut self, size: Size, lhs: impl Into<GprMem>, imm: i32) {
        let lhs = lhs.into();
        if lhs == Rm::Reg(RAX) {
            self.accumulator(sized_group(size, 0xa8), Immediate::sized(size, imm));
        } else {
            self.legacy(
                sized_group(size, 0xf6),
                0,
                lhs.untyped(),
                Immediate::sized(size, imm),
            );
        }
    }

    #[inline]
    pub fn unary(&mut self, op: Unary, size: Size, operand: impl Into<GprMem>) {
        self.legacy(
            sized_group(size, 0xf6),
            op as u8,
            operand.into().untyped(),
            Immediate::NONE,
        );
    }

    #[inline]
    pub fn imul(&mut self, width: Width, dst: Gpr, src: impl Into<GprMem>) {
        self.legacy(
            wide(width, Encoding::MAP_0F | 0xaf),
            dst.0,
            src.into().untyped(),
            Immediate::NONE,
        );
    }

    #[inline]
    pub fn imul_imm(&mut self, width: Width, dst: Gpr, src: impl Into<GprMem>, imm: i32) {
        let src = src.into().untyped();
        if is_byte(imm) {
            self.legacy(wide(width, 0x6b), dst.0, src, Immediate::byte(imm as u8));
        } else {
            self.legacy(
                wide(width, 0x69),
                dst.0,
                src,
                Immediate::sized(Size::S32, imm),
            );
        }
    }

    #[inline]
    pub fn shift_imm(&mut self, op: ShiftOp, size: Size, dst: impl Into<GprMem>, amount: u8) {
        let dst = dst.into().untyped();
        if amount == 1 {
            self.legacy(sized_group(size, 0xd0), op as u8, dst, Immediate::NONE);
        } else {
            self.legacy(
                sized_group(size, 0xc0),
                op as u8,
                dst,
                Immediate::byte(amount),
            );
        }
    }

    #[inline]
    pub fn shift_cl(&mut self, op: ShiftOp, size: Size, dst: impl Into<GprMem>) {
        self.legacy(
            sized_group(size, 0xd2),
            op as u8,
            dst.into().untyped(),
            Immediate::NONE,
        );
    }

    /// Shifts `dst` right and fills it from the low bits of `src`.
    pub fn shrd_imm(&mut self, width: Width, dst: Gpr, src: Gpr, amount: u8) {
        self.legacy_direct(
            wide(width, Encoding::MAP_0F | 0xac),
            src.0,
            dst.0,
            Immediate::byte(amount),
        );
    }

    #[inline]
    pub fn shiftx(
        &mut self,
        op: ShiftX,
        width: Width,
        dst: Gpr,
        src: impl Into<GprMem>,
        amount: Gpr,
    ) {
        debug_assert!(self.has(X64Features::BMI2));
        self.vex(
            wide(width, op as u16),
            dst.0,
            amount.0,
            src.into().untyped(),
            Immediate::NONE,
        );
    }

    pub fn rorx(&mut self, width: Width, dst: Gpr, src: impl Into<GprMem>, amount: u8) {
        debug_assert!(self.has(X64Features::BMI2));
        let encoding = wide(width, Encoding::PREFIX_F2 | Encoding::MAP_3A | 0xf0);
        self.vex(
            encoding,
            dst.0,
            0,
            src.into().untyped(),
            Immediate::byte(amount),
        );
    }

    /// `dst = !lhs & rhs`.
    pub fn andn(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<GprMem>) {
        debug_assert!(self.has(X64Features::BMI1));
        self.vex(
            wide(width, Encoding::MAP_38 | 0xf2),
            dst.0,
            lhs.0,
            rhs.into().untyped(),
            Immediate::NONE,
        );
    }

    #[inline]
    pub fn bit_count(&mut self, op: BitCount, width: Width, dst: Gpr, src: impl Into<GprMem>) {
        debug_assert!(op != BitCount::Lzcnt || self.has(X64Features::LZCNT));
        debug_assert!(op != BitCount::Tzcnt || self.has(X64Features::BMI1));
        self.legacy(
            wide(width, op as u16),
            dst.0,
            src.into().untyped(),
            Immediate::NONE,
        );
    }

    /// Copies the bit to the carry flag.
    pub fn bt(&mut self, width: Width, value: Gpr, bit: Gpr) {
        self.legacy_direct(
            wide(width, Encoding::MAP_0F | 0xa3),
            bit.0,
            value.0,
            Immediate::NONE,
        );
    }

    pub fn bit_test_imm(&mut self, op: BitTest, width: Width, value: impl Into<GprMem>, bit: u8) {
        self.legacy(
            wide(width, Encoding::MAP_0F | 0xba),
            op as u8,
            value.into().untyped(),
            Immediate::byte(bit),
        );
    }

    pub fn bswap(&mut self, width: Width, reg: Gpr) {
        self.register_in_opcode(wide(width, Encoding::MAP_0F | 0xc8), reg, Immediate::NONE);
    }

    /// Fills rdx with the sign of rax: `cdq` or `cqo`.
    pub fn extend_sign_into_rdx(&mut self, width: Width) {
        self.accumulator(wide(width, 0x99), Immediate::NONE);
    }

    /// Makes the next instruction atomic.
    pub fn lock(&mut self) {
        self.buffer.put([0xf0]);
    }

    pub fn xadd(&mut self, size: Size, dst: Address, src: Gpr) {
        self.legacy_memory(
            sized(size, Encoding::MAP_0F | 0xc0),
            src.0,
            dst,
            Immediate::NONE,
        );
    }

    pub fn cmpxchg(&mut self, size: Size, dst: Address, src: Gpr) {
        self.legacy_memory(
            sized(size, Encoding::MAP_0F | 0xb0),
            src.0,
            dst,
            Immediate::NONE,
        );
    }

    pub fn prefetcht0(&mut self, address: Address) {
        self.legacy_memory(
            Encoding(Encoding::MAP_0F | 0x18),
            1,
            address,
            Immediate::NONE,
        );
    }

    // Vector registers, in the VEX encoding where there is AVX

    #[inline]
    pub fn sse(&mut self, op: Sse, dst: Fpr, lhs: Fpr, rhs: impl Into<FprMem>) {
        self.sse_three(
            Encoding(op as u16),
            dst,
            lhs,
            rhs.into().untyped(),
            Immediate::NONE,
        );
    }

    #[inline]
    pub fn sse_imm(&mut self, op: SseImm, dst: Fpr, lhs: Fpr, rhs: impl Into<FprMem>, imm: u8) {
        self.sse_three(
            Encoding(op as u16),
            dst,
            lhs,
            rhs.into().untyped(),
            Immediate::byte(imm),
        );
    }

    #[inline]
    pub fn sse_unary(&mut self, op: SseUnary, dst: Fpr, src: impl Into<FprMem>) {
        self.sse_two(
            Encoding(op as u16),
            dst.0,
            src.into().untyped(),
            Immediate::NONE,
        );
    }

    #[inline]
    pub fn sse_unary_imm(&mut self, op: SseUnaryImm, dst: Fpr, src: impl Into<FprMem>, imm: u8) {
        self.sse_two(
            Encoding(op as u16),
            dst.0,
            src.into().untyped(),
            Immediate::byte(imm),
        );
    }

    pub fn avx_unary(&mut self, op: AvxUnary, dst: Fpr, src: impl Into<FprMem>) {
        debug_assert!(self.has(X64Features::AVX));
        self.vex(
            Encoding(op as u16),
            dst.0,
            0,
            src.into().untyped(),
            Immediate::NONE,
        );
    }

    /// Without AVX `src` is `dst`.
    pub fn sse_shift_imm(&mut self, op: SseShiftImm, dst: Fpr, src: Fpr, amount: u8) {
        let encoding = Encoding(Encoding::PREFIX_66 | Encoding::MAP_0F | op as u16 & 0xff);
        let extension = (op as u16 >> 8) as u8;
        if self.has(X64Features::AVX) {
            let vvvv = dst.0 | self.long_bit();
            self.vex_direct(encoding, extension, vvvv, src.0, Immediate::byte(amount));
        } else {
            assert!(dst == src, "without AVX the destination is the source");
            self.legacy_direct(encoding, extension, dst.0, Immediate::byte(amount));
        }
    }

    #[inline]
    pub fn sse_load(&mut self, op: SseLoad, dst: Fpr, src: Address) {
        self.sse_two(Encoding(op as u16), dst.0, Rm::Mem(src), Immediate::NONE);
    }

    #[inline]
    pub fn sse_store(&mut self, op: SseStore, dst: Address, src: Fpr) {
        self.sse_two(Encoding(op as u16), src.0, Rm::Mem(dst), Immediate::NONE);
    }

    pub fn sse_merge_load(&mut self, op: SseMergeLoad, dst: Fpr, lhs: Fpr, rhs: Address) {
        self.sse_three(Encoding(op as u16), dst, lhs, Rm::Mem(rhs), Immediate::NONE);
    }

    pub fn sse_merge(&mut self, op: SseMerge, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.sse_three(
            Encoding(op as u16),
            dst,
            lhs,
            Rm::Reg(rhs.0),
            Immediate::NONE,
        );
    }

    pub fn move_mask(&mut self, op: MoveMask, dst: Gpr, src: Fpr) {
        self.sse_two(Encoding(op as u16), dst.0, Rm::Reg(src.0), Immediate::NONE);
    }

    /// Lanes are from `rhs` where the sign bit of `mask` is set.
    pub fn blendv(&mut self, op: Blendv, dst: Fpr, lhs: Fpr, rhs: impl Into<FprMem>, mask: Fpr) {
        debug_assert!(self.has(X64Features::AVX));
        self.vex(
            Encoding(op as u16),
            dst.0,
            lhs.0,
            rhs.into().untyped(),
            Immediate::byte(mask.0 << 4),
        );
    }

    pub fn fma(&mut self, op: Fma, dst: Fpr, lhs: Fpr, rhs: impl Into<FprMem>) {
        debug_assert!(self.has(X64Features::FMA));
        self.vex(
            Encoding(op as u16),
            dst.0,
            lhs.0,
            rhs.into().untyped(),
            Immediate::NONE,
        );
    }

    /// `movd` or `movq`. Clears the rest of `dst`.
    #[inline]
    pub fn movd_to_xmm(&mut self, width: Width, dst: Fpr, src: impl Into<GprMem>) {
        let encoding = wide(width, Encoding::PREFIX_66 | Encoding::MAP_0F | 0x6e);
        self.sse_two(encoding, dst.0, src.into().untyped(), Immediate::NONE);
    }

    #[inline]
    pub fn movd_from_xmm(&mut self, width: Width, dst: impl Into<GprMem>, src: Fpr) {
        let encoding = wide(width, Encoding::PREFIX_66 | Encoding::MAP_0F | 0x7e);
        self.sse_two(encoding, src.0, dst.into().untyped(), Immediate::NONE);
    }

    /// `cvtsi2ss` or `cvtsi2sd`. The rest of `dst` is from `upper`.
    #[inline]
    pub fn cvtsi2s(
        &mut self,
        from: Width,
        to: FloatWidth,
        dst: Fpr,
        upper: Fpr,
        src: impl Into<GprMem>,
    ) {
        let encoding = wide(from, scalar_prefix(to) | Encoding::MAP_0F | 0x2a);
        self.sse_three(encoding, dst, upper, src.into().untyped(), Immediate::NONE);
    }

    /// `cvttss2si` or `cvttsd2si`. What does not fit gives the least integer.
    #[inline]
    pub fn cvtts2si(&mut self, from: FloatWidth, to: Width, dst: Gpr, src: impl Into<FprMem>) {
        let encoding = wide(to, scalar_prefix(from) | Encoding::MAP_0F | 0x2c);
        self.sse_two(encoding, dst.0, src.into().untyped(), Immediate::NONE);
    }

    pub fn vcvtps2ph(&mut self, dst: Fpr, src: Fpr, rounding: u8) {
        debug_assert!(self.has(X64Features::F16C));
        let encoding = Encoding(Encoding::PREFIX_66 | Encoding::MAP_3A | 0x1d);
        self.vex_direct(encoding, src.0, 0, dst.0, Immediate::byte(rounding));
    }

    pub fn pinsr(&mut self, lanes: Size, dst: Fpr, vector: Fpr, src: impl Into<GprMem>, lane: u8) {
        let opcode = match lanes {
            Size::S8 => Encoding::MAP_3A | 0x20,
            Size::S16 => Encoding::MAP_0F | 0xc4,
            Size::S32 => Encoding::MAP_3A | 0x22,
            Size::S64 => Encoding::MAP_3A | 0x22 | Encoding::WIDE,
        };
        self.sse_three(
            Encoding(Encoding::PREFIX_66 | opcode),
            dst,
            vector,
            src.into().untyped(),
            Immediate::byte(lane),
        );
    }

    /// Clears the rest of a register.
    pub fn pextr(&mut self, lanes: Size, dst: impl Into<GprMem>, vector: Fpr, lane: u8) {
        let dst = dst.into();
        if let (Size::S16, Rm::Reg(dst)) = (lanes, dst) {
            let shorter = Encoding(Encoding::PREFIX_66 | Encoding::MAP_0F | 0xc5);
            return self.sse_two(shorter, dst.0, Rm::Reg(vector.0), Immediate::byte(lane));
        }
        let opcode = match lanes {
            Size::S8 => 0x14,
            Size::S16 => 0x15,
            Size::S32 => 0x16,
            Size::S64 => 0x16 | Encoding::WIDE,
        };
        let encoding = Encoding(Encoding::PREFIX_66 | Encoding::MAP_3A | opcode);
        self.sse_two(encoding, vector.0, dst.untyped(), Immediate::byte(lane));
    }

    // Control

    #[inline]
    pub fn new_label(&mut self) -> Label {
        self.buffer.new_label()
    }

    #[inline]
    pub fn bind(&mut self, label: Label) {
        self.leave_replaceable_bytes();
        self.buffer.bind(label);
    }

    #[inline]
    pub(super) fn leave_replaceable_bytes(&mut self) {
        if self.buffer.len < self.buffer.replaceable_end {
            self.nops(self.buffer.replaceable_end - self.buffer.len);
        }
    }

    pub fn replaceable_point(&mut self) -> Label {
        if self.buffer.len + JUMP_SIZE != self.buffer.replaceable_end {
            self.leave_replaceable_bytes();
            self.buffer.replaceable_end = self.buffer.len + JUMP_SIZE;
        }
        self.buffer.mark()
    }

    /// The distance from the end of an instruction of `size` bytes that starts here.
    #[inline]
    fn distance_back(&self, target: u32, size: u32) -> i32 {
        target.wrapping_sub(self.buffer.len + size) as i32
    }

    #[inline(always)]
    fn jump_to<const N: usize>(&mut self, long: [u8; N], short: u8, kind: SiteKind, target: Label) {
        let with_distance = |distance: i32| {
            let mut bytes = [0; 8];
            bytes[..N].copy_from_slice(&long);
            bytes[N..N + 4].copy_from_slice(&distance.to_le_bytes());
            bytes
        };
        let state = self.buffer.state(target);
        if state.is_bound() {
            let distance = self.distance_back(state.offset, SHORT_JUMP_SIZE);
            if is_byte(distance) {
                if self.shorten_jumps && state.link as usize != self.buffer.sites.len() {
                    return self.jump_short(short, target);
                }
                return self.buffer.put([short, distance as u8]);
            }
            if !self.shorten_jumps {
                let distance = self.distance_back(state.offset, N as u32 + 4);
                return self.buffer.put_first(with_distance(distance), N as u32 + 4);
            }
        }
        let (skipped, kind) =
            if self.shorten_jumps && self.buffer.len >= self.buffer.replaceable_end {
                (0, kind)
            } else {
                (N as u32, SiteKind::Distance32 { trailing: 0 })
            };
        self.buffer
            .put_with_site(with_distance(0), N as u32 + 4, skipped, target, kind);
    }

    pub fn jmp(&mut self, target: Label) {
        self.jump_to([JUMP_OPCODE], SHORT_JUMP_OPCODE, SiteKind::Jump, target);
    }

    pub fn jcc(&mut self, cc: Cc, target: Label) {
        let cc = cc as u8;
        self.jump_to(
            [0x0f, 0x80 | cc],
            SHORT_CONDITIONAL_JUMP_OPCODE | cc,
            SiteKind::ConditionalJump,
            target,
        );
    }

    fn jump_short(&mut self, opcode: u8, target: Label) {
        self.buffer
            .put_with_site([opcode, 0], 2, 1, target, SiteKind::Distance8);
    }

    /// `target` is at most 127 bytes ahead.
    pub fn jmp_short(&mut self, target: Label) {
        self.jump_short(SHORT_JUMP_OPCODE, target);
    }

    /// `target` is at most 127 bytes ahead.
    pub fn jcc_short(&mut self, cc: Cc, target: Label) {
        self.jump_short(SHORT_CONDITIONAL_JUMP_OPCODE | cc as u8, target);
    }

    fn fixed_transfer(&mut self, opcode: u8, target: Label) {
        let kind = SiteKind::Distance32 { trailing: 0 };
        self.buffer
            .put_with_site(u64::from(opcode).to_le_bytes(), 5, 1, target, kind);
    }

    pub fn call(&mut self, target: Label) {
        self.leave_replaceable_bytes();
        self.fixed_transfer(0xe8, target);
    }

    /// One aligned store replaces the distance.
    pub(crate) fn patchable_transfer(&mut self, is_call: bool, target: Label) {
        self.pad(2, 1, 3);
        self.fixed_transfer(if is_call { 0xe8 } else { JUMP_OPCODE }, target);
    }

    #[inline]
    pub fn jmp_indirect(&mut self, target: impl Into<GprMem>) {
        self.legacy(Encoding(0xff), 4, target.into().untyped(), Immediate::NONE);
    }

    #[inline]
    pub fn call_indirect(&mut self, target: impl Into<GprMem>) {
        self.leave_replaceable_bytes();
        self.legacy(Encoding(0xff), 2, target.into().untyped(), Immediate::NONE);
    }

    pub fn ret(&mut self) {
        self.buffer.put([0xc3]);
    }

    pub fn leave(&mut self) {
        self.buffer.put([0xc9]);
    }

    pub fn int3(&mut self) {
        self.buffer.put([0xcc]);
    }

    pub fn ud2(&mut self) {
        self.buffer.put([0x0f, 0x0b]);
    }

    pub fn nops(&mut self, mut count: u32) {
        while count != 0 {
            let part = count.min(WINDOW as u32);
            fill_with_nops(&mut self.buffer.window()[..part as usize]);
            self.buffer.len += part;
            count -= part;
        }
    }

    /// Makes the offset plus `bias` a multiple of `1 << log2` if `max` bytes are enough.
    pub(crate) fn pad(&mut self, log2: u8, bias: u8, max: u8) {
        self.leave_replaceable_bytes();
        self.buffer.require_alignment(1 << log2);
        if self.shorten_jumps {
            self.buffer.record(
                self.buffer.len,
                Label(0),
                SiteKind::Padding { log2, bias, max },
            );
            self.nops(max.into());
        } else {
            self.nops(padding(self.buffer.len, log2, bias, max));
        }
    }

    /// Pads with up to `max` bytes if the code from here to `end` then touches fewer of the lines in which processors
    /// fetch instructions. Does nothing unless jumps are shortened.
    pub fn keep_together(&mut self, end: Label, max: u8) {
        if self.shorten_jumps {
            self.leave_replaceable_bytes();
            self.buffer.require_alignment(1 << LINE_SIZE_LOG2);
            let kind = SiteKind::PaddingOfStretch { max };
            self.buffer.record(self.buffer.len, end, kind);
            self.nops(max.into());
        }
    }

    /// An operand for 4, 8 or 16 bytes that are placed after the code at a multiple of their size.
    pub fn constant(&mut self, bits: u128, size: u8) -> Address {
        Address::at_label(self.buffer.constant(bits, size))
    }

    /// The label of a table of distances of 32 bits from itself to the targets.
    pub fn jump_table(&mut self, targets: &[Label]) -> Label {
        self.buffer.jump_table(targets)
    }

    /// `[offset]`, with the sign extended.
    pub fn absolute(offset: i32) -> Address {
        Address::new(Address::NO_BASE, offset)
    }

    /// `[index * scale + offset]`.
    pub fn without_base(index: Gpr, scale: Scale, offset: i32) -> Address {
        Address::indexed(Address::NO_BASE, index, scale, offset)
    }

    pub fn label_address(label: Label) -> Address {
        Address::at_label(label)
    }
}
