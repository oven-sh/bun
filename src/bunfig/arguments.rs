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

/// Result of looking up the system bunfig path.
struct SystemConfigResult<'a> {
    path: Option<&'a ZStr>,
    /// `true` if the path came from `BUN_SYSTEM_CONFIG` (admin opt-in).
    /// Explicit paths fail loudly; auto-discovered defaults are best-effort.
    is_explicit: bool,
}

fn get_system_config_path(buf: &mut PathBuffer) -> SystemConfigResult<'_> {
    // Allow overriding the system config path via BUN_SYSTEM_CONFIG.
    // get_not_empty() treats empty string as unset.
    if let Some(custom_path) = env_var::BUN_SYSTEM_CONFIG.get_not_empty() {
        // Require absolute paths so system-wide policy isn't cwd-dependent.
        if !resolve_path::Platform::AUTO.is_absolute(custom_path) {
            Output::err_generic(
                "BUN_SYSTEM_CONFIG must be an absolute path, got: \"{s}\"",
                (BStr::new(custom_path),),
            );
            Global::exit(1);
        }
        if custom_path.len() < bun_paths::MAX_PATH_BYTES {
            buf[..custom_path.len()].copy_from_slice(custom_path);
            buf[custom_path.len()] = 0;
            let len = custom_path.len();
            return SystemConfigResult {
                path: Some(ZStr::from_buf(&buf[..], len)),
                is_explicit: true,
            };
        }
        return SystemConfigResult {
            path: None,
            is_explicit: true,
        };
    }

    // `ALLUSERSPROFILE` is declared `posix = None`, so calling
    // `env_var::ALLUSERSPROFILE.get_not_empty()` on POSIX would trip the
    // macro's `debug_assert` today and break compilation outright once the
    // planned `#[cfg(unix)] compile_error!` lands (see env_var.rs:871-873).
    // Gate with attribute-`#[cfg]` so the body is removed before type-check,
    // matching the established pattern for other `posix = None` accessors
    // (SYSTEMROOT in resolver/lib.rs + resolver/fs.rs, WINDIR in upgrade_command.rs).
    #[cfg(windows)]
    {
        // Windows: use %ALLUSERSPROFILE%\bunfig.toml (typically C:\ProgramData\bunfig.toml).
        if let Some(all_users) = env_var::ALLUSERSPROFILE.get_not_empty() {
            let paths: [&[u8]; 1] = [b"bunfig.toml"];
            let joined = resolve_path::join_abs_string_buf_z::<platform::Auto>(
                all_users, &mut **buf, &paths,
            );
            return SystemConfigResult {
                path: Some(joined),
                is_explicit: false,
            };
        }
        SystemConfigResult {
            path: None,
            is_explicit: false,
        }
    }
    #[cfg(not(windows))]
    {
        // POSIX: /etc/bunfig.toml.
        let system_path: &[u8] = b"/etc/bunfig.toml";
        buf[..system_path.len()].copy_from_slice(system_path);
        buf[system_path.len()] = 0;
        let len = system_path.len();
        SystemConfigResult {
            path: Some(ZStr::from_buf(&buf[..], len)),
            is_explicit: false,
        }
    }
}

fn get_home_config_path(buf: &mut PathBuffer) -> Option<&ZStr> {
    let paths: [&[u8]; 1] = [b".bunfig.toml"];

    if let Some(data_dir) = env_var::XDG_CONFIG_HOME.get_not_empty() {
        return Some(resolve_path::join_abs_string_buf_z::<platform::Auto>(
            data_dir, &mut **buf, &paths,
        ));
    }

    if let Some(home_dir) = env_var::HOME.get_not_empty() {
        return Some(resolve_path::join_abs_string_buf_z::<platform::Auto>(
            home_dir, &mut **buf, &paths,
        ));
    }

    None
}

fn load_bunfig(
    cmd: CommandTag,
    auto_loaded: bool,
    is_project: bool,
    config_path: &ZStr,
    ctx: Context<'_>,
) -> Result<(), crate::Error> {
    // Intern `config_path` in the process-lifetime `FilenameStore` so `ctx.log`
    // can safely borrow it after the caller's PathBuffer goes out of scope.
    // `Source::init_path_string_owned` goes through `IntoStr::into_str` which
    // uses `detach_lifetime` to fabricate `&'static [u8]` from the slice we pass
    // to `to_source`; errors logged by `Bunfig::parse` then store
    // `Location.file = Cow::Borrowed(source.path.text)` in ctx.log. Those
    // messages are often printed later (by `report_bunfig_load_failure` in
    // `load_config()`'s catch, after `load_system_bunfig`'s `config_buf` stack
    // frame has been dropped). Borrowing the caller's stack buffer would read
    // freed stack memory at print time — stack-use-after-return under ASAN.
    //
    // `FilenameStore::append_parts` copies the bytes into a never-freed BSS
    // singleton and returns a genuine `&'static [u8]`, so the fabricated
    // `'static` lifetime is honest and LeakSanitizer sees the allocation as
    // reachable (the Zig original duped into a never-`deinit`'d arena for the
    // same reason). This is the codebase's standard way to own a path for the
    // process lifetime — PORTING.md forbids `Box::leak`/`mem::forget` for this.
    // We append a trailing NUL so the interned slice can back a `ZStr`.
    // `load_bunfig` runs a bounded number of times per process (system, home,
    // project), so interning even on the ENOENT probe is negligible.
    let interned = bun_resolver::fs::FilenameStore::instance()
        .append_parts(&[config_path.as_bytes(), b"\0"])
        .map_err(|_| bun_alloc::AllocError)?;
    // SAFETY: `interned` ends in the NUL byte appended above; `from_raw` takes
    // the length excluding it.
    let owned_path = unsafe { ZStr::from_raw(interned.as_ptr(), interned.len() - 1) };

    let source =
        match bun_ast::to_source(owned_path, bun_ast::ToSourceOptions { convert_bom: true }) {
            Ok(s) => s,
            Err(err) => {
                if auto_loaded {
                    return Ok(());
                }
                bun_core::pretty_errorln!(
                    "{}\nwhile reading config \"{}\"",
                    err,
                    BStr::new(owned_path.as_bytes()),
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
    // Only mark loaded_bunfig for project-level configs so guards in
    // run_command / standalone / repl don't skip project bunfig.toml
    // when a system or home config was already loaded.
    if is_project {
        ctx.debug.loaded_bunfig = true;
    }
    Bunfig::parse(cmd, &source, ctx)
}

/// Load the system-wide bunfig (lowest priority). Auto-discovered paths are
/// best-effort (warn-and-continue on errors so a broken /etc/bunfig.toml
/// doesn't brick every bun invocation on the host). Explicit BUN_SYSTEM_CONFIG
/// fails loudly so admin typos surface immediately.
pub fn load_system_bunfig(cmd: CommandTag, ctx: Context<'_>) -> Result<(), crate::Error> {
    if ctx.has_loaded_system_config {
        return Ok(());
    }
    ctx.has_loaded_system_config = true;

    let mut config_buf = PathBuffer::uninit();
    let result = get_system_config_path(&mut config_buf);
    if result.is_explicit && result.path.is_none() {
        Output::err_generic("BUN_SYSTEM_CONFIG path is too long", ());
        Global::exit(1);
    }
    if let Some(path) = result.path {
        let log_ptr: *mut bun_ast::Log = ctx.log;
        // SAFETY: process-global Log; see load_bunfig note.
        let errors_before = unsafe { (*log_ptr).errors };

        // System config is not project-level, so pass is_project = false.
        // Explicit paths aren't auto-loaded (must fail loudly on missing file).
        let load_result = load_bunfig(cmd, !result.is_explicit, false, path, ctx);

        match load_result {
            Ok(()) => {}
            Err(err) => {
                if result.is_explicit {
                    return Err(err);
                }
                // Auto-discovered: warn and continue. Bunfig::parse mutates ctx
                // in place as it walks keys, so settings before the failing key
                // may already be applied — reflect that honestly.
                // SAFETY: process-global Log.
                let log = unsafe { &mut *log_ptr };
                if log.has_any() {
                    let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                }
                bun_core::warn!(
                    "aborted parsing auto-discovered system bunfig at \"{}\" ({}); keys before the error may have been applied",
                    BStr::new(path.as_bytes()),
                    err.name(),
                );
                log.reset();
                return Ok(());
            }
        }

        // TOML lexer errors reach ctx.log without propagating as Zig/Rust
        // errors. Check for that separately.
        // SAFETY: process-global Log.
        let log = unsafe { &mut *log_ptr };
        if log.errors > errors_before {
            if result.is_explicit {
                let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                Output::err_generic(
                    "failed to parse BUN_SYSTEM_CONFIG at \"{s}\"",
                    (BStr::new(path.as_bytes()),),
                );
                Global::exit(1);
            }
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            bun_core::warn!(
                "aborted parsing auto-discovered system bunfig at \"{}\"; keys before the error may have been applied",
                BStr::new(path.as_bytes()),
            );
            log.reset();
        }
    }
    Ok(())
}

fn load_global_bunfig(cmd: CommandTag, ctx: Context<'_>) -> Result<(), crate::Error> {
    if ctx.has_loaded_global_config {
        return Ok(());
    }
    ctx.has_loaded_global_config = true;

    // Load system-wide config first (lowest priority).
    load_system_bunfig(cmd, ctx)?;

    let mut config_buf = PathBuffer::uninit();
    if let Some(path) = get_home_config_path(&mut config_buf) {
        // Home config is not project-level.
        load_bunfig(cmd, true, false, path, ctx)?;
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

    // This is the project-level config path.
    load_bunfig(cmd, auto_loaded, true, config_path, ctx)
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
    // BUN_SYSTEM_CONFIG is an explicit administrator policy override — honor
    // it even for standalone executables compiled with disable_autoload_bunfig.
    // get_not_empty() treats empty string as unset.
    let has_explicit_system_config = env_var::BUN_SYSTEM_CONFIG.get_not_empty().is_some();

    // Load system-wide config BEFORE the standalone disable check so that
    // BUN_SYSTEM_CONFIG is honored even for compiled binaries, while still
    // letting disable_autoload_bunfig block home/project config loading.
    if has_explicit_system_config || cmd.read_global_config() {
        if let Err(err) = load_system_bunfig(cmd, ctx) {
            report_bunfig_load_failure(ctx.log, err);
        }
    }

    // If running as a standalone executable with autoloadBunfig disabled, skip further
    // config loading unless an explicit --config path was provided.
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
                // Home config is not project-level.
                if let Err(err) = load_bunfig(cmd, true, false, path, ctx) {
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

        // Reshaped for borrowck: `join_abs_string_buf` ties the
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
) -> Result<(), crate::Error> {
    load_config(cmd, args.option(b"--config"), ctx)
}
