mod aliases;
mod evaluated_text;
mod imports;
mod mention_use;
mod mentions;
mod module_cache;
mod module_objects;
mod module_values;
mod paths;
mod resolver;
mod runtime_dialect;
mod stores_behind_tests;
#[cfg(test)]
mod tests;
mod unnamed_uses;
mod written_members;

pub use self::imports::find_module_export;
pub use self::module_cache::{KeyOfModuleCache, is_module_cache, is_table_of_loaders};
pub use self::module_values::{
    commonjs_variable_builtin, reads_what_wrapper_hands_in, redeclares_what_wrapper_hands_in,
};
pub use self::resolver::FileFacts;
pub use self::runtime_dialect::set_natives;
pub use self::unnamed_uses::can_lay_key_that_native_code_asks_of_process;
use super::names::BuiltinNames;
use super::runtime_uses::RuntimeUses;
use super::table::{
    self, BuiltinId, Intrinsic, Mutability, Platforms, RuntimeFunction, RuntimeModule,
};
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{Binding, Bound, CommonJsVariable, SymbolId};
use bun_sema::fold::{Constant, Decisions};
use bun_sema::hir::{self, Chain, ExprId, ExprKind, Keyword, MemberKey, NodeData, TypeNodeKind};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::module_format::ModuleFormat;
use core::ops::Range;
use smallvec::SmallVec;
use std::sync::{Arc, OnceLock};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SourceDialect {
    Program,
    Runtime,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct BuiltinPath {
    pub id: BuiltinId,
    pub mutability: Mutability,
}

impl BuiltinPath {
    pub fn locked_builtin(self) -> Option<BuiltinId> {
        let is_locked = self.mutability == Mutability::AlwaysLocked;
        (is_locked && table::is_legal_builtin_constant(self.id)).then_some(self.id)
    }
}

#[derive(Copy, Clone, Debug)]
pub enum Resolved {
    Builtin(BuiltinPath),
    DynamicGlobal(BuiltinPath),
    Intrinsic(Intrinsic),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EvaluatedTextForm {
    FunctionBody,
    Script,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EvaluatedText {
    pub call: ExprId,
    pub form: EvaluatedTextForm,
    pub callee: BuiltinPath,
    pub texts: SmallVec<[Atom; 2]>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModuleExport {
    Unknown,
    Absent,
    HeldByNamespace,
    PropertyOfNamespace(BuiltinId),
    Found(BuiltinId),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ModuleObjectOwner {
    OwnFile,
    EntryPoint,
    Related,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ModuleField {
    Id,
    Filename,
    Path,
    Loaded,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ModuleObjectUse {
    Field(ModuleField),
    Tested,
    ParentTested,
    Parent,
    Children,
    Object,
    HandedOn,
    HolderHandedOn,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ModuleObjectMention {
    pub expr: ExprId,
    pub owner: ModuleObjectOwner,
    pub object_use: ModuleObjectUse,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SpyCall {
    pub call: ExprId,
    pub object: ExprId,
    pub name: Option<Atom>,
}

pub struct ImportTargets {
    targets: Vec<(ImportSiteKind, Option<RuntimeModule>)>,
}

impl ImportTargets {
    pub fn new(targets: &[(ImportSiteKind, Option<RuntimeModule>)]) -> ImportTargets {
        debug_assert!(targets.is_sorted_by(|left, right| left.0 < right.0));
        ImportTargets {
            targets: targets.to_vec(),
        }
    }

    fn module_at(&self, site: ImportSiteKind) -> Option<RuntimeModule> {
        if self.targets.last().is_none_or(|last| last.0 < site) {
            return None;
        }
        let at = self.targets.binary_search_by_key(&site, |target| target.0);
        at.ok().and_then(|at| self.targets[at].1)
    }

    fn has_site(&self, site: ImportSiteKind) -> bool {
        self.targets
            .binary_search_by_key(&site, |target| target.0)
            .is_ok()
    }

    fn iter(&self) -> impl Iterator<Item = (ImportSiteKind, RuntimeModule)> + '_ {
        let targets = self.targets.iter();
        targets.filter_map(|&(site, module)| module.map(|module| (site, module)))
    }
}

pub const LOADED_BELOW_VITEST: &[u8] = b"%loaded-below-vitest";
pub const LOADED_BY_WORKER: &[u8] = b"%loaded-by-worker";
pub const GLOBALS_LEFT_ALONE: &[u8] = b"%globals-left-alone";
pub const BUN_OF_TEST_FILE: &[u8] = b"%bun";

fn keyword_accepts(keyword: Keyword, constant: Constant) -> bool {
    match (keyword, constant) {
        (Keyword::Any | Keyword::Unknown, _)
        | (_, Constant::Undefined | Constant::Null)
        | (Keyword::String, Constant::String(_))
        | (Keyword::Number, Constant::Number(_))
        | (Keyword::Boolean, Constant::Boolean(_))
        | (Keyword::BigInt, Constant::BigInt(_)) => true,
        (
            Keyword::Never
            | Keyword::Void
            | Keyword::Undefined
            | Keyword::Null
            | Keyword::String
            | Keyword::Number
            | Keyword::Boolean
            | Keyword::BigInt
            | Keyword::Symbol
            | Keyword::Object
            | Keyword::This
            | Keyword::Intrinsic,
            _,
        ) => false,
    }
}

pub fn passes_every_assertion(
    hir: &hir::File<'_>,
    expression: ExprId,
    constant: Option<Constant>,
) -> bool {
    let mut current = expression;
    while let Some(operand) = hir.type_assertion_operand(current) {
        if let ExprKind::As { ty, .. } = hir[current].kind {
            let TypeNodeKind::Keyword(keyword) = hir[ty].kind else {
                return false;
            };
            if constant.is_some_and(|constant| !keyword_accepts(keyword, constant)) {
                return false;
            }
        }
        current = operand;
    }
    true
}

pub struct ResolveInput<'a, 's> {
    pub hir: &'a hir::File<'s>,
    pub bound: &'a Bound<'s>,
    pub decisions: &'a Decisions<'s>,
    pub atoms: &'a Interner<'s>,
    pub module_format: ModuleFormat,
    pub targets: &'a ImportTargets,
    pub names: &'a BuiltinNames,
    pub platform: Platforms,
    pub dialect: SourceDialect,
    pub replaced: &'a [u32],
    pub runs_tests: bool,
    pub holds_language: bool,
    pub is_text_asked: bool,
}

#[derive(Copy, Clone, Default)]
struct CommonJsBuiltins {
    module: Option<BuiltinPath>,
    exports: Option<BuiltinPath>,
    require: Option<BuiltinPath>,
    filename: Option<BuiltinPath>,
    dirname: Option<BuiltinPath>,
}

impl CommonJsBuiltins {
    fn get(&self, variable: CommonJsVariable) -> Option<BuiltinPath> {
        match variable {
            CommonJsVariable::Module => self.module,
            CommonJsVariable::Exports => self.exports,
            CommonJsVariable::Require => self.require,
            CommonJsVariable::Filename => self.filename,
            CommonJsVariable::Dirname => self.dirname,
        }
    }

    fn set(&mut self, variable: CommonJsVariable, path: Option<BuiltinPath>) {
        match variable {
            CommonJsVariable::Module => self.module = path,
            CommonJsVariable::Exports => self.exports = path,
            CommonJsVariable::Require => self.require = path,
            CommonJsVariable::Filename => self.filename = path,
            CommonJsVariable::Dirname => self.dirname = path,
        }
    }
}

struct WhereMoreIsHandedOn {
    uses: RuntimeUses,
    loads_unknown_modules: bool,
    hands_on_loader_of_paths: bool,
}

struct WhereTestsLayNamesAbove {
    names_asked_for: Box<[(BuiltinId, Atom)]>,
    held: WhereMoreIsHandedOn,
    replaced_members: Box<[BuiltinId]>,
    opened_holders: Box<[BuiltinId]>,
    stores_loader_functions: bool,
}

#[derive(Default)]
pub struct ResolvedBuiltins {
    exprs: Box<[(ExprId, Resolved)]>,
    expr_bits: Box<[u64]>,
    exprs_with_side_effects: Box<[ExprId]>,
    symbols: Box<[(SymbolId, BuiltinPath)]>,
    names_in_patterns: Box<[(SymbolId, BuiltinPath)]>,
    commonjs: CommonJsBuiltins,
    evaluated_texts: Box<[EvaluatedText]>,
    module_object_mentions: Box<[ModuleObjectMention]>,
    may_store_path_of_main_module: bool,
    stores_with_module_exports: Box<[ExprId]>,
    replaced_members: Box<[BuiltinId]>,
    opened_holders: Box<[BuiltinId]>,
    names_added: Box<[(BuiltinId, Atom)]>,
    spy_calls: Box<[SpyCall]>,
    hands_spy_on: bool,
    hands_mock_on: bool,
    resets_modules: bool,
    stores_loader_functions: bool,
    process_reaches_code_on_its_prototypes: bool,
    inspects_prototype_chain_of_process: bool,
    method_that_hands_out_global_object_may_come_out: bool,
    tables_of_loaders_written: Box<[ExprId]>,
    unlocked: OnceLock<Arc<[u32]>>,
    mentioned: Box<[BuiltinId]>,
    #[cfg(test)]
    exposed: Box<[BuiltinId]>,
    uses: RuntimeUses,
    loads_unknown_modules: bool,
    hands_on_loader_of_paths: bool,
    where_hooks_of_instanceof_exist: Option<Box<WhereMoreIsHandedOn>>,
    hooks_of_instanceof_may_exist: OnceLock<()>,
    where_tests_lay_names_above: Option<Box<WhereTestsLayNamesAbove>>,
    tests_lay_names_above: OnceLock<()>,
    can_come_by_hook_of_instanceof: bool,
    keys_taken_out_of_module_cache: Box<[KeyOfModuleCache]>,
    entries_deleted_from_module_cache: Box<[ExprId]>,
    entries_stored_in_module_cache: Box<[ExprId]>,
    keys_of_entries_handed_on: Box<[KeyOfModuleCache]>,
    loses_sight_of_module_cache: bool,
    hands_module_cache_on: bool,
    names_plugin: bool,
    reaches_module_cache: bool,
}

impl ResolvedBuiltins {
    pub fn unlock(&self, members: Arc<[u32]>) {
        debug_assert!(members.is_sorted_by(|left, right| left < right));
        let is_first_list = self.unlocked.set(members).is_ok();
        assert!(is_first_list, "a second list would be dropped");
    }

    fn apply_unlocked_list(&self, mut path: BuiltinPath) -> BuiltinPath {
        if let Some(members) = self.unlocked.get()
            && members.binary_search(&(path.id as u32)).is_ok()
        {
            path.mutability = path.mutability.min(Mutability::ConstantUnlessWritten);
        }
        path
    }

    pub fn for_each_locked_builtin(&self, mut take: impl FnMut(BuiltinId)) {
        let of_exprs = self.exprs.iter().filter_map(|entry| match entry.1 {
            Resolved::Builtin(path) | Resolved::DynamicGlobal(path) => Some(path),
            Resolved::Intrinsic(_) => None,
        });
        let of_symbols = self.symbols.iter().chain(&self.names_in_patterns);
        for path in of_exprs.chain(of_symbols.map(|entry| entry.1)) {
            if let Some(builtin) = self.apply_unlocked_list(path).locked_builtin() {
                take(builtin);
            }
        }
    }

    pub fn is_unlocked(&self, place: BuiltinId) -> bool {
        let Some(members) = self.unlocked.get() else {
            return false;
        };
        let is_listed = |id: BuiltinId| members.binary_search(&(id as u32)).is_ok();
        is_listed(table::canonical_id(place)) || is_listed(place)
    }

    #[inline]
    pub fn of_expr(&self, expr: ExprId) -> Option<Resolved> {
        let index = expr.idx();
        let word = *self.expr_bits.get(index / 64)?;
        if word & (1 << (index % 64)) == 0 {
            return None;
        }
        self.find_listed_expr(expr)
    }

    #[inline(never)]
    fn find_listed_expr(&self, expr: ExprId) -> Option<Resolved> {
        let at = self.exprs.binary_search_by_key(&expr, |entry| entry.0);
        at.ok().map(|at| match self.exprs[at].1 {
            Resolved::Builtin(path) => Resolved::Builtin(self.apply_unlocked_list(path)),
            Resolved::DynamicGlobal(path) => {
                Resolved::DynamicGlobal(self.apply_unlocked_list(path))
            }
            Resolved::Intrinsic(intrinsic) => Resolved::Intrinsic(intrinsic),
        })
    }

    #[inline]
    pub fn of_pure_expr(&self, expr: ExprId) -> Option<Resolved> {
        let resolved = self.of_expr(expr)?;
        let has_side_effects = self.exprs_with_side_effects.binary_search(&expr).is_ok();
        (!has_side_effects).then_some(resolved)
    }

    pub fn global_path(
        &self,
        hir: &hir::File<'_>,
        bound: &Bound<'_>,
        expr: ExprId,
    ) -> Option<SmallVec<[BuiltinPath; 4]>> {
        let mut steps = SmallVec::new();
        let mut current = hir.skip_type_assertions(expr);
        loop {
            let Some(Resolved::Builtin(path)) = self.of_pure_expr(current) else {
                return None;
            };
            steps.push(path);
            match hir[current].kind {
                ExprKind::Dot {
                    chain: Chain::No, ..
                }
                | ExprKind::Index {
                    chain: Chain::No, ..
                } => match hir.member_key(current)? {
                    (object, MemberKey::Name(_)) => current = hir.skip_type_assertions(object),
                    (_, MemberKey::PrivateName(_) | MemberKey::Computed(_)) => return None,
                },
                ExprKind::Ident(_) => {
                    let is_free_name = bound.is_evaluated_ident(current)
                        && bound
                            .dynamic_lookup_scope(NodeData::Expr(current))
                            .is_none()
                        && bound.binding(current) == Binding::Free;
                    return is_free_name.then_some(steps);
                }
                _ => return None,
            }
        }
    }

    #[inline]
    pub fn builtin_of_expression(&self, expr: ExprId) -> Option<BuiltinId> {
        match self.of_expr(expr)? {
            Resolved::Builtin(path) => Some(path.id),
            Resolved::Intrinsic(Intrinsic::Builtin(id)) => Some(id),
            Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_) => None,
        }
    }

    pub fn of_symbol(&self, symbol: SymbolId) -> Option<BuiltinPath> {
        let at = self.symbols.binary_search_by_key(&symbol, |entry| entry.0);
        at.ok()
            .map(|at| self.apply_unlocked_list(self.symbols[at].1))
    }

    pub fn of_name_in_pattern(&self, symbol: SymbolId) -> Option<BuiltinPath> {
        let names = &self.names_in_patterns;
        let at = names.binary_search_by_key(&symbol, |entry| entry.0);
        at.ok().map(|at| self.apply_unlocked_list(names[at].1))
    }

    pub fn commonjs_variable(&self, variable: CommonJsVariable) -> Option<BuiltinPath> {
        let path = self.commonjs.get(variable)?;
        Some(self.apply_unlocked_list(path))
    }

    pub fn evaluated_text(&self, call: ExprId) -> Option<&EvaluatedText> {
        let texts = &self.evaluated_texts;
        let at = texts.binary_search_by_key(&call, |text| text.call).ok()?;
        Some(&texts[at])
    }

    pub fn evaluated_texts(&self) -> &[EvaluatedText] {
        &self.evaluated_texts
    }

    pub fn module_object_mentions(&self) -> &[ModuleObjectMention] {
        &self.module_object_mentions
    }

    pub fn module_object_mention(&self, expr: ExprId) -> Option<ModuleObjectMention> {
        let mentions = &self.module_object_mentions;
        let at = mentions
            .binary_search_by_key(&expr, |mention| mention.expr)
            .ok()?;
        Some(mentions[at])
    }

    pub fn may_store_path_of_main_module(&self) -> bool {
        self.may_store_path_of_main_module
    }

    pub fn is_stored_with_module_exports(&self, target: ExprId) -> bool {
        self.stores_with_module_exports.contains(&target)
    }

    pub fn replaced_members(&self) -> &[BuiltinId] {
        &self.replaced_members
    }

    pub fn opened_holders(&self) -> &[BuiltinId] {
        &self.opened_holders
    }

    pub fn names_added(&self) -> &[(BuiltinId, Atom)] {
        &self.names_added
    }

    pub fn spy_calls(&self) -> &[SpyCall] {
        &self.spy_calls
    }

    pub fn tables_of_loaders_written(&self) -> &[ExprId] {
        &self.tables_of_loaders_written
    }

    pub fn process_reaches_code_on_its_prototypes(&self) -> bool {
        self.process_reaches_code_on_its_prototypes
    }

    pub fn inspects_prototype_chain_of_process(&self) -> bool {
        self.inspects_prototype_chain_of_process
    }

    pub fn method_that_hands_out_global_object_may_come_out(&self) -> bool {
        self.method_that_hands_out_global_object_may_come_out
    }

    pub fn stores_loader_functions(&self) -> bool {
        self.stores_loader_functions
    }

    pub fn hands_spy_on(&self) -> bool {
        self.hands_spy_on
    }

    pub fn hands_mock_on(&self) -> bool {
        self.hands_mock_on
    }

    pub fn resets_modules(&self) -> bool {
        self.resets_modules
    }

    pub fn mentioned(&self) -> &[BuiltinId] {
        &self.mentioned
    }

    pub fn mentions_evaluator(&self) -> bool {
        let evaluators =
            table::BuiltinFlags::EVALUATES_TEXT | table::BuiltinFlags::RUNS_UNSEEN_CODE;
        let loads_by_name = [
            BuiltinId::ModuleRequire,
            BuiltinId::ImportMetaRequire,
            BuiltinId::ProcessGetBuiltinModule,
        ]
        .map(table::canonical_id);
        self.mentioned.iter().any(|&id| {
            let is_of_vm = table::entry(table::root_of(id)).module == Some(RuntimeModule::NodeVm);
            (is_of_vm || table::entry(id).flags.intersects(evaluators))
                && !loads_by_name.contains(&table::canonical_id(id))
        })
    }

    #[cfg(test)]
    pub fn exposed(&self) -> &[BuiltinId] {
        &self.exposed
    }

    fn find_what_holds_where_more_is_handed_on(&self) -> Option<&WhereMoreIsHandedOn> {
        if self.tests_lay_names_above.get().is_some() {
            return self
                .where_tests_lay_names_above
                .as_deref()
                .map(|it| &it.held);
        }
        self.hooks_of_instanceof_may_exist.get()?;
        self.where_hooks_of_instanceof_exist.as_deref()
    }

    pub fn can_come_by_hook_of_instanceof(&self) -> bool {
        self.can_come_by_hook_of_instanceof
    }

    pub fn hands_builtins_to_hooks_of_instanceof(&self) -> bool {
        self.where_hooks_of_instanceof_exist.is_some()
    }

    pub fn note_that_hooks_of_instanceof_may_exist(&self) {
        self.hooks_of_instanceof_may_exist.get_or_init(|| ());
    }

    pub fn names_asked_for_that_are_not_listed(&self) -> &[(BuiltinId, Atom)] {
        match &self.where_tests_lay_names_above {
            Some(found) => &found.names_asked_for,
            None => &[],
        }
    }

    pub fn note_that_tests_lay_names_above(&self) -> (&[BuiltinId], &[BuiltinId], bool) {
        self.tests_lay_names_above.get_or_init(|| ());
        match &self.where_tests_lay_names_above {
            Some(found) => (
                &found.replaced_members,
                &found.opened_holders,
                found.stores_loader_functions,
            ),
            None => (&[], &[], false),
        }
    }

    pub fn is_told_that_tests_lay_names_above(&self) -> bool {
        self.tests_lay_names_above.get().is_some()
    }

    pub fn is_told_that_hooks_of_instanceof_may_exist(&self) -> bool {
        self.hooks_of_instanceof_may_exist.get().is_some()
    }

    pub fn uses(&self) -> &RuntimeUses {
        match self.find_what_holds_where_more_is_handed_on() {
            Some(held) => &held.uses,
            None => &self.uses,
        }
    }

    pub fn into_uses(self) -> RuntimeUses {
        self.uses
    }

    pub fn loads_unknown_modules(&self) -> bool {
        match self.find_what_holds_where_more_is_handed_on() {
            Some(held) => held.loads_unknown_modules,
            None => self.loads_unknown_modules,
        }
    }

    pub fn hands_on_loader_of_paths(&self) -> bool {
        match self.find_what_holds_where_more_is_handed_on() {
            Some(held) => held.hands_on_loader_of_paths,
            None => self.hands_on_loader_of_paths,
        }
    }

    pub fn keys_of_entries_handed_on(&self) -> &[KeyOfModuleCache] {
        &self.keys_of_entries_handed_on
    }

    pub fn keys_taken_out_of_module_cache(&self) -> &[KeyOfModuleCache] {
        &self.keys_taken_out_of_module_cache
    }

    pub fn entries_deleted_from_module_cache(&self) -> &[ExprId] {
        &self.entries_deleted_from_module_cache
    }

    pub fn entries_stored_in_module_cache(&self) -> &[ExprId] {
        &self.entries_stored_in_module_cache
    }

    pub fn reaches_module_cache(&self) -> bool {
        self.reaches_module_cache
    }

    pub fn loses_sight_of_module_cache(&self) -> bool {
        self.loses_sight_of_module_cache
    }

    pub fn hands_module_cache_on(&self) -> bool {
        self.hands_module_cache_on
    }

    pub fn names_plugin(&self) -> bool {
        self.names_plugin
    }

    pub fn loaded_modules(&self) -> impl Iterator<Item = RuntimeModule> + '_ {
        self.uses().modules.iter().copied()
    }

    pub fn called_functions(&self) -> impl Iterator<Item = RuntimeFunction> + '_ {
        self.uses().functions.iter().copied()
    }
}

pub fn resolve_file(input: &ResolveInput<'_, '_>) -> ResolvedBuiltins {
    resolver::run(input, None, None)
}

pub fn resolve_within(
    input: &ResolveInput<'_, '_>,
    ranges: &[Range<u32>],
    facts: &FileFacts,
) -> ResolvedBuiltins {
    resolver::run(input, Some(ranges), Some(facts))
}
