use bun_ast::{Loader, Log};
use bun_bundler::options::{OutputFile, OutputFileValue, OutputKind};
use bun_core::ZBox;
use bun_paths::platform::Auto;
use bun_paths::resolve_path::{join_abs_string, platform_to_posix_in_place, relative_platform};
use bun_sema_driver::sound_files::javascript_path_beside;

use crate::cli::check_command::{
    CompilerOptions, TypedFilesRequest, WrittenJavaScript, take_module_types,
    typed_files_for_build, warn_unless_package_states,
};

pub(crate) struct TypedOutputs<'a> {
    pub(crate) working_directory: &'a [u8],
    pub(crate) outdir: &'a [u8],
    pub(crate) tsconfig: Option<&'a [u8]>,
    pub(crate) conditions: &'a [Box<[u8]>],
    pub(crate) loaders: &'a bun_ast::LoaderHashTable,
    /// The build only made source maps for this. They are not part of its output.
    pub(crate) drops_source_maps: bool,
    pub(crate) writes_package_json: bool,
}

/// `index.aot.ts`: `index.js` with its types, which `--aot` compiles.
pub(crate) fn is_typed_file(file: &OutputFile) -> bool {
    file.output_kind == OutputKind::Asset
        && file.loader == Loader::Ts
        && javascript_path_beside(&file.dest_path).is_some()
}

pub(crate) fn add_typed_files(
    request: &TypedOutputs<'_>,
    log: &mut Log,
    output_files: &mut Vec<OutputFile>,
) -> CompilerOptions {
    let outdir = join_abs_string::<Auto>(request.working_directory, &[request.outdir]).to_vec();
    let path_of = |file: &OutputFile| join_abs_string::<Auto>(&outdir, &[&file.dest_path]).to_vec();
    let text_of = |file: &OutputFile| match &file.value {
        OutputFileValue::Buffer { bytes } => Some(bytes.to_vec()),
        OutputFileValue::Saved(_) => {
            bun_sys::File::read_from(bun_core::Fd::cwd(), &path_of(file)).ok()
        }
        OutputFileValue::Copy(_) | OutputFileValue::Noop => None,
    };
    struct Written<'f> {
        path: Vec<u8>,
        text: Vec<u8>,
        source_map: Vec<u8>,
        entry_point: Option<&'f [u8]>,
    }
    let mut written: Vec<Written<'_>> = Vec::new();
    for file in output_files.iter() {
        let is_code = matches!(file.output_kind, OutputKind::EntryPoint | OutputKind::Chunk);
        if !is_code || !file.loader.is_javascript_like() {
            continue;
        }
        let source_map = output_files.get(file.source_map_index as usize);
        let (Some(mut text), Some(source_map)) = (text_of(file), source_map.and_then(text_of))
        else {
            continue;
        };
        if let Some(length) = without_debug_id(&text).map(<[u8]>::len)
            && request.drops_source_maps
        {
            text.truncate(length);
        }
        let is_entry_point = file.output_kind == OutputKind::EntryPoint;
        written.push(Written {
            path: path_of(file),
            text,
            source_map,
            entry_point: is_entry_point.then_some(file.src_path.text),
        });
    }
    let javascript: Vec<WrittenJavaScript<'_>> = written
        .iter()
        .map(|file| WrittenJavaScript {
            path: &file.path,
            text: &file.text,
            source_map: &file.source_map,
            entry_point: file.entry_point,
        })
        .collect();
    let modules = take_module_types();
    let typed_files = typed_files_for_build(
        &TypedFilesRequest {
            cwd: request.working_directory,
            tsconfig: request.tsconfig,
            conditions: request.conditions,
            loaders: request.loaders,
            outdir: &outdir,
            written: &javascript,
            modules: &modules,
        },
        log,
    );
    drop(javascript);
    drop(written);
    if request.drops_source_maps {
        drop_source_maps(&outdir, output_files);
    }
    if !request.writes_package_json && !typed_files.files.is_empty() {
        warn_unless_package_states(&outdir, &typed_files.compiler_options, log);
    }
    for typed in typed_files.files {
        let mut path = relative_platform::<Auto, false>(&outdir, &typed.path).to_vec();
        platform_to_posix_in_place::<u8>(&mut path);
        output_files.push(OutputFile {
            loader: Loader::Ts,
            input_loader: Loader::Ts,
            output_kind: OutputKind::Asset,
            dest_path: path.into_boxed_slice(),
            size: typed.text.len(),
            size_without_sourcemap: typed.text.len(),
            value: OutputFileValue::Buffer {
                bytes: typed.text.into_boxed_slice(),
            },
            ..OutputFile::zero_value()
        });
    }
    typed_files.compiler_options
}

fn without_debug_id(text: &[u8]) -> Option<&[u8]> {
    const COMMENT: &[u8] = b"\n//# debugId=";
    let at = bun_core::strings::last_index_of(text, COMMENT)?;
    let is_last_line = bun_core::strings::count_char(&text[at + 1..], b'\n') == 1;
    (is_last_line && text.ends_with(b"\n")).then(|| &text[..at])
}

fn drop_source_maps(outdir: &[u8], output_files: &mut Vec<OutputFile>) {
    let path_of =
        |file: &OutputFile| ZBox::from_bytes(join_abs_string::<Auto>(outdir, &[&file.dest_path]));
    for file in output_files.iter_mut() {
        if file.source_map_index == u32::MAX {
            continue;
        }
        let path = path_of(file);
        let length = match &mut file.value {
            OutputFileValue::Buffer { bytes } => {
                without_debug_id(bytes).map(<[u8]>::len).inspect(|&length| {
                    *bytes = Box::from(&bytes[..length]);
                })
            }
            OutputFileValue::Saved(_) => bun_sys::File::read_from(bun_core::Fd::cwd(), &path)
                .ok()
                .and_then(|text| {
                    let text = without_debug_id(&text)?;
                    bun_sys::File::write_file(bun_core::Fd::cwd(), &path, text).ok()?;
                    Some(text.len())
                }),
            OutputFileValue::Copy(_) | OutputFileValue::Noop => None,
        };
        if let Some(length) = length {
            (file.size, file.size_without_sourcemap) = (length, length);
        }
    }
    let mut kept = 0;
    let moved: Vec<u32> = output_files
        .iter()
        .map(|file| match file.output_kind {
            OutputKind::Sourcemap => u32::MAX,
            _ => {
                kept += 1;
                kept - 1
            }
        })
        .collect();
    for file in output_files.iter_mut() {
        for index in [
            &mut file.source_map_index,
            &mut file.bytecode_index,
            &mut file.module_info_index,
        ] {
            *index = moved.get(*index as usize).copied().unwrap_or(u32::MAX);
        }
    }
    for file in output_files.iter() {
        let is_saved = matches!(file.value, OutputFileValue::Saved(_));
        if file.output_kind == OutputKind::Sourcemap && is_saved {
            let _ = bun_sys::unlink(&path_of(file));
        }
    }
    output_files.retain(|file| file.output_kind != OutputKind::Sourcemap);
}
