use bun_alloc::Arena as Bump; // bumpalo::Bump re-export (AST crate: arenas are load-bearing)
use bun_collections::{BabyList, BoundedArray};
use bun_logger as logger;
use bun_str::strings;

use bun_bundler::js_printer::{self, PrintResult};
use bun_bundler::renamer;
use bun_bundler::{
    generic_path_with_pretty_initialized, Chunk, CompileResult, Index, JSAst, JSMeta, LinkerContext,
    Part, PartRange,
};
use bun_bundler::linker_context::StmtList;

use bun_js_parser::ast as js_ast;
use bun_js_parser::ast::{Binding, Expr, Ref, Stmt, B, E, G, S};
use bun_js_parser::lexer as js_lexer;

// TODO(port): MultiArrayList column access — Zig `list.items(.field)` is mapped here as
// `list.items_field()` method calls; Phase B should align with whatever
// `bun_collections::MultiArrayList` actually exposes.

pub fn generate_code_for_file_in_chunk_js<'bump>(
    c: &mut LinkerContext,
    writer: &mut js_printer::BufferWriter,
    r: renamer::Renamer,
    chunk: &mut Chunk,
    part_range: PartRange,
    to_common_js_ref: Ref,
    to_esm_ref: Ref,
    runtime_require_ref: Option<Ref>,
    stmts: &mut StmtList,
    allocator: &'bump Bump,
    temp_allocator: &'bump Bump,
    decl_collector: Option<&mut DeclCollector<'bump>>,
) -> js_printer::PrintResult {
    let parts: &mut [Part] = &mut c.graph.ast.items_parts()[part_range.source_index.get()].as_mut_slice()
        [part_range.part_index_begin as usize..part_range.part_index_end as usize];
    let all_flags: &[JSMeta::Flags] = c.graph.meta.items_flags();
    let flags = all_flags[part_range.source_index.get()];
    let wrapper_part_index = if flags.wrap != Wrap::None {
        c.graph.meta.items_wrapper_part_index()[part_range.source_index.get()]
    } else {
        Index::INVALID
    };

    // referencing everything by array makes the code a lot more annoying :(
    let mut ast: JSAst = c.graph.ast.get(part_range.source_index.get());

    // For HMR, part generation is entirely special cased.
    // - export wrapping is already done.
    // - imports are split from the main code.
    // - one part range per file
    if c.options.output_format == OutputFormat::InternalBakeDev {
        'brk: {
            if part_range.source_index.is_runtime() {
                // PERF(port): was @branchHint(.cold)
                debug_assert!(c.dev_server.is_none());
                break 'brk; // this is from `bun build --format=internal_bake_dev`
            }

            let hmr_api_ref = ast.wrapper_ref;

            for part in parts.iter() {
                if let Err(err) =
                    c.convert_stmts_for_chunk_for_dev_server(stmts, part.stmts, allocator, &mut ast)
                {
                    return PrintResult::Err(err);
                }
            }

            let main_stmts_len =
                stmts.inside_wrapper_prefix.stmts.len() + stmts.inside_wrapper_suffix.len();
            let all_stmts_len = main_stmts_len + stmts.outside_wrapper_prefix.len() + 1;

            stmts.all_stmts.reserve(all_stmts_len);
            // PERF(port): was appendSliceAssumeCapacity
            stmts
                .all_stmts
                .extend_from_slice(stmts.inside_wrapper_prefix.stmts.as_slice());
            stmts
                .all_stmts
                .extend_from_slice(stmts.inside_wrapper_suffix.as_slice());

            // PORT NOTE: reshaped for borrowck — capture pointer/len now, re-slice after pushes.
            let inner_ptr = stmts.all_stmts.as_ptr();
            // SAFETY: `inner` aliases the first `main_stmts_len` elements of `all_stmts`;
            // subsequent pushes only append past this range and capacity was reserved above
            // so no reallocation occurs. Matches Zig which slices then continues appending.
            let inner: &[Stmt] =
                unsafe { core::slice::from_raw_parts(inner_ptr, main_stmts_len) };

            let mut clousure_args: BoundedArray<G::Arg, 3> = BoundedArray::from_slice(&[G::Arg {
                binding: Binding::alloc(
                    temp_allocator,
                    B::Identifier { ref_: hmr_api_ref },
                    logger::Loc::EMPTY,
                ),
                ..Default::default()
            }])
            .expect("unreachable"); // is within bounds

            if ast.flags.uses_module_ref || ast.flags.uses_exports_ref {
                // PERF(port): was appendSliceAssumeCapacity
                clousure_args.extend_from_slice(&[
                    G::Arg {
                        binding: Binding::alloc(
                            temp_allocator,
                            B::Identifier { ref_: ast.module_ref },
                            logger::Loc::EMPTY,
                        ),
                        ..Default::default()
                    },
                    G::Arg {
                        binding: Binding::alloc(
                            temp_allocator,
                            B::Identifier { ref_: ast.exports_ref },
                            logger::Loc::EMPTY,
                        ),
                        ..Default::default()
                    },
                ]);
            }

            // PERF(port): was appendAssumeCapacity
            stmts.all_stmts.push(Stmt::allocate_expr(
                temp_allocator,
                Expr::init(
                    E::Function {
                        func: G::Fn {
                            args: temp_allocator.alloc_slice_copy(clousure_args.as_slice()),
                            body: G::FnBody {
                                stmts: inner,
                                loc: logger::Loc::EMPTY,
                            },
                            ..Default::default()
                        },
                    },
                    logger::Loc::EMPTY,
                ),
            ));
            // PERF(port): was appendSliceAssumeCapacity
            stmts
                .all_stmts
                .extend_from_slice(stmts.outside_wrapper_prefix.as_slice());

            ast.flags.uses_module_ref = true;

            // TODO: there is a weird edge case where the pretty path is not computed
            // it does not reproduce when debugging.
            let mut source = *c.get_source(part_range.source_index.get());
            if core::ptr::eq(source.path.text.as_ptr(), source.path.pretty.as_ptr()) {
                source.path = generic_path_with_pretty_initialized(
                    source.path,
                    c.options.target,
                    c.resolver.fs.top_level_dir,
                    allocator,
                )
                .unwrap_or_oom();
            }

            return c.print_code_for_file_in_chunk_js(
                r,
                allocator,
                writer,
                &stmts.all_stmts[main_stmts_len..],
                &ast,
                flags,
                Ref::NONE,
                Ref::NONE,
                None,
                part_range.source_index,
                &source,
            );
        }
    }

    let mut needs_wrapper = false;

    let namespace_export_part_index = js_ast::NAMESPACE_EXPORT_PART_INDEX;

    stmts.reset();

    let part_index_for_lazy_default_export: u32 = 'brk: {
        if ast.flags.has_lazy_export {
            if let Some(default) = c.graph.meta.items_resolved_exports()
                [part_range.source_index.get()]
            .get(b"default")
            {
                break 'brk c
                    .graph
                    .top_level_symbol_to_parts(part_range.source_index.get(), default.data.import_ref)
                    [0];
            }
        }
        break 'brk u32::MAX;
    };

    let output_format = c.options.output_format;

    // The top-level directive must come first (the non-wrapped case is handled
    // by the chunk generation code, although only for the entry point)
    if flags.wrap != Wrap::None
        && ast.flags.has_explicit_use_strict_directive
        && !chunk.is_entry_point()
        && !output_format.is_always_strict_mode()
    {
        stmts
            .inside_wrapper_prefix
            .append_non_dependency(Stmt::alloc(
                S::Directive {
                    value: b"use strict",
                },
                logger::Loc::EMPTY,
            ))
            .expect("unreachable");
    }

    // TODO: handle directive
    if namespace_export_part_index >= part_range.part_index_begin
        && namespace_export_part_index < part_range.part_index_end
        && parts[namespace_export_part_index as usize].is_live
    {
        if let Err(err) = c.convert_stmts_for_chunk(
            part_range.source_index.get(),
            stmts,
            parts[namespace_export_part_index as usize].stmts,
            chunk,
            temp_allocator,
            flags.wrap,
            &mut ast,
        ) {
            // TODO(port): bun.handleErrorReturnTrace — no Rust equivalent
            return PrintResult::Err(err);
        }

        match flags.wrap {
            Wrap::Esm => {
                stmts
                    .append_slice(StmtListKind::OutsideWrapperPrefix, stmts.inside_wrapper_suffix.as_slice())
                    .expect("unreachable");
            }
            _ => {
                stmts
                    .inside_wrapper_prefix
                    .append_non_dependency_slice(stmts.inside_wrapper_suffix.as_slice())
                    .expect("unreachable");
            }
        }

        stmts.inside_wrapper_suffix.clear();
    }

    // Add all other parts in this chunk
    for (index_, part) in parts.iter().enumerate() {
        let index = part_range.part_index_begin + (index_ as u32);
        if !part.is_live {
            // Skip the part if it's not in this chunk
            continue;
        }

        if index == namespace_export_part_index {
            // Skip the namespace export part because we already handled it above
            continue;
        }

        if index == wrapper_part_index.get() {
            // Skip the wrapper part because we already handled it above
            needs_wrapper = true;
            continue;
        }

        // TODO(port): Zig used `[1]Stmt{undefined}` — using a default-init placeholder here.
        let mut single_stmts_list: [Stmt; 1] = [Stmt::empty()];
        let mut part_stmts = part.stmts;

        // If this could be a JSON or TOML file that exports a top-level object literal, go
        // over the non-default top-level properties that ended up being imported
        // and substitute references to them into the main top-level object literal.
        // So this JSON file:
        //
        //   {
        //     "foo": [1, 2, 3],
        //     "bar": [4, 5, 6],
        //   }
        //
        // is initially compiled into this:
        //
        //   export var foo = [1, 2, 3];
        //   export var bar = [4, 5, 6];
        //   export default {
        //     foo: [1, 2, 3],
        //     bar: [4, 5, 6],
        //   };
        //
        // But we turn it into this if both "foo" and "default" are imported:
        //
        //   export var foo = [1, 2, 3];
        //   export default {
        //     foo,
        //     bar: [4, 5, 6],
        //   };
        //
        if index == part_index_for_lazy_default_export {
            debug_assert!(index != u32::MAX);

            let stmt = part_stmts[0];

            let StmtData::SExportDefault(default_export) = stmt.data else {
                panic!("expected Lazy default export to be an export default statement");
            };

            let mut default_expr = default_export.value.expr;

            // Be careful: the top-level value in a JSON file is not necessarily an object
            if let ExprData::EObject(e_object) = default_expr.data {
                let mut new_properties =
                    e_object.properties.clone_in(temp_allocator).expect("unreachable");

                let resolved_exports =
                    &c.graph.meta.items_resolved_exports()[part_range.source_index.get()];

                // If any top-level properties ended up being imported directly, change
                // the property to just reference the corresponding variable instead
                for prop in new_properties.as_mut_slice() {
                    if prop.key.is_none()
                        || !matches!(prop.key.as_ref().unwrap().data, ExprData::EString(_))
                        || prop.value.is_none()
                    {
                        continue;
                    }
                    let name = match &prop.key.as_ref().unwrap().data {
                        ExprData::EString(s) => s.slice(temp_allocator),
                        _ => unreachable!(),
                    };
                    if name == b"default"
                        || name == b"__esModule"
                        || !js_lexer::is_identifier(name)
                    {
                        continue;
                    }

                    if let Some(export_data) = resolved_exports.get(name) {
                        let export_ref = export_data.data.import_ref;
                        let export_part = &ast.parts.as_slice()[c
                            .graph
                            .top_level_symbol_to_parts(part_range.source_index.get(), export_ref)
                            [0]
                            as usize];
                        if export_part.is_live {
                            *prop = G::Property {
                                key: prop.key,
                                value: Some(Expr::init_identifier(
                                    export_ref,
                                    prop.value.as_ref().unwrap().loc,
                                )),
                                ..Default::default()
                            };
                        }
                    }
                }

                default_expr = Expr::allocate(
                    temp_allocator,
                    E::Object {
                        properties: new_properties,
                        ..Default::default()
                    },
                    default_expr.loc,
                );
            }

            single_stmts_list[0] = Stmt::allocate(
                temp_allocator,
                S::ExportDefault {
                    default_name: default_export.default_name,
                    value: js_ast::ExportDefaultValue::Expr(default_expr),
                },
                stmt.loc,
            );
            part_stmts = &single_stmts_list[..];
        }

        if let Err(err) = c.convert_stmts_for_chunk(
            part_range.source_index.get(),
            stmts,
            part_stmts,
            chunk,
            temp_allocator,
            flags.wrap,
            &mut ast,
        ) {
            return PrintResult::Err(err);
        }
    }

    // Hoist all import statements before any normal statements. ES6 imports
    // are different than CommonJS imports. All modules imported via ES6 import
    // statements are evaluated before the module doing the importing is
    // evaluated (well, except for cyclic import scenarios). We need to preserve
    // these semantics even when modules imported via ES6 import statements end
    // up being CommonJS modules.
    stmts.all_stmts.reserve(
        stmts.inside_wrapper_prefix.stmts.len() + stmts.inside_wrapper_suffix.len(),
    );
    // PERF(port): was appendSliceAssumeCapacity
    stmts
        .all_stmts
        .extend_from_slice(stmts.inside_wrapper_prefix.stmts.as_slice());
    stmts
        .all_stmts
        .extend_from_slice(stmts.inside_wrapper_suffix.as_slice());
    stmts.inside_wrapper_prefix.reset();
    stmts.inside_wrapper_suffix.clear();

    if c.options.minify_syntax {
        merge_adjacent_local_stmts(&mut stmts.all_stmts, temp_allocator);
    }

    let mut out_stmts: &mut [js_ast::Stmt] = stmts.all_stmts.as_mut_slice();

    // Optionally wrap all statements in a closure
    if needs_wrapper {
        match flags.wrap {
            Wrap::Cjs => {
                // Only include the arguments that are actually used
                let mut args: bumpalo::collections::Vec<'_, G::Arg> =
                    bumpalo::collections::Vec::with_capacity_in(
                        if ast.flags.uses_module_ref || ast.flags.uses_exports_ref {
                            2
                        } else {
                            0
                        },
                        temp_allocator,
                    );

                if ast.flags.uses_module_ref || ast.flags.uses_exports_ref {
                    // PERF(port): was appendAssumeCapacity
                    args.push(G::Arg {
                        binding: Binding::alloc(
                            temp_allocator,
                            B::Identifier { ref_: ast.exports_ref },
                            logger::Loc::EMPTY,
                        ),
                        ..Default::default()
                    });

                    if ast.flags.uses_module_ref {
                        // PERF(port): was appendAssumeCapacity
                        args.push(G::Arg {
                            binding: Binding::alloc(
                                temp_allocator,
                                B::Identifier { ref_: ast.module_ref },
                                logger::Loc::EMPTY,
                            ),
                            ..Default::default()
                        });
                    }
                }

                // TODO: variants of the runtime functions
                let cjs_args = temp_allocator.alloc_slice_copy(&[Expr::init(
                    E::Arrow {
                        args: args.into_bump_slice(),
                        body: G::FnBody {
                            stmts: stmts.all_stmts.as_slice(),
                            loc: logger::Loc::EMPTY,
                        },
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                )]);

                let commonjs_wrapper_definition = Expr::init(
                    E::Call {
                        target: Expr::init(
                            E::Identifier {
                                ref_: c.cjs_runtime_ref,
                                ..Default::default()
                            },
                            logger::Loc::EMPTY,
                        ),
                        args: BabyList::<Expr>::from_owned_slice(cjs_args),
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                );

                // "var require_foo = __commonJS(...);"
                {
                    let decls = temp_allocator.alloc_slice_copy(&[G::Decl {
                        binding: Binding::alloc(
                            temp_allocator,
                            B::Identifier { ref_: ast.wrapper_ref },
                            logger::Loc::EMPTY,
                        ),
                        value: Some(commonjs_wrapper_definition),
                    }]);

                    stmts
                        .append(
                            StmtListKind::OutsideWrapperPrefix,
                            Stmt::alloc(
                                S::Local {
                                    decls: G::DeclList::from_owned_slice(decls),
                                    ..Default::default()
                                },
                                logger::Loc::EMPTY,
                            ),
                        )
                        .expect("unreachable");
                }
            }
            Wrap::Esm => {
                // The wrapper only needs to be "async" if there is a transitive async
                // dependency. For correctness, we must not use "async" if the module
                // isn't async because then calling "require()" on that module would
                // swallow any exceptions thrown during module initialization.
                let is_async = flags.is_async_or_has_async_dependency;

                struct ExportHoist<'bump> {
                    decls: bumpalo::collections::Vec<'bump, G::Decl>,
                    allocator: &'bump Bump,
                }

                impl<'bump> ExportHoist<'bump> {
                    pub fn wrap_identifier(&mut self, loc: logger::Loc, ref_: Ref) -> Expr {
                        self.decls.push(G::Decl {
                            binding: Binding::alloc(
                                self.allocator,
                                B::Identifier { ref_ },
                                loc,
                            ),
                            value: None,
                        });

                        Expr::init_identifier(ref_, loc)
                    }
                }

                let mut hoist = ExportHoist {
                    decls: bumpalo::collections::Vec::new_in(temp_allocator),
                    allocator: temp_allocator,
                };

                let mut inner_stmts = stmts.all_stmts.as_mut_slice();

                // Hoist all top-level "var" and "function" declarations out of the closure
                {
                    let mut end: usize = 0;
                    // PORT NOTE: reshaped for borrowck — iterate by index since we mutate
                    // `inner_stmts[end]` and call `stmts.append(...)` inside the loop.
                    for i in 0..stmts.all_stmts.len() {
                        let stmt = stmts.all_stmts[i];
                        let transformed = match stmt.data {
                            StmtData::SLocal(local) => 'stmt: {
                                // "using" / "await using" declarations have disposal
                                // side-effects tied to the scope they appear in, so
                                // they must stay inside the closure rather than being
                                // hoisted to `var` + assignment.
                                if local.kind.is_using() {
                                    break 'stmt stmt;
                                }

                                // Convert the declarations to assignments
                                let mut value = Expr::EMPTY;
                                for decl in local.decls.as_slice() {
                                    if let Some(initializer) = decl.value {
                                        let can_be_moved = initializer.can_be_moved();
                                        if can_be_moved {
                                            // if the value can be moved, move the decl directly to preserve destructuring
                                            // ie `const { main } = class { static main() {} }` => `var {main} = class { static main() {} }`
                                            hoist.decls.push(*decl);
                                        } else {
                                            // if the value cannot be moved, add every destructuring key separately
                                            // ie `var { append } = { append() {} }` => `var append; __esm(() => ({ append } = { append() {} }))`
                                            let binding = decl.binding.to_expr(&mut hoist);
                                            value = value.join_with_comma(
                                                binding.assign(initializer),
                                                temp_allocator,
                                            );
                                        }
                                    } else {
                                        let _ = decl.binding.to_expr(&mut hoist);
                                    }
                                }

                                if value.is_empty() {
                                    continue;
                                }

                                break 'stmt Stmt::allocate_expr(temp_allocator, value);
                            }
                            StmtData::SFunction(_) => {
                                stmts
                                    .append(StmtListKind::OutsideWrapperPrefix, stmt)
                                    .unwrap_or_oom();
                                continue;
                            }
                            StmtData::SClass(class) => 'stmt: {
                                // TODO(port): `class` must borrow the arena-allocated S.Class (Zig's
                                // Stmt.Data.s_class is `*S.Class`), so `&mut class.class` below points
                                // into arena memory — not a stack-local copy. Ensure this match arm
                                // binds by reference (e.g. `StmtData::SClass(class /* &'bump mut S::Class */)`)
                                // or the EClass payload will dangle once this arm exits.
                                if class.class.can_be_moved() {
                                    stmts
                                        .append(StmtListKind::OutsideWrapperPrefix, stmt)
                                        .unwrap_or_oom();
                                    continue;
                                }

                                break 'stmt Stmt::allocate_expr(
                                    temp_allocator,
                                    Expr::assign(
                                        hoist.wrap_identifier(
                                            class.class.class_name.unwrap().loc,
                                            class.class.class_name.unwrap().ref_.unwrap(),
                                        ),
                                        Expr {
                                            data: ExprData::EClass(&mut class.class),
                                            loc: stmt.loc,
                                        },
                                    ),
                                );
                            }
                            _ => stmt,
                        };

                        inner_stmts[end] = transformed;
                        end += 1;
                    }
                    inner_stmts = &mut inner_stmts[..end];
                }

                if !hoist.decls.is_empty() {
                    stmts
                        .append(
                            StmtListKind::OutsideWrapperPrefix,
                            Stmt::alloc(
                                S::Local {
                                    decls: G::DeclList::move_from_list(&mut hoist.decls),
                                    ..Default::default()
                                },
                                logger::Loc::EMPTY,
                            ),
                        )
                        .expect("unreachable");
                    hoist.decls.clear();
                }

                if !inner_stmts.is_empty() {
                    // See the comment in needsWrapperRef for why the symbol
                    // is sometimes not generated.
                    debug_assert!(!ast.wrapper_ref.is_empty()); // js_parser's needsWrapperRef thought wrapper was not needed

                    // "__esm(() => { ... })"
                    let esm_args = temp_allocator.alloc_slice_copy(&[Expr::init(
                        E::Arrow {
                            args: &[],
                            is_async,
                            body: G::FnBody {
                                stmts: inner_stmts,
                                loc: logger::Loc::EMPTY,
                            },
                            ..Default::default()
                        },
                        logger::Loc::EMPTY,
                    )]);

                    // "var init_foo = __esm(...);"
                    let value = Expr::init(
                        E::Call {
                            target: Expr::init_identifier(c.esm_runtime_ref, logger::Loc::EMPTY),
                            args: BabyList::<Expr>::from_owned_slice(esm_args),
                            ..Default::default()
                        },
                        logger::Loc::EMPTY,
                    );

                    let decls = temp_allocator.alloc_slice_copy(&[G::Decl {
                        binding: Binding::alloc(
                            temp_allocator,
                            B::Identifier { ref_: ast.wrapper_ref },
                            logger::Loc::EMPTY,
                        ),
                        value: Some(value),
                    }]);

                    stmts
                        .append(
                            StmtListKind::OutsideWrapperPrefix,
                            Stmt::alloc(
                                S::Local {
                                    decls: G::DeclList::from_owned_slice(decls),
                                    ..Default::default()
                                },
                                logger::Loc::EMPTY,
                            ),
                        )
                        .unwrap_or_oom();
                } else {
                    // // If this fails, then there will be places we reference
                    // // `init_foo` without it actually existing.
                    // debug_assert!(ast.wrapper_ref.is_empty());

                    // TODO: the edge case where we are wrong is when there
                    // are references to other ESM modules, but those get
                    // fully hoisted. The look like side effects, but they
                    // are removed.
                    //
                    // It is too late to retroactively delete the
                    // wrapper_ref, since printing has already begun.  The
                    // most we can do to salvage the situation is to print
                    // an empty arrow function.
                    //
                    // This is marked as a TODO, because this can be solved
                    // via a count of external modules, decremented during
                    // linking.
                    if !ast.wrapper_ref.is_empty() {
                        let value = Expr::init(
                            E::Arrow {
                                args: &[],
                                is_async,
                                body: G::FnBody {
                                    stmts: inner_stmts,
                                    loc: logger::Loc::EMPTY,
                                },
                                ..Default::default()
                            },
                            logger::Loc::EMPTY,
                        );

                        stmts
                            .append(
                                StmtListKind::OutsideWrapperPrefix,
                                Stmt::alloc(
                                    S::Local {
                                        decls: G::DeclList::from_slice(
                                            temp_allocator,
                                            &[G::Decl {
                                                binding: Binding::alloc(
                                                    temp_allocator,
                                                    B::Identifier { ref_: ast.wrapper_ref },
                                                    logger::Loc::EMPTY,
                                                ),
                                                value: Some(value),
                                            }],
                                        )
                                        .unwrap_or_oom(),
                                        ..Default::default()
                                    },
                                    logger::Loc::EMPTY,
                                ),
                            )
                            .unwrap_or_oom();
                    }
                }
            }
            _ => {}
        }

        out_stmts = stmts.outside_wrapper_prefix.as_mut_slice();
    }

    if out_stmts.is_empty() {
        return PrintResult::Result {
            code: b"",
            source_map: None,
        };
    }

    // Collect top-level declarations from the converted statements.
    // This is done here (after convertStmtsForChunk) rather than in
    // postProcessJSChunk, because convertStmtsForChunk transforms the AST
    // (e.g. export default expr → var, export stripping) and the converted
    // statements reflect what actually gets printed.
    if let Some(dc) = decl_collector {
        dc.collect_from_stmts(out_stmts, r, c);
    }

    c.print_code_for_file_in_chunk_js(
        r,
        allocator,
        writer,
        out_stmts,
        &ast,
        flags,
        to_esm_ref,
        to_common_js_ref,
        runtime_require_ref,
        part_range.source_index,
        c.get_source(part_range.source_index.get()),
    )
}

pub struct DeclCollector<'bump> {
    pub decls: bumpalo::collections::Vec<'bump, CompileResult::DeclInfo>,
    pub allocator: &'bump Bump,
}

impl<'bump> DeclCollector<'bump> {
    /// Collect top-level declarations from **converted** statements (after
    /// `convertStmtsForChunk`). At that point, export statements have already
    /// been transformed:
    /// - `s_export_default` → `s_local` / `s_function` / `s_class`
    /// - `s_export_clause` → removed entirely
    /// - `s_export_from` / `s_export_star` → removed or converted to `s_import`
    ///
    /// Remaining `s_import` statements (external, non-bundled) don't need
    /// handling here; their bindings are recorded separately in
    /// `postProcessJSChunk` by scanning the original AST import records.
    pub fn collect_from_stmts(
        &mut self,
        stmts: &[Stmt],
        r: renamer::Renamer,
        c: &LinkerContext,
    ) {
        for stmt in stmts {
            match stmt.data {
                StmtData::SLocal(s) => {
                    let kind: CompileResult::DeclInfoKind = if s.kind == LocalKind::KVar {
                        CompileResult::DeclInfoKind::Declared
                    } else {
                        CompileResult::DeclInfoKind::Lexical
                    };
                    for decl in s.decls.as_slice() {
                        self.collect_from_binding(decl.binding, kind, r, c);
                    }
                }
                StmtData::SFunction(s) => {
                    if let Some(name_loc_ref) = s.func.name {
                        if let Some(name_ref) = name_loc_ref.ref_ {
                            self.add_ref(name_ref, CompileResult::DeclInfoKind::Lexical, r, c);
                        }
                    }
                }
                StmtData::SClass(s) => {
                    if let Some(class_name) = s.class.class_name {
                        if let Some(name_ref) = class_name.ref_ {
                            self.add_ref(name_ref, CompileResult::DeclInfoKind::Lexical, r, c);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn collect_from_binding(
        &mut self,
        binding: Binding,
        kind: CompileResult::DeclInfoKind,
        r: renamer::Renamer,
        c: &LinkerContext,
    ) {
        match binding.data {
            BindingData::BIdentifier(b) => {
                self.add_ref(b.ref_, kind, r, c);
            }
            BindingData::BArray(b) => {
                for item in b.items {
                    self.collect_from_binding(item.binding, kind, r, c);
                }
            }
            BindingData::BObject(b) => {
                for prop in b.properties {
                    self.collect_from_binding(prop.value, kind, r, c);
                }
            }
            BindingData::BMissing => {}
        }
    }

    fn add_ref(
        &mut self,
        ref_: Ref,
        kind: CompileResult::DeclInfoKind,
        r: renamer::Renamer,
        c: &LinkerContext,
    ) {
        let followed = c.graph.symbols.follow(ref_);
        let name = r.name_for_symbol(followed);
        if name.is_empty() {
            return;
        }
        // Zig: `catch return` — silently drop on alloc failure. With bumpalo Vec
        // push is infallible (aborts on OOM), so there is nothing to catch.
        self.decls.push(CompileResult::DeclInfo { name, kind });
    }
}

fn merge_adjacent_local_stmts<'bump>(
    stmts: &mut bumpalo::collections::Vec<'bump, Stmt>,
    allocator: &'bump Bump,
) {
    if stmts.is_empty() {
        return;
    }

    let mut did_merge_with_previous_local = false;
    let mut end: usize = 1;

    // PORT NOTE: reshaped for borrowck — iterate by index because we read `stmts[i]`
    // and write `stmts[end - 1]` / `stmts[end]` in the same loop body.
    for i in 1..stmts.len() {
        let stmt = stmts[i];
        // Try to merge with the previous variable statement
        if let StmtData::SLocal(after) = stmt.data {
            if let StmtData::SLocal(before) = stmts[end - 1].data {
                // It must be the same kind of variable statement (i.e. let/var/const)
                if before.can_merge_with(after) {
                    if did_merge_with_previous_local {
                        // Avoid O(n^2) behavior for repeated variable declarations
                        // Appending to this decls list is safe because did_merge_with_previous_local is true
                        before
                            .decls
                            .append_slice(allocator, after.decls.as_slice())
                            .expect("unreachable");
                    } else {
                        // Append the declarations to the previous variable statement
                        did_merge_with_previous_local = true;

                        let mut clone = BabyList::<G::Decl>::init_capacity(
                            allocator,
                            (before.decls.len + after.decls.len) as usize,
                        )
                        .expect("unreachable");
                        // PERF(port): was appendSliceAssumeCapacity
                        clone.append_slice_assume_capacity(before.decls.as_slice());
                        clone.append_slice_assume_capacity(after.decls.as_slice());
                        // we must clone instead of overwrite in-place incase the same S.Local is used across threads
                        // https://github.com/oven-sh/bun/issues/2942
                        let prev_loc = stmts[end - 1].loc;
                        stmts[end - 1] = Stmt::allocate(
                            allocator,
                            S::Local {
                                decls: clone,
                                is_export: before.is_export,
                                was_commonjs_export: before.was_commonjs_export,
                                was_ts_import_equals: before.was_ts_import_equals,
                                kind: before.kind,
                                ..Default::default()
                            },
                            prev_loc,
                        );
                    }
                    continue;
                }
            }
        }

        did_merge_with_previous_local = false;
        stmts[end] = stmt;
        end += 1;
    }
    stmts.truncate(end);
}

// TODO(port): these type aliases reference enums/variants from sibling modules whose
// exact Rust paths are decided in Phase B. They exist so the match arms above read
// the same as the Zig.
use bun_bundler::linker_context::StmtListKind;
use bun_bundler::options::OutputFormat;
use bun_js_parser::ast::stmt::Data as StmtData;
use bun_js_parser::ast::expr::Data as ExprData;
use bun_js_parser::ast::binding::Data as BindingData;
use bun_js_parser::ast::s::LocalKind;
use bun_bundler::JSMeta::Wrap;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/generateCodeForFileInChunkJS.zig (802 lines)
//   confidence: medium
//   todos:      5
//   notes:      AST-crate arena threading assumed; MultiArrayList column accessors + Stmt/Expr/Binding Data enum paths are placeholders; ESM hoist loop reshaped for borrowck (overlapping &mut on stmts.all_stmts vs stmts.append); ESM hoist .s_class arm must bind arena pointer by-ref so EClass(&mut class.class) doesn't dangle.
// ──────────────────────────────────────────────────────────────────────────
