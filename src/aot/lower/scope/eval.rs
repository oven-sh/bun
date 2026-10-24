mod bindings;

use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, CodeUnit, ScopeId, ScopeKind};
use bun_sema::fold::Constant;
use bun_sema::hir::{ClassId, ExprId, ExprKind, FnKind, IdList};

use super::BindingForm;
use super::identifiers::BindingRead;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{ECMAMode, EvalScope, EvalScopeFlags};
use crate::ir::{Edge, ValueId};
use crate::lower::call::{self, Arguments, CallSite};
use crate::lower::{FileLowering, FunctionLowering, commonjs, expression};
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

pub(crate) fn lower_direct_eval(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Call(site) = hir[call].kind else {
        unreachable!("lower_direct_eval takes a Call expression");
    };
    let site = hir[site];
    let callee = lowering.file.skip_type_syntax(site.callee);
    let ExprKind::Ident(callee_name) = hir[callee].kind else {
        unreachable!("the callee of a direct eval is an identifier");
    };
    lowering.set_position(hir[callee].pos);
    let (function, this) = lowering.lower_identifier_callee(callee);
    let (arguments, text) = lowering.lower_eval_arguments(site.args);
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
    let evaluated = match lowering.file.find_binding_named_by_text(call, site.args) {
        Some((binding, name)) => lowering.read_binding(binding, name, BindingRead::Value),
        None => lowering.emit_direct_eval(call, text),
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

impl FileLowering<'_, '_, '_, '_> {
    // `eval("require")`: a text that is known at the build and is nothing but the name of a binding that the call sees reads that binding, like the name written in its place.
    fn find_binding_named_by_text(
        &self,
        call: ExprId,
        arguments: IdList<ExprId>,
    ) -> Option<(Binding, Atom)> {
        let (hir, bound) = (self.hir, self.bound);
        let text = expression::find_constant(self, hir.ids(arguments).next()?)?;
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
        if let Some(symbol) = symbols.find(|&symbol| self.find_spelled_name(symbol) == name) {
            return match self.scopes.form(symbol) {
                BindingForm::Stored => Some((Binding::Symbol(symbol), name)),
                _ => None,
            };
        }
        if !self.is_commonjs_module() {
            return None;
        }
        let mut variables = commonjs::undeclared_wrapper_parameters(bound);
        let variable = variables.find(|variable| variable.name() == name)?;
        Some((Binding::CommonJs(variable), name))
    }

    fn compute_eval_context(&self, scope: ScopeId) -> EvalContext {
        let (hir, bound) = (self.hir, self.bound);
        let arrow_flags = match bound.code_unit(scope) {
            CodeUnit::Function(function) if hir[function].kind == FnKind::Arrow => {
                EvalScopeFlags::IS_IN_ARROW_FUNCTION
            }
            CodeUnit::Function(_) | CodeUnit::FieldInitializer(_) | CodeUnit::File => {
                EvalScopeFlags::default()
            }
        };
        let this_scope = self.scopes.lexical_owner(scope);
        let owner = bound.code_unit(this_scope);
        match owner {
            CodeUnit::File => EvalContext {
                flags: arrow_flags | compute_module_flags(self.inputs.modules.kind(self.file)),
                this_scope: None,
                owner,
                class: None,
            },
            CodeUnit::Function(function) => {
                let is_derived = self.is_derived_constructor(function);
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
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn lower_eval_arguments(&mut self, arguments: IdList<ExprId>) -> (Arguments, EvalText) {
        let arguments = self.lower_arguments(arguments);
        let text = match &arguments {
            Arguments::Values(values) => match values.first() {
                Some(&text) => EvalText::Value(text),
                None => EvalText::Absent,
            },
            Arguments::List(list) => EvalText::FirstElement(*list),
        };
        (arguments, text)
    }

    fn emit_direct_eval(&mut self, call: ExprId, text: EvalText) -> ValueId {
        let text = match text {
            EvalText::Absent => return self.builder.undefined(),
            EvalText::Value(text) => text,
            EvalText::FirstElement(list) => {
                let index = self.builder.integer(0);
                self.builder.elem_get(list, index)
            }
        };
        let eval_scope = self.file.bound.eval_scope(call);
        let eval_scope = *eval_scope.expect("lower_direct_eval takes a call with an eval scope");
        let context = self.file.compute_eval_context(eval_scope.scope);
        let this_value = if context
            .flags
            .contains(EvalScopeFlags::IS_IN_DERIVED_CONSTRUCTOR)
        {
            self.builder.undefined()
        } else {
            self.get_this()
        };
        let is_in_function = context.flags.contains(EvalScopeFlags::IS_IN_FUNCTION);
        let new_target = is_in_function.then(|| self.get_new_target());
        let record = self.collect_eval_bindings(eval_scope, context);
        let mode = if eval_scope.is_sloppy {
            ECMAMode::Sloppy
        } else {
            ECMAMode::Strict
        };
        let scope = self.file.fragment.add_eval_scope(EvalScope {
            mode,
            flags: context.flags,
            bindings: record.bindings,
        });
        self.builder
            .direct_eval(scope, text, this_value, new_target, &record.operands)
    }
}

fn compute_module_flags(kind: ModuleKind) -> EvalScopeFlags {
    match kind {
        ModuleKind::CommonJs => compute_function_flags(FnKind::Expr, false),
        _ => EvalScopeFlags::default(),
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
        _ => {
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
