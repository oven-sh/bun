//! `bun:test` runtime — Jest-compatible test runner, `expect()` matchers,
//! snapshot machinery, and fake timers.

// ─── pure-Rust leaf (no JSC) — always compiles ───────────────────────────
pub(crate) mod diff {
    // mod-rs path rule: inline `mod diff` + `#[path]` → test_runner/diff/<file>
    #[path = "printDiff.rs"]
    pub(crate) mod print_diff;
}

// ─── JSC-heavy core ──────────────────────────────────────────────────────
// `cfg_jsc!` is a historical no-op grouping macro kept so the 18 module decls
// stay one logical unit (and so a future `#[cfg]` can be re-introduced at a
// single token if `bun_jsc` ever needs to be feature-gated again).
macro_rules! cfg_jsc { ($($i:item)*) => { $( $i )* }; }

cfg_jsc! {
    #[path = "bun_test.rs"]       pub(crate) mod bun_test;
    #[path = "Collection.rs"]     pub(crate) mod collection;
    #[path = "debug.rs"]          pub(crate) mod debug;
    #[path = "diff_format.rs"]    pub(crate) mod diff_format;
    #[path = "dom_format.rs"]     pub(crate) mod dom_format;
    #[path = "DoneCallback.rs"]   pub(crate) mod done_callback;
    #[path = "environment.rs"]    pub(crate) mod environment;
    #[path = "Execution.rs"]      pub(crate) mod execution;
    pub(crate) mod expect;
    #[path = "jest.rs"]           pub(crate) mod jest;
    #[path = "module_mock.rs"]    mod module_mock;
    #[path = "Order.rs"]          pub(crate) mod order;
    #[path = "pretty_format.rs"]  pub(crate) mod pretty_format;
    #[path = "ScopeFunctions.rs"] pub(crate) mod scope_functions;
    #[path = "snapshot.rs"]       pub(crate) mod snapshot;
    #[path = "test_context.rs"]   pub(crate) mod test_context;
    #[path = "test_context_around.rs"] pub(crate) mod test_context_around;
    #[path = "test_context_fixtures.rs"] pub(crate) mod test_context_fixtures;
    #[path = "test_context_parameter.rs"] mod test_context_parameter;
    #[path = "vi_utils.rs"]       pub(crate) mod vi_utils;
    #[path = "vi_wait.rs"]        pub(crate) mod vi_wait;
}

cfg_jsc! {
    pub(crate) mod timers {
        #[path = "FakeTimers.rs"] pub(crate) mod fake_timers;
    }
}

// public surface for `crate::test_runner::*` consumers
cfg_jsc! {
    pub(crate) use done_callback::DoneCallback;
    pub(crate) use expect::{
        Expect, ExpectAny, ExpectAnything, ExpectArrayContaining, ExpectCloseTo,
        ExpectCustomAsymmetricMatcher, ExpectMatcherContext, ExpectMatcherUtils,
        ExpectObjectContaining, ExpectStatic, ExpectStringContaining, ExpectStringMatching,
        ExpectTypeOf,
    };
}
