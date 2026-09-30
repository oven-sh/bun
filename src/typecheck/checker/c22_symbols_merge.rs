// checker.go:14170-14531 (layer S-MERGE): the symbols that a checker makes, merging of symbol tables and symbols with the duplicate declaration errors, merged and late-bound symbols, and the resolution of a symbol through its alias.
use crate::ast::{
    Arg, Ast, CheckFlags, DiagnosticId, Diagnostics, INTERNAL_SYMBOL_NAME_COMPUTED, NodeId,
    SymbolFlags, SymbolId, SymbolTableId, get_exports, get_members, get_name_of_declaration,
    get_source_file_of_node, has_static_modifier, is_non_local_alias, is_plain_js_file,
};
use crate::binder::set_value_declaration;
use crate::checker::{Checker, ProgramFiles, TypeId};
use crate::core::{List, Text, some};
use crate::diagnostics::{self, MessageId};

// ast.CompareDiagnostics reads the file names of both diagnostics: the view that addDiagnostic compares through answers them.
fn compare_diagnostics(c: &Checker<'_>, d1: DiagnosticId, d2: DiagnosticId) -> isize {
    let files = ProgramFiles { ast: c.ast };
    let view = Diagnostics {
        store: &c.diagnostic_store,
        files: &files,
    };
    view.compare_diagnostics(d1, d2)
}

impl<'a> Checker<'a> {
    pub fn new_symbol(&mut self, flags: SymbolFlags, name: Text<'a>) -> SymbolId {
        self.symbol_count += 1;
        self.ast.new_symbol(flags | SymbolFlags::TRANSIENT, name)
    }

    pub fn new_symbol_ex(
        &mut self,
        flags: SymbolFlags,
        name: Text<'a>,
        check_flags: CheckFlags,
    ) -> SymbolId {
        let result = self.new_symbol(flags, name);
        self.ast
            .update_symbol(result, |s| s.check_flags = check_flags);
        result
    }

    pub fn new_parameter(&mut self, name: Text<'a>, t: TypeId) -> SymbolId {
        let symbol = self.new_symbol(SymbolFlags::FUNCTION_SCOPED_VARIABLE, name);
        let links = self.value_symbol_links_get(symbol);
        self.value_symbol_links[links].resolved_type = t;
        symbol
    }

    pub fn new_property(&mut self, name: Text<'a>, t: TypeId) -> SymbolId {
        let symbol = self.new_symbol(SymbolFlags::PROPERTY, name);
        let links = self.value_symbol_links_get(symbol);
        self.value_symbol_links[links].resolved_type = t;
        symbol
    }

    pub fn combine_symbol_tables(
        &mut self,
        first: SymbolTableId,
        second: SymbolTableId,
    ) -> SymbolTableId {
        let a = self.ast;
        if a.table_len(first) == 0 {
            return second;
        }
        if a.table_len(second) == 0 {
            return first;
        }
        let combined = a.new_table();
        self.merge_symbol_table(combined, first, false, SymbolId::NIL);
        self.merge_symbol_table(combined, second, false, SymbolId::NIL);
        combined
    }

    pub fn merge_symbol_table(
        &mut self,
        target: SymbolTableId,
        source: SymbolTableId,
        unidirectional: bool,
        merged_parent: SymbolId,
    ) {
        let a = self.ast;
        // Upstream ranges over the source table (a map): the table is walked in its own order.
        let mut position = 0;
        while let Some((id, source_symbol)) = a.table_entry_at(source, position) {
            position += 1;
            let target_symbol = a.table_get(target, id);
            let merged = if !target_symbol.is_nil() {
                self.merge_symbol(target_symbol, source_symbol, unidirectional)
            } else {
                self.get_merged_symbol(source_symbol)
            };
            if !merged_parent.is_nil() && !target_symbol.is_nil() {
                // If a merge was performed on the target symbol, set its parent to the merged parent that initiated the merge of its exports. Otherwise, `merged` came only from `sourceSymbol` and can keep its parent: with `export interface A { x: number; }` in a.ts and `declare module "./a" { interface A { y: number; } interface B {} }` in b.ts, when merging the module augmentation into a.ts, the symbol for `A` will itself be merged, so its parent should be the merged module symbol. But the symbol for `B` has only one declaration, so its parent should be the module augmentation symbol, which contains its only declaration.
                if a.sym(merged).flags.intersects(SymbolFlags::TRANSIENT) {
                    a.update_symbol(merged, |s| s.parent = merged_parent);
                }
            }
            a.table_set(target, id, merged);
        }
    }

    // Note: if target is transient, then it is mutable, and mergeSymbol with both mutate and return it. If target is not transient, mergeSymbol will produce a transient clone, mutate that and return it.
    pub fn merge_symbol(
        &mut self,
        target: SymbolId,
        source: SymbolId,
        unidirectional: bool,
    ) -> SymbolId {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return target;
        }
        let a = self.ast;
        let mut target = target;
        if !a
            .sym(target)
            .flags
            .intersects(get_excluded_symbol_flags(a.sym(source).flags))
            || (a.sym(source).flags | a.sym(target).flags).intersects(SymbolFlags::ASSIGNMENT)
        {
            if source == target {
                // This can happen when an export assigned namespace exports something also erroneously exported at the top level. See `declarationFileNoCrashOnExtraExportModifier` for an example
                return target;
            }
            if !a.sym(target).flags.intersects(SymbolFlags::TRANSIENT) {
                let resolved_target = self.resolve_symbol(target);
                if resolved_target == self.unknown_symbol {
                    return source;
                }
                if !a
                    .sym(resolved_target)
                    .flags
                    .intersects(get_excluded_symbol_flags(a.sym(source).flags))
                    || (a.sym(source).flags | a.sym(resolved_target).flags)
                        .intersects(SymbolFlags::ASSIGNMENT)
                {
                    target = self.clone_symbol(resolved_target);
                } else {
                    self.report_merge_symbol_error(target, source);
                    return source;
                }
            }
            let source_data = a.sym(source);
            // Javascript static-property-assignment declarations always merge, even though they are also values
            if source_data.flags.intersects(SymbolFlags::VALUE_MODULE)
                && a.sym(target).flags.intersects(SymbolFlags::VALUE_MODULE)
                && a.sym(target)
                    .flags
                    .intersects(SymbolFlags::CONST_ENUM_ONLY_MODULE)
                && !source_data
                    .flags
                    .intersects(SymbolFlags::CONST_ENUM_ONLY_MODULE)
            {
                // reset flag when merging instantiated module into value module that has only const enums
                a.update_symbol(target, |s| {
                    s.flags = s.flags.without(SymbolFlags::CONST_ENUM_ONLY_MODULE);
                });
            }
            let mut source_flags = source_data.flags;
            if !a
                .sym(target)
                .flags
                .intersects(SymbolFlags::CONST_ENUM_ONLY_MODULE)
            {
                source_flags = source_flags.without(SymbolFlags::CONST_ENUM_ONLY_MODULE);
            }
            a.update_symbol(target, |s| s.flags |= source_flags);
            if !source_data.value_declaration.is_nil() {
                set_value_declaration(a, target, source_data.value_declaration);
            }
            // `append(target.Declarations, source.Declarations...)`: the list of the target stays as it is when the source has no declarations.
            if !source_data.declarations.as_slice().is_empty() {
                let mut declarations: Vec<NodeId> = a.sym(target).declarations.as_slice().to_vec();
                declarations.extend_from_slice(source_data.declarations.as_slice());
                let declarations = self.list_of(&declarations);
                a.update_symbol(target, |s| s.declarations = declarations);
            }
            if !source_data.members.is_nil() {
                let members = get_members(a, target);
                self.merge_symbol_table(
                    members,
                    source_data.members,
                    unidirectional,
                    SymbolId::NIL,
                );
            }
            if !source_data.exports.is_nil() {
                let exports = get_exports(a, target);
                self.merge_symbol_table(exports, source_data.exports, unidirectional, target);
            }
            if !unidirectional {
                self.record_merged_symbol(target, source);
            }
        } else if a
            .sym(target)
            .flags
            .intersects(SymbolFlags::NAMESPACE_MODULE)
        {
            // Do not report an error when merging `var globalThis` with the built-in `globalThis`, as we will already report a "Declaration name conflicts..." error, and this error won't make much sense.
            if target != self.global_this_symbol {
                let error_node = get_name_of_declaration(a, get_first_declaration(a, source));
                let target_name = self.symbol_to_string(target);
                self.error(
                    error_node,
                    diagnostics::CANNOT_AUGMENT_MODULE_0_WITH_VALUE_EXPORTS_BECAUSE_IT_RESOLVES_TO_A_NON_MODULE_ENTITY,
                    &[Arg::Str(&target_name)],
                );
            }
        } else {
            self.report_merge_symbol_error(target, source);
        }
        target
    }

    pub fn report_merge_symbol_error(&mut self, target: SymbolId, source: SymbolId) {
        let a = self.ast;
        let is_either_enum = a.sym(target).flags.intersects(SymbolFlags::ENUM)
            || a.sym(source).flags.intersects(SymbolFlags::ENUM);
        let is_either_block_scoped = a
            .sym(target)
            .flags
            .intersects(SymbolFlags::BLOCK_SCOPED_VARIABLE)
            || a.sym(source)
                .flags
                .intersects(SymbolFlags::BLOCK_SCOPED_VARIABLE);
        let message = if is_either_enum {
            diagnostics::ENUM_DECLARATIONS_CAN_ONLY_MERGE_WITH_NAMESPACE_OR_OTHER_ENUM_DECLARATIONS
        } else if is_either_block_scoped {
            diagnostics::CANNOT_REDECLARE_BLOCK_SCOPED_VARIABLE_0
        } else {
            diagnostics::DUPLICATE_IDENTIFIER_0
        };
        let source_symbol_file = get_source_file_of_node(a, get_first_declaration(a, source));
        let target_symbol_file = get_source_file_of_node(a, get_first_declaration(a, target));
        let is_source_plain_js =
            is_plain_js_file(a, source_symbol_file, self.compiler_options.check_js);
        let is_target_plain_js =
            is_plain_js_file(a, target_symbol_file, self.compiler_options.check_js);
        let symbol_name = self.symbol_to_string(source);
        if !is_source_plain_js {
            self.add_duplicate_declaration_errors_for_symbols(
                source,
                message,
                &symbol_name,
                target,
            );
        }
        if !is_target_plain_js {
            self.add_duplicate_declaration_errors_for_symbols(
                target,
                message,
                &symbol_name,
                source,
            );
        }
    }

    pub fn add_duplicate_declaration_errors_for_symbols(
        &mut self,
        target: SymbolId,
        message: MessageId,
        symbol_name: &[u8],
        source: SymbolId,
    ) {
        let a = self.ast;
        for &node in a.sym(target).declarations.as_slice() {
            self.add_duplicate_declaration_error(
                node,
                message,
                symbol_name,
                a.sym(source).declarations,
            );
        }
    }

    pub fn add_duplicate_declaration_error(
        &mut self,
        node: NodeId,
        message: MessageId,
        symbol_name: &[u8],
        related_nodes: List<'a, NodeId>,
    ) {
        let a = self.ast;
        let mut error_node = get_adjusted_node_for_error(a, node);
        if error_node.is_nil() {
            error_node = node;
        }
        let err = self.lookup_or_issue_error(error_node, message, &[Arg::Str(symbol_name)]);
        for &related_node in related_nodes.as_slice() {
            let adjusted_node = get_adjusted_node_for_error(a, related_node);
            if adjusted_node == error_node {
                continue;
            }
            let leading_message = self.create_diagnostic_for_node(
                adjusted_node,
                diagnostics::X_0_WAS_ALSO_DECLARED_HERE,
                &[Arg::Str(symbol_name)],
            );
            let follow_on_message =
                self.create_diagnostic_for_node(adjusted_node, diagnostics::X_AND_HERE, &[]);
            let related_information = self.diagnostic_store[err].related_information();
            if related_information.len() >= 5
                || some(related_information, |d| {
                    compare_diagnostics(self, d, follow_on_message) == 0
                        || compare_diagnostics(self, d, leading_message) == 0
                })
            {
                continue;
            }
            if related_information.is_empty() {
                self.diagnostic_store.add_related_info(err, leading_message);
            } else {
                self.diagnostic_store
                    .add_related_info(err, follow_on_message);
            }
        }
    }

    // A free function upstream: a diagnostic lives in the store of the checker.
    pub fn create_diagnostic_for_node(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        self.new_diagnostic_for_node(node, message, args)
    }
}

pub fn get_adjusted_node_for_error(a: Ast<'_>, node: NodeId) -> NodeId {
    let name = get_name_of_declaration(a, node);
    if !name.is_nil() {
        return name;
    }
    node
}

impl<'a> Checker<'a> {
    pub fn lookup_or_issue_error(
        &mut self,
        location: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        let diagnostic = self.new_diagnostic_for_node(location, message, args);
        self.add_diagnostic(diagnostic)
    }
}

pub fn get_first_declaration(a: Ast<'_>, symbol: SymbolId) -> NodeId {
    let declarations = a.sym(symbol).declarations;
    if declarations.len() > 0 {
        return declarations.at(0usize);
    }
    NodeId::NIL
}

pub fn get_excluded_symbol_flags(flags: SymbolFlags) -> SymbolFlags {
    let mut result = SymbolFlags::NONE;
    if flags.intersects(SymbolFlags::BLOCK_SCOPED_VARIABLE) {
        result |= SymbolFlags::BLOCK_SCOPED_VARIABLE_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::FUNCTION_SCOPED_VARIABLE) {
        result |= SymbolFlags::FUNCTION_SCOPED_VARIABLE_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::PROPERTY) {
        result |= SymbolFlags::PROPERTY_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::ENUM_MEMBER) {
        result |= SymbolFlags::ENUM_MEMBER_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::FUNCTION) {
        result |= SymbolFlags::FUNCTION_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::CLASS) {
        result |= SymbolFlags::CLASS_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::INTERFACE) {
        result |= SymbolFlags::INTERFACE_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::REGULAR_ENUM) {
        result |= SymbolFlags::REGULAR_ENUM_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::CONST_ENUM) {
        result |= SymbolFlags::CONST_ENUM_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::VALUE_MODULE) {
        result |= SymbolFlags::VALUE_MODULE_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::METHOD) {
        result |= SymbolFlags::METHOD_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::GET_ACCESSOR) {
        result |= SymbolFlags::GET_ACCESSOR_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::SET_ACCESSOR) {
        result |= SymbolFlags::SET_ACCESSOR_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::TYPE_PARAMETER) {
        result |= SymbolFlags::TYPE_PARAMETER_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::TYPE_ALIAS) {
        result |= SymbolFlags::TYPE_ALIAS_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::ALIAS) {
        result |= SymbolFlags::ALIAS_EXCLUDES;
    }
    if flags.intersects(SymbolFlags::REPLACEABLE_BY_METHOD) {
        result = result.without(SymbolFlags::METHOD);
    }
    result
}

impl<'a> Checker<'a> {
    pub fn clone_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        let a = self.ast;
        let source = a.sym(symbol);
        let result = self.new_symbol(source.flags, source.name);
        let members = a.table_clone(source.members);
        let exports = a.table_clone(source.exports);
        a.update_symbol(result, |s| {
            // Force reallocation if anything is ever appended to declarations: a list is never appended to in place here, so the clone shares it.
            s.declarations = source.declarations;
            s.parent = source.parent;
            s.value_declaration = source.value_declaration;
            s.members = members;
            s.exports = exports;
        });
        self.record_merged_symbol(result, symbol);
        result
    }

    pub fn get_merged_symbol(&self, symbol: SymbolId) -> SymbolId {
        if !symbol.is_nil() {
            let merged = self.merged_symbols.get(&symbol);
            if !merged.is_nil() {
                return merged;
            }
        }
        symbol
    }

    pub fn get_parent_of_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        let parent = self.ast.sym(symbol).parent;
        if !parent.is_nil() {
            let late_bound = self.get_late_bound_symbol(parent);
            return self.get_merged_symbol(late_bound);
        }
        SymbolId::NIL
    }

    pub fn record_merged_symbol(&mut self, target: SymbolId, source: SymbolId) {
        let ok = self.merged_symbols.set(source, target);
        self.map_set(ok);
    }

    pub fn get_symbol_if_same_reference(&mut self, s1: SymbolId, s2: SymbolId) -> SymbolId {
        let merged1 = self.get_merged_symbol(s1);
        let resolved1 = self.resolve_symbol(merged1);
        let reference1 = self.get_merged_symbol(resolved1);
        let merged2 = self.get_merged_symbol(s2);
        let resolved2 = self.resolve_symbol(merged2);
        let reference2 = self.get_merged_symbol(resolved2);
        if reference1 == reference2 {
            return s1;
        }
        SymbolId::NIL
    }

    pub fn get_export_symbol_of_value_symbol_if_exported(&self, symbol: SymbolId) -> SymbolId {
        let a = self.ast;
        let mut symbol = symbol;
        if !symbol.is_nil()
            && a.sym(symbol).flags.intersects(SymbolFlags::EXPORT_VALUE)
            && !a.sym(symbol).export_symbol.is_nil()
        {
            symbol = a.sym(symbol).export_symbol;
        }
        self.get_merged_symbol(symbol)
    }

    pub fn get_symbol_of_declaration(&mut self, node: NodeId) -> SymbolId {
        let symbol = self.ast.symbol(node);
        if !symbol.is_nil() {
            let late_bound = self.get_late_bound_symbol(symbol);
            return self.get_merged_symbol(late_bound);
        }
        SymbolId::NIL
    }

    // Get the merged symbol for a node. If you know the node is a `Declaration`, it is more type safe to use use `getSymbolOfDeclaration` instead.
    pub fn get_symbol_of_node(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        if a.has_declaration_data(node) && !a.symbol(node).is_nil() {
            let late_bound = self.get_late_bound_symbol(a.symbol(node));
            return self.get_merged_symbol(late_bound);
        }
        SymbolId::NIL
    }

    pub fn get_late_bound_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        let a = self.ast;
        let data = a.sym(symbol);
        if !data.flags.intersects(SymbolFlags::CLASS_MEMBER)
            || data.name != INTERNAL_SYMBOL_NAME_COMPUTED
        {
            return symbol;
        }
        let links = self.late_bound_links.get(symbol);
        if self.late_bound_links[links].late_symbol.is_nil()
            && some(data.declarations.as_slice(), |declaration| {
                self.has_late_bindable_name(declaration)
            })
        {
            // force late binding of members/exports. This will set the late-bound symbol
            let parent = self.get_merged_symbol(data.parent);
            if some(data.declarations.as_slice(), |declaration| {
                has_static_modifier(a, declaration)
            }) {
                self.get_exports_of_symbol(parent);
            } else {
                self.get_members_of_symbol(parent);
            }
        }
        if self.late_bound_links[links].late_symbol.is_nil() {
            self.late_bound_links[links].late_symbol = symbol;
        }
        self.late_bound_links[links].late_symbol
    }

    pub fn resolve_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        self.resolve_symbol_ex(symbol, false)
    }

    pub fn resolve_symbol_ex(&mut self, symbol: SymbolId, dont_resolve_alias: bool) -> SymbolId {
        if !dont_resolve_alias
            && is_non_local_alias(
                self.ast,
                symbol,
                SymbolFlags::VALUE | SymbolFlags::TYPE | SymbolFlags::NAMESPACE,
            )
        {
            return self.resolve_alias(symbol);
        }
        symbol
    }
}
