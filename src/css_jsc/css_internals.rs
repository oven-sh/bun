use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_ast::Log;
use bun_css::ParserFlags;
use bun_css::targets::{Browsers, Targets};
use bun_jsc::bindgen::{JsLocal, JsScope};

use crate::JsResult;
use crate::generated_bindgen::css_internals::{
    BrowserTargets, CssParserFlag, CssParserOptions, CssTestOutput,
};

// `adt_const_params` is unstable, so the test kind is passed as a runtime
// value (the bodies branch on it anyway; no codegen difference for this fn).
#[derive(PartialEq, Eq, Clone, Copy)]
pub(crate) enum TestKind {
    Normal,
    Minify,
    Prefix,
}

pub(crate) fn minify_error_test_with_options<'a>(
    cx: &mut JsScope<'a>,
    source: &[u8],
    _: &[u8],
    options: Option<&CssParserOptions>,
) -> JsResult<CssTestOutput<'a>> {
    testing_impl(cx, source, None, parser_flags(options), TestKind::Minify)
}

pub(crate) fn minify_test_with_options<'a>(
    cx: &mut JsScope<'a>,
    source: &[u8],
    _: &[u8],
    options: Option<&CssParserOptions>,
) -> JsResult<CssTestOutput<'a>> {
    testing_impl(cx, source, None, parser_flags(options), TestKind::Minify)
}

pub(crate) fn prefix_test_with_options<'a>(
    cx: &mut JsScope<'a>,
    source: &[u8],
    _: &[u8],
    options: Option<&CssParserOptions>,
) -> JsResult<CssTestOutput<'a>> {
    testing_impl(cx, source, None, parser_flags(options), TestKind::Prefix)
}

pub(crate) fn test_with_options<'a>(
    cx: &mut JsScope<'a>,
    source: &[u8],
    _: &[u8],
    options: Option<&CssParserOptions>,
) -> JsResult<CssTestOutput<'a>> {
    testing_impl(cx, source, None, parser_flags(options), TestKind::Normal)
}

pub(crate) fn minify_test<'a>(
    cx: &mut JsScope<'a>,
    source: &[u8],
    _: &[u8],
    options: Option<&BrowserTargets>,
) -> JsResult<CssTestOutput<'a>> {
    testing_impl(
        cx,
        source,
        options,
        ParserFlags::default(),
        TestKind::Minify,
    )
}

pub(crate) fn prefix_test<'a>(
    cx: &mut JsScope<'a>,
    source: &[u8],
    _: &[u8],
    options: Option<&BrowserTargets>,
) -> JsResult<CssTestOutput<'a>> {
    testing_impl(
        cx,
        source,
        options,
        ParserFlags::default(),
        TestKind::Prefix,
    )
}

pub(crate) fn test<'a>(
    cx: &mut JsScope<'a>,
    source: &[u8],
    _: &[u8],
    options: Option<&BrowserTargets>,
) -> JsResult<CssTestOutput<'a>> {
    testing_impl(
        cx,
        source,
        options,
        ParserFlags::default(),
        TestKind::Normal,
    )
}

fn testing_impl<'a>(
    cx: &mut JsScope<'a>,
    source: &[u8],
    targets: Option<&BrowserTargets>,
    flags: ParserFlags,
    test_kind: TestKind,
) -> JsResult<CssTestOutput<'a>> {
    use bun_ast::ImportRecord;
    use bun_css::{
        DefaultAtRule, ImportRecordHandler, LocalsResultsMap, MinifyOptions, ParserOptions,
        PrinterOptions, StyleSheet,
    };
    use bun_jsc::LogJsc as _;

    let arena = Arena::new();
    // The CSS parser allocates into this bump arena; freed when it drops.
    //
    // SAFETY: `StyleSheet::parse` requires `&'static Bump`
    // because the rule tree stores lifetime-erased refs (see the css_parser.rs
    // notes on `'bump` threading). The arena strictly outlives every value parsed
    // out of it below.
    let alloc: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(&arena) };

    let global = cx.global();
    let browsers = targets.map(Browsers::from);
    let mut log = Log::init();

    let mut parser_options = ParserOptions::default(Some(&mut log));
    parser_options.flags |= flags;

    let mut import_records = Vec::<ImportRecord>::default();
    match StyleSheet::<DefaultAtRule>::parse(
        alloc,
        source,
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

            Ok(CssTestOutput::Code(result.code))
        }
        Err(err) => {
            if log.has_errors() {
                let errors = log.to_js(global, format_args!("parsing failed:"))?;
                return Ok(CssTestOutput::Failure(JsLocal::new(&cx.heap, errors)));
            }
            Err(global.throw(format_args!("parsing failed: {}", err.kind)))
        }
    }
}

fn parser_flags(options: Option<&CssParserOptions>) -> ParserFlags {
    let mut flags = ParserFlags::default();
    for flag in options
        .and_then(|options| options.flags.as_deref())
        .unwrap_or_default()
    {
        match flag {
            CssParserFlag::DeepSelectorCombinator => flags |= ParserFlags::DEEP_SELECTOR_COMBINATOR,
        }
    }
    flags
}

impl From<&BrowserTargets> for Browsers {
    fn from(targets: &BrowserTargets) -> Self {
        Browsers {
            android: targets.android,
            chrome: targets.chrome,
            edge: targets.edge,
            firefox: targets.firefox,
            ie: targets.ie,
            ios_saf: targets.ios_saf,
            opera: targets.opera,
            safari: targets.safari,
            samsung: targets.samsung,
        }
    }
}

pub(crate) fn attr_test<'a>(
    cx: &mut JsScope<'a>,
    source: &[u8],
    _: &[u8],
    minify: bool,
    targets: Option<&BrowserTargets>,
) -> JsResult<CssTestOutput<'a>> {
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

    let global = cx.global();
    let targets = Targets {
        browsers: targets.map(Browsers::from),
        ..Default::default()
    };

    let mut log = Log::init();

    let parser_options = ParserOptions::default(Some(&mut log));

    let mut import_records = Vec::<ImportRecord>::default();
    match StyleAttribute::parse(
        alloc,
        source,
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
                    return Ok(CssTestOutput::Failure(JsLocal::UNDEFINED));
                }
            };

            Ok(CssTestOutput::Code(result.code))
        }
        Err(err) => {
            if log.has_any() {
                let errors = log.to_js(global, format_args!("parsing failed:"))?;
                return Ok(CssTestOutput::Failure(JsLocal::new(&cx.heap, errors)));
            }
            Err(global.throw(format_args!("parsing failed: {}", err.kind)))
        }
    }
}
