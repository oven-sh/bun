//! The test tools themselves.

#![allow(clippy::disallowed_macros)]

mod support;

use std::sync::atomic::Ordering::Relaxed;

use support::generator::{Shape, generate};
use support::harness::{Case, Subject, World, campaign, shape_for};

struct Unchanged;

impl Subject for Unchanged {
    fn world(&mut self, seed: u64) -> World {
        World::imaginary(seed)
    }

    fn test(&mut self, case: &Case) -> Result<(), String> {
        case.check(&case.program.function)
            .map_err(|problem| format!("{problem}\n{:?}", case.program.function))
    }
}

#[test]
fn programs_do_what_they_may_and_get_far() {
    let totals = campaign(1000, || Unchanged);
    eprintln!("{totals:?}");
    let runs = totals.runs.load(Relaxed);
    assert!(totals.incomplete.load(Relaxed) * 10 < runs);
    assert!(totals.returns.load(Relaxed) * 3 > runs);
    assert!(totals.covered.load(Relaxed) * 5 > totals.instructions.load(Relaxed) * 3);
}

struct FoldedByBuilder;

impl Subject for FoldedByBuilder {
    fn world(&mut self, seed: u64) -> World {
        World::imaginary(seed)
    }

    fn shape(&mut self, seed: u64) -> Shape {
        Shape {
            folds: false,
            ..shape_for(seed)
        }
    }

    fn test(&mut self, case: &Case) -> Result<(), String> {
        let shape = Shape {
            folds: true,
            ..shape_for(case.seed)
        };
        let folded = generate(case.seed, &shape, case.world.target, &case.world.layout).function;
        case.check(&folded)
            .map_err(|problem| format!("{problem}\n{:?}\n{folded:?}", case.program.function))
    }
}

#[test]
fn the_builder_folds_correctly() {
    campaign(500, || FoldedByBuilder);
}
