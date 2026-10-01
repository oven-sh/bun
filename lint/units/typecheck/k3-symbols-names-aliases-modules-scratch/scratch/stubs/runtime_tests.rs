// Scratch tests: steps 6 to 8 run on symbols and tables of an open store, with the stand-ins of checker_stub.rs for everything else.
use crate::ast::stable::Arena;
use crate::ast::*;
use crate::checker::*;
use crate::core::{CompilerOptions, ModuleKind};

fn with_checker(f: impl FnOnce(&mut Checker<'_>)) {
    let ids = IdAllocator::new();
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = Frozen::none();
    let a = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = ScratchProgram { options: &options, modules: Vec::new(), existing: vec![b"/src/a.ts", b"/src/b.tsx"] };
    let mut c = scratch_checker(a, &lists, &program, &options);
    f(&mut c);
}

fn names(a: Ast<'_>, table: SymbolTableId) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut position = 0;
    while let Some((name, _)) = a.table_entry_at(table, position) {
        position += 1;
        out.push(name.to_vec());
    }
    out
}

#[test]
fn new_symbols_are_transient_and_counted() {
    with_checker(|c| {
        let before = c.symbol_count;
        let s = c.new_symbol(SymbolFlags::FUNCTION, b"f");
        assert_eq!(c.symbol_count, before + 1);
        assert_eq!(c.ast.sym(s).flags, SymbolFlags::FUNCTION | SymbolFlags::TRANSIENT);
        assert_eq!(c.ast.sym(s).name, b"f");
        let e = c.new_symbol_ex(SymbolFlags::PROPERTY, b"p", CheckFlags::LATE);
        assert_eq!(c.ast.sym(e).check_flags, CheckFlags::LATE);
        let any_type = c.any_type;
        let error_type = c.error_type;
        let p = c.new_parameter(b"x", any_type);
        assert!(c.ast.sym(p).flags.contains(SymbolFlags::FUNCTION_SCOPED_VARIABLE | SymbolFlags::TRANSIENT));
        let links = c.value_symbol_links_get(p);
        assert_eq!(c.value_symbol_links[links].resolved_type, any_type);
        let q = c.new_property(b"y", error_type);
        assert!(c.ast.sym(q).flags.contains(SymbolFlags::PROPERTY));
    });
}

#[test]
fn excluded_flags_follow_upstream() {
    assert_eq!(get_excluded_symbol_flags(SymbolFlags::NONE), SymbolFlags::NONE);
    assert_eq!(get_excluded_symbol_flags(SymbolFlags::BLOCK_SCOPED_VARIABLE), SymbolFlags::BLOCK_SCOPED_VARIABLE_EXCLUDES);
    assert_eq!(get_excluded_symbol_flags(SymbolFlags::INTERFACE), SymbolFlags::INTERFACE_EXCLUDES);
    assert_eq!(
        get_excluded_symbol_flags(SymbolFlags::FUNCTION | SymbolFlags::VALUE_MODULE),
        SymbolFlags::FUNCTION_EXCLUDES | SymbolFlags::VALUE_MODULE_EXCLUDES
    );
    let replaceable = get_excluded_symbol_flags(SymbolFlags::PROPERTY | SymbolFlags::REPLACEABLE_BY_METHOD);
    assert_eq!(replaceable, SymbolFlags::PROPERTY_EXCLUDES.without(SymbolFlags::METHOD));
}

#[test]
fn merge_into_a_transient_target_mutates_it() {
    with_checker(|c| {
        let a = c.ast;
        let target = c.new_symbol(SymbolFlags::INTERFACE, b"I");
        let source = a.new_symbol(SymbolFlags::INTERFACE, b"I");
        let member_a = a.new_symbol(SymbolFlags::PROPERTY, b"a");
        let member_b = a.new_symbol(SymbolFlags::PROPERTY, b"b");
        let target_members = a.new_table();
        a.table_set(target_members, b"a", member_a);
        a.update_symbol(target, |s| s.members = target_members);
        let source_members = a.new_table();
        a.table_set(source_members, b"b", member_b);
        a.update_symbol(source, |s| s.members = source_members);
        let merged = c.merge_symbol(target, source, false);
        assert_eq!(merged, target);
        assert_eq!(names(a, a.sym(target).members), vec![b"a".to_vec(), b"b".to_vec()]);
        assert_eq!(c.get_merged_symbol(source), target);
        assert_eq!(c.get_merged_symbol(target), target);
        assert_eq!(c.get_merged_symbol(SymbolId::NIL), SymbolId::NIL);
        assert!(a.sym(target).declarations.is_nil());
        assert_eq!(a.open().faults.count(), 0);
    });
}

#[test]
fn merge_into_a_bound_like_target_clones_it() {
    with_checker(|c| {
        let a = c.ast;
        let target = a.new_symbol(SymbolFlags::NAMESPACE_MODULE, b"N");
        let source = a.new_symbol(SymbolFlags::NAMESPACE_MODULE, b"N");
        let x = a.new_symbol(SymbolFlags::INTERFACE, b"X");
        let x2 = a.new_symbol(SymbolFlags::INTERFACE, b"X");
        let y = a.new_symbol(SymbolFlags::INTERFACE, b"Y");
        let target_exports = a.new_table();
        a.table_set(target_exports, b"X", x);
        a.update_symbol(target, |s| s.exports = target_exports);
        let source_exports = a.new_table();
        a.table_set(source_exports, b"X", x2);
        a.table_set(source_exports, b"Y", y);
        a.update_symbol(source, |s| s.exports = source_exports);
        let merged = c.merge_symbol(target, source, false);
        assert_ne!(merged, target);
        assert!(a.sym(merged).flags.intersects(SymbolFlags::TRANSIENT));
        assert_eq!(c.get_merged_symbol(target), merged);
        assert_eq!(c.get_merged_symbol(source), merged);
        assert_eq!(names(a, a.sym(target).exports), vec![b"X".to_vec()]);
        assert_eq!(names(a, a.sym(merged).exports), vec![b"X".to_vec(), b"Y".to_vec()]);
        let merged_x = a.table_get(a.sym(merged).exports, b"X");
        assert_ne!(merged_x, x);
        assert_eq!(a.sym(merged_x).parent, merged);
        assert_eq!(c.get_merged_symbol(x), merged_x);
        assert_eq!(c.get_merged_symbol(x2), merged_x);
        assert_eq!(a.table_get(a.sym(merged).exports, b"Y"), y);
        assert_eq!(a.sym(y).parent, SymbolId::NIL);
        assert_eq!(a.open().faults.count(), 0);
    });
}

#[test]
fn a_unidirectional_merge_records_nothing_for_the_source() {
    with_checker(|c| {
        let a = c.ast;
        let target = c.new_symbol(SymbolFlags::INTERFACE, b"I");
        let source = a.new_symbol(SymbolFlags::INTERFACE, b"I");
        assert_eq!(c.merge_symbol(target, source, true), target);
        assert_eq!(c.get_merged_symbol(source), source);
        assert_eq!(c.merge_symbol(target, target, false), target);
    });
}

#[test]
fn const_enum_only_module_flag_is_reset_by_an_instantiated_module() {
    with_checker(|c| {
        let a = c.ast;
        let target = c.new_symbol(SymbolFlags::VALUE_MODULE | SymbolFlags::CONST_ENUM_ONLY_MODULE, b"M");
        let source = a.new_symbol(SymbolFlags::VALUE_MODULE, b"M");
        c.merge_symbol(target, source, false);
        assert!(!a.sym(target).flags.intersects(SymbolFlags::CONST_ENUM_ONLY_MODULE));
        let target2 = c.new_symbol(SymbolFlags::VALUE_MODULE, b"M");
        let source2 = a.new_symbol(SymbolFlags::VALUE_MODULE | SymbolFlags::CONST_ENUM_ONLY_MODULE, b"M");
        c.merge_symbol(target2, source2, false);
        assert!(!a.sym(target2).flags.intersects(SymbolFlags::CONST_ENUM_ONLY_MODULE));
        let target3 = c.new_symbol(SymbolFlags::VALUE_MODULE | SymbolFlags::CONST_ENUM_ONLY_MODULE, b"M");
        let source3 = a.new_symbol(SymbolFlags::VALUE_MODULE | SymbolFlags::CONST_ENUM_ONLY_MODULE, b"M");
        c.merge_symbol(target3, source3, false);
        assert!(a.sym(target3).flags.intersects(SymbolFlags::CONST_ENUM_ONLY_MODULE));
    });
}

#[test]
fn conflicting_symbols_do_not_merge() {
    with_checker(|c| {
        let a = c.ast;
        let target = c.new_symbol(SymbolFlags::BLOCK_SCOPED_VARIABLE, b"x");
        let source = a.new_symbol(SymbolFlags::FUNCTION_SCOPED_VARIABLE, b"x");
        let flags = a.sym(target).flags;
        assert_eq!(c.merge_symbol(target, source, false), target);
        assert_eq!(a.sym(target).flags, flags);
        assert_eq!(c.get_merged_symbol(source), source);
    });
}

#[test]
fn symbol_tables_combine() {
    with_checker(|c| {
        let a = c.ast;
        let first = a.new_table();
        let second = a.new_table();
        assert_eq!(c.combine_symbol_tables(first, second), second);
        assert_eq!(c.combine_symbol_tables(SymbolTableId::NIL, second), second);
        let s1 = a.new_symbol(SymbolFlags::PROPERTY, b"p");
        a.table_set(first, b"p", s1);
        assert_eq!(c.combine_symbol_tables(first, second), first);
        assert_eq!(c.combine_symbol_tables(first, SymbolTableId::NIL), first);
        let s2 = a.new_symbol(SymbolFlags::PROPERTY, b"q");
        a.table_set(second, b"q", s2);
        let combined = c.combine_symbol_tables(first, second);
        assert!(combined != first && combined != second);
        assert_eq!(names(a, combined), vec![b"p".to_vec(), b"q".to_vec()]);
        assert_eq!(a.table_get(combined, b"p"), s1);
        assert_eq!(a.table_get(combined, b"q"), s2);
    });
}

#[test]
fn get_symbol_reads_through_merges_and_meanings() {
    with_checker(|c| {
        let a = c.ast;
        let table = a.new_table();
        let value = a.new_symbol(SymbolFlags::FUNCTION_SCOPED_VARIABLE, b"v");
        a.table_set(table, b"v", value);
        assert_eq!(c.get_symbol(table, b"v", SymbolFlags::VALUE), value);
        assert_eq!(c.get_symbol(table, b"v", SymbolFlags::TYPE), SymbolId::NIL);
        assert_eq!(c.get_symbol(table, b"w", SymbolFlags::VALUE), SymbolId::NIL);
        assert_eq!(c.get_symbol(table, b"v", SymbolFlags::NONE), SymbolId::NIL);
        assert_eq!(c.get_symbol(table, b"v", SymbolFlags::GLOBAL_LOOKUP), SymbolId::NIL);
        assert_eq!(c.get_symbol(SymbolTableId::NIL, b"v", SymbolFlags::VALUE), SymbolId::NIL);
        let clone = c.clone_symbol(value);
        assert_eq!(c.get_symbol(table, b"v", SymbolFlags::VALUE), clone);
    });
}

#[test]
fn ambient_modules_are_the_quoted_globals() {
    with_checker(|c| {
        let a = c.ast;
        assert!(c.get_ambient_modules().is_nil());
    });
    with_checker(|c| {
        let a = c.ast;
        let fs = a.new_symbol(SymbolFlags::VALUE_MODULE, b"\"fs\"");
        let plain = a.new_symbol(SymbolFlags::VALUE_MODULE, b"fs");
        let interface = a.new_symbol(SymbolFlags::INTERFACE, b"\"iface\"");
        a.table_set(c.globals, b"\"fs\"", fs);
        a.table_set(c.globals, b"fs", plain);
        a.table_set(c.globals, b"\"iface\"", interface);
        assert_eq!(c.try_find_ambient_module(b"fs", true), fs);
        assert_eq!(c.try_find_ambient_module(b"./fs", true), SymbolId::NIL);
        assert_eq!(c.try_find_ambient_module(b"iface", false), SymbolId::NIL);
        assert_eq!(c.try_find_ambient_module(b"none", false), SymbolId::NIL);
        assert_eq!(c.get_ambient_modules().as_slice(), &[fs, interface]);
        assert_eq!(c.get_ambient_modules().as_slice(), &[fs, interface]);
    });
}

#[test]
fn exports_of_a_module_are_cloned_once() {
    with_checker(|c| {
        let a = c.ast;
        let module = a.new_symbol(SymbolFlags::VALUE_MODULE, b"\"m\"");
        let f = a.new_symbol(SymbolFlags::FUNCTION, b"f");
        let exports = a.new_table();
        a.table_set(exports, b"f", f);
        a.update_symbol(module, |s| s.exports = exports);
        let resolved = c.get_exports_of_symbol(module);
        assert!(resolved != exports && !resolved.is_nil());
        assert_eq!(names(a, resolved), vec![b"f".to_vec()]);
        assert_eq!(c.get_exports_of_symbol(module), resolved);
        assert_eq!(c.get_exports_of_module(module), resolved);
        let links = c.module_symbol_links.get(module);
        assert!(c.module_symbol_links[links].type_only_export_star_map.is_nil());
        assert_eq!(c.get_export_of_module(module, b"f", NodeId::NIL, false), f);
        assert_eq!(c.get_export_of_module(module, b"g", NodeId::NIL, false), SymbolId::NIL);
        assert_eq!(c.get_export_of_module(f, b"f", NodeId::NIL, false), SymbolId::NIL);
        let empty = a.new_symbol(SymbolFlags::VALUE_MODULE, b"\"e\"");
        let empty_exports = c.get_exports_of_symbol(empty);
        assert!(!empty_exports.is_nil());
        assert_eq!(a.table_len(empty_exports), 0);
        assert_eq!(c.get_members_of_symbol(f), SymbolTableId::NIL);
        assert_eq!(c.resolve_external_module_symbol(module, false), module);
        assert_eq!(c.resolve_external_module_symbol(SymbolId::NIL, false), SymbolId::NIL);
    });
}

#[test]
fn an_export_equals_module_keeps_its_type_exports() {
    with_checker(|c| {
        let a = c.ast;
        let module = a.new_symbol(SymbolFlags::VALUE_MODULE, b"\"m\"");
        let target = a.new_symbol(SymbolFlags::FUNCTION_SCOPED_VARIABLE, b"x");
        let typedef = a.new_symbol(SymbolFlags::TYPE_ALIAS, b"T");
        let value = a.new_symbol(SymbolFlags::FUNCTION, b"g");
        let exports = a.new_table();
        a.table_set(exports, INTERNAL_SYMBOL_NAME_EXPORT_EQUALS, target);
        a.table_set(exports, b"T", typedef);
        a.table_set(exports, b"g", value);
        a.update_symbol(module, |s| s.exports = exports);
        assert_eq!(c.resolve_external_module_symbol(module, false), target);
        let (resolved, type_only) = c.get_exports_of_module_worker(module);
        assert_eq!(names(a, resolved), vec![b"T".to_vec()]);
        assert!(type_only.is_nil());
    });
}

#[test]
fn flags_of_symbols_without_aliases() {
    with_checker(|c| {
        let a = c.ast;
        let s = a.new_symbol(SymbolFlags::CLASS | SymbolFlags::NAMESPACE_MODULE, b"C");
        assert_eq!(c.get_symbol_flags(s), SymbolFlags::CLASS | SymbolFlags::NAMESPACE_MODULE);
        assert_eq!(c.get_symbol_flags_ex(s, true, true), SymbolFlags::NONE);
        assert_eq!(c.get_late_bound_symbol(s), s);
        assert_eq!(c.resolve_symbol(s), s);
        assert_eq!(c.resolve_symbol(SymbolId::NIL), SymbolId::NIL);
        assert_eq!(c.get_parent_of_symbol(s), SymbolId::NIL);
        assert_eq!(c.get_symbol_if_same_reference(s, s), s);
        let other = a.new_symbol(SymbolFlags::CLASS, b"D");
        assert_eq!(c.get_symbol_if_same_reference(s, other), SymbolId::NIL);
        assert_eq!(c.get_declaration_of_alias_symbol(s), NodeId::NIL);
        let exported = a.new_symbol(SymbolFlags::FUNCTION, b"f");
        let local = a.new_symbol(SymbolFlags::EXPORT_VALUE, b"f");
        a.update_symbol(local, |l| l.export_symbol = exported);
        assert_eq!(c.get_export_symbol_of_value_symbol_if_exported(local), exported);
        assert_eq!(c.get_export_symbol_of_value_symbol_if_exported(s), s);
        assert_eq!(c.get_export_symbol_of_value_symbol_if_exported(SymbolId::NIL), SymbolId::NIL);
    });
}

#[test]
fn an_alias_that_is_not_one_resolves_to_the_unknown_symbol() {
    with_checker(|c| {
        let a = c.ast;
        let s = a.new_symbol(SymbolFlags::CLASS, b"C");
        assert_eq!(c.resolve_alias(s), c.unknown_symbol);
        assert_eq!(a.open().faults.count(), 1);
        assert_eq!(c.resolve_alias_exported(SymbolId::NIL), (SymbolId::NIL, false));
    });
}

#[test]
fn value_and_type_symbols_combine() {
    with_checker(|c| {
        let a = c.ast;
        let unknown = c.unknown_symbol;
        assert_eq!(c.combine_value_and_type_symbols(unknown, unknown), unknown);
        let value = a.new_symbol(SymbolFlags::PROPERTY, b"Point");
        let type_symbol = a.new_symbol(SymbolFlags::INTERFACE, b"Point");
        let both = a.new_symbol(SymbolFlags::CLASS, b"Point");
        assert_eq!(c.combine_value_and_type_symbols(value, both), both);
        assert_eq!(c.combine_value_and_type_symbols(both, type_symbol), both);
        let members = a.new_table();
        a.table_set(members, b"x", a.new_symbol(SymbolFlags::PROPERTY, b"x"));
        a.update_symbol(type_symbol, |s| s.members = members);
        let parent = a.new_symbol(SymbolFlags::VALUE_MODULE, b"graphics");
        a.update_symbol(type_symbol, |s| s.parent = parent);
        let combined = c.combine_value_and_type_symbols(value, type_symbol);
        let data = a.sym(combined);
        assert_eq!(data.flags, SymbolFlags::PROPERTY | SymbolFlags::INTERFACE | SymbolFlags::TRANSIENT);
        assert_eq!(data.name, b"Point");
        assert_eq!(data.parent, parent);
        assert!(data.members != members && names(a, data.members) == vec![b"x".to_vec()]);
        assert!(data.exports.is_nil());
        assert!(data.declarations.is_nil());
    });
}

#[test]
fn import_suggestions() {
    with_checker(|c| {
        assert_eq!(c.get_suggested_import_extension(b"/src/a"), b".js");
        assert_eq!(c.get_suggested_import_extension(b"/src/b"), b".js");
        assert_eq!(c.get_suggested_import_extension(b"/src/c"), b"");
        c.module_kind = ModuleKind::COMMON_JS;
        assert_eq!(c.get_suggested_import_source(b"./a.d.ts", b".d.ts", ModuleKind::COMMON_JS), b"./a");
        assert_eq!(c.get_suggested_import_source(b"./a.d.mts", b".d.mts", ModuleKind::ES_NEXT), b"./a.mjs");
        assert_eq!(c.get_suggested_import_source(b"./a.cts", b".cts", ModuleKind::ES_NEXT), b"./a.cjs");
        c.module_kind = ModuleKind::ES2015;
        assert_eq!(c.get_suggested_import_source(b"./a.ts", b".ts", ModuleKind::NONE), b"./a.js");
        assert!(resolution_extension_is_ts_or_json(b".d.ts") && resolution_extension_is_ts_or_json(b".json"));
        assert!(!resolution_extension_is_ts_or_json(b".js"));
        assert!(is_esm_format_import_importing_commonjs_format_file(ModuleKind::ES_NEXT, ModuleKind::COMMON_JS));
        assert!(!is_esm_format_import_importing_commonjs_format_file(ModuleKind::COMMON_JS, ModuleKind::ES_NEXT));
    });
}
