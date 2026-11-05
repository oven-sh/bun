pub(crate) mod files_of_run;
pub(crate) mod names_from_outside;
pub(crate) mod out_of_sight;
#[cfg(test)]
mod tests;
pub(crate) mod texts;

use std::mem::replace;
use std::sync::Arc;
use std::time::Instant;

use bun_core::strings::contains_char;
use bun_sema::atom::{Atom, Interner};
use bun_sema::fold::FoldInputs;
use bun_sema::hir::ExprId;
use bun_sema::import_sites::{ImportSite, ImportSiteKind, ImportSpecifier};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{CodeResolution, FinishedFile, SiteResolution};
use bun_sema::util::SharedSort;

use self::files_of_run::{find_files_listed_by_runner, find_files_loaded_from};
use self::names_from_outside::{NamesFromOutside, settle_names_of_helpers};
use self::out_of_sight::ObjectsOutOfSight;
use self::texts::{TextReader, ends_with_module_in_text, inputs_of_file_that_nobody_describes};
use crate::builtins::table::{self, BuiltinFlags, BuiltinKind, MemberLookup, Mutability, Scope};
use crate::builtins::{BuiltinId, ResolvedBuiltins, RuntimeModule};
use crate::ir::InParallel;
use crate::ir::generated::ModuleFlags;
use crate::load::contents::{FixedBuiltins, ScanInput};
use crate::load::is_in_node_modules;
use crate::load::sources::{ParsedSource, parsed_source};
use crate::modules::{ModuleGraph, ModuleRef};
use crate::options::Options;
use crate::test_run_loads::{LoadsOfFile, LoadsOfRun, collect_loads_of_run, look_at_loads_of_file};
use crate::test_run_report::{
    CountsOfScan, FileLeavesOpen, say_file_leaves_open, say_package_takes_from_test_runner,
    say_scan, say_what_file_replaces,
};

#[derive(Copy, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum LeftOpenByText {
    #[default]
    Nothing,
    SpiesUnderAnyName,
    MocksOfAnyModule,
}

#[derive(Default)]
pub(crate) struct FoundInTexts {
    pub names_spied: Vec<Atom>,
    pub modules_replaced: Vec<Atom>,
    pub exports_spied: Vec<(Atom, Atom)>,
    pub replaced_members: Vec<BuiltinId>,
    pub opened_holders: Vec<BuiltinId>,
    pub names_added: Vec<(BuiltinId, Atom)>,
    pub left_open: LeftOpenByText,
}

#[derive(Default)]
pub(crate) struct FileOfRun {
    pub takes_from_test_runner: bool,
    pub runs_unseen_code: bool,
    pub evaluates_unknown_text: bool,
    pub evaluates_unknown_text_among_its_names: bool,
    pub in_texts_written: FoundInTexts,
    pub in_texts_handed_on: FoundInTexts,
    pub spies_under_names_from_outside: bool,
    pub spies_under_names_made_of_themselves: bool,
    pub texts_passed: Vec<(u32, Atom)>,
    pub names_stored_on_unknown_objects: Vec<Atom>,
    pub closed_holders_out_of_sight: Vec<BuiltinId>,
    pub loads: LoadsOfFile,
}

fn loads_test_runner(resolution: SiteResolution<'_>) -> bool {
    let id = match resolution {
        SiteResolution::Constant(CodeResolution::HostModule(id)) => Some(id),
        SiteResolution::Constant(CodeResolution::File(file)) => file.host_module,
        SiteResolution::Constant(_) | SiteResolution::Computed(_) => None,
    };
    id.and_then(|id| RuntimeModule::from_registry_id(id.0))
        .is_some_and(table::is_test_runner)
}

fn loads_unseen_code(request: &FinishedFile<'_, '_>, site: &ImportSite) -> bool {
    let &FinishedFile {
        analysis, atoms, ..
    } = request;
    let loads = matches!(
        site.kind,
        ImportSiteKind::ImportCall(_)
            | ImportSiteKind::Require(_)
            | ImportSiteKind::ImportMetaRequire(_)
    );
    let has_query = |text: Atom| contains_char(atoms.bytes(text), b'?');
    let mut names = analysis.alternatives_of(&site.specifier).iter();
    names.any(|name| match *name {
        ImportSpecifier::Constant(text) => has_query(text),
        ImportSpecifier::Pattern { prefix, suffix } => {
            loads || has_query(prefix) || has_query(suffix)
        }
        ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => loads,
    })
}

pub(crate) fn look_at_file_of_run(
    request: &FinishedFile<'_, '_>,
    builtins: &ResolvedBuiltins,
    input: &ScanInput<'_>,
) -> FileOfRun {
    let &FinishedFile {
        hir,
        analysis,
        resolutions,
        ..
    } = request;
    if !input.runs_tests || hir.source_len == 0 {
        return FileOfRun::default();
    }
    let mut found = FileOfRun {
        loads: look_at_loads_of_file(request, builtins),
        ..FileOfRun::default()
    };
    let mut mentioned = builtins.mentioned().iter();
    found.takes_from_test_runner = mentioned.any(|&id| table::returns_test_runner(id));
    for (site, &resolution) in analysis.import_sites.iter().zip(resolutions) {
        let is_dead = (site.kind.call()).is_some_and(|call| analysis.decisions.is_dead_expr(call));
        if !is_dead {
            found.takes_from_test_runner |= loads_test_runner(resolution);
            found.runs_unseen_code |= loads_unseen_code(request, site);
        }
    }
    let is_in_package = is_in_node_modules(request.path);
    let (fold, file) = (
        FoldInputs::default(),
        inputs_of_file_that_nobody_describes(),
    );
    let reads_texts = !is_in_package || !builtins.evaluated_texts().is_empty();
    let mut texts = reads_texts.then(|| TextReader::new(request, builtins, &fold, &file));
    if let Some(texts) = texts.as_mut().filter(|_| is_in_package) {
        for evaluated in builtins.evaluated_texts() {
            if let Some(&body) = evaluated.texts.last() {
                texts.keep_whole(evaluated.call, request.atoms.bytes(body));
            }
        }
    }
    let mut objects = ObjectsOutOfSight::new(request, builtins);
    let mut names = NamesFromOutside::new(request, builtins, is_in_package);
    for (expression, node) in (0..).map(ExprId).zip(hir.exprs.iter()) {
        if analysis.decisions.is_dead_expr(expression) {
            continue;
        }
        if let Some(texts) = texts.as_mut().filter(|_| !is_in_package) {
            texts.look_at(expression, node.kind);
        }
        objects.look_at(expression, node.kind);
        names.look_at(expression, node.kind);
    }
    found.evaluates_unknown_text = objects.evaluates_unknown_text;
    found.evaluates_unknown_text_among_its_names = objects.evaluates_unknown_text_among_its_names;
    found.runs_unseen_code |= objects.evaluates_unknown_text;
    found.closed_holders_out_of_sight = objects.take_closed_holders();
    if let Some(texts) = texts {
        (found.in_texts_written, found.in_texts_handed_on) = texts.finish();
    }
    names.finish(&mut found);
    found
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum WhoseFile {
    OfTests,
    OfProduct,
    OfNeither,
}

#[derive(Default)]
pub(crate) struct RunContents {
    pub whose: Vec<WhoseFile>,
    pub loads_compiled_files_alone: Vec<bool>,
    pub spies_under_any_name: bool,
    pub names_spied: Vec<Atom>,
    pub modules_replaced_in_text: Vec<Atom>,
    pub exports_spied_in_text: Vec<(Atom, Atom)>,
    pub mocks_any_module: bool,
    pub names_added: Vec<(BuiltinId, Atom)>,
    pub members_written_as_reads: Arc<[u32]>,
    pub members_that_library_looks_up: Arc<[u32]>,
    pub loads: LoadsOfRun,
    pub counts: CountsOfScan,
}

#[derive(Copy, Clone)]
pub(crate) struct RunInput<'a, 's> {
    pub files: &'a Files<'s>,
    pub options: &'a Options<'a>,
    pub replaced_builtins: &'a [u32],
    pub in_parallel: InParallel<'a>,
}

impl RunContents {
    fn take_what_texts_do(&mut self, found: &FoundInTexts) {
        self.names_spied.extend_from_slice(&found.names_spied);
        (self.modules_replaced_in_text).extend_from_slice(&found.modules_replaced);
        (self.exports_spied_in_text).extend_from_slice(&found.exports_spied);
        self.spies_under_any_name |= found.left_open >= LeftOpenByText::SpiesUnderAnyName;
        self.mocks_any_module |= found.left_open >= LeftOpenByText::MocksOfAnyModule;
    }

    pub(crate) fn is_replaced_in_text(&self, atoms: &Interner<'_>, path: &[u8]) -> bool {
        let mut written = self.modules_replaced_in_text.iter();
        written.any(|&module| ends_with_module_in_text(path, atoms.bytes(module)))
    }

    pub(crate) fn names_spied_in_text_on<'a>(
        &'a self,
        atoms: &'a Interner<'_>,
        path: &'a [u8],
    ) -> impl Iterator<Item = Atom> + 'a {
        let spied = self.exports_spied_in_text.iter();
        spied
            .filter(move |it| ends_with_module_in_text(path, atoms.bytes(it.0)))
            .map(|it| it.1)
    }

    pub(crate) fn plan_of_files(&self) -> TestRunPlan {
        let whose = self.whose.iter();
        TestRunPlan {
            finds_builtins_read_only: whose.map(|&it| it == WhoseFile::OfProduct).collect(),
            loads_compiled_files_alone: self.loads_compiled_files_alone.clone(),
            ..TestRunPlan::default()
        }
    }
}

fn may_be_replaced_by_tests(place: BuiltinId) -> bool {
    let entry = table::entry(place);
    let is_global = |holder: BuiltinId| table::has_flag(holder, BuiltinFlags::IS_GLOBAL_OBJECT);
    entry.mutability == Mutability::AlwaysLocked
        && entry.scope == Scope::Realm
        && !entry.flags.contains(BuiltinFlags::IS_COMPILER_HELPER)
        && table::canonical_id(place) != BuiltinId::Bun
        && match entry.kind {
            BuiltinKind::Function
            | BuiltinKind::Method
            | BuiltinKind::Accessor
            | BuiltinKind::DataProperty => entry.holder.is_some(),
            BuiltinKind::Constructor | BuiltinKind::Namespace => {
                entry.holder.is_some_and(is_global)
            }
            BuiltinKind::Prototype | BuiltinKind::Constant | BuiltinKind::NativeBinding => false,
        }
}

fn list_members_written_as_reads(replaced: &[u32], with_globals: bool) -> Arc<[u32]> {
    let mut is_listed = vec![false; BuiltinId::COUNT as usize];
    for &number in replaced {
        if let Some(is_listed) = is_listed.get_mut(number as usize) {
            *is_listed = true;
        }
    }
    let places = (0..BuiltinId::COUNT).filter_map(BuiltinId::from_wire);
    for place in places.filter(|&place| may_be_replaced_by_tests(place)) {
        let kind = table::entry(place).kind;
        if !with_globals && matches!(kind, BuiltinKind::Constructor | BuiltinKind::Namespace) {
            continue;
        }
        is_listed[place.to_wire() as usize] = true;
        is_listed[table::canonical_id(place).to_wire() as usize] = true;
        for &member in table::members(table::canonical_id(place)) {
            if table::entry(member).kind == BuiltinKind::Prototype {
                is_listed[member.to_wire() as usize] = true;
                is_listed[table::canonical_id(member).to_wire() as usize] = true;
            }
        }
    }
    let numbers = (0..BuiltinId::COUNT).filter(|&number| is_listed[number as usize]);
    numbers.collect()
}

pub(crate) fn fix_places_on_the_way(builtins: &ResolvedBuiltins, fixed: &FixedBuiltins) {
    builtins.for_each_locked_builtin(|builtin| {
        let mut place = builtin;
        while let Some(holder) = table::entry(place).holder {
            if may_be_replaced_by_tests(place) {
                fixed.note(place);
            }
            place = table::canonical_id(holder);
        }
    });
}

fn runs_unseen_code(source: &ParsedSource) -> bool {
    let names = &source.contents.names;
    source.of_run.runs_unseen_code
        || source.of_run.loads.names_file_with_query.is_some()
        || names.loads_by_unknown_path
        || !names.files_missing_at_build_at.is_empty()
        || source.contents.starts_worker_out_of_sight
}

fn count_modules_mocked(files: &Files<'_>, file: FileId) -> (usize, bool) {
    let analysis = files.analysis(file);
    let (mut spelled, mut mocks_unspelled_module) = (0, false);
    for site in analysis.import_sites {
        let ImportSiteKind::MockModule(call) = site.kind else {
            continue;
        };
        if analysis.decisions.is_dead_expr(call) {
            continue;
        }
        for name in analysis.alternatives_of(&site.specifier) {
            match name {
                ImportSpecifier::Constant(_) => spelled += 1,
                _ => mocks_unspelled_module = true,
            }
        }
    }
    (spelled, mocks_unspelled_module)
}

struct TextsThatCount {
    counts: Vec<bool>,
    files_read: usize,
    runners: usize,
    runners_beside_all: usize,
}

fn settle_texts_written(input: &RunInput<'_, '_>, whose: &[WhoseFile]) -> TextsThatCount {
    let files = input.files;
    let count = files.modules.len();
    let is_read =
        |file: FileId| files.is_compiled(file) && whose[file.idx()] != WhoseFile::OfProduct;
    let stops = |file: FileId| !is_read(file);
    let read = files.compiled_files().iter().copied();
    let read: Vec<FileId> = read.filter(|&file| is_read(file)).collect();
    let mut referrers: Vec<Vec<FileId>> = vec![Vec::new(); count];
    for &file in &read {
        let loaded = files.module(file).code_edges.iter();
        for &loaded in loaded.filter(|&&loaded| is_read(loaded)) {
            referrers[loaded.idx()].push(file);
        }
    }
    let runners = read.iter().copied();
    let runners: Vec<FileId> = runners
        .filter(|&file| parsed_source(files, file).is_none_or(runs_unseen_code))
        .collect();
    let mut comes_to_runner = vec![false; count];
    let mut pending = runners.clone();
    pending.retain(|file| !replace(&mut comes_to_runner[file.idx()], true));
    while let Some(file) = pending.pop() {
        for &referrer in &referrers[file.idx()] {
            if !replace(&mut comes_to_runner[referrer.idx()], true) {
                pending.push(referrer);
            }
        }
    }
    let test_files = find_files_listed_by_runner(input).test_files;
    let running = test_files.iter().copied();
    let running: Vec<FileId> = running.filter(|it| comes_to_runner[it.idx()]).collect();
    let mut counts = find_files_loaded_from(files, running, &stops);
    let is_reached_by_tests = find_files_loaded_from(files, test_files, &stops);
    let beside_all = runners.iter().filter(|it| !is_reached_by_tests[it.idx()]);
    let runners_beside_all = beside_all.count();
    let every_text_counts =
        runners_beside_all > 0 || !input.options.aot.only_tests_load_code_from_disk;
    for &file in &read {
        counts[file.idx()] |=
            every_text_counts || (!is_reached_by_tests[file.idx()] && !runners.is_empty());
    }
    TextsThatCount {
        counts,
        files_read: read.len(),
        runners: runners.len(),
        runners_beside_all,
    }
}

fn sort_by_bytes(texts: &mut Vec<Atom>, atoms: &Interner<'_>) {
    texts.shared_sort_unstable_by(|&left, &right| atoms.bytes(left).cmp(atoms.bytes(right)));
    texts.dedup();
}

fn list_names_added(
    mut holders: Vec<BuiltinId>,
    mut names: Vec<Atom>,
    atoms: &Interner<'_>,
) -> Vec<(BuiltinId, Atom)> {
    holders.shared_sort_unstable();
    holders.dedup();
    if holders.is_empty() {
        return Vec::new();
    }
    sort_by_bytes(&mut names, atoms);
    let is_new = |holder: BuiltinId, name: Atom| {
        let listed = table::find_name(atoms.bytes(name));
        !matches!(
            listed.map(|name| table::member(holder, name)),
            Some(MemberLookup::Found(_))
        )
    };
    let mut added = Vec::new();
    for &holder in &holders {
        let new = names.iter().filter(|&&name| is_new(holder, name));
        added.extend(new.map(|&name| (holder, name)));
    }
    added
}

pub(crate) fn collect_run_contents(
    input: RunInput<'_, '_>,
    (whose, loads_compiled_files_alone): (Vec<WhoseFile>, Vec<bool>),
) -> RunContents {
    let started = Instant::now();
    let (files, atoms) = (input.files, &input.files.atoms);
    let texts_written = settle_texts_written(&input, &whose);
    let mut run = RunContents {
        whose,
        loads_compiled_files_alone,
        members_written_as_reads: list_members_written_as_reads(input.replaced_builtins, true),
        members_that_library_looks_up: list_members_written_as_reads(
            input.replaced_builtins,
            false,
        ),
        loads: collect_loads_of_run(files, input.options),
        ..RunContents::default()
    };
    let members = &run.members_written_as_reads;
    debug_assert!(members.is_sorted_by(|left, right| left < right));
    let mut counts = CountsOfScan {
        files_at_start: texts_written.files_read,
        files_beside: files.compiled_files().len() - texts_written.files_read,
        builtins: input.replaced_builtins.len(),
        files_read: texts_written.files_read,
        runners: texts_written.runners,
        runners_beside_all: texts_written.runners_beside_all,
        ..CountsOfScan::default()
    };
    let (mut helpers, mut holders, mut names_stored) = (Vec::new(), Vec::new(), Vec::new());
    for &file in files.compiled_files() {
        let Some(source) = parsed_source(files, file) else {
            run.spies_under_any_name = true;
            run.mocks_any_module = true;
            continue;
        };
        let (builtins, of_run) = (&source.builtins, &source.of_run);
        if of_run.spies_under_names_from_outside {
            helpers.push(file);
        }
        run.spies_under_any_name |= of_run.spies_under_names_made_of_themselves;
        let whose = run.whose[file.idx()];
        let path = files.module(file).file_name();
        let names = &source.contents.names;
        let (modules_mocked, mocks_unspelled_module) = count_modules_mocked(files, file);
        let mocks_unspelled_module = mocks_unspelled_module || builtins.hands_mock_on();
        let is_in_package = is_in_node_modules(path);
        counts.modules += modules_mocked;
        counts.exports += builtins.spy_calls().len();
        counts.mocks_any_module |= mocks_unspelled_module;
        counts.spies_on_objects_from_somewhere |= builtins.hands_spy_on();
        if is_in_package {
            let spies = builtins.hands_spy_on() || of_run.spies_under_names_from_outside;
            say_package_takes_from_test_runner(path, mocks_unspelled_module, spies);
        }
        if builtins.hands_spy_on() {
            say_file_leaves_open(path, FileLeavesOpen::LetsSpyOnGo);
        }
        let hands_on_unspelled_module = whose != WhoseFile::OfProduct
            && (names.loads_by_unknown_name || names.loads_by_unknown_path);
        counts.hands_on_any_module |= hands_on_unspelled_module;
        if mocks_unspelled_module && !is_in_package {
            say_file_leaves_open(path, FileLeavesOpen::MocksUnspelledModule);
        } else if hands_on_unspelled_module {
            say_file_leaves_open(path, FileLeavesOpen::HandsOnUnspelledModule);
        }
        if whose != WhoseFile::OfProduct {
            say_what_file_replaces(path, builtins.replaced_members());
        }
        if whose != WhoseFile::OfTests {
            continue;
        }
        run.spies_under_any_name |= of_run.evaluates_unknown_text_among_its_names;
        let (written, handed_on) = (&of_run.in_texts_written, &of_run.in_texts_handed_on);
        if written.left_open.max(handed_on.left_open) != LeftOpenByText::Nothing {
            let loads_by_unknown_path = names.loads_by_unknown_path;
            let what = FileLeavesOpen::HoldsTextThatSpies {
                loads_by_unknown_path,
            };
            say_file_leaves_open(path, what);
        }
        run.take_what_texts_do(handed_on);
        let holds_text = written.left_open != LeftOpenByText::Nothing
            || !written.names_spied.is_empty()
            || !written.modules_replaced.is_empty()
            || !written.exports_spied.is_empty();
        match texts_written.counts[file.idx()] {
            true => run.take_what_texts_do(written),
            false => counts.texts_left_out += usize::from(holds_text),
        }
        holders.extend_from_slice(&of_run.closed_holders_out_of_sight);
        names_stored.extend_from_slice(&of_run.names_stored_on_unknown_objects);
    }
    helpers.shared_sort_unstable();
    let of_helpers = settle_names_of_helpers(files, &helpers);
    run.names_spied.extend(of_helpers.names);
    for (&helper, &texts_passed) in helpers.iter().zip(&of_helpers.texts_passed) {
        let what = FileLeavesOpen::SpiesUnderNamesFromOutside { texts_passed };
        say_file_leaves_open(files.module(helper).file_name(), what);
        run.spies_under_any_name |= texts_passed == 0;
    }
    sort_by_bytes(&mut run.names_spied, atoms);
    sort_by_bytes(&mut run.modules_replaced_in_text, atoms);
    (run.exports_spied_in_text).shared_sort_unstable_by(|left, right| {
        let bytes = |it: &(Atom, Atom)| (atoms.bytes(it.0), atoms.bytes(it.1));
        bytes(left).cmp(&bytes(right))
    });
    run.exports_spied_in_text.dedup();
    run.names_added = list_names_added(holders, names_stored, atoms);
    counts.names_added = run.names_added.len();
    counts.handed_on = run.names_spied.len();
    counts.mocks_any_module |= run.mocks_any_module;
    counts.spies_on_objects_from_somewhere |= run.spies_under_any_name;
    counts.milliseconds = started.elapsed().as_millis();
    run.counts = counts;
    say_scan(&run.counts);
    run
}

#[derive(Default)]
pub(crate) struct TestRunPlan {
    pub finds_builtins_read_only: Vec<bool>,
    pub loads_compiled_files_alone: Vec<bool>,
    pub is_changed_on_disk_by_run: Vec<bool>,
    pub may_be_evicted: Vec<bool>,
}

impl TestRunPlan {
    pub(crate) fn has(set: &[bool], module: ModuleRef) -> bool {
        match module {
            ModuleRef::File(file)
            | ModuleRef::Inner { file, .. }
            | ModuleRef::Face(file)
            | ModuleRef::Check(file) => set.get(file.idx()).copied().unwrap_or(false),
            ModuleRef::Runtime(_) | ModuleRef::External { .. } => false,
        }
    }
}

pub(crate) fn flags_of_module(graph: &ModuleGraph, module: ModuleRef) -> ModuleFlags {
    let plan = graph.test_run();
    let mut flags = ModuleFlags::default();
    if TestRunPlan::has(&plan.finds_builtins_read_only, module) {
        flags |= ModuleFlags::FINDS_BUILTINS_READ_ONLY;
    }
    if TestRunPlan::has(&plan.loads_compiled_files_alone, module) {
        flags |= ModuleFlags::LOADS_COMPILED_FILES_ALONE;
    }
    if TestRunPlan::has(&plan.is_changed_on_disk_by_run, module) && graph.is_code_of_program(module)
    {
        flags |= ModuleFlags::IS_CHANGED_ON_DISK_BY_RUN;
    }
    flags
}
