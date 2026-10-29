use bun_ast::Loader;
use bun_bundler::options::{OutputFile, OutputFileValue, OutputKind};
use bun_paths::platform::Auto;
use bun_paths::resolve_path::{platform_to_posix_in_place, relative_platform};
use bun_sema_driver::declaration_imports::name_imported_files;

use super::typed_files::is_typed_file;
use crate::cli::check_command::DeclarationFile;

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
pub(crate) struct OutsideRootDirectory {
    source: Vec<u8>,
    root_directory: Vec<u8>,
}

impl OutsideRootDirectory {
    pub(crate) fn write_message(&self, out: &mut Vec<u8>) {
        let parts: [&[u8]; 5] = [
            b"cannot write a declaration file for ",
            &self.source,
            b" because it is outside the root directory ",
            &self.root_directory,
            b". Pass --root to change it",
        ];
        out.extend_from_slice(&parts.concat());
    }
}

pub(crate) fn is_declaration_file(file: &OutputFile) -> bool {
    file.output_kind == OutputKind::Asset && file.loader == Loader::Ts && !is_typed_file(file)
}

pub(crate) fn add_declaration_files(
    declarations: Vec<DeclarationFile>,
    root_directory: &[u8],
    is_bundled: bool,
    output_files: &mut Vec<OutputFile>,
) -> Result<(), OutsideRootDirectory> {
    // Without bundling, only the entry points are written.
    let has_javascript =
        |source: &[u8]| is_bundled || output_files.iter().any(|file| file.src_path.text == source);
    let mut placed: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
    for declaration in declarations {
        if !has_javascript(&declaration.source) {
            continue;
        }
        let Some(path) = declaration_path(root_directory, &declaration.source) else {
            return Err(OutsideRootDirectory {
                source: declaration.source,
                root_directory: root_directory.to_vec(),
            });
        };
        placed.push((path, declaration.text));
    }
    let mut written: Vec<&[u8]> = placed.iter().map(|(path, _)| &path[..]).collect();
    written.sort_unstable();
    let is_written = |path: &[u8]| written.binary_search(&path).is_ok();
    let mut added: Vec<OutputFile> = (placed.iter())
        .map(|(path, text)| {
            declaration_output_file(path.clone(), name_imported_files(path, text, &is_written))
        })
        .collect();
    output_files.append(&mut added);
    Ok(())
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
