// checker/symbolaccessibility.go: whether and how a symbol can be named from a location.
use crate::ast::{
    Ast, INTERNAL_SYMBOL_NAME_DEFAULT, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS, Kind, NodeId,
    SymbolFlags, SymbolId, SymbolTableId, find_ancestor, get_declaration_of_kind,
    get_reparsed_node_for_node, get_source_file_of_node, get_symbol_id, is_access_expression,
    is_ambient_module, is_binary_expression, is_class_expression, is_entity_name_expression,
    is_exports_identifier, is_external_module, is_external_module_import_equals_declaration,
    is_external_or_common_js_module, is_global_source_file, is_in_js_file, is_module_block,
    is_module_exports_access_expression, is_module_with_string_literal_name, is_namespace_export,
    is_namespace_export_declaration, is_object_literal_expression, is_source_file,
    is_type_literal_node, is_variable_declaration, node_is_synthesized,
};
use crate::checker::{
    AccessibleChainCacheKey, Checker, EmitResolver, SymbolFormatFlags, TypeFlags, can_have_locals,
    get_declarations_of_kind,
};
use crate::printer::{SymbolAccessibility, SymbolAccessibilityResult};
use bun_collections::HashMap;

impl<'a> Checker<'a> {
    pub fn is_type_symbol_accessible(
        &mut self,
        type_symbol: SymbolId,
        enclosing_declaration: NodeId,
    ) -> bool {
        let access = self.is_symbol_accessible_worker(
            type_symbol,
            enclosing_declaration,
            SymbolFlags::TYPE,
            false,
            true,
        );
        access.accessibility == SymbolAccessibility::Accessible
    }

    pub fn is_value_symbol_accessible(
        &mut self,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
    ) -> bool {
        let access = self.is_symbol_accessible_worker(
            symbol,
            enclosing_declaration,
            SymbolFlags::VALUE,
            false,
            true,
        );
        access.accessibility == SymbolAccessibility::Accessible
    }

    pub fn is_symbol_accessible_by_flags(
        &mut self,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        flags: SymbolFlags,
    ) -> bool {
        // Upstream asks whether `allowModules: false` is a Strada bug.
        let access =
            self.is_symbol_accessible_worker(symbol, enclosing_declaration, flags, false, false);
        access.accessibility == SymbolAccessibility::Accessible
    }

    pub fn is_any_symbol_accessible(
        &mut self,
        symbols: &[SymbolId],
        enclosing_declaration: NodeId,
        initial_symbol: SymbolId,
        meaning: SymbolFlags,
        should_compute_aliases_to_make_visible: bool,
        allow_modules: bool,
    ) -> Option<SymbolAccessibilityResult> {
        if symbols.is_empty() {
            return None;
        }
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return None;
        }
        let a = self.ast;

        let mut had_accessible_chain = SymbolId::NIL;
        let mut early_module_bail = false;
        for symbol in symbols.iter().copied() {
            // Symbol is accessible if it by itself is accessible
            let accessible_symbol_chain =
                self.get_accessible_symbol_chain(symbol, enclosing_declaration, meaning, false);
            if let Some(&first) = accessible_symbol_chain.first() {
                had_accessible_chain = symbol;
                let has_accessible_declarations = EmitResolver.has_visible_declarations(
                    self,
                    first,
                    should_compute_aliases_to_make_visible,
                );
                if has_accessible_declarations.is_some() {
                    return has_accessible_declarations;
                }
            }
            if allow_modules
                && a.sym(symbol)
                    .declarations
                    .as_slice()
                    .iter()
                    .any(|d| has_non_global_augmentation_external_module_symbol(a, *d))
            {
                if should_compute_aliases_to_make_visible {
                    early_module_bail = true;
                    // Generally speaking, we want to use the aliases that already exist to refer to a module, if present: in order to discover those aliases, we need to check all the parents.
                    continue;
                }
                // Any meaning of a module symbol is always accessible via an `import` type
                return Some(SymbolAccessibilityResult {
                    accessibility: SymbolAccessibility::Accessible,
                    ..SymbolAccessibilityResult::default()
                });
            }

            // If we haven't got the accessible symbol, it doesn't mean the symbol is actually inaccessible: it could be a qualified symbol whose first name is not accessible, so its container is checked with the meaning of a qualifier.
            let containers = self.get_containers_of_symbol(symbol, enclosing_declaration, meaning);
            let mut next_meaning = meaning;
            if initial_symbol == symbol {
                next_meaning = get_qualified_left_meaning(meaning);
            }
            let parent_result = self.is_any_symbol_accessible(
                &containers,
                enclosing_declaration,
                initial_symbol,
                next_meaning,
                should_compute_aliases_to_make_visible,
                allow_modules,
            );
            if parent_result.is_some() {
                return parent_result;
            }
        }

        if early_module_bail {
            return Some(SymbolAccessibilityResult {
                accessibility: SymbolAccessibility::Accessible,
                ..SymbolAccessibilityResult::default()
            });
        }

        if !had_accessible_chain.is_nil() {
            let mut module_name = Vec::new();
            if had_accessible_chain != initial_symbol {
                module_name = self.symbol_to_string_ex(
                    had_accessible_chain,
                    enclosing_declaration,
                    SymbolFlags::NAMESPACE,
                    SymbolFormatFlags::ALLOW_ANY_NODE_KIND,
                );
            }
            return Some(SymbolAccessibilityResult {
                accessibility: SymbolAccessibility::NotAccessible,
                error_symbol_name: self.symbol_to_string_ex(
                    initial_symbol,
                    enclosing_declaration,
                    meaning,
                    SymbolFormatFlags::ALLOW_ANY_NODE_KIND,
                ),
                error_module_name: module_name,
                ..SymbolAccessibilityResult::default()
            });
        }
        None
    }
}

pub(crate) fn has_non_global_augmentation_external_module_symbol(
    a: Ast<'_>,
    declaration: NodeId,
) -> bool {
    is_module_with_string_literal_name(a, declaration)
        || (a.kind(declaration) == Kind::SourceFile
            && is_external_or_common_js_module(a, declaration))
}

pub(crate) fn get_qualified_left_meaning(right_meaning: SymbolFlags) -> SymbolFlags {
    // If we are looking in value space, the parent meaning is value, other wise it is namespace
    if right_meaning == SymbolFlags::VALUE {
        return SymbolFlags::VALUE;
    }
    SymbolFlags::NAMESPACE
}

impl<'a> Checker<'a> {
    pub(crate) fn get_with_alternative_containers(
        &mut self,
        container: SymbolId,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
    ) -> Vec<SymbolId> {
        let a = self.ast;
        let mut additional_containers: Vec<SymbolId> = Vec::new();
        for d in a.sym(container).declarations.as_slice() {
            let file_symbol =
                self.get_file_symbol_if_file_symbol_export_equals_container(*d, container);
            if !file_symbol.is_nil() {
                additional_containers.push(file_symbol);
            }
        }
        let mut reexport_containers: Vec<SymbolId> = Vec::new();
        if !enclosing_declaration.is_nil() {
            reexport_containers =
                self.get_alternative_containing_modules(symbol, enclosing_declaration);
        }
        let object_literal_container =
            self.get_variable_declaration_of_object_literal(container, meaning);
        let left_meaning = get_qualified_left_meaning(meaning);
        let container_flags = a.sym(container).flags;
        if !enclosing_declaration.is_nil()
            && container_flags.intersects(left_meaning)
            && !self
                .get_accessible_symbol_chain(
                    container,
                    enclosing_declaration,
                    SymbolFlags::NAMESPACE,
                    false,
                )
                .is_empty()
        {
            // This order expresses a preference for the real container if it is in scope
            let mut res = vec![container];
            res.extend_from_slice(&additional_containers);
            res.extend_from_slice(&reexport_containers);
            if !object_literal_container.is_nil() {
                res.push(object_literal_container);
            }
            return res;
        }
        // we potentially have a symbol which is a member of the instance side of something - look for a variable in scope with the container's type which may be used to indirectly access the symbol
        let mut variable_matches: Vec<SymbolId> = Vec::new();
        if meaning == SymbolFlags::VALUE
            && !container_flags.intersects(left_meaning)
            && container_flags.intersects(SymbolFlags::TYPE)
        {
            let declared_type = self.get_declared_type_of_symbol(container);
            if self.types[declared_type]
                .flags
                .intersects(TypeFlags::OBJECT)
            {
                self.some_symbol_table_in_scope(enclosing_declaration, &mut |c, t, _, _, _, _| {
                    let mut found = false;
                    for entry in 0..a.table_len(t) {
                        let (_, s) = a.table_entry_at(t, entry);
                        if a.sym(s).flags.intersects(left_meaning)
                            && c.get_type_of_symbol(s) == c.get_declared_type_of_symbol(container)
                        {
                            variable_matches.push(s);
                            found = true;
                        }
                    }
                    found
                });
                self.sort_symbols(&mut variable_matches);
            }
        }
        let mut res: Vec<SymbolId> = Vec::new();
        res.extend_from_slice(&variable_matches);
        res.extend_from_slice(&additional_containers);
        res.push(container);
        if !object_literal_container.is_nil() {
            res.push(object_literal_container);
        }
        res.extend_from_slice(&reexport_containers);
        res
    }

    pub(crate) fn get_alternative_containing_modules(
        &mut self,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
    ) -> Vec<SymbolId> {
        if enclosing_declaration.is_nil() {
            return Vec::new();
        }
        let a = self.ast;
        let containing_file = get_source_file_of_node(a, enclosing_declaration);
        let id = containing_file;
        let links = self.symbol_container_links.get(symbol);
        if let Some(existing) = self.symbol_container_links[links]
            .extended_containers_by_file
            .get(&id)
        {
            if !existing.is_empty() {
                return existing.clone();
            }
        }
        let mut results: Vec<SymbolId> = Vec::new();
        let imports = a.as_source_file(containing_file).imports();
        if !imports.is_empty() {
            // Try to make an import using an import already in the enclosing file, if possible
            for import_ref in imports.iter().copied() {
                // Synthetic names can't be resolved by `resolveExternalModuleName` - they'll cause a debug assert if they error
                if node_is_synthesized(a, import_ref) {
                    continue;
                }
                let resolved_module =
                    self.resolve_external_module_name(enclosing_declaration, import_ref, true);
                if resolved_module.is_nil() {
                    continue;
                }
                let ref_ = self.get_alias_for_symbol_in_container(resolved_module, symbol);
                if ref_.is_nil() {
                    continue;
                }
                results.push(resolved_module);
            }
            if !results.is_empty() {
                self.symbol_container_links[links]
                    .extended_containers_by_file
                    .insert(id, results.clone());
                return results;
            }
        }

        if let Some(extended_containers) = &self.symbol_container_links[links].extended_containers {
            return extended_containers.clone();
        }
        // No results from files already being imported by this file - expand search (expensive, but not location-specific, so cached)
        let other_files: Vec<NodeId> = self.program.source_files().to_vec();
        for file in other_files {
            if !is_external_module(a, file) {
                continue;
            }
            let sym = self.get_symbol_of_declaration(file);
            let ref_ = self.get_alias_for_symbol_in_container(sym, symbol);
            if ref_.is_nil() {
                continue;
            }
            results.push(sym);
        }
        self.symbol_container_links[links].extended_containers = Some(results.clone());
        results
    }

    pub(crate) fn get_variable_declaration_of_object_literal(
        &mut self,
        symbol: SymbolId,
        meaning: SymbolFlags,
    ) -> SymbolId {
        // If we're trying to reference some object literal in, eg `var a = { x: 1 }`, the symbol for the literal, `__object`, is distinct from the symbol of the declaration it is being assigned to: we should use the variable's symbol instead.
        if !meaning.intersects(SymbolFlags::VALUE) {
            return SymbolId::NIL;
        }
        let a = self.ast;
        let Some(&first_decl) = a.sym(symbol).declarations.as_slice().first() else {
            return SymbolId::NIL;
        };
        let parent = a.parent(first_decl);
        if parent.is_nil() {
            return SymbolId::NIL;
        }
        if !is_variable_declaration(a, parent) {
            return SymbolId::NIL;
        }
        if is_object_literal_expression(a, first_decl) && first_decl == a.initializer(parent)
            || is_type_literal_node(a, first_decl) && first_decl == a.type_node(parent)
        {
            return self.get_symbol_of_declaration(parent);
        }
        SymbolId::NIL
    }
}

pub(crate) fn has_external_module_symbol(a: Ast<'_>, declaration: NodeId) -> bool {
    is_ambient_module(a, declaration)
        || (a.kind(declaration) == Kind::SourceFile
            && is_external_or_common_js_module(a, declaration))
}

impl<'a> Checker<'a> {
    pub(crate) fn get_external_module_container(&mut self, declaration: NodeId) -> SymbolId {
        let a = self.ast;
        let node = find_ancestor(a, declaration, |n| has_external_module_symbol(a, n));
        if node.is_nil() {
            return SymbolId::NIL;
        }
        self.get_symbol_of_declaration(node)
    }

    pub(crate) fn get_file_symbol_if_file_symbol_export_equals_container(
        &mut self,
        d: NodeId,
        container: SymbolId,
    ) -> SymbolId {
        let a = self.ast;
        let file_symbol = self.get_external_module_container(d);
        if file_symbol.is_nil() || a.sym(file_symbol).exports.is_nil() {
            return SymbolId::NIL;
        }
        let exported = a.table_get(
            a.sym(file_symbol).exports,
            INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
        );
        if exported.is_nil() {
            return SymbolId::NIL;
        }
        if !self
            .get_symbol_if_same_reference(exported, container)
            .is_nil()
        {
            return file_symbol;
        }
        SymbolId::NIL
    }

    // Attempts to find the symbol corresponding to the container a symbol is in: usually its `.parent`, but for locals this value is nil.
    pub(crate) fn get_containers_of_symbol(
        &mut self,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
    ) -> Vec<SymbolId> {
        let a = self.ast;
        let container = self.get_parent_of_symbol(symbol);
        // Type parameters end up in the `members` lists but are not externally visible
        if !container.is_nil() && !a.sym(symbol).flags.intersects(SymbolFlags::TYPE_PARAMETER) {
            return self.get_with_alternative_containers(
                container,
                symbol,
                enclosing_declaration,
                meaning,
            );
        }
        let mut candidates: Vec<SymbolId> = Vec::new();
        let mut add_candidate = |candidates: &mut Vec<SymbolId>, sym: SymbolId| {
            if !sym.is_nil() && !candidates.contains(&sym) {
                candidates.push(sym);
            }
        };
        for d in a.sym(symbol).declarations.as_slice().iter().copied() {
            let parent = a.parent(d);
            if !is_ambient_module(a, d) && !parent.is_nil() {
                // direct children of a module
                if has_non_global_augmentation_external_module_symbol(a, parent) {
                    let sym = self.get_symbol_of_declaration(parent);
                    add_candidate(&mut candidates, sym);
                    continue;
                }
                // export ='d member of an ambient module
                let grandparent = a.parent(parent);
                if is_module_block(a, parent) && !grandparent.is_nil() {
                    let module_symbol = self.get_symbol_of_declaration(grandparent);
                    if self.resolve_external_module_symbol(module_symbol, false) == symbol {
                        let sym = self.get_symbol_of_declaration(grandparent);
                        add_candidate(&mut candidates, sym);
                        continue;
                    }
                }
            }
            if is_class_expression(a, d) && is_binary_expression(a, parent) {
                let binary = a.as_binary_expression(parent);
                if a.kind(binary.operator_token) == Kind::EqualsToken
                    && is_access_expression(a, binary.left)
                    && is_entity_name_expression(a, a.expression(binary.left))
                {
                    if is_module_exports_access_expression(a, binary.left)
                        || is_exports_identifier(a, a.expression(binary.left))
                    {
                        let sym = self.get_symbol_of_declaration(get_source_file_of_node(a, d));
                        add_candidate(&mut candidates, sym);
                        continue;
                    }
                    self.check_expression_cached(a.expression(binary.left));
                    let links = self.symbol_node_links.get(a.expression(binary.left));
                    let sym = self.symbol_node_links[links].resolved_symbol;
                    add_candidate(&mut candidates, sym);
                    continue;
                }
            }
        }
        if candidates.is_empty() {
            return Vec::new();
        }

        let mut best_containers: Vec<SymbolId> = Vec::new();
        let mut alternative_containers: Vec<SymbolId> = Vec::new();
        for container in candidates {
            if self
                .get_alias_for_symbol_in_container(container, symbol)
                .is_nil()
            {
                continue;
            }
            let all_alts = self.get_with_alternative_containers(
                container,
                symbol,
                enclosing_declaration,
                meaning,
            );
            let Some((best, rest)) = all_alts.split_first() else {
                continue;
            };
            best_containers.push(*best);
            alternative_containers.extend_from_slice(rest);
        }
        best_containers.extend_from_slice(&alternative_containers);
        best_containers
    }

    pub(crate) fn get_alias_for_symbol_in_container(
        &mut self,
        container: SymbolId,
        symbol: SymbolId,
    ) -> SymbolId {
        let a = self.ast;
        if container == self.get_parent_of_symbol(symbol) {
            // fast path, `symbol` is either already the alias or isn't aliased
            return symbol;
        }
        // Check if container is a thing with an `export=` which points directly at `symbol`, and if so, return the container itself as the alias for the symbol
        let container_exports = a.sym(container).exports;
        if !container_exports.is_nil() {
            let export_equals = a.table_get(container_exports, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS);
            if !export_equals.is_nil()
                && !self
                    .get_symbol_if_same_reference(export_equals, symbol)
                    .is_nil()
            {
                return container;
            }
        }
        let exports = self.get_exports_of_symbol(container);
        if exports.is_nil() {
            return SymbolId::NIL;
        }
        let quick = a.table_get(exports, a.sym(symbol).name);
        if !quick.is_nil() && !self.get_symbol_if_same_reference(quick, symbol).is_nil() {
            return quick;
        }
        let mut candidates: Vec<SymbolId> = Vec::new();
        for entry in 0..a.table_len(exports) {
            let (_, exported) = a.table_entry_at(exports, entry);
            if !self.get_symbol_if_same_reference(exported, symbol).is_nil() {
                candidates.push(exported);
            }
        }
        if !candidates.is_empty() {
            // _must_ sort exports for stable results - symbol table is randomly iterated
            self.sort_symbols(&mut candidates);
            return candidates.first().copied().unwrap_or(SymbolId::NIL);
        }
        SymbolId::NIL
    }

    pub(crate) fn get_accessible_symbol_chain(
        &mut self,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
        use_only_external_aliasing: bool,
    ) -> Vec<SymbolId> {
        let mut visited_symbol_tables_map: VisitedSymbolTablesMap = HashMap::default();
        self.get_accessible_symbol_chain_ex(
            AccessibleSymbolChainContext {
                symbol,
                enclosing_declaration,
                meaning,
                use_only_external_aliasing,
            },
            &mut visited_symbol_tables_map,
        )
    }
}

// `visitedSymbolTablesMap` is shared by the contexts of one lookup: it travels beside the context.
type VisitedSymbolTablesMap = HashMap<u64, HashMap<SymbolTableID, ()>>;

#[derive(Clone, Copy)]
pub(crate) struct AccessibleSymbolChainContext {
    symbol: SymbolId,
    enclosing_declaration: NodeId,
    meaning: SymbolFlags,
    use_only_external_aliasing: bool,
}

// symbolTableID is a stable identifier for a symbol table: the upper 3 bits are the kind, the lower 61 bits the node or symbol id.
pub type SymbolTableID = u64;

const ST_KIND_SHIFT: u32 = 61;
const ST_KIND_LOCALS: SymbolTableID = 0 << ST_KIND_SHIFT;
const ST_KIND_EXPORTS: SymbolTableID = 1 << ST_KIND_SHIFT;
const ST_KIND_MEMBERS: SymbolTableID = 2 << ST_KIND_SHIFT;
const ST_KIND_GLOBALS: SymbolTableID = 3 << ST_KIND_SHIFT;
// resolved/derived exports from getExportsOfSymbol, distinct from raw sym.Exports
const ST_KIND_RESOLVED_EXPORTS: SymbolTableID = 4 << ST_KIND_SHIFT;
// `(iota - 1) << stKindShift` upstream, where iota is 5.
const ST_KIND_MASK: SymbolTableID = 4 << ST_KIND_SHIFT;

fn symbol_table_id_from_locals(node: NodeId) -> SymbolTableID {
    ST_KIND_LOCALS | SymbolTableID::from(node.0)
}

fn symbol_table_id_from_exports(a: Ast<'_>, sym: SymbolId) -> SymbolTableID {
    ST_KIND_EXPORTS | get_symbol_id(a, sym)
}

fn symbol_table_id_from_resolved_exports(a: Ast<'_>, sym: SymbolId) -> SymbolTableID {
    ST_KIND_RESOLVED_EXPORTS | get_symbol_id(a, sym)
}

fn symbol_table_id_from_members(a: Ast<'_>, sym: SymbolId) -> SymbolTableID {
    ST_KIND_MEMBERS | get_symbol_id(a, sym)
}

fn symbol_table_id_from_globals() -> SymbolTableID {
    ST_KIND_GLOBALS
}

impl<'a> Checker<'a> {
    fn get_accessible_symbol_chain_ex(
        &mut self,
        ctx: AccessibleSymbolChainContext,
        visited: &mut VisitedSymbolTablesMap,
    ) -> Vec<SymbolId> {
        if ctx.symbol.is_nil() {
            return Vec::new();
        }
        if is_property_or_method_declaration_symbol(self.ast, ctx.symbol) {
            return Vec::new();
        }
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return Vec::new();
        }
        // Go from enclosingDeclaration to the first scope we check, so the cache is keyed off the "nearest scope" rather than whatever node we were originally handed.
        let mut first_relevant_location = NodeId::NIL;
        self.some_symbol_table_in_scope(ctx.enclosing_declaration, &mut |_, _, _, _, _, node| {
            first_relevant_location = node;
            true
        });
        let links = self.symbol_container_links.get(ctx.symbol);
        let link_key = AccessibleChainCacheKey {
            use_only_external_aliasing: ctx.use_only_external_aliasing,
            first_relevant_location,
            meaning: ctx.meaning,
        };
        if let Some(existing) = self.symbol_container_links[links]
            .accessible_chain_cache
            .get(&link_key)
        {
            return existing.clone();
        }

        let mut result: Vec<SymbolId> = Vec::new();
        self.some_symbol_table_in_scope(
            ctx.enclosing_declaration,
            &mut |c, t, table_id, ignore_qualification, is_local_name_lookup, _| {
                let res = c.get_accessible_symbol_chain_from_symbol_table(
                    ctx,
                    &mut *visited,
                    t,
                    table_id,
                    ignore_qualification,
                    is_local_name_lookup,
                );
                if !res.is_empty() {
                    result = res;
                    return true;
                }
                false
            },
        );
        self.symbol_container_links[links]
            .accessible_chain_cache
            .insert(link_key, result.clone());
        result
    }

    // `ignore_qualification` is set when a symbol is being looked for through the exports of another symbol (meaning we have a route to qualify it already)
    fn get_accessible_symbol_chain_from_symbol_table(
        &mut self,
        ctx: AccessibleSymbolChainContext,
        visited: &mut VisitedSymbolTablesMap,
        t: SymbolTableId,
        table_id: SymbolTableID,
        ignore_qualification: bool,
        is_local_name_lookup: bool,
    ) -> Vec<SymbolId> {
        let sym_id = get_symbol_id(self.ast, ctx.symbol);
        let visited_symbol_tables = visited.entry(sym_id).or_default();
        if visited_symbol_tables.contains_key(&table_id) {
            return Vec::new();
        }
        visited_symbol_tables.insert(table_id, ());

        let res = self.try_symbol_table(
            ctx,
            visited,
            t,
            table_id,
            ignore_qualification,
            is_local_name_lookup,
        );

        if let Some(visited_symbol_tables) = visited.get_mut(&sym_id) {
            visited_symbol_tables.remove(&table_id);
        }
        res
    }

    // getSymbolTableAliases returns the alias symbols from a symbol table. Stable tables (globals, exports, resolved exports) are cached; locals may be mutated by fake scopes and members are rebuilt each call.
    fn get_symbol_table_aliases(
        &mut self,
        symbols: SymbolTableId,
        table_id: SymbolTableID,
    ) -> Vec<SymbolId> {
        let a = self.ast;
        let kind = table_id & ST_KIND_MASK;
        if kind == ST_KIND_MEMBERS {
            return Vec::new();
        }
        let cached =
            kind == ST_KIND_GLOBALS || kind == ST_KIND_EXPORTS || kind == ST_KIND_RESOLVED_EXPORTS;
        if cached {
            if let Some(aliases) = self.symbol_table_alias_cache.get(&table_id) {
                return aliases.clone();
            }
        }
        let mut aliases: Vec<SymbolId> = Vec::new();
        if !symbols.is_nil() {
            for entry in 0..a.table_len(symbols) {
                let (_, sym) = a.table_entry_at(symbols, entry);
                if a.sym(sym).flags.intersects(SymbolFlags::ALIAS) {
                    aliases.push(sym);
                }
            }
        }
        if cached {
            self.symbol_table_alias_cache
                .insert(table_id, aliases.clone());
        }
        aliases
    }

    fn try_symbol_table(
        &mut self,
        ctx: AccessibleSymbolChainContext,
        visited: &mut VisitedSymbolTablesMap,
        symbols: SymbolTableId,
        table_id: SymbolTableID,
        ignore_qualification: bool,
        is_local_name_lookup: bool,
    ) -> Vec<SymbolId> {
        let a = self.ast;
        let is_globals = table_id == ST_KIND_GLOBALS;
        // If symbol is directly available by its name in the symbol table
        let res = if symbols.is_nil() {
            SymbolId::NIL
        } else {
            a.table_get(symbols, a.sym(ctx.symbol).name)
        };
        if !res.is_nil()
            && self.is_accessible(ctx, visited, res, SymbolId::NIL, ignore_qualification)
        {
            return vec![ctx.symbol];
        }

        let mut candidate_chains: Vec<Vec<SymbolId>> = Vec::new();
        // collect all possible chains to sort them and return the shortest/best
        if !res.is_nil() && !a.sym(res).export_symbol.is_nil() {
            let export_symbol = self.get_merged_symbol(a.sym(res).export_symbol);
            if self.is_accessible(
                ctx,
                visited,
                export_symbol,
                SymbolId::NIL,
                ignore_qualification,
            ) {
                candidate_chains.push(vec![ctx.symbol]);
            }
        }

        // Check if symbol is any of the aliases in scope
        for symbol_from_symbol_table in self.get_symbol_table_aliases(symbols, table_id) {
            // for every non-default, non-export= alias symbol in scope, check if it refers to or can chain to the target symbol
            let alias = a.sym(symbol_from_symbol_table);
            let declarations = alias.declarations.as_slice();
            if alias.name != INTERNAL_SYMBOL_NAME_EXPORT_EQUALS
                && alias.name != INTERNAL_SYMBOL_NAME_DEFAULT
                && !(is_umd_export_symbol(a, symbol_from_symbol_table)
                    && !ctx.enclosing_declaration.is_nil()
                    && is_external_module(a, get_source_file_of_node(a, ctx.enclosing_declaration)))
                // If `!useOnlyExternalAliasing`, we can use any type of alias to get the name
                && (!ctx.use_only_external_aliasing
                    || declarations
                        .iter()
                        .any(|d| is_external_module_import_equals_declaration(a, *d)))
                // If we're looking up a local name to reference directly, omit namespace reexports, otherwise when we're trawling through an export list to make a dotted name, we can keep it
                && (is_local_name_lookup
                    && !declarations
                        .iter()
                        .any(|d| is_namespace_reexport_declaration(a, *d))
                    || !is_local_name_lookup)
                // While exports are generally considered to be in scope, export-specifier declared symbols are _not_
                && (ignore_qualification
                    || get_declarations_of_kind(a, symbol_from_symbol_table, Kind::ExportSpecifier)
                        .is_empty())
            {
                let resolved_imported_symbol = self.resolve_alias(symbol_from_symbol_table);
                let candidate = self.get_candidate_list_for_symbol(
                    ctx,
                    visited,
                    symbol_from_symbol_table,
                    resolved_imported_symbol,
                    ignore_qualification,
                );
                if !candidate.is_empty() {
                    candidate_chains.push(candidate);
                }
            }
        }

        if !candidate_chains.is_empty() {
            // pick first, shortest
            candidate_chains.sort_by(|x, y| self.compare_symbol_chains_worker(x, y).cmp(&0));
            return candidate_chains.into_iter().next().unwrap_or_default();
        }

        // If there's no result and we're looking at the global symbol table, treat `globalThis` like an alias and try to lookup thru that
        if is_globals {
            let global_this_symbol = self.global_this_symbol;
            return self.get_candidate_list_for_symbol(
                ctx,
                visited,
                global_this_symbol,
                global_this_symbol,
                ignore_qualification,
            );
        }
        Vec::new()
    }

    pub fn compare_symbol_chains_worker(&self, a: &[SymbolId], b: &[SymbolId]) -> isize {
        let chain_len = a.len() as isize - b.len() as isize;
        if chain_len != 0 {
            return chain_len;
        }
        for (x, y) in a.iter().zip(b.iter()) {
            let comparison = self.compare_symbols(*x, *y);
            if comparison != 0 {
                return comparison;
            }
        }
        0
    }
}

fn is_umd_export_symbol(a: Ast<'_>, symbol: SymbolId) -> bool {
    if symbol.is_nil() {
        return false;
    }
    match a.sym(symbol).declarations.as_slice().first() {
        Some(&first) => !first.is_nil() && is_namespace_export_declaration(a, first),
        None => false,
    }
}

fn is_namespace_reexport_declaration(a: Ast<'_>, node: NodeId) -> bool {
    is_namespace_export(a, node) && !a.module_specifier(a.parent(node)).is_nil()
}

impl<'a> Checker<'a> {
    fn get_candidate_list_for_symbol(
        &mut self,
        ctx: AccessibleSymbolChainContext,
        visited: &mut VisitedSymbolTablesMap,
        symbol_from_symbol_table: SymbolId,
        resolved_imported_symbol: SymbolId,
        ignore_qualification: bool,
    ) -> Vec<SymbolId> {
        if self.is_accessible(
            ctx,
            visited,
            symbol_from_symbol_table,
            resolved_imported_symbol,
            ignore_qualification,
        ) {
            return vec![symbol_from_symbol_table];
        }

        // Look in the exported members, if we can find accessibleSymbolChain, symbol is accessible using this chain but only if the symbolFromSymbolTable can be qualified
        let candidate_table = self.get_exports_of_symbol(resolved_imported_symbol);
        if candidate_table.is_nil() {
            return Vec::new();
        }
        let candidate_table_id =
            symbol_table_id_from_resolved_exports(self.ast, resolved_imported_symbol);
        let accessible_symbols_from_exports = self.get_accessible_symbol_chain_from_symbol_table(
            ctx,
            visited,
            candidate_table,
            candidate_table_id,
            true,
            false,
        );
        if accessible_symbols_from_exports.is_empty() {
            return Vec::new();
        }
        if !self.can_qualify_symbol(
            ctx,
            visited,
            symbol_from_symbol_table,
            get_qualified_left_meaning(ctx.meaning),
        ) {
            return Vec::new();
        }
        let mut result = vec![symbol_from_symbol_table];
        result.extend_from_slice(&accessible_symbols_from_exports);
        result
    }

    fn is_accessible(
        &mut self,
        ctx: AccessibleSymbolChainContext,
        visited: &mut VisitedSymbolTablesMap,
        symbol_from_symbol_table: SymbolId,
        resolved_alias_symbol: SymbolId,
        ignore_qualification: bool,
    ) -> bool {
        let a = self.ast;
        let mut like_symbols = false;
        if ctx.symbol == resolved_alias_symbol {
            like_symbols = true;
        }
        if ctx.symbol == symbol_from_symbol_table {
            like_symbols = true;
        }
        let symbol = self.get_merged_symbol(ctx.symbol);
        if symbol == self.get_merged_symbol(resolved_alias_symbol) {
            like_symbols = true;
        }
        if symbol == self.get_merged_symbol(symbol_from_symbol_table) {
            like_symbols = true;
        }
        if !like_symbols {
            return false;
        }
        // if the symbolFromSymbolTable is not external module (it could be if it was determined as ambient external module and would be in globals table) and if symbolFromSymbolTable or alias resolution matches the symbol, check the symbol can be qualified, it is only then this symbol is accessible
        if a.sym(symbol_from_symbol_table)
            .declarations
            .as_slice()
            .iter()
            .any(|d| has_non_global_augmentation_external_module_symbol(a, *d))
        {
            return false;
        }
        if ignore_qualification {
            return true;
        }
        let merged = self.get_merged_symbol(symbol_from_symbol_table);
        self.can_qualify_symbol(ctx, visited, merged, ctx.meaning)
    }

    // If the symbol is equivalent and doesn't need further qualification, this symbol is accessible
    fn can_qualify_symbol(
        &mut self,
        ctx: AccessibleSymbolChainContext,
        visited: &mut VisitedSymbolTablesMap,
        symbol_from_symbol_table: SymbolId,
        meaning: SymbolFlags,
    ) -> bool {
        if !self.needs_qualification(symbol_from_symbol_table, ctx.enclosing_declaration, meaning) {
            return true;
        }
        // If symbol needs qualification, make sure that parent is accessible, if it is then this symbol is accessible too
        let parent = self.ast.sym(symbol_from_symbol_table).parent;
        !self
            .get_accessible_symbol_chain_ex(
                AccessibleSymbolChainContext {
                    symbol: parent,
                    enclosing_declaration: ctx.enclosing_declaration,
                    meaning: get_qualified_left_meaning(meaning),
                    use_only_external_aliasing: ctx.use_only_external_aliasing,
                },
                visited,
            )
            .is_empty()
    }

    pub(crate) fn needs_qualification(
        &mut self,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
    ) -> bool {
        let a = self.ast;
        let name = a.sym(symbol).name;
        let mut qualify = false;
        self.some_symbol_table_in_scope(
            enclosing_declaration,
            &mut |c, symbol_table, _, _, _, _| {
                // If symbol of this name is not available in the symbol table we are ok
                if symbol_table.is_nil() {
                    return false;
                }
                let res = a.table_get(symbol_table, name);
                if res.is_nil() {
                    return false;
                }
                let mut symbol_from_symbol_table = c.get_merged_symbol(res);
                if symbol_from_symbol_table.is_nil() {
                    // Continue to the next symbol table
                    return false;
                }
                // If the symbol with this name is present it should refer to the symbol
                if symbol_from_symbol_table == symbol {
                    // No need to qualify
                    return true;
                }

                // Qualify if the symbol from symbol table has same meaning as expected
                let should_resolve_alias = a
                    .sym(symbol_from_symbol_table)
                    .flags
                    .intersects(SymbolFlags::ALIAS)
                    && get_declaration_of_kind(a, symbol_from_symbol_table, Kind::ExportSpecifier)
                        .is_nil();
                if should_resolve_alias {
                    symbol_from_symbol_table = c.resolve_alias(symbol_from_symbol_table);
                }
                let mut flags = a.sym(symbol_from_symbol_table).flags;
                if should_resolve_alias {
                    flags = c.get_symbol_flags(symbol_from_symbol_table);
                }
                if flags.intersects(meaning) {
                    qualify = true;
                    return true;
                }

                // Continue to the next symbol table
                false
            },
        );
        qualify
    }
}

fn is_property_or_method_declaration_symbol(a: Ast<'_>, symbol: SymbolId) -> bool {
    let declarations = a.sym(symbol).declarations.as_slice();
    if declarations.is_empty() {
        return false;
    }
    declarations.iter().all(|declaration| {
        matches!(
            a.kind(*declaration),
            Kind::PropertyDeclaration
                | Kind::MethodDeclaration
                | Kind::GetAccessor
                | Kind::SetAccessor
        )
    })
}

// The callback of someSymbolTableInScope: the table, its id, ignoreQualification, isLocalNameLookup and the scope node.
type SymbolTableCallback<'f, 'a> =
    dyn FnMut(&mut Checker<'a>, SymbolTableId, SymbolTableID, bool, bool, NodeId) -> bool + 'f;

impl<'a> Checker<'a> {
    pub(crate) fn some_symbol_table_in_scope(
        &mut self,
        enclosing_declaration: NodeId,
        callback: &mut SymbolTableCallback<'_, 'a>,
    ) -> bool {
        let a = self.ast;
        let mut location = enclosing_declaration;
        while !location.is_nil() {
            // Locals of a source file are not in scope (because they get merged into the global symbol table)
            if can_have_locals(a, location)
                && !a.locals(location).is_nil()
                && !is_global_source_file(a, location)
            {
                if callback(
                    self,
                    a.locals(location),
                    symbol_table_id_from_locals(location),
                    false,
                    true,
                    location,
                ) {
                    return true;
                }
            }
            match a.kind(location) {
                Kind::SourceFile | Kind::ModuleDeclaration => {
                    if !(is_source_file(a, location)
                        && !is_external_or_common_js_module(a, location))
                    {
                        let sym =
                            self.get_symbol_of_declaration(get_reparsed_node_for_node(a, location));
                        if callback(
                            self,
                            a.sym(sym).exports,
                            symbol_table_id_from_exports(a, sym),
                            false,
                            true,
                            location,
                        ) {
                            return true;
                        }
                    }
                }
                Kind::ClassDeclaration | Kind::ClassExpression | Kind::InterfaceDeclaration => {
                    // Type parameters are bound into `members` lists so they can merge across declarations: a copy with only the type members is what is in scope, since we must never write `foo` as `Foo.foo`.
                    let mut table = SymbolTableId::NIL;
                    let sym = self.get_symbol_of_declaration(location);
                    let members = a.sym(sym).members;
                    if !members.is_nil() {
                        for entry in 0..a.table_len(members) {
                            let (key, member_symbol) = a.table_entry_at(members, entry);
                            if a.sym(member_symbol)
                                .flags
                                .intersects(SymbolFlags::TYPE.without(SymbolFlags::ASSIGNMENT))
                            {
                                if table.is_nil() {
                                    table = a.new_table();
                                }
                                a.table_set(table, key, member_symbol);
                            }
                        }
                    }
                    if !table.is_nil()
                        && callback(
                            self,
                            table,
                            symbol_table_id_from_members(a, sym),
                            false,
                            false,
                            location,
                        )
                    {
                        return true;
                    }
                    // The name of a class expression is in scope within the class: it is not in members or locals, so it gets a table of its own.
                    if is_class_expression(a, location) && !a.name(location).is_nil() {
                        let name_table = self.get_class_expression_name_table(location);
                        if !name_table.is_nil()
                            && callback(
                                self,
                                name_table,
                                symbol_table_id_from_locals(location),
                                false,
                                true,
                                location,
                            )
                        {
                            return true;
                        }
                    }
                }
                _ => {}
            }
            location = a.parent(location);
        }
        let globals = self.globals;
        callback(
            self,
            globals,
            symbol_table_id_from_globals(),
            false,
            true,
            NodeId::NIL,
        )
    }

    // getClassExpressionNameTable returns a cached one-entry symbol table mapping the class expression's name to its symbol.
    fn get_class_expression_name_table(&mut self, location: NodeId) -> SymbolTableId {
        let a = self.ast;
        if let Some(table) = self.class_expression_name_tables.get(&location) {
            return *table;
        }
        let class_symbol = self.get_symbol_of_declaration(location);
        let name_text = a.text(a.name(location));
        if name_text.is_empty() || class_symbol.is_nil() {
            return SymbolTableId::NIL;
        }
        let table = a.new_table();
        a.table_set(table, name_text, class_symbol);
        self.class_expression_name_tables.insert(location, table);
        table
    }

    // Check if the given symbol in given enclosing declaration is accessible and mark all associated alias to be visible if requested
    pub fn is_symbol_accessible(
        &mut self,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
        should_compute_aliases_to_make_visible: bool,
    ) -> SymbolAccessibilityResult {
        self.is_symbol_accessible_worker(
            symbol,
            enclosing_declaration,
            meaning,
            should_compute_aliases_to_make_visible,
            true,
        )
    }

    fn is_symbol_accessible_worker(
        &mut self,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
        should_compute_aliases_to_make_visible: bool,
        allow_modules: bool,
    ) -> SymbolAccessibilityResult {
        if !symbol.is_nil() && !enclosing_declaration.is_nil() {
            let a = self.ast;
            let result = self.is_any_symbol_accessible(
                &[symbol],
                enclosing_declaration,
                symbol,
                meaning,
                should_compute_aliases_to_make_visible,
                allow_modules,
            );
            if let Some(result) = result {
                return result;
            }

            // This could be a symbol that is not exported in the external module or it could be a symbol from different external module that is not aliased and hence cannot be named
            let mut symbol_external_module = SymbolId::NIL;
            for d in a.sym(symbol).declarations.as_slice() {
                symbol_external_module = self.get_external_module_container(*d);
                if !symbol_external_module.is_nil() {
                    break;
                }
            }
            if !symbol_external_module.is_nil() {
                let enclosing_external_module =
                    self.get_external_module_container(enclosing_declaration);
                if symbol_external_module != enclosing_external_module {
                    // name from different external module that is not visible
                    return SymbolAccessibilityResult {
                        accessibility: SymbolAccessibility::CannotBeNamed,
                        error_symbol_name: self.symbol_to_string_ex(
                            symbol,
                            enclosing_declaration,
                            meaning,
                            SymbolFormatFlags::ALLOW_ANY_NODE_KIND,
                        ),
                        error_module_name: self.symbol_to_string(symbol_external_module),
                        error_node: if is_in_js_file(a, enclosing_declaration) {
                            enclosing_declaration
                        } else {
                            NodeId::NIL
                        },
                        ..SymbolAccessibilityResult::default()
                    };
                }
            }

            // Just a local name that is not accessible
            return SymbolAccessibilityResult {
                accessibility: SymbolAccessibility::NotAccessible,
                error_symbol_name: self.symbol_to_string_ex(
                    symbol,
                    enclosing_declaration,
                    meaning,
                    SymbolFormatFlags::ALLOW_ANY_NODE_KIND,
                ),
                ..SymbolAccessibilityResult::default()
            };
        }

        SymbolAccessibilityResult {
            accessibility: SymbolAccessibility::Accessible,
            ..SymbolAccessibilityResult::default()
        }
    }
}
