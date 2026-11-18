mod common;

use bun_engine_bigint::*;
use bun_engine_text::Text;
use common::*;

const PRIME: u128 = (1 << 61) - 1;

/// By plain linear code.
fn residue(x: &BigInt) -> u128 {
    let digits = x.as_ref().digits().iter().rev();
    digits.fold(0, |left, &digit| (left << 64 | u128::from(digit)) % PRIME)
}

struct Operands(u64);

impl Operands {
    fn digit(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mixed = (self.0 ^ self.0 >> 30).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        mixed ^ mixed >> 29
    }

    /// Dense, all ones, or mostly zeros.
    fn with_length(&mut self, length: usize) -> BigInt {
        let kind = self.digit() % 3;
        let mut digits: Vec<u64> = (0..length)
            .map(|_| match (kind, self.digit()) {
                (0, digit) => digit,
                (1, _) => u64::MAX,
                (_, digit) => u64::from(digit % 8 == 0),
            })
            .collect();
        digits[length - 1] |= 1;
        BigInt::copy_of(BigIntRef::new(false, &digits)).unwrap()
    }
}

/// Around the lengths at which another algorithm takes over.
const LENGTHS: [usize; 22] = [
    1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 33, 64, 129, 130, 131, 200, 395, 520, 581, 1406, 1407, 3000,
];

#[test]
fn products() {
    let mut operands = Operands(1);
    for long in LENGTHS {
        let x = operands.with_length(long);
        let square = residue(&x) * residue(&x) % PRIME;
        assert_eq!(residue(&apply("*", &x, &x)), square, "{long}");
        for short in LENGTHS.into_iter().filter(|&short| short <= long) {
            let y = operands.with_length(short);
            let product = residue(&x) * residue(&y) % PRIME;
            assert_eq!(residue(&apply("*", &x, &y)), product, "{long} {short}");
        }
    }
}

#[test]
fn quotients_and_remainders() {
    let mut operands = Operands(2);
    let one = big("1");
    for divisor_length in LENGTHS {
        for quotient_length in LENGTHS {
            let divisor = operands.with_length(divisor_length);
            let quotient = operands.with_length(quotient_length);
            let product = apply("*", &quotient, &divisor);
            let halved = apply(">>", &divisor, &one);
            for left in [big("0"), halved, apply("-", &divisor, &one)] {
                let dividend = apply("+", &product, &left);
                let results = (
                    apply("/", &dividend, &divisor),
                    apply("%", &dividend, &divisor),
                );
                let is_right = results.0 == quotient && results.1 == left;
                assert!(is_right, "{divisor_length} {quotient_length}");
            }
        }
    }
}

#[test]
fn repeated_divisors() {
    let mut operands = Operands(3);
    let cache = DivisorCache::default();
    let near_power_of_two = apply("-", &apply("<<", &big("1"), &big("255")), &big("19"));
    let others = [1, 2, 3, 4, 6, 8, 9, 10, 11, 32, 33].map(|length| operands.with_length(length));
    for divisor in others.iter().chain([&near_power_of_two]) {
        let length = divisor.as_ref().digits().len();
        for round in 0..24 {
            let quotient = operands.with_length(1 + round % (length + 2));
            let left = match round % 3 {
                0 => big("0"),
                1 => apply("-", divisor, &big("1")),
                _ => apply(">>", divisor, &big("3")),
            };
            let dividend = apply("+", &apply("*", &quotient, divisor), &left);
            let apply =
                |operator| try_apply_with(operator, &dividend, divisor, &cache, &mut || false);
            assert_eq!((apply("/"), apply("%")), (Ok(quotient), Ok(left)));
        }
    }
}

#[test]
fn text_in_both_directions() {
    let mut operands = Operands(4);
    for length in [1, 2, 3, 5, 43, 44, 45, 103, 104, 105, 300, 2500] {
        let x = operands.with_length(length);
        for radix in [2, 3, 4, 8, 10, 16, 24, 32, 36] {
            let text = x.as_ref().to_string_ref(radix, &mut || false).unwrap();
            let value = text.text().code_units().fold(0, |value, unit| {
                let digit = char::from(unit as u8).to_digit(radix).unwrap();
                (value * u128::from(radix) + u128::from(digit)) % PRIME
            });
            assert!(value == residue(&x) && text.text().at(0) != u16::from(b'0'));
            let radix = match radix {
                2 => LiteralRadix::Binary,
                8 => LiteralRadix::Octal,
                10 => LiteralRadix::Decimal,
                16 => LiteralRadix::Hexadecimal,
                _ => continue,
            };
            let wide: Vec<u16> = text.text().code_units().collect();
            for text in [text.text(), Text::Utf16(&wide)] {
                let parsed = from_literal(text, radix, false).unwrap();
                assert_eq!(parsed.into_owned(&mut || false).as_ref(), Ok(&x));
            }
        }
    }
}
