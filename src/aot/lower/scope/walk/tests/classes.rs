use bun_sema::hir::{self, ClassId, FnKind, MemberId, PropKey};

use super::{
    class_ref, created_at, creator_of, has_use, initialized_at, member_of, slot_initialized_at,
    slots_used_by, walked, walked_function, with_walk,
};
use crate::ir::{ClassSlot, FunctionKey};
use crate::lower::scope::testing::{functions_of_kind, only_function, symbol_named, top_scope};
use crate::lower::scope::walk::ScopeWalk;
use crate::lower::scope::{BindingRef, ScopeSlot, WalkedFunctionId};

const CLASS: ClassId = ClassId(0);
const MODULE_BODY: WalkedFunctionId = WalkedFunctionId::MODULE_BODY;
const CLASS_OBJECT: ScopeSlot = ScopeSlot::Class(ClassSlot::ClassObject);
const CLASS_TOKEN: ScopeSlot = ScopeSlot::Class(ClassSlot::ClassToken);

fn implicit_constructor(walk: &ScopeWalk) -> WalkedFunctionId {
    walked_function(
        walk,
        FunctionKey::ImplicitConstructor(class_ref(walk, CLASS)),
    )
}

fn instance_initializer(walk: &ScopeWalk) -> WalkedFunctionId {
    walked_function(
        walk,
        FunctionKey::InstanceInitializer(class_ref(walk, CLASS)),
    )
}

fn static_initializer(walk: &ScopeWalk) -> WalkedFunctionId {
    walked_function(walk, FunctionKey::StaticInitializer(class_ref(walk, CLASS)))
}

fn members(hir: &hir::File<'_>) -> Vec<MemberId> {
    hir[CLASS].members.iter().collect()
}

fn has_private_name_test(walk: &ScopeWalk) -> bool {
    let mut keys = walk.functions.iter().map(|function| function.key);
    keys.any(|key| matches!(key, FunctionKey::PrivateNameTest { .. }))
}

#[test]
fn source_constructor_is_first_function() {
    let source = "class C { m() {} constructor() { this.m(); } } new C();";
    with_walk(&[("main.ts", source)], |hir, _, walk| {
        let constructor = only_function(hir, FnKind::Constructor);
        let id = walked(walk, constructor);
        let key = walk.functions[id.index()].key;
        assert!(matches!(key, FunctionKey::Source(source) if source.function == constructor));
        let entries = walk.functions.iter().filter(|function| function.key == key);
        assert_eq!(entries.count(), 1);
        let others = [
            instance_initializer(walk),
            static_initializer(walk),
            walked(walk, only_function(hir, FnKind::Method)),
        ];
        assert!(others.iter().all(|&other| id < other));
    });
}

#[test]
fn source_constructor_uses_this() {
    let source = "export class C { constructor() {} }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let constructor = only_function(hir, FnKind::Constructor);
        let this = (top_scope(bound, constructor), ScopeSlot::This);
        assert_eq!(slots_used_by(walk, walked(walk, constructor)), [this]);
    });
}

#[test]
fn ambient_class_is_not_walked() {
    let source = "declare class A { m(): void; } export {};";
    with_walk(&[("main.ts", source)], |_, _, walk| {
        assert_eq!(walk.functions.len(), 1);
        assert!(walk.slot_initializations.is_empty());
    });
}

#[test]
fn class_functions_follow_evaluation_order() {
    let source = "export function g(B, k) { \
        class C extends B { #p = 1; [k]() {} static s = () => C; } return C; }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let scope = bound.class_scope[CLASS.idx()];
        let times = [
            slot_initialized_at(walk, scope, ClassSlot::ClassToken),
            created_at(walk, implicit_constructor(walk)),
            created_at(walk, instance_initializer(walk)),
            slot_initialized_at(walk, scope, ClassSlot::ClassObject),
            created_at(walk, walked(walk, only_function(hir, FnKind::Method))),
            initialized_at(walk, bound.inner_class_symbol(CLASS)),
            created_at(walk, static_initializer(walk)),
            created_at(walk, walked(walk, only_function(hir, FnKind::Arrow))),
            initialized_at(walk, symbol_named(hir, bound, "C")),
        ];
        assert!(
            times.is_sorted_by(|earlier, later| earlier < later),
            "{times:?}"
        );
    });
}

#[test]
fn instance_initializer_is_created_by_constructor() {
    let source = "export class C { x = 1; }";
    with_walk(&[("main.mjs", source)], |_, _, walk| {
        let constructor = implicit_constructor(walk);
        let initializer = instance_initializer(walk);
        assert_eq!(creator_of(walk, initializer), Some(constructor));
        assert_eq!(creator_of(walk, constructor), Some(MODULE_BODY));
        let creator = creator_of(walk, static_initializer(walk));
        assert_eq!(creator, Some(MODULE_BODY));
    });
    let source = "export function g() { return class { x = 1; constructor() {} }; }";
    with_walk(&[("main.mjs", source)], |hir, _, walk| {
        let evaluating = walked(walk, only_function(hir, FnKind::Decl));
        let constructor = walked(walk, only_function(hir, FnKind::Constructor));
        let initializer = instance_initializer(walk);
        assert_eq!(creator_of(walk, initializer), Some(constructor));
        assert_eq!(creator_of(walk, constructor), Some(evaluating));
        assert_eq!(creator_of(walk, static_initializer(walk)), Some(evaluating));
    });
}

#[test]
fn field_initializers_belong_to_initializers() {
    let source = "export class C { a = 1; static b = 2; c; }";
    with_walk(&[("main.mjs", source)], |hir, _, walk| {
        let [instance_field, static_field, _] = members(hir)[..] else {
            panic!("the class has three members");
        };
        let expected = [
            (instance_field, instance_initializer(walk)),
            (static_field, static_initializer(walk)),
        ];
        assert_eq!(walk.function_of_field, expected);
    });
}

#[test]
fn initializers_use_class_slots() {
    let source = "export function g(k) { class C { #p = 1; [k] = 2; static s = 3; } return C; }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let scope = bound.class_scope[CLASS.idx()];
        let is_computed = |member: &MemberId| matches!(hir[*member].key, PropKey::Computed(_));
        let computed = members(hir).into_iter().find(is_computed);
        let key = ClassSlot::ComputedKey(computed.expect("a member has a computed key"));
        let key_slot = (scope, ScopeSlot::Class(key));
        let instance_slots = [(scope, CLASS_TOKEN), key_slot];
        assert_eq!(
            slots_used_by(walk, instance_initializer(walk)),
            instance_slots
        );
        let static_slots = [(scope, CLASS_OBJECT), key_slot];
        assert_eq!(slots_used_by(walk, static_initializer(walk)), static_slots);
        let object_time = slot_initialized_at(walk, scope, ClassSlot::ClassObject);
        assert!(object_time < slot_initialized_at(walk, scope, key));
    });
}

#[test]
fn static_members_follow_inner_name() {
    let source = "export function g() { class C { static a = () => C; static { C; } } return C; }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let inner_name = bound.inner_class_symbol(CLASS);
        let initializer = static_initializer(walk);
        let arrow = walked(walk, only_function(hir, FnKind::Arrow));
        assert!(initialized_at(walk, inner_name) < created_at(walk, initializer));
        assert!(created_at(walk, initializer) < created_at(walk, arrow));
        assert_eq!(creator_of(walk, arrow), Some(initializer));
        let block = walked(walk, only_function(hir, FnKind::StaticBlock));
        assert!(created_at(walk, initializer) < created_at(walk, block));
        assert!(has_use(walk, block, BindingRef::Symbol(inner_name)));
    });
}

#[test]
fn static_block_is_function_that_initializer_creates() {
    let source = "export class C { static { 1; } static { 2; } }";
    with_walk(&[("main.mjs", source)], |hir, _, walk| {
        let blocks = functions_of_kind(hir, FnKind::StaticBlock);
        assert_eq!(blocks.len(), 2);
        let initializer = static_initializer(walk);
        let functions: Vec<_> = blocks
            .into_iter()
            .map(|block| walked(walk, block))
            .collect();
        assert_ne!(functions[0], functions[1]);
        for function in functions {
            assert_ne!(function, initializer);
            assert_eq!(creator_of(walk, function), Some(initializer));
            assert!(created_at(walk, initializer) < created_at(walk, function));
        }
    });
}

#[test]
fn accessor_functions_use_token() {
    let source = "export class C { accessor v = 1; }";
    with_walk(&[("main.ts", source)], |hir, bound, walk| {
        let (file, member) = (class_ref(walk, CLASS).file, members(hir)[0]);
        let keys = [
            FunctionKey::AccessorGetter { file, member },
            FunctionKey::AccessorSetter { file, member },
        ];
        for key in keys {
            let function = walked_function(walk, key);
            let token = (bound.class_scope[CLASS.idx()], CLASS_TOKEN);
            assert_eq!(slots_used_by(walk, function), [token], "{key:?}");
            assert_eq!(creator_of(walk, function), Some(MODULE_BODY));
            assert!(created_at(walk, function) > 0, "{key:?}");
        }
        assert!(!has_private_name_test(walk));
    });
}

#[test]
fn static_accessor_functions_use_class_object() {
    let source = "export class C { static accessor v = 1; }";
    with_walk(&[("main.ts", source)], |hir, bound, walk| {
        let (file, member) = (class_ref(walk, CLASS).file, members(hir)[0]);
        let scope = bound.class_scope[CLASS.idx()];
        let storage = ScopeSlot::Class(ClassSlot::StaticField(member));
        let getter = walked_function(walk, FunctionKey::AccessorGetter { file, member });
        assert_eq!(
            slots_used_by(walk, getter),
            [(scope, CLASS_OBJECT), (scope, storage)]
        );
    });
}

#[test]
fn private_accessor_has_a_name_test() {
    let source = "export class C { accessor #v = 1; }";
    with_walk(&[("main.ts", source)], |hir, bound, walk| {
        let (file, member) = (class_ref(walk, CLASS).file, members(hir)[0]);
        let test = walked_function(walk, FunctionKey::PrivateNameTest { file, member });
        let token = (bound.class_scope[CLASS.idx()], CLASS_TOKEN);
        assert_eq!(slots_used_by(walk, test), [token]);
    });
}

#[test]
fn private_method_is_a_slot() {
    let source = "export class C { #m() {} a() { this.#m(); } }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let [private_method, caller] = functions_of_kind(hir, FnKind::Method)[..] else {
            panic!("the class has two methods");
        };
        let scope = bound.class_scope[CLASS.idx()];
        let method_slot = ClassSlot::PrivateMethod(member_of(bound, private_method));
        let expected = [
            (scope, CLASS_TOKEN),
            (scope, ScopeSlot::Class(method_slot)),
            (top_scope(bound, caller), ScopeSlot::This),
        ];
        assert_eq!(slots_used_by(walk, walked(walk, caller)), expected);
        assert!(slots_used_by(walk, walked(walk, private_method)).is_empty());
    });
}

#[test]
fn private_method_slot_follows_its_closure() {
    let source = "export class C { #m() {} }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let method = only_function(hir, FnKind::Method);
        let scope = bound.class_scope[CLASS.idx()];
        let slot = ClassSlot::PrivateMethod(member_of(bound, method));
        let slot_time = slot_initialized_at(walk, scope, slot);
        assert!(created_at(walk, walked(walk, method)) < slot_time);
        assert!(slot_time < initialized_at(walk, bound.inner_class_symbol(CLASS)));
        assert!(!has_private_name_test(walk));
    });
}

#[test]
fn decorated_private_method_slot_follows_inner_name() {
    let source = "export function g(d) { class C { @d #m() {} } return C; }";
    with_walk(&[("main.ts", source)], |hir, bound, walk| {
        let method = only_function(hir, FnKind::Method);
        let scope = bound.class_scope[CLASS.idx()];
        let slot = ClassSlot::PrivateMethod(member_of(bound, method));
        let inner_name_time = initialized_at(walk, bound.inner_class_symbol(CLASS));
        assert!(created_at(walk, walked(walk, method)) < inner_name_time);
        assert!(inner_name_time < slot_initialized_at(walk, scope, slot));
        assert!(has_private_name_test(walk));
    });
}

#[test]
fn static_private_name_uses_class_object() {
    let source = "export class C { static #s = 1; static r(o) { return o.#s; } }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let scope = bound.class_scope[CLASS.idx()];
        let storage = ScopeSlot::Class(ClassSlot::StaticField(members(hir)[0]));
        let reader = walked(walk, only_function(hir, FnKind::Method));
        assert_eq!(
            slots_used_by(walk, reader),
            [(scope, CLASS_OBJECT), (scope, storage)]
        );
    });
}

#[test]
fn super_member_uses_class_object() {
    let source = "export class D extends Object { m() { return super.m(); } }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let method = only_function(hir, FnKind::Method);
        let expected = [
            (bound.class_scope[CLASS.idx()], CLASS_OBJECT),
            (top_scope(bound, method), ScopeSlot::This),
        ];
        assert_eq!(slots_used_by(walk, walked(walk, method)), expected);
    });
}

#[test]
fn super_call_in_arrow_references_constructor() {
    let source = "export function g(B) { \
        return class D extends B { constructor() { const s = () => super(); s(); } }; }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let constructor = only_function(hir, FnKind::Constructor);
        let scope = top_scope(bound, constructor);
        let arrow = walked(walk, only_function(hir, FnKind::Arrow));
        assert_eq!(walk.function_references, [(arrow, constructor)]);
        let expected = [
            (scope, ScopeSlot::This),
            (scope, ScopeSlot::NewTarget),
            (scope, ScopeSlot::Callee),
        ];
        assert_eq!(slots_used_by(walk, arrow), expected);
        assert_eq!(walk.stored_slots, [(scope, ScopeSlot::This)]);
    });
}

#[test]
fn class_moved_to_file_start_is_created_before_earlier_statements() {
    let source = "const calls = []; class C { m() { return calls; } } new C().m();";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let method = walked(walk, only_function(hir, FnKind::Method));
        assert!(created_at(walk, method) < initialized_at(walk, symbol_named(hir, bound, "calls")));
    });
}

#[test]
fn class_with_heritage_stays_in_place() {
    let source = "const calls = []; class C extends Object { m() { return calls; } } new C().m();";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let method = walked(walk, only_function(hir, FnKind::Method));
        assert!(created_at(walk, method) > initialized_at(walk, symbol_named(hir, bound, "calls")));
    });
}
