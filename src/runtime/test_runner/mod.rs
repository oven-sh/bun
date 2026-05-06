//! `bun:test` runtime — Jest-compatible test runner, `expect()` matchers,
//! snapshot machinery, and fake timers.
//!
//! Phase B-2 un-gate round: module tree is real; matcher bodies are real
//! (each `expect/to*.rs` carries its full ported logic). The whole subtree
//! is JSC-dense (every matcher takes `&JSGlobalObject` + `&CallFrame` and
//! calls `JSValue` methods), so it stays behind `` until
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
// TODO(b2-blocked): bun_jsc — drop every `` below once
// `bun_jsc.workspace = true` is uncommented in src/runtime/Cargo.toml.
// Nothing inside is body-stubbed; the whole tree goes live at once.
//
// `cfg_jsc!` lets us flip one token instead of 18.
macro_rules! cfg_jsc { ($($i:item)*) => { $( $i )* }; }

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
    pub fn get_signature(
        matcher_name: &'static str,
        args: &'static str,
        not: bool,
    ) -> &'static str {
        Expect::get_signature(matcher_name, args, not)
    }

    /// Const-context twin of `get_signature` — Zig's `getSignature` is a
    /// `comptime` fn (.zig:103-109) that concatenates string literals. Rust
    /// has no const-fn string concat, so call sites that need a `&'static
    /// str` constant (e.g. inside `const_format::concatcp!`) use this macro
    /// instead. `use super::get_signature;` imports both the fn (value
    /// namespace) and this macro (macro namespace), so runtime callers keep
    /// `get_signature(...)` and const callers write `get_signature!(...)`.
    macro_rules! __get_signature {
        ($matcher:expr, $args:expr, true $(,)?) => {
            ::const_format::concatcp!(
                "<d>expect(<r><red>received<r><d>).<r>not<d>.<r>",
                $matcher, "<d>(<r>", $args, "<d>)<r>",
            )
        };
        ($matcher:expr, $args:expr, false $(,)?) => {
            ::const_format::concatcp!(
                "<d>expect(<r><red>received<r><d>).<r>",
                $matcher, "<d>(<r>", $args, "<d>)<r>",
            )
        };
    }
    pub(crate) use __get_signature as get_signature;

    // ── shims over `bun_jsc` API gaps ─────────────────────────────────
    // The Phase-A matcher drafts were written against a slightly newer
    // `bun_jsc` surface (`JSValue::to_fmt`, `Formatter: Default`,
    // `JSGlobalObject::throw_pretty`, `BigIntCompare`, etc.). Rather than
    // touch 75 files we provide thin extension traits / aliases here so the
    // drafts compile unchanged. Each shim is `// TODO(port)`-tagged for
    // Phase B once the upstream method lands in `bun_jsc`.

    use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult};
    use bun_jsc::console_object::Formatter;
    use bun_jsc::console_object::formatter::ZigFormatter;

    /// `value.to_fmt(&mut formatter)` → `Display` adapter (Zig
    /// `value.toFmt(&formatter)`). Returns the `ZigFormatter` wrapper.
    pub trait JSValueTestExt {
        fn to_fmt<'a, 'b>(self, f: &'a mut Formatter<'b>) -> ZigFormatter<'a, 'b>;
        fn jest_deep_equals(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool>;
        fn jest_strict_deep_equals(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool>;
        fn jest_deep_match(self, other: JSValue, global: &JSGlobalObject, replace_props: bool) -> JsResult<bool>;
        fn is_reg_exp(self) -> bool;
        fn as_big_int_compare(self, other: JSValue, global: &JSGlobalObject) -> BigIntCompare;
        // ── Phase-D shims for matcher drafts (TODO(port): land in bun_jsc) ──
        fn values(self, global: &JSGlobalObject) -> JsResult<JSValue>;
        fn keys(self, global: &JSGlobalObject) -> JsResult<JSValue>;
        fn is_instance_of(self, global: &JSGlobalObject, constructor: JSValue) -> JsResult<bool>;
        fn has_own_property_value(self, global: &JSGlobalObject, key: JSValue) -> JsResult<bool>;
        fn is_uint32_as_any_int(self) -> bool;
        fn is_big_int32(self) -> bool;
        fn is_constructor(self) -> bool;
        fn is_object_empty(self, global: &JSGlobalObject) -> JsResult<bool>;
        fn get_length_if_property_exists_internal(self, global: &JSGlobalObject) -> JsResult<f64>;
        fn get_if_property_exists_from_path(self, global: &JSGlobalObject, path: JSValue) -> JsResult<JSValue>;
        fn string_includes(self, global: &JSGlobalObject, needle: JSValue) -> JsResult<bool>;
        fn to_match(self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool>;
        fn to_u32(self) -> u32;
    }
    impl JSValueTestExt for JSValue {
        #[inline]
        fn to_fmt<'a, 'b>(self, f: &'a mut Formatter<'b>) -> ZigFormatter<'a, 'b> {
            ZigFormatter::new(f, self)
        }
        #[inline]
        fn jest_deep_equals(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool> {
            JSValue::jest_deep_equals(self, other, global)
        }
        #[inline]
        fn jest_strict_deep_equals(self, other: JSValue, global: &JSGlobalObject) -> JsResult<bool> {
            JSValue::jest_strict_deep_equals(self, other, global)
        }
        #[inline]
        fn jest_deep_match(self, other: JSValue, global: &JSGlobalObject, replace_props: bool) -> JsResult<bool> {
            JSValue::jest_deep_match(self, other, global, replace_props)
        }
        #[inline]
        fn is_reg_exp(self) -> bool {
            self.is_cell() && self.js_type() == bun_jsc::JSType::RegExpObject
        }
        #[inline]
        fn as_big_int_compare(self, other: JSValue, global: &JSGlobalObject) -> BigIntCompare {
            // Trait kept the Phase-A `(other, global)` ordering; the upstream
            // inherent is `(global, other)` — adapt here so 75 matcher
            // call-sites stay untouched.
            use bun_jsc::ComparisonResult as R;
            match JSValue::as_big_int_compare(self, global, other) {
                R::Equal => BigIntCompare::Equal,
                R::Undefined => BigIntCompare::Undefined,
                R::GreaterThan => BigIntCompare::GreaterThan,
                R::LessThan => BigIntCompare::LessThan,
                R::InvalidComparison => BigIntCompare::Undefined,
            }
        }
        #[inline]
        fn values(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            JSValue::values(self, global)
        }
        #[inline]
        fn keys(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            JSValue::keys(self, global)
        }
        #[inline]
        fn is_instance_of(self, global: &JSGlobalObject, constructor: JSValue) -> JsResult<bool> {
            JSValue::is_instance_of(self, global, constructor)
        }
        #[inline]
        fn has_own_property_value(self, global: &JSGlobalObject, key: JSValue) -> JsResult<bool> {
            Ok(self.get_own_by_value(global, key).is_some())
        }
        #[inline]
        fn is_uint32_as_any_int(self) -> bool {
            self.is_any_int() && self.to_int32() >= 0
        }
        #[inline]
        fn is_big_int32(self) -> bool {
            // TODO(port): JSC has a packed BigInt32 representation; until the FFI lands,
            // treat any BigInt as the heap kind (matchers only branch on parity).
            false
        }
        #[inline]
        fn is_constructor(self) -> bool {
            JSValue::is_constructor(self)
        }
        #[inline]
        fn is_object_empty(self, global: &JSGlobalObject) -> JsResult<bool> {
            JSValue::is_object_empty(self, global)
        }
        #[inline]
        fn get_length_if_property_exists_internal(self, global: &JSGlobalObject) -> JsResult<f64> {
            JSValue::get_length_if_property_exists_internal(self, global)
        }
        #[inline]
        fn get_if_property_exists_from_path(self, global: &JSGlobalObject, path: JSValue) -> JsResult<JSValue> {
            JSValue::get_if_property_exists_from_path(self, global, path)
        }
        #[inline]
        fn string_includes(self, global: &JSGlobalObject, needle: JSValue) -> JsResult<bool> {
            JSValue::string_includes(self, global, needle)
        }
        #[inline]
        fn to_match(self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
            JSValue::to_match(self, global, value)
        }
        #[inline]
        fn to_u32(self) -> u32 {
            self.to_int32() as u32
        }
    }

    /// Result of `JSValue::as_big_int_compare` (Zig `JSBigInt.CompareResult`).
    #[derive(Copy, Clone, PartialEq, Eq)]
    pub enum BigIntCompare { LessThan, Equal, GreaterThan, Undefined }

    /// `global.throw_pretty(fmt, args)` shim — `bun_jsc::JSGlobalObject` only
    /// exposes `throw(args)` today; pretty-fmt rewriting happens in Phase B.
    pub trait JSGlobalObjectTestExt {
        fn throw_pretty(&self, fmt: &str, args: core::fmt::Arguments<'_>) -> JsError;
        fn throw2(&self, fmt: &str, args: core::fmt::Arguments<'_>) -> JsError;
        fn throw_invalid_arguments2(&self, fmt: &str, args: core::fmt::Arguments<'_>) -> JsError;
    }
    impl JSGlobalObjectTestExt for JSGlobalObject {
        #[inline]
        fn throw_pretty(&self, fmt: &str, args: core::fmt::Arguments<'_>) -> JsError {
            // TODO(port): comptime <r>/<d> rewriting — for now forward as-is.
            let _ = fmt;
            self.throw(args)
        }
        #[inline]
        fn throw2(&self, _fmt: &str, args: core::fmt::Arguments<'_>) -> JsError {
            self.throw(args)
        }
        #[inline]
        fn throw_invalid_arguments2(&self, _fmt: &str, args: core::fmt::Arguments<'_>) -> JsError {
            self.throw_invalid_arguments(args)
        }
    }

    /// `super::make_formatter(global_this)`
    /// is the universal matcher pattern; `Formatter` has no `Default` (it
    /// borrows `global_this`), so provide the constructor every matcher
    /// expected.
    #[inline]
    pub fn make_formatter(global: &JSGlobalObject) -> Formatter<'_> {
        let mut f = Formatter::new(global);
        f.quote_strings = true;
        f
    }

    /// Builder-style `.with_quote_strings(bool)` shim — `bun_jsc::Formatter`
    /// exposes `quote_strings` as a public field, not a chained setter. A
    /// handful of Phase-A matcher drafts wrote
    /// `Formatter::new(g).with_quote_strings(true)`.
    pub trait FormatterTestExt: Sized {
        fn with_quote_strings(self, b: bool) -> Self;
    }
    impl<'a> FormatterTestExt for Formatter<'a> {
        #[inline]
        fn with_quote_strings(mut self, b: bool) -> Self { self.quote_strings = b; self }
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
