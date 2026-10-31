//! Which files of a test run may load a second time. `delete require.cache[path]` makes the next `require()` or `import()` of the file load it again, from
//! disk, and so does `require.cache[path] = undefined`. Code that asks for such a file asks the run time which instance answers, and knows nothing of what it gets, so the fewer the better.
//! So does an import statement of a test file, which may be linked behind the `delete` of an earlier one: `leave_imports_of_test_files_to_loader`.
//! A file that the run itself writes, moves or removes is among them, though it may load only once: `bun test` reads what lies on disk when something first loads it.

use super::module_set::ModuleSet;
use super::plan::ModuleRef;
use super::requests::{ScannedSite, Scans};
use super::{BindInput, ReplacedModules};
use crate::builtins::{KeyOfModuleCache, ResolvedBuiltins, RuntimeModule, table};
use crate::load::loader_aliases::resolve_loader_alias;
use crate::load::sources::{SourceKind, parsed_source};
use crate::options::ReplacedModule;
use crate::statistics::logs_stages;
use bun_ast::Target;
use bun_core::strings::{contains, index_of_char, last_index_of_char};
use bun_paths::resolve_path::{dirname, join_abs_string_buf_checked, platform};
use bun_paths::{is_absolute, path_buffer_pool};
use bun_resolve_builtins::HardcodedModule::BUN_ALIASES;
use bun_resolve_builtins::{Alias, Cfg};
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{Binding, BindingInitializer, Bound, FnOwner, Parent};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{ExprId, ExprKind, StmtId, StmtKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, is_made_require};
use bun_sema::program::FileId;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::host::{from_argument, to_native};

#[derive(Default)]
pub(super) struct EvictedModules {
    modules: FxHashSet<ModuleRef>,
    is_every_module: bool,
    /// What the texts of `modules` name. A copy from disk links to the names of compiled modules.
    named_by_copies: FxHashSet<ModuleRef>,
    /// A file may read what the table lists, and an entry shows all that its file exports. Or a copy names a file that nobody knows.
    is_every_export_asked_for: bool,
    /// The text of a copy names a file that nobody knows.
    copies_name_any_file: bool,
    /// A file names the table, or lets go of something that leads there: it may get at the entry of a file, and store other `exports` in it.
    is_table_reached: bool,
    /// `writeFileSync(path, text)`: the files of the program at the paths that a file spells to a call which writes, moves or removes what is there.
    /// What loads from there is a text that nobody has read.
    changed_on_disk: FxHashSet<ModuleRef>,
}

impl EvictedModules {
    pub(super) fn contains(&self, module: ModuleRef) -> bool {
        self.is_every_module || self.modules.contains(&module)
    }

    pub(super) fn is_every_module(&self) -> bool {
        self.is_every_module
    }

    pub(super) fn is_table_reached(&self) -> bool {
        self.is_every_module || self.is_table_reached
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = ModuleRef> + '_ {
        self.modules.iter().copied()
    }

    pub(super) fn changed_on_disk(&self) -> impl Iterator<Item = ModuleRef> + '_ {
        self.changed_on_disk.iter().copied()
    }

    pub(super) fn is_every_export_asked_for(&self) -> bool {
        self.is_every_module || self.is_every_export_asked_for
    }

    /// Whether `asked_for_any_export` falls short of what a copy from disk may name.
    pub(super) fn copies_name_every_module(&self) -> bool {
        self.is_every_module || self.copies_name_any_file
    }

    /// The modules of which somebody out of sight may ask for any export, where that is not all of them.
    pub(super) fn asked_for_any_export(&self) -> impl Iterator<Item = ModuleRef> + '_ {
        self.modules.iter().chain(&self.named_by_copies).copied()
    }
}

/// What a key of the table names, as far as the file says it.
pub(crate) enum FileOfKey {
    /// `require.resolve("./a")`: the place of the call in `FileAnalysis::import_sites`.
    Site(usize),
    Path(Atom),
    Unknown,
}

/// `const path = require.resolve("./a"); delete require.cache[path];`
pub(crate) fn find_file_of_key(
    hir: &bun_sema::hir::File<'_>,
    bound: &bun_sema::bind::Bound<'_>,
    analysis: &bun_sema::file_analysis::FileAnalysis<'_>,
    key: KeyOfModuleCache,
) -> FileOfKey {
    let key = match key {
        KeyOfModuleCache::Text(path) => return FileOfKey::Path(path),
        KeyOfModuleCache::Computed(key) => key,
    };
    let mut key = hir.skip_type_assertions(key);
    // `const a = b, b = a` leads round.
    let mut followed = Vec::new();
    loop {
        if let FoldedValue::Constant(Constant::String(path)) = analysis.decisions.constant(hir, key)
        {
            return FileOfKey::Path(path);
        }
        let is_this_call = |kind: ImportSiteKind| kind == ImportSiteKind::RequireResolve(key);
        if let Some(site) = (analysis.import_sites.iter()).position(|site| is_this_call(site.kind))
        {
            return FileOfKey::Site(site);
        }
        let Binding::Symbol(symbol) = bound.binding(key) else {
            return FileOfKey::Unknown;
        };
        if !bound.is_evaluated_ident(key)
            || !bound.is_stable_binding(symbol)
            || followed.contains(&symbol)
        {
            return FileOfKey::Unknown;
        }
        followed.push(symbol);
        let BindingInitializer::Expression(initializer) = bound.binding_initializer(hir, symbol)
        else {
            return FileOfKey::Unknown;
        };
        key = hir.skip_type_assertions(initializer);
    }
}

/// `try { require("./a.cjs"); } catch {}`, `expect(() => require("./a.cjs")).toThrow()`, `test("a", () => { require("./a.cjs"); })`: the program goes on behind a body that throws.
/// Whoever is handed a function may catch what it throws.
pub(crate) fn stands_where_a_throw_is_caught(
    hir: &bun_sema::hir::File<'_>,
    bound: &Bound<'_>,
    mut call: ExprId,
) -> bool {
    let statement_around = |parent: Parent| -> Option<StmtId> {
        match parent {
            Parent::Stmt(statement) => statement.some(),
            Parent::VarInit(declaration) => bound.var_stmt[declaration.idx()].some(),
            Parent::Case(case) => bound.case_stmt[case.idx()].some(),
            _ => None,
        }
    };
    loop {
        let mut parent = bound.parent_of_expr(call);
        while let Parent::Expr(outer) = parent {
            parent = bound.parent_of_expr(outer);
        }
        while let Some(inner) = statement_around(parent) {
            parent = bound.parent_of_stmt(inner);
            let is_guarded = statement_around(parent).is_some_and(|outer| {
                matches!(hir[outer].kind, StmtKind::Try { block, handler, .. } if block == inner && handler.is_some())
            });
            if is_guarded {
                return true;
            }
        }
        let Parent::FnBody(function) = parent else {
            return false;
        };
        let FnOwner::Expr(function) = bound.fns[function.idx()].owner else {
            return false;
        };
        let Parent::Expr(user) = bound.parent_of_expr(function) else {
            return false;
        };
        let (ExprKind::Call(site) | ExprKind::New(site)) = hir[user].kind else {
            return false;
        };
        if hir[site].callee != function {
            return true;
        }
        // `(() => require("./a.cjs"))()`: what it throws goes on to what stands around the call.
        call = user;
    }
}

/// `import("./a.js?again")` loads the file once more, from disk. What stands in front of the `?` in each specifier that has one.
/// `None`: the `?` follows a part that nobody knows.
pub(crate) fn find_files_named_with_query<'a>(
    atoms: &'a bun_sema::atom::Interner<'_>,
    analysis: &bun_sema::file_analysis::FileAnalysis<'_>,
) -> Vec<Option<&'a [u8]>> {
    let before_query = |text: Atom| {
        let text = atoms.bytes(text);
        index_of_char(text, b'?').map(|at| &text[..at as usize])
    };
    let mut named = Vec::new();
    for site in analysis.import_sites {
        for specifier in analysis.alternatives_of(&site.specifier) {
            match *specifier {
                ImportSpecifier::Constant(text) => named.extend(before_query(text).map(Some)),
                ImportSpecifier::Pattern { prefix, suffix } => match before_query(prefix) {
                    Some(file) => named.push(Some(file)),
                    None => named.extend(before_query(suffix).map(|_| None)),
                },
                ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => {}
            }
        }
    }
    named
}

// The compiled file that `importer` means with a path. `./a.js` may stand for `./a.ts`.
fn find_file_beside(
    by_path: &ReplacedModules<'_>,
    importer: &[u8],
    written: &[u8],
) -> Option<ModuleRef> {
    const WRITTEN_FOR_OUTPUT: [(&[u8], [&[u8]; 2]); 4] = [
        (b".js", [b".ts", b".tsx"]),
        (b".jsx", [b".tsx", b".tsx"]),
        (b".mjs", [b".mts", b".mts"]),
        (b".cjs", [b".cts", b".cts"]),
    ];
    if !written.starts_with(b"./") && !written.starts_with(b"../") && !is_absolute(written) {
        return None;
    }
    let mut buffer = path_buffer_pool::get();
    let directory = dirname::<platform::Auto>(importer);
    let path =
        join_abs_string_buf_checked::<platform::Auto>(directory, &mut buffer[..], &[written])?;
    let find = |path: Vec<u8>| match by_path.find(&ReplacedModule::File(path)) {
        Some(module @ ModuleRef::File(_)) => Some(module),
        _ => None,
    };
    find(path.to_vec()).or_else(|| {
        let (stem, sources) = (WRITTEN_FOR_OUTPUT.iter())
            .find_map(|(end, sources)| Some((path.strip_suffix(*end)?, sources)))?;
        (sources.iter()).find_map(|source| find([stem, source].concat()))
    })
}

/// The paths that a file spells to calls which write, move or remove what is there, each with whether it starts at the folder of the file, as `./a.js` in an import does.
/// A path that the file does not spell is none: a test writes where it likes, mostly into a folder of its own, and a build that took every such call for one on a
/// file of the program would know nothing of any file.
pub(crate) fn find_paths_changed_on_disk(
    analysis: &bun_sema::file_analysis::FileAnalysis<'_>,
) -> Vec<(Atom, bool)> {
    let mut paths = Vec::new();
    for (argument, specifier) in analysis.paths_of_changed_files {
        let starts_at_own_directory = analysis.is_path_from_own_directory(*argument)
            || analysis.find_resolved_form(*argument).is_some();
        for alternative in analysis.alternatives_of(specifier) {
            if let ImportSpecifier::Constant(written) = *alternative {
                paths.push((written, starts_at_own_directory));
            }
        }
    }
    paths
}

// `rmSync(folder, { recursive: true })`, `renameSync(folder, other)`: a path stands for the file there and for all that lies below it.
fn find_files_at(by_path: &ReplacedModules<'_>, mut paths: Vec<Vec<u8>>) -> Vec<ModuleRef> {
    let mut files: Vec<ModuleRef> = Vec::new();
    paths.retain_mut(|path| match by_path.files.get(&path[..]) {
        Some(&file) => {
            files.push(ModuleRef::File(file));
            false
        }
        None => {
            path.push(b'/');
            true
        }
    });
    if !paths.is_empty() {
        let below = by_path.files.iter().filter(|(name, _)| {
            let mut folders = paths.iter();
            folders.any(|folder| name.starts_with(folder))
        });
        files.extend(below.map(|(_, &file)| ModuleRef::File(file)));
    }
    files
}

// The stage log says why every file of a run may load again.
fn say_why_every_file(input: &BindInput<'_, '_>, file: FileId, does: &str) {
    if logs_stages() {
        bun_core::print_errorln!(
            "AOT test run | every file may load again: {} {}",
            bstr::BStr::new(input.files.module(file).file_name()),
            does,
        );
    }
}

// A module that has not run yet is bound to what its imports name when it runs. Behind an eviction that is an instance from disk, which only code from disk
// imports: the run time leaves such a module to the loader of the host too (`Modules::isLeftToHost`).
fn add_importers(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    evicted: &mut FxHashSet<ModuleRef>,
) {
    let mut importers: FxHashMap<ModuleRef, Vec<FileId>> = FxHashMap::default();
    for &file in &modules.compiled_files {
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scans.of(file).sites) {
            let is_statement = matches!(
                site.kind,
                ImportSiteKind::JsxRuntime
                    | ImportSiteKind::JsxPackage
                    | ImportSiteKind::Import(_)
                    | ImportSiteKind::ExportFrom(_)
                    | ImportSiteKind::ExportStar(_)
                    | ImportSiteKind::ImportEquals(_)
            );
            if let (true, &ScannedSite::Module(target)) = (is_statement, answer) {
                importers.entry(target).or_default().push(file);
            }
        }
    }
    let mut to_follow: Vec<ModuleRef> = evicted.iter().copied().collect();
    while let Some(module) = to_follow.pop() {
        for &importer in importers.get(&module).map_or(&[][..], |it| &it[..]) {
            let importer = ModuleRef::File(importer);
            for form in core::iter::once(importer).chain(modules.forms_of(importer)) {
                if evicted.insert(form) {
                    to_follow.push(form);
                }
            }
        }
    }
}

pub(super) fn find_evicted_modules(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
) -> EvictedModules {
    let mut evicted = EvictedModules::default();
    if !input.runs_tests {
        return evicted;
    }
    evicted.is_every_module = input.evicts_any_module;
    if input.evicts_any_module && logs_stages() {
        bun_core::print_errorln!(
            "AOT test run | every file may load again: the scan of the test files says so"
        );
    }
    let by_path = ReplacedModules::of_every_file(input, modules);
    let out_of_sight = input.evicted_modules.iter();
    (evicted.modules).extend(out_of_sight.filter_map(|module| by_path.find(module)));
    let is_thrower = |required: &ModuleRef| {
        modules
            .find_commonjs_file(*required)
            .is_some_and(|thrower| {
                !contains(input.files.module(thrower).file_name(), b"/node_modules/")
            })
    };
    let out_of_sight = input.files_that_tests_load.where_throws_are_caught.iter();
    let out_of_sight = out_of_sight.filter_map(|module| by_path.find(module));
    evicted.modules.extend(out_of_sight.filter(is_thrower));
    // `rmSync(folder, { recursive: true })` in a test file that this build does not see.
    let out_of_sight = input.evicted_modules.iter();
    let mut paths_changed_on_disk: Vec<Vec<u8>> = out_of_sight
        .filter(|module| by_path.find(module).is_none())
        .filter_map(ReplacedModule::file_path)
        .cloned()
        .collect();
    for &file in &modules.compiled_files {
        if !matches!(
            input.sources.kind(file),
            SourceKind::Program | SourceKind::EvaluatedText
        ) {
            continue;
        }
        for written in find_files_named_with_query(&input.files.atoms, input.files.analysis(file)) {
            // A file that is reached only under a query is never compiled, so nobody has read its text: it may name any file of the program.
            // Where the host alone runs what the build has not seen, what nobody named is refused by name: the copy is as one that loads again.
            let Some(written) = written.filter(|_| input.host_runs_files_from_disk) else {
                say_why_every_file(input, file, "loads a file under a query");
                evicted.is_every_module = true;
                continue;
            };
            let importer = input.files.module(file).file_name();
            evicted
                .modules
                .extend(find_file_beside(&by_path, importer, written));
        }
        let Some(builtins) = parsed_source(input.files, file).map(|source| &source.builtins) else {
            continue;
        };
        if builtins.loses_sight_of_module_cache() {
            say_why_every_file(
                input,
                file,
                "hands require.cache on, names Bun.plugin, or stores a loader into Module._extensions",
            );
            evicted.is_every_module = true;
        }
        evicted.is_every_export_asked_for |= builtins.reaches_module_cache();
        evicted.is_table_reached |= builtins.reaches_module_cache();
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let (analysis, scan) = (input.files.analysis(file), scans.of(file));
        for (written, starts_at_own_directory) in find_paths_changed_on_disk(analysis) {
            let name = input.files.module(file).file_name();
            let folder = match starts_at_own_directory {
                true => &name[..last_index_of_char(name, b'/').unwrap_or(0)],
                false => input.working_directory,
            };
            paths_changed_on_disk.push(from_argument(folder, input.files.atoms.bytes(written)));
        }
        // A CommonJS file whose body throws is out of the table, and the next `require()` runs it again.
        for (site, answer) in analysis.import_sites.iter().zip(&scan.sites) {
            if let (ImportSiteKind::Require(call), &ScannedSite::Module(required)) =
                (site.kind, answer)
                && is_thrower(&required)
                && stands_where_a_throw_is_caught(hir, bound, call)
            {
                evicted.modules.insert(required);
            }
        }
        for &key in builtins.keys_taken_out_of_module_cache() {
            match find_file_of_key(hir, bound, analysis, key) {
                FileOfKey::Path(path) => {
                    let path = ReplacedModule::File(input.files.atoms.bytes(path).to_vec());
                    evicted.modules.extend(by_path.find(&path));
                }
                FileOfKey::Site(site) => match scan.sites[site] {
                    ScannedSite::Module(module) => {
                        evicted.modules.insert(module);
                    }
                    ScannedSite::Candidates(ref range) => {
                        evicted.modules.extend(scan.modules_spelled_in(range));
                    }
                    ScannedSite::AllModules => {
                        say_why_every_file(
                            input,
                            file,
                            "takes require.cache[require.resolve(name)] out for a name that it does not spell",
                        );
                        evicted.is_every_module = true;
                    }
                    ScannedSite::Unresolved | ScannedSite::Erased => {}
                },
                FileOfKey::Unknown => {
                    say_why_every_file(
                        input,
                        file,
                        "takes a key out of require.cache that it does not spell",
                    );
                    evicted.is_every_module = true;
                }
            }
        }
    }
    paths_changed_on_disk.shared_sort_unstable();
    paths_changed_on_disk.dedup();
    let mut changed_on_disk = find_files_at(&by_path, paths_changed_on_disk);
    evicted.modules.extend(&changed_on_disk);
    for module in changed_on_disk.iter().filter(|_| logs_stages()) {
        if let ModuleRef::File(file) = *module {
            bun_core::print_errorln!(
                "AOT test run | the run writes, moves or removes a file of its own, which is compared with the disk before it loads: {}",
                bstr::BStr::new(input.files.module(file).file_name()),
            );
        }
    }
    // A file of data names nothing.
    changed_on_disk.retain(|module| {
        matches!(*module, ModuleRef::File(file) if input.sources.kind(file) != SourceKind::Data)
    });
    let forms = changed_on_disk.iter().flat_map(|&it| modules.forms_of(it));
    evicted.changed_on_disk = forms.chain(changed_on_disk.iter().copied()).collect();
    // The new text names what it likes.
    evicted.is_every_export_asked_for |= !changed_on_disk.is_empty();
    evicted.copies_name_any_file |= !changed_on_disk.is_empty();
    if evicted.is_every_module {
        evicted.modules.clear();
        return evicted;
    }
    evicted
        .modules
        .retain(|module| matches!(module, ModuleRef::File(_)));
    let forms: Vec<ModuleRef> = (evicted.modules.iter())
        .flat_map(|&it| modules.forms_of(it))
        .collect();
    evicted.modules.extend(forms);
    add_importers(input, scans, modules, &mut evicted.modules);
    for &module in &evicted.modules {
        let ModuleRef::File(file) = module else {
            continue;
        };
        let Some(scan) = scans.find(file) else {
            continue;
        };
        for answer in &scan.sites {
            match *answer {
                ScannedSite::Module(named) => {
                    evicted.named_by_copies.insert(named);
                }
                ScannedSite::Candidates(ref range) => {
                    let named = scan.modules_spelled_in(range);
                    evicted.named_by_copies.extend(named);
                }
                ScannedSite::AllModules => {
                    evicted.is_every_export_asked_for = true;
                    evicted.copies_name_any_file = true;
                }
                ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
    }
    add_files_named_below_files_left_to_loader(input, modules, &mut evicted);
    let forms: Vec<ModuleRef> = (evicted.named_by_copies.iter())
        .flat_map(|&it| modules.forms_of(it))
        .collect();
    evicted.named_by_copies.extend(forms);
    evicted
}

// The loader reads a file that is left to it from disk, as it reads a copy, and asks for what the text names. `export { absent } from "./lib.js"`:
// it is the link to lib.js that fails. A mock of lib.js may have the name, and then the file runs.
fn add_files_named_below_files_left_to_loader(
    input: &BindInput<'_, '_>,
    modules: &ModuleSet,
    evicted: &mut EvictedModules,
) {
    if input.loads_below_files_left_to_loader.is_empty() {
        return;
    }
    let held = modules.record_files.iter();
    let held: FxHashMap<&[u8], FileId> = held
        .map(|&file| (to_native(input.files.module(file).file_name()), file))
        .collect();
    for below in input.loads_below_files_left_to_loader {
        let mut is_followed = vec![false; below.files.len()];
        let mut to_follow: Vec<u32> = (0..below.left_count as u32).collect();
        while let Some(place) = to_follow.pop() {
            if core::mem::replace(&mut is_followed[place as usize], true) {
                continue;
            }
            let file = &below.files[place as usize];
            let is_left = (place as usize) < below.left_count;
            if let Some(&held) = held.get(&file.path[..]).filter(|_| !is_left) {
                evicted.named_by_copies.insert(ModuleRef::File(held));
                continue;
            }
            if file.loads_unknown_files {
                evicted.is_every_export_asked_for = true;
                evicted.copies_name_any_file = true;
            }
            to_follow.extend_from_slice(&file.loads);
        }
    }
}

/// `require.cache["fs"] = { exports: fake }`: from then on `require("fs")` answers with what the entry exports, and `require("node:fs")` with the module.
/// `overridableRequire` in CommonJS.ts looks in the table for a name in front of which the resolver puts `node:`. These are the modules for which a file spells such a key.
#[derive(Default)]
pub(super) struct LibraryModulesStoredInCache {
    modules: FxHashSet<RuntimeModule>,
    /// The others that a `require` of the program names without `node:`. It is compiled for the module, so the run time refuses an entry under such a name.
    held_under_name_without_prefix: FxHashSet<RuntimeModule>,
    /// `bun run` reads `require("fs")` as `require("node:fs")` in a CommonJS file that an import loads, and as it is written in one that `require` loads.
    /// The first load counts, and the statements of a program are followed before any of its code runs.
    commonjs_files_that_imports_load: FxHashSet<FileId>,
    commonjs_files_tracking_first_load: FxHashSet<FileId>,
}

/// The key under which `require(name)` looks, and the module that it answers with where nothing stands there.
/// A module of Bun's own (`bun:sqlite`, `ws`) is looked for under its one name. `require("bun")` is read as `Bun`.
fn find_key_and_module_looked_up_in_cache(name: &[u8]) -> Option<(&[u8], RuntimeModule)> {
    let alias = Alias::get(name, Target::Bun, Cfg::default())?;
    let path = alias.path.as_bytes();
    let key = if path.starts_with(b"node:") {
        name
    } else {
        path
    };
    let module = table::module_by_specifier(path)?;
    (!key.starts_with(b"node:") && module != RuntimeModule::Bun).then_some((key, module))
}

fn find_module_looked_up_in_cache(name: &[u8]) -> Option<RuntimeModule> {
    find_key_and_module_looked_up_in_cache(name).map(|(_, module)| module)
}

fn find_module_stored_under(key: &[u8]) -> Option<RuntimeModule> {
    let (looked_under, module) = find_key_and_module_looked_up_in_cache(key)?;
    (looked_under == key).then_some(module)
}

pub(crate) fn find_names_that_unspelled_keys_may_be(
    hir: &bun_sema::hir::File<'_>,
    bound: &Bound<'_>,
    analysis: &bun_sema::file_analysis::FileAnalysis<'_>,
    atoms: &Interner<'_>,
    builtins: &ResolvedBuiltins,
) -> Vec<&'static [u8]> {
    let mut keys: Vec<(&[u8], Option<&[u8]>)> = Vec::new();
    if builtins.hands_module_cache_on() {
        keys.push((b"", Some(b"")));
    }
    for &key in builtins.keys_stored_in_module_cache() {
        let text = match (find_file_of_key(hir, bound, analysis, key), key) {
            (FileOfKey::Path(_), _) | (FileOfKey::Unknown, KeyOfModuleCache::Text(_)) => continue,
            (FileOfKey::Site(site), _) => &analysis.import_sites[site].specifier,
            (FileOfKey::Unknown, KeyOfModuleCache::Computed(key)) => analysis
                .find_key_stored_in_cache(key)
                .unwrap_or(&ImportSpecifier::Unknown),
        };
        keys.extend((analysis.alternatives_of(text).iter()).map(
            |alternative| match *alternative {
                ImportSpecifier::Constant(text) => (atoms.bytes(text), None),
                ImportSpecifier::Pattern { prefix, suffix } => {
                    (atoms.bytes(prefix), Some(atoms.bytes(suffix)))
                }
                ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => (&b""[..], Some(&b""[..])),
            },
        ));
    }
    if keys.is_empty() {
        return Vec::new();
    }
    let may_be = |name: &[u8]| {
        keys.iter().any(|&(start, end)| match end {
            None => name == start,
            Some(end) => {
                name.len() >= start.len() + end.len()
                    && name.starts_with(start)
                    && name.ends_with(end)
            }
        })
    };
    let names = BUN_ALIASES.iter().copied().flatten().map(|entry| entry.0);
    names
        .filter(|name| may_be(name) && find_module_stored_under(name).is_some())
        .collect()
}

impl LibraryModulesStoredInCache {
    pub(super) fn may_stand_under(&self, name: &[u8]) -> bool {
        !self.modules.is_empty()
            && find_module_looked_up_in_cache(name)
                .is_some_and(|module| self.modules.contains(&module))
    }

    pub(super) fn is_held_under_name_without_prefix(&self, module: RuntimeModule) -> bool {
        self.held_under_name_without_prefix.contains(&module)
    }

    pub(super) fn is_commonjs_file_that_imports_load(&self, file: FileId) -> bool {
        self.commonjs_files_that_imports_load.contains(&file)
    }

    pub(super) fn tracks_first_load(&self, file: FileId) -> bool {
        self.commonjs_files_tracking_first_load.contains(&file)
    }

    pub(super) fn files_tracking_first_load(&self) -> impl Iterator<Item = FileId> + '_ {
        self.commonjs_files_tracking_first_load.iter().copied()
    }

    /// Nobody knows what `require` answers for the module.
    pub(super) fn contains(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::Runtime(module) if self.modules.contains(&module))
    }
}

fn find_commonjs_files_that_imports_load(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
) -> FxHashSet<FileId> {
    let [mut by_statement, mut by_call, mut required] = <[FxHashSet<FileId>; 3]>::default();
    let by_path = ReplacedModules::of_every_file(input, modules);
    let loaded = input.files_that_tests_load;
    for (paths, files) in [
        (&loaded.by_statements, &mut by_statement),
        (&loaded.by_calls, &mut by_call),
        (&loaded.by_require, &mut required),
    ] {
        let targets = paths.iter().filter_map(|path| by_path.find(path));
        files.extend(targets.filter_map(|target| modules.find_commonjs_file(target)));
    }
    for &file in &modules.compiled_files {
        // It names what the test files name, and does not say how they load it. The scan of the test files does.
        if input.stand_in_for_files_from_disk == Some(file) {
            continue;
        }
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scans.of(file).sites) {
            let &ScannedSite::Module(target) = answer else {
                continue;
            };
            let Some(target) = modules.find_commonjs_file(target) else {
                continue;
            };
            match site.kind {
                ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_) => by_statement.insert(target),
                ImportSiteKind::ImportCall(_) => by_call.insert(target),
                ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::ImportEquals(_) => required.insert(target),
                _ => false,
            };
        }
    }
    by_statement.extend(by_call.difference(&required));
    by_statement
}

fn find_commonjs_files_tracking_first_load(
    input: &BindInput<'_, '_>,
    modules: &ModuleSet,
    stored: &LibraryModulesStoredInCache,
) -> FxHashSet<FileId> {
    let mut files = FxHashSet::default();
    if stored.modules.is_empty() {
        return files;
    }
    let may_find_entry = |written: Atom| {
        let written = input.files.atoms.bytes(written);
        let name = Alias::bun_prefixed_builtin(written).unwrap_or(written);
        stored.may_stand_under(name)
            && Alias::get(name, Target::Bun, Cfg::default()).is_some_and(|alias| alias.node_builtin)
    };
    for &file in &modules.compiled_files {
        let is_of_program = matches!(
            input.sources.kind(file),
            SourceKind::Program | SourceKind::EvaluatedText
        );
        if !is_of_program || modules.find_commonjs_file(ModuleRef::File(file)).is_none() {
            continue;
        }
        let analysis = input.files.analysis(file);
        let is_require = |kind: ImportSiteKind| {
            matches!(
                kind,
                ImportSiteKind::Require(_)
                    | ImportSiteKind::ImportMetaRequire(_)
                    | ImportSiteKind::ImportEquals(_)
            )
        };
        let sites = analysis.import_sites.iter();
        let is_written = sites.filter(|site| is_require(site.kind)).any(|site| {
            (analysis.alternatives_of(&site.specifier).iter()).any(|alternative| {
                matches!(*alternative, ImportSpecifier::Constant(written) if may_find_entry(written))
            })
        });
        let named =
            parsed_source(input.files, file).map_or(&[][..], |source| source.named_modules());
        if is_written || named.iter().any(|named| may_find_entry(named.name)) {
            files.insert(file);
        }
    }
    files
}

// `createRequire(import.meta.url)("fs")`, and a name that holds `require`. `process.getBuiltinModule(flag ? "vm" : "v8")` looks in no table.
fn is_argument_of_require(
    hir: &bun_sema::hir::File<'_>,
    bound: &Bound<'_>,
    analysis: &bun_sema::file_analysis::FileAnalysis<'_>,
    argument: ExprId,
) -> bool {
    let mut operand = argument;
    while let Parent::Expr(parent) = bound.parent_of_expr(operand)
        && hir.type_assertion_operand(parent) == Some(operand)
    {
        operand = parent;
    }
    let Parent::Expr(user) = bound.parent_of_expr(operand) else {
        return false;
    };
    let ExprKind::Call(call) = hir[user].kind else {
        return false;
    };
    let callee = hir[call].callee;
    hir.ids(hir[call].args).next() == Some(operand)
        && (is_made_require(hir, bound, callee)
            || resolve_loader_alias(hir, bound, &analysis.decisions, callee).is_some())
}

fn find_modules_held_under_name_without_prefix(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    stored: &LibraryModulesStoredInCache,
) -> FxHashSet<RuntimeModule> {
    let mut held = FxHashSet::default();
    let mut hold = |written: Atom, is_answer: &dyn Fn(RuntimeModule) -> bool| {
        let written = input.files.atoms.bytes(written);
        let name = Alias::bun_prefixed_builtin(written).unwrap_or(written);
        if let Some(module) = find_module_looked_up_in_cache(name)
            && is_answer(module)
            && !stored.modules.contains(&module)
        {
            held.insert(module);
        }
    };
    for &file in &modules.compiled_files {
        let is_of_program = matches!(
            input.sources.kind(file),
            SourceKind::Program | SourceKind::EvaluatedText
        );
        if !is_of_program || stored.is_commonjs_file_that_imports_load(file) {
            continue;
        }
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let (analysis, scan) = (input.files.analysis(file), scans.of(file));
        for (site, answer) in analysis.import_sites.iter().zip(&scan.sites) {
            if !matches!(
                site.kind,
                ImportSiteKind::Require(_)
                    | ImportSiteKind::ImportMetaRequire(_)
                    | ImportSiteKind::ImportEquals(_)
            ) {
                continue;
            }
            // A program above others leaves Bun's own modules to the host.
            let is_answer = |module: RuntimeModule| match *answer {
                ScannedSite::Module(answer) => answer == ModuleRef::Runtime(module),
                ScannedSite::Candidates(ref range) => {
                    let mut named = scan.modules_spelled_in(range);
                    named.any(|named| named == ModuleRef::Runtime(module))
                }
                ScannedSite::AllModules | ScannedSite::Unresolved | ScannedSite::Erased => false,
            };
            for alternative in analysis.alternatives_of(&site.specifier) {
                if let ImportSpecifier::Constant(written) = *alternative {
                    hold(written, &is_answer);
                }
            }
        }
        let named =
            parsed_source(input.files, file).map_or(&[][..], |source| source.named_modules());
        for named in named {
            if is_argument_of_require(hir, bound, analysis, named.argument) {
                hold(named.name, &|module| module == named.module);
            }
        }
    }
    held
}

pub(super) fn find_library_modules_stored_in_cache(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
) -> LibraryModulesStoredInCache {
    let mut stored = LibraryModulesStoredInCache::default();
    // The scan of the test files writes each module of the library under its one name.
    for module in input.evicted_modules {
        let ReplacedModule::File(name) = module else {
            continue;
        };
        stored.modules.extend(match name.starts_with(b"node:") {
            true => table::module_by_specifier(name),
            false => find_module_stored_under(name),
        });
    }
    for &file in &modules.compiled_files {
        if !matches!(
            input.sources.kind(file),
            SourceKind::Program | SourceKind::EvaluatedText
        ) {
            continue;
        }
        let Some(builtins) = parsed_source(input.files, file).map(|source| &source.builtins) else {
            continue;
        };
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let analysis = input.files.analysis(file);
        let bytes_of = |name: Atom| input.files.atoms.bytes(name);
        for &key in builtins.keys_stored_in_module_cache() {
            let name = match find_file_of_key(hir, bound, analysis, key) {
                FileOfKey::Path(name) => name,
                // `require.resolve` answers the name of a Node.js module as it is asked.
                FileOfKey::Site(site) => match analysis.import_sites[site].specifier {
                    ImportSpecifier::Constant(name) => name,
                    _ => continue,
                },
                FileOfKey::Unknown => continue,
            };
            (stored.modules).extend(find_module_stored_under(bytes_of(name)));
        }
        if !input.runs_tests {
            continue;
        }
        let names = find_names_that_unspelled_keys_may_be(
            hir,
            bound,
            analysis,
            &input.files.atoms,
            builtins,
        );
        if !names.is_empty() && logs_stages() {
            bun_core::print_errorln!(
                "AOT test run | an entry in require.cache may answer require() of {} modules of the library: {} stores under a key that it does not spell, or hands the table on",
                names.len(),
                bstr::BStr::new(input.files.module(file).file_name()),
            );
        }
        let modules = names.into_iter().filter_map(find_module_stored_under);
        stored.modules.extend(modules);
    }
    stored.commonjs_files_that_imports_load =
        find_commonjs_files_that_imports_load(input, scans, modules);
    stored.commonjs_files_tracking_first_load =
        find_commonjs_files_tracking_first_load(input, modules, &stored);
    stored.held_under_name_without_prefix =
        find_modules_held_under_name_without_prefix(input, scans, modules, &stored);
    stored
}
