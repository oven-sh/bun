//! What the macro assemblers say about scratch registers and destinations is exactly so.

#[path = "support/shuffles.rs"]
mod shuffles;
mod support;
#[path = "support/vectors.rs"]
mod vectors;

use std::fmt::Debug;

use bun_engine_asm::{
    Address, Arm64Features, FloatWidth, Fpr, Gpr, Options, Reuse, Scratch, ScratchNeeds, Size,
    TestCond, VectorAssembly, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary,
    X64Features, arm64, lanes, x64,
};

struct Case<M> {
    name: String,
    sources: usize,
    needs: ScratchNeeds,
    reuse: Reuse,
    /// The queries are about all of these together.
    variants: Vec<Box<dyn Fn(&mut M, [Fpr; 4])>>,
}

fn case<M>(
    name: impl Debug,
    sources: usize,
    needs: ScratchNeeds,
    reuse: Reuse,
    emit: impl Fn(&mut M, [Fpr; 4]) + 'static,
) -> Case<M> {
    Case {
        name: format!("{name:?}"),
        sources,
        needs,
        reuse,
        variants: vec![Box::new(emit)],
    }
}

fn cases<M: VectorAssembly>(features: M::Features) -> Vec<Case<M>> {
    let (x, none) = (Gpr::new(0), ScratchNeeds::default());
    let mut all = Vec::new();
    for &op in VectorUnary::ALL {
        all.push(case(
            op,
            1,
            M::scratch_for_unary(features, op),
            M::reuse_for_unary(features, op),
            move |masm: &mut M, [d, a, ..]| masm.vector_unary(op, d, a),
        ));
    }
    for &op in VectorBinary::ALL {
        all.push(case(
            op,
            2,
            M::scratch_for_binary(features, op),
            M::reuse_for_binary(features, op),
            move |masm: &mut M, [d, a, b, _]| masm.vector_binary(op, d, a, b),
        ));
    }
    for &op in VectorTernary::ALL {
        all.push(case(
            op,
            3,
            M::scratch_for_ternary(features, op),
            M::reuse_for_ternary(features, op),
            move |masm: &mut M, [d, a, b, c]| masm.vector_ternary(op, d, a, b, c),
        ));
    }
    for &op in VectorShift::ALL {
        all.push(case(
            op,
            1,
            M::scratch_for_shift(features, op, false),
            M::reuse_for_shift(features),
            move |masm: &mut M, [d, a, ..]| masm.vector_shift(op, d, a, x),
        ));
        let by = |amount: u8| {
            move |masm: &mut M, [d, a, ..]: [Fpr; 4]| {
                masm.vector_shift(op, d, a, amount);
            }
        };
        let needs = M::scratch_for_shift(features, op, true);
        let mut by_constant = case(op, 1, needs, M::reuse_for_shift(features), by(3));
        for amount in 1..op.lanes().bits() {
            by_constant.variants.push(Box::new(by(amount)));
        }
        all.push(by_constant);
    }
    for &op in VectorReduce::ALL {
        all.push(case(
            op,
            1,
            M::scratch_for_reduce(features, op),
            Reuse::empty(),
            move |masm: &mut M, [_, a, ..]| masm.vector_reduce(op, x, a),
        ));
    }
    all.push(case(
        "branch",
        1,
        M::scratch_for_branch_test(features),
        Reuse::empty(),
        |masm: &mut M, [_, a, ..]| {
            let target = masm.here();
            masm.branch_test_vector(TestCond::Zero, a, target);
        },
    ));
    let reuse = M::reuse_for_replace_lane(features);
    for size in [Size::S8, Size::S16, Size::S32, Size::S64] {
        all.push(case(
            size,
            1,
            none,
            reuse,
            move |masm: &mut M, [d, a, ..]| {
                masm.replace_int_lane(size, d, a, 1, x);
            },
        ));
        all.push(case(
            size,
            1,
            none,
            reuse,
            move |masm: &mut M, [d, a, ..]| {
                masm.load_vector_lane(size, d, a, 1, Address::new(x, 0));
            },
        ));
    }
    for width in [FloatWidth::F32, FloatWidth::F64] {
        // There may be an instruction that joins two halves.
        for lane in 0..lanes::count(width.width().size()) - 1 {
            all.push(case(
                width,
                1,
                none,
                reuse,
                move |masm: &mut M, [d, a, b, _]| {
                    masm.replace_float_lane(width, d, a, lane, b);
                },
            ));
        }
    }
    let random = &mut vectors::Random(1);
    let patterns = [
        shuffles::with_names(),
        shuffles::prepared_lanes(),
        shuffles::of_wide_lanes().into_iter().step_by(11).collect(),
        shuffles::near_names(300, random),
        shuffles::random(300, random),
    ];
    for pattern in patterns.into_iter().flatten() {
        all.push(case(
            pattern,
            2,
            M::scratch_for_shuffle(features, pattern),
            M::reuse_for_shuffle(features, pattern),
            move |masm: &mut M, [d, a, b, _]| masm.vector_shuffle(d, a, b, pattern),
        ));
    }
    all
}

fn instructions<M: VectorAssembly>(
    features: M::Features,
    scratch: Scratch,
    emit: impl FnOnce(&mut M),
) -> Vec<u8> {
    let mut masm = M::new(Options {
        features,
        shorten_jumps: false,
        seed: 0,
    });
    masm.set_scratch(scratch);
    emit(&mut masm);
    masm.breakpoint();
    let code = masm.finish().unwrap();
    code.bytes()[..code.instructions_end() as usize].to_vec()
}

const SOURCES: [Fpr; 3] = [Fpr::new(1), Fpr::new(3), Fpr::new(5)];
const DESTINATIONS: [Fpr; 4] = [Fpr::new(7), SOURCES[0], SOURCES[1], SOURCES[2]];
const SCRATCH: Scratch = Scratch {
    gprs: [Some(Gpr::new(6)), Some(Gpr::new(7))],
    fprs: [Some(Fpr::new(9)), Some(Fpr::new(11))],
};

/// A register is used if the code changes with it.
fn check_scratch<M: VectorAssembly>(features: M::Features, case: &Case<M>) {
    let mut others = [SCRATCH; 4];
    others[0].gprs[0] = Some(Gpr::new(3));
    others[1].gprs[1] = Some(Gpr::new(3));
    others[2].fprs[0] = Some(Fpr::new(13));
    others[3].fprs[1] = Some(Fpr::new(13));
    let mut used = [false; 4];
    let [a, b, c] = SOURCES;
    let sharing = [[a, b, c], [a, a, c], [a, b, a], [a, b, b], [a, a, a]];
    for emit in &case.variants {
        for &dst in &DESTINATIONS[..=case.sources] {
            for &[a, b, c] in &sharing[..[1, 2, 5][case.sources - 1]] {
                let code =
                    |scratch| instructions(features, scratch, |masm| emit(masm, [dst, a, b, c]));
                let usual = code(SCRATCH);
                for (used, other) in used.iter_mut().zip(others) {
                    *used |= code(other) != usual;
                }
            }
        }
    }
    let ScratchNeeds { gprs, fprs } = case.needs;
    assert!(gprs <= 1 && fprs <= 2, "{}", case.name);
    let declared = [gprs > 0, gprs > 1, fprs > 0, fprs > 1];
    assert_eq!(used, declared, "{}", case.name);
}

fn check_reuse<M: VectorAssembly>(
    features: M::Features,
    arguments: &[&str],
    missing: &[&str],
    cases: &[Case<M>],
) {
    let [a, b, c] = SOURCES;
    let mut bytes = Vec::new();
    for case in cases {
        for &dst in &DESTINATIONS[..=case.sources] {
            let emit = &case.variants[0];
            bytes.extend(instructions(features, SCRATCH, |masm| {
                emit(masm, [dst, a, b, c])
            }));
        }
    }
    let Some(lines) = support::disassemble(arguments, &bytes) else {
        return;
    };
    for line in &lines {
        assert!(
            !missing.iter().any(|start| line.starts_with(start)),
            "{line}"
        );
    }
    let mut listings = lines.split(|line| line == "int3" || line.starts_with("brk"));
    for case in cases {
        let listings: Vec<_> = listings.by_ref().take(1 + case.sources).collect();
        let least = listings.iter().map(|listing| listing.len()).min().unwrap();
        let mut best = Reuse::empty();
        for (listing, reuse) in listings[1..].iter().zip(Reuse::all()) {
            best.set(reuse, listing.len() == least && listings[0].len() != least);
        }
        assert_eq!(case.reuse, best, "{}: {listings:#?}", case.name);
    }
}

/// `missing` has the starts of the instructions that take other features.
fn check<M: VectorAssembly>(features: M::Features, arguments: &[&str], missing: &[&str]) {
    let cases = cases::<M>(features);
    for case in &cases {
        check_scratch(features, case);
    }
    check_reuse(features, arguments, missing, &cases);
}

const X64: [&str; 2] = ["-triple=x86_64", "--output-asm-variant=1"];

#[test]
fn x64_with_sse() {
    check::<x64::MacroAssembler>(X64Features::empty(), &X64, &["v"]);
}

#[test]
fn x64_with_what_is_of_no_use_without_avx() {
    check::<x64::MacroAssembler>(X64Features::AVX2 | X64Features::FMA, &X64, &["v"]);
}

#[test]
fn x64_with_avx() {
    check::<x64::MacroAssembler>(X64Features::AVX, &X64, &["vf", "vpbroadcast"]);
}

#[test]
fn x64_with_everything() {
    check::<x64::MacroAssembler>(X64Features::all(), &X64, &[]);
}

#[test]
fn arm64_with_nothing_more() {
    check::<arm64::MacroAssembler>(Arm64Features::empty(), &support::ARM64, &["sdot"]);
}

#[test]
fn arm64_with_everything() {
    check::<arm64::MacroAssembler>(Arm64Features::all(), &support::ARM64, &[]);
}
