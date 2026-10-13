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

use crate::bunfig::{Bunfig, Counts};

/// Reads what a bunfig has for `bun lint` or `bun fmt`, which know their flags. It is called with the whole file.
/// `Err`: what is wrong, and where.
pub type ToolReader<'a> = dyn FnMut(&bun_ast::Expr) -> Result<(), (bun_ast::Loc, Vec<u8>)> + 'a;

/// What the process ends with if its bunfig cannot be used. For `bun lint` and `bun fmt` that is what ESLint and
/// Prettier end with if their configuration cannot.
fn exit_code_of_failure(cmd: CommandTag) -> u32 {
    match cmd {
        CommandTag::LintCommand | CommandTag::FormatCommand => 2,
        _ => 1,
    }
}

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
    cmd: CommandTag,
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
    Global::exit(exit_code_of_failure(cmd));
}

fn load_bunfig(
    cmd: CommandTag,
    auto_loaded: bool,
    config_path: &ZStr,
    ctx: Context<'_>,
    tool: Option<&mut ToolReader<'_>>,
    counts: Counts,
) -> Result<(), crate::Error> {
    let source =
        match bun_ast::to_source(config_path, bun_ast::ToSourceOptions { convert_bom: true }) {
            Ok(s) => s,
            Err(err) => return unreadable_config(cmd, auto_loaded, &err, config_path.as_bytes()),
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
    Bunfig::parse(cmd, &source, ctx, tool, counts)
}

fn load_global_bunfig(cmd: CommandTag, ctx: Context<'_>) -> Result<(), crate::Error> {
    if ctx.has_loaded_global_config {
        return Ok(());
    }
    ctx.has_loaded_global_config = true;

    let mut config_buf = bun_paths::path_buffer_pool::get();
    if let Some(path) = get_home_config_path(&mut config_buf) {
        load_bunfig(cmd, true, path, ctx, None, Counts::Everything)?;
    }
    Ok(())
}

pub fn load_config_path(
    cmd: CommandTag,
    auto_loaded: bool,
    config_path: &ZStr,
    ctx: Context<'_>,
) -> Result<(), crate::Error> {
    load_config_path_for_tool(cmd, auto_loaded, config_path, ctx, None)
}

fn load_config_path_for_tool(
    cmd: CommandTag,
    auto_loaded: bool,
    config_path: &ZStr,
    ctx: Context<'_>,
    tool: Option<&mut ToolReader<'_>>,
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

    load_bunfig(cmd, auto_loaded, config_path, ctx, tool, Counts::Everything)
}

#[cold]
fn report_bunfig_load_failure(cmd: CommandTag, log: *mut bun_ast::Log, err: crate::Error) -> ! {
    report_bunfig_load_failure_as(cmd, log, err, None)
}

/// `shown`: what the file is called, if that is not its name.
#[cold]
fn report_bunfig_load_failure_as(
    cmd: CommandTag,
    log: *mut bun_ast::Log,
    err: crate::Error,
    shown: Option<&[u8]>,
) -> ! {
    // SAFETY: process-global Log; see `load_bunfig` note.
    let log = unsafe { &mut *log };
    let is_of_tool = matches!(cmd, CommandTag::LintCommand | CommandTag::FormatCommand);
    if log.has_any() {
        // `bun lint` and `bun fmt` print relative paths everywhere else, so do that here too.
        let locations = log.msgs.iter_mut().filter(|_| is_of_tool);
        for location in locations.filter_map(|it| it.data.location.as_mut()) {
            location.file = (shown.unwrap_or_else(|| bun_paths::basename(&location.file[..])))
                .to_vec()
                .into();
        }
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
        if is_of_tool {
            Global::exit(exit_code_of_failure(cmd));
        }
        Output::print_error("\n");
    }
    Output::err(err, "failed to load bunfig", ());
    Global::exit(exit_code_of_failure(cmd));
}

pub fn load_config(
    cmd: CommandTag,
    user_config_path_: Option<&[u8]>,
    ctx: Context<'_>,
) -> Result<(), crate::Error> {
    load_config_for_tool(cmd, user_config_path_, ctx, None)
}

/// As [`load_config`], for `bun lint` and `bun fmt`: `tool` is called with the file, if there is one.
pub fn load_config_for_tool(
    cmd: CommandTag,
    user_config_path_: Option<&[u8]>,
    ctx: Context<'_>,
    tool: Option<&mut ToolReader<'_>>,
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

    let mut config_buf = bun_paths::path_buffer_pool::get();
    if cmd.read_global_config() {
        if !ctx.has_loaded_global_config {
            ctx.has_loaded_global_config = true;

            if let Some(path) = get_home_config_path(&mut config_buf) {
                if let Err(err) = load_config_path(cmd, true, path, ctx) {
                    report_bunfig_load_failure(cmd, ctx.log, err);
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
            let mut secondbuf = bun_paths::path_buffer_pool::get();
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
            cmd,
            auto_loaded,
            &bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open)
                .with_path(config_path_),
            config_path_,
        );
    };

    if let Err(err) = load_config_path_for_tool(cmd, auto_loaded, config_path, ctx, tool) {
        report_bunfig_load_failure(cmd, ctx.log, err);
    }
    Ok(())
}

/// Whether `bun lint` or `bun fmt` goes on to the bunfig.toml of the directory above.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Above {
    /// It has all that it looks for.
    Unwanted,
    /// A file there that cannot be used ends the process.
    Needed,
    /// It has its own section and looks for one that it can do without. A file there that cannot be used ends the search: it
    /// can be that of another project.
    Optional,
}

/// For `bun lint` and `bun fmt`, which have not found all that is for them in the working directory: has `tool` read the
/// bunfig.toml of each directory above it, from the nearest, for as long as it wants the next. It is called with the file and
/// its path from the working directory. Nothing else in these files counts.
pub fn load_config_above_for_tool(
    cmd: CommandTag,
    ctx: Context<'_>,
    mut above: Above,
    tool: &mut dyn FnMut(&bun_ast::Expr, &[u8]) -> Result<Above, (bun_ast::Loc, Vec<u8>)>,
) -> Option<()> {
    let cwd = ctx.args.absolute_working_dir.clone()?;
    let mut buffer = bun_paths::path_buffer_pool::get();
    let mut shown = b"bunfig.toml".to_vec();
    let mut below = join_config_path(&cwd, &shown, &mut buffer)?
        .as_bytes()
        .to_vec();
    loop {
        shown.splice(0..0, *b"../");
        let path = join_config_path(&cwd, &shown, &mut buffer)?;
        // The root is its own parent.
        if path.as_bytes() == below {
            return None;
        }
        let is_optional = above == Above::Optional;
        let read: &mut ToolReader<'_> = &mut |file| {
            above = tool(file, &shown)?;
            Ok(())
        };
        // SAFETY: process-global Log; see `load_bunfig` note.
        let said = unsafe { &*ctx.log }.msgs.len();
        let counts = Counts::OnlyForTheTool;
        if let Err(err) = load_bunfig(cmd, true, path, &mut *ctx, Some(read), counts) {
            if !is_optional {
                report_bunfig_load_failure_as(cmd, ctx.log, err, Some(&shown));
            }
            // SAFETY: as above.
            let log = unsafe { &mut *ctx.log };
            for it in log.msgs.drain(said..) {
                match it.kind {
                    bun_ast::Kind::Err => log.errors -= 1,
                    bun_ast::Kind::Warn => log.warnings -= 1,
                    _ => {}
                }
            }
            return None;
        }
        if above == Above::Unwanted {
            return Some(());
        }
        below.clear();
        below.extend_from_slice(path.as_bytes());
    }
}

pub fn load_config_with_cmd_args(
    cmd: CommandTag,
    args: &bun_clap::Args<bun_clap::Help>,
    ctx: Context<'_>,
) -> Result<(), crate::Error> {
    load_config(cmd, args.option(b"--config"), ctx)
}
