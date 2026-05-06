//! `bun:test` runtime — Jest-compatible test runner, `expect()` matchers,
//! snapshot machinery, and fake timers.
//!
//! Phase B-2 un-gate round: module tree is real; matcher bodies are real
//! (each `expect/to*.rs` carries its full ported logic). The whole subtree
//! is JSC-dense (every matcher takes `&JSGlobalObject` + `&CallFrame` and
//! calls `JSValue` methods), so it stays behind `#[cfg(any())]` until
//! `bun_jsc` is re-enabled as a dep of `bun_runtime` (see Cargo.toml
//! `TODO(b2-blocked)`). Flip the gate and 75 matchers + Expect compile
//! together — no per-file stubs.
//!
//! Import normalization done in this round: every matcher resolves `Expect`,
//! `get_signature`, `mock`, `DiffFormatter`, `ExpectAny` via `super::*` so
//! the only outstanding unknowns are `bun_jsc` method-surface gaps (tracked
//! per-file in PORT STATUS trailers).

#![allow(non_snake_case)]

// ─── pure-Rust leaf (no JSC) — always compiles ───────────────────────────
pub mod diff {
    // mod-rs path rule: inline `mod diff` + `#[path]` → test_runner/diff/<file>
    #[path = "diff_match_patch.rs"]
    pub mod diff_match_patch;
    #[path = "printDiff.rs"]
    pub mod print_diff;
}

// ─── JSC-heavy core — gated as one unit on bun_jsc dep ───────────────────
// TODO(b2-blocked): bun_jsc — drop every `#[cfg(any())]` below once
// `bun_jsc.workspace = true` is uncommented in src/runtime/Cargo.toml.
// Nothing inside is body-stubbed; the whole tree goes live at once.
//
// `cfg_jsc!` lets us flip one token instead of 18.
macro_rules! cfg_jsc { ($($i:item)*) => { $( #[cfg(any())] $i )* }; }

cfg_jsc! {
    #[path = "bun_test.rs"]       pub mod bun_test;
    #[path = "Collection.rs"]     pub mod collection;
    #[path = "debug.rs"]          pub mod debug;
    #[path = "diff_format.rs"]    pub mod diff_format;
    #[path = "DoneCallback.rs"]   pub mod done_callback;
    #[path = "Execution.rs"]      pub mod execution;
    #[path = "jest.rs"]           pub mod jest;
    #[path = "Order.rs"]          pub mod order;
    #[path = "pretty_format.rs"]  pub mod pretty_format;
    #[path = "ScopeFunctions.rs"] pub mod scope_functions;
    #[path = "snapshot.rs"]       pub mod snapshot;

    // expect.rs is the umbrella file (Expect struct + asymmetric matchers +
    // ExpectStatic + mock helpers); each `expect/to*.rs` adds one inherent
    // method or free host_fn to `Expect`. Loaded as a private sibling so the
    // `pub mod expect` façade below can layer matcher submodules on top
    // without a directory-level mod.rs.
    #[path = "expect.rs"]
    mod expect_core;
}

cfg_jsc! {
    pub mod harness {
        #[path = "fixtures.rs"] pub mod fixtures;
        #[path = "recover.rs"]  pub mod recover;
    }

    pub mod timers {
        #[path = "FakeTimers.rs"] pub mod fake_timers;
        pub use fake_timers::FakeTimers;
    }
}

cfg_jsc! {
pub mod expect {
    // Re-export the umbrella surface so every matcher can `use super::*`.
    pub use super::expect_core::*;
    pub use super::expect_core::mock;
    pub use super::diff_format::DiffFormatter;

    /// Free-fn alias for `Expect::get_signature` — many Phase-A matcher
    /// drafts imported it as a path item (`use super::get_signature`),
    /// which Rust does not allow for associated fns. Thin shim keeps the
    /// drafts unmodified.
    #[inline]
    pub const fn get_signature(
        matcher_name: &'static str,
        args: &'static str,
        not: bool,
    ) -> &'static bun_str::ZStr {
        Expect::get_signature(matcher_name, args, not)
    }

    // ── matcher modules (75) ──────────────────────────────────────────
    // Each file is `impl Expect { pub fn to_*(..) }` or a free
    // `#[bun_jsc::host_fn(method)] pub fn to_*(this: &mut Expect, ..)`.
    // Bodies are real (un-gated); they exercise the full bun_jsc::JSValue
    // method surface (is_null/is_string/deep_equals/to_fmt/array_iterator
    // /get_length/...). Any method gap surfaces here when `cfg_jsc!` is
    // flipped.
    macro_rules! matchers {
        ( $( $file:literal => $mod:ident ),* $(,)? ) => {
            $( #[path = $file] pub mod $mod; )*
        };
    }
    matchers! {
        "toBe.rs"                               => to_be,
        "toBeArray.rs"                          => to_be_array,
        "toBeArrayOfSize.rs"                    => to_be_array_of_size,
        "toBeBoolean.rs"                        => to_be_boolean,
        "toBeCloseTo.rs"                        => to_be_close_to,
        "toBeDate.rs"                           => to_be_date,
        "toBeDefined.rs"                        => to_be_defined,
        "toBeEmpty.rs"                          => to_be_empty,
        "toBeEmptyObject.rs"                    => to_be_empty_object,
        "toBeEven.rs"                           => to_be_even,
        "toBeFalse.rs"                          => to_be_false,
        "toBeFalsy.rs"                          => to_be_falsy,
        "toBeFinite.rs"                         => to_be_finite,
        "toBeFunction.rs"                       => to_be_function,
        "toBeGreaterThan.rs"                    => to_be_greater_than,
        "toBeGreaterThanOrEqual.rs"             => to_be_greater_than_or_equal,
        "toBeInstanceOf.rs"                     => to_be_instance_of,
        "toBeInteger.rs"                        => to_be_integer,
        "toBeLessThan.rs"                       => to_be_less_than,
        "toBeLessThanOrEqual.rs"                => to_be_less_than_or_equal,
        "toBeNaN.rs"                            => to_be_nan,
        "toBeNegative.rs"                       => to_be_negative,
        "toBeNil.rs"                            => to_be_nil,
        "toBeNull.rs"                           => to_be_null,
        "toBeNumber.rs"                         => to_be_number,
        "toBeObject.rs"                         => to_be_object,
        "toBeOdd.rs"                            => to_be_odd,
        "toBeOneOf.rs"                          => to_be_one_of,
        "toBePositive.rs"                       => to_be_positive,
        "toBeString.rs"                         => to_be_string,
        "toBeSymbol.rs"                         => to_be_symbol,
        "toBeTrue.rs"                           => to_be_true,
        "toBeTruthy.rs"                         => to_be_truthy,
        "toBeTypeOf.rs"                         => to_be_type_of,
        "toBeUndefined.rs"                      => to_be_undefined,
        "toBeValidDate.rs"                      => to_be_valid_date,
        "toBeWithin.rs"                         => to_be_within,
        "toContain.rs"                          => to_contain,
        "toContainAllKeys.rs"                   => to_contain_all_keys,
        "toContainAllValues.rs"                 => to_contain_all_values,
        "toContainAnyKeys.rs"                   => to_contain_any_keys,
        "toContainAnyValues.rs"                 => to_contain_any_values,
        "toContainEqual.rs"                     => to_contain_equal,
        "toContainKey.rs"                       => to_contain_key,
        "toContainKeys.rs"                      => to_contain_keys,
        "toContainValue.rs"                     => to_contain_value,
        "toContainValues.rs"                    => to_contain_values,
        "toEndWith.rs"                          => to_end_with,
        "toEqual.rs"                            => to_equal,
        "toEqualIgnoringWhitespace.rs"          => to_equal_ignoring_whitespace,
        "toHaveBeenCalled.rs"                   => to_have_been_called,
        "toHaveBeenCalledOnce.rs"               => to_have_been_called_once,
        "toHaveBeenCalledTimes.rs"              => to_have_been_called_times,
        "toHaveBeenCalledWith.rs"               => to_have_been_called_with,
        "toHaveBeenLastCalledWith.rs"           => to_have_been_last_called_with,
        "toHaveBeenNthCalledWith.rs"            => to_have_been_nth_called_with,
        "toHaveLastReturnedWith.rs"             => to_have_last_returned_with,
        "toHaveLength.rs"                       => to_have_length,
        "toHaveNthReturnedWith.rs"              => to_have_nth_returned_with,
        "toHaveProperty.rs"                     => to_have_property,
        "toHaveReturned.rs"                     => to_have_returned,
        "toHaveReturnedTimes.rs"                => to_have_returned_times,
        "toHaveReturnedWith.rs"                 => to_have_returned_with,
        "toInclude.rs"                          => to_include,
        "toIncludeRepeated.rs"                  => to_include_repeated,
        "toMatch.rs"                            => to_match,
        "toMatchInlineSnapshot.rs"              => to_match_inline_snapshot,
        "toMatchObject.rs"                      => to_match_object,
        "toMatchSnapshot.rs"                    => to_match_snapshot,
        "toSatisfy.rs"                          => to_satisfy,
        "toStartWith.rs"                        => to_start_with,
        "toStrictEqual.rs"                      => to_strict_equal,
        "toThrow.rs"                            => to_throw,
        "toThrowErrorMatchingInlineSnapshot.rs" => to_throw_error_matching_inline_snapshot,
        "toThrowErrorMatchingSnapshot.rs"       => to_throw_error_matching_snapshot,
    }
}
}

// public surface for `crate::test_runner::*` consumers
cfg_jsc! {
    pub use bun_test::BunTest;
    pub use diff_format::DiffFormatter;
    pub use done_callback::DoneCallback;
    pub use execution::Execution;
    pub use expect::{
        Expect, ExpectAny, ExpectAnything, ExpectArrayContaining, ExpectCloseTo,
        ExpectCustomAsymmetricMatcher, ExpectMatcherContext, ExpectMatcherUtils,
        ExpectObjectContaining, ExpectStatic, ExpectStringContaining, ExpectStringMatching,
        ExpectTypeOf, Flags as ExpectFlags,
    };
    pub use jest::Jest;
    pub use pretty_format::JestPrettyFormat;
    pub use snapshot::Snapshots;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/test_runner/ (12 files + 75 matchers + diff/harness/timers)
//   confidence: medium
//   todos:      1
//   notes:      single-gate on bun_jsc dep (cfg_jsc!); matcher imports normalized to super::*; diff/ is JSC-free and live
// ──────────────────────────────────────────────────────────────────────────
