use bun_engine_asm::arm64::*;
use bun_engine_asm::{Arm64Features, Width};

const PARTS: [u64; 14] = [
    0, 0xffff, 1, 0x8000, 0xfffe, 0x7fff, 0x00ff, 0xff00, 0x0ff0, 0xf00f, 0x5555, 0x9999, 0x1234,
    0x7f12,
];

struct Bitmask {
    encoding: u32,
    value: u64,
}

fn bitmasks() -> Vec<Bitmask> {
    let mut all = Vec::new();
    for log2 in 1..=6 {
        let period: u32 = 1 << log2;
        for ones in 1..period {
            for rotation in 0..period {
                let bits = (0..64).filter(|bit| (bit + rotation) % period < ones);
                let value = bits.fold(0, |value, bit| value | 1 << bit);
                let imms = !(2 * period - 1) & 63 | (ones - 1);
                let encoding = period >> 6 << 12 | rotation << 6 | imms;
                all.push(Bitmask { encoding, value });
            }
        }
    }
    all.sort_unstable_by_key(|bitmask| bitmask.encoding);
    all
}

/// What the instructions leave in the register.
fn interpret(bytes: &[u8], bitmasks: &[Bitmask]) -> u64 {
    let mut reg = 0xdead_beef_dead_beef;
    for &word in bytes.as_chunks().0 {
        let word = u32::from_le_bytes(word);
        assert_eq!(word & 31, 7);
        let shift = (word >> 21 & 3) * 16;
        let imm = u64::from(word >> 5 & 0xffff) << shift;
        let is_wide = word >> 31 != 0;
        reg = match word >> 23 & 0xff {
            0x25 => !imm,
            0xa5 => imm,
            0xe5 => reg & !(0xffff << shift) | imm,
            0x64 => {
                assert_eq!(word >> 5 & 31, 31);
                let encoding = word >> 10 & 0x1fff;
                let found = bitmasks.binary_search_by_key(&encoding, |known| known.encoding);
                bitmasks[found.unwrap()].value
            }
            _ => panic!("{word:08x}"),
        };
        if !is_wide {
            reg &= 0xffff_ffff;
        }
    }
    reg
}

fn differing_parts(a: u64, b: u64) -> u32 {
    (0..4)
        .filter(|index| (a ^ b) >> (16 * index) & 0xffff != 0)
        .count() as u32
}

/// Tries every first instruction.
fn fewest_instructions(value: u64, bitmasks: &[Bitmask]) -> u32 {
    let wide = [0, u64::MAX, 0xffff_ffff].into_iter().flat_map(|rest| {
        let parts = if rest == 0xffff_ffff { 2 } else { 4 };
        (0..parts).map(move |index| {
            let part = 0xffff << (16 * index);
            value & part | rest & !part
        })
    });
    let patterns = bitmasks.iter().flat_map(|bitmask| {
        let has_short_form = bitmask.encoding >> 12 == 0;
        [
            Some(bitmask.value),
            has_short_form.then_some(bitmask.value & 0xffff_ffff),
        ]
    });
    let firsts = wide.chain(patterns.flatten());
    1 + firsts
        .map(|first| differing_parts(first, value))
        .min()
        .unwrap()
}

fn check(width: Width, value: u64, bitmasks: &[Bitmask]) -> u32 {
    let constant = ConstantMove::new(width, value);
    let mut asm = Assembler::new(Arm64Features::empty());
    asm.move_constant(X7, constant);
    let code = asm.finish().unwrap();
    assert_eq!(
        interpret(code.bytes(), bitmasks),
        value & u64::MAX >> (64 - width.bits()),
        "{value:#x}"
    );
    assert_eq!(code.bytes().len(), 4 * constant.instructions() as usize);
    constant.instructions()
}

fn from_parts() -> impl Iterator<Item = u64> {
    (0..PARTS.len().pow(4)).map(|mut choice| {
        (0..4).fold(0, |value, _| {
            let part = PARTS[choice % PARTS.len()];
            choice /= PARTS.len();
            value << 16 | part
        })
    })
}

#[test]
fn the_register_gets_the_constant() {
    let bitmasks = bitmasks();
    let near_bitmasks = bitmasks.iter().flat_map(|bitmask| {
        [0, 0x1234, 0x1234 << 16, 0x1234 << 32, 0x1234 << 48].map(|bits| bitmask.value ^ bits)
    });
    for value in from_parts().chain(near_bitmasks) {
        check(Width::W64, value, &bitmasks);
        assert!(check(Width::W32, value, &bitmasks) <= 2);
    }
}

#[test]
fn no_first_instruction_makes_it_shorter() {
    let bitmasks = bitmasks();
    let stride = if cfg!(debug_assertions) { 5 } else { 1 };
    let near_bitmasks = bitmasks.iter().enumerate().flat_map(|(index, bitmask)| {
        let (first, second) = (index % 4 * 16, index / 4 % 4 * 16);
        [
            bitmask.value,
            bitmask.value ^ 0x1234 << first,
            bitmask.value ^ 0x1234 << first ^ 0x4321 << second,
        ]
    });
    for value in from_parts().chain(near_bitmasks).step_by(stride) {
        assert_eq!(
            check(Width::W64, value, &bitmasks),
            fewest_instructions(value, &bitmasks),
            "{value:#x}"
        );
    }
}
