//! Removes what only the deleted exports of a page needed from its browser copy.
//!
//! `features.remove_server_only_code` gives every top-level statement its own part, so each part's
//! `symbol_uses` says what that statement needs. A variable, function or class goes when removed
//! code used every name it declares and nothing that stays can reach it, even if creating it has
//! side effects. A binding that nothing used stays, as Next.js's SSG transform keeps it.

use bun_ast::{self as js_ast, ImportRecordFlags, Loc, Ref, flags};
use bun_collections::{HashMap, VecExt};

use crate::ImportItemForNamespaceMap;
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

/// Takes the names `is_dead` accepts out of a pattern, and returns whether it lost all it had. The
/// initializer still runs, so array elements keep their positions, a hole of the source stays, and
/// an object with a live `...rest` keeps its properties, which `rest` must not receive. `dropped`
/// gets the binding of each default value that goes.
fn strip_dead_names(
    binding: js_ast::Binding,
    is_dead: &dyn Fn(Ref) -> bool,
    dropped: &mut Vec<Loc>,
) -> bool {
    match binding.data {
        BindingData::BIdentifier(id) => is_dead(id.r#ref),
        BindingData::BMissing(_) => false,
        BindingData::BArray(mut array) => {
            let len = array.items().len();
            let mut end = 0;
            for (i, item) in array.items_mut().iter_mut().enumerate() {
                if strip_dead_names(item.binding, is_dead, dropped) {
                    if item.default_value.take().is_some() {
                        dropped.push(item.binding.loc);
                    }
                    item.binding.data = BindingData::BMissing(js_ast::b::Missing {});
                } else {
                    end = i + 1;
                }
            }
            if end != len {
                array.items.truncate(end);
                array.has_spread = false;
            }
            len != 0 && end == 0
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
            let len = properties.len();
            let mut end = 0;
            for i in 0..len {
                let dead = strip_dead_names(properties[i].value, is_dead, dropped);
                if !dead || properties[i].flags.contains(flags::Property::IsComputed) {
                    properties.swap(end, i);
                    end += 1;
                } else if properties[i].default_value.is_some() {
                    dropped.push(properties[i].value.loc);
                }
            }
            object.properties.truncate(end);
            len != 0 && end == 0
        }
    }
}

/// The names a statement declares and exports.
fn exported_declarations(stmt: js_ast::Stmt, names: &mut Vec<Ref>) {
    match stmt.data {
        js_ast::StmtData::SLocal(local) if local.is_export => {
            for decl in local.decls.slice() {
                if let BindingData::BIdentifier(id) = decl.binding.data {
                    names.push(id.r#ref);
                }
            }
        }
        js_ast::StmtData::SFunction(function)
            if function.func.flags.contains(flags::Function::IsExport) =>
        {
            names.extend(function.func.name.map(|name| name.ref_));
        }
        js_ast::StmtData::SClass(class) if class.is_export => {
            names.extend(class.class.class_name.map(|name| name.ref_));
        }
        _ => {}
    }
}

/// `X.prop` while bundling is a property use of `X`, which `symbol_uses` does not count.
fn release_property_uses(symbols: &mut [js_ast::Symbol], exports_ref: Ref, part: &js_ast::Part) {
    let Some(uses) = part.import_symbol_property_uses.as_ref() else {
        return;
    };
    for (base, properties) in uses.keys().iter().zip(uses.values()) {
        // Calls of `exports.name()`, recorded here without a use of `exports`.
        if *base == exports_ref {
            continue;
        }
        let symbol = &mut symbols[base.inner_index() as usize];
        for property in properties.values() {
            symbol.use_count_estimate = symbol
                .use_count_estimate
                .saturating_sub(property.count_estimate);
        }
    }
}

/// `ns.a` while bundling is a use of the generated symbol for `a`, not of `ns`, so the namespace
/// stays until its removed items are gone.
fn release_namespace_items(
    namespaces: &mut HashMap<Ref, ImportItemForNamespaceMap>,
    symbols: &[js_ast::Symbol],
    used_by_removed: &mut [bool],
) {
    for (namespace, items) in namespaces.iter_mut() {
        let before = items.count();
        items.retain(|_, item| {
            !item.ref_.is_valid()
                || symbols[item.ref_.inner_index() as usize].use_count_estimate != 0
                || !used_by_removed[item.ref_.inner_index() as usize]
        });
        if items.count() != before {
            used_by_removed[namespace.inner_index() as usize] = true;
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

    /// `export function f` goes by its name, but `export { f as other }` needs `f`, so `f` stays.
    pub(crate) fn keep_exports_with_kept_aliases(&mut self, stmts: &[js_ast::Stmt]) {
        let mut declared = Vec::new();
        for &stmt in stmts {
            exported_declarations(stmt, &mut declared);
        }
        for stmt in stmts {
            let js_ast::StmtData::SExportClause(clause) = stmt.data else {
                continue;
            };
            for item in clause.items.slice() {
                let name = self.load_name_from_ref(item.name.ref_);
                let replace_exports = &self.options.features.replace_exports;
                if !replace_exports.contains(item.alias.slice())
                    && replace_exports.contains(name)
                    && declared.iter().any(|&r| self.load_name_from_ref(r) == name)
                {
                    self.options.features.replace_exports.swap_remove(name);
                }
            }
        }
    }

    /// Records the `require()` and `import()` calls in the default value of `binding`, which
    /// visiting it just added.
    pub(crate) fn note_default_value_records(&mut self, binding: Loc, records_before: usize) {
        if self.options.features.remove_server_only_code {
            for &record in &self.import_records_for_current_part.as_slice()[records_before..] {
                self.default_value_records.push((binding, record));
            }
        }
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
            release_property_uses(self.symbols.as_mut_slice(), self.exports_ref, part);
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
        let mut dropped_defaults = Vec::new();
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
                        strip_dead_names(decl.binding, &is_dead, &mut dropped_defaults);
                    }
                }
            }
        }
        for (binding, record) in core::mem::take(&mut self.default_value_records) {
            if dropped_defaults.contains(&binding) {
                self.import_records.items_mut()[record as usize]
                    .flags
                    .insert(ImportRecordFlags::IS_UNUSED);
            }
        }

        let mut part_index = 0;
        parts.retain(|_| {
            part_index += 1;
            part_is_live[part_index - 1]
        });

        release_namespace_items(
            &mut self.import_items_for_namespace,
            self.symbols.as_slice(),
            &mut used_by_removed,
        );

        self.used_by_deleted_exports = used_by_removed
            .iter()
            .enumerate()
            .filter(|(_, used)| **used)
            .map(|(symbol, _)| symbol as u32)
            .collect();
    }
}
