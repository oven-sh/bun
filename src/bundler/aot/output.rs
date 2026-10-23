use super::{AotBuild, AotEntryPoint};
use crate::OutputFile;
use crate::options::{OutputKind, Side};
use crate::output_file::{IndexOptional, Options, OptionsData};
use bun_aot::Compilation;
use bun_aot::compile::{EntryPointPaths, ProgramSummary};
use bun_ast::Loader;

/// Entry point `i` is shown as `shown[i]`, the path of its source, and is a file of the executable under `embedded[i]`, the name that `bun build --compile` gives it.
pub(crate) struct EntryPointNames<'a> {
    pub module_prefix: &'a [u8],
    pub shown: &'a [Vec<u8>],
    pub embedded: &'a [Vec<u8>],
}

impl EntryPointNames<'_> {
    /// A program that runs in place has the paths of its files on disk, and no other names.
    fn file_name<'p>(&'p self, public_path: &'p [u8]) -> &'p [u8] {
        let Some(shown) = public_path.strip_prefix(self.module_prefix) else {
            return public_path;
        };
        match self.shown.iter().position(|name| is_shown_as(name, shown)) {
            Some(index) => &self.embedded[index],
            None => shown,
        }
    }
}

/// In a public path, a `..` that leaves the root directory of the build is `_.._`.
fn is_shown_as(name: &[u8], shown: &[u8]) -> bool {
    let segments = bun_core::strings::split(name, b"/");
    let segments = segments.map(|segment| {
        if segment == b".." {
            &b"_.._"[..]
        } else {
            segment
        }
    });
    segments.eq(bun_core::strings::split(shown, b"/"))
}

pub(crate) fn finish_build(
    compilation: Compilation,
    names_of_entry_points: &EntryPointNames<'_>,
    embedded: Vec<OutputFile>,
) -> AotBuild {
    let Compilation { engine, summary } = compilation;
    let ProgramSummary {
        entry_points: entry_paths,
        folders: _,
        names,
        texts,
        statistics,
        validates_by_type,
    } = summary;
    let (output_files, entry_points) =
        collect_output_files(entry_paths, names_of_entry_points, embedded);
    AotBuild {
        output_files,
        engine,
        entry_points,
        root_directory: Vec::new(),
        package_names: Vec::new(),
        names,
        texts,
        statistics,
        validates_by_type,
    }
}

fn collect_output_files(
    entry_paths: Vec<EntryPointPaths>,
    names: &EntryPointNames<'_>,
    embedded: Vec<OutputFile>,
) -> (Vec<OutputFile>, Vec<AotEntryPoint>) {
    let entry_count = entry_paths.len();
    let mut output_files = Vec::with_capacity(entry_count + embedded.len());
    let mut entry_points = Vec::with_capacity(entry_count);
    for (index, entry) in entry_paths.into_iter().enumerate() {
        let dest_path = names.file_name(&entry.public_path);
        output_files.push(create_entry_file(
            dest_path,
            &entry.source_path,
            index as u32,
        ));
        entry_points.push(AotEntryPoint {
            source_path: entry.source_path,
            module_path: entry.public_path,
        });
    }
    for mut file in embedded {
        if file.source_map_index != u32::MAX {
            file.source_map_index += entry_count as u32;
        }
        file.entry_point_index = None;
        // In place, an entry point that is embedded, a native addon, has one name for its file and for its bytes, and of two files with one name the executable keeps the first.
        let entry_files = &mut output_files[..entry_count];
        if let Some(entry_file) = entry_files
            .iter_mut()
            .find(|entry_file| entry_file.dest_path == file.dest_path)
        {
            core::mem::swap(&mut entry_file.value, &mut file.value);
            core::mem::swap(&mut entry_file.loader, &mut file.loader);
            core::mem::swap(&mut entry_file.size, &mut file.size);
            core::mem::swap(
                &mut entry_file.size_without_sourcemap,
                &mut file.size_without_sourcemap,
            );
        }
        output_files.push(file);
    }
    (output_files, entry_points)
}

fn create_entry_file(dest_path: &[u8], source_path: &[u8], index: u32) -> OutputFile {
    OutputFile::init(Options {
        loader: Loader::Js,
        input_loader: Loader::Js,
        hash: None,
        source_map_index: None,
        bytecode_index: None,
        module_info_index: None,
        output_path: Box::from(dest_path),
        source_index: IndexOptional::NONE,
        size: None,
        input_path: Box::from(source_path),
        display_size: 0,
        output_kind: OutputKind::EntryPoint,
        is_executable: false,
        data: OptionsData::Buffer {
            data: Box::default(),
        },
        side: Some(Side::Server),
        entry_point_index: Some(index),
        referenced_css_chunks: Box::default(),
        bake_extra: Default::default(),
    })
}
