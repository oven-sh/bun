//! One method for each form of instruction. Operands are in the order of Arm's manual.

use super::opcode::{Barrier, Cc};
use super::registers::{LR, SP, ZR};
use crate::buffer::CodeBuffer;
use crate::features::Arm64Features;
use crate::label::{Code, Label};
use crate::operand::Width;
use crate::register::{Fpr, Gpr};

const MAX_CODE_SIZE: usize = super::patch::REACH;

pub(crate) const NOP: u32 = 0xd503_201f;

/// All but the last two are at an instruction whose distance has that many bits.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SiteKind {
    Branch26,
    Branch19,
    Branch14,
    Address21,
    /// A load of `size` bytes from a constant.
    Literal19 {
        size: u8,
    },
    /// The start of `size` bytes of padding. The label is not used.
    Padding {
        log2: u8,
        max: u8,
        size: u8,
    },
    TableEntry {
        table: Label,
    },
}

pub(crate) fn padding(offset: u32, log2: u8, max: u8) -> u32 {
    let needed = offset.wrapping_neg() & ((1 << log2) - 1);
    if needed > u32::from(max) { 0 } else { needed }
}

/// For a field in which 31 is the zero register.
#[inline(always)]
pub(super) fn gpr(reg: Gpr) -> u32 {
    debug_assert!(reg < SP || reg == ZR, "this operand cannot be sp");
    u32::from(reg.0 & 31)
}

/// For a field in which 31 is the stack pointer.
#[inline(always)]
pub(super) fn gpr_or_sp(reg: Gpr) -> u32 {
    debug_assert!(reg <= SP, "this operand cannot be the zero register");
    u32::from(reg.0 & 31)
}

#[inline(always)]
pub(super) fn fpr(reg: Fpr) -> u32 {
    u32::from(reg.0 & 31)
}

/// The bit that selects 64 bits.
#[inline(always)]
pub(super) const fn sf(width: Width) -> u32 {
    (width as u32) << 31
}

pub struct Assembler {
    pub(crate) buffer: CodeBuffer<SiteKind>,
    pub(crate) features: Arm64Features,
    /// By the index of an external target, the jump after the code that leads there.
    pub(super) routes: Vec<Option<Label>>,
    /// The latest instructions in a row that may still be taken back.
    pub(super) revocable: core::ops::Range<u32>,
}

impl Assembler {
    pub fn new(features: Arm64Features) -> Self {
        Self {
            buffer: CodeBuffer::new(MAX_CODE_SIZE),
            features,
            routes: Vec::new(),
            revocable: 0..0,
        }
    }

    pub(crate) fn restart(&mut self, features: Arm64Features, spent: Option<Code>) {
        self.buffer.restart(spent);
        self.features = features;
        self.routes.clear();
        self.revocable = 0..0;
    }

    #[inline]
    pub fn has(&self, features: Arm64Features) -> bool {
        self.features.contains(features)
    }

    #[inline(always)]
    pub(super) fn emit(&mut self, word: u32) {
        self.buffer.put(word.to_le_bytes());
    }

    #[inline(always)]
    fn emit_with_target(&mut self, word: u32, target: Label, kind: SiteKind) {
        self.buffer
            .put_with_site(word.to_le_bytes(), 4, 0, target, kind);
    }

    fn emit_short_branch(&mut self, word: u32, target: Label, kind: SiteKind) {
        if target.is_external() {
            return self.emit_branch_to_route(word, target, kind);
        }
        self.emit_with_target(word, target, kind);
    }

    #[cold]
    #[inline(never)]
    fn emit_branch_to_route(&mut self, word: u32, external: Label, kind: SiteKind) {
        let route = self.route_to(external);
        self.emit_with_target(word, route, kind);
    }

    pub(super) fn route_to(&mut self, external: Label) -> Label {
        let index = self.buffer.state(external).link as usize;
        if index >= self.routes.len() {
            self.routes.resize(index + 1, None);
        }
        *self.routes[index].get_or_insert_with(|| self.buffer.new_label())
    }

    #[inline]
    pub fn new_label(&mut self) -> Label {
        self.buffer.new_label()
    }

    #[inline]
    pub fn bind(&mut self, label: Label) {
        self.leave_replaceable_bytes();
        self.keep_what_is_there();
        self.buffer.bind(label);
    }

    #[inline]
    pub(super) fn leave_replaceable_bytes(&mut self) {
        if self.buffer.len < self.buffer.replaceable_end {
            self.nop();
        }
    }

    pub fn replaceable_point(&mut self) -> Label {
        self.keep_what_is_there();
        self.buffer.replaceable_end = self.buffer.len + super::patch::REPLACEMENT_JUMP_SIZE as u32;
        self.buffer.mark()
    }

    /// Makes the offset a multiple of `1 << log2` if `max` bytes are enough.
    pub(crate) fn pad(&mut self, log2: u8, max: u8) {
        self.leave_replaceable_bytes();
        self.buffer.require_alignment(1 << log2);
        let size = padding(self.buffer.len, log2, max) as u8;
        self.buffer.record(
            self.buffer.len,
            Label(0),
            SiteKind::Padding { log2, max, size },
        );
        for _ in 0..size / 4 {
            self.nop();
        }
    }

    pub fn nop(&mut self) {
        self.emit(NOP);
    }

    pub fn b(&mut self, target: Label) {
        self.emit_with_target(0x1400_0000, target, SiteKind::Branch26);
    }

    pub fn bl(&mut self, target: Label) {
        self.emit_with_target(0x9400_0000, target, SiteKind::Branch26);
    }

    #[inline]
    pub fn b_cond(&mut self, cc: Cc, target: Label) {
        self.emit_short_branch(0x5400_0000 | cc as u32, target, SiteKind::Branch19);
    }

    #[inline]
    pub fn cbz(&mut self, width: Width, reg: Gpr, target: Label) {
        self.emit_short_branch(
            0x3400_0000 | sf(width) | gpr(reg),
            target,
            SiteKind::Branch19,
        );
    }

    #[inline]
    pub fn cbnz(&mut self, width: Width, reg: Gpr, target: Label) {
        self.emit_short_branch(
            0x3500_0000 | sf(width) | gpr(reg),
            target,
            SiteKind::Branch19,
        );
    }

    #[inline]
    fn test_bit_and_branch(&mut self, opcode: u32, reg: Gpr, bit: u8, target: Label) {
        assert!(bit < 64);
        let bit = u32::from(bit);
        self.emit_short_branch(
            opcode | (bit >> 5) << 31 | (bit & 31) << 19 | gpr(reg),
            target,
            SiteKind::Branch14,
        );
    }

    #[inline]
    pub fn tbz(&mut self, reg: Gpr, bit: u8, target: Label) {
        self.test_bit_and_branch(0x3600_0000, reg, bit, target);
    }

    #[inline]
    pub fn tbnz(&mut self, reg: Gpr, bit: u8, target: Label) {
        self.test_bit_and_branch(0x3700_0000, reg, bit, target);
    }

    pub fn br(&mut self, target: Gpr) {
        self.emit(0xd61f_0000 | gpr(target) << 5);
    }

    pub fn blr(&mut self, target: Gpr) {
        self.emit(0xd63f_0000 | gpr(target) << 5);
    }

    pub fn ret(&mut self) {
        self.emit(0xd65f_0000 | gpr(LR) << 5);
    }

    pub fn brk(&mut self, imm: u16) {
        self.emit(0xd420_0000 | u32::from(imm) << 5);
    }

    pub fn udf(&mut self, imm: u16) {
        self.emit(imm.into());
    }

    pub fn dmb(&mut self, barrier: Barrier) {
        self.emit(0xd503_30bf | (barrier as u32) << 8);
    }

    /// The label of words of 32 bits after the code, each the distance from it to a target.
    pub fn jump_table(&mut self, targets: &[Label]) -> Label {
        self.buffer.jump_table(targets)
    }

    pub fn adr(&mut self, dst: Gpr, target: Label) {
        self.emit_with_target(0x1000_0000 | gpr(dst), target, SiteKind::Address21);
    }

    /// Loads the low 4, 8 or 16 bytes of `bits` from after the code.
    pub fn ldr_fpr_constant(&mut self, dst: Fpr, bits: u128, size: u8) {
        let opcode = match size {
            4 => 0x1c00_0000,
            8 => 0x5c00_0000,
            16 => 0x9c00_0000,
            _ => unreachable!("no such size"),
        };
        let constant = self.buffer.constant(bits, size);
        self.emit_with_target(opcode | fpr(dst), constant, SiteKind::Literal19 { size });
    }
}
