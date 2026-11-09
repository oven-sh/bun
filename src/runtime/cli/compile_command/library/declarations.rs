use bun_ast::Loader;
use bun_bundler::options::{OutputFile, OutputFileValue, OutputKind};
use bun_paths::platform::Auto;
use bun_paths::resolve_path::{platform_to_posix_in_place, relative_platform};
use bun_sema::util::SharedSort;
use bun_sema_driver::declaration_imports::name_imported_files;

use super::typed_files::is_typed_file;
use crate::cli::check_command::{DeclarationFile, Declarations, JsonDeclarationFile, Unwritable};

const DECLARATION_EXTENSIONS: [(&[u8], &[u8]); 8] = [
    (b".tsx", b".d.ts"),
    (b".ts", b".d.ts"),
    (b".mts", b".d.mts"),
    (b".cts", b".d.cts"),
    (b".jsx", b".d.ts"),
    (b".js", b".d.ts"),
    (b".mjs", b".d.mts"),
    (b".cjs", b".d.cts"),
];

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum UnwrittenDeclaration {
    OutsideRootDirectory {
        source: Vec<u8>,
        root_directory: Vec<u8>,
    },
    /// The declaration file of `importer` imports the JSON module `source`.
    Json {
        source: Vec<u8>,
        importer: Vec<u8>,
        why: Unwritable,
    },
}

impl UnwrittenDeclaration {
    pub(crate) fn write_message(&self, out: &mut Vec<u8>) {
        fn under(config: &[u8]) -> &[u8] {
            match config.is_empty() {
                true => b"the default options",
                false => config,
            }
        }
        let mut write = |parts: &[&[u8]]| out.extend_from_slice(&parts.concat());
        match self {
            Self::OutsideRootDirectory {
                source,
                root_directory,
            } => write(&[
                b"cannot write a declaration file for ",
                source,
                b" because it is outside the root directory ",
                root_directory,
                b". Pass --root to change it",
            ]),
            Self::Json {
                source,
                importer,
                why,
            } => {
                write(&[b"cannot write a declaration file for ", source]);
                match why {
                    Unwritable::TooLong => {
                        write(&[b" because its type is too long to write (TS7056)"]);
                    }
                    Unwritable::TwoTypes(first, second) => write(&[
                        b" because it has one type under ",
                        under(first),
                        b" and another under ",
                        under(second),
                    ]),
                }
                write(&[
                    b". The declaration file of ",
                    importer,
                    b" imports it. Give the exports of that file types that do not refer to the JSON file",
                ]);
            }
        }
    }
}

pub(crate) fn is_declaration_file(file: &OutputFile) -> bool {
    file.output_kind == OutputKind::Asset && file.loader == Loader::Ts && !is_typed_file(file)
}

pub(crate) fn add_declaration_files(
    declarations: Declarations,
    root_directory: &[u8],
    is_bundled: bool,
    output_files: &mut Vec<OutputFile>,
) -> Result<(), UnwrittenDeclaration> {
    // Without bundling, only the entry points are written.
    let has_javascript =
        |source: &[u8]| is_bundled || output_files.iter().any(|file| file.src_path.text == source);
    let mut placed: Vec<(Vec<u8>, DeclarationFile)> = Vec::new();
    for declaration in declarations.files {
        if !has_javascript(&declaration.source) {
            continue;
        }
        let Some(path) = declaration_path(root_directory, &declaration.source) else {
            return Err(UnwrittenDeclaration::OutsideRootDirectory {
                source: declaration.source,
                root_directory: root_directory.to_vec(),
            });
        };
        placed.push((path, declaration));
    }
    let mut written: Vec<&[u8]> = placed.iter().map(|(path, _)| &path[..]).collect();
    written.shared_sort_unstable();
    let is_written = |path: &[u8]| written.binary_search(&path).is_ok();
    // Without bundling, the JavaScript imports the JSON file, and so do the declaration files.
    let json = declarations.json.into_iter().filter(|_| is_bundled);
    // No place for a JSON module that is not below the root directory, or whose place a source has: `data.json.cts`.
    let json: Vec<(Vec<u8>, JsonDeclarationFile)> = json
        .filter_map(|json| Some((json_declaration_path(root_directory, &json.source)?, json)))
        .filter(|(path, _)| !is_written(path))
        .collect();
    // For each JSON module, the first written declaration file that imports it.
    let mut importers: Vec<Option<&[u8]>> = vec![None; json.len()];
    let mut added: Vec<OutputFile> = Vec::with_capacity(placed.len());
    for (path, declaration) in &placed {
        let source = &declaration.source;
        let names = |(of_json, json): &(Vec<u8>, JsonDeclarationFile), path: &[u8]| {
            of_json == path && json.named_by.contains(source)
        };
        let is_written = |path: &[u8]| is_written(path) || json.iter().any(|it| names(it, path));
        let mut note = |imported: &[u8]| {
            if let Some(at) = json.iter().position(|it| names(it, imported)) {
                importers[at].get_or_insert(source);
            }
        };
        let text = name_imported_files(path, &declaration.text, &is_written, &mut note);
        added.push(declaration_output_file(path.clone(), text));
    }
    for ((path, json), importer) in json.into_iter().zip(importers) {
        let Some(importer) = importer else {
            continue;
        };
        match json.text {
            Ok(text) => added.push(declaration_output_file(path, text)),
            Err(why) => {
                return Err(UnwrittenDeclaration::Json {
                    source: json.source,
                    importer: importer.to_vec(),
                    why,
                });
            }
        }
    }
    output_files.append(&mut added);
    Ok(())
}

/// Where the one of `data.json.cts` would be: `export =` is an error in a `.d.ts` file of a `"type": "module"` package.
fn json_declaration_path(root_directory: &[u8], source: &[u8]) -> Option<Vec<u8>> {
    declaration_path(root_directory, &[source, b".cts"].concat())
}

pub(super) fn declaration_path(root_directory: &[u8], source: &[u8]) -> Option<Vec<u8>> {
    let relative = relative_platform::<Auto, false>(root_directory, source);
    if leaves_its_directory(relative) {
        return None;
    }
    let (stem, extension) = DECLARATION_EXTENSIONS
        .iter()
        .find_map(|(from, to)| Some((relative.strip_suffix(*from)?, *to)))?;
    let mut path = [stem, extension].concat();
    platform_to_posix_in_place::<u8>(&mut path);
    Some(path)
}

fn leaves_its_directory(relative: &[u8]) -> bool {
    match relative {
        b".." => true,
        [b'.', b'.', separator, ..] if bun_paths::is_sep_any(*separator) => true,
        _ => bun_paths::is_absolute(relative),
    }
}

fn declaration_output_file(path: Vec<u8>, text: Vec<u8>) -> OutputFile {
    OutputFile {
        loader: Loader::Ts,
        input_loader: Loader::Ts,
        output_kind: OutputKind::Asset,
        dest_path: path.into_boxed_slice(),
        size: text.len(),
        size_without_sourcemap: text.len(),
        value: OutputFileValue::Buffer {
            bytes: text.into_boxed_slice(),
        },
        ..OutputFile::zero_value()
    }
}
