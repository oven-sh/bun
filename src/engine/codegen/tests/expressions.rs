//! What the passes are expected to make of expressions. The cases are in `expressions.txt`.

#![allow(clippy::disallowed_methods)]

mod support;

use std::fmt::Debug;

use bun_engine_asm::Sign::{Signed, Unsigned};
use bun_engine_asm::Size::{S8, S16, S32, S64};
use bun_engine_asm::{
    Arm64Features, Cond, FloatCond, FloatWidth, RegisterSet, Rounding, VectorBinary, VectorReduce,
    VectorShift, VectorTernary, VectorUnary, X64Features,
};
use bun_engine_codegen::Target;
use bun_engine_codegen::ir::Type::{F32, F64, I32, I64, V128};
use bun_engine_codegen::ir::{
    Access, AccessFlags, Binary, Boundary, Builder, Checked, Exit, Function, Heap, Lanes, Load, Op,
    State, Token, Type, Unary, Value,
};
use bun_engine_codegen::passes::Analyses;
use support::harness::pass_named;

const PARAMS: [(&str, Type); 13] = [
    ("x", I32),
    ("y", I32),
    ("z", I32),
    ("X", I64),
    ("Y", I64),
    ("Z", I64),
    ("f", F32),
    ("g", F32),
    ("d", F64),
    ("e", F64),
    ("u", V128),
    ("v", V128),
    ("w", V128),
];

fn named<T: Copy + Debug>(all: &[T], name: &str) -> Option<T> {
    all.iter().copied().find(|item| format!("{item:?}") == name)
}

fn unary_named(name: &str) -> Option<Unary> {
    use Unary::*;
    let plain = [
        Neg,
        CountLeadingZeros,
        CountTrailingZeros,
        CountOnes,
        Wrap,
        Abs,
        Sqrt,
        Promote,
        Demote,
        FloatToInt32Modular,
        HalfBitsToFloat,
        Bitcast,
        CanonicalizeNan,
        Opaque,
    ];
    let sized = [S8, S16, S32, S64].map(|size| [SwapBytes(size), SignExtend(size)]);
    let signed = [Signed, Unsigned].map(|sign| {
        [
            Widen(sign),
            IntToFloat(sign),
            FloatToInt(sign),
            FloatToIntSaturating(sign),
        ]
    });
    let rounding = [
        Round(Rounding::Down),
        Round(Rounding::TowardZero),
        FitsIn(8),
    ];
    named(
        &[&plain[..], &sized.concat(), &signed.concat(), &rounding].concat(),
        name,
    )
}

fn binary_named(name: &str) -> Option<Binary> {
    use Binary::*;
    let all = [
        Add,
        Sub,
        Mul,
        Div,
        Rem,
        UnsignedDiv,
        UnsignedRem,
        TotalDiv,
        TotalRem,
        MulHigh(Signed),
        MulHigh(Unsigned),
        And,
        Or,
        Xor,
        Shl,
        Shr,
        Sar,
        RotateLeft,
        RotateRight,
        Min,
        Max,
        CopySign,
    ];
    named(&all, name)
}

fn lanes_named(name: &str) -> Lanes {
    let ints = [S8, S16, S32, S64].map(Lanes::Int);
    let floats = [FloatWidth::F32, FloatWidth::F64].map(Lanes::Float);
    named(&[&ints[..], &floats].concat(), name).unwrap()
}

fn load_named(name: &str) -> Option<Load> {
    let with_size = |size| {
        let [signed, unsigned] = [Signed, Unsigned]
            .map(|sign| [Load::Narrow(size, sign), Load::VectorExtend(size, sign)]);
        [
            signed,
            unsigned,
            [Load::VectorSplat(size), Load::VectorZero(size)],
        ]
        .concat()
    };
    let all = [
        [S8, S16, S32, S64].map(with_size).concat(),
        vec![Load::Full],
    ]
    .concat();
    all.into_iter()
        .find(|kind| format!("{kind:?}").replace(' ', "") == name)
}

enum Tree<'a> {
    Atom(&'a str),
    List(&'a str, Vec<Tree<'a>>),
}

fn parse<'a>(tokens: &mut impl Iterator<Item = &'a str>) -> Option<Tree<'a>> {
    match tokens.next()? {
        "]" => None,
        "[" => Some(Tree::List(
            tokens.next()?,
            std::iter::from_fn(|| parse(tokens)).collect(),
        )),
        atom => Some(Tree::Atom(atom)),
    }
}

fn number(text: &str) -> i128 {
    match text.strip_prefix("0x") {
        Some(digits) => u128::from_str_radix(digits, 16).unwrap() as i128,
        None => text.parse().unwrap(),
    }
}

fn pattern(text: &str) -> [u8; 16] {
    let indices: Vec<u8> = text
        .split(',')
        .map(|index| index.parse().unwrap_or(0x80))
        .collect();
    let unit = (16 / indices.len()) as u8;
    std::array::from_fn(|byte| match indices[byte / usize::from(unit)] {
        0x80 => 0x80,
        index => index * unit + byte as u8 % unit,
    })
}

/// Numbers take the type of their neighbours, or else `wanted`.
fn build_alike(
    b: &mut Builder<'_>,
    params: &[Value],
    trees: &[Tree<'_>],
    wanted: Type,
) -> Vec<Value> {
    let is_number = |tree: &Tree<'_>| matches!(tree, Tree::Atom(atom) if PARAMS.iter().all(|(name, _)| name != atom));
    let typed: Vec<_> = trees
        .iter()
        .map(|tree| (!is_number(tree)).then(|| build(b, params, tree, wanted)))
        .collect();
    let ty = typed
        .iter()
        .flatten()
        .next()
        .map_or(wanted, |&value| b.type_of(value));
    typed
        .into_iter()
        .zip(trees)
        .map(|(value, tree)| value.unwrap_or_else(|| build(b, params, tree, ty)))
        .collect()
}

fn build(b: &mut Builder<'_>, params: &[Value], tree: &Tree<'_>, wanted: Type) -> Value {
    let (name, trees) = match tree {
        Tree::List(name, trees) => (*name, trees),
        Tree::Atom(atom) => {
            return match (PARAMS.iter().position(|(name, _)| name == atom), wanted) {
                (Some(position), _) => params[position],
                (None, F32) => b.const_f32(atom.parse().unwrap()),
                (None, F64) => b.const_f64(atom.parse().unwrap()),
                (None, V128) => b.const_v128(number(atom) as u128),
                (None, _) => b.constant(wanted, number(atom) as u64),
            };
        }
    };
    let mut parts = name.split(':');
    let (name, detail, more) = (parts.next().unwrap(), parts.next(), parts.next());
    let stated = detail.and_then(|detail| named(&[I32, I64, F32, F64, V128], detail));
    if let Some(kind) = load_named(name) {
        let (address, flags) = (build(b, params, &trees[0], I64), trees.len() == 2);
        let flags = if flags {
            AccessFlags::TRAPS
        } else {
            AccessFlags::empty()
        };
        let (offset, access) = (
            more.map_or(0, |offset| number(offset) as i32),
            Access::new(Heap::EVERYTHING, flags),
        );
        return b.insert(
            Op::Load {
                kind,
                address,
                offset,
                access,
            },
            stated.unwrap(),
        );
    }
    if let (Some(op), 1) = (unary_named(name), trees.len()) {
        let operand = build(b, params, &trees[0], wanted);
        let ty = stated.unwrap_or_else(|| match (op, b.type_of(operand)) {
            (Unary::Widen(_), _) | (Unary::Bitcast, F64) => I64,
            (Unary::Wrap | Unary::FloatToInt32Modular, _) | (Unary::Bitcast, F32) => I32,
            (Unary::Promote | Unary::HalfBitsToFloat, _) | (Unary::Bitcast, I64) => F64,
            (Unary::Demote, _) | (Unary::Bitcast, I32) => F32,
            (_, ty) => ty,
        });
        return b.insert(Op::Unary(op, operand), ty);
    }
    let shift = named(VectorShift::ALL, name);
    let first_apart = name == "Select";
    let last_apart = shift.is_some()
        || name == "ReplaceLane"
        || binary_named(name).is_some_and(Binary::is_shift);
    let args = match (first_apart, last_apart) {
        (true, _) => [
            vec![build(b, params, &trees[0], I32)],
            build_alike(b, params, &trees[1..], wanted),
        ]
        .concat(),
        (_, true) => vec![
            build(b, params, &trees[0], wanted),
            build(b, params, &trees[1], I32),
        ],
        _ => build_alike(b, params, trees, wanted),
    };
    let (ty, pair) = (b.type_of(args[0]), || [args[0], args[1]]);
    let exit = Exit {
        token: Token(0),
        state: State::NONE,
    };
    let checked = name
        .strip_prefix("Checked")
        .and_then(|name| named(&[Checked::Add, Checked::Sub, Checked::Mul], name));
    let (op, ty) = if let Some(op) = name
        .strip_prefix("Vector")
        .and_then(|name| named(VectorBinary::ALL, name))
    {
        (Op::VectorBinary(op, pair()), V128)
    } else if let Some(op) = binary_named(name) {
        (Op::Binary(op, pair()), ty)
    } else if let (Some(cond), true) = (named(&Cond::ALL, name), ty.is_int()) {
        (Op::Compare(cond, pair()), I32)
    } else if let Some(cond) = named(&FloatCond::ALL, name) {
        (Op::FloatCompare(cond, pair()), I32)
    } else if let Some(op) = checked {
        (Op::Checked(op, pair(), exit), ty)
    } else if let Some(op) = named(VectorUnary::ALL, name) {
        (Op::VectorUnary(op, args[0]), V128)
    } else if let Some(op) = named(VectorBinary::ALL, name) {
        (Op::VectorBinary(op, pair()), V128)
    } else if let Some(op) = named(VectorTernary::ALL, name) {
        (Op::VectorTernary(op, [args[0], args[1], args[2]]), V128)
    } else if let Some(op) = named(VectorReduce::ALL, name) {
        (Op::VectorReduce(op, args[0]), I32)
    } else if let Some(op) = shift {
        (Op::VectorShift(op, pair()), V128)
    } else {
        let lane = || number(more.unwrap()) as u8;
        return match name {
            "Select" => b.insert(Op::Select([args[0], args[1], args[2]]), b.type_of(args[1])),
            "Shuffle" => b.shuffle(args[0], args[1], pattern(detail.unwrap())),
            "Splat" => b.splat(lanes_named(detail.unwrap()), args[0]),
            "ExtractLane" => {
                b.extract_lane(lanes_named(detail.unwrap()), Unsigned, args[0], lane())
            }
            "ReplaceLane" => b.replace_lane(lanes_named(detail.unwrap()), args[0], lane(), args[1]),
            _ => panic!("no operation is named {name}"),
        };
    };
    b.insert(op, ty)
}

fn function_for(text: &str, wanted: Type) -> (Function, Type) {
    let mut function = Function::new(RegisterSet::EMPTY);
    function.set_results(&[Boundary::Frame(16)]);
    let place =
        |(position, &(_, ty)): (i32, &(&str, Type))| (ty, Boundary::Frame(16 + 16 * position));
    let params: Vec<_> = (0..).zip(&PARAMS).map(place).collect();
    let entry = function.add_entry(&params);
    let params = function.params(entry).to_vec();
    let spaced = text.replace('[', " [ ").replace(']', " ] ");
    let mut b = Builder::at_end(&mut function, entry);
    let result = build(
        &mut b,
        &params,
        &parse(&mut spaced.split_whitespace()).unwrap(),
        wanted,
    );
    let ty = b.type_of(result);
    b.ret(&[result]);
    (function, ty)
}

/// The same for expressions that differ in the order of operands only.
fn describe(function: &Function, value: Value) -> String {
    let mut op = *function.op(value);
    let mut operands: Vec<String> = op
        .inline_operands()
        .iter()
        .map(|&operand| describe(function, operand))
        .collect();
    if operands.len() == 2 && operands[0] > operands[1] {
        let commutes = match &mut op {
            Op::Binary(op, _) => op.is_commutative(),
            Op::VectorBinary(op, _) => op.is_commutative(),
            Op::Checked(op, ..) => *op != Checked::Sub,
            Op::Compare(cond, _) => {
                *cond = cond.commuted();
                true
            }
            Op::FloatCompare(cond, _) => {
                *cond = cond.commuted();
                true
            }
            _ => false,
        };
        if commutes {
            operands.swap(0, 1);
        }
    }
    op.inline_operands_mut().fill(Value::NONE);
    let head = match op {
        Op::Param(position) => return PARAMS[position as usize].0.into(),
        Op::ConstV128(bits) => return format!("{:#x}", function.vector_constant(bits)),
        Op::Shuffle(_, pattern) => format!(
            "Shuffle{:?}",
            function.vector_constant(pattern).to_le_bytes()
        ),
        op => format!("{op:?}").replace("none", "_"),
    };
    format!(
        "[{head}:{:?} {}]",
        function.type_of(value),
        operands.join(" ")
    )
}

fn result_of(function: &Function) -> String {
    let end = function.last(function.entries()[0].block);
    describe(function, function.operands(end)[0])
}

#[test]
fn expressions_become_what_is_expected() {
    let (x64, arm64) = (
        Target::X64(X64Features::all()),
        Target::Arm64(Arm64Features::all()),
    );
    let mut failures = Vec::new();
    let lines = include_str!("expressions.txt").lines();
    for line in lines.filter(|line| !line.is_empty() && !line.starts_with('#')) {
        let (case, conditions) = line.split_once(" if ").unwrap_or((line, ""));
        let (given, expected) = case.split_once(" => ").unwrap_or((case, case));
        let passes: &[&str] = if conditions.contains("regrouped") {
            &["simplify", "reassociate", "simplify"]
        } else {
            &["simplify"]
        };
        for (target, unless) in [(x64, "arm64"), (arm64, "x64")] {
            for (quiets_nans, unless_also) in [(false, " quieting"), (true, "not quieting")] {
                let asks_for_quieting =
                    conditions.contains("quieting") && !conditions.contains("not quieting");
                if conditions.contains(unless)
                    || if quiets_nans {
                        conditions.contains(unless_also)
                    } else {
                        asks_for_quieting
                    }
                {
                    continue;
                }
                let (mut function, ty) = function_for(given, I32);
                function.quiets_nans = quiets_nans;
                let mut analyses = Analyses::default();
                passes
                    .iter()
                    .for_each(|name| pass_named(name).run(&mut function, &mut analyses, target));
                let (actual, expected) = (
                    result_of(&function),
                    result_of(&function_for(expected, ty).0),
                );
                if actual != expected {
                    failures.push(format!("{line}\n    {target:?} gives {actual}"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
