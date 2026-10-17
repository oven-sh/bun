pub mod audit;
pub mod build;
pub mod builder;
mod builtins_generated;
pub mod declared;
mod field_types;
pub mod format;
pub mod fragment;
pub mod id;
pub mod ir;
pub mod link;
mod names;
mod operands;
mod positions;
pub mod prelude;
mod print;
mod verify;
mod webassembly;

use build::Problem;
pub use bun_sema::aot_rules as rules;
use bun_sema::check::{Checker, Program as Checked};
use bun_sema::hir::{FileKind, StmtKind};
use bun_sema::program::FileId;
use bun_sema::util::{InParallel, for_each_mut};
use bun_threading::RwLock;
use fragment::Fragments;
use link::{Errors, Linked, OutsideProgramReason};
pub use link::{Explain, Typedness};

pub struct Translated {
    pub program: ir::Program,
    pub problems: Vec<String>,
    pub members: String,
    pub explained: Vec<String>,
    pub kept_errors: Vec<bool>,
    pub always_fails: bool,
    pub error_dismissal_reasons: Vec<String>,
    pub skipped_builtin_modules: Vec<(u32, String)>,
    pub skipped_builtin_functions: Vec<(u32, String)>,
    pub times: link::Times,
    pub typedness: Typedness,
    pub tokens: Option<Box<[u8]>>,
}

pub struct EngineProgram {
    pub written: Result<Box<[u8]>, Vec<String>>,
    pub kept_errors: Vec<bool>,
    pub explained: Vec<String>,
    pub typedness: Typedness,
    pub tokens: Option<Box<[u8]>>,
    pub builtin_modules_of_entry_points: Vec<Vec<Box<[u8]>>>,
}

pub const REQUIRE_SPECIFIER_PREFIX: &[u8] = b"\0require ";

pub const REQUIRED_AGAIN_SUFFIX: &[u8] = b"?required-again";
pub const REQUIRED_AGAIN_SPECIFIER: &[u8] = b"\0required again";

pub fn original_path(path: &[u8]) -> &[u8] {
    path.strip_suffix(REQUIRED_AGAIN_SUFFIX).unwrap_or(path)
}

pub fn runtime_path(path: &[u8]) -> Vec<u8> {
    let native = match path {
        [b'/', b'\\', b'\\', ..] => &path[1..],
        _ => bun_sema::resolve::typescript_path(path),
    };
    if !cfg!(windows) || native.len() == path.len() {
        return path.to_vec();
    }
    native
        .iter()
        .map(|&byte| if byte == b'/' { b'\\' } else { byte })
        .collect()
}

pub fn runtime_folder(runtime_path: &[u8]) -> &[u8] {
    let is_native = cfg!(windows) && !runtime_path.starts_with(b"/");
    let end =
        bun_core::strings::last_index_of_char(runtime_path, if is_native { b'\\' } else { b'/' })
            .unwrap_or(0);
    let is_root_of_drive = is_native && end == 2;
    &runtime_path[..(end + is_root_of_drive as usize)
        .max(1)
        .min(runtime_path.len())]
}

const REQUIRED_AGAIN_PROLOGUE: &[u8] =
    b"module.exports = function (exports, require, module, __filename, __dirname) {";
const REQUIRED_AGAIN_EPILOGUE: &[u8] = b"\n}";
pub const REQUIRED_AGAIN_PROLOGUE_LEN: u32 = REQUIRED_AGAIN_PROLOGUE.len() as u32;

pub fn original_source<'a>(path: &[u8], text: &'a [u8]) -> &'a [u8] {
    if !path.ends_with(REQUIRED_AGAIN_SUFFIX) {
        return text;
    }
    text.strip_prefix(REQUIRED_AGAIN_PROLOGUE)
        .and_then(|rest| rest.strip_suffix(REQUIRED_AGAIN_EPILOGUE))
        .unwrap_or(text)
}

#[derive(Default)]
pub struct Constants {
    pub root: Vec<u8>,
    pub defines: Vec<(Vec<u8>, Vec<u8>)>,
    pub features: Vec<Vec<u8>>,
    pub resolved: Option<ResolvedImports>,
    pub dropped_imports: rustc_hash::FxHashSet<(Vec<u8>, Vec<u8>)>,
    pub side_effect_free_files: rustc_hash::FxHashSet<Vec<u8>>,
    pub lifted_commonjs: rustc_hash::FxHashSet<Vec<u8>>,
    pub statements: rustc_hash::FxHashMap<Vec<u8>, Vec<(u32, bool)>>,
    pub texts: rustc_hash::FxHashMap<Vec<u8>, Vec<u8>>,
    pub assets: rustc_hash::FxHashMap<Vec<u8>, Vec<u8>>,
    pub source_path_to_url: Option<fn(&[u8]) -> Vec<u8>>,
    pub has_test_globals: bool,
    pub ignores_dce_annotations: bool,
    pub jsx_has_side_effects: bool,
    pub minifies_syntax: bool,
    pub minifies_identifiers: bool,
    pub function_sources: Option<Box<dyn Fn() -> FunctionSources + Send + Sync>>,
    pub logs_type_errors: bool,
    pub leaves_decorators_to_the_bundler: bool,
    pub records_spans: bool,
    pub has_preloads: bool,
}

pub type FunctionSources = rustc_hash::FxHashMap<Vec<u8>, (Vec<u8>, Vec<(u32, u32, u32)>)>;

#[derive(Clone, Copy)]
struct ResolvedImport {
    from: u32,
    to: u32,
    specifier: (u32, u32),
    previous_import: u32,
}

#[derive(Default, Clone)]
pub struct ResolvedImports {
    paths: Vec<Vec<u8>>,
    numbers: rustc_hash::FxHashMap<Vec<u8>, u32>,
    last_import_by_importer: Vec<u32>,
    specifiers: Vec<u8>,
    imports: Vec<ResolvedImport>,
}

impl ResolvedImports {
    const NONE: u32 = u32::MAX;

    pub fn number_of(&mut self, path: &[u8]) -> u32 {
        if let Some(&number) = self.numbers.get(path) {
            return number;
        }
        let number = self.paths.len() as u32;
        self.paths.push(path.to_vec());
        self.last_import_by_importer.push(Self::NONE);
        self.numbers.insert(path.to_vec(), number);
        number
    }

    fn specifier_of(&self, import: &ResolvedImport) -> &[u8] {
        let (start, length) = import.specifier;
        &self.specifiers[start as usize..(start + length) as usize]
    }

    pub fn insert(&mut self, from: u32, specifier: &[u8], to: u32) {
        let mut place = self.last_import_by_importer[from as usize];
        while place != Self::NONE {
            let import = self.imports[place as usize];
            if self.specifier_of(&import) == specifier {
                self.imports[place as usize].to = to;
                return;
            }
            place = import.previous_import;
        }
        let start = self.specifiers.len() as u32;
        self.specifiers.extend_from_slice(specifier);
        let previous_import = std::mem::replace(
            &mut self.last_import_by_importer[from as usize],
            self.imports.len() as u32,
        );
        self.imports.push(ResolvedImport {
            from,
            to,
            specifier: (start, specifier.len() as u32),
            previous_import,
        });
    }

    pub fn path(&self, number: u32) -> &[u8] {
        &self.paths[number as usize]
    }

    pub fn paths(&self) -> &[Vec<u8>] {
        &self.paths
    }

    pub fn by_number(&self) -> impl Iterator<Item = (u32, &[u8], u32)> + '_ {
        self.imports
            .iter()
            .map(|import| (import.from, self.specifier_of(import), import.to))
    }

    pub fn iter(&self) -> impl Iterator<Item = (&[u8], &[u8], &[u8])> + '_ {
        self.by_number()
            .map(|(from, specifier, to)| (self.path(from), specifier, self.path(to)))
    }

    pub fn targets(&self) -> impl Iterator<Item = &[u8]> + '_ {
        let mut is_target = vec![false; self.paths.len()];
        for import in &self.imports {
            is_target[import.to as usize] = true;
        }
        self.paths
            .iter()
            .zip(is_target)
            .filter(|it| it.1)
            .map(|it| it.0.as_slice())
    }

    pub fn retarget(&mut self, replacement_target: &[Option<u32>]) {
        for import in &mut self.imports {
            if let Some(instead) = replacement_target
                .get(import.to as usize)
                .copied()
                .flatten()
            {
                import.to = instead;
            }
        }
    }
}

impl Constants {
    pub fn build_constants(&self) -> std::sync::Arc<bun_sema::fold::BuildConstants> {
        std::sync::Arc::new(bun_sema::fold::BuildConstants {
            defines: bun_sema::fold::Defines::new(
                self.defines
                    .iter()
                    .map(|(name, value)| (&name[..], &value[..])),
            ),
            features: self.features.iter().cloned().collect(),
            locks_builtins: true,
            bundled_files: self
                .resolved
                .as_ref()
                .map(|resolved| resolved.targets().map(<[u8]>::to_vec).collect()),
        })
    }

    pub fn statements_by_file(
        statements: impl Iterator<Item = (Vec<u8>, u32, bool)>,
    ) -> rustc_hash::FxHashMap<Vec<u8>, Vec<(u32, bool)>> {
        let mut by_file: rustc_hash::FxHashMap<Vec<u8>, Vec<(u32, bool)>> = Default::default();
        for (path, start, verdict) in statements {
            by_file.entry(path).or_default().push((start, verdict));
        }
        by_file
    }
}

pub struct Translation<'a> {
    constants: &'a Constants,
    explain: Explain,
    rules: rules::Settings,
    begun: RwLock<Option<StartedTranslation<'a>>>,
}

struct StartedTranslation<'a> {
    partially_parsed: Vec<FileId>,
    translating: Option<(build::Shared<'a>, Fragments)>,
    refused_at: Option<(FileId, u32)>,
    has_stale_escape_notes: std::sync::OnceLock<bool>,
}

impl<'a> Translation<'a> {
    pub fn new(constants: &'a Constants) -> Translation<'a> {
        Translation {
            constants,
            explain: Explain::default(),
            rules: rules::Settings::default(),
            begun: RwLock::new(None),
        }
    }

    pub fn explaining(self, explain: Explain) -> Translation<'a> {
        Translation { explain, ..self }
    }

    pub fn enforcing(self, rules: rules::Settings) -> Translation<'a> {
        Translation { rules, ..self }
    }

    pub fn begin(
        &self,
        program: &Checked<'_>,
        entry_points: &[Vec<FileId>],
        in_parallel: InParallel<'_>,
    ) {
        program.rule_scopes.get_or_init(|| {
            rules::Scopes::new(&self.rules, program.files, &self.constants.root)
                .collecting_everything(self.explain.costs || self.explain.costs_json)
        });
        let mut partially_parsed = program.partially_parsed_files();
        partially_parsed.retain(|&file| program.files.hir(file).kind != FileKind::Declaration);
        if let Some(resolved) = self
            .constants
            .resolved
            .as_ref()
            .filter(|_| !partially_parsed.is_empty())
        {
            let files_in_bundle: rustc_hash::FxHashSet<FileId> = resolved
                .targets()
                .filter_map(|path| program.files.by_path.get(path))
                .chain(entry_points.iter().flatten().copied())
                .collect();
            partially_parsed.retain(|file| files_in_bundle.contains(file));
        }
        if self.constants.has_test_globals && !partially_parsed.is_empty() {
            let mut is_reached = vec![false; program.files.modules.len()];
            let mut left: Vec<FileId> = entry_points.iter().flatten().copied().collect();
            while let Some(file) = left.pop() {
                if !std::mem::replace(&mut is_reached[file.idx()], true) {
                    left.extend_from_slice(program.files.module(file).edges);
                }
            }
            partially_parsed.retain(|file| is_reached[file.idx()]);
        }
        let translating = partially_parsed.is_empty().then(|| {
            (
                build::Shared::new(program, entry_points, self.constants, in_parallel),
                Fragments::new(program.files.modules.len()),
            )
        });
        let maximum = usize::from(u16::MAX);
        let mut suspects: Vec<(FileId, Option<u32>)> = match &translating {
            Some((shared, _)) if !self.constants.records_spans => (0..program.files.modules.len()
                as u32)
                .map(FileId)
                .filter(|&file| {
                    program.files.modules[file.idx()].bound.symbols.len() > maximum
                        && shared.is_compiled(file)
                })
                .map(|file| (file, None))
                .collect(),
            _ => Vec::new(),
        };
        for_each_mut(&mut suspects, in_parallel, &|(file, place)| {
            *place = program.checker().oversized_environment_pos(*file, maximum)
        });
        let refused_at = suspects
            .into_iter()
            .find_map(|(file, place)| Some((file, place?)));
        if refused_at.is_some() {
            program.give_up();
        }
        let translating = translating.filter(|_| refused_at.is_none());
        *self.begun.write() = Some(StartedTranslation {
            partially_parsed,
            translating,
            refused_at,
            has_stale_escape_notes: Default::default(),
        });
    }

    pub fn is_compiled(&self, file: FileId) -> bool {
        self.begun
            .read()
            .as_ref()
            .and_then(|begun| begun.translating.as_ref())
            .is_some_and(|(shared, _)| shared.is_compiled(file))
    }

    pub fn record_file(&self, c: &mut Checker<'_, '_>, file: FileId) {
        let begun = self.begun.read();
        let begun = begun.as_ref().expect(NOT_STARTED_MESSAGE);
        if let Some((shared, fragments)) = &begun.translating
            && shared.is_compiled(file)
        {
            let has_stale_escape_notes = *begun.has_stale_escape_notes.get_or_init(|| {
                fragments.is_any_of(&|translated| c.are_escapes_recorded_for(translated))
            });
            c.during_translation_after_check(|c| {
                c.record_function_uses_in(file);
                if !has_stale_escape_notes {
                    c.record_untyped_object_evidence(file);
                }
            });
            c.clear_expr_cache();
        }
    }

    pub fn merge_notes(&self, program: &Checked<'_>) {
        let mut c = program.checker();
        c.merge_recorded_function_uses();
        let begun = self.begun.read();
        if let Some((shared, _)) = &begun.as_ref().expect(NOT_STARTED_MESSAGE).translating {
            c.merge_untyped_object_evidence(&|file| shared.is_compiled(file));
        }
    }

    pub fn translate_file(&self, c: &mut Checker<'_, '_>, file: FileId) {
        let begun = self.begun.read();
        let Some((shared, fragments)) = &begun.as_ref().expect(NOT_STARTED_MESSAGE).translating
        else {
            return;
        };
        if !shared.is_compiled(file) {
            return;
        }
        let fragment = match c.has_merged_function_uses() {
            true => c.during_translation_after_check(|c| build::translate_file(c, shared, file)),
            false => c.during_translation(|c| {
                c.record_function_uses_in(file);
                build::translate_file(c, shared, file)
            }),
        };
        if !c.is_warming_up() {
            fragments.put(fragment);
        }
        c.clear_expr_cache();
    }

    pub fn take_fragment_programs(&self, program: &Checked<'_>) -> Vec<ir::Program> {
        let begun = self.begun.read();
        let fragments = begun
            .as_ref()
            .expect(NOT_STARTED_MESSAGE)
            .translating
            .as_ref()
            .map_or_else(Vec::new, |(_, fragments)| {
                fragments.take(&|file| file.0, &|count, work| (0..count).for_each(work))
            });
        let line_table_of = |path: &[u8]| {
            let text = program
                .files
                .by_path
                .get(path)
                .map_or(&[][..], |file| &program.files.hir(file).text[..]);
            format::line_table(text, &bun_sema::check::compute_ecma_line_starts(text))
        };
        fragments
            .into_iter()
            .map(|fragment| {
                audit::fragment_program(
                    fragment,
                    &self.constants.root,
                    program.files.is_case_sensitive,
                    &line_table_of,
                )
            })
            .collect()
    }

    pub fn finish(
        &self,
        program: &Checked<'_>,
        in_parallel: InParallel<'_>,
        errors: &[(FileId, u32)],
    ) -> Translated {
        let (mut translated, name_table) =
            self.finish_before_renaming(program, in_parallel, errors);
        translated.tokens =
            name_table.map(|name_table| names::as_json(&name_table).into_boxed_slice());
        translated
    }

    fn finish_before_renaming(
        &self,
        program: &Checked<'_>,
        in_parallel: InParallel<'_>,
        errors: &[(FileId, u32)],
    ) -> (Translated, Option<names::NameTable>) {
        let begun = self.begun.read();
        let begun = begun.as_ref().expect(NOT_STARTED_MESSAGE);
        let mut linked = match &begun.translating {
            Some((shared, fragments)) => {
                let is_in_dropped_import = |&(file, pos): &(FileId, u32)| {
                    let hir = program.files.hir(file);
                    let specifier = hir
                        .ids(hir.body)
                        .filter(|&stmt| hir[stmt].start <= pos && pos < hir[stmt].loc.end)
                        .find_map(|stmt| match hir[stmt].kind {
                            StmtKind::Import(import) => Some(hir[import].spec),
                            StmtKind::ExportNamed(export) => Some(hir[export].spec),
                            StmtKind::ExportStar { spec, .. } => Some(spec),
                            _ => None,
                        });
                    specifier
                        .filter(|specifier| specifier.is_some())
                        .is_some_and(|specifier| {
                            self.constants.dropped_imports.contains(&(
                                program.files.module(file).file_name().to_vec(),
                                program.files.atoms.bytes(specifier).to_vec(),
                            ))
                        })
                };
                let in_dropped_imports: Vec<bool> =
                    errors.iter().map(is_in_dropped_import).collect();
                let errors = Errors {
                    places: errors,
                    in_dropped_imports: &in_dropped_imports,
                    imported_by: &|c, file| build::files_imported_by(c, shared, file),
                };
                let mut function_sources = self
                    .constants
                    .function_sources
                    .as_ref()
                    .map(|later| later());
                program.release_translation_caches();
                link::link(
                    program,
                    fragments.take(&|file| program.files.rank_of_file(file), in_parallel),
                    &fragments.program_ids,
                    shared.roots(),
                    shared.entry_points(),
                    shared.builtin_modules(),
                    shared.prelude(),
                    &self.constants.root,
                    self.constants.source_path_to_url.is_some(),
                    function_sources.as_mut(),
                    errors,
                    in_parallel,
                    self.explain,
                    &|c, missing, is_defined| build::describe(c, shared, missing, is_defined),
                )
            }
            None => {
                let parse_failure = |&file: &FileId| Problem {
                    file,
                    pos: program.files.hir(file).error_pos,
                    what: "a file that does not parse".into(),
                };
                let refused = begun.refused_at.map(|(file, pos)| Problem {
                    file,
                    pos,
                    what: "a function with more than 65,535 variables that inner functions use"
                        .into(),
                });
                Linked {
                    problems: begun
                        .partially_parsed
                        .iter()
                        .map(parse_failure)
                        .chain(refused)
                        .collect(),
                    errors: errors.iter().map(|_| None).collect(),
                    ..Linked::default()
                }
            }
        };
        linked.program.logs_type_errors = self.constants.logs_type_errors;
        webassembly::add_referenced_files(&mut linked.program);
        let tdz_names = self
            .constants
            .minifies_identifiers
            .then(|| names::intern_tdz_names(&mut linked.program.strs));
        let name_uses = linked.find_always_failing_sites(program, in_parallel, |linked_program| {
            tdz_names
                .as_ref()
                .map(|tdz_names| names::count_uses(linked_program, tdz_names, in_parallel))
        });
        let name_table = tdz_names.zip(name_uses).map(|(tdz_names, name_uses)| {
            names::shorten(&mut linked.program, &tdz_names, name_uses, in_parallel)
        });
        for (elsewhere, _) in linked
            .errors
            .iter_mut()
            .zip(errors)
            .filter(|(_, place)| program.files.hir(place.0).kind == FileKind::Declaration)
        {
            *elsewhere = None;
        }
        if let Some((shared, _)) = &begun.translating
            && let Some(&file) = shared.roots().first()
            && let Some(layout) = linked
                .program
                .layouts
                .iter()
                .find(|layout| layout.fields.len() > usize::from(u16::MAX))
        {
            let what = match layout.kind {
                ir::LayoutKind::Environment => {
                    "a function with more than 65,535 variables that inner functions use"
                }
                _ => "an object with more than 65,535 properties",
            };
            linked.problems.push(Problem {
                file,
                pos: 0,
                what: what.into(),
            });
        }
        let line_of = |file: FileId, pos: u32| {
            let text = &program.files.hir(file).text;
            bun_core::strings::count_char(&text[..(pos as usize).min(text.len())], b'\n') + 1
        };
        let error_dismissal_reasons = (linked.errors.iter().zip(errors))
            .filter_map(|(elsewhere, &(file, _))| {
                Some(match elsewhere.as_ref()? {
                    OutsideProgramReason::Cut(start) => format!("cut by a constant at line {}", line_of(file, *start)),
                    OutsideProgramReason::DroppedImport => "in a dropped import".to_owned(),
                    OutsideProgramReason::NotReached(name) => format!("in `{name}`, which is not reached"),
                    OutsideProgramReason::NoModule => "the file is not in the program".to_owned(),
                    OutsideProgramReason::RegExpLiteral => "in a regular expression literal, which the engine parses".to_owned(),
                    OutsideProgramReason::PrivateNameInOptionalChain => "a private name in an optional chain of JavaScript, which ECMAScript has".to_owned(),
                    OutsideProgramReason::PrivateNameOfEnclosingClass => "a private name of JavaScript that an enclosing class declares, which ECMAScript looks for when it runs".to_owned(),
                    OutsideProgramReason::StaticMemberNamedConstructor => "a static member of JavaScript named `constructor`, which ECMAScript has".to_owned(),
                    OutsideProgramReason::JsComment => "in a JavaScript comment, which is not code".to_owned(),
                    OutsideProgramReason::PackageDeclarations => "in a package's type declarations, which are not code".to_owned(),
                })
            })
            .collect();
        let shown = |problem: &Problem| {
            let module = program.files.module(problem.file);
            format!(
                "{}:{}: --aot does not support {}",
                bstr::BStr::new(&runtime_path(module.file_name())),
                line_of(problem.file, problem.pos),
                problem.what
            )
        };
        let problems = linked.problems.iter().map(shown).collect();
        let skipped_builtin_modules = linked
            .skipped_builtin_modules
            .iter()
            .map(|(id, problem)| (*id, shown(problem)))
            .collect();
        let skipped_builtin_functions = linked
            .skipped_builtin_functions
            .iter()
            .map(|(id, problem)| (*id, shown(problem)))
            .collect();
        if let Some(scopes) = program.rule_scopes.get() {
            scopes.retain_beyond_baseline(program.files, &mut linked.found);
        }
        let is_error =
            |found: &bun_sema::check::CompilerDiagnostic| match rules::Rule::of_code(found.code) {
                Some(rule) => program.rule_scopes.get().is_some_and(|scopes| {
                    scopes.severity(rule, found.file, found.start) == rules::Severity::Deny
                }),
                None => !matches!(found.code, 100019 | 100020),
            };
        let always_fails = linked.found.iter().any(is_error);
        program.compiler_diagnostics.lock().extend(linked.found);
        (
            Translated {
                program: linked.program,
                problems,
                members: linked.members,
                explained: linked.explained,
                kept_errors: linked.errors.iter().map(Option::is_none).collect(),
                always_fails,
                error_dismissal_reasons,
                skipped_builtin_modules,
                skipped_builtin_functions,
                times: linked.times,
                typedness: linked.typedness,
                tokens: None,
            },
            name_table,
        )
    }

    pub fn finish_for_engine(
        &self,
        program: &Checked<'_>,
        in_parallel: InParallel<'_>,
        errors: &[(FileId, u32)],
        on_written: &dyn Fn(&[u8]),
    ) -> EngineProgram {
        let builtin_modules_of_entry_points = match &self
            .begun
            .read()
            .as_ref()
            .expect(NOT_STARTED_MESSAGE)
            .translating
        {
            Some((shared, _)) => {
                build::builtin_modules_of_entry_points(&mut program.checker(), shared)
            }
            None => Vec::new(),
        };
        let (
            Translated {
                program: mut linked,
                problems,
                kept_errors,
                always_fails,
                explained,
                typedness,
                ..
            },
            name_table,
        ) = self.finish_before_renaming(program, in_parallel, errors);
        let written = if kept_errors.contains(&true) || always_fails {
            Err(Vec::new())
        } else if !problems.is_empty() {
            Err(problems)
        } else {
            let written = format::write_releasing(&mut linked, in_parallel).into_boxed_slice();
            on_written(&written);
            Ok(written)
        };
        let tokens = name_table.map(|name_table| names::as_json(&name_table).into_boxed_slice());
        release(linked, in_parallel);
        EngineProgram {
            written,
            kept_errors,
            explained,
            typedness,
            tokens,
            builtin_modules_of_entry_points,
        }
    }
}

pub fn release(mut program: ir::Program, in_parallel: InParallel<'_>) {
    const FUNCTIONS_PER_SLICE: usize = 256;
    let mut funcs = std::mem::take(&mut program.funcs);
    let mut parts: Vec<ir::Program> = vec![program];
    while !funcs.is_empty() {
        let slice = funcs.split_off(funcs.len().saturating_sub(FUNCTIONS_PER_SLICE));
        parts.push(ir::Program {
            funcs: slice,
            ..Default::default()
        });
    }
    for_each_mut(&mut parts, in_parallel, &|part| drop(std::mem::take(part)));
}

const NOT_STARTED_MESSAGE: &str = "`begin` comes first";
