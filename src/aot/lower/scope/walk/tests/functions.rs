use bun_sema::bind::Decl;
use bun_sema::hir::{FnKind, StmtKind};

use super::{
    created_at, creator_of, has_symbol_use, has_use, hoisted_to, initialized_at, slots_used_by,
    used_slots, walked, with_walk,
};
use crate::ir::FunctionKey;
use crate::lower::scope::testing::{
    file_scope, first_statement, function_named, functions_of_kind, only_function, symbol_named,
    top_scope, walk_scopes, with_runtime_dialect_input,
};
use crate::lower::scope::walk::ArgumentRead;
use crate::lower::scope::{BindingRef, Initialization, ScopeSlot, WalkedFunctionId};

const CLASSIC_JSX: &str = r#"{"compilerOptions":{"jsx":"react","jsxFactory":"h"}}"#;

#[test]
fn hoisted_functions_last_wins() {
    let source = "function f() { return 1; } function f() { return 2; } f();";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let functions = functions_of_kind(hir, FnKind::Decl);
        let [first, last] = functions[..] else {
            panic!("the source declares two functions");
        };
        let symbol = bound.declared_symbol(Decl::Fn(last));
        assert_eq!(bound.declared_symbol(Decl::Fn(first)), symbol);
        assert_eq!(
            walk.hoisted_functions,
            [(file_scope(hir, bound), symbol, last)]
        );
    });
}

#[test]
fn implicit_block_function_is_hoisted_to_its_block() {
    let source = "var a = 1; if (a) function f() {}";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let function = only_function(hir, FnKind::Decl);
        let symbol = bound.declared_symbol(Decl::Fn(function));
        let statement = first_statement(hir, |kind| matches!(kind, StmtKind::Fn(_)));
        let scope = bound.own_scope(statement);
        assert_ne!(scope, file_scope(hir, bound));
        assert_eq!(walk.hoisted_functions, [(scope, symbol, function)]);
        assert_eq!(hoisted_to(walk, function), Some(scope));
        assert!(!walk.is_repeated_scope[scope.idx()]);
    });
    let repeated = "for (var i = 0; i < 2; i++) if (i) function f() {}";
    with_walk(&[("main.cjs", repeated)], |hir, bound, walk| {
        let statement = first_statement(hir, |kind| matches!(kind, StmtKind::Fn(_)));
        assert!(walk.is_repeated_scope[bound.own_scope(statement).idx()]);
    });
}

#[test]
fn hoisted_function_names_its_scope() {
    let source = "export {}; { function f() {} f(); }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let function = only_function(hir, FnKind::Decl);
        let symbol = bound.declared_symbol(Decl::Fn(function));
        let block = first_statement(hir, |kind| matches!(kind, StmtKind::Block(_)));
        let scope = bound.own_scope(block);
        assert_eq!(hoisted_to(walk, function), Some(scope));
        assert_eq!(walk.hoisted_functions, [(scope, symbol, function)]);
        assert_eq!(
            walk.symbol_initializations[symbol.idx()],
            Some(Initialization::WITH_HOISTED_FUNCTIONS)
        );
    });
}

#[test]
fn function_expression_is_not_hoisted() {
    let source = "export const f = function g() {};";
    with_walk(&[("main.mjs", source)], |hir, _, walk| {
        let function = only_function(hir, FnKind::Expr);
        assert!(walk.hoisted_functions.is_empty());
        assert_eq!(hoisted_to(walk, function), None);
    });
}

#[test]
fn parameter_precedes_hoisted_functions() {
    let source = "export function f(a) { const b = a; function g() { return a + b; } return g; }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let initialization = |name: &str| {
            let initialization = walk.symbol_initializations[symbol_named(hir, bound, name).idx()];
            initialization.expect("the walk met the initialization")
        };
        assert!(initialization("a").precedes_hoisted_functions);
        assert!(!initialization("b").precedes_hoisted_functions);
        assert!(initialization("a").time < initialization("b").time);
    });
}

#[test]
fn function_follows_creator() {
    let source = "function outer() { return class { m() { return () => 1; } }; } outer();";
    with_walk(&[("main.ts", source)], |hir, _, walk| {
        for (id, function) in (0..).map(WalkedFunctionId).zip(&walk.functions) {
            match function.creator {
                Some(creator) => assert!(creator < id, "{id:?}"),
                None => assert_eq!(id, WalkedFunctionId::MODULE_BODY),
            }
        }
        let outer = walked(walk, only_function(hir, FnKind::Decl));
        let method = walked(walk, only_function(hir, FnKind::Method));
        let arrow = walked(walk, only_function(hir, FnKind::Arrow));
        assert_eq!(creator_of(walk, outer), Some(WalkedFunctionId::MODULE_BODY));
        assert_eq!(creator_of(walk, method), Some(outer));
        assert_eq!(creator_of(walk, arrow), Some(method));
    });
}

#[test]
fn module_body_is_first_function() {
    with_walk(&[("main.mjs", "export {};")], |_, _, walk| {
        assert_eq!(walk.functions.len(), 1);
        assert!(matches!(walk.functions[0].key, FunctionKey::ModuleBody(_)));
        assert_eq!(created_at(walk, WalkedFunctionId::MODULE_BODY), 0);
    });
}

#[test]
fn creation_follows_initialization() {
    let is_initialized_first = |source: &str| {
        with_walk(&[("main.mjs", source)], |hir, bound, walk| {
            let arrow = walked(walk, only_function(hir, FnKind::Arrow));
            initialized_at(walk, symbol_named(hir, bound, "a")) < created_at(walk, arrow)
        })
    };
    assert!(is_initialized_first(
        "const a = 1; export const f = () => a;"
    ));
    assert!(!is_initialized_first(
        "export const f = () => a; const a = 1;"
    ));
}

#[test]
fn pattern_names_follow_defaults() {
    let source = "export function g(o) { const { a = () => b, b } = o; return a; }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let arrow = created_at(walk, walked(walk, only_function(hir, FnKind::Arrow)));
        assert!(arrow < initialized_at(walk, symbol_named(hir, bound, "a")));
        assert!(arrow < initialized_at(walk, symbol_named(hir, bound, "b")));
    });
}

#[test]
fn declaration_is_initialized_after_its_initializer() {
    let source = "export function g(make) { const a = make(() => a); return a; }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let arrow = created_at(walk, walked(walk, only_function(hir, FnKind::Arrow)));
        assert!(arrow < initialized_at(walk, symbol_named(hir, bound, "a")));
    });
}

#[test]
fn variable_without_initializer_is_never_initialized() {
    let source = "export function g() { var a; var b = 1; return [a, b]; }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let initialization =
            |name: &str| walk.symbol_initializations[symbol_named(hir, bound, name).idx()];
        assert_eq!(initialization("a"), None);
        assert!(initialization("b").is_some());
    });
}

#[test]
fn arguments_store_is_recorded() {
    let stores = [
        "arguments = 7;",
        "var arguments = 7;",
        "arguments++;",
        "[arguments] = [i];",
        "({ a: arguments } = { a: i });",
        "for (arguments of [i]) {}",
    ];
    for store in stores {
        let source = format!(
            "function f() {{ for (var i = 0; i < 2; i++) {{ {store} }} return arguments; }}"
        );
        with_walk(&[("main.cjs", source.as_str())], |hir, bound, walk| {
            let scope = top_scope(bound, only_function(hir, FnKind::Decl));
            let binding = BindingRef::Slot(scope, ScopeSlot::ArgumentsBinding);
            assert_eq!(
                walk.stored_slots,
                [(scope, ScopeSlot::ArgumentsBinding)],
                "{store}"
            );
            assert!(walk.loops[0].stored.contains(&binding), "{store}");
        });
    }
    let read = "function f() { for (var i = 0; i < arguments.length; i++) { arguments[i] = i; } }";
    with_walk(&[("main.cjs", read)], |_, _, walk| {
        assert!(walk.stored_slots.is_empty());
    });
}

#[test]
fn arguments_object_is_used_by_owner() {
    let source = "function f() { return () => arguments; }";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let function = only_function(hir, FnKind::Decl);
        let scope = top_scope(bound, function);
        let arrow = walked(walk, only_function(hir, FnKind::Arrow));
        assert_eq!(
            slots_used_by(walk, arrow),
            [(scope, ScopeSlot::ArgumentsBinding)]
        );
        assert_eq!(
            slots_used_by(walk, walked(walk, function)),
            [(scope, ScopeSlot::Arguments)]
        );
    });
}

#[test]
fn wrapper_arguments_object_is_used_by_module_body() {
    let source = "module.exports = () => arguments;";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let scope = file_scope(hir, bound);
        let arrow = walked(walk, only_function(hir, FnKind::Arrow));
        assert_eq!(
            slots_used_by(walk, arrow),
            [(scope, ScopeSlot::ArgumentsBinding)]
        );
        let arguments = BindingRef::Slot(scope, ScopeSlot::Arguments);
        assert!(has_use(walk, WalkedFunctionId::MODULE_BODY, arguments));
        assert!(walk.stored_slots.is_empty());
    });
    with_walk(&[("main.cjs", "arguments = 1;")], |hir, bound, walk| {
        assert_eq!(
            walk.stored_slots,
            [(file_scope(hir, bound), ScopeSlot::ArgumentsBinding)]
        );
    });
    let source = "export default () => typeof arguments;";
    with_walk(&[("main.mjs", source)], |_, _, walk| {
        assert!(used_slots(walk).is_empty());
    });
}

#[test]
fn lexical_slots_belong_to_the_enclosing_function() {
    let source = "export function f() { return () => [this, new.target]; }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let scope = top_scope(bound, only_function(hir, FnKind::Decl));
        let arrow = walked(walk, only_function(hir, FnKind::Arrow));
        let expected = [(scope, ScopeSlot::This), (scope, ScopeSlot::NewTarget)];
        assert_eq!(slots_used_by(walk, arrow), expected);
    });
}

#[test]
fn this_at_top_level_is_a_slot_of_commonjs_only() {
    let uses_this = |file: &str, source: &str| {
        with_walk(&[(file, source)], |hir, bound, walk| {
            let this = BindingRef::Slot(file_scope(hir, bound), ScopeSlot::This);
            has_use(walk, WalkedFunctionId::MODULE_BODY, this)
        })
    };
    assert!(uses_this("main.cjs", "this.a = 1;"));
    assert!(!uses_this("main.mjs", "this; export {};"));
}

#[test]
fn method_has_no_new_target_slot() {
    let source = "export const o = { m() { return new.target; } };";
    with_walk(&[("main.mjs", source)], |hir, _, walk| {
        let method = walked(walk, only_function(hir, FnKind::Method));
        assert!(slots_used_by(walk, method).is_empty());
    });
}

fn argument_reads_in_runtime_dialect(source: &str) -> Vec<ArgumentRead> {
    with_runtime_dialect_input(&[("main.mjs", source)], |input| {
        let walk = walk_scopes(input);
        let function = walked(&walk, function_named(input.hir, "f"));
        assert!(slots_used_by(&walk, function).is_empty());
        let reads = walk.argument_reads.iter();
        reads
            .filter(|read| read.0 == function)
            .map(|read| read.1)
            .collect()
    })
}

#[test]
fn argument_intrinsics_are_recorded_without_arguments_slot() {
    let count = "export function f() { return $argumentCount(); }";
    assert_eq!(
        argument_reads_in_runtime_dialect(count),
        [ArgumentRead::Count]
    );
    let argument = "export function f() { return $argument(1); }";
    assert_eq!(
        argument_reads_in_runtime_dialect(argument),
        [ArgumentRead::At(1)]
    );
    let computed = "export function f(x) { return $argument(x); }";
    assert!(argument_reads_in_runtime_dialect(computed).is_empty());
    let inner = "export function f() { return () => $argument(1); }";
    assert!(argument_reads_in_runtime_dialect(inner).is_empty());
    let dead = "export function f() { if (false) $argument(1); }";
    assert!(argument_reads_in_runtime_dialect(dead).is_empty());

    with_walk(&[("main.mjs", count)], |_, _, walk| {
        assert!(walk.argument_reads.is_empty())
    });
}

#[test]
fn jsx_factory_is_used_by_enclosing_function() {
    let is_used_by_arrow = |source: &str| {
        let files = [("main.jsx", source), ("tsconfig.json", CLASSIC_JSX)];
        with_walk(&files, |hir, bound, walk| {
            let factory = symbol_named(hir, bound, "h");
            let arrow = walked(walk, only_function(hir, FnKind::Arrow));
            let function = walked(walk, only_function(hir, FnKind::Decl));
            let is_used_by_arrow = has_symbol_use(walk, arrow, factory);
            assert_ne!(has_symbol_use(walk, function, factory), is_used_by_arrow);
            is_used_by_arrow
        })
    };
    assert!(is_used_by_arrow(
        "export function f(h) { return () => <a />; }"
    ));
    assert!(!is_used_by_arrow(
        "export function f(h) { <a />; return () => 1; }"
    ));
}

#[test]
fn metadata_type_is_used_by_evaluating_function() {
    let source = "declare const d: any; export function f() { class T {} \
        return () => { class C { @d x: T = null!; } return C; }; }";
    let is_used_by_arrow = |emits_decorator_metadata: bool| {
        let metadata = format!(r#""emitDecoratorMetadata":{emits_decorator_metadata}"#);
        let configuration =
            format!(r#"{{"compilerOptions":{{"experimentalDecorators":true,{metadata}}}}}"#);
        let files = [
            ("main.ts", source),
            ("tsconfig.json", configuration.as_str()),
        ];
        with_walk(&files, |hir, bound, walk| {
            let arrow = walked(walk, only_function(hir, FnKind::Arrow));
            has_symbol_use(walk, arrow, symbol_named(hir, bound, "T"))
        })
    };
    assert!(is_used_by_arrow(true));
    assert!(!is_used_by_arrow(false));
}
