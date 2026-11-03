use bun_sema::bind::{CommonJsVariable, Decl};
use bun_sema::hir::{FnId, FnKind};
use bun_sema::program::Sym;

use super::super::Context;
use super::super::storage::find_initial_functions;
use super::{COPIED, Probe, analyze_source, is_field, storage_in};
use crate::ir::VariableKey;
use crate::lower::captures::{Capture, CaptureList, CapturePlan};
use crate::lower::scope::testing::{functions_of_kind, walk_scopes, with_scope_input};
use crate::lower::scope::{BindingRef, Placement, ScopeSlot, Storage};

const MODULE: ScopeSlot = ScopeSlot::CommonJs(CommonJsVariable::Module);

fn is_symbol(binding: &BindingRef) -> bool {
    match binding {
        BindingRef::Symbol(_) => true,
        BindingRef::Slot(..) => false,
    }
}

fn symbol_variable(probe: &Probe<'_, '_, '_>, name: &str) -> Storage {
    Storage::Variable(VariableKey::Symbol(Sym {
        file: probe.analysis.file,
        id: probe.symbol(name),
    }))
}

#[test]
fn shared_at_top_level_is_module_variable() {
    let source = "let a = 1; export function f() { return a; }";
    analyze_source("main.ts", source, |probe| {
        let placement = probe.placement_of("a");
        assert_eq!(placement.storage, symbol_variable(probe, "a"));
        assert!(placement.is_shared);
        assert!(probe.captures_of("f").is_empty());
        assert!(!probe.has_environment(probe.file_scope()));
    });
}

#[test]
fn unshared_top_level_binding_is_local() {
    let source = "let a = 1; console.log(a); export {};";
    analyze_source("main.ts", source, |probe| {
        let placement = probe.placement_of("a");
        assert_eq!(placement.storage, Storage::Local);
        assert!(!placement.is_shared);
    });
}

#[test]
fn commonjs_top_level_binding_is_captured() {
    let immutable = "let a = 1; module.exports = function f() { return a; };";
    analyze_source("main.cjs", immutable, |probe| {
        assert_eq!(probe.placement_of("a").storage, Storage::Local);
        assert_eq!(probe.captures_of("f"), [probe.copy_of("a")]);
    });
    let stored = "let a = 1; module.exports = function f() { return a; }; a = 2;";
    analyze_source("main.cjs", stored, |probe| {
        let scope = probe.file_scope();
        let field = Storage::Field { scope, field: 0 };
        assert_eq!(probe.placement_of("a").storage, field);
        assert_eq!(probe.captures_of("f"), [Capture::Environment(scope)]);
    });
}

#[test]
fn commonjs_hoisted_function_takes_the_environment() {
    let source = "const a = 1; function f() { return a; } module.exports = f;";
    analyze_source("main.cjs", source, |probe| {
        let scope = probe.file_scope();
        assert_eq!(probe.captures_of("f"), [Capture::Environment(scope)]);
        assert_eq!(probe.environment_fields(scope), [probe.binding("a")]);
    });
}

#[test]
fn immutable_module_variable_keeps_local() {
    let immutable = "const a = Math.random(); export const g = () => a;";
    analyze_source("main.ts", immutable, |probe| {
        let expected = Placement {
            storage: symbol_variable(probe, "a"),
            has_local: true,
            is_immutable: true,
            is_shared: true,
        };
        assert_eq!(probe.placement_of("a"), expected);
    });
    let stored = "let a = Math.random(); export const g = () => a; a = 2;";
    analyze_source("main.ts", stored, |probe| {
        let placement = probe.placement_of("a");
        assert_eq!(placement.storage, symbol_variable(probe, "a"));
        assert!(!placement.has_local && !placement.is_immutable);
    });
}

#[test]
fn top_level_binding_in_loop_is_not_a_variable() {
    let source = "export const list = []; for (const x of [1]) list.push(() => x);";
    analyze_source("main.js", source, |probe| {
        assert_eq!(probe.placement_of("x").storage, Storage::Local);
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("x")]);
    });
    let stored = "export const list = []; for (let x of [1]) { list.push(() => x); x = 2; }";
    assert!(is_field(storage_in("main.js", stored, "x")));
}

#[test]
fn top_level_block_binding_is_a_variable() {
    let source = "export let read; { let a = 1; read = () => a; }";
    analyze_source("main.js", source, |probe| {
        assert_eq!(probe.placement_of("a").storage, symbol_variable(probe, "a"));
        assert!(probe.captures(probe.arrow()).is_empty());
    });
}

#[test]
fn exported_is_module_variable() {
    let source = "export let a = 1; console.log(a);";
    analyze_source("main.ts", source, |probe| {
        let placement = probe.placement_of("a");
        assert_eq!(placement.storage, symbol_variable(probe, "a"));
        assert!(placement.is_shared);
    });
    let renamed = "let a = 1; console.log(a); export { a as b };";
    analyze_source("main.ts", renamed, |probe| {
        assert_eq!(probe.placement_of("a").storage, symbol_variable(probe, "a"));
    });
}

#[test]
fn unused_export_is_module_variable() {
    analyze_source("main.ts", "export let a = 1;", |probe| {
        let placement = probe.placement_of("a");
        assert_eq!(placement.storage, symbol_variable(probe, "a"));
        assert!(placement.is_shared);
        assert_eq!(probe.bindings(probe.file_scope()), [probe.binding("a")]);
    });
}

#[test]
fn initial_function_of_module_variable() {
    let module = "export function probe() { return helper(); } function helper() { return 1; }";
    analyze_source("main.ts", module, |probe| {
        for name in ["probe", "helper"] {
            let function = probe.function(name);
            let symbol = probe.bound.declared_symbol(Decl::Fn(function));
            let placement = probe.placement(BindingRef::Symbol(symbol));
            assert_eq!(placement.storage, symbol_variable(probe, name), "{name}");
            assert!(!placement.has_local, "{name}");
            assert_eq!(probe.initial_function(symbol), Some(function), "{name}");
        }
    });

    let unshared = "function helper() { return 1; } console.log(helper()); export {};";
    analyze_source("main.ts", unshared, |probe| {
        assert_eq!(probe.placement_of("helper").storage, Storage::Local);
        assert_eq!(probe.initial_function(probe.symbol("helper")), None);
    });
}

#[test]
fn commonjs_function_is_not_initial() {
    let source = "function helper() { return 1; } module.exports = () => helper();";
    analyze_source("main.cjs", source, |probe| {
        assert_eq!(probe.placement_of("helper").storage, Storage::Local);
        assert_eq!(probe.initial_function(probe.symbol("helper")), None);
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("helper")]);
    });
}

#[test]
fn function_in_block_is_not_initial() {
    let source = "export let read; { function helper() { return 1; } read = () => helper(); }";
    analyze_source("main.js", source, |probe| {
        assert_eq!(
            probe.placement_of("helper").storage,
            symbol_variable(probe, "helper")
        );
        assert_eq!(probe.initial_function(probe.symbol("helper")), None);
    });
}

#[test]
fn function_with_captures_is_not_initial() {
    let source = "export function first() {} export function second() {}";
    with_scope_input(&[("main.mjs", source)], |input| {
        let walk = walk_scopes(input);
        let context = Context::new(input, &walk);
        let [first, second] = functions_of_kind(input.hir, FnKind::Decl)[..] else {
            panic!("the source declares two functions");
        };
        let symbol_of = |function: FnId| input.bound.declared_symbol(Decl::Fn(function));
        let variable_of = |function: FnId| {
            let (file, id) = (input.file, symbol_of(function));
            (
                BindingRef::Symbol(id),
                VariableKey::Symbol(Sym { file, id }),
            )
        };
        let mut variables = [variable_of(first), variable_of(second)];
        variables.sort_unstable();
        let mut plan = CapturePlan {
            captures: vec![CaptureList::new(); walk.functions.len()],
            fields: Vec::new(),
            functions_over_limit: Vec::new(),
        };
        let mut both = [(symbol_of(first), first), (symbol_of(second), second)];
        both.sort_unstable();
        assert_eq!(find_initial_functions(&context, &variables, &plan), both);

        let walked = walk.function_of_fn[first.idx()].expect("the function is live");
        plan.captures[walked.index()].push(Capture::Environment(context.file_scope));
        let without_captures = [(symbol_of(second), second)];
        assert_eq!(
            find_initial_functions(&context, &variables, &plan),
            without_captures
        );
    });
}

#[test]
fn commonjs_name_is_no_binding_without_wrapper_parameters() {
    for source in [
        "function f() { return module; } f();",
        "function f() { return [require, exports, __filename, __dirname]; } f();",
        "module.exports = 1;",
        "exports = module.exports = function f() { return exports; };",
    ] {
        analyze_source("main.cjs", source, |probe| {
            assert!(!probe.has_wrapper_parameters(), "{source}");
            assert!(
                probe.bindings(probe.file_scope()).iter().all(is_symbol),
                "{source}"
            );
            for kind in [FnKind::Decl, FnKind::Expr] {
                for function in probe.functions(kind) {
                    assert!(probe.captures(function).is_empty(), "{source}");
                }
            }
        });
    }
}

#[test]
fn text_that_needs_the_five_parameters_keeps_them() {
    for source in [
        "arguments;",
        "var exports;",
        "var text = ''; eval(text);",
        "with (exports) {}",
        "exports = {};",
        "module = null;",
        "require = null;",
        "__filename = '';",
        "function f() { __dirname = ''; } f();",
    ] {
        analyze_source("main.cjs", source, |probe| {
            assert!(probe.has_wrapper_parameters(), "{source}");
        });
    }
    analyze_source("main.mjs", "console.log(typeof arguments);", |probe| {
        assert!(!probe.has_wrapper_parameters());
    });
}

#[test]
fn commonjs_slot_is_captured_when_shared() {
    let shared = "'use strict'; arguments; function f() { return module; } f();";
    analyze_source("main.cjs", shared, |probe| {
        let module = BindingRef::Slot(probe.file_scope(), MODULE);
        assert_eq!(probe.placement(module), COPIED);
        assert_eq!(probe.captures_of("f"), [Capture::Value(module)]);
    });

    let unshared = "'use strict'; arguments; module.exports = 1;";
    analyze_source("main.cjs", unshared, |probe| {
        let placement = probe.placement(BindingRef::Slot(probe.file_scope(), MODULE));
        assert_eq!(placement.storage, Storage::Local);
        assert!(!placement.is_shared);
    });

    let stored = "function f() { return module; } module = f;";
    analyze_source("main.cjs", stored, |probe| {
        let scope = probe.file_scope();
        let placement = probe.placement(BindingRef::Slot(scope, MODULE));
        assert_eq!(placement.storage, Storage::Field { scope, field: 0 });
        assert_eq!(probe.captures_of("f"), [Capture::Environment(scope)]);
    });
}

#[test]
fn unmentioned_commonjs_slot_has_no_placement() {
    analyze_source("main.cjs", "exports.a = 1;", |probe| {
        let module = BindingRef::Slot(probe.file_scope(), MODULE);
        assert_eq!(probe.analysis.placement(module), None);
    });
}
