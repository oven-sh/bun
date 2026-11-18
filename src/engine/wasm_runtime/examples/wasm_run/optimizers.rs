use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use bun_engine_wasm_compiler::optimize::{CallFeedback, Feedback, InliningBudget, Level};
use bun_engine_wasm_compiler::{CompiledFunction, Environment};
use bun_engine_wasm_format::CodeIndex;
use bun_engine_wasm_runtime::{Compilers, Optimizer};

use crate::support::baseline_without_counters;

static NANOSECONDS: AtomicU64 = AtomicU64::new(0);
static COMPILATIONS: [AtomicU64; 2] = [const { AtomicU64::new(0) }; 2];

/// Most calls are hot, and indirect ones seem to go anywhere.
struct Fake<'a> {
    real: &'a dyn Feedback,
    functions: u32,
    seed: u64,
}

impl Feedback for Fake<'_> {
    fn entry_count(&self, _: CodeIndex) -> u32 {
        1000
    }

    fn loop_turns(&self, code: CodeIndex, index: u32) -> u32 {
        let key = self.seed ^ (u64::from(code.0) << 20) ^ u64::from(index);
        [0, 1000, 1000, 100_000][(key.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 62) as usize]
    }

    fn call(&self, code: CodeIndex, site: u32) -> CallFeedback {
        let key = self.seed ^ (u64::from(code.0) << 20) ^ u64::from(site);
        let mut random = key.wrapping_add(1).wrapping_mul(0x9e37_79b9_7f4a_7c15);
        let targets = 1 + (random >> 62) as u32;
        let target = |_| {
            random = (random ^ random >> 29).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            (
                CodeIndex((random >> 32) as u32 % self.functions),
                1000 / targets,
            )
        };
        let mut targets: Vec<_> = (0..targets).map(target).collect();
        targets.sort_unstable();
        targets.dedup();
        CallFeedback {
            count: [1000, 1000, 1000, 10][(random >> 20 & 3) as usize],
            targets: targets.into_iter().collect(),
        }
    }

    fn inlining_budget(&self) -> InliningBudget {
        self.real.inlining_budget()
    }
}

fn optimize<const IS_FULL: bool, const FAKES: bool>(
    compilers: &mut Compilers,
    env: &Environment<'_>,
    code: CodeIndex,
    loop_entry: Option<u32>,
    real: &dyn Feedback,
) -> Option<CompiledFunction> {
    let fake = Fake {
        real,
        functions: env.module.code_count(),
        seed: env.seed,
    };
    let feedback = if FAKES { &fake } else { real };
    let level = if IS_FULL { Level::Full } else { Level::Quick };
    let start = Instant::now();
    let compiled = (compilers.optimizing).compile(env, code, loop_entry, level, feedback);
    NANOSECONDS.fetch_add(start.elapsed().as_nanos() as u64, Ordering::Relaxed);
    COMPILATIONS[usize::from(compiled.is_err())].fetch_add(1, Ordering::Relaxed);
    compiled.ok()
}

pub(crate) fn report() {
    let [done, refused] = COMPILATIONS.each_ref().map(|it| it.load(Ordering::Relaxed));
    let time = NANOSECONDS.load(Ordering::Relaxed) as f64 / 1e6;
    eprintln!("optimize: {time:.3} ms, {done} done, {refused} refused");
}

pub(crate) fn named(name: &str, fakes_feedback: bool) -> Option<Optimizer> {
    Some(match (name, fakes_feedback) {
        ("full", false) => optimize::<true, false>,
        ("full", true) => optimize::<true, true>,
        ("quick", false) => optimize::<false, false>,
        ("quick", true) => optimize::<false, true>,
        ("baseline", _) => baseline_without_counters,
        _ => return None,
    })
}
