use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingKind, Bound, Decl, ScopeId, SymbolId};
use bun_sema::hir::{self, ClassId, EnumId, ExprId, ExprKind, FnKind, ModuleId, PatId, PatKind};

use super::{analyze_source, storage_in};
use crate::lower::captures::Capture;
use crate::lower::scope::lexical_owners::find_container_binding;
use crate::lower::scope::{BindingForm, BindingRef, Storage};

fn first_name(hir: &hir::File<'_>) -> PatId {
    let mut patterns = hir.pats.iter();
    let found = patterns.position(|pattern| matches!(pattern.kind, PatKind::Ident(_)));
    PatId(found.expect("the source declares a name") as u32)
}

fn only_identifier(hir: &hir::File<'_>, name: Atom) -> ExprId {
    let is_named =
        |expr: &ExprId| matches!(hir[*expr].kind, ExprKind::Ident(found) if found == name);
    let expressions = (0..hir.exprs.len() as u32).map(ExprId);
    let identifiers: Vec<ExprId> = expressions.filter(is_named).collect();
    assert_eq!(identifiers.len(), 1);
    identifiers[0]
}

fn namespace_blocks_in(bound: &Bound<'_>, scope: ScopeId) -> Vec<ModuleId> {
    let blocks = (0..bound.module_scope.len() as u32).map(ModuleId);
    let parent_of = |block: &ModuleId| bound.scopes[bound.module_scope[block.idx()].idx()].parent;
    blocks.filter(|block| parent_of(block) == scope).collect()
}

fn exported_member(bound: &Bound<'_>, binding: SymbolId) -> SymbolId {
    let member = bound.export_symbol_of_value_symbol_if_exported(binding);
    assert_ne!(
        member, binding,
        "the block binds another symbol than the member"
    );
    member
}

#[test]
fn namespace_member_is_container_member() {
    let captured = "namespace Box { export const inner = 1; export const read = () => inner; } \
                    console.log(Box); export {};";
    analyze_source("main.ts", captured, |probe| {
        let container = probe.symbol("Box");
        let form = BindingForm::ContainerMember { container };
        assert_eq!(probe.form_of("inner"), form);
        assert_eq!(probe.analysis.placement(probe.binding("inner")), None);
        assert!(matches!(
            probe.placement_of("Box").storage,
            Storage::Variable(_)
        ));
        assert!(probe.captures(probe.arrow()).is_empty());
    });

    let uncaptured = "namespace Box { export const inner = 1; console.log(inner); } \
                      console.log(Box); export {};";
    assert_eq!(storage_in("main.ts", uncaptured, "Box"), Storage::Local);

    let commonjs = "namespace Box { export const inner = 1; export const read = () => inner; } \
                    module.exports = Box;";
    analyze_source("main.cts", commonjs, |probe| {
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("Box")]);
        assert_eq!(probe.placement_of("Box").storage, Storage::Local);
    });
}

#[test]
fn exported_namespace_declarations_are_block_bindings() {
    let source = "namespace Box { export function read() { return 1; } export class Item {} \
                  export enum Level { Low } export namespace Inner { export const depth = 1; } } \
                  console.log(Box); export {};";
    analyze_source("main.ts", source, |probe| {
        let (bound, analysis) = (probe.bound, probe.analysis);
        let outer = namespace_blocks_in(bound, probe.file_scope())[0];
        let block = bound.module_scope[outer.idx()];
        let container = bound.declared_symbol(Decl::Module(outer));
        let inner = namespace_blocks_in(bound, block)[0];
        let declarations = [
            (
                Decl::Fn(probe.only_function(FnKind::Decl)),
                BindingKind::Function,
            ),
            (Decl::Class(ClassId(0)), BindingKind::Class),
            (Decl::Enum(EnumId(0)), BindingKind::TypeScriptContainer),
            (Decl::Module(inner), BindingKind::TypeScriptContainer),
        ];
        for (decl, kind) in declarations {
            let binding = bound.declared_symbol(decl);
            let member = analysis.form(exported_member(bound, binding));
            let binding_ref = BindingRef::Symbol(binding);
            assert_eq!(bound.binding_kind(binding), kind, "{decl:?}");
            assert_eq!(
                probe.placement(binding_ref).storage,
                Storage::Local,
                "{decl:?}"
            );
            assert!(analysis.bindings(block).contains(&binding_ref), "{decl:?}");
            assert_eq!(
                member,
                BindingForm::ContainerMember { container },
                "{decl:?}"
            );
        }
    });
}

#[test]
fn exported_namespace_variable_is_only_member() {
    let source = "namespace Box { export const inner = 1; console.log(inner); } \
                  console.log(Box); export {};";
    analyze_source("main.ts", source, |probe| {
        let bound = probe.bound;
        let outer = namespace_blocks_in(bound, probe.file_scope())[0];
        let container = bound.declared_symbol(Decl::Module(outer));
        let member = bound.declared_symbol(Decl::Var(first_name(probe.hir)));
        assert_eq!(
            probe.form(member),
            BindingForm::ContainerMember { container }
        );
        assert!(probe.bindings(bound.module_scope[outer.idx()]).is_empty());
    });
}

#[test]
fn exported_namespace_function_is_hoisted_in_block() {
    let source = "namespace Box { read(); export function read() { return 1; } } \
                  console.log(Box); export {};";
    analyze_source("main.ts", source, |probe| {
        let bound = probe.bound;
        let outer = namespace_blocks_in(bound, probe.file_scope())[0];
        let function = probe.only_function(FnKind::Decl);
        let binding = bound.declared_symbol(Decl::Fn(function));
        let hoisted = probe.hoisted_functions(bound.module_scope[outer.idx()]);
        assert_eq!(hoisted, [(binding, function)]);
        let callee = only_identifier(probe.hir, probe.hir[function].name);
        assert_eq!(bound.binding(callee), Binding::Symbol(binding));
    });
}

#[test]
fn other_namespace_block_reads_member() {
    let source = "namespace Box { export function read() { return 1; } } \
                  namespace Box { read(); } console.log(Box); export {};";
    analyze_source("main.ts", source, |probe| {
        let bound = probe.bound;
        let blocks = namespace_blocks_in(bound, probe.file_scope());
        let other = bound.module_scope[blocks[1].idx()];
        let container = bound.declared_symbol(Decl::Module(blocks[1]));
        let function = probe.only_function(FnKind::Decl);
        let member = exported_member(bound, bound.declared_symbol(Decl::Fn(function)));
        let callee = only_identifier(probe.hir, probe.hir[function].name);
        assert_eq!(bound.binding(callee), Binding::Symbol(member));
        assert_eq!(
            probe.form(member),
            BindingForm::ContainerMember { container }
        );
        assert!(probe.bindings(other).is_empty());
        assert!(probe.hoisted_functions(other).is_empty());
    });
}

#[test]
fn reopened_namespace_has_binding_per_block() {
    let source = "namespace Outer { export namespace Inner { export const first = 1; } } \
                  namespace Outer { export namespace Inner { export const second = 2; } } \
                  console.log(Outer); export {};";
    analyze_source("main.ts", source, |probe| {
        let bound = probe.bound;
        let blocks = namespace_blocks_in(bound, probe.file_scope());
        let binding_in = |outer: ModuleId| {
            let block = bound.module_scope[outer.idx()];
            let binding = bound.declared_symbol(Decl::Module(namespace_blocks_in(bound, block)[0]));
            let binding_ref = BindingRef::Symbol(binding);
            assert_eq!(probe.bindings(block), [binding_ref]);
            assert_eq!(
                bound.binding_kind(binding),
                BindingKind::TypeScriptContainer
            );
            assert_eq!(probe.placement(binding_ref).storage, Storage::Local);
            binding
        };
        let (first, second) = (binding_in(blocks[0]), binding_in(blocks[1]));
        assert_ne!(first, second);
        assert_eq!(
            exported_member(bound, first),
            exported_member(bound, second)
        );
    });
}

#[test]
fn captured_block_binding_is_shared() {
    let namespace = "namespace Box { export function read() { return 1; } \
                     export const call = () => read(); }";
    let module = format!("{namespace} console.log(Box); export {{}};");
    analyze_source("main.ts", &module, |probe| {
        let function = probe.only_function(FnKind::Decl);
        let binding = probe.bound.declared_symbol(Decl::Fn(function));
        let placement = probe.placement(BindingRef::Symbol(binding));
        assert!(matches!(placement.storage, Storage::Variable(_)));
        assert!(placement.is_shared);
        assert_eq!(probe.initial_function(binding), None);
    });

    let commonjs = format!("{namespace} module.exports = Box;");
    analyze_source("main.cts", &commonjs, |probe| {
        let function = probe.only_function(FnKind::Decl);
        let binding = BindingRef::Symbol(probe.bound.declared_symbol(Decl::Fn(function)));
        assert_eq!(probe.placement(binding).storage, Storage::Local);
        assert_eq!(probe.captures(probe.arrow()), [Capture::Value(binding)]);
    });
}

#[test]
fn closure_in_nested_namespace_captures_block_binding() {
    let source = "namespace Outer { export namespace Inner { export let value = 1; \
                  export function read() { return value; } } } module.exports = Outer;";
    analyze_source("main.cts", source, |probe| {
        let bound = probe.bound;
        let top = probe.file_scope();
        let outer = namespace_blocks_in(bound, top)[0];
        let outer_block = bound.module_scope[outer.idx()];
        let inner = namespace_blocks_in(bound, outer_block)[0];
        let container = bound.declared_symbol(Decl::Module(outer));
        let binding = bound.declared_symbol(Decl::Module(inner));
        let member = exported_member(bound, binding);
        let function = probe.only_function(FnKind::Decl);
        let from = probe.top_scope(function);
        assert_eq!(find_container_binding(bound, from, member), binding);
        assert_eq!(find_container_binding(bound, from, container), container);
        assert_eq!(find_container_binding(bound, top, member), member);

        let storage = probe.placement(BindingRef::Symbol(binding)).storage;
        let field = Storage::Field {
            scope: outer_block,
            field: 0,
        };
        assert_eq!(storage, field);
        assert_eq!(
            probe.captures(function),
            [Capture::Environment(outer_block)]
        );
        let container_storage = probe.placement(BindingRef::Symbol(container)).storage;
        assert_eq!(container_storage, Storage::Local);
    });
}
