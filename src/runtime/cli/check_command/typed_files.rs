use bstr::BStr;
use bun_ast::LoaderHashTable;
use bun_paths::platform::Auto;
use bun_paths::resolve_path::join_abs_string;
use bun_sema::check::Checker;
use bun_sema::check::aot::{Effect, FileOrigin, effect_of};
use bun_sema::config::{
    self, Project, default_options_of_aot_package, find_package_with_compiler_options,
    load_for_aot_package, load_options_for_build,
};
use bun_sema::json::Json;
use bun_sema::program::FileId;
use bun_sema::session::Session;
use bun_sema_driver::host::{Disk, Provided, from_native};
use bun_sema_driver::sound_files::{
    ModuleTypes, Output, annotate_implicit_any, emitted_declarations_of, module_types, sound_files,
    tsconfig_of_sources, typed_path_beside,
};
use bun_sema_driver::{Diagnostic, PlanOptions, Report, Request};
use bun_threading::Guarded;

use super::declarations::{LIBS_WITHOUT_CONFIGURATION, bundler_path};
use super::{Entries, Paths, already_read, request, script_kinds_by_extension, with_pages};

const SKIPPED_TYPED_FILES: &str =
    "the .aot.ts files that --aot compiles a package from are left out";

pub(crate) struct WrittenJavaScript<'a> {
    pub(crate) path: &'a [u8],
    pub(crate) text: &'a [u8],
    pub(crate) source_map: &'a [u8],
    pub(crate) entry_point: Option<&'a [u8]>,
}

pub(crate) struct TypedFilesRequest<'a> {
    pub(crate) cwd: &'a [u8],
    pub(crate) tsconfig: Option<&'a [u8]>,
    pub(crate) conditions: &'a [Box<[u8]>],
    pub(crate) loaders: &'a LoaderHashTable,
    pub(crate) outdir: &'a [u8],
    pub(crate) written: &'a [WrittenJavaScript<'a>],
    pub(crate) modules: &'a [ModuleTypes],
}

pub(crate) struct TypedFile {
    pub(crate) path: Vec<u8>,
    pub(crate) text: Vec<u8>,
}

pub(crate) type CompilerOptions = Vec<(Vec<u8>, Json)>;

#[derive(Default)]
pub(crate) struct TypedFiles {
    pub(crate) files: Vec<TypedFile>,
    pub(crate) compiler_options: CompilerOptions,
}

pub(crate) fn warn_about_skipped_typed_files(option: &str, log: &mut bun_ast::Log) {
    log.add_warning_fmt(
        None,
        bun_ast::Loc::EMPTY,
        format_args!("{SKIPPED_TYPED_FILES}: they do not support {option} yet"),
    );
}

/// What the checker knows about each module, by file. A task of the checker can run again: the last time counts.
#[derive(Default)]
pub(super) struct NotedModuleTypes(Guarded<Vec<(u32, ModuleTypes)>>);

impl NotedModuleTypes {
    pub(super) fn note(&self, checker: &mut Checker<'_, '_>, file: FileId) {
        self.note_if(checker, file, |_| true);
    }

    fn note_if(
        &self,
        checker: &mut Checker<'_, '_>,
        file: FileId,
        is_wanted: impl Fn(&ModuleTypes) -> bool,
    ) {
        if let Some(found) = module_types(checker, file).filter(is_wanted) {
            let mut noted = self.0.lock();
            noted.retain(|known| known.0 != file.0);
            noted.push((file.0, found));
        }
    }

    pub(super) fn take(&self) -> Vec<ModuleTypes> {
        let mut noted = std::mem::take(&mut *self.0.lock());
        noted.sort_by_key(|module| module.0);
        noted.into_iter().map(|module| module.1).collect()
    }
}

// What costs a package its types in the build of a program that installs it.
fn first_error(report: &Report) -> Option<&Diagnostic> {
    report.diagnostics.iter().find(|reported| {
        let effect = effect_of(
            FileOrigin::DependencySource,
            reported.class,
            reported.category,
        );
        effect != Effect::Dropped
    })
}

type Texts = Vec<(Vec<u8>, Vec<u8>)>;

const STATED_AS_THE_SOURCES_STATE_THEM: [&[u8]; 7] = [
    b"jsx",
    b"jsxFactory",
    b"jsxFragmentFactory",
    b"jsxImportSource",
    b"experimentalDecorators",
    b"emitDecoratorMetadata",
    b"useDefineForClassFields",
];

fn options_that_types_depend_on(project: &Project) -> CompilerOptions {
    let options = &project.options;
    let under_strict: [(&[u8], bool); 8] = [
        (b"strictNullChecks", options.strict_null_checks),
        (b"noImplicitAny", options.no_implicit_any),
        (b"noImplicitThis", options.no_implicit_this),
        (b"strictFunctionTypes", options.strict_function_types),
        (b"strictBindCallApply", options.strict_bind_call_apply),
        (
            b"strictBuiltinIteratorReturn",
            options.strict_builtin_iterator_return,
        ),
        (
            b"strictPropertyInitialization",
            options.strict_property_initialization,
        ),
        (
            b"useUnknownInCatchVariables",
            options.use_unknown_in_catch_variables,
        ),
    ];
    let beyond_strict: [(&[u8], bool); 2] = [
        (
            b"exactOptionalPropertyTypes",
            options.exact_optional_property_types,
        ),
        (
            b"noUncheckedIndexedAccess",
            options.no_unchecked_indexed_access,
        ),
    ];
    let is_strict = under_strict.iter().any(|flag| flag.1);
    let differing = (under_strict.iter().filter(|flag| is_strict && !flag.1))
        .chain(beyond_strict.iter().filter(|flag| flag.1));
    let mut stated = vec![(b"strict".to_vec(), Json::Bool(is_strict))];
    stated.extend(differing.map(|&(name, is_on)| (name.to_vec(), Json::Bool(is_on))));
    // Without `lib`, a target has a library of its own, which no `lib` can name.
    let is_default = options.libs.iter().any(|lib| lib.ends_with(b".full"));
    if !is_default && !options.libs.is_empty() {
        let libs = options.libs.iter().map(|lib| Json::String(lib.clone()));
        stated.push((b"lib".to_vec(), Json::Array(libs.collect())));
    }
    let written = project.raw_compiler_options.iter();
    stated.extend(
        written
            .filter(|option| STATED_AS_THE_SOURCES_STATE_THEM.contains(&&option.0[..]))
            .cloned(),
    );
    stated
}

fn options_of_sources(cwd: &[u8], tsconfig: Option<&[u8]>) -> CompilerOptions {
    let session = Session::new();
    let project = tsconfig.and_then(|tsconfig| {
        let path = from_native(join_abs_string::<Auto>(cwd, &[tsconfig]));
        let disk = Disk::with_already_read(1, Default::default(), &path);
        load_options_for_build(&disk, &session, &path).ok()
    });
    match project {
        Some(project) => options_that_types_depend_on(&project),
        None => vec![(b"strict".to_vec(), Json::Bool(true))],
    }
}

pub(crate) fn warn_unless_package_states(
    outdir: &[u8],
    compiler_options: &CompilerOptions,
    log: &mut bun_ast::Log,
) {
    let outdir = from_native(outdir);
    let disk = Disk::with_already_read(1, Default::default(), &outdir);
    let manifest_path = find_package_with_compiler_options(&disk, &outdir);
    let stated = match &manifest_path {
        Some(path) => {
            options_that_types_depend_on(&load_for_aot_package(&disk, &Session::new(), path))
        }
        None => vec![(b"strict".to_vec(), Json::Bool(true))],
    };
    if stated == *compiler_options {
        return;
    }
    let mut wanted = Vec::new();
    Json::Object(compiler_options.clone()).stringify(&mut wanted);
    log.add_warning_fmt(
        None,
        bun_ast::Loc::EMPTY,
        format_args!(
            "package.json needs \"compilerOptions\": {}: --aot type checks a package's .aot.ts files under them, and as strict without them",
            BStr::new(&wanted),
        ),
    );
}

pub(crate) fn typed_files_for_build(
    asked: &TypedFilesRequest<'_>,
    log: &mut bun_ast::Log,
) -> TypedFiles {
    let &TypedFilesRequest {
        cwd,
        tsconfig,
        conditions,
        loaders,
        outdir,
        written,
        modules,
    } = asked;
    let (bundler_outdir, outdir) = (outdir, &from_native(outdir)[..]);
    let paths: Vec<(Vec<u8>, Option<Vec<u8>>)> = written
        .iter()
        .map(|file| (from_native(file.path), file.entry_point.map(from_native)))
        .collect();
    let outputs: Vec<Output<'_>> = (written.iter().zip(&paths))
        .map(|(file, (path, entry_point))| Output {
            path,
            javascript: file.text,
            source_map: file.source_map,
            entry_point: entry_point.as_deref(),
        })
        .collect();
    let by_extension = script_kinds_by_extension(loaders);
    let tsconfig_of_sources = match tsconfig {
        Some(_) => None,
        None => tsconfig_of_sources(&outputs, modules),
    };
    let tsconfig = tsconfig.or(tsconfig_of_sources.as_deref());
    let newest_lib: Texts = vec![(
        [
            outdir.strip_suffix(b"/").unwrap_or(outdir),
            b"/newest-lib.d.ts",
        ]
        .concat(),
        b"/// <reference lib=\"esnext\" />\n".to_vec(),
    )];
    // The typed files are judged as a project that installs the package judges them: without the sources, under what the
    // package.json says of them. What the application's own tsconfig.json asks for does not count.
    let outdir_without_slash = outdir.strip_suffix(b"/").unwrap_or(outdir);
    let typed_names = paths.iter().filter_map(|(path, _)| {
        let typed = typed_path_beside(path)?;
        let inside = typed.strip_prefix(outdir_without_slash)?;
        Some(Json::String([b".", inside].concat()))
    });
    let compiler_options = options_of_sources(cwd, tsconfig);
    let mut all_options = default_options_of_aot_package();
    config::merge_compiler_options(&mut all_options, compiler_options.clone(), &[]);
    let mut config_text = Vec::new();
    Json::Object(vec![
        (b"compilerOptions".to_vec(), Json::Object(all_options)),
        (b"files".to_vec(), Json::Array(typed_names.collect())),
    ])
    .stringify(&mut config_text);
    let config_path = [outdir_without_slash, b"/tsconfig.aot.json"].concat();
    let without_sources = Some((config_path, config_text));
    let sources_tsconfig = tsconfig;
    let tsconfig_path = without_sources.as_ref().map(|file| bundler_path(&file.0));
    let tsconfig = tsconfig_path.as_deref();
    let check = |typed: &mut Texts, declarations: &Texts, libs: &Texts| {
        let paths: Vec<Vec<u8>> = (typed.iter().chain(libs))
            .map(|file| file.0.clone())
            .collect();
        let entries = Paths::EntryPoints(Entries {
            paths: &paths,
            script_kinds: &[],
            script_kinds_by_extension: &by_extension,
            conditions,
        });
        let request = request(cwd, tsconfig, &entries, &[], 0, None);
        let mut rounds = 0;
        loop {
            let texts = typed.iter().chain(declarations).chain(libs);
            let texts = texts.chain(&without_sources);
            let provided = Provided {
                already_read: already_read(cwd, &mut texts.map(|file| (&file.0[..], &file.1[..]))),
                ..Default::default()
            };
            let provided = with_pages(cwd, provided);
            let report = bun_sema_driver::check_provided_then(&request, provided, |report| report);
            rounds += 1;
            if rounds == 3 || !annotate_implicit_any(typed, &report.diagnostics) {
                return report;
            }
        }
    };
    let without_emitted_declarations = sound_files(outdir, &outputs, modules, &[]);
    let untyped_modules = without_emitted_declarations
        .as_ref()
        .map_or(&[][..], |found| &found.modules_of_untyped_values[..]);
    let emitted = emitted_declarations_of(modules, untyped_modules);
    let emitted_modules = NotedModuleTypes::default();
    if !emitted.is_empty() {
        let note = |checker: &mut Checker<'_, '_>, file: FileId| {
            emitted_modules.note_if(checker, file, |found| {
                emitted.iter().any(|file| file.0[..] == found.path[..])
            });
        };
        let paths: Vec<Vec<u8>> = emitted.iter().map(|file| file.0.clone()).collect();
        let entries = Paths::EntryPoints(Entries {
            paths: &paths,
            script_kinds: &[],
            script_kinds_by_extension: &by_extension,
            conditions,
        });
        let libs = match sources_tsconfig {
            Some(_) => &[][..],
            None => &LIBS_WITHOUT_CONFIGURATION,
        };
        let command_line = bun_sema_driver::parse_command_line(libs, cwd);
        let options = &command_line.compiler_options;
        let request = Request {
            plan_options: PlanOptions {
                stays_inside_package: true,
                ..Default::default()
            },
            after_file: Some(&note),
            ..request(cwd, sources_tsconfig, &entries, options, 0, None)
        };
        let mut texts = emitted.iter().map(|file| (&file.0[..], &file.1[..]));
        let provided = Provided {
            already_read: already_read(cwd, &mut texts),
            ..Default::default()
        };
        bun_sema_driver::check_provided_then(&request, with_pages(cwd, provided), |_| ());
    }
    let emitted_modules = emitted_modules.take();
    let found = match emitted_modules.is_empty() {
        true => without_emitted_declarations,
        false => sound_files(outdir, &outputs, modules, &emitted_modules),
    };
    let mut warn = |why: core::fmt::Arguments<'_>| {
        log.add_warning_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("{SKIPPED_TYPED_FILES}: {why}"),
        );
        TypedFiles::default()
    };
    let mut found = match found {
        Ok(found) => found,
        Err(why) => return warn(format_args!("{why}")),
    };
    let report = check(
        &mut found.typed,
        &found.declarations_while_checked,
        &newest_lib,
    );
    if let Some(first) = first_error(&report) {
        let path = bundler_path(&first.path);
        let separator = std::path::MAIN_SEPARATOR_STR.as_bytes();
        let shown = path
            .strip_prefix(bundler_outdir)
            .map_or(&path[..], |inside| {
                inside.strip_prefix(separator).unwrap_or(inside)
            });
        let text = bun_core::strings::split(&first.text[..], b"\n").next();
        let without_newest_lib = check(
            &mut found.typed,
            &found.declarations_while_checked,
            &Vec::new(),
        );
        let under = match first_error(&without_newest_lib) {
            None => {
                " under \"lib\": [\"esnext\"], which a project that installs the package may have"
            }
            Some(_) => "",
        };
        return warn(format_args!(
            "they have type errors{under}, the first at {}:{}:{}: TS{}: {}",
            BStr::new(shown),
            first.line,
            first.column,
            first.code,
            BStr::new(text.unwrap_or_default()),
        ));
    }
    if !report.incomplete.is_empty() {
        return warn(format_args!("they could not be type checked"));
    }
    let typed_files = found.typed.into_iter().map(|(path, text)| TypedFile {
        path: bundler_path(&path),
        text,
    });
    TypedFiles {
        files: typed_files.collect(),
        compiler_options,
    }
}
