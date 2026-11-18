mod support;

use bun_engine_codegen::ir::validate;
use bun_engine_codegen::passes::{Analyses, Level, Pass, peel_loops};
use support::harness::{Case, Order, Passes, Subject, World, campaign};
use support::random::Random;

#[test]
fn full_pipeline_keeps_behaviour() {
    campaign(600, || Passes::new(Order::Pipeline(Level::Full)));
}

#[test]
fn quick_pipeline_keeps_behaviour() {
    campaign(300, || Passes::new(Order::Pipeline(Level::Quick)));
}

#[test]
fn each_pass_alone_keeps_behaviour() {
    campaign(300, || Passes::new(Order::Single));
}

#[test]
fn passes_in_any_order_keep_behaviour() {
    campaign(600, || Passes::new(Order::Random));
}

struct Peeling;

impl Subject for Peeling {
    fn world(&mut self, seed: u64) -> World {
        World::imaginary(seed)
    }

    fn test(&mut self, case: &Case) -> Result<(), String> {
        let (mut function, mut analyses) = (case.program.function.clone(), Analyses::default());
        let mut random = Random::new(case.seed);
        Pass::CONSTRUCT_SSA.run(&mut function, &mut analyses, case.world.target);
        if random.flip() {
            Pass::SIMPLIFY.run(&mut function, &mut analyses, case.world.target);
        }
        let before = function.clone();
        peel_loops(&mut function, &mut analyses, |_, _, _| random.percent(70));
        validate(&function)
            .and_then(|()| case.check(&function))
            .map_err(|problem| format!("{problem}\nbefore:\n{before:?}\nafter:\n{function:?}"))
    }
}

#[test]
fn peeling_keeps_behaviour() {
    campaign(600, || Peeling);
}
