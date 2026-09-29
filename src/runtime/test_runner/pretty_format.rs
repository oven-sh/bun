//! How `expect.anything()` and its siblings print, in `console.log` as in
//! `bun:test` snapshots and diffs. Everything else about printing a value
//! lives in `bun_jsc::console_object::formatter`.

use bun_jsc::console_object::formatter::TagResult;
use bun_jsc::{FormatTag, Formatter, JSType, JSValue, JsResult};

use super::expect;
use crate::test_runner::expect::JSValueTestExt;

/// `Expect*.js.*GetCached` accessors — generate-classes.ts emits these
/// per-type for `cache: true` props (jest.classes.ts).
/// Rust has no inherent associated modules, so each
/// matcher gets a sibling `expect_js::*` module the same way `mod.rs` does for
/// `Expect`.
mod expect_js {
    pub(super) mod any {
        ::bun_jsc::codegen_cached_accessors!("ExpectAny"; constructorValue);
    }
    pub(super) mod close_to {
        ::bun_jsc::codegen_cached_accessors!("ExpectCloseTo"; numberValue, digitsValue);
    }
    pub(super) mod object_containing {
        ::bun_jsc::codegen_cached_accessors!("ExpectObjectContaining"; objectValue);
    }
    pub(super) mod string_containing {
        ::bun_jsc::codegen_cached_accessors!("ExpectStringContaining"; stringValue);
    }
    pub(super) mod string_matching {
        ::bun_jsc::codegen_cached_accessors!("ExpectStringMatching"; testValue);
    }
    pub(super) mod custom {
        ::bun_jsc::codegen_cached_accessors!("ExpectCustomAsymmetricMatcher"; capturedArgs, matcherFn);
    }
}

fn put(formatter: &mut Formatter<'_>, writer: &mut dyn bun_io::Write, text: &str) {
    formatter.add_for_new_line(text.len());
    let _ = writer.write_all(text.as_bytes());
}

fn put_prefix(
    formatter: &mut Formatter<'_>,
    writer: &mut dyn bun_io::Write,
    flags: expect::Flags,
    name: &str,
    not_name: &str,
) {
    match flags.promise() {
        expect::Promise::Resolves => put(formatter, writer, "promise resolved to "),
        expect::Promise::Rejects => put(formatter, writer, "promise rejected to "),
        expect::Promise::None => {}
    }
    put(formatter, writer, if flags.not() { not_name } else { name });
}

fn print_operand<const ENABLE_ANSI_COLORS: bool>(
    formatter: &mut Formatter<'_>,
    writer: &mut dyn bun_io::Write,
    tag: FormatTag,
    value: JSValue,
    cell: JSType,
) -> JsResult<()> {
    let global = formatter.global_this;
    let tag = TagResult {
        tag: tag.into(),
        cell,
    };
    formatter.format::<ENABLE_ANSI_COLORS>(tag, writer, value, global)
}

/// `Ok(false)` when `value` is not an asymmetric matcher.
pub(crate) fn print_asymmetric_matcher<const ENABLE_ANSI_COLORS: bool>(
    formatter: &mut Formatter<'_>,
    writer: &mut dyn bun_io::Write,
    value: JSValue,
) -> JsResult<bool> {
    if let Some(matcher) = value.as_class_ref::<expect::ExpectAnything>() {
        put_prefix(formatter, writer, matcher.flags.get(), "Anything", "NotAnything");
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectAny>() {
        let Some(constructor_value) = expect_js::any::constructor_value_get_cached(value) else {
            return Ok(true);
        };
        put_prefix(formatter, writer, matcher.flags.get(), "Any<", "NotAny<");
        let class_name = constructor_value.get_class_name(formatter.global_this)?;
        formatter.add_for_new_line(class_name.length());
        let _ = if ENABLE_ANSI_COLORS {
            write!(writer, bun_core::pretty_fmt!("<cyan>{}<r>", true), class_name)
        } else {
            write!(writer, "{class_name}")
        };
        put(formatter, writer, ">");
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCloseTo>() {
        let Some(number_value) = expect_js::close_to::number_value_get_cached(value) else {
            return Ok(true);
        };
        let Some(digits_value) = expect_js::close_to::digits_value_get_cached(value) else {
            return Ok(true);
        };
        let number = number_value.to_int32();
        let digits = digits_value.to_int32();
        put_prefix(
            formatter,
            writer,
            matcher.flags.get(),
            "NumberCloseTo ",
            "NumberNotCloseTo",
        );
        let _ = write!(
            writer,
            "{} ({} digit{})",
            number,
            digits,
            if digits == 1 { "" } else { "s" },
        );
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectObjectContaining>() {
        let Some(object_value) = expect_js::object_containing::object_value_get_cached(value)
        else {
            return Ok(true);
        };
        put_prefix(
            formatter,
            writer,
            matcher.flags.get(),
            "ObjectContaining ",
            "ObjectNotContaining ",
        );
        print_operand::<ENABLE_ANSI_COLORS>(
            formatter,
            writer,
            FormatTag::Object,
            object_value,
            JSType::Object,
        )?;
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringContaining>() {
        let Some(substring_value) = expect_js::string_containing::string_value_get_cached(value)
        else {
            return Ok(true);
        };
        put_prefix(
            formatter,
            writer,
            matcher.flags.get(),
            "StringContaining ",
            "StringNotContaining ",
        );
        print_operand::<ENABLE_ANSI_COLORS>(
            formatter,
            writer,
            FormatTag::String,
            substring_value,
            JSType::String,
        )?;
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringMatching>() {
        let Some(test_value) = expect_js::string_matching::test_value_get_cached(value) else {
            return Ok(true);
        };
        put_prefix(
            formatter,
            writer,
            matcher.flags.get(),
            "StringMatching ",
            "StringNotMatching ",
        );
        let quote_strings = formatter.quote_strings;
        if test_value.is_reg_exp() {
            formatter.quote_strings = false;
        }
        let result = print_operand::<ENABLE_ANSI_COLORS>(
            formatter,
            writer,
            FormatTag::String,
            test_value,
            JSType::String,
        );
        formatter.quote_strings = quote_strings;
        result?;
    } else if let Some(instance) = value.as_class_ref::<expect::ExpectCustomAsymmetricMatcher>() {
        let mut sink: &mut dyn bun_io::Write = &mut *writer;
        let printed = expect::ExpectCustomAsymmetricMatcher::custom_print(
            instance,
            value,
            formatter.global_this,
            &mut sink,
            true,
        )
        .expect("unreachable");
        if printed {
            return Ok(true);
        }
        // Not overridden by the user.
        let Some(args_value) = expect_js::custom::captured_args_get_cached(value) else {
            return Ok(true);
        };
        let Some(matcher_fn) = expect_js::custom::matcher_fn_get_cached(value) else {
            return Ok(true);
        };
        let matcher_name = matcher_fn.get_name(formatter.global_this)?;
        put_prefix(formatter, writer, instance.flags, "", "not ");
        formatter.add_for_new_line(matcher_name.length() + 1);
        let _ = write!(writer, "{matcher_name} ");
        print_operand::<ENABLE_ANSI_COLORS>(
            formatter,
            writer,
            FormatTag::Array,
            args_value,
            JSType::Array,
        )?;
    } else {
        return Ok(false);
    }
    Ok(true)
}
