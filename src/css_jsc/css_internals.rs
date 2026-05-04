use core::marker::ConstParamTy;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::BabyList;
use bun_css::targets::{Browsers, Targets};
use bun_css::{
    DefaultAtRule, LocalsResultsMap, MinifyOptions, ParserOptions, PrinterOptions, StyleAttribute,
    StyleSheet,
};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_logger::Log;
use bun_options_types::ImportRecord;
use bun_str::String as BunString;
use bun_str::StringJsc as _; // .to_js() extension trait — allowed in *_jsc crate

#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
enum TestKind {
    Normal,
    Minify,
    Prefix,
}

#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
enum TestCategory {
    /// arg is browsers
    Normal,
    /// arg is parser options
    ParserOptions,
}

#[bun_jsc::host_fn]
pub fn minify_error_test_with_options(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    testing_impl::<{ TestKind::Minify }, { TestCategory::ParserOptions }>(global, frame)
}

#[bun_jsc::host_fn]
pub fn minify_test_with_options(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl::<{ TestKind::Minify }, { TestCategory::ParserOptions }>(global, frame)
}

#[bun_jsc::host_fn]
pub fn prefix_test_with_options(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl::<{ TestKind::Prefix }, { TestCategory::ParserOptions }>(global, frame)
}

#[bun_jsc::host_fn]
pub fn test_with_options(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl::<{ TestKind::Normal }, { TestCategory::ParserOptions }>(global, frame)
}

#[bun_jsc::host_fn]
pub fn minify_test(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl::<{ TestKind::Minify }, { TestCategory::Normal }>(global, frame)
}

#[bun_jsc::host_fn]
pub fn prefix_test(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl::<{ TestKind::Prefix }, { TestCategory::Normal }>(global, frame)
}

#[bun_jsc::host_fn]
pub fn _test(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl::<{ TestKind::Normal }, { TestCategory::Normal }>(global, frame)
}

pub fn testing_impl<const TEST_KIND: TestKind, const TEST_CATEGORY: TestCategory>(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arena = Arena::new();
    // PERF(port): was arena bulk-free — CSS parser allocates into this bump

    let arguments_ = frame.arguments_old(3);
    let mut arguments = bun_jsc::ArgumentsSlice::init(global.bun_vm(), arguments_.slice());
    let Some(source_arg) = arguments.next_eat() else {
        return global.throw(format_args!(
            "minifyTestWithOptions: expected 2 arguments, got 0"
        ));
    };
    if !source_arg.is_string() {
        return global.throw(format_args!(
            "minifyTestWithOptions: expected source to be a string"
        ));
    }
    let source_bunstr = source_arg.to_bun_string(global)?;
    let source = source_bunstr.to_utf8();

    let Some(expected_arg) = arguments.next_eat() else {
        return global.throw(format_args!(
            "minifyTestWithOptions: expected 2 arguments, got 1"
        ));
    };
    if !expected_arg.is_string() {
        return global.throw(format_args!(
            "minifyTestWithOptions: expected `expected` arg to be a string"
        ));
    }
    let expected_bunstr = expected_arg.to_bun_string(global)?;
    let _expected = expected_bunstr.to_utf8();

    let browser_options_arg = arguments.next_eat();

    let mut log = Log::init(&arena);

    let mut browsers: Option<Browsers> = None;
    let parser_options = {
        let mut opts = ParserOptions::default(&arena, &mut log);
        // if (test_kind == .prefix) break :parser_options opts;

        match TEST_CATEGORY {
            TestCategory::Normal => {
                if let Some(optargs) = browser_options_arg {
                    if optargs.is_object() {
                        browsers = Some(targets_from_js(global, optargs)?);
                    }
                }
            }
            TestCategory::ParserOptions => {
                if let Some(optargs) = browser_options_arg {
                    if optargs.is_object() {
                        parser_options_from_js(global, &arena, &mut opts, optargs)?;
                    }
                }
            }
        }

        opts
    };

    let mut import_records = BabyList::<ImportRecord>::default();
    match StyleSheet::<DefaultAtRule>::parse(
        &arena,
        source.slice(),
        parser_options,
        &mut import_records,
        bun_bundler::Index::INVALID,
    ) {
        Ok(ret) => {
            let (mut stylesheet, mut extra) = ret;
            let mut minify_options = MinifyOptions::default();
            minify_options.targets.browsers = browsers;
            match stylesheet.minify(&arena, minify_options, &mut extra) {
                Ok(_) => {}
                Err(err) => {
                    return global.throw_value(err.to_error_instance(global)?);
                }
            }

            let symbols = bun_js_parser::symbol::Map::default();
            let mut local_names = LocalsResultsMap::default();
            let result = match stylesheet.to_css(
                &arena,
                PrinterOptions {
                    minify: match TEST_KIND {
                        TestKind::Minify => true,
                        TestKind::Normal => false,
                        TestKind::Prefix => false,
                    },
                    targets: Targets {
                        browsers: minify_options.targets.browsers,
                        ..Default::default()
                    },
                    ..Default::default()
                },
                bun_css::ImportRecordHandler::init_outside_of_bundler(&mut import_records),
                // TODO(port): exact type/module path for `.initOutsideOfBundler` — guessed bun_css::ImportRecordHandler
                &mut local_names,
                &symbols,
            ) {
                Ok(result) => result,
                Err(err) => {
                    return global.throw_value(err.to_error_instance(global)?);
                }
            };

            Ok(BunString::from_bytes(result.code).to_js(global))
        }
        Err(err) => {
            if log.has_errors() {
                return Ok(log.to_js(global, "parsing failed:"));
            }
            global.throw(format_args!("parsing failed: {}", err.kind))
        }
    }
}

fn parser_options_from_js(
    global: &JSGlobalObject,
    _arena: &Arena,
    opts: &mut ParserOptions,
    jsobj: JSValue,
) -> JsResult<()> {
    if let Some(val) = jsobj.get_truthy(global, "flags")? {
        if val.is_array() {
            let mut iter = val.array_iterator(global)?;
            while let Some(item) = iter.next()? {
                let bunstr = item.to_bun_string(global)?;
                let str = bunstr.to_utf8();
                if str.slice() == b"DEEP_SELECTOR_COMBINATOR" {
                    opts.flags.deep_selector_combinator = true;
                } else {
                    return global.throw(format_args!(
                        "invalid flag: {}",
                        bstr::BStr::new(str.slice())
                    ));
                }
            }
        } else {
            return global.throw(format_args!("flags must be an array"));
        }
    }

    // if (try jsobj.getTruthy(globalThis, "css_modules")) |val| {
    //     opts.css_modules = bun.css.css_modules.Config{
    //
    //     };
    //     if (val.isObject()) {
    //         if (try val.getTruthy(globalThis, "pure")) |pure_val| {
    //             opts.css_modules.pure = pure_val.toBoolean();
    //         }
    //     }
    // }

    Ok(())
}

fn targets_from_js(global: &JSGlobalObject, jsobj: JSValue) -> JsResult<Browsers> {
    let mut targets = Browsers::default();

    if let Some(val) = jsobj.get_truthy(global, "android")? {
        if val.is_int32() {
            if let Some(value) = val.get_number() {
                // note: Rust `as` saturates on overflow/NaN where Zig is UB
                targets.android = Some(value as u32);
            }
        }
    }
    if let Some(val) = jsobj.get_truthy(global, "chrome")? {
        if val.is_int32() {
            if let Some(value) = val.get_number() {
                targets.chrome = Some(value as u32);
            }
        }
    }
    if let Some(val) = jsobj.get_truthy(global, "edge")? {
        if val.is_int32() {
            if let Some(value) = val.get_number() {
                targets.edge = Some(value as u32);
            }
        }
    }
    if let Some(val) = jsobj.get_truthy(global, "firefox")? {
        if val.is_int32() {
            if let Some(value) = val.get_number() {
                targets.firefox = Some(value as u32);
            }
        }
    }
    if let Some(val) = jsobj.get_truthy(global, "ie")? {
        if val.is_int32() {
            if let Some(value) = val.get_number() {
                targets.ie = Some(value as u32);
            }
        }
    }
    if let Some(val) = jsobj.get_truthy(global, "ios_saf")? {
        if val.is_int32() {
            if let Some(value) = val.get_number() {
                targets.ios_saf = Some(value as u32);
            }
        }
    }
    if let Some(val) = jsobj.get_truthy(global, "opera")? {
        if val.is_int32() {
            if let Some(value) = val.get_number() {
                targets.opera = Some(value as u32);
            }
        }
    }
    if let Some(val) = jsobj.get_truthy(global, "safari")? {
        if val.is_int32() {
            if let Some(value) = val.get_number() {
                targets.safari = Some(value as u32);
            }
        }
    }
    if let Some(val) = jsobj.get_truthy(global, "samsung")? {
        if val.is_int32() {
            if let Some(value) = val.get_number() {
                targets.samsung = Some(value as u32);
            }
        }
    }

    Ok(targets)
}

#[bun_jsc::host_fn]
pub fn attr_test(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arena = Arena::new();

    let arguments_ = frame.arguments_old(4);
    let mut arguments = bun_jsc::ArgumentsSlice::init(global.bun_vm(), arguments_.slice());
    let Some(source_arg) = arguments.next_eat() else {
        return global.throw(format_args!("attrTest: expected 3 arguments, got 0"));
    };
    if !source_arg.is_string() {
        return global.throw(format_args!("attrTest: expected source to be a string"));
    }
    let source_bunstr = source_arg.to_bun_string(global)?;
    let source = source_bunstr.to_utf8();

    let Some(expected_arg) = arguments.next_eat() else {
        return global.throw(format_args!("attrTest: expected 3 arguments, got 1"));
    };
    if !expected_arg.is_string() {
        return global.throw(format_args!(
            "attrTest: expected `expected` arg to be a string"
        ));
    }
    let expected_bunstr = expected_arg.to_bun_string(global)?;
    let _expected = expected_bunstr.to_utf8();

    let Some(minify_arg) = arguments.next_eat() else {
        return global.throw(format_args!("attrTest: expected 3 arguments, got 2"));
    };
    let minify = minify_arg.is_boolean() && minify_arg.to_boolean();

    let mut targets = Targets::default();
    if let Some(arg) = arguments.next_eat() {
        if arg.is_object() {
            targets.browsers = Some(targets_from_js(global, arg)?);
        }
    }

    let mut log = Log::init(&arena);

    let parser_options = ParserOptions::default(&arena, &mut log);

    let mut import_records = BabyList::<ImportRecord>::default();
    match StyleAttribute::parse(
        &arena,
        source.slice(),
        parser_options,
        &mut import_records,
        bun_bundler::Index::INVALID,
    ) {
        Ok(stylesheet_) => {
            let mut stylesheet = stylesheet_;
            let mut minify_options = MinifyOptions::default();
            minify_options.targets = targets;
            stylesheet.minify(&arena, minify_options);

            let result = match stylesheet.to_css(
                &arena,
                PrinterOptions {
                    minify,
                    targets,
                    ..Default::default()
                },
                bun_css::ImportRecordHandler::init_outside_of_bundler(&mut import_records),
                // TODO(port): exact type/module path for `.initOutsideOfBundler`
            ) {
                Ok(r) => r,
                Err(_e) => {
                    // Zig: bun.handleErrorReturnTrace(e, @errorReturnTrace()); return .js_undefined;
                    // TODO(port): handleErrorReturnTrace — debug-only error trace dump; no Rust equivalent yet
                    return Ok(JSValue::UNDEFINED);
                }
            };

            Ok(BunString::from_bytes(result.code).to_js(global))
        }
        Err(err) => {
            if log.has_any() {
                return Ok(log.to_js(global, "parsing failed:"));
            }
            global.throw(format_args!("parsing failed: {}", err.kind))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css_jsc/css_internals.zig (341 lines)
//   confidence: medium
//   todos:      3
//   notes:      bun_css result types mapped to Ok/Err; .initOutsideOfBundler enum-literal type guessed; Browsers fields assumed Option<u32>
// ──────────────────────────────────────────────────────────────────────────
