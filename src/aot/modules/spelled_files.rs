use super::BindInput;
use super::module_set::ModuleSet;
use crate::ir::for_each_mut;
use crate::load::SourceKind;
use crate::load::sources::parsed_source;
use bun_core::strings::{last_index_of_char, split};
use bun_sema::bind::{Binding, CommonJsVariable};
use bun_sema::fold::{Constant, Decision};
use bun_sema::hir::{ExprId, ExprKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{ExternalKind, join};
use bun_sema::util::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

fn without_extension(path: &[u8]) -> &[u8] {
    let name = last_index_of_char(path, b'/').map_or(0, |slash| slash + 1);
    match last_index_of_char(&path[name..], b'.') {
        Some(dot) if dot > 0 => &path[..name + dot],
        _ => path,
    }
}

pub(crate) fn directory_of(path: &[u8]) -> &[u8] {
    &path[..last_index_of_char(path, b'/').unwrap_or(0)]
}

#[derive(Copy, Clone)]
pub struct TextThatSpellsFile {
    pub written_in: FileId,
    pub text: ExprId,
    pub spelled: FileId,
}

type FilesBySpelling<'a> = FxHashMap<&'a [u8], SmallVec<[FileId; 2]>>;

fn index_by_spelling<'a>(input: &BindInput<'a, '_>) -> FilesBySpelling<'a> {
    let files = input.files;
    let is_code = |&&file: &&FileId| input.sources.kind(file) == SourceKind::Program;
    let mut files_by_spelling = FilesBySpelling::default();
    for &file in files.compiled_files().iter().filter(is_code) {
        let spelling = without_extension(files.module(file).file_name());
        files_by_spelling.entry(spelling).or_default().push(file);
        if spelling.ends_with(b"/index") {
            let folder = directory_of(spelling);
            files_by_spelling.entry(folder).or_default().push(file);
        }
    }
    files_by_spelling
}

fn loads_by_unknown_name(files: &Files<'_>, file: FileId, counts: impl Fn(u32) -> bool) -> bool {
    parsed_source(files, file).is_none_or(|source| {
        let names = &source.contents.names;
        let mut unknown_names = names.unknown_names_at.iter();
        names.loads_by_unknown_name
            || unknown_names.any(|&site| counts(site))
            || !names.files_missing_at_build_at.is_empty()
            || source.builtins.loads_unknown_modules()
    })
}

fn is_held_by_no_pattern(files: &Files<'_>, file: FileId, site: u32) -> bool {
    let analysis = files.analysis(file);
    let specifier = &analysis.import_sites[site as usize].specifier;
    let mut alternatives = analysis.alternatives_of(specifier).iter();
    alternatives.any(|it| matches!(it, ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown))
}

pub(super) fn program_loads_by_name_that_no_pattern_holds(input: &BindInput<'_, '_>) -> bool {
    let files = input.files;
    let is_code = |&&file: &&FileId| input.sources.kind(file) == SourceKind::Program;
    let mut code_files = files.compiled_files().iter().filter(is_code);
    code_files.any(|&file| {
        loads_by_unknown_name(files, file, |site| is_held_by_no_pattern(files, file, site))
    })
}

fn find_files_spelled_by(
    files: &Files<'_>,
    files_by_spelling: &FilesBySpelling<'_>,
    file: FileId,
) -> Vec<TextThatSpellsFile> {
    let mut found = Vec::new();
    let directory = directory_of(files.module(file).file_name());
    let decisions = &files.analysis(file).decisions;
    let bound = files.bound(file);
    let mut stores = bound.runtime.unbound_name_stores().iter();
    let stores_require = stores.any(|&(target, _)| {
        bound.binding(target) == Binding::CommonJs(CommonJsVariable::Require)
            && !decisions.is_dead_expr(target)
    });
    let sites = files.analysis(file).import_sites.iter();
    let sites =
        sites.filter(|site| !stores_require || !matches!(site.kind, ImportSiteKind::Require(_)));
    let resolved: FxHashSet<ExprId> = sites.map(|site| site.specifier_node).collect();
    for (index, expression) in files.hir(file).exprs.iter().enumerate() {
        let text = match expression.kind {
            ExprKind::String(text) => text,
            ExprKind::Call(_) => match decisions.decision(ExprId(index as u32)) {
                Decision::Constant(Constant::String(text)) => text,
                Decision::Constant(_)
                | Decision::Unknown
                | Decision::GlobalPath(_)
                | Decision::Data(_)
                | Decision::DeferredData => continue,
            },
            _ => continue,
        };
        if decisions.is_dead_expr(ExprId(index as u32)) {
            continue;
        }
        let text = files.atoms.bytes(text);
        let names_something = split(text, b"/").any(|part| !matches!(part, b"" | b"." | b".."));
        if !(text.starts_with(b"./") || text.starts_with(b"../") || text.starts_with(b"/"))
            || !names_something
            || resolved.contains(&ExprId(index as u32))
        {
            continue;
        }
        let path = join(directory, text.strip_prefix(b"/").unwrap_or(text));
        let path = path.strip_suffix(b"/").unwrap_or(&path);
        for spelling in [path, without_extension(path)] {
            let spelled = files_by_spelling.get(spelling).into_iter().flatten();
            found.extend(spelled.map(|&spelled| TextThatSpellsFile {
                written_in: file,
                text: ExprId(index as u32),
                spelled,
            }));
        }
    }
    found
}

pub(super) fn is_every_file_found_by_name(input: &BindInput<'_, '_>, modules: &ModuleSet) -> bool {
    let mut externals = modules.external_kinds.iter();
    match input.runs_tests {
        true => input.helpers_of_tests_name_files,
        false => {
            (input.runs_in_place || input.files_are_named_out_of_sight)
                && externals.any(|&(_, kind)| kind == ExternalKind::UncompiledCode)
        }
    }
}

pub(super) fn find_texts_that_spell_files(
    input: &BindInput<'_, '_>,
    modules: &ModuleSet,
) -> Option<Vec<TextThatSpellsFile>> {
    let files = input.files;
    let mut compiled = files.compiled_files().iter();
    if is_every_file_found_by_name(input, modules)
        || !compiled.any(|&file| loads_by_unknown_name(files, file, |_| true))
    {
        return None;
    }
    let files_by_spelling = index_by_spelling(input);
    let is_code = |&&file: &&FileId| input.sources.kind(file) == SourceKind::Program;
    let code_files = files.compiled_files().iter().filter(is_code);
    let mut found: Vec<(FileId, Vec<TextThatSpellsFile>)> =
        code_files.map(|&file| (file, Vec::new())).collect();
    found.sort_unstable_by_key(|of_file| of_file.0);
    for_each_mut(&mut found, input.in_parallel, &|(file, texts)| {
        *texts = find_files_spelled_by(files, &files_by_spelling, *file);
    });
    Some(found.into_iter().flat_map(|of_file| of_file.1).collect())
}
