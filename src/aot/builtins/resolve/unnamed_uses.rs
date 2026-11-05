use super::SourceDialect;
use super::mention_use::MentionUse;
use super::module_values::reads_what_wrapper_hands_in;
use super::resolver::{ExprState, Resolver};
use crate::builtins::runtime_uses::{
    SyntaxWithHelpers, is_name_of_language_member_with_code, is_name_under_which_evaluator_hangs,
};
use crate::builtins::table::{self, BuiltinId, BuiltinName, Intrinsic};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingKind, BindingStability, Decl, Parent, PatParent, StoreKind, SymbolId,
};
use bun_sema::fold::{Constant, Decision, FoldedValue};
use bun_sema::hir::{
    self, BinOp, ExprId, ExprKind, Flags, MemberKey, PatId, PatKind, PropKey, StmtKind, UnOp,
    VarDeclId, VarKind,
};
use core::ops::Range;

pub(super) const MOST_VARIABLES_FOLLOWED: u32 = 4;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Head {
    OfNoWalk,
    OfWalkOverNames,
    OfWalkOverValues,
}

#[derive(Default)]
pub(super) struct SyntaxOutsideExpressions {
    marks: Vec<(u32, SyntaxWithHelpers)>,
    dynamic_scopes: Vec<u32>,
    object_patterns: Vec<(u32, PatId)>,
    written_targets: Vec<(u32, ExprId)>,
}

fn within<'l, T>(list: &'l [(u32, T)], range: &Range<u32>) -> &'l [(u32, T)] {
    let start = list.partition_point(|entry| entry.0 < range.start);
    let end = list.partition_point(|entry| entry.0 < range.end);
    &list[start..end.max(start)]
}

impl SyntaxOutsideExpressions {
    pub(super) fn of(hir: &hir::File<'_>) -> SyntaxOutsideExpressions {
        let mut syntax = SyntaxOutsideExpressions::default();
        let decorators = hir.decorators.iter();
        (syntax.marks).extend(
            decorators.map(|&(_, written)| (hir[written].pos, SyntaxWithHelpers::DECORATOR)),
        );
        for declaration in hir.var_decls.iter() {
            let asked = match declaration.kind {
                VarKind::Using => SyntaxWithHelpers::DISPOSAL,
                VarKind::AwaitUsing => {
                    SyntaxWithHelpers::DISPOSAL
                        | SyntaxWithHelpers::ASYNC_DISPOSAL
                        | SyntaxWithHelpers::PROMISE
                }
                _ => continue,
            };
            syntax.marks.push((hir[declaration.pat].pos, asked));
        }
        for function in hir.fns.iter() {
            let mut asked = SyntaxWithHelpers::empty();
            if function.flags.contains(Flags::ASYNC) {
                asked |= SyntaxWithHelpers::PROMISE;
            }
            if function.flags.contains(Flags::GENERATOR) {
                asked |= SyntaxWithHelpers::GENERATOR;
            }
            if !asked.is_empty() {
                syntax.marks.push((function.start, asked));
            }
        }
        for statement in hir.stmts.iter() {
            let left = match statement.kind {
                StmtKind::ForOf { left, is_await, .. } => {
                    let awaits = match is_await {
                        true => SyntaxWithHelpers::PROMISE,
                        false => SyntaxWithHelpers::empty(),
                    };
                    let asked = SyntaxWithHelpers::ITERATION | awaits;
                    syntax.marks.push((statement.start, asked));
                    left
                }
                StmtKind::ForIn { left, .. } => left,
                StmtKind::With { .. } => {
                    syntax.dynamic_scopes.push(statement.start);
                    continue;
                }
                _ => continue,
            };
            if let StmtKind::Expr(target) = hir[left].kind {
                syntax.written_targets.push((statement.start, target));
            }
        }
        for (id, pattern) in (0..).map(PatId).zip(hir.pats.iter()) {
            match pattern.kind {
                PatKind::Array(_) => {
                    (syntax.marks).push((pattern.pos, SyntaxWithHelpers::ITERATION))
                }
                PatKind::Object(_) => syntax.object_patterns.push((pattern.pos, id)),
                _ => {}
            }
        }
        syntax.marks.sort_unstable_by_key(|mark| mark.0);
        syntax.dynamic_scopes.sort_unstable();
        syntax
            .object_patterns
            .sort_unstable_by_key(|pattern| pattern.0);
        syntax
            .written_targets
            .sort_unstable_by_key(|target| target.0);
        syntax
    }
}

fn makes_number(op: BinOp) -> bool {
    matches!(
        op,
        BinOp::Sub
            | BinOp::Mul
            | BinOp::Div
            | BinOp::Rem
            | BinOp::Pow
            | BinOp::Shl
            | BinOp::Shr
            | BinOp::UShr
            | BinOp::BitAnd
            | BinOp::BitOr
            | BinOp::BitXor
    )
}

impl Resolver<'_, '_> {
    fn collect_syntax_inside_expressions(&mut self) {
        for expr in self.evaluated_exprs() {
            self.note_texts_under_which_evaluators_hang(expr);
            self.output.may_hand_values_to_natives =
                self.output.may_hand_values_to_natives || !self.hands_natives_nothing_to_ask(expr);
            match self.state(expr) {
                ExprState::NotEvaluated => {}
                ExprState::Intrinsic(
                    Intrinsic::IteratorGenericNext
                    | Intrinsic::IteratorGenericClose
                    | Intrinsic::IfAbruptCloseIterator,
                ) => self.output.syntax |= SyntaxWithHelpers::ITERATION,
                _ if matches!(self.input.hir[expr].kind, ExprKind::This) => {
                    self.output.global_object_may_be_looked_through |=
                        self.may_be_global_object(expr);
                }
                _ => self.note_syntax_of_expression(self.input.hir[expr].kind),
            }
        }
    }

    fn hands_natives_nothing_to_ask(&self, expr: ExprId) -> bool {
        let is_bound_to_builtin =
            |expr: ExprId| matches!(self.state(expr), ExprState::Builtin(_) | ExprState::Held(_));
        match self.input.hir[expr].kind {
            _ if matches!(self.state(expr), ExprState::NotEvaluated) => true,
            _ if self.folds_to_primitive(expr) => true,
            ExprKind::Fn(_) => self.is_function_that_quiet_call_wants(expr),
            ExprKind::Ident(_) | ExprKind::Dot { .. } => {
                is_bound_to_builtin(expr)
                    && matches!(
                        self.classify_use(expr),
                        MentionUse::Holder | MentionUse::Called(_) | MentionUse::Inspected
                    )
            }
            ExprKind::Call(call) => {
                let hands_on_no_object = || {
                    let quiet = self.find_quiet_call(expr);
                    quiet.is_some_and(|quiet| self.hands_on_no_object(expr, quiet))
                };
                is_bound_to_builtin(self.input.hir[call].callee)
                    && (matches!(self.classify_use(expr), MentionUse::Inspected)
                        || hands_on_no_object())
            }
            _ => false,
        }
    }

    fn note_texts_under_which_evaluators_hang(&mut self, expr: ExprId) {
        let input = self.input;
        if input.dialect != SourceDialect::Program {
            return;
        }
        match input.hir[expr].kind {
            ExprKind::JsxText(text) => self.note_text_under_which_evaluator_hangs(text),
            ExprKind::Template { .. } => {
                for part in input.hir.template_parts(expr) {
                    if let Some(cooked) = part.cooked {
                        self.note_text_under_which_evaluator_hangs(cooked);
                    }
                }
            }
            _ => {}
        }
        if let FoldedValue::Constant(Constant::String(text))
        | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) =
            input.decisions.constant(input.hir, expr)
        {
            self.note_text_under_which_evaluator_hangs(text);
        }
        if let Decision::Constant(Constant::String(text)) = input.decisions.decision(expr) {
            self.note_text_under_which_evaluator_hangs(text);
        }
    }

    fn note_text_under_which_evaluator_hangs(&mut self, text: Atom) {
        self.output.reads_name_leading_to_hook_of_instanceof |=
            self.input.names.leads_to_hook_of_instanceof(text);
        let name = self.input.names.find_name_of_language_member(text);
        if let Some(name) = name.filter(|&name| is_name_under_which_evaluator_hangs(name)) {
            self.output.members_read.push(name);
        }
    }

    fn note_syntax_of_expression(&mut self, kind: ExprKind) {
        match kind {
            ExprKind::Spread(_) | ExprKind::Yield { star: true, .. } => {
                self.output.syntax |= SyntaxWithHelpers::ITERATION;
            }
            ExprKind::Await(_) => self.output.syntax |= SyntaxWithHelpers::PROMISE,
            ExprKind::ImportCall { .. } => {
                self.output.syntax |= SyntaxWithHelpers::PROMISE | SyntaxWithHelpers::IMPORT_CALL;
            }
            ExprKind::Assign {
                op: None, target, ..
            } if matches!(
                self.input.hir[target].kind,
                ExprKind::Array(_) | ExprKind::Object(_)
            ) =>
            {
                self.written_patterns.push(target);
            }
            _ => {}
        }
    }

    fn note_name_read(&mut self, name: BuiltinName) {
        if is_name_of_language_member_with_code(name) {
            self.output.members_read.push(name);
        }
    }

    fn note_text_taken_by_pattern(&mut self, name: Atom) {
        self.output.may_call_evaluator |= name == known::constructor;
        self.note_text_read(name);
    }

    pub(super) fn note_names_of_path(&mut self, path: &[Atom]) {
        if !self.input.is_text_asked {
            return;
        }
        for &name in path.iter().skip(1) {
            self.note_text_taken_by_pattern(name);
        }
    }

    fn note_text_read(&mut self, name: Atom) {
        self.output.reads_name_leading_to_hook_of_instanceof |=
            self.input.names.leads_to_hook_of_instanceof(name);
        if let Some(name) = self.input.names.find_name_of_language_member(name) {
            self.output.members_read.push(name);
        }
    }

    fn head_of(&self, declaration: VarDeclId) -> Head {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let head = bound.var_stmt[declaration.idx()];
        let Parent::Stmt(walk) = bound.parent_of_stmt(head) else {
            return Head::OfNoWalk;
        };
        match hir[walk].kind {
            StmtKind::ForIn { left, .. } if left == head => Head::OfWalkOverNames,
            StmtKind::ForOf { left, .. } if left == head => Head::OfWalkOverValues,
            _ => Head::OfNoWalk,
        }
    }

    fn declarations_of(&self, variable: SymbolId) -> Option<impl Iterator<Item = VarDeclId>> {
        let bound = self.input.bound;
        let is_variable = matches!(
            bound.binding_kind(variable),
            BindingKind::Var | BindingKind::Let | BindingKind::Const
        );
        let declaration_of = |declaration: &Decl| match *declaration {
            Decl::Var(name) => match bound.pat_parent[name.idx()] {
                PatParent::Var(declaration) => Some(declaration),
                _ => None,
            },
            _ => None,
        };
        let declarations = bound.symbol(variable).decls;
        let is_stored_under_its_name_alone = matches!(
            bound.binding_stability(variable),
            BindingStability::Stable
                | BindingStability::Stored
                | BindingStability::NotInitializedOnce
        );
        let mut redeclared = bound.runtime.redeclared_commonjs_variables().iter();
        let is_plain = is_variable
            && is_stored_under_its_name_alone
            && !bound.is_appended_symbol(variable)
            && !redeclared.any(|it| {
                it.0 == variable && reads_what_wrapper_hands_in(self.input.hir, bound, variable)
            })
            && declarations.iter().all(|it| declaration_of(it).is_some());
        is_plain.then(|| declarations.iter().filter_map(declaration_of))
    }

    fn holds_numbers_alone(&self, variable: SymbolId, followed: u32) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        if followed == MOST_VARIABLES_FOLLOWED {
            return false;
        }
        let Some(mut declarations) = self.declarations_of(variable) else {
            return false;
        };
        let mut stores = bound.stores_to(variable).iter();
        declarations.all(|declaration| {
            let first = hir[declaration].init.some();
            self.head_of(declaration) == Head::OfNoWalk
                && first.is_none_or(|first| self.is_number_by_syntax(first, followed + 1))
        }) && stores.all(|store| match store.kind {
            StoreKind::Update(_) => true,
            StoreKind::CompoundAssign(op) if makes_number(op) => true,
            StoreKind::Assign | StoreKind::CompoundAssign(BinOp::Add) => {
                match bound.parent_of_expr(self.outermost_assertion_of(store.target)) {
                    Parent::Expr(assignment) => match hir[assignment].kind {
                        ExprKind::Assign { value, .. } => {
                            self.is_number_by_syntax(value, followed + 1)
                        }
                        _ => false,
                    },
                    _ => false,
                }
            }
            StoreKind::CompoundAssign(_)
            | StoreKind::Destructure
            | StoreKind::ForIn
            | StoreKind::ForOf => false,
        })
    }

    fn is_number_by_syntax(&self, value: ExprId, followed: u32) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let value = hir.skip_type_assertions(value);
        let is_of_program = self.input.dialect == SourceDialect::Program;
        match hir[value].kind {
            ExprKind::Number(_) => true,
            ExprKind::BigInt(_) => !is_of_program,
            ExprKind::Unary { op: UnOp::Plus, .. } => true,
            ExprKind::Unary { op, operand } => {
                let keeps_kind = matches!(
                    op,
                    UnOp::Minus
                        | UnOp::BitNot
                        | UnOp::PreInc
                        | UnOp::PreDec
                        | UnOp::PostInc
                        | UnOp::PostDec
                );
                keeps_kind && (!is_of_program || self.is_number_by_syntax(operand, followed))
            }
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => {
                self.is_number_by_syntax(left, followed)
                    && self.is_number_by_syntax(right, followed)
            }
            ExprKind::Binary {
                op: BinOp::UShr, ..
            } => true,
            ExprKind::Binary { op, left, right } => {
                makes_number(op)
                    && (!is_of_program
                        || self.is_number_by_syntax(left, followed)
                        || self.is_number_by_syntax(right, followed))
            }
            ExprKind::Ident(_) => match bound.binding(value) {
                Binding::Symbol(variable) => self.holds_numbers_alone(variable, followed),
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
            },
            _ => false,
        }
    }

    fn note_key_read_by_pattern(&mut self, key: ExprId) {
        let key_without_assertions = self.input.hir.skip_type_assertions(key);
        let folded = self
            .input
            .decisions
            .constant(self.input.hir, key_without_assertions);
        let is_name = self.symbol_that_key_is(key).is_some() || folded != FoldedValue::Unknown;
        self.output.reads_by_unknown_key |= !is_name;
        self.note_key_read(key, false);
    }

    fn note_key_read(&mut self, key: ExprId, is_only_looked_at: bool) {
        let input = self.input;
        if let Some((_, symbol)) = self.symbol_that_key_is(key) {
            return self.note_name_read(table::name_of_symbol(symbol));
        }
        let key = input.hir.skip_type_assertions(key);
        match input.decisions.constant(input.hir, key) {
            FoldedValue::Constant(Constant::String(name))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(name)) => {
                self.output.may_call_evaluator |= name == known::constructor && !is_only_looked_at;
                self.note_text_read(name);
            }
            FoldedValue::Constant(Constant::BigInt(_))
            | FoldedValue::ConstantOutsideDeadZone(Constant::BigInt(_)) => {
                self.output.reads_by_unknown_key |= input.dialect == SourceDialect::Program;
            }
            FoldedValue::Constant(_) | FoldedValue::ConstantOutsideDeadZone(_) => {}
            FoldedValue::Unknown => {
                self.output.reads_by_unknown_key |= !self.is_number_by_syntax(key, 0);
            }
        }
    }

    fn note_names_of_written_pattern(&mut self, pattern: ExprId) {
        let hir = self.input.hir;
        let mut waiting = vec![pattern];
        while let Some(pattern) = waiting.pop() {
            match hir[hir.skip_type_assertions(pattern)].kind {
                ExprKind::Array(items) => {
                    self.output.syntax |= SyntaxWithHelpers::ITERATION;
                    waiting.extend(hir.ids(items));
                }
                ExprKind::Object(properties) => {
                    for property in properties.iter() {
                        let property = &hir[property];
                        match property.key {
                            PropKey::Name(name) => self.note_text_taken_by_pattern(name),
                            PropKey::Computed(key) => self.note_key_read_by_pattern(key),
                            PropKey::None | PropKey::Private(_) => {}
                        }
                        waiting.extend(property.value.some());
                    }
                }
                ExprKind::Assign { target, .. } | ExprKind::Spread(target) => waiting.push(target),
                _ => {}
            }
        }
    }

    fn note_syntax_outside_expressions(
        &mut self,
        syntax: &SyntaxOutsideExpressions,
        range: &Range<u32>,
    ) {
        let hir = self.input.hir;
        for &(_, asked) in within(&syntax.marks, range) {
            self.output.syntax |= asked;
        }
        let first = syntax
            .dynamic_scopes
            .partition_point(|&it| it < range.start);
        let has_dynamic_scope =
            (syntax.dynamic_scopes.get(first)).is_some_and(|&it| it < range.end);
        self.output.reads_by_unknown_key |= has_dynamic_scope;
        for &(_, target) in within(&syntax.written_targets, range) {
            self.written_patterns.push(target);
        }
        for &(_, pattern) in within(&syntax.object_patterns, range) {
            let PatKind::Object(properties) = hir[pattern].kind else {
                continue;
            };
            for property in properties.iter() {
                match hir[property].key {
                    PropKey::Name(name) => self.note_text_taken_by_pattern(name),
                    PropKey::Computed(key) => self.note_key_read_by_pattern(key),
                    PropKey::None | PropKey::Private(_) => {}
                }
            }
        }
    }

    fn collect_syntax_outside_expressions(&mut self) {
        let of_file;
        let syntax = match self.facts {
            Some(facts) => facts.syntax_outside_expressions(self.input.hir),
            None => {
                of_file = SyntaxOutsideExpressions::of(self.input.hir);
                &of_file
            }
        };
        match self.ranges() {
            Some(ranges) => {
                for range in ranges {
                    self.note_syntax_outside_expressions(syntax, range);
                }
            }
            None => self.note_syntax_outside_expressions(syntax, &(0..u32::MAX)),
        }
        for pattern in core::mem::take(&mut self.written_patterns) {
            self.note_names_of_written_pattern(pattern);
        }
    }

    fn collect_members_read(&mut self) {
        for index in 0..self.computed.len() {
            let expr = self.computed[index];
            match self.state(expr) {
                ExprState::Intrinsic(Intrinsic::Apply) => {
                    let apply = table::entry(BuiltinId::FunctionPrototypeApply).name;
                    self.output.members_read.push(apply);
                    continue;
                }
                ExprState::Intrinsic(Intrinsic::SymbolKey(symbol)) => {
                    self.note_name_read(table::name_of_symbol(symbol));
                    continue;
                }
                ExprState::Builtin(_) | ExprState::Held(_) | ExprState::Intrinsic(_) => continue,
                _ => {}
            }
            let is_only_looked_at = |resolver: &Self| {
                matches!(
                    resolver.classify_use(expr),
                    MentionUse::Holder | MentionUse::Inspected
                )
            };
            match self.input.hir.member_key(expr) {
                Some((_, MemberKey::Name(name))) if name == known::constructor => {
                    self.output.may_call_evaluator |= !is_only_looked_at(self);
                    self.note_text_read(name);
                }
                Some((_, MemberKey::Name(name))) => self.note_text_read(name),
                Some((_, MemberKey::Computed(key))) => {
                    let is_only_looked_at = is_only_looked_at(self);
                    self.note_key_read(key, is_only_looked_at);
                }
                Some((_, MemberKey::PrivateName(_))) | None => {}
            }
        }
    }

    pub(super) fn asks_for_symbol_that_host_ignores(&self, call: ExprId, id: BuiltinId) -> bool {
        let input = self.input;
        if table::canonical_id(id) != BuiltinId::SymbolFor {
            return false;
        }
        let ExprKind::Call(call) = input.hir[call].kind else {
            return false;
        };
        let Some(operand) = input.hir.ids(input.hir[call].args).next() else {
            return false;
        };
        let operand = input.hir.skip_type_assertions(operand);
        match input.decisions.constant(input.hir, operand) {
            FoldedValue::Constant(Constant::String(text))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => {
                !input.names.is_text_of_symbol_that_host_looks_for(text)
            }
            _ => false,
        }
    }

    pub(super) fn collect_what_is_reached_without_a_name(&mut self) {
        self.collect_syntax_inside_expressions();
        self.collect_syntax_outside_expressions();
        self.collect_members_read();
    }
}
