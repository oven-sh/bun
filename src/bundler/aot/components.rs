use super::services::{BuildContext, with_ast_scope};
use crate::bun_fs as Fs;
use crate::options::Target;
use crate::parse_task::Step;
use crate::parse_task::parse_worker::run_with_source_code;
use crate::{ParseTask, Worker};
use bun_aot::load::source_provider::{ComponentFile, apply_jsx_settings};
use bun_ast::{Index, Log};
use bun_js_parser::{
    ExpandedImportMetaGlob, leave_import_meta_globs_as_written, record_import_meta_globs,
};
use bun_ptr::{ParentRef, detach_lifetime, detach_lifetime_ref};
use bun_react_compiler::{Observer, observe};

/// Index 0 is the runtime, and the hashbang of index 1 picks the target. Nothing looks this index up in the graph.
const SOURCE_INDEX: u32 = 2;
const TARGET: Target = Target::Bun;

/// Parses `file` through `ParseTask`, so the parser gets exactly the options a bundle gives it. Returns false if the
/// file has an error, such as a macro call.
pub(crate) fn compile_components(
    context: &BuildContext,
    file: &ComponentFile<'_>,
    observer: &mut dyn Observer,
    log: &mut Log,
) -> bool {
    // An expanded `import.meta.glob()` refers to imports that exist only in the parser's tree.
    leave_import_meta_globs_as_written(|| observe(observer, || parse(context, file, log)))
}

/// Every call of `import.meta.glob()` in `file` as a bundle expands it.
pub(crate) fn expand_globs(
    context: &BuildContext,
    file: &ComponentFile<'_>,
    log: &mut Log,
) -> Vec<ExpandedImportMetaGlob> {
    let mut expanded = Vec::new();
    record_import_meta_globs(&mut expanded, || parse(context, file, log));
    expanded
}

fn parse(context: &BuildContext, file: &ComponentFile<'_>, log: &mut Log) -> bool {
    let mut worker = Worker::get(context.bundle());
    with_ast_scope(|arena| {
        // SAFETY: `parsed` holds the AST that borrows `arena` and `file.contents`, and drops inside this closure.
        let (arena, contents) =
            unsafe { (detach_lifetime_ref(arena), detach_lifetime(file.contents)) };
        let mut worker = scopeguard::guard(&mut *worker, |worker| {
            let inlines_main = context.options().inline_entrypoint_import_meta_main;
            set_main_inlining(worker, inlines_main);
        });
        // Load fails the build on a macro import, so nothing is lost by disabling macros here.
        worker.transpiler_for_target(TARGET).options.no_macros = true;
        set_main_inlining(&mut worker, false);
        let mut task = create_task(context, file);
        let mut step = Step::Pending;
        let parsed = run_with_source_code(&mut task, &mut worker, &mut step, log, arena, contents);
        parsed.is_ok_and(|success| !success.log.has_errors())
    })
}

/// A worker may run an entry point too, so the load folds `import.meta.main` there, not the parser.
fn set_main_inlining(worker: &mut Worker, inlines_main: bool) {
    let options = &mut worker.transpiler_for_target(TARGET).options;
    options.inline_entrypoint_import_meta_main = inlines_main;
}

fn create_task(context: &BuildContext, file: &ComponentFile<'_>) -> ParseTask<'static> {
    // SAFETY: the task drops inside `parse`, which borrows both slices.
    let (path, namespace) = unsafe {
        (
            detach_lifetime(file.module.path),
            detach_lifetime(file.module.namespace),
        )
    };
    // SAFETY: the carrier outlives the build, and its pointer comes from a mutable reference.
    let carrier = unsafe { ParentRef::from_raw_mut(context.bundle_pointer().as_ptr()) };
    let mut jsx = context.options().jsx.clone();
    apply_jsx_settings(&mut jsx, &file.settings.jsx);
    ParseTask {
        path: Fs::Path::init_with_namespace(path, namespace),
        ctx: Some(carrier),
        known_target: TARGET,
        loader: Some(file.loader),
        jsx,
        source_index: Index::init(SOURCE_INDEX),
        emit_decorator_metadata: file.settings.emits_decorator_metadata,
        experimental_decorators: file.settings.experimental_decorators,
        use_define_for_class_fields: file.settings.use_define_for_class_fields != Some(false),
        is_entry_point: file.is_entry_point,
        ..Default::default()
    }
}
