//! `--optimize-module-scopes`: with ESM output, a module's top-level bindings that nothing outside the module references
//! are printed inside a block statement of their own, so they leave the chunk's single shared scope. The minify renamer
//! then names them like nested-scope symbols (every module restarts at the shortest names) and the engine builds one
//! small lexical scope per module instead of one scope holding every binding in the chunk.
//!
//! This runs after chunks and their part ranges are final and before renaming; it never changes which parts are live
//! or where they go. A file takes part only when all of its live parts print as one contiguous range in one chunk, it
//! is not in a static-import cycle (so no other module can observe its bindings before its block has run — the chunk
//! import graph itself is acyclic by construction), it is not wrapped, and it has no top-level `using`/direct `eval`.
//! Bindings another file, another chunk or an entry-point export clause reaches stay at chunk scope: `let/const/class`
//! become `var` in place and a `function` becomes `var f = function f() {}` at the top of the block, which is where
//! hoisting would have put it.

use crate::mal_prelude::*;
use bun_ast::symbol::SlotNamespace;
use bun_ast::{ImportKind, Ref, StmtData};
use bun_collections::{ArrayHashMap, AutoBitSet, VecExt};

use crate::linker_context_mod::debug;

use crate::chunk::Content;
use crate::options::Format;
use crate::{Chunk, EntryPoint, Index, LinkerContext, PartRange, WrapKind};

/// What the printer needs for one file.
pub(crate) struct ModuleScopeBlock {
    /// Top-level `let`/`const`/`class`/`function` bindings of this file that must stay reachable at chunk scope.
    pub(crate) hoisted: ArrayHashMap<Ref, ()>,
    /// The ones that become block-scoped (they carry nested renamer slots now, so they must not print at chunk scope).
    pub(crate) internal: ArrayHashMap<Ref, ()>,
}

impl ModuleScopeBlock {
    /// A `var` statement whose bindings were all classified internal (originally `let`/`const`).
    pub(crate) fn internal_stmt(&self, local: &bun_ast::S::Local) -> bool {
        let mut refs: Vec<Ref> = Vec::new();
        for decl in local.decls.slice() {
            collect_binding_refs(&decl.binding, &mut refs);
        }
        !refs.is_empty() && refs.iter().all(|r| self.internal.contains(r))
    }
}

impl<'a> LinkerContext<'a> {
    pub(crate) fn compute_module_scope_blocks(&mut self, chunks: &mut [Chunk]) -> Result<(), crate::Error> {
        self.module_scope_blocks.clear();
        if !self.options.optimize_module_scopes || self.options.output_format != Format::Esm {
            return Ok(());
        }
        let _trace = bun_core::perf::trace("Bundler.computeModuleScopeBlocks");
        let file_count = self.graph.files.len();
        self.module_scope_blocks.resize_with(file_count, || None);

        // 1. Coalesce adjacent ranges of the same file (a dead part between two live ones splits a range; the printer
        //    skips dead parts itself), then find the files whose live parts form exactly one range.
        let mut range_count = vec![0u32; file_count];
        for chunk in chunks.iter_mut() {
            let Content::Javascript(js) = &mut chunk.content else { continue };
            let ranges = core::mem::take(&mut js.parts_in_chunk_in_order).into_vec();
            let mut out: Vec<PartRange> = Vec::with_capacity(ranges.len());
            for r in ranges {
                if let Some(last) = out.last_mut() {
                    if last.source_index.get() == r.source_index.get() && last.part_index_end <= r.part_index_begin {
                        last.part_index_end = r.part_index_end;
                        continue;
                    }
                }
                out.push(r);
            }
            for r in &out {
                range_count[r.source_index.get() as usize] += 1;
            }
            js.parts_in_chunk_in_order = out.into_boxed_slice();
        }

        // 2. Files in a static-import cycle keep today's hoisted form: inside a cycle a module's exported `function`s
        //    can be called before its own statements have run.
        let in_cycle = self.files_in_static_import_cycles()?;

        // 3. Every top-level symbol some *other* file's live part refers to (imports are followed to what they bind).
        let mut used_elsewhere: ArrayHashMap<Ref, ()> = ArrayHashMap::new();
        {
            let parts = self.graph.ast.items_parts();
            let symbols = &self.graph.symbols;
            for &source in self.graph.reachable_files.slice() {
                let source_index = source.get();
                let parts_live = &self.graph.parts_live[source_index as usize];
                for (part_index, part) in parts[source_index as usize].as_slice().iter().enumerate() {
                    if !parts_live.is_set(part_index) {
                        continue;
                    }
                    for &ref_ in part.symbol_uses.keys() {
                        let target = symbols.follow(ref_);
                        if target.source_index() != source_index {
                            used_elsewhere.put(target, ())?;
                        }
                    }
                }
                // An entry point's export clause is generated later from resolved_exports, outside any part.
                if self.graph.files.items_entry_point_kind()[source_index as usize] != EntryPoint::Kind::None {
                    for export in self.graph.meta.items_resolved_exports()[source_index as usize].values() {
                        used_elsewhere.put(symbols.follow(export.data.import_ref), ())?;
                    }
                }
            }
            for chunk in chunks.iter() {
                let Content::Javascript(js) = &chunk.content else { continue };
                for &ref_ in js.exports_to_other_chunks.keys() {
                    used_elsewhere.put(symbols.follow(ref_), ())?;
                }
            }
        }

        // 4. Per eligible file: classify each top-level declaration statement, give the internal bindings nested
        //    renamer slots, and move the file's existing nested slots past them.
        let flags = self.graph.meta.items_flags();
        let ast_flags = self.graph.ast.items_flags();
        let module_scopes = self.graph.ast.items_module_scope();
        let exports_kind = self.graph.ast.items_exports_kind();
        let mut slot_count_bumps: Vec<(usize, u32)> = Vec::new();
        let mut blocked_files = 0usize;
        let mut internal_symbols = 0usize;
        let mut hoisted_symbols = 0usize;
        for &source in self.graph.reachable_files.slice() {
            let source_index = source.get();
            let i = source_index as usize;
            if range_count[i] != 1
                || source_index == Index::RUNTIME.get()
                || in_cycle.is_set(i)
                || flags[i].wrap != WrapKind::None
                || module_scopes[i].contains_direct_eval
                || ast_flags[i].contains(crate::bundled_ast::Flags::HAS_LAZY_EXPORT)
                || !matches!(exports_kind[i], bun_ast::ExportsKind::Esm | bun_ast::ExportsKind::EsmWithDynamicFallback)
                || self.graph.ast.items_css()[i].is_some()
            {
                continue;
            }
            let parts = self.graph.ast.items_parts()[i].as_slice();
            let parts_live = &self.graph.parts_live[i];

            // A binding is internal only if every live part of this file that uses it is... in this file's one range,
            // which is all of them; so within the file only the declaration kind matters. Across files: `used_elsewhere`.
            let mut hoisted: ArrayHashMap<Ref, ()> = ArrayHashMap::new();
            let mut internal: Vec<Ref> = Vec::new();
            let mut group: Vec<Ref> = Vec::new();
            let mut has_top_level_using = false;
            for (part_index, part) in parts.iter().enumerate() {
                if !parts_live.is_set(part_index) {
                    continue;
                }
                for stmt in part.stmts.slice() {
                    group.clear();
                    match stmt.data {
                        StmtData::SLocal(local) => {
                            if local.kind.is_using() {
                                has_top_level_using = true;
                                continue;
                            }
                            // Bundling prints top-level `let`/`const` as `var` (select_local_kind); the symbols still
                            // say which were lexical. A statement declaring any real `var` stays as it is.
                            for decl in local.decls.slice() {
                                collect_binding_refs(&decl.binding, &mut group);
                            }
                            let symbols = &self.graph.symbols;
                            if group.iter().any(|&r| {
                                symbols
                                    .get_const(symbols.follow(r))
                                    .is_none_or(|sym| !matches!(sym.kind, bun_ast::symbol::Kind::Other | bun_ast::symbol::Kind::Constant))
                            }) {
                                continue;
                            }
                        }
                        StmtData::SFunction(f) => {
                            if let Some(name) = f.func.name {
                                group.push(name.ref_);
                            }
                        }
                        StmtData::SClass(class) => {
                            if let Some(name) = class.class.class_name {
                                group.push(name.ref_);
                            }
                        }
                        StmtData::SExportDefault(default) => {
                            if let bun_ast::StmtOrExpr::Stmt(inner) = &default.value {
                                if matches!(inner.data, StmtData::SFunction(_) | StmtData::SClass(_)) {
                                    group.push(default.default_name.ref_);
                                }
                            }
                        }
                        _ => continue,
                    }
                    if group.is_empty() {
                        continue;
                    }
                    let symbols = &self.graph.symbols;
                    let stays = group.iter().any(|&r| {
                        let r = symbols.follow(r);
                        used_elsewhere.contains(&r)
                            || symbols.get_const(r).is_none_or(|sym| sym.slot_namespace() != SlotNamespace::Default)
                    });
                    if stays {
                        for &r in &group {
                            hoisted.put(symbols.follow(r), ())?;
                        }
                    } else {
                        for &r in &group {
                            internal.push(symbols.follow(r));
                        }
                    }
                }
            }
            if has_top_level_using {
                continue;
            }

            // Nested slots for the internal bindings, most-used first; then shift the file's existing nested slots
            // past them so an inner scope's slot can never alias one of these.
            let symbols = &mut self.graph.symbols;
            internal.sort_unstable_by(|a, b| {
                let ua = symbols.get_const(*a).map_or(0, |s| s.use_count_estimate);
                let ub = symbols.get_const(*b).map_or(0, |s| s.use_count_estimate);
                ub.cmp(&ua).then(a.inner_index().cmp(&b.inner_index()))
            });
            internal.dedup();
            let shift = internal.len() as u32;
            if shift > 0 {
                let file_symbols = symbols.symbols_for_source.slice_mut()[i].slice_mut();
                for sym in file_symbols.iter_mut() {
                    if sym.nested_scope_slot().is_some() && sym.slot_namespace() == SlotNamespace::Default {
                        sym.nested_scope_slot += shift;
                    }
                }
                for (slot, r) in internal.iter().enumerate() {
                    debug_assert_eq!(r.source_index(), source_index);
                    file_symbols[r.inner_index() as usize].nested_scope_slot = slot as u32;
                }
                slot_count_bumps.push((i, shift));
            }
            internal_symbols += internal.len();
            hoisted_symbols += hoisted.count();
            blocked_files += 1;
            let mut internal_set: ArrayHashMap<Ref, ()> = ArrayHashMap::new();
            for &r in &internal {
                internal_set.put(r, ())?;
            }
            self.module_scope_blocks[i] = Some(Box::new(ModuleScopeBlock { hoisted, internal: internal_set }));
        }
        for (i, shift) in slot_count_bumps {
            self.graph.ast.items_nested_scope_slot_counts_mut()[i].slots[SlotNamespace::Default] += shift;
        }
        debug!(
            "optimize-module-scopes: {} files blocked, {} bindings internal, {} kept at chunk scope, {} files in import cycles",
            blocked_files,
            internal_symbols,
            hoisted_symbols,
            in_cycle.count()
        );
        if std::env::var_os("BUN_DEBUG_OMS").is_some() {
            eprintln!("[optimize-module-scopes] {} files blocked, {} bindings internal, {} kept at chunk scope, {} files in import cycles", blocked_files, internal_symbols, hoisted_symbols, in_cycle.count());
        }
        Ok(())
    }

    /// Tarjan's SCC over static `import` edges between bundled files; set for every file in a component of two or
    /// more files or that imports itself.
    fn files_in_static_import_cycles(&self) -> Result<AutoBitSet, crate::Error> {
        let n = self.graph.files.len();
        let mut result = AutoBitSet::init_empty(n)?;
        let import_records = self.graph.ast.items_import_records();
        let edges = |v: u32| {
            import_records[v as usize]
                .as_slice()
                .iter()
                .filter(|r| r.kind == ImportKind::Stmt && r.source_index.is_valid())
                .map(|r| r.source_index.get())
        };

        const UNVISITED: u32 = u32::MAX;
        let mut index = vec![UNVISITED; n];
        let mut lowlink = vec![0u32; n];
        let mut on_stack = AutoBitSet::init_empty(n)?;
        let mut stack: Vec<u32> = Vec::new();
        // (node, next edge position) — iterative DFS.
        let mut work: Vec<(u32, usize)> = Vec::new();
        let mut next_index = 0u32;
        for &source in self.graph.reachable_files.slice() {
            let root = source.get();
            if index[root as usize] != UNVISITED {
                continue;
            }
            work.push((root, 0));
            while let Some(&mut (v, ref mut pos)) = work.last_mut() {
                if *pos == 0 && index[v as usize] == UNVISITED {
                    index[v as usize] = next_index;
                    lowlink[v as usize] = next_index;
                    next_index += 1;
                    stack.push(v);
                    on_stack.set(v as usize);
                }
                let mut descended = false;
                let mut it = edges(v).skip(*pos);
                while let Some(w) = it.next() {
                    *pos += 1;
                    if w == v {
                        result.set(v as usize);
                        continue;
                    }
                    if index[w as usize] == UNVISITED {
                        work.push((w, 0));
                        descended = true;
                        break;
                    } else if on_stack.is_set(w as usize) {
                        lowlink[v as usize] = lowlink[v as usize].min(index[w as usize]);
                    }
                }
                if descended {
                    continue;
                }
                // all edges done
                work.pop();
                if let Some(&(parent, _)) = work.last() {
                    lowlink[parent as usize] = lowlink[parent as usize].min(lowlink[v as usize]);
                }
                if lowlink[v as usize] == index[v as usize] {
                    let mut size = 0;
                    let start = stack.iter().rposition(|&x| x == v).expect("on stack");
                    for &x in &stack[start..] {
                        size += 1;
                        let _ = x;
                    }
                    for x in stack.drain(start..) {
                        on_stack.unset(x as usize);
                        if size > 1 {
                            result.set(x as usize);
                        }
                    }
                }
            }
        }
        Ok(result)
    }
}

fn collect_binding_refs(binding: &bun_ast::Binding, out: &mut Vec<Ref>) {
    use bun_ast::b::B;
    match &binding.data {
        B::BIdentifier(id) => out.push(id.r#ref),
        B::BArray(array) => {
            for item in array.items.slice() {
                collect_binding_refs(&item.binding, out);
            }
        }
        B::BObject(object) => {
            for prop in object.properties.slice() {
                collect_binding_refs(&prop.value, out);
            }
        }
        B::BMissing(_) => {}
    }
}
