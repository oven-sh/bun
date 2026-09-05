//! Bunfig-loading subset of CLI argument handling: these functions
//! and their private helpers were lifted out of `bun_runtime::cli::Arguments`
//! so that mid-tier crates (`bun_install`) can call them directly. The
//! `bun_runtime` crate re-exports these for its own callers.

use bstr::BStr;
use bun_bundler::options;
use bun_core::ZStr;
use bun_core::{self, Global, Output, env_var};
use bun_options_types::command_tag::{ALWAYS_LOADS_CONFIG, Tag as CommandTag};
use bun_options_types::context::Context;
use bun_paths::PathBuffer;
use bun_paths::resolve_path::{self, platform};
use bun_standalone_graph::StandaloneModuleGraph::StandaloneModuleGraph;

use crate::bunfig::Bunfig;

// ─── bunfig loading ──────────────────────────────────────────────────────────

/// `None` when `dir/path` does not fit: nothing could be opened at such a path anyway.
fn join_config_path<'buf>(
    dir: &[u8],
    path: &[u8],
    buf: &'buf mut PathBuffer,
) -> Option<&'buf ZStr> {
    let max_len = buf.len() - 1;
    let len = resolve_path::join_abs_string_buf_checked::<platform::Auto>(
        dir,
        &mut buf[..max_len],
        &[path],
    )?
    .len();
    buf[len] = 0;
    Some(ZStr::from_buf(&buf[..], len))
}

fn get_home_config_path(buf: &mut PathBuffer) -> Option<&ZStr> {
    let dir = env_var::XDG_CONFIG_HOME
        .get()
        .or_else(|| env_var::HOME.get())?;
    join_config_path(dir, b".bunfig.toml", buf)
}

fn unreadable_config(
    auto_loaded: bool,
    err: &bun_sys::Error,
    config_path: &[u8],
) -> Result<(), crate::Error> {
    if auto_loaded {
        return Ok(());
    }
    bun_core::pretty_errorln!(
        "{}\nwhile reading config \"{}\"",
        err,
        BStr::new(config_path),
    );
    Global::exit(1);
}

fn load_bunfig(
    cmd: CommandTag,
    auto_loaded: bool,
    config_path: &ZStr,
    ctx: Context<'_>,
) -> Result<(), crate::Error> {
    let source =
        match bun_ast::to_source(config_path, bun_ast::ToSourceOptions { convert_bom: true }) {
            Ok(s) => s,
            Err(err) => return unreadable_config(auto_loaded, &err, config_path.as_bytes()),
        };

    bun_ast::stmt::data::Store::create();
    bun_ast::expr::data::Store::create();
    let _store_reset = bun_ast::StoreResetGuard::new();

    // A drop-guard borrowing `&mut *ctx.log` would conflict with the
    // `Bunfig::parse(.., ctx)` reborrow.
    // Route through the raw `*mut Log` (process-lifetime, set in
    // `create_context_data()`); the guard restores `level` on unwind/return.
    let log_ptr: *mut bun_ast::Log = ctx.log;
    debug_assert!(!log_ptr.is_null());
    // SAFETY: `ctx.log` is the process-global Log written once during
    // single-threaded CLI startup; no other `&mut` to it is live here.
    let original_level = unsafe { (*log_ptr).level };
    // SAFETY: see above.
    unsafe { (*log_ptr).level = bun_ast::Level::Warn };
    let _guard = scopeguard::guard(original_level, move |lvl| {
        // SAFETY: same as above; runs on the same thread.
        unsafe { (*log_ptr).level = lvl };
    });
    ctx.debug.loaded_bunfig = true;
    Bunfig::parse(cmd, &source, ctx)
}

fn load_global_bunfig(cmd: CommandTag, ctx: Context<'_>) -> Result<(), crate::Error> {
    if ctx.has_loaded_global_config {
        return Ok(());
    }
    ctx.has_loaded_global_config = true;

    let mut config_buf = PathBuffer::uninit();
    if let Some(path) = get_home_config_path(&mut config_buf) {
        load_bunfig(cmd, true, path, ctx)?;
    }
    Ok(())
}

pub fn load_config_path(
    cmd: CommandTag,
    auto_loaded: bool,
    config_path: &ZStr,
    ctx: Context<'_>,
) -> Result<(), crate::Error> {
    // `cmd.read_global_config()` is evaluated at runtime (see
    // the note on `Parser::parse` in src/bunfig/bunfig.rs);
    // `Tag::read_global_config` is a const-ish
    // lookup so the dead arm is still a single branch.
    if cmd.read_global_config() {
        if let Err(err) = load_global_bunfig(cmd, ctx) {
            if auto_loaded {
                return Ok(());
            }

            bun_core::pretty_errorln!(
                "{}\nreading global config \"{}\"",
                err,
                BStr::new(config_path.as_bytes()),
            );
            Global::exit(1);
        }
    }

    load_bunfig(cmd, auto_loaded, config_path, ctx)
}

#[cold]
fn report_bunfig_load_failure(log: *mut bun_ast::Log, err: crate::Error) -> ! {
    // SAFETY: process-global Log; see `load_bunfig` note.
    let log = unsafe { &mut *log };
    if log.has_any() {
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
        Output::print_error("\n");
    }
    Output::err(err, "failed to load bunfig", ());
    Global::crash();
}

pub fn load_config(
    cmd: CommandTag,
    user_config_path_: Option<&[u8]>,
    ctx: Context<'_>,
) -> Result<(), crate::Error> {
    // If running as a standalone executable with autoloadBunfig disabled, skip config loading
    // unless an explicit config path was provided via --config
    if user_config_path_.is_none() {
        if let Some(graph) = StandaloneModuleGraph::get_ref() {
            if graph.flags.contains(
                bun_standalone_graph::StandaloneModuleGraph::Flags::DISABLE_AUTOLOAD_BUNFIG,
            ) {
                return Ok(());
            }
        }
    }

    let mut config_buf = PathBuffer::uninit();
    if cmd.read_global_config() {
        if !ctx.has_loaded_global_config {
            ctx.has_loaded_global_config = true;

            if let Some(path) = get_home_config_path(&mut config_buf) {
                if let Err(err) = load_config_path(cmd, true, path, ctx) {
                    report_bunfig_load_failure(ctx.log, err);
                }
            }
        }
    }

    let mut config_path_: &[u8] = user_config_path_.unwrap_or(b"");

    let mut auto_loaded: bool = false;
    if config_path_.is_empty()
        && (user_config_path_.is_some()
            || ALWAYS_LOADS_CONFIG[cmd]
            || (cmd == CommandTag::AutoCommand
                && (
                    // "bun"
                    ctx.positionals.is_empty()
                        // "bun file.js"
                        || (!ctx.positionals.is_empty()
                            && options::DEFAULT_LOADERS
                                .contains_key(bun_paths::extension(&ctx.positionals[0])))
                ))
            // "bun [run] --filter/--workspaces/--parallel/--sequential": these
            // dispatch to their own runners right after argument parsing and
            // never reach the lazy load in `RunCommand::exec_with_cfg`. Loading
            // here keeps the `[run]` flags applied later in `Arguments::parse`
            // (`--bun`, `--elide-lines`, ...) ahead of the file.
            || (matches!(cmd, CommandTag::RunCommand | CommandTag::AutoCommand)
                && (ctx.parallel || ctx.sequential || ctx.workspaces || !ctx.filters.is_empty())))
    {
        config_path_ = b"bunfig.toml";
        auto_loaded = true;
    }

    if config_path_.is_empty() {
        return Ok(());
    }
    let config_path: Option<&ZStr> = if config_path_[0] == b'/' {
        if config_path_.len() < config_buf.len() {
            Some(resolve_path::z(config_path_, &mut config_buf))
        } else {
            None
        }
    } else {
        if ctx.args.absolute_working_dir.is_none() {
            let mut secondbuf = PathBuffer::uninit();
            let cwd_len = match bun_sys::getcwd(&mut *secondbuf) {
                Ok(n) => n,
                Err(_) => return Ok(()),
            };
            ctx.args.absolute_working_dir = Some(Box::<[u8]>::from(&secondbuf[..cwd_len]));
        }

        join_config_path(
            ctx.args.absolute_working_dir.as_deref().unwrap(),
            config_path_,
            &mut config_buf,
        )
    };
    let Some(config_path) = config_path else {
        return unreadable_config(
            auto_loaded,
            &bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open)
                .with_path(config_path_),
            config_path_,
        );
    };

    if let Err(err) = load_config_path(cmd, auto_loaded, config_path, ctx) {
        report_bunfig_load_failure(ctx.log, err);
    }
    Ok(())
}

pub fn load_config_with_cmd_args(
    cmd: CommandTag,
    args: &bun_clap::Args<bun_clap::Help>,
    ctx: Context<'_>,
) -> Result<(), crate::Error> {
    load_config(cmd, args.option(b"--config"), ctx)
}
