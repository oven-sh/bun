use crate::p::P;
use bun_alloc::ArenaVec;
use bun_ast::{self as js_ast, Ref, flags};
use bun_collections::HashMap;
use bun_crash_handler::handle_oom::handle_oom;
use smallvec::SmallVec;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Single-file tree shaking (`features.remove_unused_declarations`).
    ///
    /// `Options.tree_shaking` gave every top-level statement its own part.
    /// Parts that do anything other than declare something side-effect free
    /// are roots; a declaration part survives only if a live part uses one of
    /// its symbols. Removing a part also un-counts its symbol uses, so the
    /// import scanner that runs next trims the imports only it needed.
    pub(crate) fn remove_unused_parts(&mut self, parts: &mut ArenaVec<'a, js_ast::Part>) {
        // The bundler tree shakes in the linker, where cross-file uses are known.
        debug_assert!(!self.options.bundle);

        // Code inside a direct eval() can name any top-level declaration.
        if self.module_scope().contains_direct_eval {
            return;
        }

        let arena = self.arena;
        let mut live = bun_alloc::vec_from_iter_in(core::iter::repeat_n(false, parts.len()), arena);
        let mut worklist = ArenaVec::<u32>::new_in(arena);
        // Redeclaring a `var` or function creates a second symbol linked to the
        // first, so both declarations are keyed by the symbol the links end at.
        let mut declaring_parts: HashMap<Ref, SmallVec<[u32; 1]>> = HashMap::default();

        for (i, part) in parts.iter().enumerate() {
            if !self.part_only_declares_removable_symbols(part) {
                live[i] = true;
                worklist.push(i as u32);
                continue;
            }
            for &declared in part.declared_symbols.refs() {
                let key = self.follow_symbol_links(declared);
                handle_oom(declaring_parts.get_or_put(key))
                    .value_ptr
                    .push(i as u32);
            }
        }

        while let Some(i) = worklist.pop() {
            for &used in parts[i as usize].symbol_uses.keys() {
                let Some(declaring) = declaring_parts.get(&self.follow_symbol_links(used)) else {
                    continue;
                };
                for &j in declaring {
                    if !live[j as usize] {
                        live[j as usize] = true;
                        worklist.push(j);
                    }
                }
            }
        }

        let live_count = live.iter().filter(|&&is_live| is_live).count();
        if live_count == parts.len() {
            return;
        }

        let all_parts = core::mem::replace(parts, ArenaVec::with_capacity_in(live_count, arena));
        for (part, is_live) in all_parts.into_iter().zip(live.iter()) {
            if *is_live {
                parts.push(part);
            } else {
                self.clear_symbol_usages_from_dead_part(&part);
            }
        }
    }

    /// Imports are kept here and trimmed by use count in the import scanner;
    /// exports and everything `can_be_removed_if_unused` rejects keep the rest
    /// of the file alive.
    fn part_only_declares_removable_symbols(&self, part: &js_ast::Part) -> bool {
        part.can_be_removed_if_unused
            && part.stmts.iter().all(|stmt| match &stmt.data {
                js_ast::StmtData::SLocal(local) => !local.is_export,
                js_ast::StmtData::SFunction(func) => {
                    !func.func.flags.contains(flags::Function::IsExport)
                }
                js_ast::StmtData::SClass(class) => !class.is_export,
                // Generated companions of a declaration, e.g. the closure that
                // fills in a TypeScript enum.
                js_ast::StmtData::SExpr(expr) => expr.does_not_affect_tree_shaking,
                js_ast::StmtData::SEmpty(_) => true,
                _ => false,
            })
    }

    fn follow_symbol_links(&self, mut ref_: Ref) -> Ref {
        loop {
            let symbol = &self.symbols[ref_.inner_index() as usize];
            if !symbol.has_link() {
                return ref_;
            }
            ref_ = symbol.link.get();
        }
    }
}
