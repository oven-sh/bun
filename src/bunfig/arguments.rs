//! Bunfig-loading subset of CLI argument handling: these functions
//! and their private helpers were lifted out of `bun_runtime::cli::Arguments`
//! so that mid-tier crates (`bun_install`) can call them directly. The
//! `bun_runtime` crate re-exports these for its own callers.

use bstr::BStr;
use bun_bundler::options;
use bun_core::ZStr;
use bun_core::{self, Global, Output, env_var, strings};
use bun_options_types::command_tag::{ALWAYS_LOADS_CONFIG, Tag as CommandTag};
use bun_options_types::context::Context;
use bun_options_types::schema::api;
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

/// The XDG specification says to ignore `$XDG_CONFIG_HOME` when it is empty or a relative path.
fn get_home_config_path(buf: &mut PathBuffer) -> Option<&ZStr> {
    let dir = [env_var::XDG_CONFIG_HOME.get(), env_var::HOME.get()]
        .into_iter()
        .flatten()
        .find(|dir| bun_paths::is_fully_qualified(dir))?;
    join_config_path(dir, b".bunfig.toml", buf)
}

/// Like npm, skips a config file that was found automatically but can't be read.
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

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ConfigFile {
    /// `$XDG_CONFIG_HOME/.bunfig.toml` or `$HOME/.bunfig.toml`
    User,
    /// `./bunfig.toml`
    Project,
    /// See [`find_config_above`].
    ProjectAbove,
    /// `--config`
    Named,
}

struct RestoreLogLevel {
    log: *mut bun_ast::Log,
    level: bun_ast::Level,
}

impl Drop for RestoreLogLevel {
    fn drop(&mut self) {
        // SAFETY: see `load_bunfig`; runs on the same thread.
        unsafe { (*self.log).level = self.level };
    }
}

fn load_bunfig(
    cmd: CommandTag,
    file: ConfigFile,
    config_path: &ZStr,
    ctx: Context<'_>,
    tool: Option<&mut ToolReader<'_>>,
    counts: Counts,
) -> Result<(), crate::Error> {
    let auto_loaded = file != ConfigFile::Named;
    // Set this even if the read fails. Otherwise the later stages of `bun run` that check the flag
    // would try to load the file again and print the warning twice.
    ctx.debug.loaded_bunfig = true;
    let source =
        match bun_ast::to_source(config_path, bun_ast::ToSourceOptions { convert_bom: true }) {
            Ok(s) => s,
            Err(err) => {
                return unreadable_config(cmd, auto_loaded, &err, config_path.as_bytes());
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
    let _restore = RestoreLogLevel {
        log: log_ptr,
        level: original_level,
    };
    Bunfig::parse(cmd, &source, file, ctx, tool, counts)
}

/// Whether the package.json in `root` lists `dir`, which is below `root`, as a workspace. `None` if it has no `workspaces`.
fn lists_workspace(root: &[u8], dir: &[u8], buf: &mut PathBuffer) -> Option<bool> {
    let path = join_config_path(root, b"package.json", buf)?;
    let source = bun_ast::to_source(path, Default::default()).ok()?;
    bun_ast::stmt::data::Store::create();
    bun_ast::expr::data::Store::create();
    let _store_reset = bun_ast::StoreResetGuard::new();
    let mut log = bun_ast::Log::init();
    let Ok(json) = bun_parsers::json::ParsedJson::parse_package_json(&source, &mut log) else {
        return Some(false);
    };
    let workspaces = json.root.get(b"workspaces")?;
    let patterns = workspaces.get(b"packages").unwrap_or(workspaces);
    let bun_ast::ExprData::EArrayJSON(patterns) = patterns.data else {
        return Some(false);
    };
    let dir = bun_paths::string_paths::without_leading_path_separator(&dir[root.len()..]);
    let patterns = patterns.get().items().iter().filter_map(|it| match it {
        bun_ast::E::JsonValue::String(pattern) => Some(pattern.slice()),
        _ => None,
    });
    Some(bun_glob::any_matches(patterns.map(|pattern| {
        let pattern = strings::remove_leading_dot_slash(pattern);
        bun_glob::r#match(strings::without_trailing_slash(pattern), dir)
    })))
}

/// Whether `path`, not following a link, and its directory `dir` belong to the owner of `cwd`; a hard link gives `path` alone that owner.
#[cfg(unix)]
fn has_owner_of(path: &ZStr, dir: &[u8], cwd: &[u8]) -> bool {
    let Ok(file) = bun_sys::lstat(path) else {
        return false;
    };
    [dir, cwd].into_iter().all(|it| {
        bun_sys::lstat(&bun_core::ZBox::from_bytes(it)).is_ok_and(|it| it.st_uid == file.st_uid)
    })
}

/// The owner of a file or directory.
#[cfg(windows)]
struct Owner {
    /// Points into `descriptor`.
    sid: *mut core::ffi::c_void,
    descriptor: *mut core::ffi::c_void,
}

#[cfg(windows)]
impl Owner {
    fn of(path: &[u8]) -> Option<Owner> {
        use bun_sys::windows::advapi32;
        use core::ptr::null_mut;

        let mut wbuf = bun_paths::w_path_buffer_pool::get();
        let wpath = bun_paths::string_paths::to_kernel32_path(&mut wbuf, path);
        let mut owner = Owner {
            sid: null_mut(),
            descriptor: null_mut(),
        };
        // SAFETY: `wpath` is NUL-terminated, the two out-pointers are valid, and the others may be null.
        let status = unsafe {
            advapi32::GetNamedSecurityInfoW(
                wpath.as_ptr(),
                advapi32::SE_FILE_OBJECT,
                advapi32::OWNER_SECURITY_INFORMATION,
                &raw mut owner.sid,
                null_mut(),
                null_mut(),
                null_mut(),
                &raw mut owner.descriptor,
            )
        };
        (status == 0 && !owner.sid.is_null()).then_some(owner)
    }
}

#[cfg(windows)]
impl Drop for Owner {
    fn drop(&mut self) {
        // SAFETY: `descriptor` is null or what `GetNamedSecurityInfoW` allocated, and nothing else frees it.
        unsafe { bun_sys::windows::kernel32::LocalFree(self.descriptor) };
    }
}

#[cfg(windows)]
fn has_owner_of(path: &ZStr, dir: &[u8], cwd: &[u8]) -> bool {
    use bun_sys::windows::advapi32::EqualSid;

    // `Owner::of` follows a link, and another user can make one to a file of the owner of `cwd`.
    if bun_sys::get_file_attributes(path).is_none_or(|it| it.is_reparse_point) {
        return false;
    }
    let (Some(file), Some(dir), Some(cwd)) =
        (Owner::of(path.as_bytes()), Owner::of(dir), Owner::of(cwd))
    else {
        return false;
    };
    // SAFETY: all are valid SIDs in descriptors that `file`, `dir` and `cwd` keep alive.
    unsafe { EqualSid(file.sid, cwd.sid) != 0 && EqualSid(dir.sid, cwd.sid) != 0 }
}

#[cfg(not(any(unix, windows)))]
fn has_owner_of(_: &ZStr, _: &[u8], _: &[u8]) -> bool {
    false
}

/// The nearest bunfig.toml above `cwd` that is in the same project: not above the nearest package.json, or the workspace root that lists it.
fn find_config_above<'buf>(cwd: &[u8], buf: &'buf mut PathBuffer) -> Option<&'buf ZStr> {
    // A dependency's scripts and a compiled executable are not part of the project they run in.
    if StandaloneModuleGraph::get_ref().is_some()
        || bun_paths::string_paths::path_contains_node_modules_folder(cwd)
    {
        return None;
    }
    let mut config_dir = cwd;
    loop {
        config_dir = bun_core::dirname(config_dir)?;
        let path = join_config_path(config_dir, b"bunfig.toml", buf)?;
        if has_owner_of(path, config_dir, cwd) {
            break;
        }
    }
    let mut root = cwd;
    while !bun_sys::exists_z(join_config_path(root, b"package.json", buf)?) {
        root = bun_core::dirname(root)?;
    }
    if config_dir.len() < root.len() {
        let package_dir = root;
        loop {
            root = bun_core::dirname(root)?;
            if let Some(is_listed) = lists_workspace(root, package_dir, buf) {
                if !is_listed || config_dir.len() < root.len() {
                    return None;
                }
                break;
            }
        }
    }
    join_config_path(config_dir, b"bunfig.toml", buf)
}

/// The user's own file, once.
pub fn load_global_bunfig(cmd: CommandTag, ctx: Context<'_>) {
    if !cmd.read_global_config() || ctx.has_loaded_global_config {
        return;
    }
    ctx.has_loaded_global_config = true;

    let mut config_buf = bun_paths::path_buffer_pool::get();
    if let Some(path) = get_home_config_path(&mut config_buf) {
        if let Err(err) = load_bunfig(cmd, ConfigFile::User, path, ctx, None, Counts::Everything) {
            report_bunfig_load_failure(cmd, ctx.log, err);
        }
    }
}

/// Whether `[install.security] scanner` is set in the user's global `.bunfig.toml` or in any
/// `bunfig.toml` from `dir` up to `root`. `Err` holds the path of a config file that doesn't parse.
pub fn has_security_scanner(dir: &[u8], root: &[u8]) -> Result<bool, Box<[u8]>> {
    let mut config_buf = bun_paths::path_buffer_pool::get();
    if let Some(path) = get_home_config_path(&mut config_buf)
        && file_has_security_scanner(path)?
    {
        return Ok(true);
    }
    let mut next_dir = Some(bun_paths::string_paths::without_trailing_slash_windows_path(dir));
    while let Some(dir) = next_dir {
        if let Some(path) = join_config_path(dir, b"bunfig.toml", &mut config_buf)
            && file_has_security_scanner(path)?
        {
            return Ok(true);
        }
        // Stop at `root`. If `dir` is outside `root`, only `dir` itself is read, not its parents.
        next_dir = match resolve_path::is_parent_or_equal(root, dir) {
            resolve_path::ParentEqual::Parent => bun_core::dirname(dir),
            _ => None,
        };
    }
    Ok(false)
}

fn file_has_security_scanner(config_path: &ZStr) -> Result<bool, Box<[u8]>> {
    let path = config_path.as_bytes();
    match bun_ast::to_source(config_path, bun_ast::ToSourceOptions { convert_bom: true }) {
        Ok(source) => Bunfig::has_security_scanner(&source).map_err(|_| path.into()),
        Err(_) => Ok(false),
    }
}

/// Reads the `[install]` section of the `bunfig.toml` in `dir`, the way `bun install` run in `dir`
/// would. `Err` holds the path of the file if it doesn't parse.
pub fn load_install_section(dir: &[u8]) -> Result<Option<Box<api::BunInstall>>, Box<[u8]>> {
    let mut config_buf = bun_paths::path_buffer_pool::get();
    match join_config_path(dir, b"bunfig.toml", &mut config_buf) {
        Some(config_path) => read_install_section(config_path),
        None => Ok(None),
    }
}

/// Like [`load_install_section`], but reads the user's global `.bunfig.toml`.
pub fn load_user_install_section() -> Result<Option<Box<api::BunInstall>>, Box<[u8]>> {
    let mut config_buf = bun_paths::path_buffer_pool::get();
    match get_home_config_path(&mut config_buf) {
        Some(config_path) => read_install_section(config_path),
        None => Ok(None),
    }
}

fn read_install_section(config_path: &ZStr) -> Result<Option<Box<api::BunInstall>>, Box<[u8]>> {
    let path = config_path.as_bytes();
    let source =
        match bun_ast::to_source(config_path, bun_ast::ToSourceOptions { convert_bom: true }) {
            Ok(source) => source,
            Err(_) => return Ok(None),
        };
    Bunfig::parse_install_section(&source).map_err(|_| path.into())
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
    let file = if auto_loaded {
        ConfigFile::Project
    } else {
        ConfigFile::Named
    };
    let looks_above = matches!(
        cmd,
        CommandTag::AutoCommand
            | CommandTag::RunCommand
            | CommandTag::TestCommand
            | CommandTag::BuildCommand
    );
    let mut buf = bun_paths::path_buffer_pool::get();
    if auto_loaded
        && looks_above
        && !bun_sys::exists_z(config_path)
        && let Some(cwd) = ctx.args.absolute_working_dir.as_deref()
        && let Some(above) = find_config_above(cwd, &mut buf)
    {
        let file = ConfigFile::ProjectAbove;
        return load_bunfig(cmd, file, above, ctx, tool, Counts::Everything);
    }
    load_bunfig(cmd, file, config_path, ctx, tool, Counts::Everything)
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

    load_global_bunfig(cmd, ctx);

    let mut config_buf = bun_paths::path_buffer_pool::get();
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
        if let Err(err) = load_bunfig(
            cmd,
            ConfigFile::Project,
            path,
            &mut *ctx,
            Some(read),
            counts,
        ) {
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
