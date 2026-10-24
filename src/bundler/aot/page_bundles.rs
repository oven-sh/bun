use core::ptr::NonNull;
use std::borrow::Cow;

use bstr::BStr;
use bun_alloc::Arena;
use bun_aot::load::source_provider::Failed;
use bun_ast::{Loc, Log, Source};
use bun_event_loop::AnyEventLoop;
use bun_js_printer::Encoding;
use bun_paths::fs::Path;
use bun_resolver::compiled_program::compare_source_paths;
use bun_sema::atom::Interner;
use bun_sema::hir_from_data::DataValue;

use super::assets::EmbeddedFiles;
use super::data_values::{data_value_from_expr, report_not_data};
use super::services::{BuildContext, with_ast_scope};
use crate::bundle_v2::bv2_impl::generate_unique_key;
use crate::mal_prelude::*;
use crate::options::{CompileMode, Loader, ModuleType, OutputFile, OutputKind, Side, Target};
use crate::{BundleV2, Chunk, Index, Transpiler};

const ENTRY_NAMESPACE: &[u8] = b"bun-aot-page";
const ENTRY_FILE_NAME: &[u8] = b"page-entry.js";
const NO_OUTPUT_FILE: u32 = u32::MAX;

struct PageOutputs {
    manifests: Vec<Vec<u8>>,
    output_files: Vec<OutputFile>,
}

pub(crate) fn bundle_pages<'s>(
    context: &BuildContext,
    embedded: &EmbeddedFiles,
    pages: &[&[u8]],
    arena: &'s Arena,
    atoms: &Interner<'s>,
    log: &mut Log,
) -> Result<Vec<&'s DataValue<'s>>, Failed> {
    if pages.is_empty() {
        return Ok(Vec::new());
    }
    let PageOutputs {
        manifests,
        output_files,
    } = create_page_outputs(context, pages, log)?;
    embedded.embed_page_outputs(collect_client_files(output_files));
    pages
        .iter()
        .zip(&manifests)
        .map(|(page, manifest)| parse_page_manifest(manifest, page, arena, atoms, log))
        .collect()
}

fn create_page_outputs(
    context: &BuildContext,
    pages: &[&[u8]],
    log: &mut Log,
) -> Result<PageOutputs, Failed> {
    with_ast_scope(|heap| {
        let mut page_log = Log::init();
        let transpiler = create_page_transpiler(context, heap, &raw mut page_log);
        let transpiler_pointer: *mut Transpiler<'_> = transpiler;
        let mut any_loop = AnyEventLoop::default();
        let carrier = context.bundle();

        let result = BundleV2::init(
            // SAFETY: `transpiler_pointer` is the unique slot `heap.alloc` returned, and it lives in `heap`.
            unsafe { &mut *transpiler_pointer },
            None,
            heap,
            Some(NonNull::from(&mut any_loop)),
            false,
            NonNull::new(carrier.graph.pool().worker_pool),
            heap,
        )
        .and_then(|mut bundle| {
            bundle.plugins = carrier.plugins;
            bundle.plugin_context = carrier.plugin_context;
            bundle.completion = carrier.completion;
            bundle.file_map = carrier.file_map;

            let result = run(&mut bundle, pages, heap);
            bundle.deinit_without_freeing_arena();
            drop(bundle);
            result
        });

        // SAFETY: the bundle that borrowed the transpiler is gone, so this is the only pointer to it. The arena frees
        // the struct's bytes, and `drop_in_place` releases what its fields own on the global heap. No double free.
        unsafe {
            if let Some(macros) = (*transpiler_pointer).macro_context.take() {
                macros.deinit();
            }
            core::ptr::drop_in_place(transpiler_pointer);
        }

        let has_page_errors = page_log.errors > 0;
        page_log.append_to_with_recycled(log, true);

        result.map_err(|error| {
            if !has_page_errors {
                log.add_error_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!("{} while bundling HTML imports", error.name()),
                );
            }
            Failed
        })
    })
}

#[allow(clippy::mut_from_ref)] // allocated in the arena
fn create_page_transpiler<'h>(
    context: &BuildContext,
    heap: &'h Arena,
    log: *mut Log,
) -> &'h mut Transpiler<'h> {
    // SAFETY: the carrier's transpiler outlives this one, which `create_page_outputs` destroys before it returns, and
    // `log` is non-null and outlives it too.
    let transpiler =
        heap.alloc(unsafe { Transpiler::for_worker(context.bundle().transpiler(), heap, log) });

    let options = &mut transpiler.options;
    options.type_check = None;
    options.metafile = false;
    options.metafile_json_path = Box::default();
    options.metafile_markdown_path = Box::default();
    options.bytecode = false;
    options.output_dir = Box::default();
    options.output_dir_handle = None;
    options.entry_points = Box::default();
    options.compile_mode = CompileMode::Executable;
    options.public_path.clone_from(&context.module_prefix);
    options.banner = Cow::Borrowed(b"");
    options.footer = Cow::Borrowed(b"");

    transpiler.sync_resolver_opts();
    transpiler.wire_after_move();
    transpiler
}

fn create_entry_source(pages: &[&[u8]], heap: &Arena) -> Source {
    let mut text: Vec<u8> = Vec::new();
    for (index, page) in pages.iter().enumerate() {
        text.extend_from_slice(format!("import page{index} from ").as_bytes());
        bun_js_printer::write_json_string::<_, { Encoding::Utf8 }>(page, &mut text)
            .expect("writing to a Vec cannot fail");
        text.extend_from_slice(b" with { type: \"html\" };\n");
    }
    let names: Vec<String> = (0..pages.len())
        .map(|index| format!("page{index}"))
        .collect();
    text.extend_from_slice(format!("export default [{}];\n", names.join(", ")).as_bytes());

    let first_page = pages.first().copied().unwrap_or_default();
    let directory_length = first_page.len() - bun_paths::basename(first_page).len();
    let mut entry_path = first_page[..directory_length].to_vec();
    entry_path.extend_from_slice(ENTRY_FILE_NAME);

    let mut source = Source::init_path_string(
        &*heap.alloc_slice_copy(&entry_path),
        &*heap.alloc_slice_copy(&text),
    );
    source.path = Path::init_with_namespace(source.path.text, ENTRY_NAMESPACE);
    source
}

fn run(
    bundle: &mut BundleV2<'_>,
    pages: &[&[u8]],
    heap: &Arena,
) -> Result<PageOutputs, crate::Error> {
    bundle.unique_key = generate_unique_key();
    bundle.enqueue_entry_points_normal::<&[u8]>(&[])?;

    let mut source = create_entry_source(pages, heap);
    let index =
        bundle.enqueue_parse_task2(&mut source, Loader::Js, Target::Bun, ModuleType::Esm)?;
    bundle.graph.entry_points.push(Index::init(index));

    bundle.wait_for_parse();
    if bundle.transpiler.log().errors > 0 {
        return Err(crate::Error::BuildFailed);
    }
    bundle.fail_if_no_entry_points()?;

    bundle.scan_for_secondary_paths();
    bundle.process_server_component_manifest_files()?;
    bundle.clone_ast()?;

    let reachable_files = bundle.find_reachable_files()?;
    bundle.process_files_to_copy(&reachable_files)?;
    bundle.add_server_component_boundaries_as_extra_entry_points()?;

    // SAFETY: as in `run_from_js_in_new_thread`: every borrow comes from the one raw pointer, so projecting `linker`
    // does not invalidate `entry_points` or `boundaries`.
    let mut chunks = unsafe {
        let bundle_pointer: *mut BundleV2<'_> = &raw mut *bundle;
        let entry_points = (*bundle_pointer).graph.entry_points.as_slice();
        let boundaries = &(*bundle_pointer).graph.server_component_boundaries;
        (*bundle_pointer)
            .linker
            .link(bundle_pointer, entry_points, boundaries, &reachable_files)?
    };
    if bundle.transpiler.log().errors > 0 {
        return Err(crate::Error::BuildFailed);
    }

    let output_files = crate::linker_context_mod::generate_chunks_in_parallel::<false>(
        &mut bundle.linker,
        &mut chunks,
    )?;

    let manifests = write_page_manifests(bundle, &chunks, &output_files, pages)?;
    Ok(PageOutputs {
        manifests,
        output_files,
    })
}

fn write_page_manifests(
    bundle: &BundleV2<'_>,
    chunks: &[Chunk],
    output_files: &[OutputFile],
    pages: &[&[u8]],
) -> Result<Vec<Vec<u8>>, crate::Error> {
    let server_source_indices = &bundle.graph.html_imports.server_source_indices;
    if server_source_indices.len() != pages.len() {
        return Err(report_page_count(
            bundle,
            server_source_indices.len(),
            pages.len(),
        ));
    }

    let mut positions_by_path: Vec<(&[u8], usize)> = pages.iter().copied().zip(0..).collect();
    positions_by_path.sort_unstable_by(|a, b| compare_source_paths(a.0, b.0));

    let sources = bundle.graph.input_files.items_source();
    let mut manifests: Vec<Option<Vec<u8>>> = vec![None; pages.len()];
    for (index, &source_index) in server_source_indices.iter().enumerate() {
        let path: &[u8] = sources[source_index as usize].path.text;
        let Ok(found) =
            positions_by_path.binary_search_by(|&(page, _)| compare_source_paths(page, path))
        else {
            continue;
        };

        // `generate_chunks_in_parallel` moved the copied files out of the graph and into `output_files`.
        let mut manifest: Vec<u8> = Vec::new();
        crate::HTMLImportManifest::write_with_assets(
            index as u32,
            &bundle.graph,
            &bundle.linker.graph,
            chunks,
            output_files,
            &mut manifest,
        )?;
        manifests[positions_by_path[found].1] = Some(manifest);
    }

    let bundled_count = manifests.iter().flatten().count();
    if bundled_count != pages.len() {
        return Err(report_page_count(bundle, bundled_count, pages.len()));
    }
    Ok(manifests.into_iter().flatten().collect())
}

fn report_page_count(
    bundle: &BundleV2<'_>,
    bundled_count: usize,
    requested_count: usize,
) -> crate::Error {
    bundle.transpiler().log_mut().add_error_fmt(
        None,
        Loc::EMPTY,
        format_args!("{bundled_count} pages were bundled, {requested_count} were asked for"),
    );
    crate::Error::BuildFailed
}

fn parse_page_manifest<'s>(
    manifest: &[u8],
    path: &[u8],
    arena: &'s Arena,
    atoms: &Interner<'s>,
    log: &mut Log,
) -> Result<&'s DataValue<'s>, Failed> {
    let source = Source::init_path_string(path, manifest);
    with_ast_scope(|scratch| {
        let Ok(root) = bun_parsers::json::parse_json_into_arena(&source, log, scratch) else {
            let path = BStr::new(path);
            log.add_error_fmt(
                Some(&source),
                Loc::EMPTY,
                format_args!("the manifest of \"{path}\" is not JSON"),
            );
            return Err(Failed);
        };
        data_value_from_expr(&root, scratch, arena, atoms).map_err(|error| {
            report_not_data(log, path, "the manifest", error);
            Failed
        })
    })
}

fn is_client_output(file: &OutputFile) -> bool {
    match file.output_kind {
        OutputKind::Chunk | OutputKind::EntryPoint | OutputKind::Asset => {
            file.side != Some(Side::Server)
        }
        _ => false,
    }
}

fn collect_client_files(outputs: Vec<OutputFile>) -> Vec<OutputFile> {
    let client_files: Vec<bool> = outputs.iter().map(is_client_output).collect();

    let mut is_kept = client_files.clone();
    for (file, is_client) in outputs.iter().zip(&client_files) {
        if *is_client && file.source_map_index != NO_OUTPUT_FILE {
            is_kept[file.source_map_index as usize] = true;
        }
    }

    let mut next_position = 0u32;
    let new_positions: Vec<Option<u32>> = is_kept
        .iter()
        .map(|kept| {
            kept.then(|| {
                let position = next_position;
                next_position += 1;
                position
            })
        })
        .collect();

    outputs
        .into_iter()
        .zip(is_kept)
        .filter(|(_, kept)| *kept)
        .map(|(mut file, _)| {
            if file.source_map_index != NO_OUTPUT_FILE {
                file.source_map_index =
                    new_positions[file.source_map_index as usize].unwrap_or(NO_OUTPUT_FILE);
            }
            file.bytecode_index = NO_OUTPUT_FILE;
            file.module_info_index = NO_OUTPUT_FILE;
            file
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use bun_sema::session::Session;

    use super::super::services::with_test_context;
    use super::*;

    fn output(
        name: &[u8],
        kind: OutputKind,
        side: Option<Side>,
        source_map_index: u32,
    ) -> OutputFile {
        let mut file = OutputFile::zero_value();
        file.dest_path = Box::from(name);
        file.output_kind = kind;
        file.side = side;
        file.source_map_index = source_map_index;
        file
    }

    fn names(files: &[OutputFile]) -> Vec<&[u8]> {
        files.iter().map(|file| &*file.dest_path).collect()
    }

    #[test]
    fn collect_client_files_drops_server_outputs() {
        let kept = collect_client_files(vec![
            output(b"server.js", OutputKind::EntryPoint, Some(Side::Server), 1),
            output(
                b"server.map",
                OutputKind::Sourcemap,
                Some(Side::Server),
                NO_OUTPUT_FILE,
            ),
            output(b"client.js", OutputKind::Chunk, Some(Side::Client), 3),
            output(
                b"client.map",
                OutputKind::Sourcemap,
                Some(Side::Client),
                NO_OUTPUT_FILE,
            ),
            output(b"logo.svg", OutputKind::Asset, None, NO_OUTPUT_FILE),
            output(
                b"graph",
                OutputKind::PrelinkedModuleGraph,
                None,
                NO_OUTPUT_FILE,
            ),
        ]);

        assert_eq!(
            names(&kept),
            [&b"client.js"[..], &b"client.map"[..], &b"logo.svg"[..]]
        );
        assert_eq!(kept[0].source_map_index, 1);
        assert_eq!(kept[2].source_map_index, NO_OUTPUT_FILE);
    }

    #[test]
    fn collect_client_files_clears_bytecode_indexes() {
        let side = Some(Side::Client);
        let mut chunk = output(b"client.js", OutputKind::Chunk, side, NO_OUTPUT_FILE);
        chunk.bytecode_index = 4;
        chunk.module_info_index = 5;

        let kept = collect_client_files(vec![chunk]);

        assert_eq!(kept[0].bytecode_index, NO_OUTPUT_FILE);
        assert_eq!(kept[0].module_info_index, NO_OUTPUT_FILE);
    }

    #[test]
    fn collect_client_files_drops_unreferenced_source_map() {
        let kept = collect_client_files(vec![
            output(
                b"orphan.map",
                OutputKind::Sourcemap,
                Some(Side::Client),
                NO_OUTPUT_FILE,
            ),
            output(
                b"client.js",
                OutputKind::Chunk,
                Some(Side::Client),
                NO_OUTPUT_FILE,
            ),
        ]);

        assert_eq!(names(&kept), [&b"client.js"[..]]);
    }

    fn assert_entry_imports_page(pages: &[&[u8]]) {
        with_ast_scope(|heap| {
            let source = create_entry_source(pages, heap);
            assert_eq!(source.path.namespace, ENTRY_NAMESPACE);

            let options = bun_js_parser::ParserOptions::init(Default::default(), Loader::Js);
            let define = bun_js_parser::Define::default();
            let mut log = Log::init();
            let parser = bun_js_parser::Parser::init(options, &mut log, &source, &define, heap)
                .expect("the parser starts");
            let bun_js_parser::Result::Ast(ast) = parser.parse().expect("the entry parses") else {
                panic!("the entry is an ordinary module");
            };

            assert_eq!(ast.import_records.len(), pages.len());
            for (index, page) in pages.iter().enumerate() {
                assert_eq!(ast.import_records[index].path.text, *page);
            }
        });
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn create_entry_source_escapes_quotes() {
        assert_entry_imports_page(&[b"/p/a \"b\".html"]);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn create_entry_source_escapes_backslashes() {
        assert_entry_imports_page(&[b"C:\\p\\a.html"]);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn entry_imports_every_page_in_order() {
        assert_entry_imports_page(&[&b"/p/b.html"[..], b"/p/a.html", b"/q/index.html"]);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn entry_is_beside_first_page() {
        with_ast_scope(|heap| {
            let source = create_entry_source(&[&b"/q/b.html"[..], b"/p/a.html"], heap);
            assert_eq!(source.path.text, b"/q/page-entry.js");
        });
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn no_pages_start_no_bundle() {
        with_test_context(
            |_| {},
            |context| {
                let session = Session::new();
                let atoms = Interner::new_in(&session);
                let arena = Arena::new();
                let embedded = EmbeddedFiles::default();
                let mut log = Log::init();

                let manifests = bundle_pages(context, &embedded, &[], &arena, &atoms, &mut log);

                assert!(manifests.unwrap().is_empty());
                assert!(log.msgs.is_empty());
                assert!(embedded.into_output_files().is_empty());
            },
        );
    }
}
