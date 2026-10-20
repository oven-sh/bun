//! Removes what only the deleted exports of a page needed from its browser copy.
//!
//! `features.remove_server_only_code` gives every top-level statement its own part, so each part's
//! `symbol_uses` says what that statement needs. A variable, function or class goes when removed
//! code used every name it declares and nothing that stays can reach it, even if creating it has
//! side effects. A binding that nothing used stays, as Next.js's SSG transform keeps it.

use bun_ast::{self as js_ast, ImportRecordFlags, Ref, flags};
use bun_collections::{HashMap, VecExt};

use crate::p::P;

type BindingData = js_ast::b::B;

/// A part that holds one top-level declaration, and the names it declares. Recorded before the
/// visit, because the visit adds generated names to the part (`var _s = $RefreshSig$()`).
pub(crate) struct DeclarationPart {
    part: u32,
    names: Vec<Ref>,
}

fn collect_names(binding: js_ast::Binding, names: &mut Vec<Ref>) {
    match binding.data {
        BindingData::BIdentifier(id) => names.push(id.r#ref),
        BindingData::BArray(array) => {
            for item in array.items() {
                collect_names(item.binding, names);
            }
        }
        BindingData::BObject(object) => {
            for property in object.properties() {
                collect_names(property.value, names);
            }
        }
        BindingData::BMissing(_) => {}
    }
}

/// The names a top-level statement declares, if it can go when they are unused.
fn removable_names(stmt: js_ast::Stmt) -> Option<Vec<Ref>> {
    let mut names = Vec::new();
    match stmt.data {
        js_ast::StmtData::SLocal(local) if !local.is_export && !local.kind.is_using() => {
            for decl in local.decls.slice() {
                collect_names(decl.binding, &mut names);
            }
        }
        js_ast::StmtData::SFunction(function)
            if !function.func.flags.contains(flags::Function::IsExport) =>
        {
            names.push(function.func.name?.ref_);
        }
        js_ast::StmtData::SClass(class) if !class.is_export => {
            names.push(class.class.class_name?.ref_);
        }
        _ => return None,
    }
    Some(names)
}

/// Takes the names `is_dead` accepts out of a pattern, and returns whether none are left. The
/// initializer still runs, so array elements keep their positions, and an object with a live
/// `...rest` keeps its properties, which `rest` must not receive.
fn strip_dead_names(binding: js_ast::Binding, is_dead: &impl Fn(Ref) -> bool) -> bool {
    match binding.data {
        BindingData::BIdentifier(id) => is_dead(id.r#ref),
        BindingData::BMissing(_) => true,
        BindingData::BArray(mut array) => {
            for item in array.items_mut() {
                if strip_dead_names(item.binding, is_dead) {
                    item.binding.data = BindingData::BMissing(js_ast::b::Missing {});
                    item.default_value = None;
                }
            }
            let mut end = array.items().len();
            while end > 0
                && matches!(
                    array.items()[end - 1].binding.data,
                    BindingData::BMissing(_)
                )
            {
                end -= 1;
            }
            if end != array.items().len() {
                array.items.truncate(end);
                array.has_spread = false;
            }
            end == 0
        }
        BindingData::BObject(mut object) => {
            let live_rest = object.properties().iter().any(|property| {
                let mut names = Vec::new();
                collect_names(property.value, &mut names);
                property.flags.contains(flags::Property::IsSpread)
                    && !names.into_iter().all(is_dead)
            });
            if live_rest {
                return false;
            }
            let properties = object.properties_mut();
            let mut end = 0;
            for i in 0..properties.len() {
                let dead = strip_dead_names(properties[i].value, is_dead);
                if !dead || properties[i].flags.contains(flags::Property::IsComputed) {
                    properties.swap(end, i);
                    end += 1;
                }
            }
            object.properties.truncate(end);
            end == 0
        }
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// `append_part` for one top-level statement, noting what it declares.
    pub(crate) fn append_statement_part(
        &mut self,
        parts: &mut bun_alloc::ArenaVec<'a, js_ast::Part>,
        stmt: js_ast::Stmt,
        tracks_declarations: bool,
    ) -> Result<(), crate::Error> {
        let names = if tracks_declarations {
            removable_names(stmt)
        } else {
            None
        };
        let part = parts.len();
        let stmts = self.arena.alloc_slice_copy(&[stmt]);
        self.append_part(parts, stmts)?;
        if parts.len() > part
            && let Some(names) = names
        {
            self.declaration_parts.push(DeclarationPart {
                part: part as u32,
                names,
            });
        }
        Ok(())
    }

    pub(crate) fn note_used_by_deleted_export(&mut self, ref_: Ref) {
        if !self.used_by_deleted_exports.contains(&ref_.inner_index()) {
            self.used_by_deleted_exports.push(ref_.inner_index());
        }
    }

    fn symbol_index(&self, ref_: Ref) -> usize {
        self.linked_symbol_index(ref_.inner_index() as usize)
    }

    fn linked_symbol_index(&self, mut index: usize) -> usize {
        while self.symbols[index].has_link() {
            index = self.symbols[index].link.get().inner_index() as usize;
        }
        index
    }

    /// Runs after the visit, before the import scan. The scan then drops the imports that removed
    /// code used, since their use counts reach zero here and `used_by_deleted_exports` names them.
    pub(crate) fn remove_server_only_code(
        &mut self,
        parts: &mut bun_alloc::ArenaVec<'a, js_ast::Part>,
    ) {
        // Direct eval can read any top-level name.
        if self.module_scope().contains_direct_eval {
            return;
        }

        let declarations = core::mem::take(&mut self.declaration_parts);
        let mut parts_declaring: HashMap<usize, Vec<u32>> = HashMap::default();
        for declaration in &declarations {
            for &name in &declaration.names {
                let symbol = self.symbol_index(name);
                let entry = bun_core::handle_oom(parts_declaring.get_or_put(symbol));
                if !entry.found_existing {
                    *entry.value_ptr = Vec::new();
                }
                entry.value_ptr.push(declaration.part);
            }
        }

        let mut used_by_removed = vec![false; self.symbols.len()];
        for &symbol in &self.used_by_deleted_exports {
            used_by_removed[self.linked_symbol_index(symbol as usize)] = true;
        }

        // Everything the deleted exports could reach through the declarations they use.
        let mut pending: Vec<usize> = (0..used_by_removed.len())
            .filter(|&symbol| used_by_removed[symbol])
            .collect();
        while let Some(symbol) = pending.pop() {
            for &part in parts_declaring.get(&symbol).into_iter().flatten() {
                for &used in parts[part as usize].symbol_uses.keys() {
                    let used = self.symbol_index(used);
                    if !core::mem::replace(&mut used_by_removed[used], true) {
                        pending.push(used);
                    }
                }
            }
        }

        // A declaration of only those names goes, unless something that stays reaches it.
        // Reachability, not use counts, so that functions calling each other can go together.
        let mut part_is_live = vec![true; parts.len()];
        for declaration in &declarations {
            if !declaration.names.is_empty()
                && declaration
                    .names
                    .iter()
                    .all(|&name| used_by_removed[self.symbol_index(name)])
            {
                part_is_live[declaration.part as usize] = false;
            }
        }
        let mut symbol_is_live = vec![false; self.symbols.len()];
        let mut pending: Vec<u32> = (0..parts.len() as u32)
            .filter(|&part| part_is_live[part as usize])
            .collect();
        while let Some(part) = pending.pop() {
            for &used in parts[part as usize].symbol_uses.keys() {
                let symbol = self.symbol_index(used);
                if core::mem::replace(&mut symbol_is_live[symbol], true) {
                    continue;
                }
                for &declaring in parts_declaring.get(&symbol).into_iter().flatten() {
                    if !core::mem::replace(&mut part_is_live[declaring as usize], true) {
                        pending.push(declaring);
                    }
                }
            }
        }

        for (i, part) in parts.iter().enumerate() {
            if part_is_live[i] {
                continue;
            }
            self.clear_symbol_usages_from_dead_part(part);
            // `require()` and `import()` calls in the removed code.
            for &record in part.import_record_indices.slice() {
                self.import_records.items_mut()[record as usize]
                    .flags
                    .insert(ImportRecordFlags::IS_UNUSED);
            }
        }

        let is_dead = |ref_: Ref| {
            let symbol = self.symbol_index(ref_);
            used_by_removed[symbol] && !symbol_is_live[symbol]
        };
        for declaration in &declarations {
            let part = &parts[declaration.part as usize];
            if !part_is_live[declaration.part as usize] {
                continue;
            }
            for stmt in part.stmts.iter() {
                let js_ast::StmtData::SLocal(local) = stmt.data else {
                    continue;
                };
                for decl in local.decls.slice() {
                    if !matches!(decl.binding.data, BindingData::BIdentifier(_)) {
                        strip_dead_names(decl.binding, &is_dead);
                    }
                }
            }
        }

        let mut part_index = 0;
        parts.retain(|_| {
            part_index += 1;
            part_is_live[part_index - 1]
        });

        // `ns.a` while bundling is a use of the generated symbol for `a`, not of `ns`, so the
        // namespace stays until its removed items are gone.
        let mut used_namespaces = Vec::new();
        let symbols = &self.symbols;
        for (namespace, items) in self.import_items_for_namespace.iter_mut() {
            let before = items.count();
            items.retain(|_, item| {
                !item.ref_.is_valid()
                    || symbols[item.ref_.inner_index() as usize].use_count_estimate != 0
                    || !used_by_removed[item.ref_.inner_index() as usize]
            });
            if items.count() != before {
                used_namespaces.push(namespace.inner_index());
            }
        }
        for namespace in used_namespaces {
            used_by_removed[namespace as usize] = true;
        }

        self.used_by_deleted_exports = used_by_removed
            .iter()
            .enumerate()
            .filter(|(_, used)| **used)
            .map(|(symbol, _)| symbol as u32)
            .collect();
    }
}
