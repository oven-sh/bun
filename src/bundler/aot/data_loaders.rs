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

#[cfg(test)]
mod tests {
    use bun_sema::atom::Atom;
    use bun_sema::session::Session;

    use super::super::assets::{embedded_name, embedded_path};
    use super::super::services::with_test_context;
    use super::*;
    use crate::ContentHasher;

    const PATH: &[u8] = b"/project/data.bin";

    struct Outcome<'c, 's> {
        context: &'c BuildContext,
        atoms: &'c Interner<'s>,
        log: &'c Log,
        embedded: EmbeddedFiles,
        result: Result<DataModule<'s>, Failed>,
    }

    impl Outcome<'_, '_> {
        fn embedded_path_of(&self, contents: &[u8], loader: Loader) -> Vec<u8> {
            let file = SourceFile {
                path: PATH,
                contents,
                loader,
            };
            let name = embedded_name(self.context, &file, ContentHasher::run(contents));
            embedded_path(&self.context.module_prefix, &name)
        }

        fn has_message_prefix(&self, prefix: &[u8]) -> bool {
            self.log
                .msgs
                .iter()
                .any(|message| message.data.text.starts_with(prefix))
        }
    }

    fn load<R>(
        loader: Loader,
        contents: &[u8],
        check: impl for<'c, 's> FnOnce(Outcome<'c, 's>) -> R,
    ) -> R {
        with_test_context(
            |_| {},
            |context| {
                let session = Session::new();
                let atoms = Interner::new_in(&session);
                let arena = Arena::new();
                let embedded = EmbeddedFiles::default();
                let mut log = Log::init();
                let file = SourceFile {
                    path: PATH,
                    contents,
                    loader,
                };
                let result = parse_data(context, &embedded, &file, &arena, &atoms, &mut log);
                check(Outcome {
                    context,
                    atoms: &atoms,
                    log: &log,
                    embedded,
                    result,
                })
            },
        )
    }

    fn assert_fails_with_error(loader: Loader, contents: &[u8]) {
        load(loader, contents, |outcome| {
            assert!(outcome.result.is_err());
            assert!(outcome.log.errors >= 1);
        });
    }

    fn assert_string_module(loader: Loader, contents: &[u8], expected: &[u8]) {
        load(loader, contents, |outcome| {
            let text = DataValue::String(outcome.atoms.intern(expected));
            let module = DataModule::Value {
                default: &text,
                exports_keys: false,
            };
            assert_eq!(outcome.result.unwrap(), module);
        });
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn structured_formats_export_keys() {
        for (loader, contents) in [
            (Loader::Json, &b"{\"a\":1}"[..]),
            (Loader::Jsonc, &b"// comment\n{\"a\":1,}"[..]),
            (Loader::Json5, &b"{\"a\":1}"[..]),
            (Loader::Toml, &b"a = 1\n"[..]),
            (Loader::Yaml, &b"a: 1\n"[..]),
        ] {
            load(loader, contents, |outcome| {
                let properties = [(outcome.atoms.intern(b"a"), DataValue::Number(1.0))];
                let value = DataValue::Object(&properties);
                let module = DataModule::Value {
                    default: &value,
                    exports_keys: true,
                };
                assert_eq!(outcome.result.unwrap(), module);
            });
        }
        load(Loader::Xml, b"<a>1</a>", |outcome| {
            let text = DataValue::String(outcome.atoms.intern(b"1"));
            let properties = [(outcome.atoms.intern(b"a"), text)];
            let value = DataValue::Object(&properties);
            let module = DataModule::Value {
                default: &value,
                exports_keys: true,
            };
            assert_eq!(outcome.result.unwrap(), module);
        });
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn scalar_keys_are_property_keys() {
        for (loader, contents, names) in [
            (
                Loader::Yaml,
                &b"404: 0\ntrue: 1\n~: 2\n"[..],
                [&b"404"[..], b"true", b"null"],
            ),
            (
                Loader::Json5,
                &b"{ a: 0, true: 1, null: 2 }"[..],
                [&b"a"[..], b"true", b"null"],
            ),
        ] {
            load(loader, contents, |outcome| {
                let properties: Vec<(Atom, DataValue<'_>)> = names
                    .iter()
                    .enumerate()
                    .map(|(index, name)| {
                        (outcome.atoms.intern(name), DataValue::Number(index as f64))
                    })
                    .collect();
                let value = DataValue::Object(&properties);
                let module = DataModule::Value {
                    default: &value,
                    exports_keys: true,
                };
                assert_eq!(outcome.result.unwrap(), module);
            });
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn structured_data_replaces_ill_formed_bytes() {
        for (loader, contents) in [
            (Loader::Json, &b"{\"a\":\"caf\xE9\"}"[..]),
            (Loader::Yaml, &b"a: caf\xE9\n"[..]),
        ] {
            load(loader, contents, |outcome| {
                let text = DataValue::String(outcome.atoms.intern("caf\u{FFFD}".as_bytes()));
                let properties = [(outcome.atoms.intern(b"a"), text)];
                let expected = DataValue::Object(&properties);
                let module = DataModule::Value {
                    default: &expected,
                    exports_keys: true,
                };
                assert_eq!(outcome.result.unwrap(), module);
            });
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn css_is_empty_object_without_embedded_file() {
        load(Loader::Css, b".c { color: red }", |outcome| {
            let module = DataModule::Value {
                default: &DataValue::Object(&[]),
                exports_keys: false,
            };
            assert_eq!(outcome.result.unwrap(), module);
            assert!(outcome.embedded.into_output_files().is_empty());
        });
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn html_is_a_page() {
        load(
            Loader::Html,
            b"<script src=\"./client.ts\"></script>",
            |outcome| {
                assert_eq!(outcome.result.unwrap(), DataModule::Page);
                assert_eq!(outcome.log.errors, 0);
                assert!(outcome.embedded.into_output_files().is_empty());
            },
        );
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn empty_and_blank_files_are_empty_objects() {
        for contents in [&b""[..], &b" \n\t"[..]] {
            for loader in [
                Loader::Json,
                Loader::Jsonc,
                Loader::Json5,
                Loader::Toml,
                Loader::Yaml,
                Loader::Xml,
            ] {
                load(loader, contents, |outcome| {
                    let module = DataModule::Value {
                        default: &DataValue::Object(&[]),
                        exports_keys: true,
                    };
                    assert_eq!(outcome.result.unwrap(), module);
                });
            }
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn text_replaces_ill_formed_sequences() {
        assert_string_module(Loader::Text, b"plain", b"plain");
        assert_string_module(Loader::Text, b"a\xFFb", "a\u{FFFD}b".as_bytes());
        assert_eq!(&*decode_utf8_lossy(b"a\xE2\x82b"), "a\u{FFFD}b".as_bytes());
        assert!(matches!(decode_utf8_lossy(b"valid"), Cow::Borrowed(_)));
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn markdown_is_rendered_html() {
        let html = bun_md::root::render_to_html(b"# a").unwrap();
        assert_string_module(Loader::Md, b"# a", &html);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn unimplemented_loaders_are_empty_strings() {
        for loader in [Loader::Dataurl, Loader::Base64, Loader::Bunsh] {
            assert_string_module(loader, b"contents", b"");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn embedded_files_are_paths_under_prefix() {
        for loader in [Loader::File, Loader::Wasm] {
            load(loader, b"contents", |outcome| {
                let path = outcome.embedded_path_of(b"contents", loader);
                assert!(path.starts_with(&outcome.context.module_prefix));
                let text = DataValue::String(outcome.atoms.intern(&path));
                let module = DataModule::Value {
                    default: &text,
                    exports_keys: false,
                };
                assert_eq!(outcome.result.unwrap(), module);
                assert_eq!(outcome.embedded.into_output_files().len(), 1);
            });
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn napi_loads_embedded_file() {
        load(Loader::Napi, b"addon", |outcome| {
            let path = outcome.embedded_path_of(b"addon", Loader::Napi);
            let module = DataModule::NativeAddon {
                path: outcome.atoms.intern(&path),
            };
            assert_eq!(outcome.result.unwrap(), module);
        });
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn embedded_sqlite_opens_embedded_file() {
        load(Loader::SqliteEmbedded, b"database", |outcome| {
            let path = outcome.embedded_path_of(b"database", Loader::SqliteEmbedded);
            let module = DataModule::Database {
                path: outcome.atoms.intern(&path),
                is_embedded: true,
            };
            assert_eq!(outcome.result.unwrap(), module);
        });
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn sqlite_opens_original_path() {
        load(Loader::Sqlite, b"database", |outcome| {
            let module = DataModule::Database {
                path: outcome.atoms.intern(PATH),
                is_embedded: false,
            };
            assert_eq!(outcome.result.unwrap(), module);
        });
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn broken_documents_fail_with_error() {
        assert_fails_with_error(Loader::Json, b"{");
        assert_fails_with_error(Loader::Toml, b"a = ");
        assert_fails_with_error(Loader::Yaml, b"a: [");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn toml_date_is_unsupported() {
        load(Loader::Toml, b"d = 1979-05-27\n", |outcome| {
            assert!(outcome.has_message_prefix(b"TS100050"));
            assert!(outcome.result.is_err());
        });
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn yaml_alias_cycle_is_syntax_error() {
        assert_fails_with_error(Loader::Yaml, b"a: &x\n  b: *x\n");
    }
}
