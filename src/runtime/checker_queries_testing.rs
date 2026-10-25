use std::num::NonZeroUsize;

use bun_aot::builtins::unlinked_named_values;
use bun_aot::statistics::{LimitId, LimitValues};
use bun_core::strings;
use bun_jsc::bindgen::JsScope;
use bun_jsc::{JSGlobalObject, JsError, JsResult};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::Interner;
use bun_sema::check::aot::{
    BuiltinClassIndex, BuiltinTypePath, BuiltinTypeSymbols, Denotation, FileOrigin, QueryInputs,
    write_queries,
};
use bun_sema::fold::FoldInputs;
use bun_sema::program::Files;
use bun_sema::resolve::{AOT_CONDITION, Host};
use bun_sema::session::Session;
use bun_sema_driver::host::from_native;
use bun_sema_driver::{
    BuildDiagnostic, CompileRequest, EntryPoints, Libs, LoadFailure, check_and_lower, decide_roles,
    load_program,
};

use crate::cli::typescript_libs::BUNDLED;
use crate::code_resolver_testing::{
    DiskWithBuiltinModules, code_options_with_limits, fold_options_with_limits,
};

const fn global_type_path(
    class: u32,
    type_name: u32,
    names: &'static [&'static str],
    denotation: Denotation,
) -> BuiltinTypePath<'static> {
    BuiltinTypePath {
        class: BuiltinClassIndex(class),
        type_name,
        module: None,
        names,
        denotation,
    }
}

const TYPE_PATHS: [BuiltinTypePath<'static>; 11] = [
    global_type_path(0, 0, &["Map"], Denotation::Exact),
    global_type_path(0, 1, &["ReadonlyMap"], Denotation::View),
    global_type_path(1, 0, &["Set"], Denotation::Exact),
    global_type_path(1, 1, &["ReadonlySet"], Denotation::View),
    global_type_path(2, 0, &["Promise"], Denotation::Exact),
    global_type_path(2, 1, &["PromiseLike"], Denotation::View),
    global_type_path(3, 0, &["Error"], Denotation::Exact),
    global_type_path(4, 0, &["RegExp"], Denotation::Exact),
    global_type_path(5, 0, &["Date"], Denotation::Exact),
    global_type_path(6, 0, &["Request"], Denotation::Exact),
    global_type_path(7, 0, &["Intl", "DateTimeFormat"], Denotation::Exact),
];

fn write_diagnostic(reported: &BuildDiagnostic, files: &Files<'_>, root: &[u8], out: &mut Vec<u8>) {
    let diagnostic = &reported.diagnostic;
    match diagnostic.file {
        Some(file) => {
            let name = files.module(file).file_name();
            out.extend_from_slice(name.strip_prefix(root).unwrap_or(name));
            out.extend_from_slice(format!(":{}", diagnostic.line).as_bytes());
        }
        None => out.extend_from_slice(b"-:0"),
    }
    let (class, effect) = (diagnostic.class, reported.effect);
    let answer = format!(" diagnostic TS{} = {class:?} {effect:?}\n", diagnostic.code);
    out.extend_from_slice(answer.as_bytes());
}

fn throw_load_failure(global: &JSGlobalObject, failure: &LoadFailure) -> JsError {
    match failure.diagnostics.first() {
        Some(reported) => {
            let text = bstr::BStr::new(&reported.diagnostic.text);
            global.throw(format_args!("{text}"))
        }
        None => global.throw(format_args!("cannot resolve the entry point")),
    }
}

pub(crate) fn describe_checker_queries(
    cx: &mut JsScope<'_>,
    entry_point: &[u8],
    threads: Option<i32>,
) -> JsResult<Option<Vec<u8>>> {
    if !bun_aot::engine::has_compiler() {
        return Ok(None);
    }
    let global = cx.global();
    let session = Session::new();
    let requested_threads = usize::try_from(threads.unwrap_or(0)).unwrap_or(0);

    let entry_points = [from_native(entry_point)];
    let directory = strings::without_trailing_slash(dirname::<Posix>(&entry_points[0]));
    let conditions = [AOT_CONDITION.to_vec()];
    let host =
        DiskWithBuiltinModules::new(global.bun_vm(), requested_threads, directory, &conditions);
    let threads = NonZeroUsize::new(host.threads()).unwrap_or(NonZeroUsize::MIN);
    let limits = LimitValues::for_host();
    // Printed paths are the loader's, which are real paths.
    let mut root = host.realpath(directory);
    let code = code_options_with_limits(&root, &limits);
    if !root.ends_with(b"/") {
        root.push(b'/');
    }

    let fold = FoldInputs::new(fold_options_with_limits(&limits), session.arena());
    let atoms = Interner::new_in(&session);
    let request = CompileRequest {
        entry_points: EntryPoints::Written(&entry_points),
        code: &code,
        fold: &fold,
        atoms,
        libs: Libs::Bundled(BUNDLED),
        project_origin: FileOrigin::NoFile,
        threads,
        progress: None,
        left_out_bodies: None,
    };

    let loaded = match load_program(&session, &host, &request) {
        Ok(loaded) => loaded,
        Err(failure) => return Err(throw_load_failure(global, &failure)),
    };
    let files = loaded.files();
    let files_to_lower = files.compiled_files();
    let roles = decide_roles(&loaded, &host, &request, files_to_lower);
    let builtin_types = BuiltinTypeSymbols::compute(files, &TYPE_PATHS, &[]);
    let named_values = unlinked_named_values(files, &request.atoms);
    let inputs = QueryInputs {
        roles: &roles.roles,
        checked_elsewhere: &[],
        builtin_types: &builtin_types,
        named_values: &*named_values,
        max_inference_nodes: limits.get(LimitId::MaxInferenceNodes),
    };
    let checked = check_and_lower(
        &loaded,
        &host,
        &request,
        &roles,
        files_to_lower,
        &|checker, file| {
            let mut out = Vec::new();
            checker.with_queries(file, inputs, |queries| {
                write_queries(queries, &root, &mut out)
            });
            Some(out)
        },
    );

    let mut description = Vec::new();
    for (_, text) in &checked.lowered {
        description.extend_from_slice(text);
    }
    let diagnostics = (loaded.diagnostics.iter())
        .chain(&roles.diagnostics)
        .chain(&checked.diagnostics);
    for reported in diagnostics {
        write_diagnostic(reported, files, &root, &mut description);
    }
    Ok(Some(description))
}
