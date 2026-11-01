use super::queries::find_entry;
use super::storage::RuntimeDeclarationsIn;
use super::{
    Binding, BindingKind, BindingStability, ImplicitReference, ImplicitReferenceKind,
    PrivateMembers, PrivateName, PrivateNameId, RuntimeBindings, RuntimeBindingsIn,
    RuntimeTablesIn, StoreKind, SymbolStore,
};
use crate::atom::known;
use crate::bind::decorator_metadata::MetadataReference;
use crate::bind::{Decl, ScopeId, SymbolId};
use crate::hir::*;
use crate::session::Arena;

fn computed(tables: RuntimeTablesIn<Growable>) -> RuntimeBindingsIn<Growable> {
    RuntimeBindingsIn {
        tables: Some(Box::new(tables)),
    }
}

fn private_field(class: u32, member: u32) -> PrivateName {
    PrivateName {
        class: ClassId(class),
        name: known::value,
        first_member: MemberId(member),
        members: PrivateMembers::Field(MemberId(member)),
        is_static: false,
    }
}

#[test]
fn find_entry_misses_absent_key() {
    let list = [(StmtId(1), ScopeId(4)), (StmtId(3), ScopeId(5))];
    assert_eq!(find_entry(&list, StmtId(3)), Some(&ScopeId(5)));
    assert_eq!(find_entry(&list, StmtId(2)), None);
    assert_eq!(find_entry::<StmtId, ScopeId>(&[], StmtId(0)), None);
}

#[test]
#[should_panic(expected = "bound without BindOptions::runtime")]
fn uncomputed_tables_panic() {
    let runtime = RuntimeBindingsIn::<Growable>::default();
    assert!(!runtime.is_computed());
    let _ = runtime.references.stores.len();
}

#[test]
fn computed_tables_are_readable() {
    let runtime = computed(RuntimeTablesIn::default());
    assert!(runtime.is_computed());
    assert!(runtime.references.stores.is_empty());
}

#[test]
fn binding_from_symbol() {
    assert_eq!(
        Binding::from_symbol(SymbolId(3)),
        Binding::Symbol(SymbolId(3))
    );
    assert_eq!(Binding::from_symbol(SymbolId::NONE), Binding::Free);
}

#[test]
fn defaults_are_the_answers_that_permit_nothing() {
    assert_eq!(BindingKind::default(), BindingKind::NoBinding);
    assert_eq!(BindingStability::default(), BindingStability::NoBinding);
}

#[test]
fn immutable_binding_kinds() {
    let immutable = [
        BindingKind::Import,
        BindingKind::Const,
        BindingKind::ClassInnerName,
        BindingKind::FunctionName,
    ];
    assert!(immutable.iter().all(|kind| kind.is_immutable()));
    let mutable = [
        BindingKind::NoBinding,
        BindingKind::TypeScriptContainer,
        BindingKind::Var,
        BindingKind::Let,
        BindingKind::SimpleCatchParameter,
        BindingKind::Class,
        BindingKind::Function,
        BindingKind::Parameter,
    ];
    assert!(!mutable.iter().any(|kind| kind.is_immutable()));
}

#[test]
fn created_scope_without_entry_is_none() {
    let declarations = RuntimeDeclarationsIn::<Growable> {
        own_scopes: vec![(StmtId(1), ScopeId(4))],
        ..Default::default()
    };
    assert_eq!(declarations.created_scope(StmtId(1)), ScopeId(4));
    assert_eq!(declarations.created_scope(StmtId(2)), ScopeId::NONE);
}

fn assert_moved_lists(runtime: &RuntimeBindings<'_>) {
    assert_eq!(
        runtime.field_initializer_scopes(),
        [(MemberId(1), ScopeId(8))]
    );
    assert_eq!(runtime.private_class(ExprId(3)), Some(ClassId(1)));
    assert_eq!(runtime.private_class(ExprId(5)), Some(ClassId(0)));
    assert_eq!(runtime.private_class(ExprId(4)), None);
}

#[test]
fn lists_reach_arena() {
    let arena = Arena::new();
    let mut tables = RuntimeTablesIn::<Growable> {
        field_initializer_scopes: vec![(MemberId(1), ScopeId(8))],
        ..Default::default()
    };
    tables.private_names.names = vec![private_field(0, 2), private_field(1, 0)];
    tables.private_names.references =
        vec![(ExprId(3), PrivateNameId(1)), (ExprId(5), PrivateNameId(0))];
    let mut growable = computed(tables);
    let moved = growable.move_to_arena(&arena);
    assert!(!growable.is_computed());
    assert_moved_lists(&moved);
}

#[test]
fn uncomputed_tables_stay_uncomputed_in_the_arena() {
    let arena = Arena::new();
    let moved = RuntimeBindingsIn::<Growable>::default().move_to_arena(&arena);
    assert!(!moved.is_computed());
    assert!(!moved.share().is_computed());
}

#[test]
fn clear_drops_the_tables() {
    let mut runtime = computed(RuntimeTablesIn::default());
    runtime.clear();
    assert!(!runtime.is_computed());
}

#[test]
fn unsorted_declarations_are_detected() {
    let mut tables = RuntimeTablesIn::<Growable>::default();
    assert!(tables.is_sorted());
    tables.declarations.own_scopes = vec![(StmtId(1), ScopeId(2)), (StmtId(2), ScopeId(1))];
    assert!(tables.is_sorted());
    tables.declarations.own_scopes.reverse();
    assert!(!tables.is_sorted());
}

#[test]
fn unsorted_declared_symbols_are_detected() {
    let mut tables = RuntimeTablesIn::<Growable>::default();
    tables.declarations.declared_symbols = vec![
        (Decl::Class(ClassId(0)), SymbolId(5)),
        (Decl::Class(ClassId(2)), SymbolId(4)),
    ];
    assert!(tables.is_sorted());
    tables.declarations.declared_symbols.reverse();
    assert!(!tables.is_sorted());
}

#[test]
fn stores_are_sorted_by_symbol_then_target() {
    let store = |symbol, target| SymbolStore {
        symbol: SymbolId(symbol),
        target: ExprId(target),
        kind: StoreKind::Assign,
    };
    let mut tables = RuntimeTablesIn::<Growable>::default();
    tables.references.stores = vec![store(1, 9), store(2, 3), store(2, 7)];
    assert!(tables.is_sorted());
    tables.references.stores.swap(1, 2);
    assert!(!tables.is_sorted());
}

#[test]
fn jsx_references_precede_decorator_metadata() {
    let reference = |node, kind| ImplicitReference {
        node,
        kind,
        name: known::React,
        binding: Binding::Free,
    };
    let type_name = |node| {
        let recorded = MetadataReference::TypeName(TypeNodeId(node));
        reference(
            NodeData::File,
            ImplicitReferenceKind::DecoratorMetadata(recorded),
        )
    };
    let sorted = vec![
        reference(NodeData::Expr(ExprId(4)), ImplicitReferenceKind::JsxFactory),
        reference(
            NodeData::Expr(ExprId(4)),
            ImplicitReferenceKind::JsxFragment,
        ),
        reference(NodeData::Expr(ExprId(9)), ImplicitReferenceKind::JsxFactory),
        type_name(1),
        type_name(3),
    ];
    for (first, second) in [(0, 1), (1, 2), (2, 3), (3, 4)] {
        let mut tables = RuntimeTablesIn::<Growable>::default();
        tables.references.implicit_references = sorted.clone();
        assert!(tables.is_sorted());
        tables.references.implicit_references.swap(first, second);
        assert!(!tables.is_sorted(), "{first} and {second}");
    }
}

#[test]
fn unsorted_top_level_and_private_lists_are_detected() {
    let mut tables = RuntimeTablesIn::<Growable> {
        field_initializer_scopes: vec![(MemberId(1), ScopeId(8)), (MemberId(2), ScopeId(7))],
        ..Default::default()
    };
    tables.private_names.names = vec![private_field(0, 2), private_field(1, 0)];
    assert!(tables.is_sorted());
    tables.field_initializer_scopes.reverse();
    assert!(!tables.is_sorted());
    tables.field_initializer_scopes.reverse();
    tables.private_names.names.reverse();
    assert!(!tables.is_sorted());
}
