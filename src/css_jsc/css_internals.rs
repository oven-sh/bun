use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::VecExt;
use bun_css::targets::{Browsers, Targets};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue};
use bun_logger::Log;
use bun_string::{OwnedString, String as BunString};

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
    use bun_css::{
        DefaultAtRule, ImportRecordHandler, LocalsResultsMap, MinifyOptions, ParserOptions,
        PrinterOptions, SrcIndex, StyleSheet,
    };
    use bun_jsc::{LogJsc as _, StringJsc as _};
    use bun_options_types::ImportRecord;

    let arena = Arena::new();
    // PERF(port): was arena bulk-free — CSS parser allocates into this bump
    //
    // SAFETY: `StyleSheet::parse` requires `&'static Bump` / `ParserOptions<'static>`
    // because the rule tree stores lifetime-erased refs (see css_parser.rs PORT
    // NOTE on `'bump` threading). The arena strictly outlives every value parsed
    // out of it below, so erasing `&arena -> &'static Bump` here matches the
    // crate-wide `unsafe { &*(allocator as *const Bump) }` pattern.
    let alloc: &'static Arena = unsafe { &*(&raw const arena) };

    let arguments_ = frame.arguments_old::<3>();
    // SAFETY: bunVM() never returns null for a Bun-owned global; reborrow the
    // raw `*mut VirtualMachine` as a shared ref for the slice's lifetime.
    let mut arguments =
        bun_jsc::ArgumentsSlice::init(global.bun_vm(), arguments_.slice());
    let Some(source_arg) = arguments.next_eat() else {
        return Err(global.throw(format_args!(
            "minifyTestWithOptions: expected 2 arguments, got 0"
        )));
    };
    if !source_arg.is_string() {
        return Err(global.throw(format_args!(
            "minifyTestWithOptions: expected source to be a string"
        )));
    }
    // Zig: `defer source_bunstr.deref()` — `to_bun_string` returns a +1 ref and
    // `bun_string::String` is `Copy` (no `Drop`), so wrap in `OwnedString` for RAII release.
    let source_bunstr = OwnedString::new(source_arg.to_bun_string(global)?);
    let source = source_bunstr.to_utf8();

    let Some(expected_arg) = arguments.next_eat() else {
        return Err(global.throw(format_args!(
            "minifyTestWithOptions: expected 2 arguments, got 1"
        )));
    };
    if !expected_arg.is_string() {
        return Err(global.throw(format_args!(
            "minifyTestWithOptions: expected `expected` arg to be a string"
        )));
    }
    // Zig: `defer expected_bunstr.deref()`
    let expected_bunstr = OwnedString::new(expected_arg.to_bun_string(global)?);
    let _expected = expected_bunstr.to_utf8();

    let browser_options_arg = arguments.next_eat();

    let mut log = Log::init();
    // SAFETY: `ParserOptions<'static>` stores the log as `NonNull<Log>` and only
    // writes through it during parsing; `log` outlives the parsed stylesheet and
    // is not aliased for the duration. Erasing to `'static` matches the
    // `&'static Bump` erasure above (re-threads to `'bump` with the rest of bun_css).
    let log_ref = unsafe { &mut *(&raw mut log) };

    let mut browsers: Option<Browsers> = None;
    let parser_options = {
        let mut opts = ParserOptions::default(Some(log_ref));
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

    let mut import_records = Vec::<ImportRecord>::default();
    match StyleSheet::<DefaultAtRule>::parse(
        alloc,
        source.slice(),
        parser_options,
        Some(&mut import_records),
        SrcIndex::INVALID,
    ) {
        Ok(ret) => {
            let (mut stylesheet, extra) = ret;
            let mut minify_options = MinifyOptions::default();
            minify_options.targets.browsers = browsers;
            match stylesheet.minify(alloc, &minify_options, &extra) {
                Ok(_) => {}
                Err(err) => {
                    return Err(
                        global.throw_value(crate::error_jsc::to_error_instance(&err, global)?)
                    );
                }
            }

            let symbols = bun_logger::symbol::Map::init_list(Default::default());
            let local_names = LocalsResultsMap::default();
            let result = match stylesheet.to_css(
                alloc,
                PrinterOptions {
                    minify: match test_kind {
                        TestKind::Minify => true,
                        TestKind::Normal => false,
                        TestKind::Prefix => false,
                    },
                    targets: Targets {
                        browsers,
                        ..Default::default()
                    },
                    ..Default::default()
                },
                Some(ImportRecordHandler::init_outside_of_bundler(&import_records)),
                Some(&local_names),
                &symbols,
            ) {
                Ok(result) => result,
                Err(err) => {
                    return Err(
                        global.throw_value(crate::error_jsc::to_error_instance(&err, global)?)
                    );
                }
            };

            BunString::from_bytes(&result.code).to_js(global)
        }
        Err(err) => {
            if log.has_errors() {
                return log.to_js(global, "parsing failed:");
            }
            Err(global.throw(format_args!("parsing failed: {}", err.kind)))
        }
    }
}

fn parser_options_from_js(
    global: &JSGlobalObject,
    _arena: &Arena,
    opts: &mut bun_css::ParserOptions,
    jsobj: JSValue,
) -> JsResult<()> {
    if let Some(val) = jsobj.get_truthy(global, b"flags")? {
        if val.is_array() {
            let mut iter = val.array_iterator(global)?;
            while let Some(item) = iter.next()? {
                // Zig: `defer bunstr.deref()` — release the +1 ref each iteration.
                let bunstr = OwnedString::new(item.to_bun_string(global)?);
                let str = bunstr.to_utf8();
                if str.slice() == b"DEEP_SELECTOR_COMBINATOR" {
                    opts.flags |= bun_css::ParserFlags::DEEP_SELECTOR_COMBINATOR;
                } else {
                    return Err(global.throw(format_args!(
                        "invalid flag: {}",
                        bstr::BStr::new(str.slice())
                    )));
                }
            }
        } else {
            return Err(global.throw(format_args!("flags must be an array")));
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

    if let Some(val) = jsobj.get_truthy(global, b"android")? {
            if val.is_int32() {
                if let Some(value) = val.get_number() {
                    // note: Rust `as` saturates on overflow/NaN where Zig is UB
                    targets.android = Some(value as u32);
                }
            }
        }
    if let Some(val) = jsobj.get_truthy(global, b"chrome")? {
            if val.is_int32() {
                if let Some(value) = val.get_number() {
                    targets.chrome = Some(value as u32);
                }
            }
        }
    if let Some(val) = jsobj.get_truthy(global, b"edge")? {
            if val.is_int32() {
                if let Some(value) = val.get_number() {
                    targets.edge = Some(value as u32);
                }
            }
        }
    if let Some(val) = jsobj.get_truthy(global, b"firefox")? {
            if val.is_int32() {
                if let Some(value) = val.get_number() {
                    targets.firefox = Some(value as u32);
                }
            }
        }
    if let Some(val) = jsobj.get_truthy(global, b"ie")? {
            if val.is_int32() {
                if let Some(value) = val.get_number() {
                    targets.ie = Some(value as u32);
                }
            }
        }
    if let Some(val) = jsobj.get_truthy(global, b"ios_saf")? {
            if val.is_int32() {
                if let Some(value) = val.get_number() {
                    targets.ios_saf = Some(value as u32);
                }
            }
        }
    if let Some(val) = jsobj.get_truthy(global, b"opera")? {
            if val.is_int32() {
                if let Some(value) = val.get_number() {
                    targets.opera = Some(value as u32);
                }
            }
        }
    if let Some(val) = jsobj.get_truthy(global, b"safari")? {
            if val.is_int32() {
                if let Some(value) = val.get_number() {
                    targets.safari = Some(value as u32);
                }
            }
        }
    if let Some(val) = jsobj.get_truthy(global, b"samsung")? {
        if val.is_int32() {
            if let Some(value) = val.get_number() {
                targets.samsung = Some(value as u32);
            }
        }
    }

    Ok(targets)
}

pub fn attr_test(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_css::{
        ImportRecordHandler, MinifyOptions, ParserOptions, PrinterOptions, SrcIndex, StyleAttribute,
    };
    use bun_jsc::{LogJsc as _, StringJsc as _};
    use bun_options_types::ImportRecord;

    let arena = Arena::new();
    // PERF(port): was arena bulk-free — StyleAttribute::parse allocates its
    // AST into this bump; freed when `arena` drops at end of scope.
    //
    // SAFETY: `StyleAttribute` stores `DeclarationBlock<'static>` (lifetime
    // erased crate-wide until 'bump threads through the rule tree — see
    // css_parser.rs PORT NOTE). The arena strictly outlives the parsed
    // `stylesheet` below, so erasing `&arena -> &'static Bump` here matches
    // the existing `unsafe { &*(allocator as *const Bump) }` pattern in
    // bun_css (declaration.rs / context.rs / css_parser.rs).
    let alloc: &'static Arena = unsafe { &*(&raw const arena) };

    let arguments_ = frame.arguments_old::<4>();
    // SAFETY: bunVM() never returns null for a Bun-owned global.
    let mut arguments =
        bun_jsc::ArgumentsSlice::init(global.bun_vm(), arguments_.slice());
    let Some(source_arg) = arguments.next_eat() else {
        return Err(global.throw(format_args!("attrTest: expected 3 arguments, got 0")));
    };
    if !source_arg.is_string() {
        return Err(global.throw(format_args!("attrTest: expected source to be a string")));
    }
    // Zig: `defer source_bunstr.deref()` — `to_bun_string` returns a +1 ref;
    // `bun_string::String` is `Copy` (no `Drop`), so wrap in `OwnedString` for RAII release.
    let source_bunstr = OwnedString::new(source_arg.to_bun_string(global)?);
    let source = source_bunstr.to_utf8();

    let Some(expected_arg) = arguments.next_eat() else {
        return Err(global.throw(format_args!("attrTest: expected 3 arguments, got 1")));
    };
    if !expected_arg.is_string() {
        return Err(global.throw(format_args!(
            "attrTest: expected `expected` arg to be a string"
        )));
    }
    // Zig: `defer expected_bunstr.deref()`
    let expected_bunstr = OwnedString::new(expected_arg.to_bun_string(global)?);
    let _expected = expected_bunstr.to_utf8();

    let Some(minify_arg) = arguments.next_eat() else {
        return Err(global.throw(format_args!("attrTest: expected 3 arguments, got 2")));
    };
    let minify = minify_arg.is_boolean() && minify_arg.to_boolean();

    let mut targets = Targets::default();
    if let Some(arg) = arguments.next_eat() {
        if arg.is_object() {
            targets.browsers = Some(targets_from_js(global, arg)?);
        }
    }

    let mut log = Log::init();

    let parser_options = ParserOptions::default(Some(&mut log));

    let mut import_records = Vec::<ImportRecord>::default();
    match StyleAttribute::parse(
        alloc,
        source.slice(),
        parser_options,
        &mut import_records,
        SrcIndex::INVALID,
    ) {
        Ok(stylesheet_) => {
            let mut stylesheet = stylesheet_;
            let mut minify_options = MinifyOptions::default();
            minify_options.targets = targets;
            stylesheet.minify(minify_options);

            let result = match stylesheet.to_css(
                alloc,
                PrinterOptions {
                    minify,
                    targets,
                    ..Default::default()
                },
                Some(ImportRecordHandler::init_outside_of_bundler(&import_records)),
            ) {
                Ok(r) => r,
                Err(_e) => {
                    // Zig: bun.handleErrorReturnTrace(e, @errorReturnTrace()); return .js_undefined;
                    // TODO(port): handleErrorReturnTrace — debug-only error trace dump; no Rust equivalent yet
                    return Ok(JSValue::UNDEFINED);
                }
            };

            BunString::from_bytes(&result.code).to_js(global)
        }
        Err(err) => {
            if log.has_any() {
                return log.to_js(global, "parsing failed:");
            }
            Err(global.throw(format_args!("parsing failed: {}", err.kind)))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css_jsc/css_internals.zig (341 lines)
//   confidence: medium
//   notes:      const-generic comptime enums lowered to runtime params (adt_const_params unstable); host_fn attribute removed pending proc-macro; bodies un-gated against bun_css::stylesheet_impl (StyleSheet/StyleAttribute parse·minify·to_css).
// ──────────────────────────────────────────────────────────────────────────
