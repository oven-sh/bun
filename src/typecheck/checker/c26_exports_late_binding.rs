// checker.go:16014-16347 (layer M-MODULE): the exports and members of a symbol with late binding of dynamic members, and the exports of a module with its `export *` declarations and their collisions.
use crate::ast::{
    Arg, Ast, CheckFlags, INTERNAL_SYMBOL_NAME_ASSIGNMENT_DECLARATION,
    INTERNAL_SYMBOL_NAME_DEFAULT, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
    INTERNAL_SYMBOL_NAME_EXPORT_STAR, INTERNAL_SYMBOL_NAME_INDEX, NodeId, SymbolFlags, SymbolId,
    SymbolTableId, get_name_of_declaration, has_static_modifier, is_binary_expression,
    is_element_access_expression,
};
use crate::binder::set_value_declaration;
use crate::checker::{
    Checker, MembersAndExportsLinks, MembersOrExportsResolutionKind, TypeFlags,
    get_excluded_symbol_flags, get_members_of_declaration, get_property_name_from_type,
    is_type_usable_as_property_name,
};
use crate::collections::{Set, new_set_with_size_hint};
use crate::core::{Link, Map, Text, concatenate, filter, or_else};
use crate::diagnostics;
use crate::scanner::{declaration_name_to_string, get_text_of_node};
use std::borrow::Cow;
use std::collections::BTreeMap;

// `links[resolutionKind]`: the links of a late-binding container are a table for each resolution kind.
fn resolved_members_or_exports(
    c: &Checker<'_>,
    links: Link<MembersAndExportsLinks>,
    resolution_kind: MembersOrExportsResolutionKind,
) -> SymbolTableId {
    c.members_and_exports_links[links]
        .0
        .get(resolution_kind.0 as usize)
        .copied()
        .unwrap_or_default()
}

// `links[resolutionKind] = table`
fn set_resolved_members_or_exports(
    c: &mut Checker<'_>,
    links: Link<MembersAndExportsLinks>,
    resolution_kind: MembersOrExportsResolutionKind,
    table: SymbolTableId,
) {
    if let Some(slot) = c.members_and_exports_links[links]
        .0
        .get_mut(resolution_kind.0 as usize)
    {
        *slot = table;
    }
}

impl<'a> Checker<'a> {
    pub fn get_exports_of_symbol(&mut self, symbol: SymbolId) -> SymbolTableId {
        let flags = self.ast.sym(symbol).flags;
        if flags.intersects(SymbolFlags::LATE_BINDING_CONTAINER) {
            return self.get_resolved_members_or_exports_of_symbol(
                symbol,
                MembersOrExportsResolutionKind::RESOLVED_EXPORTS,
            );
        }
        if flags.intersects(SymbolFlags::MODULE) {
            return self.get_exports_of_module(symbol);
        }
        self.ast.sym(symbol).exports
    }

    pub fn get_resolved_members_or_exports_of_symbol(
        &mut self,
        symbol: SymbolId,
        resolution_kind: MembersOrExportsResolutionKind,
    ) -> SymbolTableId {
        let a = self.ast;
        let links = self.members_and_exports_links.get(symbol);
        if resolved_members_or_exports(self, links, resolution_kind).is_nil() {
            let is_static = resolution_kind == MembersOrExportsResolutionKind::RESOLVED_EXPORTS;
            let mut early_symbols = a.sym(symbol).exports;
            if !is_static {
                early_symbols = a.sym(symbol).members;
            } else if a.sym(symbol).flags.intersects(SymbolFlags::MODULE) {
                (early_symbols, _) = self.get_exports_of_module_worker(symbol);
            }
            set_resolved_members_or_exports(self, links, resolution_kind, early_symbols);
            // fill in any as-yet-unresolved late-bound members.
            let mut late_symbols = SymbolTableId::NIL;
            for &decl in a.sym(symbol).declarations.as_slice() {
                for &member in get_members_of_declaration(a, decl).as_slice() {
                    if is_static == has_static_modifier(a, member) {
                        if self.has_late_bindable_name(member) {
                            if late_symbols.is_nil() {
                                late_symbols = a.new_table();
                            }
                            self.late_bind_member(symbol, early_symbols, late_symbols, member);
                        } else if self.has_late_bindable_index_signature(member) {
                            if late_symbols.is_nil() {
                                late_symbols = a.new_table();
                            }
                            self.late_bind_index_signature(
                                symbol,
                                early_symbols,
                                late_symbols,
                                member,
                            );
                        }
                    }
                }
            }
            if is_static {
                let assignment_symbol = a.table_get(
                    a.sym(symbol).exports,
                    INTERNAL_SYMBOL_NAME_ASSIGNMENT_DECLARATION,
                );
                if !assignment_symbol.is_nil() {
                    for &member in a.sym(assignment_symbol).declarations.as_slice() {
                        if self.has_late_bindable_name(member) {
                            if late_symbols.is_nil() {
                                late_symbols = a.new_table();
                            }
                            self.late_bind_member(symbol, early_symbols, late_symbols, member);
                        }
                    }
                }
            }
            let combined = self.combine_symbol_tables(early_symbols, late_symbols);
            set_resolved_members_or_exports(self, links, resolution_kind, combined);
        }
        resolved_members_or_exports(self, links, resolution_kind)
    }

    // Performs late-binding of a dynamic member. This performs the same function for late-bound members that `declareSymbol` in binder.ts performs for early-bound members. If a symbol is a dynamic name from a computed property, we perform an additional "late" binding phase to attempt to resolve the name for the symbol from the type of the computed property's expression. If the type of the expression is a string-literal, numeric-literal, or unique symbol type, we can use that type as the name of the symbol. For example, given `const x = Symbol(); interface I { [x]: number; }`, the binder gives the property `[x]: number` a special symbol with the name "__computed". In the late-binding phase we can type-check the expression `x` and see that it has a unique symbol type which we can then use as the name of the member. This allows users to define custom symbols that can be used in the members of an object type. `parent` is the containing symbol for the member, `earlySymbols` the early-bound symbols of the parent, `lateSymbols` the late-bound symbols of the parent, `decl` the member to bind.
    pub fn late_bind_member(
        &mut self,
        parent: SymbolId,
        early_symbols: SymbolTableId,
        late_symbols: SymbolTableId,
        decl: NodeId,
    ) -> SymbolId {
        let a = self.ast;
        self.assert(
            !a.symbol(decl).is_nil(),
            "The member is expected to have a symbol.",
        );
        let links = self.symbol_node_links.get(decl);
        if self.symbol_node_links[links].resolved_symbol.is_nil() {
            // In the event we attempt to resolve the late-bound name of this member recursively, fall back to the early-bound name of this member.
            self.symbol_node_links[links].resolved_symbol = a.symbol(decl);
            let decl_name = if is_binary_expression(a, decl) {
                a.as_binary_expression(decl).left
            } else {
                a.name(decl)
            };
            let t = if is_element_access_expression(a, decl_name) {
                self.check_expression_cached(
                    a.as_element_access_expression(decl_name)
                        .argument_expression,
                )
            } else {
                self.check_computed_property_name(decl_name)
            };
            if is_type_usable_as_property_name(self, t) {
                let property_name = get_property_name_from_type(self, t);
                let member_name = self.text(&property_name);
                let symbol_flags = a.sym(a.symbol(decl)).flags;
                // Get or add a late-bound symbol for the member. This allows us to merge late-bound accessor declarations.
                let mut late_symbol = a.table_get(late_symbols, member_name);
                if late_symbol.is_nil() {
                    late_symbol =
                        self.new_symbol_ex(SymbolFlags::NONE, member_name, CheckFlags::LATE);
                    a.table_set(late_symbols, member_name, late_symbol);
                }
                // Report an error if there's a symbol declaration with the same name and conflicting flags.
                let early_symbol = a.table_get(early_symbols, member_name);
                if a.sym(late_symbol)
                    .flags
                    .intersects(get_excluded_symbol_flags(symbol_flags))
                {
                    // If we have an existing early-bound member, combine its declarations so that we can report an error at each declaration.
                    let declarations: Cow<'a, [NodeId]> = if !early_symbol.is_nil() {
                        concatenate(
                            a.sym(early_symbol).declarations.as_slice(),
                            a.sym(late_symbol).declarations.as_slice(),
                        )
                    } else {
                        Cow::Borrowed(a.sym(late_symbol).declarations.as_slice())
                    };
                    let unique_symbol_name;
                    let mut name: &[u8] = member_name;
                    if self.types[t].flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL) {
                        unique_symbol_name = declaration_name_to_string(a, decl_name);
                        name = &unique_symbol_name;
                    }
                    for &d in declarations.iter() {
                        self.error(
                            or_else(get_name_of_declaration(a, d), d),
                            diagnostics::DUPLICATE_IDENTIFIER_0,
                            &[Arg::Str(name)],
                        );
                    }
                    self.error(
                        or_else(decl_name, decl),
                        diagnostics::DUPLICATE_IDENTIFIER_0,
                        &[Arg::Str(name)],
                    );
                    let late_flags = a.sym(late_symbol).flags;
                    if late_flags.intersects(SymbolFlags::ACCESSOR)
                        && (late_flags & SymbolFlags::ACCESSOR)
                            != (symbol_flags & SymbolFlags::ACCESSOR)
                    {
                        a.update_symbol(late_symbol, |s| s.flags |= SymbolFlags::ACCESSOR);
                    }
                    late_symbol =
                        self.new_symbol_ex(SymbolFlags::NONE, member_name, CheckFlags::LATE);
                }
                let late_links = self.value_symbol_links_get(late_symbol);
                self.value_symbol_links[late_links].name_type = t;
                self.add_declaration_to_late_bound_symbol(late_symbol, decl, symbol_flags);
                if a.sym(late_symbol).parent.is_nil() {
                    a.update_symbol(late_symbol, |s| s.parent = parent);
                }
                self.symbol_node_links[links].resolved_symbol = late_symbol;
            }
        }
        self.symbol_node_links[links].resolved_symbol
    }

    // Upstream does not read `parent` either.
    pub fn late_bind_index_signature(
        &mut self,
        _parent: SymbolId,
        early_symbols: SymbolTableId,
        late_symbols: SymbolTableId,
        decl: NodeId,
    ) {
        let a = self.ast;
        // First, late bind the index symbol itself, if needed
        let mut index_symbol = a.table_get(late_symbols, INTERNAL_SYMBOL_NAME_INDEX);
        if index_symbol.is_nil() {
            let early = a.table_get(early_symbols, INTERNAL_SYMBOL_NAME_INDEX);
            if early.is_nil() {
                index_symbol = self.new_symbol_ex(
                    SymbolFlags::NONE,
                    INTERNAL_SYMBOL_NAME_INDEX,
                    CheckFlags::LATE,
                );
            } else {
                index_symbol = self.clone_symbol(early);
                a.update_symbol(index_symbol, |s| s.check_flags |= CheckFlags::LATE);
            }
            a.table_set(late_symbols, INTERNAL_SYMBOL_NAME_INDEX, index_symbol);
        }
        // Then just add the computed name as a late bound declaration (note: unlike `addDeclarationToLateBoundSymbol` we do not set up a `.lateSymbol` on `decl`'s links, since that would point at an index symbol and not a single property symbol, like most consumers would expect)
        if a.sym(index_symbol).declarations.len() == 0
            || !a
                .sym(a.symbol(decl))
                .flags
                .intersects(SymbolFlags::REPLACEABLE_BY_METHOD)
        {
            let mut declarations: Vec<NodeId> =
                a.sym(index_symbol).declarations.as_slice().to_vec();
            declarations.push(decl);
            let declarations = self.list_of(&declarations);
            a.update_symbol(index_symbol, |s| s.declarations = declarations);
        }
    }
}

pub fn is_not_replacable_by_method(a: Ast<'_>, decl: NodeId) -> bool {
    !a.sym(a.symbol(decl))
        .flags
        .intersects(SymbolFlags::REPLACEABLE_BY_METHOD)
}

impl<'a> Checker<'a> {
    // Adds a declaration to a late-bound dynamic member. This performs the same function for late-bound members that `addDeclarationToSymbol` in binder.ts performs for early-bound members.
    pub fn add_declaration_to_late_bound_symbol(
        &mut self,
        symbol: SymbolId,
        member: NodeId,
        symbol_flags: SymbolFlags,
    ) {
        let a = self.ast;
        self.assert(
            a.sym(symbol).check_flags.intersects(CheckFlags::LATE),
            "Expected a late-bound symbol.",
        );
        let member_symbol = a.symbol(member);
        let links = self.late_bound_links.get(member_symbol);
        self.late_bound_links[links].late_symbol = symbol;
        if a.sym(symbol).declarations.len() == 0
            || !a
                .sym(member_symbol)
                .flags
                .intersects(SymbolFlags::REPLACEABLE_BY_METHOD)
        {
            let mut declarations: Vec<NodeId> = a.sym(symbol).declarations.as_slice().to_vec();
            declarations.push(member);
            let declarations = self.list_of(&declarations);
            a.update_symbol(symbol, |s| {
                s.flags |= symbol_flags;
                s.declarations = declarations;
            });
        } else if a
            .sym(symbol)
            .flags
            .intersects(SymbolFlags::REPLACEABLE_BY_METHOD)
            && a.sym(member_symbol).flags.intersects(SymbolFlags::METHOD)
        {
            // Remove all replacable-by-method members, along with their flags.
            let mut declarations: Vec<NodeId> =
                filter(a.sym(symbol).declarations.as_slice(), |d| {
                    is_not_replacable_by_method(a, d)
                })
                .into_owned();
            declarations.push(member);
            let old_flags = a.sym(symbol).flags;
            let mut flags = SymbolFlags::NONE;
            for &d in &declarations {
                flags |= a.sym(a.symbol(d)).flags;
            }
            if old_flags.intersects(SymbolFlags::ACCESSOR) {
                flags |= SymbolFlags::ACCESSOR;
            }
            let declarations = self.list_of(&declarations);
            a.update_symbol(symbol, |s| {
                s.declarations = declarations;
                s.flags = flags;
            });
        }
        if symbol_flags.intersects(SymbolFlags::VALUE) {
            set_value_declaration(a, symbol, member);
        }
    }

    // Gets a SymbolTable containing both the early- and late-bound members of a symbol. For a description of late-binding, see `lateBindMember`.
    pub fn get_members_of_symbol(&mut self, symbol: SymbolId) -> SymbolTableId {
        if self
            .ast
            .sym(symbol)
            .flags
            .intersects(SymbolFlags::LATE_BINDING_CONTAINER)
        {
            return self.get_resolved_members_or_exports_of_symbol(
                symbol,
                MembersOrExportsResolutionKind::RESOLVED_MEMBERS,
            );
        }
        self.ast.sym(symbol).members
    }

    pub fn get_exports_of_module(&mut self, module_symbol: SymbolId) -> SymbolTableId {
        let links = self.module_symbol_links.get(module_symbol);
        if self.module_symbol_links[links].resolved_exports.is_nil() {
            let (exports, type_only_export_star_map) =
                self.get_exports_of_module_worker(module_symbol);
            self.module_symbol_links[links].resolved_exports = exports;
            self.module_symbol_links[links].type_only_export_star_map = type_only_export_star_map;
        }
        self.module_symbol_links[links].resolved_exports
    }
}

pub struct ExportCollision {
    pub specifier_text: Vec<u8>,
    pub exports_with_duplicate: Vec<NodeId>,
}

// A map upstream, ranged over in a random order: here the entries come in the order of their names.
pub type ExportCollisionTable<'a> = BTreeMap<Text<'a>, ExportCollision>;

// What upstream's `visit` closure of getExportsOfModuleWorker captures.
struct ExportsVisit<'a> {
    visited_symbols: Vec<SymbolId>,
    non_type_only_names: Set<Text<'a>>,
    type_only_export_star_map: Map<Text<'a>, NodeId>,
}

impl<'a> Checker<'a> {
    pub fn get_exports_of_module_worker(
        &mut self,
        module_symbol: SymbolId,
    ) -> (SymbolTableId, Map<Text<'a>, NodeId>) {
        // The ES6 spec permits export * declarations in a module to circularly reference the module itself. For example, module 'a' can 'export * from "b"' and 'b' can 'export * from "a"' without error.
        fn visit<'a>(
            c: &mut Checker<'a>,
            state: &mut ExportsVisit<'a>,
            symbol: SymbolId,
            export_star: NodeId,
            is_type_only: bool,
        ) -> SymbolTableId {
            if !c.stack_check.is_safe_to_recurse() {
                return c.stack_limit();
            }
            let a = c.ast;
            if !is_type_only && !symbol.is_nil() {
                // Add non-type-only names before checking if we've visited this module, because we might have visited it via an 'export type *', and visiting again with 'export *' will override the type-onlyness of its exports.
                let mut position = 0;
                while let Some((name, _)) = a.table_entry_at(a.sym(symbol).exports, position) {
                    position += 1;
                    state.non_type_only_names.add(name);
                }
            }
            if symbol.is_nil()
                || a.sym(symbol).exports.is_nil()
                || state.visited_symbols.contains(&symbol)
            {
                return SymbolTableId::NIL;
            }
            state.visited_symbols.push(symbol);
            let symbols = a.table_clone(a.sym(symbol).exports);
            // All export * declarations are collected in an __export symbol by the binder
            let export_stars = a.table_get(a.sym(symbol).exports, INTERNAL_SYMBOL_NAME_EXPORT_STAR);
            if !export_stars.is_nil() {
                let nested_symbols = a.new_table();
                let mut lookup_table = ExportCollisionTable::new();
                for &node in a.sym(export_stars).declarations.as_slice() {
                    let resolved_module =
                        c.resolve_external_module_name(node, a.module_specifier(node), false);
                    let exported_symbols = visit(
                        c,
                        state,
                        resolved_module,
                        node,
                        is_type_only || a.is_type_only(node),
                    );
                    c.extend_export_symbols(
                        nested_symbols,
                        exported_symbols,
                        Some(&mut lookup_table),
                        node,
                    );
                }
                for (&id, s) in &lookup_table {
                    // It's not an error if the file with multiple `export *`s with duplicate names exports a member with that name itself
                    if id == INTERNAL_SYMBOL_NAME_EXPORT_EQUALS
                        || s.exports_with_duplicate.is_empty()
                        || !a.table_get(symbols, id).is_nil()
                    {
                        continue;
                    }
                    for &node in &s.exports_with_duplicate {
                        let diagnostic = c.create_diagnostic_for_node(
                            node,
                            diagnostics::MODULE_0_HAS_ALREADY_EXPORTED_A_MEMBER_NAMED_1_CONSIDER_EXPLICITLY_RE_EXPORTING_TO_RESOLVE_THE_AMBIGUITY,
                            &[Arg::Str(&s.specifier_text), Arg::Str(id)],
                        );
                        c.add_diagnostic(diagnostic);
                    }
                }
                c.extend_export_symbols(symbols, nested_symbols, None, NodeId::NIL);
            }
            if !export_star.is_nil() && a.is_type_only(export_star) {
                if state.type_only_export_star_map.is_nil() {
                    state.type_only_export_star_map = Map::make();
                }
                let mut position = 0;
                while let Some((name, _)) = a.table_entry_at(symbols, position) {
                    position += 1;
                    let ok = state.type_only_export_star_map.set(name, export_star);
                    c.map_set(ok);
                }
            }
            symbols
        }

        let a = self.ast;
        let mut module_symbol = module_symbol;
        let mut state = ExportsVisit {
            visited_symbols: Vec::new(),
            non_type_only_names: new_set_with_size_hint(a.table_len(a.sym(module_symbol).exports)),
            type_only_export_star_map: Map::default(),
        };
        let mut original_module = SymbolId::NIL;
        if !module_symbol.is_nil() {
            let export_equals = a.table_get(
                a.sym(module_symbol).exports,
                INTERNAL_SYMBOL_NAME_EXPORT_EQUALS,
            );
            if !self.resolve_symbol_ex(export_equals, false).is_nil() {
                original_module = module_symbol;
            }
        }
        // A module defined by an 'export=' consists of one export that needs to be resolved
        module_symbol = self.resolve_external_module_symbol(module_symbol, false);
        let mut exports = visit(self, &mut state, module_symbol, NodeId::NIL, false);
        if exports.is_nil() {
            exports = a.new_table();
        }
        // A CommonJS module defined by an 'export=' might also export typedefs, stored on the original module
        if !original_module.is_nil() && a.table_len(a.sym(original_module).exports) > 1 {
            let original_exports = a.sym(original_module).exports;
            let mut position = 0;
            while let Some((_, symbol)) = a.table_entry_at(original_exports, position) {
                position += 1;
                let name = a.sym(symbol).name;
                if name == INTERNAL_SYMBOL_NAME_EXPORT_EQUALS
                    || name == INTERNAL_SYMBOL_NAME_EXPORT_STAR
                {
                    continue;
                }
                let flags = self.get_symbol_flags(symbol);
                if flags.intersects(SymbolFlags::TYPE | SymbolFlags::NAMESPACE)
                    && !flags.intersects(SymbolFlags::VALUE)
                    && a.table_get(exports, name).is_nil()
                {
                    a.table_set(exports, name, symbol);
                }
            }
        }
        for name in state.non_type_only_names.keys() {
            state.type_only_export_star_map.delete(name);
        }
        (exports, state.type_only_export_star_map)
    }

    // Extends one symbol table with another while collecting information on name collisions for error message generation into the `lookupTable` argument. Not passing `lookupTable` and `exportNode` disables this collection, and just extends the tables
    pub fn extend_export_symbols(
        &mut self,
        target: SymbolTableId,
        source: SymbolTableId,
        lookup_table: Option<&mut ExportCollisionTable<'a>>,
        export_node: NodeId,
    ) {
        let a = self.ast;
        let mut lookup_table = lookup_table;
        // Upstream ranges over the source table (a map): the table is walked in its own order.
        let mut position = 0;
        while let Some((id, source_symbol)) = a.table_entry_at(source, position) {
            position += 1;
            if id == INTERNAL_SYMBOL_NAME_DEFAULT {
                continue;
            }
            let target_symbol = a.table_get(target, id);
            if target_symbol.is_nil() {
                a.table_set(target, id, source_symbol);
                if let Some(lookup_table) = lookup_table.as_deref_mut() {
                    if !export_node.is_nil() {
                        lookup_table.insert(
                            id,
                            ExportCollision {
                                specifier_text: get_text_of_node(
                                    a,
                                    a.module_specifier(export_node),
                                ),
                                exports_with_duplicate: Vec::new(),
                            },
                        );
                    }
                }
            } else if lookup_table.is_some()
                && !export_node.is_nil()
                && self.resolve_symbol(target_symbol) != self.resolve_symbol(source_symbol)
            {
                match lookup_table
                    .as_deref_mut()
                    .and_then(|table| table.get_mut(id))
                {
                    Some(collision) => collision.exports_with_duplicate.push(export_node),
                    // Upstream reads through the nil entry here.
                    None => self.fail("nil ExportCollision in extendExportSymbols"),
                }
            }
        }
    }
}
