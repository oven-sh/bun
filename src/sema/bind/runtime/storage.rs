use super::{
    AnnexBFunction, Binding, BindingKind, BindingStability, CodeUnit, CommonJsVariable,
    EarlyRedeclaration, EvalScope, FunctionFlags, ImplicitReference, ImplicitReferenceKind,
    ParameterVarCopy, PrivateName, PrivateNameId, RuntimeBindings, RuntimeBindingsIn, StoreKind,
    SymbolStore,
};
use crate::bind::decorator_metadata::MetadataReference;
use crate::bind::{Decl, ScopeId, SymbolId};
use crate::hir::*;
use crate::session::{Arena, ArenaBox};
use crate::util::SharedSort;

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

fn sort_by_key<T, K: Ord>(list: &mut [T], mut key: impl FnMut(&T) -> K) {
    if !list.is_sorted_by_key(&mut key) {
        list.shared_sort_by_key(key);
    }
}

trait Stored<'s, T> {
    fn from_growable(list: Vec<T>, arena: &'s Arena) -> Self;
}

impl<'s, T: Copy> Stored<'s, T> for Fixed<'s, T> {
    fn from_growable(mut list: Vec<T>, arena: &'s Arena) -> Self {
        copy_to_arena(&mut list, arena)
    }
}

impl<'s, T> Stored<'s, T> for ArenaFew<'s, T> {
    fn from_growable(list: Vec<T>, arena: &'s Arena) -> Self {
        few_to_arena(list, arena)
    }
}

macro_rules! define_tables {
    ($visibility:vis struct $name:ident<$storage:ident> {
        $(values { $($value:ident: $value_type:ty,)* })?
        $(tables { $($table:ident: $table_type:ty,)* })?
        $(maps { $($map:ident: $map_type:ty,)* })?
        $(sorted { $($sorted:ident: $sorted_type:ty = $key:expr,)* })?
        $(lists { $($list:ident: $list_type:ty,)* })?
    }) => {
        #[derive(Default)]
        $visibility struct $name<$storage: Storage> {
            $($(pub(in crate::bind) $value: $value_type,)*)?
            $($(pub(in crate::bind) $table: $table_type,)*)?
            $($(pub(in crate::bind) $map: $map_type,)*)?
            $($(pub(in crate::bind) $sorted: $sorted_type,)*)?
            $($(pub(in crate::bind) $list: $list_type,)*)?
        }

        impl $name<Growable> {
            pub(super) fn sort(&mut self) {
                $($(self.$table.sort();)*)?
                $($(sort_by_key(&mut self.$map, |entry| entry.0);)*)?
                $($(sort_by_key(&mut self.$sorted, $key);)*)?
            }

            pub(super) fn is_sorted(&self) -> bool {
                true
                    $($(&& self.$table.is_sorted())*)?
                    $($(&& self.$map.is_sorted_by_key(|entry| entry.0))*)?
                    $($(&& self.$sorted.is_sorted_by_key($key))*)?
            }

            fn into_arena<'s>(self, arena: &'s Arena) -> $name<InArena<'s>> {
                $name {
                    $($($value: self.$value,)*)?
                    $($($table: self.$table.into_arena(arena),)*)?
                    $($($map: Stored::from_growable(self.$map, arena),)*)?
                    $($($sorted: Stored::from_growable(self.$sorted, arena),)*)?
                    $($($list: Stored::from_growable(self.$list, arena),)*)?
                }
            }
        }
    };
}

define_tables! {
    pub struct RuntimeTablesIn<S> {
        values {
            is_module: bool,
            depends_on_sloppy_mode: bool,
            file_uses_arguments: bool,
            import_meta_may_be_modified: bool,
            hoists_top_level_variables: bool,
            first_appended_symbol: u32,
            appended_symbol_end: u32,
        }
        tables {
            declarations: RuntimeDeclarationsIn<S>,
            references: RuntimeReferencesIn<S>,
            private_names: PrivateNamesIn<S>,
            stability: BindingStabilitiesIn<S>,
        }
        maps {
            field_initializer_scopes: S::Few<(MemberId, ScopeId)>,
        }
        sorted {
            early_error_redeclarations: S::Few<u32> = |&index| index,
        }
        lists {
            strict_scopes: S::List<u64>,
            function_flags: S::List<FunctionFlags>,
        }
    }
}

define_tables! {
    pub(in crate::bind) struct RuntimeDeclarationsIn<S> {
        values {
            goal_independent_redeclaration_count: u32,
        }
        maps {
            declared_symbols: S::Few<(Decl, SymbolId)>,
            inner_class_symbols: S::Few<(ClassId, SymbolId)>,
            own_scopes: S::List<(StmtId, ScopeId)>,
        }
        sorted {
            annex_b_functions: S::Few<AnnexBFunction> = |entry| entry.function,
            parameter_var_copies: S::Few<ParameterVarCopy> = |entry| entry.function,
        }
        lists {
            import_default_symbols: S::List<SymbolId>,
            import_namespace_symbols: S::List<SymbolId>,
            import_spec_symbols: S::List<SymbolId>,
            import_equals_symbols: S::Few<SymbolId>,
            symbol_scopes: S::List<ScopeId>,
            scope_units: S::List<CodeUnit>,
            valueless_symbols: S::List<u64>,
            binding_kinds: S::List<BindingKind>,
            early_redeclarations: S::Few<EarlyRedeclaration>,
        }
    }
}

define_tables! {
    pub(in crate::bind) struct RuntimeReferencesIn<S> {
        maps {
            ident_bindings: S::List<(ExprId, Binding)>,
            initialized_bindings: S::Few<(PatId, Binding)>,
            exported_bindings: S::Few<(ExportSpecId, Binding)>,
            entity_root_bindings: S::Few<(ImportEqualsId, Binding)>,
            redeclared_commonjs_variables: S::Few<(SymbolId, CommonJsVariable)>,
            unbound_name_stores: S::Few<(ExprId, StoreKind)>,
            dynamic_ident_lookups: S::Few<(ExprId, ScopeId)>,
            dynamic_declarator_lookups: S::Few<(PatId, ScopeId)>,
            eval_scopes: S::Few<(ExprId, EvalScope)>,
            jump_targets: S::Few<(StmtId, StmtId)>,
        }
        sorted {
            stores: S::List<SymbolStore> = |store| (store.symbol, store.target),
            implicit_references: S::Few<ImplicitReference> = implicit_reference_order,
        }
        lists {
            evaluated_idents: S::List<u64>,
            eval_visible_symbols: S::List<u64>,
            store_targets: S::List<u64>,
        }
    }
}

define_tables! {
    pub(in crate::bind) struct PrivateNamesIn<S> {
        maps {
            references: S::Few<(ExprId, PrivateNameId)>,
            members: S::Few<(MemberId, PrivateNameId)>,
        }
        sorted {
            names: S::Few<PrivateName> = |name| (name.class, name.first_member),
        }
    }
}

define_tables! {
    pub(in crate::bind) struct BindingStabilitiesIn<S> {
        lists {
            stabilities: S::List<BindingStability>,
            initializers: S::List<Option<Decl>>,
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

impl RuntimeBindings<'_> {
    pub(in crate::bind) fn share<'s>(&self) -> RuntimeBindings<'s> {
        debug_assert!(!self.is_computed());
        RuntimeBindingsIn { tables: None }
    }
}
