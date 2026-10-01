use crate::ast::ast_generated::NodeFactory;
use crate::ast::builder::FileBuilder;
use crate::ast::diagnostic::{Arg, Diagnostics, SourceFiles};
use crate::ast::factory::NodeSink;
use crate::ast::file::{File, IdAllocator, SourceFileData};
use crate::ast::flags_generated::{NodeFlags, SymbolFlags, TokenFlags};
use crate::ast::kind_generated::Kind;
use crate::ast::open::Open;
use crate::ast::reader::{Ast, Frozen};
use crate::bindprobe::bind_probe;
use crate::checker::checker::{Checker, TypeSystemEntity, TypeSystemPropertyName};
use crate::checker::flags_generated::{
    InferenceFlags, InferencePriority, IntersectionState, ObjectFlags, RelationComparisonResult,
    TypeFlags,
};
use crate::checker::ids::*;
use crate::checker::keys::{
    CacheHashKey, KeyBuilder, get_alias_key, get_relation_key, get_type_list_key, get_union_key,
};
use crate::checker::mapper::{MapperTargets, TypeMapper};
use crate::checker::program::{Program, ProgramFiles, ResolvedProgram};
use crate::checker::relater::{RelationKind, TypeComparer};
use crate::checker::types::{Ternary, TypeAlias, TypeData, TypeParameter};
use crate::diagnostics::{self, Locale, MessageId};
use crate::diagnosticwriter::{FormattingOptions, write_format_diagnostics};
use crate::tscore::golang::{List, Map, SliceBuf};
use crate::tscore::ids::{DiagnosticId, ModifierListId, NodeId, NodeListId, SymbolId, TypeId};
use crate::tscore::internal::FaultKind;
use crate::tscore::lines::compute_ecma_line_starts;
use crate::tscore::stable::Arena as Slices;
use crate::tscore::text::TextRange;
use bun_core::StackCheck;
use std::cell::Cell;
use std::rc::Rc;

const TEXT: &[u8] = b"type A = A;\nconst x: number = \"s\";\n";

// The nodes of TEXT that the tests name.
#[derive(Clone, Copy, Default)]
struct Nodes {
    root: NodeId,
    alias: NodeId,
    alias_type: NodeId,
    declaration: NodeId,
    name: NodeId,
}

// `type A = A;` and `const x: number = "s";` made the way a parser makes them: children before parents.
fn build(ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(TEXT);
    let alias_name = b.new_identifier(b"A");
    b.set_loc(alias_name, TextRange::new(5, 6));
    let reference_name = b.new_identifier(b"A");
    b.set_loc(reference_name, TextRange::new(9, 10));
    let reference = b.new_type_reference_node(reference_name, NodeListId::NIL);
    b.set_loc(reference, TextRange::new(9, 10));
    let alias =
        b.new_type_alias_declaration(ModifierListId::NIL, alias_name, NodeListId::NIL, reference);
    b.set_loc(alias, TextRange::new(0, 11));
    let name = b.new_identifier(b"x");
    b.set_loc(name, TextRange::new(18, 19));
    let type_node = b.new_keyword_type_node(Kind::NumberKeyword);
    b.set_loc(type_node, TextRange::new(20, 27));
    let initializer = b.new_string_literal(b"s", TokenFlags::NONE);
    b.set_loc(initializer, TextRange::new(29, 33));
    let declaration = b.new_variable_declaration(name, NodeId::NIL, type_node, initializer);
    b.set_loc(declaration, TextRange::new(17, 33));
    let declarations = b.new_node_list(&[declaration]);
    let list = b.new_variable_declaration_list(declarations, NodeFlags::CONST);
    b.set_loc(list, TextRange::new(11, 33));
    let statement = b.new_variable_statement(ModifierListId::NIL, list);
    b.set_loc(statement, TextRange::new(11, 34));
    let statements = b.new_node_list(&[alias, statement]);
    let eof = b.new_token(Kind::EndOfFile);
    b.set_loc(eof, TextRange::new(34, 35));
    let root = b.new_source_file(statements, eof);
    b.set_loc(root, TextRange::new(0, 35));
    assert_eq!(b.faults.count(), 0);
    let data = SourceFileData {
        file_name: b"min.ts".to_vec(),
        ..SourceFileData::default()
    };
    b.finish(root, data, ids).expect("ids")
}

fn find(a: Ast<'_>, file: &File) -> Nodes {
    let root = file.source_file.root;
    let statements = a.nodes(a.as_source_file(root).statements);
    let alias = statements.at(0usize);
    let list = a
        .as_variable_statement(statements.at(1usize))
        .declaration_list;
    let declaration = a
        .nodes(a.as_variable_declaration_list(list).declarations)
        .at(0usize);
    Nodes {
        root,
        alias,
        alias_type: a.as_type_alias_declaration(alias).type_node,
        declaration,
        name: a.name(declaration),
    }
}

// One bound file, one open store, one checker with the intrinsic types that the translated functions read.
fn with_checker(test: impl for<'a> FnOnce(&mut Checker<'a>, Ast<'a>, Nodes)) {
    let ids = IdAllocator::new();
    let file = build(&ids);
    let root = file.source_file.root;
    file.bind_once(&ids, |a| {
        bind_probe(a, root);
    });
    let files = [&file];
    let frozen = Frozen::of_files(&files).expect("one allocator");
    let arena = Slices::new();
    let open = Open::new(&arena, &ids);
    let a = Ast::new(&frozen, &open);
    let mut file_list = SliceBuf::make(0, 1);
    file_list.push(root);
    let program = ResolvedProgram {
        files: List::from_slice(arena.alloc_slice_copy(&file_list.items)),
        ..Default::default()
    };
    let mut c = Checker::zero(a, &arena, &program, StackCheck::init());
    c.files = program.source_files();
    c.file_index_map = Map::make();
    let _ = c.file_index_map.set(root, 0);
    c.any_type = c.new_intrinsic_type(TypeFlags::ANY, b"any");
    c.error_type = c.new_intrinsic_type(TypeFlags::ANY, b"error");
    c.unknown_type = c.new_intrinsic_type(TypeFlags::UNKNOWN, b"unknown");
    c.string_type = c.new_intrinsic_type(TypeFlags::STRING, b"string");
    c.number_type = c.new_intrinsic_type(TypeFlags::NUMBER, b"number");
    c.void_type = c.new_intrinsic_type(TypeFlags::VOID, b"void");
    c.never_type = c.new_intrinsic_type(TypeFlags::NEVER, b"never");
    c.silent_never_type = c.new_intrinsic_type(TypeFlags::NEVER, b"never");
    c.unknown_symbol = a.new_symbol(SymbolFlags::PROPERTY, b"unknown");
    c.unknown_signature = c.new_signature(List::NIL, List::NIL, c.error_type);
    let nodes = find(a, &file);
    test(&mut c, a, nodes);
}

fn object_type(c: &mut Checker<'_>) -> TypeId {
    c.new_type(TypeFlags::OBJECT, ObjectFlags::NONE, TypeData::Nil)
}

fn type_parameter(c: &mut Checker<'_>) -> TypeId {
    c.new_type(
        TypeFlags::TYPE_PARAMETER,
        ObjectFlags::NONE,
        TypeData::TypeParameter(Box::default()),
    )
}

fn type_list<'a>(c: &Checker<'a>, types: &[TypeId]) -> List<'a, TypeId> {
    let mut buf = SliceBuf::make(0, 0);
    for &t in types {
        buf.push(t);
    }
    c.list(&buf)
}

fn signature_list<'a>(c: &Checker<'a>, signatures: &[SignatureId]) -> List<'a, SignatureId> {
    let mut buf = SliceBuf::make(0, 0);
    for &s in signatures {
        buf.push(s);
    }
    c.list(&buf)
}

fn stand_in_count(c: &Checker<'_>, name: &str) -> u32 {
    c.stand_ins
        .snapshot()
        .iter()
        .find(|entry| entry.0 == name)
        .map_or(0, |entry| entry.1)
}

fn fault_count(a: Ast<'_>) -> u32 {
    a.open().faults.count()
}

#[test]
fn lists_keep_nil_empty_and_identity_apart() {
    with_checker(|c, _, _| {
        let nil: SliceBuf<TypeId> = SliceBuf::nil();
        let empty: SliceBuf<TypeId> = SliceBuf::make(0, 4);
        assert!(c.list(&nil).is_nil());
        assert!(!c.list(&empty).is_nil());
        assert_eq!(c.list(&empty).len(), 0);
        // core.Same: two empty lists are the same, two allocations of equal content are not.
        assert!(c.list(&nil).same(c.list(&empty)));
        let one = type_list(c, &[c.string_type, c.number_type]);
        let two = type_list(c, &[c.string_type, c.number_type]);
        assert!(one.same(one));
        assert!(!one.same(two));
        assert!(!one.same(one.sub(0usize, 1usize)));
        assert!(one.sub(0usize, 2usize).same(one));
        // core.Filter hands its argument back when nothing is removed, and a non-nil list when everything is.
        let kept = c.filter(one, |_, _| true);
        assert!(kept.same(one));
        let none = c.filter(one, |_, _| false);
        assert!(!none.is_nil() && none.len() == 0);
        let string_type = c.string_type;
        let some = c.filter(one, |_, t| t != string_type);
        assert_eq!(some.as_slice(), &[c.number_type]);
        assert!(c.map_list(List::<TypeId>::NIL, |_, t| t).is_nil());
        assert_eq!(c.clone_list(one).as_slice(), one.as_slice());
        assert!(!c.clone_list(one).same(one));
    });
}

#[test]
fn union_signatures_find_the_master_list_by_identity() {
    with_checker(|c, a, _| {
        let s1 = c.new_signature(List::NIL, List::NIL, c.string_type);
        let s2 = c.new_signature(List::NIL, List::NIL, c.number_type);
        let s3 = c.new_signature(List::NIL, List::NIL, c.void_type);
        // An empty list ends the function with nil.
        let master = signature_list(c, &[s1, s2]);
        assert!(c.get_union_signatures(&[master, List::NIL]).is_nil());
        // The master list is skipped, the other list is combined into every signature of the master list.
        let single = signature_list(c, &[s3]);
        let before = c.signature_count;
        let result = c.get_union_signatures(&[master, single]);
        assert_eq!(result.len(), 2);
        assert_eq!(c.signature_count, before + 2);
        assert_eq!(c.signatures[result.at(0usize)].target, s1);
        assert_eq!(c.signatures[result.at(1usize)].target, s2);
        // The same list twice is the master list twice: nothing is combined and the clone comes back.
        let alone = signature_list(c, &[s1]);
        let before = c.signature_count;
        let result = c.get_union_signatures(&[alone, alone]);
        assert_eq!(result.as_slice(), &[s1]);
        assert!(!result.same(alone));
        assert_eq!(c.signature_count, before);
        // A second allocation with the same content is another list: it is combined.
        let twin = signature_list(c, &[s1]);
        let result = c.get_union_signatures(&[alone, twin]);
        assert_eq!(c.signature_count, before + 1);
        assert_eq!(c.signatures[result.at(0usize)].target, s1);
        assert_eq!(fault_count(a), 0);
    });
}

#[test]
fn fill_missing_type_arguments_mappers_read_the_list_while_it_is_filled() {
    with_checker(|c, a, _| {
        let (p0, p1, p2) = (type_parameter(c), type_parameter(c), type_parameter(c));
        for p in [p0, p1, p2] {
            c.scripted_type_variables.add(p);
        }
        // The default of the second parameter names the third one, the default of the third one is string.
        c.scripted_defaults = Map::make();
        let _ = c.scripted_defaults.set(p1, p2);
        let _ = c.scripted_defaults.set(p2, c.string_type);
        let type_parameters = type_list(c, &[p0, p1, p2]);
        let type_arguments = type_list(c, &[c.number_type]);
        let first_new_mapper = TypeMapperId(c.type_mappers.count() + 1);
        let result = c.fill_missing_type_arguments(type_arguments, type_parameters, 1, false);
        // The forward reference was read while its slot still held the error type.
        assert_eq!(
            result.as_slice(),
            &[c.number_type, c.error_type, c.string_type]
        );
        // The mapper of that step reads the filled list afterwards, as the shared backing array of upstream does.
        assert!(matches!(
            c.type_mappers[first_new_mapper],
            TypeMapper::Array {
                targets: MapperTargets::Cells(_),
                ..
            }
        ));
        assert_eq!(c.map(first_new_mapper, p2), c.string_type);
        assert_eq!(c.map(first_new_mapper, p0), c.number_type);
        // One source: newTypeMapper reads targets[0] at once and keeps no list.
        let single = type_list(c, &[p0]);
        let cells = c.arena.alloc_type_cells(1);
        let simple = c.new_type_mapper(single, MapperTargets::Cells(cells));
        cells.first().expect("one cell").set(c.string_type);
        assert_eq!(c.map(simple, p0), TypeId::NIL);
        // Enough arguments: the argument list itself comes back.
        let full = type_list(c, &[c.number_type, c.number_type, c.number_type]);
        assert!(
            c.fill_missing_type_arguments(full, type_parameters, 1, false)
                .same(full)
        );
        assert!(
            c.fill_missing_type_arguments(full, List::NIL, 0, false)
                .is_nil()
        );
        assert_eq!(fault_count(a), 0);
    });
}

#[test]
fn cache_keys_hash_upstream_bytes() {
    with_checker(|c, a, _| {
        // The bytes of a key are upstream's: a list is its length as 64 bits and each type id as 32 bits.
        let types = type_list(c, &[c.string_type, c.number_type]);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&2u64.to_le_bytes());
        bytes.extend_from_slice(&c.string_type.0.to_le_bytes());
        bytes.extend_from_slice(&c.number_type.0.to_le_bytes());
        assert_eq!(get_type_list_key(types), CacheHashKey::of(&bytes));
        assert_ne!(get_type_list_key(types), get_type_list_key(List::NIL));
        assert!(CacheHashKey::default().is_zero());
        assert!(!CacheHashKey::of(b"").is_zero());
        // A key that spills out of the inline buffer hashes the same byte stream.
        let mut long = KeyBuilder::default();
        let mut expected = Vec::new();
        for i in 0..100u32 {
            long.write_uint32(i);
            expected.extend_from_slice(&i.to_le_bytes());
        }
        long.write_string(&[7u8; 300]);
        expected.extend_from_slice(&[7u8; 300]);
        long.write_byte(b'!');
        expected.push(b'!');
        assert_eq!(long.hash(), CacheHashKey::of(&expected));
        // An alias key names the symbol by ast.GetSymbolId: the key gives the symbol its id.
        let symbol = a.new_symbol(SymbolFlags::TYPE_ALIAS, b"T");
        let alias = c.type_aliases.alloc(TypeAlias {
            symbol,
            type_arguments: types,
        });
        let key = get_alias_key(c, alias);
        let id = a.get_symbol_id(symbol);
        let mut bytes = vec![1u8];
        bytes.extend_from_slice(&id.to_le_bytes());
        bytes.extend_from_slice(&2u64.to_le_bytes());
        bytes.extend_from_slice(&c.string_type.0.to_le_bytes());
        bytes.extend_from_slice(&c.number_type.0.to_le_bytes());
        assert_eq!(key, CacheHashKey::of(&bytes));
        // getUnionKey leaves through a fault for an origin that is no union, intersection or index type.
        let key = get_union_key(c, types, c.string_type, TypeAliasId::NIL);
        assert!(key.is_zero());
        let fault = a.open().faults.first().expect("a fault");
        assert_eq!(
            (fault.kind, fault.message),
            (FaultKind::Panic, "Unhandled case in getUnionKey")
        );
    });
}

#[test]
fn symbol_ids_are_given_in_request_order() {
    with_checker(|c, a, n| {
        // A bound symbol and transient symbols are read through one record.
        let bound = a.symbol(n.declaration);
        assert!(!bound.is_nil() && !bound.is_open());
        assert_eq!(a.sym(bound).name, b"x");
        let first = a.new_symbol(SymbolFlags::PROPERTY | SymbolFlags::TRANSIENT, b"p");
        let second = a.new_symbol(SymbolFlags::PROPERTY | SymbolFlags::TRANSIENT, b"p");
        assert!(first.is_open() && first.0 < second.0);
        // No declaration and the same name: the tie is broken by the id, and the id is given at the first request.
        let links = c.value_symbol_links_get(second);
        c.value_symbol_links[links].resolved_type = c.string_type;
        assert!(c.compare_symbols(first, second) > 0);
        assert!(a.get_symbol_id(second) < a.get_symbol_id(first));
        // A symbol with a declaration sorts before one without, whatever the ids.
        assert!(c.compare_symbols(bound, second) < 0);
        assert_eq!(c.compare_symbols(SymbolId::NIL, second), 1);
        let mut symbols = [first, bound, second];
        c.sort_symbols(&mut symbols);
        assert_eq!(symbols, [bound, second, first]);
        // Has and TryGet ask for the id too.
        let third = a.new_symbol(SymbolFlags::PROPERTY | SymbolFlags::TRANSIENT, b"p");
        assert!(c.value_symbol_links_try_get(third).is_none());
        let fourth = a.new_symbol(SymbolFlags::PROPERTY | SymbolFlags::TRANSIENT, b"p");
        assert!(c.compare_symbols(third, fourth) < 0);
        // A write to a bound symbol is a fault and changes nothing.
        a.update_symbol(bound, |s| s.flags = SymbolFlags::NONE);
        assert_eq!(
            a.open().faults.first().map(|f| f.kind),
            Some(FaultKind::WriteToFrozen)
        );
        assert_ne!(a.sym(bound).flags, SymbolFlags::NONE);
    });
}

#[test]
fn compare_types_orders_as_upstream() {
    with_checker(|c, a, n| {
        // Flags first, then the id for intrinsic types.
        assert!(c.compare_types(c.string_type, c.number_type) < 0);
        assert!(c.compare_types(c.any_type, c.error_type) < 0);
        assert_eq!(c.compare_types(TypeId::NIL, c.any_type), -1);
        // Object types are ordered by their symbols: a declared symbol before a transient one.
        let (o1, o2) = (object_type(c), object_type(c));
        c.types[o1].symbol = a.new_symbol(SymbolFlags::TRANSIENT, b"o");
        c.types[o2].symbol = a.symbol(n.declaration);
        assert!(c.compare_types(o1, o2) > 0);
        let mut types = [o1, c.number_type, o2, c.string_type];
        crate::tscore::slices::sort_stable_func(&mut types, |x, y| c.compare_types(x, y));
        assert_eq!(types, [c.string_type, c.number_type, o2, o1]);
        // Nodes of one file are ordered by position.
        assert!(c.compare_nodes(n.alias, n.declaration) < 0);
        assert_eq!(c.compare_nodes(n.root, n.root), 0);
        assert_eq!(fault_count(a), 0);
    });
}

fn chain_text(c: &Checker<'_>, r: RelaterId) -> String {
    let mut parts = Vec::new();
    let mut e = c.relaters[r].error_chain;
    while !e.is_nil() {
        let node = &c.relaters[r].error_chains[e];
        let args: Vec<String> = node
            .args
            .iter()
            .map(|arg| match arg {
                Arg::Str(s) => s.iter().map(|&b| char::from(b)).collect(),
                Arg::Int(i) => i.to_string(),
                Arg::Bool(b) => b.to_string(),
            })
            .collect();
        parts.push(format!("TS{}[{}]", node.message.code(), args.join("|")));
        e = node.next;
    }
    parts.join(" <- ")
}

fn text(s: &str) -> Arg<'_> {
    Arg::Str(s.as_bytes())
}

// The call sequences and the chains are the ones that typescript-go prints for the probe chain.ts of the relations research.
#[test]
fn report_error_reduces_the_chain_as_upstream() {
    with_checker(|c, a, _| {
        let property = diagnostics::Types_of_property_0_are_incompatible;
        let assignable = diagnostics::Type_0_is_not_assignable_to_type_1;
        let r = c.get_relater();
        c.report_error(r, assignable, &[text("string"), text("number")]);
        c.report_error(r, property, &[text("c")]);
        c.report_error(
            r,
            assignable,
            &[text("{ c: string; }"), text("{ c: number; }")],
        );
        c.report_error(r, property, &[text("b")]);
        assert_eq!(chain_text(c, r), "TS2200[b.c] <- TS2322[string|number]");
        c.report_error(r, assignable, &[text("B1"), text("B2")]);
        c.report_error(r, property, &[text("a")]);
        assert_eq!(chain_text(c, r), "TS2200[a.b.c] <- TS2322[string|number]");
        assert_eq!(c.chain_depth(r, c.relaters[r].error_chain), 2);
        c.put_relater(r);

        let r = c.get_relater();
        assert!(c.relaters[r].error_chain.is_nil());
        c.report_error(r, assignable, &[text("string"), text("number")]);
        c.report_error(r, property, &[text("\"x-y\"")]);
        c.report_error(r, assignable, &[text("O1"), text("O2")]);
        c.report_error(
            r,
            diagnostics::Call_signatures_with_no_arguments_have_incompatible_return_types_0_and_1,
            &[text("O1"), text("O2")],
        );
        c.report_error(r, assignable, &[text("F1"), text("F2")]);
        c.report_error(r, property, &[text("m")]);
        assert_eq!(
            chain_text(c, r),
            "TS2201[m()[\"x-y\"]] <- TS2322[string|number]"
        );
        c.put_relater(r);

        let r = c.get_relater();
        c.report_error(r, assignable, &[text("string"), text("number")]);
        c.report_error(r, property, &[text("z")]);
        c.report_error(r, assignable, &[text("O1"), text("O2")]);
        c.report_error(
            r,
            diagnostics::Construct_signature_return_types_0_and_1_are_incompatible,
            &[text("O1"), text("O2")],
        );
        c.report_error(r, assignable, &[text("F1"), text("F2")]);
        c.report_error(r, property, &[text("k")]);
        assert_eq!(
            chain_text(c, r),
            "TS2201[(new k(...)).z] <- TS2322[string|number]"
        );
        assert!(c.chain_args_match(r, &[None]));
        assert!(!c.chain_args_match(r, &[Some(text("other"))]));
        c.put_relater(r);
        assert_eq!(fault_count(a), 0);
    });
}

// The key and the results are the SET lines that typescript-go prints for the probe rel2.ts of the relations research.
#[test]
fn recursive_type_related_to_fills_the_cache_as_upstream() {
    with_checker(|c, a, _| {
        while c.type_count < 85 {
            object_type(c);
        }
        let (source, target) = (object_type(c), object_type(c));
        assert_eq!((source, target), (TypeId(86), TypeId(87)));
        let key = CacheHashKey::of(&[0x73, 0x56, 0, 0, 0, 0x57, 0, 0, 0, 0, 0, 0, 0]);
        let (computed, constrained) =
            get_relation_key(c, source, target, IntersectionState::NONE, false, false);
        assert_eq!((computed, constrained), (key, false));

        c.scripted_structured_results.push(Ternary::FALSE);
        assert!(!c.check_type_related_to(source, target, RelationKind::Assignable, NodeId::NIL));
        assert_eq!(
            c.relation_get(RelationKind::Assignable, key),
            RelationComparisonResult::FAILED
        );
        assert_eq!(c.relation_size(RelationKind::Assignable), 1);
        // A cached failure answers without a new comparison when no error is wanted.
        assert!(!c.check_type_related_to(source, target, RelationKind::Assignable, NodeId::NIL));
        assert_eq!(stand_in_count(c, "structuredTypeRelatedTo"), 0);

        // Maybe at depth zero is recorded as a success, Unknown is not recorded.
        c.scripted_structured_results.push(Ternary::MAYBE);
        assert!(c.check_type_related_to(source, target, RelationKind::Subtype, NodeId::NIL));
        assert_eq!(
            c.relation_get(RelationKind::Subtype, key),
            RelationComparisonResult::SUCCEEDED
        );
        c.scripted_structured_results.push(Ternary::UNKNOWN);
        assert!(c.check_type_related_to(source, target, RelationKind::Comparable, NodeId::NIL));
        assert_eq!(c.relation_size(RelationKind::Comparable), 0);
        assert_eq!(fault_count(a), 0);
        assert_eq!(Ternary::TRUE & Ternary::MAYBE, Ternary::MAYBE);
        assert_eq!(Ternary::MAYBE & Ternary::UNKNOWN, Ternary::UNKNOWN);
        assert_eq!(InferencePriority::CIRCULARITY.0, -1);
    });
}

#[test]
fn a_stored_comparer_names_the_slot_of_its_relater() {
    with_checker(|c, a, _| {
        let (source, target) = (object_type(c), object_type(c));
        // The pool hands the same relater out again.
        let r1 = c.get_relater();
        let r2 = c.get_relater();
        c.put_relater(r2);
        c.put_relater(r1);
        assert_eq!(c.get_relater(), r1);
        assert_eq!(c.get_relater(), r2);
        // relater.go 3768: a context keeps `r.isRelatedToWorker`, and getInferredType calls it later.
        c.relaters[r2].relation = RelationKind::Assignable;
        c.relaters[r2].relation_count = 1000;
        let tp = type_parameter(c);
        let type_parameters = type_list(c, &[tp]);
        let comparer = TypeComparer::Relater {
            r: r2,
            intersection_state: IntersectionState::NONE,
        };
        let n = c.new_inference_context(
            type_parameters,
            SignatureId::NIL,
            InferenceFlags::NONE,
            comparer,
        );
        c.scripted_structured_results.push(Ternary::TRUE);
        let stored = c.inference_contexts[n].compare_types;
        assert_eq!(
            c.call_type_comparer(stored, source, target, false),
            Ternary::TRUE
        );
        assert_eq!(c.relaters[r2].relation_count, 999);
        // After the relater went back to the pool the comparer finds no relation: upstream dereferences nil there.
        c.put_relater(r2);
        let (source2, target2) = (object_type(c), object_type(c));
        assert_eq!(fault_count(a), 0);
        assert_eq!(
            c.call_type_comparer(stored, source2, target2, false),
            Ternary::FALSE
        );
        let fault = a.open().faults.first().expect("a fault");
        assert_eq!(
            (fault.kind, fault.message),
            (FaultKind::Panic, "nil Relation")
        );
        assert!(!c.relaters[r2].overflow);
        // A nil comparer of a context is compareTypesAssignable.
        let plain = c.new_inference_context(
            type_parameters,
            SignatureId::NIL,
            InferenceFlags::NONE,
            TypeComparer::Nil,
        );
        assert_eq!(
            c.inference_contexts[plain].compare_types,
            TypeComparer::Assignable
        );
    });
}

#[test]
fn signature_related_to_passes_reporter_and_comparer_of_one_relater() {
    with_checker(|c, a, _| {
        let (t1, t2) = (object_type(c), object_type(c));
        let s1 = c.new_signature(List::NIL, List::NIL, t1);
        let s2 = c.new_signature(List::NIL, List::NIL, t2);
        let r = c.get_relater();
        c.relaters[r].relation = RelationKind::Assignable;
        c.relaters[r].relation_count = 1000;
        assert_eq!(
            c.signature_related_to(r, s1, s1, false, true, IntersectionState::NONE),
            Ternary::TRUE
        );
        // The return types are compared by the relater, and the marker message lands on its chain.
        c.scripted_structured_results.push(Ternary::FALSE);
        assert_eq!(
            c.signature_related_to(r, s1, s2, false, true, IntersectionState::NONE),
            Ternary::FALSE
        );
        assert_eq!(
            c.get_chain_message(r, 0),
            diagnostics::Call_signatures_with_no_arguments_have_incompatible_return_types_0_and_1
        );
        assert!(c.get_chain_message(r, 0).elided_in_compatibility_pyramid());
        // The marker is elided from the diagnostic chain: nothing is left to report.
        let chain = c.relaters[r].error_chain;
        assert!(
            c.create_diagnostic_chain_from_error_chain(r, chain)
                .is_nil()
        );
        c.put_relater(r);
        // Without a reporter and without errors the same comparison runs through compareTypesAssignable.
        assert!(!c.is_signature_assignable_to(s1, s2, false));
        assert!(stand_in_count(c, "isTypeRelatedTo") > 0);
        assert_eq!(fault_count(a), 0);
        // A reporter that is nil and is called is upstream's nil function call.
        c.call_error_reporter(None, diagnostics::Type_0_is_not_assignable_to_type_1, &[]);
        assert_eq!(fault_count(a), 1);
    });
}

#[test]
fn inference_lists_are_shared_by_handle() {
    with_checker(|c, a, _| {
        let tp = type_parameter(c);
        let type_parameters = type_list(c, &[tp]);
        let n = c.new_inference_context(
            type_parameters,
            SignatureId::NIL,
            InferenceFlags::NONE,
            TypeComparer::Nil,
        );
        let list = c.inference_contexts[n].inferences;
        let old = c.inference_at(list, 0usize);
        assert_eq!(c.inference_infos[old].type_parameter, tp);
        assert_eq!(
            c.inference_infos[old].priority,
            InferencePriority::MAX_VALUE
        );
        assert_eq!(c.inference_infos[old].implied_arity, -1);
        // The two mappers of a context name the context.
        let mapper = c.inference_contexts[n].mapper;
        assert!(matches!(
            c.type_mappers[mapper],
            TypeMapper::Inference { fixing: true, .. }
        ));
        // mergeInferences replaces an element, and every holder of the list sees it.
        let state = c.get_inference_state();
        c.inference_states[state].inferences = list;
        let fresh = c.new_inference_info(tp);
        c.inference_infos[fresh].candidates.push(c.string_type);
        let other = c.inference_lists.alloc(vec![fresh]);
        c.merge_inferences(list, other);
        assert_eq!(
            c.inference_at(c.inference_states[state].inferences, 0usize),
            fresh
        );
        assert!(!c.has_inference_candidates(old));
        c.put_inference_state(state);
        assert_eq!(c.get_inference_state(), state);
        // A clone has lists of its own.
        let clone = c.clone_inference_context(n, InferenceFlags::NO_DEFAULT);
        let clone_list = c.inference_contexts[clone].inferences;
        let copy = c.inference_at(clone_list, 0usize);
        assert_ne!(copy, fresh);
        c.inference_infos[copy].candidates.clear();
        assert!(c.has_inference_candidates(fresh));
        assert!(
            c.inference_contexts[clone]
                .flags
                .intersects(InferenceFlags::NO_DEFAULT)
        );
        // The mapper of the context answers with the inferred type: no signature, so the default is unknown.
        assert_eq!(c.map(mapper, tp), c.unknown_type);
        assert!(c.inference_infos[fresh].is_fixed);
        assert_eq!(c.map(mapper, c.string_type), c.string_type);
        assert_eq!(c.get_inferred_types(n).as_slice(), &[c.unknown_type]);
        assert_eq!(fault_count(a), 0);
    });
}

#[test]
fn get_inferred_type_calls_the_stored_comparer() {
    with_checker(|c, a, _| {
        // A signature, one candidate, and a constraint that the candidate does not satisfy.
        let tp = type_parameter(c);
        let constraint = object_type(c);
        let candidate = object_type(c);
        let type_parameters = type_list(c, &[tp]);
        let signature = c.new_signature(type_parameters, List::NIL, c.void_type);
        let r = c.get_relater();
        c.relaters[r].relation = RelationKind::Assignable;
        c.relaters[r].relation_count = 1000;
        let comparer = TypeComparer::Relater {
            r,
            intersection_state: IntersectionState::NONE,
        };
        let n = c.new_inference_context(type_parameters, signature, InferenceFlags::NONE, comparer);
        let info = c.inference_at(c.inference_contexts[n].inferences, 0usize);
        c.inference_infos[info].candidates.push(candidate);
        // No constraint: the candidate is the inferred type and the comparer is not asked.
        assert_eq!(c.get_inferred_type(n, 0), candidate);
        assert_eq!(stand_in_count(c, "getCovariantInference"), 1);
        assert_eq!(c.relation_size(RelationKind::Assignable), 0);
        // With a constraint the comparer of the context decides: the comparison fails, so the constraint is the answer.
        c.inference_infos[info].inferred_type = TypeId::NIL;
        c.types[tp].data = TypeData::TypeParameter(Box::new(TypeParameter {
            constraint,
            ..Default::default()
        }));
        c.scripted_structured_results.push(Ternary::FALSE);
        assert_eq!(c.get_inferred_type(n, 0), constraint);
        // The comparison ran in the relater that the comparer names: its failure is in the cache of the relation.
        let (key, _) = get_relation_key(
            c,
            candidate,
            constraint,
            IntersectionState::NONE,
            false,
            false,
        );
        assert_eq!(
            c.relation_get(RelationKind::Assignable, key),
            RelationComparisonResult::FAILED
        );
        assert_eq!(c.relaters[r].relation_count, 999);
        assert_eq!(fault_count(a), 0);
    });
}

#[test]
fn callbacks_get_the_checker_back() {
    with_checker(|c, a, n| {
        // mapType with a method value and with a closure over a local.
        assert_eq!(c.map_to_widened(c.string_type), c.string_type);
        let union = c.new_union_type(type_list(c, &[c.string_type, c.number_type]));
        let (string_type, void_type) = (c.string_type, c.void_type);
        let mapped = c.map_type(union, &mut |c, t| {
            if t == string_type { c.never_type } else { t }
        });
        assert_eq!(
            c.type_types(mapped).as_slice(),
            &[c.never_type, c.number_type]
        );
        assert_eq!(c.map_type(union, &mut |_, t| t), union);
        assert!(c.map_type(union, &mut |_, _| TypeId::NIL).is_nil());
        // filterType returns the type itself when the filter keeps everything.
        assert_eq!(c.remove_type(union, void_type), union);
        let filtered = c.remove_type(union, string_type);
        assert_eq!(c.type_types(filtered).as_slice(), &[c.number_type]);
        assert_eq!(c.remove_type(c.string_type, string_type), c.never_type);
        // A deferred callback runs once, with the checker, and one that it adds is dropped.
        let runs = Rc::new(Cell::new(0));
        let counter = Rc::clone(&runs);
        let location = n.name;
        c.add_deferred_diagnostic(Box::new(move |c| {
            counter.set(counter.get() + 1);
            c.error(
                location,
                diagnostics::X_0_is_declared_but_its_value_is_never_read,
                &[Arg::Str(b"x")],
            );
            c.add_deferred_diagnostic(Box::new(|c| {
                c.error_type = TypeId::NIL;
            }));
        }));
        c.produce_deferred_diagnostics();
        c.produce_deferred_diagnostics();
        assert_eq!(runs.get(), 1);
        assert!(!c.error_type.is_nil());
        assert_eq!(c.diagnostic_store.fault_count(), 0);
        assert_eq!(fault_count(a), 0);
    });
}

// The line map that the writer needs beside the names and texts of the checker's view.
struct FilesWithLines<'a> {
    files: ProgramFiles<'a>,
    root: NodeId,
    lines: Vec<i32>,
}

impl SourceFiles for FilesWithLines<'_> {
    fn file_name(&self, file: NodeId) -> &[u8] {
        self.files.file_name(file)
    }
    fn path(&self, file: NodeId) -> &[u8] {
        self.files.path(file)
    }
    fn text(&self, file: NodeId) -> &[u8] {
        self.files.text(file)
    }
    fn ecma_line_map(&self, file: NodeId) -> &[i32] {
        if file == self.root { &self.lines } else { &[] }
    }
}

fn written(c: &Checker<'_>, a: Ast<'_>, root: NodeId, list: &[DiagnosticId]) -> String {
    let files = FilesWithLines {
        files: ProgramFiles::new(a),
        root,
        lines: compute_ecma_line_starts(TEXT),
    };
    let mut out = Vec::new();
    let identity = |name: &[u8]| name.to_vec();
    let opts = FormattingOptions {
        locale: Locale::DEFAULT,
        new_line: b"\n",
        convert_to_relative_path: &identity,
    };
    let view = Diagnostics {
        store: &c.diagnostic_store,
        files: &files,
    };
    write_format_diagnostics(&mut out, view, list, &opts);
    out.iter().map(|&b| char::from(b)).collect()
}

#[test]
fn a_circular_alias_is_reported_through_the_stack_and_the_table() {
    with_checker(|c, a, n| {
        let symbol = a.symbol(n.alias);
        assert_eq!(a.sym(symbol).name, b"A");
        // `type A = A`: the type node of the alias refers to the alias.
        c.scripted_type_node_aliases = Map::make();
        let _ = c.scripted_type_node_aliases.set(n.alias_type, symbol);
        let t = c.get_declared_type_of_type_alias(symbol);
        assert_eq!(t, c.error_type);
        assert!(c.type_resolutions.is_empty());
        assert_eq!(c.get_declared_type_of_type_alias(symbol), c.error_type);
        let files = ProgramFiles::new(a);
        let view = Diagnostics {
            store: &c.diagnostic_store,
            files: &files,
        };
        let list = c.diagnostics.get_diagnostics(view);
        assert_eq!(list.len(), 1);
        assert_eq!(
            written(c, a, n.root, &list),
            "min.ts(1,6): error TS2456: Type alias 'A' circularly references itself.\n"
        );
        // The stack itself: a second push of the same target and property is a cycle, and both entries answer false.
        let entity = TypeSystemEntity::Type(type_parameter(c));
        assert!(c.push_type_resolution(entity, TypeSystemPropertyName::ResolvedBaseConstraint));
        assert!(!c.push_type_resolution(entity, TypeSystemPropertyName::ResolvedBaseConstraint));
        assert!(!c.pop_type_resolution());
        assert_eq!(fault_count(a), 0);
        // A pop of the empty stack is upstream's index out of range.
        assert!(!c.pop_type_resolution());
        assert_eq!(
            a.open().faults.first().map(|f| f.kind),
            Some(FaultKind::IndexOutOfRange)
        );
    });
}

#[test]
fn the_first_visible_result_is_written_from_a_node() {
    with_checker(|c, a, n| {
        let d = c.error(
            n.name,
            diagnostics::Type_0_is_not_assignable_to_type_1,
            &[Arg::Str(b"string"), Arg::Str(b"number")],
        );
        // The same diagnostic again is the one that the collection already has.
        let again = c.error(
            n.name,
            diagnostics::Type_0_is_not_assignable_to_type_1,
            &[Arg::Str(b"string"), Arg::Str(b"number")],
        );
        assert_ne!(d, again);
        let files = ProgramFiles::new(a);
        let view = Diagnostics {
            store: &c.diagnostic_store,
            files: &files,
        };
        let list = c.diagnostics.get_diagnostics(view);
        assert_eq!(list, vec![d]);
        assert_eq!(
            written(c, a, n.root, &list),
            "min.ts(2,7): error TS2322: Type 'string' is not assignable to type 'number'.\n"
        );
        // A comparison whose cached result is an overflow reports 2859 through the chain of the relater.
        let (source, target) = (object_type(c), object_type(c));
        let (key, _) = get_relation_key(c, source, target, IntersectionState::NONE, false, false);
        c.relation_set(
            RelationKind::Assignable,
            key,
            RelationComparisonResult::FAILED | RelationComparisonResult::COMPLEXITY_OVERFLOW,
        );
        let mut output = Vec::new();
        assert!(!c.check_type_related_to_ex(
            source,
            target,
            RelationKind::Assignable,
            n.name,
            MessageId::NIL,
            Some(&mut output),
        ));
        assert_eq!(output.len(), 1);
        assert_eq!(
            written(c, a, n.root, &output),
            format!(
                "min.ts(2,7): error TS2859: Excessive complexity comparing types '#{}' and '#{}'.\n",
                source.0, target.0
            )
        );
        assert_eq!(fault_count(a), 0);
    });
}

#[test]
fn faults_and_stand_ins_have_one_sink_each() {
    with_checker(|c, a, n| {
        c.current_node = n.name;
        // A stand-in answers with the fallback of its result kind and is counted by name.
        assert_eq!(c.get_intersection_type(List::NIL), c.error_type);
        assert!(c.get_properties_of_type(c.string_type).is_nil());
        assert!(!c.is_weak_type(c.string_type));
        assert_eq!(
            c.get_type_predicate_of_signature(SignatureId::NIL),
            TypePredicateId::NIL
        );
        assert_eq!(
            c.union_or_intersection_related_to(
                RelaterId::NIL,
                c.string_type,
                c.number_type,
                false,
                IntersectionState::NONE
            ),
            Ternary::FALSE
        );
        assert!(c.get_intersection_type(List::NIL) == c.error_type);
        assert_eq!(stand_in_count(c, "getIntersectionType"), 2);
        assert_eq!(stand_in_count(c, "isWeakType"), 1);
        assert!(!c.stand_ins.is_empty());
        assert_eq!(fault_count(a), 0);
        // A failed cast reads the nil part and names the type.
        assert!(c.as_union_type(c.string_type).origin.is_nil());
        assert!(c.as_object_type(c.string_type).target.is_nil());
        let faults = a.open().faults.snapshot();
        assert_eq!(faults.len(), 2);
        assert!(
            faults
                .iter()
                .all(|f| f.kind == FaultKind::BadCast && f.id == c.string_type.0)
        );
        // A panic keeps upstream's message and the node that was being checked.
        let t: TypeId = c.fail("Unhandled case in newObjectType");
        assert_eq!(t, c.error_type);
        c.assert(false, "upstream assert");
        let faults = a.open().faults.snapshot();
        assert_eq!(faults.len(), 4);
        assert_eq!(
            faults.get(2).map(|f| (f.kind, f.message, f.id)),
            Some((
                FaultKind::Panic,
                "Unhandled case in newObjectType",
                n.name.0
            ))
        );
        assert_eq!(faults.get(3).map(|f| f.kind), Some(FaultKind::Assert));
        // A mapper that is nil maps to the error type and is a fault.
        assert_eq!(c.map(TypeMapperId::NIL, c.string_type), c.error_type);
        assert_eq!(fault_count(a), 5);
        // The driver turns the faults into errors: at the node for a panic, without a place for a failed cast.
        let internal = c.internal_diagnostics();
        assert_eq!(internal.len(), 5);
        let first = internal.first().copied().unwrap_or_default();
        let third = internal.get(2).copied().unwrap_or_default();
        assert!(c.diagnostic_store[first].file().is_nil());
        assert_eq!(c.diagnostic_store[third].file(), n.root);
        assert_eq!(c.diagnostic_store[third].pos(), a.pos(n.name));
        assert_eq!(
            c.diagnostic_store[third].localize(Locale::DEFAULT),
            b"Internal fault of the type checker: Unhandled case in newObjectType"
        );
    });
}

#[test]
fn a_loop_that_upstream_cannot_leave_ends_with_a_fault() {
    with_checker(|c, a, n| {
        // alias -> middle -> target: the chain is walked to the resolved target.
        let declarations = List::from_slice(c.arena.alloc_slice_copy(&[n.declaration]));
        let make = |name: &'static [u8]| {
            let s = a.new_symbol(SymbolFlags::ALIAS, name);
            a.update_symbol(s, |data| data.declarations = declarations);
            s
        };
        let (alias, middle, target) = (make(b"a"), make(b"m"), make(b"t"));
        a.update_symbol(target, |data| data.flags = SymbolFlags::VARIABLE);
        for (from, to) in [(alias, middle), (middle, target)] {
            let links = c.alias_symbol_links.get(from);
            c.alias_symbol_links[links].immediate_target = to;
            c.alias_symbol_links[links].alias_target = target;
        }
        assert_eq!(
            c.resolve_alias_with_deprecation_check(alias, n.name),
            target
        );
        assert_eq!(fault_count(a), 0);
        // An immediate target without declarations: upstream turns in place for ever.
        let bare = a.new_symbol(SymbolFlags::ALIAS, b"bare");
        let links = c.alias_symbol_links.get(alias);
        c.alias_symbol_links[links].immediate_target = bare;
        assert_eq!(
            c.resolve_alias_with_deprecation_check(alias, n.name),
            target
        );
        let fault = a.open().faults.first().expect("a fault");
        assert_eq!(
            (fault.kind, fault.message),
            (FaultKind::LoopLimit, "resolveAliasWithDeprecationCheck")
        );
        // A chain that runs in a circle beside the target leaves through the budget.
        let links = c.alias_symbol_links.get(alias);
        c.alias_symbol_links[links].immediate_target = middle;
        let links = c.alias_symbol_links.get(middle);
        c.alias_symbol_links[links].immediate_target = alias;
        assert_eq!(
            c.resolve_alias_with_deprecation_check(alias, n.name),
            target
        );
        assert_eq!(fault_count(a), 2);
    });
}

#[test]
fn a_deferred_call_runs_on_every_way_out() {
    with_checker(|c, a, n| {
        let class = a.new_symbol(SymbolFlags::CLASS, b"C");
        assert_eq!(
            c.get_explicit_type_of_symbol(class, DiagnosticId::NIL),
            c.error_type
        );
        assert_eq!(c.resolving_explicit_type_of_symbol.len(), 0);
        // A variable without an annotation: the related information is added and nil is returned.
        let variable = a.symbol(n.declaration);
        let diagnostic = c.error(n.name, diagnostics::Type_0_is_not_assignable_to_type_1, &[]);
        assert!(c.get_explicit_type_of_symbol(variable, diagnostic).is_nil());
        assert_eq!(c.resolving_explicit_type_of_symbol.len(), 0);
        assert_eq!(
            c.diagnostic_store[diagnostic].related_information().len(),
            1
        );
        // A symbol that is being resolved answers nil at once.
        c.resolving_explicit_type_of_symbol.add(class);
        assert!(
            c.get_explicit_type_of_symbol(class, DiagnosticId::NIL)
                .is_nil()
        );
        assert!(c.resolving_explicit_type_of_symbol.has(class));
        let _ = a;
    });
}

#[test]
fn the_program_is_a_trait_object_over_resolved_inputs() {
    with_checker(|c, _, n| {
        let program: &dyn Program = c.program;
        assert_eq!(program.source_files().as_slice(), &[n.root]);
        assert!(!program.file_exists(b"/other.ts"));
        assert!(
            program
                .get_resolved_module(n.root, b"./x", Default::default())
                .is_none()
        );
        assert!(program.get_packages_map().is_none());
        assert!(
            program
                .get_project_reference_from_output_dts(n.root)
                .is_none()
        );
        assert!(
            !program
                .options()
                .get_strict_option_value(program.options().strict_null_checks)
        );
        let mut seen = 0;
        program.for_each_resolved_module(&mut |_| seen += 1);
        assert_eq!(seen, 0);
        assert_eq!(c.files.as_slice(), &[n.root]);
    });
}

#[test]
fn instantiate_type_keeps_the_caches_of_the_active_mappers() {
    with_checker(|c, a, _| {
        let tp = type_parameter(c);
        c.scripted_type_variables.add(tp);
        let m = c.new_simple_type_mapper(tp, c.string_type);
        // A type that cannot contain type variables comes back at once, as does a nil mapper.
        assert_eq!(c.instantiate_type(c.number_type, m), c.number_type);
        assert_eq!(c.instantiate_type(tp, TypeMapperId::NIL), tp);
        assert_eq!(c.total_instantiation_count, 0);
        assert_eq!(c.instantiate_type(tp, m), c.string_type);
        assert_eq!(c.total_instantiation_count, 1);
        assert!(c.active_mappers.is_empty());
        assert_eq!(c.active_type_mappers_caches_len, 0);
        assert_eq!(c.active_type_mappers_caches.len(), 1);
        // A mapper that is active answers from its cache the second time.
        c.push_active_mapper(m);
        assert_eq!(c.instantiate_type(tp, m), c.string_type);
        assert_eq!(c.instantiate_type(tp, m), c.string_type);
        assert_eq!(c.total_instantiation_count, 2);
        c.clear_active_mapper_caches();
        assert_eq!(c.instantiate_type(tp, m), c.string_type);
        assert_eq!(c.total_instantiation_count, 3);
        c.pop_active_mapper();
        // The depth limit reports 2589 at the current node and answers the error type.
        c.instantiation_depth = 100;
        assert_eq!(c.instantiate_type(tp, m), c.error_type);
        c.instantiation_depth = 0;
        let code = c.diagnostic_store[DiagnosticId(1)].code();
        assert_eq!(code, 2589);
        // A composite mapper instantiates what its first mapper changed.
        let tp2 = type_parameter(c);
        c.scripted_type_variables.add(tp2);
        let first = c.new_simple_type_mapper(tp2, tp);
        let composite = c.combine_type_mappers(first, m);
        assert_eq!(c.map(composite, tp2), c.string_type);
        assert_eq!(c.map(composite, tp), c.string_type);
        let merged = c.merge_type_mappers(first, m);
        assert_eq!(c.map(merged, tp2), c.string_type);
        assert_eq!(
            c.compare_type_mappers(first, m).signum(),
            c.compare_types(tp2, tp).signum()
        );
        assert_eq!(fault_count(a), 0);
    });
}

#[test]
fn the_checker_is_one_record_of_arenas() {
    with_checker(|c, _, _| {
        // Every id of a record is its index, and the count of types is the id of the last one.
        assert_eq!(c.types.count(), c.type_count);
        assert_eq!(c.types[c.never_type].id, c.never_type);
        assert_eq!(c.signatures[c.unknown_signature].id, c.unknown_signature);
        assert!(std::mem::size_of::<TypeMapper<'_>>() <= 48);
        assert!(std::mem::size_of::<crate::ast::open::Symbol<'_>>() <= 64);
        assert_eq!(std::mem::size_of::<CacheHashKey>(), 16);
        assert_eq!(std::mem::size_of::<TypeComparer>(), 12);
    });
}
