use std::borrow::Cow;

use bstr::BStr;
use bun_alloc::Arena;
use bun_aot::diagnostic_codes::Code;
use bun_aot::diagnostics::log_diagnostic;
use bun_aot::load::source_provider::{Failed, SourceFile};
use bun_ast::{Expr, Loader, Loc, Log, Source};
use bun_core::strings;
use bun_sema::atom::Interner;
use bun_sema::hir_from_data::{DataModule, DataValue};

use super::assets::EmbeddedFiles;
use super::data_values::{data_value_from_expr, report_not_data};
use super::services::{BuildContext, with_ast_scope};

const REPLACEMENT_CHARACTER: &[u8] = "\u{FFFD}".as_bytes();

#[derive(Copy, Clone)]
enum StructuredFormat {
    Json,
    Jsonc,
    Json5,
    Toml,
    Yaml,
    Xml,
}

pub(crate) fn parse_data<'s>(
    context: &BuildContext,
    embedded: &EmbeddedFiles,
    file: &SourceFile<'_>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    log: &mut Log,
) -> Result<DataModule<'s>, Failed> {
    let source = Source::init_path_string(file.path, file.contents);
    match file.loader {
        Loader::Json => parse_structured(StructuredFormat::Json, &source, arena, atoms, log),
        Loader::Jsonc => parse_structured(StructuredFormat::Jsonc, &source, arena, atoms, log),
        Loader::Json5 => parse_structured(StructuredFormat::Json5, &source, arena, atoms, log),
        Loader::Toml => parse_structured(StructuredFormat::Toml, &source, arena, atoms, log),
        Loader::Yaml => parse_structured(StructuredFormat::Yaml, &source, arena, atoms, log),
        Loader::Xml => parse_structured(StructuredFormat::Xml, &source, arena, atoms, log),
        Loader::Text => Ok(create_string_module(
            &decode_utf8_lossy(file.contents),
            arena,
            atoms,
        )),
        Loader::Md => match bun_md::root::render_to_html(file.contents) {
            Ok(html) => Ok(create_string_module(
                &decode_utf8_lossy(&html),
                arena,
                atoms,
            )),
            Err(_) => {
                log.add_error(
                    Some(&source),
                    Loc::EMPTY,
                    b"Failed to render markdown to HTML",
                );
                Err(Failed)
            }
        },
        Loader::Dataurl | Loader::Base64 | Loader::Bunsh => {
            Ok(create_string_module(b"", arena, atoms))
        }
        Loader::Css => Ok(DataModule::Value {
            default: arena.alloc(DataValue::Object(&[])),
            exports_keys: false,
        }),
        Loader::File | Loader::Wasm => {
            let path = embedded.embed_file(context, file, log)?;
            Ok(create_string_module(&path, arena, atoms))
        }
        Loader::Napi => {
            let path = atoms.intern(&embedded.embed_file(context, file, log)?);
            Ok(DataModule::NativeAddon { path })
        }
        Loader::SqliteEmbedded => Ok(DataModule::Database {
            path: atoms.intern(&embedded.embed_file(context, file, log)?),
            is_embedded: true,
        }),
        Loader::Sqlite => Ok(DataModule::Database {
            path: atoms.intern(file.path),
            is_embedded: false,
        }),
        Loader::Html => Ok(DataModule::Page),
        Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx => {
            debug_assert!(false, "the host never asks for a script loader as data");
            log_diagnostic(log, Code::UnsupportedOption, &[b"a script loader as data"]);
            Err(Failed)
        }
    }
}

fn decode_utf8_lossy(contents: &[u8]) -> Cow<'_, [u8]> {
    if strings::is_valid_utf8(contents) {
        return Cow::Borrowed(contents);
    }
    let mut decoded = Vec::with_capacity(contents.len() + REPLACEMENT_CHARACTER.len());
    for chunk in contents.utf8_chunks() {
        decoded.extend_from_slice(chunk.valid().as_bytes());
        if !chunk.invalid().is_empty() {
            decoded.extend_from_slice(REPLACEMENT_CHARACTER);
        }
    }
    Cow::Owned(decoded)
}

fn parse_structured<'s>(
    format: StructuredFormat,
    source: &Source,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    log: &mut Log,
) -> Result<DataModule<'s>, Failed> {
    let default: &'s DataValue<'s> = if strings::is_all_whitespace(source.contents()) {
        arena.alloc(DataValue::Object(&[]))
    } else {
        parse_structured_value(format, source, arena, atoms, log)?
    };
    Ok(DataModule::Value {
        default,
        exports_keys: true,
    })
}

fn parse_structured_value<'s>(
    format: StructuredFormat,
    source: &Source,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    log: &mut Log,
) -> Result<&'s DataValue<'s>, Failed> {
    let errors_before = log.errors;
    with_ast_scope(|scratch| {
        let Some(root) = parse_tree(format, source, log, scratch) else {
            if log.errors == errors_before {
                let path = BStr::new(source.path.text);
                log.add_error_fmt(
                    Some(source),
                    Loc::EMPTY,
                    format_args!("\"{path}\" could not be parsed"),
                );
            }
            return Err(Failed);
        };
        data_value_from_expr(&root, scratch, arena, atoms).map_err(|error| {
            report_not_data(log, source.path.text, "the value", error);
            Failed
        })
    })
}

fn parse_tree<'a>(
    format: StructuredFormat,
    source: &'a Source,
    log: &mut Log,
    scratch: &'a Arena,
) -> Option<Expr> {
    match format {
        StructuredFormat::Json => {
            bun_parsers::json::parse_json_into_arena(source, log, scratch).ok()
        }
        StructuredFormat::Jsonc => {
            bun_parsers::json::parse_jsonc_into_arena(source, log, scratch).ok()
        }
        StructuredFormat::Json5 => {
            bun_parsers::json5::JSON5Parser::parse(source, log, scratch).ok()
        }
        StructuredFormat::Toml => bun_parsers::toml::TOML::parse(source, log, scratch, false).ok(),
        StructuredFormat::Yaml => bun_parsers::yaml::YAML::parse(
            source,
            log,
            scratch,
            bun_parsers::yaml::CyclicAliases::Reject,
        )
        .ok(),
        StructuredFormat::Xml => {
            bun_core::analytics::Features::xml_parse_inc();
            let options = bun_parsers::xml::Options {
                compact: true,
                encoding: bun_parsers::xml::InputEncoding::File,
            };
            let rows = bun_parsers::xml::XML::parse(source, log, scratch, options).ok()?;
            bun_parsers::json::materialize(&rows, source, log, scratch).ok()
        }
    }
}

fn create_string_module<'s>(text: &[u8], arena: &'s Arena, atoms: &Interner<'s>) -> DataModule<'s> {
    DataModule::Value {
        default: arena.alloc(DataValue::String(atoms.intern(text))),
        exports_keys: false,
    }
}
