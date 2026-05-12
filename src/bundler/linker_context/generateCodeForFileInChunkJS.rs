use crate::bundled_ast::Flags as AstFlags;
use crate::mal_prelude::*;
use bun_alloc::Arena as Bump; // bumpalo::Bump re-export (AST crate: arenas are load-bearing)
use bun_alloc::ArenaVecExt as _;
use bun_collections::{BoundedArray, VecExt};

use bun_js_printer::renamer;
use bun_js_printer::{self as js_printer, PrintResult, PrintResultSuccess};

use crate::linker_context_mod::{StmtList, StmtListWhich};
use crate::options::Format as OutputFormat;
use crate::ungate_support::generic_path_with_pretty_initialized;
use crate::{
    Chunk, DeclInfo, DeclInfoKind, Index, JSAst, JSMeta, LinkerContext, Part, PartRange, WrapKind,
};

use bun_ast as js_ast;
use bun_ast::StoreRef;
use bun_ast::binding::ToExprWrapper;
use bun_ast::{B, Binding, E, Expr, G, Ref, S, Stmt};
use bun_js_parser::lexer as js_lexer;

use super::convert_stmts_for_chunk::convert_stmts_for_chunk;
use super::convert_stmts_for_chunk_for_dev_server::convert_stmts_for_chunk_for_dev_server;

// PORT NOTE: MultiArrayList column access — Zig `list.items(.field)` is mapped here as
// `list.items_field()` method calls (codegen'd accessors on the SoA wrappers).

#[allow(clippy::too_many_arguments)]
pub fn generate_code_for_file_in_chunk_js<'r, 'src>(
    c: &mut LinkerContext,
    writer: &mut js_printer::BufferWriter,
    r: renamer::Renamer<'r, 'src>,
    chunk: &mut Chunk,
    part_range: PartRange,
    to_common_js_ref: Ref,
    to_esm_ref: Ref,
    runtime_require_ref: Option<Ref>,
    stmts: &mut StmtList,
    arena: &Bump,
    temp_arena: &Bump,
    decl_collector: Option<&mut DeclCollector>,
) -> js_printer::PrintResult {
    let source_index = part_range.source_index.get() as usize;

    // PORT NOTE: reshaped for borrowck — grab raw pointers to the SoA columns up front so
    // subsequent `&mut c` borrows (convert_stmts_for_chunk, print_code_for_file_in_chunk_js)
    // don't conflict. Matches Zig which slices once at the top.
    // SAFETY: the underlying MultiArrayList storage is not resized for the duration of this
    // function (linking has already sized everything).
    let parts: *mut [Part] = unsafe {
        let list = &mut c.graph.ast.items_parts_mut()[source_index];
        core::ptr::addr_of_mut!(
            list.slice_mut()
                [part_range.part_index_begin as usize..part_range.part_index_end as usize]
        )
    };
    let flags: crate::js_meta::Flags = c.graph.meta.items_flags()[source_index];
    let wrapper_part_index = if flags.wrap != WrapKind::None {
        c.graph.meta.items_wrapper_part_index()[source_index]
    } else {
        Index::INVALID
    };

    // referencing everything by array makes the code a lot more annoying :(
    //
    // PORT NOTE: `MultiArrayList::get` returns `ManuallyDrop<BundledAst>` — the
    // storage retains ownership of every Drop field (`parts`, `symbols`,
    // `named_imports`, …). The local `flags` mutation below is intentional and
    // stays scoped to this read view.
    let mut ast = c.graph.ast.get(source_index);

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

            // SAFETY: see `parts` raw-pointer note above.
            for part in unsafe { (*parts).iter() } {
                let part_stmts: &[Stmt] = part.stmts.slice();
                if let Err(err) =
                    convert_stmts_for_chunk_for_dev_server(c, stmts, part_stmts, arena, &mut ast)
                {
                    return PrintResult::Err(err.into());
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
            // SAFETY: `inner` aliases the first `main_stmts_len` elements of `all_stmts`;
            // subsequent pushes only append past this range and capacity was reserved above
            // so no reallocation occurs. Matches Zig which slices then continues appending.
            let inner = bun_ast::StoreSlice::new_mut(
                &mut stmts.all_stmts.as_mut_slice()[0..main_stmts_len],
            );

            let mut clousure_args: BoundedArray<G::Arg, 3> = BoundedArray::default();
            clousure_args.append_assume_capacity(G::Arg {
                binding: Binding::alloc(
                    temp_arena,
                    B::Identifier { r#ref: hmr_api_ref },
                    bun_ast::Loc::EMPTY,
                ),
                ..Default::default()
            });

            if ast
                .flags
                .intersects(AstFlags::USES_MODULE_REF | AstFlags::USES_EXPORTS_REF)
            {
                clousure_args.append_assume_capacity(G::Arg {
                    binding: Binding::alloc(
                        temp_arena,
                        B::Identifier {
                            r#ref: ast.module_ref,
                        },
                        bun_ast::Loc::EMPTY,
                    ),
                    ..Default::default()
                });
                clousure_args.append_assume_capacity(G::Arg {
                    binding: Binding::alloc(
                        temp_arena,
                        B::Identifier {
                            r#ref: ast.exports_ref,
                        },
                        bun_ast::Loc::EMPTY,
                    ),
                    ..Default::default()
                });
            }

            // PERF(port): was temp_arena.dupe — `G::Arg` is not Copy in Rust
            let dup_args: &mut [G::Arg] = {
                let mut v = bun_alloc::ArenaVec::with_capacity_in(
                    clousure_args.const_slice().len(),
                    temp_arena,
                );
                for a in clousure_args.slice().iter_mut() {
                    v.push(core::mem::take(a));
                }
                v.into_bump_slice_mut()
            };

            // PERF(port): was appendAssumeCapacity
            stmts.all_stmts.push(Stmt::allocate_expr(
                temp_arena,
                Expr::init(
                    E::Function {
                        func: G::Fn {
                            args: bun_ast::StoreSlice::new_mut(dup_args),
                            body: G::FnBody {
                                stmts: inner,
                                loc: bun_ast::Loc::EMPTY,
                            },
                            ..Default::default()
                        },
                    },
                    bun_ast::Loc::EMPTY,
                ),
            ));
            // PERF(port): was appendSliceAssumeCapacity
            stmts
                .all_stmts
                .extend_from_slice(stmts.outside_wrapper_prefix.as_slice());

            ast.flags.insert(AstFlags::USES_MODULE_REF);

            // TODO: there is a weird edge case where the pretty path is not computed
            // it does not reproduce when debugging.
            let source_ref = c.get_source(source_index as u32);
            // PORT NOTE: reshaped for borrowck — Zig copies the `Source` by value,
            // mutates `.path`, and passes `&source`. `bun_ast::Source` is not `Clone`
            // (its `Cow` fields would deep-copy `Owned` data); instead, build a
            // borrowed-field shadow only when the path needs fixing.
            let mut source_storage: bun_ast::Source;
            let source: &bun_ast::Source = if core::ptr::eq(
                source_ref.path.text.as_ptr(),
                source_ref.path.pretty.as_ptr(),
            ) {
                let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
                let new_path = bun_core::handle_oom(generic_path_with_pretty_initialized(
                    source_ref.path.clone(),
                    c.options.target,
                    top_level_dir,
                    arena,
                ));
                source_storage = bun_ast::Source {
                    path: new_path,
                    // SAFETY: `source_ref` is `&'static Source`, so re-borrowing its
                    // `Cow` payloads as `&'static [u8]` is sound regardless of arm.
                    contents: std::borrow::Cow::Borrowed(unsafe {
                        &*std::ptr::from_ref::<[u8]>(source_ref.contents.as_ref())
                    }),
                    contents_is_recycled: source_ref.contents_is_recycled,
                    identifier_name: std::borrow::Cow::Borrowed(unsafe {
                        &*std::ptr::from_ref::<[u8]>(source_ref.identifier_name.as_ref())
                    }),
                    index: source_ref.index,
                };
                &source_storage
            } else {
                source_ref
            };

            return c.print_code_for_file_in_chunk_js(
                r,
                arena,
                writer,
                &mut stmts.all_stmts[main_stmts_len..],
                &ast,
                flags,
                Ref::NONE,
                Ref::NONE,
                None,
                part_range.source_index,
                source,
            );
        }
    }

    let mut needs_wrapper = false;

    let namespace_export_part_index = bun_ast::NAMESPACE_EXPORT_PART_INDEX;

    stmts.reset();

    let part_index_for_lazy_default_export: u32 = 'brk: {
        if ast.flags.contains(AstFlags::HAS_LAZY_EXPORT) {
            if let Some(default) =
                c.graph.meta.items_resolved_exports()[source_index].get(b"default")
            {
                break 'brk c
                    .graph
                    .top_level_symbol_to_parts(source_index as u32, default.data.import_ref)[0];
            }
        }
        u32::MAX
    };

    let output_format = c.options.output_format;

    // The top-level directive must come first (the non-wrapped case is handled
    // by the chunk generation code, although only for the entry point)
    if flags.wrap != WrapKind::None
        && ast
            .flags
            .contains(AstFlags::HAS_EXPLICIT_USE_STRICT_DIRECTIVE)
        && !chunk.is_entry_point()
        && !output_format.is_always_strict_mode()
    {
        stmts
            .inside_wrapper_prefix
            .append_non_dependency(Stmt::alloc(
                S::Directive {
                    value: bun_ast::StoreStr::new(b"use strict"),
                },
                bun_ast::Loc::EMPTY,
            ))
            .expect("unreachable");
    }

    // TODO: handle directive
    if namespace_export_part_index >= part_range.part_index_begin
        && namespace_export_part_index < part_range.part_index_end
        // SAFETY: see `parts` raw-pointer note above.
        && unsafe { (*parts)[namespace_export_part_index as usize].is_live }
    {
        let ns_part_stmts: &[Stmt] =
            unsafe { (*parts)[namespace_export_part_index as usize].stmts }.slice();
        if let Err(err) = convert_stmts_for_chunk(
            c,
            source_index as u32,
            stmts,
            ns_part_stmts,
            chunk,
            temp_arena,
            flags.wrap,
            &ast,
        ) {
            // TODO(port): bun.handleErrorReturnTrace — no Rust equivalent
            return PrintResult::Err(err);
        }

        match flags.wrap {
            WrapKind::Esm => {
                // PORT NOTE: reshaped for borrowck — append_slice borrows `stmts` mutably while
                // also reading from a sibling field.
                let suffix = core::mem::take(&mut stmts.inside_wrapper_suffix);
                stmts.append_slice(StmtListWhich::OutsideWrapperPrefix, suffix.as_slice());
                stmts.inside_wrapper_suffix = suffix;
            }
            _ => {
                let suffix = core::mem::take(&mut stmts.inside_wrapper_suffix);
                stmts
                    .inside_wrapper_prefix
                    .append_non_dependency_slice(suffix.as_slice())
                    .expect("unreachable");
                stmts.inside_wrapper_suffix = suffix;
            }
        }

        stmts.inside_wrapper_suffix.clear();
    }

    // Add all other parts in this chunk
    // SAFETY: see `parts` raw-pointer note above.
    let parts_len = unsafe { (&*parts).len() };
    for index_ in 0..parts_len {
        // SAFETY: index in bounds.
        let part: &Part = unsafe { &(*parts)[index_] };
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

        let mut single_stmts_list: [Stmt; 1] = [Stmt::empty()];
        let mut part_stmts: &[Stmt] = part.stmts.slice();

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

            let mut default_expr = match &default_export.value {
                bun_ast::StmtOrExpr::Expr(e) => *e,
                bun_ast::StmtOrExpr::Stmt(_) => {
                    panic!("expected Lazy default export value to be an expression")
                }
            };

            // Be careful: the top-level value in a JSON file is not necessarily an object
            if let ExprData::EObject(e_object) = default_expr.data {
                // PORT NOTE: Zig `properties.clone(temp_arena)` is a memcpy into the
                // temp arena. `G::Property` is not `Clone` (it embeds a `Vec`), so
                // mirror the Zig bitwise copy directly. JSON object properties carry no
                // owned heap data (`ts_decorators` is always empty, `class_static_block`
                // is `None`), so the duplicated bits do not alias any allocation.
                let src_len = e_object.properties.len();
                let mut new_properties = Vec::<G::Property>::init_capacity(src_len);
                // SAFETY: `new_properties` has capacity `src_len`; source slice is live
                // arena memory of length `src_len`; see note above re: no owned heap data.
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        e_object.properties.as_ptr(),
                        new_properties.as_mut_ptr(),
                        src_len,
                    );
                    unsafe { new_properties.set_len((src_len as u32) as usize) };
                }

                let resolved_exports = &c.graph.meta.items_resolved_exports()[source_index];

                // If any top-level properties ended up being imported directly, change
                // the property to just reference the corresponding variable instead
                for prop in new_properties.slice_mut() {
                    if prop.key.is_none()
                        || !matches!(
                            prop.key.as_ref().expect("infallible: prop has key").data,
                            ExprData::EString(_)
                        )
                        || prop.value.is_none()
                    {
                        continue;
                    }
                    let name = match &mut prop.key.as_mut().unwrap().data {
                        ExprData::EString(s) => s.slice(temp_arena),
                        _ => unreachable!(),
                    };
                    if name == b"default" || name == b"__esModule" || !js_lexer::is_identifier(name)
                    {
                        continue;
                    }

                    if let Some(export_data) = resolved_exports.get(name) {
                        let export_ref = export_data.data.import_ref;
                        let part_idx = c
                            .graph
                            .top_level_symbol_to_parts(source_index as u32, export_ref)[0]
                            as usize;
                        let export_part = &ast.parts.slice()[part_idx];
                        if export_part.is_live {
                            // PTR_AUDIT(#1): `*prop` is a bitwise copy of
                            // `e_object.properties[i]` (see `copy_nonoverlapping`
                            // above). A plain `*prop = …` would run `Drop` on the
                            // aliased old value — specifically `prop.ts_decorators:
                            // Vec<Expr>`, which (if non-empty) would free the
                            // *original AST's* allocation. The "JSON ⇒ ts_decorators
                            // empty" invariant makes that drop a no-op today, but
                            // `ptr::write` enforces it structurally.
                            let key = prop.key;
                            let value_loc =
                                prop.value.as_ref().expect("infallible: prop has value").loc;
                            // SAFETY: `prop` is a valid `&mut G::Property` slot;
                            // the overwritten old value aliases AST-owned data and
                            // MUST NOT be dropped (PTR_AUDIT.md class #1).
                            unsafe {
                                core::ptr::write(
                                    prop,
                                    G::Property {
                                        key,
                                        value: Some(Expr::init_identifier(export_ref, value_loc)),
                                        ..Default::default()
                                    },
                                );
                            }
                        }
                    }
                }

                default_expr = Expr::allocate(
                    temp_arena,
                    E::Object {
                        properties: Vec::move_from_list(new_properties),
                        ..Default::default()
                    },
                    default_expr.loc,
                );
            }

            single_stmts_list[0] = Stmt::allocate(
                temp_arena,
                S::ExportDefault {
                    default_name: default_export.default_name,
                    value: bun_ast::StmtOrExpr::Expr(default_expr),
                },
                stmt.loc,
            );
            part_stmts = &single_stmts_list[..];
        }

        if let Err(err) = convert_stmts_for_chunk(
            c,
            source_index as u32,
            stmts,
            part_stmts,
            chunk,
            temp_arena,
            flags.wrap,
            &ast,
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
    stmts
        .all_stmts
        .reserve(stmts.inside_wrapper_prefix.stmts.len() + stmts.inside_wrapper_suffix.len());
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
        merge_adjacent_local_stmts(&mut stmts.all_stmts, temp_arena);
    }

    let mut out_stmts = bun_ast::StoreSlice::new_mut(stmts.all_stmts.as_mut_slice());

    // Optionally wrap all statements in a closure
    if needs_wrapper {
        match flags.wrap {
            WrapKind::Cjs => {
                // Only include the arguments that are actually used
                let mut args: bun_alloc::ArenaVec<'_, G::Arg> =
                    bun_alloc::ArenaVec::with_capacity_in(
                        if ast
                            .flags
                            .intersects(AstFlags::USES_MODULE_REF | AstFlags::USES_EXPORTS_REF)
                        {
                            2
                        } else {
                            0
                        },
                        temp_arena,
                    );

                if ast
                    .flags
                    .intersects(AstFlags::USES_MODULE_REF | AstFlags::USES_EXPORTS_REF)
                {
                    // PERF(port): was appendAssumeCapacity
                    args.push(G::Arg {
                        binding: Binding::alloc(
                            temp_arena,
                            B::Identifier {
                                r#ref: ast.exports_ref,
                            },
                            bun_ast::Loc::EMPTY,
                        ),
                        ..Default::default()
                    });

                    if ast.flags.contains(AstFlags::USES_MODULE_REF) {
                        // PERF(port): was appendAssumeCapacity
                        args.push(G::Arg {
                            binding: Binding::alloc(
                                temp_arena,
                                B::Identifier {
                                    r#ref: ast.module_ref,
                                },
                                bun_ast::Loc::EMPTY,
                            ),
                            ..Default::default()
                        });
                    }
                }

                // TODO: variants of the runtime functions
                let body_stmts = bun_ast::StoreSlice::new_mut(stmts.all_stmts.as_mut_slice());
                let cjs_args = Vec::<Expr>::from_slice(&[Expr::init(
                    E::Arrow {
                        args: bun_ast::StoreSlice::new(args.into_bump_slice()),
                        body: G::FnBody {
                            stmts: body_stmts,
                            loc: bun_ast::Loc::EMPTY,
                        },
                        ..Default::default()
                    },
                    bun_ast::Loc::EMPTY,
                )]);

                let commonjs_wrapper_definition = Expr::init(
                    E::Call {
                        target: Expr::init(
                            E::Identifier {
                                ref_: c.cjs_runtime_ref,
                                ..Default::default()
                            },
                            bun_ast::Loc::EMPTY,
                        ),
                        args: Vec::move_from_list(cjs_args),
                        ..Default::default()
                    },
                    bun_ast::Loc::EMPTY,
                );

                // "var require_foo = __commonJS(...);"
                {
                    let decls = G::DeclList::from_slice(&[G::Decl {
                        binding: Binding::alloc(
                            temp_arena,
                            B::Identifier {
                                r#ref: ast.wrapper_ref,
                            },
                            bun_ast::Loc::EMPTY,
                        ),
                        value: Some(commonjs_wrapper_definition),
                    }]);

                    stmts.append(
                        StmtListWhich::OutsideWrapperPrefix,
                        Stmt::alloc(
                            S::Local {
                                decls,
                                ..Default::default()
                            },
                            bun_ast::Loc::EMPTY,
                        ),
                    );
                }
            }
            WrapKind::Esm => {
                // The wrapper only needs to be "async" if there is a transitive async
                // dependency. For correctness, we must not use "async" if the module
                // isn't async because then calling "require()" on that module would
                // swallow any exceptions thrown during module initialization.
                let is_async = flags.is_async_or_has_async_dependency;

                struct ExportHoist {
                    decls: Vec<G::Decl>,
                    // BackRef: the arena is the caller's `temp_arena: &Bump`,
                    // which strictly outlives this local helper struct.
                    arena: bun_ptr::BackRef<Bump>,
                }

                impl ExportHoist {
                    fn wrap_identifier(&mut self, loc: bun_ast::Loc, ref_: Ref) -> Expr {
                        // Copy the BackRef so the `&Bump` borrow is detached
                        // from `&mut self` (needed for `self.decls.push`).
                        let arena = self.arena;
                        self.decls.push(G::Decl {
                            binding: Binding::alloc(
                                arena.get(),
                                B::Identifier { r#ref: ref_ },
                                loc,
                            ),
                            value: None,
                        });

                        Expr::init_identifier(ref_, loc)
                    }

                    /// Trampoline matching `ToExprWrapper`'s erased fn-pointer signature.
                    fn wrap_trampoline(
                        ctx: *mut core::ffi::c_void,
                        loc: bun_ast::Loc,
                        ref_: Ref,
                    ) -> Expr {
                        // SAFETY: `ctx` is `&mut ExportHoist` derived at the call site.
                        let this = unsafe { bun_ptr::callback_ctx::<ExportHoist>(ctx) };
                        this.wrap_identifier(loc, ref_)
                    }
                }

                let mut hoist = ExportHoist {
                    decls: Vec::new(),
                    arena: bun_ptr::BackRef::new(temp_arena),
                };
                let hoist_wrapper = ToExprWrapper::new(temp_arena, ExportHoist::wrap_trampoline);

                let mut inner_stmts = bun_ast::StoreSlice::new_mut(stmts.all_stmts.as_mut_slice());

                // Hoist all top-level "var" and "function" declarations out of the closure
                {
                    let mut end: usize = 0;
                    // PORT NOTE: reshaped for borrowck — iterate by index since we mutate
                    // `inner_stmts[end]` and call `stmts.append(...)` inside the loop.
                    'hoist: for i in 0..stmts.all_stmts.len() {
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
                                for decl in local.decls.slice() {
                                    if let Some(initializer) = decl.value {
                                        let can_be_moved = initializer.can_be_moved();
                                        if can_be_moved {
                                            // if the value can be moved, move the decl directly to preserve destructuring
                                            // ie `const { main } = class { static main() {} }` => `var {main} = class { static main() {} }`
                                            hoist.decls.push(G::Decl {
                                                binding: decl.binding,
                                                value: decl.value,
                                            });
                                        } else {
                                            // if the value cannot be moved, add every destructuring key separately
                                            // ie `var { append } = { append() {} }` => `var append; __esm(() => ({ append } = { append() {} }))`
                                            let binding = Binding::to_expr(
                                                &decl.binding,
                                                (&raw mut hoist).cast::<core::ffi::c_void>(),
                                                hoist_wrapper,
                                            );
                                            value = value.join_with_comma(Expr::assign(
                                                binding,
                                                initializer,
                                            ));
                                        }
                                    } else {
                                        let _ = Binding::to_expr(
                                            &decl.binding,
                                            (&raw mut hoist).cast::<core::ffi::c_void>(),
                                            hoist_wrapper,
                                        );
                                    }
                                }

                                if value.is_empty() {
                                    continue 'hoist;
                                }

                                break 'stmt Stmt::allocate_expr(temp_arena, value);
                            }
                            StmtData::SFunction(_) => {
                                stmts.append(StmtListWhich::OutsideWrapperPrefix, stmt);
                                continue 'hoist;
                            }
                            StmtData::SClass(mut class) => 'stmt: {
                                // PORT NOTE: `class` is `StoreRef<S::Class>` — an arena-owned pointer.
                                // `&mut class.class` (via DerefMut) yields a `&mut G::Class` into arena
                                // memory, so wrapping it in a StoreRef for `EClass` is sound and matches
                                // Zig's `&class.class`.
                                if class.class.can_be_moved() {
                                    stmts.append(StmtListWhich::OutsideWrapperPrefix, stmt);
                                    continue 'hoist;
                                }

                                let class_name_loc = class.class.class_name.unwrap().loc;
                                let class_name_ref = class
                                    .class
                                    .class_name
                                    .unwrap()
                                    .ref_
                                    .expect("infallible: ref bound");
                                let lhs = hoist.wrap_identifier(class_name_loc, class_name_ref);
                                let class_ref: StoreRef<E::Class> =
                                    StoreRef::from_bump(&mut class.class);
                                break 'stmt Stmt::allocate_expr(
                                    temp_arena,
                                    Expr::assign(
                                        lhs,
                                        Expr {
                                            data: ExprData::EClass(class_ref),
                                            loc: stmt.loc,
                                        },
                                    ),
                                );
                            }
                            _ => stmt,
                        };

                        // `inner_stmts` aliases `stmts.all_stmts.items` which is not
                        // resized in this loop; `end <= i < len`.
                        inner_stmts.slice_mut()[end] = transformed;
                        end += 1;
                    }
                    inner_stmts.truncate(end);
                }

                if !hoist.decls.is_empty() {
                    stmts.append(
                        StmtListWhich::OutsideWrapperPrefix,
                        Stmt::alloc(
                            S::Local {
                                decls: G::DeclList::move_from_list(core::mem::take(
                                    &mut hoist.decls,
                                )),
                                ..Default::default()
                            },
                            bun_ast::Loc::EMPTY,
                        ),
                    );
                    hoist.decls.clear();
                }

                let inner_len = inner_stmts.len();
                if inner_len > 0 {
                    // See the comment in needsWrapperRef for why the symbol
                    // is sometimes not generated.
                    debug_assert!(!ast.wrapper_ref.is_empty()); // js_parser's needsWrapperRef thought wrapper was not needed

                    // "__esm(() => { ... })"
                    let esm_args = Vec::<Expr>::from_slice(&[Expr::init(
                        E::Arrow {
                            is_async,
                            body: G::FnBody {
                                stmts: inner_stmts,
                                loc: bun_ast::Loc::EMPTY,
                            },
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    )]);

                    // "var init_foo = __esm(...);"
                    let value = Expr::init(
                        E::Call {
                            target: Expr::init_identifier(c.esm_runtime_ref, bun_ast::Loc::EMPTY),
                            args: Vec::move_from_list(esm_args),
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    );

                    let decls = G::DeclList::from_slice(&[G::Decl {
                        binding: Binding::alloc(
                            temp_arena,
                            B::Identifier {
                                r#ref: ast.wrapper_ref,
                            },
                            bun_ast::Loc::EMPTY,
                        ),
                        value: Some(value),
                    }]);

                    stmts.append(
                        StmtListWhich::OutsideWrapperPrefix,
                        Stmt::alloc(
                            S::Local {
                                decls,
                                ..Default::default()
                            },
                            bun_ast::Loc::EMPTY,
                        ),
                    );
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
                                is_async,
                                body: G::FnBody {
                                    stmts: inner_stmts,
                                    loc: bun_ast::Loc::EMPTY,
                                },
                                ..Default::default()
                            },
                            bun_ast::Loc::EMPTY,
                        );

                        stmts.append(
                            StmtListWhich::OutsideWrapperPrefix,
                            Stmt::alloc(
                                S::Local {
                                    decls: G::DeclList::from_slice(&[G::Decl {
                                        binding: Binding::alloc(
                                            temp_arena,
                                            B::Identifier {
                                                r#ref: ast.wrapper_ref,
                                            },
                                            bun_ast::Loc::EMPTY,
                                        ),
                                        value: Some(value),
                                    }]),
                                    ..Default::default()
                                },
                                bun_ast::Loc::EMPTY,
                            ),
                        );
                    }
                }
            }
            _ => {}
        }

        out_stmts = bun_ast::StoreSlice::new_mut(stmts.outside_wrapper_prefix.as_mut_slice());
    }

    // `out_stmts` aliases either `stmts.all_stmts` or `stmts.outside_wrapper_prefix`,
    // both of which remain live for the rest of this function.
    let out_stmts: &mut [Stmt] = out_stmts.slice_mut();

    if out_stmts.is_empty() {
        return PrintResult::Result(PrintResultSuccess {
            code: Box::new([]),
            source_map: None,
        });
    }

    // Collect top-level declarations from the converted statements.
    // This is done here (after convertStmtsForChunk) rather than in
    // postProcessJSChunk, because convertStmtsForChunk transforms the AST
    // (e.g. export default expr → var, export stripping) and the converted
    // statements reflect what actually gets printed.
    let mut r = r;
    if let Some(dc) = decl_collector {
        dc.collect_from_stmts(out_stmts, &mut r, c);
    }

    // `get_source` returns `&'static Source` (parse_graph SoA is append-only and
    // outlives the link step), so it does not borrow `c` — no split-borrow needed
    // across the `&mut self` call below.
    let source: &bun_ast::Source = c.get_source(source_index as u32);
    c.print_code_for_file_in_chunk_js(
        r,
        arena,
        writer,
        out_stmts,
        &ast,
        flags,
        to_esm_ref,
        to_common_js_ref,
        runtime_require_ref,
        part_range.source_index,
        source,
    )
}

pub struct DeclCollector {
    pub decls: Vec<DeclInfo>,
    pub arena: *const Bump,
}

impl Default for DeclCollector {
    fn default() -> Self {
        Self {
            decls: Vec::new(),
            arena: core::ptr::null(),
        }
    }
}

impl DeclCollector {
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
        r: &mut renamer::Renamer<'_, '_>,
        c: &LinkerContext,
    ) {
        for stmt in stmts {
            match stmt.data {
                StmtData::SLocal(s) => {
                    let kind: DeclInfoKind = if s.kind == LocalKind::KVar {
                        DeclInfoKind::Declared
                    } else {
                        DeclInfoKind::Lexical
                    };
                    for decl in s.decls.slice() {
                        self.collect_from_binding(decl.binding, kind, r, c);
                    }
                }
                StmtData::SFunction(s) => {
                    if let Some(name_loc_ref) = s.func.name {
                        if let Some(name_ref) = name_loc_ref.ref_ {
                            self.add_ref(name_ref, DeclInfoKind::Lexical, r, c);
                        }
                    }
                }
                StmtData::SClass(s) => {
                    if let Some(class_name) = s.class.class_name {
                        if let Some(name_ref) = class_name.ref_ {
                            self.add_ref(name_ref, DeclInfoKind::Lexical, r, c);
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
        kind: DeclInfoKind,
        r: &mut renamer::Renamer<'_, '_>,
        c: &LinkerContext,
    ) {
        match binding.data {
            BindingData::BIdentifier(b) => {
                self.add_ref(b.r#ref, kind, r, c);
            }
            BindingData::BArray(b) => {
                for item in b.items() {
                    self.collect_from_binding(item.binding, kind, r, c);
                }
            }
            BindingData::BObject(b) => {
                for prop in b.properties() {
                    self.collect_from_binding(prop.value, kind, r, c);
                }
            }
            BindingData::BMissing(_) => {}
        }
    }

    fn add_ref(
        &mut self,
        ref_: Ref,
        kind: DeclInfoKind,
        r: &mut renamer::Renamer<'_, '_>,
        c: &LinkerContext,
    ) {
        let followed = c.graph.symbols.follow(ref_);
        let name = r.name_for_symbol(followed);
        if name.is_empty() {
            return;
        }
        // Zig: `catch return` — silently drop on alloc failure. With std Vec
        // push aborts on OOM, so there is nothing to catch.
        self.decls.push(DeclInfo {
            name: name.to_vec().into_boxed_slice(),
            kind,
        });
    }
}

fn merge_adjacent_local_stmts(stmts: &mut Vec<Stmt>, _arena: &Bump) {
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
            if let StmtData::SLocal(mut before) = stmts[end - 1].data {
                // It must be the same kind of variable statement (i.e. let/var/const)
                if before.can_merge_with(&after) {
                    if did_merge_with_previous_local {
                        // Avoid O(n^2) behavior for repeated variable declarations
                        // Appending to this decls list is safe because did_merge_with_previous_local is true
                        before.decls.append_slice(after.decls.slice());
                    } else {
                        // Append the declarations to the previous variable statement
                        did_merge_with_previous_local = true;

                        let mut clone =
                            Vec::<G::Decl>::init_capacity(before.decls.len() + after.decls.len());
                        // PERF(port): was appendSliceAssumeCapacity
                        clone.append_slice_assume_capacity(before.decls.slice());
                        clone.append_slice_assume_capacity(after.decls.slice());
                        // we must clone instead of overwrite in-place incase the same S.Local is used across threads
                        // https://github.com/oven-sh/bun/issues/2942
                        let prev_loc = stmts[end - 1].loc;
                        stmts[end - 1] = Stmt::allocate(
                            _arena,
                            S::Local {
                                decls: Vec::move_from_list(clone),
                                is_export: before.is_export,
                                was_commonjs_export: before.was_commonjs_export,
                                was_ts_import_equals: before.was_ts_import_equals,
                                kind: before.kind,
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

// Type aliases / re-imports for readability of match arms (mirrors Zig naming).
use bun_ast::LocalKind;
use bun_ast::binding::Data as BindingData;
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;

// ported from: src/bundler/linker_context/generateCodeForFileInChunkJS.zig
