use bun_sema::atom::Atom;
use bun_sema::bind::{BindingKind, CodeUnit, CommonJsVariable, Decl, SymbolId};
use bun_sema::hir::{ModuleName, PatKind};

use super::{Probe, analyze_files, analyze_source};
use crate::ir::generated::FunctionFlags;
use crate::lower::captures::Capture;
use crate::lower::scope::testing::{function_named, with_runtime_dialect_input};
use crate::lower::scope::{
    ArgumentsObject, BindingForm, BindingRef, ScopeSlot, Storage, analyze_scopes,
};

fn symbols_with_name(probe: &Probe<'_, '_, '_>, name: Atom) -> Vec<SymbolId> {
    let symbols = (0..probe.bound.symbols.len() as u32).map(SymbolId);
    symbols
        .filter(|&symbol| probe.bound.symbol(symbol).name == name)
        .collect()
}

#[test]
fn type_only_is_not_a_value() {
    let main = "import { Unused } from './other'; interface Shape { a: number } \
                declare const ambient: number; namespace Types { export type T = number } \
                export {};";
    let files = [("main.ts", main), ("other.ts", "export const Unused = 1;")];
    analyze_files(&files, |probe| {
        let ModuleName::Ident(namespace) = probe.hir.modules[0].name else {
            panic!("the namespace has a name");
        };
        let PatKind::Ident(ambient) = probe.hir.pats[0].kind else {
            panic!("the ambient declaration has a name");
        };
        let import = probe.hir.import_specs[0].local;
        let interface = probe.hir.interfaces[0].name;
        for name in [import, interface, ambient, namespace] {
            let symbols = symbols_with_name(probe, name);
            assert!(!symbols.is_empty());
            for symbol in symbols {
                assert_eq!(probe.form(symbol), BindingForm::NotAValue);
                assert_eq!(probe.analysis.placement(BindingRef::Symbol(symbol)), None);
            }
        }
    });
}

#[test]
fn import_is_import() {
    let main = "import { value } from './other'; console.log(value);";
    let files = [("main.ts", main), ("other.ts", "export const value = 1;")];
    analyze_files(&files, |probe| {
        let symbol = probe.symbol("value");
        assert_eq!(probe.bound.binding_kind(symbol), BindingKind::Import);
        assert_eq!(probe.form(symbol), BindingForm::Import);
        assert_eq!(probe.analysis.placement(BindingRef::Symbol(symbol)), None);
        assert!(probe.bindings(probe.file_scope()).is_empty());
    });
}

#[test]
fn import_in_closure_is_no_capture() {
    let main = "import { value } from './other'; export function f() { return () => value; }";
    let files = [("main.ts", main), ("other.ts", "export const value = 1;")];
    analyze_files(&files, |probe| {
        assert!(probe.captures(probe.arrow()).is_empty());
    });
}

#[test]
fn import_equals_require_is_local() {
    let source = "import fs = require('node:fs'); console.log(fs);";
    analyze_source("main.ts", source, |probe| {
        let symbol = probe.symbol("fs");
        assert_eq!(probe.bound.binding_kind(symbol), BindingKind::Const);
        assert_eq!(probe.form(symbol), BindingForm::Stored);
        assert_eq!(probe.placement_of("fs").storage, Storage::Local);
    });
}

#[test]
fn type_import_merged_with_function_is_function() {
    let main = "import { type Merged } from './other'; function Merged() {} console.log(Merged);";
    let files = [
        ("main.ts", main),
        ("other.ts", "export interface Merged { a: number }"),
    ];
    analyze_files(&files, |probe| {
        let symbol = probe.symbol("Merged");
        assert_eq!(probe.bound.binding_kind(symbol), BindingKind::Function);
        assert_eq!(probe.form(symbol), BindingForm::Stored);
        assert_eq!(probe.placement_of("Merged").storage, Storage::Local);
    });
}

#[test]
fn function_expression_name_is_callee() {
    let own_use = "export const probe = function self() { return self; };";
    analyze_source("main.ts", own_use, |probe| {
        let function = probe.function("self");
        let callee = probe.slot(function, ScopeSlot::Callee);
        let placement = probe.placement(callee);
        assert_eq!(probe.form_of("self"), BindingForm::Callee { function });
        assert_eq!(probe.analysis.placement(probe.binding("self")), None);
        assert_eq!(placement.storage, Storage::Local);
        assert!(!placement.is_shared);
        assert_eq!(probe.bindings(probe.top_scope(function)), [callee]);
    });

    let use_in_arrow = "export const probe = function self() { return () => self; };";
    analyze_source("main.ts", use_in_arrow, |probe| {
        let callee = probe.slot(probe.function("self"), ScopeSlot::Callee);
        assert_eq!(probe.captures(probe.arrow()), [Capture::Value(callee)]);
        assert!(probe.placement(callee).is_shared);
    });

    let unused = "export const probe = function self() { return 1; };";
    analyze_source("main.ts", unused, |probe| {
        let callee = probe.slot(probe.function("self"), ScopeSlot::Callee);
        assert_eq!(probe.analysis.placement(callee), None);
    });
}

#[test]
fn mapped_argument_index_of_duplicate() {
    let sloppy = "function probe(twice, twice) { return arguments.length + twice; } \
                  module.exports = probe;";
    analyze_source("main.cjs", sloppy, |probe| {
        let function = probe.function("probe");
        let unit = CodeUnit::Function(function);
        let form = BindingForm::MappedArgument { unit, index: 1 };
        assert_eq!(probe.arguments_object(function), ArgumentsObject::Mapped);
        assert_eq!(probe.form_of("twice"), form);
        let callee = probe.placement(probe.slot(function, ScopeSlot::Callee));
        assert_eq!(callee.storage, Storage::Local);
    });

    let strict = "'use strict'; function probe(once) { return arguments.length + once; } \
                  module.exports = probe;";
    analyze_source("main.cjs", strict, |probe| {
        let function = probe.function("probe");
        assert_eq!(probe.arguments_object(function), ArgumentsObject::Unmapped);
        assert_eq!(probe.form_of("once"), BindingForm::Stored);
        let callee = probe.slot(function, ScopeSlot::Callee);
        assert_eq!(probe.analysis.placement(callee), None);
    });

    let unused = "function probe(once) { return once; } module.exports = probe;";
    analyze_source("main.cjs", unused, |probe| {
        let object = probe.arguments_object(probe.function("probe"));
        assert_eq!(object, ArgumentsObject::None);
        assert_eq!(probe.form_of("once"), BindingForm::Stored);
    });
}

#[test]
fn mapped_argument_in_closure_shares_arguments_object() {
    let source = "function probe(once) { return [arguments.length, () => once]; } \
                  module.exports = probe;";
    analyze_source("main.cjs", source, |probe| {
        let function = probe.function("probe");
        let unit = CodeUnit::Function(function);
        let form = BindingForm::MappedArgument { unit, index: 0 };
        let arguments = probe.slot(function, ScopeSlot::Arguments);
        assert_eq!(probe.form_of("once"), form);
        assert!(probe.placement(arguments).is_shared);
        assert_eq!(probe.captures(probe.arrow()), [Capture::Value(arguments)]);
        let bindings = [
            probe.slot(function, ScopeSlot::Callee),
            arguments,
            probe.slot(function, ScopeSlot::ArgumentsBinding),
        ];
        assert_eq!(probe.bindings(probe.top_scope(function)), bindings);
    });
}

#[test]
fn wrapper_arguments_object_by_mode() {
    let exports = ScopeSlot::CommonJs(CommonJsVariable::Exports);
    let source = "console.log(arguments.length, exports);";
    analyze_source("main.cjs", source, |probe| {
        let object = probe.analysis.arguments_object(CodeUnit::File);
        assert_eq!(object, ArgumentsObject::Mapped);
        let bindings = [
            probe.file_slot(ScopeSlot::Callee),
            probe.file_slot(ScopeSlot::Arguments),
            probe.file_slot(ScopeSlot::ArgumentsBinding),
        ];
        assert_eq!(probe.bindings(probe.file_scope()), bindings);
    });
    let strict = format!("'use strict'; {source}");
    analyze_source("main.cjs", &strict, |probe| {
        let object = probe.analysis.arguments_object(CodeUnit::File);
        assert_eq!(object, ArgumentsObject::Unmapped);
        let bindings = [
            probe.file_slot(ScopeSlot::Arguments),
            probe.file_slot(ScopeSlot::ArgumentsBinding),
            probe.file_slot(exports),
        ];
        assert_eq!(probe.bindings(probe.file_scope()), bindings);
    });
}

#[test]
fn only_commonjs_body_has_arguments_object() {
    let cases = [
        ("main.cjs", "console.log(exports);"),
        ("main.cjs", "if (false) arguments;"),
        ("main.cjs", "function f() { return arguments; } f();"),
        ("main.mjs", "console.log(typeof arguments);"),
    ];
    for (file, source) in cases {
        analyze_source(file, source, |probe| {
            let object = probe.analysis.arguments_object(CodeUnit::File);
            assert_eq!(object, ArgumentsObject::None, "{source}");
            let arguments = probe.file_slot(ScopeSlot::Arguments);
            assert_eq!(probe.analysis.placement(arguments), None);
        });
    }
}

#[test]
fn redeclared_wrapper_parameter_is_mapped_argument() {
    let unit = CodeUnit::File;
    analyze_source("main.cjs", "var module, exports; arguments;", |probe| {
        let module = BindingForm::MappedArgument { unit, index: 2 };
        let exports = BindingForm::MappedArgument { unit, index: 0 };
        assert_eq!(probe.form_of("module"), module);
        assert_eq!(probe.form_of("exports"), exports);
    });
    let source = "'use strict'; var module; arguments; module;";
    analyze_source("main.cjs", source, |probe| {
        assert_eq!(probe.form_of("module"), BindingForm::Stored);
    });
    analyze_source("main.cjs", "var module; module;", |probe| {
        assert_eq!(probe.form_of("module"), BindingForm::Stored);
    });
}

#[test]
fn wrapper_parameter_in_closure_shares_arguments_object() {
    let source = "arguments; module.exports = () => require;";
    analyze_source("main.cjs", source, |probe| {
        let arguments = probe.file_slot(ScopeSlot::Arguments);
        assert!(probe.placement(arguments).is_shared);
        assert_eq!(probe.captures(probe.arrow()), [Capture::Value(arguments)]);
    });
    let source = "module.exports = () => arguments;";
    analyze_source("main.cjs", source, |probe| {
        let binding = probe.file_slot(ScopeSlot::ArgumentsBinding);
        assert_eq!(probe.captures(probe.arrow()), [Capture::Value(binding)]);
    });
}

#[test]
fn arguments_object_needs_simple_parameters_to_be_mapped() {
    for parameters in ["...rest", "{ a }", "a = 1"] {
        let source =
            format!("function probe({parameters}) {{ return arguments; }} module.exports = probe;");
        analyze_source("main.cjs", &source, |probe| {
            let object = probe.arguments_object(probe.function("probe"));
            assert_eq!(object, ArgumentsObject::Unmapped, "{parameters}");
        });
    }
}

#[test]
fn dead_arguments_mention_asks_for_nothing() {
    let dead = "export function f() { if (false) arguments; }";
    analyze_source("main.mjs", dead, |probe| {
        let function = probe.function("f");
        assert_eq!(probe.arguments_object(function), ArgumentsObject::None);
        assert!(probe.entry_flags(probe.key(function)).is_empty());
    });
    let live = "export function f() { if (true) arguments; }";
    analyze_source("main.mjs", live, |probe| {
        let object = probe.arguments_object(probe.function("f"));
        assert_eq!(object, ArgumentsObject::Unmapped);
    });
}

#[test]
fn argument_intrinsics_need_no_arguments_object() {
    let entry = |source: &str| {
        with_runtime_dialect_input(&[("main.mjs", source)], |input| {
            let unit = CodeUnit::Function(function_named(input.hir, "f"));
            let scopes = analyze_scopes(input);
            assert_eq!(scopes.arguments_object(unit), ArgumentsObject::None);
            let key = scopes.function_key(unit);
            (scopes.entry_flags(key), scopes.undeclared_parameters(key))
        })
    };
    let none = FunctionFlags::default();
    let count = entry("export function f() { return $argumentCount(); }");
    assert_eq!(count, (FunctionFlags::HAS_ARGUMENT_COUNT, 0));
    let undeclared_parameters = [
        ("export function f() { return $argument(1); }", 2),
        (
            "export function f(a) { return $argument(2) + $argument(1); }",
            2,
        ),
        ("export function f(a, b) { return $argument(1); }", 0),
        ("export function f(...a) { return $argument(1); }", 0),
        ("export function f(x) { return $isObject(x); }", 0),
    ];
    for (source, count) in undeclared_parameters {
        assert_eq!(entry(source), (none, count), "{source}");
    }
}

#[test]
fn implicit_block_binding_is_stored() {
    let stored = "function probe(a) { if (a) function f() { f = 1; return f; } return f; } \
                  module.exports = probe;";
    analyze_source("main.cjs", stored, |probe| {
        let function = probe.function("f");
        let symbol = probe.bound.declared_symbol(Decl::Fn(function));
        let scope = probe.bound.symbol_scope(symbol);
        let binding = BindingRef::Symbol(symbol);
        assert_eq!(probe.form(symbol), BindingForm::Stored);
        assert_eq!(probe.bindings(scope), [binding]);
        assert_eq!(probe.hoisted_functions(scope), [(symbol, function)]);
        let placement = probe.placement(binding);
        assert_eq!(placement.storage, Storage::Field { scope, field: 0 });
        assert!(!placement.is_immutable && !placement.has_local);
        assert_eq!(probe.captures(function), [Capture::Environment(scope)]);
    });
    let expression = "module.exports = function f() { f = 1; return f; };";
    analyze_source("main.cjs", expression, |probe| {
        let function = probe.function("f");
        let symbol = probe.bound.declared_symbol(Decl::Fn(function));
        assert_eq!(probe.form(symbol), BindingForm::Callee { function });
    });
}

#[test]
fn merged_redeclaration_is_one_binding() {
    let source = "function probe() { var twice = 1; function twice() {} return twice; } \
                  module.exports = probe;";
    analyze_source("main.cjs", source, |probe| {
        let symbol = probe.symbol("twice");
        let top = probe.top_of("probe");
        let function = probe.function("twice");
        assert_eq!(probe.bound.declared_symbol(Decl::Fn(function)), symbol);
        assert_eq!(probe.bindings(top), [BindingRef::Symbol(symbol)]);
        assert_eq!(probe.hoisted_functions(top), [(symbol, function)]);
        assert!(!probe.placement_of("twice").is_immutable);
    });
}

#[test]
fn enum_member_is_container_member() {
    let source = "enum Level { Low = Math.random(), High = Low + 1 } \
                  console.log(Level); export {};";
    analyze_source("main.ts", source, |probe| {
        let container = probe.symbol("Level");
        let form = BindingForm::ContainerMember { container };
        assert_eq!(probe.form_of("Low"), form);
        assert_eq!(
            probe.bound.binding_kind(container),
            BindingKind::TypeScriptContainer
        );
        assert_eq!(probe.form(container), BindingForm::Stored);
    });
}
