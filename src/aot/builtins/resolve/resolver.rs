use super::{
    BuiltinPath, CommonJsBuiltins, EvaluatedText, ModuleObjectMention, ResolveInput, Resolved,
    ResolvedBuiltins, SourceDialect,
};
use crate::builtins::runtime_uses::{Mentions, RuntimeUses, reaches_unknown_module_loader};
use crate::builtins::table::{
    BuiltinId, BuiltinName, Intrinsic, Mutability, RuntimeFunction, RuntimeModule,
};
use bun_sema::bind::{Binding, Parent, SymbolId};
use bun_sema::fold::Decision;
use bun_sema::hir::{BinOp, ExprId, ExprKind, MemberKey};
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
}

impl ResolvedValue {
    pub(super) fn object(path: BuiltinPath) -> ResolvedValue {
        ResolvedValue {
            path,
            kind: HolderKind::Object,
        }
    }

    pub(super) fn predicted(self) -> ResolvedValue {
        let mutability = weaker(self.path.mutability, Mutability::ConstantUnlessWritten);
        ResolvedValue {
            path: BuiltinPath {
                id: self.path.id,
                mutability,
            },
            kind: self.kind,
        }
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

pub(super) enum AliasSource {
    Known(ResolvedValue),
    Initializer {
        initializer: ExprId,
        members: SmallVec<[BuiltinName; 2]>,
    },
}

#[derive(Default)]
pub(super) struct ResolverOutput {
    pub(super) mentioned: Vec<BuiltinId>,
    // What would be in `mentioned` but for the text of the call.
    pub(super) called_with_other_texts: Vec<BuiltinId>,
    pub(super) called: Vec<BuiltinId>,
    // The objects of the modules that the import sites load.
    pub(super) loaded: Vec<BuiltinId>,
    pub(super) exposed: Vec<BuiltinId>,
    pub(super) linked_functions: Vec<RuntimeFunction>,
    pub(super) evaluated_texts: Vec<EvaluatedText>,
    pub(super) module_object_mentions: Vec<ModuleObjectMention>,
    pub(super) stores_with_module_exports: Vec<ExprId>,
}

pub(super) struct Resolver<'a, 's> {
    pub(super) input: &'a ResolveInput<'a, 's>,
    pub(super) states: Vec<ExprState>,
    pub(super) aliases: FxHashMap<SymbolId, AliasSource>,
    // The one built-in that is stored into a binding all of whose reads are in this file. `None`: several are.
    pub(super) held: FxHashMap<SymbolId, Option<ResolvedValue>>,
    pub(super) exported_symbols: FxHashSet<SymbolId>,
    pub(super) commonjs: CommonJsBuiltins,
    pub(super) exposes_own_module_object: bool,
    // The targets of the stores to the name `exports` of a CommonJS file.
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
    work_stack: Vec<ExprId>,
}

pub(super) fn weaker(left: Mutability, right: Mutability) -> Mutability {
    left.min(right)
}

fn sorted_unique<T: Ord>(mut list: Vec<T>) -> Box<[T]> {
    list.shared_sort_unstable();
    list.dedup();
    list.into_boxed_slice()
}

pub(super) fn run(input: &ResolveInput<'_, '_>, within: Option<&[Range<u32>]>) -> ResolvedBuiltins {
    let mut resolver = Resolver::new(input, within);
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
    resolver.collect_evaluated_texts();
    resolver.classify_mentions();
    resolver.classify_stores_to_exports();
    resolver.collect_module_object_mentions();
    resolver.visit_implicit_references();
    resolver.visit_import_sites();
    resolver.finish()
}

impl<'a, 's> Resolver<'a, 's> {
    fn new(input: &'a ResolveInput<'a, 's>, within: Option<&'a [Range<u32>]>) -> Resolver<'a, 's> {
        Resolver {
            input,
            within,
            named_outside: OnceCell::new(),
            evaluated: 0..input.hir.exprs.len() as u32,
            states: vec![ExprState::Unvisited; input.hir.exprs.len()],
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
            work_stack: Vec::new(),
        }
    }

    pub(super) fn state(&self, expr: ExprId) -> ExprState {
        self.states[expr.idx()]
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
        match self.state(expr) {
            ExprState::Builtin(_) | ExprState::Held(_) | ExprState::Intrinsic(_) => true,
            _ => false,
        }
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

    // Whether a name that is written outside the part of the file that is resolved is bound to the symbol.
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
                self.states[expr.idx()] = ExprState::NotEvaluated;
                continue;
            }
            if evaluated.is_empty() {
                evaluated.start = expr.0;
            }
            evaluated.end = expr.0 + 1;
            let state = match input.decisions.decision(expr) {
                Decision::Unknown => ExprState::Unvisited,
                Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {
                    ExprState::Unresolved
                }
                Decision::GlobalPath(path) => self.resolve_global_path(path),
            };
            self.states[expr.idx()] = state;
        }
        self.evaluated = evaluated;
    }

    // What a binding holds changes what `resolve` computes. Which expressions count as evaluated, and what the folder has decided, stays.
    fn forget_computed_states(&mut self) {
        for expr in self.evaluated_exprs() {
            let is_computed = !matches!(self.state(expr), ExprState::NotEvaluated)
                && matches!(self.input.decisions.decision(expr), Decision::Unknown);
            if is_computed {
                self.states[expr.idx()] = ExprState::Unvisited;
            }
        }
    }

    fn resolve_exprs(&mut self) {
        for expr in self.evaluated_exprs() {
            if self.is_unvisited(expr) {
                self.resolve(expr);
            }
        }
    }

    fn resolve(&mut self, start: ExprId) {
        self.work_stack.push(start);
        while let Some(&expr) = self.work_stack.last() {
            if let Some(dependency) = self.find_unvisited_dependency(expr) {
                self.states[expr.idx()] = ExprState::InProgress;
                self.work_stack.push(dependency);
                continue;
            }
            let state = self.compute_state(expr);
            self.states[expr.idx()] = state;
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
            ExprKind::Dot { .. } | ExprKind::Index { .. } => self.compute_member_state(expr),
            ExprKind::Call(_) => self.compute_call_state(expr),
            ExprKind::ImportMeta => self.compute_import_meta_state(),
            ExprKind::Binary { op: BinOp::Comma, right, .. } => {
                ExprState::of_value(self.value_of(right).map(ResolvedValue::predicted))
            }
            ExprKind::Assign { target, .. } => match self.find_held_value(target) {
                Some(value) => ExprState::Held(value),
                None => ExprState::Unresolved,
            },
            _ => ExprState::Unresolved,
        }
    }

    fn finish(self) -> ResolvedBuiltins {
        let symbols = self.collect_symbol_paths();
        let Resolver {
            input,
            states,
            evaluated,
            commonjs,
            mut output,
            ..
        } = self;
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
            exposed: &exposed,
            linked_functions: &output.linked_functions,
        };
        let uses = RuntimeUses::of_mentions(mentions, input.platform);
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
        let mut expr_bits = vec![0u64; states.len().div_ceil(64)];
        for expr in evaluated.map(ExprId) {
            let resolved = match states[expr.idx()] {
                ExprState::Builtin(ResolvedValue {
                    path,
                    kind: HolderKind::Object,
                }) => Resolved::Builtin(path),
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
            symbols: symbols.into_boxed_slice(),
            commonjs,
            evaluated_texts: output.evaluated_texts.into_boxed_slice(),
            module_object_mentions: output.module_object_mentions.into_boxed_slice(),
            stores_with_module_exports: output.stores_with_module_exports.into_boxed_slice(),
            mentioned,
            exposed,
            uses,
            loads_unknown_modules,
        }
    }
}
