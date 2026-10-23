use bun_aot::diagnostic_codes::Code;
use bun_aot::diagnostics::log_diagnostic;
use bun_aot::load::source_provider::{Failed, SourceFile};
use bun_ast::{Loader, Log, Target};
use bun_core::strings;
use bun_paths::resolve_path;
use bun_threading::Guarded;

use super::paths::{relative_path, report_long_path};
use super::services::BuildContext;
use crate::ContentHasher;
use crate::bun_fs as Fs;
use crate::options::{OutputFile, OutputKind, PathTemplate, PlaceholderField, Side};
use crate::output_file::{Options, OptionsData};

#[derive(Default)]
pub(crate) struct EmbeddedFiles {
    files: Guarded<Vec<OutputFile>>,
}

impl EmbeddedFiles {
    pub(crate) fn embed_file(
        &self,
        context: &BuildContext,
        file: &SourceFile<'_>,
        log: &mut Log,
    ) -> Result<Vec<u8>, Failed> {
        let (output, path) = create_embedded_file(context, file, log)?;
        self.files.lock().push(output);
        Ok(path)
    }

    pub(crate) fn set_contents(
        &self,
        context: &BuildContext,
        file: &SourceFile<'_>,
        log: &mut Log,
    ) -> Result<(), Failed> {
        let (output, _) = create_embedded_file(context, file, log)?;
        let mut files = self.files.lock();
        let is_placeholder = |it: &&mut OutputFile| {
            it.loader == file.loader
                && *it.src_path.text == *file.path
                && it.value.as_slice().is_empty()
        };
        match files.iter_mut().find(is_placeholder) {
            Some(embedded) => *embedded = output,
            None => files.push(output),
        }
        Ok(())
    }

    pub(crate) fn clear(&self) {
        self.files.lock().clear();
    }

    pub(crate) fn embed_page_outputs(&self, mut files: Vec<OutputFile>) {
        let mut embedded = self.files.lock();
        let embedded_length = embedded.len() as u32;
        for file in &mut files {
            if file.source_map_index != u32::MAX {
                file.source_map_index += embedded_length;
            }
        }
        embedded.append(&mut files);
    }

    pub(crate) fn check_names(&self, log: &mut Log) -> Result<(), Failed> {
        let mut files = self.files.lock();
        let order = compute_name_order(&files);
        let mut final_indices = vec![u32::MAX; files.len()];
        let retained = retain_distinct_names(&files, &order, &mut final_indices, log)?;
        *files = finish_retained_files(core::mem::take(&mut *files), &retained, &final_indices);
        Ok(())
    }

    pub(crate) fn into_output_files(mut self) -> Vec<OutputFile> {
        core::mem::take(self.files.get_mut())
    }
}

pub(crate) fn asset_paths_ignore_contents(context: &BuildContext) -> bool {
    let options = context.options();
    let mut template: PathTemplate = PathTemplate::ASSET.into();
    if !options.asset_naming.is_empty() {
        template.data.clone_from(&options.asset_naming);
    }
    context.module_prefix.is_empty() || !template.needs(PlaceholderField::Hash)
}

fn create_embedded_file(
    context: &BuildContext,
    file: &SourceFile<'_>,
    log: &mut Log,
) -> Result<(OutputFile, Vec<u8>), Failed> {
    let content_hash = ContentHasher::run(file.contents);
    let Some(template) = create_embedded_template(context, file, content_hash) else {
        report_long_path(log, "embedded file", file.path);
        return Err(Failed);
    };
    // An executable that runs in place has no folder of its own. What it embeds keeps the path of its source, as what `--asset` gives it does.
    let runs_in_place = context.module_prefix.is_empty();
    let dest_path = match runs_in_place {
        true => posix_path(file.path),
        false => name_under_root(context, file, &template),
    };
    let path = match runs_in_place {
        true => file.path.to_vec(),
        false => embedded_path(&context.module_prefix, &dest_path),
    };
    let output = OutputFile::init(Options {
        data: OptionsData::Buffer {
            data: file.contents.into(),
        },
        size: Some(file.contents.len()),
        output_path: dest_path.into_boxed_slice(),
        input_path: file.path.into(),
        input_loader: Loader::File,
        loader: file.loader,
        output_kind: OutputKind::Asset,
        hash: Some(template.content_hash(content_hash)),
        side: Some(Side::Client),
        ..Default::default()
    });
    Ok((output, path))
}

pub(crate) fn embedded_path(module_prefix: &[u8], dest_path: &[u8]) -> Vec<u8> {
    [module_prefix, strings::remove_leading_dot_slash(dest_path)].concat()
}

fn create_embedded_template(
    context: &BuildContext,
    file: &SourceFile<'_>,
    content_hash: u64,
) -> Option<PathTemplate> {
    let options = context.options();
    let mut template: PathTemplate = PathTemplate::ASSET.into();
    if !options.asset_naming.is_empty() {
        template.data.clone_from(&options.asset_naming);
    }

    let working_directory = context.bundle().transpiler().fs().top_level_dir();
    let relative = relative_path(working_directory, &options.root_dir, file.path)?;
    let pathname = Fs::PathName::init(&relative);
    template.placeholder.name = pathname.base.into();
    template.placeholder.dir = pathname.dir.into();
    template.placeholder.ext = pathname
        .ext
        .strip_prefix(b".")
        .unwrap_or(pathname.ext)
        .into();
    if template.needs(PlaceholderField::Hash) {
        template.placeholder.hash = Some(template.content_hash(content_hash));
    }
    if template.needs(PlaceholderField::Target) {
        template.placeholder.target = Target::Bun.naming_placeholder().into();
    }
    Some(template)
}

/// A native addon may load libraries by a path relative to itself, so it keeps its path from the root directory.
fn name_under_root(
    context: &BuildContext,
    file: &SourceFile<'_>,
    template: &PathTemplate,
) -> Vec<u8> {
    let path_from_root = || {
        let working_directory = context.bundle().transpiler().fs().top_level_dir();
        let relative = relative_path(working_directory, &context.options().root_dir, file.path)?;
        (!relative.starts_with(b"..")).then(|| posix_path(&relative))
    };
    let kept = Some(())
        .filter(|()| file.loader == Loader::Napi)
        .and_then(|()| path_from_root());
    kept.unwrap_or_else(|| print_embedded_name(template))
}

fn posix_path(path: &[u8]) -> Vec<u8> {
    let mut path = path.to_vec();
    resolve_path::platform_to_posix_in_place::<u8>(&mut path);
    path
}

fn print_embedded_name(template: &PathTemplate) -> Vec<u8> {
    let mut name = Vec::new();
    template.print(&mut name, false).expect("oom");
    resolve_path::platform_to_posix_in_place::<u8>(&mut name);
    name
}

fn compute_name_order(files: &[OutputFile]) -> Vec<u32> {
    let mut order: Vec<u32> = (0..files.len() as u32).collect();
    order.sort_by(|&left, &right| {
        let (left, right) = (&files[left as usize], &files[right as usize]);
        left.dest_path
            .cmp(&right.dest_path)
            .then_with(|| same_name_order(left).cmp(&same_name_order(right)))
    });
    order
}

fn same_name_order(file: &OutputFile) -> (bool, u8, &[u8]) {
    let loader = file.loader;
    (
        !is_runtime_require_loader(loader),
        loader as u8,
        file.src_path.text,
    )
}

fn is_runtime_require_loader(loader: Loader) -> bool {
    match loader {
        Loader::Napi | Loader::Sqlite | Loader::SqliteEmbedded => true,
        _ => false,
    }
}

fn retain_distinct_names(
    files: &[OutputFile],
    order: &[u32],
    final_indices: &mut [u32],
    log: &mut Log,
) -> Result<Vec<u32>, Failed> {
    let mut retained: Vec<u32> = Vec::with_capacity(order.len());
    let mut has_collision = false;
    for &index in order {
        let file = &files[index as usize];
        let final_index = &mut final_indices[index as usize];
        let last = retained.last().map(|&last| &files[last as usize]);
        let same_name = last.filter(|last| last.dest_path == file.dest_path);
        if let Some(last) = same_name {
            if last.value.as_slice() != file.value.as_slice() {
                has_collision = true;
                log_diagnostic(
                    log,
                    Code::EmbeddedFileNameCollision,
                    &[&*file.dest_path, last.src_path.text, file.src_path.text],
                );
            }
            *final_index = (retained.len() - 1) as u32;
            continue;
        }
        *final_index = retained.len() as u32;
        retained.push(index);
    }
    if has_collision {
        return Err(Failed);
    }
    Ok(retained)
}

fn finish_retained_files(
    files: Vec<OutputFile>,
    retained: &[u32],
    final_indices: &[u32],
) -> Vec<OutputFile> {
    let mut files: Vec<Option<OutputFile>> = files.into_iter().map(Some).collect();
    retained
        .iter()
        .map(|&index| {
            let mut file = files[index as usize]
                .take()
                .expect("an index is retained once");
            if file.source_map_index != u32::MAX {
                file.source_map_index = final_indices[file.source_map_index as usize];
            }
            file.bytecode_index = u32::MAX;
            file.module_info_index = u32::MAX;
            file.prelinked_module_index = u32::MAX;
            file.load_order = u32::MAX;
            file.loads_at_startup = false;
            file.bytecode_entry_offset = 0;
            file
        })
        .collect()
}
