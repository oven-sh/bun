//! `JSON.parse<T>(text)` from "bun" and `validate<T>(value)` in a file that is transpiled and not compiled ahead of time. The
//! parser erases `T`. It asks here, the type checker reads `T`, and the parser writes what the checker found into the call.

use core::ffi::c_void;
use core::num::NonZeroU32;

use bun_aot::WithoutServices;
use bun_aot::engine::{ExecutableIdentity, has_compiler};
use bun_ast::{Log, Source};
use bun_options_types::aot_options::AotOptions;
use bun_options_types::validation_plans::{ValidationPlanSource, ValidationPlans};
use bun_sema_driver::Libs;
use bun_sema_driver::host::BundledLibs;
use bun_threading::Guarded;

use super::options::{OptionsInput, options_for_one_file};
use crate::Transpiler;
use crate::options::Target;

unsafe extern "Rust" {
    /// src/runtime/cli/typescript_libs.rs
    safe fn bun_bundled_typescript_libs() -> BundledLibs;
}

/// A file that is run where it lies finds what `bun run` finds, and one that is bundled what a bundle holds.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Output {
    RunsInPlace,
    Bundle,
}

/// `None`: the output doesn't run in Bun, which makes the validators, or this Bun has no type checker for it.
pub(crate) fn plan_source(
    transpiler: &Transpiler<'_>,
    output: Output,
) -> Option<ValidationPlanSource> {
    if transpiler.options.target != Target::Bun || !has_compiler() {
        return None;
    }
    Some(ValidationPlanSource {
        context: core::ptr::from_ref(transpiler).cast::<c_void>(),
        find: match output {
            Output::RunsInPlace => |context, source, log| ask_compiler(context, source, log, true),
            Output::Bundle => |context, source, log| ask_compiler(context, source, log, false),
        },
    })
}

/// A compiled executable only includes the type checker when its program calls `Bun.build`.
fn ask_compiler(
    context: *const c_void,
    source: &Source,
    log: &mut Log,
    runs_in_place: bool,
) -> Option<ValidationPlans> {
    bun_removable_features::call_removable_or!(
        AotCompiler,
        Throw,
        {
            log.add_error(
                Some(source),
                bun_ast::Loc::EMPTY,
                b"This executable doesn't include the type checker, so JSON.parse<T>() from \"bun\" and validate<T>() don't work in files it loads at run time",
            );
            None
        },
        find_plans,
        context,
        source,
        log,
        runs_in_place
    )
}

fn find_plans(
    context: *const c_void,
    source: &Source,
    log: &mut Log,
    runs_in_place: bool,
) -> Option<ValidationPlans> {
    // SAFETY: `plan_source` made the pointer of the transpiler that runs the parse, and nothing changes its options meanwhile.
    let transpiler = unsafe { &*context.cast::<Transpiler<'_>>() };
    let aot = AotOptions {
        runs_in_place,
        checks_only: runs_in_place,
        // The thread that asks is one of several that transpile.
        thread_count: Some(NonZeroU32::MIN),
        ..Default::default()
    };
    let input = OptionsInput {
        bundle_options: &transpiler.options,
        entry_points: &[],
        assets: &[],
        aot: &aot,
        executable_identity: ExecutableIdentity([0; 16]),
        image_form: None,
        module_prefix: b"",
        typescript_libs: Libs::Bundled(bun_bundled_typescript_libs()),
        file_map: None,
        working_directory: transpiler.fs().top_level_dir(),
        node_path: transpiler.env().get(b"NODE_PATH"),
    };
    let options = options_for_one_file(&input, source.path.text, &source.contents);
    static ONE_AT_A_TIME: Guarded<()> = Guarded::new(());
    let _one_at_a_time = ONE_AT_A_TIME.lock();
    bun_aot::plan_validated_calls(&options, &WithoutServices, log)
}
