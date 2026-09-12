use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_ast::Log;
use bun_css::targets::{Browsers, Targets};
use bun_jsc::bun_string_jsc;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue};

use crate::JsResult;

// `adt_const_params` is unstable, so the test kind is passed as a runtime
// value (the bodies branch on it anyway; no codegen difference for this fn).
#[derive(PartialEq, Eq, Clone, Copy)]
pub(crate) enum TestKind {
    Normal,
    Minify,
    Prefix,
}

#[derive(PartialEq, Eq, Clone, Copy)]
pub(crate) enum TestCategory {
    /// arg is browsers
    Normal,
    /// arg is parser options
    ParserOptions,
}

// These test-only wrappers are consumed as plain safe fns through
// `dispatch_js2native.rs` re-exports, so they don't use the
// `#[bun_jsc::host_fn]` C-ABI shim.

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

/// Shared arg-validation for the test-only CSS internals: pulls the next arg,
/// throws "{fn_name}: expected {expected_n} arguments, got {got_n}" if absent,
/// throws "{fn_name}: expected {arg_label} to be a string" if not a string,
/// otherwise returns the +1-ref `bun_core::String`.
/// Caller does `.to_utf8()` (borrows the bun_core::String, so can't be returned here).
fn eat_string_arg(
    arguments: &mut bun_jsc::ArgumentsSlice<'_>,
    global: &JSGlobalObject,
    fn_name: &str,
    expected_n: u32,
    got_n: u32,
    arg_label: &str,
) -> JsResult<bun_core::String> {
    let Some(arg) = arguments.next_eat() else {
        return Err(global.throw(format_args!(
            "{fn_name}: expected {expected_n} arguments, got {got_n}"
        )));
    };
    if !arg.is_string() {
        return Err(global.throw(format_args!(
            "{fn_name}: expected {arg_label} to be a string"
        )));
    }
    arg.to_bun_string(global)
}

fn testing_impl(
    global: &JSGlobalObject,
    frame: &CallFrame,
    test_kind: TestKind,
    test_category: TestCategory,
) -> JsResult<JSValue> {
    use bun_ast::ImportRecord;
    use bun_css::{
        DefaultAtRule, ImportRecordHandler, LocalsResultsMap, MinifyOptions, ParserOptions,
        PrinterOptions, StyleSheet,
    };
    use bun_jsc::LogJsc as _;

    let arena = Arena::new();
    // The CSS parser allocates into this bump arena; freed when it drops.
    //
    // SAFETY: `StyleSheet::parse` requires `&'static Bump` / `ParserOptions<'static>`
    // because the rule tree stores lifetime-erased refs (see the css_parser.rs
    // notes on `'bump` threading). The arena strictly outlives every value parsed
    // out of it below.
    let alloc: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(&arena) };

    // SAFETY: bunVM() never returns null for a Bun-owned global; reborrow the
    // raw `*mut VirtualMachine` as a shared ref for the slice's lifetime.
    let mut arguments = bun_jsc::ArgumentsSlice::init(global.bun_vm(), frame.arguments());
    let source_bunstr = eat_string_arg(
        &mut arguments,
        global,
        "minifyTestWithOptions",
        2,
        0,
        "source",
    )?;
    let source = source_bunstr.to_utf8();

    let expected_bunstr = eat_string_arg(
        &mut arguments,
        global,
        "minifyTestWithOptions",
        2,
        1,
        "`expected` arg",
    )?;
    let _expected = expected_bunstr.to_utf8();

    let browser_options_arg = arguments.next_eat();

    let mut log = Log::init();
    // SAFETY: `ParserOptions<'static>` stores the log as `NonNull<Log>` and only
    // writes through it during parsing; `log` outlives the parsed stylesheet and
    // is not aliased for the duration. Erasing to `'static` matches the
    // `&'static Bump` erasure above (re-threads to `'bump` with the rest of bun_css).
    let log_ptr: *mut Log = &raw mut log;
    // SAFETY: `log` is a stack-local that outlives the parsed stylesheet and
    // is not aliased for the duration of the parse.
    let log_ref = unsafe { &mut *log_ptr };

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
        bun_ast::Index::INVALID,
    ) {
        Ok(ret) => {
            let (mut stylesheet, extra) = ret;
            let mut minify_options = MinifyOptions::default();
            minify_options.targets.browsers = browsers;
            match stylesheet.minify(alloc, &minify_options, &extra) {
                Ok(_) => {}
                Err(err) => {
                    return Err(global
                        .throw_value(global.create_error_instance(format_args!("{}", err.kind))));
                }
            }

            let symbols = bun_ast::symbol::Map::init_list(Default::default());
            let local_names = LocalsResultsMap::default();
            let result = match stylesheet.to_css(
                alloc,
                &PrinterOptions {
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
                Some(ImportRecordHandler::init_outside_of_bundler(
                    &import_records,
                )),
                Some(&local_names),
                &symbols,
            ) {
                Ok(result) => result,
                Err(err) => {
                    return Err(global
                        .throw_value(global.create_error_instance(format_args!("{}", err.kind))));
                }
            };

            bun_string_jsc::create_utf8_for_js(global, &result.code)
        }
        Err(err) => {
            if log.has_errors() {
                return log.to_js(global, format_args!("parsing failed:"));
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
                let bunstr = item.to_bun_string(global)?;
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

    Ok(())
}

fn targets_from_js(global: &JSGlobalObject, jsobj: JSValue) -> JsResult<Browsers> {
    let mut targets = Browsers::default();

    // Table-driven loop. Key order matters: it determines JS getter/exception
    // ordering.
    for (key, slot) in [
        ("android", &mut targets.android),
        ("chrome", &mut targets.chrome),
        ("edge", &mut targets.edge),
        ("firefox", &mut targets.firefox),
        ("ie", &mut targets.ie),
        ("ios_saf", &mut targets.ios_saf),
        ("opera", &mut targets.opera),
        ("safari", &mut targets.safari),
        ("samsung", &mut targets.samsung),
    ] {
        if let Some(val) = jsobj.get_truthy(global, key)? {
            if val.is_int32() {
                if let Some(value) = val.get_number() {
                    // `as` saturates on overflow/NaN
                    *slot = Some(value as u32);
                }
            }
        }
    }

    Ok(targets)
}

pub fn css_modules_test(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_ast::ImportRecord;
    use bun_css::css_modules::{Config as CssModulesConfig, CssModuleReference};
    use bun_css::{
        DefaultAtRule, ImportRecordHandler, LocalsResultsMap, ParserOptions, PrinterOptions,
        StyleSheet,
    };
    use bun_jsc::{LogJsc as _, StringJsc as _};

    let arena = Arena::new();
    // SAFETY: same `'bump`-erasure as `testing_impl` above.
    let alloc: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(&arena) };

    let mut arguments = bun_jsc::ArgumentsSlice::init(global.bun_vm(), frame.arguments());
    let source_bunstr = eat_string_arg(&mut arguments, global, "cssModulesTest", 1, 0, "source")?;
    let source = source_bunstr.to_utf8();

    let mut log = Log::init();
    let log_ptr: *mut Log = &raw mut log;
    // SAFETY: `log` outlives the parsed stylesheet.
    let log_ref = unsafe { &mut *log_ptr };

    let mut opts = ParserOptions::default(Some(log_ref));
    opts.filename = b"test.module.css";
    opts.css_modules = Some(CssModulesConfig::default());

    let mut import_records = Vec::<ImportRecord>::default();
    let (stylesheet, extra) = match StyleSheet::<DefaultAtRule>::parse(
        alloc,
        source.slice(),
        opts,
        Some(&mut import_records),
        bun_ast::Index::init(0),
    ) {
        Ok(ret) => ret,
        Err(err) => {
            if log.has_errors() {
                return log.to_js(global, "parsing failed:");
            }
            return Err(global.throw(format_args!("parsing failed: {}", err.kind)));
        }
    };

    let symbols = bun_ast::symbol::Map::init_with_one_list(extra.symbols);
    let local_names = LocalsResultsMap::default();
    let result = match stylesheet.to_css(
        alloc,
        &PrinterOptions::default(),
        Some(ImportRecordHandler::init_outside_of_bundler(
            &import_records,
        )),
        Some(&local_names),
        &symbols,
    ) {
        Ok(result) => result,
        Err(err) => {
            return Err(global.throw_value(crate::error_jsc::to_error_instance(&err, global)?));
        }
    };

    let ret = JSValue::create_empty_object(global, 2);
    ret.put(
        global,
        b"code",
        BunString::from_bytes(&result.code).to_js(global)?,
    );

    let exports_obj = JSValue::create_empty_object(global, 0);
    if let Some(exports) = &result.exports {
        for (key, export) in exports.iter() {
            let entry = JSValue::create_empty_object(global, 2);
            entry.put(
                global,
                b"name",
                BunString::from_bytes(export.name).to_js(global)?,
            );
            let composes_arr =
                JSValue::create_array_from_iter(global, export.composes.iter(), |reference| {
                    let obj = JSValue::create_empty_object(global, 3);
                    match reference {
                        CssModuleReference::Local { name } => {
                            obj.put(
                                global,
                                b"type",
                                BunString::from_bytes(b"local").to_js(global)?,
                            );
                            obj.put(global, b"name", BunString::from_bytes(name).to_js(global)?);
                        }
                        CssModuleReference::Global { name } => {
                            obj.put(
                                global,
                                b"type",
                                BunString::from_bytes(b"global").to_js(global)?,
                            );
                            obj.put(global, b"name", BunString::from_bytes(name).to_js(global)?);
                        }
                        CssModuleReference::Dependency { name, specifier } => {
                            obj.put(
                                global,
                                b"type",
                                BunString::from_bytes(b"dependency").to_js(global)?,
                            );
                            obj.put(global, b"name", BunString::from_bytes(name).to_js(global)?);
                            obj.put(
                                global,
                                b"specifier",
                                BunString::from_bytes(specifier).to_js(global)?,
                            );
                        }
                    }
                    Ok(obj)
                })?;
            entry.put(global, b"composes", composes_arr);
            exports_obj.put(global, *key, entry);
        }
    }
    ret.put(global, b"exports", exports_obj);

    Ok(ret)
}

pub fn attr_test(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_ast::ImportRecord;
    use bun_css::{
        ImportRecordHandler, MinifyOptions, ParserOptions, PrinterOptions, StyleAttribute,
    };
    use bun_jsc::LogJsc as _;

    let arena = Arena::new();
    // StyleAttribute::parse allocates its
    // AST into this bump; freed when `arena` drops at end of scope.
    //
    // SAFETY: `StyleAttribute` stores `DeclarationBlock<'static>` (lifetime
    // erased crate-wide until 'bump threads through the rule tree — see the
    // css_parser.rs notes). The arena strictly outlives the parsed
    // `stylesheet` below.
    let alloc: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(&arena) };

    // SAFETY: bunVM() never returns null for a Bun-owned global.
    let mut arguments = bun_jsc::ArgumentsSlice::init(global.bun_vm(), frame.arguments());
    let source_bunstr = eat_string_arg(&mut arguments, global, "attrTest", 3, 0, "source")?;
    let source = source_bunstr.to_utf8();

    let expected_bunstr =
        eat_string_arg(&mut arguments, global, "attrTest", 3, 1, "`expected` arg")?;
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
        &parser_options,
        &mut import_records,
        bun_ast::Index::INVALID,
    ) {
        Ok(stylesheet_) => {
            let mut stylesheet = stylesheet_;
            let minify_options = MinifyOptions {
                targets,
                ..Default::default()
            };
            stylesheet.minify(minify_options);

            let result = match stylesheet.to_css(
                alloc,
                &PrinterOptions {
                    minify,
                    targets,
                    ..Default::default()
                },
                Some(ImportRecordHandler::init_outside_of_bundler(
                    &import_records,
                )),
            ) {
                Ok(r) => r,
                Err(_e) => {
                    // The error is intentionally swallowed here.
                    return Ok(JSValue::UNDEFINED);
                }
            };

            bun_string_jsc::create_utf8_for_js(global, &result.code)
        }
        Err(err) => {
            if log.has_any() {
                return log.to_js(global, format_args!("parsing failed:"));
            }
            Err(global.throw(format_args!("parsing failed: {}", err.kind)))
        }
    }
}
