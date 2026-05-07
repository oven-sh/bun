use crate::mal_prelude::*;
use bun_alloc::Arena;
use crate::ungate_support::DeclInfoKind;
use crate::analyze_transpiled_module::{self, ModuleInfo};
use bun_js_printer::{self as js_printer, PrintResult};
use crate::linker_context_mod::{GenerateChunkCtx, LinkerOptionsMode};
use crate::LinkerContext;
use crate::options;
use crate::options_impl::{LoaderExt as _, TargetExt as _};
use crate::bundle_v2::bake_types::{get_hmr_runtime, HmrRuntimeSide};
use crate::{
    Chunk, CompileResult, CompileResultForSourceMap, Index, JSAst, JSMeta, RefImportData,
    ResolvedExports, ThreadPool,
};
use bun_collections::VecExt;
use bun_collections::MultiArrayList;
use bun_core::perf;
use bun_js_parser::ast::{self as js_ast, Binding, Expr, Part, Ref, Scope, Stmt, StmtData, StmtOrExpr, B, E, G, S};
use bun_logger as Logger;
use bun_options_types::{ImportRecord, ImportRecordTag, ImportRecordFlags};
use bun_sourcemap as SourceMap;
use bun_string::{strings, MutableString, string_joiner::{StringJoiner, Watcher}};

#[allow(dead_code)]
type IndexInt = u32;

/// Helper: get printed code from a `PrintResult` (Zig: `result.result.code`).
fn print_result_code(r: &PrintResult) -> &[u8] {
    match r {
        PrintResult::Result(ok) => &ok.code,
        PrintResult::Err(_) => b"",
    }
}

/// Move the printed code out of a `PrintResult`. Mirrors Zig
/// `j.push(result.code, worker.allocator)` where the joiner takes ownership of
/// the slice — the Rust `PrintResultSuccess.code` is a `Box<[u8]>` that would
/// otherwise drop at end of `post_process_js_chunk` and leave the deferred
/// `IntermediateOutput::Joiner` path holding freed memory.
fn print_result_take_code(r: &mut PrintResult) -> Box<[u8]> {
    match r {
        PrintResult::Result(ok) => core::mem::take(&mut ok.code),
        PrintResult::Err(_) => Box::default(),
    }
}

/// This runs after we've already populated the compile results
pub fn post_process_js_chunk(
    ctx: GenerateChunkCtx,
    worker: &mut ThreadPool::Worker,
    chunk: &mut Chunk,
    chunk_index: usize,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let _trace = perf::trace("Bundler.postProcessJSChunk");

    let _ = chunk_index;
    // SAFETY: `ctx.c` is a non-null backref into `BundleV2.linker`, valid for the
    // duration of chunk post-processing (single-threaded per chunk).
    let c: &mut LinkerContext = unsafe { &mut *ctx.c };
    debug_assert!(matches!(chunk.content, crate::chunk::Content::Javascript(_)));

    js_ast::expr::data::Store::create();
    js_ast::stmt::data::Store::create();

    // TODO(port): `defer chunk.renamer.deinit(bun.default_allocator)` — Zig explicitly
    // tears down the renamer at end of scope. In Rust this should be handled by Drop on
    // the renamer field, or an explicit `chunk.renamer.take()` at fn exit. Verify in Phase B.

    // PERF(port): was arena bulk-free — profile in Phase B
    let mut arena = Arena::new();

    // Also generate the cross-chunk binding code
    let mut cross_chunk_prefix: PrintResult;
    let mut cross_chunk_suffix: PrintResult;

    let runtime_input_file =
        c.graph.files.items_input_file()[Index::RUNTIME.value as usize].get() as usize;
    let runtime_scope: &mut Scope =
        &mut c.graph.ast.items_module_scope_mut()[runtime_input_file];
    let runtime_members = &mut runtime_scope.members;
    let to_common_js_ref = c.graph.symbols.follow(runtime_members.get(&b"__toCommonJS"[..]).unwrap().ref_);
    let to_esm_ref = c.graph.symbols.follow(runtime_members.get(&b"__toESM"[..]).unwrap().ref_);
    let runtime_require_ref = if c.options.output_format == options::OutputFormat::Cjs {
        None
    } else {
        Some(c.graph.symbols.follow(runtime_members.get(&b"__require"[..]).unwrap().ref_))
    };

    // Create ModuleInfo for ESM bytecode in --compile builds
    let generate_module_info = c.options.generate_bytecode_cache
        && c.options.output_format == options::OutputFormat::Esm
        && c.options.compile;
    let loader = c.parse_graph().input_files.items_loader()[chunk.entry_point.source_index() as usize];
    let is_typescript = loader.is_type_script();
    // Zig: ModuleInfo.create(bun.default_allocator, ...) returns heap-allocated *ModuleInfo,
    // later stored on chunk.content.javascript.module_info — OWNED → Box<ModuleInfo>.
    let mut module_info: Option<Box<ModuleInfo>> = if generate_module_info {
        Some(ModuleInfo::create(is_typescript))
    } else {
        None
    };

    // SAFETY: worker.arena is set in Worker::init() before any task runs.
    let worker_arena: &Arena = unsafe { &*worker.arena };

    {
        // PORT NOTE: Zig builds one `print_options` and passes it by-value twice.
        // Rust `Options` is not `Copy` (holds `&mut ModuleInfo`), and a closure
        // taking `&mut ModuleInfo` can't express "output lifetime = input
        // lifetime" — so build a base with `module_info: None` and override it
        // via FRU at each call site.
        let make_print_options = || js_printer::Options {
            bundling: true,
            indent: Default::default(),
            has_run_symbol_renamer: true,

            require_ref: runtime_require_ref,
            minify_whitespace: c.options.minify_whitespace,
            minify_identifiers: c.options.minify_identifiers,
            minify_syntax: c.options.minify_syntax,
            target: c.options.target,
            print_dce_annotations: c.options.emit_dce_annotations,
            mangled_props: Some(&c.mangled_props),
            module_info: None,
            // .const_values = c.graph.const_values,
            ..Default::default()
        };

        let mut cross_chunk_import_records: Vec<ImportRecord> =
            Vec::with_capacity(chunk.cross_chunk_imports.len() as usize);
        // PERF(port): was initCapacity catch unreachable
        for import_record in chunk.cross_chunk_imports.slice() {
            // PERF(port): was appendAssumeCapacity
            cross_chunk_import_records.push(ImportRecord {
                kind: import_record.import_kind,
                // SAFETY: chunk_index is in-bounds (produced by the linker for this chunks slice).
                path: bun_paths::fs::Path::init(unsafe { &(*ctx.chunks)[import_record.chunk_index as usize] }.unique_key),
                range: Logger::Range::NONE,
                // Remaining fields take their Zig defaults (no Default impl):
                tag: ImportRecordTag::None,
                loader: None,
                source_index: Index::INVALID,
                module_id: 0,
                original_path: b"",
                flags: ImportRecordFlags::default(),
            });
        }

        // PORT NOTE: `MultiArrayList::get` returns `ManuallyDrop<BundledAst>` —
        // the storage retains ownership of every Drop field (`named_imports`,
        // `parts`, `top_level_symbols_to_parts`, …), so the gathered struct
        // must NOT run Drop. `to_ast` consumes by value, so unwrap, convert,
        // and re-wrap the result (which carries the same heap pointers).
        let ast_view = core::mem::ManuallyDrop::new(
            core::mem::ManuallyDrop::into_inner(
                c.graph.ast.get(chunk.entry_point.source_index() as usize),
            )
            .to_ast(),
        );
        let source = c.get_source(chunk.entry_point.source_index());
        let target = c.resolver().opts.target;

        // Hoist `*mut [Stmt]` extraction so the two `&mut chunk` borrows below
        // (content vs renamer) don't overlap inside a single expression.
        let prefix_stmts: *mut [Stmt] =
            std::ptr::from_mut::<[Stmt]>(chunk.content.javascript_mut().cross_chunk_prefix_stmts.slice_mut());
        let suffix_stmts: *mut [Stmt] =
            std::ptr::from_mut::<[Stmt]>(chunk.content.javascript_mut().cross_chunk_suffix_stmts.slice_mut());

        cross_chunk_prefix = js_printer::print::<false>(
            worker_arena,
            target,
            &ast_view,
            source,
            js_printer::Options {
                module_info: module_info.as_deref_mut(),
                ..make_print_options()
            },
            cross_chunk_import_records.as_slice(),
            &[Part {
                stmts: prefix_stmts,
                ..Default::default()
            }],
            chunk.renamer.as_renamer(),
        );
        cross_chunk_suffix = js_printer::print::<false>(
            worker_arena,
            target,
            &ast_view,
            source,
            js_printer::Options {
                module_info: module_info.as_deref_mut(),
                ..make_print_options()
            },
            &[],
            &[Part {
                stmts: suffix_stmts,
                ..Default::default()
            }],
            chunk.renamer.as_renamer(),
        );
    }

    // Populate ModuleInfo with declarations collected during parallel printing,
    // external import records from the original AST, and wrapper refs.
    if let Some(mi) = module_info.as_deref_mut() {
        // 1. Add declarations collected by DeclCollector during parallel part printing.
        // These come from the CONVERTED statements (after convertStmtsForChunk transforms
        // export default → var, strips exports, etc.), so they match what's actually printed.
        for cr in chunk.compile_results_for_chunk.iter() {
            let decls = match cr {
                CompileResult::Javascript { decls, .. } => decls,
                _ => continue,
            };
            for decl in decls.iter() {
                let var_kind: analyze_transpiled_module::VarKind = match decl.kind {
                    DeclInfoKind::Declared => analyze_transpiled_module::VarKind::Declared,
                    DeclInfoKind::Lexical => analyze_transpiled_module::VarKind::Lexical,
                };
                let string_id = mi.str(&decl.name);
                mi.add_var(string_id, var_kind);
            }
        }

        // 1b. Check if any source in this chunk uses import.meta. The per-part
        // parallel printer does not have module_info, so the printer cannot set
        // this flag during per-part printing. We derive it from the AST instead.
        // Note: the runtime source (index 0) also uses import.meta (e.g.
        // `import.meta.require`), so we must not skip it.
        {
            let all_ast_flags = c.graph.ast.items_flags();
            for part_range in chunk.content.javascript().parts_in_chunk_in_order.iter() {
                if all_ast_flags[part_range.source_index.get() as usize].contains(js_ast::bundled_ast::Flags::HAS_IMPORT_META) {
                    mi.flags.contains_import_meta = true;
                    break;
                }
            }
        }

        // 1c. Same idea for top-level await. The new JSC module loader decides
        // sync vs async evaluation from JSModuleRecord::hasTLA(), which we set
        // from this bit when constructing the record from cached module_info
        // (BunAnalyzeTranspiledModule). Without it, a bytecode-compiled module
        // that contains TLA gets evaluated on the sync path and the suspended
        // generator is dropped — the entry promise resolves immediately and the
        // process exits before the awaited value lands.
        {
            let tla_keywords = c.parse_graph().ast.items_top_level_await_keyword();
            let wraps = c.graph.meta.items_flags();
            for part_range in chunk.content.javascript().parts_in_chunk_in_order.iter() {
                let idx = part_range.source_index.get() as usize;
                if idx >= tla_keywords.len() {
                    continue;
                }
                if wraps[idx].wrap != crate::WrapKind::None {
                    continue;
                }
                if !tla_keywords[idx].is_empty() {
                    mi.flags.has_tla = true;
                    break;
                }
            }
        }

        // 2. Collect truly-external imports from the original AST. Bundled imports
        // (where source_index is valid) are removed by convertStmtsForChunk and
        // re-created as cross-chunk imports — those are already captured by the
        // printer when it prints cross_chunk_prefix_stmts above. Only truly-external
        // imports (node built-ins, etc.) survive as s_import in per-file parts and
        // need recording here.
        let all_parts = c.graph.ast.items_parts();
        let all_flags = c.graph.meta.items_flags();
        let all_import_records = c.graph.ast.items_import_records();
        for part_range in chunk.content.javascript().parts_in_chunk_in_order.iter() {
            if all_flags[part_range.source_index.get() as usize].wrap == crate::WrapKind::Cjs {
                continue;
            }
            let source_parts = all_parts[part_range.source_index.get() as usize].slice();
            let source_import_records = all_import_records[part_range.source_index.get() as usize].slice();
            let mut part_i = part_range.part_index_begin;
            while part_i < part_range.part_index_end {
                // SAFETY: Part.stmts is a non-null arena `*mut [Stmt]` valid for the bundler arena lifetime.
                for stmt in unsafe { (*source_parts[part_i as usize].stmts).iter() } {
                    match &stmt.data {
                        StmtData::SImport(s) => {
                            let record = &source_import_records[s.import_record_index as usize];
                            if record.path.is_disabled {
                                continue;
                            }
                            if record.tag == ImportRecordTag::Bun {
                                continue;
                            }
                            // Skip bundled imports — these are converted to cross-chunk
                            // imports by the linker. The printer already recorded them
                            // when printing cross_chunk_prefix_stmts.
                            if record.source_index.is_valid() {
                                continue;
                            }
                            // Skip barrel-optimized-away imports — marked is_unused by
                            // barrel_imports.zig. Never resolved (source_index invalid),
                            // and removed by convertStmtsForChunk. Not in emitted code.
                            if record.flags.contains(ImportRecordFlags::IS_UNUSED) {
                                continue;
                            }

                            let import_path = record.path.text;
                            let irp_id = mi.str(import_path);
                            mi.request_module(irp_id, analyze_transpiled_module::ImportAttributes::None);

                            if let Some(name) = &s.default_name {
                                if let Some(name_ref) = name.ref_ {
                                    let local_name_id = {
                                        let local_name = chunk.renamer.name_for_symbol(name_ref);
                                        mi.str(local_name)
                                    };
                                    mi.add_var(local_name_id, analyze_transpiled_module::VarKind::Lexical);
                                    let default_id = mi.str(b"default");
                                    mi.add_import_info_single(irp_id, default_id, local_name_id, false);
                                }
                            }

                            // SAFETY: S::Import.items is arena-owned `*mut [ClauseItem]`; never null.
                            for item in unsafe { (*s.items).iter() } {
                                if let Some(name_ref) = item.name.ref_ {
                                    let local_name_id = {
                                        let local_name = chunk.renamer.name_for_symbol(name_ref);
                                        mi.str(local_name)
                                    };
                                    mi.add_var(local_name_id, analyze_transpiled_module::VarKind::Lexical);
                                    // SAFETY: ClauseItem.alias is an arena `*const [u8]`; never null.
                                    let alias_id = mi.str(unsafe { &*item.alias });
                                    mi.add_import_info_single(irp_id, alias_id, local_name_id, false);
                                }
                            }

                            if record.flags.contains(ImportRecordFlags::CONTAINS_IMPORT_STAR) {
                                let local_name_id = {
                                    let local_name = chunk.renamer.name_for_symbol(s.namespace_ref);
                                    mi.str(local_name)
                                };
                                mi.add_var(local_name_id, analyze_transpiled_module::VarKind::Lexical);
                                mi.add_import_info_namespace(irp_id, local_name_id);
                            }
                        }
                        _ => {}
                    }
                }
                part_i += 1;
            }
        }

        // 3. Add wrapper-generated declarations (init_xxx, require_xxx) that are
        // not in any part statement.
        let all_wrapper_refs = c.graph.ast.items_wrapper_ref();
        for part_range in chunk.content.javascript().parts_in_chunk_in_order.iter() {
            let source_index = part_range.source_index.get() as usize;
            if all_flags[source_index].wrap != crate::WrapKind::None {
                let wrapper_ref = all_wrapper_refs[source_index];
                if !wrapper_ref.is_empty() {
                    let string_id = {
                        let name = chunk.renamer.name_for_symbol(wrapper_ref);
                        if name.is_empty() { continue; }
                        mi.str(name)
                    };
                    mi.add_var(string_id, analyze_transpiled_module::VarKind::Declared);
                }
            }
        }
    }

    // Generate the exports for the entry point, if there are any.
    // This must happen before module_info serialization so the printer
    // can populate export entries in module_info.
    let entry_point_tail = 'brk: {
        if chunk.is_entry_point() {
            break 'brk generate_entry_point_tail_js(
                c,
                to_common_js_ref,
                to_esm_ref,
                chunk.entry_point.source_index(),
                worker_arena,
                &arena,
                chunk.renamer.as_renamer(),
                module_info.as_deref_mut(),
            );
        }

        break 'brk CompileResult::Javascript {
            source_index: Index::INVALID.value,
            result: PrintResult::Result(js_printer::PrintResultSuccess {
                code: Box::default(),
                source_map: None,
            }),
            decls: Box::default(),
        };
    };

    // Store unserialized ModuleInfo on the chunk. Serialization is deferred to
    // generateChunksInParallel after final chunk paths are computed, so that
    // cross-chunk import specifiers (which use unique_key placeholders during
    // printing) can be resolved to actual paths.
    if let Some(mi) = module_info {
        chunk.content.javascript_mut().module_info = Some(mi);
    }

    let mut j = StringJoiner::default();
    j.watcher = Watcher {
        input: chunk.unique_key,
        ..Default::default()
    };
    // errdefer j.deinit() — deleted; StringJoiner has Drop
    let output_format = c.options.output_format;

    let mut line_offset: SourceMap::LineColumnOffsetOptional =
        if c.options.source_maps != options::SourceMapOption::None {
            SourceMap::LineColumnOffsetOptional::Value(Default::default())
        } else {
            SourceMap::LineColumnOffsetOptional::Null
        };

    // Concatenate the generated JavaScript chunks together

    let mut newline_before_comment = false;
    let mut is_executable = false;

    // Extract hashbang and banner for entry points
    let (hashbang, banner): (&[u8], &[u8]) = if chunk.is_entry_point() {
        'brk: {
            let source_hashbang = c.graph.ast.items_hashbang()[chunk.entry_point.source_index() as usize];

            // If source file has a hashbang, use it
            if !source_hashbang.is_empty() {
                break 'brk (source_hashbang.slice(), c.options.banner);
            }

            // Otherwise check if banner starts with hashbang
            if !c.options.banner.is_empty() && c.options.banner.starts_with(b"#!") {
                let newline_pos = strings::index_of_char(c.options.banner, b'\n')
                    .map(|n| n as usize)
                    .unwrap_or(c.options.banner.len());
                let banner_hashbang = &c.options.banner[..newline_pos];

                break 'brk (
                    banner_hashbang,
                    strings::trim_left(&c.options.banner[newline_pos..], b"\r\n"),
                );
            }

            // No hashbang anywhere
            break 'brk (b"", c.options.banner);
        }
    } else {
        (b"", c.options.banner)
    };

    // Start with the hashbang if there is one. This must be done before the
    // banner because it only works if it's literally the first character.
    if !hashbang.is_empty() {
        j.push_static(hashbang);
        j.push_static(b"\n");
        line_offset.advance(hashbang);
        line_offset.advance(b"\n");
        newline_before_comment = true;
        is_executable = true;
    }

    // Add @bun comments and CJS wrapper start for each chunk when targeting Bun.
    let is_bun = c.graph.ast.items_target()[chunk.entry_point.source_index() as usize].is_bun();
    if is_bun {
        if c.options.generate_bytecode_cache && output_format == options::OutputFormat::Cjs {
            // Zig `++` literal concat → single byte literal (concat! yields &str, not &[u8])
            const INPUT: &[u8] =
                b"// @bun @bytecode @bun-cjs\n(function(exports, require, module, __filename, __dirname) {";
            j.push_static(INPUT);
            line_offset.advance(INPUT);
        } else if c.options.generate_bytecode_cache {
            j.push_static(b"// @bun @bytecode\n");
            line_offset.advance(b"// @bun @bytecode\n");
        } else if output_format == options::OutputFormat::Cjs {
            const INPUT: &[u8] =
                b"// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {";
            j.push_static(INPUT);
            line_offset.advance(INPUT);
        } else {
            j.push_static(b"// @bun\n");
            line_offset.advance(b"// @bun\n");
        }
    }

    // Add the banner (excluding any hashbang part) for all chunks
    if !banner.is_empty() {
        j.push_static(banner);
        line_offset.advance(banner);
        if !strings::ends_with_char(banner, b'\n') {
            j.push_static(b"\n");
            line_offset.advance(b"\n");
        }
        newline_before_comment = true;
    }

    // Add the top-level directive if present (but omit "use strict" in ES
    // modules because all ES modules are automatically in strict mode)
    if chunk.is_entry_point() && !output_format.is_always_strict_mode() {
        let flags = c.graph.ast.items_flags()[chunk.entry_point.source_index() as usize];

        if flags.contains(js_ast::bundled_ast::Flags::HAS_EXPLICIT_USE_STRICT_DIRECTIVE) {
            j.push_static(b"\"use strict\";\n");
            line_offset.advance(b"\"use strict\";\n");
            newline_before_comment = true;
        }
    }

    // For Kit, hoist runtime.js outside of the IIFE
    let compile_results = &chunk.compile_results_for_chunk;
    if c.options.output_format == options::OutputFormat::InternalBakeDev {
        for compile_result in compile_results.iter() {
            let source_index = compile_result.source_index();
            if source_index != Index::RUNTIME.value {
                break;
            }
            line_offset.advance(compile_result.code());
            j.push(compile_result.code());
        }
    }

    match c.options.output_format {
        options::OutputFormat::InternalBakeDev => {
            let start = get_hmr_runtime(if c.options.target.is_server_side() {
                HmrRuntimeSide::Server
            } else {
                HmrRuntimeSide::Client
            });
            j.push_static(start.code);
            line_offset.advance(start.code);
        }
        options::OutputFormat::Iife => {
            // Bun does not do arrow function lowering. So the wrapper can be an arrow.
            let start: &[u8] = if c.options.minify_whitespace {
                b"(()=>{"
            } else {
                b"(() => {\n"
            };
            j.push_static(start);
            line_offset.advance(start);
        }
        _ => {} // no wrapper
    }

    {
        // PORT NOTE: Zig `j.push(code, worker.allocator)` transferred ownership;
        // `cross_chunk_prefix` is a local that drops at fn exit, but the joiner
        // may be stashed on `chunk.intermediate_output` and consumed later
        // (`IntermediateOutput::Joiner` path). Move the Box into the joiner.
        let code = print_result_take_code(&mut cross_chunk_prefix);
        if !code.is_empty() {
            newline_before_comment = true;
            line_offset.advance(&code);
            j.push_owned(code);
        }
    }

    // Concatenate the generated JavaScript chunks together
    let mut prev_filename_comment: IndexInt = 0;

    let mut compile_results_for_source_map: MultiArrayList<CompileResultForSourceMap> =
        MultiArrayList::default();
    let _ = compile_results_for_source_map.set_capacity(compile_results.len()); // OOM/capacity: Zig aborts; port keeps fire-and-forget
    // bun.handleOom dropped — Rust aborts on OOM

    let show_comments =
        c.options.mode == LinkerOptionsMode::Bundle && !c.options.minify_whitespace;

    let emit_targets_in_commands = show_comments
        && (if let Some(fw) = c.framework {
            // SAFETY: framework is a non-null bundler-owned pointer when Some.
            unsafe { (*fw).server_components.is_some() }
        } else {
            false
        });

    let sources: &[Logger::Source] = c.parse_graph().input_files.items_source();
    let targets: &[options::Target] = c.parse_graph().ast.items_target();
    for compile_result in compile_results.iter() {
        let source_index = compile_result.source_index();
        let is_runtime = source_index == Index::RUNTIME.value;

        // TODO: extracated legal comments

        // Add a comment with the file path before the file contents
        if show_comments && source_index != prev_filename_comment && !compile_result.code().is_empty() {
            prev_filename_comment = source_index;

            if newline_before_comment {
                j.push_static(b"\n");
                line_offset.advance(b"\n");
            }

            // Make sure newlines in the path can't cause a syntax error.
            enum CommentType {
                Multiline,
                Single,
            }

            let pretty = sources[source_index as usize].path.pretty;

            // TODO: quote this. This is really janky.
            let comment_type = if strings::index_of_newline_or_non_ascii(pretty, 0).is_some() {
                CommentType::Multiline
            } else {
                CommentType::Single
            };

            if !c.options.minify_whitespace
                && (output_format == options::OutputFormat::Iife
                    || output_format == options::OutputFormat::InternalBakeDev)
            {
                j.push_static(b"  ");
                line_offset.advance(b"  ");
            }

            match comment_type {
                CommentType::Multiline => {
                    j.push_static(b"/* ");
                    line_offset.advance(b"/* ");
                }
                CommentType::Single => {
                    j.push_static(b"// ");
                    line_offset.advance(b"// ");
                }
            }

            j.push_static(pretty);
            line_offset.advance(pretty);

            if emit_targets_in_commands {
                j.push_static(b" (");
                line_offset.advance(b" (");
                let target: &'static str =
                    <&'static str>::from(targets[source_index as usize].bake_graph());
                j.push_static(target.as_bytes());
                line_offset.advance(target.as_bytes());
                j.push_static(b")");
                line_offset.advance(b")");
            }

            match comment_type {
                CommentType::Multiline => {
                    j.push_static(b" */\n");
                    line_offset.advance(b" */\n");
                }
                CommentType::Single => {
                    j.push_static(b"\n");
                    line_offset.advance(b"\n");
                }
            }
        }

        if is_runtime {
            if c.options.output_format != options::OutputFormat::InternalBakeDev {
                line_offset.advance(compile_result.code());
                j.push(compile_result.code());
            }
        } else {
            j.push(compile_result.code());

            if let Some(source_map_chunk) = compile_result.source_map_chunk() {
                if c.options.source_maps != options::SourceMapOption::None {
                    compile_results_for_source_map.append(CompileResultForSourceMap {
                        source_map_chunk: source_map_chunk.clone(),
                        generated_offset: match line_offset {
                            SourceMap::LineColumnOffsetOptional::Value(v) => v,
                            SourceMap::LineColumnOffsetOptional::Null => Default::default(),
                        },
                        source_index: compile_result.source_index(),
                    })?;
                }

                line_offset.reset();
            } else {
                line_offset.advance(compile_result.code());
            }
        }

        // TODO: metafile
        newline_before_comment = !compile_result.code().is_empty();
    }

    {
        // PORT NOTE: `entry_point_tail` is a local `CompileResult` whose `code`
        // is a `Box<[u8]>`; Zig `j.push(tail_code, worker.allocator)` handed
        // ownership to the joiner. Move it so the deferred-joiner path doesn't
        // read freed memory after this fn returns.
        let tail_code = entry_point_tail.into_code();
        if !tail_code.is_empty() {
            // Stick the entry point tail at the end of the file. Deliberately don't
            // include any source mapping information for this because it's automatically
            // generated and doesn't correspond to a location in the input file.
            j.push_owned(tail_code);
        }
    }

    // Put the cross-chunk suffix inside the IIFE
    {
        // PORT NOTE: see cross_chunk_prefix above — move ownership into joiner.
        let code = print_result_take_code(&mut cross_chunk_suffix);
        if !code.is_empty() {
            if newline_before_comment {
                j.push_static(b"\n");
            }
            j.push_owned(code);
        }
    }

    match output_format {
        options::OutputFormat::Iife => {
            const WITHOUT_NEWLINE: &[u8] = b"})();";

            let with_newline: &[u8] = if newline_before_comment {
                b"})();\n"
            } else {
                WITHOUT_NEWLINE
            };

            j.push_static(with_newline);
        }
        options::OutputFormat::InternalBakeDev => {
            {
                let str = b"}, {\n  main: ";
                j.push_static(str);
                line_offset.advance(str);
            }
            {
                let input =
                    &c.parse_graph().input_files.items_source()[chunk.entry_point.source_index() as usize].path;
                let mut buf = MutableString::init_empty();
                // PERF(port): worker.arena is an arena in Zig
                let _ = js_printer::quote_for_json(input.pretty, &mut buf, true); // fmt::Result into Vec<u8> is infallible
                // bun.handleOom dropped — Rust aborts on OOM
                let str = buf.slice(); // worker.arena is an arena
                j.push_static(str);
                line_offset.advance(str);
            }
            // {
            //     let str = b"\n  react_refresh: ";
            //     j.push_static(str);
            //     line_offset.advance(str);
            // }
            {
                let str = b"\n});";
                j.push_static(str);
                line_offset.advance(str);
            }
        }
        options::OutputFormat::Cjs => {
            if is_bun {
                j.push_static(b"})\n");
                line_offset.advance(b"})\n");
            }
        }
        _ => {}
    }

    j.ensure_newline_at_end();
    // TODO: maybeAppendLegalComments

    if !c.options.footer.is_empty() {
        if newline_before_comment {
            j.push_static(b"\n");
            line_offset.advance(b"\n");
        }
        j.push_static(c.options.footer);
        line_offset.advance(c.options.footer);
        j.push_static(b"\n");
        line_offset.advance(b"\n");
    }

    chunk.intermediate_output = c
        .break_output_into_pieces(worker_arena, &mut j, ctx.chunks.len() as u32)
        .unwrap_or_else(|_| panic!("Unhandled out of memory error in breakOutputIntoPieces()"));

    // TODO: meta contents

    chunk.isolated_hash = c.generate_isolated_hash(chunk);
    chunk.flags.set(crate::chunk::Flags::IS_EXECUTABLE, is_executable);

    if c.options.source_maps != options::SourceMapOption::None {
        let can_have_shifts = matches!(chunk.intermediate_output, crate::chunk::IntermediateOutput::Pieces(_));
        chunk.output_source_map = c.generate_source_map_for_chunk(
            chunk.isolated_hash,
            worker,
            compile_results_for_source_map,
            // SAFETY: resolver backref; raw deref because this arg is passed
            // to `c.generate_source_map_for_chunk(&mut self, …)` (split borrow).
            unsafe { &(*c.resolver).opts.output_dir },
            can_have_shifts,
        )?;
    }

    Ok(())
}

/// Recursively walk a binding and add all declared names to `ModuleInfo`.
/// Handles `b_identifier`, `b_array`, `b_object`, and `b_missing`.
fn add_binding_vars_to_module_info(
    mi: &mut ModuleInfo,
    binding: Binding,
    var_kind: analyze_transpiled_module::VarKind,
    r: &mut js_printer::renamer::Renamer<'_, '_>,
    symbols: &js_ast::symbol::Map,
) {
    match binding.data {
        B::B::BIdentifier(b) => {
            // SAFETY: arena `*mut B::Identifier` is always non-null.
            let b = unsafe { &*b };
            let name = r.name_for_symbol(symbols.follow(b.r#ref));
            if !name.is_empty() {
                let str_id = mi.str(name);
                mi.add_var(str_id, var_kind);
            }
        }
        B::B::BArray(b) => {
            // SAFETY: arena `*mut B::Array` and its `items` slice are always non-null.
            let b = unsafe { &*b };
            for item in unsafe { (*b.items).iter() } {
                add_binding_vars_to_module_info(mi, item.binding, var_kind, r, symbols);
            }
        }
        B::B::BObject(b) => {
            // SAFETY: arena `*mut B::Object` and its `properties` slice are always non-null.
            let b = unsafe { &*b };
            for prop in unsafe { (*b.properties).iter() } {
                add_binding_vars_to_module_info(mi, prop.value, var_kind, r, symbols);
            }
        }
        B::B::BMissing(_) => {}
    }
}

// PORT NOTE: `js_printer::print` ties bump/Options/import_records/renamer to a
// single `'a`, and `Renamer<'r, 'src>` is invariant in `'src` — so the caller's
// renamer lifetime fixes `'a`. All by-ref params that flow into `print` must
// share that lifetime.
pub fn generate_entry_point_tail_js<'a>(
    c: &'a mut LinkerContext,
    to_common_js_ref: Ref,
    to_esm_ref: Ref,
    source_index: IndexInt,
    // bundler is an AST crate: std.mem.Allocator param → &'bump Bump (Arena)
    // TODO(port): thread &'bump Bump from worker.arena end-to-end in Phase B
    arena: &'a Arena,
    temp_arena: &Arena,
    mut r: js_printer::renamer::Renamer<'a, 'a>,
    mut module_info: Option<&'a mut ModuleInfo>,
) -> CompileResult {
    let flags: crate::js_meta::Flags = c.graph.meta.items_flags()[source_index as usize];
    // PERF(port): was arena-backed ArrayList(Stmt) — profile in Phase B
    let mut stmts: Vec<Stmt> = Vec::new();
    // PORT NOTE: `MultiArrayList::get` returns `ManuallyDrop<BundledAst>`; the
    // storage retains ownership of every Drop field, so neither this
    // `BundledAst` nor the `ast_view: Ast` derived from it below may run Drop.
    let ast = c.graph.ast.get(source_index as usize);

    match c.options.output_format {
        options::OutputFormat::Esm => {
            match flags.wrap {
                crate::WrapKind::Cjs => {
                    stmts.push(Stmt::alloc(
                        // "export default require_foo();"
                        S::ExportDefault {
                            default_name: js_ast::LocRef {
                                loc: Logger::Loc::EMPTY,
                                ref_: Some(ast.wrapper_ref),
                            },
                            value: StmtOrExpr::Expr(Expr::init(
                                E::Call {
                                    target: Expr::init_identifier(ast.wrapper_ref, Logger::Loc::EMPTY),
                                    ..Default::default()
                                },
                                Logger::Loc::EMPTY,
                            )),
                        },
                        Logger::Loc::EMPTY,
                    ));
                }
                _ => {
                    if flags.wrap == crate::WrapKind::Esm && ast.wrapper_ref.is_valid() {
                        if flags.is_async_or_has_async_dependency {
                            // "await init_foo();"
                            stmts.push(Stmt::alloc(
                                S::SExpr {
                                    value: Expr::init(
                                        E::Await {
                                            value: Expr::init(
                                                E::Call {
                                                    target: Expr::init_identifier(
                                                        ast.wrapper_ref,
                                                        Logger::Loc::EMPTY,
                                                    ),
                                                    ..Default::default()
                                                },
                                                Logger::Loc::EMPTY,
                                            ),
                                        },
                                        Logger::Loc::EMPTY,
                                    ),
                                    ..Default::default()
                                },
                                Logger::Loc::EMPTY,
                            ));
                        } else {
                            // "init_foo();"
                            stmts.push(Stmt::alloc(
                                S::SExpr {
                                    value: Expr::init(
                                        E::Call {
                                            target: Expr::init_identifier(
                                                ast.wrapper_ref,
                                                Logger::Loc::EMPTY,
                                            ),
                                            ..Default::default()
                                        },
                                        Logger::Loc::EMPTY,
                                    ),
                                    ..Default::default()
                                },
                                Logger::Loc::EMPTY,
                            ));
                        }
                    }

                    let sorted_and_filtered_export_aliases =
                        &c.graph.meta.items_sorted_and_filtered_export_aliases()[source_index as usize];

                    if !sorted_and_filtered_export_aliases.is_empty() {
                        let resolved_exports: &ResolvedExports =
                            &c.graph.meta.items_resolved_exports()[source_index as usize];
                        let imports_to_bind: &RefImportData =
                            &c.graph.meta.items_imports_to_bind()[source_index as usize];

                        // If the output format is ES6 modules and we're an entry point, generate an
                        // ES6 export statement containing all exports. Except don't do that if this
                        // entry point is a CommonJS-style module, since that would generate an ES6
                        // export statement that's not top-level. Instead, we will export the CommonJS
                        // exports as a default export later on.
                        // PERF(port): was arena-backed ArrayList(ClauseItem) — profile in Phase B
                        let mut items: Vec<js_ast::ClauseItem> = Vec::new();
                        let cjs_export_copies =
                            &c.graph.meta.items_cjs_export_copies()[source_index as usize];

                        let mut had_default_export = false;

                        for (i, alias) in sorted_and_filtered_export_aliases.iter().enumerate() {
                            // PORT NOTE: Zig `resolved_exports.get(alias).?` returns a by-value
                            // copy of `ExportData`; only `.data` (an `ImportTracker`, `Copy`) is
                            // read/mutated below, so copy that field instead of the whole struct.
                            let mut resolved_export_data = resolved_exports.get(alias).unwrap().data;

                            had_default_export = had_default_export || **alias == *b"default";

                            // If this is an export of an import, reference the symbol that the import
                            // was eventually resolved to. We need to do this because imports have
                            // already been resolved by this point, so we can't generate a new import
                            // and have that be resolved later.
                            if let Some(import_data) = imports_to_bind.get(&resolved_export_data.import_ref) {
                                resolved_export_data.import_ref = import_data.data.import_ref;
                                resolved_export_data.source_index = import_data.data.source_index;
                            }

                            // Exports of imports need EImportIdentifier in case they need to be re-
                            // written to a property access later on
                            // SAFETY: symbol::Map::get returns a non-null `*mut Symbol` for a valid ref.
                            if unsafe {
                                (*c.graph
                                    .symbols
                                    .get(resolved_export_data.import_ref)
                                    .unwrap())
                                .namespace_alias
                                .is_some()
                            } {
                                let temp_ref = cjs_export_copies[i];

                                // Create both a local variable and an export clause for that variable.
                                // The local variable is initialized with the initial value of the
                                // export. This isn't fully correct because it's a "dead" binding and
                                // doesn't update with the "live" value as it changes. But ES6 modules
                                // don't have any syntax for bare named getter functions so this is the
                                // best we can do.
                                //
                                // These input files:
                                //
                                //   // entry_point.js
                                //   export {foo} from './cjs-format.js'
                                //
                                //   // cjs-format.js
                                //   Object.defineProperty(exports, 'foo', {
                                //     enumerable: true,
                                //     get: () => Math.random(),
                                //   })
                                //
                                // Become this output file:
                                //
                                //   // cjs-format.js
                                //   var require_cjs_format = __commonJS((exports) => {
                                //     Object.defineProperty(exports, "foo", {
                                //       enumerable: true,
                                //       get: () => Math.random()
                                //     });
                                //   });
                                //
                                //   // entry_point.js
                                //   var cjs_format = __toESM(require_cjs_format());
                                //   var export_foo = cjs_format.foo;
                                //   export {
                                //     export_foo as foo
                                //   };
                                //
                                stmts.push(Stmt::alloc(
                                    S::Local {
                                        decls: G::DeclList::from_slice(
                                            &[G::Decl {
                                                binding: Binding::alloc(
                                                    temp_arena,
                                                    B::Identifier { r#ref: temp_ref },
                                                    Logger::Loc::EMPTY,
                                                ),
                                                value: Some(Expr::init(
                                                    E::ImportIdentifier {
                                                        ref_: resolved_export_data.import_ref,
                                                        ..Default::default()
                                                    },
                                                    Logger::Loc::EMPTY,
                                                )),
                                            }],
                                        )
                                        .expect("unreachable"),
                                        ..Default::default()
                                    },
                                    Logger::Loc::EMPTY,
                                ));

                                items.push(js_ast::ClauseItem {
                                    name: js_ast::LocRef {
                                        ref_: Some(temp_ref),
                                        loc: Logger::Loc::EMPTY,
                                    },
                                    alias: &raw const **alias,
                                    alias_loc: Logger::Loc::EMPTY,
                                    ..Default::default()
                                });
                            } else {
                                // Local identifiers can be exported using an export clause. This is done
                                // this way instead of leaving the "export" keyword on the local declaration
                                // itself both because it lets the local identifier be minified and because
                                // it works transparently for re-exports across files.
                                //
                                // These input files:
                                //
                                //   // entry_point.js
                                //   export * from './esm-format.js'
                                //
                                //   // esm-format.js
                                //   export let foo = 123
                                //
                                // Become this output file:
                                //
                                //   // esm-format.js
                                //   let foo = 123;
                                //
                                //   // entry_point.js
                                //   export {
                                //     foo
                                //   };
                                //
                                items.push(js_ast::ClauseItem {
                                    name: js_ast::LocRef {
                                        ref_: Some(resolved_export_data.import_ref),
                                        loc: resolved_export_data.name_loc,
                                    },
                                    alias: &raw const **alias,
                                    alias_loc: resolved_export_data.name_loc,
                                    ..Default::default()
                                });
                            }
                        }

                        // PORT NOTE: arena-owned `*mut [ClauseItem]` — leak the Vec
                        // (worker-arena reset frees it in Phase B; for now leak). The leaked
                        // slice is also iterated below for the synthetic-default-export path.
                        let items: &mut [js_ast::ClauseItem] = Box::leak(items.into_boxed_slice());
                        stmts.push(Stmt::alloc(
                            S::ExportClause {
                                items: std::ptr::from_mut::<[js_ast::ClauseItem]>(items),
                                is_single_line: false,
                            },
                            Logger::Loc::EMPTY,
                        ));

                        if flags.needs_synthetic_default_export && !had_default_export {
                            let mut properties =
                                G::PropertyList::init_capacity(items.len()).expect("OOM");
                            // PERF(port): was initCapacity catch unreachable
                            let getter_fn_body: &mut [Stmt] =
                                arena.alloc_slice_fill_default(items.len());
                            // TODO(port): arena.alloc(Stmt, n) — needs arena slice alloc API
                            let mut remain_getter_fn_body = &mut getter_fn_body[..];
                            for export_item in items.iter() {
                                let (fn_body, rest) = remain_getter_fn_body.split_at_mut(1);
                                remain_getter_fn_body = rest;
                                fn_body[0] = Stmt::alloc(
                                    S::Return {
                                        value: Some(Expr::init(
                                            E::Identifier {
                                                ref_: export_item.name.ref_.expect("infallible: ref bound"),
                                                ..Default::default()
                                            },
                                            export_item.name.loc,
                                        )),
                                    },
                                    Logger::Loc::EMPTY,
                                );
                                // PERF(port): was appendAssumeCapacity
                                VecExt::append(&mut properties, G::Property {
                                    key: Some(Expr::init(
                                        E::String {
                                            // SAFETY: alias is an arena `*const [u8]`; never null.
                                            data: unsafe { &*export_item.alias }.into(),
                                            is_utf16: false,
                                            ..Default::default()
                                        },
                                        export_item.alias_loc,
                                    )),
                                    value: Some(Expr::init(
                                        E::Function {
                                            func: G::Fn {
                                                body: G::FnBody {
                                                    loc: Logger::Loc::EMPTY,
                                                    stmts: std::ptr::from_mut::<[Stmt]>(fn_body),
                                                },
                                                ..Default::default()
                                            },
                                        },
                                        export_item.alias_loc,
                                    )),
                                    kind: G::PropertyKind::Get,
                                    flags: js_ast::Flags::Property::IsMethod.into(),
                                    ..Default::default()
                                }).expect("OOM");
                            }
                            stmts.push(Stmt::alloc(
                                S::ExportDefault {
                                    default_name: js_ast::LocRef {
                                        ref_: Some(Ref::NONE),
                                        loc: Logger::Loc::EMPTY,
                                    },
                                    value: StmtOrExpr::Expr(Expr::init(
                                        E::Object {
                                            properties,
                                            ..Default::default()
                                        },
                                        Logger::Loc::EMPTY,
                                    )),
                                },
                                Logger::Loc::EMPTY,
                            ));
                        }
                    }
                }
            }
        }

        // TODO: iife
        options::OutputFormat::Iife => {}

        options::OutputFormat::InternalBakeDev => {
            // nothing needs to be done here, as the exports are already
            // forwarded in the module closure.
        }

        options::OutputFormat::Cjs => {
            match flags.wrap {
                crate::WrapKind::Cjs => {
                    // "module.exports = require_foo();"
                    stmts.push(Stmt::assign(
                        Expr::init(
                            E::Dot {
                                target: Expr::init_identifier(c.unbound_module_ref, Logger::Loc::EMPTY),
                                name: b"exports".into(),
                                name_loc: Logger::Loc::EMPTY,
                                ..Default::default()
                            },
                            Logger::Loc::EMPTY,
                        ),
                        Expr::init(
                            E::Call {
                                target: Expr::init_identifier(ast.wrapper_ref, Logger::Loc::EMPTY),
                                ..Default::default()
                            },
                            Logger::Loc::EMPTY,
                        ),
                    ));
                }
                crate::WrapKind::Esm => {
                    // "init_foo();"
                    stmts.push(Stmt::alloc(
                        S::SExpr {
                            value: Expr::init(
                                E::Call {
                                    target: Expr::init_identifier(ast.wrapper_ref, Logger::Loc::EMPTY),
                                    ..Default::default()
                                },
                                Logger::Loc::EMPTY,
                            ),
                            ..Default::default()
                        },
                        Logger::Loc::EMPTY,
                    ));
                }
                _ => {}
            }

            // TODO:
            // If we are generating CommonJS for node, encode the known export names in
            // a form that node can understand them. This relies on the specific behavior
            // of this parser, which the node project uses to detect named exports in
            // CommonJS files: https://github.com/guybedford/cjs-module-lexer. Think of
            // this code as an annotation for that parser.
        }
    }

    // Add generated local declarations from entry point tail to module_info.
    // This captures vars like `var export_foo = cjs.foo` for CJS export copies.
    // PORT NOTE: reshaped for borrowck — reborrow via as_deref_mut so module_info
    // remains usable for print_options below.
    if let Some(mi) = module_info.as_mut() {
        let mi: &mut ModuleInfo = &mut **mi;
        for stmt in stmts.iter() {
            match &stmt.data {
                StmtData::SLocal(s) => {
                    let var_kind: analyze_transpiled_module::VarKind = if s.kind == S::Kind::KVar {
                        analyze_transpiled_module::VarKind::Declared
                    } else {
                        analyze_transpiled_module::VarKind::Lexical
                    };
                    for decl in s.decls.slice() {
                        add_binding_vars_to_module_info(mi, decl.binding, var_kind, &mut r, &c.graph.symbols);
                    }
                }
                _ => {}
            }
        }
    }

    if stmts.is_empty() {
        return CompileResult::Javascript {
            source_index,
            result: PrintResult::Result(js_printer::PrintResultSuccess {
                code: Box::default(),
                source_map: None,
            }),
            decls: Box::default(),
        };
    }

    let print_options = js_printer::Options {
        // TODO: IIFE indent
        indent: Default::default(),
        has_run_symbol_renamer: true,

        to_esm_ref,
        to_commonjs_ref: to_common_js_ref,
        require_or_import_meta_for_source_callback:
            js_printer::RequireOrImportMetaCallback::init::<LinkerContext>(c),

        minify_whitespace: c.options.minify_whitespace,
        print_dce_annotations: c.options.emit_dce_annotations,
        minify_syntax: c.options.minify_syntax,
        mangled_props: Some(&c.mangled_props),
        module_info,
        // .const_values = c.graph.const_values,
        ..Default::default()
    };

    let ast_view =
        core::mem::ManuallyDrop::new(core::mem::ManuallyDrop::into_inner(ast).to_ast());
    // SAFETY: `import_records` is a `Vec` pointing into the bundler arena,
    // which outlives `'a` (the chunk-processing scope). Detach the borrow from
    // the local `ast_view` so it can satisfy `print`'s `&'a [ImportRecord]`.
    let import_records: &'a [ImportRecord] =
        unsafe { &*std::ptr::from_ref::<[ImportRecord]>(ast_view.import_records.slice()) };

    CompileResult::Javascript {
        result: js_printer::print::<false>(
            arena,
            c.resolver().opts.target,
            &ast_view,
            c.get_source(source_index),
            print_options,
            import_records,
            &[Part {
                stmts: std::ptr::from_mut::<[Stmt]>(stmts.as_mut_slice()),
                ..Default::default()
            }],
            r,
        ),
        source_index,
        decls: Box::default(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/postProcessJSChunk.zig (1125 lines)
//   confidence: medium
//   todos:      13
//   notes:      MultiArrayList .items(.field) → .items_<field>() accessors; worker.arena pass-throughs need &'bump Bump threading in Phase B; AST node constructor shapes (Stmt::alloc/Expr::init/S::*/E::*) and CompileResult variant layout need Phase-B verification.
// ──────────────────────────────────────────────────────────────────────────
