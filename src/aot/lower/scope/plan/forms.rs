use bun_sema::bind::{BindingKind, CodeUnit, Decl, ScopeId, SymbolId, has_mapped_arguments};
use bun_sema::hir::FnId;
use bun_sema::util::SharedSort;

use super::{Context, NormalizedUses};
use crate::ir::FunctionKey;
use crate::lower::commonjs;
use crate::lower::scope::analysis::{ArgumentsObjects, sort_unique};
use crate::lower::scope::lexical_owners::find_container_binding;
use crate::lower::scope::walk::EvalUse;
use crate::lower::scope::{ArgumentsObject, BindingForm, BindingRef, ScopeSlot, WalkedFunctionId};
use crate::modules::ImportBinding;

pub(super) fn compute_arguments_objects(context: &Context<'_, '_>) -> ArgumentsObjects {
    let (hir, bound) = (context.input.hir, context.input.bound);
    let mut objects = ArgumentsObjects {
        file: ArgumentsObject::None,
        functions: vec![ArgumentsObject::None; hir.fns.len()],
        fields: Vec::new(),
    };
    for &(_, used) in &context.walk.uses {
        let BindingRef::Slot(scope, ScopeSlot::Arguments) = used else {
            continue;
        };
        let unit = bound.code_unit(scope);
        debug_assert_eq!(bound.top_scope(hir, unit), scope);
        let created = match has_mapped_arguments(hir, unit) {
            true => ArgumentsObject::Mapped,
            false => ArgumentsObject::Unmapped,
        };
        match unit {
            CodeUnit::File => objects.file = created,
            CodeUnit::Function(function) => objects.functions[function.idx()] = created,
            CodeUnit::FieldInitializer(member) => objects.fields.push(member),
        }
    }
    sort_unique(&mut objects.fields);
    objects
}

pub(super) fn compute_forms(
    context: &Context<'_, '_>,
    arguments_objects: &ArgumentsObjects,
) -> Vec<BindingForm> {
    let (hir, bound) = (context.input.hir, context.input.bound);
    let symbols = (0..bound.symbols.len() as u32).map(SymbolId);
    let form_of = |symbol: SymbolId| compute_form(context, symbol, bound.binding_kind(symbol));
    let mut forms: Vec<BindingForm> = symbols.map(form_of).collect();
    for (function, &object) in (0..).map(FnId).zip(&arguments_objects.functions) {
        if object != ArgumentsObject::Mapped {
            continue;
        }
        let unit = CodeUnit::Function(function);
        for (index, parameter) in (0..).zip(hir[function].params.iter()) {
            let symbol = bound.declared_symbol(Decl::Param(hir[parameter].pat));
            if bound.binding_kind(symbol) != BindingKind::Parameter {
                continue;
            }
            if bound.is_mapped_argument(hir, symbol, context.input.names_lie_on_object_prototype) {
                forms[symbol.idx()] = BindingForm::MappedArgument { unit, index };
            }
        }
    }
    if arguments_objects.file == ArgumentsObject::Mapped {
        for &(symbol, variable) in bound.runtime.redeclared_commonjs_variables() {
            forms[symbol.idx()] = BindingForm::MappedArgument {
                unit: CodeUnit::File,
                index: commonjs::wrapper_parameter_index(variable),
            };
        }
    }
    forms
}

pub(super) fn normalize_uses(
    context: &Context<'_, '_>,
    forms: &[BindingForm],
    arguments_objects: &ArgumentsObjects,
) -> NormalizedUses {
    let (bound, walk) = (context.input.bound, context.walk);
    let has_mapped_wrapper_parameters = arguments_objects.file == ArgumentsObject::Mapped;
    let normalize = |user: WalkedFunctionId, binding: BindingRef| match binding {
        BindingRef::Slot(scope, ScopeSlot::CommonJs(_)) if has_mapped_wrapper_parameters => {
            Some(BindingRef::Slot(scope, ScopeSlot::Arguments))
        }
        BindingRef::Symbol(_) | BindingRef::Slot(..) => {
            normalize_binding(context, forms, user, binding)
        }
    };
    debug_assert!(walk.uses.is_sorted_by(|first, second| first < second));
    let mut uses: Vec<(WalkedFunctionId, BindingRef)> = Vec::with_capacity(walk.uses.len());
    let mut entry_captures: Vec<(WalkedFunctionId, BindingRef)> = Vec::new();
    let mut is_in_order = true;
    for &(user, used) in &walk.uses {
        let is_kept = match used {
            BindingRef::Symbol(symbol) => matches!(forms[symbol.idx()], BindingForm::Stored),
            BindingRef::Slot(_, ScopeSlot::CommonJs(_)) => !has_mapped_wrapper_parameters,
            BindingRef::Slot(..) => true,
        };
        let binding = match is_kept {
            true => used,
            false => {
                let Some(binding) = normalize(user, used) else {
                    continue;
                };
                is_in_order = false;
                binding
            }
        };
        if let BindingRef::Slot(scope, ScopeSlot::HomeObject) = binding
            && let Some(function) = context.scope_functions[scope.idx()]
        {
            entry_captures.push((function, binding));
        }
        uses.push((user, binding));
    }
    for (index, &walked) in walk.function_of_fn.iter().enumerate() {
        if arguments_objects.functions[index] == ArgumentsObject::Mapped
            && let Some(walked) = walked
        {
            let callee = BindingRef::Slot(bound.fns[index].scope, ScopeSlot::Callee);
            uses.push((walked, callee));
            is_in_order = false;
        }
    }
    if has_mapped_wrapper_parameters {
        let callee = BindingRef::Slot(context.file_scope, ScopeSlot::Callee);
        uses.push((WalkedFunctionId::MODULE_BODY, callee));
        is_in_order = false;
    }
    let stored_eval_uses = walk.eval_uses.iter().filter_map(|&eval_use| {
        let binding = normalize(eval_use.function, eval_use.binding)?;
        Some(EvalUse {
            binding,
            ..eval_use
        })
    });
    let mut eval_uses: Vec<EvalUse> = stored_eval_uses.collect();
    eval_uses.shared_sort_unstable();
    eval_uses.dedup();
    if let Some((_, eval)) = bound.runtime.eval_scopes().first()
        && !walk.evals_under_names_of_file.is_empty()
    {
        let is_variable_of_module = |&symbol: &SymbolId| {
            matches!(forms[symbol.idx()], BindingForm::Stored)
                && context.is_module_level_scope[context.declaring_scope(symbol).idx()]
        };
        let (variables, others): (Vec<SymbolId>, Vec<SymbolId>) = bound
            .ids(eval.file_symbols)
            .partition(is_variable_of_module);
        let mut is_body_met = vec![false; walk.functions.len()];
        let mut uses_of_names: Vec<(WalkedFunctionId, BindingRef)> = Vec::new();
        let mut eval_uses_of_names: Vec<EvalUse> = Vec::new();
        for &(function, time) in &walk.evals_under_names_of_file {
            let body = context.module_bodies[function.index()];
            let variables = match std::mem::replace(&mut is_body_met[body.index()], true) {
                true => &[][..],
                false => &variables[..],
            };
            for &symbol in variables.iter().chain(&others) {
                let Some(binding) = normalize(function, BindingRef::Symbol(symbol)) else {
                    continue;
                };
                uses_of_names.push((function, binding));
                eval_uses_of_names.push(EvalUse {
                    function,
                    binding,
                    time,
                });
            }
        }
        sort_unique(&mut eval_uses_of_names);
        eval_uses = merge_unique(&eval_uses, &eval_uses_of_names);
        if is_in_order {
            sort_unique(&mut uses_of_names);
            uses = merge_unique(&uses, &uses_of_names);
        } else {
            uses.append(&mut uses_of_names);
        }
    }
    if !is_in_order {
        sort_unique(&mut uses);
    }

    let walked_references = walk.function_references.iter();
    let walked_references = walked_references.filter_map(|&(user, function)| {
        let walked = walk.function_of_fn[function.idx()]?;
        (walked != user).then_some((user, walked))
    });
    let mut references: Vec<(WalkedFunctionId, WalkedFunctionId)> = walked_references.collect();
    sort_unique(&mut references);

    sort_unique(&mut entry_captures);

    NormalizedUses {
        uses,
        eval_uses,
        references,
        entry_captures,
    }
}

fn merge_unique<T: Ord + Copy>(mut first: &[T], mut second: &[T]) -> Vec<T> {
    let mut merged = Vec::with_capacity(first.len() + second.len());
    while let (Some(&of_first), Some(&of_second)) = (first.first(), second.first()) {
        let order = of_first.cmp(&of_second);
        merged.push(if order.is_gt() { of_second } else { of_first });
        first = &first[usize::from(order.is_le())..];
        second = &second[usize::from(order.is_ge())..];
    }
    merged.extend_from_slice(first);
    merged.extend_from_slice(second);
    merged
}

#[inline]
fn compute_form(context: &Context<'_, '_>, symbol: SymbolId, kind: BindingKind) -> BindingForm {
    let (input, bound) = (context.input, context.input.bound);
    if kind == BindingKind::NoBinding {
        let declares_variable = |decl: &Decl| matches!(decl, Decl::Var(_));
        let container = find_container(context, symbol)
            .filter(|&container| bound.has_runtime_value(container))
            .filter(|_| bound.symbol(symbol).decls.iter().any(declares_variable));
        return match container {
            Some(container) => BindingForm::ContainerMember { container },
            None => BindingForm::NotAValue,
        };
    }
    if kind == BindingKind::Import {
        return match input.modules.import_binding(input.file, symbol) {
            ImportBinding::Unused => BindingForm::NotAValue,
            ImportBinding::Local => {
                debug_assert!(false, "the module graph binds every import");
                BindingForm::Import
            }
            _ => BindingForm::Import,
        };
    }
    if let Some(container) = find_container(context, symbol) {
        return BindingForm::ContainerMember { container };
    }
    if kind == BindingKind::FunctionName {
        let mut declarations = bound.symbol(symbol).decls.iter();
        let function = declarations.find_map(|&decl| match decl {
            Decl::Fn(function) if bound.declared_symbol(decl) == symbol => Some(function),
            _ => None,
        });
        let function = function.expect("a function declares its own name");
        return BindingForm::Callee { function };
    }
    let has_scope = bound.symbol_scope(symbol).is_some();
    let is_export = bound.symbol(symbol).parent.is_some();
    assert!(
        has_scope || is_export,
        "only an export-only name has no scope"
    );
    BindingForm::Stored
}

fn find_container(context: &Context<'_, '_>, symbol: SymbolId) -> Option<SymbolId> {
    let bound = context.input.bound;
    let parent = bound.symbol(symbol).parent.some();
    parent.filter(|&parent| parent != bound.file_symbol)
}

fn top_scope(context: &Context<'_, '_>, function: WalkedFunctionId) -> ScopeId {
    let bound = context.input.bound;
    match context.walk.functions[function.index()].key {
        FunctionKey::ModuleBody(_) => context.file_scope,
        FunctionKey::Source(source) => bound.fns[source.function.idx()].scope,
        FunctionKey::Signature(_) | FunctionKey::ClassSignature(_) => {
            unreachable!("a signature has no scopes")
        }
        FunctionKey::ImplicitConstructor(class)
        | FunctionKey::InstanceInitializer(class)
        | FunctionKey::StaticInitializer(class) => bound.class_scope[class.class.idx()],
        FunctionKey::AccessorGetter { member, .. }
        | FunctionKey::AccessorSetter { member, .. }
        | FunctionKey::PrivateNameTest { member, .. } => {
            let class = bound.member_class(member);
            let class = class.expect("an accessor function belongs to a class member");
            bound.class_scope[class.idx()]
        }
        _ => {
            unreachable!("the walk meets no function of this kind")
        }
    }
}

fn normalize_binding(
    context: &Context<'_, '_>,
    forms: &[BindingForm],
    user: WalkedFunctionId,
    binding: BindingRef,
) -> Option<BindingRef> {
    let (bound, walk) = (context.input.bound, context.walk);
    let mut symbol = match binding {
        BindingRef::Symbol(symbol) => symbol,
        BindingRef::Slot(..) => return Some(binding),
    };
    loop {
        match forms[symbol.idx()] {
            BindingForm::ContainerMember { container } => {
                symbol = find_container_binding(bound, top_scope(context, user), container);
            }
            BindingForm::NotAValue | BindingForm::Import => return None,
            BindingForm::Callee { function } => {
                let walked = walk.function_of_fn[function.idx()]?;
                if walk.functions[walked.index()].creator == Some(user) {
                    return None;
                }
                let scope = bound.fns[function.idx()].scope;
                return Some(BindingRef::Slot(scope, ScopeSlot::Callee));
            }
            BindingForm::MappedArgument { unit, .. } => {
                let scope = bound.top_scope(context.input.hir, unit);
                return Some(BindingRef::Slot(scope, ScopeSlot::Arguments));
            }
            BindingForm::Stored => return Some(BindingRef::Symbol(symbol)),
        }
    }
}
