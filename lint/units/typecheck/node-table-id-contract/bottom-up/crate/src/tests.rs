use crate::ast::ast_generated::{
    DEF_COUNT, Def, NodeFactory, NodeUpdater, is_identifier, is_variable_statement,
};
use crate::ast::builder::FileBuilder;
use crate::ast::factory::{Factory, NodeSink, NodeUpdate};
use crate::ast::file::{File, IdAllocator, SourceFileData};
use crate::ast::flags_generated::{FlowFlags, ModifierFlags, NodeFlags, SymbolFlags, TokenFlags};
use crate::ast::kind_generated::{Kind, is_token_kind};
use crate::ast::layout::{SlotType, VisitTag};
use crate::ast::open::Open;
use crate::ast::program::Program;
use crate::ast::publish::PublishError;
use crate::ast::reader::{Ast, Frozen, FrozenError};
use crate::bindprobe::{BindStats, bind_probe, get_symbol_name_for_private_identifier};
use crate::testimport::{ImportStats, import_dump};
use crate::tscore::deps::{hash_bytes, index_of};
use crate::tscore::ids::{
    FlowNodeId, ModifierListId, NodeId, NodeListId, OPEN_BIT, PAGE_SIZE, SymbolId, SymbolTableId,
};
use crate::tscore::internal::FaultKind;
use crate::tscore::stable::{Arena, Stable};
use crate::tscore::text::TextRange;
use std::sync::Arc;

const MIN_TS: &[u8] = b"const x: number = \"s\";\n";

// `const x: number = "s";` made the way a parser makes it: children before parents.
fn build_min(extra_garbage: bool, ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(MIN_TS);
    let name = b.new_identifier(b"x");
    b.set_loc(name, TextRange::new(5, 7));
    if extra_garbage {
        let mark = b.mark();
        let dropped = b.new_identifier(b"speculative");
        assert_eq!(dropped, NodeId(2));
        b.rewind(mark);
        // A node that nothing refers to is dropped by finish as well.
        let _unused = b.new_token(Kind::CommaToken);
    }
    let type_node = b.new_keyword_type_node(Kind::NumberKeyword);
    b.set_loc(type_node, TextRange::new(8, 15));
    let initializer = b.new_string_literal(b"s", TokenFlags::NONE);
    b.set_loc(initializer, TextRange::new(17, 21));
    let declaration = b.new_variable_declaration(name, NodeId::NIL, type_node, initializer);
    b.set_loc(declaration, TextRange::new(5, 21));
    let declarations = b.new_node_list(&[declaration]);
    b.set_list_loc(declarations, TextRange::new(5, 21));
    let list = b.new_variable_declaration_list(declarations, NodeFlags::CONST);
    b.set_loc(list, TextRange::new(0, 21));
    let statement = b.new_variable_statement(ModifierListId::NIL, list);
    b.set_loc(statement, TextRange::new(0, 22));
    let statements = b.new_node_list(&[statement]);
    b.set_list_loc(statements, TextRange::new(0, 22));
    let eof = b.new_token(Kind::EndOfFile);
    b.set_loc(eof, TextRange::new(22, 23));
    let root = b.new_source_file(statements, eof);
    b.set_loc(root, TextRange::new(0, 23));
    assert_eq!(b.faults.count(), 0);
    match b.finish(
        root,
        SourceFileData {
            file_name: b"/min.ts".to_vec(),
            ..SourceFileData::default()
        },
        ids,
    ) {
        Some(file) => file,
        None => panic!("no ids left"),
    }
}

fn bind_and_publish(file: File, ids: &IdAllocator) -> (Arc<File>, BindStats) {
    let mut stats = BindStats::default();
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        stats = bind_probe(a, root);
        assert_eq!(a.open().faults.first(), None);
    });
    // A second request does not bind again.
    file.bind_once(ids, |_| panic!("bound twice"));
    (Arc::new(file), stats)
}

// Everything a context can read below a node, with the ids of the file taken relative to its base.
fn digest(a: Ast<'_>, file: &File) -> u64 {
    let base = file.base();
    let bound_base = file.bound().map_or(0, |bound| bound.base());
    // An id of the nodes and lists relative to their range, an id of the binder relative to its range.
    let rel = |id: u32| {
        if id == 0 || id & OPEN_BIT != 0 {
            id
        } else if id > bound_base && bound_base > base {
            id - bound_base
        } else {
            id - base
        }
    };
    let mut out: Vec<u8> = Vec::new();
    let mut put = |value: u32| out.extend_from_slice(&value.to_le_bytes());
    let mut stack = vec![file.source_file.root];
    while let Some(node) = stack.pop() {
        put(rel(node.0));
        put(a.kind(node) as u32);
        put(a.def(node) as u32);
        put(a.flags(node).0);
        put(a.pos(node) as u32);
        put(a.end(node) as u32);
        put(rel(a.parent(node).0));
        let symbol = a.symbol(node);
        put(rel(symbol.0));
        if !symbol.is_nil() {
            let s = a.sym(symbol);
            put(s.flags.0);
            put(hash_bytes(s.name) as u32);
            put(s.declarations.len() as u32);
            for declaration in s.declarations.iter() {
                put(rel(declaration.0));
            }
            put(rel(s.value_declaration.0));
        }
        let locals = a.locals(node);
        put(rel(locals.0));
        for position in 0..a.table_len(locals) as usize {
            if let Some((name, symbol)) = a.table_entry_at(locals, position) {
                put(hash_bytes(name) as u32);
                put(rel(symbol.0));
                put(rel(a.table_get(locals, name).0));
            }
        }
        put(rel(a.next_container(node).0));
        let flow = a.flow(a.flow_node(node));
        put(flow.flags.0);
        put(rel(flow.node.0));
        put(rel(flow.antecedent.0));
        if let Some((def, data)) = a.data_any(node) {
            for (index, slot) in def.info().slots.iter().enumerate() {
                match slot.ty {
                    SlotType::Node => put(rel(data.node(index).0)),
                    SlotType::NodeList | SlotType::ModifierList | SlotType::RawNodeList => {
                        let list = data.list(index);
                        put(rel(list.0));
                        put(a.list_loc(list).pos as u32);
                        put(a.list_loc(list).end as u32);
                        put(a.nodes(list).len() as u32);
                    }
                    SlotType::Text => put(hash_bytes(data.text(index)) as u32),
                    _ => put(data.int(index) as u32),
                }
            }
        }
        let mut children: Vec<NodeId> = a.jsdoc(node).iter().collect();
        children.extend(a.iter_children(node));
        for child in &children {
            assert_eq!(
                a.parent(*child),
                node,
                "the parent of a child is the node that holds it"
            );
        }
        stack.extend(children.iter().rev());
    }
    hash_bytes(&out)
}

#[test]
fn stable_store_keeps_addresses() {
    let store: Stable<u32> = Stable::new();
    let first = store.push(7).map(std::ptr::from_ref);
    for value in 0..5000u32 {
        assert_eq!(store.push(value).copied(), Some(value));
    }
    assert_eq!(store.get(0).map(std::ptr::from_ref), first);
    assert_eq!(store.get(0).copied(), Some(7));
    assert_eq!(store.get(5000).copied(), Some(4999));
    assert_eq!(store.get(5001), None);
    let arena = Arena::new();
    let a = arena.alloc_slice_copy(&[NodeId(1), NodeId(2)]);
    let b = arena.alloc_slice_copy(b"text".as_slice());
    assert_eq!(
        (a, b),
        ([NodeId(1), NodeId(2)].as_slice(), b"text".as_slice())
    );
    assert_eq!(arena.allocated_bytes(), 12);
}

#[test]
fn workspace_crates_link() {
    assert_eq!(index_of(b"abcdef", b"cd"), Some(2));
    assert_ne!(hash_bytes(b"abc"), hash_bytes(b"abd"));
}

#[test]
fn finish_numbers_in_for_each_child_order() {
    let ids = IdAllocator::new();
    for garbage in [false, true] {
        let file = build_min(garbage, &ids);
        assert_eq!(file.node_count(), 8);
        let base = file.base();
        assert_eq!(base, if garbage { 2 * PAGE_SIZE } else { PAGE_SIZE });
        let arena = Arena::new();
        let open = Open::new(&arena, &ids);
        let frozen = Frozen::of_binding(&file);
        let a = Ast::new(&frozen, &open);
        let n = |local: u32| NodeId(base + local);
        let kinds: Vec<Kind> = (1..=8).map(|id| a.kind(n(id))).collect();
        assert_eq!(
            kinds,
            [
                Kind::SourceFile,
                Kind::VariableStatement,
                Kind::VariableDeclarationList,
                Kind::VariableDeclaration,
                Kind::Identifier,
                Kind::NumberKeyword,
                Kind::StringLiteral,
                Kind::EndOfFile
            ]
        );
        let parents: Vec<u32> = (1..=8)
            .map(|id| a.parent(n(id)).0.saturating_sub(base))
            .collect();
        assert_eq!(parents, [0, 1, 2, 3, 4, 4, 4, 1]);
        assert_eq!(file.source_file.root, n(1));
        let root = a.as_source_file(n(1));
        assert_eq!(a.nodes(root.statements).as_slice(), [n(2)]);
        assert_eq!(root.end_of_file_token, n(8));
        assert!(is_variable_statement(a, n(2)));
        let declaration = a.as_variable_declaration(n(4));
        assert!(is_identifier(a, declaration.name));
        assert_eq!(a.as_identifier(declaration.name).text, b"x");
        assert_eq!(a.name(n(4)), n(5));
        assert_eq!(a.type_node(n(4)), n(6));
        assert_eq!(a.initializer(n(4)), n(7));
        assert_eq!(a.text(n(7)), b"s");
        assert_eq!(a.flags(n(3)), NodeFlags::CONST);
        assert_eq!(a.list_loc(root.statements), TextRange::new(0, 22));
        assert!(a.modifiers(n(2)).is_nil());
        assert!(a.nodes(a.modifiers(n(2)).as_node_list()).is_nil());
        assert_eq!(
            a.iter_children(n(4)).collect::<Vec<_>>(),
            [n(5), n(6), n(7)]
        );
        assert_eq!(open.faults.count(), 0);
        // A cast to another definition gives the zero value and records a fault.
        assert_eq!(a.as_if_statement(n(4)).expression, NodeId::NIL);
        assert_eq!(
            open.faults.first().map(|fault| fault.kind),
            Some(FaultKind::BadCast)
        );
        // A method of Node on a kind that upstream does not handle.
        assert_eq!(a.expression(n(4)), NodeId::NIL);
        assert_eq!(open.faults.count(), 2);
        // An id that no file of the context owns reads as nil.
        assert_eq!(
            (
                a.kind(NodeId(7)),
                a.parent(NodeId(base + 500)),
                a.kind(NodeId(u32::MAX))
            ),
            (Kind::Unknown, NodeId::NIL, Kind::Unknown)
        );
    }
}

#[test]
fn bind_publish_and_share_between_programs() {
    let ids = IdAllocator::new();
    let (first, stats) = bind_and_publish(build_min(false, &ids), &ids);
    let (second, _) = bind_and_publish(build_min(true, &ids), &ids);
    assert_eq!(
        stats,
        BindStats {
            nodes: 8,
            symbols: 1,
            declarations: 1,
            tables: 1,
            flow_nodes: 3,
            flow_data_nodes: 0,
            private_names: 0
        }
    );
    let bases = |file: &File| (file.base(), file.bound().map_or(0, |bound| bound.base()));
    assert_eq!(
        (bases(&first), bases(&second)),
        ((PAGE_SIZE, 2 * PAGE_SIZE), (3 * PAGE_SIZE, 4 * PAGE_SIZE))
    );
    let second_bound = second.bound().map_or(0, |bound| bound.base());

    let one = Program::new(vec![Arc::clone(&first), Arc::clone(&second)]);
    let other = Program::new(vec![Arc::clone(&second), Arc::clone(&first)]);
    let alone = Program::new(vec![Arc::clone(&second)]);
    let arena = Arena::new();
    let mut digests = Vec::new();
    for program in [&one, &other, &alone] {
        let frozen = match program.frozen() {
            Ok(frozen) => frozen,
            Err(error) => panic!("{error:?}"),
        };
        let open = Open::new(&arena, &ids);
        let a = Ast::new(&frozen, &open);
        for file in program.files() {
            digests.push(digest(a, file));
        }
        // The declaration of x in the second file, by an id that is the same in every program.
        let declaration = NodeId(second.base() + 4);
        let symbol = a.symbol(declaration);
        assert_eq!(symbol, SymbolId(second_bound + 1));
        assert_eq!(a.sym(symbol).name, b"x");
        assert_eq!(a.sym(symbol).declarations.as_slice(), [declaration]);
        let locals = a.locals(NodeId(second.base() + 1));
        assert_eq!(a.table_get(locals, b"x"), symbol);
        assert_eq!(a.table_get(locals, b"y"), SymbolId::NIL);
        assert_eq!(
            a.flow(a.flow_node(NodeId(second.base() + 5))).node,
            NodeId(second.base() + 5)
        );
        assert_eq!(open.faults.first(), None);
        // A published file takes no write.
        a.set_symbol(declaration, SymbolId::NIL);
        a.set_flags(declaration, NodeFlags::NONE);
        assert_eq!(
            open.faults.first().map(|fault| fault.kind),
            Some(FaultKind::WriteToFrozen)
        );
        assert_eq!(a.symbol(declaration), symbol);
    }
    // The two files hold the same tree, so every digest is the same: no id was left without its base.
    assert!(digests.iter().all(|d| *d == digests[0]), "{digests:?}");

    // Files of two allocators cannot be in one program.
    let other_ids = IdAllocator::new();
    let foreign = bind_and_publish(build_min(false, &other_ids), &other_ids).0;
    let mixed = Program::new(vec![first, foreign]);
    assert_eq!(
        mixed.frozen().err(),
        Some(FrozenError::Overlap {
            first: 0,
            second: 1
        })
    );
}

#[test]
fn checker_nodes_live_in_the_open_store() {
    let ids = IdAllocator::new();
    let (file, _) = bind_and_publish(build_min(false, &ids), &ids);
    let program = Program::new(vec![Arc::clone(&file)]);
    let frozen = match program.frozen() {
        Ok(frozen) => frozen,
        Err(error) => panic!("{error:?}"),
    };
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let a = Ast::new(&frozen, &open);
    let mut factory = Factory::new(a);
    let declaration = NodeId(file.base() + 4);
    let name = a.name(declaration);
    // checker.go isPropertyInitializedInConstructor: `this.x` with a name that is a node of the file.
    let this = factory.new_keyword_expression(Kind::ThisKeyword);
    let reference =
        factory.new_property_access_expression(this, NodeId::NIL, name, NodeFlags::NONE);
    a.set_parent(this, reference);
    a.set_parent(reference, declaration);
    a.set_flow_node(reference, a.flow_node(name));
    assert!(reference.is_open() && this.is_open());
    assert_eq!(a.kind(reference), Kind::PropertyAccessExpression);
    assert_eq!(a.expression(reference), this);
    assert_eq!(a.parent(a.expression(reference)), reference);
    assert_eq!(a.name(reference), name);
    assert_eq!(a.parent(name), declaration);
    assert_eq!(a.flow_node(reference), a.flow_node(name));
    assert_eq!(a.iter_children(reference).collect::<Vec<_>>(), [this, name]);
    a.set_loc(reference, a.loc(declaration));
    assert_eq!(a.loc(reference), TextRange::new(5, 21));

    // Update returns the node itself when nothing changed, else a node with the flags and the range of the original.
    let same = factory.update_property_access_expression(
        reference,
        this,
        NodeId::NIL,
        name,
        a.flags(reference),
    );
    assert_eq!(same, reference);
    let other = factory.new_identifier(b"y");
    let updated = factory.update_property_access_expression(
        reference,
        this,
        NodeId::NIL,
        other,
        a.flags(reference),
    );
    assert_ne!(updated, reference);
    assert_eq!(a.loc(updated), a.loc(reference));
    assert_eq!(a.as_identifier(a.name(updated)).text, b"y");
    // Clone of a node of the file: the text moves into the open store, the fields of the binder do not.
    let clone = factory.clone_node(name);
    assert!(clone.is_open());
    assert_eq!(a.as_identifier(clone).text, b"x");
    assert_eq!(a.loc(clone), a.loc(name));
    assert_eq!(a.flow_node(clone), FlowNodeId::NIL);
    // A list and a transient symbol of the checker.
    let list = factory.new_node_list(&[clone, other]);
    assert_eq!(a.nodes(list).as_slice(), [clone, other]);
    assert!(a.nodes(NodeListId::NIL).is_nil());
    let symbol = a.new_symbol(SymbolFlags::TRANSIENT, b"t");
    a.update_symbol(symbol, |s| s.value_declaration = clone);
    assert_eq!(a.sym(symbol).value_declaration, clone);
    let table = a.new_table();
    a.table_set(table, b"t", symbol);
    assert_eq!(a.table_get(table, b"t"), symbol);
    assert_eq!(a.table_entry_at(table, 0), Some((b"t".as_slice(), symbol)));
    a.table_set(SymbolTableId::NIL, b"t", symbol);
    assert_eq!(
        open.faults.first().map(|fault| fault.kind),
        Some(FaultKind::NilMapWrite)
    );
    let flow = a.new_flow_node(FlowFlags::TRUE_CONDITION, reference, a.flow_node(name));
    assert_eq!(a.flow(flow).antecedent, a.flow_node(name));
    assert_eq!(open.node_count(), 5);
}

#[test]
fn lazy_symbol_ids_and_private_names() {
    let ids = IdAllocator::new();
    let source = b"class C { #x; }\n";
    let build = || {
        let mut b = FileBuilder::new(source);
        let private_name = b.new_private_identifier(b"#x");
        let property = b.new_property_declaration(
            ModifierListId::NIL,
            private_name,
            NodeId::NIL,
            NodeId::NIL,
            NodeId::NIL,
        );
        let members = b.new_node_list(&[property]);
        let class_name = b.new_identifier(b"C");
        let class = b.new_class_declaration(
            ModifierListId::NIL,
            class_name,
            NodeListId::NIL,
            NodeListId::NIL,
            members,
        );
        let statements = b.new_node_list(&[class]);
        let eof = b.new_token(Kind::EndOfFile);
        let root = b.new_source_file(statements, eof);
        match b.finish(root, SourceFileData::default(), &ids) {
            Some(file) => file,
            None => panic!("no ids left"),
        }
    };
    let (first, stats) = bind_and_publish(build(), &ids);
    let (second, _) = bind_and_publish(build(), &ids);
    assert_eq!(stats.private_names, 1);
    let program = Program::new(vec![Arc::clone(&first), Arc::clone(&second)]);
    let frozen = match program.frozen() {
        Ok(frozen) => frozen,
        Err(error) => panic!("{error:?}"),
    };
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let a = Ast::new(&frozen, &open);
    let mut names = Vec::new();
    for file in [&first, &second] {
        let class = NodeId(file.base() + 2);
        assert_eq!(a.kind(class), Kind::ClassDeclaration);
        let class_symbol = a.symbol(class);
        // The checker builds the name that the binder stored, from the id that the binder gave the class.
        let name = get_symbol_name_for_private_identifier(a, class_symbol, b"#x");
        let member = a.table_get(a.locals(class), name);
        assert!(!member.is_nil(), "{name:?}");
        assert_eq!(a.sym(member).name, name);
        names.push(name.to_vec());
    }
    assert_ne!(names[0], names[1]);
    // A symbol that the binder did not number gets its id from the checker, once.
    let member = a.symbol(NodeId(first.base() + 4));
    let id = a.get_symbol_id(member);
    assert_eq!((id, a.get_symbol_id(member)), (3, 3));
    let transient = a.new_symbol(SymbolFlags::TRANSIENT, b"t");
    assert_eq!(a.get_symbol_id(transient), 4);
}

// One node of every definition: the factory, the casts, the children, clone and update see the same layout.
#[test]
fn every_definition_round_trips() {
    let frozen = Frozen::none();
    let arena = Arena::new();
    let ids = IdAllocator::new();
    let open = Open::new(&arena, &ids);
    let a = Ast::new(&frozen, &open);
    let mut factory = Factory::new(a);
    let leaf = factory.new_token(Kind::CommaToken);
    let mut defs = 0;
    for index in 1..DEF_COUNT as u8 {
        let def = Def::from_u8(index);
        let info = def.info();
        let mut slots = Vec::new();
        let mut expected_children = 0usize;
        for (position, slot) in info.slots.iter().enumerate() {
            let is_child = info
                .children
                .iter()
                .any(|child| usize::from(child.slot) == position);
            slots.push(match slot.ty {
                SlotType::Node => {
                    expected_children += usize::from(is_child);
                    leaf.0
                }
                SlotType::NodeList | SlotType::RawNodeList => {
                    expected_children += 2 * usize::from(is_child);
                    factory.new_node_list(&[leaf, leaf]).0
                }
                SlotType::ModifierList => {
                    expected_children += usize::from(is_child);
                    factory.new_modifier_list(&[leaf]).0
                }
                SlotType::Text => factory.text_slot(slot.name.as_bytes()),
                SlotType::Bool => 1,
                _ => 3,
            });
        }
        let node = factory.alloc_node(def, Kind::Unknown, NodeFlags::SYNTHESIZED, &slots);
        let (actual, data) = match a.data_any(node) {
            Some(found) => found,
            None => panic!("{}", info.name),
        };
        assert_eq!(actual, def);
        for (position, slot) in info.slots.iter().enumerate() {
            match slot.ty {
                SlotType::Text => assert_eq!(data.text(position), slot.name.as_bytes()),
                _ => assert_eq!(
                    data.node(position).0,
                    slots[position],
                    "{}.{}",
                    info.name,
                    slot.name
                ),
            }
        }
        assert_eq!(
            a.iter_children(node).count(),
            expected_children,
            "{}",
            info.name
        );
        assert!(
            info.children
                .iter()
                .all(|child| match info.slots[usize::from(child.slot)].ty {
                    SlotType::Node => !matches!(
                        child.visit,
                        VisitTag::Nodes
                            | VisitTag::Modifiers
                            | VisitTag::RawNodes
                            | VisitTag::Parameters
                            | VisitTag::TopLevelStatements
                    ),
                    SlotType::NodeList | SlotType::RawNodeList | SlotType::ModifierList =>
                        !matches!(child.visit, VisitTag::Node | VisitTag::Token),
                    _ => false,
                })
        );
        // Update: the node itself when no member changed, else a new node of the same kind.
        assert_eq!(
            factory.update_node(node, def, None, &slots),
            node,
            "{}",
            info.name
        );
        if let Some(first) = info.slots.first().filter(|slot| slot.ty != SlotType::Text) {
            let mut changed = slots.clone();
            changed[0] = if first.ty == SlotType::Bool {
                0
            } else {
                changed[0] + 1
            };
            let updated = factory.update_node(node, def, None, &changed);
            assert_ne!(updated, node, "{}", info.name);
            assert_eq!(
                (a.def(updated), a.flags(updated)),
                (def, NodeFlags::SYNTHESIZED)
            );
        }
        let clone = factory.clone_node(node);
        assert_eq!(
            a.iter_children(clone).collect::<Vec<_>>(),
            a.iter_children(node).collect::<Vec<_>>()
        );
        assert_eq!(a.flags(clone), NodeFlags::SYNTHESIZED);
        defs += 1;
    }
    assert_eq!(defs, 194);
    assert_eq!(open.faults.first(), None);
    assert!(is_token_kind(Kind::CommaToken) && !is_token_kind(Kind::IfStatement));
    assert_eq!(
        Def::of_kind(Kind::ThisKeyword),
        (Def::KeywordExpression, Def::Token)
    );
    assert_eq!(Kind::from_name(b"IfStatement"), Some(Kind::IfStatement));
    assert_eq!(Kind::FIRST_TOKEN, Kind::Unknown);
    assert_eq!(
        ModifierFlags::EXPORT_DEFAULT,
        ModifierFlags::EXPORT | ModifierFlags::DEFAULT
    );
    assert_eq!(SymbolFlags::ALL.0, (1 << 30) - 1);
}

#[test]
fn imports_a_dump_of_typescript() {
    let mut stats = ImportStats::default();
    let ids = IdAllocator::new();
    let files = match import_dump(
        include_bytes!("../testdata/lib.decorators.legacy.d.ts.ast.json"),
        &ids,
        &mut stats,
    ) {
        Ok(files) => files,
        Err(error) => panic!("{error:?}"),
    };
    assert_eq!(
        (stats.files, stats.dump_nodes, stats.made_nodes),
        (1, 77, 77)
    );
    assert_eq!(
        (
            stats.unknown_kinds,
            stats.unmapped_children,
            stats.unmapped_lists,
            stats.unmapped_attrs
        ),
        (0, 0, 0, 0),
        "{:?}",
        stats.first_unmapped
    );
    let mut published = Vec::new();
    for file in files {
        assert_eq!(file.node_count(), 77);
        published.push(bind_and_publish(file, &ids).0);
    }
    let program = Program::new(published);
    let frozen = match program.frozen() {
        Ok(frozen) => frozen,
        Err(error) => panic!("{error:?}"),
    };
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let a = Ast::new(&frozen, &open);
    let file = &program.files()[0];
    let root = file.source_file.root;
    let statements = a.statements(root);
    assert_eq!(statements.len(), 4);
    let first = statements.at(0usize);
    assert_eq!(a.kind(first), Kind::TypeAliasDeclaration);
    assert_eq!(a.text(a.name(first)), b"ClassDecorator");
    assert_eq!(a.modifier_flags(first), ModifierFlags::AMBIENT);
    assert!(a.flags(first).contains(NodeFlags::AMBIENT));
    assert_eq!(
        a.sym(a.table_get(a.locals(root), b"MethodDecorator"))
            .declarations
            .at(0usize),
        statements.at(2usize)
    );
    assert_eq!(a.kind(a.type_node(first)), Kind::FunctionType);
    assert_eq!(a.type_parameters(a.type_node(first)).len(), 1);
    assert_eq!(
        &file.source_text()[a.pos(a.name(first)) as usize + 1..a.end(a.name(first)) as usize],
        b"ClassDecorator"
    );
    assert_eq!(open.faults.first(), None);
}

// What the binder and the program layer make: the data node of a switch clause flow node, a synthetic import.
#[test]
fn published_stores_keep_their_nodes() {
    let ids = IdAllocator::new();
    let mut b = FileBuilder::new(b"switch (x) {}\n");
    let x = b.new_identifier(b"x");
    let clauses = b.new_node_list(&[]);
    let case_block = b.new_case_block(clauses);
    let switch = b.new_switch_statement(x, case_block);
    let statements = b.new_node_list(&[switch]);
    let eof = b.new_token(Kind::EndOfFile);
    let root = b.new_source_file(statements, eof);
    let file = match b.finish(root, SourceFileData::default(), &ids) {
        Some(file) => file,
        None => panic!("no ids left"),
    };
    let (file, stats) = bind_and_publish(file, &ids);
    assert_eq!(stats.flow_data_nodes, 1);
    assert_eq!(file.bound().map(|bound| bound.node_count()), Some(1));
    assert_eq!(
        file.publish(&Open::new(&Arena::new(), &ids), &ids).err(),
        Some(PublishError::AlreadyPublished)
    );

    // compiler/fileloader.go createSyntheticImport: a string literal in an import declaration whose parent is the file.
    let arena = Arena::new();
    let imports = {
        let none = Frozen::none();
        let open = Open::new(&arena, &ids);
        let a = Ast::new(&none, &open);
        let mut factory = Factory::new(a);
        let specifier = factory.new_string_literal(b"tslib", TokenFlags::NONE);
        let declaration = factory.new_import_declaration(
            ModifierListId::NIL,
            NodeId::NIL,
            specifier,
            NodeId::NIL,
        );
        a.set_parent(specifier, declaration);
        a.set_parent(declaration, file.source_file.root);
        match File::of_open(&open, &ids) {
            Ok(imports) => Arc::new(imports),
            Err(error) => panic!("{error:?}"),
        }
    };
    let program = Program::new(vec![Arc::clone(&file), Arc::clone(&imports)]);
    let frozen = match program.frozen() {
        Ok(frozen) => frozen,
        Err(error) => panic!("{error:?}"),
    };
    let open = Open::new(&arena, &ids);
    let a = Ast::new(&frozen, &open);
    let bound_base = file.bound().map_or(0, |bound| bound.base());
    // The flow node of the clause is the second flow node of the binder after the start node and the one of x.
    let switch = a.statements(file.source_file.root).at(0usize);
    assert_eq!(a.kind(switch), Kind::SwitchStatement);
    let clause_flow = (1..8)
        .map(|index| a.flow(FlowNodeId(bound_base + index)))
        .find(|flow| flow.flags.intersects(FlowFlags::SWITCH_CLAUSE));
    let data_node = clause_flow.map_or(NodeId::NIL, |flow| flow.node);
    assert_eq!(data_node, NodeId(bound_base + 1));
    assert_eq!(a.kind(data_node), Kind::Unknown);
    let data = a.as_flow_switch_clause_data(data_node);
    assert_eq!(
        (data.switch_statement, data.clause_start, data.clause_end),
        (switch, 0, 1)
    );
    assert_eq!(a.parent(data_node), NodeId::NIL);
    // The nodes of the program.
    let imports_base = imports.bound().map_or(0, |bound| bound.base());
    let specifier = NodeId(imports_base + 1);
    let declaration = NodeId(imports_base + 2);
    assert_eq!(a.text(specifier), b"tslib");
    assert_eq!(a.parent(specifier), declaration);
    assert_eq!(a.module_specifier(declaration), specifier);
    assert_eq!(a.parent(declaration), file.source_file.root);
    assert_eq!(a.symbol(declaration), SymbolId::NIL);
    // GetSourceFileOfNode: by the page of a node of a file, by the parents of a node of a store.
    assert_eq!(
        a.source_file_of(a.expression(switch)),
        file.source_file.root
    );
    assert_eq!(a.source_file_of(specifier), file.source_file.root);
    assert_eq!(a.source_file_of(data_node), NodeId::NIL);
    assert_eq!(open.faults.first(), None);
}

// A table of more than eight entries is found through its hash index after the file is bound.
#[test]
fn bound_tables_with_an_index() {
    let ids = IdAllocator::new();
    let names: Vec<Vec<u8>> = (0..40)
        .map(|index| format!("name{index}").into_bytes())
        .collect();
    let mut b = FileBuilder::new(b"");
    let mut statements = Vec::new();
    for name in &names {
        let identifier = b.new_identifier(name);
        let declaration =
            b.new_variable_declaration(identifier, NodeId::NIL, NodeId::NIL, NodeId::NIL);
        let declarations = b.new_node_list(&[declaration]);
        let list = b.new_variable_declaration_list(declarations, NodeFlags::LET);
        statements.push(b.new_variable_statement(ModifierListId::NIL, list));
    }
    // The reparser of upstream writes a member after the node exists: a type for the first declaration.
    let first = statements.first().copied().unwrap_or(NodeId::NIL);
    let declaration_list = NodeId(b.slot(first, 1));
    assert_eq!(b.kind(declaration_list), Kind::VariableDeclarationList);
    let first_declaration =
        b.new_variable_declaration(NodeId::NIL, NodeId::NIL, NodeId::NIL, NodeId::NIL);
    let keyword = b.new_keyword_type_node(Kind::StringKeyword);
    let copy = b.clone_node(keyword);
    b.set_type_node(first_declaration, copy);
    b.set_initializer(first_declaration, keyword);
    assert_eq!(
        (b.slot(first_declaration, 2), b.slot(first_declaration, 3)),
        (copy.0, keyword.0)
    );
    b.set_expression(first_declaration, keyword);
    assert_eq!(
        b.faults.first().map(|fault| fault.kind),
        Some(FaultKind::Panic)
    );
    let statements = b.new_node_list(&statements);
    let eof = b.new_token(Kind::EndOfFile);
    let root = b.new_source_file(statements, eof);
    let file = match b.finish(root, SourceFileData::default(), &ids) {
        Some(file) => file,
        None => panic!("no ids left"),
    };
    let (file, stats) = bind_and_publish(file, &ids);
    assert_eq!((stats.symbols, stats.tables), (40, 1));
    let program = Program::new(vec![Arc::clone(&file)]);
    let frozen = match program.frozen() {
        Ok(frozen) => frozen,
        Err(error) => panic!("{error:?}"),
    };
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let a = Ast::new(&frozen, &open);
    let locals = a.locals(file.source_file.root);
    assert_eq!(a.table_len(locals), 40);
    for (position, name) in names.iter().enumerate() {
        let symbol = a.table_get(locals, name);
        assert_eq!(a.sym(symbol).name, name.as_slice());
        assert_eq!(
            a.table_entry_at(locals, position).map(|entry| entry.1),
            Some(symbol)
        );
        assert_eq!(a.symbol(a.sym(symbol).value_declaration), symbol);
    }
    assert_eq!(a.table_get(locals, b"name40"), SymbolId::NIL);
    assert_eq!(a.table_get(locals, b""), SymbolId::NIL);
    assert_eq!(open.faults.first(), None);
}
