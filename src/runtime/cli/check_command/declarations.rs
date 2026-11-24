use std::collections::BTreeMap;

use bstr::BStr;
use bun_bundler::options::TypeChecked;
use bun_sema::check::Checker;
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use bun_sema_driver::host::{Provided, check_entry_point_dirs, from_native, to_native};
use bun_sema_driver::typed_files::{ModuleTypes, module_types, tsconfig_of_package};
use bun_sema_driver::{Category, PlanOptions, Report, Request, ScriptKind, format};
use bun_threading::Guarded;

use super::{
    Entries, Paths, already_read, has_types_with, log_data_of, request, script_kind_of,
    script_kinds_by_extension, with_pages,
};

/// A package without a configuration file is written for every runtime: it gets the globals that all of them have.
pub(super) const LIBS_WITHOUT_CONFIGURATION: [&[u8]; 2] =
    [b"--lib", b"esnext,dom,dom.iterable,dom.asynciterable"];

pub(crate) struct DeclarationFile {
    pub(crate) source: Vec<u8>,
    pub(crate) text: Vec<u8>,
}

// `BundleOptions::type_check` only answers whether the build goes on, so what it emits waits here.
static EMITTED_FILES: Guarded<Vec<DeclarationFile>> = Guarded::new(Vec::new());

static MODULE_TYPES: Guarded<Vec<ModuleTypes>> = Guarded::new(Vec::new());

pub(crate) fn take_declaration_files() -> Vec<DeclarationFile> {
    std::mem::take(&mut *EMITTED_FILES.lock())
}

pub(crate) fn take_module_types() -> Vec<ModuleTypes> {
    std::mem::take(&mut *MODULE_TYPES.lock())
}

pub(crate) fn check_and_emit_declarations(checked: TypeChecked, log: &mut bun_ast::Log) -> bool {
    let TypeChecked {
        cwd,
        tsconfig,
        conditions,
        loaders,
        entry_points,
        sources,
    } = checked;
    let by_extension = script_kinds_by_extension(loaders);
    let mut script_kinds: Vec<(Vec<u8>, ScriptKind)> = Vec::new();
    let mut sources = sources.map(|(path, text, loader)| {
        let script_kind = script_kind_of(loader).filter(|it| it.differs_from_name(path));
        if !bun_core::strings::contains(path, bun_paths::NODE_MODULES_NEEDLE) {
            script_kinds.extend(script_kind.map(|it| (path.to_vec(), it)));
        }
        (path, text)
    });
    let provided = Provided {
        already_read: already_read(cwd, &mut sources),
        ..Default::default()
    };
    let is_source = |path: &&[u8]| {
        has_types_with(&by_extension, path) || script_kinds.iter().any(|it| it.0 == **path)
    };
    let paths: Vec<Vec<u8>> = (entry_points.filter(is_source))
        .map(<[u8]>::to_vec)
        .collect();
    if paths.is_empty() {
        return true;
    }
    if !check_entry_point_dirs(cwd, &paths, log) {
        return false;
    }
    let entry_paths = paths;
    let paths = Paths::EntryPoints(Entries {
        paths: &entry_paths,
        script_kinds: &script_kinds,
        script_kinds_by_extension: &by_extension,
        conditions,
    });

    // By source: its `FileId`, the text of its declaration file, and what the checker knows about it. A task of the
    // checker can run again, and two programs can check the same file: the last time counts, for all three.
    let noted: Guarded<BTreeMap<Vec<u8>, (u32, Option<Vec<u8>>, Option<ModuleTypes>)>> =
        Guarded::new(BTreeMap::new());
    let emit = |checker: &mut Checker<'_, '_>, file: FileId| {
        let types = module_types(checker, file);
        let text = checker.emit_declaration_file(file);
        let source = checker.p.files.module(file).file_name().to_vec();
        noted.lock().insert(source, (file.0, text, types));
    };
    let has_configuration = tsconfig.is_some()
        || entry_paths.iter().any(|path| {
            let path = bun_paths::Path::resolve(&[cwd, path]);
            tsconfig_of_package(&from_native(&path)).is_some()
        });
    let flags = [&b"--declaration"[..], b"--declarationMap", b"false"];
    let libs = if has_configuration {
        &[][..]
    } else {
        &LIBS_WITHOUT_CONFIGURATION
    };
    let command_line = bun_sema_driver::parse_command_line(&[&flags, libs].concat(), cwd);
    let request = Request {
        plan_options: PlanOptions {
            after_file_only_for_checked_files: true,
            after_file_only_for_reached_files: true,
            stays_inside_package: true,
            ..Default::default()
        },
        after_file: Some(&emit),
        ..request(
            cwd,
            tsconfig,
            &paths,
            &command_line.compiler_options,
            0,
            None,
        )
    };
    let provided = with_pages(cwd, provided);
    let report = bun_sema_driver::check_provided_then(&request, provided, |report| report);
    add_to_log(&report, log);
    if !report.is_ok() {
        return false;
    }
    let noted = std::mem::take(&mut *noted.lock());
    let (mut module_types, mut emitted) = (Vec::new(), Vec::new());
    for (source, (file, text, types)) in noted {
        if let Some(mut types) = types {
            if let Some(text) = &text {
                types.emitted_declarations = text[..].into();
            }
            module_types.push((file, types));
        }
        emitted.extend(text.map(|text| DeclarationFile {
            source: bundler_path(&source),
            text,
        }));
    }
    // In the order of their program. The `FileId` of a file of one program is also that of a file of another, and
    // those stay in the order of their paths.
    module_types.shared_sort_by_key(|module| module.0);
    *MODULE_TYPES.lock() = module_types.into_iter().map(|it| it.1).collect();
    *EMITTED_FILES.lock() = emitted;
    true
}

pub(super) fn bundler_path(path: &[u8]) -> Vec<u8> {
    let mut path = to_native(path).to_vec();
    bun_paths::to_native_in_place::<u8>(&mut path);
    path
}

fn add_to_log(report: &Report, log: &mut bun_ast::Log) {
    for reported in &report.diagnostics {
        let kind = match reported.category {
            Category::Error => bun_ast::Kind::Err,
            Category::Warning => bun_ast::Kind::Warn,
            Category::Suggestion | Category::Message => continue,
        };
        match kind {
            bun_ast::Kind::Err => log.errors += 1,
            _ => log.warnings += 1,
        }
        log.add_msg(bun_ast::Msg {
            kind,
            data: log_data_of(reported),
            metadata: format::metadata_of(reported),
            notes: reported.related.iter().map(log_data_of).collect(),
            ..Default::default()
        });
    }
    for file in &report.incomplete {
        let path = to_native(&file.path);
        log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("{}", BStr::new(&file.message(path))),
        );
    }
}
