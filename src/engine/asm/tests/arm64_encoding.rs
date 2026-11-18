#![allow(clippy::disallowed_types)]

mod support;

use std::collections::HashSet;

use bun_engine_asm::arm64::*;
use bun_engine_asm::{Arm64Features, FloatWidth, Fpr, Gpr, Rounding, Sign, Size, Width};

const WIDTHS: [Width; 2] = [Width::W32, Width::W64];
const SIZES: [Size; 4] = [Size::S8, Size::S16, Size::S32, Size::S64];
const SIGNS: [Sign; 2] = [Sign::Signed, Sign::Unsigned];
const FLOAT_WIDTHS: [FloatWidth; 2] = [FloatWidth::F32, FloatWidth::F64];
const ACCESS_SIZES: [AccessSize; 5] = [
    AccessSize::S8,
    AccessSize::S16,
    AccessSize::S32,
    AccessSize::S64,
    AccessSize::S128,
];

/// Every register in each operand, and every choice of operands with the number 31, which `last` names.
fn operands<const N: usize>(last: [Gpr; N]) -> Vec<[Gpr; N]> {
    let usual: [Gpr; N] = std::array::from_fn(|index| [X3, X12, X21, X28][index]);
    let mut all = Vec::new();
    for position in 0..N {
        for number in 0..31 {
            let mut registers = usual;
            registers[position] = Gpr::new(number);
            all.push(registers);
        }
    }
    for choice in 1..1 << N {
        all.push(std::array::from_fn(|index| {
            [usual, last][choice >> index & 1][index]
        }));
    }
    all
}

fn float_operands<const N: usize>() -> Vec<[Fpr; N]> {
    let number = |reg: Gpr| Fpr::new(reg.number());
    operands([SP; N])
        .into_iter()
        .map(|registers| registers.map(number))
        .collect()
}

fn name(reg: Gpr, width: Width) -> String {
    let prefix = ["w", "x"][width as usize];
    match reg {
        ZR => format!("{prefix}zr"),
        SP => ["wsp", "sp"][width as usize].into(),
        _ => format!("{prefix}{}", reg.number()),
    }
}

fn x(reg: Gpr) -> String {
    name(reg, Width::W64)
}

fn w(reg: Gpr) -> String {
    name(reg, Width::W32)
}

fn names<const N: usize>(registers: [Gpr; N], width: Width) -> String {
    registers.map(|reg| name(reg, width)).join(", ")
}

fn part(reg: Fpr, size: impl Into<AccessSize>) -> String {
    let prefix = ["b", "h", "s", "d", "q"][size.into() as usize];
    format!("{prefix}{}", reg.number())
}

fn parts<const N: usize>(registers: [Fpr; N], width: FloatWidth) -> String {
    registers.map(|reg| part(reg, width)).join(", ")
}

fn lower(op: impl std::fmt::Debug) -> String {
    format!("{op:?}").to_lowercase()
}

fn suffix(size: Size) -> &'static str {
    ["b", "h", "", ""][size as usize]
}

fn all_flags() -> impl Iterator<Item = Nzcv> {
    (0..16).map(Nzcv::from_bits_retain)
}

struct Listing {
    asm: Assembler,
    expected: Vec<String>,
}

impl Listing {
    fn new() -> Self {
        Self {
            asm: Assembler::new(Arm64Features::all()),
            expected: Vec::new(),
        }
    }

    fn add(&mut self, expected: String, emit: impl FnOnce(&mut Assembler)) {
        emit(&mut self.asm);
        self.expected.push(expected);
    }

    fn check(self) {
        let code = self.asm.finish().unwrap();
        let bytes = &code.bytes()[..code.instructions_end() as usize];
        support::assert_arm64_assembly(bytes, &self.expected);
    }
}

#[test]
fn addition_and_subtraction() {
    let mut listing = Listing::new();
    for width in WIDTHS {
        for &op in AddSub::ALL {
            let text = lower(op);
            let last = if op.sets_flags() { ZR } else { SP };
            for [d, n] in operands([last, SP]) {
                let imm = ArithmeticImm::new(0x5a5).unwrap();
                listing.add(format!("{text} {}, #0x5a5", names([d, n], width)), |a| {
                    a.add_sub_imm(op, width, d, n, imm)
                });
            }
            for imm12 in 0..4096 {
                let operands = names([X1, X2], width);
                let imm = ArithmeticImm::new(imm12).unwrap();
                listing.add(format!("{text} {operands}, #{imm12}"), |a| {
                    a.add_sub_imm(op, width, X1, X2, imm)
                });
                if imm12 != 0 {
                    let imm = ArithmeticImm::new(imm12 << 12).unwrap();
                    listing.add(format!("{text} {operands}, #{imm12}, lsl #12"), |a| {
                        a.add_sub_imm(op, width, X1, X2, imm)
                    });
                }
            }
            for [d, n, m] in operands([ZR; 3]) {
                listing.add(format!("{text} {}", names([d, n, m], width)), |a| {
                    a.add_sub(op, width, d, n, m)
                });
            }
            for &shift in &ShiftOp::ALL[..3] {
                for amount in 0..width.bits() {
                    let operands = names([X1, ZR, X3], width);
                    listing.add(
                        format!("{text} {operands}, {} #{amount}", lower(shift)),
                        |a| a.add_sub_shifted(op, width, X1, ZR, X3, shift, amount),
                    );
                }
            }
            for &extend in Extend::ALL {
                let reads_all = matches!(extend, Extend::Uxtx | Extend::Sxtx);
                let source = if reads_all { width } else { Width::W32 };
                for (index, [d, n, m]) in operands([last, SP, ZR]).into_iter().enumerate() {
                    let amount = (index % 5) as u8;
                    let operands = format!("{}, {}", names([d, n], width), name(m, source));
                    listing.add(
                        format!("{text} {operands}, {} #{amount}", lower(extend)),
                        |a| a.add_sub_extended(op, width, d, n, m, extend, amount),
                    );
                }
            }
        }
        for &op in WithCarry::ALL {
            for [d, n, m] in operands([ZR; 3]) {
                listing.add(format!("{} {}", lower(op), names([d, n, m], width)), |a| {
                    a.with_carry(op, width, d, n, m)
                });
            }
        }
    }
    listing.check();
}

#[test]
fn arithmetic_immediates_are_twelve_bits() {
    let fits = |value: u64| value < 4096 || value.is_multiple_of(4096) && value < 1 << 24;
    let shifted = (0..64).flat_map(|shift| [1, 3, 0xfff, 0x1001].map(|bits: u64| bits << shift));
    for value in (0..1 << 16).chain(shifted).chain([u64::MAX]) {
        assert_eq!(ArithmeticImm::new(value).is_some(), fits(value), "{value}");
    }
    let five = ArithmeticImm::new(5).unwrap();
    for (&op, opposite) in AddSub::ALL.iter().zip(AddSub::ALL.iter().cycle().skip(2)) {
        assert_eq!(op.with_constant(Width::W64, 5), Some((op, five)));
        assert_eq!(op.with_constant(Width::W64, -5), Some((*opposite, five)));
        assert_eq!(op.with_constant(Width::W64, 0xffff_fffb), None);
        assert_eq!(op.with_constant(Width::W64, i64::MIN), None);
        let low_half = op.with_constant(Width::W32, 0xffff_fffb);
        assert_eq!(low_half, Some((*opposite, five)));
    }
    assert_eq!(ArithmeticImm::new(0), Some(ArithmeticImm::ZERO));
    assert_eq!(ArithmeticImm::new(1), Some(ArithmeticImm::ONE));
}

/// From the definition in the manual.
fn bitmasks(width: Width) -> Vec<u64> {
    let mut all = Vec::new();
    for period in [2, 4, 8, 16, 32, 64] {
        if period > u32::from(width.bits()) {
            continue;
        }
        for ones in 1..period {
            for rotation in 0..period {
                let is_set = |bit: u32| (bit + rotation) % period < ones;
                let bits = (0..width.bits().into()).filter(|&bit| is_set(bit));
                all.push(bits.fold(0, |value, bit| value | 1 << bit));
            }
        }
    }
    all
}

#[test]
fn every_bitmask() {
    let mut listing = Listing::new();
    for (width, count) in WIDTHS.into_iter().zip([1302, 5334]) {
        let all = bitmasks(width);
        assert_eq!(all.len(), count);
        for &op in &Logical::ALL[..4] {
            assert!(op.has_immediate_form());
            for &value in &all {
                let imm = BitmaskImm::new(width, value).unwrap();
                let operands = names([X1, X2], width);
                listing.add(format!("{} {operands}, #{value:#x}", lower(op)), |a| {
                    a.logical_imm(op, X1, X2, imm)
                });
            }
        }
    }
    listing.check();
}

#[test]
fn nothing_else_is_a_bitmask() {
    for width in WIDTHS {
        let all = bitmasks(width);
        let known: HashSet<u64> = all.iter().copied().collect();
        let used_bits = u64::MAX >> (64 - width.bits());
        let check = |value: u64| {
            assert_eq!(
                BitmaskImm::new(width, value).is_some(),
                known.contains(&(value & used_bits)),
                "{value:#x}"
            );
        };
        for (index, &value) in all.iter().enumerate() {
            for bit in 0..64 {
                check(value ^ 1 << bit);
            }
            let other = all[index * 37 % all.len()];
            check(value ^ other);
            check(value & other);
            check(value | other);
            check(value.wrapping_add(other));
        }
        for part in 0..=0xffff {
            for factor in [1, 0x1_0001, 0x1_0000_0001, 0x1_0001_0001_0001] {
                check(part * factor);
            }
            check(!part);
        }
    }
}

#[test]
fn logical_operations() {
    let mut listing = Listing::new();
    for width in WIDTHS {
        for &op in Logical::ALL {
            let text = lower(op);
            for [d, n, m] in operands([ZR; 3]) {
                listing.add(format!("{text} {}", names([d, n, m], width)), |a| {
                    a.logical(op, width, d, n, m)
                });
            }
            for &shift in ShiftOp::ALL {
                for amount in 0..width.bits() {
                    let operands = names([X1, X2, X3], width);
                    listing.add(
                        format!("{text} {operands}, {} #{amount}", lower(shift)),
                        |a| a.logical_shifted(op, width, X1, X2, X3, shift, amount),
                    );
                }
            }
            if op.has_immediate_form() {
                let imm = BitmaskImm::new(width, 0xff0).unwrap();
                for [d, n] in operands([if op == Logical::Ands { ZR } else { SP }, ZR]) {
                    listing.add(format!("{text} {}, #0xff0", names([d, n], width)), |a| {
                        a.logical_imm(op, d, n, imm)
                    });
                }
            }
        }
        for &op in MoveWide::ALL {
            for shift in (0..width.bits()).step_by(16) {
                for [d] in operands([ZR]) {
                    for imm in [0, 1, 0x1234, 0x8000, 0xffff] {
                        let operands = format!("{}, #{imm}, lsl #{shift}", name(d, width));
                        listing.add(format!("{} {operands}", lower(op)), |a| {
                            a.move_wide(op, width, d, imm, shift)
                        });
                    }
                }
            }
        }
    }
    listing.check();
}

#[test]
fn bit_fields_and_shifts() {
    let mut listing = Listing::new();
    for width in WIDTHS {
        let bits = width.bits();
        let pair = names([X1, X2], width);
        let aliases = [("sbfx", "sbfiz"), ("bfxil", "bfi"), ("ubfx", "ubfiz")];
        for (&op, (extract, insert)) in Bitfield::ALL.iter().zip(aliases) {
            let text = lower(op);
            for [d, n] in operands([ZR; 2]) {
                listing.add(format!("{text} {}, #3, #9", names([d, n], width)), |a| {
                    a.bitfield(op, width, d, n, 3, 9)
                });
            }
            for first in 0..bits {
                for second in 0..bits {
                    listing.add(format!("{text} {pair}, #{first}, #{second}"), |a| {
                        a.bitfield(op, width, X1, X2, first, second)
                    });
                }
                for count in 1..=bits - first {
                    listing.add(format!("{extract} {pair}, #{first}, #{count}"), |a| {
                        a.bitfield_extract(op, width, X1, X2, first, count)
                    });
                    listing.add(format!("{insert} {pair}, #{first}, #{count}"), |a| {
                        a.bitfield_insert(op, width, X1, X2, first, count)
                    });
                }
            }
        }
        for [d, n, m] in operands([ZR; 3]) {
            listing.add(format!("extr {}, #7", names([d, n, m], width)), |a| {
                a.extr(width, d, n, m, 7)
            });
        }
        for amount in 0..bits {
            let operands = names([X1, X2, X3], width);
            listing.add(format!("extr {operands}, #{amount}"), |a| {
                a.extr(width, X1, X2, X3, amount)
            });
        }
        for &op in ShiftOp::ALL {
            let text = lower(op);
            for amount in 0..bits {
                listing.add(format!("{text} {pair}, #{amount}"), |a| {
                    a.shift_imm(op, width, X1, X2, amount)
                });
            }
            for [d, n, m] in operands([ZR; 3]) {
                listing.add(format!("{text}v {}", names([d, n, m], width)), |a| {
                    a.shift(op, width, d, n, m)
                });
            }
        }
        for &op in Unary::ALL {
            if op == Unary::Rev32 && width == Width::W32 {
                continue;
            }
            for [d, n] in operands([ZR; 2]) {
                listing.add(format!("{} {}", lower(op), names([d, n], width)), |a| {
                    a.unary(op, width, d, n)
                });
            }
        }
    }
    listing.check();
}

#[test]
fn multiplication_and_division() {
    let mut listing = Listing::new();
    for [d, n, m, a] in operands([ZR; 4]) {
        for width in WIDTHS {
            for &op in MultiplyAdd::ALL {
                let operands = names([d, n, m, a], width);
                listing.add(format!("{} {operands}", lower(op)), |asm| {
                    asm.multiply_add(op, width, d, n, m, a)
                });
            }
        }
        for &op in MultiplyAddLong::ALL {
            let operands = [x(d), w(n), w(m), x(a)].join(", ");
            listing.add(format!("{} {operands}", lower(op)), |asm| {
                asm.multiply_add_long(op, d, n, m, a)
            });
        }
    }
    for [d, n, m] in operands([ZR; 3]) {
        for (sign, prefix) in SIGNS.into_iter().zip(["s", "u"]) {
            let operands = names([d, n, m], Width::W64);
            listing.add(format!("{prefix}mulh {operands}"), |a| {
                a.multiply_high(sign, d, n, m)
            });
            for width in WIDTHS {
                listing.add(format!("{prefix}div {}", names([d, n, m], width)), |a| {
                    a.div(sign, width, d, n, m)
                });
            }
        }
    }
    listing.check();
}

#[test]
fn conditional_operations() {
    let mut listing = Listing::new();
    for width in WIDTHS {
        for &op in Select::ALL {
            let text = lower(op);
            for [d, n, m] in operands([ZR; 3]) {
                listing.add(format!("{text} {}, hi", names([d, n, m], width)), |a| {
                    a.select(op, width, d, n, m, Cc::Hi)
                });
            }
            for cc in Cc::ALL {
                let operands = names([X1, X2, X3], width);
                listing.add(format!("{text} {operands}, {}", lower(cc)), |a| {
                    a.select(op, width, X1, X2, X3, cc)
                });
            }
        }
        for &op in ConditionalCompare::ALL {
            let text = lower(op);
            for [n, m] in operands([ZR; 2]) {
                listing.add(format!("{text} {}, #4, lt", names([n, m], width)), |a| {
                    a.compare_if(op, width, n, m, Nzcv::Z, Cc::Lt)
                });
                listing.add(format!("{text} {}, #5, #9, lt", name(n, width)), |a| {
                    a.compare_imm_if(op, width, n, 5, Nzcv::N | Nzcv::V, Cc::Lt)
                });
            }
            for cc in Cc::ALL {
                for flags in all_flags() {
                    let rest = format!("#{}, {}", flags.bits(), lower(cc));
                    listing.add(format!("{text} {}, {rest}", names([X1, X2], width)), |a| {
                        a.compare_if(op, width, X1, X2, flags, cc)
                    });
                    listing.add(format!("{text} {}, #31, {rest}", name(X1, width)), |a| {
                        a.compare_imm_if(op, width, X1, 31, flags, cc)
                    });
                }
            }
            for imm in 0..32 {
                listing.add(format!("{text} {}, #{imm}, #2, eq", name(X1, width)), |a| {
                    a.compare_imm_if(op, width, X1, imm, Nzcv::C, Cc::Eq)
                });
            }
        }
    }
    listing.check();
}

#[test]
fn aliases() {
    let mut listing = Listing::new();
    let short = ArithmeticImm::new(9).unwrap();
    for width in WIDTHS {
        for [a, b] in operands([ZR; 2]) {
            let pair = names([a, b], width);
            listing.add(format!("mov {pair}"), |asm| asm.mov(width, a, b));
            listing.add(format!("mvn {pair}"), |asm| asm.mvn(width, a, b));
            listing.add(format!("neg {pair}"), |asm| asm.neg(width, a, b));
            listing.add(format!("cmp {pair}"), |asm| asm.cmp(width, a, b));
            listing.add(format!("tst {pair}"), |asm| asm.tst(width, a, b));
        }
        for [d, n, m] in operands([ZR; 3]) {
            listing.add(format!("mul {}", names([d, n, m], width)), |a| {
                a.mul(width, d, n, m)
            });
        }
        for [n] in operands([SP]) {
            listing.add(format!("cmp {}, #9", name(n, width)), |a| {
                a.cmp_imm(width, n, short)
            });
            listing.add(format!("cmn {}, #9", name(n, width)), |a| {
                a.cmn_imm(width, n, short)
            });
        }
        for [n] in operands([ZR]) {
            listing.add(format!("tst {}, #6", name(n, width)), |a| {
                a.tst_imm(n, BitmaskImm::new(width, 6).unwrap())
            });
            for cc in Cc::ALL {
                listing.add(format!("cset {}, {}", w(n), lower(cc)), |a| a.cset(n, cc));
                listing.add(format!("csetm {}, {}", name(n, width), lower(cc)), |a| {
                    a.csetm(width, n, cc)
                });
            }
        }
    }
    for [d, n] in operands([SP; 2]) {
        listing.add(format!("add {}, {}, #0", x(d), x(n)), |a| a.mov_sp(d, n));
    }
    listing.check();
}

struct Form {
    mem: Mem,
    text: String,
    is_unscaled: bool,
    changed: Option<Gpr>,
}

/// Every offset with one base, and every base and index with one offset.
fn forms(size: AccessSize) -> Vec<Form> {
    let mut all = Vec::new();
    let bytes = 1 << size.log2_bytes();
    let mut add = |mem: Option<Mem>, text: String, is_unscaled, changed| {
        all.push(Form {
            mem: mem.unwrap(),
            text,
            is_unscaled,
            changed,
        });
    };
    let bases = operands([SP]).into_iter().map(|[base]| base);
    let scaled = (0..4096).map(|units| (X5, units * bytes));
    for (base, offset) in scaled.chain(bases.clone().map(|base| (base, 3 * bytes))) {
        let text = format!("[{}, #{offset}]", x(base));
        add(Mem::scaled(size, base, offset), text.clone(), false, None);
        add(Mem::offset(size, base, offset), text, false, None);
    }
    let unscaled = (-256..256).map(|offset| (X5, offset));
    for (base, offset) in unscaled.chain(bases.clone().map(|base| (base, -7))) {
        let text = format!("[{}, #{offset}]", x(base));
        add(Mem::unscaled(size, base, offset), text.clone(), true, None);
        let is_unscaled = offset < 0 || offset % bytes != 0;
        add(
            Mem::offset(size, base, offset),
            text.clone(),
            is_unscaled,
            None,
        );
        let pre_index = Mem::pre_index(size, base, offset);
        add(pre_index, format!("{text}!"), false, Some(base));
        let text = format!("[{}], #{offset}", x(base));
        add(Mem::post_index(size, base, offset), text, false, Some(base));
    }
    for base in bases {
        let text = format!("[{}]", x(base));
        add(Some(Mem::at(size, base)), text, false, None);
    }
    for [base, index] in operands([SP, ZR]) {
        for &extend in IndexExtend::ALL {
            for scaled in [false, true] {
                let operand = match (extend, scaled) {
                    (IndexExtend::Lsl, false) => x(index),
                    (IndexExtend::Lsl, true) => format!("{}, lsl", x(index)),
                    _ => format!("{}, {}", w(index), lower(extend)),
                };
                let amount = if scaled {
                    format!(" #{}", size.log2_bytes())
                } else {
                    String::new()
                };
                let mem = Mem::indexed(size, base, index, extend, scaled);
                let text = format!("[{}, {operand}{amount}]", x(base));
                add(Some(mem), text, false, None);
            }
        }
    }
    all
}

#[test]
fn loads_and_stores() {
    let mut listing = Listing::new();
    for access in ACCESS_SIZES {
        for (index, form) in forms(access).into_iter().enumerate() {
            let (mem, m) = (form.mem, &form.text);
            let u = if form.is_unscaled { "u" } else { "" };
            let fpr = Fpr::new((index % 32) as u8);
            let f = part(fpr, access);
            listing.add(format!("ld{u}r {f}, {m}"), |a| a.ldr_fpr(fpr, mem));
            listing.add(format!("st{u}r {f}, {m}"), |a| a.str_fpr(fpr, mem));
            let Some(&size) = SIZES.get(access as usize) else {
                continue;
            };
            let gpr = match Gpr::new((index % 32) as u8) {
                reg if reg == SP || Some(reg) == form.changed => ZR,
                reg => reg,
            };
            let (r, s) = (name(gpr, size.width()), suffix(size));
            listing.add(format!("ld{u}r{s} {r}, {m}"), |a| a.ldr(gpr, mem));
            listing.add(format!("st{u}r{s} {r}, {m}"), |a| a.str(gpr, mem));
            for width in WIDTHS.into_iter().filter(|width| size < width.size()) {
                let s = ["b", "h", "w"][size as usize];
                listing.add(format!("ld{u}rs{s} {}, {m}", name(gpr, width)), |a| {
                    a.ldrs(width, gpr, mem)
                });
            }
            if size == Size::S64 && form.changed.is_none() {
                listing.add(format!("prf{u}m pldl1keep, {m}"), |a| a.prfm(mem));
            }
        }
    }
    listing.check();
}

#[test]
fn offsets_fit_where_the_manual_says() {
    let far = (17..63).flat_map(|shift| [1 << shift, -1 << shift, (1 << shift) + 16]);
    for offset in (-70_000..70_000).chain(far).chain([i64::MIN, i64::MAX]) {
        let unscaled = (-256..=255).contains(&offset);
        assert_eq!(Mem::fits_unscaled(offset), unscaled);
        for size in ACCESS_SIZES {
            let bytes = 1 << size.log2_bytes();
            let scaled = offset % bytes == 0 && (0..=4095 * bytes).contains(&offset);
            assert_eq!(Mem::fits_scaled(size, offset), scaled);
            assert_eq!(Mem::fits_offset(size, offset), scaled || unscaled);
            assert_eq!(Mem::scaled(size, X0, offset).is_some(), scaled);
            assert_eq!(Mem::offset(size, X0, offset).is_some(), scaled || unscaled);
            for form in [Mem::unscaled, Mem::pre_index, Mem::post_index] {
                assert_eq!(form(size, X0, offset).is_some(), unscaled);
            }
            if size >= AccessSize::S32 {
                let fits = offset % bytes == 0 && (-64 * bytes..=63 * bytes).contains(&offset);
                assert_eq!(PairMem::fits(size, offset), fits);
                for form in [PairMem::offset, PairMem::pre_index, PairMem::post_index] {
                    assert_eq!(form(size, X0, offset).is_some(), fits);
                }
            }
        }
    }
}

#[test]
fn pairs() {
    let mut listing = Listing::new();
    for size in ACCESS_SIZES[2..].iter().copied() {
        let bytes = 1 << size.log2_bytes();
        let offsets = (-64..64).map(|units| ([X1, X2, X3], units * bytes));
        let registers = operands([ZR, ZR, SP]).into_iter();
        for ([low, high, base], offset) in offsets.chain(registers.map(|all| (all, -2 * bytes))) {
            let b = x(base);
            let forms = [
                (
                    PairMem::offset(size, base, offset),
                    format!("[{b}, #{offset}]"),
                ),
                (
                    PairMem::pre_index(size, base, offset),
                    format!("[{b}, #{offset}]!"),
                ),
                (
                    PairMem::post_index(size, base, offset),
                    format!("[{b}], #{offset}"),
                ),
            ];
            for (index, (mem, m)) in forms.into_iter().enumerate() {
                let mem = mem.unwrap();
                let [first, second] = [low, high].map(|reg| Fpr::new(reg.number() % 32));
                let pair = format!("{}, {}", part(first, size), part(second, size));
                listing.add(format!("stp {pair}, {m}"), |a| {
                    a.stp_fpr(first, second, mem)
                });
                if low != high {
                    listing.add(format!("ldp {pair}, {m}"), |a| {
                        a.ldp_fpr(first, second, mem)
                    });
                }
                if size == AccessSize::S128 || index != 0 && (base == low || base == high) {
                    continue;
                }
                let pair = names([low, high], WIDTHS[size as usize - 2]);
                listing.add(format!("stp {pair}, {m}"), |a| a.stp(low, high, mem));
                if low != high {
                    listing.add(format!("ldp {pair}, {m}"), |a| a.ldp(low, high, mem));
                }
            }
        }
    }
    listing.check();
}

#[test]
fn atomics() {
    let mut listing = Listing::new();
    for size in SIZES {
        let (s, width) = (suffix(size), size.width());
        for [t, n] in operands([ZR, SP]) {
            let operands = format!("{}, [{}]", name(t, width), x(n));
            listing.add(format!("ldar{s} {operands}"), |a| a.ldar(size, t, n));
            listing.add(format!("stlr{s} {operands}"), |a| a.stlr(size, t, n));
            listing.add(format!("ldaxr{s} {operands}"), |a| a.ldaxr(size, t, n));
        }
        for [first, t, n] in operands([ZR, ZR, SP]) {
            let rest = format!("{}, [{}]", name(t, width), x(n));
            if first != t && first != n {
                listing.add(format!("stlxr{s} {}, {rest}", w(first)), |a| {
                    a.stlxr(size, first, t, n)
                });
            }
            let operands = format!("{}, {rest}", name(first, width));
            listing.add(format!("casal{s} {operands}"), |a| {
                a.casal(size, first, t, n)
            });
            for &op in AtomicUpdate::ALL {
                listing.add(format!("{}{s} {operands}", lower(op)), |a| {
                    a.atomic_update(op, size, first, t, n)
                });
            }
        }
    }
    listing.check();
}

#[test]
fn control() {
    let mut listing = Listing::new();
    let start = listing.asm.new_label();
    listing.asm.bind(start);
    let back = |listing: &Listing| format!("#-{}", 4 * listing.expected.len());
    listing.add("nop".into(), |a| a.nop());
    listing.add("ret".into(), |a| a.ret());
    listing.add(format!("b {}", back(&listing)), |a| a.b(start));
    listing.add(format!("bl {}", back(&listing)), |a| a.bl(start));
    for imm in [0, 1, 0xf000, 0xffff] {
        listing.add(format!("brk #{imm}"), |a| a.brk(imm));
        listing.add(format!("udf #{imm}"), |a| a.udf(imm));
    }
    for &barrier in Barrier::ALL {
        listing.add(format!("dmb {}", lower(barrier)), |a| a.dmb(barrier));
    }
    for cc in Cc::ALL {
        listing.add(format!("b.{} {}", lower(cc), back(&listing)), |a| {
            a.b_cond(cc, start)
        });
    }
    for [reg] in operands([ZR]) {
        listing.add(format!("br {}", x(reg)), |a| a.br(reg));
        listing.add(format!("blr {}", x(reg)), |a| a.blr(reg));
        listing.add(format!("adr {}, {}", x(reg), back(&listing)), |a| {
            a.adr(reg, start)
        });
        for width in WIDTHS {
            let r = name(reg, width);
            listing.add(format!("cbz {r}, {}", back(&listing)), |a| {
                a.cbz(width, reg, start)
            });
            listing.add(format!("cbnz {r}, {}", back(&listing)), |a| {
                a.cbnz(width, reg, start)
            });
        }
        for bit in 0..64 {
            let operands = format!("{}, #{bit}", x(reg));
            listing.add(format!("tbz {operands}, {}", back(&listing)), |a| {
                a.tbz(reg, bit, start)
            });
            listing.add(format!("tbnz {operands}, {}", back(&listing)), |a| {
                a.tbnz(reg, bit, start)
            });
        }
    }
    listing.check();
}

#[test]
fn constants_follow_the_code_from_the_largest_down() {
    let mut listing = Listing::new();
    listing.add("ldr s1, #40".into(), |a| a.ldr_fpr_constant(V1, 1, 4));
    listing.add("ldr d2, #28".into(), |a| a.ldr_fpr_constant(V2, 2, 8));
    listing.add("ldr q31, #8".into(), |a| a.ldr_fpr_constant(V31, 3, 16));
    listing.check();
}

#[test]
fn floats() {
    let mut listing = Listing::new();
    for width in FLOAT_WIDTHS {
        for [d, n] in float_operands() {
            let pair = parts([d, n], width);
            for &op in FloatUnary::ALL {
                listing.add(format!("{} {pair}", lower(op)), |a| {
                    a.float_unary(op, width, d, n)
                });
            }
            listing.add(format!("fcmp {pair}"), |a| a.fcmp(width, d, n));
            listing.add(format!("fcmp {}, #0.0", part(n, width)), |a| {
                a.fcmp_zero(width, n)
            });
            listing.add(format!("fccmp {pair}, #8, vc"), |a| {
                a.fccmp(width, d, n, Nzcv::N, Cc::Vc)
            });
        }
        for [d, n, m] in float_operands() {
            let operands = parts([d, n, m], width);
            for &op in FloatBinary::ALL {
                listing.add(format!("{} {operands}", lower(op)), |a| {
                    a.float_binary(op, width, d, n, m)
                });
            }
            listing.add(format!("fcsel {operands}, mi"), |a| {
                a.fcsel(width, d, n, m, Cc::Mi)
            });
        }
        for [d, n, m, addend] in float_operands() {
            for &op in FloatMultiplyAdd::ALL {
                let operands = parts([d, n, m, addend], width);
                listing.add(format!("{} {operands}", lower(op)), |a| {
                    a.float_multiply_add(op, width, d, n, m, addend)
                });
            }
        }
        for cc in Cc::ALL {
            let operands = parts([V1, V2, V3], width);
            listing.add(format!("fcsel {operands}, {}", lower(cc)), |a| {
                a.fcsel(width, V1, V2, V3, cc)
            });
            for flags in all_flags() {
                let operands = format!("{}, #{}", parts([V1, V2], width), flags.bits());
                listing.add(format!("fccmp {operands}, {}", lower(cc)), |a| {
                    a.fccmp(width, V1, V2, flags, cc)
                });
            }
        }
    }
    listing.check();
}

#[test]
fn conversions() {
    let mut listing = Listing::new();
    let view = |format, reg| match format {
        FloatFormat::Half => part(reg, Size::S16),
        FloatFormat::Single => part(reg, Size::S32),
        FloatFormat::Double => part(reg, Size::S64),
    };
    for [d, n] in float_operands() {
        for &from in FloatFormat::ALL {
            for &to in FloatFormat::ALL.iter().filter(|&&to| to != from) {
                listing.add(format!("fcvt {}, {}", view(to, d), view(from, n)), |a| {
                    a.fcvt(from, to, d, n)
                });
            }
        }
    }
    for [gpr, other] in operands([ZR, SP]) {
        let fpr = Fpr::new(other.number());
        listing.add(
            format!("fjcvtzs {}, {}", w(gpr), part(fpr, Size::S64)),
            |a| a.fjcvtzs(gpr, fpr),
        );
        for float in FLOAT_WIDTHS {
            let (f, r) = (part(fpr, float), name(gpr, float.width()));
            listing.add(format!("fmov {f}, {r}"), |a| a.fmov_to_fpr(float, fpr, gpr));
            listing.add(format!("fmov {r}, {f}"), |a| {
                a.fmov_from_fpr(float, gpr, fpr)
            });
            for width in WIDTHS {
                for (sign, s) in SIGNS.into_iter().zip(["s", "u"]) {
                    let r = name(gpr, width);
                    listing.add(format!("fcvtz{s} {r}, {f}"), |a| {
                        a.fcvtz(float, sign, width, gpr, fpr)
                    });
                    for (rounding, m) in [
                        (Rounding::Nearest, "n"),
                        (Rounding::Up, "p"),
                        (Rounding::Down, "m"),
                    ] {
                        listing.add(format!("fcvt{m}{s} {r}, {f}"), |a| {
                            a.fcvt_to_gpr(rounding, float, sign, width, gpr, fpr)
                        });
                    }
                    listing.add(format!("{s}cvtf {f}, {r}"), |a| {
                        a.cvtf(sign, width, float, fpr, gpr)
                    });
                }
            }
        }
    }
    listing.check();
}

#[test]
fn every_float_immediate() {
    let mut listing = Listing::new();
    let mut values = Vec::new();
    for sign in [1.0, -1.0] {
        for exponent in -3..=4 {
            for sixteenths in 16..32 {
                values.push(sign * f64::from(sixteenths) / 16.0 * 2f64.powi(exponent));
            }
        }
    }
    for width in FLOAT_WIDTHS {
        let bits_of = |value: f64| match width {
            FloatWidth::F32 => (value as f32).to_bits().into(),
            FloatWidth::F64 => value.to_bits(),
        };
        for (index, &value) in values.iter().enumerate() {
            let dst = Fpr::new((index % 32) as u8);
            let imm = FloatImm::new(width, bits_of(value)).unwrap();
            listing.add(format!("fmov {}, #{value:?}", part(dst, width)), |a| {
                a.fmov_imm(dst, imm)
            });
        }
        let known: HashSet<u64> = values.iter().map(|&value| bits_of(value)).collect();
        let bits = width.width().bits();
        for top in 0..=0xffff {
            let value = top << (bits - 16);
            assert_eq!(
                FloatImm::new(width, value).is_some(),
                known.contains(&value)
            );
        }
        for &value in &known {
            for bit in 0..64 {
                let other = value ^ 1 << bit;
                let fits = bit >= bits || known.contains(&other);
                assert_eq!(FloatImm::new(width, other).is_some(), fits);
            }
        }
    }
    listing.check();
}

#[cfg(debug_assertions)]
#[test]
fn operands_that_an_instruction_cannot_take_are_noticed() {
    let (w, one) = (Width::W64, ArithmeticImm::ONE);
    let mask = BitmaskImm::new(w, 1).unwrap();
    let mistakes: [&dyn Fn(&mut Assembler); 22] = [
        &|a| a.add_sub_imm(AddSub::Add, w, ZR, X1, one),
        &|a| a.add_sub_imm(AddSub::Adds, w, SP, X1, one),
        &|a| a.add_sub_imm(AddSub::Add, w, X0, ZR, one),
        &|a| a.add_sub(AddSub::Add, w, SP, X1, X2),
        &|a| a.add_sub(AddSub::Add, w, X0, SP, X2),
        &|a| a.add_sub_extended(AddSub::Add, w, X0, X1, SP, Extend::Uxtx, 0),
        &|a| a.add_sub_extended(AddSub::Add, w, X0, ZR, X2, Extend::Uxtx, 0),
        &|a| a.logical_imm(Logical::And, ZR, X1, mask),
        &|a| a.logical_imm(Logical::Ands, SP, X1, mask),
        &|a| a.logical_imm(Logical::And, X0, SP, mask),
        &|a| a.mov(w, X0, SP),
        &|a| a.ldr(X0, Mem::at(Size::S64, ZR)),
        &|a| a.str(SP, Mem::at(Size::S64, X0)),
        &|a| a.ldr(X0, Mem::indexed(w, X1, SP, IndexExtend::Lsl, false)),
        &|a| a.ldr(X0, Mem::at(AccessSize::S128, X1)),
        &|a| a.ldr(X1, Mem::pre_index(w, X1, 8).unwrap()),
        &|a| a.str(X1, Mem::post_index(w, X1, 8).unwrap()),
        &|a| a.ldrs(Width::W32, X0, Mem::at(Size::S32, X1)),
        &|a| a.ldp(X1, X2, PairMem::pre_index(w, X2, 8).unwrap()),
        &|a| a.stp(X1, X2, PairMem::post_index(w, X1, 8).unwrap()),
        &|a| a.ldar(Size::S64, X0, ZR),
        &|a| a.cbz(w, SP, Assembler::new(Arm64Features::empty()).new_label()),
    ];
    for (index, mistake) in mistakes.into_iter().enumerate() {
        let emit = || mistake(&mut Assembler::new(Arm64Features::all()));
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(emit));
        assert!(outcome.is_err(), "{index}");
    }
}
