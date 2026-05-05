use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::BabyList;
use bun_css::targets::{Browsers, Targets};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue};
use bun_logger::Log;
use bun_string::String as BunString;

use crate::JsResult;

// PORTING.md §Dispatch: Zig used `comptime test_kind: enum {...}` — Rust
// `adt_const_params` is unstable, so the enum is passed as a runtime value
// (the bodies branch on it anyway; no codegen difference for this fn).
#[derive(PartialEq, Eq, Clone, Copy)]
pub enum TestKind {
    Normal,
    Minify,
    Prefix,
}

#[derive(PartialEq, Eq, Clone, Copy)]
pub enum TestCategory {
    /// arg is browsers
    Normal,
    /// arg is parser options
    ParserOptions,
}

// `#[bun_jsc::host_fn]` proc-macro not yet available; wrappers are plain fns
// for now and re-gain the attribute when bun_jsc::host_fn lands.
// TODO(b2-blocked): bun_jsc::host_fn (proc-macro attribute)

pub fn minify_error_test_with_options(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    testing_impl(global, frame, TestKind::Minify, TestCategory::ParserOptions)
}

pub fn minify_test_with_options(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl(global, frame, TestKind::Minify, TestCategory::ParserOptions)
}

pub fn prefix_test_with_options(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl(global, frame, TestKind::Prefix, TestCategory::ParserOptions)
}

pub fn test_with_options(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl(global, frame, TestKind::Normal, TestCategory::ParserOptions)
}

pub fn minify_test(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl(global, frame, TestKind::Minify, TestCategory::Normal)
}

pub fn prefix_test(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl(global, frame, TestKind::Prefix, TestCategory::Normal)
}

pub fn _test(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    testing_impl(global, frame, TestKind::Normal, TestCategory::Normal)
}

pub fn testing_impl(
    global: &JSGlobalObject,
    frame: &CallFrame,
    test_kind: TestKind,
    test_category: TestCategory,
) -> JsResult<JSValue> {
    #[cfg(any())]
    {
        // TODO(b2-blocked): bun_jsc::CallFrame::arguments_old
        // TODO(b2-blocked): bun_jsc::ArgumentsSlice
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw / throw_value / bun_vm
        // TODO(b2-blocked): bun_jsc::JSValue::is_string / to_bun_string / is_object
        // TODO(b2-blocked): bun_css::ParserOptions
        // TODO(b2-blocked): bun_css::StyleSheet
        // TODO(b2-blocked): bun_css::DefaultAtRule
        // TODO(b2-blocked): bun_css::MinifyOptions
        // TODO(b2-blocked): bun_css::PrinterOptions
        // TODO(b2-blocked): bun_css::ImportRecordHandler
        // TODO(b2-blocked): bun_css::LocalsResultsMap
        // TODO(b2-blocked): bun_options_types::ImportRecord
        // TODO(b2-blocked): bun_bundler::Index
        // TODO(b2-blocked): bun_string::String::from_bytes
        // TODO(b2-blocked): bun_jsc::StringJsc::to_js
        use bun_css::{
            DefaultAtRule, ImportRecordHandler, LocalsResultsMap, MinifyOptions, ParserOptions,
            PrinterOptions, StyleSheet,
        };
        use bun_options_types::ImportRecord;

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

        let mut log = Log::init();

        let mut browsers: Option<Browsers> = None;
        let parser_options = {
            let mut opts = ParserOptions::default(&arena, &mut log);
            // if (test_kind == .prefix) break :parser_options opts;

            match test_category {
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
                        return global
                            .throw_value(crate::error_jsc::to_error_instance(&err, global)?);
                    }
                }

                let symbols = bun_logger::symbol::Map::default();
                let mut local_names = LocalsResultsMap::default();
                let result = match stylesheet.to_css(
                    &arena,
                    PrinterOptions {
                        minify: match test_kind {
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
                    ImportRecordHandler::init_outside_of_bundler(&mut import_records),
                    // TODO(port): exact type/module path for `.initOutsideOfBundler` — guessed bun_css::ImportRecordHandler
                    &mut local_names,
                    &symbols,
                ) {
                    Ok(result) => result,
                    Err(err) => {
                        return global
                            .throw_value(crate::error_jsc::to_error_instance(&err, global)?);
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
    #[cfg(not(any()))]
    {
        let _ = (global, frame, test_kind, test_category);
        todo!("bun_css_jsc::css_internals::testing_impl — gated on bun_jsc/bun_css surface")
    }
}

#[cfg(any())]
fn parser_options_from_js(
    global: &JSGlobalObject,
    _arena: &Arena,
    opts: &mut bun_css::ParserOptions,
    jsobj: JSValue,
) -> JsResult<()> {
    // TODO(b2-blocked): bun_css::ParserOptions
    // TODO(b2-blocked): bun_jsc::JSValue::get_truthy / is_array / array_iterator / to_bun_string
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
    #[cfg(any())]
    {
        // TODO(b2-blocked): bun_jsc::JSValue::get_truthy / is_int32 / get_number
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

        return Ok(targets);
    }
    let _ = (global, jsobj);
    todo!("bun_css_jsc::css_internals::targets_from_js — gated on bun_jsc::JSValue methods")
}

pub fn attr_test(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(any())]
    {
        // TODO(b2-blocked): bun_jsc::CallFrame::arguments_old
        // TODO(b2-blocked): bun_jsc::ArgumentsSlice
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw / bun_vm
        // TODO(b2-blocked): bun_jsc::JSValue::is_string / to_bun_string / is_boolean / to_boolean / is_object
        // TODO(b2-blocked): bun_css::ParserOptions
        // TODO(b2-blocked): bun_css::StyleAttribute
        // TODO(b2-blocked): bun_css::MinifyOptions
        // TODO(b2-blocked): bun_css::PrinterOptions
        // TODO(b2-blocked): bun_css::ImportRecordHandler
        // TODO(b2-blocked): bun_options_types::ImportRecord
        // TODO(b2-blocked): bun_bundler::Index
        // TODO(b2-blocked): bun_jsc::JSValue::UNDEFINED
        use bun_css::{ImportRecordHandler, MinifyOptions, ParserOptions, PrinterOptions, StyleAttribute};
        use bun_options_types::ImportRecord;

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

        let mut log = Log::init();

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
                    ImportRecordHandler::init_outside_of_bundler(&mut import_records),
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
    #[cfg(not(any()))]
    {
        let _ = (global, frame);
        todo!("bun_css_jsc::css_internals::attr_test — gated on bun_jsc/bun_css surface")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css_jsc/css_internals.zig (341 lines)
//   confidence: medium
//   todos:      see TODO(b2-blocked) markers
//   notes:      const-generic comptime enums lowered to runtime params (adt_const_params unstable); host_fn attribute removed pending proc-macro; fn bodies gated on bun_jsc method surface + bun_css parser types.
// ──────────────────────────────────────────────────────────────────────────
