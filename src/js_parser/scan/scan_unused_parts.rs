use crate::RuntimeImports;
use crate::p::P;
use bun_alloc::ArenaVec;
use bun_ast::{self as js_ast, DeclaredSymbol, ImportRecordFlags, Ref, flags};
use bun_collections::HashMap;
use bun_crash_handler::handle_oom::handle_oom;
use smallvec::SmallVec;

/// The parts declaring each top-level symbol, keyed by the end of the symbol's `link` chain.
type DeclaringParts = HashMap<Ref, SmallVec<[u32; 1]>>;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Single-file tree shaking of the hoisted (`before`) and remaining top-level parts.
    pub(crate) fn remove_unused_parts(
        &mut self,
        before: &mut ArenaVec<'a, js_ast::Part>,
        parts: &mut ArenaVec<'a, js_ast::Part>,
    ) {
        // The bundler tree shakes in the linker, where cross-file uses are known.
        debug_assert!(!self.options.bundle);

        // Code inside a direct eval() can name any top-level declaration.
        if self.module_scope().contains_direct_eval {
            return;
        }

        let arena = self.arena;
        let hoisted = before.len();
        let mut all = core::mem::replace(before, ArenaVec::new_in(arena));
        all.append(parts);

        let mut live = bun_alloc::vec_from_iter_in(core::iter::repeat_n(false, all.len()), arena);
        let mut worklist = ArenaVec::<u32>::new_in(arena);
        let mut declaring_parts = DeclaringParts::default();

        for (i, part) in all.iter().enumerate() {
            if !self.part_only_declares_removable_symbols(part) {
                live[i] = true;
                worklist.push(i as u32);
            }
            DeclaredSymbol::for_each_top_level_symbol(
                &part.declared_symbols,
                &mut declaring_parts,
                |declaring_parts, declared| {
                    handle_oom(declaring_parts.get_or_put(self.follow_symbol_links(declared)))
                        .value_ptr
                        .push(i as u32);
                },
            );
        }

        while let Some(i) = worklist.pop() {
            let part = &all[i as usize];
            for &used in part.symbol_uses.keys() {
                self.mark_declaring_parts_live(used, &declaring_parts, &mut live, &mut worklist);
            }
            // Every declaration of a live symbol stays: `export var x = 1; var x = 2;`
            DeclaredSymbol::for_each_top_level_symbol(
                &part.declared_symbols,
                &mut (&mut live, &mut worklist),
                |(live, worklist), declared| {
                    self.mark_declaring_parts_live(declared, &declaring_parts, live, worklist);
                },
            );
        }

        for (i, (part, is_live)) in all.into_iter().zip(live.iter()).enumerate() {
            if *is_live {
                let kept = if i < hoisted {
                    &mut *before
                } else {
                    &mut *parts
                };
                kept.push(part);
                continue;
            }
            // `scan()` and the linker skip unused records.
            for &record_index in part.import_record_indices.iter() {
                self.import_records.items_mut()[record_index as usize]
                    .flags
                    .insert(ImportRecordFlags::IS_UNUSED);
            }
            self.clear_symbol_usages_from_dead_part(&part);
        }

        self.forget_unused_runtime_helpers();
    }

    fn mark_declaring_parts_live(
        &self,
        symbol: Ref,
        declaring_parts: &DeclaringParts,
        live: &mut [bool],
        worklist: &mut ArenaVec<'a, u32>,
    ) {
        let Some(declaring) = declaring_parts.get(&self.follow_symbol_links(symbol)) else {
            return;
        };
        for &i in declaring {
            if !live[i as usize] {
                live[i as usize] = true;
                worklist.push(i);
            }
        }
    }

    /// Imports stay here and get trimmed by use count in the import scanner.
    fn part_only_declares_removable_symbols(&self, part: &js_ast::Part) -> bool {
        part.can_be_removed_if_unused
            && part.stmts.iter().all(|stmt| match &stmt.data {
                js_ast::StmtData::SLocal(local) => !local.is_export,
                js_ast::StmtData::SFunction(func) => {
                    !func.func.flags.contains(flags::Function::IsExport)
                }
                js_ast::StmtData::SClass(class) => !class.is_export,
                // Generated next to a declaration, e.g. a TypeScript enum's closure.
                js_ast::StmtData::SExpr(expr) => expr.does_not_affect_tree_shaking,
                js_ast::StmtData::SEmpty(_) => true,
                _ => false,
            })
    }

    /// Redeclaring a `var` or function links the earlier symbol to the new one.
    fn follow_symbol_links(&self, mut ref_: Ref) -> Ref {
        loop {
            let symbol = &self.symbols[ref_.inner_index() as usize];
            if !symbol.has_link() {
                return ref_;
            }
            ref_ = symbol.link.get();
        }
    }

    /// A `bun:wrap` helper whose callers were all swept would otherwise still be imported.
    fn forget_unused_runtime_helpers(&mut self) {
        let mut unused: SmallVec<[&'static [u8]; 4]> = SmallVec::new();
        let mut helpers = self.runtime_imports.iter();
        while let Some(helper) = helpers.next() {
            if self.symbols[helper.value.inner_index() as usize].use_count_estimate == 0 {
                unused.push(RuntimeImports::ALL[helper.key as usize]);
            }
        }
        for name in unused {
            self.runtime_imports.put(name, Ref::NONE);
        }
    }
}
