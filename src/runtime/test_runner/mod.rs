//! `bun:test` runtime — Jest-compatible test runner, `expect()` matchers,
//! snapshot machinery, and fake timers.
//!
//! Module layout: every matcher resolves `Expect`, `get_signature`, `mock`,
//! `DiffFormatter`, `ExpectAny` via `super::*` from the `expect` façade
//! below. The `JSValueTestExt` / `JSGlobalObjectTestExt` extension traits are
//! thin call-convention adapters (the matcher modules were written against a
//! different argument order / arity than the `bun_jsc` inherents that have since landed); every
//! body forwards to the canonical `bun_jsc::JSValue` / `JSGlobalObject`
//! inherent so there is exactly one FFI declaration per symbol.

#![allow(non_snake_case)]

// ─── pure-Rust leaf (no JSC) — always compiles ───────────────────────────
pub mod diff {
    // mod-rs path rule: inline `mod diff` + `#[path]` → test_runner/diff/<file>
    #[path = "diff_match_patch.rs"]
    pub mod diff_match_patch;
    #[path = "printDiff.rs"]
    pub mod print_diff;
}

macro_rules! cfg_jsc { ($($i:item)*) => { $( $i )* }; }

#[macro_export]
macro_rules! unary_predicate_matcher {
    ($method:ident, $name:literal, |$v:ident| $pred:expr) => {
        impl $crate::test_runner::expect_core::Expect {
            #[::bun_jsc::host_fn(method)]
            pub fn $method(
                &self,
                g: &::bun_jsc::JSGlobalObject,
                f: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                self.run_unary_predicate(g, f, $name, |$v: ::bun_jsc::JSValue| $pred)
            }
        }
    };
}

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

    #[path = "expect.rs"]
    pub mod expect_core;
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

    pub mod js {
        ::bun_jsc::codegen_cached_accessors!("Expect"; capturedValue, resultValue);
    }

    #[inline]
    pub fn get_signature(
        matcher_name: &'static str,
        args: &'static str,
        not: bool,
    ) -> &'static str {
        Expect::get_signature(matcher_name, args, not)
    }

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
        fn jest_snapshot_pretty_format<W: bun_io::Write>(self, out: &mut W, global: &JSGlobalObject) -> JsResult<()>;
        fn is_reg_exp(self) -> bool;
        fn as_big_int_compare(self, other: JSValue, global: &JSGlobalObject) -> BigIntCompare;
        // ── forwarders to `bun_jsc::JSValue` inherents (kept on the trait so
        //    matcher drafts importing `JSValueTestExt` resolve them in scope) ──
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
        fn bind(
            self,
            global: &JSGlobalObject,
            bind_this: JSValue,
            name: &bun_core::String,
            length: f64,
            args: &[JSValue],
        ) -> JsResult<JSValue>;
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
        fn jest_snapshot_pretty_format<W: bun_io::Write>(self, out: &mut W, global: &JSGlobalObject) -> JsResult<()> {
            // Port of Zig `JSValue.jestSnapshotPrettyFormat` (JSValue.zig:562).
            use super::pretty_format::{JestPrettyFormat, FormatOptions, MessageLevel};
            let fmt_options = FormatOptions {
                enable_colors: false,
                add_newline: false,
                flush: false,
                quote_strings: true,
            };
            JestPrettyFormat::format(
                MessageLevel::Debug,
                global,
                core::slice::from_ref(&self),
                1,
                out,
                fmt_options,
            )?;
            out.flush().map_err(|e| global.throw_error(e, "snapshot writer flush failed"))?;
            Ok(())
        }
        #[inline]
        fn is_reg_exp(self) -> bool {
            self.is_cell() && self.js_type() == bun_jsc::JSType::RegExpObject
        }
        #[inline]
        fn as_big_int_compare(self, other: JSValue, global: &JSGlobalObject) -> BigIntCompare {
            // Trait keeps the matcher modules' `(other, global)` ordering; the upstream
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
            JSValue::has_own_property_value(self, global, key)
        }
        #[inline]
        fn is_uint32_as_any_int(self) -> bool {
            JSValue::is_uint32_as_any_int(self)
        }
        #[inline]
        fn is_big_int32(self) -> bool {
            // Inherent FFI predicate (`JSC__JSValue__isBigInt32`) — JSC packs
            // small BigInts as immediates; toBeOdd/toBeEven branch on this
            // before the heap-BigInt arm.
            JSValue::is_big_int32(self)
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
            JSValue::to_u32(self)
        }
        #[inline]
        fn bind(
            self,
            global: &JSGlobalObject,
            bind_this: JSValue,
            name: &bun_core::String,
            length: f64,
            args: &[JSValue],
        ) -> JsResult<JSValue> {
            JSValue::bind(self, global, bind_this, name, length, args)
        }
    }

    /// Result of `JSValue::as_big_int_compare` (Zig `JSBigInt.CompareResult`).
    #[derive(Copy, Clone, PartialEq, Eq)]
    pub enum BigIntCompare { LessThan, Equal, GreaterThan, Undefined }

    pub trait JSGlobalObjectTestExt {
        fn throw_pretty(&self, fmt: &str, args: core::fmt::Arguments<'_>) -> JsError;
        fn throw2(&self, fmt: &str, args: core::fmt::Arguments<'_>) -> JsError;
        fn throw_invalid_arguments2(&self, fmt: &str, args: core::fmt::Arguments<'_>) -> JsError;
    }
    impl JSGlobalObjectTestExt for JSGlobalObject {
        #[inline]
        fn throw_pretty(&self, _fmt: &str, args: core::fmt::Arguments<'_>) -> JsError {
            JSGlobalObject::throw_pretty(self, args)
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

    #[inline]
    pub fn make_formatter(global: &JSGlobalObject) -> Formatter<'_> {
        let mut f = Formatter::new(global);
        f.quote_strings = true;
        f
    }

    #[derive(Copy, Clone)]
    pub(super) enum OrderingRelation { Gt, Ge, Lt, Le }

    impl OrderingRelation {
        /// Operator glyph pre-escaped for `throw_pretty` (`<`/`>` would
        /// otherwise be parsed as colour-tag delimiters).
        #[inline]
        fn glyph(self) -> &'static str {
            match self {
                Self::Gt => r"\>",
                Self::Ge => r"\>=",
                Self::Lt => r"\<",
                Self::Le => r"\<=",
            }
        }
        /// number×number arm.
        #[inline]
        fn cmp_f64(self, a: f64, b: f64) -> bool {
            match self {
                Self::Gt => a > b,
                Self::Ge => a >= b,
                Self::Lt => a < b,
                Self::Le => a <= b,
            }
        }
        /// `value.asBigIntCompare(other)` arm — `value` is the BigInt.
        #[inline]
        fn cmp_bigint_fwd(self, r: BigIntCompare) -> bool {
            use BigIntCompare::*;
            match self {
                Self::Gt => matches!(r, GreaterThan),
                Self::Ge => matches!(r, GreaterThan | Equal),
                Self::Lt => matches!(r, LessThan),
                Self::Le => matches!(r, LessThan | Equal),
            }
        }
        /// `other.asBigIntCompare(value)` arm — operands swapped, so the
        /// relation is mirrored (Zig writes this out longhand per-matcher).
        #[inline]
        fn cmp_bigint_rev(self, r: BigIntCompare) -> bool {
            use BigIntCompare::*;
            match self {
                Self::Gt => matches!(r, LessThan),
                Self::Ge => matches!(r, LessThan | Equal),
                Self::Lt => matches!(r, GreaterThan),
                Self::Le => matches!(r, GreaterThan | Equal),
            }
        }
    }

    impl Expect {
        pub(super) fn numeric_ordering_matcher(
            &self,
            global: &JSGlobalObject,
            frame: &bun_jsc::CallFrame,
            name: &'static str,
            rel: OrderingRelation,
        ) -> JsResult<JSValue> {
            // `defer this.postMatch(globalThis)` — run on every exit path.
            let this = scopeguard::guard(self, |this| this.post_match(global));

            let this_value = frame.this();
            let args_buf = frame.arguments_old::<1>();
            let arguments: &[JSValue] = args_buf.slice();

            if arguments.is_empty() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{name}() requires 1 argument"
                )));
            }

            this.increment_expect_call_counter();

            let other_value = arguments[0];
            other_value.ensure_still_alive();

            let value: JSValue =
                this.get_value(global, this_value, name, "<green>expected<r>")?;

            if (!value.is_number() && !value.is_big_int())
                || (!other_value.is_number() && !other_value.is_big_int())
            {
                return Err(global.throw(format_args!(
                    "Expected and actual values must be numbers or bigints"
                )));
            }

            let not = this.flags.get().not();
            let mut pass = if !value.is_big_int() && !other_value.is_big_int() {
                rel.cmp_f64(value.as_number(), other_value.as_number())
            } else if value.is_big_int() {
                rel.cmp_bigint_fwd(JSValueTestExt::as_big_int_compare(value, other_value, global))
            } else {
                rel.cmp_bigint_rev(JSValueTestExt::as_big_int_compare(other_value, value, global))
            };

            if not { pass = !pass; }
            if pass { return Ok(JSValue::UNDEFINED); }

            // failure path — two formatters because `to_fmt` borrows `&mut`.
            let mut f1 = make_formatter(global);
            let mut f2 = make_formatter(global);
            let value_fmt = value.to_fmt(&mut f1);
            let expected_fmt = other_value.to_fmt(&mut f2);
            let glyph = rel.glyph();
            let signature = Expect::get_signature(name, "<green>expected<r>", not);
            if not {
                return this.throw(
                    global,
                    signature,
                    format_args!(
                        "\n\nExpected: not {glyph} <green>{expected_fmt}<r>\nReceived: <red>{value_fmt}<r>\n"
                    ),
                );
            }
            this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected: {glyph} <green>{expected_fmt}<r>\nReceived: <red>{value_fmt}<r>\n"
                ),
            )
        }
    }

    pub trait FormatterTestExt: Sized {
        fn with_quote_strings(self, b: bool) -> Self;
    }
    impl<'a> FormatterTestExt for Formatter<'a> {
        #[inline]
        fn with_quote_strings(mut self, b: bool) -> Self { self.quote_strings = b; self }
    }

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

// ported from: src/runtime/test_runner/
