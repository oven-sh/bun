use super::aliases::declared_names;
use super::mentions::expose_in;
use super::unnamed_uses::SyntaxOutsideExpressions;
use super::written_members::find_what_opens_where_handed_on;
use super::{
    BuiltinPath, CommonJsBuiltins, EvaluatedText, GLOBALS_LEFT_ALONE, KeyOfModuleCache,
    LOADED_BELOW_VITEST, LOADED_BY_WORKER, ModuleObjectMention, ResolveInput, Resolved,
    ResolvedBuiltins, SourceDialect, SpyCall, WhereMoreIsHandedOn, WhereTestsLayNamesAbove,
};
use crate::builtins::runtime_uses::{
    ENTRIES_LEADING_TO_HOOK_OF_INSTANCEOF, Mentions, RuntimeUses, SyntaxWithHelpers, is_evaluator,
    is_unknown_module_loader, reaches_unknown_module_loader,
};
use crate::builtins::table::{
    self, BuiltinId, BuiltinName, Intrinsic, Mutability, Platforms, RuntimeFunction, RuntimeModule,
};
use crate::ir::WellKnownSymbol;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, CommonJsVariable, Decl, InitialState, Parent, SymbolId,
};
use bun_sema::fold::{Constant, Decision, KnownSets};
use bun_sema::hir::{BinOp, ExprId, ExprKind, Flags, FnId, MemberKey, UnOp};
use bun_sema::import_sites::find_module_printed_as_require;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use core::cell::{Cell, OnceCell, RefCell};
use core::ops::Range;
use smallvec::SmallVec;
use std::sync::OnceLock;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum HolderKind {
    ModuleNamespace,
    Object,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct ResolvedValue {
    pub(super) path: BuiltinPath,
    pub(super) kind: HolderKind,
    pub(super) has_side_effects: bool,
}

impl ResolvedValue {
    pub(super) fn object(path: BuiltinPath) -> ResolvedValue {
        ResolvedValue {
            path,
            kind: HolderKind::Object,
            has_side_effects: false,
        }
    }

    pub(super) fn predicted(mut self) -> ResolvedValue {
        let mutability = &mut self.path.mutability;
        *mutability = (*mutability).min(Mutability::ConstantUnlessWritten);
        self
    }

    pub(super) fn with_side_effects(mut self) -> ResolvedValue {
        self.has_side_effects = true;
        self.predicted()
    }

    pub(super) fn stored(mut self) -> ResolvedValue {
        self.has_side_effects = false;
        self.predicted()
    }
}

#[derive(Copy, Clone)]
pub(super) enum ExprState {
    Unvisited,
    InProgress,
    NotEvaluated,
    Unresolved,
    Builtin(ResolvedValue),
    Held(ResolvedValue),
    DynamicGlobal(BuiltinPath),
    Intrinsic(Intrinsic),
}

impl ExprState {
    pub(super) fn of_value(value: Option<ResolvedValue>) -> ExprState {
        match value {
            Some(value) => ExprState::Builtin(value),
            None => ExprState::Unresolved,
        }
    }

    pub(super) fn of_path(path: Option<BuiltinPath>) -> ExprState {
        ExprState::of_value(path.map(ResolvedValue::object))
    }

    fn is_found(self) -> bool {
        matches!(
            self,
            ExprState::Builtin(_)
                | ExprState::Held(_)
                | ExprState::DynamicGlobal(_)
                | ExprState::Intrinsic(_)
        )
    }
}

enum Step {
    Dependency(ExprId),
    State(ExprState),
}

#[derive(Clone)]
pub(super) enum AliasSource {
    Known(ResolvedValue),
    Initializer {
        initializer: ExprId,
        members: SmallVec<[BuiltinName; 2]>,
    },
}

pub struct FileFacts {
    exprs_by_position: Vec<u64>,
    declared_aliases: Vec<(SymbolId, AliasSource)>,
    aliases_by_position: Vec<(u32, u32)>,
    aliases_by_initializer: Vec<(u32, u32)>,
    symbols_exported_by_name: FxHashSet<SymbolId>,
    symbols_exported_where_declared: FxHashSet<SymbolId>,
    syntax_outside_expressions: OnceLock<SyntaxOutsideExpressions>,
}

fn list_names_by_variable(input: &ResolveInput<'_, '_>) -> Vec<(u32, u32)> {
    let (hir, bound) = (input.hir, input.bound);
    let names = (0..hir.exprs.len() as u32).map(ExprId);
    let names = names.filter(|&name| matches!(hir[name].kind, ExprKind::Ident(_)));
    let mut names_by_variable: Vec<(u32, u32)> = names
        .filter_map(|name| match bound.binding(name) {
            Binding::Symbol(variable) => Some((variable.0, name.0)),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
        })
        .collect();
    names_by_variable.sort_unstable();
    names_by_variable
}

fn entries_within(entries: &[(u32, u32)], keys: Range<u32>) -> &[(u32, u32)] {
    let start = entries.partition_point(|entry| entry.0 < keys.start);
    let end = entries.partition_point(|entry| entry.0 < keys.end);
    &entries[start..end.max(start)]
}

impl FileFacts {
    pub fn new(input: &ResolveInput<'_, '_>) -> FileFacts {
        let hir = input.hir;
        let mut resolver = Resolver::new(input, None, None);
        resolver.collect_exported_symbols();
        let mut facts = FileFacts {
            exprs_by_position: (0..hir.exprs.len() as u32)
                .map(|id| (u64::from(hir[ExprId(id)].pos) << 32) | u64::from(id))
                .collect(),
            declared_aliases: Vec::new(),
            aliases_by_position: Vec::new(),
            aliases_by_initializer: Vec::new(),
            symbols_exported_by_name: core::mem::take(&mut resolver.exported_symbols),
            symbols_exported_where_declared: FxHashSet::default(),
            syntax_outside_expressions: OnceLock::new(),
        };
        for (name, symbol) in declared_names(input) {
            let flags = input.bound.modifier_flags(hir, Decl::Var(name));
            if flags.contains(Flags::EXPORT) {
                facts.symbols_exported_where_declared.insert(symbol);
            }
            let Some(source) = resolver.find_alias_source(symbol) else {
                continue;
            };
            let index = facts.declared_aliases.len() as u32;
            if let AliasSource::Initializer { initializer, .. } = source {
                let initializer = hir.skip_type_assertions(initializer);
                facts.aliases_by_initializer.push((initializer.0, index));
            }
            facts.aliases_by_position.push((hir[name].pos, index));
            facts.declared_aliases.push((symbol, source));
        }
        facts.exprs_by_position.sort_unstable();
        facts.aliases_by_position.shared_sort_unstable();
        facts.aliases_by_initializer.shared_sort_unstable();
        facts
    }

    pub(super) fn syntax_outside_expressions(
        &self,
        hir: &bun_sema::hir::File<'_>,
    ) -> &SyntaxOutsideExpressions {
        self.syntax_outside_expressions
            .get_or_init(|| SyntaxOutsideExpressions::of(hir))
    }

    fn ids_within(&self, ranges: &[Range<u32>]) -> Range<u32> {
        let entries = &self.exprs_by_position[..];
        let mut ids = 0..0;
        for range in ranges {
            let start = entries.partition_point(|&entry| entry < u64::from(range.start) << 32);
            let end = entries.partition_point(|&entry| entry < u64::from(range.end) << 32);
            for &entry in &entries[start..end.max(start)] {
                let id = entry as u32;
                if ids.is_empty() {
                    ids = id..id + 1;
                }
                ids = ids.start.min(id)..ids.end.max(id + 1);
            }
        }
        ids
    }
}

#[derive(Default)]
pub(super) struct ResolverOutput {
    pub(super) mentioned: Vec<BuiltinId>,
    pub(super) called_with_other_texts: Vec<BuiltinId>,
    pub(super) called_without_other_code: Vec<BuiltinId>,
    pub(super) called: Vec<BuiltinId>,
    pub(super) loaded: Vec<BuiltinId>,
    pub(super) exposed: Vec<BuiltinId>,
    pub(super) handed_to_hooks_of_instanceof: Vec<BuiltinId>,
    pub(super) names_asked_for_that_are_not_listed: Vec<(BuiltinId, Atom)>,
    pub(super) reads_name_leading_to_hook_of_instanceof: bool,
    pub(super) linked_functions: Vec<RuntimeFunction>,
    pub(super) evaluated_texts: Vec<EvaluatedText>,
    pub(super) module_object_mentions: Vec<ModuleObjectMention>,
    pub(super) may_store_path_of_main_module: bool,
    pub(super) stores_with_module_exports: Vec<ExprId>,
    pub(super) replaced_members: Vec<BuiltinId>,
    pub(super) opened_holders: Vec<BuiltinId>,
    pub(super) names_added: Vec<(BuiltinId, Atom)>,
    pub(super) spy_calls: Vec<SpyCall>,
    pub(super) hands_spy_on: bool,
    pub(super) hands_mock_on: bool,
    pub(super) resets_modules: bool,
    pub(super) stores_loader_functions: bool,
    pub(super) process_reaches_code_on_its_prototypes: bool,
    pub(super) inspects_prototype_chain_of_process: bool,
    pub(super) method_that_hands_out_global_object_may_come_out: bool,
    pub(super) tables_of_loaders_written: Vec<ExprId>,
    pub(super) keys_taken_out_of_module_cache: Vec<KeyOfModuleCache>,
    pub(super) entries_deleted_from_module_cache: Vec<ExprId>,
    pub(super) entries_stored_in_module_cache: Vec<ExprId>,
    pub(super) keys_of_entries_handed_on: Vec<KeyOfModuleCache>,
    pub(super) loses_sight_of_module_cache: bool,
    pub(super) hands_module_cache_on: bool,
    pub(super) gets_at_entries_of_module_cache: bool,
    pub(super) members_read: Vec<BuiltinName>,
    pub(super) reads_by_unknown_key: bool,
    pub(super) may_call_evaluator: bool,
    pub(super) global_object_may_be_looked_through: bool,
    pub(super) syntax: SyntaxWithHelpers,
    pub(super) may_hand_values_to_natives: bool,
}

#[derive(Copy, Clone)]
pub(super) enum HooksOfInstanceof {
    OnWhatIsNoBuiltin,
    Nowhere,
    Everywhere,
}

#[derive(Default)]
pub(super) struct FunctionsReadingThis {
    pub(super) found: FxHashSet<FnId>,
    pub(super) is_any_this_of_nobody_known: bool,
}

pub(super) struct Resolver<'a, 's> {
    pub(super) input: &'a ResolveInput<'a, 's>,
    states: Vec<ExprState>,
    first_state: u32,
    pub(super) facts: Option<&'a FileFacts>,
    has_seen_declarations: bool,
    pub(super) aliases: FxHashMap<SymbolId, AliasSource>,
    pub(super) exported_symbols: FxHashSet<SymbolId>,
    pub(super) commonjs: CommonJsBuiltins,
    pub(super) exposes_own_module_object: bool,
    pub(super) exposes_own_require: bool,
    pub(super) stores_to_exports: Vec<ExprId>,
    pub(super) may_hold_made_require: bool,
    pub(super) hooks_of_instanceof_supposed: Cell<HooksOfInstanceof>,
    pub(super) functions_reading_this: OnceCell<FunctionsReadingThis>,
    pub(super) output: ResolverOutput,
    within: Option<&'a [Range<u32>]>,
    named_outside: OnceCell<FxHashSet<SymbolId>>,
    names_by_variable: OnceCell<Vec<(u32, u32)>>,
    pub(super) kept_variables: RefCell<FxHashMap<(SymbolId, BuiltinId), bool>>,
    pub(super) variables_asked_for_numbers: RefCell<FxHashMap<(SymbolId, u32), bool>>,
    pub(super) variables_let_out_of_sight: OnceCell<FxHashSet<SymbolId>>,
    known_sets: RefCell<KnownSets<'a, 's>>,
    evaluated: Range<u32>,
    pub(super) computed: Vec<ExprId>,
    calls: Vec<ExprId>,
    pub(super) written_patterns: Vec<ExprId>,
    pub(super) found_or_this: Vec<ExprId>,
    work_stack: Vec<ExprId>,
}

fn can_stand_for_builtin(kind: ExprKind) -> bool {
    matches!(
        kind,
        ExprKind::Ident(_)
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Call(_)
            | ExprKind::Await(_)
            | ExprKind::ImportMeta
            | ExprKind::Binary {
                op: BinOp::Comma | BinOp::And,
                ..
            }
    )
}

fn lists_or_traps_symbols(id: BuiltinId) -> bool {
    ENTRIES_LEADING_TO_HOOK_OF_INSTANCEOF.contains(&table::canonical_id(id))
}

fn holds_what_leads_to_hook_of_instanceof(id: BuiltinId) -> bool {
    matches!(
        table::canonical_id(id),
        BuiltinId::GlobalThis | BuiltinId::Symbol | BuiltinId::Object | BuiltinId::Reflect
    )
}

fn sorted_unique<T: Ord>(mut list: Vec<T>) -> Box<[T]> {
    list.shared_sort_unstable();
    list.dedup();
    list.into_boxed_slice()
}

pub(super) fn is_of_loader(id: BuiltinId) -> bool {
    let id = table::canonical_id(id);
    let root = table::root_of(id);
    is_unknown_module_loader(id)
        || table::entry(root).module == Some(RuntimeModule::NodeModule)
        || matches!(
            table::canonical_id(root),
            BuiltinId::ModuleObject | BuiltinId::ModuleRequire | BuiltinId::ModuleRequireMain
        )
}

fn reaches_loader_of_paths(
    loaded: &[BuiltinId],
    called: &[BuiltinId],
    exposed: &[BuiltinId],
    platform: Platforms,
) -> bool {
    let takes_paths = |id: &BuiltinId| {
        table::canonical_id(*id) != table::canonical_id(BuiltinId::ProcessGetBuiltinModule)
    };
    let lists = [loaded, called, exposed];
    if lists.iter().all(|list| list.iter().all(takes_paths)) {
        return true;
    }
    let [loaded, called, exposed] =
        lists.map(|list| -> Vec<BuiltinId> { list.iter().copied().filter(takes_paths).collect() });
    reaches_unknown_module_loader(&loaded, &called, &exposed, platform)
}

pub(super) fn run(
    input: &ResolveInput<'_, '_>,
    within: Option<&[Range<u32>]>,
    facts: Option<&FileFacts>,
) -> ResolvedBuiltins {
    let mut resolver = Resolver::new(input, within, facts);
    resolver.mark_unevaluated_exprs();
    resolver.resolve_commonjs_variables();
    resolver.collect_exported_symbols();
    resolver.collect_import_aliases();
    resolver.collect_declared_aliases();
    resolver.resolve_exprs();
    resolver.collect_evaluated_texts();
    resolver.collect_replaced_members();
    resolver.classify_mentions();
    resolver.collect_names_added();
    resolver.classify_stores_to_exports();
    resolver.collect_module_object_mentions();
    resolver.visit_implicit_references();
    resolver.visit_import_sites();
    if input.is_text_asked || resolver.spells_name_that_every_file_is_asked_for() {
        resolver.collect_what_is_reached_without_a_name();
    }
    resolver.finish()
}

#[cfg(test)]
pub(super) fn count_states(
    input: &ResolveInput<'_, '_>,
    ranges: &[Range<u32>],
    facts: &FileFacts,
) -> usize {
    Resolver::new(input, Some(ranges), Some(facts)).states.len()
}

fn binding_of_defined_root(input: &ResolveInput<'_, '_>, expression: ExprId) -> Binding {
    match input.hir[expression].kind {
        ExprKind::Ident(_) => input.bound.binding(expression),
        _ => input.bound.runtime.binding_of_defined_path(expression),
    }
}

impl<'a, 's> Resolver<'a, 's> {
    fn new(
        input: &'a ResolveInput<'a, 's>,
        within: Option<&'a [Range<u32>]>,
        facts: Option<&'a FileFacts>,
    ) -> Resolver<'a, 's> {
        let evaluated = match (within, facts) {
            (Some(ranges), Some(facts)) => facts.ids_within(ranges),
            (Some(_) | None, _) => 0..input.hir.exprs.len() as u32,
        };
        Resolver {
            input,
            within,
            facts,
            has_seen_declarations: false,
            named_outside: OnceCell::new(),
            names_by_variable: OnceCell::new(),
            kept_variables: RefCell::default(),
            variables_asked_for_numbers: RefCell::default(),
            variables_let_out_of_sight: OnceCell::new(),
            known_sets: RefCell::new(KnownSets::new(
                input.hir,
                input.bound,
                input.decisions,
                input.atoms,
            )),
            states: vec![ExprState::Unvisited; evaluated.len()],
            first_state: evaluated.start,
            evaluated,
            aliases: FxHashMap::default(),
            exported_symbols: FxHashSet::default(),
            commonjs: CommonJsBuiltins::default(),
            exposes_own_module_object: false,
            exposes_own_require: false,
            stores_to_exports: Vec::new(),
            may_hold_made_require: !input.hir.imported_requires.is_empty()
                || input
                    .targets
                    .iter()
                    .any(|it| it.1 == RuntimeModule::NodeModule),
            hooks_of_instanceof_supposed: Cell::new(HooksOfInstanceof::OnWhatIsNoBuiltin),
            functions_reading_this: OnceCell::new(),
            output: ResolverOutput::default(),
            computed: Vec::new(),
            calls: Vec::new(),
            written_patterns: Vec::new(),
            found_or_this: Vec::new(),
            work_stack: Vec::new(),
        }
    }

    pub(super) fn known_set(&self, expr: ExprId) -> SmallVec<[Constant; 4]> {
        SmallVec::from_slice(self.known_sets.borrow_mut().of(expr))
    }

    #[inline]
    pub(super) fn state(&self, expr: ExprId) -> ExprState {
        let state = self
            .states
            .get(expr.0.wrapping_sub(self.first_state) as usize);
        state.copied().unwrap_or(ExprState::NotEvaluated)
    }

    fn set_state(&mut self, expr: ExprId, state: ExprState) {
        self.states[(expr.0 - self.first_state) as usize] = state;
    }

    pub(super) fn is_exported(&self, symbol: SymbolId) -> bool {
        self.exported_symbols.contains(&symbol)
            || self.facts.is_some_and(|facts| {
                facts.symbols_exported_by_name.contains(&symbol)
                    || (self.has_seen_declarations
                        && facts.symbols_exported_where_declared.contains(&symbol))
            })
    }

    pub(super) fn add_declared_aliases_of_part(&mut self, facts: &FileFacts) {
        self.has_seen_declarations = true;
        let ids = self.first_state..self.first_state + self.states.len() as u32;
        let by_initializer = entries_within(&facts.aliases_by_initializer, ids);
        let ranges = self.within.unwrap_or_default().iter();
        let by_position =
            ranges.flat_map(|range| entries_within(&facts.aliases_by_position, range.clone()));
        for &(_, index) in by_initializer.iter().chain(by_position) {
            let (symbol, source) = &facts.declared_aliases[index as usize];
            self.aliases
                .entry(*symbol)
                .or_insert_with(|| source.clone());
        }
    }

    pub(super) fn value_of(&self, expr: ExprId) -> Option<ResolvedValue> {
        match self.state(self.input.hir.skip_type_assertions(expr)) {
            ExprState::Builtin(value) => Some(value),
            ExprState::Intrinsic(Intrinsic::Builtin(id)) => {
                Some(ResolvedValue::object(BuiltinPath {
                    id,
                    mutability: Mutability::AlwaysLocked,
                }))
            }
            _ => None,
        }
    }

    pub(super) fn symbol_that_key_is(
        &self,
        key: ExprId,
    ) -> Option<(ResolvedValue, WellKnownSymbol)> {
        let value = self.value_of(key)?;
        let symbol = table::well_known_symbol(value.path.id)?;
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut followed: SmallVec<[SymbolId; 4]> = SmallVec::new();
        let mut current = key;
        loop {
            current = hir.skip_type_assertions(current);
            current = match hir[current].kind {
                ExprKind::Dot { .. } | ExprKind::Index { .. } => hir.member_key(current)?.0,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => right,
                ExprKind::Ident(_) => match bound.binding(current) {
                    Binding::Symbol(variable) => {
                        let is_filled_once =
                            bound.initial_state(variable) == InitialState::Uninitialized;
                        let may_be_replaced = self.input.runs_tests && self.is_exported(variable);
                        if !is_filled_once || may_be_replaced || followed.contains(&variable) {
                            return None;
                        }
                        followed.push(variable);
                        match bound.binding_initializer(hir, variable) {
                            BindingInitializer::Expression(initializer) => initializer,
                            BindingInitializer::PatternProperty { source, .. } => source,
                            _ => return None,
                        }
                    }
                    _ => return Some((value, symbol)),
                },
                _ => return Some((value, symbol)),
            };
        }
    }

    pub(super) fn held_value_of(&self, expr: ExprId) -> Option<ResolvedValue> {
        match self.state(self.input.hir.skip_type_assertions(expr)) {
            ExprState::Held(value) => Some(value),
            _ => None,
        }
    }

    pub(super) fn is_resolved(&self, expr: ExprId) -> bool {
        matches!(
            self.state(expr),
            ExprState::Builtin(_) | ExprState::Held(_) | ExprState::Intrinsic(_)
        )
    }

    fn is_unvisited(&self, expr: ExprId) -> bool {
        matches!(self.state(expr), ExprState::Unvisited)
    }

    pub(super) fn ranges(&self) -> Option<&'a [Range<u32>]> {
        self.within
    }

    #[inline]
    fn is_within(&self, position: u32) -> bool {
        match self.within {
            None => true,
            Some([range]) => range.contains(&position),
            Some(ranges) => {
                let following = ranges.partition_point(|range| range.start <= position);
                following > 0 && position < ranges[following - 1].end
            }
        }
    }

    pub(super) fn names_of(&self, variable: SymbolId) -> impl Iterator<Item = ExprId> + use<'_> {
        let names_by_variable = self
            .names_by_variable
            .get_or_init(|| list_names_by_variable(self.input));
        let names = entries_within(names_by_variable, variable.0..variable.0 + 1);
        names.iter().map(|name| ExprId(name.1))
    }

    pub(super) fn is_named_outside(&self, symbol: SymbolId) -> bool {
        if self.within.is_none() {
            return false;
        }
        let input = self.input;
        let named_outside = self.named_outside.get_or_init(|| {
            let names = (0..input.hir.exprs.len() as u32)
                .map(ExprId)
                .filter(|&name| {
                    matches!(input.hir[name].kind, ExprKind::Ident(_))
                        && !self.is_within(input.hir[name].pos)
                });
            names
                .filter_map(|name| match input.bound.binding(name) {
                    Binding::Symbol(symbol) => Some(symbol),
                    Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
                })
                .collect()
        });
        named_outside.contains(&symbol)
    }

    fn is_evaluated(&self, expr: ExprId) -> bool {
        let input = self.input;
        let is_unevaluated_name = || {
            matches!(input.hir[expr].kind, ExprKind::Ident(_))
                && !input.bound.is_evaluated_ident(expr)
        };
        self.is_within(input.hir[expr].pos)
            && !is_unevaluated_name()
            && !input.decisions.is_dead_expr(expr)
            && !matches!(input.bound.parent_of_expr(expr), Parent::None)
    }

    pub(super) fn evaluated_exprs(&self) -> impl Iterator<Item = ExprId> + use<> {
        self.evaluated.clone().map(ExprId)
    }

    fn mark_unevaluated_exprs(&mut self) {
        let input = self.input;
        let operands: &[ExprId] = &input.bound.type_query_operands;
        let first = self.evaluated.start;
        let mut type_query_operands = &operands[operands.partition_point(|it| it.0 < first)..];
        let mut evaluated = 0..0;
        self.computed.reserve(self.evaluated.len());
        for expr in self.evaluated_exprs() {
            while let [operand, rest @ ..] = type_query_operands
                && *operand < expr
            {
                type_query_operands = rest;
            }
            let is_in_type_query = type_query_operands.first() == Some(&expr);
            if is_in_type_query || !self.is_evaluated(expr) {
                self.set_state(expr, ExprState::NotEvaluated);
                continue;
            }
            if evaluated.is_empty() {
                evaluated.start = expr.0;
            }
            evaluated.end = expr.0 + 1;
            let kind = input.hir[expr].kind;
            if matches!(kind, ExprKind::Call(_) | ExprKind::New(_)) {
                self.calls.push(expr);
            }
            let state = match input.decisions.decision(expr) {
                Decision::Unknown
                    if can_stand_for_builtin(kind)
                        || (input.runs_tests && matches!(kind, ExprKind::Cond { .. })) =>
                {
                    self.computed.push(expr);
                    ExprState::Unvisited
                }
                Decision::Unknown
                | Decision::Constant(_)
                | Decision::Data(_)
                | Decision::DeferredData => ExprState::Unresolved,
                Decision::GlobalPath(path)
                    if binding_of_defined_root(input, expr) != Binding::Free =>
                {
                    self.note_names_of_path(path);
                    ExprState::Unresolved
                }
                Decision::GlobalPath(path) => {
                    let state = self.resolve_global_path(path);
                    if !state.is_found() {
                        self.note_names_of_path(path);
                    }
                    state
                }
            };
            if state.is_found() || matches!(kind, ExprKind::This) {
                self.found_or_this.push(expr);
            }
            self.set_state(expr, state);
        }
        self.evaluated = evaluated;
    }

    pub(super) fn evaluated_calls(&self) -> &[ExprId] {
        &self.calls
    }

    fn resolve_exprs(&mut self) {
        for index in 0..self.computed.len() {
            let expr = self.computed[index];
            if self.is_unvisited(expr) {
                self.resolve(expr);
            }
        }
        self.found_or_this.sort_unstable();
    }

    fn resolve(&mut self, start: ExprId) {
        let mut expr = start;
        loop {
            match self.take_step(expr) {
                Step::Dependency(dependency) => {
                    self.set_state(expr, ExprState::InProgress);
                    self.work_stack.push(expr);
                    expr = dependency;
                }
                Step::State(state) => {
                    if state.is_found() {
                        self.found_or_this.push(expr);
                    }
                    self.set_state(expr, state);
                    match self.work_stack.pop() {
                        Some(waiting) => expr = waiting,
                        None => return,
                    }
                }
            }
        }
    }

    fn take_step(&mut self, expr: ExprId) -> Step {
        let ExprKind::Ident(name) = self.input.hir[expr].kind else {
            return match self.find_unvisited_dependency(expr) {
                Some(dependency) => Step::Dependency(dependency),
                None => Step::State(self.compute_state(expr)),
            };
        };
        let symbol = match self.input.bound.binding(expr) {
            Binding::Symbol(symbol) => symbol,
            Binding::Free => return Step::State(self.compute_free_name_state(expr, name)),
            Binding::CommonJs(variable) => {
                return Step::State(self.compute_commonjs_state(expr, variable, name));
            }
            Binding::Arguments(_) => return Step::State(ExprState::Unresolved),
        };
        let initializer = match self.aliases.get(&symbol) {
            Some(AliasSource::Initializer { initializer, .. }) => Some(*initializer),
            Some(AliasSource::Known(_)) => None,
            None => return Step::State(ExprState::Unresolved),
        };
        match initializer.and_then(|initializer| self.find_unvisited(initializer)) {
            Some(dependency) => Step::Dependency(dependency),
            None => Step::State(self.compute_symbol_state(expr, symbol)),
        }
    }

    fn find_unvisited(&self, operand: ExprId) -> Option<ExprId> {
        let operand = self.input.hir.skip_type_assertions(operand);
        self.is_unvisited(operand).then_some(operand)
    }

    fn asks_who_loads(&self, test: ExprId) -> bool {
        let (hir, atoms) = (self.input.hir, self.input.atoms);
        match hir[test].kind {
            ExprKind::Assign {
                op: Some(BinOp::Nullish),
                target,
                ..
            } => {
                matches!(hir[target].kind, ExprKind::Ident(name) if [LOADED_BY_WORKER, LOADED_BELOW_VITEST, GLOBALS_LEFT_ALONE].contains(&atoms.bytes(name)))
            }
            ExprKind::Binary {
                op: BinOp::Or,
                left,
                right,
            } => self.asks_who_loads(left) && self.asks_who_loads(right),
            ExprKind::Binary {
                op: BinOp::BitAnd,
                left,
                ..
            } => self.asks_who_loads(left),
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => self.asks_who_loads(operand),
            _ => false,
        }
    }

    fn find_unvisited_dependency(&self, expr: ExprId) -> Option<ExprId> {
        let hir = self.input.hir;
        if let Some((object, key)) = hir.member_key(expr) {
            return self.find_unvisited(object).or_else(|| match key {
                MemberKey::Computed(computed) => self.find_unvisited(computed),
                MemberKey::Name(_) | MemberKey::PrivateName(_) => None,
            });
        }
        match hir[expr].kind {
            ExprKind::Binary {
                op: BinOp::Comma | BinOp::And,
                right,
                ..
            } => self.find_unvisited(right),
            ExprKind::Call(call) => self.find_unvisited(hir[call].callee),
            ExprKind::Cond { branches, .. } => self.find_unvisited(hir.branches(branches).no),
            _ => None,
        }
    }

    #[rustfmt::skip]
    fn compute_state(&mut self, expr: ExprId) -> ExprState {
        match self.input.hir[expr].kind {

            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                match find_module_printed_as_require(self.input.hir, self.input.bound, expr) {
                    Some(module) => self.compute_commonjs_state(module, CommonJsVariable::Require, known::require),
                    None => self.compute_member_state(expr),
                }
            }
            ExprKind::Call(_) => self.compute_call_state(expr),
            ExprKind::Await(promise) => self.compute_state_of_awaited_import(promise),
            ExprKind::ImportMeta => self.compute_import_meta_state(),
            ExprKind::Binary { op: BinOp::Comma, right, .. } => {
                ExprState::of_value(self.value_of(right).map(ResolvedValue::with_side_effects))
            }
            ExprKind::Binary { op: BinOp::And, right, .. } => {
                match self.value_of(right).or_else(|| self.held_value_of(right)) {
                    Some(value) if table::canonical_id(value.path.id) == BuiltinId::ModuleObject => {
                        ExprState::Held(value.with_side_effects())
                    }
                    _ => ExprState::Unresolved,
                }
            }
            ExprKind::Cond { test, branches } if self.asks_who_loads(test) => {
                let of_runner = self.input.hir.branches(branches).no;
                match self.value_of(of_runner).or_else(|| self.held_value_of(of_runner)) {
                    Some(value) => ExprState::Held(value.with_side_effects()),
                    None => ExprState::Unresolved,
                }
            }
            _ => ExprState::Unresolved,
        }
    }

    fn finish(self) -> ResolvedBuiltins {
        let symbols = self.collect_symbol_paths();
        let names_in_patterns = self.collect_paths_read_by_patterns();
        let (input, mut output) = (self.input, self.output);
        output
            .mentioned
            .extend(symbols.iter().map(|entry| entry.1.id));
        let mut called_with_other_texts = output.called_with_other_texts;
        called_with_other_texts.retain(|id| !output.mentioned.contains(id));
        let mut called_without_other_code = output.called_without_other_code;
        called_without_other_code
            .retain(|id| !output.mentioned.contains(id) && !called_with_other_texts.contains(id));
        output.mentioned.extend_from_slice(&called_with_other_texts);
        output
            .mentioned
            .extend_from_slice(&called_without_other_code);
        let called_with_other_texts = sorted_unique(called_with_other_texts);
        let called_without_other_code = sorted_unique(called_without_other_code);
        let mentioned = sorted_unique(output.mentioned);
        let exposed = sorted_unique(output.exposed);
        let mentions = Mentions {
            mentioned: &mentioned,
            called_with_other_texts: &called_with_other_texts,
            called_without_other_code: &called_without_other_code,
            exposed: &exposed,
            linked_functions: &output.linked_functions,
            members_read: &sorted_unique(output.members_read),
            reads_by_unknown_key: output.reads_by_unknown_key,
            may_call_evaluator: output.may_call_evaluator,
            global_object_may_be_looked_through: output.global_object_may_be_looked_through,
            syntax: output.syntax,
            may_hand_values_to_natives: output.may_hand_values_to_natives,
            called: &output.called,
            is_of_program: input.dialect == SourceDialect::Program,
            holds_language: input.holds_language,
        };
        let uses = RuntimeUses::of_mentions(&mentions, input.platform);
        let leads_alone = |id: &BuiltinId| input.runs_tests && !is_of_loader(*id);
        let without_what_leads = |list: &[BuiltinId]| -> Vec<BuiltinId> {
            list.iter().copied().filter(|id| !leads_alone(id)).collect()
        };
        let (called, handed_on) = (
            without_what_leads(&output.called),
            without_what_leads(&exposed),
        );
        let loads_unknown_modules = match input.dialect {
            SourceDialect::Program => {
                reaches_unknown_module_loader(&output.loaded, &called, &handed_on, input.platform)
            }
            SourceDialect::Runtime => false,
        };
        let hands_on_loader_of_paths = loads_unknown_modules
            && reaches_loader_of_paths(&output.loaded, &called, &handed_on, input.platform);
        let hold_where_handed_on = |handed_on: &[BuiltinId]| {
            let (mut called, mut exposed) = (output.called.clone(), exposed.to_vec());
            for &id in handed_on {
                expose_in(&mut called, &mut exposed, id);
            }
            let exposed = sorted_unique(exposed);
            let mentions = Mentions {
                exposed: &exposed,
                called: &called,
                ..mentions
            };
            let uses = RuntimeUses::of_mentions(&mentions, input.platform);
            let (called, handed_on) = (without_what_leads(&called), without_what_leads(&exposed));
            let loads_unknown_modules =
                reaches_unknown_module_loader(&output.loaded, &called, &handed_on, input.platform);
            WhereMoreIsHandedOn {
                uses,
                loads_unknown_modules,
                hands_on_loader_of_paths: loads_unknown_modules
                    && reaches_loader_of_paths(&output.loaded, &called, &handed_on, input.platform),
            }
        };
        let handed_to_hooks = &output.handed_to_hooks_of_instanceof;
        let where_hooks_of_instanceof_exist =
            (!handed_to_hooks.is_empty()).then(|| Box::new(hold_where_handed_on(handed_to_hooks)));
        let names_asked_for = &output.names_asked_for_that_are_not_listed;
        let where_tests_lay_names_above = (!names_asked_for.is_empty()).then(|| {
            let objects = sorted_unique(names_asked_for.iter().map(|asked| asked.0).collect());
            let (replaced_members, opened_holders, stores_loader_functions) =
                find_what_opens_where_handed_on(&objects);
            Box::new(WhereTestsLayNamesAbove {
                held: hold_where_handed_on(&objects),
                names_asked_for: names_asked_for.clone().into_boxed_slice(),
                replaced_members: sorted_unique(replaced_members),
                opened_holders: sorted_unique(opened_holders),
                stores_loader_functions,
            })
        });
        let can_list_symbols_of_objects = input.dialect == SourceDialect::Program
            && (input.runs_tests
                || output.reads_name_leading_to_hook_of_instanceof
                || mentioned.iter().any(|&id| lists_or_traps_symbols(id))
                || (exposed.iter()).any(|&id| holds_what_leads_to_hook_of_instanceof(id)));
        let can_come_by_hook_of_instanceof = can_list_symbols_of_objects
            || (input.dialect == SourceDialect::Program
                && (uses.lets_in_what_nobody_names
                    || mentioned
                        .iter()
                        .any(|&id| is_evaluator(table::canonical_id(id)))));
        let may_make_proxy = input.dialect == SourceDialect::Program
            && (output.called.iter().chain(handed_to_hooks))
                .any(|&id| table::root_of(id) == BuiltinId::Proxy);
        let reaches_module_cache =
            input.dialect == SourceDialect::Program && output.gets_at_entries_of_module_cache;
        let mut ids = mentioned.iter();
        let names_plugin = ids.any(|&id| {
            table::canonical_id(id) == BuiltinId::BunPlugin || table::resets_modules(id)
        });
        let mut exprs = Vec::new();
        let mut expr_bits = vec![0u64; input.hir.exprs.len().div_ceil(64)];
        let mut exprs_with_side_effects = Vec::new();
        for &expr in &self.found_or_this {
            let resolved = match self.states[(expr.0 - self.first_state) as usize] {
                ExprState::Builtin(ResolvedValue {
                    path,
                    kind: HolderKind::Object,
                    has_side_effects,
                }) => {
                    if has_side_effects {
                        exprs_with_side_effects.push(expr);
                    }
                    Resolved::Builtin(path)
                }
                ExprState::DynamicGlobal(path) => Resolved::DynamicGlobal(path),
                ExprState::Intrinsic(intrinsic) => Resolved::Intrinsic(intrinsic),
                ExprState::Builtin(ResolvedValue {
                    kind: HolderKind::ModuleNamespace,
                    ..
                })
                | ExprState::Unvisited
                | ExprState::InProgress
                | ExprState::NotEvaluated
                | ExprState::Held(_)
                | ExprState::Unresolved => continue,
            };
            exprs.push((expr, resolved));
            expr_bits[expr.idx() / 64] |= 1 << (expr.idx() % 64);
        }
        output.spy_calls.shared_sort_by_key(|spy| spy.call);
        ResolvedBuiltins {
            exprs: exprs.into_boxed_slice(),
            expr_bits: expr_bits.into_boxed_slice(),
            exprs_with_side_effects: exprs_with_side_effects.into_boxed_slice(),
            symbols: symbols.into_boxed_slice(),
            names_in_patterns: names_in_patterns.into_boxed_slice(),
            commonjs: self.commonjs,
            evaluated_texts: output.evaluated_texts.into_boxed_slice(),
            module_object_mentions: output.module_object_mentions.into_boxed_slice(),
            may_store_path_of_main_module: output.may_store_path_of_main_module,
            stores_with_module_exports: output.stores_with_module_exports.into_boxed_slice(),
            replaced_members: sorted_unique(output.replaced_members),
            opened_holders: sorted_unique(output.opened_holders),
            names_added: output.names_added.into_boxed_slice(),
            spy_calls: output.spy_calls.into_boxed_slice(),
            hands_spy_on: output.hands_spy_on,
            hands_mock_on: output.hands_mock_on,
            resets_modules: output.resets_modules,
            stores_loader_functions: output.stores_loader_functions,
            process_reaches_code_on_its_prototypes: output.process_reaches_code_on_its_prototypes
                || may_make_proxy,
            inspects_prototype_chain_of_process: output.inspects_prototype_chain_of_process,
            method_that_hands_out_global_object_may_come_out: output
                .method_that_hands_out_global_object_may_come_out,
            tables_of_loaders_written: output.tables_of_loaders_written.into_boxed_slice(),
            unlocked: OnceLock::new(),
            mentioned,
            #[cfg(test)]
            exposed,
            uses,
            loads_unknown_modules,
            hands_on_loader_of_paths,
            where_hooks_of_instanceof_exist,
            hooks_of_instanceof_may_exist: OnceLock::new(),
            where_tests_lay_names_above,
            tests_lay_names_above: OnceLock::new(),
            can_come_by_hook_of_instanceof,
            keys_of_entries_handed_on: output.keys_of_entries_handed_on.into_boxed_slice(),
            entries_deleted_from_module_cache: output
                .entries_deleted_from_module_cache
                .into_boxed_slice(),
            entries_stored_in_module_cache: output
                .entries_stored_in_module_cache
                .into_boxed_slice(),
            keys_taken_out_of_module_cache: output
                .keys_taken_out_of_module_cache
                .into_boxed_slice(),
            loses_sight_of_module_cache: output.loses_sight_of_module_cache || names_plugin,
            hands_module_cache_on: output.hands_module_cache_on,
            names_plugin,
            reaches_module_cache,
        }
    }
}
