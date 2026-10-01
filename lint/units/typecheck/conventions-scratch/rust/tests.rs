use crate::arena::Arena;
use crate::checker::*;
use crate::flags::{SymbolFlags, TypeFlags};
use crate::golang::{List, Map, Memo, OrderedMap, SliceBuf};
use crate::ids::*;
use crate::internal::{InternalLog, StandInLog};
use crate::keys::{CacheHashKey, KeyBuilder, get_type_list_key, get_union_key};
use crate::shims::{Bump, StackCheck};
use crate::types::*;

fn checker<'a>(arena: &'a Bump, program: &'a Program<'a>) -> Checker<'a> {
    Checker {
        arena,
        program,
        stack_check: StackCheck::init(),
        internal: InternalLog::default(),
        stand_ins: StandInLog::default(),
        file_index_map: Map::make(),
        type_count: 0,
        symbol_count: 0,
        signature_count: 0,
        total_instantiation_count: 0,
        instantiation_count: 0,
        instantiation_depth: 0,
        current_node: NodeId::NIL,
        strict_null_checks: true,
        next_symbol_id: program.next_symbol_id,
        symbol_ids: Vec::new(),
        nodes: crate::arena::Overlay::new(program.nodes),
        symbols: crate::arena::Overlay::new(program.symbols),
        symbol_tables: Arena::new(),
        types: Arena::new(),
        signatures: Arena::new(),
        type_mappers: Arena::new(),
        type_aliases: Arena::new(),
        conditional_roots: Arena::new(),
        value_symbol_links: LinkStore::new(),
        type_alias_links: LinkStore::new(),
        alias_symbol_links: LinkStore::new(),
        node_links: LinkStore::new(),
        type_resolutions: Vec::new(),
        resolution_start: 0,
        active_mappers: Vec::new(),
        active_type_mappers_caches: Vec::new(),
        active_type_mappers_caches_len: 0,
        get_global_promise_type: Memo::default(),
        any_type: TypeId::NIL,
        error_type: TypeId::NIL,
        never_type: TypeId::NIL,
        intrinsic_marker_type: TypeId::NIL,
        unknown_signature: SignatureId::NIL,
        nil_sections: NilSections::default(),
        sink_sections: NilSections::default(),
        nil_cache: Map::default(),
        deferred_diagnostic_callbacks: Vec::new(),
        resolving_explicit_type_of_symbol: Vec::new(),
    }
}

fn program() -> (Vec<Node>, Vec<Symbol<'static>>) {
    let nodes = vec![
        Node::default(),
        Node {
            kind: 308,
            ..Default::default()
        },
    ];
    let symbols = vec![
        Symbol::default(),
        Symbol {
            name: b"bound",
            id: 1,
            flags: SymbolFlags::CLASS,
            ..Default::default()
        },
    ];
    (nodes, symbols)
}

#[test]
fn ids_arenas_and_lazy_symbol_ids() {
    let arena = Bump;
    let (nodes, symbols) = program();
    let program = Program {
        nodes: &nodes,
        symbols: &symbols,
        next_symbol_id: 1,
    };
    let mut c = checker(&arena, &program);
    assert!(c.symbols.is_frozen(SymbolId(1)));
    let a = c.symbols.alloc(Symbol {
        name: b"same",
        ..Default::default()
    });
    let b = c.symbols.alloc(Symbol {
        name: b"same",
        ..Default::default()
    });
    assert_eq!((a, b), (SymbolId(2), SymbolId(3)));
    // The second created symbol is asked first: it sorts first, as upstream's lazy ids make it.
    assert!(c.compare_symbols(b, a) < 0);
    assert_eq!(c.get_symbol_id(b), 2);
    assert_eq!(c.get_symbol_id(a), 3);
    assert_eq!(c.get_symbol_id(SymbolId(1)), 1);
    assert!(c.compare_symbols(a, b) > 0);
    // A write to a bound symbol is refused and counted, a read through nil is the zero object.
    c.symbols[SymbolId(1)].flags |= SymbolFlags::TRANSIENT;
    assert_eq!(c.symbols[SymbolId(1)].flags, SymbolFlags::CLASS);
    assert_eq!(c.symbols.writes_to_frozen, 1);
    assert_eq!(c.symbols[SymbolId::NIL].name, b"");
    assert_eq!(c.symbols[SymbolId(99)].name, b"");
}

#[test]
fn type_ids_are_creation_order_and_casts_do_not_panic() {
    let arena = Bump;
    let (nodes, symbols) = program();
    let program = Program {
        nodes: &nodes,
        symbols: &symbols,
        next_symbol_id: 1,
    };
    let mut c = checker(&arena, &program);
    c.any_type = c.new_intrinsic_type(TypeFlags::ANY, b"any");
    c.error_type = c.new_intrinsic_type(TypeFlags::ANY, b"error");
    let s = c.new_intrinsic_type(TypeFlags::STRING, b"string");
    let n = c.new_intrinsic_type(TypeFlags::NUMBER, b"number");
    assert_eq!(
        (c.any_type, c.error_type, s, n),
        (TypeId(1), TypeId(2), TypeId(3), TypeId(4))
    );
    assert_eq!(c.types[n].id, n);
    assert!(c.compare_types(s, n) < 0);
    assert!(c.compare_types(c.any_type, c.error_type) < 0);
    let f = c.new_literal_type(
        TypeFlags::BOOLEAN_LITERAL,
        LiteralValue::Boolean(false),
        TypeId::NIL,
    );
    assert_eq!(c.as_literal_type(f).regular_type, f);
    assert_eq!(c.internal.count(), 0);
    let _ = c.as_union_type(s).origin;
    assert_eq!(c.internal.count(), 1);
    let key: CacheHashKey = get_union_key(&mut c, List::NIL, s, TypeAliasId::NIL);
    assert!(key.is_zero());
    assert_eq!(
        c.internal.snapshot().last().map(|f| f.message),
        Some("Unhandled case in getUnionKey")
    );
    let mut types = [n, c.any_type, s, c.error_type];
    c.sort_types(&mut types);
    assert_eq!(types, [TypeId(1), TypeId(2), TypeId(3), TypeId(4)]);
    let sorted = c.clone_list(List::from_slice(&types));
    assert!(c.contains_type(sorted, s));
}

#[test]
fn resolution_stack_and_links() {
    let arena = Bump;
    let (nodes, symbols) = program();
    let program = Program {
        nodes: &nodes,
        symbols: &symbols,
        next_symbol_id: 1,
    };
    let mut c = checker(&arena, &program);
    let s = c.symbols.alloc(Symbol {
        name: b"T",
        ..Default::default()
    });
    assert!(c.push_type_resolution(
        TypeSystemEntity::Symbol(s),
        TypeSystemPropertyName::DeclaredType
    ));
    assert!(!c.push_type_resolution(
        TypeSystemEntity::Symbol(s),
        TypeSystemPropertyName::DeclaredType
    ));
    assert!(!c.pop_type_resolution());
    assert_eq!(c.internal.count(), 0);
    assert!(!c.pop_type_resolution());
    assert_eq!(c.internal.count(), 1);
    c.error_type = c.new_intrinsic_type(TypeFlags::ANY, b"error");
    let t = c.get_declared_type_of_type_alias(s);
    assert_eq!(t, c.error_type);
    let names: Vec<_> = c.stand_ins.snapshot().into_iter().map(|e| e.0).collect();
    assert_eq!(
        names,
        [
            "getTypeFromTypeNode",
            "getLocalTypeParametersOfClassOrInterfaceOrTypeAlias"
        ]
    );
}

#[test]
fn go_values() {
    let arena = Bump;
    let nil: List<'_, u32> = List::NIL;
    let empty: List<'_, u32> = List::from_slice(&[]);
    assert!(nil.is_nil() && !empty.is_nil() && nil.len() == 0 && empty.len() == 0);
    assert_eq!(nil.at(3usize), 0);
    let mut buf = SliceBuf::<u32>::nil();
    buf.extend(empty);
    assert!(buf.is_nil());
    buf.push(7);
    assert!(!buf.is_nil());
    assert!(SliceBuf::<u32>::make(0, 4).len() == 0 && !SliceBuf::<u32>::make(0, 4).is_nil());
    let stored = List::from_slice(arena.alloc_slice_copy(&buf.items));
    assert!(
        stored.same(stored) && !stored.same(List::from_slice(arena.alloc_slice_copy(&buf.items)))
    );
    let mut m: Map<u32, u32> = Map::default();
    assert!(m.is_nil() && m.get(&1) == 0 && !m.set(1, 2));
    m = Map::make();
    assert!(m.set(1, 2) && m.get_ok(&1) == Some(2) && m.get_ok(&2).is_none());
    let mut o: OrderedMap<u32, u32> = OrderedMap::make();
    for k in [5, 1, 9, 1] {
        assert!(o.set(k, k * 10));
    }
    let order: Vec<_> = (0..o.len() as usize)
        .filter_map(|i| o.entry_at(i))
        .collect();
    assert_eq!(order, [(5, 50), (1, 10), (9, 90)]);
}

#[test]
fn key_builder_stream_and_go_sorts() {
    let mut b = KeyBuilder::default();
    let mut stream = Vec::new();
    for i in 0..100u32 {
        b.write_uint32(i);
        stream.extend_from_slice(&i.to_le_bytes());
        b.write_byte(b'|');
        stream.push(b'|');
    }
    let long = [b'x'; 300];
    b.write_string(&long);
    stream.extend_from_slice(&long);
    b.write_int(-1);
    stream.extend_from_slice(&u64::MAX.to_le_bytes());
    assert_eq!(b.hash(), CacheHashKey::of(&stream));
    assert_eq!(
        get_type_list_key(List::NIL),
        get_type_list_key(List::from_slice(&[]))
    );
    assert_ne!(
        get_type_list_key(List::from_slice(&[TypeId(1)])),
        get_type_list_key(List::from_slice(&[TypeId(2)]))
    );

    let mut seed = 12345u64;
    for n in [0usize, 1, 2, 12, 13, 19, 20, 21, 40, 41, 257] {
        let mut data: Vec<(u32, u32)> = (0..n)
            .map(|i| {
                seed = seed
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                ((seed >> 60) as u32, i as u32)
            })
            .collect();
        let mut expected = data.clone();
        expected.sort_by_key(|e| e.0);
        crate::slices::sort_stable_func(&mut data, |a, b| a.0 as isize - b.0 as isize);
        assert_eq!(data, expected, "stable sort of {n}");
        let keys: Vec<u32> = expected.iter().map(|e| e.0).collect();
        for probe in 0..17u32 {
            let (index, found) =
                crate::slices::binary_search_func(&keys, probe, |a, b| a as isize - b as isize);
            assert_eq!(index, keys.partition_point(|&k| k < probe));
            assert_eq!(found, keys.contains(&probe));
        }
    }
}
