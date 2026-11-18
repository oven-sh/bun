#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod support;
#[path = "support/vectors.rs"]
mod vectors;

use std::collections::HashSet;

use bun_engine_asm::arm64::*;
use bun_engine_asm::{Arm64Features, FloatWidth, Fpr, Gpr, Sign, Size, Width, lanes};

const SIZES: [Size; 4] = [Size::S8, Size::S16, Size::S32, Size::S64];
const SIGNS: [(Sign, &str); 2] = [(Sign::Signed, "s"), (Sign::Unsigned, "u")];
const FLOATS: [Arrangement; 3] = [Arrangement::S2, Arrangement::S4, Arrangement::D2];

/// Every register in each operand.
fn operands<const N: usize>() -> Vec<[Fpr; N]> {
    let mut all = Vec::new();
    for position in 0..N {
        for number in 0..32 {
            let mut registers = std::array::from_fn(|index| [V3, V12, V5, V28][index]);
            registers[position] = Fpr::new(number);
            all.push(registers);
        }
    }
    all
}

fn shapes() -> impl Iterator<Item = Arrangement> {
    Arrangement::ALL.iter().copied()
}

fn narrow_shapes() -> impl Iterator<Item = Arrangement> {
    shapes().filter(|&shape| shape != Arrangement::D2)
}

fn doubled(size: Size) -> Size {
    SIZES[size as usize + 1]
}

fn letter(size: Size) -> &'static str {
    ["b", "h", "s", "d"][size as usize]
}

fn named(reg: Fpr, bytes: u8, size: Size) -> String {
    let (number, count) = (reg.number(), bytes / size.bytes());
    format!("v{number}.{count}{}", letter(size))
}

fn v(reg: Fpr, shape: Arrangement) -> String {
    named(reg, if shape.is_full() { 16 } else { 8 }, shape.lanes())
}

fn wide(reg: Fpr, shape: Arrangement) -> String {
    named(reg, 16, doubled(shape.lanes()))
}

fn all<const N: usize>(registers: [Fpr; N], shape: Arrangement) -> String {
    registers.map(|reg| v(reg, shape)).join(", ")
}

fn element(reg: Fpr, size: Size, lane: u8) -> String {
    format!("v{}.{}[{lane}]", reg.number(), letter(size))
}

fn scalar(reg: Fpr, size: Size) -> String {
    format!("{}{}", letter(size), reg.number())
}

fn gpr(reg: Gpr, width: Width) -> String {
    let prefix = ["w", "x"][width as usize];
    match reg {
        ZR => format!("{prefix}zr"),
        SP => "sp".into(),
        _ => format!("{prefix}{}", reg.number()),
    }
}

fn gprs(last: Gpr) -> impl Iterator<Item = Gpr> {
    (0..31).map(Gpr::new).chain([last])
}

fn lower(op: impl std::fmt::Debug) -> String {
    format!("{op:?}").to_lowercase()
}

/// The name of an instruction that has a form for each half.
fn for_half(op: impl std::fmt::Debug, shape: Arrangement) -> String {
    lower(op) + if shape.is_full() { "2" } else { "" }
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
fn arrangements() {
    for shape in shapes() {
        let of = [Arrangement::half, Arrangement::full][usize::from(shape.is_full())];
        assert_eq!(of(shape.lanes()), shape);
    }
    assert_eq!(Arrangement::of_floats(FloatWidth::F32), Arrangement::S4);
    assert_eq!(Arrangement::of_floats(FloatWidth::F64), Arrangement::D2);
}

#[test]
fn three_registers_with_the_same_lanes() {
    let mut listing = Listing::new();
    for [d, n, m] in operands() {
        for shape in shapes() {
            let operands = all([d, n, m], shape);
            for &op in NeonBinary::ALL.iter().filter(|op| op.takes(shape.lanes())) {
                listing.add(format!("{} {operands}", lower(op)), |a| {
                    a.neon(op, shape, d, n, m)
                });
            }
            for &op in NeonPermute::ALL {
                listing.add(format!("{} {operands}", lower(op)), |a| {
                    a.neon_permute(op, shape, d, n, m)
                });
            }
        }
        for shape in FLOATS {
            for &op in NeonFloatBinary::ALL {
                listing.add(format!("{} {}", lower(op), all([d, n, m], shape)), |a| {
                    a.neon_float(op, shape, d, n, m)
                });
            }
        }
        let bytes = all([d, n, m], Arrangement::B16);
        for &op in NeonBitwise::ALL {
            listing.add(format!("{} {bytes}", lower(op)), |a| {
                a.neon_bitwise(op, d, n, m)
            });
        }
        for first in 0..16 {
            listing.add(format!("ext {bytes}, #{first}"), |a| a.ext(d, n, m, first));
        }
        for amount in 0..64 {
            let operands = all([d, n, m], Arrangement::D2);
            listing.add(format!("xar {operands}, #{amount}"), |a| {
                a.xar(d, n, m, amount)
            });
        }
    }
    for [d, n, m, c] in operands() {
        for &op in NeonBitwiseThree::ALL {
            let operands = all([d, n, m, c], Arrangement::B16);
            listing.add(format!("{} {operands}", lower(op)), |a| {
                a.neon_bitwise_three(op, d, n, m, c)
            });
        }
    }
    listing.check();
}

#[test]
fn three_registers_with_different_lanes() {
    let mut listing = Listing::new();
    for [d, n, m] in operands() {
        for shape in narrow_shapes() {
            for &op in NeonLong::ALL {
                let lhs = [v, wide][usize::from(lower(op).ends_with('w'))](n, shape);
                let operands = format!("{}, {lhs}, {}", wide(d, shape), v(m, shape));
                listing.add(format!("{} {operands}", for_half(op, shape)), |a| {
                    a.neon_long(op, shape, d, n, m)
                });
            }
            for &op in NeonHighHalves::ALL {
                let operands = format!("{}, {}, {}", v(d, shape), wide(n, shape), wide(m, shape));
                listing.add(format!("{} {operands}", for_half(op, shape)), |a| {
                    a.neon_high_halves(op, shape, d, n, m)
                });
            }
        }
        for (shape, bytes) in [
            (Arrangement::S2, Arrangement::B8),
            (Arrangement::S4, Arrangement::B16),
        ] {
            for (sign, prefix) in SIGNS {
                let operands = format!("{}, {}", v(d, shape), all([n, m], bytes));
                listing.add(format!("{prefix}dot {operands}"), |a| {
                    a.dot(sign, shape, d, n, m)
                });
            }
            for &op in NeonLookup::ALL {
                for registers in 1..=4 {
                    let table = (0..registers).map(|index| (n.number() + index) % 32);
                    let table: Vec<_> = table.map(|number| format!("v{number}.16b")).collect();
                    let table = table.join(", ");
                    let operands = format!("{}, {{ {table} }}, {}", v(d, bytes), v(m, bytes));
                    listing.add(format!("{} {operands}", lower(op)), |a| {
                        a.neon_lookup(op, bytes, d, n, registers, m)
                    });
                }
            }
        }
    }
    listing.check();
}

#[test]
fn by_element() {
    let mut listing = Listing::new();
    for [d, n, m] in operands() {
        for shape in shapes().filter(|shape| shape.lanes() != Size::S16 || m < V16) {
            let size = shape.lanes();
            for &op in NeonByElement::ALL.iter().filter(|op| op.takes(size)) {
                let (text, dst) = if lower(op).ends_with("ll") || lower(op).ends_with("al") {
                    (for_half(op, shape), wide(d, shape))
                } else {
                    (lower(op), v(d, shape))
                };
                for lane in 0..lanes::count(size) {
                    let operands = format!("{dst}, {}, {}", v(n, shape), element(m, size, lane));
                    listing.add(format!("{text} {operands}"), |a| {
                        a.neon_by_element(op, shape, d, n, m, lane)
                    });
                }
            }
        }
    }
    listing.check();
}

#[test]
fn two_registers() {
    let mut listing = Listing::new();
    let zero = |op: &str, zero| if op.contains("cm") { zero } else { "" };
    for [d, n] in operands() {
        for shape in shapes() {
            for &op in NeonUnary::ALL.iter().filter(|op| op.takes(shape.lanes())) {
                let text = lower(op);
                let operands = all([d, n], shape) + zero(&text, ", #0");
                listing.add(format!("{text} {operands}"), |a| {
                    a.neon_unary(op, shape, d, n)
                });
            }
        }
        for shape in FLOATS {
            for &op in NeonFloatUnary::ALL {
                let text = lower(op);
                let operands = all([d, n], shape) + zero(&text, ", #0.0");
                listing.add(format!("{text} {operands}"), |a| {
                    a.neon_float_unary(op, shape, d, n)
                });
            }
        }
        for shape in narrow_shapes() {
            let size = shape.lanes();
            for &op in NeonAddPairs::ALL {
                let dst = named(d, if shape.is_full() { 16 } else { 8 }, doubled(size));
                listing.add(format!("{} {dst}, {}", lower(op), v(n, shape)), |a| {
                    a.neon_add_pairs(op, shape, d, n)
                });
            }
            let narrowing = format!("{}, {}", v(d, shape), wide(n, shape));
            let widening = format!("{}, {}", wide(d, shape), v(n, shape));
            for &op in NeonNarrow::ALL {
                listing.add(format!("{} {narrowing}", for_half(op, shape)), |a| {
                    a.neon_narrow(op, shape, d, n)
                });
            }
            let half = if shape.is_full() { "2" } else { "" };
            listing.add(format!("shll{half} {widening}, #{}", size.bits()), |a| {
                a.shll(shape, d, n)
            });
            if size == Size::S32 {
                listing.add(format!("fcvtn{half} {narrowing}"), |a| a.fcvtn(shape, d, n));
                listing.add(format!("fcvtl{half} {widening}"), |a| a.fcvtl(shape, d, n));
            }
            for &op in NeonAcross::ALL.iter().filter(|_| shape != Arrangement::S2) {
                let is_long = lower(op).ends_with("lv");
                let dst = scalar(d, if is_long { doubled(size) } else { size });
                listing.add(format!("{} {dst}, {}", lower(op), v(n, shape)), |a| {
                    a.neon_across(op, shape, d, n)
                });
            }
        }
        for &op in NeonFloatAcross::ALL {
            let operands = format!("{}, {}", scalar(d, Size::S32), v(n, Arrangement::S4));
            listing.add(format!("{} {operands}", lower(op)), |a| {
                a.neon_float_across(op, d, n)
            });
        }
        for (width, shape) in [
            (FloatWidth::F32, Arrangement::S2),
            (FloatWidth::F64, Arrangement::D2),
        ] {
            for &op in NeonFloatPair::ALL {
                let operands = format!("{}, {}", scalar(d, shape.lanes()), v(n, shape));
                listing.add(format!("{} {operands}", lower(op)), |a| {
                    a.neon_float_pair(op, width, d, n)
                });
            }
        }
        let operands = format!("{}, {}", scalar(d, Size::S64), v(n, Arrangement::D2));
        listing.add(format!("addp {operands}"), |a| a.addp_scalar(d, n));
    }
    listing.check();
}

#[test]
fn shifts() {
    let mut listing = Listing::new();
    for (index, [d, n]) in operands().into_iter().enumerate() {
        for shape in shapes() {
            let bits = shape.lanes().bits();
            let operands = all([d, n], shape);
            for left in (0..bits).filter(|amount| index == 0 || *amount == 3) {
                let right = left + 1;
                for &op in NeonShiftLeft::ALL {
                    listing.add(format!("{} {operands}, #{left}", lower(op)), |a| {
                        a.neon_shift_left(op, shape, d, n, left)
                    });
                }
                for &op in NeonShiftRight::ALL {
                    listing.add(format!("{} {operands}, #{right}", lower(op)), |a| {
                        a.neon_shift_right(op, shape, d, n, right)
                    });
                }
                if shape == Arrangement::D2 {
                    continue;
                }
                for &op in NeonShiftNarrow::ALL {
                    let operands = format!("{}, {}, #{right}", v(d, shape), wide(n, shape));
                    listing.add(format!("{} {operands}", for_half(op, shape)), |a| {
                        a.neon_shift_narrow(op, shape, d, n, right)
                    });
                }
                for (sign, prefix) in SIGNS {
                    let half = if shape.is_full() { "2" } else { "" };
                    let operands = format!("{}, {}, #{left}", wide(d, shape), v(n, shape));
                    listing.add(format!("{prefix}shll{half} {operands}"), |a| {
                        a.neon_shift_long(sign, shape, d, n, left)
                    });
                }
            }
        }
    }
    listing.check();
}

#[test]
fn single_lanes() {
    let mut listing = Listing::new();
    for size in SIZES {
        for lane in 0..lanes::count(size) {
            for [d, n] in operands() {
                let (to, from) = (element(d, size, lane), element(n, size, lane));
                for shape in shapes().filter(|shape| shape.lanes() == size) {
                    listing.add(format!("dup {}, {from}", v(d, shape)), |a| {
                        a.dup_element(shape, d, n, lane)
                    });
                }
                listing.add(format!("dup {}, {from}", scalar(d, size)), |a| {
                    a.dup_scalar(size, d, n, lane)
                });
                for other in 0..lanes::count(size) {
                    listing.add(format!("ins {to}, {}", element(n, size, other)), |a| {
                        a.ins_element(size, d, lane, n, other)
                    });
                }
            }
            for (x, d) in gprs(ZR).zip((0..32).rev().map(Fpr::new)) {
                let (r, e) = (gpr(x, size.width()), element(d, size, lane));
                listing.add(format!("ins {e}, {r}"), |a| a.ins_gpr(size, d, lane, x));
                listing.add(format!("umov {r}, {e}"), |a| a.umov(size, x, d, lane));
                for width in [Width::W32, Width::W64] {
                    if size < width.size() {
                        listing.add(format!("smov {}, {e}", gpr(x, width)), |a| {
                            a.smov(size, width, x, d, lane)
                        });
                    }
                }
            }
            for (x, d) in gprs(SP).zip((0..32).rev().map(Fpr::new)) {
                let (number, base) = (d.number(), gpr(x, Width::W64));
                let operands = format!("{{ v{number}.{} }}[{lane}], [{base}]", letter(size));
                listing.add(format!("ld1 {operands}"), |a| a.ld1_lane(size, d, lane, x));
                listing.add(format!("st1 {operands}"), |a| a.st1_lane(size, d, lane, x));
            }
        }
    }
    for shape in shapes() {
        for (x, d) in gprs(ZR).zip((0..32).rev().map(Fpr::new)) {
            let operands = format!("{}, {}", v(d, shape), gpr(x, shape.lanes().width()));
            listing.add(format!("dup {operands}"), |a| a.dup_gpr(shape, d, x));
        }
        for (x, d) in gprs(SP).zip((0..32).rev().map(Fpr::new)) {
            let operands = format!("{{ {} }}, [{}]", v(d, shape), gpr(x, Width::W64));
            listing.add(format!("ld1r {operands}"), |a| a.ld1r(shape, d, x));
        }
    }
    listing.check();
}

#[test]
fn bitwise_immediates() {
    let mut listing = Listing::new();
    for shape in shapes().filter(|shape| matches!(shape.lanes(), Size::S16 | Size::S32)) {
        for &op in NeonBitwiseImm::ALL {
            for shift in (0..shape.lanes().bits()).step_by(8) {
                for byte in 0..=255 {
                    let d = Fpr::new(byte % 32);
                    let operands = format!("{}, #{byte}, lsl #{shift}", v(d, shape));
                    listing.add(format!("{} {operands}", lower(op)), |a| {
                        a.neon_bitwise_imm(op, shape, d, byte, shift)
                    });
                }
            }
        }
    }
    listing.check();
}

/// Each instruction that moves a constant, and the 64 bits that it repeats.
fn constant_moves(full: bool) -> Vec<(String, u64)> {
    let name = |size| named(V7, if full { 16 } else { 8 }, size);
    let repeated = |size, value| lanes::splat(size, value) as u64;
    let mut all = Vec::new();
    for byte in 0..=255u64 {
        let bytes = (0..8).fold(0, |bytes, bit| {
            bytes | ((byte >> bit & 1) * 0xff) << (8 * bit)
        });
        let whole = if full { "v7.2d" } else { "d7" };
        all.push((format!("movi {whole}, #{bytes:#x}"), bytes));
    }
    for byte in 0..=255 {
        let text = format!("movi {}, #{byte}", name(Size::S8));
        all.push((text, repeated(Size::S8, byte)));
    }
    for (op, flip) in [("movi", 0), ("mvni", u64::MAX)] {
        for byte in 0..=255 {
            for size in [Size::S32, Size::S16] {
                for shift in (0..size.bits()).step_by(8) {
                    let text = format!("{op} {}, #{byte}, lsl #{shift}", name(size));
                    all.push((text, repeated(size, byte << shift) ^ flip));
                }
            }
        }
        for byte in 0..=255 {
            for shift in [8, 16] {
                let text = format!("{op} {}, #{byte}, msl #{shift}", name(Size::S32));
                let value = byte << shift | ((1 << shift) - 1);
                all.push((text, repeated(Size::S32, value) ^ flip));
            }
        }
    }
    for index in 0..128 {
        let magnitude = f64::from(16 + index % 16) / 128.0 * f64::from(1 << (index / 16));
        for value in [magnitude, -magnitude] {
            let text = format!("fmov {}, #{value:?}", name(Size::S32));
            all.push((text, repeated(Size::S32, (value as f32).to_bits().into())));
            if full {
                all.push((format!("fmov v7.2d, #{value:?}"), value.to_bits()));
            }
        }
    }
    all
}

#[test]
fn constants() {
    let mut listing = Listing::new();
    let mut known = HashSet::new();
    for full in [true, false] {
        for (text, half) in constant_moves(full) {
            let bits = u128::from(half) | u128::from(half * u64::from(full)) << 64;
            if known.insert(bits) {
                listing.add(text, |a| a.movi(V7, VectorImm::new(bits).unwrap()));
            }
        }
    }
    listing.check();
    for bits in vectors::constants(&mut vectors::Random(1)) {
        assert_eq!(VectorImm::new(bits).is_some(), known.contains(&bits));
    }
    assert_eq!(VectorImm::new(0), Some(VectorImm::ZERO));
    let signs = 0x8000_0000_8000_0000;
    assert_eq!(VectorImm::new(signs), Some(VectorImm::SIGNS32));
}
