// Scratch tests: steps 6 to 8 over files that are built and bound by hand (what upstream's binder leaves for them), read through a frozen context as a checker reads them.
use crate::ast::stable::Arena;
use crate::ast::*;
use crate::checker::*;
use crate::core::{CompilerOptions, List, ModuleKind};
use crate::diagnostics;
use crate::module::ResolvedModule;
use crate::tspath::Path;

fn some<T>(value: Option<T>) -> T {
    match value {
        Some(value) => value,
        None => panic!("expected a value"),
    }
}

fn finish(b: FileBuilder, root: NodeId, name: &[u8], indicator: NodeId, ids: &IdAllocator) -> File {
    let data = SourceFileData {
        file_name: name.to_vec(),
        path: Path(name.to_vec()),
        external_module_indicator: indicator,
        ..SourceFileData::default()
    };
    some(b.finish(root, data, ids))
}

fn walk(a: Ast<'_>, node: NodeId, out: &mut Vec<NodeId>) {
    out.push(node);
    for child in a.iter_children(node) {
        walk(a, child, out);
    }
}

// The nodes of a file in the order of ForEachChild.
fn nodes_of(file: &File, ids: &IdAllocator) -> Vec<NodeId> {
    let arena = Arena::new();
    let open = Open::new(&arena, ids);
    let frozen = some(Frozen::of_files(&[file]).ok());
    let a = Ast::new(&frozen, &open);
    let mut out = Vec::new();
    walk(a, file.source_file.root, &mut out);
    out
}

fn of_kind(file: &File, ids: &IdAllocator, kind: Kind) -> Vec<NodeId> {
    let arena = Arena::new();
    let open = Open::new(&arena, ids);
    let frozen = some(Frozen::of_files(&[file]).ok());
    let a = Ast::new(&frozen, &open);
    nodes_of(file, ids).into_iter().filter(|n| a.kind(*n) == kind).collect()
}

fn declared<'x>(a: Ast<'x>, flags: SymbolFlags, name: &'x [u8], declaration: NodeId, value: bool) -> SymbolId {
    let symbol = a.new_symbol(flags, name);
    let declarations = List::from_slice(a.open().arena.alloc_slice_copy(&[declaration]));
    a.update_symbol(symbol, |s| {
        s.declarations = declarations;
        if value {
            s.value_declaration = declaration;
        }
    });
    a.set_symbol(declaration, symbol);
    symbol
}

// a.ts: export const x = 1;
fn file_a(ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(b"export const x = 1;\n");
    let nil = NodeId::NIL;
    let x = b.new_identifier(b"x");
    let one = b.new_numeric_literal(b"1", TokenFlags::NONE);
    let declaration = b.new_variable_declaration(x, nil, nil, one);
    let declarations = b.new_node_list(&[declaration]);
    let list = b.new_variable_declaration_list(declarations, NodeFlags::CONST);
    let statement = b.new_variable_statement(ModifierListId::NIL, list);
    let end = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[statement]);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, b"/a.ts", statement, ids);
    let declaration = some(of_kind(&file, ids, Kind::VariableDeclaration).first().copied());
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let file_symbol = declared(a, SymbolFlags::VALUE_MODULE, b"\"/a\"", root, true);
        let exported = declared(a, SymbolFlags::BLOCK_SCOPED_VARIABLE, b"x", declaration, true);
        a.update_symbol(exported, |s| s.parent = file_symbol);
        let exports = a.new_table();
        a.table_set(exports, b"x", exported);
        a.update_symbol(file_symbol, |s| s.exports = exports);
        let local = a.new_symbol(SymbolFlags::EXPORT_VALUE, b"x");
        a.update_symbol(local, |s| s.export_symbol = exported);
        a.set_local_symbol(declaration, local);
        let locals = a.new_table();
        a.table_set(locals, b"x", local);
        a.set_locals(root, locals);
    });
    file
}

fn import_of(b: &mut FileBuilder, name: &[u8], specifier: &[u8]) -> NodeId {
    let nil = NodeId::NIL;
    let name = b.new_identifier(name);
    let import_specifier = b.new_import_specifier(false, nil, name);
    let elements = b.new_node_list(&[import_specifier]);
    let named = b.new_named_imports(elements);
    let clause = b.new_import_clause(Kind::Unknown, nil, named);
    let module_specifier = b.new_string_literal(specifier, TokenFlags::NONE);
    b.new_import_declaration(ModifierListId::NIL, clause, module_specifier, nil)
}

// b.ts: import { x } from "./a"; import { y } from "./a"; import { q } from "./missing"; x;
fn file_b(ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(b"import { x } from \"./a\";\nimport { y } from \"./a\";\nimport { q } from \"./missing\";\nx;\n");
    let first = import_of(&mut b, b"x", b"./a");
    let second = import_of(&mut b, b"y", b"./a");
    let third = import_of(&mut b, b"q", b"./missing");
    let x = b.new_identifier(b"x");
    let use_x = b.new_expression_statement(x);
    let end = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[first, second, third, use_x]);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, b"/b.ts", first, ids);
    let specifiers = of_kind(&file, ids, Kind::ImportSpecifier);
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let file_symbol = declared(a, SymbolFlags::VALUE_MODULE, b"\"/b\"", root, true);
        a.update_symbol(file_symbol, |s| s.exports = a.new_table());
        let locals = a.new_table();
        for &specifier in &specifiers {
            let name = a.text(a.name(specifier));
            let alias = declared(a, SymbolFlags::ALIAS, name, specifier, false);
            a.table_set(locals, name, alias);
        }
        a.set_locals(root, locals);
    });
    file
}

// c.ts: namespace N { export const v = 1; } import w = N.v; import m = N.missing;
fn file_c(ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(b"namespace N { export const v = 1; }\nimport w = N.v;\nimport m = N.missing;\n");
    let nil = NodeId::NIL;
    let v = b.new_identifier(b"v");
    let one = b.new_numeric_literal(b"1", TokenFlags::NONE);
    let declaration = b.new_variable_declaration(v, nil, nil, one);
    let declarations = b.new_node_list(&[declaration]);
    let list = b.new_variable_declaration_list(declarations, NodeFlags::CONST);
    let statement = b.new_variable_statement(ModifierListId::NIL, list);
    let block_statements = b.new_node_list(&[statement]);
    let block = b.new_module_block(block_statements);
    let n = b.new_identifier(b"N");
    let namespace = b.new_module_declaration(ModifierListId::NIL, Kind::NamespaceKeyword, n, block);
    let mut import_equals = |b: &mut FileBuilder, name: &[u8], right: &[u8]| {
        let left = b.new_identifier(b"N");
        let right = b.new_identifier(right);
        let reference = b.new_qualified_name(left, right);
        let name = b.new_identifier(name);
        b.new_import_equals_declaration(ModifierListId::NIL, false, name, reference)
    };
    let w = import_equals(&mut b, b"w", b"v");
    let m = import_equals(&mut b, b"m", b"missing");
    let end = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[namespace, w, m]);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, b"/c.ts", nil, ids);
    let namespace = some(of_kind(&file, ids, Kind::ModuleDeclaration).first().copied());
    let declaration = some(of_kind(&file, ids, Kind::VariableDeclaration).first().copied());
    let aliases = of_kind(&file, ids, Kind::ImportEqualsDeclaration);
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let locals = a.new_table();
        let n = declared(a, SymbolFlags::VALUE_MODULE, b"N", namespace, true);
        let v = declared(a, SymbolFlags::BLOCK_SCOPED_VARIABLE, b"v", declaration, true);
        a.update_symbol(v, |s| s.parent = n);
        let exports = a.new_table();
        a.table_set(exports, b"v", v);
        a.update_symbol(n, |s| s.exports = exports);
        a.table_set(locals, b"N", n);
        for &alias_declaration in &aliases {
            let name = a.text(a.name(alias_declaration));
            let alias = declared(a, SymbolFlags::ALIAS, name, alias_declaration, false);
            a.table_set(locals, name, alias);
        }
        a.set_locals(root, locals);
    });
    file
}

// d1.ts and d2.ts: interface I { <member>: number } let dup = 1;
fn file_d(ids: &IdAllocator, name: &[u8], member: &[u8]) -> File {
    let mut b = FileBuilder::new(b"interface I { a: number }\nlet dup = 1;\n");
    let nil = NodeId::NIL;
    let member_name = b.new_identifier(member);
    let number = b.new_keyword_type_node(Kind::NumberKeyword);
    let property = b.new_property_signature_declaration(ModifierListId::NIL, member_name, nil, number, nil);
    let members = b.new_node_list(&[property]);
    let i = b.new_identifier(b"I");
    let interface = b.new_interface_declaration(ModifierListId::NIL, i, NodeListId::NIL, NodeListId::NIL, members);
    let dup = b.new_identifier(b"dup");
    let one = b.new_numeric_literal(b"1", TokenFlags::NONE);
    let declaration = b.new_variable_declaration(dup, nil, nil, one);
    let declarations = b.new_node_list(&[declaration]);
    let list = b.new_variable_declaration_list(declarations, NodeFlags::LET);
    let statement = b.new_variable_statement(ModifierListId::NIL, list);
    let end = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[interface, statement]);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, name, nil, ids);
    let interface = some(of_kind(&file, ids, Kind::InterfaceDeclaration).first().copied());
    let property = some(of_kind(&file, ids, Kind::PropertySignature).first().copied());
    let declaration = some(of_kind(&file, ids, Kind::VariableDeclaration).first().copied());
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let locals = a.new_table();
        let i = declared(a, SymbolFlags::INTERFACE, b"I", interface, false);
        let member_name = a.text(a.name(property));
        let p = declared(a, SymbolFlags::PROPERTY, member_name, property, true);
        a.update_symbol(p, |s| s.parent = i);
        let members = a.new_table();
        a.table_set(members, member_name, p);
        a.update_symbol(i, |s| s.members = members);
        a.table_set(locals, b"I", i);
        let dup = declared(a, SymbolFlags::BLOCK_SCOPED_VARIABLE, b"dup", declaration, true);
        a.table_set(locals, b"dup", dup);
        a.set_locals(root, locals);
    });
    file
}


fn module(reference: &'static [u8], file_name: &'static [u8], root: NodeId) -> (&'static [u8], ResolvedModule<'static>, NodeId) {
    (reference, ResolvedModule { resolved_file_name: file_name, extension: b".ts", ..ResolvedModule::default() }, root)
}

fn program_of<'p>(options: &'p CompilerOptions, modules: Vec<(&'p [u8], ResolvedModule<'p>, NodeId)>) -> ScratchProgram<'p> {
    ScratchProgram { options, modules, existing: Vec::new() }
}

fn reported(c: &Checker<'_>) -> Vec<(diagnostics::MessageId, Vec<Vec<u8>>)> {
    c.diagnostics.added.iter().map(|d| (c.diagnostic_store[*d].message, c.diagnostic_store[*d].args.clone())).collect()
}

#[test]
fn an_import_specifier_resolves_to_the_export_of_the_other_file() {
    let ids = IdAllocator::new();
    let (fa, fb) = (file_a(&ids), file_b(&ids));
    assert_eq!((some(fa.bound()).fault_count(), some(fb.bound()).fault_count()), (0, 0));
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&fa, &fb]).ok());
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = program_of(&options, vec![module(b"./a", b"/a.ts", fa.source_file.root)]);
    let mut c = scratch_checker(a, &lists, &program, &options);

    let a_symbol = a.symbol(fa.source_file.root);
    let exported_x = a.table_get(a.sym(a_symbol).exports, b"x");
    assert!(!exported_x.is_nil() && !exported_x.is_open());
    let b_locals = a.locals(fb.source_file.root);
    let (alias_x, alias_y, alias_q) = (a.table_get(b_locals, b"x"), a.table_get(b_locals, b"y"), a.table_get(b_locals, b"q"));
    assert!(!alias_x.is_nil() && !alias_y.is_nil() && !alias_q.is_nil());

    // The use of `x` finds the alias in the locals of the module through the name resolver and getSymbol, which follows the alias for its meaning.
    let use_x = some(of_kind(&fb, &ids, Kind::ExpressionStatement).first().copied());
    let identifier = a.expression(use_x);
    assert_eq!(c.get_resolved_symbol(identifier), alias_x);
    assert_eq!(c.get_resolved_symbol_or_nil(identifier), alias_x);
    assert_eq!(c.get_referenced_value_or_alias_symbol(identifier), alias_x);
    assert_eq!(c.resolve_alias(alias_x), exported_x);
    assert_eq!(c.resolve_alias_exported(alias_x), (exported_x, true));
    assert_eq!(c.get_symbol_flags(alias_x), SymbolFlags::ALIAS | SymbolFlags::BLOCK_SCOPED_VARIABLE);
    assert_eq!(c.resolve_symbol(alias_x), exported_x);
    assert_eq!(c.try_resolve_alias(alias_x), exported_x);
    assert_eq!(c.get_symbol(b_locals, b"x", SymbolFlags::VALUE), alias_x);
    assert_eq!(c.get_symbol(b_locals, b"x", SymbolFlags::TYPE), SymbolId::NIL);
    assert_eq!(reported(&c), vec![]);
    assert_eq!(a.open().faults.count(), 0);

    // The module of the import is the file symbol, and its exports are a clone of the bound table.
    let imports = of_kind(&fb, &ids, Kind::ImportDeclaration);
    let first = some(imports.first().copied());
    assert_eq!(c.resolve_external_module_name(first, a.module_specifier(first), false), a_symbol);
    let exports = c.get_exports_of_module(a_symbol);
    assert!(exports.is_open() && a.table_get(exports, b"x") == exported_x);
    assert_eq!(c.get_external_module_file_from_declaration(first), fa.source_file.root);
    assert_eq!(c.get_module_specifier_for_import_or_export(a.import_clause(first)), a.module_specifier(first));

    // A member that the module does not export.
    assert_eq!(c.resolve_alias(alias_y), c.unknown_symbol);
    assert_eq!(
        reported(&c),
        vec![(diagnostics::MODULE_0_HAS_NO_EXPORTED_MEMBER_1, vec![b"\"/a\"".to_vec(), b"y".to_vec()])]
    );
    assert_eq!(c.get_symbol_flags(alias_y), SymbolFlags::ALL);
    assert_eq!(c.resolve_alias_exported(alias_y), (c.unknown_symbol, false));

    // A module that is not resolved.
    assert_eq!(c.resolve_alias(alias_q), c.unknown_symbol);
    assert_eq!(
        reported(&c).get(1),
        Some(&(diagnostics::CANNOT_FIND_MODULE_0_OR_ITS_CORRESPONDING_TYPE_DECLARATIONS, vec![b"./missing".to_vec()]))
    );
    assert_eq!(reported(&c).len(), 2);
    let third = some(imports.get(2).copied());
    assert_eq!(c.resolve_external_module_name(third, a.module_specifier(third), true), SymbolId::NIL);
    assert_eq!(reported(&c).len(), 2);
    assert_eq!(a.open().faults.count(), 0);
    assert!(c.type_resolutions.is_empty());
}

#[test]
fn an_import_alias_resolves_a_qualified_name() {
    let ids = IdAllocator::new();
    let fc = file_c(&ids);
    assert_eq!(some(fc.bound()).fault_count(), 0);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&fc]).ok());
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = program_of(&options, Vec::new());
    let mut c = scratch_checker(a, &lists, &program, &options);
    // initializeChecker (step 5) merges the locals of a script into the globals.
    let locals = a.locals(fc.source_file.root);
    c.merge_symbol_table(c.globals, locals, false, SymbolId::NIL);
    let (n, w, m) = (a.table_get(locals, b"N"), a.table_get(locals, b"w"), a.table_get(locals, b"m"));
    assert_eq!(a.table_get(c.globals, b"N"), n);
    let v = a.table_get(a.sym(n).exports, b"v");

    assert_eq!(c.resolve_alias(w), v);
    assert_eq!(reported(&c), vec![]);
    assert_eq!(c.get_symbol_flags(w), SymbolFlags::ALIAS | SymbolFlags::BLOCK_SCOPED_VARIABLE);
    let aliases = of_kind(&fc, &ids, Kind::ImportEqualsDeclaration);
    let first = some(aliases.first().copied());
    assert_eq!(c.get_symbol_of_declaration(first), w);
    assert_eq!(c.get_target_of_alias_declaration(first), v);
    let reference = a.as_import_equals_declaration(first).module_reference;
    assert_eq!(c.resolve_entity_name(reference, SymbolFlags::VALUE, true, false, NodeId::NIL), v);
    assert_eq!(c.resolve_entity_name(reference, SymbolFlags::TYPE, true, false, NodeId::NIL), SymbolId::NIL);
    assert_eq!(c.resolve_entity_name(a.as_qualified_name(reference).left, SymbolFlags::NAMESPACE, true, false, NodeId::NIL), n);
    assert_eq!(c.get_fully_qualified_name(v, NodeId::NIL), b"N.v");

    assert_eq!(c.resolve_alias(m), c.unknown_symbol);
    assert_eq!(
        reported(&c),
        vec![(diagnostics::NAMESPACE_0_HAS_NO_EXPORTED_MEMBER_1, vec![b"N".to_vec(), b"missing".to_vec()])]
    );
    assert_eq!(a.open().faults.count(), 0);
    assert!(c.type_resolutions.is_empty());
}

#[test]
fn declarations_of_two_files_merge_in_the_globals() {
    let ids = IdAllocator::new();
    let (d1, d2) = (file_d(&ids, b"/d1.ts", b"a"), file_d(&ids, b"/d2.ts", b"b"));
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&d1, &d2]).ok());
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = program_of(&options, Vec::new());
    let mut c = scratch_checker(a, &lists, &program, &options);
    let (locals1, locals2) = (a.locals(d1.source_file.root), a.locals(d2.source_file.root));
    let (i1, i2) = (a.table_get(locals1, b"I"), a.table_get(locals2, b"I"));
    let (dup1, dup2) = (a.table_get(locals1, b"dup"), a.table_get(locals2, b"dup"));
    c.merge_symbol_table(c.globals, locals1, false, SymbolId::NIL);
    assert_eq!(a.table_get(c.globals, b"I"), i1);
    assert_eq!(reported(&c), vec![]);
    c.merge_symbol_table(c.globals, locals2, false, SymbolId::NIL);

    // The two interfaces are one transient symbol with the declarations and the members of both.
    let merged = a.table_get(c.globals, b"I");
    assert!(merged.is_open() && a.sym(merged).flags == SymbolFlags::INTERFACE | SymbolFlags::TRANSIENT);
    assert_eq!((c.get_merged_symbol(i1), c.get_merged_symbol(i2)), (merged, merged));
    let (decl1, decl2) = (a.sym(i1).declarations.at(0usize), a.sym(i2).declarations.at(0usize));
    assert_eq!(a.sym(merged).declarations.as_slice(), &[decl1, decl2]);
    assert_eq!(c.get_symbol_of_declaration(decl2), merged);
    assert_eq!(c.get_symbol_of_node(decl1), merged);
    let members = c.get_members_of_symbol(merged);
    assert!(members.is_open());
    assert_eq!((a.table_len(members), a.table_len(a.sym(i1).members)), (2, 1));
    assert!(!a.table_get(members, b"a").is_nil() && !a.table_get(members, b"b").is_nil());
    assert_eq!(c.get_symbol(c.globals, b"I", SymbolFlags::TYPE), merged);

    // The two block scoped variables do not merge: each declaration gets the error with the other one as related information.
    assert_eq!(a.table_get(c.globals, b"dup"), dup1);
    assert_eq!(c.get_merged_symbol(dup2), dup2);
    let errors = reported(&c);
    let redeclare = (diagnostics::CANNOT_REDECLARE_BLOCK_SCOPED_VARIABLE_0, vec![b"dup".to_vec()]);
    assert_eq!(errors, vec![redeclare.clone(), redeclare]);
    let (name1, name2) = (a.name(a.sym(dup1).declarations.at(0usize)), a.name(a.sym(dup2).declarations.at(0usize)));
    let (first, second) = (c.diagnostics.added[0], c.diagnostics.added[1]);
    assert_eq!((c.diagnostic_store[first].node, c.diagnostic_store[second].node), (name2, name1));
    for (error, other) in [(first, name1), (second, name2)] {
        let related = c.diagnostic_store[error].related_information().to_vec();
        assert_eq!(related.len(), 1);
        let info = &c.diagnostic_store[related[0]];
        assert_eq!((info.node, info.message), (other, diagnostics::X_0_WAS_ALSO_DECLARED_HERE));
    }
    assert_eq!(a.open().faults.count(), 0);
}

// A module file with one exported const per name.
fn file_exporting(ids: &IdAllocator, file_name: &[u8], symbol_name: &[u8], names: &[&[u8]]) -> File {
    let mut b = FileBuilder::new(b"");
    let nil = NodeId::NIL;
    let mut statements = Vec::new();
    for name in names {
        let name = b.new_identifier(name);
        let one = b.new_numeric_literal(b"1", TokenFlags::NONE);
        let declaration = b.new_variable_declaration(name, nil, nil, one);
        let declarations = b.new_node_list(&[declaration]);
        let list = b.new_variable_declaration_list(declarations, NodeFlags::CONST);
        statements.push(b.new_variable_statement(ModifierListId::NIL, list));
    }
    let end = b.new_token(Kind::EndOfFile);
    let indicator = some(statements.first().copied());
    let statements = b.new_node_list(&statements);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, file_name, indicator, ids);
    let declarations = of_kind(&file, ids, Kind::VariableDeclaration);
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let symbol_name = a.open().arena.alloc_slice_copy(symbol_name);
        let file_symbol = declared(a, SymbolFlags::VALUE_MODULE, symbol_name, root, true);
        let exports = a.new_table();
        for &declaration in &declarations {
            let name = a.text(a.name(declaration));
            let exported = declared(a, SymbolFlags::BLOCK_SCOPED_VARIABLE, name, declaration, true);
            a.update_symbol(exported, |s| s.parent = file_symbol);
            a.table_set(exports, name, exported);
        }
        a.update_symbol(file_symbol, |s| s.exports = exports);
    });
    file
}

// A module file of `export * from` declarations, each type-only or not.
fn file_of_export_stars(ids: &IdAllocator, file_name: &[u8], symbol_name: &[u8], stars: &[(&[u8], bool)]) -> File {
    let mut b = FileBuilder::new(b"");
    let nil = NodeId::NIL;
    let mut statements = Vec::new();
    for (specifier, is_type_only) in stars {
        let module_specifier = b.new_string_literal(specifier, TokenFlags::NONE);
        statements.push(b.new_export_declaration(ModifierListId::NIL, *is_type_only, nil, module_specifier, nil));
    }
    let end = b.new_token(Kind::EndOfFile);
    let indicator = some(statements.first().copied());
    let statements = b.new_node_list(&statements);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, file_name, indicator, ids);
    let declarations = of_kind(&file, ids, Kind::ExportDeclaration);
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let symbol_name = a.open().arena.alloc_slice_copy(symbol_name);
        let file_symbol = declared(a, SymbolFlags::VALUE_MODULE, symbol_name, root, true);
        let star = a.new_symbol(SymbolFlags::EXPORT_STAR, INTERNAL_SYMBOL_NAME_EXPORT_STAR);
        let list = List::from_slice(a.open().arena.alloc_slice_copy(&declarations));
        a.update_symbol(star, |s| {
            s.declarations = list;
            s.parent = file_symbol;
        });
        for &declaration in &declarations {
            a.set_symbol(declaration, star);
        }
        let exports = a.new_table();
        a.table_set(exports, INTERNAL_SYMBOL_NAME_EXPORT_STAR, star);
        a.update_symbol(file_symbol, |s| s.exports = exports);
    });
    file
}


fn table_names(a: Ast<'_>, table: SymbolTableId) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut position = 0;
    while let Some((name, _)) = a.table_entry_at(table, position) {
        position += 1;
        out.push(name.to_vec());
    }
    out
}

#[test]
fn export_stars_extend_the_exports_and_report_collisions() {
    let ids = IdAllocator::new();
    let e1 = file_exporting(&ids, b"/e1.ts", b"\"/e1\"", &[b"k", b"only1"]);
    let e2 = file_exporting(&ids, b"/e2.ts", b"\"/e2\"", &[b"k", b"only2"]);
    let e3 = file_of_export_stars(&ids, b"/e3.ts", b"\"/e3\"", &[(b"./e1", false), (b"./e2", false)]);
    let e5 = file_of_export_stars(&ids, b"/e5.ts", b"\"/e5\"", &[(b"./e1", true)]);
    let e6 = file_of_export_stars(&ids, b"/e6.ts", b"\"/e6\"", &[(b"./e1", true), (b"./e1", false), (b"./e6", false)]);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&e1, &e2, &e3, &e5, &e6]).ok());
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = program_of(
        &options,
        vec![
            module(b"./e1", b"/e1.ts", e1.source_file.root),
            module(b"./e2", b"/e2.ts", e2.source_file.root),
            module(b"./e6", b"/e6.ts", e6.source_file.root),
        ],
    );
    let mut c = scratch_checker(a, &lists, &program, &options);
    let (s1, s2, s3, s5, s6) = (
        a.symbol(e1.source_file.root),
        a.symbol(e2.source_file.root),
        a.symbol(e3.source_file.root),
        a.symbol(e5.source_file.root),
        a.symbol(e6.source_file.root),
    );
    let (k1, k2) = (a.table_get(a.sym(s1).exports, b"k"), a.table_get(a.sym(s2).exports, b"k"));
    assert!(k1 != k2 && !k1.is_nil() && !k2.is_nil());

    let exports = c.get_exports_of_module(s3);
    assert_eq!(
        table_names(a, exports),
        vec![INTERNAL_SYMBOL_NAME_EXPORT_STAR.to_vec(), b"k".to_vec(), b"only1".to_vec(), b"only2".to_vec()]
    );
    assert_eq!(a.table_get(exports, b"k"), k1);
    let stars = of_kind(&e3, &ids, Kind::ExportDeclaration);
    let collision = diagnostics::MODULE_0_HAS_ALREADY_EXPORTED_A_MEMBER_NAMED_1_CONSIDER_EXPLICITLY_RE_EXPORTING_TO_RESOLVE_THE_AMBIGUITY;
    assert_eq!(reported(&c), vec![(collision, vec![b"./e1".to_vec(), b"k".to_vec()])]);
    assert_eq!(c.diagnostic_store[c.diagnostics.added[0]].node, stars[1]);
    let links = c.module_symbol_links.get(s3);
    assert!(c.module_symbol_links[links].type_only_export_star_map.is_nil());
    assert_eq!(c.get_exports_of_symbol(s3), exports);
    assert_eq!(reported(&c).len(), 1);

    // `export type *` marks every name that it brings.
    let type_only_exports = c.get_exports_of_module(s5);
    assert_eq!(a.table_get(type_only_exports, b"k"), k1);
    let star5 = of_kind(&e5, &ids, Kind::ExportDeclaration)[0];
    let links = c.module_symbol_links.get(s5);
    assert_eq!(c.module_symbol_links[links].type_only_export_star_map.get(&b"k".as_slice()), star5);
    assert_eq!(c.module_symbol_links[links].type_only_export_star_map.get(&b"only1".as_slice()), star5);
    assert_eq!(c.module_symbol_links[links].type_only_export_star_map.len(), 2);

    // A plain `export *` of the same module after the type-only one takes the marks away again, and a module that exports itself ends.
    let both = c.get_exports_of_module(s6);
    assert_eq!(a.table_get(both, b"k"), k1);
    let links = c.module_symbol_links.get(s6);
    assert_eq!(c.module_symbol_links[links].type_only_export_star_map.len(), 0);
    assert_eq!(reported(&c).len(), 1);
    assert_eq!(a.open().faults.count(), 0);
}

// h.ts: import d from "./a"; import x from "./a"; import * as ns from "./a"; export { x as z } from "./a"; const loc = 1; export { loc as renamed };
fn file_h(ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(b"");
    let nil = NodeId::NIL;
    let mut default_import = |b: &mut FileBuilder, name: &[u8]| {
        let name = b.new_identifier(name);
        let clause = b.new_import_clause(Kind::Unknown, name, nil);
        let module_specifier = b.new_string_literal(b"./a", TokenFlags::NONE);
        b.new_import_declaration(ModifierListId::NIL, clause, module_specifier, nil)
    };
    let import_d = default_import(&mut b, b"d");
    let import_x = default_import(&mut b, b"x");
    let ns = b.new_identifier(b"ns");
    let namespace_import = b.new_namespace_import(ns);
    let clause = b.new_import_clause(Kind::Unknown, nil, namespace_import);
    let module_specifier = b.new_string_literal(b"./a", TokenFlags::NONE);
    let import_ns = b.new_import_declaration(ModifierListId::NIL, clause, module_specifier, nil);
    let (x, z) = (b.new_identifier(b"x"), b.new_identifier(b"z"));
    let specifier = b.new_export_specifier(false, x, z);
    let elements = b.new_node_list(&[specifier]);
    let named = b.new_named_exports(elements);
    let module_specifier = b.new_string_literal(b"./a", TokenFlags::NONE);
    let reexport = b.new_export_declaration(ModifierListId::NIL, false, named, module_specifier, nil);
    let loc = b.new_identifier(b"loc");
    let one = b.new_numeric_literal(b"1", TokenFlags::NONE);
    let declaration = b.new_variable_declaration(loc, nil, nil, one);
    let declarations = b.new_node_list(&[declaration]);
    let list = b.new_variable_declaration_list(declarations, NodeFlags::CONST);
    let statement = b.new_variable_statement(ModifierListId::NIL, list);
    let (loc2, renamed) = (b.new_identifier(b"loc"), b.new_identifier(b"renamed"));
    let specifier = b.new_export_specifier(false, loc2, renamed);
    let elements = b.new_node_list(&[specifier]);
    let named = b.new_named_exports(elements);
    let export_local = b.new_export_declaration(ModifierListId::NIL, false, named, nil, nil);
    let end = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[import_d, import_x, import_ns, reexport, statement, export_local]);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, b"/h.ts", import_d, ids);
    let clauses = of_kind(&file, ids, Kind::ImportClause);
    let namespace_import = of_kind(&file, ids, Kind::NamespaceImport)[0];
    let export_specifiers = of_kind(&file, ids, Kind::ExportSpecifier);
    let declaration = of_kind(&file, ids, Kind::VariableDeclaration)[0];
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let file_symbol = declared(a, SymbolFlags::VALUE_MODULE, b"\"/h\"", root, true);
        let (locals, exports) = (a.new_table(), a.new_table());
        for &clause in clauses.iter().take(2) {
            let name = a.text(a.name(clause));
            a.table_set(locals, name, declared(a, SymbolFlags::ALIAS, name, clause, false));
        }
        a.table_set(locals, b"ns", declared(a, SymbolFlags::ALIAS, b"ns", namespace_import, false));
        for &specifier in &export_specifiers {
            let name = a.text(a.name(specifier));
            a.table_set(exports, name, declared(a, SymbolFlags::ALIAS, name, specifier, false));
        }
        a.table_set(locals, b"loc", declared(a, SymbolFlags::BLOCK_SCOPED_VARIABLE, b"loc", declaration, true));
        a.update_symbol(file_symbol, |s| s.exports = exports);
        a.set_locals(root, locals);
    });
    file
}

#[test]
fn default_namespace_and_export_specifier_aliases() {
    let ids = IdAllocator::new();
    let (fa, fh) = (file_a(&ids), file_h(&ids));
    assert_eq!(some(fh.bound()).fault_count(), 0);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&fa, &fh]).ok());
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = program_of(&options, vec![module(b"./a", b"/a.ts", fa.source_file.root)]);
    let mut c = scratch_checker(a, &lists, &program, &options);
    let a_symbol = a.symbol(fa.source_file.root);
    let exported_x = a.table_get(a.sym(a_symbol).exports, b"x");
    let locals = a.locals(fh.source_file.root);
    let exports = a.sym(a.symbol(fh.source_file.root)).exports;
    let clauses = of_kind(&fh, &ids, Kind::ImportClause);

    // A default import of a module without a default export, with and without an export of the same name.
    let d = a.table_get(locals, b"d");
    assert_eq!(c.resolve_alias(d), c.unknown_symbol);
    assert_eq!(reported(&c), vec![(diagnostics::MODULE_0_HAS_NO_DEFAULT_EXPORT, vec![b"\"/a\"".to_vec()])]);
    assert_eq!(c.diagnostic_store[c.diagnostics.added[0]].node, a.name(clauses[0]));
    let x = a.table_get(locals, b"x");
    assert_eq!(c.resolve_alias(x), c.unknown_symbol);
    assert_eq!(
        reported(&c).get(1),
        Some(&(
            diagnostics::MODULE_0_HAS_NO_DEFAULT_EXPORT_DID_YOU_MEAN_TO_USE_IMPORT_1_FROM_0_INSTEAD,
            vec![b"\"/a\"".to_vec(), b"x".to_vec()]
        ))
    );
    assert_eq!(c.diagnostic_store[c.diagnostics.added[1]].node, clauses[1]);

    // A namespace import is the module itself.
    let ns = a.table_get(locals, b"ns");
    assert_eq!(c.resolve_alias(ns), a_symbol);
    assert_eq!(c.get_symbol_flags(ns), SymbolFlags::ALIAS | SymbolFlags::VALUE_MODULE);

    // `export { x as z } from` and `export { loc as renamed }`.
    let z = a.table_get(exports, b"z");
    assert_eq!(c.resolve_alias(z), exported_x);
    let renamed = a.table_get(exports, b"renamed");
    assert_eq!(c.resolve_alias(renamed), a.table_get(locals, b"loc"));
    assert_eq!(reported(&c).len(), 2);
    let specifiers = of_kind(&fh, &ids, Kind::ExportSpecifier);
    assert_eq!(c.get_target_of_export_specifier(specifiers[1], SymbolFlags::TYPE, false), SymbolId::NIL);
    // The error for the name that has no type meaning belongs to onFailedToResolveSymbol (step 5), which this scratch does not wire.
    assert_eq!(reported(&c).len(), 2);
    assert_eq!(a.open().faults.count(), 0);
    assert!(c.type_resolutions.is_empty());
}

// g.ts: import a = b; import b = a;
fn file_g(ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(b"");
    let mut import_equals = |b: &mut FileBuilder, name: &[u8], reference: &[u8]| {
        let reference = b.new_identifier(reference);
        let name = b.new_identifier(name);
        b.new_import_equals_declaration(ModifierListId::NIL, false, name, reference)
    };
    let first = import_equals(&mut b, b"a", b"b");
    let second = import_equals(&mut b, b"b", b"a");
    let end = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[first, second]);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, b"/g.ts", NodeId::NIL, ids);
    let aliases = of_kind(&file, ids, Kind::ImportEqualsDeclaration);
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let locals = a.new_table();
        for &declaration in &aliases {
            let name = a.text(a.name(declaration));
            a.table_set(locals, name, declared(a, SymbolFlags::ALIAS, name, declaration, false));
        }
        a.set_locals(root, locals);
    });
    file
}

#[test]
fn circular_import_aliases_are_reported_once_each() {
    let ids = IdAllocator::new();
    let fg = file_g(&ids);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&fg]).ok());
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = program_of(&options, Vec::new());
    let mut c = scratch_checker(a, &lists, &program, &options);
    let locals = a.locals(fg.source_file.root);
    c.merge_symbol_table(c.globals, locals, false, SymbolId::NIL);
    let (alias_a, alias_b) = (a.table_get(locals, b"a"), a.table_get(locals, b"b"));
    let declarations = of_kind(&fg, &ids, Kind::ImportEqualsDeclaration);
    assert_eq!(c.resolve_alias(alias_a), c.unknown_symbol);
    let circular = diagnostics::CIRCULAR_DEFINITION_OF_IMPORT_ALIAS_0;
    assert_eq!(reported(&c), vec![(circular, vec![b"b".to_vec()]), (circular, vec![b"a".to_vec()])]);
    assert_eq!(
        (c.diagnostic_store[c.diagnostics.added[0]].node, c.diagnostic_store[c.diagnostics.added[1]].node),
        (declarations[1], declarations[0])
    );
    assert_eq!(c.resolve_alias(alias_b), c.unknown_symbol);
    assert_eq!(c.get_symbol_flags(alias_a), SymbolFlags::ALL);
    assert_eq!(reported(&c).len(), 2);
    assert_eq!(a.open().faults.count(), 0);
    assert!(c.type_resolutions.is_empty());
}


#[test]
fn modules_that_do_not_resolve_to_a_file_of_the_program() {
    let ids = IdAllocator::new();
    let mut b = FileBuilder::new(b"");
    let specifiers: [&[u8]; 6] = [b"./j", b"pkg", b"@types/foo", b"./data.json", b"fs", b"node:test"];
    let mut statements = Vec::new();
    for specifier in specifiers {
        statements.push(import_of(&mut b, b"m", specifier));
    }
    let end = b.new_token(Kind::EndOfFile);
    let indicator = statements[0];
    let statements = b.new_node_list(&statements);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, b"/u.ts", indicator, &ids);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&file]).ok());
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let mut options = CompilerOptions::default();
    options.resolve_json_module = crate::core::Tristate::FALSE;
    let mut package = ResolvedModule {
        resolved_file_name: b"/node_modules/pkg/index.js",
        extension: b".js",
        is_external_library_import: true,
        ..ResolvedModule::default()
    };
    package.package_id.name = b"pkg";
    let untyped = ResolvedModule { resolved_file_name: b"/j.js", extension: b".js", ..ResolvedModule::default() };
    let program = program_of(&options, vec![(b"./j", untyped, NodeId::NIL), (b"pkg", package, NodeId::NIL)]);
    let mut c = scratch_checker(a, &lists, &program, &options);
    let imports = of_kind(&file, &ids, Kind::ImportDeclaration);
    let resolve = |c: &mut Checker<'_>, index: usize| {
        let import = imports[index];
        c.resolve_external_module_name(import, a.module_specifier(import), false)
    };

    // An untyped relative module is a suggestion without noImplicitAny and an error with it.
    assert_eq!(resolve(&mut c, 0), SymbolId::NIL);
    assert_eq!(reported(&c), vec![]);
    c.no_implicit_any = true;
    assert_eq!(resolve(&mut c, 0), SymbolId::NIL);
    let implicit_any = diagnostics::COULD_NOT_FIND_A_DECLARATION_FILE_FOR_MODULE_0_1_IMPLICITLY_HAS_AN_ANY_TYPE;
    assert_eq!(reported(&c), vec![(implicit_any, vec![b"./j".to_vec(), b"/j.js".to_vec()])]);
    assert_eq!(c.diagnostic_store[c.diagnostics.added[0]].node, a.module_specifier(imports[0]));
    assert!(c.diagnostic_store[c.diagnostics.added[0]].chain.is_nil());

    // An untyped package carries the chain of createModuleNotFoundChain with its repopulate info.
    assert_eq!(resolve(&mut c, 1), SymbolId::NIL);
    let package = c.diagnostics.added[1];
    assert_eq!(
        reported(&c)[1],
        (implicit_any, vec![b"pkg".to_vec(), b"/node_modules/pkg/index.js".to_vec()])
    );
    let chain = c.diagnostic_store[package].chain;
    assert!(!chain.is_nil());
    let info = some(c.diagnostic_store[chain].repopulate_info());
    assert_eq!(info.kind, RepopulateDiagnosticKind::MODULE_NOT_FOUND);
    assert_eq!((info.module_reference.as_slice(), info.package_name.as_slice()), (&b"pkg"[..], &b""[..]));

    // `@types/` in a specifier, then the module that is not there.
    assert_eq!(resolve(&mut c, 2), SymbolId::NIL);
    assert_eq!(
        reported(&c)[2..],
        [
            (
                diagnostics::CANNOT_IMPORT_TYPE_DECLARATION_FILES_CONSIDER_IMPORTING_0_INSTEAD_OF_1,
                vec![b"foo".to_vec(), b"@types/foo".to_vec()]
            ),
            (
                diagnostics::CANNOT_FIND_MODULE_0_OR_ITS_CORRESPONDING_TYPE_DECLARATIONS,
                vec![b"@types/foo".to_vec()]
            ),
        ]
    );

    // A JSON module without resolveJsonModule.
    assert_eq!(resolve(&mut c, 3), SymbolId::NIL);
    assert_eq!(
        reported(&c)[4],
        (
            diagnostics::CANNOT_FIND_MODULE_0_CONSIDER_USING_RESOLVEJSONMODULE_TO_IMPORT_MODULE_WITH_JSON_EXTENSION,
            vec![b"./data.json".to_vec()]
        )
    );

    // The names of node's own modules get the message about its type definitions.
    let node_types = diagnostics::CANNOT_FIND_NAME_0_DO_YOU_NEED_TO_INSTALL_TYPE_DEFINITIONS_FOR_NODE_TRY_NPM_I_SAVE_DEV_TYPES_SLASHNODE_AND_THEN_ADD_NODE_TO_THE_TYPES_FIELD_IN_YOUR_TSCONFIG;
    assert_eq!(resolve(&mut c, 4), SymbolId::NIL);
    assert_eq!(reported(&c)[5], (node_types, vec![b"fs".to_vec()]));
    assert_eq!(resolve(&mut c, 5), SymbolId::NIL);
    assert_eq!(reported(&c)[6], (node_types, vec![b"node:test".to_vec()]));
    assert_eq!(reported(&c).len(), 7);

    // Nothing is reported when errors are ignored.
    let import = imports[2];
    assert_eq!(c.resolve_external_module_name(import, a.module_specifier(import), true), SymbolId::NIL);
    assert_eq!(reported(&c).len(), 7);
    assert_eq!(a.open().faults.count(), 0);
}

// l.ts: class C { [k]: number; [k]: string; } class D { [k]: number; [k](): void {} }
fn file_l(ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(b"");
    let nil = NodeId::NIL;
    let mut computed = |b: &mut FileBuilder| {
        let k = b.new_identifier(b"k");
        b.new_computed_property_name(k)
    };
    let mut property = |b: &mut FileBuilder| {
        let name = computed(b);
        let number = b.new_keyword_type_node(Kind::NumberKeyword);
        b.new_property_declaration(ModifierListId::NIL, name, nil, number, nil)
    };
    let (p1, p2, p3) = (property(&mut b), property(&mut b), property(&mut b));
    let method_name = {
        let k = b.new_identifier(b"k");
        b.new_computed_property_name(k)
    };
    let statements = b.new_node_list(&[]);
    let body = b.new_block(statements, false);
    let method = b.new_method_declaration(ModifierListId::NIL, nil, method_name, nil, NodeListId::NIL, NodeListId::NIL, nil, nil, body);
    let c_name = b.new_identifier(b"C");
    let c_members = b.new_node_list(&[p1, p2]);
    let class_c = b.new_class_declaration(ModifierListId::NIL, c_name, NodeListId::NIL, NodeListId::NIL, c_members);
    let d_name = b.new_identifier(b"D");
    let d_members = b.new_node_list(&[p3, method]);
    let class_d = b.new_class_declaration(ModifierListId::NIL, d_name, NodeListId::NIL, NodeListId::NIL, d_members);
    let end = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[class_c, class_d]);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, b"/l.ts", nil, ids);
    let classes = of_kind(&file, ids, Kind::ClassDeclaration);
    let properties = of_kind(&file, ids, Kind::PropertyDeclaration);
    let methods = of_kind(&file, ids, Kind::MethodDeclaration);
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let locals = a.new_table();
        let members_of = [(classes[0], vec![properties[0], properties[1]]), (classes[1], vec![properties[2], methods[0]])];
        for (class, members) in members_of {
            let name = a.text(a.name(class));
            let class_symbol = declared(a, SymbolFlags::CLASS, name, class, true);
            a.update_symbol(class_symbol, |s| s.members = a.new_table());
            a.table_set(locals, name, class_symbol);
            for member in members {
                let flags = if a.kind(member) == Kind::MethodDeclaration { SymbolFlags::METHOD } else { SymbolFlags::PROPERTY };
                let member_symbol = declared(a, flags, INTERNAL_SYMBOL_NAME_COMPUTED, member, true);
                a.update_symbol(member_symbol, |s| s.parent = class_symbol);
            }
        }
        a.set_locals(root, locals);
    });
    file
}

#[test]
fn computed_members_are_bound_late() {
    let ids = IdAllocator::new();
    let fl = file_l(&ids);
    assert_eq!(some(fl.bound()).fault_count(), 0);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&fl]).ok());
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = program_of(&options, Vec::new());
    let mut c = scratch_checker(a, &lists, &program, &options);
    let locals = a.locals(fl.source_file.root);
    let (class_c, class_d) = (a.table_get(locals, b"C"), a.table_get(locals, b"D"));
    let properties = of_kind(&fl, &ids, Kind::PropertyDeclaration);
    let methods = of_kind(&fl, &ids, Kind::MethodDeclaration);
    let late_name: &[u8] = b"\xFE@k@7";

    // Two properties of one name are one late symbol with both declarations.
    let early = a.symbol(properties[0]);
    assert_eq!(a.sym(early).name, INTERNAL_SYMBOL_NAME_COMPUTED);
    let late = c.get_late_bound_symbol(early);
    assert!(late != early && late.is_open());
    let data = a.sym(late);
    assert_eq!(data.name, late_name);
    assert_eq!(data.flags, SymbolFlags::PROPERTY | SymbolFlags::TRANSIENT);
    assert_eq!(data.check_flags, CheckFlags::LATE);
    assert_eq!(data.parent, class_c);
    assert_eq!(data.declarations.as_slice(), &[properties[0], properties[1]]);
    assert_eq!(data.value_declaration, properties[0]);
    let members = c.get_members_of_symbol(class_c);
    assert_eq!(a.table_get(members, late_name), late);
    assert_eq!(c.get_members_of_symbol(class_c), members);
    assert_eq!(c.get_symbol_of_declaration(properties[1]), late);
    assert_eq!(c.get_late_bound_symbol(a.symbol(properties[1])), late);
    let links = c.value_symbol_links_get(late);
    assert_eq!(c.value_symbol_links[links].name_type, scripted(&c).unique_symbol_type);
    assert_eq!(reported(&c), vec![]);
    assert_eq!(a.table_len(c.get_exports_of_symbol(class_c)), 0);

    // A method after a property of the same name is a conflict: each declaration gets the error, and the method gets a symbol of its own.
    let members = c.get_members_of_symbol(class_d);
    let property_symbol = a.table_get(members, late_name);
    assert_eq!(a.sym(property_symbol).declarations.as_slice(), &[properties[2]]);
    let method_symbol = c.get_symbol_of_declaration(methods[0]);
    assert!(method_symbol != property_symbol && method_symbol.is_open());
    assert_eq!(a.sym(method_symbol).flags, SymbolFlags::METHOD | SymbolFlags::TRANSIENT);
    assert_eq!(a.sym(method_symbol).parent, class_d);
    let duplicate = (diagnostics::DUPLICATE_IDENTIFIER_0, vec![b"".to_vec()]);
    assert_eq!(reported(&c), vec![duplicate.clone(), duplicate]);
    assert_eq!(
        (c.diagnostic_store[c.diagnostics.added[0]].node, c.diagnostic_store[c.diagnostics.added[1]].node),
        (a.name(properties[2]), a.name(methods[0]))
    );
    assert_eq!(a.open().faults.count(), 0);
}

// q.ts: const x = 1; export = x;      r.ts: import { x } from "./q";
fn file_q(ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(b"");
    let nil = NodeId::NIL;
    let x = b.new_identifier(b"x");
    let one = b.new_numeric_literal(b"1", TokenFlags::NONE);
    let declaration = b.new_variable_declaration(x, nil, nil, one);
    let declarations = b.new_node_list(&[declaration]);
    let list = b.new_variable_declaration_list(declarations, NodeFlags::CONST);
    let statement = b.new_variable_statement(ModifierListId::NIL, list);
    let x2 = b.new_identifier(b"x");
    let assignment = b.new_export_assignment(ModifierListId::NIL, true, nil, x2);
    let end = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[statement, assignment]);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, b"/q.ts", assignment, ids);
    let declaration = of_kind(&file, ids, Kind::VariableDeclaration)[0];
    let assignment = of_kind(&file, ids, Kind::ExportAssignment)[0];
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let file_symbol = declared(a, SymbolFlags::VALUE_MODULE, b"\"/q\"", root, true);
        let locals = a.new_table();
        a.table_set(locals, b"x", declared(a, SymbolFlags::BLOCK_SCOPED_VARIABLE, b"x", declaration, true));
        let exports = a.new_table();
        let export_equals = declared(a, SymbolFlags::ALIAS, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS, assignment, false);
        a.update_symbol(export_equals, |s| s.parent = file_symbol);
        a.table_set(exports, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS, export_equals);
        a.update_symbol(file_symbol, |s| s.exports = exports);
        a.set_locals(root, locals);
    });
    file
}

fn file_r(ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(b"");
    let import = import_of(&mut b, b"x", b"./q");
    let end = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[import]);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, b"/r.ts", import, ids);
    let specifier = of_kind(&file, ids, Kind::ImportSpecifier)[0];
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let file_symbol = declared(a, SymbolFlags::VALUE_MODULE, b"\"/r\"", root, true);
        a.update_symbol(file_symbol, |s| s.exports = a.new_table());
        let locals = a.new_table();
        a.table_set(locals, b"x", declared(a, SymbolFlags::ALIAS, b"x", specifier, false));
        a.set_locals(root, locals);
    });
    file
}

#[test]
fn an_export_equals_alias_and_a_named_import_of_it() {
    let ids = IdAllocator::new();
    let (fq, fr) = (file_q(&ids), file_r(&ids));
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&fq, &fr]).ok());
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = program_of(&options, vec![module(b"./q", b"/q.ts", fq.source_file.root)]);
    let mut c = scratch_checker(a, &lists, &program, &options);
    c.module_kind = ModuleKind::COMMON_JS;
    let q_symbol = a.symbol(fq.source_file.root);
    let local_x = a.table_get(a.locals(fq.source_file.root), b"x");
    let export_equals = a.table_get(a.sym(q_symbol).exports, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS);

    // `export = x` is an alias of the local, and the module resolves to it.
    assert_eq!(c.resolve_alias(export_equals), local_x);
    assert_eq!(c.resolve_external_module_symbol(q_symbol, false), local_x);
    assert_eq!(c.resolve_external_module_symbol(q_symbol, true), export_equals);
    assert_eq!(a.table_len(c.get_exports_of_module(q_symbol)), 0);
    assert_eq!(reported(&c), vec![]);

    // A named import of what the module assigns: the three messages of reportInvalidImportEqualsExportMember by module kind.
    let alias = a.table_get(a.locals(fr.source_file.root), b"x");
    assert_eq!(c.resolve_alias(alias), c.unknown_symbol);
    assert_eq!(
        reported(&c),
        vec![(
            diagnostics::X_0_CAN_ONLY_BE_IMPORTED_BY_USING_IMPORT_1_REQUIRE_2_OR_A_DEFAULT_IMPORT,
            vec![b"x".to_vec(), b"x".to_vec(), b"\"/q\"".to_vec()]
        )]
    );
    let specifier = of_kind(&fr, &ids, Kind::ImportSpecifier)[0];
    let name = a.name(specifier);
    assert_eq!(c.diagnostic_store[c.diagnostics.added[0]].node, name);
    c.module_kind = ModuleKind::ES2015;
    c.report_invalid_import_equals_export_member(name, b"x", b"\"/q\"");
    assert_eq!(
        reported(&c)[1],
        (diagnostics::X_0_CAN_ONLY_BE_IMPORTED_BY_USING_A_DEFAULT_IMPORT, vec![b"x".to_vec()])
    );
    assert_eq!(a.open().faults.count(), 0);
    assert!(c.type_resolutions.is_empty());
}

// t.ts: import type { x } from "./a"; import y = x; export * as star from "./a"; export as namespace Umd; import * as ns from "./a";
fn file_t(ids: &IdAllocator) -> File {
    let mut b = FileBuilder::new(b"");
    let nil = NodeId::NIL;
    let x = b.new_identifier(b"x");
    let import_specifier = b.new_import_specifier(false, nil, x);
    let elements = b.new_node_list(&[import_specifier]);
    let named = b.new_named_imports(elements);
    let clause = b.new_import_clause(Kind::TypeKeyword, nil, named);
    let module_specifier = b.new_string_literal(b"./a", TokenFlags::NONE);
    let type_import = b.new_import_declaration(ModifierListId::NIL, clause, module_specifier, nil);
    let (x2, y) = (b.new_identifier(b"x"), b.new_identifier(b"y"));
    let import_equals = b.new_import_equals_declaration(ModifierListId::NIL, false, y, x2);
    let star = b.new_identifier(b"star");
    let namespace_export = b.new_namespace_export(star);
    let module_specifier = b.new_string_literal(b"./a", TokenFlags::NONE);
    let export_star = b.new_export_declaration(ModifierListId::NIL, false, namespace_export, module_specifier, nil);
    let umd = b.new_identifier(b"Umd");
    let umd_export = b.new_namespace_export_declaration(ModifierListId::NIL, umd);
    let ns = b.new_identifier(b"ns");
    let namespace_import = b.new_namespace_import(ns);
    let clause = b.new_import_clause(Kind::Unknown, nil, namespace_import);
    let module_specifier = b.new_string_literal(b"./a", TokenFlags::NONE);
    let import_ns = b.new_import_declaration(ModifierListId::NIL, clause, module_specifier, nil);
    let end = b.new_token(Kind::EndOfFile);
    let statements = b.new_node_list(&[type_import, import_equals, export_star, umd_export, import_ns]);
    let root = b.new_source_file(statements, end);
    let file = finish(b, root, b"/t.ts", type_import, ids);
    let specifier = of_kind(&file, ids, Kind::ImportSpecifier)[0];
    let import_equals = of_kind(&file, ids, Kind::ImportEqualsDeclaration)[0];
    let namespace_export = of_kind(&file, ids, Kind::NamespaceExport)[0];
    let umd_export = of_kind(&file, ids, Kind::NamespaceExportDeclaration)[0];
    let namespace_import = of_kind(&file, ids, Kind::NamespaceImport)[0];
    let root = file.source_file.root;
    file.bind_once(ids, |a| {
        let file_symbol = declared(a, SymbolFlags::VALUE_MODULE, b"\"/t\"", root, true);
        let (locals, exports, global_exports) = (a.new_table(), a.new_table(), a.new_table());
        a.table_set(locals, b"x", declared(a, SymbolFlags::ALIAS, b"x", specifier, false));
        a.table_set(locals, b"y", declared(a, SymbolFlags::ALIAS, b"y", import_equals, false));
        a.table_set(locals, b"ns", declared(a, SymbolFlags::ALIAS, b"ns", namespace_import, false));
        a.table_set(exports, b"star", declared(a, SymbolFlags::ALIAS, b"star", namespace_export, false));
        a.table_set(global_exports, b"Umd", declared(a, SymbolFlags::ALIAS, b"Umd", umd_export, false));
        a.update_symbol(file_symbol, |s| s.exports = exports);
        a.set_locals(root, locals);
        a.set_global_exports(root, global_exports);
    });
    file
}

#[test]
fn type_only_imports_namespace_exports_and_module_types() {
    let ids = IdAllocator::new();
    let (fa, ft) = (file_a(&ids), file_t(&ids));
    assert_eq!(some(ft.bound()).fault_count(), 0);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&fa, &ft]).ok());
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = program_of(&options, vec![module(b"./a", b"/a.ts", fa.source_file.root)]);
    let mut c = scratch_checker(a, &lists, &program, &options);
    let a_symbol = a.symbol(fa.source_file.root);
    let exported_x = a.table_get(a.sym(a_symbol).exports, b"x");
    let t_file = a.as_source_file(ft.source_file.root);
    let (locals, exports) = (t_file.locals, a.sym(t_file.symbol).exports);
    let specifier = of_kind(&ft, &ids, Kind::ImportSpecifier)[0];
    let import_equals = of_kind(&ft, &ids, Kind::ImportEqualsDeclaration)[0];

    // `import type { x }`: the alias resolves, is marked type-only, and its flags stop there when type-only meanings are excluded.
    let x = a.table_get(locals, b"x");
    assert_eq!(c.resolve_alias(x), exported_x);
    assert_eq!(c.get_type_only_alias_declaration(x), specifier);
    assert_eq!(c.get_symbol_flags_ex(x, true, false), SymbolFlags::ALIAS);
    assert_eq!(c.get_symbol_flags_ex(x, false, true), SymbolFlags::BLOCK_SCOPED_VARIABLE);
    assert_eq!(c.get_symbol_flags(x), SymbolFlags::ALIAS | SymbolFlags::BLOCK_SCOPED_VARIABLE);
    assert!(c.mark_symbol_of_alias_declaration_if_type_only(specifier, NodeId::NIL));
    assert!(!c.mark_symbol_of_alias_declaration_if_type_only(NodeId::NIL, specifier));
    assert_eq!(c.resolve_alias_with_deprecation_check(x, specifier), exported_x);
    assert_eq!(reported(&c), vec![]);

    // `import y = x` of a type-only import: the error on the reference with the import as related information.
    let y = a.table_get(locals, b"y");
    assert_eq!(c.resolve_alias(y), c.unknown_symbol);
    assert_eq!(
        reported(&c),
        vec![(diagnostics::AN_IMPORT_ALIAS_CANNOT_REFERENCE_A_DECLARATION_THAT_WAS_IMPORTED_USING_IMPORT_TYPE, vec![])]
    );
    let error = c.diagnostics.added[0];
    assert_eq!(c.diagnostic_store[error].node, a.as_import_equals_declaration(import_equals).module_reference);
    let related = c.diagnostic_store[error].related_information().to_vec();
    assert_eq!(related.len(), 1);
    let info = &c.diagnostic_store[related[0]];
    assert_eq!((info.node, info.message, info.args.clone()), (specifier, diagnostics::X_0_WAS_IMPORTED_HERE, vec![b"x".to_vec()]));

    // `export * as star from` and `export as namespace Umd` are the module.
    let star = a.table_get(exports, b"star");
    assert_eq!(c.resolve_alias(star), a_symbol);
    let umd = a.table_get(t_file.global_exports, b"Umd");
    assert_eq!(c.resolve_alias(umd), t_file.symbol);

    // A namespace import of a module whose type has a `default` property gets a module type with a synthetic default.
    set_scripted(Scripted { default_property: c.unknown_symbol, ..scripted(&c) });
    let ns = a.table_get(locals, b"ns");
    let module_type_symbol = c.resolve_alias(ns);
    assert!(module_type_symbol != a_symbol && module_type_symbol.is_open());
    let data = a.sym(module_type_symbol);
    assert_eq!(data.flags, SymbolFlags::VALUE_MODULE | SymbolFlags::TRANSIENT);
    assert_eq!(data.name, a.sym(a_symbol).name);
    assert_eq!(a.table_get(data.exports, b"x"), exported_x);
    assert!(data.exports != a.sym(a_symbol).exports);
    let links = c.export_type_links.get(module_type_symbol);
    assert_eq!(c.export_type_links[links].target, a_symbol);
    let namespace_import = of_kind(&ft, &ids, Kind::NamespaceImport)[0];
    assert_eq!(c.export_type_links[links].originating_import, a.parent(a.parent(namespace_import)));
    let value_links = c.value_symbol_links_get(module_type_symbol);
    let resolved_type = c.value_symbol_links[value_links].resolved_type;
    assert!(!resolved_type.is_nil());
    assert_eq!(c.types[resolved_type].symbol, module_type_symbol);
    let default = a.table_get(c.as_structured_type(resolved_type).members, INTERNAL_SYMBOL_NAME_DEFAULT);
    assert_eq!(a.sym(default).flags, SymbolFlags::ALIAS | SymbolFlags::TRANSIENT);
    assert_eq!(c.resolve_alias(default), a_symbol);
    assert_eq!(reported(&c).len(), 1);

    // A structured type of a TypeScript module without `export =` has no synthetic default: the type itself is the module type, and the answer is cached.
    let structured = c.types.alloc(Type { flags: TypeFlags::OBJECT, ..Type::default() });
    let reference = a.module_specifier(a.parent(a.parent(namespace_import)));
    assert_eq!(c.get_type_with_synthetic_default_import_type(structured, a_symbol, a_symbol, reference), structured);
    let key = CachedTypeKey { kind: CachedTypeKind::SYNTHETIC_TYPE, type_id: structured };
    assert_eq!(c.cached_types.get(&key), structured);
    assert_eq!(c.get_type_with_synthetic_default_only(structured, a_symbol, a_symbol, reference), TypeId::NIL);
    assert_eq!(c.resolve_external_module_type_by_literal(reference), c.error_type);
    assert_eq!(a.open().faults.count(), 0);
    assert!(c.type_resolutions.is_empty());
}

#[test]
fn a_qualified_type_name_that_is_a_value() {
    let ids = IdAllocator::new();
    let fc = file_c(&ids);
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = some(Frozen::of_files(&[&fc]).ok());
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = program_of(&options, Vec::new());
    let mut c = scratch_checker(a, &lists, &program, &options);
    let locals = a.locals(fc.source_file.root);
    c.merge_symbol_table(c.globals, locals, false, SymbolId::NIL);
    c.global_object_type = c.any_type;
    let aliases = of_kind(&fc, &ids, Kind::ImportEqualsDeclaration);
    let reference = a.as_import_equals_declaration(aliases[1]).module_reference;
    // `N.missing` as a type: tryGetQualifiedNameAsValue finds `N` and asks its type for the property, which the scratch does not have.
    assert_eq!(c.try_get_qualified_name_as_value(reference), SymbolId::NIL);
    assert_eq!(c.resolve_entity_name(reference, SymbolFlags::TYPE, false, false, NodeId::NIL), SymbolId::NIL);
    assert_eq!(
        reported(&c),
        vec![(diagnostics::NAMESPACE_0_HAS_NO_EXPORTED_MEMBER_1, vec![b"N".to_vec(), b"missing".to_vec()])]
    );
    assert_eq!(a.open().faults.count(), 0);
}
