//! Which files of a test run may load a second time. `delete require.cache[path]` makes the next `require()` or `import()` of the file load it again, from
//! disk. Code that asks for such a file asks the run time which instance answers, and knows nothing of what it gets, so the fewer the better.

use super::module_set::ModuleSet;
use super::plan::ModuleRef;
use super::requests::{ScannedSite, Scans};
use super::{BindInput, ReplacedModules};
use crate::builtins::KeyOfModuleCache;
use crate::load::sources::{SourceKind, parsed_source};
use crate::options::ReplacedModule;
use crate::statistics::logs_stages;
use bun_core::strings::index_of_char;
use bun_paths::resolve_path::{dirname, join_abs_string_buf_checked, platform};
use bun_paths::{is_absolute, path_buffer_pool};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingInitializer};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::ExprId;
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::FileId;
use bun_sema::util::{FxHashMap, FxHashSet};

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
}

impl EvictedModules {
    pub(super) fn contains(&self, module: ModuleRef) -> bool {
        self.is_every_module || self.modules.contains(&module)
    }

    pub(super) fn is_every_module(&self) -> bool {
        self.is_every_module
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = ModuleRef> + '_ {
        self.modules.iter().copied()
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
    key: ExprId,
) -> FileOfKey {
    const NAMES_FOLLOWED: usize = 4;
    let mut key = hir.skip_type_assertions(key);
    for _ in 0..NAMES_FOLLOWED {
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
            break;
        };
        if !bound.is_evaluated_ident(key) || !bound.is_stable_binding(symbol) {
            break;
        }
        let BindingInitializer::Expression(initializer) = bound.binding_initializer(hir, symbol)
        else {
            break;
        };
        key = hir.skip_type_assertions(initializer);
    }
    FileOfKey::Unknown
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
            say_why_every_file(input, file, "hands require.cache on, or names Bun.plugin");
            evicted.is_every_module = true;
        }
        evicted.is_every_export_asked_for |= builtins.reaches_module_cache();
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let (analysis, scan) = (input.files.analysis(file), scans.of(file));
        for &key in builtins.keys_taken_out_of_module_cache() {
            let named = match key {
                KeyOfModuleCache::Text(path) => FileOfKey::Path(path),
                KeyOfModuleCache::Computed(key) => find_file_of_key(hir, bound, analysis, key),
            };
            match named {
                FileOfKey::Path(path) => {
                    let path = ReplacedModule::File(input.files.atoms.bytes(path).to_vec());
                    evicted.modules.extend(by_path.find(&path));
                }
                FileOfKey::Site(site) => match scan.sites[site] {
                    ScannedSite::Module(module) => {
                        evicted.modules.insert(module);
                    }
                    ScannedSite::Candidates(ref range) => {
                        let range = range.start as usize..range.end as usize;
                        evicted.modules.extend(&scan.candidates[range]);
                    }
                    ScannedSite::AllModules => {
                        say_why_every_file(
                            input,
                            file,
                            "deletes require.cache[require.resolve(name)] for a name that it does not spell",
                        );
                        evicted.is_every_module = true;
                    }
                    ScannedSite::Unresolved | ScannedSite::Erased => {}
                },
                FileOfKey::Unknown => {
                    say_why_every_file(
                        input,
                        file,
                        "deletes a key of require.cache that it does not spell",
                    );
                    evicted.is_every_module = true;
                }
            }
        }
    }
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
                    let range = range.start as usize..range.end as usize;
                    evicted.named_by_copies.extend(&scan.candidates[range]);
                }
                ScannedSite::AllModules => {
                    evicted.is_every_export_asked_for = true;
                    evicted.copies_name_any_file = true;
                }
                ScannedSite::Unresolved | ScannedSite::Erased => {}
            }
        }
    }
    let forms: Vec<ModuleRef> = (evicted.named_by_copies.iter())
        .flat_map(|&it| modules.forms_of(it))
        .collect();
    evicted.named_by_copies.extend(forms);
    evicted
}
