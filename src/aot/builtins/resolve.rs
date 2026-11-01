mod aliases;
mod builtins_of_files;
mod evaluated_text;
mod imports;
mod mention_use;
mod mentions;
mod module_cache;
mod module_objects;
mod module_values;
mod paths;
mod replaced_members;
mod resolver;
mod runtime_dialect;
mod spelled_values;
#[cfg(test)]
mod tests;
mod unnamed_holders;
mod walked_texts;

pub use self::imports::find_module_export;
pub use self::module_cache::{KeyOfModuleCache, is_module_cache, is_table_of_loaders};
pub use self::module_values::commonjs_variable_builtin;
pub use self::replaced_members::{find_member_written_behind, members_written_under_any_name};
pub use self::resolver::FileFacts;
pub use self::runtime_dialect::set_natives;
use super::names::BuiltinNames;
use super::runtime_uses::RuntimeUses;
use super::table::{
    self, BuiltinId, Intrinsic, Mutability, Platforms, RuntimeFunction, RuntimeModule,
};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Bound, CommonJsVariable, SymbolId};
use bun_sema::fold::Decisions;
use bun_sema::hir::{self, Chain, ExprId, ExprKind, MemberKey, NodeData};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::module_format::ModuleFormat;
use bun_sema::util::SharedSort;
use core::ops::Range;
use smallvec::SmallVec;

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
    /// A file that `parent` or an element of `children` leads to, or a binding that something has stored a module object into.
    Related,
    /// `require.cache[path]` in a test run, where the cache lists the compiled files: any of them.
    ListedInCache,
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
    /// `process` goes where nothing follows it. Whoever gets it may read `mainModule` there.
    HolderHandedOn,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ModuleObjectMention {
    /// The member for `Field`, `ParentTested`, `Parent` and `Children`, else what stands for the object.
    pub expr: ExprId,
    pub owner: ModuleObjectOwner,
    pub object_use: ModuleObjectUse,
}

/// `spyOn(object, key)`, `Object.defineProperty(object, key, d)`: one of the values that the file spells for `object`.
#[derive(Copy, Clone, Debug)]
pub struct ObjectSpelled {
    pub key: ExprId,
    pub object: ExprId,
    pub is_builtin: bool,
}

/// `import { make } from "./helper"; make().prototype.get = f`
#[derive(Clone, Debug)]
pub struct WriteOnImport {
    /// As the file writes it.
    pub module: Atom,
    /// The names between what is imported and the write, from the write on: `prototype`.
    pub path: Vec<Atom>,
    pub key: Atom,
}

/// A built-in that a file exports, and the names that lead to it from what `import * as` of the file gives:
/// `export const { getPrototypeOf } = Object` has one under `getPrototypeOf`, `export default console` under `default`,
/// `module.exports = { holder: Object }` and `export default { holder: Object }` under `default` and then `holder`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct BuiltinExported {
    pub path: SmallVec<[Atom; 2]>,
    pub builtin: BuiltinId,
}

/// What a load of another file gives, as far as that file binds it to built-ins. Also of a module of Bun that is written in JavaScript.
pub struct BuiltinsOfLoadedFile {
    pub site: ImportSiteKind,
    /// `require()` gives what stands under `default`, and a name that the file does not export is a property of that: a CommonJS file, a module of Bun.
    pub object_is_default: bool,
    pub exported: Vec<BuiltinExported>,
}

pub struct ImportTargets {
    targets: Vec<(ImportSiteKind, Option<RuntimeModule>)>,
    loaded_files: Vec<BuiltinsOfLoadedFile>,
}

impl ImportTargets {
    pub fn new(targets: &[(ImportSiteKind, Option<RuntimeModule>)]) -> ImportTargets {
        debug_assert!(targets.is_sorted_by(|left, right| left.0 < right.0));
        ImportTargets {
            targets: targets.to_vec(),
            loaded_files: Vec::new(),
        }
    }

    /// Only whoever reads the files of a test run ahead of its builds knows this much about another file. A build leaves it to the engine, which follows the values.
    pub fn with_loaded_files(mut self, mut files: Vec<BuiltinsOfLoadedFile>) -> ImportTargets {
        files.shared_sort_unstable_by_key(|file| file.site);
        self.loaded_files = files;
        self
    }

    fn loaded_file_at(&self, site: ImportSiteKind) -> Option<&BuiltinsOfLoadedFile> {
        let at = (self.loaded_files).binary_search_by_key(&site, |file| file.site);
        at.ok().map(|at| &self.loaded_files[at])
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

pub struct ResolveInput<'a, 's> {
    pub hir: &'a hir::File<'s>,
    pub bound: &'a Bound<'s>,
    pub decisions: &'a Decisions<'s>,
    pub module_format: ModuleFormat,
    pub targets: &'a ImportTargets,
    pub names: &'a BuiltinNames,
    pub platform: Platforms,
    pub dialect: SourceDialect,
    /// `LoadOptions::replaced_builtins`.
    pub replaced: &'a [u32],
    pub replaced_members_sought: ReplacedMembersSought,
}

/// What a file is searched for. See `replaced_members`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ReplacedMembersSought {
    None,
    /// No test run: the names that the file adds to built-in objects where it writes them. What it replaces stays locked, and so does Object.prototype.
    NamesAdded,
    /// A file of a test run that an executable holds too. It is read as there, `NamesAdded`: what it replaces throws in the executable, and a suite that is green has to say so.
    NamesAddedByProduct,
    /// Where the file writes a member of a built-in object. In a package a helper that is handed an object and a name mostly reads: `getNative(Object, "create")`.
    /// So there the object beside the name counts only for a member that is tested where it is used anyway, `fetch` and the timers: to open one costs nothing.
    Written,
    /// And where it may: the object beside the name.
    WrittenOrNamed,
    /// A file of the project outside the folders of the tests. Whether an executable holds it shows behind the load, so it is read both ways: as `WrittenOrNamed`,
    /// and what `NamesAdded` finds is kept beside it.
    WrittenOrNamedUnlessOfProduct,
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
    stores_with_module_exports: Box<[ExprId]>,
    replaced_members: Box<[BuiltinId]>,
    names_added: Box<[(BuiltinId, Atom)]>,
    names_added_in_executable: Box<[(BuiltinId, Atom)]>,
    holders_named_from_outside: Box<[BuiltinId]>,
    writes_on_parameters_under_any_name: bool,
    builtins_handed_out: Box<[BuiltinId]>,
    builtins_exported: Box<[BuiltinExported]>,
    writes_on_imports: Box<[WriteOnImport]>,
    modules_written_on: Box<[Atom]>,
    mentioned: Box<[BuiltinId]>,
    #[cfg(test)]
    exposed: Box<[BuiltinId]>,
    uses: RuntimeUses,
    guessed_uses: RuntimeUses,
    loads_unknown_modules: bool,
    keys_spelled_on_other_objects: Box<[(ExprId, Atom)]>,
    objects_spelled_for_calls: Box<[ObjectSpelled]>,
    keys_partly_read: Box<[ExprId]>,
    calls_that_may_stub_global: Box<[(ExprId, BuiltinId)]>,
    keys_taken_out_of_module_cache: Box<[KeyOfModuleCache]>,
    keys_stored_in_module_cache: Box<[KeyOfModuleCache]>,
    hands_module_cache_on: bool,
    loses_sight_of_module_cache: bool,
    names_plugin: bool,
    reaches_module_cache: bool,
    reads_entries_of_module_cache: bool,
}

impl ResolvedBuiltins {
    pub fn of_expr(&self, expr: ExprId) -> Option<Resolved> {
        let index = expr.idx();
        let word = *self.expr_bits.get(index / 64)?;
        if word & (1 << (index % 64)) == 0 {
            return None;
        }
        let at = self.exprs.binary_search_by_key(&expr, |entry| entry.0);
        at.ok().map(|at| self.exprs[at].1)
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
        at.ok().map(|at| self.symbols[at].1)
    }

    pub fn commonjs_variable(&self, variable: CommonJsVariable) -> Option<BuiltinPath> {
        self.commonjs.get(variable)
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

    /// Whether `target` is the name `exports` in `exports = module.exports = value` as a statement of the body of a CommonJS file: from there on both name the one value, so the store needs no parameter to go to.
    pub fn is_stored_with_module_exports(&self, target: ExprId) -> bool {
        self.stores_with_module_exports.contains(&target)
    }

    /// Ascending. Of a file of a test run: the locked members of built-in objects that it writes under names that it spells.
    pub fn replaced_members(&self) -> &[BuiltinId] {
        &self.replaced_members
    }

    /// Of a file of a test run: the names of its own that it writes on built-in objects which take no new names. `Object.prototype.polluted = 1`.
    pub fn names_added(&self) -> &[(BuiltinId, Atom)] {
        &self.names_added
    }

    /// Of a file of a package in a test run, `ReplacedMembersSought::Written`: what `names_added` holds where the build of an executable reads the file.
    pub fn names_added_in_executable(&self) -> &[(BuiltinId, Atom)] {
        &self.names_added_in_executable
    }

    /// The objects that take no new names and that the file writes under a key which nothing in it spells: `export function plant(name) { Object.prototype[name] = 1; }`.
    pub fn holders_named_from_outside(&self) -> &[BuiltinId] {
        &self.holders_named_from_outside
    }

    /// The file writes on what a parameter holds, under a key which nothing in it spells: `export function silence(target, names) { for (const name of names) target[name] = noop; }`.
    pub fn writes_on_parameters_under_any_name(&self) -> bool {
        self.writes_on_parameters_under_any_name
    }

    /// The built-in objects that what the file exports stands for, holds or answers: `export const ofMath = () => new Proxy(Math, {})`.
    pub fn builtins_handed_out(&self) -> &[BuiltinId] {
        &self.builtins_handed_out
    }

    /// Of a file of a test run: the built-ins that it exports, each under a binding that nothing stores to.
    pub fn builtins_exported(&self) -> &[BuiltinExported] {
        &self.builtins_exported
    }

    /// Where the file writes, under the name of a member of some built-in object, on what comes out of an import.
    pub fn writes_on_imports(&self) -> &[WriteOnImport] {
        &self.writes_on_imports
    }

    /// The modules, as the file writes them, on whose exports it writes under a name that it spells: `import { File } from "parts"; File.prototype.own = 1`.
    pub fn modules_written_on(&self) -> &[Atom] {
        &self.modules_written_on
    }

    pub fn mentioned(&self) -> &[BuiltinId] {
        &self.mentioned
    }

    #[cfg(test)]
    pub fn exposed(&self) -> &[BuiltinId] {
        &self.exposed
    }

    pub fn uses(&self) -> &RuntimeUses {
        &self.uses
    }

    /// `MentionedUses::guessed` of a file of the program.
    pub fn guessed_uses(&self) -> &RuntimeUses {
        &self.guessed_uses
    }

    pub fn loads_unknown_modules(&self) -> bool {
        self.loads_unknown_modules
    }

    /// Of a file of a test run. `key`: the key of `spyOn(object, key)`, `Object.defineProperty(object, key, ..)` or `object[key] = ..` on an object that is no
    /// built-in, without its type assertions. The names that the file spells for it: the key itself, what a constant holds, the elements of the list that a
    /// loop walks, what the calls of a function of the file pass. Some of the names, not all of them.
    /// `key` as for `keys_spelled_for`. What the file spells for the object of that call: `const files = fs as Record<string, F>; spyOn(files, key)`,
    /// `[fs, fsPromises].map(module => spyOn(module, key))`. The object itself where nothing is known of it. A parameter may get more from another file.
    pub fn objects_spelled_for(&self, key: ExprId) -> &[ObjectSpelled] {
        let objects = &self.objects_spelled_for_calls;
        let start = objects.partition_point(|entry| entry.key < key);
        let end = objects.partition_point(|entry| entry.key <= key);
        &objects[start..end]
    }

    /// `key` as for `keys_spelled_for`. Whether something reaches the key that the file does not spell: a parameter that nobody in the file passes,
    /// what a call returns. `keys_spelled_for` then lists some of its names at most.
    pub fn is_key_partly_read(&self, key: ExprId) -> bool {
        self.keys_partly_read.binary_search(&key).is_ok()
    }

    pub fn stubs_that_call_may_be(&self, call: ExprId) -> impl Iterator<Item = BuiltinId> + '_ {
        let calls = &self.calls_that_may_stub_global;
        let start = calls.partition_point(|entry| entry.0 < call);
        let end = calls.partition_point(|entry| entry.0 <= call);
        calls[start..end].iter().map(|entry| entry.1)
    }

    pub fn keys_spelled_for(&self, key: ExprId) -> impl Iterator<Item = Atom> + '_ {
        let keys = &self.keys_spelled_on_other_objects;
        let start = keys.partition_point(|entry| entry.0 < key);
        (keys[start..].iter())
            .take_while(move |entry| entry.0 == key)
            .map(|entry| entry.1)
    }

    /// `delete require.cache[key]`, `Reflect.deleteProperty(require.cache, key)` and `require.cache[key] = undefined`, also of `Module._cache` and of a name that holds the table.
    pub fn keys_taken_out_of_module_cache(&self) -> &[KeyOfModuleCache] {
        &self.keys_taken_out_of_module_cache
    }

    /// `require.cache[key] = entry`: those of `keys_taken_out_of_module_cache` under which the file may leave an entry of its own.
    pub fn keys_stored_in_module_cache(&self) -> &[KeyOfModuleCache] {
        &self.keys_stored_in_module_cache
    }

    pub fn hands_module_cache_on(&self) -> bool {
        self.hands_module_cache_on
    }

    /// The file gets at an entry of the table: it may read what the entry exports, and store in it.
    /// Whoever lists the keys, or compares what an entry exports with a value that he has, gets at none. Neither does whoever lets go of something that leads to the table, a `module` or
    /// a `process`: who gets it names the table himself; and a `require` that goes out of sight is a loader that is given names which the build does not know, which has rules of its own.
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

/// A file of a program of which `AotOptions::imports_are_in_other_images` holds.
pub fn resolve_file_served_by_other_images(input: &ResolveInput<'_, '_>) -> ResolvedBuiltins {
    resolver::run_for_program(input, None, None, true)
}

/// The built-ins of a part of a file: the code in these ranges of positions, which are in order and do not overlap.
pub fn resolve_within(
    input: &ResolveInput<'_, '_>,
    ranges: &[Range<u32>],
    facts: &FileFacts,
) -> ResolvedBuiltins {
    resolver::run(input, Some(ranges), Some(facts))
}
