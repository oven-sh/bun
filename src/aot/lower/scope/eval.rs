mod bindings;

use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, CodeUnit, ScopeId, ScopeKind};
use bun_sema::fold::Constant;
use bun_sema::hir::{ClassId, ExprId, ExprKind, FnKind, IdList};

use super::BindingForm;
use super::identifiers::{self, BindingRead};
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{ECMAMode, EvalScope, EvalScopeFlags};
use crate::ir::{Edge, ValueId};
use crate::lower::call::{self, Arguments, CallSite};
use crate::lower::{FileLowering, FunctionLowering, commonjs, expression, function};
use crate::modules::ModuleKind;

#[derive(Copy, Clone)]
pub(super) struct EvalContext {
    pub(super) flags: EvalScopeFlags,
    pub(super) this_scope: Option<ScopeId>,
    pub(super) owner: CodeUnit,
    pub(super) class: Option<ClassId>,
}

#[derive(Copy, Clone)]
enum EvalText {
    Absent,
    Value(ValueId),
    FirstElement(ValueId),
}

pub(super) fn lower_direct_eval(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Call(site) = hir[call].kind else {
        unreachable!("lower_direct_eval takes a Call expression");
    };
    let site = hir[site];
    let callee = expression::skip_type_syntax(lowering.file, site.callee);
    let ExprKind::Ident(callee_name) = hir[callee].kind else {
        unreachable!("the callee of a direct eval is an identifier");
    };
    lowering.set_position(hir[callee].pos);
    let (function, this) = identifiers::lower_identifier_callee(lowering, callee);
    let (arguments, text) = lower_eval_arguments(lowering, site.args);
    lowering.set_position(hir[call].pos);
    let eval = lowering.builder.builtin(BuiltinId::Eval);
    let is_eval = lowering.builder.strict_eq(function, eval);

    let direct = lowering.create_block();
    let ordinary = lowering.create_block();
    let join = lowering.create_block();
    let result = lowering.builder.add_parameter(join, None);
    // What is called there is any function but eval.
    let other_function = lowering.builder.add_edge_result(ordinary);
    let ordinary_edge = Edge::with_proofs(ordinary, &[0]);
    lowering
        .builder
        .branch(is_eval, Edge::to(direct), ordinary_edge);

    lowering.continue_in(direct);
    let evaluated = match find_binding_named_by_text(lowering.file, call, site.args) {
        Some((binding, name)) => {
            identifiers::read_binding(lowering, binding, name, BindingRead::Value)
        }
        None => emit_direct_eval(lowering, call, text),
    };
    lowering.jump_with(join, &[evaluated]);

    lowering.continue_in(ordinary);
    let call_site = CallSite {
        callee_name: Some(lowering.file.intern_atom(callee_name)),
        ..CallSite::default()
    };
    let returned = call::emit_call(lowering, other_function, this, arguments, call_site);
    lowering.jump_with(join, &[returned]);

    lowering.continue_in(join);
    result
}

// `eval("require")`: a text that is known at the build and is nothing but the name of a binding that the call sees reads that binding, like the name written in its place.
fn find_binding_named_by_text(
    file: &FileLowering<'_, '_, '_, '_>,
    call: ExprId,
    arguments: IdList<ExprId>,
) -> Option<(Binding, Atom)> {
    let (hir, bound) = (file.hir, file.bound);
    let text = expression::find_constant(file, hir.ids(arguments).next()?)?;
    let Constant::String(name) = text else {
        return None;
    };
    if bound
        .runtime
        .eval_scopes()
        .iter()
        .any(|entry| entry.1.is_sloppy)
    {
        return None;
    }
    let eval_scope = bound.eval_scope(call)?;
    let mut scope = eval_scope.scope;
    while scope.is_some() {
        if matches!(bound.scopes[scope.idx()].kind, ScopeKind::With(_)) {
            return None;
        }
        scope = bound.runtime_parent_scope(hir, scope);
    }
    let mut symbols = bound.ids(eval_scope.symbols);
    if let Some(symbol) = symbols.find(|&symbol| bindings::find_spelled_name(file, symbol) == name)
    {
        return match file.scopes.form(symbol) {
            BindingForm::Stored => Some((Binding::Symbol(symbol), name)),
            BindingForm::Import
            | BindingForm::NotAValue
            | BindingForm::Callee { .. }
            | BindingForm::MappedArgument { .. }
            | BindingForm::ContainerMember { .. } => None,
        };
    }
    if !commonjs::is_commonjs_module(file) {
        return None;
    }
    let mut variables = commonjs::undeclared_wrapper_parameters(bound);
    let variable = variables.find(|variable| variable.name() == name)?;
    Some((Binding::CommonJs(variable), name))
}

fn lower_eval_arguments(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    arguments: IdList<ExprId>,
) -> (Arguments, EvalText) {
    let arguments = call::lower_arguments(lowering, arguments);
    let text = match &arguments {
        Arguments::Values(values) => match values.first() {
            Some(&text) => EvalText::Value(text),
            None => EvalText::Absent,
        },
        Arguments::List(list) => EvalText::FirstElement(*list),
    };
    (arguments, text)
}

fn emit_direct_eval(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    text: EvalText,
) -> ValueId {
    let text = match text {
        EvalText::Absent => return lowering.builder.undefined(),
        EvalText::Value(text) => text,
        EvalText::FirstElement(list) => {
            let index = lowering.builder.integer(0);
            lowering.builder.elem_get(list, index)
        }
    };
    let eval_scope = lowering.file.bound.eval_scope(call);
    let eval_scope = *eval_scope.expect("lower_direct_eval takes a call with an eval scope");
    let context = compute_eval_context(lowering.file, eval_scope.scope);
    let this_value = if context
        .flags
        .contains(EvalScopeFlags::IS_IN_DERIVED_CONSTRUCTOR)
    {
        lowering.builder.undefined()
    } else {
        function::get_this(lowering)
    };
    let is_in_function = context.flags.contains(EvalScopeFlags::IS_IN_FUNCTION);
    let new_target = is_in_function.then(|| function::get_new_target(lowering));
    let record = bindings::collect_eval_bindings(lowering, eval_scope, context);
    let mode = if eval_scope.is_sloppy {
        ECMAMode::Sloppy
    } else {
        ECMAMode::Strict
    };
    let scope = lowering.file.fragment.add_eval_scope(EvalScope {
        mode,
        flags: context.flags,
        bindings: record.bindings,
    });
    lowering
        .builder
        .direct_eval(scope, text, this_value, new_target, &record.operands)
}

fn compute_eval_context(file: &FileLowering<'_, '_, '_, '_>, scope: ScopeId) -> EvalContext {
    let (hir, bound) = (file.hir, file.bound);
    let arrow_flags = match bound.code_unit(scope) {
        CodeUnit::Function(function) if hir[function].kind == FnKind::Arrow => {
            EvalScopeFlags::IS_IN_ARROW_FUNCTION
        }
        CodeUnit::Function(_) | CodeUnit::FieldInitializer(_) | CodeUnit::File => {
            EvalScopeFlags::default()
        }
    };
    let this_scope = file.scopes.lexical_owner(scope);
    let owner = bound.code_unit(this_scope);
    match owner {
        CodeUnit::File => EvalContext {
            flags: arrow_flags | compute_module_flags(file.inputs.modules.kind(file.file)),
            this_scope: None,
            owner,
            class: None,
        },
        CodeUnit::Function(function) => {
            let is_derived = function::is_derived_constructor(file, function);
            let kind = hir.runtime_function_kind(function);
            EvalContext {
                flags: arrow_flags | compute_function_flags(kind, is_derived),
                this_scope: Some(this_scope),
                owner,
                class: bound.function_class(function),
            }
        }
        CodeUnit::FieldInitializer(member) => EvalContext {
            flags: arrow_flags | compute_initializer_flags(),
            this_scope: Some(this_scope),
            owner,
            class: bound.member_class(member),
        },
    }
}

fn compute_module_flags(kind: ModuleKind) -> EvalScopeFlags {
    match kind {
        ModuleKind::CommonJs => compute_function_flags(FnKind::Expr, false),
        ModuleKind::SourceText
        | ModuleKind::Data
        | ModuleKind::RuntimeSource
        | ModuleKind::Runtime
        | ModuleKind::External => EvalScopeFlags::default(),
    }
}

fn compute_function_flags(kind: FnKind, is_derived: bool) -> EvalScopeFlags {
    let function = EvalScopeFlags::IS_IN_FUNCTION | EvalScopeFlags::ALLOWS_NEW_TARGET;
    let method = function | EvalScopeFlags::ALLOWS_SUPER_PROPERTY;
    match kind {
        FnKind::Decl | FnKind::Expr => function,
        FnKind::Method | FnKind::Getter | FnKind::Setter => method,
        FnKind::Constructor if is_derived => {
            method | EvalScopeFlags::IS_IN_DERIVED_CONSTRUCTOR | EvalScopeFlags::ALLOWS_SUPER_CALL
        }
        FnKind::Constructor => method,
        FnKind::StaticBlock => compute_initializer_flags(),
        FnKind::Arrow
        | FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType
        | FnKind::IndexSignature => {
            debug_assert!(false, "this function kind is not a lexical owner");
            EvalScopeFlags::default()
        }
    }
}

fn compute_initializer_flags() -> EvalScopeFlags {
    EvalScopeFlags::IS_IN_FIELD_INITIALIZER
        | EvalScopeFlags::ALLOWS_SUPER_PROPERTY
        | EvalScopeFlags::ALLOWS_NEW_TARGET
}
