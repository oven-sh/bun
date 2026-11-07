use super::SourceDialect;
use super::mention_use::{MentionUse, lookup_passes_holder_linked_anew};
use super::module_values::reads_what_wrapper_hands_in;
use super::resolver::{ExprState, Resolver};
use crate::builtins::runtime_uses::{
    SyntaxWithHelpers, is_name_of_language_member_with_code, is_name_under_which_evaluator_hangs,
};
use crate::builtins::table::{self, BuiltinId, BuiltinName, Intrinsic};
use bun_core::strings;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingKind, BindingStability, Decl, Parent, PatParent, StoreKind, SymbolId,
};
use bun_sema::fold::{Constant, Decision, FoldedValue};
use bun_sema::hir::{
    self, BinOp, ExprId, ExprKind, Flags, FnKind, MemberKey, MemberKind, PatId, PatKind, PropKey,
    StmtKind, UnOp, VarDeclId, VarKind,
};
use bun_sema::hir_from_data::DataValue;
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
    names_that_spell_constructor: Vec<u32>,
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
        let spells_constructor = PropKey::Name(known::constructor);
        let properties = hir.props.iter();
        let properties = properties.filter(|property| property.key == spells_constructor);
        (syntax.names_that_spell_constructor).extend(properties.map(|property| property.start));
        let members = hir.enum_members.iter();
        let members = members.filter(|member| member.name == known::constructor);
        (syntax.names_that_spell_constructor).extend(members.map(|member| member.pos));
        for class in hir.classes.iter() {
            if class.name == known::constructor {
                syntax.names_that_spell_constructor.push(class.start);
            }
            let members = class.members.iter().filter(|&member| {
                hir.runtime_member_kind(member) != MemberKind::Constructor
                    && hir[member].key == spells_constructor
            });
            (syntax.names_that_spell_constructor).extend(members.map(|member| hir[member].start));
        }
        for function in hir.fns.iter() {
            if function.name == known::constructor
                && matches!(function.kind, FnKind::Decl | FnKind::Expr)
            {
                syntax.names_that_spell_constructor.push(function.start);
            }
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
                PatKind::Ident(name) if name == known::constructor => {
                    syntax.names_that_spell_constructor.push(pattern.pos);
                }
                _ => {}
            }
        }
        syntax.marks.sort_unstable_by_key(|mark| mark.0);
        syntax.dynamic_scopes.sort_unstable();
        syntax.names_that_spell_constructor.sort_unstable();
        syntax
            .object_patterns
            .sort_unstable_by_key(|pattern| pattern.0);
        syntax
            .written_targets
            .sort_unstable_by_key(|target| target.0);
        syntax
    }
}

fn names_asked_past_what_some_runs_create(
    input: &super::ResolveInput<'_, '_>,
) -> impl Iterator<Item = BuiltinName> {
    let (dialect, platform) = (input.dialect, input.platform);
    let created_in_some_runs = table::MEMBERS_CREATED_IN_SOME_RUNS.iter();
    created_in_some_runs.filter_map(move |&member| {
        let entry = table::entry(member);
        lookup_passes_holder_linked_anew(entry.holder?, Some(entry.name), dialect, platform)
            .then_some(entry.name)
    })
}

fn for_each_text_spelled_at(
    input: &super::ResolveInput<'_, '_>,
    expr: ExprId,
    mut note: impl FnMut(Atom),
) {
    match input.hir[expr].kind {
        ExprKind::JsxText(text) => note(text),
        ExprKind::Ident(name) if name == known::constructor => note(name),
        ExprKind::Template { .. } => {
            for part in input.hir.template_parts(expr) {
                if let Some(cooked) = part.cooked {
                    note(cooked);
                }
            }
        }
        _ => {}
    }
    if let FoldedValue::Constant(Constant::String(text))
    | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) =
        input.decisions.constant(input.hir, expr)
    {
        note(text);
    }
    match input.decisions.decision(expr) {
        Decision::Constant(Constant::String(text)) => note(text),
        Decision::Data(data) => for_each_text_spelled_in_data(data, &mut note),
        Decision::DeferredData => note(known::constructor),
        _ => {}
    }
}

fn for_each_text_spelled_in_data(data: &DataValue<'_>, note: &mut dyn FnMut(Atom)) {
    let mut waiting = vec![data];
    while let Some(value) = waiting.pop() {
        match *value {
            DataValue::String(text) => note(text),
            DataValue::Array(items) => waiting.extend(items),
            DataValue::Object(entries) => {
                for (key, value) in entries {
                    if *key == known::constructor {
                        note(*key);
                    }
                    waiting.push(value);
                }
            }
            _ => {}
        }
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
            self.note_texts_that_may_come_to_be_keys(expr);
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

    fn note_texts_that_may_come_to_be_keys(&mut self, expr: ExprId) {
        if self.input.dialect == SourceDialect::Program {
            for_each_text_spelled_at(self.input, expr, |text| {
                self.note_text_that_may_come_to_be_key(text, expr);
            });
        }
    }

    fn note_key_that_program_can_lay(&mut self, key: Atom) {
        if let Some(name) = self.input.names.get(key) {
            self.output.process_reaches_code_on_its_prototypes |=
                names_asked_past_what_some_runs_create(self.input).any(|asked| asked == name);
        }
    }

    pub(super) fn note_keys_that_program_can_lay(&mut self) {
        let input = self.input;
        if input.dialect != SourceDialect::Program {
            return;
        }
        self.output.process_reaches_code_on_its_prototypes |=
            names_asked_past_what_some_runs_create(input)
                .any(|name| strings::contains(&input.hir.text, table::text_of_name(name)));
        if !input.is_text_asked {
            for expr in self.evaluated_exprs() {
                for_each_text_spelled_at(input, expr, |text| {
                    self.note_key_that_program_can_lay(text);
                });
            }
        }
        let of_literals = input.hir.props.iter().map(|property| property.key);
        let of_classes = input.hir.members.iter().map(|member| member.key);
        for key in of_literals.chain(of_classes) {
            if let PropKey::Name(name) = key {
                self.note_key_that_program_can_lay(name);
            }
        }
    }

    fn is_written_as_key(&self, text: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let read = ExprId(text.0 + 1);
        if read.idx() < hir.exprs.len() && hir.is_written_in_brackets(read) {
            return true;
        }
        let Parent::Expr(user) = bound.parent_of_expr(self.outermost_assertion_of(text)) else {
            return false;
        };
        let text = hir.skip_type_assertions(text);
        match hir.written_kind(user) {
            ExprKind::Binary {
                op: BinOp::In,
                left,
                ..
            } => hir.skip_type_assertions(left) == text,
            ExprKind::Index { index, .. } => hir.skip_type_assertions(index) == text,
            _ => false,
        }
    }

    fn note_text_that_may_come_to_be_key(&mut self, text: Atom, at: ExprId) {
        if self
            .input
            .names
            .is_name_of_method_that_hands_out_global_object(text)
            && !self.is_written_as_key(at)
        {
            self.note_method_taken_off_value_nobody_knows(text);
        }
        self.note_text_under_which_evaluator_hangs(text);
    }

    fn note_text_under_which_evaluator_hangs(&mut self, text: Atom) {
        self.note_key_that_program_can_lay(text);
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

    fn note_method_taken_off_value_nobody_knows(&mut self, name: Atom) {
        let names = self.input.names;
        if self.input.dialect == SourceDialect::Program
            && names.is_name_of_method_that_hands_out_global_object(name)
        {
            self.output.method_that_hands_out_global_object_may_come_out = true;
            self.mention(BuiltinId::GlobalThis);
            self.expose(BuiltinId::GlobalThis);
        }
    }

    pub(super) fn spells_method_that_hands_out_global_object(&self) -> bool {
        let (hir, names) = (self.input.hir, self.input.names);
        let is_such = |name: Atom| names.is_name_of_method_that_hands_out_global_object(name);
        let is_key = |key: PropKey| match key {
            PropKey::Name(name) => is_such(name),
            PropKey::Computed(key) => self.constant_text(key).is_some_and(is_such),
            PropKey::None | PropKey::Private(_) => false,
        };
        let is_read_under_such_key = |&read: &ExprId| match hir.member_key(read) {
            Some((_, MemberKey::Computed(key))) => self.constant_text(key).is_some_and(is_such),
            _ => false,
        };
        let decisions = self.input.decisions;
        let decided = decisions
            .decided()
            .iter()
            .filter_map(|decided| match decided.1 {
                Decision::Constant(Constant::String(made)) => Some(made),
                _ => None,
            });
        self.input.dialect == SourceDialect::Program
            && (decided.into_iter().any(is_such)
                || self.computed.iter().any(is_read_under_such_key)
                || hir.props.iter().any(|property| is_key(property.key))
                || hir.pat_props.iter().any(|property| is_key(property.key))
                || (hir.template_parts.iter()).any(|part| part.cooked.is_some_and(is_such))
                || hir.exprs.iter().any(|expr| match expr.kind {
                    ExprKind::Dot { name, .. }
                    | ExprKind::String(name)
                    | ExprKind::JsxText(name) => is_such(name),
                    _ => false,
                }))
    }

    fn note_text_taken_by_pattern(&mut self, name: Atom) {
        self.output.may_call_evaluator |= name == known::constructor;
        self.note_method_taken_off_value_nobody_knows(name);
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
        let names = &syntax.names_that_spell_constructor;
        let first = names.partition_point(|&it| it < range.start);
        if self.input.dialect == SourceDialect::Program
            && names.get(first).is_some_and(|&it| it < range.end)
        {
            self.note_text_under_which_evaluator_hangs(known::constructor);
        }
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
                Some((_, MemberKey::Name(name))) => {
                    let names = self.input.names;
                    if names.is_name_of_method_that_hands_out_global_object(name)
                        && self.is_taken_as_value(expr)
                    {
                        self.note_method_taken_off_value_nobody_knows(name);
                    }
                    self.note_text_read(name);
                }
                Some((_, MemberKey::Computed(key))) => {
                    let is_only_looked_at = is_only_looked_at(self);
                    let text = self.constant_text(self.input.hir.skip_type_assertions(key));
                    if let Some(name) = text.filter(|_| self.is_taken_as_value(expr)) {
                        self.note_method_taken_off_value_nobody_knows(name);
                    }
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
