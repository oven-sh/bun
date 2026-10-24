use bun_sema::bind::{CodeUnit, CommonJsVariable, ScopeId, SymbolId};
use bun_sema::hir::{ClassId, Flags, FnId, FnKind, MemberId, StmtKind};

use super::{analyze_source, is_field};
use crate::ir::FunctionKey;
use crate::ir::generated::FunctionFlags;
use crate::lower::scope::analysis::{GroupedList, find_by_key};
use crate::lower::scope::lexical_owners::compute_lexical_owners;
use crate::lower::scope::testing::{source_key, with_scope_input};
use crate::lower::scope::{
    ArgumentsObject, BindingForm, BindingRef, ScopeSlot, Storage, analyze_scopes,
};

const EXPORTS: ScopeSlot = ScopeSlot::CommonJs(CommonJsVariable::Exports);

fn is_loop(kind: &StmtKind) -> bool {
    matches!(kind, StmtKind::While { .. } | StmtKind::For { .. })
}

#[test]
fn function_key_of_each_unit() {
    let source = "function f() {} const a = () => 1; \
        class C { x = 1; static y = 2; static { f(); } } new C(); a();";
    analyze_source("main.ts", source, |probe| {
        let (analysis, file) = (probe.analysis, probe.analysis.file);
        assert_eq!(
            analysis.function_key(CodeUnit::File),
            FunctionKey::ModuleBody(file)
        );
        for kind in [FnKind::Decl, FnKind::Arrow, FnKind::StaticBlock] {
            let function = probe.only_function(kind);
            assert_eq!(probe.key(function), source_key(file, function));
        }
        let members: Vec<MemberId> = probe.hir[ClassId(0)].members.iter().collect();
        let instance_initializer = FunctionKey::InstanceInitializer(probe.class(0));
        let static_initializer = FunctionKey::StaticInitializer(probe.class(0));
        let key = analysis.function_key(CodeUnit::FieldInitializer(members[0]));
        assert_eq!(key, instance_initializer);
        let key = analysis.function_key(CodeUnit::FieldInitializer(members[1]));
        assert_eq!(key, static_initializer);
    });
}

#[test]
fn arrow_inherits_lexical_owner() {
    let in_function = "export function probe() { return () => { { return this; } }; }";
    analyze_source("main.js", in_function, |probe| {
        let top = probe.top_of("probe");
        let arrow = probe.top_scope(probe.arrow());
        let block = probe.first_statement(|kind| matches!(kind, StmtKind::Block(_)));
        assert_eq!(probe.lexical_owner(top), top);
        assert_eq!(probe.lexical_owner(arrow), top);
        assert_eq!(probe.lexical_owner(probe.bound.own_scope(block)), top);
        assert_eq!(probe.lexical_owner(probe.file_scope()), probe.file_scope());
    });

    let in_field = "export class Box { field = () => this; }";
    analyze_source("main.ts", in_field, |probe| {
        let initializer = probe.bound.field_initializer_scope(MemberId(0));
        let initializer = initializer.expect("the field has an initializer");
        let arrow = probe.top_scope(probe.arrow());
        assert_eq!(probe.lexical_owner(initializer), initializer);
        assert_eq!(probe.lexical_owner(arrow), initializer);
    });
}

#[test]
fn function_expression_is_its_own_lexical_owner() {
    let source = "export function probe() { return function () { return this; }; }";
    analyze_source("main.js", source, |probe| {
        let inner = probe.top_scope(probe.only_function(FnKind::Expr));
        assert_eq!(probe.lexical_owner(inner), inner);
    });
}

#[test]
fn lexical_owners_need_no_walk() {
    let source = "export class Box { static { const read = () => this; read(); } }";
    analyze_source("main.ts", source, |probe| {
        let owners = compute_lexical_owners(probe.hir, probe.bound);
        assert_eq!(owners.len(), probe.bound.scopes.len());
        for (scope, &owner) in (0..).map(ScopeId).zip(&owners) {
            assert_eq!(probe.lexical_owner(scope), owner);
        }
        let block = probe.top_scope(probe.only_function(FnKind::StaticBlock));
        let arrow = probe.top_scope(probe.arrow());
        assert_eq!(owners[block.idx()], block);
        assert_eq!(owners[arrow.idx()], block);
    });
}

#[test]
fn field_order_is_binding_order() {
    let source = "function probe() { let second = 2; let first = 1; \
        const read = () => [first, second, arguments]; \
        first = 3; second = 4; arguments = 5; return read; } module.exports = probe;";
    analyze_source("main.cjs", source, |probe| {
        let function = probe.function("probe");
        let scope = probe.top_scope(function);
        let fields = probe.environment_fields(scope);
        assert_eq!(fields.len(), 3);
        assert!(fields.is_sorted_by(|earlier, later| earlier < later));
        assert!(fields.contains(&probe.binding("first")));
        assert!(fields.contains(&probe.binding("second")));
        assert_eq!(fields[2], probe.slot(function, ScopeSlot::ArgumentsBinding));
        for (field, &binding) in (0..).zip(fields) {
            assert_eq!(
                probe.placement(binding).storage,
                Storage::Field { scope, field }
            );
        }
    });
}

#[test]
fn bindings_list_symbols_before_slots() {
    let source = "export function probe() { const b = 2; const a = 1; return [this, a, b]; }";
    analyze_source("main.mjs", source, |probe| {
        let function = probe.function("probe");
        let bindings = probe.bindings(probe.top_scope(function));
        assert_eq!(bindings.len(), 3);
        assert!(bindings.is_sorted_by(|earlier, later| earlier < later));
        assert_eq!(bindings[2], probe.slot(function, ScopeSlot::This));
    });
}

#[test]
fn stored_local_slot_is_loop_carried() {
    let stored = "var i = 0; while (i < 2) { exports = { n: i }; i++; } console.log(exports.n);";
    analyze_source("main.cjs", stored, |probe| {
        let exports = BindingRef::Slot(probe.file_scope(), EXPORTS);
        assert_eq!(probe.placement(exports).storage, Storage::Local);
        let carried = probe.stored_in_loop(probe.first_statement(is_loop));
        assert_eq!(carried, [probe.binding("i"), exports]);
    });

    let arguments = "function probe() { for (var i = 0; i < 2; i++) { arguments = i; } \
                     return arguments; } module.exports = probe;";
    analyze_source("main.cjs", arguments, |probe| {
        let binding = probe.slot(probe.function("probe"), ScopeSlot::ArgumentsBinding);
        assert_eq!(probe.placement(binding).storage, Storage::Local);
        let carried = probe.stored_in_loop(probe.first_statement(is_loop));
        assert_eq!(carried, [probe.binding("i"), binding]);
    });

    let only_read = "var i = 0; while (i < 2) { console.log(exports); i++; }";
    analyze_source("main.cjs", only_read, |probe| {
        let carried = probe.stored_in_loop(probe.first_statement(is_loop));
        assert_eq!(carried, [probe.binding("i")]);
    });

    let shared = "var i = 0; while (i < 2) { exports = { n: i }; i++; } \
                  module.exports = () => exports;";
    analyze_source("main.cjs", shared, |probe| {
        let exports = BindingRef::Slot(probe.file_scope(), EXPORTS);
        assert!(is_field(probe.placement(exports).storage));
        let carried = probe.stored_in_loop(probe.first_statement(is_loop));
        assert_eq!(carried, [probe.binding("i")]);
    });
}

#[test]
fn binding_declared_in_loop_is_not_loop_carried() {
    let source = "export function g() { for (let i = 0; i < 3; i++) { let b = i; b = 2; } }";
    analyze_source("main.mjs", source, |probe| {
        let carried = probe.stored_in_loop(probe.first_statement(is_loop));
        assert_eq!(carried, [probe.binding("i")]);
    });
}

#[test]
fn binding_of_another_function_is_not_loop_carried() {
    let source = "export function g() { let x = 0; return () => { while (x < 1) { x = 1; } }; }";
    analyze_source("main.mjs", source, |probe| {
        assert!(
            probe
                .stored_in_loop(probe.first_statement(is_loop))
                .is_empty()
        );
    });
}

#[test]
#[should_panic(expected = "the scope walk records every live loop")]
fn statement_without_loop_panics() {
    let source = "let probe = 0; if (probe) { probe = 1; } export {};";
    analyze_source("main.ts", source, |probe| {
        let statement = probe.first_statement(|kind| matches!(kind, StmtKind::If { .. }));
        probe.stored_in_loop(statement).len()
    });
}

fn entry_flags_of_function(file: &str, source: &str) -> FunctionFlags {
    analyze_source(file, source, |probe| {
        probe.entry_flags(probe.key(probe.function("f")))
    })
}

#[test]
fn entry_flags_of_source_functions() {
    let (none, this) = (FunctionFlags::default(), FunctionFlags::HAS_THIS);
    let (target, callee) = (FunctionFlags::HAS_NEW_TARGET, FunctionFlags::TAKES_CALLEE);
    let count = FunctionFlags::HAS_ARGUMENT_COUNT;
    let arguments_flags = count | FunctionFlags::HAS_HIDDEN_REST;
    let cases = [
        ("export function f() { return 1; }", none),
        ("export function f() { return this; }", this),
        ("export function f() { return () => this; }", this),
        ("export function f() { return new.target; }", target),
        ("export const g = function f() { return f; };", callee),
        ("export function f() { return arguments; }", arguments_flags),
        (
            "export function f(...rest) { return [arguments, rest]; }",
            count,
        ),
    ];
    for (source, flags) in cases {
        assert_eq!(
            entry_flags_of_function("main.mjs", source),
            flags,
            "{source}"
        );
    }
    let mapped = "function f(a) { return arguments; } module.exports = f;";
    let mapped_flags = arguments_flags | callee;
    assert_eq!(entry_flags_of_function("main.cjs", mapped), mapped_flags);
}

#[test]
fn arrow_function_has_no_entry_this() {
    let source = "export function f() { return () => this; }";
    analyze_source("main.mjs", source, |probe| {
        let arrow = probe.key(probe.arrow());
        assert!(probe.entry_flags(arrow).is_empty());
    });
}

#[test]
fn entry_flags_of_class_functions() {
    let source = "export class C { x = 1; static y = 2; accessor #z = 3; constructor() {} }";
    analyze_source("main.ts", source, |probe| {
        let (file, class) = (probe.analysis.file, probe.class(0));
        let mut members = probe.hir[ClassId(0)].members.iter();
        let member = members.find(|&member| probe.hir[member].flags.contains(Flags::ACCESSOR));
        let member = member.expect("the class has an accessor");
        let constructor = probe.key(probe.only_function(FnKind::Constructor));
        let flags = probe.entry_flags(constructor);
        assert_eq!(flags, FunctionFlags::HAS_NEW_TARGET);
        let keys = [
            FunctionKey::InstanceInitializer(class),
            FunctionKey::StaticInitializer(class),
            FunctionKey::AccessorGetter { file, member },
            FunctionKey::AccessorSetter { file, member },
            FunctionKey::PrivateNameTest { file, member },
        ];
        for key in keys {
            assert_eq!(probe.entry_flags(key), FunctionFlags::HAS_THIS, "{key:?}");
        }
    });
    analyze_source("main.ts", "export class D {}", |probe| {
        let constructor = FunctionKey::ImplicitConstructor(probe.class(0));
        let flags = probe.entry_flags(constructor);
        assert_eq!(flags, FunctionFlags::HAS_NEW_TARGET);
    });
}

#[test]
fn entry_flags_of_module_body() {
    let flags_of = |file: &str, source: &str| {
        analyze_source(file, source, |probe| {
            probe.entry_flags(FunctionKey::ModuleBody(probe.analysis.file))
        })
    };
    // `this` at the top of a CommonJS file is the object that the body begins with: nobody passes it.
    assert!(flags_of("main.cjs", "this.a = 1;").is_empty());
    assert!(flags_of("main.cjs", "exports.a = 1;").is_empty());
    assert!(flags_of("main.mjs", "this; export {};").is_empty());
    let unmapped = FunctionFlags::HAS_ARGUMENT_COUNT | FunctionFlags::HAS_HIDDEN_REST;
    assert_eq!(flags_of("main.cjs", "'use strict'; arguments;"), unmapped);
    assert_eq!(
        flags_of("main.cjs", "arguments;"),
        unmapped | FunctionFlags::TAKES_CALLEE
    );
    assert!(flags_of("main.cjs", "function f() { arguments; } f();").is_empty());
    assert!(flags_of("main.mjs", "typeof arguments; export {};").is_empty());
}

#[test]
fn analysis_is_deterministic() {
    let source = "let top = 1; export function f(p, s) { let m = 1; const c = 2; \
        function h() { return [m, c, p, top]; } \
        class C extends p { #q = c; static t = () => C; r() { return this.#q; } } \
        for (const x of p) { m = () => [x, this, arguments]; } \
        return [h, C, eval(s)]; }";
    with_scope_input(&[("main.mjs", source)], |input| {
        let (first, second) = (analyze_scopes(input), analyze_scopes(input));
        for scope in (0..input.bound.scopes.len() as u32).map(ScopeId) {
            assert_eq!(first.bindings(scope), second.bindings(scope));
            assert_eq!(
                first.environment_fields(scope),
                second.environment_fields(scope)
            );
            assert_eq!(
                first.hoisted_functions(scope),
                second.hoisted_functions(scope)
            );
        }
        assert!(first.functions.len() > 5);
        assert_eq!(first.functions.len(), second.functions.len());
        for function in &first.functions {
            assert_eq!(first.captures(function.key), second.captures(function.key));
            assert_eq!(
                first.entry_flags(function.key),
                second.entry_flags(function.key)
            );
        }
    });
}

#[test]
fn unknown_ids_get_unknown_answers() {
    let source = "export function f() { return () => this; }";
    analyze_source("main.mjs", source, |probe| {
        let analysis = probe.analysis;
        let scope = ScopeId(probe.bound.scopes.len() as u32);
        let symbol = SymbolId(probe.bound.symbols.len() as u32);
        let function = FnId(probe.hir.fns.len() as u32);
        let key = source_key(analysis.file, function);
        assert_eq!(analysis.form(symbol), BindingForm::NotAValue);
        assert_eq!(analysis.placement(BindingRef::Symbol(symbol)), None);
        assert_eq!(
            analysis.placement(BindingRef::Slot(scope, ScopeSlot::This)),
            None
        );
        assert!(analysis.bindings(scope).is_empty());
        assert!(analysis.environment_fields(scope).is_empty());
        assert!(!analysis.has_environment(scope));
        assert!(analysis.hoisted_functions(scope).is_empty());
        assert_eq!(analysis.initial_function(symbol), None);
        assert!(!analysis.is_switch_scope(scope));
        let unit = CodeUnit::Function(function);
        assert_eq!(analysis.arguments_object(unit), ArgumentsObject::None);
        assert_eq!(analysis.lexical_owner(scope), scope);
        assert!(analysis.captures(key).is_empty());
        assert!(analysis.entry_flags(key).is_empty());
        assert!(!analysis.has_too_many_captures(key));
    });
}

#[test]
fn grouped_list_keeps_entry_order() {
    let list = GroupedList::new(3, &[(2, 'a'), (0, 'b'), (2, 'c')]);
    assert_eq!(list.get(0), ['b']);
    assert!(list.get(1).is_empty());
    assert_eq!(list.get(2), ['a', 'c']);
    assert!(list.get(3).is_empty());
}

#[test]
fn find_by_key_misses_absent_key() {
    let list = [(1, 'a'), (3, 'b')];
    assert_eq!(find_by_key(&list, 3), Some('b'));
    assert_eq!(find_by_key(&list, 2), None);
}
