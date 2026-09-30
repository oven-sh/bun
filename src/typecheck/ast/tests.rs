// Tests of the node table: the generated tables, the builder, the frozen file, the bind result, the open store and the visitor.
use crate::ast::stable::Arena;
use crate::ast::*;
use crate::core::{List, new_text_range};
use crate::internal::FaultKind;
use crate::tspath::Path;

const SOURCE: &[u8] = b"const x = 1;\nfunction f(a) { return a + x; }\n";

// The kinds of the tree of SOURCE in the order of ForEachChild.
const TREE: [Kind; 17] = [
    Kind::SourceFile,
    Kind::VariableStatement,
    Kind::VariableDeclarationList,
    Kind::VariableDeclaration,
    Kind::Identifier,
    Kind::NumericLiteral,
    Kind::FunctionDeclaration,
    Kind::Identifier,
    Kind::Parameter,
    Kind::Identifier,
    Kind::Block,
    Kind::ReturnStatement,
    Kind::BinaryExpression,
    Kind::Identifier,
    Kind::PlusToken,
    Kind::Identifier,
    Kind::EndOfFile,
];

fn some<T>(value: Option<T>) -> T {
    match value {
        Some(value) => value,
        None => panic!("expected a value"),
    }
}

fn text(start: usize, end: usize) -> &'static [u8] {
    some(SOURCE.get(start..end))
}

fn at(b: &mut FileBuilder, node: NodeId, pos: i32, end: i32) -> NodeId {
    b.set_loc(node, new_text_range(pos, end));
    node
}

fn list(b: &mut FileBuilder, nodes: &[NodeId], pos: i32, end: i32) -> NodeListId {
    let list = b.new_node_list(nodes);
    b.set_list_loc(list, new_text_range(pos, end));
    list
}

// The tree of SOURCE, made bottom up and the function first, as no parser would: the ids of the file do not depend on it.
fn build(ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(SOURCE);
    let nil = NodeId::NIL;
    let a1 = b.new_identifier(text(36, 37));
    at(&mut b, a1, 35, 37);
    let plus = b.new_token(Kind::PlusToken);
    at(&mut b, plus, 37, 39);
    let x2 = b.new_identifier(text(40, 41));
    at(&mut b, x2, 39, 41);
    let sum = b.new_binary_expression(ModifierListId::NIL, a1, nil, plus, x2);
    at(&mut b, sum, 35, 41);
    let ret = b.new_return_statement(sum);
    at(&mut b, ret, 28, 42);
    let body = list(&mut b, &[ret], 28, 42);
    let block = b.new_block(body, false);
    at(&mut b, block, 26, 44);
    let parameter_name = b.new_identifier(text(24, 25));
    at(&mut b, parameter_name, 24, 25);
    let parameter =
        b.new_parameter_declaration(ModifierListId::NIL, nil, parameter_name, nil, nil, nil);
    at(&mut b, parameter, 24, 25);
    let parameters = list(&mut b, &[parameter], 24, 25);
    let function_name = b.new_identifier(text(22, 23));
    at(&mut b, function_name, 21, 23);
    let function = b.new_function_declaration(
        ModifierListId::NIL,
        nil,
        function_name,
        NodeListId::NIL,
        parameters,
        nil,
        nil,
        block,
    );
    at(&mut b, function, 12, 44);
    let x1 = b.new_identifier(text(6, 7));
    at(&mut b, x1, 5, 7);
    let one = b.new_numeric_literal(text(10, 11), TokenFlags::NONE);
    at(&mut b, one, 9, 11);
    let declaration = b.new_variable_declaration(x1, nil, nil, one);
    at(&mut b, declaration, 5, 11);
    let declarations = list(&mut b, &[declaration], 5, 11);
    let declaration_list = b.new_variable_declaration_list(declarations, NodeFlags::CONST);
    at(&mut b, declaration_list, 0, 11);
    let statement = b.new_variable_statement(ModifierListId::NIL, declaration_list);
    at(&mut b, statement, 0, 12);
    let end_of_file = b.new_token(Kind::EndOfFile);
    at(&mut b, end_of_file, 44, 45);
    let statements = list(&mut b, &[statement, function], 0, 44);
    let root = b.new_source_file(statements, end_of_file);
    at(&mut b, root, 0, 45);
    assert_eq!(b.node_count(), 17);
    assert_eq!(b.text_count(), 6);
    let data = SourceFileData {
        file_name: b"/a.ts".to_vec(),
        path: Path(b"/a.ts".to_vec()),
        ..SourceFileData::default()
    };
    some(b.finish(root, data, ids))
}

// The node at a position of TREE.
fn node(file: &File, position: u32) -> NodeId {
    NodeId(file.base() + 1 + position)
}

fn walk(a: Ast<'_>, node: NodeId, out: &mut Vec<NodeId>) {
    out.push(node);
    for child in a.iter_children(node) {
        walk(a, child, out);
    }
}

#[test]
fn generated_tables_agree_with_ast_json() {
    assert_eq!(KIND_COUNT, 351);
    assert_eq!(Kind::Count as usize, KIND_COUNT);
    assert_eq!(DEF_COUNT, 195);
    assert_eq!(Kind::from_u16(Kind::Identifier as u16), Kind::Identifier);
    assert_eq!(Kind::from_u16(u16::MAX), Kind::Unknown);
    assert_eq!(Kind::Identifier.string(), "KindIdentifier");
    assert_eq!(Kind::JSDocParameterTag.name(), "JSDocParameterTag");
    assert_eq!(
        Kind::from_name(b"JSDocParameterTag"),
        Some(Kind::JSDocParameterTag)
    );
    assert_eq!(Kind::from_name(b"NoSuchKind"), None);
    assert_eq!(Kind::FIRST_ASSIGNMENT, Kind::EqualsToken);
    for value in 0..=u8::MAX {
        let def = Def::from_u8(value);
        let info = def.info();
        assert!(info.slots.len() <= MAX_SLOTS);
        assert!(usize::from(info.factory_slots) <= info.slots.len());
        for child in info.children.iter().chain(info.children_alt) {
            assert!(usize::from(*child) < usize::from(info.factory_slots));
        }
        assert_eq!(Def::from_name(info.name.as_bytes()), def);
    }
    assert_eq!(
        Def::of_kind(Kind::FunctionDeclaration),
        (Def::FunctionDeclaration, Def::None)
    );
    assert_eq!(Def::of_kind(Kind::PlusToken), (Def::Token, Def::None));
    let info = Def::FunctionDeclaration.info();
    let names: Vec<&str> = info.slots.iter().map(|slot| slot.name).collect();
    let members = [
        "modifiers",
        "AsteriskToken",
        "name",
        "TypeParameters",
        "Parameters",
        "Type",
        "FullSignature",
        "Body",
    ];
    assert_eq!(names, members);
    let late = LATE_SYMBOL
        | LATE_LOCAL_SYMBOL
        | LATE_LOCALS
        | LATE_NEXT_CONTAINER
        | LATE_FLOW_NODE
        | LATE_END_FLOW_NODE
        | LATE_RETURN_FLOW_NODE;
    assert_eq!(info.late, late);
    let clause = Def::CaseOrDefaultClause.info().late;
    assert_eq!(
        clause & LATE_FALLTHROUGH_FLOW_NODE,
        LATE_FALLTHROUGH_FLOW_NODE
    );
    assert_eq!(NodeFlags::BLOCK_SCOPED.bits(), 7);
    assert!(SubtreeFacts::COMPUTED.bits() != 0);
}

#[test]
fn finish_numbers_the_nodes_in_the_order_of_for_each_child() {
    let ids = IdAllocator::new();
    let file = build(&ids);
    assert_eq!(file.node_count(), 17);
    assert_eq!((file.base(), file.span()), (PAGE_SIZE, PAGE_SIZE));
    assert_eq!(file.copied_text_len(), 0);
    assert_eq!(file.fault_count(), 0);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&file]).ok());
    let a = Ast::new(&frozen, &open);
    let root = file.source_file.root;
    assert_eq!(root, node(&file, 0));
    let mut seen = Vec::new();
    walk(a, root, &mut seen);
    let kinds: Vec<Kind> = seen.iter().map(|node| a.kind(*node)).collect();
    assert_eq!(kinds, TREE);
    for (position, id) in seen.iter().enumerate() {
        assert_eq!(*id, node(&file, position as u32));
        for child in a.iter_children(*id) {
            assert_eq!(a.parent(child), *id);
        }
    }
    assert!(a.parent(root).is_nil());

    let function = node(&file, 6);
    let data = a.as_function_declaration(function);
    assert_eq!(a.text(data.name), b"f");
    assert_eq!(a.name(function), data.name);
    assert_eq!((a.pos(function), a.end(function)), (12, 44));
    assert_eq!(a.parameters(function).len(), 1);
    assert_eq!(a.body(function), node(&file, 10));
    assert!(a.function_like_data(function).is_some() && a.class_like_data(function).is_none());
    assert!(a.has_declaration_data(function) && a.has_locals_container_data(function));
    assert!(a.symbol(function).is_nil());
    assert_eq!(a.flags(node(&file, 2)), NodeFlags::CONST);
    let declaration = a.as_variable_declaration(node(&file, 3));
    assert_eq!(a.text(declaration.initializer), b"1");
    assert!(is_numeric_literal(a, declaration.initializer));
    let sum = a.as_binary_expression(node(&file, 12));
    assert_eq!(a.kind(sum.operator_token), Kind::PlusToken);
    assert_eq!(
        (a.text(sum.left), a.text(sum.right)),
        (&b"a"[..], &b"x"[..])
    );
    assert_eq!(a.expression(node(&file, 11)), node(&file, 12));
    assert!(a.contains(function, sum.right) && !a.contains(node(&file, 1), sum.right));
    assert_eq!(a.source_file_of(sum.right), root);

    // A text of a node is a slice of the source text of the file: nothing was copied.
    let range = file.source_text().as_ptr_range();
    assert!(range.contains(&a.text(sum.right).as_ptr()));
    let view = a.as_source_file(root);
    assert_eq!(view.text(), SOURCE);
    assert_eq!(view.file_name(), b"/a.ts");
    assert_eq!(view.path(), &Path(b"/a.ts".to_vec()));
    assert_eq!((view.node_count, view.text_count), (17, 6));
    assert_eq!(a.kind(view.end_of_file_token), Kind::EndOfFile);
    assert_eq!(a.statements(root).as_slice(), [node(&file, 1), function]);
    assert_eq!(a.list_loc(view.statements), new_text_range(0, 44));
    assert!(!a.has_trailing_comma(view.statements) && !view.is_bound());
    assert_eq!(view.ecma_line_map().len(), 3);
    assert_eq!(
        a.member(function, b"Body"),
        Some(MemberValue::Node(node(&file, 10)))
    );
    assert_eq!(a.member(function, b"NoSuchMember"), None);
    assert_eq!(open.faults.count(), 0);

    // The nil node reads as nothing, and a cast to another definition is a fault.
    assert_eq!(a.kind(NodeId::NIL), Kind::Unknown);
    assert!(a.as_block(function).statements.is_nil());
    assert_eq!(some(open.faults.first()).kind, FaultKind::BadCast);
    a.set_loc(function, new_text_range(0, 1));
    assert_eq!(a.pos(function), 12);
    assert_eq!(open.faults.count(), 2);
}

#[test]
fn what_the_binder_writes_is_kept_beside_the_file() {
    let ids = IdAllocator::new();
    let file = build(&ids);
    let root = file.source_file.root;
    let (declaration, x1, function, block) = (
        node(&file, 3),
        node(&file, 4),
        node(&file, 6),
        node(&file, 10),
    );
    let names: Vec<Vec<u8>> = (0..20)
        .map(|number| format!("name{number}").into_bytes())
        .collect();
    let bound = file.bind_once(&ids, |a| {
        let arena = a.open().arena;
        let symbol = a.new_symbol(SymbolFlags::FUNCTION, a.text(a.name(function)));
        let declarations = List::from_slice(arena.alloc_slice_copy(&[function]));
        a.update_symbol(symbol, |s| {
            s.value_declaration = function;
            s.declarations = declarations;
        });
        a.set_symbol(function, symbol);
        let exports = a.new_table();
        for name in &names {
            let name = arena.alloc_slice_copy(name);
            a.table_set(exports, name, a.new_symbol(SymbolFlags::PROPERTY, name));
        }
        let internal = a.new_symbol(SymbolFlags::ALIAS, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS);
        a.table_set(exports, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS, internal);
        a.update_symbol(symbol, |s| s.exports = exports);
        a.set_locals(function, a.new_table());
        let start = a.new_flow_node(FlowFlags::START, NodeId::NIL, FlowNodeId::NIL);
        let assignment = a.new_flow_node(FlowFlags::ASSIGNMENT, declaration, start);
        a.set_flow_node(x1, assignment);
        let clause = new_flow_switch_clause_data(a, block, 1, 3);
        let switch = a.new_flow_node(FlowFlags::SWITCH_CLAUSE, clause, assignment);
        a.set_end_flow_node(function, switch);
        let label = a.new_flow_node(FlowFlags::BRANCH_LABEL, NodeId::NIL, FlowNodeId::NIL);
        let antecedents = a.new_flow_list(start, FlowListId::NIL);
        a.update_flow(label, |flow| flow.antecedents = antecedents);
        a.update_flow_list(antecedents, |entry| entry.flow = assignment);
        a.set_return_flow_node(function, label);
        a.set_flags(function, a.flags(function) | NodeFlags::HAS_IMPLICIT_RETURN);
        a.set_symbol_count(root, 22);
        a.set_global_exports(root, exports);

        // What the binder wrote is read back while it binds.
        assert_eq!(a.symbol(function), symbol);
        assert_eq!(a.as_function_declaration(function).symbol, symbol);
        assert!(a.flags(function).intersects(NodeFlags::HAS_IMPLICIT_RETURN));
        assert_eq!(a.as_source_file(root).symbol_count, 22);
        assert_eq!(a.as_source_file(root).global_exports, exports);
        assert_eq!(a.open().faults.count(), 0);
        // The tree itself stays frozen, and a node without the field has nothing to write.
        a.set_parent(function, NodeId::NIL);
        a.set_symbol(block, symbol);
    });
    assert_eq!((bound.fault_count(), bound.faults().len()), (2, 2));
    assert_eq!(some(bound.faults().first()).kind, FaultKind::WriteToFrozen);
    assert_eq!(some(bound.faults().get(1)).kind, FaultKind::NilWrite);
    assert_eq!(bound.symbol_count(), 22);
    assert_eq!((bound.table_count(), bound.flow_node_count()), (2, 4));
    assert_eq!(bound.node_count(), 1);
    let mut ran = false;
    file.bind_once(&ids, |_| ran = true);
    assert!(!ran && file.bound().is_some());

    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&file]).ok());
    let a = Ast::new(&frozen, &open);
    let symbol = a.symbol(function);
    assert!(!symbol.is_nil() && !symbol.is_open());
    let s = a.sym(symbol);
    assert_eq!((s.name, s.flags), (&b"f"[..], SymbolFlags::FUNCTION));
    assert_eq!(s.value_declaration, function);
    assert_eq!(s.declarations.as_slice(), [function]);
    assert_eq!(symbol_name(a, symbol), b"f");
    assert_eq!(a.table_len(s.exports), 21);
    for (position, name) in names.iter().enumerate() {
        let member = a.table_get(s.exports, name);
        assert_eq!(a.sym(member).name, name.as_slice());
        let entry = a.table_entry_at(s.exports, position);
        assert_eq!(entry, Some((name.as_slice(), member)));
    }
    let internal = a.table_get(s.exports, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS);
    assert_eq!(a.sym(internal).flags, SymbolFlags::ALIAS);
    assert!(a.table_get(s.exports, b"missing").is_nil());
    assert!(a.table_entry_at(s.exports, 21).is_none());
    assert_eq!(a.table_len(a.locals(function)), 0);
    assert!(!a.locals(function).is_nil());

    let assignment = a.flow(a.flow_node(x1));
    assert_eq!(assignment.flags, FlowFlags::ASSIGNMENT);
    assert_eq!(assignment.node, declaration);
    assert_eq!(a.flow(assignment.antecedent).flags, FlowFlags::START);
    assert_eq!(a.as_identifier(x1).flow_node, a.flow_node(x1));
    let switch = a.flow(a.end_flow_node(function));
    let clause = a.as_flow_switch_clause_data(switch.node);
    assert_eq!(clause.switch_statement, block);
    assert_eq!((clause.clause_start, clause.clause_end), (1, 3));
    assert!(!clause.is_empty());
    let label = a.flow(a.return_flow_node(function));
    let antecedent = a.flow_list(label.antecedents).flow;
    assert_eq!(a.flow(antecedent).flags, FlowFlags::ASSIGNMENT);
    assert!(a.flags(function).intersects(NodeFlags::HAS_IMPLICIT_RETURN));
    let view = a.as_source_file(root);
    assert!(view.is_bound());
    assert_eq!((view.symbol_count, view.global_exports), (22, s.exports));
    assert_eq!(view.locals, SymbolTableId::NIL);

    // The number of a symbol is given once, whoever asks first.
    let number = a.get_symbol_id(symbol);
    assert!(number != 0 && a.get_symbol_id(symbol) == number);
    assert!(a.get_symbol_id(internal) != number);

    // Nothing of a bound file is written again.
    assert_eq!(open.faults.count(), 0);
    a.set_symbol(function, SymbolId::NIL);
    a.update_symbol(symbol, |s| s.flags = SymbolFlags::NONE);
    a.table_set(s.exports, b"late", symbol);
    a.set_flags(function, NodeFlags::NONE);
    assert_eq!(open.faults.count(), 4);
    assert_eq!(a.symbol(function), symbol);
    assert_eq!(a.sym(symbol).flags, SymbolFlags::FUNCTION);
}

#[test]
fn the_open_store_makes_updates_and_clones() {
    let ids = IdAllocator::new();
    let file = build(&ids);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&file]).ok());
    let a = Ast::new(&frozen, &open);
    let mut factory = Factory::new(a);
    let (declaration, x1) = (node(&file, 3), node(&file, 4));

    let y = factory.new_identifier(b"y");
    assert!(y.is_open() && is_identifier(a, y));
    assert_eq!((a.text(y), a.pos(y)), (&b"y"[..], -1));
    a.set_loc(y, new_text_range(3, 4));
    assert_eq!((a.pos(y), a.end(y)), (3, 4));

    // An update with the members of the node is the node.
    let d = a.as_variable_declaration(declaration);
    let same = factory.update_variable_declaration(
        declaration,
        d.name,
        d.exclamation_token,
        d.type_node,
        d.initializer,
    );
    assert_eq!(same, declaration);
    // A changed member makes a node of the store with the range of the original.
    let updated = factory.update_variable_declaration(
        declaration,
        y,
        d.exclamation_token,
        d.type_node,
        d.initializer,
    );
    assert!(updated.is_open());
    assert_eq!(a.loc(updated), a.loc(declaration));
    let u = a.as_variable_declaration(updated);
    assert_eq!((u.name, u.initializer), (y, d.initializer));
    // updateNode: the flags member of a constructor loses to the flags of the original.
    let list = a.as_variable_declaration_list(node(&file, 2));
    let relisted =
        factory.update_variable_declaration_list(node(&file, 2), list.declarations, NodeFlags::LET);
    assert!(relisted.is_open());
    assert_eq!(a.flags(relisted), NodeFlags::CONST);

    let clone = factory.clone_node(x1);
    assert!(clone.is_open());
    assert_eq!((a.text(clone), a.loc(clone)), (&b"x"[..], a.loc(x1)));
    assert_eq!((factory.node_count(), factory.text_count()), (4, 2));

    let export = factory.new_modifier(Kind::ExportKeyword);
    let modifiers = factory.new_modifier_list(&[export]);
    assert_eq!(a.modifier_list_flags(modifiers), ModifierFlags::EXPORT);
    let access = factory.new_property_access_expression(y, NodeId::NIL, clone, NodeFlags::AMBIENT);
    assert_eq!(a.flags(access), NodeFlags::NONE);
    let chain = NodeFlags::OPTIONAL_CHAIN;
    let chained = factory.new_property_access_expression(y, NodeId::NIL, clone, chain);
    assert_eq!(a.flags(chained), NodeFlags::OPTIONAL_CHAIN);
    let literal = factory.new_string_literal(b"s", TokenFlags::from_bits(-1));
    let kept = a.as_string_literal(literal).token_flags;
    assert_eq!(kept, TokenFlags::STRING_LITERAL_FLAGS);

    // The setters of MutableNode write a node of the store and nothing else.
    let statement = factory.new_expression_statement(y);
    a.set_expression(statement, clone);
    assert_eq!(a.expression(statement), clone);
    a.set_symbol(updated, SymbolId::from_open_index(7));
    assert_eq!(a.symbol(updated), SymbolId::from_open_index(7));
    assert_eq!(open.faults.count(), 0);
    a.set_expression(y, clone);
    assert_eq!(some(open.faults.first()).kind, FaultKind::Panic);
    a.set_expression(node(&file, 11), clone);
    assert_eq!(a.expression(node(&file, 11)), node(&file, 12));
    assert_eq!(open.faults.count(), 2);

    // A symbol and a table of a checker live in its store.
    let transient = a.new_symbol(SymbolFlags::TRANSIENT, b"t");
    a.update_symbol(transient, |s| s.check_flags = CheckFlags::LATE);
    assert_eq!(a.sym(transient).check_flags, CheckFlags::LATE);
    let table = a.new_table();
    a.table_set(table, b"t", transient);
    let copy = a.table_clone(table);
    a.table_delete(table, b"t");
    assert_eq!(
        (a.table_len(table), a.table_get(copy, b"t")),
        (0, transient)
    );
    assert!(a.sym(SymbolId::NIL).name.is_empty());
    assert!(a.table_clone(SymbolTableId::NIL).is_nil());
}

#[test]
fn jsdoc_and_members_by_name() {
    let ids = IdAllocator::new();
    let mut b = FileBuilder::new(b"");
    let name = b.new_node_by_def(Def::Identifier, Kind::Identifier);
    assert!(b.set_member(name, b"Text", MemberValue::Text(b"p")));
    assert!(!b.set_member(name, b"NoSuchMember", MemberValue::Bool(true)));
    assert!(!b.set_member(name, b"Text", MemberValue::Bool(true)));
    assert!(b.new_node_by_def(Def::Identifier, Kind::Block).is_nil());
    assert_eq!(b.faults.count(), 3);
    let tag_name = b.new_identifier(b"param");
    let type_expression = b.new_jsdoc_type_expression(NodeId::NIL);
    let tag = b.new_jsdoc_parameter_or_property_tag(
        Kind::JSDocParameterTag,
        tag_name,
        name,
        false,
        type_expression,
        true,
        NodeListId::NIL,
    );
    let tags = b.new_node_list(&[tag]);
    let jsdoc = b.new_jsdoc(NodeListId::NIL, tags);
    let expression = b.new_identifier(b"e");
    let host = b.new_expression_statement(expression);
    b.attach_jsdoc(host, &[jsdoc]);
    let mark = b.mark();
    let dropped = b.new_identifier(b"dropped");
    assert_eq!((b.node_count(), b.kind(dropped)), (8, Kind::Identifier));
    b.rewind(mark);
    assert_eq!((b.node_count(), b.kind(dropped)), (7, Kind::Unknown));
    let end_of_file = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[host]);
    let root = b.new_source_file(statements, end_of_file);
    let file = some(b.finish(root, SourceFileData::default(), &ids));
    assert_eq!(file.fault_count(), 3);
    assert_eq!(file.copied_text_len(), b"pparame".len());

    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&file]).ok());
    let a = Ast::new(&frozen, &open);
    let host = node(&file, 1);
    assert_eq!(a.kind(host), Kind::ExpressionStatement);
    assert!(a.flags(host).intersects(NodeFlags::HAS_JSDOC));
    // The JSDoc of a host follows the host and comes before its children.
    let jsdoc = a.jsdoc(host);
    assert_eq!(jsdoc.as_slice(), [node(&file, 2)]);
    assert_eq!(a.parent(jsdoc.at(0usize)), host);
    let tags = a.as_jsdoc(jsdoc.at(0usize)).tags;
    let tag = a.nodes(tags).at(0usize);
    assert_eq!(a.kind(tag), Kind::JSDocParameterTag);
    // IsNameFirst: the name comes before the type expression.
    let children: Vec<NodeId> = a.iter_children(tag).collect();
    let data = a.as_jsdoc_parameter_or_property_tag(tag);
    assert_eq!(children, [data.tag_name, data.name, data.type_expression]);
    assert_eq!(a.text(data.tag_name), b"param");
    assert_eq!(a.text(data.name), b"p");
    assert_eq!(a.kind(node(&file, 7)), Kind::Identifier);
    assert_eq!(a.text(node(&file, 7)), b"e");
    assert_eq!(a.member(data.name, b"Text"), Some(MemberValue::Text(b"p")));
    assert!(a.jsdoc(tag).is_nil());
}

#[test]
fn a_node_of_two_holders_is_a_fault() {
    let ids = IdAllocator::new();
    let mut b = FileBuilder::new(b"");
    let shared = b.new_identifier(b"s");
    let first = b.new_expression_statement(shared);
    let second = b.new_expression_statement(shared);
    let end_of_file = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[first, second]);
    let root = b.new_source_file(statements, end_of_file);
    let file = some(b.finish(root, SourceFileData::default(), &ids));
    assert_eq!(file.node_count(), 5);
    assert_eq!(some(file.faults().first()).kind, FaultKind::TwoParents);
    let empty = FileBuilder::new(b"");
    assert!(
        empty
            .finish(NodeId(9), SourceFileData::default(), &ids)
            .is_none()
    );
}

#[test]
fn the_files_of_a_context_come_from_one_allocator() {
    let ids = IdAllocator::new();
    let (first, second) = (build(&ids), build(&ids));
    assert_eq!(second.base(), 2 * PAGE_SIZE);
    second.bind_once(&ids, |a| {
        let root = second.source_file.root;
        a.set_symbol(root, a.new_symbol(SymbolFlags::VALUE_MODULE, b"\"a\""));
    });
    assert_eq!(some(second.bound()).base(), 3 * PAGE_SIZE);
    assert_eq!(ids.used(), 4 * PAGE_SIZE);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&first, &second]).ok());
    let a = Ast::new(&frozen, &open);
    assert_eq!(frozen.page_count(), 4);
    assert_eq!(a.kind(node(&first, 6)), Kind::FunctionDeclaration);
    assert_eq!(a.kind(node(&second, 6)), Kind::FunctionDeclaration);
    let module = a.sym(a.symbol(second.source_file.root));
    assert!(module.is_external_module());
    let owner = a.file_of(node(&second, 6));
    assert!(owner.is_some_and(|file| file.base() == second.base()));

    let other = build(&IdAllocator::new());
    let overlap = Frozen::of_files(&[&first, &other]).err();
    let expected = FrozenError::Overlap {
        first: 0,
        second: 1,
    };
    assert_eq!(overlap, Some(expected));
    assert!(IdAllocator::new().alloc(u32::MAX).is_none());
}

#[test]
fn visit_each_child_updates_through_the_factory_of_the_caller() {
    let ids = IdAllocator::new();
    let file = build(&ids);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&file]).ok());
    let a = Ast::new(&frozen, &open);
    let sum = node(&file, 12);
    let mut visited = 0u32;
    let rename = |count: &mut u32, child: NodeId| {
        *count += 1;
        if is_identifier(a, child) && a.text(child) == b"x" {
            return Factory::new(a).new_identifier(b"z");
        }
        child
    };
    let updated = visit_each_child(a, &mut visited, sum, rename, |_, run| {
        run(&mut Factory::new(a))
    });
    assert_eq!(visited, 3);
    assert!(updated.is_open() && is_binary_expression(a, updated));
    let (old, new) = (a.as_binary_expression(sum), a.as_binary_expression(updated));
    assert_eq!(
        (new.left, new.operator_token),
        (old.left, old.operator_token)
    );
    assert_eq!(a.text(new.right), b"z");
    assert_eq!(a.loc(updated), a.loc(sum));
    let keep = |_: &mut u32, child: NodeId| child;
    let same = visit_each_child(a, &mut visited, sum, keep, |_, run| {
        run(&mut Factory::new(a))
    });
    assert_eq!(same, sum);

    // A list in which a node changed is a new list with the range of the old one.
    let drop_return = |_: &mut u32, v: &NodeVisitor<'_, '_, u32>, child: NodeId| {
        if v.a.kind(child) == Kind::ReturnStatement {
            return NodeId::NIL;
        }
        child
    };
    let hooks = NodeVisitorHooks::default();
    let make: FactoryFn<'_, u32> = &|_, run| run(&mut Factory::new(a));
    let visitor = new_node_visitor(a, Some(&drop_return), make, &hooks);
    let block = node(&file, 10);
    let emptied = visitor.visit_each_child(&mut visited, block);
    let statements = a.as_block(emptied).statements;
    assert!(emptied.is_open() && statements.is_open());
    assert_eq!(a.nodes(statements).len(), 0);
    let old_statements = a.as_block(block).statements;
    assert_eq!(a.list_loc(statements), a.list_loc(old_statements));
    assert_eq!(open.faults.count(), 0);
}

#[test]
fn internal_symbol_names_are_escaped() {
    assert_eq!(escape_internal_symbol_name(b"\xFEcall").as_ref(), b"__call");
    assert_eq!(escape_internal_symbol_name(b"call").as_ref(), b"call");
    assert_eq!(escape_symbol_name(b"__x").as_ref(), b"___x");
    assert_eq!(
        escape_symbol_name(INTERNAL_SYMBOL_NAME_NEW).as_ref(),
        b"__new"
    );
    let escaped = escape_all_internal_symbol_names(b"a\xFEb\xFE");
    assert_eq!(escaped.as_ref(), b"a__b__");
    assert_eq!(INTERNAL_SYMBOL_NAME_PREFIX, b"\xFE");
}
