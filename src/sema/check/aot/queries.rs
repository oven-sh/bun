use super::answers::{
    CallTarget, CheckedMember, CheckedType, ClassDeclaration, ClassRef, ClassShape, EnumConstant,
    FunctionRef, GaveUp, IndexSignature, ListedMember, MemberLookup, ObjectMember, PositionTypes,
    QueryStatistics, SignatureShape, TypeDisplayName, WrittenType,
};
use super::builtin_types::BuiltinTypeSymbols;
use super::declared_signatures::DeclaredSignatures;
use super::inferred_from_use::{ReferenceIndex, Subject, TypeState, TypesInProgress, UsageState};
use super::kept_answers::{
    GaveUpAnswers, KeptFact, KeptMemo, ObjectAnswers, TypeAnswers, TypeQuestion,
};
use super::prototype_links::NamedValues;
use super::type_identity::{ObjectOrigin, TypeIdentity};
use super::type_shape::{BuiltinShape, PrimitiveKinds, TypeShape};
use crate::atom::{Atom, known};
use crate::bind::{BindingKind, Bound, Decl, Parent, SymbolId};
use crate::check::jsx::{JsxName, JsxReferenceKind};
use crate::check::print::to_valid_utf8;
use crate::check::relate::Relation;
use crate::check::{Checker, ContextFlags, Requested, WORK_TRAP_DISARMED};
use crate::hir::{self, EnumMemberId, ExprId, ExprKind, FnId, ParamId, PatId, TypeNodeId};
use crate::program::{FileId, FileRole, Files, Sym};
use crate::session::Arena;
use crate::types::{EnumValue, SigId, TypeId, tf};
use crate::util::FxHashMap;
use std::hash::Hash;
use std::rc::Rc;

const MAX_RELATION_ENTRIES: i32 = 20_000;

#[derive(Copy, Clone)]
pub struct QueryInputs<'c> {
    pub roles: &'c [FileRole],
    pub checked_elsewhere: &'c [FileId],
    pub builtin_types: &'c BuiltinTypeSymbols,
    pub named_values: &'c dyn NamedValues,
    pub max_inference_nodes: u64,
}

pub struct Queries<'c, 'p, 's> {
    pub(super) c: &'c mut Checker<'p, 's>,
    pub(super) file: FileId,
    pub(super) arena: &'c Arena,
    pub(super) inputs: QueryInputs<'c>,
    pub(super) memo: Memo<'c>,
    pub(super) kept: KeptMemo<'c>,
    statistics: QueryStatistics,
    closed_cycles_before: u32,
    depth: u32,
    unstable_answers: u64,
    has_met_inferred_member: bool,
    flow_analysis_was_disabled: Vec<FileId>,
    had_run_out_of_stack: bool,
    pub(super) infers_nothing_from_use: bool,
}

#[derive(Default)]
pub(super) struct Memo<'c> {
    gave_up: GaveUpAnswers,
    members: FxHashMap<TypeId, Result<&'c [ObjectMember], GaveUp>>,
    checked_members: FxHashMap<TypeId, Result<&'c [CheckedMember], GaveUp>>,
    signature_results: FxHashMap<SigId, CheckedType>,
    signatures: FxHashMap<SigId, SignatureShape<'c>>,
    function_signatures: FxHashMap<FunctionRef, SignatureShape<'c>>,
    classes: FxHashMap<ClassDeclaration, Option<&'c ClassShape<'c>>>,
    own_constructor_function_shapes: FxHashMap<FunctionRef, Option<&'c ClassShape<'c>>>,
    variables: FxHashMap<Sym, WrittenType>,
    member_accesses: FxHashMap<ExprId, Result<MemberLookup, GaveUp>>,
    resolved_calls: FxHashMap<ExprId, Result<Option<CallTarget>, GaveUp>>,
    contextual_types: FxHashMap<ExprId, Result<Option<TypeId>, GaveUp>>,
    literal_contexts: FxHashMap<ExprId, TypeId>,
    pub(super) unwritten_forms: FxHashMap<(FileId, TypeNodeId), GaveUp>,
    pub(super) alias_forms: FxHashMap<Sym, AliasForm>,
    pub(super) reference_index: Option<ReferenceIndex<'c>>,
    pub(super) usages: FxHashMap<Subject, UsageState>,
    pub(super) inferred_types: FxHashMap<Subject, TypeState>,
    pub(super) types_in_progress: TypesInProgress,
    pub(super) declared_signatures: Option<Rc<DeclaredSignatures>>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum AliasForm {
    InProgress,
    Computed(Result<TypeId, GaveUp>),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum AliasScan {
    InProgress,
    MentionsUntrustedAlias,
    MentionsNone,
}

struct CutState {
    ran_out_of_stack: bool,
    flow_analysis_disabled: Vec<FileId>,
}

impl CutState {
    fn reason(&self) -> Option<GaveUp> {
        if self.ran_out_of_stack {
            Some(GaveUp::Unresolved)
        } else if !self.flow_analysis_disabled.is_empty() {
            Some(GaveUp::FlowAnalysisDisabled)
        } else {
            None
        }
    }
}

impl<'p, 's> Checker<'p, 's> {
    pub fn with_queries<R>(
        &mut self,
        file: FileId,
        inputs: QueryInputs<'_>,
        then: impl FnOnce(&mut Queries<'_, 'p, 's>) -> R,
    ) -> R {
        debug_assert!(
            self.is_type_checked && self.task.file == Some(file) && self.stack.is_empty()
        );
        if self.bound(file).has_types_that_depend_on_order() && !self.has_checked_source_file(file)
        {
            self.check_source_file_silently(file);
        }
        let (memo_of_checker, arena) = self.aot_answers.take();
        let closed_cycles_before = self.closed_cycle_count();
        let flow_analysis_was_disabled = std::mem::take(&mut self.flow_analysis_disabled);
        let had_run_out_of_stack = self.ran_out_of_stack.get();
        let mut queries = Queries {
            c: self,
            file,
            arena: &arena,
            inputs,
            memo: Memo::default(),
            kept: memo_of_checker,
            statistics: QueryStatistics::default(),
            closed_cycles_before,
            depth: 0,
            unstable_answers: 0,
            has_met_inferred_member: false,
            flow_analysis_was_disabled,
            had_run_out_of_stack,
            infers_nothing_from_use: false,
        };
        let answer = then(&mut queries);
        let memo_of_checker = std::mem::take(&mut queries.kept);
        drop(queries);
        // SAFETY: `Queries::arena`, which is that arena, is the only source of its references.
        let memo_of_checker = unsafe { memo_of_checker.outliving_its_borrow() };
        self.aot_answers.put_back(memo_of_checker, arena);
        answer
    }

    pub(super) fn count_limits_hit(&self) -> u64 {
        self.cuts() + self.instantiation_limit_hits
    }

    fn has_checked_source_file(&self, file: FileId) -> bool {
        match self.expected {
            Requested::All | Requested::Types => self.reports_semantic_errors(file),
            Requested::Syntactic | Requested::EarlyErrors | Requested::Declaration => false,
        }
    }
}

impl Drop for Queries<'_, '_, '_> {
    fn drop(&mut self) {
        self.c.flow_analysis_disabled = std::mem::take(&mut self.flow_analysis_was_disabled);
        self.c.ran_out_of_stack.set(self.had_run_out_of_stack);
        self.c.rechecked_exprs.clear();
        self.c.rechecked_members.clear();
        self.c.rejected_expressions.clear();
        self.c.work_trap = WORK_TRAP_DISARMED;
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub fn is_discarded(&self) -> bool {
        self.c.was_discarded()
    }

    pub fn note_idle(&mut self) {
        debug_assert!(self.depth == 0);
        self.c.idle_between_statements();
    }

    pub fn find_chain_longer_than(&mut self, maximum: u64) -> Option<u32> {
        let hir = self.hir();
        if hir.exprs.len() as u64 <= maximum {
            return None;
        }
        let mut links = vec![0u32; hir.exprs.len()];
        for (index, expression) in hir.exprs.iter().enumerate() {
            let (base, link) = match expression.kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => (obj, 1),
                ExprKind::Call(call) => (hir[call].callee, 1),
                ExprKind::NonNull(base) => (base, 0),
                _ => continue,
            };
            let Some(&links_of_base) = links[..index].get(base.idx()) else {
                continue;
            };
            links[index] = links_of_base + link;
            if u64::from(links[index]) > maximum {
                self.infers_nothing_from_use = true;
                return Some(expression.pos);
            }
        }
        None
    }

    fn take_cut_state(&mut self) -> CutState {
        self.c.rejected_expressions.clear();
        self.c.work_trap = WORK_TRAP_DISARMED;
        CutState {
            ran_out_of_stack: self.c.ran_out_of_stack.replace(false),
            flow_analysis_disabled: std::mem::take(&mut self.c.flow_analysis_disabled),
        }
    }

    fn restore_cut_state(&mut self, state: CutState) {
        self.c.ran_out_of_stack.set(state.ran_out_of_stack);
        self.c.flow_analysis_disabled = state.flow_analysis_disabled;
    }

    pub(super) fn ask<T>(
        &mut self,
        compute: impl FnOnce(&mut Self) -> Result<T, GaveUp>,
    ) -> Result<T, GaveUp> {
        debug_assert!(self.c.stack.is_empty());
        let is_outermost = self.depth == 0;
        let enclosing = self.take_cut_state();
        self.depth += 1;
        let computed = compute(self);
        self.depth -= 1;
        let own = self.take_cut_state();
        self.restore_cut_state(enclosing);
        let answer = match own.reason() {
            Some(reason) => Err(reason),
            None => computed,
        };
        if is_outermost {
            self.statistics.asked += 1;
        }
        if let Err(reason) = answer {
            self.note_gave_up(reason, is_outermost);
        }
        answer
    }

    fn note_gave_up(&mut self, reason: GaveUp, is_outermost: bool) {
        if !reason.is_function_of_key() {
            self.unstable_answers += 1;
        }
        let counts = match is_outermost {
            true => &mut self.statistics.gave_up,
            false => &mut self.statistics.members_gave_up,
        };
        counts[reason as usize] += 1;
    }

    pub(super) fn ask_written(
        &mut self,
        compute: impl FnOnce(&mut Self) -> WrittenType,
    ) -> WrittenType {
        let asked = self.ask(|queries| match compute(queries) {
            WrittenType::Written(ty) => Ok(Some(ty)),
            WrittenType::Unwritten => Ok(None),
            WrittenType::GaveUp(reason) => Err(reason),
        });
        match asked {
            Ok(Some(ty)) => WrittenType::Written(ty),
            Ok(None) => WrittenType::Unwritten,
            Err(reason) => WrittenType::GaveUp(reason),
        }
    }

    fn ask_expression<T>(
        &mut self,
        expression: ExprId,
        compute: impl FnOnce(&mut Self) -> Result<T, GaveUp>,
    ) -> Result<T, GaveUp> {
        self.ask(|queries| {
            queries.require_live_expression(expression)?;
            compute(queries)
        })
    }

    fn memoized<K: Copy + Eq + Hash, T: Copy>(
        &mut self,
        key: K,
        table: for<'m> fn(&'m mut Memo<'c>) -> &'m mut FxHashMap<K, Result<T, GaveUp>>,
        compute: impl FnOnce(&mut Self) -> Result<T, GaveUp>,
    ) -> Result<T, GaveUp> {
        if let Some(&stored) = table(&mut self.memo).get(&key) {
            return self.answer_as_known(stored);
        }
        let unstable_answers = self.unstable_answers;
        let answer = self.ask(compute);
        if self.unstable_answers == unstable_answers {
            table(&mut self.memo).insert(key, answer);
        }
        answer
    }

    fn answer_as_known<T>(&mut self, stored: Result<T, GaveUp>) -> Result<T, GaveUp> {
        if self.depth == 0 && stored.is_ok() {
            self.statistics.asked += 1;
            return stored;
        }
        self.ask(|_| stored)
    }

    pub(super) fn note_inferred_member(&mut self) {
        self.has_met_inferred_member = true;
    }

    fn noting_inferred_members<T>(&mut self, compute: impl FnOnce(&mut Self) -> T) -> (T, bool) {
        let had_met = std::mem::replace(&mut self.has_met_inferred_member, false);
        let computed = compute(self);
        let has_met = self.has_met_inferred_member;
        self.has_met_inferred_member |= had_met;
        (computed, has_met)
    }

    fn find_gave_up(&self, ty: TypeId, question: TypeQuestion) -> Option<GaveUp> {
        match self.memo.gave_up.is_empty() {
            true => None,
            false => self.memo.gave_up.get(&(ty, question)).copied(),
        }
    }

    fn kept_about_type<T: Copy>(
        &mut self,
        ty: TypeId,
        question: TypeQuestion,
        slot: for<'m> fn(&'m mut TypeAnswers<'c>) -> &'m mut Option<T>,
        compute: impl FnOnce(&mut Self) -> Result<T, GaveUp>,
    ) -> Result<T, GaveUp> {
        let row = self.kept.type_row(ty);
        if let Some(known) = *slot(self.kept.type_at(row)) {
            return self.answer_as_known(Ok(known));
        }
        if let Some(reason) = self.find_gave_up(ty, question) {
            return self.answer_as_known(Err(reason));
        }
        let unstable_answers = self.unstable_answers;
        let answer = self.ask(compute);
        if self.unstable_answers == unstable_answers {
            match answer {
                Ok(known) => *slot(self.kept.type_at(row)) = Some(known),
                Err(reason) => drop(self.memo.gave_up.insert((ty, question), reason)),
            }
        }
        answer
    }

    fn kept_about_object_type<T: Copy>(
        &mut self,
        ty: TypeId,
        question: TypeQuestion,
        slot: for<'m> fn(&'m mut ObjectAnswers<'c>) -> &'m mut Option<T>,
        compute: impl FnOnce(&mut Self) -> Result<T, GaveUp>,
    ) -> Result<T, GaveUp> {
        let row = self.kept.object_row(ty);
        if let Some(known) = *slot(self.kept.object_at(row)) {
            return self.answer_as_known(Ok(known));
        }
        if let Some(reason) = self.find_gave_up(ty, question) {
            return self.answer_as_known(Err(reason));
        }
        let unstable_answers = self.unstable_answers;
        let answer = self.ask(compute);
        if self.unstable_answers == unstable_answers {
            match answer {
                Ok(known) => *slot(self.kept.object_at(row)) = Some(known),
                Err(reason) => drop(self.memo.gave_up.insert((ty, question), reason)),
            }
        }
        answer
    }

    pub(super) fn find_known_identity(&self, ty: TypeId) -> Option<TypeIdentity> {
        self.kept.find_type(ty)?.identity
    }

    pub(super) fn remember_identity(
        &mut self,
        ty: TypeId,
        identity: TypeIdentity,
        unstable_answers: u64,
    ) {
        if self.unstable_answers == unstable_answers {
            let row = self.kept.type_row(ty);
            self.kept.type_at(row).identity = Some(identity);
        }
    }

    pub fn count_unstable_answers(&self) -> u64 {
        self.unstable_answers
    }

    pub fn find_kept_fact(&self, ty: TypeId, fact: KeptFact) -> Option<bool> {
        let bits = self.kept.find_type(ty)?.facts >> (fact as u8 * 2);
        (bits & 1 != 0).then_some(bits & 2 != 0)
    }

    pub fn keep_fact(
        &mut self,
        ty: TypeId,
        fact: KeptFact,
        holds: bool,
        unstable_answers: u64,
    ) -> bool {
        if self.unstable_answers != unstable_answers {
            return false;
        }
        let row = self.kept.type_row(ty);
        self.kept.type_at(row).facts |= (1 | u8::from(holds) << 1) << (fact as u8 * 2);
        true
    }

    fn memoized_record<K: Copy + Eq + Hash, T: Copy>(
        &mut self,
        key: K,
        table: for<'m> fn(&'m mut Memo<'c>) -> &'m mut FxHashMap<K, T>,
        compute: impl FnOnce(&mut Self) -> T,
    ) -> T {
        if self.depth == 0 {
            self.statistics.asked += 1;
        }
        if let Some(&stored) = table(&mut self.memo).get(&key) {
            return stored;
        }
        let unstable_answers = self.unstable_answers;
        self.depth += 1;
        let record = compute(self);
        self.depth -= 1;
        if self.unstable_answers == unstable_answers {
            table(&mut self.memo).insert(key, record);
        }
        record
    }

    pub fn file(&self) -> FileId {
        self.file
    }

    pub fn files(&self) -> &'p Files<'s> {
        self.c.files()
    }

    pub fn hir(&self) -> &'p hir::File<'s> {
        self.c.hir(self.file)
    }

    pub fn bound(&self) -> &'p Bound<'s> {
        self.c.bound(self.file)
    }

    pub fn atom_bytes(&self, atom: Atom) -> &'p [u8] {
        self.c.atoms().bytes(atom)
    }

    pub fn role(&self, file: FileId) -> FileRole {
        let role = self.inputs.roles.get(file.idx()).copied();
        role.unwrap_or(FileRole::TypesOnly)
    }

    pub fn is_stack_low(&self) -> bool {
        self.c.is_stack_low()
    }

    pub fn statistics(&self) -> QueryStatistics {
        QueryStatistics {
            closed_cycles: self
                .c
                .closed_cycle_count()
                .wrapping_sub(self.closed_cycles_before),
            ..self.statistics
        }
    }

    pub fn canonical_symbol(&self, file: FileId, symbol: SymbolId) -> Sym {
        let bound = self.c.bound(file);
        let is_variable_beside_declaration =
            bound.is_appended_symbol(symbol) && bound.binding_kind(symbol) == BindingKind::Var;
        if !is_variable_beside_declaration && let [decl] = bound.symbol(symbol).decls {
            let own = bound.symbol_of_declaration(*decl);
            if own.is_some() {
                return self.files().sym(file, own);
            }
        }
        self.files().sym(
            file,
            bound.export_symbol_of_value_symbol_if_exported(symbol),
        )
    }

    pub fn class_of_binding(&self, symbol: Sym) -> Option<ClassRef> {
        self.compute_class_of_binding(symbol)
    }

    pub fn expression_type(&mut self, expression: ExprId) -> CheckedType {
        self.ask_expression(expression, |queries| {
            let file = queries.file;
            let ty = queries.c.type_of_expr(file, expression);
            let is_flow_too_deep = queries.c.is_error_type(ty)
                && queries
                    .c
                    .p
                    .flows_too_deep
                    .get(&queries.c.task, &(file, expression))
                    .is_some();
            if is_flow_too_deep {
                return Err(GaveUp::FlowAnalysisDisabled);
            }
            queries.resolved(ty)
        })
    }

    pub fn predicted_expression_type(&mut self, expression: ExprId) -> CheckedType {
        let checked = self.expression_type(expression)?;
        self.ask(|queries| Ok(queries.infer_expression_type(expression, checked)))
    }

    pub fn contextual_type(&mut self, expression: ExprId) -> Result<Option<TypeId>, GaveUp> {
        self.memoized(
            expression,
            |memo| &mut memo.contextual_types,
            |queries| {
                queries.require_live_expression(expression)?;
                queries.compute_contextual_type(expression, false)
            },
        )
    }

    /// `contextual_type` of an expression whose value is never a promise. `return` in an async function is written under
    /// `Order | PromiseLike<Order>`: this answers `Order`.
    pub fn contextual_type_of_settled_value(
        &mut self,
        expression: ExprId,
    ) -> Result<Option<TypeId>, GaveUp> {
        self.ask_expression(expression, |queries| {
            queries.compute_contextual_type(expression, true)
        })
    }

    pub fn is_written_under_type_variable(&mut self, expression: ExprId) -> Result<bool, GaveUp> {
        self.ask_expression(expression, |queries| {
            let file = queries.file;
            let outer = queries.c.begin_recheck();
            let is_pushed = queries.push_enclosing_literal_context(expression);
            let plain = queries
                .c
                .contextual_type(file, expression, ContextFlags::empty());
            if is_pushed {
                queries.c.pop_contextual_type();
            }
            queries.c.end_recheck(outer);
            let Some(plain) = plain else {
                return Ok(false);
            };
            let plain = queries.without_nullish(plain)?;
            Ok(queries.c.flags(plain) & tf::INSTANTIABLE != 0)
        })
    }

    fn compute_contextual_type(
        &mut self,
        expression: ExprId,
        is_settled: bool,
    ) -> Result<Option<TypeId>, GaveUp> {
        let file = self.file;
        let outer = self.c.begin_recheck();
        let is_pushed = self.push_enclosing_literal_context(expression);
        let plain = self
            .c
            .contextual_type(file, expression, ContextFlags::empty());
        let apparent =
            self.c
                .apparent_type_of_contextual_type(file, expression, ContextFlags::empty());
        if is_pushed {
            self.c.pop_contextual_type();
        }
        self.c.end_recheck(outer);
        let (Some(mut plain), Some(mut apparent)) = (plain, apparent) else {
            return Ok(None);
        };
        if is_settled {
            plain = self.c.awaited(plain);
            apparent = self.c.awaited(apparent);
        }
        let plain = self.without_nullish(plain)?;
        let apparent = self.without_nullish(apparent)?;
        if plain == TypeId::NEVER || apparent == TypeId::NEVER {
            return Ok(None);
        }
        if self
            .c
            .every_type(plain, |c, member| c.flags(member) & tf::PRIMITIVE != 0)
        {
            return Ok(Some(plain));
        }
        Ok((!self.c.is_union(apparent)).then_some(apparent))
    }

    fn enclosing_literal(&self, expression: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.hir(), self.bound());
        let literal = match bound.parent_of_expr(expression) {
            Parent::Prop(property) => bound.prop_owner[property.idx()],
            Parent::Expr(outer) => outer,
            _ => return None,
        };
        let literal = literal.some()?;
        matches!(hir[literal].kind, ExprKind::Object(_) | ExprKind::Array(_)).then_some(literal)
    }

    fn push_enclosing_literal_context(&mut self, expression: ExprId) -> bool {
        let Some(literal) = self.enclosing_literal(expression) else {
            return false;
        };
        let Some(expected) = self.literal_context(literal) else {
            return false;
        };
        self.c
            .push_contextual_type(self.file, literal, Some(expected), true);
        true
    }

    fn literal_context(&mut self, literal: ExprId) -> Option<TypeId> {
        if let Some(&known) = self.memo.literal_contexts.get(&literal) {
            return Some(known);
        }
        if self.c.is_stack_low() || !self.c.flow_analysis_disabled.is_empty() {
            return None;
        }
        let is_pushed = self.push_enclosing_literal_context(literal);
        let expected = self
            .c
            .contextual_type(self.file, literal, ContextFlags::empty());
        if is_pushed {
            self.c.pop_contextual_type();
        }
        let expected = expected?;
        let is_final = self.c.flow_analysis_disabled.is_empty()
            && !self.c.ran_out_of_stack.get()
            && expected != TypeId::UNRESOLVED;
        if !is_final {
            return None;
        }
        self.memo.literal_contexts.insert(literal, expected);
        Some(expected)
    }

    pub fn jsx_attributes_type(&mut self, element: ExprId) -> Result<Option<TypeId>, GaveUp> {
        self.ask_expression(element, |queries| {
            queries.compute_jsx_attributes_type(element)
        })
    }

    fn compute_jsx_attributes_type(&mut self, element: ExprId) -> Result<Option<TypeId>, GaveUp> {
        let Some(declared) = self.find_jsx_props_type(element)? else {
            return Ok(None);
        };
        let declared = self.without_nullish(declared)?;
        if declared == TypeId::NEVER {
            return Ok(None);
        }
        let file = self.file;
        let outer = self.c.begin_recheck();
        let matching = self
            .c
            .discriminate_by_jsx_attributes(file, element, declared);
        self.c.end_recheck(outer);
        self.resolved(matching).map(Some)
    }

    fn find_jsx_props_type(&mut self, element: ExprId) -> Result<Option<TypeId>, GaveUp> {
        let (file, hir) = (self.file, self.hir());
        let ExprKind::Jsx(jsx) = hir[element].kind else {
            return Ok(None);
        };
        let Some(tag) = hir[jsx].tag.some() else {
            return Ok(None);
        };
        let location = self.c.jsx_opening_like(file, element);
        if let Some(name) = self.c.jsx_intrinsic_tag_name(file, tag) {
            return Ok(self.c.jsx_intrinsic_attributes(file, location, name));
        }
        let found = self.c.resolved_signature(file, element);
        let Some(signature) = found.sig else {
            return self.resolved(found.ret).map(|_| None);
        };
        let properties_name = match self.c.jsx_reference_kind(file, tag) {
            JsxReferenceKind::Component => {
                self.c
                    .jsx_name_from_container(file, location, known::ElementAttributesProperty)
            }
            JsxReferenceKind::Function | JsxReferenceKind::Mixed => JsxName::Missing,
        };
        Ok(match properties_name {
            JsxName::Missing => Some(
                self.c
                    .type_of_first_parameter_with_fallback(signature, TypeId::UNKNOWN),
            ),
            JsxName::Empty => Some(self.c.sig_return(signature)),
            JsxName::Name(name) => self.c.jsx_props_from_member(signature, name),
        })
    }

    pub fn without_nullish(&mut self, ty: TypeId) -> CheckedType {
        let ty = self.resolved(ty)?;
        Ok(self.c.filter(ty, |c, member| !c.is_nullish(member)))
    }

    pub fn union_of(&mut self, members: &[TypeId]) -> CheckedType {
        for &member in members {
            self.resolved(member)?;
        }
        Ok(self.c.union(members))
    }

    pub fn is_assignable(&mut self, source: TypeId, target: TypeId) -> Result<bool, GaveUp> {
        self.ask(|queries| {
            let source = queries.resolved(source)?;
            let target = queries.resolved(target)?;
            let checker = &mut *queries.c;
            let limits_hit = checker.count_limits_hit();
            checker.relation_entries_for_query = Some(MAX_RELATION_ENTRIES);
            let answer =
                checker.try_is_type_related_to(source, target, Relation::Assignable, false);
            checker.relation_entries_for_query = None;
            if checker.count_limits_hit() != limits_hit {
                return Err(GaveUp::ErrorType);
            }
            answer.map_err(|_| GaveUp::Unresolved)
        })
    }

    pub fn can_be_asserted(&mut self, source: TypeId, target: TypeId) -> Result<bool, GaveUp> {
        self.ask(|queries| {
            let source = queries.resolved(source)?;
            let target = queries.resolved(target)?;
            let mut is_comparable = |from, to| {
                queries
                    .c
                    .try_is_type_related_to(from, to, Relation::Comparable, false)
                    .map_err(|_| GaveUp::Unresolved)
            };
            Ok(is_comparable(target, source)? || is_comparable(source, target)?)
        })
    }

    pub fn member_access(&mut self, access: ExprId) -> Result<MemberLookup, GaveUp> {
        self.memoized(
            access,
            |memo| &mut memo.member_accesses,
            |queries| {
                queries.require_live_expression(access)?;
                queries.compute_member_access(access)
            },
        )
    }

    pub fn resolved_call(&mut self, call: ExprId) -> Result<Option<CallTarget>, GaveUp> {
        self.memoized(
            call,
            |memo| &mut memo.resolved_calls,
            |queries| {
                queries.require_live_expression(call)?;
                queries.compute_resolved_call(call)
            },
        )
    }

    pub fn constant_enum_access(&mut self, access: ExprId) -> Result<Option<EnumValue>, GaveUp> {
        self.ask_expression(access, |queries| {
            queries.compute_constant_enum_access(access)
        })
    }

    pub fn accessed_enum_member(&mut self, access: ExprId) -> Result<Option<EnumMemberId>, GaveUp> {
        self.ask_expression(access, |queries| {
            Ok(queries.compute_accessed_enum_member(access))
        })
    }

    pub fn enum_member_value(
        &mut self,
        member: EnumMemberId,
    ) -> Result<Option<EnumConstant>, GaveUp> {
        self.ask(|queries| Ok(queries.compute_enum_constant(queries.file, member)))
    }

    pub fn written_type(&mut self, node: TypeNodeId) -> WrittenType {
        self.ask_written(|queries| queries.compute_written_type(queries.file, node))
    }

    pub fn parameter_type(&mut self, parameter: ParamId) -> CheckedType {
        self.ask(|queries| {
            let file = queries.file;
            let function = queries.bound().param_fn[parameter.idx()];
            let is_this_parameter =
                function != FnId::NONE && queries.c.hir(file)[function].this_param == parameter;
            let ty = match is_this_parameter {
                true => queries.c.type_of_this_parameter(file, function),
                false => queries.c.type_of_param(file, parameter),
            };
            let ty = queries.resolved(ty)?;
            Ok(queries.infer_parameter_type(file, parameter, ty))
        })
    }

    pub fn binding_type(&mut self, pattern: PatId) -> CheckedType {
        self.ask(|queries| {
            let ty = queries.c.type_of_pat(queries.file, pattern);
            let ty = queries.resolved(ty)?;
            Ok(queries.infer_binding_type(pattern, ty))
        })
    }

    pub fn return_type(&mut self, function: FnId) -> CheckedType {
        self.ask(|queries| {
            let ty = queries.c.return_type_of_fn(queries.file, function);
            let ty = queries.resolved(ty)?;
            Ok(queries.infer_result_type(queries.file, function, ty))
        })
    }

    pub fn written_variable_type(&mut self, symbol: Sym) -> WrittenType {
        if let Some(&known) = self.kept.variables.get(&symbol) {
            if self.depth == 0 {
                self.statistics.asked += 1;
            }
            return known;
        }
        let was_known = self.memo.variables.contains_key(&symbol);
        let written = self.memoized_record(
            symbol,
            |memo| &mut memo.variables,
            |queries| queries.compute_written_variable_type(symbol),
        );
        let is_answer = !matches!(written, WrittenType::GaveUp(_));
        if !was_known && is_answer && self.memo.variables.remove(&symbol).is_some() {
            self.kept.variables.insert(symbol, written);
        }
        written
    }

    pub fn function_signature(&mut self, function: FunctionRef) -> SignatureShape<'c> {
        self.memoized_signature(
            function,
            |memo| &mut memo.function_signatures,
            |kept| &mut kept.function_signatures,
            |queries| queries.compute_function_signature(function),
        )
    }

    pub fn signature(&mut self, signature: SigId) -> SignatureShape<'c> {
        self.memoized_signature(
            signature,
            |memo| &mut memo.signatures,
            |kept| &mut kept.signatures,
            |queries| queries.compute_signature(signature),
        )
    }

    pub fn signature_result(&mut self, signature: SigId) -> CheckedType {
        if self.depth == 0 {
            self.statistics.asked += 1;
        }
        if let Some(known) = self.memo.signatures.get(&signature) {
            return known.result.checked;
        }
        if let Some(&known) = self.memo.signature_results.get(&signature) {
            return known;
        }
        let holds_everywhere_else = self.find_file_of_signature(signature) != Some(self.file);
        if holds_everywhere_else {
            if let Some(known) = self.kept.signatures.get(&signature) {
                return known.result.checked;
            }
            if let Some(&known) = self.kept.signature_results.get(&signature) {
                return Ok(known);
            }
        }
        let unstable_answers = self.unstable_answers;
        self.depth += 1;
        let result = self.compute_signature_result(signature);
        self.depth -= 1;
        if self.unstable_answers == unstable_answers {
            match result {
                Ok(known) if holds_everywhere_else => {
                    self.kept.signature_results.insert(signature, known);
                }
                Ok(_) | Err(_) => drop(self.memo.signature_results.insert(signature, result)),
            }
        }
        result
    }

    fn memoized_signature<K: Copy + Eq + Hash>(
        &mut self,
        key: K,
        table: for<'m> fn(&'m mut Memo<'c>) -> &'m mut FxHashMap<K, SignatureShape<'c>>,
        kept: for<'m> fn(&'m mut KeptMemo<'c>) -> &'m mut FxHashMap<K, SignatureShape<'c>>,
        compute: impl FnOnce(&mut Self) -> SignatureShape<'c>,
    ) -> SignatureShape<'c> {
        let file = self.file;
        let holds_everywhere_else = |shape: &SignatureShape<'c>| {
            shape
                .declaration
                .is_none_or(|function| function.file != file)
        };
        if let Some(&known) = kept(&mut self.kept).get(&key)
            && holds_everywhere_else(&known)
        {
            if self.depth == 0 {
                self.statistics.asked += 1;
            }
            return known;
        }
        let was_known = table(&mut self.memo).contains_key(&key);
        let shape = self.memoized_record(key, table, compute);
        if !was_known
            && holds_everywhere_else(&shape)
            && table(&mut self.memo).remove(&key).is_some()
        {
            kept(&mut self.kept).insert(key, shape);
        }
        shape
    }

    pub fn class_shape(&mut self, class: ClassRef) -> &'c ClassShape<'c> {
        let shape = self.memoized_record(
            ClassDeclaration::Class(class),
            |memo| &mut memo.classes,
            |queries| Some(queries.compute_class_shape(class)),
        );
        shape.expect("a class has a shape")
    }

    pub fn constructor_function_shape(
        &mut self,
        function: FunctionRef,
    ) -> Option<&'c ClassShape<'c>> {
        self.memoized_record(
            ClassDeclaration::Function(function),
            |memo| &mut memo.classes,
            |queries| queries.complete_constructor_function_shape(function),
        )
    }

    pub(super) fn own_constructor_function_shape(
        &mut self,
        function: FunctionRef,
    ) -> Option<&'c ClassShape<'c>> {
        self.memoized_record(
            function,
            |memo| &mut memo.own_constructor_function_shapes,
            |queries| queries.compute_constructor_function_shape(function),
        )
    }

    pub fn type_shape(&mut self, ty: TypeId) -> Result<TypeShape<'c>, GaveUp> {
        self.kept_about_type(
            ty,
            TypeQuestion::Shape,
            |answers| &mut answers.shape,
            |queries| queries.compute_type_shape(ty),
        )
    }

    pub fn accepted_primitives(&mut self, object_type: TypeId) -> Result<PrimitiveKinds, GaveUp> {
        self.kept_about_object_type(
            object_type,
            TypeQuestion::Primitives,
            |answers| &mut answers.primitives,
            |queries| queries.compute_accepted_primitives(object_type),
        )
    }

    pub(super) fn builtin_base(&mut self, ty: TypeId) -> Result<Option<TypeShape<'c>>, GaveUp> {
        self.kept_about_object_type(
            ty,
            TypeQuestion::BuiltinBase,
            |answers| &mut answers.builtin_base,
            |queries| queries.compute_builtin_base(ty),
        )
    }

    pub fn accepted_builtins(&mut self, object_type: TypeId) -> Result<&'c [BuiltinShape], GaveUp> {
        self.kept_about_object_type(
            object_type,
            TypeQuestion::AcceptedBuiltins,
            |answers| &mut answers.accepted_builtins,
            |queries| queries.compute_accepted_builtins(object_type),
        )
    }

    pub fn accepted_class_constructors(
        &mut self,
        object_type: TypeId,
    ) -> Result<&'c [ClassRef], GaveUp> {
        self.kept_about_object_type(
            object_type,
            TypeQuestion::AcceptedClassConstructors,
            |answers| &mut answers.accepted_class_constructors,
            |queries| queries.compute_accepted_class_constructors(object_type),
        )
    }

    pub fn object_members(&mut self, object_type: TypeId) -> Result<&'c [ObjectMember], GaveUp> {
        let row = self.kept.object_row(object_type);
        if let Some(known) = self.kept.object_at(row).members {
            return self.answer_as_known(Ok(known));
        }
        if let Some(&stored) = self.memo.members.get(&object_type) {
            return self.answer_as_known(stored);
        }
        let unstable_answers = self.unstable_answers;
        let (answer, has_inferred_member) = self.noting_inferred_members(|queries| {
            queries.ask(|queries| queries.compute_object_members(object_type))
        });
        if self.unstable_answers == unstable_answers {
            match answer {
                Ok(known) if !has_inferred_member => {
                    self.kept.object_at(row).members = Some(known);
                }
                Ok(_) | Err(_) => drop(self.memo.members.insert(object_type, answer)),
            }
        }
        answer
    }

    pub fn checked_members(&mut self, object_type: TypeId) -> Result<&'c [CheckedMember], GaveUp> {
        let row = self.kept.object_row(object_type);
        if let Some(known) = self.kept.object_at(row).checked_members {
            return self.answer_as_known(Ok(known));
        }
        if let Some(&stored) = self.memo.checked_members.get(&object_type) {
            return self.answer_as_known(stored);
        }
        let unstable_answers = self.unstable_answers;
        let computed = self.ask(|queries| queries.compute_checked_members(object_type));
        let answer = computed.map(|(members, _)| members);
        if self.unstable_answers == unstable_answers {
            match computed {
                Ok((known, false)) => self.kept.object_at(row).checked_members = Some(known),
                Ok((_, true)) | Err(_) => {
                    self.memo.checked_members.insert(object_type, answer);
                }
            }
        }
        answer
    }

    pub fn find_checked_member(
        &mut self,
        receiver: TypeId,
        name: Atom,
    ) -> Result<Option<CheckedMember>, GaveUp> {
        self.ask(|queries| queries.compute_find_checked_member(receiver, name))
    }

    pub fn listed_members(&mut self, object_type: TypeId) -> Result<&'c [ListedMember], GaveUp> {
        self.kept_about_object_type(
            object_type,
            TypeQuestion::ListedMembers,
            |answers| &mut answers.listed_members,
            |queries| queries.compute_listed_members(object_type),
        )
    }

    pub fn listed_member_types(
        &mut self,
        object_type: TypeId,
        member: ListedMember,
    ) -> PositionTypes {
        let row = self.kept.object_row(object_type);
        let index = member.property_index;
        if let Some(known) = self.kept.find_member_types(row, index) {
            return PositionTypes {
                written: self.written_as_known(known.written),
                checked: self.answer_as_known(known.checked),
            };
        }
        let unstable_answers = self.unstable_answers;
        let (types, is_inferred) = self.noting_inferred_members(|queries| {
            queries.compute_listed_member_types(object_type, member)
        });
        let is_answer = !matches!(types.written, WrittenType::GaveUp(_)) && types.checked.is_ok();
        if is_answer && !is_inferred && self.unstable_answers == unstable_answers {
            self.keep_member_types(object_type, index, types);
        }
        types
    }

    fn written_as_known(&mut self, written: WrittenType) -> WrittenType {
        debug_assert!(!matches!(written, WrittenType::GaveUp(_)));
        if self.depth == 0 {
            self.statistics.asked += 1;
            return written;
        }
        self.ask_written(|_| written)
    }

    fn keep_member_types(&mut self, object_type: TypeId, index: u32, types: PositionTypes) {
        let row = self.kept.object_row(object_type);
        if !self.kept.has_room_for_member_types(row) {
            let declared = self.declared_type_of_this(object_type);
            let count = self
                .c
                .members(declared)
                .map_or(0, |members| members.shape().props.len());
            self.kept.make_room_for_member_types(row, count as u32);
        }
        self.kept.keep_member_types(row, index, types);
    }

    pub fn index_signatures(
        &mut self,
        object_type: TypeId,
    ) -> Result<&'c [IndexSignature], GaveUp> {
        self.kept_about_object_type(
            object_type,
            TypeQuestion::IndexSignatures,
            |answers| &mut answers.index_signatures,
            |queries| queries.compute_index_signatures(object_type),
        )
    }

    pub fn find_member(&mut self, receiver: TypeId, name: Atom) -> Result<MemberLookup, GaveUp> {
        self.ask(|queries| queries.compute_find_member(receiver, name))
    }

    pub fn awaited_type(&mut self, ty: TypeId) -> CheckedType {
        self.kept_about_type(
            ty,
            TypeQuestion::Awaited,
            |answers| &mut answers.awaited,
            |queries| {
                let ty = queries.resolved(ty)?;
                let awaited = queries.c.awaited(ty);
                queries.resolved(awaited)
            },
        )
    }

    pub fn type_identity(&mut self, ty: TypeId) -> Result<TypeIdentity, GaveUp> {
        self.kept_about_type(
            ty,
            TypeQuestion::Identity,
            |answers| &mut answers.identity,
            |queries| queries.compute_type_identity(ty),
        )
    }

    pub fn object_origin(&mut self, object_type: TypeId) -> ObjectOrigin {
        self.compute_object_origin(object_type)
    }

    pub fn grows_along(&mut self, path: &[TypeId]) -> bool {
        const MAX_DEPTH: usize = 4;
        let Some(&ty) = path.last() else {
            return false;
        };
        let identity = self.c.recursion_identity_of_family(ty);
        let is_instantiation =
            |&on_path: &TypeId| self.c.recursion_identity_of_family(on_path) == identity;
        let family: Vec<TypeId> = path.iter().copied().filter(is_instantiation).collect();
        let Some(last) = family
            .len()
            .checked_sub(MAX_DEPTH)
            .map(|start| &family[start..])
        else {
            return false;
        };
        let types = self.c.types();
        let mut neighbors = last.iter().zip(last.iter().skip(1));
        neighbors.all(|(&outer, &inner)| types.nesting_order(inner, outer).is_gt())
    }

    pub fn type_text(&mut self, ty: TypeId) -> Vec<u8> {
        to_valid_utf8(self.c.type_to_string(ty))
    }

    pub fn type_name_site(&mut self, ty: TypeId) -> Option<(FileId, u32)> {
        let ObjectOrigin::Symbol(symbol) = self.object_origin(ty) else {
            return None;
        };
        self.find_first_type_name(symbol)
    }

    pub fn type_display_name(&mut self, ty: TypeId) -> Option<TypeDisplayName> {
        let ObjectOrigin::Symbol(symbol) = self.object_origin(ty) else {
            return None;
        };
        let (file, position) = self.find_first_type_name(symbol)?;
        Some(TypeDisplayName {
            text: self.type_text(ty),
            file,
            position,
        })
    }

    fn find_first_type_name(&self, symbol: Sym) -> Option<(FileId, u32)> {
        let declarations = self.files().decls_of(symbol);
        let names = declarations.iter().filter_map(|&(file, decl)| {
            let hir = self.c.hir(file);
            let position = match decl {
                Decl::Interface(id) => hir[id].name_pos,
                Decl::Alias(id) => hir[id].name_pos,
                Decl::Class(id) => hir[id].name_pos,
                _ => return None,
            };
            Some((file, position))
        });
        names.min()
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn list<T: Copy>(&self, items: &[T]) -> &'c [T] {
        match items.is_empty() {
            true => &[],
            false => self.arena.alloc_slice_copy(items),
        }
    }

    pub(super) fn resolved(&self, ty: TypeId) -> CheckedType {
        if ty == TypeId::UNRESOLVED {
            return Err(GaveUp::Unresolved);
        }
        if self.c.is_error_type(ty) {
            return Err(GaveUp::ErrorType);
        }
        Ok(ty)
    }

    pub(super) fn require_live_expression(&self, expression: ExprId) -> Result<(), GaveUp> {
        let is_unreached = self.bound().parent_of_expr(expression) == Parent::None;
        match is_unreached || self.c.is_dead_expression(self.file, expression) {
            true => Err(GaveUp::UnreachedNode),
            false => Ok(()),
        }
    }
}
