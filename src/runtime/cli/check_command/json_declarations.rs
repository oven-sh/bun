//! `bun build --dts` writes a declaration file for each JSON module that a declaration file of the build names.

use bun_sema::check::Checker;
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use bun_sema_driver::declaration_imports::json_modules_named_in;
use bun_threading::Guarded;

use super::declarations::bundler_path;

pub(crate) struct JsonDeclarationFile {
    pub(crate) source: Vec<u8>,
    pub(crate) text: Result<Vec<u8>, Unwritable>,
    /// The `source` of each `DeclarationFile` that names it.
    pub(crate) named_by: Vec<Vec<u8>>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Unwritable {
    /// TS7056
    TooLong,
    /// The configuration files of two programs of the build that give the JSON value different types.
    TwoTypes(Vec<u8>, Vec<u8>),
}

/// What the program with the configuration file `config` writes for the JSON module `source`.
struct Noted {
    source: Vec<u8>,
    config: Vec<u8>,
    text: Option<Vec<u8>>,
    named_by: Vec<Vec<u8>>,
}

#[derive(Default)]
pub(super) struct NotedJsonModules(Guarded<Vec<Noted>>);

impl NotedJsonModules {
    /// `text` is the declaration file of `file`, if it has one.
    pub(super) fn note(&self, checker: &Checker<'_, '_>, file: FileId, text: Option<&[u8]>) {
        let Some(text) = text else {
            return;
        };
        let files = checker.p.files;
        for module in json_modules_named_in(files, file, text) {
            let (source, config) = (files.module(module).file_name(), &files.options.config_path);
            // Held while the program writes the declaration file, so that it writes it once.
            let mut noted = self.0.lock();
            let known = noted
                .iter()
                .position(|it| it.source == source && it.config == *config);
            let at = known.unwrap_or_else(|| {
                noted.push(Noted {
                    source: source.to_vec(),
                    config: config.clone(),
                    text: checker.json_module_declaration(module),
                    named_by: Vec::new(),
                });
                noted.len() - 1
            });
            let importer = files.module(file).file_name();
            if !noted[at].named_by.iter().any(|it| it[..] == *importer) {
                noted[at].named_by.push(importer.to_vec());
            }
        }
    }

    pub(super) fn take(&self) -> Vec<JsonDeclarationFile> {
        let mut noted = std::mem::take(&mut *self.0.lock());
        noted.shared_sort_unstable_by(|a, b| (&a.source, &a.config).cmp(&(&b.source, &b.config)));
        let mut files: Vec<(JsonDeclarationFile, Vec<u8>)> = Vec::new();
        for of_program in noted {
            let source = bundler_path(&of_program.source);
            let named_by = of_program.named_by.iter().map(|it| bundler_path(it));
            let text = of_program.text.ok_or(Unwritable::TooLong);
            match files.last_mut().filter(|known| known.0.source == source) {
                Some((known, first_config)) => {
                    known.named_by.extend(named_by);
                    if known.text.is_ok() && known.text != text {
                        let first = bundler_path(first_config);
                        let second = bundler_path(&of_program.config);
                        known.text = Err(Unwritable::TwoTypes(first, second));
                    }
                }
                None => {
                    let named_by = named_by.collect();
                    let file = JsonDeclarationFile {
                        source,
                        text,
                        named_by,
                    };
                    files.push((file, of_program.config));
                }
            }
        }
        files.into_iter().map(|(file, _)| file).collect()
    }
}
