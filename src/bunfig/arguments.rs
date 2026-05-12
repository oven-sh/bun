//! Port of `src/runtime/cli/Arguments.zig` — bunfig-loading subset.
//!
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

fn get_home_config_path(buf: &mut PathBuffer) -> Option<&ZStr> {
    let paths: [&[u8]; 1] = [b".bunfig.toml"];

    if let Some(data_dir) = env_var::XDG_CONFIG_HOME.get() {
        return Some(resolve_path::join_abs_string_buf_z::<platform::Auto>(
            data_dir, &mut **buf, &paths,
        ));
    }

    if let Some(home_dir) = env_var::HOME.get() {
        return Some(resolve_path::join_abs_string_buf_z::<platform::Auto>(
            home_dir, &mut **buf, &paths,
        ));
    }

    None
}

fn load_bunfig(
    cmd: CommandTag,
    auto_loaded: bool,
    config_path: &ZStr,
    ctx: Context<'_>,
) -> Result<(), bun_core::Error> {
    let source =
        match bun_ast::to_source(config_path, bun_ast::ToSourceOptions { convert_bom: true }) {
            Ok(s) => s,
            Err(err) => {
                if auto_loaded {
                    return Ok(());
                }
                Output::pretty_errorln(format_args!(
                    "{}\nwhile reading config \"{}\"",
                    err,
                    BStr::new(config_path.as_bytes()),
                ));
                Global::exit(1);
            }
        };

    bun_ast::stmt::data::Store::create();
    bun_ast::expr::data::Store::create();
    let _store_reset = bun_ast::StoreResetGuard::new();

    // PORT NOTE: reshaped for borrowck — `defer { ctx.log.level = original }`
    // would capture `&mut *ctx.log` past the `Bunfig::parse(.., ctx)` reborrow.
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

fn load_global_bunfig(cmd: CommandTag, ctx: Context<'_>) -> Result<(), bun_core::Error> {
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
) -> Result<(), bun_core::Error> {
    // PORT NOTE: `comptime cmd.readGlobalConfig()` demoted to runtime — see
    // `parse()` PORT NOTE; `Tag::read_global_config` is a const-ish lookup so
    // the dead arm is still a single branch.
    if cmd.read_global_config() {
        if let Err(err) = load_global_bunfig(cmd, ctx) {
            if auto_loaded {
                return Ok(());
            }

            Output::pretty_errorln(format_args!(
                "{}\nreading global config \"{}\"",
                err,
                BStr::new(config_path.as_bytes()),
            ));
            Global::exit(1);
        }
    }

    load_bunfig(cmd, auto_loaded, config_path, ctx)
}

#[cold]
fn report_bunfig_load_failure(log: *mut bun_ast::Log, err: bun_core::Error) -> ! {
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
) -> Result<(), bun_core::Error> {
    // If running as a standalone executable with autoloadBunfig disabled, skip config loading
    // unless an explicit config path was provided via --config
    if user_config_path_.is_none() {
        if let Some(graph) = StandaloneModuleGraph::get() {
            // SAFETY: `get()` returns a non-null process-global pointer when Some.
            if unsafe { (*graph).flags }.contains(
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
                )))
    {
        config_path_ = b"bunfig.toml";
        auto_loaded = true;
    }

    if config_path_.is_empty() {
        return Ok(());
    }
    let config_path_len: usize;
    if config_path_[0] == b'/' {
        config_buf[..config_path_.len()].copy_from_slice(config_path_);
        config_buf[config_path_.len()] = 0;
        config_path_len = config_path_.len();
    } else {
        if ctx.args.absolute_working_dir.is_none() {
            let mut secondbuf = PathBuffer::uninit();
            let cwd_len = match bun_sys::getcwd(&mut *secondbuf) {
                Ok(n) => n,
                Err(_) => return Ok(()),
            };
            ctx.args.absolute_working_dir = Some(Box::<[u8]>::from(&secondbuf[..cwd_len]));
        }

        // PORT NOTE: reshaped for borrowck — `join_abs_string_buf` ties the
        // returned slice's lifetime to both `cwd` (borrowed from `ctx.args`)
        // and `config_buf`. We only need the length to NUL-terminate and
        // re-wrap, so capture `joined.len()` and drop the `ctx` borrow before
        // the `&mut ctx` call below.
        config_path_len = {
            let awd: &[u8] = ctx.args.absolute_working_dir.as_deref().unwrap();
            let parts: [&[u8]; 2] = [awd, config_path_];
            let joined =
                resolve_path::join_abs_string_buf::<platform::Auto>(awd, &mut *config_buf, &parts);
            joined.len()
        };
        config_buf[config_path_len] = 0;
    }
    // SAFETY: `config_buf[config_path_len] == 0` (written above on both arms);
    // `config_buf` outlives the call.
    let config_path = ZStr::from_buf(&config_buf[..], config_path_len);

    if let Err(err) = load_config_path(cmd, auto_loaded, config_path, ctx) {
        report_bunfig_load_failure(ctx.log, err);
    }
    Ok(())
}

pub fn load_config_with_cmd_args(
    cmd: CommandTag,
    args: &bun_clap::Args<bun_clap::Help>,
    ctx: Context<'_>,
) -> Result<(), bun_core::Error> {
    load_config(cmd, args.option(b"--config"), ctx)
}
