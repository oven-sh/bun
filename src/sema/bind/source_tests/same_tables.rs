mod support;
use support::*;

use std::fmt::Debug;

const DIFFERENCE_CONTEXT: usize = 200;

struct Numbering {
    scopes: Vec<ScopeId>,
    tables: Vec<TableId>,
}

impl Numbering {
    fn new(bound: &Bound<'_>) -> Numbering {
        let mut numbering = Numbering {
            scopes: Vec::with_capacity(bound.scopes.len()),
            tables: Vec::with_capacity(bound.tables.len()),
        };
        let mut is_dropped = vec![false; bound.tables.len()];
        let mut next_scope = 0;
        for scope in bound.scopes.iter() {
            let number = if is_runtime_scope(scope.kind) {
                assert!(bound.table(scope.locals).is_empty());
                is_dropped[scope.locals.idx()] = true;
                numbering.scope(scope.parent)
            } else {
                next_scope += 1;
                ScopeId(next_scope - 1)
            };
            numbering.scopes.push(number);
        }
        let mut next_table = 0;
        for is_dropped in is_dropped {
            let number = if is_dropped {
                TableId::NONE
            } else {
                next_table += 1;
                TableId(next_table - 1)
            };
            numbering.tables.push(number);
        }
        numbering
    }

    fn scope(&self, id: ScopeId) -> ScopeId {
        id.some().map_or(ScopeId::NONE, |id| self.scopes[id.idx()])
    }

    fn table(&self, id: TableId) -> TableId {
        id.some().map_or(TableId::NONE, |id| self.tables[id.idx()])
    }
}

fn is_runtime_scope(kind: ScopeKind) -> bool {
    matches!(
        kind,
        ScopeKind::With(_)
            | ScopeKind::FieldInitializer(_)
            | ScopeKind::ClassDecorators(_)
            | ScopeKind::ImplicitBlock(_)
    )
}

fn scalar_text<T: Debug>(value: &T) -> String {
    format!("{value:?}")
}

fn list_text<T: Debug>(list: &[T]) -> String {
    format!("{list:?}")
}

fn mapped_text<T, U: Debug>(list: &[T], map: impl Fn(&T) -> U) -> String {
    format!("{:?}", list.iter().map(map).collect::<Vec<U>>())
}

fn sorted_text<T: Debug>(items: impl Iterator<Item = T>) -> String {
    let mut texts: Vec<String> = items.map(|item| format!("{item:?}")).collect();
    texts.sort();
    texts.join(", ")
}

fn ids_text<T: Id, U: Debug>(list: &Narrow<'_, T>, map: impl Fn(T) -> U) -> String {
    let ids = (0..list.len()).filter_map(|index| list.id_at(index));
    format!("{:?}", ids.map(map).collect::<Vec<U>>())
}

fn describe_symbol(symbol: Symbol<'_>, numbering: &Numbering) -> String {
    let Symbol {
        name,
        flags,
        decls,
        value_declaration,
        parent,
        exports,
        members,
        export_symbol,
    } = symbol;
    let exports = numbering.table(exports);
    let members = numbering.table(members);
    format!(
        "{:?}",
        (
            name,
            flags,
            decls,
            value_declaration,
            parent,
            exports,
            members,
            export_symbol
        )
    )
}

fn describe_scope(scope: &Scope, numbering: &Numbering) -> String {
    let Scope {
        parent,
        kind,
        locals,
        symbol,
        is_export_context,
    } = *scope;
    let parent = numbering.scope(parent);
    let locals = numbering.table(locals);
    format!("{:?}", (parent, kind, locals, symbol, is_export_context))
}

fn describe_fn(info: &FnInfo, bound: &Bound<'_>, numbering: &Numbering) -> String {
    let FnInfo {
        owner,
        scope,
        enclosing,
        returns,
        yields,
        end,
        exit,
        contains_this,
    } = *info;
    let scope = numbering.scope(scope);
    let returns: Vec<StmtId> = bound.ids(returns).collect();
    let yields: Vec<ExprId> = bound.ids(yields).collect();
    format!(
        "{:?}",
        (
            owner,
            scope,
            enclosing,
            returns,
            yields,
            end,
            exit,
            contains_this
        )
    )
}

fn describe_scopes(scopes: &[Scope], numbering: &Numbering) -> String {
    let described_scopes: Vec<String> = scopes
        .iter()
        .filter(|scope| !is_runtime_scope(scope.kind))
        .map(|scope| describe_scope(scope, numbering))
        .collect();
    format!("{described_scopes:?}")
}

fn describe_tables(bound: &Bound<'_>, numbering: &Numbering) -> String {
    let described_tables: Vec<&[(Atom, SymbolId)]> = (0..bound.tables.len() as u32)
        .map(TableId)
        .filter(|&table| numbering.table(table).is_some())
        .map(|table| bound.table(table))
        .collect();
    format!("{described_tables:?}")
}

fn describe_large_tables(bound: &Bound<'_>, numbering: &Numbering) -> String {
    sorted_text(
        bound
            .large_tables
            .iter()
            .map(|(&(table, name), &entry_index)| ((numbering.table(table), name), entry_index)),
    )
}

fn describe_expr_scope(bound: &Bound<'_>, numbering: &Numbering) -> String {
    sorted_text(
        bound
            .expr_scope
            .iter()
            .map(|(&expr, &scope)| (expr, numbering.scope(scope))),
    )
}

macro_rules! push_fields {
    ($described:ident, $text:ident: $($field:ident),+ $(,)?) => {
        $($described.push((stringify!($field), $text($field)));)+
    };
}

fn describe(
    bound: &Bound<'_>,
    numbering: &Numbering,
    symbol_count: usize,
    id_count: usize,
) -> Vec<(&'static str, String)> {
    #[rustfmt::skip]
    let BoundIn {
        ran_out_of_stack, is_unbound, symbols, scopes, tables: _, entries, large_tables: _,
        nested_names, ids,
        file_symbol, export_stars, ambient_modules, pattern_ambient_modules, global_augmentations,
        redeclarations, umd_globals, specifiers, module_augmentations, ambient_specifiers,
        commonjs_indicator, module_exports_property, expr_symbol, expr_parent, expr_flow,
        stmt_parent, stmt_scope, type_scope, type_by_alias, this_in_type_literal, pat_parent,
        pat_symbol, prop_owner, member_symbol, property_symbol, member_owner, member_scope,
        param_fn, type_param_symbol, type_param_scope, fns, requires_scope_change, fn_symbol,
        class_symbol, class_owner, class_scope, interface_symbol, interface_scope,
        interface_contains_this, enum_scope, module_scope, alias_symbol, alias_scope, enum_symbol,
        enum_member_symbol, enum_member_owner, module_symbol, module_instance_state, var_stmt,
        assignments, type_query_operands, unchecked_exprs,
        unchecked_types, infer_positions, expando_declarations, computed_symbols, case_stmt,
        stmt_flow, case_fallthrough, hoisted_vars, rejected_decorators, unused_labels, import_scope,
        import_equals_scope, export_scope, expr_scope: _, private_class,
        private_names_outside_class_bodies, classes_of_private_names, free_idents, alias_idents,
        arguments_objects, identifiers_in_parameters, jsdoc_param_errors,
        names_resolved_for_arguments, flow, flow_edges, flow_shared, flow_depth,
        has_loop_types_that_depend_on_order, expr_kinds, expr_kind_counts, kind_counts,
        runtime: _,
    } = bound;

    let described_symbols: Vec<String> = symbols
        .iter()
        .take(symbol_count)
        .map(|symbol| describe_symbol(symbol, numbering))
        .collect();
    let mut described = vec![
        ("symbols", list_text(&described_symbols)),
        ("ids", list_text(&ids[..id_count])),
        ("scopes", describe_scopes(scopes, numbering)),
        ("tables", describe_tables(bound, numbering)),
        ("large_tables", describe_large_tables(bound, numbering)),
        (
            "computed_symbols",
            mapped_text(computed_symbols, |&(table, symbol)| {
                (numbering.table(table), symbol)
            }),
        ),
        (
            "fns",
            mapped_text(fns, |info| describe_fn(info, bound, numbering)),
        ),
        ("expr_scope", describe_expr_scope(bound, numbering)),
        (
            "this_in_type_literal",
            sorted_text(this_in_type_literal.iter()),
        ),
        ("property_symbol", sorted_text(property_symbol.iter())),
        ("private_class", sorted_text(private_class.iter())),
    ];

    let scope_list = |list: &[ScopeId]| mapped_text(list, |&scope| numbering.scope(scope));
    described.push((
        "stmt_scope",
        ids_text(stmt_scope, |scope| numbering.scope(scope)),
    ));
    let id_list = |list: &Narrow<'_, FlowId>| ids_text(list, |flow| flow);
    push_fields!(described, id_list: expr_flow, stmt_flow);
    described.push(("expr_symbol", ids_text(expr_symbol, |symbol| symbol)));
    push_fields!(described, scope_list: type_scope, member_scope, type_param_scope,
        class_scope, interface_scope, enum_scope, module_scope, alias_scope, import_scope,
        import_equals_scope, export_scope);

    described.push((
        "hoisted_vars",
        mapped_text(hoisted_vars, |&(pat, scope)| (pat, numbering.scope(scope))),
    ));
    let expr_scope_list = |list: &[(ExprId, ScopeId)]| {
        mapped_text(list, |&(expr, scope)| (expr, numbering.scope(scope)))
    };
    push_fields!(described, expr_scope_list: free_idents, alias_idents);
    described.push((
        "names_resolved_for_arguments",
        mapped_text(names_resolved_for_arguments, |&(node, scope, symbol)| {
            (node, numbering.scope(scope), symbol)
        }),
    ));

    push_fields!(described, scalar_text: ran_out_of_stack, is_unbound, file_symbol, commonjs_indicator,
        module_exports_property, flow_depth, has_loop_types_that_depend_on_order);
    push_fields!(described, list_text: entries, nested_names, export_stars, ambient_modules,
        pattern_ambient_modules, global_augmentations, redeclarations, umd_globals, specifiers,
        module_augmentations, ambient_specifiers, expr_parent, stmt_parent,
        type_by_alias, pat_parent, pat_symbol, prop_owner, member_symbol, member_owner, param_fn,
        type_param_symbol, requires_scope_change, fn_symbol, class_symbol, class_owner,
        interface_symbol, interface_contains_this, alias_symbol, enum_symbol, enum_member_symbol,
        enum_member_owner, module_symbol, module_instance_state, var_stmt, assignments,
        type_query_operands, unchecked_exprs, unchecked_types,
        infer_positions, expando_declarations, case_stmt, case_fallthrough,
        rejected_decorators, unused_labels, private_names_outside_class_bodies,
        classes_of_private_names, arguments_objects, identifiers_in_parameters,
        jsdoc_param_errors, flow, flow_edges, flow_shared, expr_kinds, expr_kind_counts,
        kind_counts);
    described
}

fn around_difference(text: &str, difference: usize) -> &str {
    let start = difference.saturating_sub(DIFFERENCE_CONTEXT);
    let end = (difference + DIFFERENCE_CONTEXT).min(text.len());
    text.get(start..end).unwrap_or(text)
}

fn assert_same_descriptions(
    path: &str,
    plain: &[(&'static str, String)],
    compiled: &[(&'static str, String)],
) {
    for ((field, plain), (_, compiled)) in plain.iter().zip(compiled) {
        let difference = plain
            .bytes()
            .zip(compiled.bytes())
            .position(|(a, b)| a != b)
            .unwrap_or(plain.len().min(compiled.len()));
        assert!(
            plain == compiled,
            "{path}: {field} differs\nfor `bun check`: {}\nfor `bun compile`: {}",
            around_difference(plain, difference),
            around_difference(compiled, difference),
        );
    }
}

fn bind_both<'s>(workspace: &Workspace<'s>, source: &Source<'_>) -> (Bound<'s>, Bound<'s>) {
    let mut hir = workspace.parse(source);
    let (compiled, _) = workspace.analyze_tree(&mut hir, source);
    (workspace.bind_for_check(&hir), compiled)
}

fn assert_same_tables(workspace: &Workspace<'_>, path: &str, text: &[u8]) {
    let source = Source::from_bytes(path, text);
    let (plain, compiled) = bind_both(workspace, &source);
    if plain.ran_out_of_stack || compiled.ran_out_of_stack {
        assert!(
            plain.ran_out_of_stack && compiled.ran_out_of_stack,
            "{path}: only one bind ran out of stack"
        );
        return;
    }

    assert!(
        plain
            .scopes
            .iter()
            .all(|scope| !is_runtime_scope(scope.kind)),
        "{path}: a bind for `bun check` has a run-time scope"
    );
    let symbol_count = plain.symbols.len();
    let id_count = plain.ids.len();
    assert!(
        compiled.symbols.len() >= symbol_count,
        "{path}: symbols were removed"
    );
    assert!(compiled.ids.len() >= id_count, "{path}: ids were removed");
    assert_same_descriptions(
        path,
        &describe(&plain, &Numbering::new(&plain), symbol_count, id_count),
        &describe(
            &compiled,
            &Numbering::new(&compiled),
            symbol_count,
            id_count,
        ),
    );
    for symbol in (0..compiled.symbols.len() as u32).map(SymbolId) {
        assert_eq!(
            compiled.is_appended_symbol(symbol),
            symbol.idx() >= symbol_count,
            "{path}: {symbol:?}"
        );
    }
}

fn field_text(bound: &Bound<'_>, field: &str) -> String {
    let numbering = Numbering::new(bound);
    let described = describe(bound, &numbering, bound.symbols.len(), bound.ids.len());
    let found = described.into_iter().find(|entry| entry.0 == field);
    found.unwrap().1
}

fn symbols_text(workspace: &Workspace<'_>, text: &str) -> String {
    let hir = workspace.parse(&Source::new("a.ts", text));
    field_text(&workspace.bind_for_check(&hir), "symbols")
}

#[test]
fn every_program() {
    for_each_program(&SOURCE_EXTENSIONS, assert_same_tables);
}

#[test]
fn scopes_are_renumbered() {
    const TEXT: &str =
        "with (o) { let x; } class C { f = () => x; static g = 1; [k] = 2; m() {} } { let y; }";
    with_workspace(|workspace| {
        assert_same_tables(workspace, "a.cjs", TEXT.as_bytes());
        let (plain, compiled) = bind_both(workspace, &Source::new("a.cjs", TEXT));
        assert_eq!(compiled.scopes.len(), plain.scopes.len() + 4);
        let kinds = || compiled.scopes.iter().map(|scope| scope.kind);
        let with_count = kinds()
            .filter(|kind| matches!(kind, ScopeKind::With(_)))
            .count();
        let initializer_count = kinds()
            .filter(|kind| matches!(kind, ScopeKind::FieldInitializer(_)))
            .count();
        assert_eq!(with_count, 1);
        assert_eq!(initializer_count, 3);
    });
}

#[test]
fn class_decorator_scopes_are_renumbered() {
    const TEXT: &str = "const D = @d(() => C) class C {}; @d(() => E) class E {} { let y; }";
    with_workspace(|workspace| {
        assert_same_tables(workspace, "a.ts", TEXT.as_bytes());
        let source = Source::new("a.ts", TEXT);
        let (plain, compiled) = bind_both(workspace, &source);
        assert_eq!(compiled.scopes.len(), plain.scopes.len() + 1);
        let decorated_class = |scope: &Scope| match scope.kind {
            ScopeKind::ClassDecorators(class) => Some(class),
            _ => None,
        };
        let decorated: Vec<ClassId> = compiled.scopes.iter().filter_map(decorated_class).collect();
        assert_eq!(decorated, [workspace.class(&workspace.parse(&source), "C")]);
    });
}

#[test]
fn implicit_block_scopes_are_renumbered() {
    const TEXT: &str = "if (a) function f() { let x; } else function g() {} { function h() {} } f;";
    with_workspace(|workspace| {
        assert_same_tables(workspace, "a.cjs", TEXT.as_bytes());
        let source = Source::new("a.cjs", TEXT);
        let (plain, compiled) = bind_both(workspace, &source);
        assert_eq!(compiled.scopes.len(), plain.scopes.len() + 2);
        let function_in_block = |scope: &Scope| match scope.kind {
            ScopeKind::ImplicitBlock(function) => Some(function),
            _ => None,
        };
        let functions: Vec<FnId> = compiled
            .scopes
            .iter()
            .filter_map(function_in_block)
            .collect();
        let hir = workspace.parse(&source);
        assert_eq!(
            functions,
            [workspace.function(&hir, "f"), workspace.function(&hir, "g")]
        );
    });
}

#[test]
fn with_declares_in_its_function() {
    const TEXT: &str = "function f() { with (a) var b = 1; with (a) { let c; } }";
    analyzed("a.cjs", TEXT, |file| {
        let plain = file.workspace.bind_for_check(&file.hir);
        assert!(plain.hoisted_vars.is_empty());
        assert!(file.bound.hoisted_vars.is_empty());
        let scope_kind = |symbol| file.bound.scopes[file.bound.symbol_scope(symbol).idx()].kind;
        assert_eq!(
            scope_kind(file.variable("b", 0)),
            ScopeKind::Fn(file.function("f"))
        );
        assert_eq!(scope_kind(file.variable("c", 0)), ScopeKind::Block);
    });
}

const WITH_BODY_DECLARATIONS: [(&str, &str, &str); 4] = [
    (
        "a.cjs",
        "{ const f = function () {}; with (o) f.a = 1; }",
        "expando_declarations",
    ),
    (
        "a.ts",
        "with (o) declare module \"m\" { import x = require(\"n\"); }",
        "ambient_specifiers",
    ),
    (
        "a.ts",
        "export {}; with (o) declare global { var q: number; }",
        "global_augmentations",
    ),
    ("a.ts", "with (o) import y = require(\"m\");", "specifiers"),
];

#[test]
fn with_body_declares_in_enclosing_scope() {
    with_workspace(|workspace| {
        for (path, text, field) in WITH_BODY_DECLARATIONS {
            assert_same_tables(workspace, path, text.as_bytes());
            let (plain, _) = bind_both(workspace, &Source::new(path, text));
            assert_ne!(field_text(&plain, field), "[]", "{path}: {text}");
        }
    });
}

#[test]
fn describe_sees_a_difference() {
    with_workspace(|workspace| {
        assert_ne!(
            symbols_text(workspace, "var a;"),
            symbols_text(workspace, "let a;")
        );
    });
}
