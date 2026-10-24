use bun_sema::bind::{BindingKind, FnOwner};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{ClassId, FnId, FnKind, MemberId};

use super::{Probe, analyze_source, first_field, is_field};
use crate::ir::generated::FunctionFlags;
use crate::ir::{ClassSlot, FunctionKey, VariableKey};
use crate::lower::captures::Capture;
use crate::lower::scope::{BindingRef, ScopeSlot, Storage};

fn member_of(probe: &Probe<'_, '_, '_>, function: FnId) -> MemberId {
    let FnOwner::Member(member) = probe.bound.fns[function.idx()].owner else {
        panic!("the function is a class member");
    };
    member
}

fn initializer_and_constructor(class: ClassRef) -> [FunctionKey; 2] {
    [
        FunctionKey::InstanceInitializer(class),
        FunctionKey::ImplicitConstructor(class),
    ]
}

#[test]
fn member_captures_what_it_needs() {
    let source = "export function f() { const a = 1, b = 2; \
        class C { m() { return a; } n() { return b; } k() {} } return C; }";
    analyze_source("main.mjs", source, |probe| {
        let [first, second, third] = probe.functions(FnKind::Method)[..] else {
            panic!("the class has three methods");
        };
        assert_eq!(probe.captures(first), [probe.copy_of("a")]);
        assert_eq!(probe.captures(second), [probe.copy_of("b")]);
        assert!(probe.captures(third).is_empty());
        assert!(!probe.has_environment(probe.class_scope(0)));
    });
}

#[test]
fn constructor_supplies_initializer() {
    let source = "export function f() { const a = 1; class C { x = a; } return C; }";
    analyze_source("main.mjs", source, |probe| {
        let copy = [probe.copy_of("a")];
        let class = probe.class(0);
        for key in initializer_and_constructor(class) {
            assert_eq!(probe.analysis.captures(key), copy, "{key:?}");
        }
    });
}

#[test]
fn constructor_captures_nothing_for_constant_field() {
    let source = "export function f() { const a = 1; class C { x = 1; } return [C, a]; }";
    analyze_source("main.mjs", source, |probe| {
        let class = probe.class(0);
        for key in initializer_and_constructor(class) {
            assert!(probe.analysis.captures(key).is_empty(), "{key:?}");
        }
    });
}

#[test]
fn later_method_copies_private_method() {
    let source = "export function f() { const a = 1; \
        class C { #m() { return a; } n() { return this.#m(); } } return C; }";
    analyze_source("main.mjs", source, |probe| {
        let [private_method, caller] = probe.functions(FnKind::Method)[..] else {
            panic!("the class has two methods");
        };
        let method_slot = ClassSlot::PrivateMethod(member_of(probe, private_method));
        let expected = [
            Capture::Value(probe.class_slot(0, ClassSlot::ClassToken)),
            Capture::Value(probe.class_slot(0, method_slot)),
        ];
        assert_eq!(probe.captures(caller), expected);
        assert_eq!(probe.captures(private_method), [probe.copy_of("a")]);
    });
}

#[test]
fn earlier_method_reads_private_method_from_environment() {
    let source = "export function f() { class C { n() { return this.#m(); } #m() {} } return C; }";
    analyze_source("main.mjs", source, |probe| {
        let [caller, private_method] = probe.functions(FnKind::Method)[..] else {
            panic!("the class has two methods");
        };
        let scope = probe.class_scope(0);
        let method_slot = ClassSlot::PrivateMethod(member_of(probe, private_method));
        let expected = first_field(scope, true);
        assert_eq!(probe.placement(probe.class_slot(0, method_slot)), expected);
        let token = probe.class_slot(0, ClassSlot::ClassToken);
        let captures = [Capture::Environment(scope), Capture::Value(token)];
        assert_eq!(probe.captures(caller), captures);
    });
}

#[test]
fn derived_constructor_takes_callee() {
    let source = "export function f(B) { class D extends B { \
        constructor() { super(); } m() { return super.m(); } } return D; }";
    analyze_source("main.mjs", source, |probe| {
        let constructor = probe.only_function(FnKind::Constructor);
        let flags = FunctionFlags::HAS_NEW_TARGET | FunctionFlags::TAKES_CALLEE;
        assert_eq!(probe.entry_flags(probe.key(constructor)), flags);
        assert!(probe.captures(constructor).is_empty());
        let class_object = probe.class_slot(0, ClassSlot::ClassObject);
        let method = probe.only_function(FnKind::Method);
        assert_eq!(probe.captures(method), [Capture::Value(class_object)]);
    });
}

#[test]
fn arrow_with_super_call_supplies_initializer() {
    let source = "export function f(B, g) { const a = g(); class D extends B { \
        x = a; constructor() { const s = () => super(); s(); } } return D; }";
    analyze_source("main.mjs", source, |probe| {
        let constructor = probe.only_function(FnKind::Constructor);
        let expected = [
            Capture::Environment(probe.top_scope(constructor)),
            probe.copy_of("a"),
            Capture::Value(probe.slot(constructor, ScopeSlot::NewTarget)),
            Capture::Value(probe.slot(constructor, ScopeSlot::Callee)),
        ];
        assert_eq!(probe.captures(probe.arrow()), expected);
        assert_eq!(probe.captures(constructor), [probe.copy_of("a")]);
    });
}

#[test]
fn arrow_without_super_call_supplies_nothing() {
    let source = "export function f(B, g) { const a = g(); class D extends B { \
        x = a; constructor() { super(); const s = () => 1; s(); } } return D; }";
    analyze_source("main.mjs", source, |probe| {
        assert!(probe.captures(probe.arrow()).is_empty());
    });
}

#[test]
fn derived_this_is_mutable() {
    let source = "export function f(B) { \
        return class extends B { constructor() { const s = () => super(); s(); } }; }";
    analyze_source("main.mjs", source, |probe| {
        let constructor = probe.only_function(FnKind::Constructor);
        let expected = first_field(probe.top_scope(constructor), false);
        assert_eq!(
            probe.placement(probe.slot(constructor, ScopeSlot::This)),
            expected
        );
    });
}

#[test]
fn derived_this_is_never_copied() {
    let source = "export function f(B) { \
        return class extends B { constructor() { super(); return () => this; } }; }";
    analyze_source("main.mjs", source, |probe| {
        let constructor = probe.only_function(FnKind::Constructor);
        let environment = [Capture::Environment(probe.top_scope(constructor))];
        assert_eq!(probe.captures(probe.arrow()), environment);
    });
}

#[test]
fn base_this_is_copied() {
    let source = "export class C { constructor() { this.read = () => this; } }";
    analyze_source("main.mjs", source, |probe| {
        let this = probe.slot(probe.only_function(FnKind::Constructor), ScopeSlot::This);
        assert_eq!(probe.captures(probe.arrow()), [Capture::Value(this)]);
        assert_eq!(probe.placement(this).storage, Storage::Local);
    });
}

#[test]
fn token_is_copied_by_all() {
    let source = "export function f() { class C { #p = 1; r() { return this.#p; } } return C; }";
    analyze_source("main.mjs", source, |probe| {
        let copy = [Capture::Value(probe.class_slot(0, ClassSlot::ClassToken))];
        let class = probe.class(0);
        assert_eq!(probe.captures(probe.only_function(FnKind::Method)), copy);
        for key in initializer_and_constructor(class) {
            assert_eq!(probe.analysis.captures(key), copy, "{key:?}");
        }
        assert!(!probe.has_environment(probe.class_scope(0)));
    });
}

#[test]
fn class_slots_at_top_level_are_variables() {
    let source = "export class C { #p = 1; r() { return this.#p; } }";
    analyze_source("main.mjs", source, |probe| {
        let class = probe.class(0);
        for slot in [ClassSlot::ClassObject, ClassSlot::ClassToken] {
            let key = VariableKey::ClassSlot { class, slot };
            let storage = probe.placement(probe.class_slot(0, slot)).storage;
            assert_eq!(storage, Storage::Variable(key));
        }
        let keys = [
            probe.key(probe.only_function(FnKind::Method)),
            FunctionKey::ImplicitConstructor(class),
            FunctionKey::InstanceInitializer(class),
            FunctionKey::StaticInitializer(class),
        ];
        for key in keys {
            assert!(probe.analysis.captures(key).is_empty(), "{key:?}");
        }
    });
}

#[test]
fn class_slots_of_commonjs_are_captured() {
    let source = "module.exports = class C { #p = 1; r() { return this.#p; } };";
    analyze_source("main.cjs", source, |probe| {
        let token = probe.class_slot(0, ClassSlot::ClassToken);
        assert_eq!(probe.placement(token).storage, Storage::Local);
        assert_eq!(
            probe.captures(probe.only_function(FnKind::Method)),
            [Capture::Value(token)]
        );
    });
}

#[test]
fn inner_class_name_has_a_field() {
    let source = "export function f() { class C { static make() { return new C(); } } return C; }";
    analyze_source("main.mjs", source, |probe| {
        let scope = probe.class_scope(0);
        let inner = BindingRef::Symbol(probe.bound.inner_class_symbol(ClassId(0)));
        let expected = first_field(scope, true);
        assert_eq!(probe.placement(inner), expected);
        let method = probe.only_function(FnKind::Method);
        assert_eq!(probe.captures(method), [Capture::Environment(scope)]);
    });
}

#[test]
fn static_arrow_copies_inner_name() {
    let source = "export function f() { class C { static make = () => new C(); } return C; }";
    analyze_source("main.mjs", source, |probe| {
        let inner = BindingRef::Symbol(probe.bound.inner_class_symbol(ClassId(0)));
        assert_eq!(probe.captures(probe.arrow()), [Capture::Value(inner)]);
        let initializer = [
            Capture::Value(inner),
            Capture::Value(probe.class_slot(0, ClassSlot::ClassObject)),
        ];
        let key = FunctionKey::StaticInitializer(probe.class(0));
        assert_eq!(probe.analysis.captures(key), initializer);
        assert_eq!(probe.placement(inner).storage, Storage::Local);
    });
}

#[test]
fn class_declaration_has_two_bindings() {
    let source = "export function probe() { \
        class Box { make() { return new Box(); } } return Box; }";
    analyze_source("main.ts", source, |probe| {
        let outer = probe.symbol("Box");
        let inner = probe.bound.inner_class_symbol(ClassId(0));
        assert_ne!(outer, inner);
        assert_eq!(probe.bound.binding_kind(outer), BindingKind::Class);
        assert_eq!(probe.bound.binding_kind(inner), BindingKind::ClassInnerName);
        let placement = probe.placement(BindingRef::Symbol(outer));
        assert_eq!(placement.storage, Storage::Local);
        assert!(!placement.is_shared);
        let fields = probe.environment_fields(probe.class_scope(0));
        assert_eq!(fields, [BindingRef::Symbol(inner)]);
    });
}

#[test]
fn class_expression_name_is_outside_class_scope() {
    let source = "export function probe() { return class Box { make() { return Box; } }; }";
    analyze_source("main.ts", source, |probe| {
        let inner = probe.bound.inner_class_symbol(ClassId(0));
        let scope = probe.bound.symbol_scope(inner);
        assert_eq!(probe.bound.binding_kind(inner), BindingKind::ClassInnerName);
        assert_ne!(scope, probe.class_scope(0));
        let storage = probe.placement(BindingRef::Symbol(inner)).storage;
        assert_eq!(storage, Storage::Field { scope, field: 0 });
        let method = probe.only_function(FnKind::Method);
        assert_eq!(probe.captures(method), [Capture::Environment(scope)]);
    });
}

#[test]
fn home_object_is_an_entry_capture() {
    let source = "export function f() { const a = 1; return { m() { return super.x + a; } }; }";
    analyze_source("main.mjs", source, |probe| {
        let method = probe.only_function(FnKind::Method);
        let expected = [
            probe.copy_of("a"),
            Capture::Value(probe.slot(method, ScopeSlot::HomeObject)),
        ];
        assert_eq!(probe.captures(method), expected);
        assert!(probe.captures_of("f").is_empty());
    });
}

#[test]
fn method_without_super_has_no_home_object() {
    let source = "export function f() { return { m() { return 1; } }; }";
    analyze_source("main.mjs", source, |probe| {
        let method = probe.only_function(FnKind::Method);
        assert!(probe.captures(method).is_empty());
        let home_object = probe.slot(method, ScopeSlot::HomeObject);
        assert_eq!(probe.analysis.placement(home_object), None);
    });
}

#[test]
fn arrow_in_method_copies_home_object() {
    let source = "export function f() { return { m() { return () => super.x; } }; }";
    analyze_source("main.mjs", source, |probe| {
        let method = probe.only_function(FnKind::Method);
        let home_object = Capture::Value(probe.slot(method, ScopeSlot::HomeObject));
        let this = Capture::Value(probe.slot(method, ScopeSlot::This));
        assert_eq!(probe.captures(probe.arrow()), [this, home_object]);
        assert_eq!(probe.captures(method), [home_object]);
    });
}

#[test]
fn variables_of_static_blocks_are_locals() {
    let source = "export function probe() { class Box { \
        static { let first = 1; console.log(first); } \
        static { let second = 2; console.log(second); } } return Box; }";
    analyze_source("main.ts", source, |probe| {
        let key = FunctionKey::StaticInitializer(probe.class(0));
        let blocks = probe.functions(FnKind::StaticBlock);
        assert_eq!(blocks.len(), 2);
        for block in blocks {
            assert!(matches!(probe.key(block), FunctionKey::Source(_)));
            assert!(!probe.has_environment(probe.top_scope(block)));
        }
        for name in ["first", "second"] {
            let placement = probe.placement_of(name);
            assert_eq!(placement.storage, Storage::Local, "{name}");
            assert!(!placement.is_shared, "{name}");
        }
        let class_object = probe.class_slot(0, ClassSlot::ClassObject);
        assert_eq!(probe.analysis.captures(key), [Capture::Value(class_object)]);
    });
}

#[test]
fn static_private_field_is_mutable() {
    let source = "export function f() { \
        class C { static #s = 1; static r() { return C.#s; } } return C; }";
    analyze_source("main.mjs", source, |probe| {
        let field = probe.hir[ClassId(0)].members.iter().next();
        let slot = ClassSlot::StaticField(field.expect("the class has members"));
        let placement = probe.placement(probe.class_slot(0, slot));
        assert!(is_field(placement.storage));
        assert!(!placement.is_immutable && !placement.has_local);
    });
}
