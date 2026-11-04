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
mod written_members;

pub use self::imports::find_module_export;
pub use self::module_cache::{KeyOfModuleCache, is_module_cache, is_table_of_loaders};
pub use self::module_values::commonjs_variable_builtin;
pub use self::resolver::FileFacts;
pub use self::runtime_dialect::set_natives;
use super::names::BuiltinNames;
use super::runtime_uses::RuntimeUses;
use super::table::{
    self, BuiltinId, Intrinsic, Mutability, Platforms, RuntimeFunction, RuntimeModule,
};
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{Binding, Bound, CommonJsVariable, SymbolId};
use bun_sema::fold::Decisions;
use bun_sema::hir::{self, Chain, ExprId, ExprKind, MemberKey, NodeData};
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
    // A locked number, accessor or data property stays a read, which the engine folds: no operation names one.
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
    /// `module`.
    OwnFile,
    /// `require.main` and `process.mainModule`: the file that the process, or the Worker, has started with.
    EntryPoint,
    /// A file that `parent` or an element of `children` leads to.
    Related,
}

/// A member of a module object whose value the record of the module has.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ModuleField {
    Id,
    Filename,
    Path,
    Loaded,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ModuleObjectUse {
    /// `module.id`, `require.main.filename`: a plain read off what is that object in every run.
    Field(ModuleField),
    /// `!require.main`: only whether there is an object.
    Tested,
    /// `!module.parent`: only whether there is a parent.
    ParentTested,
    /// `module.parent` as a value: the objects of the files that request the owner.
    Parent,
    /// `module.children`, read or stored: the objects of the files that the owner requires.
    Children,
    /// The object is held, compared, stored into, or asked for a member that is none of the above.
    Object,
    /// The object, or the list of them, goes where nothing follows it. Whoever gets it reads any member, `parent` and `children` among them.
    HandedOn,
    /// `process`, or the global object, goes where nothing follows it. Whoever gets it may read `mainModule` there.
    HolderHandedOn,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ModuleObjectMention {
    /// The member for `Field`, `ParentTested`, `Parent` and `Children`, else what stands for the object.
    pub expr: ExprId,
    pub owner: ModuleObjectOwner,
    pub object_use: ModuleObjectUse,
}

/// `spyOn(object, name)` of bun:test, `jest.spyOn`, `vi.spyOn`, by the binding of the callee, where `object` is no built-in.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SpyCall {
    pub call: ExprId,
    pub object: ExprId,
    /// `None`: folding knows no constant for it.
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

/// The variables that load/test_runner_names.rs makes for the answer to who has loaded a file: `(loadedByWorker ??= ..) ? jest : local`. No program can write such a name.
pub const LOADED_BELOW_VITEST: &[u8] = b"%loaded-below-vitest";
pub const LOADED_BY_WORKER: &[u8] = b"%loaded-by-worker";

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
    /// Ascending. For application files, `LoadOptions::replaced_builtins`: what the files themselves replace is known only after all of them load, and arrives through `unlock`.
    /// For Bun's own code, `ProgramContents::replaced_builtins`.
    pub replaced: &'a [u32],
    /// When false, the file is not searched for writes that replace members of built-in objects, spies, mocks or `resetModules()`.
    /// An executable rejects those writes, so they must not unlock anything there. The names that a file adds are sought in every build.
    pub runs_tests: bool,
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

#[derive(Default)]
pub struct ResolvedBuiltins {
    exprs: Box<[(ExprId, Resolved)]>,
    expr_bits: Box<[u64]>,
    exprs_with_side_effects: Box<[ExprId]>,
    symbols: Box<[(SymbolId, BuiltinPath)]>,
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
    unlocked: OnceLock<Arc<[u32]>>,
    mentioned: Box<[BuiltinId]>,
    #[cfg(test)]
    exposed: Box<[BuiltinId]>,
    uses: RuntimeUses,
    loads_unknown_modules: bool,
    hands_on_loader_of_paths: bool,
    keys_taken_out_of_module_cache: Box<[KeyOfModuleCache]>,
    loses_sight_of_module_cache: bool,
    hands_module_cache_on: bool,
    names_plugin: bool,
    reaches_module_cache: bool,
    reads_entries_of_module_cache: bool,
}

impl ResolvedBuiltins {
    /// Call at most once, after every application file has loaded, with everything the test run's files replace, ascending.
    /// From then on, a path whose `id` is in `members` is at most `ConstantUnlessWritten`.
    /// A path's `id` is the `table::canonical_id` of the place it was read from, so `members` must hold the canonical id of every replaced place.
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

    /// Whether the list given to `unlock` has the place, or what the place holds. No place has been unlocked before that call, or in an executable.
    pub fn is_unlocked(&self, place: BuiltinId) -> bool {
        let Some(members) = self.unlocked.get() else {
            return false;
        };
        let is_listed = |id: BuiltinId| members.binary_search(&(id as u32)).is_ok();
        is_listed(table::canonical_id(place)) || is_listed(place)
    }

    pub fn of_expr(&self, expr: ExprId) -> Option<Resolved> {
        let index = expr.idx();
        let word = *self.expr_bits.get(index / 64)?;
        if word & (1 << (index % 64)) == 0 {
            return None;
        }
        let at = self.exprs.binary_search_by_key(&expr, |entry| entry.0);
        at.ok().map(|at| match self.exprs[at].1 {
            Resolved::Builtin(path) => Resolved::Builtin(self.apply_unlocked_list(path)),
            Resolved::DynamicGlobal(path) => {
                Resolved::DynamicGlobal(self.apply_unlocked_list(path))
            }
            Resolved::Intrinsic(intrinsic) => Resolved::Intrinsic(intrinsic),
        })
    }

    /// `of_expr` resolves the value of `(f(), Object.keys)` and `(f(), module).exports` too. Whatever stands in for an expression, or drops it, asks this one.
    pub fn of_pure_expr(&self, expr: ExprId) -> Option<Resolved> {
        let has_side_effects = self.exprs_with_side_effects.binary_search(&expr).is_ok();
        self.of_expr(expr).filter(|_| !has_side_effects)
    }

    /// `Object.keys` gives `[Object.keys, Object]`. It answers only for a free name and for named, non-optional member reads on one.
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

    /// In the order of the expressions.
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

    /// By binding, in a file of the program: `Bun.main = path`, a store into `Bun` under a key that folding does not know, or `Bun` goes somewhere as a value.
    /// The file at the path that `Bun.main` holds is the main module, so no file of such a program is folded with whether it is.
    pub fn may_store_path_of_main_module(&self) -> bool {
        self.may_store_path_of_main_module
    }

    /// Whether `target` is the name `exports` in `exports = module.exports = value` as a statement of the body of a CommonJS file: from there on both name the one value, so the store needs no parameter to go to.
    pub fn is_stored_with_module_exports(&self, target: ExprId) -> bool {
        self.stores_with_module_exports.contains(&target)
    }

    /// Ascending, each once. Empty unless the file is part of a test run: the members of built-in objects that the file may give another value, and the modules of native code that it mocks.
    /// With each goes every member the table lists below it: behind `globalThis.Map = Fake`, `Map.prototype.get` is no function of the table either.
    pub fn replaced_members(&self) -> &[BuiltinId] {
        &self.replaced_members
    }

    /// Ascending, each once. Empty unless the file is part of a test run: the built-in objects of which the file may write any member.
    /// Each as `table::canonical_id` names it, the global object as `BuiltinId::GlobalThis`. The object itself stays what it is.
    pub fn opened_holders(&self) -> &[BuiltinId] {
        &self.opened_holders
    }

    /// By holder, each once, in every build: the new names the file writes on built-in objects that take no new names. `Function.prototype.once = f`.
    /// Outside a test run only those of a file of the program, and none on `Object.prototype`.
    pub fn names_added(&self) -> &[(BuiltinId, Atom)] {
        &self.names_added
    }

    /// Sorted by `call`. Empty unless the file is part of a test run.
    pub fn spy_calls(&self) -> &[SpyCall] {
        &self.spy_calls
    }

    /// In a test run: the file passes a `spyOn` function around as a value, so not all of its calls can be seen.
    pub fn hands_spy_on(&self) -> bool {
        self.hands_spy_on
    }

    /// In a test run: `mock`, `jest` or `vi`, or what mocks a module below one of them, goes somewhere as a value, so nobody sees which modules it mocks.
    pub fn hands_mock_on(&self) -> bool {
        self.hands_mock_on
    }

    /// In a test run: the file may call `jest.resetModules()`, `vi.resetModules()` or `jest.isolateModules()`, so every loaded file may load again.
    pub fn resets_modules(&self) -> bool {
        self.resets_modules
    }

    pub fn mentioned(&self) -> &[BuiltinId] {
        &self.mentioned
    }

    /// `eval`, `Function`, node:vm: a text imports what it likes. The table flags the three functions that load by a name too, and `require("node:path")` is as closed as
    /// an import of it: `ProgramContents::loads_by_unknown_path` says where one of them is handed on, or is given a name that the build does not know.
    pub fn mentions_evaluator(&self) -> bool {
        let evaluators = table::BuiltinFlags::EVALUATES_TEXT | table::BuiltinFlags::RUNS_UNSEEN_CODE;
        let loads_by_name = [
            BuiltinId::ModuleRequire,
            BuiltinId::ImportMetaRequire,
            BuiltinId::ProcessGetBuiltinModule,
        ]
        .map(table::canonical_id);
        self.mentioned.iter().any(|&id| {
            table::entry(id).flags.intersects(evaluators)
                && !loads_by_name.contains(&table::canonical_id(id))
        })
    }

    #[cfg(test)]
    pub fn exposed(&self) -> &[BuiltinId] {
        &self.exposed
    }

    pub fn uses(&self) -> &RuntimeUses {
        &self.uses
    }

    pub fn loads_unknown_modules(&self) -> bool {
        self.loads_unknown_modules
    }

    /// As `loads_unknown_modules`, but for `process.getBuiltinModule`, which takes the names of library modules and no path.
    pub fn hands_on_loader_of_paths(&self) -> bool {
        self.hands_on_loader_of_paths
    }

    /// `delete require.cache[key]`, `Reflect.deleteProperty(require.cache, key)` and a store to `require.cache[key]`, whatever it stores, also of `Module._cache` and of a name that holds the table.
    pub fn keys_taken_out_of_module_cache(&self) -> &[KeyOfModuleCache] {
        &self.keys_taken_out_of_module_cache
    }

    /// The file gets at an entry of the table: it may read what the entry exports, and store in it.
    /// Whoever lets go of something that leads to the table, a `module` or a `process`, gets at none:
    /// who gets it names the table himself; and a `require` that goes out of sight is a loader that is given names which the build does not know, which has rules of its own.
    pub fn reaches_module_cache(&self) -> bool {
        self.reaches_module_cache
    }

    /// The file may read what an entry of the table exports. Whoever takes an entry out, or stores one, reads none.
    /// Neither does whoever lets go of something that leads to the table, a `module` or a `process`: that is said of nearly every program, and who gets it names the table himself.
    pub fn reads_entries_of_module_cache(&self) -> bool {
        self.reads_entries_of_module_cache
    }

    /// The table goes where this file does not follow it: whoever gets it may take any entry out.
    /// Also where the file names `Bun.plugin`: what a plugin loads takes the place of a file as if that had been taken out.
    pub fn loses_sight_of_module_cache(&self) -> bool {
        self.loses_sight_of_module_cache
    }

    /// The table itself goes where this file does not follow it: whoever gets it stores what he likes under any key. `loses_sight_of_module_cache` holds then too.
    pub fn hands_module_cache_on(&self) -> bool {
        self.hands_module_cache_on
    }

    pub fn names_plugin(&self) -> bool {
        self.names_plugin
    }

    pub fn loaded_modules(&self) -> impl Iterator<Item = RuntimeModule> + '_ {
        self.uses.modules.iter().copied()
    }

    pub fn called_functions(&self) -> impl Iterator<Item = RuntimeFunction> + '_ {
        self.uses.functions.iter().copied()
    }
}

pub fn resolve_file(input: &ResolveInput<'_, '_>) -> ResolvedBuiltins {
    resolver::run(input, None, None)
}

/// The built-ins of a part of a file: the code in these ranges of positions, which are in order and do not overlap.
pub fn resolve_within(
    input: &ResolveInput<'_, '_>,
    ranges: &[Range<u32>],
    facts: &FileFacts,
) -> ResolvedBuiltins {
    resolver::run(input, Some(ranges), Some(facts))
}
