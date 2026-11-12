use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, ScopeId};
use bun_sema::fold::Constant;
use bun_sema::hir::{CallId, ExprId, ExprKind, KnownEvaluation, NodeData};
use rustc_hash::FxHashMap;

use super::{Arguments, Callee};
use crate::builtins::EvaluatedText;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, Edge, StringId, ValueId};
use crate::lower::expression::Tail;
use crate::lower::{FileLowering, FunctionLowering};

impl FileLowering<'_, '_, '_, '_> {
    fn list_known_functions(&self, call: CallId) -> Vec<KnownEvaluation> {
        let hir = self.hir;
        let all = hir.known_evaluations_of(call).iter();
        all.filter(|it| hir.is_valid_evaluation(it) && self.sees_only_global_scope(it))
            .copied()
            .collect()
    }

    /// The function that the file holds in place of the string is nested in the functions around the call.
    fn sees_only_global_scope(&self, evaluation: &KnownEvaluation) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let root = hir.skip_type_assertions(evaluation.function);
        let ExprKind::Fn(function) = hir[root].kind else {
            return false;
        };
        let own_scope = bound.fns[function.idx()].scope;
        let is_own = |scope: ScopeId| {
            let parent_of = |scope: &ScopeId| bound.scopes[scope.idx()].parent.some();
            std::iter::successors(scope.some(), parent_of).any(|it| it == own_scope)
        };
        let mut expressions = (evaluation.first_expression.0..root.0).map(ExprId);
        // `Function` doesn't take over that the code around the call is strict.
        let scope_around = bound.scopes[own_scope.idx()].parent;
        let is_strict_around = hir.is_strict || bound.is_strict_scope(scope_around);
        let is_strict = hir[function].is_strict;
        is_strict == hir[function].is_strict_by_syntax
            && (is_strict || !is_strict_around)
            && expressions.all(|e| match hir[e].kind {
                ExprKind::Ident(_) => {
                    bound.dynamic_lookup_scope(NodeData::Expr(e)).is_none()
                        && match bound.binding(e) {
                            Binding::Free | Binding::Arguments(_) => true,
                            Binding::CommonJs(_) => false,
                            Binding::Symbol(symbol) => is_own(bound.symbol_scope(symbol)),
                        }
                }
                _ => true,
            })
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_evaluated_text_call(
        &mut self,
        call: ExprId,
        text: &EvaluatedText,
        exit: Option<BlockId>,
        tail: Tail<'_>,
    ) -> ValueId {
        debug_assert_eq!(text.call, call, "the text belongs to another call");
        let hir = self.file.hir;
        let (ExprKind::Call(site) | ExprKind::New(site)) = hir[call].kind else {
            unreachable!("evaluated text is an argument of a Call or a New expression");
        };
        let site = hir[site];
        let is_construct = matches!(hir[call].kind, ExprKind::New(_));
        let callee = if is_construct {
            let function = self.lower_expression(site.callee);
            Callee::without_key(function, None, self.file.find_callee_name(site.callee))
        } else {
            let mut callee = self.lower_callee(site.callee, exit, None);
            callee.function = self.leave_chain_if_nullish(site, callee.function, exit);
            callee
        };
        let arguments = self.lower_arguments(site.args);
        self.emit_ordinary(call, is_construct, callee, arguments, tail)
    }

    /// `Function`, with strings that the build may have compiled.
    pub(super) fn lower_known_function_call(
        &mut self,
        call: ExprId,
        id: CallId,
        tail: Tail<'_>,
    ) -> ValueId {
        let hir = self.file.hir;
        let is_construct = matches!(hir[call].kind, ExprKind::New(_));
        let written = hir[id].callee;
        let callee = if is_construct {
            let function = self.lower_expression(written);
            Callee::without_key(function, None, self.file.find_callee_name(written))
        } else {
            self.lower_callee(written, None, None)
        };
        let arguments = self.lower_arguments(hir.written_args(id));
        let known = self.file.list_known_functions(id);
        let values = match &arguments {
            Arguments::Values(values) if !known.is_empty() => values.clone(),
            _ => return self.emit_ordinary(call, is_construct, callee, arguments, tail),
        };
        let Some((&body, parameters)) = values.split_last() else {
            return self.emit_ordinary(call, is_construct, callee, arguments, tail);
        };
        let function = self.emit_builtin_itself(BuiltinId::Function);
        let is_function = self.builder.strict_eq(callee.function, function);
        let by_text = self.create_block();
        let ordinary = self.create_block();
        let join = self.create_block();
        let result = self.builder.add_parameter(join, None);
        self.builder
            .branch(is_function, Edge::to(by_text), Edge::to(ordinary));

        self.continue_in(by_text);
        let mut by_body: Vec<(Atom, Vec<KnownEvaluation>)> = Vec::new();
        let mut places: FxHashMap<Atom, usize> = FxHashMap::default();
        for evaluation in known {
            let Some(text) = hir.ids(evaluation.arguments).next_back() else {
                continue;
            };
            let place = *places.entry(text).or_insert_with(|| {
                by_body.push((text, Vec::new()));
                by_body.len() - 1
            });
            by_body[place].1.push(evaluation);
        }
        let strings = by_body.iter().map(|it| self.file.intern_atom(it.0));
        let strings: Vec<StringId> = strings.collect();
        let blocks: Vec<BlockId> = by_body.iter().map(|_| self.create_block()).collect();
        let edges: Vec<Edge<'static>> = blocks.iter().map(|&block| Edge::to(block)).collect();
        self.builder
            .switch_string(body, &strings, &edges, Edge::to(ordinary));
        for ((_, evaluations), block) in by_body.into_iter().zip(blocks) {
            self.continue_in(block);
            for evaluation in evaluations {
                let other = self.create_block();
                for (&value, text) in parameters.iter().zip(hir.ids(evaluation.arguments)) {
                    let known_text = self.emit_constant(Constant::String(text));
                    let is_known = self.builder.strict_eq(value, known_text);
                    let same = self.create_block();
                    self.builder
                        .branch(is_known, Edge::to(same), Edge::to(other));
                    self.continue_in(same);
                }
                let function = self.lower_expression(evaluation.function);
                self.jump_with(join, &[function]);
                self.continue_in(other);
            }
            self.jump(ordinary);
        }

        self.continue_in(ordinary);
        let made = self.emit_ordinary(call, is_construct, callee, arguments, Tail::No);
        self.jump_with(join, &[made]);
        self.continue_in(join);
        result
    }

    fn emit_ordinary(
        &mut self,
        call: ExprId,
        is_construct: bool,
        callee: Callee,
        arguments: Arguments,
        tail: Tail<'_>,
    ) -> ValueId {
        if is_construct {
            self.emit_new_expression(call, callee, arguments)
        } else {
            self.emit_call_expression(call, callee, arguments, tail)
        }
    }
}
