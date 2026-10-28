use super::aliases::declared_names;
use super::{
    BuiltinPath, CommonJsBuiltins, EvaluatedText, ModuleObjectMention, ResolveInput, Resolved,
    ResolvedBuiltins, SourceDialect,
};
use crate::builtins::runtime_uses::{
    MentionedUses, Mentions, RuntimeUses, reaches_unknown_module_loader,
};
use crate::builtins::table::{
    BuiltinId, BuiltinName, Intrinsic, Mutability, RuntimeFunction, RuntimeModule,
};
use bun_sema::atom::known;
use bun_sema::bind::{Binding, CommonJsVariable, Decl, Parent, SymbolId};
use bun_sema::fold::Decision;
use bun_sema::hir::{self, BinOp, ExprId, ExprKind, Flags, MemberKey, PatKind, StmtKind, VarKind};
use bun_sema::import_sites::find_module_printed_as_require;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use core::cell::OnceCell;
use core::ops::Range;
use smallvec::SmallVec;

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
    // The value may be the built-in: a read of a variable or of a parameter that it is stored into, among other values.
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
}

#[derive(Clone)]
pub(super) enum AliasSource {
    Known(ResolvedValue),
    Initializer {
        initializer: ExprId,
        members: SmallVec<[BuiltinName; 2]>,
    },
}

/// What the resolver reads off a file whichever part of it is resolved.
pub struct FileFacts {
    // The position and the id of every expression, in the order of the positions.
    exprs_by_position: Vec<(u32, u32)>,
    declared_aliases: Vec<(SymbolId, AliasSource)>,
    // Where the name is written, or the id of the initializer without its type assertions, and the index of the alias. Both in order.
    aliases_by_position: Vec<(u32, u32)>,
    aliases_by_initializer: Vec<(u32, u32)>,
    symbols_exported_by_name: FxHashSet<SymbolId>,
    symbols_exported_where_declared: FxHashSet<SymbolId>,
    syntax_with_helpers: SyntaxWithHelpers,
}

/// Where the syntax is written for which lowering or the engine calls code of Bun's own. The positions ascend.
#[derive(Default)]
struct SyntaxWithHelpers {
    decorators: Vec<u32>,
    disposed_resources: Vec<u32>,
    generators: Vec<u32>,
    /// Async functions, `await` and `import()`.
    promises: Vec<u32>,
    /// `for (.. of ..)`, `[...list]`, `[a, b] = list`, `yield* list`
    iterations: Vec<u32>,
}

impl SyntaxWithHelpers {
    fn of(hir: &hir::File<'_>) -> SyntaxWithHelpers {
        let declarations = hir.var_decls.iter();
        let functions = hir.fns.iter();
        let async_functions = hir.fns.iter().filter(|it| it.flags.contains(Flags::ASYNC));
        let awaited = hir.exprs.iter();
        let awaited = awaited
            .filter(|it| matches!(it.kind, ExprKind::Await(_) | ExprKind::ImportCall { .. }));
        let awaiting_loops = hir.stmts.iter();
        let awaiting_loops =
            awaiting_loops.filter(|it| matches!(it.kind, StmtKind::ForOf { is_await: true, .. }));
        let expressions = hir.exprs.iter().filter(|expression| {
            matches!(
                expression.kind,
                ExprKind::Spread(_) | ExprKind::Yield { star: true, .. }
            )
        });
        let statements = hir.stmts.iter();
        let statements = statements.filter(|it| matches!(it.kind, StmtKind::ForOf { .. }));
        let patterns = hir.pats.iter();
        let patterns = patterns.filter(|it| matches!(it.kind, PatKind::Array(_)));
        let mut syntax = SyntaxWithHelpers {
            decorators: (hir.decorators.iter().map(|&(_, written)| hir[written].pos)).collect(),
            disposed_resources: declarations
                .filter(|it| matches!(it.kind, VarKind::Using | VarKind::AwaitUsing))
                .map(|it| hir[it.pat].pos)
                .collect(),
            generators: functions
                .filter(|it| it.flags.contains(Flags::GENERATOR))
                .map(|it| it.start)
                .collect(),
            promises: async_functions
                .map(|it| it.start)
                .chain(awaited.map(|it| it.pos))
                .chain(awaiting_loops.map(|it| it.start))
                .collect(),
            iterations: expressions
                .map(|it| it.pos)
                .chain(statements.map(|it| it.start))
                .chain(patterns.map(|it| it.pos))
                .collect(),
        };
        let SyntaxWithHelpers {
            decorators,
            disposed_resources,
            generators,
            promises,
            iterations,
        } = &mut syntax;
        for positions in [
            decorators,
            disposed_resources,
            generators,
            promises,
            iterations,
        ] {
            positions.sort_unstable();
        }
        syntax
    }
}

fn is_any_within(positions: &[u32], ranges: Option<&[Range<u32>]>) -> bool {
    let Some(ranges) = ranges else {
        return !positions.is_empty();
    };
    ranges.iter().any(|range| {
        let first = positions.partition_point(|&position| position < range.start);
        positions
            .get(first)
            .is_some_and(|&position| position < range.end)
    })
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
                .map(|id| (hir[ExprId(id)].pos, id))
                .collect(),
            declared_aliases: Vec::new(),
            aliases_by_position: Vec::new(),
            aliases_by_initializer: Vec::new(),
            symbols_exported_by_name: core::mem::take(&mut resolver.exported_symbols),
            symbols_exported_where_declared: FxHashSet::default(),
            syntax_with_helpers: SyntaxWithHelpers::of(hir),
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
        facts.exprs_by_position.shared_sort_unstable();
        facts.aliases_by_position.shared_sort_unstable();
        facts.aliases_by_initializer.shared_sort_unstable();
        facts
    }

    // The ids of the expressions that are written in the ranges lie in this range.
    fn ids_within(&self, ranges: &[Range<u32>]) -> Range<u32> {
        let mut ids = 0..0;
        for range in ranges {
            for &(_, id) in entries_within(&self.exprs_by_position, range.clone()) {
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
    // What would be in `mentioned` but for the text of the call.
    pub(super) called_with_other_texts: Vec<BuiltinId>,
    pub(super) called: Vec<BuiltinId>,
    pub(super) loaded: Vec<BuiltinId>,
    pub(super) exposed: Vec<BuiltinId>,
    pub(super) linked_functions: Vec<RuntimeFunction>,
    pub(super) members_read: Vec<BuiltinName>,
    pub(super) has_decorator: bool,
    pub(super) disposes_resource: bool,
    pub(super) iterates: bool,
    pub(super) has_generator: bool,
    pub(super) makes_promise: bool,
    pub(super) evaluated_texts: Vec<EvaluatedText>,
    pub(super) module_object_mentions: Vec<ModuleObjectMention>,
    pub(super) stores_with_module_exports: Vec<ExprId>,
}

pub(super) struct Resolver<'a, 's> {
    pub(super) input: &'a ResolveInput<'a, 's>,
    // Of the expressions from `first_state` on. What has none does not count as evaluated.
    states: Vec<ExprState>,
    first_state: u32,
    pub(super) facts: Option<&'a FileFacts>,
    has_seen_declarations: bool,
    pub(super) aliases: FxHashMap<SymbolId, AliasSource>,
    // The one built-in that is stored into a binding all of whose reads are in this file. `None`: several are.
    pub(super) held: FxHashMap<SymbolId, Option<ResolvedValue>>,
    pub(super) exported_symbols: FxHashSet<SymbolId>,
    pub(super) commonjs: CommonJsBuiltins,
    pub(super) exposes_own_module_object: bool,
    pub(super) stores_to_exports: Vec<ExprId>,
    // `createRequire` comes out of it.
    pub(super) loads_node_module: bool,
    pub(super) output: ResolverOutput,
    // Only what is written in one of these ranges of positions counts as evaluated. They are in order and do not overlap.
    within: Option<&'a [Range<u32>]>,
    // Made when it is first asked for: few parts of a file let a binding hold a built-in.
    named_outside: OnceCell<FxHashSet<SymbolId>>,
    // The ids of the expressions that count as evaluated lie in this range, which is short for a part of a file.
    evaluated: Range<u32>,
    // The evaluated expressions whose state `resolve` computes, and the evaluated calls with and without `new`. Both in order.
    computed: Vec<ExprId>,
    calls: Vec<ExprId>,
    work_stack: Vec<ExprId>,
}

// `compute_state` answers `Unresolved` for every other kind, which waits for nothing.
fn can_stand_for_builtin(kind: ExprKind) -> bool {
    matches!(
        kind,
        ExprKind::Ident(_)
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Call(_)
            | ExprKind::ImportMeta
            | ExprKind::Binary {
                op: BinOp::Comma,
                ..
            }
            | ExprKind::Assign { .. }
    )
}

fn sorted_unique<T: Ord>(mut list: Vec<T>) -> Box<[T]> {
    list.shared_sort_unstable();
    list.dedup();
    list.into_boxed_slice()
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
    while resolver.follow_stored_builtins() {
        resolver.forget_computed_states();
        resolver.resolve_exprs();
    }
    resolver.collect_members_read_by_name();
    resolver.collect_syntax_with_helpers();
    resolver.collect_evaluated_texts();
    resolver.classify_mentions();
    resolver.classify_stores_to_exports();
    resolver.collect_module_object_mentions();
    resolver.visit_implicit_references();
    resolver.visit_import_sites();
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
            states: vec![ExprState::Unvisited; evaluated.len()],
            first_state: evaluated.start,
            evaluated,
            aliases: FxHashMap::default(),
            held: FxHashMap::default(),
            exported_symbols: FxHashSet::default(),
            commonjs: CommonJsBuiltins::default(),
            exposes_own_module_object: false,
            stores_to_exports: Vec::new(),
            loads_node_module: input
                .targets
                .iter()
                .any(|it| it.1 == RuntimeModule::NodeModule),
            output: ResolverOutput::default(),
            computed: Vec::new(),
            calls: Vec::new(),
            work_stack: Vec::new(),
        }
    }

    pub(super) fn state(&self, expr: ExprId) -> ExprState {
        let index = expr.0.checked_sub(self.first_state);
        let state = index.and_then(|index| self.states.get(index as usize));
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

    // An alias whose name and whose initializer are both written elsewhere stands for nothing here, and nobody asks for it.
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

    fn is_within(&self, position: u32) -> bool {
        self.within.is_none_or(|ranges| {
            let following = ranges.partition_point(|range| range.start <= position);
            following > 0 && position < ranges[following - 1].end
        })
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
            && !input.bound.is_in_type_query(expr)
    }

    pub(super) fn evaluated_exprs(&self) -> impl Iterator<Item = ExprId> + use<> {
        self.evaluated.clone().map(ExprId)
    }

    // Whether an expression counts as evaluated never changes, so what is outside the range stays as it is marked.
    fn mark_unevaluated_exprs(&mut self) {
        let input = self.input;
        let mut evaluated = 0..0;
        for expr in self.evaluated_exprs() {
            if !self.is_evaluated(expr) {
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
                Decision::Unknown if can_stand_for_builtin(kind) => {
                    self.computed.push(expr);
                    ExprState::Unvisited
                }
                Decision::Unknown
                | Decision::Constant(_)
                | Decision::Data(_)
                | Decision::DeferredData => ExprState::Unresolved,
                Decision::GlobalPath(path) => self.resolve_global_path(path),
            };
            self.set_state(expr, state);
        }
        self.evaluated = evaluated;
    }

    pub(super) fn evaluated_calls(&self) -> &[ExprId] {
        &self.calls
    }

    // What a binding holds changes what `resolve` computes. Which expressions count as evaluated, and what the folder has decided, stays.
    fn forget_computed_states(&mut self) {
        for index in 0..self.computed.len() {
            self.set_state(self.computed[index], ExprState::Unvisited);
        }
    }

    fn resolve_exprs(&mut self) {
        for index in 0..self.computed.len() {
            let expr = self.computed[index];
            if self.is_unvisited(expr) {
                self.resolve(expr);
            }
        }
    }

    fn resolve(&mut self, start: ExprId) {
        // What an expression waits for is written in front of it, but for a name that is read above its declaration.
        if self.find_unvisited_dependency(start).is_none() {
            let state = self.compute_state(start);
            self.set_state(start, state);
            return;
        }
        self.work_stack.push(start);
        while let Some(&expr) = self.work_stack.last() {
            if let Some(dependency) = self.find_unvisited_dependency(expr) {
                self.set_state(expr, ExprState::InProgress);
                self.work_stack.push(dependency);
                continue;
            }
            let state = self.compute_state(expr);
            self.set_state(expr, state);
            self.work_stack.pop();
        }
    }

    fn find_unvisited_dependency(&self, expr: ExprId) -> Option<ExprId> {
        let hir = self.input.hir;
        let unvisited = |operand: ExprId| {
            let operand = hir.skip_type_assertions(operand);
            self.is_unvisited(operand).then_some(operand)
        };
        if let Some((object, key)) = hir.member_key(expr) {
            return unvisited(object).or_else(|| match key {
                MemberKey::Computed(computed) => unvisited(computed),
                MemberKey::Name(_) | MemberKey::PrivateName(_) => None,
            });
        }
        if let ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } = hir[expr].kind
        {
            return unvisited(right);
        }
        if let ExprKind::Call(call) = hir[expr].kind {
            let first_operand = hir.ids(hir[call].args).next();
            return unvisited(hir[call].callee).or_else(|| first_operand.and_then(unvisited));
        }
        if !matches!(hir[expr].kind, ExprKind::Ident(_)) {
            return None;
        }
        let Binding::Symbol(symbol) = self.input.bound.binding(expr) else {
            return None;
        };
        match self.aliases.get(&symbol)? {
            AliasSource::Initializer { initializer, .. } => unvisited(*initializer),
            AliasSource::Known(_) => None,
        }
    }

    #[rustfmt::skip]
    fn compute_state(&mut self, expr: ExprId) -> ExprState {
        match self.input.hir[expr].kind {
            ExprKind::Ident(name) => match self.input.bound.binding(expr) {
                Binding::Free => self.compute_free_name_state(expr, name),
                Binding::Symbol(symbol) => self.compute_symbol_state(expr, symbol),
                Binding::CommonJs(variable) => self.compute_commonjs_state(expr, variable, name),
                Binding::Arguments(_) => ExprState::Unresolved,
            },
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                match find_module_printed_as_require(self.input.hir, self.input.bound, expr) {
                    Some(module) => self.compute_commonjs_state(module, CommonJsVariable::Require, known::require),
                    None => self.compute_member_state(expr),
                }
            }
            ExprKind::Call(_) => self.compute_call_state(expr),
            ExprKind::ImportMeta => self.compute_import_meta_state(),
            ExprKind::Binary { op: BinOp::Comma, right, .. } => {
                ExprState::of_value(self.value_of(right).map(ResolvedValue::with_side_effects))
            }
            ExprKind::Assign { target, .. } => match self.find_held_value(target) {
                Some(value) => ExprState::Held(value),
                None => ExprState::Unresolved,
            },
            _ => ExprState::Unresolved,
        }
    }

    fn collect_members_read_by_name(&mut self) {
        for index in 0..self.computed.len() {
            let expr = self.computed[index];
            if self.is_resolved(expr) {
                continue;
            }
            let key = self.input.hir.member_key(expr);
            if let Some(key) = key.and_then(|(_, key)| self.find_key_name(key)) {
                self.output.members_read.push(key.name);
            }
        }
    }

    fn collect_syntax_with_helpers(&mut self) {
        let of_file;
        let syntax = match self.facts {
            Some(facts) => &facts.syntax_with_helpers,
            None => {
                of_file = SyntaxWithHelpers::of(self.input.hir);
                &of_file
            }
        };
        let output = &mut self.output;
        output.has_decorator = is_any_within(&syntax.decorators, self.within);
        output.disposes_resource = is_any_within(&syntax.disposed_resources, self.within);
        output.has_generator = is_any_within(&syntax.generators, self.within);
        output.makes_promise = is_any_within(&syntax.promises, self.within);
        output.iterates = is_any_within(&syntax.iterations, self.within);
    }

    fn finish(self) -> ResolvedBuiltins {
        let symbols = self.collect_symbol_paths();
        let (input, mut output) = (self.input, self.output);
        output
            .mentioned
            .extend(symbols.iter().map(|entry| entry.1.id));
        let mut called_with_other_texts = output.called_with_other_texts;
        called_with_other_texts.retain(|id| !output.mentioned.contains(id));
        output.mentioned.extend_from_slice(&called_with_other_texts);
        let called_with_other_texts = sorted_unique(called_with_other_texts);
        let mentioned = sorted_unique(output.mentioned);
        let exposed = sorted_unique(output.exposed);
        let mentions = Mentions {
            mentioned: &mentioned,
            called_with_other_texts: &called_with_other_texts,
            called: &output.called,
            exposed: &exposed,
            linked_functions: &output.linked_functions,
            members_read: &sorted_unique(output.members_read),
            has_decorator: output.has_decorator,
            disposes_resource: output.disposes_resource,
            iterates: output.iterates,
            has_generator: output.has_generator,
            makes_promise: output.makes_promise,
            is_of_program: input.dialect == SourceDialect::Program,
        };
        let MentionedUses {
            certain: uses,
            guessed: guessed_uses,
        } = match input.dialect {
            SourceDialect::Program => RuntimeUses::of_mentions_apart(&mentions, input.platform),
            SourceDialect::Runtime => MentionedUses {
                certain: RuntimeUses::of_mentions(&mentions, input.platform),
                guessed: RuntimeUses::default(),
            },
        };
        let loads_unknown_modules = match input.dialect {
            SourceDialect::Program => reaches_unknown_module_loader(
                &output.loaded,
                &output.called,
                &exposed,
                input.platform,
            ),
            SourceDialect::Runtime => false,
        };
        let mut exprs = Vec::new();
        let mut expr_bits = vec![0u64; input.hir.exprs.len().div_ceil(64)];
        let mut exprs_with_side_effects = Vec::new();
        for expr in self.evaluated.map(ExprId) {
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
        ResolvedBuiltins {
            exprs: exprs.into_boxed_slice(),
            expr_bits: expr_bits.into_boxed_slice(),
            exprs_with_side_effects: exprs_with_side_effects.into_boxed_slice(),
            symbols: symbols.into_boxed_slice(),
            commonjs: self.commonjs,
            evaluated_texts: output.evaluated_texts.into_boxed_slice(),
            module_object_mentions: output.module_object_mentions.into_boxed_slice(),
            stores_with_module_exports: output.stores_with_module_exports.into_boxed_slice(),
            mentioned,
            #[cfg(test)]
            exposed,
            uses,
            guessed_uses,
            loads_unknown_modules,
        }
    }
}
