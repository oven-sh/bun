//! CSS module scripts: in a browser bundle, `import sheet from "./a.css" with { type: "css" }` loads the file as a JavaScript module that exports a constructed `CSSStyleSheet`.

use std::borrow::Cow;
use std::io::Write as _;

use bun_alloc::Arena as Bump;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, Log, Source};
use bun_collections::index_sort;
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

/// The start of the text that stands for a URL until `fill_urls` knows it. A number and `_` follow.
fn write_url_placeholder_prefix(out: &mut Vec<u8>, unique_key_prefix: u64) {
    let _ = write!(out, "__bun_css_url_{unique_key_prefix:016x}_");
}

/// Returns the module `export default <CSSStyleSheet of the text>`. `@import` is dropped. A `url()` that can be a file is a variable and an import record: `fill_urls` sets the variable after the scan.
#[cold]
#[inline(never)]
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

    // Print each `url()` that can be a file as a placeholder. `urls` has the distinct ones.
    let mut placeholder_prefix = Vec::<u8>::new();
    write_url_placeholder_prefix(&mut placeholder_prefix, unique_key_prefix);
    let mut urls = Vec::<(bun_paths::fs::Path<'static>, bun_ast::Range)>::new();
    let mut url_of_record = vec![usize::MAX; css_records.len()];
    for (i, record) in css_records.iter_mut().enumerate() {
        if record.kind != ImportKind::Url || !is_file_url(record.path.text) {
            continue;
        }
        url_of_record[i] = match urls
            .iter()
            .position(|(path, _)| path.text == record.path.text)
        {
            Some(url) => url,
            None => {
                urls.push((record.path, record.range));
                urls.len() - 1
            }
        };
        let mut placeholder = placeholder_prefix.clone();
        let _ = write!(&mut placeholder, "{i}_");
        record.path.text = bump.alloc_slice_copy(&placeholder);
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
    for url in 0..urls.len() {
        let _ = writeln!(
            &mut js,
            "var url{url} = \"{}{url}_\";",
            bstr::BStr::new(&placeholder_prefix)
        );
    }
    if !urls.is_empty() {
        // A constructed stylesheet resolves a relative URL against the document: `cssUrl` resolves it against the bundle, and makes it safe in a quoted `url()`.
        js.extend_from_slice(if topts.output_format == options::Format::Esm {
            b"var cssUrl = (url) => {\n  try {\n    url = new URL(url, import.meta.url).href;\n  } catch {}\n  return url.replace(/[\"\\\\]/g, \"\\\\$&\");\n};\n"
        } else {
            b"var cssUrl = (url) => url.replace(/[\"\\\\]/g, \"\\\\$&\");\n"
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
        let url = core::str::from_utf8(&after[..digits])
            .ok()
            .and_then(|record| record.parse::<usize>().ok())
            .and_then(|record| url_of_record.get(record).copied())
            .filter(|url| *url != usize::MAX && after.get(digits) == Some(&b'_'));
        let Some(url) = url else {
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
        let _ = write!(&mut js, "${{cssUrl(url{url})}}");
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

    // No statement uses these records. The scan resolves each one like the `url()` of a stylesheet, and `fill_urls` reads the result.
    for (path, range) in urls {
        ast.import_records.push(ImportRecord {
            range,
            path,
            kind: ImportKind::Url,
            tag: Default::default(),
            loader: None,
            source_index: Default::default(),
            original_path: b"",
            flags: Default::default(),
        });
    }
    Ok(ast)
}

/// Gives each `url()` of the CSS module script `file` its text, as the CSS printer does for a stylesheet of the page: a `data:` URL, the key of a copied file, or the URL as the resolver left it. Returns false after an error.
#[cold]
#[allow(clippy::too_many_arguments)]
fn fill_urls(
    bump: &Bump,
    log: &mut Log,
    url_files: &mut Vec<(IndexInt, IndexInt)>,
    file: usize,
    import_records: &[ImportRecord],
    parts: &[bun_ast::Part],
    css_asts: &[crate::bundled_ast::CssCol],
    urls_for_css: &[&[u8]],
    unique_keys: &[Box<[u8], bun_alloc::AstAlloc>],
    sources: &[Source],
    loaders: &[Loader],
    placeholder_prefix: &[u8],
    bundle_has_url: bool,
) -> bool {
    // `parse` appended the `url()` records after the records of the JavaScript parser.
    let Some(first) = import_records
        .iter()
        .position(|record| record.kind == ImportKind::Url)
    else {
        return true;
    };
    let urls = &import_records[first..];
    let errors = log.errors;
    let _ = crate::LinkerContext::scan_css_imports(
        file as u32,
        urls,
        std::ptr::from_ref(css_asts),
        sources,
        loaders,
        log,
    );

    let with_suffix = |url: &[u8], suffix: &[u8]| -> bun_ast::StoreStr {
        let text = bump.alloc_slice_fill_copy(url.len() + suffix.len(), 0u8);
        text[..url.len()].copy_from_slice(url);
        text[url.len()..].copy_from_slice(suffix);
        bun_ast::StoreStr::new(text)
    };
    let mut texts = Vec::<bun_ast::StoreStr>::with_capacity(urls.len());
    for record in urls {
        if record.source_index.is_valid() {
            url_files.push((file as IndexInt, record.source_index.get()));
            let target = record.source_index.get() as usize;
            let suffix = url_suffix(record.original_path);
            if !urls_for_css[target].is_empty() {
                // A `?query` lands in the base64 body of a `data:` URL and breaks it: keep only the `#fragment`.
                let fragment = match strings::index_of_char(suffix, b'#') {
                    Some(i) => &suffix[i as usize..],
                    None => b"",
                };
                texts.push(with_suffix(urls_for_css[target], fragment));
                continue;
            }
            if !unique_keys[target].is_empty() {
                if !bundle_has_url {
                    log.add_range_error_fmt_with_notes(
                        Some(&sources[file]),
                        record.range,
                        Box::new([bun_ast::range_data(
                            None,
                            bun_ast::Range::NONE,
                            b"The bundle copies this file: it is too large for a \"data:\" URL.".to_vec(),
                        )]),
                        format_args!(
                            "A stylesheet that is imported with {{ type: \"css\" }} resolves this \"url()\" against the location of the bundle. Only the \"esm\" format knows that location. Use it, or set a public path."
                        ),
                    );
                }
                texts.push(with_suffix(&unique_keys[target], suffix));
                continue;
            }
        }
        texts.push(with_suffix(record.path.text, b""));
    }

    // Each URL is `var url<n> = "<placeholder><n>_"` at the top level of the module.
    let mut filled = 0usize;
    for part in parts {
        for stmt in part.stmts.slice() {
            let bun_ast::StmtData::SLocal(mut local) = stmt.data else {
                continue;
            };
            for decl in local.decls.iter_mut() {
                let Some(bun_ast::ExprData::EString(mut string)) =
                    decl.value.map(|value| value.data)
                else {
                    continue;
                };
                if string.is_utf16 {
                    continue;
                }
                let Some(text) = string
                    .slice8()
                    .strip_prefix(placeholder_prefix)
                    .and_then(|rest| rest.strip_suffix(b"_"))
                    .and_then(|digits| core::str::from_utf8(digits).ok())
                    .and_then(|digits| digits.parse::<usize>().ok())
                    .and_then(|url| texts.get(url))
                else {
                    continue;
                };
                string.data = *text;
                filled += 1;
            }
        }
    }
    debug_assert_eq!(filled, texts.len());
    log.errors == errors
}

/// After the scan: reports a file used both with and without `type: "css"` (one path is one module), warns about an import that binds nothing, and gives each `url()` of a CSS module script its text.
pub(crate) fn check_imports(this: &mut BundleV2<'_>) -> Result<(), AnyError> {
    if this.graph.css_module_script_imports.is_empty() {
        return Ok(());
    }

    let mut typed_imports = core::mem::take(&mut this.graph.css_module_script_imports);
    index_sort::sort_slice_by(&mut typed_imports, |a, b| a.cmp(b));
    let is_typed_import = |importer: usize, record: usize| {
        typed_imports
            .binary_search(&(importer as IndexInt, record as u32))
            .is_ok()
    };

    // The file of a bundle has a URL that the stylesheet can use in the esm format (`import.meta.url`), or with a public path.
    let browser_options = &this.transpiler_for_target(options::Target::Browser).options;
    let bundle_has_url = browser_options.output_format == options::Format::Esm
        || !browser_options.public_path.is_empty();
    let mut placeholder_prefix = Vec::<u8>::new();
    write_url_placeholder_prefix(&mut placeholder_prefix, this.unique_key);

    let bump = this.arena();
    let all_import_records = this.graph.ast.items_import_records();
    let all_parts = this.graph.ast.items_parts();
    let css_asts = this.graph.ast.items_css();
    let urls_for_css = this.graph.ast.items_url_for_css();
    let loaders = this.graph.input_files.items_loader();
    let sources = this.graph.input_files.items_source();
    let unique_keys = this
        .graph
        .input_files
        .items_unique_key_for_additional_file();
    let log = this.transpiler.log_mut();

    let mut has_error = false;
    let mut url_files = Vec::<(IndexInt, IndexInt)>::new();
    // The files that one import uses as a CSS module script and another as a stylesheet.
    let mut conflicts = Vec::<IndexInt>::new();
    for (importer, import_records) in all_import_records.iter().enumerate() {
        if loaders[importer] == Loader::CssModuleScript
            && !fill_urls(
                bump,
                log,
                &mut url_files,
                importer,
                import_records.as_slice(),
                all_parts[importer].as_slice(),
                css_asts,
                urls_for_css,
                unique_keys,
                sources,
                loaders,
                &placeholder_prefix,
                bundle_has_url,
            )
        {
            has_error = true;
        }
        for (i, record) in import_records.as_slice().iter().enumerate() {
            if !record.source_index.is_valid() {
                continue;
            }
            let file = record.source_index.get();
            if loaders[file as usize] == Loader::CssModuleScript && !is_typed_import(importer, i) {
                conflicts.push(file);
            }
        }
    }
    for &(importer, i) in &typed_imports {
        let record = &all_import_records[importer as usize].as_slice()[i as usize];
        if !record.source_index.is_valid() {
            continue;
        }
        let file = record.source_index.get();
        if loaders[file as usize] == Loader::Css {
            conflicts.push(file);
        }
        if loaders[file as usize] == Loader::CssModuleScript
            && record
                .flags
                .contains(ImportRecordFlags::WAS_ORIGINALLY_BARE_IMPORT)
        {
            log.add_range_warning_fmt(
                Some(&sources[importer as usize]),
                record.range,
                format_args!(
                    "This import does nothing: it makes a CSSStyleSheet that no code can adopt. Remove {{ type: \"css\" }} to add \"{}\" to the page.",
                    bstr::BStr::new(sources[file as usize].path.pretty),
                ),
            );
        }
    }

    // One error for each file at its first typed import, in an order that does not depend on which import the scan resolved first.
    index_sort::sort_slice_by(&mut conflicts, |a, b| {
        let path = |file: &IndexInt| sources[*file as usize].path.text;
        path(a).cmp(path(b)).then(a.cmp(b))
    });
    conflicts.dedup();
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
        index_sort::sort_slice_by(&mut uses, |a, b| a.cmp(b));
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
        log.add_range_error_fmt_with_notes(
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
    this.graph.css_module_script_urls = url_files;
    Ok(())
}

/// Marks the file of each `url()` live where its CSS module script is live, for the same entry points. The linker does this itself for a stylesheet: all its records count. For a JavaScript module it follows only the records of statements.
#[cold]
pub(crate) fn mark_url_files(
    c: &mut crate::LinkerContext<'_>,
) -> Result<(), bun_alloc::AllocError> {
    for i in 0..c.parse_graph().css_module_script_urls.len() {
        let (file, url_file) = c.parse_graph().css_module_script_urls[i];
        if !c.graph.files_live.is_set(file as usize) {
            continue;
        }
        c.graph.files_live.set(url_file as usize);
        let entry_bits = c.graph.files.items_entry_bits_mut();
        let reached_by = entry_bits[file as usize].clone()?;
        entry_bits[url_file as usize].set_union(&reached_by);
    }
    Ok(())
}
