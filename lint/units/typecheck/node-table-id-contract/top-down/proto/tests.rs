use crate::ast::ast_generated::{Def, is_call_expression, is_identifier, is_variable_declaration};
use crate::ast::context::{AstContext, Mode};
use crate::ast::dump::{Dump, tree_digest};
use crate::ast::factory::{NodeFactoryHooks, NodeVisitorHooks, new_node_factory, new_node_visitor};
use crate::ast::flags_generated::{ModifierFlags, NodeFlags, TokenFlags};
use crate::ast::kind_generated::{Kind, is_token_kind};
use crate::ast::program::{IdAllocator, freeze};
use crate::ast::symbol::{FlowNodeRec, SymbolRec};
use crate::ast::table::{FileData, NodeTable};
use crate::core::new_text_range;
use crate::ids::{FlowNodeId, NodeId, NodeListId, PAGE_SIZE, SymbolId};
use crate::internal::FaultKind;
use crate::producers::importer::{import_file, read_bundle};
use std::io::Write;
use std::time::Instant;

// `const x: number = "s";` made with the factory: children before parents, ranges afterwards.
fn build_min(a: &AstContext<'_>) -> NodeId {
    let f = new_node_factory(a, NodeFactoryHooks::default());
    let name = f.new_identifier(b"x");
    a.set_loc(name, new_text_range(5, 7));
    let type_node = f.new_keyword_type_node(Kind::NumberKeyword);
    a.set_loc(type_node, new_text_range(8, 15));
    let initializer = f.new_string_literal(b"s", TokenFlags::empty());
    a.set_loc(initializer, new_text_range(17, 21));
    let declaration = f.new_variable_declaration(name, NodeId::NIL, type_node, initializer);
    a.set_loc(declaration, new_text_range(5, 21));
    let declarations = f.new_node_list(&[declaration]);
    a.set_list_loc(declarations, new_text_range(5, 21));
    let declaration_list = f.new_variable_declaration_list(declarations, NodeFlags::CONST);
    a.set_loc(declaration_list, new_text_range(0, 21));
    let statement = f.new_variable_statement(crate::ids::ModifierListId::NIL, declaration_list);
    a.set_loc(statement, new_text_range(0, 22));
    let statements = f.new_node_list(&[statement]);
    a.set_list_loc(statements, new_text_range(0, 22));
    let eof = f.new_token(Kind::EndOfFile);
    a.set_loc(eof, new_text_range(22, 23));
    let file = f.new_source_file(statements, eof);
    a.set_loc(file, new_text_range(0, 23));
    assert_eq!(f.node_count(), 8);
    assert_eq!(f.text_count(), 2);
    file
}

fn min_table() -> NodeTable {
    let a = AstContext::for_building();
    let root = build_min(&a);
    let table = a.finish(
        root,
        b"const x: number = \"s\";\n".to_vec(),
        FileData::default(),
    );
    assert_eq!(a.log.count(), 0);
    table
}

const MIN_GOLDEN: &str = "root KindSourceFile [0,23) f=0x0
  .Statements: list [0,22) n=1
    - KindVariableStatement [0,22) f=0x0
      .DeclarationList: KindVariableDeclarationList [0,21) f=0x2
        .Declarations: list [5,21) n=1
          - KindVariableDeclaration [5,21) f=0x0
            .Initializer: KindStringLiteral [17,21) f=0x0 Text=\"s\" TokenFlags=0x0
            .Type: KindNumberKeyword [8,15) f=0x0
            .name: KindIdentifier [5,7) f=0x0 Text=\"x\"
  .EndOfFileToken: KindEndOfFile [22,23) f=0x0
";

fn dump_text(a: &AstContext<'_>, root: NodeId) -> Vec<u8> {
    let mut text = Vec::new();
    let mut sink = |line: &[u8]| {
        text.extend_from_slice(line);
        text.push(b'\n');
    };
    Dump::new(a, false, &mut sink).tree(root);
    text
}

#[test]
fn factory_finish_and_read() {
    let table = min_table();
    assert_eq!(table.node_count(), 8);
    let a = AstContext::for_binding(&table);
    assert_eq!(a.mode(), Mode::Bind);
    let file = table.root;
    // The ids are the positions in the order of ForEachChild.
    assert_eq!(file, NodeId(1));
    let statement = file.statements(&a).at(0usize);
    assert_eq!(statement, NodeId(2));
    assert_eq!(statement.kind(&a), Kind::VariableStatement);
    assert_eq!(statement.parent(&a), file);
    let list = statement.as_variable_statement(&a).declaration_list;
    assert!(list.flags(&a).contains(NodeFlags::CONST));
    let declaration = list.as_variable_declaration_list(&a).declarations;
    let declaration = a.list_nodes(declaration).at(0usize);
    assert!(is_variable_declaration(&a, declaration));
    assert_eq!(declaration.name(&a).text(&a), b"x");
    assert!(is_identifier(&a, declaration.name(&a)));
    assert_eq!(declaration.type_node(&a).kind(&a), Kind::NumberKeyword);
    assert_eq!(declaration.initializer(&a).text(&a), b"s");
    assert_eq!(declaration.initializer(&a).parent(&a), declaration);
    assert_eq!(declaration.pos(&a), 5);
    assert!(file.contains(&a, declaration.name(&a)));
    assert!(!declaration.contains(&a, statement));
    // ForEachChild of VariableDeclaration: name, ExclamationToken, Type, Initializer.
    let mut seen = Vec::new();
    declaration.for_each_child(&a, &mut |child| {
        seen.push(child.kind(&a));
        false
    });
    assert_eq!(
        seen,
        [Kind::Identifier, Kind::NumberKeyword, Kind::StringLiteral]
    );
    assert_eq!(
        bstr::BStr::new(&dump_text(&a, file)),
        bstr::BStr::new(MIN_GOLDEN.as_bytes())
    );
    assert_eq!(a.log.count(), 0);

    // A nil read, a wrong cast and an unhandled accessor give zero values and one log entry each.
    assert_eq!(NodeId::NIL.kind(&a), Kind::Unknown);
    assert_eq!(statement.as_call_expression(&a).arguments, NodeListId::NIL);
    assert!(declaration.expression(&a).is_nil());
    assert!(!is_call_expression(&a, statement));
    let faults = a.log.snapshot();
    assert_eq!(faults.len(), 3);
    assert_eq!(faults[0].kind, FaultKind::NilRead);
    assert_eq!(faults[1].kind, FaultKind::BadCast);
    assert_eq!(faults[2].kind, FaultKind::Panic);
    assert_eq!(faults[2].message, "Unhandled case in Node.Expression: ");
    assert_eq!(faults[2].detail, Kind::VariableDeclaration as u32);
    assert!(is_token_kind(Kind::EndOfFile));
    assert_eq!(Kind::FIRST_ASSIGNMENT, Kind::EqualsToken);
}

#[test]
fn binder_writes_then_freeze_and_share() {
    let mut table = min_table();
    let mut other = min_table();
    {
        // The binder writes flags and its own fields through the shared view. A syntax field is refused.
        let a = AstContext::for_binding(&table);
        let file = table.root;
        let statement = file.statements(&a).at(0usize);
        let declaration = a
            .list_nodes(
                statement
                    .as_variable_statement(&a)
                    .declaration_list
                    .as_variable_declaration_list(&a)
                    .declarations,
            )
            .at(0usize);
        a.set_flags(file, file.flags(&a) | NodeFlags::EXPORT_CONTEXT);
        assert!(a.set_slot_by_table(declaration, &crate::ast::SYMBOL_SLOT, 1));
        assert!(a.set_slot_by_table(statement, &crate::ast::FLOW_NODE_SLOT, 1));
        assert_eq!(a.log.count(), 0);
        declaration.set_initializer(&a, NodeId::NIL);
        assert_eq!(a.log.snapshot()[0].kind, FaultKind::WriteToBoundObject);
        assert_eq!(declaration.symbol(&a), SymbolId(1));
        assert_eq!(statement.flow_node_data(&a).flow_node, FlowNodeId(1));
        assert!(declaration.flow_node_data(&a).nil);
    }
    // What the binder hands over at its end: symbols, tables, flow nodes, and its flow data nodes.
    let name = table.bound.push_name(b"x");
    table.bound.declarations.push(NodeId(4));
    table.bound.symbols.push(SymbolRec {
        flags: 2,
        name,
        declarations: (0, 1),
        value_declaration: NodeId(4),
        ..SymbolRec::default()
    });
    let locals = table.bound.push_symbol_table(1, &[(b"x", SymbolId(1))]);
    // The binder numbers its flow data nodes past the nodes of the tree and appends them when it hands over.
    let promised = table.next_flow_data_id(0);
    let data = table.push_flow_switch_clause_data(NodeId(2), 0, 3);
    assert_eq!(data, promised);
    assert_eq!(data, NodeId(9));
    let number = crate::ast::program::next_symbol_id();
    assert!(crate::ast::program::next_symbol_id() > number);
    table.bound.flow_nodes.push(FlowNodeRec {
        flags: 2,
        ..FlowNodeRec::default()
    });

    let ids = IdAllocator::new();
    assert!(freeze(&mut table, &ids));
    other.file.file_name = b"/other.ts".to_vec();
    assert!(freeze(&mut other, &ids));
    assert!(table.is_frozen() && other.is_frozen());
    assert_eq!(table.first(), PAGE_SIZE);
    assert_eq!(other.first(), 2 * PAGE_SIZE);
    let delta = PAGE_SIZE - 1;

    // Two programs with the files in a different order: a file has the same ids in both.
    for order in [[&table, &other], [&other, &table]] {
        let a = AstContext::for_checking(&order);
        assert_eq!(a.mode(), Mode::Check);
        let file = table.root;
        assert_eq!(file, NodeId(PAGE_SIZE));
        assert!(file.flags(&a).contains(NodeFlags::EXPORT_CONTEXT));
        let statement = file.statements(&a).at(0usize);
        assert_eq!(statement, NodeId(2 + delta));
        assert_eq!(statement.parent(&a), file);
        let declaration = NodeId(4 + delta);
        assert_eq!(declaration.kind(&a), Kind::VariableDeclaration);
        assert_eq!(declaration.name(&a).text(&a), b"x");
        let symbol = declaration.symbol(&a);
        assert_eq!(symbol, SymbolId(1 + delta));
        let read = a.symbol(symbol);
        assert_eq!(read.name, b"x");
        assert_eq!(read.value_declaration, declaration);
        assert_eq!(read.declarations.at(0usize), declaration);
        assert_eq!(
            a.symbol_table_get(crate::ids::SymbolTableId(locals.0 + delta), b"x"),
            symbol
        );
        assert!(
            a.symbol_table_get(crate::ids::SymbolTableId(locals.0 + delta), b"y")
                .is_nil()
        );
        assert_eq!(a.flow_node(statement.flow_node_data(&a).flow_node).flags, 2);
        let data = NodeId(9 + delta).as_flow_switch_clause_data(&a);
        assert_eq!(
            (data.switch_statement, data.clause_start, data.clause_end),
            (statement, 0, 3)
        );
        assert_eq!(NodeId(9 + delta).kind(&a), Kind::Unknown);
        let other_file = other.root;
        assert_eq!(other_file.statements(&a).at(0usize).parent(&a), other_file);
        assert_eq!(a.log.count(), 0);

        // A checker makes a node over a file node, as checker.go:5054 does, and writes only its own nodes.
        let f = new_node_factory(&a, NodeFactoryHooks::default());
        let this = f.new_keyword_expression(Kind::ThisKeyword);
        let reference = f.new_property_access_expression(
            this,
            NodeId::NIL,
            declaration.name(&a),
            NodeFlags::empty(),
        );
        a.set_parent(reference.expression(&a), reference);
        a.set_parent(reference, statement);
        assert!(a.set_slot_by_table(reference, &crate::ast::FLOW_NODE_SLOT, 7));
        assert!(reference.is_synthetic());
        assert_eq!(reference.name(&a), declaration.name(&a));
        assert_eq!(reference.name(&a).parent(&a), declaration);
        assert_eq!(reference.expression(&a).parent(&a), reference);
        assert_eq!(reference.flow_node_data(&a).flow_node, FlowNodeId(7));
        assert_eq!(a.log.count(), 0);
        a.set_parent(declaration, reference);
        a.set_flags(declaration, NodeFlags::empty());
        assert_eq!(a.log.count(), 2);
        assert_eq!(
            declaration.parent(&a).kind(&a),
            Kind::VariableDeclarationList
        );
    }
}

#[test]
fn update_clone_and_visit() {
    let a = AstContext::for_building();
    let file = build_min(&a);
    let f = new_node_factory(&a, NodeFactoryHooks::default());
    let statement = file.statements(&a).at(0usize);
    let declaration = a
        .list_nodes(
            statement
                .as_variable_statement(&a)
                .declaration_list
                .as_variable_declaration_list(&a)
                .declarations,
        )
        .at(0usize);
    // Update with the same members returns the node; with a new member it returns a new node with the old range.
    let d = declaration.as_variable_declaration(&a);
    assert_eq!(
        f.update_variable_declaration(
            declaration,
            d.name,
            d.exclamation_token,
            d.type_node,
            d.initializer
        ),
        declaration
    );
    let other = f.new_numeric_literal(b"1", TokenFlags::empty());
    let updated =
        f.update_variable_declaration(declaration, d.name, d.exclamation_token, d.type_node, other);
    assert_ne!(updated, declaration);
    assert_eq!(updated.loc(&a), declaration.loc(&a));
    assert_eq!(updated.initializer(&a), other);
    let cloned = f.clone(d.name);
    assert_ne!(cloned, d.name);
    assert_eq!(cloned.text(&a), b"x");
    assert_eq!(cloned.loc(&a), d.name.loc(&a));
    // VisitEachChild: the identity visitor keeps the node, a visitor that replaces a child makes a new parent.
    let identity = |node: NodeId| node;
    let v = new_node_visitor(Some(&identity), &f, &NodeVisitorHooks::default());
    assert_eq!(v.visit_each_child(declaration), declaration);
    assert_eq!(v.visit_each_child(file), file);
    let replace = |node: NodeId| if node == d.initializer { other } else { node };
    let v = new_node_visitor(Some(&replace), &f, &NodeVisitorHooks::default());
    let visited = v.visit_each_child(declaration);
    assert_ne!(visited, declaration);
    assert_eq!(visited.initializer(&a), other);
    assert_eq!(visited.name(&a), d.name);
    let modifiers = f.new_modifier_list(&[
        f.new_modifier(Kind::ExportKeyword),
        f.new_modifier(Kind::DeclareKeyword),
    ]);
    assert_eq!(
        a.list_modifier_flags(modifiers),
        ModifierFlags::EXPORT | ModifierFlags::AMBIENT
    );
    assert_eq!(a.def(f.new_token(Kind::TrueKeyword)), Def::Token);
    assert_eq!(
        a.def(f.new_keyword_expression(Kind::TrueKeyword)),
        Def::KeywordExpression
    );
    assert_eq!(a.log.count(), 0);
}

fn read(path: &str) -> Option<Vec<u8>> {
    bun_sys::File::read_from(bun_sys::Fd::cwd(), path.as_bytes()).ok()
}

#[test]
fn importer_gives_the_reference_tree() {
    let json = br#"{"v":1,"kinds":["SourceFile","VariableStatement","VariableDeclarationList","VariableDeclaration","Identifier","NumberKeyword","StringLiteral","EndOfFile"],"fields":["Statements","DeclarationList","Declarations","name","Text","Type","Initializer","TokenFlags","EndOfFileToken"],"strings":["x","s"],"files":[{"fileName":"/min.ts","scriptKind":3,"languageVariant":0,"isDeclarationFile":0,"externalModuleIndicator":-1,"nodes":[0,0,23,0,-1,-1,-1,1,0,22,0,0,-1,0,2,0,21,2,1,1,-1,3,5,21,0,2,-1,1,4,5,7,0,3,3,-1,5,8,15,0,3,5,-1,6,17,21,0,3,6,-1,7,22,23,0,0,8,-1],"lists":[0,0,0,22,0,0,2,2,5,21,0,0],"scalars":[4,4,2,0,6,4,2,1,6,7,3,0],"text":"const x: number = \"s\";\n"}]}"#;
    let bundle = read_bundle(json).unwrap_or_default();
    assert_eq!(bundle.files.len(), 1);
    let (table, faults, _) = import_file(&bundle, &bundle.files[0]);
    assert_eq!(faults, 0);
    let a = AstContext::for_binding(&table);
    assert_eq!(
        bstr::BStr::new(&dump_text(&a, table.root)),
        bstr::BStr::new(MIN_GOLDEN.as_bytes())
    );
    // The importer made the nodes in another order than the factory did: the tables are the same.
    let by_factory = min_table();
    let b = AstContext::for_binding(&by_factory);
    assert_eq!(
        tree_digest(&a, table.root, false),
        tree_digest(&b, by_factory.root, false)
    );
    assert_eq!(table.node_count(), by_factory.node_count());
    for id in 1..=table.node_count() {
        assert_eq!(NodeId(id).kind(&a), NodeId(id).kind(&b));
        assert_eq!(NodeId(id).parent(&a), NodeId(id).parent(&b));
    }
}

// Splits at a byte with the repository's own search.
fn split_at_byte(text: &[u8], byte: u8) -> Vec<&[u8]> {
    let mut parts = Vec::new();
    let mut rest = text;
    while let Some(at) = bun_core::strings::index_of_char(rest, byte) {
        parts.push(rest.get(..at as usize).unwrap_or(&[]));
        rest = rest.get(at as usize + 1..).unwrap_or(&[]);
    }
    parts.push(rest);
    parts
}

fn parse_number(text: &[u8], radix: u64) -> u64 {
    let mut value = 0u64;
    for b in text {
        let digit = match b {
            b'0'..=b'9' => u64::from(b - b'0'),
            b'a'..=b'f' => u64::from(b - b'a') + 10,
            _ => 0,
        };
        value = value.wrapping_mul(radix).wrapping_add(digit);
    }
    value
}

// The golden digests of the dump research: FNV-1a of the reference's own tree of each lib file, without JSDoc.
fn golden_digests() -> Vec<(Vec<u8>, u64, u32)> {
    let path = "/workspace/notes/lint/units/typecheck/ts-dump-and-test-importer/top-down/golden/libs.tsgo-digests.tsv";
    let text = read(path).unwrap_or_default();
    let mut rows = Vec::new();
    for line in split_at_byte(&text, b'\n') {
        let cells = split_at_byte(line, b'\t');
        if line.first() == Some(&b'#') || cells.len() < 11 {
            continue;
        }
        rows.push((
            cells[2].to_vec(),
            parse_number(cells[5], 16),
            parse_number(cells[10], 10) as u32,
        ));
    }
    rows
}

// Imports a bundle made by probes/flatten-converted.ts, compares every file with the reference, then measures.
fn measure_bundle(label: &str, path: &str) {
    let mut err = std::io::stderr();
    let Some(bytes) = read(path) else {
        let _ = writeln!(err, "{label}: {path} is missing, nothing measured");
        return;
    };
    let golden = golden_digests();
    let t0 = Instant::now();
    let bundle = read_bundle(&bytes).unwrap_or_default();
    let t_json = t0.elapsed();
    let mut tables: Vec<NodeTable> = Vec::new();
    let (mut t_build, mut t_finish, mut arena_bytes, mut faults) = (0.0f64, 0.0f64, 0usize, 0u32);
    for dump in &bundle.files {
        let a = AstContext::for_building();
        let t = Instant::now();
        let ids = crate::producers::importer::build_file(&a, &bundle, dump);
        t_build += t.elapsed().as_secs_f64();
        let t = Instant::now();
        let file = FileData {
            file_name: dump.file_name.clone(),
            ..FileData::default()
        };
        tables.push(a.finish(
            ids.first().copied().unwrap_or(NodeId::NIL),
            dump.text.clone(),
            file,
        ));
        t_finish += t.elapsed().as_secs_f64();
        arena_bytes += a.arena.heap_bytes();
        faults += a.log.count();
    }
    // Compare with the reference before the ids move.
    let (mut same, mut differ, mut unknown) = (0, 0, 0);
    for table in &tables {
        let a = AstContext::for_binding(table);
        let (digest, nodes) = tree_digest(&a, table.root, true);
        let name = table.file.file_name.get(1..).unwrap_or(&[]);
        match golden.iter().find(|row| row.0 == name) {
            Some(row) if row.1 == digest && row.2 == nodes => same += 1,
            Some(row) => {
                differ += 1;
                let _ = writeln!(
                    err,
                    "{label}: {} differs: digest {digest:016x} nodes {nodes}, reference {:016x} nodes {}",
                    bstr::BStr::new(name),
                    row.1,
                    row.2
                );
            }
            None => unknown += 1,
        }
        faults += a.log.count();
    }
    let ids = IdAllocator::new();
    let t = Instant::now();
    for table in &mut tables {
        assert!(freeze(table, &ids));
    }
    let t_freeze = t.elapsed();
    let nodes: u32 = tables.iter().map(NodeTable::node_count).sum();
    let lists: u32 = tables.iter().map(NodeTable::list_count).sum();
    let heap: usize = tables.iter().map(NodeTable::heap_bytes).sum();
    let source: usize = tables.iter().map(|t| t.source_text().len()).sum();
    // A program over the frozen files, then a second program over the same files in reverse order.
    let refs: Vec<&NodeTable> = tables.iter().collect();
    let t = Instant::now();
    let first = AstContext::for_checking(&refs);
    let t_first = t.elapsed();
    let reversed: Vec<&NodeTable> = tables.iter().rev().collect();
    let t = Instant::now();
    let second = AstContext::for_checking(&reversed);
    let t_second = t.elapsed();
    // Read every node through the context: kind, parent and children, as a checker pass would.
    let t = Instant::now();
    let (mut visited, mut kinds) = (0u64, 0u64);
    for table in &tables {
        let mut stack = vec![table.root];
        while let Some(node) = stack.pop() {
            visited += 1;
            kinds += node.kind(&second) as u64 + u64::from(node.parent(&second).0 & 1);
            node.for_each_child(&second, &mut |child| {
                stack.push(child);
                false
            });
        }
    }
    let t_walk = t.elapsed();
    // ForEachChild gives the children in source order, and a child's id is above its parent's and its elder siblings'.
    let (mut out_of_source_order, mut out_of_id_order) = (0u32, 0u32);
    for table in &tables {
        let mut stack = vec![table.root];
        while let Some(node) = stack.pop() {
            let (mut last_pos, mut last_id) = (i32::MIN, node.0);
            node.for_each_child(&second, &mut |child| {
                let pos = child.pos(&second);
                out_of_source_order += u32::from(pos < last_pos);
                out_of_id_order += u32::from(child.0 <= last_id);
                last_pos = pos;
                last_id = child.0;
                stack.push(child);
                false
            });
        }
    }
    let mut parts = [0usize; 6];
    for table in &tables {
        for (sum, part) in parts.iter_mut().zip(table.heap_parts()) {
            *sum += part;
        }
    }
    let t = Instant::now();
    let mut after = 0;
    for table in &tables {
        let (_, n) = tree_digest(&first, table.root, true);
        after += n;
    }
    let t_dump = t.elapsed();
    faults += first.log.count() + second.log.count();
    let _ = writeln!(
        err,
        "{label}: files {} nodes {nodes} lists {lists} source bytes {source} dump bytes {}\n  reference digests: same {same} differ {differ} not in the golden table {unknown}; faults {faults}; nodes printed after freeze {after}\n  json read {:.1} ms; build {:.1} ms; finish {:.1} ms; freeze {:.2} ms; program 1 {:.3} ms; program 2 {:.3} ms ({} pages)\n  walk of {visited} nodes {:.1} ms (checksum {kinds}); dump of all trees {:.1} ms\n  table heap {heap} bytes ({:.1} per node, source text included); arena while building {arena_bytes} bytes; ids used {} pages\n  bytes of records, slots, list records, list items, node texts, source: {parts:?}; children out of source order {out_of_source_order}, out of id order {out_of_id_order}",
        tables.len(),
        bytes.len(),
        t_json.as_secs_f64() * 1e3,
        t_build * 1e3,
        t_finish * 1e3,
        t_freeze.as_secs_f64() * 1e3,
        t_first.as_secs_f64() * 1e3,
        t_second.as_secs_f64() * 1e3,
        second.page_count(),
        t_walk.as_secs_f64() * 1e3,
        t_dump.as_secs_f64() * 1e3,
        heap as f64 / f64::from(nodes.max(1)),
        ids.pages_used() - 1,
    );
    assert_eq!(differ, 0);
    assert_eq!(faults, 0);
    assert_eq!(out_of_id_order, 0);
}

#[test]
fn measure_es5_closure() {
    measure_bundle("es5 closure", "/tmp/ntc-td/es5.json");
}

#[test]
fn measure_esnext_closure() {
    measure_bundle("esnext closure", "/tmp/ntc-td/esnext.json");
}

#[test]
fn rewind_and_synthetic_table() {
    let a = AstContext::for_building();
    let f = new_node_factory(&a, NodeFactoryHooks::default());
    let kept = f.new_identifier(b"kept");
    let mark = a.mark();
    let dropped = f.new_identifier(b"dropped");
    let list = f.new_node_list(&[dropped]);
    a.rewind(mark);
    let next = f.new_identifier(b"next");
    // The id of a node made after the mark is given again.
    assert_eq!(next, dropped);
    assert_eq!(next.text(&a), b"next");
    assert_eq!(f.new_node_list(&[kept]), list);
    assert_eq!(a.list_nodes(list).at(0usize), kept);
    assert_eq!(a.log.count(), 0);

    // A node that nothing holds is dropped by finish, and a node that two parents hold is reported.
    let orphan = f.new_identifier(b"orphan");
    let shared = f.new_parenthesized_expression(kept);
    let twice = f.new_binary_expression(
        crate::ids::ModifierListId::NIL,
        shared,
        NodeId::NIL,
        f.new_token(Kind::PlusToken),
        shared,
    );
    let table = a.finish(twice, Vec::new(), FileData::default());
    assert_eq!(table.node_count(), 4);
    assert!(!orphan.is_nil());
    assert_eq!(
        a.log.snapshot().last().map(|fault| fault.kind),
        Some(FaultKind::SharedNode)
    );

    // The import specifier a program makes for a file: its parent is the node of a frozen file.
    let ids = IdAllocator::new();
    let mut file = min_table();
    assert!(freeze(&mut file, &ids));
    let b = AstContext::for_building();
    let f = new_node_factory(&b, NodeFactoryHooks::default());
    let specifier = f.new_string_literal(b"tslib", TokenFlags::empty());
    let import = f.new_import_declaration(
        crate::ids::ModifierListId::NIL,
        NodeId::NIL,
        specifier,
        NodeId::NIL,
    );
    b.set_parent(specifier, import);
    b.set_parent(import, file.root);
    let synthetic = b.finish_synthetic(&[import], &ids);
    assert!(synthetic.is_some());
    let synthetic = synthetic.unwrap_or_default();
    assert!(synthetic.is_frozen());
    assert_eq!(synthetic.first(), 2 * PAGE_SIZE);
    let c = AstContext::for_checking(&[&file, &synthetic]);
    let import = synthetic.root;
    assert_eq!(import.kind(&c), Kind::ImportDeclaration);
    assert_eq!(import.parent(&c), file.root);
    let specifier = import.module_specifier(&c);
    assert_eq!(specifier.text(&c), b"tslib");
    assert_eq!(specifier.parent(&c), import);
    assert_eq!(import.parent(&c).kind(&c), Kind::SourceFile);
    assert_eq!(c.log.count(), 0);
}

// A module that imports the port of upstream's package `core` by name: `core::` is that package here, the
// standard library is `std::` (or `::core::`), and macros of other crates still expand.
mod core_name_probe {
    use crate::core;

    bitflags::bitflags! {
        #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
        pub struct ProbeFlags: u32 {
            const A = 1;
        }
    }

    #[test]
    fn module_named_core() {
        let range = core::new_text_range(1, 2);
        assert_eq!(range.len(), 1);
        assert!(ProbeFlags::A.contains(ProbeFlags::A));
        let (mut a, mut b) = (1, 2);
        std::mem::swap(&mut a, &mut b);
        assert_eq!((a, b), (2, 1));
        assert_eq!(::core::mem::size_of::<u32>(), 4);
        assert!(matches!(format!("{range:?}").len(), 1..));
    }
}

// Every unit of the conformance corpus: the tree the importer builds against the digest of the reference's own tree.
// The bundles come from probes/flatten-corpus.ts, the digests from the dump research (one row per unit, same order).
#[test]
fn corpus_against_reference_digests() {
    let mut err = std::io::stderr();
    let Some(golden) = read("/tmp/ntc-td/cases.tsv") else {
        let _ = writeln!(
            err,
            "corpus: /tmp/ntc-td/cases.tsv is missing, nothing compared"
        );
        return;
    };
    let rows: Vec<(u64, u32, u32)> = split_at_byte(&golden, b'\n')
        .into_iter()
        .filter(|line| line.first() != Some(&b'#'))
        .map(|line| split_at_byte(line, b'\t'))
        .filter(|cells| cells.len() >= 12)
        .map(|cells| {
            (
                parse_number(cells[5], 16),
                parse_number(cells[10], 10) as u32,
                parse_number(cells[11], 10) as u32,
            )
        })
        .collect();
    // Classes: TypeScript family, JavaScript, JSON. Per class: units, same, differ, with faults, same among the units without parse errors, units without parse errors.
    let mut stats = [[0u32; 6]; 3];
    let mut defs_seen = [false; crate::ast::DEF_COUNT];
    let mut kinds_seen = [false; Kind::COUNT];
    let (mut nodes, mut heap, mut seconds) = (0u64, 0usize, 0.0f64);
    let mut differing: Vec<Vec<u8>> = Vec::new();
    for bundle_index in 0..100 {
        let path = format!("/tmp/ntc-td/corpus/b{bundle_index:02}.json");
        let Some(bytes) = read(&path) else {
            break;
        };
        let bundle = read_bundle(&bytes).unwrap_or_default();
        for (index, dump) in bundle.files.iter().enumerate() {
            let name = dump.file_name.as_slice();
            let class = if name.ends_with(b".json") {
                2
            } else if name.ends_with(b".js")
                || name.ends_with(b".jsx")
                || name.ends_with(b".mjs")
                || name.ends_with(b".cjs")
            {
                1
            } else {
                0
            };
            let Some(&(digest, count, parse_errors)) = rows.get(bundle.start as usize + index)
            else {
                continue;
            };
            let t = Instant::now();
            let (table, faults, _) = import_file(&bundle, dump);
            seconds += t.elapsed().as_secs_f64();
            let a = AstContext::for_binding(&table);
            let (found, found_count) = tree_digest(&a, table.root, true);
            for id in 1..=table.node_count() {
                if let Some(seen) = defs_seen.get_mut(a.def(NodeId(id)) as usize) {
                    *seen = true;
                }
                if let Some(seen) = kinds_seen.get_mut(NodeId(id).kind(&a) as usize) {
                    *seen = true;
                }
            }
            nodes += u64::from(table.node_count());
            heap += table.heap_bytes();
            let same = found == digest && found_count == count;
            if let Some(row) = stats.get_mut(class) {
                row[0] += 1;
                row[1] += u32::from(same);
                row[2] += u32::from(!same);
                row[3] += u32::from(faults + a.log.count() != 0);
                row[4] += u32::from(same && parse_errors == 0);
                row[5] += u32::from(parse_errors == 0);
            }
            if !same && class == 0 {
                differing.push(name.to_vec());
            }
        }
    }
    let defs = defs_seen.iter().filter(|seen| **seen).count();
    let kinds = kinds_seen.iter().filter(|seen| **seen).count();
    let _ = writeln!(
        err,
        "corpus: nodes {nodes}; import and finish {seconds:.2} s; table heap {heap} bytes; structs seen {defs} of {}; kinds seen {kinds} of {}",
        crate::ast::DEF_COUNT - 1,
        Kind::COUNT
    );
    for (label, row) in ["ts family", "js", "json"].iter().zip(stats.iter()) {
        let _ = writeln!(
            err,
            "  {label}: units {} same as the reference {} differ {} with importer faults {}; without parse errors {} of which same {}",
            row[0], row[1], row[2], row[3], row[5], row[4]
        );
    }
    let _ = writeln!(err, "  differing ts family units:");
    for name in &differing {
        let _ = writeln!(err, "    {}", bstr::BStr::new(name));
    }
    let missing: Vec<&str> = crate::ast::LAYOUTS
        .iter()
        .zip(defs_seen.iter())
        .filter(|(layout, seen)| !**seen && !layout.name.is_empty())
        .map(|(layout, _)| layout.name)
        .collect();
    let _ = writeln!(err, "  structs that no unit has: {missing:?}");
}
