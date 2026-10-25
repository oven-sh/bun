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

#[cfg(test)]
pub(crate) fn embedded_name(
    context: &BuildContext,
    file: &SourceFile<'_>,
    content_hash: u64,
) -> Vec<u8> {
    let template = create_embedded_template(context, file, content_hash);
    name_under_root(context, file, &template.expect("the path fits"))
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
    matches!(
        loader,
        Loader::Napi | Loader::Sqlite | Loader::SqliteEmbedded
    )
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
            // A build that loads a file more than once embeds it more than once. It is still one file, and a copy whose contents are read later is empty.
            if last.src_path.text == file.src_path.text {
                if last.value.as_slice().is_empty() {
                    *retained.last_mut().expect("there is a last file") = index;
                }
            } else if last.value.as_slice() != file.value.as_slice() {
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

#[cfg(test)]
mod tests {
    use super::super::services::with_test_context;
    use super::*;
    use crate::options::BundleOptions;

    fn create_output(dest_path: &[u8], source: &[u8], bytes: &[u8], source_map: u32) -> OutputFile {
        OutputFile::init(Options {
            data: OptionsData::Buffer { data: bytes.into() },
            output_path: dest_path.into(),
            input_path: source.into(),
            source_map_index: Some(source_map),
            output_kind: OutputKind::Asset,
            ..Default::default()
        })
    }

    fn summarize(files: &[OutputFile]) -> Vec<(Vec<u8>, Vec<u8>, u32)> {
        files
            .iter()
            .map(|file| {
                (
                    file.dest_path.to_vec(),
                    file.value.as_slice().to_vec(),
                    file.source_map_index,
                )
            })
            .collect()
    }

    fn name_with_options(configure: impl FnOnce(&mut BundleOptions<'_>)) -> Vec<u8> {
        with_test_context(configure, |context| {
            let file = SourceFile {
                path: b"/p/img/a.png",
                contents: b"image",
                loader: Loader::File,
            };
            embedded_name(context, &file, ContentHasher::run(file.contents))
        })
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn default_name_has_hash_without_directory() {
        let name = name_with_options(|options| options.root_dir = Box::from(&b"/p"[..]));
        assert!(name.starts_with(b"./a-"));
        assert!(name.ends_with(b".png"));
        assert_eq!(name.len(), b"./a-".len() + 8 + b".png".len());
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn asset_naming_replaces_template() {
        let name = name_with_options(|options| {
            options.root_dir = Box::from(&b"/p"[..]);
            options.asset_naming = Box::from(&b"[dir]/[name].[ext]"[..]);
        });
        assert_eq!(name, b"img/a.png");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn asset_path_ignores_contents_unless_template_has_hash() {
        let ignores_contents = |naming: &'static [u8]| {
            let configure =
                |options: &mut BundleOptions<'_>| options.asset_naming = Box::from(naming);
            with_test_context(configure, asset_paths_ignore_contents)
        };
        assert!(!ignores_contents(b""));
        assert!(!ignores_contents(b"[name]-[hash].[ext]"));
        assert!(ignores_contents(b"[name].[ext]"));
        assert!(ignores_contents(b"[dir]/[name].[ext]"));
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn set_contents_matches_embedding_with_contents() {
        let configure = |options: &mut BundleOptions<'_>| {
            options.root_dir = Box::from(&b"/p"[..]);
            options.asset_naming = Box::from(&b"[name].[ext]"[..]);
        };
        with_test_context(configure, |context| {
            let file = |path: &'static [u8], contents: &'static [u8]| SourceFile {
                path,
                contents,
                loader: Loader::File,
            };
            let describe = |embedded: EmbeddedFiles| {
                let files = embedded.into_output_files();
                let describe_file = |file: &OutputFile| {
                    (
                        file.dest_path.to_vec(),
                        file.value.as_slice().to_vec(),
                        file.size,
                        file.hash,
                    )
                };
                files.iter().map(describe_file).collect::<Vec<_>>()
            };
            let mut log = Log::init();
            let eager = EmbeddedFiles::default();
            let eager_paths = [
                eager
                    .embed_file(context, &file(b"/p/a.bin", b"first"), &mut log)
                    .unwrap(),
                eager
                    .embed_file(context, &file(b"/p/b.bin", b"second"), &mut log)
                    .unwrap(),
            ];
            let lazy = EmbeddedFiles::default();
            let lazy_paths = [
                lazy.embed_file(context, &file(b"/p/a.bin", b""), &mut log)
                    .unwrap(),
                lazy.embed_file(context, &file(b"/p/b.bin", b""), &mut log)
                    .unwrap(),
            ];
            lazy.set_contents(context, &file(b"/p/b.bin", b"second"), &mut log)
                .unwrap();
            lazy.set_contents(context, &file(b"/p/a.bin", b"first"), &mut log)
                .unwrap();
            assert_eq!(eager_paths, lazy_paths);
            assert_eq!(describe(eager), describe(lazy));
            assert_eq!(log.errors, 0);
        });
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn equal_input_gives_equal_name() {
        let first = name_with_options(|options| options.root_dir = Box::from(&b"/p"[..]));
        let second = name_with_options(|options| options.root_dir = Box::from(&b"/p"[..]));
        assert_eq!(first, second);
    }

    #[test]
    fn embedded_path_removes_leading_dot_slash() {
        assert_eq!(
            embedded_path(b"/$bunfs/root/", b"./a.png"),
            b"/$bunfs/root/a.png"
        );
        assert_eq!(
            embedded_path(b"/$bunfs/root/", b"img/a.png"),
            b"/$bunfs/root/img/a.png"
        );
    }

    #[test]
    fn equal_bytes_share_one_file() {
        let embedded = EmbeddedFiles::default();
        let mut log = Log::init();
        embedded.embed_page_outputs(vec![
            create_output(b"a.js", b"/a.js", b"a", 1),
            create_output(b"shared.map", b"/shared", b"map", u32::MAX),
        ]);
        embedded.embed_page_outputs(vec![
            create_output(b"b.js", b"/b.js", b"b", 1),
            create_output(b"shared.map", b"/shared", b"map", u32::MAX),
        ]);
        assert!(embedded.check_names(&mut log).is_ok());
        assert_eq!(log.errors, 0);
        let files = embedded.into_output_files();
        assert_eq!(
            summarize(&files),
            [
                (b"a.js".to_vec(), b"a".to_vec(), 2),
                (b"b.js".to_vec(), b"b".to_vec(), 2),
                (b"shared.map".to_vec(), b"map".to_vec(), u32::MAX),
            ]
        );
    }

    #[test]
    fn later_outputs_raise_source_map_index() {
        let embedded = EmbeddedFiles::default();
        let mut log = Log::init();
        embedded.embed_page_outputs(vec![create_output(b"a", b"/a", b"1", u32::MAX)]);
        embedded.embed_page_outputs(vec![
            create_output(b"b", b"/b", b"2", 1),
            create_output(b"b.map", b"/b", b"3", u32::MAX),
        ]);
        assert!(embedded.check_names(&mut log).is_ok());
        let files = embedded.into_output_files();
        assert_eq!(&*files[1].dest_path, b"b");
        assert_eq!(files[1].source_map_index, 2);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn page_source_maps_follow_files() {
        with_test_context(
            |_| {},
            |context| {
                let embedded = EmbeddedFiles::default();
                let mut log = Log::init();
                let image = SourceFile {
                    path: b"/project/m.png",
                    contents: b"m",
                    loader: Loader::File,
                };
                assert!(embedded.embed_file(context, &image, &mut log).is_ok());
                embedded.embed_page_outputs(vec![
                    create_output(b"z.js", b"/z.ts", b"z", 2),
                    create_output(b"a.js", b"/a.ts", b"a", 3),
                    create_output(b"z.js.map", b"/z.ts", b"z map", u32::MAX),
                    create_output(b"a.js.map", b"/a.ts", b"a map", u32::MAX),
                ]);
                assert!(embedded.check_names(&mut log).is_ok());
                let files = embedded.into_output_files();
                assert_eq!(files.len(), 5);
                assert_eq!(files[0].src_path.text, b"/project/m.png");
                assert_eq!(files[0].source_map_index, u32::MAX);
                let pairs: [(&[u8], &[u8]); 2] = [(b"a.js", b"a.js.map"), (b"z.js", b"z.js.map")];
                for (name, map_name) in pairs {
                    let file = files.iter().find(|file| &*file.dest_path == name);
                    let source_map_index = file.expect("the script is embedded").source_map_index;
                    assert_eq!(&*files[source_map_index as usize].dest_path, map_name);
                }
            },
        );
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn different_bytes_under_one_name_collide() {
        let embedded = EmbeddedFiles::default();
        let mut log = Log::init();
        embedded.embed_page_outputs(vec![
            create_output(b"x", b"/first", b"1", u32::MAX),
            create_output(b"x", b"/second", b"2", u32::MAX),
        ]);
        assert!(embedded.check_names(&mut log).is_err());
        assert_eq!(log.errors, 1);
        let text = &log.msgs[0].data.text;
        assert!(text.starts_with(b"TS100054"));
        assert!(strings::contains(text, b"/first"));
        assert!(strings::contains(text, b"/second"));
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn one_source_embedded_twice_is_one_file() {
        for copies in [[&b""[..], b"text"], [b"text", b""], [b"text", b"text"]] {
            let embedded = EmbeddedFiles::default();
            let mut log = Log::init();
            embedded.embed_page_outputs(vec![
                create_output(b"x.min.js", b"/lib/x.min.js", copies[0], u32::MAX),
                create_output(b"x.min.js", b"/lib/x.min.js", copies[1], u32::MAX),
            ]);
            assert!(embedded.check_names(&mut log).is_ok());
            assert_eq!(log.errors, 0);
            let files = embedded.into_output_files();
            assert_eq!(files.len(), 1);
            assert_eq!(files[0].value.as_slice(), b"text");
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn every_collision_is_reported() {
        let embedded = EmbeddedFiles::default();
        let mut log = Log::init();
        embedded.embed_page_outputs(vec![
            create_output(b"x", b"/a/x", b"1", u32::MAX),
            create_output(b"y", b"/a/y", b"1", u32::MAX),
            create_output(b"x", b"/b/x", b"2", u32::MAX),
            create_output(b"y", b"/b/y", b"2", u32::MAX),
        ]);
        assert!(embedded.check_names(&mut log).is_err());
        assert_eq!(log.errors, 2);
        assert!(strings::contains(&log.msgs[0].data.text, b"/b/x"));
        assert!(strings::contains(&log.msgs[1].data.text, b"/b/y"));
    }

    #[test]
    fn check_names_clears_fields_of_finished_bundle() {
        let embedded = EmbeddedFiles::default();
        let mut log = Log::init();
        let mut output = create_output(b"a.js", b"/a.js", b"a", u32::MAX);
        output.bytecode_index = 1;
        output.module_info_index = 2;
        output.prelinked_module_index = 3;
        output.load_order = 4;
        output.loads_at_startup = true;
        output.bytecode_entry_offset = 5;
        embedded.embed_page_outputs(vec![output]);
        assert!(embedded.check_names(&mut log).is_ok());
        let files = embedded.into_output_files();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].bytecode_index, u32::MAX);
        assert_eq!(files[0].module_info_index, u32::MAX);
        assert_eq!(files[0].prelinked_module_index, u32::MAX);
        assert_eq!(files[0].load_order, u32::MAX);
        assert!(!files[0].loads_at_startup);
        assert_eq!(files[0].bytecode_entry_offset, 0);
    }

    fn embed_under_loaders(loaders: &[Loader]) -> (Vec<Vec<u8>>, Vec<OutputFile>) {
        with_test_context(
            |_| {},
            |context| {
                let embedded = EmbeddedFiles::default();
                let paths = loaders
                    .iter()
                    .map(|&loader| {
                        let file = SourceFile {
                            path: b"/project/x.db",
                            contents: b"bytes",
                            loader,
                        };
                        let path = embedded.embed_file(context, &file, &mut Log::init());
                        path.expect("the path fits")
                    })
                    .collect();
                assert!(embedded.check_names(&mut Log::init()).is_ok());
                (paths, embedded.into_output_files())
            },
        )
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn embedded_file_is_retained_as_asset() {
        let (paths, files) = embed_under_loaders(&[Loader::File]);
        assert_eq!(files.len(), 1);
        assert_eq!(
            paths,
            [embedded_path(b"/$bunfs/root/", &files[0].dest_path)]
        );
        assert!(files[0].dest_path.starts_with(b"./x-"));
        assert!(files[0].dest_path.ends_with(b".db"));
        assert_eq!(files[0].value.as_slice(), b"bytes");
        assert_eq!(files[0].src_path.text, b"/project/x.db");
        assert_eq!(files[0].loader, Loader::File);
        assert!(matches!(files[0].output_kind, OutputKind::Asset));
        assert!(matches!(files[0].side, Some(Side::Client)));
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn long_path_fails() {
        with_test_context(
            |options| options.root_dir = Box::from(&b"/project"[..]),
            |context| {
                let path = [&b"/project/"[..], &[b'a'; bun_paths::MAX_PATH_BYTES]].concat();
                let file = SourceFile {
                    path: &path,
                    contents: b"bytes",
                    loader: Loader::File,
                };
                let embedded = EmbeddedFiles::default();
                let mut log = Log::init();
                assert!(embedded.embed_file(context, &file, &mut log).is_err());
                assert_eq!(log.errors, 1);
                assert!(
                    log.msgs[0]
                        .data
                        .text
                        .starts_with(b"the embedded file \"/project/aaa")
                );
                assert!(log.msgs[0].data.text.ends_with(b"\" is too long"));
                assert!(embedded.check_names(&mut log).is_ok());
                assert!(embedded.into_output_files().is_empty());
            },
        );
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn runtime_require_loader_wins_among_equal_copies() {
        for loaders in [
            [Loader::File, Loader::SqliteEmbedded],
            [Loader::SqliteEmbedded, Loader::File],
        ] {
            let (paths, files) = embed_under_loaders(&loaders);
            assert_eq!(paths[0], paths[1]);
            assert_eq!(files.len(), 1);
            assert_eq!(files[0].loader, Loader::SqliteEmbedded);
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn embedding_order_does_not_choose_loader() {
        for loaders in [[Loader::File, Loader::Wasm], [Loader::Wasm, Loader::File]] {
            let (_, files) = embed_under_loaders(&loaders);
            assert_eq!(files.len(), 1);
            assert_eq!(files[0].loader, Loader::File);
        }
    }

    #[test]
    fn insertion_order_does_not_change_result() {
        let first = EmbeddedFiles::default();
        let second = EmbeddedFiles::default();
        let mut log = Log::init();
        let outputs: [(&[u8], &[u8]); 3] = [(b"/a", b"z"), (b"/b", b"y"), (b"/c", b"z")];
        for (source, dest_path) in outputs {
            first.embed_page_outputs(vec![create_output(dest_path, source, b"1", u32::MAX)]);
        }
        for (source, dest_path) in outputs.into_iter().rev() {
            second.embed_page_outputs(vec![create_output(dest_path, source, b"1", u32::MAX)]);
        }
        assert!(first.check_names(&mut log).is_ok());
        assert!(second.check_names(&mut log).is_ok());
        let first_files = first.into_output_files();
        let second_files = second.into_output_files();
        assert_eq!(summarize(&first_files), summarize(&second_files));
        assert_eq!(first_files[1].src_path.text, second_files[1].src_path.text);
    }

    fn embed_files(files: &[SourceFile<'_>]) -> Vec<OutputFile> {
        with_test_context(
            |_| {},
            |context| {
                let embedded = EmbeddedFiles::default();
                for file in files {
                    assert!(embedded.embed_file(context, file, &mut Log::init()).is_ok());
                }
                assert!(embedded.check_names(&mut Log::init()).is_ok());
                embedded.into_output_files()
            },
        )
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn push_order_does_not_change_list() {
        let mut sources = [
            SourceFile {
                path: b"/project/b.png",
                contents: b"b",
                loader: Loader::File,
            },
            SourceFile {
                path: b"/project/a.wasm",
                contents: b"a",
                loader: Loader::Wasm,
            },
            SourceFile {
                path: b"/project/x.db",
                contents: b"x",
                loader: Loader::File,
            },
            SourceFile {
                path: b"/project/x.db",
                contents: b"x",
                loader: Loader::SqliteEmbedded,
            },
        ];
        let first = embed_files(&sources);
        sources.reverse();
        let second = embed_files(&sources);
        assert_eq!(first.len(), 3);
        assert!(first.is_sorted_by(|left, right| left.dest_path < right.dest_path));
        assert_eq!(summarize(&first), summarize(&second));
        for (left, right) in first.iter().zip(&second) {
            assert_eq!(left.src_path.text, right.src_path.text);
            assert_eq!(left.loader, right.loader);
        }
    }
}
