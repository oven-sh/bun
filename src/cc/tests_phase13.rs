//! `long double` on x86-64 System V: the x87 format, computed with in memory.

use crate::extended::Extended;

fn image(text: &str, exponent: i64) -> (u16, u64) {
    let value = Extended::from_decimal(text.as_bytes(), exponent);
    (value.sign_exponent, value.significand)
}

#[test]
fn decimal_constants_round_to_a_64_bit_significand() {
    // Checked against what gcc stores for the same constants.
    assert_eq!(image("1", 0), (0x3fff, 0x8000_0000_0000_0000));
    assert_eq!(image("15", -1), (0x3fff, 0xc000_0000_0000_0000));
    assert_eq!(image("1", -1), (0x3ffb, 0xcccc_cccc_cccc_cccd));
    assert_eq!(
        image("31415926535897932384626433832795029", -34),
        (0x4000, 0xc90f_daa2_2168_c235)
    );
    // LDBL_MAX, LDBL_MIN, LDBL_EPSILON and LDBL_TRUE_MIN as <float.h> writes them.
    assert_eq!(
        image("118973149535723176502", 4932 - 20),
        (0x7ffe, 0xffff_ffff_ffff_ffff)
    );
    assert_eq!(
        image("336210314311209350626", -4932 - 20),
        (0x0001, 0x8000_0000_0000_0000)
    );
    assert_eq!(
        image("108420217248550443401", -19 - 20),
        (0x3fc0, 0x8000_0000_0000_0000)
    );
    assert_eq!(
        image("364519953188247460253", -4951 - 20),
        (0x0000, 0x0000_0000_0000_0001)
    );
    // Too big, too small, and half of the smallest subnormal (a tie, to even: zero).
    assert_eq!(image("1", 5000), (0x7fff, 0x8000_0000_0000_0000));
    assert_eq!(image("1", -5000), (0, 0));
    assert_eq!(image("12", 4931), (0x7fff, 0x8000_0000_0000_0000));
}

#[test]
fn arithmetic_in_software_matches_the_x87_unit() {
    let value = |text: &str, exponent: i64| Extended::from_decimal(text.as_bytes(), exponent);
    let third = value("1", 0).div(value("3", 0));
    assert_eq!(
        (third.sign_exponent, third.significand),
        (0x3ffd, 0xaaaa_aaaa_aaaa_aaab)
    );
    let sum = third.add(third).add(third);
    assert_eq!(
        (sum.sign_exponent, sum.significand),
        (0x3fff, 0x8000_0000_0000_0000)
    );
    let product = value("1", -1).mul(value("1", -1));
    assert_eq!(
        (product.sign_exponent, product.significand),
        (0x3ff8, 0xa3d7_0a3d_70a3_d70b)
    );
    let difference = value("1", 0).sub(value("1", -1).mul(value("10", 0)));
    assert_eq!((difference.sign_exponent, difference.significand), (0, 0));
    assert!(Extended::INFINITY.sub(Extended::INFINITY).is_nan());
    assert_eq!(value("1", 0).compare(Extended::NAN), None);
    assert_eq!(Extended::from_f64(0.1).to_f64(), 0.1);
    assert_eq!(value("1", -1).to_f64(), 0.1);
    assert_eq!(value("16777217", 0).to_f32(), 16_777_216.0);
    assert_eq!(value("25", -1).to_i64(), 2);
    assert_eq!(value("25", -1).negated().to_i64(), -2);
    assert_eq!(
        Extended::from_u128(u128::from(u64::MAX)).significand,
        u64::MAX
    );
    assert_eq!(Extended::from_i128(-1).sign_exponent, 0xbfff);
}

#[test]
fn the_four_operations_on_operands_that_are_hard_to_round() {
    // a, b, and what the x87 unit gives for a + b, a - b, a * b and a / b: results that are
    // subnormal, that overflow, that cancel, and operands 64 binary places apart.
    let rows = [
        "8001 ad7dd140587fc437 3ffc e5ecf8a23bce1c54 3ffc e5ecf8a23bce1c54 bffc e5ecf8a23bce1c54 8000 26f4892ad2d6139b 8003 c12a7dbba638dcc2",
        "3fde 8000000000000000 0003 af78685383922c4d 3fde 8000000000000000 3fde 8000000000000000 0000 000000015ef0d0a7 7fd9 babe6a4329e38fb9",
        "bfe2 b9bff89000000000 0003 b931f6e82f5e11f1 bfe2 b9bff89000000000 bfe2 b9bff89000000000 8000 0000002197fee165 ffde 8062264a9b4a4a8e",
        "3ffb 8000000000000000 7ffc c714249200000000 7ffc c714249200000000 fffc c714249200000000 7ff8 c714249200000000 0000 0a49925fa5ee20d2",
        "8001 8c0f3d4cbb2a9eb3 c013 e98866e04dc12153 c013 e98866e04dc12153 4013 e98866e04dc12153 0015 ff88fe5862d35be9 0000 000004cc45bb9d56",
        "f054 8000000000000000 f054 8000000000000000 f055 8000000000000000 0000 0000000000000000 7fff 8000000000000000 3fff 8000000000000000",
        "7ffe 8000000000000000 7ffe 8000000000000000 7fff 8000000000000000 0000 0000000000000000 7fff 8000000000000000 3fff 8000000000000000",
        "efde 8000000000000000 efde 8000000000000000 efdf 8000000000000000 0000 0000000000000000 7fff 8000000000000000 3fff 8000000000000000",
        "0001 ad6005a38f2e874e 8001 d4c74f6326f5e000 8000 276749bf97c758b2 0002 c113aa835b1233a7 8000 0000000000000000 bffe d097b18d3564236b",
        "0000 0d71c00000000000 0000 034b06fc9f879b0e 0000 10bcc6fc9f879b0e 0000 0a26b903607864f2 0000 0000000000000000 4001 82a4b99d070355dc",
        "7ffc cef632b38904dcef fffe c13e4b1225889400 fffe 8d80be6543475cc4 7ffe f4fbd7bf07c9cb3c ffff 8000000000000000 bffd 891634c1599f343d",
        "fffc dfe9771954000000 fffb d700d4bc91b7acb5 fffd a5b4f0bbce6deb2d fffb e8d219761648534b 7fff 8000000000000000 4000 854dc09fa74cf990",
        "3fff 9d78162175df7166 4000 8f790d37f0b9a438 4000 de351848aba95ceb bfff 817a044e6b93d70a 4000 b0811481514f8158 3ffe 8c7c9f2a0592e295",
        "e0b4 91cd1d0c0129b881 f840 a7dd26c29f22f717 f840 a7dd26c29f22f717 7840 a7dd26c29f22f717 7fff 8000000000000000 2872 de5a7c9324909d77",
        "bfc0 fa9b31e400000000 c000 d85a6c5895b09627 c000 d85a6c5895b09628 4000 d85a6c5895b09626 3fc2 d3cb76b81b168819 3fbf 9443d360e92de696",
        "3ffe cec6bbdbcd1ad144 403e fc2c9d7bc0000000 403e fc2c9d7bc0000001 c03e fc2c9d7bbfffffff 403e cbafaa487d74c2e5 3fbe d1e9cdc19a487ccd",
        "3fbe bfeb67df00000000 3ffe e7de561d0bb7f5d7 3ffe e7de561d0bb7f5d8 bffe e7de561d0bb7f5d6 3fbe add4196d27bab54e 3fbe d3e4b6092954a1ad",
    ];
    for row in rows {
        let words: Vec<u64> = row
            .split_ascii_whitespace()
            .map(|w| u64::from_str_radix(w, 16).expect("hexadecimal"))
            .collect();
        let at = |index: usize| Extended {
            sign_exponent: words[index * 2] as u16,
            significand: words[index * 2 + 1],
        };
        let (a, b) = (at(0), at(1));
        assert_eq!(a.add(b), at(2), "{row}: +");
        assert_eq!(a.sub(b), at(3), "{row}: -");
        assert_eq!(a.mul(b), at(4), "{row}: *");
        assert_eq!(a.div(b), at(5), "{row}: /");
    }
}
