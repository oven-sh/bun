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
use crate::lower::call::{self, Arguments, Callee};
use crate::lower::{FileLowering, FunctionLowering, commonjs, expression};
use crate::modules::ModuleKind;

#[derive(Copy, Clone)]
pub(super) struct EvalContext {
    pub(super) flags: EvalScopeFlags,
    pub(super) this_scope: Option<ScopeId>,
    pub(super) owner: CodeUnit,
    pub(super) class: Option<ClassId>,
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
    let callee_name = lowering.file.identifier_name(callee);
    lowering.set_position(hir[callee].pos);
    let (function, this) = lowering.lower_identifier_callee(callee);
    let arguments = lowering.lower_arguments(site.args);
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
        None => lowering.emit_direct_eval(call, &arguments),
    };
    lowering.jump_with(join, &[evaluated]);

    lowering.continue_in(ordinary);
    let name = Some(lowering.file.intern_atom(callee_name));
    let callee = Callee::without_key(other_function, this, name);
    let returned = call::emit_call_of(lowering, callee, arguments);
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
        let mut eval_scopes = bound.runtime.eval_scopes().iter();
        if eval_scopes.any(|entry| entry.1.is_sloppy) {
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
        let (flags, this_scope, class) = match owner {
            CodeUnit::File => match self.inputs.modules.kind(self.file) {
                ModuleKind::CommonJs => (compute_function_flags(FnKind::Expr, false), None, None),
                _ => (EvalScopeFlags::default(), None, None),
            },
            CodeUnit::Function(function) => {
                let is_derived = self.is_derived_constructor(function);
                let kind = hir.runtime_function_kind(function);
                let flags = compute_function_flags(kind, is_derived);
                (flags, Some(this_scope), bound.function_class(function))
            }
            CodeUnit::FieldInitializer(member) => {
                let flags = compute_initializer_flags();
                (flags, Some(this_scope), bound.member_class(member))
            }
        };
        EvalContext {
            flags: arrow_flags | flags,
            this_scope,
            owner,
            class,
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_direct_eval(&mut self, call: ExprId, arguments: &Arguments) -> ValueId {
        let text = match arguments {
            Arguments::Values(values) => match values.first() {
                Some(&text) => text,
                None => return self.builder.undefined(),
            },
            Arguments::List(list) => {
                let index = self.builder.integer(0);
                self.builder.elem_get(*list, index)
            }
        };
        let eval_scope = self.file.bound.eval_scope(call);
        let eval_scope = *eval_scope.expect("lower_direct_eval takes a call with an eval scope");
        let context = self.file.compute_eval_context(eval_scope.scope);
        let flags = context.flags;
        let this_value = if flags.contains(EvalScopeFlags::IS_IN_DERIVED_CONSTRUCTOR) {
            self.builder.undefined()
        } else {
            self.get_this()
        };
        let is_in_function = flags.contains(EvalScopeFlags::IS_IN_FUNCTION);
        let new_target = is_in_function.then(|| self.get_new_target());
        let (bindings, operands) = self.collect_eval_bindings(eval_scope, context);
        let mode = if eval_scope.is_sloppy {
            ECMAMode::Sloppy
        } else {
            ECMAMode::Strict
        };
        let scope = self.file.fragment.add_eval_scope(EvalScope {
            mode,
            flags,
            bindings,
        });
        self.builder
            .direct_eval(scope, text, this_value, new_target, &operands)
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
