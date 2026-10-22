use super::{
    BindingStabilitiesIn, ImplicitReference, ImplicitReferenceKind, PrivateNamesIn,
    RuntimeBindings, RuntimeBindingsIn, RuntimeDeclarationsIn, RuntimeReferencesIn,
    RuntimeTablesIn,
};
use crate::bind::decorator_metadata::MetadataReference;
use crate::hir::*;
use crate::session::{Arena, ArenaBox};

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum ImplicitReferenceOrder {
    Jsx { element: ExprId, is_fragment: bool },
    DecoratorMetadata(MetadataReference),
}

fn implicit_reference_order(reference: &ImplicitReference) -> ImplicitReferenceOrder {
    let is_fragment = match reference.kind {
        ImplicitReferenceKind::JsxFactory => false,
        ImplicitReferenceKind::JsxFragment => true,
        ImplicitReferenceKind::DecoratorMetadata(recorded) => {
            return ImplicitReferenceOrder::DecoratorMetadata(recorded);
        }
    };
    let NodeData::Expr(element) = reference.node else {
        unreachable!("a JSX root is recorded at its element");
    };
    ImplicitReferenceOrder::Jsx {
        element,
        is_fragment,
    }
}

fn share_few<'s, T: Clone>(list: &ArenaFew<'_, T>, arena: &'s Arena) -> ArenaFew<'s, T> {
    ArenaFew::from_iter_in(list.iter().cloned(), arena)
}

impl RuntimeDeclarationsIn<Growable> {
    fn is_sorted(&self) -> bool {
        self.pattern_symbols.is_sorted_by_key(|entry| entry.0)
            && self.function_symbols.is_sorted_by_key(|entry| entry.0)
            && self.class_symbols.is_sorted_by_key(|entry| entry.0)
            && self.enum_symbols.is_sorted_by_key(|entry| entry.0)
            && self.module_symbols.is_sorted_by_key(|entry| entry.0)
            && self.inner_class_symbols.is_sorted_by_key(|entry| entry.0)
            && self.export_expression_symbols.is_sorted_by_key(|entry| entry.0)
            && self.own_scopes.is_sorted_by_key(|entry| entry.0)
            && self.annex_b_functions.is_sorted_by_key(|entry| entry.function)
            && self.parameter_var_copies.is_sorted_by_key(|entry| entry.function)
    }

    fn into_arena<'s>(mut self, arena: &'s Arena) -> RuntimeDeclarationsIn<InArena<'s>> {
        RuntimeDeclarationsIn {
            pattern_symbols: few_to_arena(self.pattern_symbols, arena),
            function_symbols: few_to_arena(self.function_symbols, arena),
            class_symbols: few_to_arena(self.class_symbols, arena),
            enum_symbols: few_to_arena(self.enum_symbols, arena),
            module_symbols: few_to_arena(self.module_symbols, arena),
            inner_class_symbols: few_to_arena(self.inner_class_symbols, arena),
            import_default_symbols: copy_to_arena(&mut self.import_default_symbols, arena),
            import_namespace_symbols: copy_to_arena(&mut self.import_namespace_symbols, arena),
            import_spec_symbols: copy_to_arena(&mut self.import_spec_symbols, arena),
            import_equals_symbols: few_to_arena(self.import_equals_symbols, arena),
            export_expression_symbols: few_to_arena(self.export_expression_symbols, arena),
            own_scopes: copy_to_arena(&mut self.own_scopes, arena),
            symbol_scopes: copy_to_arena(&mut self.symbol_scopes, arena),
            scope_units: copy_to_arena(&mut self.scope_units, arena),
            valueless_symbols: copy_to_arena(&mut self.valueless_symbols, arena),
            binding_kinds: copy_to_arena(&mut self.binding_kinds, arena),
            annex_b_functions: few_to_arena(self.annex_b_functions, arena),
            parameter_var_copies: few_to_arena(self.parameter_var_copies, arena),
            early_redeclarations: few_to_arena(self.early_redeclarations, arena),
            goal_independent_redeclaration_count: self.goal_independent_redeclaration_count,
        }
    }
}

impl RuntimeReferencesIn<Growable> {
    fn is_sorted(&self) -> bool {
        self.ident_bindings.is_sorted_by_key(|entry| entry.0)
            && self.initialized_bindings.is_sorted_by_key(|entry| entry.0)
            && self.exported_bindings.is_sorted_by_key(|entry| entry.0)
            && self.entity_root_bindings.is_sorted_by_key(|entry| entry.0)
            && self.redeclared_commonjs_variables.is_sorted_by_key(|entry| entry.0)
            && self.stores.is_sorted_by_key(|store| (store.symbol, store.target))
            && self.unbound_name_stores.is_sorted_by_key(|entry| entry.0)
            && self.dynamic_ident_lookups.is_sorted_by_key(|entry| entry.0)
            && self.dynamic_declarator_lookups.is_sorted_by_key(|entry| entry.0)
            && self.eval_scopes.is_sorted_by_key(|entry| entry.0)
            && self.jump_targets.is_sorted_by_key(|entry| entry.0)
            && self.implicit_references.is_sorted_by_key(implicit_reference_order)
    }

    fn into_arena<'s>(mut self, arena: &'s Arena) -> RuntimeReferencesIn<InArena<'s>> {
        RuntimeReferencesIn {
            evaluated_idents: copy_to_arena(&mut self.evaluated_idents, arena),
            ident_bindings: copy_to_arena(&mut self.ident_bindings, arena),
            initialized_bindings: few_to_arena(self.initialized_bindings, arena),
            exported_bindings: few_to_arena(self.exported_bindings, arena),
            entity_root_bindings: few_to_arena(self.entity_root_bindings, arena),
            redeclared_commonjs_variables: few_to_arena(self.redeclared_commonjs_variables, arena),
            eval_visible_symbols: copy_to_arena(&mut self.eval_visible_symbols, arena),
            stores: copy_to_arena(&mut self.stores, arena),
            unbound_name_stores: few_to_arena(self.unbound_name_stores, arena),
            store_targets: copy_to_arena(&mut self.store_targets, arena),
            dynamic_ident_lookups: few_to_arena(self.dynamic_ident_lookups, arena),
            dynamic_declarator_lookups: few_to_arena(self.dynamic_declarator_lookups, arena),
            eval_scopes: few_to_arena(self.eval_scopes, arena),
            jump_targets: few_to_arena(self.jump_targets, arena),
            implicit_references: few_to_arena(self.implicit_references, arena),
        }
    }
}

impl PrivateNamesIn<Growable> {
    fn is_sorted(&self) -> bool {
        self.names.is_sorted_by_key(|name| (name.class, name.first_member))
            && self.references.is_sorted_by_key(|entry| entry.0)
            && self.members.is_sorted_by_key(|entry| entry.0)
    }

    fn into_arena<'s>(self, arena: &'s Arena) -> PrivateNamesIn<InArena<'s>> {
        PrivateNamesIn {
            names: few_to_arena(self.names, arena),
            references: few_to_arena(self.references, arena),
            members: few_to_arena(self.members, arena),
        }
    }
}

impl BindingStabilitiesIn<Growable> {
    fn into_arena<'s>(mut self, arena: &'s Arena) -> BindingStabilitiesIn<InArena<'s>> {
        BindingStabilitiesIn {
            stabilities: copy_to_arena(&mut self.stabilities, arena),
            initializers: copy_to_arena(&mut self.initializers, arena),
        }
    }
}

impl RuntimeTablesIn<Growable> {
    pub(super) fn is_sorted(&self) -> bool {
        self.field_initializer_scopes.is_sorted_by_key(|entry| entry.0)
            && self.early_error_redeclarations.is_sorted()
            && self.declarations.is_sorted()
            && self.references.is_sorted()
            && self.private_names.is_sorted()
    }

    fn into_arena<'s>(mut self, arena: &'s Arena) -> RuntimeTablesIn<InArena<'s>> {
        RuntimeTablesIn {
            is_module: self.is_module,
            depends_on_sloppy_mode: self.depends_on_sloppy_mode,
            file_uses_arguments: self.file_uses_arguments,
            import_meta_may_be_modified: self.import_meta_may_be_modified,
            hoists_top_level_variables: self.hoists_top_level_variables,
            first_appended_symbol: self.first_appended_symbol,
            appended_symbol_end: self.appended_symbol_end,
            strict_scopes: copy_to_arena(&mut self.strict_scopes, arena),
            function_flags: copy_to_arena(&mut self.function_flags, arena),
            field_initializer_scopes: few_to_arena(self.field_initializer_scopes, arena),
            early_error_redeclarations: few_to_arena(self.early_error_redeclarations, arena),
            declarations: self.declarations.into_arena(arena),
            references: self.references.into_arena(arena),
            private_names: self.private_names.into_arena(arena),
            stability: self.stability.into_arena(arena),
        }
    }
}

impl RuntimeBindingsIn<Growable> {
    pub(in crate::bind) fn clear(&mut self) {
        self.tables = None;
    }

    pub(in crate::bind) fn move_to_arena<'s>(&mut self, arena: &'s Arena) -> RuntimeBindings<'s> {
        let tables = self.tables.take();
        RuntimeBindingsIn {
            tables: tables.map(|tables| ArenaBox::new_in(tables.into_arena(arena), arena)),
        }
    }
}

impl RuntimeDeclarationsIn<InArena<'_>> {
    fn share<'s>(&'s self, arena: &'s Arena) -> RuntimeDeclarationsIn<InArena<'s>> {
        RuntimeDeclarationsIn {
            pattern_symbols: share_few(&self.pattern_symbols, arena),
            function_symbols: share_few(&self.function_symbols, arena),
            class_symbols: share_few(&self.class_symbols, arena),
            enum_symbols: share_few(&self.enum_symbols, arena),
            module_symbols: share_few(&self.module_symbols, arena),
            inner_class_symbols: share_few(&self.inner_class_symbols, arena),
            import_default_symbols: Fixed::shared(&self.import_default_symbols),
            import_namespace_symbols: Fixed::shared(&self.import_namespace_symbols),
            import_spec_symbols: Fixed::shared(&self.import_spec_symbols),
            import_equals_symbols: share_few(&self.import_equals_symbols, arena),
            export_expression_symbols: share_few(&self.export_expression_symbols, arena),
            own_scopes: Fixed::shared(&self.own_scopes),
            symbol_scopes: Fixed::shared(&self.symbol_scopes),
            scope_units: Fixed::shared(&self.scope_units),
            valueless_symbols: Fixed::shared(&self.valueless_symbols),
            binding_kinds: Fixed::shared(&self.binding_kinds),
            annex_b_functions: share_few(&self.annex_b_functions, arena),
            parameter_var_copies: share_few(&self.parameter_var_copies, arena),
            early_redeclarations: share_few(&self.early_redeclarations, arena),
            goal_independent_redeclaration_count: self.goal_independent_redeclaration_count,
        }
    }
}

impl RuntimeReferencesIn<InArena<'_>> {
    fn share<'s>(&'s self, arena: &'s Arena) -> RuntimeReferencesIn<InArena<'s>> {
        RuntimeReferencesIn {
            evaluated_idents: Fixed::shared(&self.evaluated_idents),
            ident_bindings: Fixed::shared(&self.ident_bindings),
            initialized_bindings: share_few(&self.initialized_bindings, arena),
            exported_bindings: share_few(&self.exported_bindings, arena),
            entity_root_bindings: share_few(&self.entity_root_bindings, arena),
            redeclared_commonjs_variables: share_few(&self.redeclared_commonjs_variables, arena),
            eval_visible_symbols: Fixed::shared(&self.eval_visible_symbols),
            stores: Fixed::shared(&self.stores),
            unbound_name_stores: share_few(&self.unbound_name_stores, arena),
            store_targets: Fixed::shared(&self.store_targets),
            dynamic_ident_lookups: share_few(&self.dynamic_ident_lookups, arena),
            dynamic_declarator_lookups: share_few(&self.dynamic_declarator_lookups, arena),
            eval_scopes: share_few(&self.eval_scopes, arena),
            jump_targets: share_few(&self.jump_targets, arena),
            implicit_references: share_few(&self.implicit_references, arena),
        }
    }
}

impl PrivateNamesIn<InArena<'_>> {
    fn share<'s>(&'s self, arena: &'s Arena) -> PrivateNamesIn<InArena<'s>> {
        PrivateNamesIn {
            names: share_few(&self.names, arena),
            references: share_few(&self.references, arena),
            members: share_few(&self.members, arena),
        }
    }
}

impl BindingStabilitiesIn<InArena<'_>> {
    fn share(&self) -> BindingStabilitiesIn<InArena<'_>> {
        BindingStabilitiesIn {
            stabilities: Fixed::shared(&self.stabilities),
            initializers: Fixed::shared(&self.initializers),
        }
    }
}

impl RuntimeTablesIn<InArena<'_>> {
    fn share<'s>(&'s self, arena: &'s Arena) -> RuntimeTablesIn<InArena<'s>> {
        RuntimeTablesIn {
            is_module: self.is_module,
            depends_on_sloppy_mode: self.depends_on_sloppy_mode,
            file_uses_arguments: self.file_uses_arguments,
            import_meta_may_be_modified: self.import_meta_may_be_modified,
            hoists_top_level_variables: self.hoists_top_level_variables,
            first_appended_symbol: self.first_appended_symbol,
            appended_symbol_end: self.appended_symbol_end,
            strict_scopes: Fixed::shared(&self.strict_scopes),
            function_flags: Fixed::shared(&self.function_flags),
            field_initializer_scopes: share_few(&self.field_initializer_scopes, arena),
            early_error_redeclarations: share_few(&self.early_error_redeclarations, arena),
            declarations: self.declarations.share(arena),
            references: self.references.share(arena),
            private_names: self.private_names.share(arena),
            stability: self.stability.share(),
        }
    }
}

impl RuntimeBindings<'_> {
    pub(in crate::bind) fn share<'s>(&'s self, arena: &'s Arena) -> RuntimeBindings<'s> {
        let tables = self.tables.as_deref();
        RuntimeBindingsIn {
            tables: tables.map(|tables| ArenaBox::new_in(tables.share(arena), arena)),
        }
    }
}
