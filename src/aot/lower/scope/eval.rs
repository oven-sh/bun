mod bindings;

use bun_sema::atom::{Atom, known};
use bun_sema::bind::{self, Binding, CodeUnit, ScopeId, ScopeKind, SymbolId};
use bun_sema::fold::Constant;
use bun_sema::hir::{BinOp, CallId, ClassId, ExprId, ExprKind, FnKind, IdList, KnownEvaluation};

use super::BindingForm;
use super::identifiers::BindingRead;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{ECMAMode, EvalScope, EvalScopeFlags, FunctionKind, RuntimeErrorKind};
use crate::ir::{BlockId, Edge, EvalScopeId, StringId, ValueId, VariableKey};
use crate::lower::call::{self, Arguments, Callee};
use crate::lower::{FileLowering, FunctionLowering, commonjs, expression};
use crate::modules::ModuleKind;
use smallvec::smallvec;
use std::rc::Rc;

#[derive(Clone)]
pub(in crate::lower) struct NamesOfFileForEvals {
    listed_once: Option<EvalScopeId>,
    handed_over: Rc<[SymbolId]>,
}

/// `left + "suffix"`
#[derive(Copy, Clone)]
struct JoinedText {
    expression: ExprId,
    left: ExprId,
    right: ExprId,
    suffix: Atom,
}

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
    let ExprKind::Call(call_id) = hir[call].kind else {
        unreachable!("lower_direct_eval takes a Call expression");
    };
    let site = hir[call_id];
    let callee = lowering.file.skip_type_syntax(site.callee);
    let callee_name = lowering.file.identifier_name(callee);
    lowering.set_position(hir[callee].pos);
    let (function, this) = lowering.lower_identifier_callee(callee);
    let joined = lowering.file.find_joined_text(call_id);
    let arguments = match joined {
        Some(joined) => Arguments::Values(smallvec![lowering.lower_expression(joined.left)]),
        None => lowering.lower_arguments(hir.written_args(call_id)),
    };
    lowering.set_position(hir[call].pos);
    let eval = lowering.emit_builtin_itself(BuiltinId::Eval);
    let is_eval = lowering.builder.strict_eq(function, eval);

    let direct = lowering.create_block();
    let ordinary = lowering.create_block();
    let join = lowering.create_block();
    let result = lowering.builder.add_parameter(join, None);
    let other_function = lowering.builder.add_edge_result(ordinary);
    let ordinary_edge = Edge::with_proofs(ordinary, &[0]);
    lowering
        .builder
        .branch(is_eval, Edge::to(direct), ordinary_edge);

    lowering.continue_in(direct);
    let evaluated = match lowering.file.find_binding_named_by_text(call, site.args) {
        Some((binding, name)) => {
            lowering.builder.check_evaluation(false);
            lowering.read_binding(binding, name, BindingRead::Value)
        }
        None => {
            let arguments = lowering.lower_known_evaluations(call_id, &arguments, joined, join);
            match hir.is_settled_eval(call_id) {
                true => lowering.emit_settled_eval_end(call_id, &arguments, join),
                false => lowering.emit_direct_eval(call, &arguments),
            }
        }
    };
    lowering.jump_with(join, &[evaluated]);

    lowering.continue_in(ordinary);
    let name = Some(lowering.file.intern_atom(callee_name));
    let callee = Callee::without_key(other_function, this, name);
    let arguments = match joined {
        Some(joined) => lowering.join_text(joined, &arguments),
        None => arguments,
    };
    let returned = call::emit_call_of(lowering, callee, arguments);
    lowering.jump_with(join, &[returned]);

    lowering.continue_in(join);
    result
}

impl FileLowering<'_, '_, '_, '_> {
    /// What `call` evaluates, where every known string ends as it does: the strings are told apart by the left operand.
    fn find_joined_text(&self, call: CallId) -> Option<JoinedText> {
        let hir = self.hir;
        let known = hir.known_evaluations_of(call);
        if known.is_empty() {
            return None;
        }
        let mut written = hir.ids(hir.written_args(call));
        let (expression, None) = (written.next()?, written.next()) else {
            return None;
        };
        let ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } = hir[expression].kind
        else {
            return None;
        };
        let ExprKind::String(suffix) = hir[right].kind else {
            return None;
        };
        let end = self.queries.atom_bytes(suffix);
        let ends_as_joined = |it: &KnownEvaluation| {
            let mut texts = hir.ids(it.arguments);
            let text = texts.next();
            text.is_some_and(|text| self.queries.atom_bytes(text).ends_with(end))
        };
        let is_joined = !end.is_empty() && known.iter().all(ends_as_joined);
        is_joined.then_some(JoinedText {
            expression,
            left,
            right,
            suffix,
        })
    }

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
        let mut constructor_symbols = bound.ids(eval_scope.constructor_symbols);
        if constructor_symbols.any(|symbol| self.find_spelled_name(symbol) == name) {
            return None;
        }
        let mut symbols = bound.ids(eval_scope.symbols);
        let symbol = symbols.find(|&symbol| self.find_spelled_name(symbol) == name);
        if let Some(symbol) = symbol.or_else(|| self.find_name_of_file(eval_scope, name)) {
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

    fn find_name_of_file(&self, eval_scope: &bind::EvalScope, name: Atom) -> Option<SymbolId> {
        let by_text = self.modules.names_of_file_by_text.get_or_init(|| {
            let names = self.bound.ids(eval_scope.file_symbols);
            names
                .map(|symbol| (self.find_spelled_name(symbol), symbol))
                .collect()
        });
        by_text.get(&name).copied()
    }

    fn compute_eval_context(&self, scope: ScopeId) -> EvalContext {
        let (hir, bound) = (self.hir, self.bound);
        let unit = match bound.code_unit(scope) {
            CodeUnit::FieldInitializer(member) if bound.is_field_assigned_behind_class(member) => {
                let class = bound.member_class(member);
                let class = class.expect("a field initializer belongs to a member of a class");
                bound.code_unit(bound.class_scope[class.idx()])
            }
            unit => unit,
        };
        let arrow_flags = match unit {
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
                let mut flags = compute_function_flags(kind, is_derived);
                if kind == FnKind::Constructor
                    && !arrow_flags.contains(EvalScopeFlags::IS_IN_ARROW_FUNCTION)
                {
                    flags |= EvalScopeFlags::ALLOWS_SUPER_CALL;
                }
                (flags, Some(this_scope), bound.function_class(function))
            }
            CodeUnit::FieldInitializer(member) => {
                let flags = match self.is_code_of_constructor(this_scope) {
                    true => compute_function_flags(FnKind::Method, false),
                    false => compute_initializer_flags(),
                };
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
    fn join_text(&mut self, joined: JoinedText, left: &Arguments) -> Arguments {
        let Arguments::Values(left) = left else {
            unreachable!("the left operand is one value");
        };
        let right = self.lower_expression(joined.right);
        self.set_position(self.file.hir[joined.expression].pos);
        let text = self.emit_binary(BinOp::Add, left[0], right);
        Arguments::Values(smallvec![text])
    }

    /// Where the string is one that the build has compiled, jumps to `join` with what it evaluates to. Returns the arguments.
    fn lower_known_evaluations(
        &mut self,
        call: CallId,
        arguments: &Arguments,
        joined: Option<JoinedText>,
        join: BlockId,
    ) -> Arguments {
        let hir = self.file.hir;
        let all = hir.known_evaluations_of(call).iter();
        let known: Vec<_> = all.filter(|it| hir.is_valid_evaluation(it)).collect();
        let first = match known.is_empty() {
            true => None,
            false => self.emit_evaluated_string(arguments),
        };
        let Some(first) = first else {
            return match joined {
                Some(joined) => self.join_text(joined, arguments),
                None => arguments.clone(),
            };
        };
        let texts = known.iter().filter_map(|it| hir.ids(it.arguments).next());
        let texts: Vec<Atom> = texts.collect();
        let blocks: Vec<BlockId> = known.iter().map(|_| self.create_block()).collect();
        let edges: Vec<Edge<'static>> = blocks.iter().map(|&block| Edge::to(block)).collect();
        let other = self.create_block();
        let mut arguments = arguments.clone();
        let mut text = first;
        if let Some(joined) = joined {
            let suffix = self.file.queries.atom_bytes(joined.suffix).len();
            let strings: Vec<StringId> = texts
                .iter()
                .map(|&text| {
                    let text = self.file.queries.atom_bytes(text);
                    let left = text[..text.len() - suffix].to_vec();
                    self.file.intern_bytes(&left)
                })
                .collect();
            let unmatched = self.create_block();
            self.builder
                .switch_string(first, &strings, &edges, Edge::to(unmatched));
            self.continue_in(unmatched);
            arguments = self.join_text(joined, &arguments);
            if let Arguments::Values(values) = &arguments {
                text = values[0];
            }
        }
        let strings: Vec<StringId> = texts
            .iter()
            .map(|&text| self.file.intern_atom(text))
            .collect();
        self.builder
            .switch_string(text, &strings, &edges, Edge::to(other));
        for (evaluation, block) in known.into_iter().zip(blocks) {
            self.continue_in(block);
            self.set_position(hir[hir[call].callee].pos);
            self.builder.check_evaluation(false);
            let mut value = self.lower_expression(evaluation.function);
            if evaluation.is_called() {
                self.set_position(hir[hir[call].callee].pos);
                value = call::emit_call_by_eval(self, value, None);
            }
            self.jump_with(join, &[value]);
        }
        self.continue_in(other);
        arguments
    }

    fn emit_settled_eval_end(
        &mut self,
        call: CallId,
        arguments: &Arguments,
        join: BlockId,
    ) -> ValueId {
        let hir = self.file.hir;
        let known = hir.known_evaluations_of(call).iter();
        self.set_position(hir[hir[call].callee].pos);
        self.builder.check_evaluation(false);
        let name = self.file.intern_atom(known::eval);
        let refused: Vec<_> = known.filter(|it| !hir.is_valid_evaluation(it)).collect();
        let text = match refused.is_empty() {
            true => None,
            false => self.emit_evaluated_string(arguments),
        };
        if let Some(text) = text {
            let texts = refused.iter().filter_map(|it| hir.ids(it.arguments).next());
            let strings: Vec<StringId> = texts.map(|text| self.file.intern_atom(text)).collect();
            let blocks: Vec<BlockId> = refused.iter().map(|_| self.create_block()).collect();
            let edges: Vec<Edge<'static>> = blocks.iter().map(|&block| Edge::to(block)).collect();
            let other = self.create_block();
            self.builder
                .switch_string(text, &strings, &edges, Edge::to(other));
            let flags = match self.builder.function().kind {
                FunctionKind::Arrow => EvalScopeFlags::IS_IN_ARROW_FUNCTION,
                _ => EvalScopeFlags::default(),
            };
            let scope = self.file.fragment.add_eval_scope(EvalScope {
                mode: self.mode(),
                flags,
                ..EvalScope::default()
            });
            for (evaluation, block) in refused.into_iter().zip(blocks) {
                self.continue_in(block);
                let this_value = self.builder.undefined();
                let value = (self.builder).direct_eval(scope, text, this_value, None, &[]);
                match self.file.needs_no_scope(evaluation) {
                    true => self.jump_with(join, &[value]),
                    false => self.builder.jump(Edge::to(other)),
                }
            }
            self.continue_in(other);
        }
        self.emit_throw_runtime_error(RuntimeErrorKind::OmittedFromExecutable, Some(name));
        self.builder.undefined()
    }

    fn list_names_of_file(&mut self, eval_scope: bind::EvalScope) -> NamesOfFileForEvals {
        if let Some(names) = &self.file.modules.names_of_file_for_evals {
            return names.clone();
        }
        let (bindings, handed_over) = self.collect_bindings_of_file(eval_scope);
        let listed_once = (!bindings.is_empty()).then(|| {
            self.file.fragment.add_eval_scope(EvalScope {
                bindings,
                ..EvalScope::default()
            })
        });
        let names = NamesOfFileForEvals {
            listed_once,
            handed_over: handed_over.into(),
        };
        self.file.modules.names_of_file_for_evals = Some(names.clone());
        names
    }

    fn emit_evaluated_string(&mut self, arguments: &Arguments) -> Option<ValueId> {
        match arguments {
            Arguments::Values(values) => values.first().copied(),
            Arguments::List(list) => {
                let index = self.builder.integer(0);
                Some(self.builder.elem_get(*list, index))
            }
        }
    }

    fn emit_direct_eval(&mut self, call: ExprId, arguments: &Arguments) -> ValueId {
        let Some(text) = self.emit_evaluated_string(arguments) else {
            return self.builder.undefined();
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
        let has_new_target = flags.contains(EvalScopeFlags::IS_IN_FUNCTION)
            || context
                .this_scope
                .is_some_and(|scope| self.file.is_code_of_constructor(scope));
        let new_target = has_new_target.then(|| self.get_new_target());
        let names_of_file = match eval_scope.is_in_global_code {
            true => NamesOfFileForEvals {
                listed_once: None,
                handed_over: Rc::default(),
            },
            false => self.list_names_of_file(eval_scope),
        };
        let handed_over = &names_of_file.handed_over;
        let (bindings, operands) =
            self.collect_eval_bindings(call, eval_scope, context, handed_over);
        let mode = if eval_scope.is_sloppy {
            ECMAMode::Sloppy
        } else {
            ECMAMode::Strict
        };
        let scope = self.file.fragment.add_eval_scope(EvalScope {
            mode,
            flags,
            bindings,
            outer: names_of_file.listed_once,
        });
        let own_file = self.file.file;
        let mark = self
            .file
            .ensure_variable(VariableKey::EvaluationMark(own_file));
        let yes = self.builder.boolean(true);
        self.builder.put_module_variable(mark, yes);
        self.builder
            .direct_eval(scope, text, this_value, new_target, &operands)
    }
}

fn compute_function_flags(kind: FnKind, is_derived: bool) -> EvalScopeFlags {
    let function = EvalScopeFlags::IS_IN_FUNCTION | EvalScopeFlags::ALLOWS_NEW_TARGET;
    let method = function | EvalScopeFlags::ALLOWS_SUPER_PROPERTY;
    match kind {
        FnKind::Decl | FnKind::Expr => function,
        FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::StaticBlock => method,
        FnKind::Constructor if is_derived => {
            method | EvalScopeFlags::IS_IN_DERIVED_CONSTRUCTOR | EvalScopeFlags::ALLOWS_SUPER_CALL
        }
        FnKind::Constructor => method,
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
