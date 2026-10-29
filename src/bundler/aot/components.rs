use super::services::{BuildContext, with_ast_scope};
use crate::bun_fs as Fs;
use crate::cache::{Contents, Entry};
use crate::options::Target;
use crate::parse_task::parse_worker::run_with_source_code;
use crate::parse_task::{ContentsOrFd, Step};
use crate::{ParseTask, Worker};
use bun_aot::load::source_provider::{ComponentFile, apply_jsx_settings};
use bun_ast::{Index, Log};
use bun_ptr::{BackRef, ParentRef, detach_lifetime};
use bun_react_compiler::{Observer, observe};
use bun_sys::Fd;

/// Index 0 is the runtime, and the hashbang of index 1 picks the target. Nothing looks this index up in the graph.
const SOURCE_INDEX: u32 = 2;

/// Parses `file` through `ParseTask`, so the parser gets exactly the options a bundle gives it. Returns false if the
/// file has an error.
pub(crate) fn compile_components(
    context: &BuildContext,
    file: &ComponentFile<'_>,
    observer: &mut dyn Observer,
    log: &mut Log,
) -> bool {
    let mut worker = scopeguard::guard(Worker::get(context.bundle()), |worker| worker.unget());
    with_ast_scope(|arena| {
        // A bundle keeps every AST until it finishes. This one is dead once `observer` has seen it.
        let arena_of_bundle = std::mem::replace(&mut worker.arena, BackRef::new(arena));
        let mut worker = scopeguard::guard(&mut **worker, |worker| worker.arena = arena_of_bundle);
        let mut task = create_task(context, file);
        let mut entry = Entry {
            contents: Contents::SharedBuffer {
                ptr: file.contents.as_ptr(),
                len: file.contents.len(),
            },
            fd: Fd::INVALID,
            ..Default::default()
        };
        let mut step = Step::Pending;
        let parsed = observe(observer, || {
            run_with_source_code(&mut task, &mut worker, &mut step, log, &mut entry)
        });
        parsed.is_ok_and(|success| !success.log.has_errors())
    })
}

fn create_task(context: &BuildContext, file: &ComponentFile<'_>) -> ParseTask<'static> {
    // SAFETY: the task is dropped inside `compile_components`, which borrows all three slices.
    let (path, namespace, contents) = unsafe {
        (
            detach_lifetime(file.module.path),
            detach_lifetime(file.module.namespace),
            detach_lifetime(file.contents),
        )
    };
    // SAFETY: the carrier outlives the build, and its pointer comes from a mutable reference.
    let carrier = unsafe { ParentRef::from_raw_mut(context.bundle_pointer().as_ptr()) };
    let mut jsx = context.options().jsx.clone();
    apply_jsx_settings(&mut jsx, &file.settings.jsx);
    ParseTask {
        path: Fs::Path::init_with_namespace(path, namespace),
        ctx: Some(carrier),
        known_target: Target::Bun,
        contents_or_fd: ContentsOrFd::Contents(contents),
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
