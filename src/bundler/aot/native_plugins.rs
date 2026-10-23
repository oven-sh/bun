use bstr::BStr;
use bun_alloc::Arena;
use bun_aot::load::source_provider::{Failed, Loaded, ModuleName};
use bun_ast::{Loader, Loc, Log};
use bun_ptr::{ParentRef, detach_lifetime};
use std::borrow::Cow;

use super::services::BuildContext;
use crate::ParseTask;
use crate::bun_fs as Fs;
use crate::options::Target;
use crate::parse_task::ContentsOrFd;
use crate::parse_task::parse_worker::get_code_for_parse_task;
use crate::transpiler::Transpiler;

pub(crate) fn has_before_parse_plugins(context: &BuildContext) -> bool {
    context
        .bundle()
        .plugins_ref()
        .is_some_and(|plugins| plugins.has_on_before_parse_plugins())
}

pub(crate) fn run_before_parse(
    context: &BuildContext,
    module: ModuleName<'_>,
    loaded: Loaded,
    log: &mut Log,
) -> Result<Loaded, Failed> {
    let (contents, loader) = match &loaded {
        Loaded::Source {
            contents,
            loader,
            is_from_plugin: false,
        } => (&**contents, *loader),
        // The bundler parses what `onLoad` yields as it is.
        Loaded::Source {
            is_from_plugin: true,
            ..
        }
        | Loaded::Deferred
        | Loaded::NotFound => return Ok(loaded),
    };
    if !has_before_parse_plugins(context) {
        return Ok(loaded);
    }

    // `get_code_for_parse_task` blames the plugin for every error that is already in its log.
    let mut plugin_log = Log::init();
    let changed = context.with_worker(|transpiler, arena| {
        let mut task = create_task(context, module, contents, loader);
        run_plugins(&mut task, loader, transpiler, arena, &mut plugin_log)
    });
    plugin_log.append_to_with_recycled(log, true);
    Ok(changed?.unwrap_or(loaded))
}

fn create_task(
    context: &BuildContext,
    module: ModuleName<'_>,
    contents: &[u8],
    loader: Loader,
) -> ParseTask {
    // SAFETY: the task is dropped inside `run_before_parse`, which borrows all three slices and
    // copies the text of the task's messages, which can borrow `module.namespace`, out of its log.
    let (path, contents) = unsafe {
        (
            Fs::Path::init_with_namespace(module.path, module.namespace).into_static(),
            detach_lifetime(contents),
        )
    };
    // SAFETY: the carrier outlives the build, and its pointer comes from a mutable reference.
    let carrier = unsafe { ParentRef::from_raw_mut(context.bundle_pointer().as_ptr()) };
    ParseTask {
        path,
        ctx: Some(carrier),
        known_target: Target::Bun,
        contents_or_fd: ContentsOrFd::Contents(contents),
        loader: Some(loader),
        ..Default::default()
    }
}

fn run_plugins(
    task: &mut ParseTask,
    mut loader: Loader,
    transpiler: &mut Transpiler<'static>,
    arena: &Arena,
    log: &mut Log,
) -> Result<Option<Loaded>, Failed> {
    let mut file_path = task.path;
    let mut from_plugin = false;
    let transpiler = std::ptr::from_mut(transpiler);
    // SAFETY: `transpiler` comes from a live exclusive reference.
    let resolver = unsafe { &raw mut (*transpiler).resolver };
    let entry = get_code_for_parse_task(
        task,
        log,
        transpiler,
        resolver,
        arena,
        &mut file_path,
        &mut loader,
        &mut from_plugin,
    );

    let changed = match entry {
        Ok(entry) if from_plugin => Ok(Some(Loaded::Source {
            contents: Cow::Owned(entry.contents.as_slice().to_vec()),
            loader,
            is_from_plugin: true,
        })),
        Ok(_) => Ok(None),
        Err(error) => {
            if !log.has_errors() {
                let path = BStr::new(task.path.text);
                log.add_error_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!("{} in a native plugin for \"{path}\"", error.name()),
                );
            }
            Err(Failed)
        }
    };
    task.external_free_function.call();
    changed
}

#[cfg(test)]
mod tests {
    use super::super::services::with_test_context;
    use super::*;

    const MODULE: ModuleName<'static> = ModuleName {
        namespace: b"file",
        path: b"/project/a.ts",
    };

    #[test]
    #[cfg_attr(miri, ignore)]
    fn build_without_native_plugins_changes_nothing() {
        with_test_context(
            |_| {},
            |context| {
                assert!(!has_before_parse_plugins(context));
                let mut log = Log::init();
                let source = Loaded::Source {
                    contents: Cow::Borrowed(b"let a;"),
                    loader: Loader::Ts,
                    is_from_plugin: true,
                };
                assert!(matches!(
                    run_before_parse(context, MODULE, source, &mut log),
                    Ok(Loaded::Source {
                        contents: Cow::Borrowed(b"let a;"),
                        loader: Loader::Ts,
                        is_from_plugin: true,
                    })
                ));
                assert!(matches!(
                    run_before_parse(context, MODULE, Loaded::Deferred, &mut log),
                    Ok(Loaded::Deferred)
                ));
                assert!(matches!(
                    run_before_parse(context, MODULE, Loaded::NotFound, &mut log),
                    Ok(Loaded::NotFound)
                ));
                assert!(log.msgs.is_empty());
            },
        );
    }
}
