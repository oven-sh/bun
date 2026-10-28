use bun_sema::atom::Atom;
use bun_sema::fold::Constant;
use rustc_hash::FxHashSet;

use super::dispatch::{CaseKey, add_case, classify_constant};
use crate::ir::{BlockId, Id};

fn classify_number(number: f64) -> CaseKey {
    classify_constant(Constant::Number(number))
}

#[test]
fn integral_numbers_in_tracked_range_are_integers() {
    let integers = [
        (0.0, 0),
        (-0.0, 0),
        (1.0, 1),
        (-1.0, -1),
        (4294967296.0, 4294967296),
        (9007199254740992.0, 9007199254740992),
        (4611686018427387392.0, 4611686018427387392),
        (-4611686018427387392.0, -4611686018427387392),
    ];
    for (number, integer) in integers {
        let expected = CaseKey::Integer(integer);
        assert_eq!(classify_number(number), expected, "{number}");
    }
}

#[test]
fn other_numbers_are_other() {
    let numbers = [
        4611686018427387904.0,
        -4611686018427387904.0,
        f64::INFINITY,
        f64::NEG_INFINITY,
        1.5,
        -0.5,
    ];
    for number in numbers {
        let other = CaseKey::Other(Constant::Number(number));
        assert_eq!(classify_number(number), other, "{number}");
    }
    assert!(matches!(
        classify_number(f64::NAN),
        CaseKey::Other(Constant::Number(number)) if number.is_nan()
    ));
}

#[test]
fn strings_are_strings() {
    let text = Atom(7);
    assert_eq!(
        classify_constant(Constant::String(text)),
        CaseKey::String(text)
    );
}

#[test]
fn other_primitives_are_other() {
    let constants = [
        Constant::Undefined,
        Constant::Null,
        Constant::Boolean(true),
        Constant::Boolean(false),
        Constant::BigInt(Atom(3)),
    ];
    for constant in constants {
        assert_eq!(classify_constant(constant), CaseKey::Other(constant));
    }
}

#[test]
fn first_case_wins() {
    let mut cases = Vec::new();
    let mut seen = FxHashSet::default();
    add_case(&mut cases, &mut seen, 1, BlockId::new(0));
    add_case(&mut cases, &mut seen, 2, BlockId::new(1));
    add_case(&mut cases, &mut seen, 1, BlockId::new(2));
    assert_eq!(cases, [(1, BlockId::new(0)), (2, BlockId::new(1))]);
}

#[test]
fn cases_stay_in_source_order() {
    let mut cases = Vec::new();
    let mut seen = FxHashSet::default();
    for (index, key) in [9, 3, 7].into_iter().enumerate() {
        add_case(&mut cases, &mut seen, key, BlockId::new(index));
    }
    let keys: Vec<i64> = cases.iter().map(|case| case.0).collect();
    assert_eq!(keys, [9, 3, 7]);
}
