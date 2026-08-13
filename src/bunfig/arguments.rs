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
) -> Result<(), crate::Error> {
    let source =
        match bun_ast::to_source(config_path, bun_ast::ToSourceOptions { convert_bom: true }) {
            Ok(s) => s,
            Err(err) => {
                if auto_loaded {
                    return Ok(());
                }
                bun_core::pretty_errorln!(
                    "{}\nwhile reading config \"{}\"",
                    err,
                    BStr::new(config_path.as_bytes()),
                );
                Global::exit(1);
            }
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

/// True when `path` contains a `node_modules` component.
fn in_node_modules(path: &[u8]) -> bool {
    let mut rest = path;
    while let Some(i) = bun_core::strings::index_of(rest, b"node_modules") {
        let end = i + b"node_modules".len();
        let before_ok = i == 0 || bun_paths::is_sep_any(rest[i - 1]);
        let after_ok = end == rest.len() || bun_paths::is_sep_any(rest[end]);
        if before_ok && after_ok {
            return true;
        }
        rest = &rest[end..];
    }
    false
}

enum PackageJson {
    Missing,
    Plain,
    Workspaces(Vec<Box<[u8]>>),
}

/// Reads `dir/package.json` and classifies it; an unreadable or unparsable
/// file counts as `Plain` (a project root whose shape we cannot see).
fn read_package_json(dir: &[u8]) -> PackageJson {
    let mut name_buf = PathBuffer::uninit();
    let json_path: &ZStr = resolve_path::join_abs_string_buf_z::<platform::Auto>(
        dir,
        &mut name_buf[..],
        &[b"package.json".as_slice()],
    );
    let json_source = match bun_ast::to_source(json_path, Default::default()) {
        Err(_) => return PackageJson::Missing,
        Ok(source) => source,
    };
    let mut log = bun_ast::Log::default();
    let Ok(parsed) = bun_parsers::json::ParsedJson::parse_package_json(&json_source, &mut log)
    else {
        return PackageJson::Plain;
    };
    let Some(prop) = parsed.root.as_property(b"workspaces") else {
        return PackageJson::Plain;
    };
    let json_array = match prop.expr.data {
        bun_ast::ExprData::EArrayJSON(arr) => arr,
        bun_ast::ExprData::EObjectJSON(obj) => match (*obj).get(b"packages") {
            Some(bun_ast::e::JsonValue::Array(arr)) => *arr,
            _ => return PackageJson::Plain,
        },
        _ => return PackageJson::Plain,
    };
    let mut patterns: Vec<Box<[u8]>> = Vec::new();
    for item in json_array.get().items() {
        if let bun_ast::e::JsonValue::String(pattern) = item {
            patterns.push(Box::<[u8]>::from(pattern.slice()));
        }
    }
    PackageJson::Workspaces(patterns)
}

/// Last directory the ancestor bunfig.toml walk may check, as a prefix length
/// of `cwd`, mirroring how `--filter` finds the project root (filter_arg.rs):
/// the nearest directory with a package.json, or the workspace root whose
/// `workspaces` globs claim that directory. `None` when no package.json
/// exists anywhere up the tree (walk unbounded, like package.json resolution).
fn walk_root_bound(cwd: &[u8]) -> Option<usize> {
    bun_ast::expr::data::Store::create();
    bun_ast::stmt::data::Store::create();
    let _store_guard = bun_ast::StoreResetGuard::new();

    // Nearest directory with a package.json.
    let mut dir = cwd;
    let nearest: &[u8] = loop {
        match read_package_json(dir) {
            // A workspace root is its own project.
            PackageJson::Workspaces(_) => return Some(dir.len()),
            PackageJson::Plain => break dir,
            PackageJson::Missing => {}
        }
        dir = bun_paths::dirname(dir)?;
    };

    // The nearest ancestor declaring workspaces decides: if its globs claim
    // `nearest`, that root bounds the walk; otherwise `nearest` stands alone.
    let mut anc = nearest;
    while let Some(parent) = bun_paths::dirname(anc) {
        anc = parent;
        if let PackageJson::Workspaces(patterns) = read_package_json(anc) {
            let rel_start =
                anc.len() + usize::from(!matches!(anc.last(), Some(&c) if bun_paths::is_sep_any(c)));
            let mut rel: Vec<u8> = nearest[rel_start..].to_vec();
            if cfg!(windows) {
                for c in &mut rel {
                    if *c == b'\\' {
                        *c = b'/';
                    }
                }
            }
            let member = patterns
                .iter()
                .any(|p| bun_glob::r#match(p, &rel).matches());
            return Some(if member { anc.len() } else { nearest.len() });
        }
        if matches!(anc.last(), Some(&c) if bun_paths::is_sep_any(c)) {
            break;
        }
    }
    Some(nearest.len())
}

pub fn load_config(
    cmd: CommandTag,
    user_config_path_: Option<&[u8]>,
    ctx: Context<'_>,
) -> Result<(), crate::Error> {
    load_config_impl(cmd, user_config_path_, false, ctx)
}

/// `load_config`, but auto-discovering bunfig.toml even for commands outside
/// `ALWAYS_LOADS_CONFIG`. Used by the exec-time `bun run` / repl call sites,
/// which load config only after CLI flags are applied.
pub fn load_config_auto(cmd: CommandTag, ctx: Context<'_>) -> Result<(), crate::Error> {
    load_config_impl(cmd, None, true, ctx)
}

fn load_config_impl(
    cmd: CommandTag,
    user_config_path_: Option<&[u8]>,
    force_auto: bool,
    ctx: Context<'_>,
) -> Result<(), crate::Error> {
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
            || force_auto
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

        if auto_loaded {
            // Walk up from cwd so a workspace subdirectory finds the root bunfig.toml.
            let awd: Box<[u8]> = ctx
                .args
                .absolute_working_dir
                .as_deref()
                .unwrap()
                .to_vec()
                .into_boxed_slice();
            // Strip a trailing separator from `--cwd dir/`, keeping "/" and "C:\".
            let mut dir: &[u8] = &awd;
            while dir.len() > 1
                && bun_paths::is_sep_native(dir[dir.len() - 1])
                && (!cfg!(windows) || dir[dir.len() - 2] != b':')
            {
                dir = &dir[..dir.len() - 1];
            }
            // Lifecycle scripts run with cwd inside node_modules, and
            // compiled executables read config from their run directory:
            // both keep the cwd-only lookup.
            let bound: Option<usize> =
                if StandaloneModuleGraph::get().is_some() || in_node_modules(dir) {
                    Some(dir.len())
                } else {
                    walk_root_bound(dir)
                };
            // Roots ("/", "C:\\", UNC) keep their trailing separator: the last to check.
            let mut is_root = matches!(dir.last(), Some(&c) if bun_paths::is_sep_native(c));
            let mut found_len: Option<usize> = None;
            loop {
                let parts: [&[u8]; 2] = [dir, config_path_];
                let joined = resolve_path::join_abs_string_buf::<platform::Auto>(
                    dir,
                    &mut *config_buf,
                    &parts,
                );
                let joined_len = joined.len();
                config_buf[joined_len] = 0;
                let candidate = ZStr::from_buf(&config_buf[..], joined_len);
                let is_regular = matches!(
                    bun_sys::stat(candidate),
                    Ok(ref st) if bun_sys::is_regular_file(st.st_mode as bun_sys::Mode)
                );
                if is_regular {
                    found_len = Some(joined_len);
                    break;
                }
                if matches!(bound, Some(b) if dir.len() <= b) {
                    break;
                }
                if is_root {
                    break;
                }
                let Some(parent) = bun_paths::dirname(dir) else {
                    break;
                };
                is_root = matches!(parent.last(), Some(&c) if bun_paths::is_sep_native(c));
                dir = parent;
            }
            match found_len {
                Some(len) => {
                    // config_buf is already populated and NUL-terminated.
                    config_path_len = len;
                }
                None => {
                    // Mark attempted so fallback load_config calls skip the walk.
                    ctx.debug.loaded_bunfig = true;
                    return Ok(());
                }
            }
        } else {
            // Capture the length only, ending the `ctx.args` borrow early for borrowck.
            config_path_len = {
                let awd: &[u8] = ctx.args.absolute_working_dir.as_deref().unwrap();
                let parts: [&[u8]; 2] = [awd, config_path_];
                let joined = resolve_path::join_abs_string_buf::<platform::Auto>(
                    awd,
                    &mut *config_buf,
                    &parts,
                );
                joined.len()
            };
            config_buf[config_path_len] = 0;
        }
    }
    // SAFETY: `config_buf[config_path_len] == 0` (written above on both arms);
    // `config_buf` outlives the call.
    let config_path = ZStr::from_buf(&config_buf[..], config_path_len);

    if let Err(err) = load_config_path(cmd, auto_loaded, config_path, ctx) {
        // Non-fatal only for `bun run`; `bun -e` and explicit --config stay fatal.
        if !(auto_loaded && cmd == CommandTag::RunCommand) {
            report_bunfig_load_failure(ctx.log, err);
        }
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
