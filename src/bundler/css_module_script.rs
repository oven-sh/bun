//! CSS module scripts: `import sheet from "./a.css" with { type: "css" }` in a browser bundle.
//!
//! `BundleV2::typed_css_import_loader` gives the file `Loader::CssModuleScript`. `parse` then
//! loads it as a JavaScript module that exports a constructed `CSSStyleSheet`, so the linker
//! needs no knowledge of it. `check_imports` runs after the scan: one path is one module, so it
//! reports a file that another import uses as a stylesheet.

use core::fmt::Write as _;
use std::borrow::Cow;
use std::io::Write as _;

use bun_alloc::Arena as Bump;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, Log, Source};
use bun_core::strings;
use bun_js_parser as js_parser;

use crate::Error as AnyError;
use crate::bun_css;
use crate::bun_css::css_parser::BundlerCssRule;
use crate::bundle_v2::BundleV2;
use crate::mal_prelude::*;
use crate::options::{self, Loader};
use crate::{IndexInt, JSAst};

/// The `?query#fragment` of a `url()`. The resolver finds the file without it.
fn url_suffix(url: &[u8]) -> &[u8] {
    match strings::index_of_any(url, b"?#") {
        Some(i) => &url[i..],
        None => b"",
    }
}

/// Whether the resolver takes `url` for a file. It keeps the other forms as they are.
fn is_file_url(url: &[u8]) -> bool {
    !(url.is_empty()
        || url.starts_with(b"#")
        || url.starts_with(b"//")
        || url.starts_with(b"http://")
        || url.starts_with(b"https://")
        || url.starts_with(b"data:"))
}

/// Appends `text` as the content of a JavaScript template literal.
fn write_template_chars(js: &mut Vec<u8>, text: &[u8]) {
    for &byte in text {
        if matches!(byte, b'\\' | b'`' | b'$') {
            js.push(b'\\');
        }
        js.push(byte);
    }
}

/// Parses a stylesheet and returns the module `export default <CSSStyleSheet of the text>`.
///
/// The text is final here, before the bundler resolves anything. So a `url()` to a file is a
/// `${...}` of an asset import in the module, and an `@import` is dropped, as browsers do.
pub(crate) fn parse(
    log: &mut Log,
    topts: &options::BundleOptions<'_>,
    define: &'static crate::defines::Define,
    opts: js_parser::ParserOptions<'static>,
    bump: &'static Bump,
    source: &'static Source<'static>,
    unique_key_prefix: u64,
) -> Result<JSAst<'static>, AnyError> {
    let mut css_records = Vec::<ImportRecord>::default();
    let mut temp_log = Log::init();
    temp_log.level = log.level;

    let (mut sheet, extra) = match bun_css::BundlerStyleSheet::parse_bundler(
        bump,
        &source.contents,
        bun_css::ParserOptions::default(Some(&mut temp_log)),
        &mut css_records,
        bun_ast::Index::source(source.index.0),
    ) {
        Ok(v) => v,
        Err(e) => {
            let _ = e.add_to_logger(&mut temp_log, source);
            temp_log.append_to(log);
            return Err(AnyError::SyntaxError);
        }
    };
    let targets = bun_css::Targets::for_bundler_target(topts.target);
    if let Err(e) = sheet.minify(
        bump,
        &bun_css::MinifyOptions {
            targets,
            unused_symbols: Default::default(),
        },
        &extra,
    ) {
        let _ = e.add_to_logger(&mut temp_log, source);
        temp_log.append_to(log);
        return Err(AnyError::MinifyError);
    }

    for rule in sheet.rules.v.iter_mut() {
        if let BundlerCssRule::Import(import) = rule {
            temp_log.add_range_warning_fmt(
                Some(source),
                css_records[import.import_record_idx as usize].range,
                format_args!(
                    "This \"@import\" is ignored. A stylesheet that is imported with {{ type: \"css\" }} cannot import another stylesheet, in a browser or in a bundle."
                ),
            );
            *rule = BundlerCssRule::Ignored;
        }
    }

    // Print each `url()` to a file as a placeholder. `assets` has the distinct files.
    let mut placeholder_prefix = Vec::<u8>::new();
    let _ = write!(
        &mut placeholder_prefix,
        "__bun_css_url_{unique_key_prefix:016x}_"
    );
    let mut assets = Vec::<(bun_paths::fs::Path<'static>, bun_ast::Range)>::new();
    let mut asset_of_record = vec![usize::MAX; css_records.len()];
    for (i, record) in css_records.iter_mut().enumerate() {
        if record.kind != ImportKind::Url || !is_file_url(record.path.text) {
            continue;
        }
        asset_of_record[i] = match assets
            .iter()
            .position(|(path, _)| path.text == record.path.text)
        {
            Some(asset) => asset,
            None => {
                assets.push((record.path, record.range));
                assets.len() - 1
            }
        };
        let mut placeholder = bun_alloc::ArenaString::new_in(bump);
        let _ = write!(
            &mut placeholder,
            "{}{i}_",
            bstr::BStr::new(&placeholder_prefix)
        );
        record.path.text = placeholder.into_bump_str().as_bytes();
    }

    if let Some(&(_, range)) = assets.first()
        && topts.output_format != options::Format::Esm
        && topts.public_path.is_empty()
    {
        temp_log.add_range_error_fmt(
            Some(source),
            range,
            format_args!(
                "A stylesheet that is imported with {{ type: \"css\" }} resolves this \"url()\" against the location of the bundle. Only the \"esm\" format knows that location. Use it, or set a public path."
            ),
        );
        temp_log.append_to(log);
        return Err(AnyError::BuildFailed);
    }

    let symbols = bun_ast::symbol::Map::init_list(vec![extra.symbols]);
    let css = match sheet.to_css(
        bump,
        &bun_css::PrinterOptions {
            minify: topts.minify_whitespace,
            targets,
            ..Default::default()
        },
        Some(bun_css::ImportInfo::init_outside_of_bundler(&css_records)),
        None,
        &symbols,
    ) {
        Ok(result) => result.code,
        Err(e) => {
            temp_log.add_error_fmt(
                Some(source),
                bun_ast::Loc::EMPTY,
                format_args!("{e} while printing"),
            );
            temp_log.append_to(log);
            return Err(AnyError::PrintError);
        }
    };

    let mut js = Vec::<u8>::with_capacity(css.len() + 256);
    for asset in 0..assets.len() {
        let _ = write!(&mut js, "import asset{asset} from \"{asset}\";\n");
    }
    if !assets.is_empty() {
        // The URL of an asset is relative to the chunk. A stylesheet resolves a relative URL
        // against the document, so make it absolute. The result is safe in a quoted `url()`.
        js.extend_from_slice(if topts.output_format == options::Format::Esm {
            b"var url = (path) => {\n  try {\n    path = new URL(path, import.meta.url).href;\n  } catch {}\n  return path.replace(/[\"\\\\]/g, \"\\\\$&\");\n};\n"
        } else {
            b"var url = (path) => path.replace(/[\"\\\\]/g, \"\\\\$&\");\n"
        });
    }
    js.extend_from_slice(b"export default /* @__PURE__ */ ((sheet) => (sheet.replaceSync(`");
    let mut rest: &[u8] = css.trim_ascii_end();
    while let Some(at) = strings::index_of(rest, &placeholder_prefix) {
        let after = &rest[at + placeholder_prefix.len()..];
        let digits = after
            .iter()
            .position(|byte| !byte.is_ascii_digit())
            .unwrap_or(after.len());
        let asset = core::str::from_utf8(&after[..digits])
            .ok()
            .and_then(|record| record.parse::<usize>().ok())
            .and_then(|record| asset_of_record.get(record).copied())
            .filter(|asset| *asset != usize::MAX && after.get(digits) == Some(&b'_'));
        let Some(asset) = asset else {
            // The stylesheet itself has this text.
            write_template_chars(&mut js, &rest[..at + placeholder_prefix.len()]);
            rest = after;
            continue;
        };
        // The printer writes `url(x)` or `url("x")`. Always quote: the URL is not known yet.
        let quoted = at > 0 && rest[at - 1] == b'"';
        write_template_chars(&mut js, &rest[..at]);
        if !quoted {
            js.push(b'"');
        }
        let _ = write!(&mut js, "${{url(asset{asset})}}");
        for &byte in url_suffix(assets[asset].0.text) {
            if matches!(byte, b'"' | b'\\') {
                js.extend_from_slice(b"\\\\");
            }
            write_template_chars(&mut js, &[byte]);
        }
        if !quoted {
            js.push(b'"');
        }
        rest = &after[digits + 1..];
    }
    write_template_chars(&mut js, rest);
    js.extend_from_slice(b"`), sheet))(/* @__PURE__ */ new CSSStyleSheet());\n");

    let js_source: &'static Source<'static> = bump.alloc(Source {
        path: source.path,
        contents: Cow::Borrowed(bump.alloc_slice_copy(&js)),
        index: source.index,
        ..Default::default()
    });
    let parsed = (crate::cache::JavaScript {}).parse(bump, opts, define, &mut temp_log, js_source);
    temp_log.append_to(log);
    let Some(js_parser::Result::Ast(ast)) = parsed? else {
        return Err(AnyError::ParserError);
    };
    let mut ast = JSAst::init(*ast);

    // The imports are in the order of `assets`. Resolve each one as its `url()`: the scan
    // then finds the same file as for a page stylesheet, and `check_imports` makes the record a
    // statement import for the linker.
    let mut asset_imports = ast
        .import_records
        .iter_mut()
        .filter(|record| !record.flags.contains(ImportRecordFlags::IS_INTERNAL));
    for &(path, range) in &assets {
        let Some(record) = asset_imports.next() else {
            return Err(AnyError::ParserError);
        };
        record.path = path;
        record.range = range;
        record.kind = ImportKind::Url;
        record.loader = Some(Loader::File);
    }
    Ok(ast)
}

/// Runs after the scan when the build has a CSS module script.
///
/// - Reports a file that is a CSS module script for one import and a stylesheet for another.
/// - Warns about an import that binds nothing: no code can adopt its sheet.
/// - Makes the asset imports of each CSS module script statement imports (see `parse`).
pub(crate) fn check_imports(this: &mut BundleV2<'_>) -> Result<(), AnyError> {
    if this.graph.css_module_script_imports.is_empty() {
        return Ok(());
    }

    let mut typed_imports = core::mem::take(&mut this.graph.css_module_script_imports);
    typed_imports.sort_unstable();
    let is_typed_import = |importer: usize, record: usize| {
        typed_imports
            .binary_search(&(importer as IndexInt, record as u32))
            .is_ok()
    };

    let mut ast_slice = this.graph.ast.slice();
    let all_import_records = ast_slice.split_mut().import_records;
    let loaders = this.graph.input_files.items_loader();
    let sources = this.graph.input_files.items_source();

    let mut has_error = false;
    // The files that one import uses as a CSS module script and another as a stylesheet.
    let mut conflicts = Vec::<IndexInt>::new();
    for (importer, import_records) in all_import_records.iter_mut().enumerate() {
        let importer_is_module_script = loaders[importer] == Loader::CssModuleScript;
        for (i, record) in import_records.as_mut_slice().iter_mut().enumerate() {
            if !record.source_index.is_valid() {
                if importer_is_module_script
                    && record.kind == ImportKind::Url
                    && !record.flags.contains(ImportRecordFlags::WAS_UNRESOLVED)
                {
                    has_error = true;
                    this.transpiler.log_mut().add_range_error_fmt(
                        Some(&sources[importer]),
                        record.range,
                        format_args!(
                            "\"{}\" is external. A stylesheet that is imported with {{ type: \"css\" }} can only have a \"url()\" to a file of the bundle.",
                            bstr::BStr::new(record.original_path),
                        ),
                    );
                }
                continue;
            }
            if importer_is_module_script && record.kind == ImportKind::Url {
                record.kind = ImportKind::Stmt;
            }
            let file = record.source_index.get();
            let typed = is_typed_import(importer, i);
            if typed
                && record
                    .flags
                    .contains(ImportRecordFlags::WAS_ORIGINALLY_BARE_IMPORT)
            {
                this.transpiler.log_mut().add_range_warning_fmt(
                    Some(&sources[importer]),
                    record.range,
                    format_args!(
                        "This import does nothing: it makes a CSSStyleSheet that no code can adopt. Remove {{ type: \"css\" }} to add \"{}\" to the page.",
                        bstr::BStr::new(sources[file as usize].path.pretty),
                    ),
                );
            }
            match loaders[file as usize] {
                Loader::CssModuleScript if !typed => conflicts.push(file),
                Loader::Css if typed => conflicts.push(file),
                _ => {}
            }
        }
    }

    // One error for each file, at its first typed import, with a note at each use without the
    // attribute. The order does not depend on which import the scan resolved first.
    conflicts.sort_unstable();
    conflicts.dedup();
    conflicts.sort_unstable_by_key(|file| sources[*file as usize].path.text);
    for &file in &conflicts {
        // (not typed, path of the importer, offset in the importer, importer, import record)
        let mut uses = Vec::<(bool, &[u8], i32, usize, usize)>::new();
        for (importer, import_records) in all_import_records.iter().enumerate() {
            for (i, record) in import_records.as_slice().iter().enumerate() {
                if record.source_index.is_valid() && record.source_index.get() == file {
                    uses.push((
                        !is_typed_import(importer, i),
                        sources[importer].path.text,
                        record.range.loc.start,
                        importer,
                        i,
                    ));
                }
            }
        }
        uses.sort_unstable();
        let Some((&(_, _, _, importer, i), others)) = uses.split_first() else {
            continue;
        };
        let pretty = bstr::BStr::new(sources[file as usize].path.pretty);
        let notes: Vec<bun_ast::Data> = others
            .iter()
            .filter(|(not_typed, ..)| *not_typed)
            .map(|&(_, _, _, importer, i)| {
                let mut text = Vec::<u8>::new();
                let _ = write!(
                    &mut text,
                    "\"{pretty}\" is used without {{ type: \"css\" }} here"
                );
                bun_ast::range_data(
                    Some(&sources[importer]),
                    all_import_records[importer].as_slice()[i].range,
                    text,
                )
            })
            .collect();
        has_error = true;
        this.transpiler.log_mut().add_range_error_fmt_with_notes(
            Some(&sources[importer]),
            all_import_records[importer].as_slice()[i].range,
            notes.into_boxed_slice(),
            format_args!(
                "A build cannot use \"{pretty}\" both with and without {{ type: \"css\" }}. The bundler makes one module for each file: a CSSStyleSheet, or a stylesheet of the page."
            ),
        );
    }
    if has_error {
        return Err(AnyError::BuildFailed);
    }
    Ok(())
}
