use bun_collections::VecExt;
use std::cell::Cell;
use std::io::Write as _;

use crate::api::bun_process::Status;
use crate::api::bun_process::sync as spawn_sync;
use bun_clap as clap;
use bun_core::Progress::{Node as ProgressNode, Progress};
use bun_core::{Global, Output, pretty_error, pretty_errorln};
use bun_core::{MutableString, strings};
use bun_dotenv as DotEnv;
use bun_http as HTTP;
use bun_js_printer as JSPrinter;
use bun_libarchive::{Archiver, archiver};
use bun_parsers::json as JSON;
use bun_paths::{OSPathSlice, PathBuffer};
use bun_resolver::fs;
use bun_sys::FdDirExt as _;
#[cfg(not(windows))]
use bun_sys::copy_file as CopyFile;
use bun_url::URL;
use bun_which::which;
use bun_zlib as Zlib;

use crate::Command;
use crate::cli::run_command::RunCommand;

#[path = "create/SourceFileProjectGenerator.rs"]
pub(crate) mod SourceFileProjectGenerator;

// Single-thread CLI scratch buffer, used by the git lookup and by `--open`.
static BUN_PATH_BUF: bun_core::RacyCell<PathBuffer> = bun_core::RacyCell::new(PathBuffer::ZEROED);

#[cfg(not(windows))]
const SKIP_DIRS: &[&OSPathSlice] = &[b"node_modules", b".git"];
// `.git` as a file points a worktree or submodule at its repository.
#[cfg(not(windows))]
const SKIP_FILES: &[&OSPathSlice] = &[
    b"package-lock.json",
    b"yarn.lock",
    b"pnpm-lock.yaml",
    b".git",
];
#[cfg(windows)]
const SKIP_DIRS: &[&OSPathSlice] = &[bun_core::w!("node_modules"), bun_core::w!(".git")];
#[cfg(windows)]
const SKIP_FILES: &[&OSPathSlice] = &[
    bun_core::w!("package-lock.json"),
    bun_core::w!("yarn.lock"),
    bun_core::w!("pnpm-lock.yaml"),
    bun_core::w!(".git"),
];

const NEVER_CONFLICT: &[&[u8]] = &[b"README.md", b"gitignore", b".git/"];

/// Runs one `bun-create` task like a package.json script. A non-zero exit ends the process.
fn exec_task(
    ctx: Command::Context<'_>,
    task: &[u8],
    name: &[u8],
    cwd: &[u8],
    env_loader: &mut DotEnv::Loader,
) -> crate::Result<()> {
    let task = strings::trim(task, b" \n\r\t");
    if task.is_empty() {
        return Ok(());
    }

    let use_system_shell = ctx.debug.use_system_shell;
    Output::flush();
    let _unbuffered = Output::disable_buffering_scope();
    RunCommand::run_package_script_foreground(
        ctx,
        task,
        name,
        cwd,
        env_loader,
        &[],
        false,
        use_system_shell,
    )
}

// Two buffers, used in turn: printing over the one on display would garble it.
struct ProgressBuf;

impl ProgressBuf {
    thread_local! {
        static BUFS: core::cell::RefCell<[[u8; 1024]; 2]> = const { core::cell::RefCell::new([[0u8; 1024]; 2]) };
        static BUF_INDEX: Cell<usize> = const { Cell::new(0) };
    }

    fn print(args: core::fmt::Arguments<'_>) -> crate::Result<&'static [u8]> {
        Self::BUF_INDEX.with(|i| i.set(i.get() + 1));
        let idx = Self::BUF_INDEX.with(|i| i.get()) % 2;
        Self::BUFS.with_borrow_mut(|bufs| {
            let buf = &mut bufs[idx];
            let mut cursor: &mut [u8] = &mut buf[..];
            let cap = cursor.len();
            write!(&mut cursor, "{}", args)
                .map_err(|_| crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))?;
            let written = cap - cursor.len();
            // SAFETY: a thread-local static buffer; it is printed or copied before it is reused.
            let out: &'static [u8] = unsafe { bun_ptr::detach_lifetime(&buf[..written]) };
            Ok(out)
        })
    }

    /// `<tag>` sequences inside interpolated arguments are rewritten too.
    fn pretty(args: core::fmt::Arguments<'_>) -> crate::Result<&'static [u8]> {
        if Output::enable_ansi_colors_stdout() {
            ProgressBuf::print(format_args!("{}", Output::pretty_fmt::<true>(args)))
        } else {
            ProgressBuf::print(format_args!("{}", Output::pretty_fmt::<false>(args)))
        }
    }
}

/// A raw pointer, so that it does not hold an exclusive borrow for the whole body of `exec`.
struct RefreshOnDrop(*mut Progress);

impl Drop for RefreshOnDrop {
    fn drop(&mut self) {
        // SAFETY: `exec` declares its `Progress` before this guard, so it is still alive.
        unsafe { (*self.0).refresh() };
    }
}

struct CreateOptions {
    skip_install: bool,
    ignore_scripts: bool,
    overwrite: bool,
    skip_git: bool,
    skip_package_json: bool,
    positionals: Vec<&'static [u8]>,
    verbose: bool,
    open: bool,
}

impl CreateOptions {
    fn parse() -> crate::Result<CreateOptions> {
        static PARAMS: &[clap::Param<clap::Help>] = &[
            clap::param!("-h, --help                     Print this menu"),
            clap::param!("--force                        Overwrite existing files"),
            clap::param!("--no-install                   Don't install node_modules"),
            clap::param!("--ignore-scripts               Don't run tasks or lifecycle scripts"),
            clap::param!("--no-git                      Don't create a git repository"),
            clap::param!("--verbose                      Too many logs"),
            clap::param!("--no-package-json              Disable package.json transforms"),
            clap::param!("--open                         On finish, start bun & open in-browser"),
            clap::param!("<POS>...                       "),
        ];
        let mut diag = clap::Diagnostic::default();

        let args = match clap::parse::<clap::Help>(
            PARAMS,
            clap::ParseOptions {
                diagnostic: Some(&mut diag),
                ..Default::default()
            },
        ) {
            Ok(a) => a,
            Err(err) => {
                let _ = diag.report(Output::error_writer(), err);
                return Err(err.into());
            }
        };

        let mut positionals = args.positionals().to_vec();
        if !positionals.is_empty() && (positionals[0] == b"c" || positionals[0] == b"create") {
            positionals.remove(0);
        }

        Ok(CreateOptions {
            positionals,
            skip_package_json: args.flag(b"--no-package-json"),
            verbose: args.flag(b"--verbose") || Output::is_verbose(),
            open: args.flag(b"--open"),
            skip_install: args.flag(b"--no-install"),
            ignore_scripts: args.flag(b"--ignore-scripts"),
            skip_git: args.flag(b"--no-git"),
            overwrite: args.flag(b"--force"),
        })
    }
}

const BUN_CREATE_DIR: &[u8] = b".bun-create";
// Single-thread CLI scratch buffer.
static HOME_DIR_BUF: bun_core::RacyCell<PathBuffer> = bun_core::RacyCell::new(PathBuffer::ZEROED);

/// `name`, joined onto a template dir by the `Loose` join (`/` and `\` fold), stays inside it.
fn names_path_inside_dir(name: &[u8]) -> bool {
    let mut depth: usize = 0;
    for segment in strings::split_any(name, b"/\\") {
        match segment {
            b"" | b"." => {}
            b".." if depth == 0 => return false,
            b".." => depth -= 1,
            _ => depth += 1,
        }
    }
    depth > 0
}

/// Such a copy would truncate its source or walk into its own output.
fn destination_is_inside_template(
    template_dir: &bun_sys::Dir,
    abs_template_path: &[u8],
    destination: &[u8],
) -> bool {
    use bun_paths::resolve_path::{ParentEqual, is_parent_or_equal};
    if is_parent_or_equal(abs_template_path, destination) != ParentEqual::Unrelated {
        return true;
    }

    let mut template_buf = bun_paths::path_buffer_pool::get();
    let mut existing_buf = bun_paths::path_buffer_pool::get();
    let Ok(template_real) = template_dir.get_fd_path(&mut template_buf) else {
        return false;
    };
    // The destination may not exist yet: its deepest existing directory decides.
    let mut path = destination;
    loop {
        if let Ok(existing) = bun_sys::Dir::open(path) {
            return existing.get_fd_path(&mut existing_buf).is_ok_and(|real| {
                is_parent_or_equal(template_real, real) != ParentEqual::Unrelated
            });
        }
        match bun_paths::dirname(path) {
            Some(parent) if parent.len() < path.len() => path = parent,
            _ => return false,
        }
    }
}

/// A component of `path` is a link in `destination`. `overwrite` removes the link instead.
fn leaves_destination(destination: &[u8], path: &[u8], overwrite: bool) -> bun_sys::Result<bool> {
    use bun_sys::FileKind;
    let mut buf = bun_paths::path_buffer_pool::get();
    let mut end = 0;
    while end < path.len() {
        end = strings::index_of_char_usize(&path[end + 1..], bun_paths::SEP)
            .map_or(path.len(), |i| end + 1 + i);
        let Some(component) = bun_paths::resolve_path::join_abs_string_buf_z_checked::<
            bun_paths::platform::Auto,
        >(destination, &mut buf[..], &[&path[..end]]) else {
            return Err(bun_sys::Error::from_code(
                bun_sys::E::ENAMETOOLONG,
                bun_sys::Tag::lstat,
            ));
        };
        match bun_sys::lstat(component) {
            Ok(stat) => match bun_sys::kind_from_mode(stat.st_mode as _) {
                FileKind::Directory => {}
                FileKind::SymLink if overwrite => {
                    let removed = bun_sys::unlink(component);
                    #[cfg(windows)]
                    let removed = removed.or_else(|_| bun_sys::rmdir(component));
                    return removed.map(|()| false);
                }
                kind => return Ok(kind == FileKind::SymLink),
            },
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => return Ok(false),
            Err(err) => return Err(err),
        }
    }
    Ok(false)
}

/// The template's files that have something of `destination` in their way, relative to it.
fn local_template_conflicts(
    abs_template_path: &[u8],
    destination: &[u8],
    overwrite: bool,
) -> crate::Result<Vec<Vec<u8>>> {
    let Ok(existing) = bun_sys::Dir::open(destination) else {
        return Ok(Vec::new());
    };
    let mut walker = bun_sys::walker_skippable::walk_owned(
        bun_sys::Dir::open(abs_template_path)?,
        SKIP_FILES,
        SKIP_DIRS,
    )?;
    let mut conflicts = Vec::new();
    while let Some(entry) = walker.next()? {
        let is_file = entry.kind == bun_sys::FileKind::File;
        // On Windows the copy makes the template's directories too, even empty ones.
        if !is_file && !(cfg!(windows) && entry.kind == bun_sys::FileKind::Directory) {
            continue;
        }
        #[cfg(windows)]
        let path: Vec<u8> = strings::to_utf8_alloc(entry.path);
        #[cfg(not(windows))]
        let path: Vec<u8> = entry.path.as_bytes().to_vec();
        if leaves_destination(destination, &path, overwrite)?
            || (is_file
                && !overwrite
                && match existing.open_file(&path, bun_sys::O::WRONLY, 0) {
                    // Windows opens a directory for writing.
                    Ok(_) => {
                        !NEVER_CONFLICT.contains(&path.as_slice())
                            || (cfg!(windows) && existing.open_at(&path).is_ok())
                    }
                    Err(err) => matches!(err.get_errno(), bun_sys::E::EISDIR | bun_sys::E::ENOTDIR),
                })
        {
            conflicts.push(path);
        }
    }
    Ok(conflicts)
}

fn exit_with_conflicts<'a>(destination: &[u8], paths: impl Iterator<Item = &'a [u8]>) -> ! {
    // Thank you create-react-app for this copy (and idea)
    pretty_errorln!(
        "<r>\n<red>error<r><d>: <r>The directory <b><blue>{}<r>/ contains files that could conflict:\n\n",
        bstr::BStr::new(bun_paths::basename(destination)),
    );
    for path in paths {
        if strings::ends_with(path, bun_paths::SEP_STR.as_bytes()) {
            pretty_error!(
                "<r>  <blue>{}<r>",
                bun_core::fmt::escape_control_chars(&path[0..path.len().max(1) - 1]),
            );
            pretty_errorln!("{}", bun_paths::SEP_STR);
        } else {
            pretty_errorln!("<r>  {}", bun_core::fmt::escape_control_chars(path));
        }
    }

    pretty_errorln!("<r>\n<d>To overwrite them, use --force<r>");
    Global::exit(1);
}

pub(crate) struct CreateCommand;

impl CreateCommand {
    #[cold]
    pub(crate) fn exec(
        ctx: Command::Context<'_>,
        example_tag: ExampleTag,
        template: &[u8],
    ) -> crate::Result<()> {
        Global::configure_allocator(Global::AllocatorConfiguration {
            long_running: false,
            ..Default::default()
        });
        HTTP::http_thread::init(&Default::default());

        let mut create_options = CreateOptions::parse()?;
        let positionals = &create_options.positionals;

        if positionals.is_empty() {
            return CreateListExamplesCommand::exec(&ctx);
        }

        // SAFETY: `fs::FileSystem::init` returns a process-global singleton pointer.
        let filesystem: &mut fs::FileSystem = unsafe { &mut *fs::FileSystem::init(None)? };
        // Process-lifetime: every mini event loop (the tasks', a Windows spawn's) keeps a pointer to it.
        let env_loader: &'static mut DotEnv::Loader = Box::leak(Box::new(DotEnv::Loader::init()));
        DotEnv::set_instance(std::ptr::from_mut::<DotEnv::Loader>(env_loader));

        env_loader.load_process()?;

        let dirname: &[u8] = if positionals.len() == 1 {
            bun_paths::basename(template)
        } else {
            positionals[1]
        };

        let destination =
            filesystem
                .dirname_store
                .append_slice(bun_paths::resolve_path::join_abs::<
                    bun_paths::platform::Loose,
                >(filesystem.top_level_dir, dirname))?;

        let mut progress = Progress {
            supports_ansi_escape_codes: Output::enable_ansi_colors_stderr(),
            ..Default::default()
        };
        let verb = if example_tag == ExampleTag::JslikeFile {
            "Analyzing"
        } else {
            "Loading"
        };
        let node: *mut ProgressNode = progress.start(
            ProgressBuf::print(format_args!("{} {}", verb, bstr::BStr::new(template)))?,
            0,
        );
        // SAFETY: `node` is `&mut progress.root`; both live for all of `exec`, and are used independently.
        let node: &mut ProgressNode = unsafe { &mut *node };

        // alacritty is fast
        if env_loader.map.get(b"ALACRITTY_LOG").is_some() {
            progress.refresh_rate_ns = (bun_core::time::NS_PER_MS * 8) as u64;
        }

        let _refresh_on_exit = RefreshOnDrop(&raw mut progress);

        let mut package_json_contents: MutableString = MutableString::default();
        let mut package_json_file: Option<bun_sys::File> = None;

        // What the destination already holds is the user's, not the template's.
        let (had_gitignore, had_dot_gitignore, had_npmignore, had_git) =
            match bun_sys::Dir::open(destination) {
                Ok(dir) => (
                    bun_sys::exists_at(&dir, bun_core::zstr!("gitignore")),
                    bun_sys::exists_at(&dir, bun_core::zstr!(".gitignore")),
                    bun_sys::exists_at(&dir, bun_core::zstr!(".npmignore")),
                    bun_sys::exists_at_type(dir.fd(), bun_core::zstr!(".git")).is_ok(),
                ),
                Err(_) => (false, false, false, false),
            };
        let mut template_has_dot_gitignore = false;

        if example_tag != ExampleTag::LocalFolder && create_options.verbose {
            pretty_errorln!("Downloading as {}\n", <&'static str>::from(example_tag),);
        }

        match example_tag {
            ExampleTag::JslikeFile => {
                return run_on_entry_point(ctx, create_options.overwrite, template, node);
            }
            ExampleTag::GithubRepository | ExampleTag::Official => {
                let tarball_bytes: MutableString = match example_tag {
                    ExampleTag::Official => {
                        match Example::fetch(&ctx, env_loader, template, &mut progress, node) {
                            Ok(b) => b,
                            Err(err) => {
                                node.end();
                                progress.refresh();

                                if !matches!(
                                    err,
                                    crate::Error::HTTPForbidden | crate::Error::ExampleNotFound
                                ) {
                                    pretty_errorln!("\n\n");
                                    return Err(err);
                                }
                                pretty_error!(
                                    "\n<r><red>error:<r> <b>\"{}\"<r> was not found. Here are templates you can use:\n\n",
                                    bstr::BStr::new(template),
                                );
                                Output::flush();

                                let examples = Example::fetch_all_local_and_remote(
                                    &ctx, None, env_loader, filesystem,
                                )?;
                                Example::print(&examples, Some(dirname));
                                Global::exit(1);
                            }
                        }
                    }
                    ExampleTag::GithubRepository => {
                        match Example::fetch_from_github(env_loader, template, &mut progress, node)
                        {
                            Ok(b) => b,
                            Err(err) => {
                                node.end();
                                progress.refresh();

                                if matches!(
                                    err,
                                    crate::Error::HTTPForbidden | crate::Error::HTTPTooManyRequests
                                ) {
                                    pretty_error!(
                                        "\n<r><red>error:<r> GitHub returned {}. This usually means GitHub is rate limiting your requests.\nTo fix this, either:<r>  <b>A) pass a <r><cyan>GITHUB_ACCESS_TOKEN<r> environment variable to bun<r>\n  <b>B)Wait a little and try again<r>\n",
                                        if matches!(err, crate::Error::HTTPForbidden) {
                                            "403"
                                        } else {
                                            "429"
                                        },
                                    );
                                } else if matches!(err, crate::Error::GitHubIsDown) {
                                    pretty_error!(
                                        "\n<r><red>error:<r> GitHub returned a server error while fetching the tarball for <b>\"{}\"<r>. GitHub may be temporarily unavailable; wait a moment and try again.\n",
                                        bstr::BStr::new(template),
                                    );
                                } else if matches!(err, crate::Error::GitHubRepositoryNotFound) {
                                    pretty_error!(
                                        "\n<r><red>error:<r> <b>\"{}\"<r> was not found on GitHub. Here are templates you can use:\n\n",
                                        bstr::BStr::new(template),
                                    );
                                    Output::flush();

                                    let examples = Example::fetch_all_local_and_remote(
                                        &ctx, None, env_loader, filesystem,
                                    )?;
                                    Example::print(&examples, Some(dirname));
                                } else {
                                    pretty_errorln!("\n\n");
                                    return Err(err);
                                }
                                Global::crash();
                            }
                        }
                    }
                    _ => unreachable!(),
                };

                node.name = ProgressBuf::print(format_args!(
                    "Decompressing {}",
                    bstr::BStr::new(template)
                ))?;
                node.set_completed_items(0);
                node.set_estimated_total_items(0);

                progress.refresh();

                let mut tarball_buf_list: Vec<u8> = Vec::with_capacity(16384);
                let mut gunzip = Zlib::ZlibReaderArrayList::init(
                    tarball_bytes.list.as_slice(),
                    &mut tarball_buf_list,
                )?;
                gunzip.read_all(true)?;
                drop(gunzip);

                node.name =
                    ProgressBuf::print(format_args!("Extracting {}", bstr::BStr::new(template)))?;
                node.set_completed_items(0);
                node.set_estimated_total_items(0);

                progress.refresh();

                let package_json_lit: &OSPathSlice = bun_paths::os_path_literal!("package.json");
                let pluckers: Vec<archiver::Plucker> = if !create_options.skip_package_json {
                    vec![archiver::Plucker::init(package_json_lit, 2048)?]
                } else {
                    Vec::new()
                };

                let mut archive_context = archiver::Context {
                    pluckers,
                    overwrite_list: bun_collections::StringArrayHashMap::<()>::default(),
                };

                {
                    // The overwrite list boxes its keys itself: a view of the path is enough.
                    struct OverwriteListAppender {
                        buf: Vec<u8>,
                    }
                    impl bun_libarchive::ArchiveAppender for OverwriteListAppender {
                        fn append(&mut self, path: &[u8]) -> Result<&[u8], bun_libarchive::Error> {
                            self.buf.clear();
                            self.buf.extend_from_slice(path);
                            Ok(&self.buf)
                        }
                    }
                    Archiver::get_overwriting_file_list::<OverwriteListAppender, 1>(
                        &tarball_buf_list,
                        destination,
                        &mut archive_context,
                        &mut OverwriteListAppender { buf: Vec::new() },
                        &mut |path: &[u8]| {
                            template_has_dot_gitignore |= path == b".gitignore";
                            leaves_destination(destination, path, create_options.overwrite)
                        },
                    )?;

                    for never_conflict_path in NEVER_CONFLICT {
                        if !leaves_destination(destination, never_conflict_path, false)? {
                            let _ = archive_context
                                .overwrite_list
                                .swap_remove(never_conflict_path);
                        }
                    }

                    if !create_options.overwrite && archive_context.overwrite_list.count() > 0 {
                        node.end();
                        progress.refresh();
                        exit_with_conflicts(
                            destination,
                            archive_context.overwrite_list.keys().iter().map(|k| &**k),
                        );
                    }
                }

                let _ = Archiver::extract_to_disk(
                    &tarball_buf_list,
                    destination,
                    Some(&mut archive_context),
                    &mut (),
                    archiver::ExtractOptions {
                        depth_to_skip: 1,
                        ..Default::default()
                    },
                )?;

                if !create_options.skip_package_json {
                    let plucker = &archive_context.pluckers[0];

                    if plucker.found && plucker.fd.is_valid() {
                        node.name = b"Updating package.json";
                        progress.refresh();

                        package_json_contents = plucker.contents.clone()?;
                        package_json_file = Some(bun_sys::File::from_fd(plucker.fd));
                    }
                }
            }
            ExampleTag::LocalFolder => {
                node.name = b"Copying files";
                progress.refresh();

                let abs_template_path = crate::cli::cli_dupe(filesystem.abs(&[template]));
                let template_dir = match bun_sys::Dir::open(abs_template_path) {
                    Ok(d) => d,
                    Err(err) => {
                        node.end();
                        progress.refresh();

                        pretty_errorln!(
                            "<r><red>{}<r>: opening dir {}",
                            bstr::BStr::new(err.name()),
                            bstr::BStr::new(template),
                        );
                        Global::exit(1);
                    }
                };

                if destination_is_inside_template(&template_dir, abs_template_path, destination) {
                    node.end();
                    progress.refresh();

                    pretty_errorln!(
                        "<r><red>error<r>: destination <b>{}<r> is inside template <b>{}<r>",
                        bstr::BStr::new(destination),
                        bstr::BStr::new(abs_template_path),
                    );
                    Global::exit(1);
                }

                let conflicts = local_template_conflicts(
                    abs_template_path,
                    destination,
                    create_options.overwrite,
                )?;
                if !conflicts.is_empty() {
                    node.end();
                    progress.refresh();
                    exit_with_conflicts(destination, conflicts.iter().map(Vec::as_slice));
                }

                let destination_dir = match bun_sys::Fd::cwd().make_open_path(destination) {
                    Ok(d) => d,
                    Err(err) => {
                        node.end();
                        progress.refresh();

                        pretty_errorln!(
                            "<r><red>{}<r>: creating dir {}",
                            bstr::BStr::new(err.name()),
                            bstr::BStr::new(destination),
                        );
                        Global::exit(1);
                    }
                };

                #[cfg(windows)]
                let mut destination_buf = bun_paths::w_path_buffer_pool::get();
                #[cfg(windows)]
                let destination_len = strings::convert_utf8_to_utf16_in_buffer(
                    destination_buf.as_mut_slice(),
                    strings::without_trailing_slash(destination),
                )
                .len();
                #[cfg(windows)]
                {
                    destination_buf[destination_len] = bun_paths::SEP as u16;
                }

                #[cfg(windows)]
                let mut template_path_buf = bun_paths::w_path_buffer_pool::get();
                #[cfg(windows)]
                let template_path_len = strings::convert_utf8_to_utf16_in_buffer(
                    template_path_buf.as_mut_slice(),
                    strings::without_trailing_slash(abs_template_path),
                )
                .len();
                #[cfg(windows)]
                {
                    template_path_buf[template_path_len] = bun_paths::SEP as u16;
                }

                let mut walker_ = bun_sys::walker_skippable::walk(
                    bun_sys::Fd::from_std_dir(&template_dir),
                    SKIP_FILES,
                    SKIP_DIRS,
                )?;

                file_copier_copy(
                    &destination_dir,
                    &mut walker_,
                    node,
                    &mut progress,
                    #[cfg(windows)]
                    (destination_len + 1),
                    #[cfg(windows)]
                    &mut destination_buf,
                    #[cfg(windows)]
                    (template_path_len + 1),
                    #[cfg(windows)]
                    &mut template_path_buf,
                )?;

                template_has_dot_gitignore =
                    bun_sys::exists_at(&template_dir, bun_core::zstr!(".gitignore"));
                if bun_sys::exists_at(&template_dir, bun_core::zstr!("package.json")) {
                    package_json_file = destination_dir
                        .open_file(b"package.json", bun_sys::O::RDWR, 0)
                        .ok();
                }

                'read_package_json: {
                    if let Some(ref pkg) = package_json_file {
                        let size: u64 = 'brk: {
                            #[cfg(windows)]
                            {
                                break 'brk pkg.get_end_pos()? as u64;
                            }
                            #[cfg(not(windows))]
                            {
                                let stat = match pkg.stat() {
                                    Ok(s) => s,
                                    Err(err) => {
                                        node.end();
                                        progress.refresh();

                                        package_json_file = None;
                                        pretty_errorln!(
                                            "Error reading package.json: <r><red>{}",
                                            bstr::BStr::new(err.name()),
                                        );
                                        break 'read_package_json;
                                    }
                                };

                                if bun_sys::kind_from_mode(stat.st_mode as _)
                                    != bun_sys::FileKind::File
                                    || stat.st_size == 0
                                {
                                    package_json_file = None;
                                    node.end();
                                    progress.refresh();
                                    break 'read_package_json;
                                }

                                break 'brk stat.st_size as u64;
                            }
                        };

                        package_json_contents =
                            MutableString::init(usize::try_from(size).expect("int cast"))?;
                        // Set len to capacity so the buffer is readable.
                        let cap = package_json_contents.list.capacity();
                        package_json_contents.list.resize(cap, 0);

                        #[cfg(windows)]
                        let prev_file_pos = pkg.get_pos()?;

                        if let Err(err) =
                            pkg.pread_all(package_json_contents.list.as_mut_slice(), 0)
                        {
                            package_json_file = None;
                            node.end();
                            progress.refresh();

                            pretty_errorln!(
                                "Error reading package.json: <r><red>{}",
                                bstr::BStr::new(err.name()),
                            );
                            break 'read_package_json;
                        }
                        #[cfg(windows)]
                        pkg.seek_to(prev_file_pos)?;
                        // The printer doesn't truncate, so we must do so manually
                        let _ = bun_sys::ftruncate(pkg.handle(), 0);

                        bun_ast::initialize_store();
                    }
                }
            }
        }

        node.end();
        progress.refresh();

        let mut preinstall_tasks: Vec<&[u8]> = Vec::new();
        let mut postinstall_tasks: Vec<&[u8]> = Vec::new();
        let mut has_dependencies: bool = false;
        let path_env: Vec<u8> = env_loader.map.get(b"PATH").unwrap_or(b"").to_vec();
        let path_env: &[u8] = &path_env;

        {
            let parent_dir = bun_sys::Dir::open(destination)?;
            if !had_gitignore {
                // The template's `gitignore` does not replace a `.gitignore` that the template also
                // ships. It only replaces the user's existing `.gitignore` with `--force`.
                let replaces_the_users =
                    create_options.overwrite && had_dot_gitignore && !template_has_dot_gitignore;
                if !replaces_the_users
                    && matches!(
                        bun_sys::exists_at_type(parent_dir.fd(), bun_core::zstr!(".gitignore")),
                        Ok(bun_sys::ExistsAtType::File)
                    )
                {
                    let _ = bun_sys::unlinkat(&parent_dir, bun_core::zstr!("gitignore"));
                } else if let Err(err) = bun_sys::renameat(
                    &parent_dir,
                    bun_core::zstr!("gitignore"),
                    &parent_dir,
                    bun_core::zstr!(".gitignore"),
                ) && err.get_errno() != bun_sys::E::ENOENT
                {
                    pretty_errorln!(
                        "<r><red>{}<r>: renaming gitignore to .gitignore",
                        bstr::BStr::new(err.name()),
                    );
                    Global::exit(1);
                }
            }
            if !had_npmignore {
                let _ = bun_sys::unlinkat(&parent_dir, bun_core::zstr!(".npmignore"));
            }
        }

        let mut start_command: &[u8] = b"bun dev";

        'process_package_json: {
            if create_options.skip_package_json {
                package_json_file = None;
            }

            if let Some(package_json_file) = &package_json_file {
                bun_ast::initialize_store();

                let source = bun_ast::Source::init_path_string(
                    b"package.json",
                    package_json_contents.list.as_slice(),
                );

                // SAFETY: single-threaded CLI dispatch; no other borrow of `Cli::LOG_` is live in this scope.
                let log: &mut bun_ast::Log = unsafe { ctx.log_mut() };
                let bump: &'static bun_alloc::Arena = crate::cli::cli_arena();
                let parsed = match JSON::parse_package_json_utf8_with_opts(
                    JSON::JSONOptions {
                        guess_indentation: true,
                        ..JSON::PACKAGE_JSON_OPTS
                    },
                    &source,
                    log,
                    bump,
                ) {
                    Ok(r) => r,
                    Err(_) => {
                        if log.errors > 0 {
                            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                        }
                        break 'process_package_json;
                    }
                };
                let indentation = parsed.indentation;
                let mut package_json_expr = parsed.root;

                if package_json_expr.data.e_object().is_none() {
                    break 'process_package_json;
                }

                if log.errors > 0 {
                    let _ = log.print(std::ptr::from_mut(Output::error_writer()));

                    break 'process_package_json;
                }

                if let Some(name_expr) = package_json_expr.as_property(b"name")
                    && let Some(mut s) = name_expr.expr.data.e_string()
                {
                    // `destination` is interned in the process-global DirnameStore.
                    s.data = bun_ast::StoreStr::new(bun_paths::basename(destination));
                }

                for key in [b"devDependencies".as_slice(), b"dependencies".as_slice()] {
                    if let Some(q) = package_json_expr.as_property(key)
                        && let Some(object) = q.expr.data.e_object()
                        && object.properties.len_u32() > 0
                    {
                        has_dependencies = true;
                    }
                }

                package_json_expr
                    .data
                    .e_object_mut()
                    .expect("infallible: variant checked")
                    .is_single_line = false;

                {
                    use bun_ast::ExprData as LExprData;
                    let mut i: usize = 0;
                    let mut property_i: usize = 0;
                    let props = &mut package_json_expr
                        .data
                        .e_object_mut()
                        .expect("infallible: variant checked")
                        .properties;
                    while i < props.len_u32() as usize {
                        let key_expr = props.slice()[i].key.unwrap();
                        let key = key_expr
                            .as_utf8_string_literal()
                            .expect("infallible: is_string checked");

                        // A copy of the `StoreRef`: mutating through it mutates the same arena E::Object.
                        if key == b"scripts"
                            && let Some(mut scripts_obj) =
                                props.slice()[i].value.unwrap().data.e_object()
                        {
                            let scripts_properties = scripts_obj.properties.slice_mut();
                            let mut script_property_out_i: usize = 0;

                            // Starting the app with "react-scripts start" or "next dev" won't make sense.
                            for script_property_i in 0..scripts_properties.len() {
                                if let Some(script_value) =
                                    scripts_properties[script_property_i].value
                                    && let Some(script_value) = script_value.data.e_string()
                                {
                                    let script = script_value.data.slice();

                                    if strings::contains(script, b"react-scripts start")
                                        || strings::contains(script, b"next dev")
                                        || strings::contains(script, b"react-scripts eject")
                                    {
                                        if create_options.verbose {
                                            bun_core::pretty_errorln!(
                                                "<r><d>[package.json] Pruned unnecessary script: {}<r>",
                                                bun_core::fmt::escape_control_chars(script),
                                            );
                                        }
                                        continue;
                                    }

                                    if strings::contains(script, b"react-scripts build") {
                                        scripts_properties[script_property_i].value =
                                            Some(bun_ast::Expr::init(
                                                bun_ast::E::EString::init(
                                                    b"npx react-scripts build",
                                                ),
                                                bun_ast::Loc::EMPTY,
                                            ));
                                    }
                                }

                                scripts_properties.swap(script_property_out_i, script_property_i);
                                script_property_out_i += 1;
                            }

                            scripts_obj
                                .properties
                                .shrink_retaining_capacity(script_property_out_i);
                        }

                        if key != b"bun-create" {
                            props.slice_mut().swap(property_i, i);
                            property_i += 1;
                            i += 1;
                            continue;
                        }

                        let value = props.slice()[i].value.unwrap();
                        let arena_str = |s: &[u8]| -> &'static [u8] {
                            // SAFETY: `s` points into the JSON arena, which lives for the rest of `exec`.
                            unsafe { &*std::ptr::from_ref::<[u8]>(s) }
                        };
                        for (name, tasks) in [
                            (b"postinstall".as_slice(), &mut postinstall_tasks),
                            (b"preinstall".as_slice(), &mut preinstall_tasks),
                        ] {
                            match value.as_property(name).map(|property| property.expr.data) {
                                Some(LExprData::EString(single_task)) => {
                                    tasks.push(arena_str(single_task.data.slice()));
                                }
                                Some(LExprData::EArray(array)) => {
                                    for task in array.slice() {
                                        if let Some(task_entry) = task.as_utf8_string_literal() {
                                            tasks.push(arena_str(task_entry));
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }

                        if let Some(start) = value.as_property(b"start")
                            && let Some(start_str) = start.expr.as_utf8_string_literal()
                            && !start_str.is_empty()
                        {
                            start_command = arena_str(start_str);
                        }

                        i += 1;
                    }
                    props.shrink_retaining_capacity(property_i);
                }

                // A task that is the name of a package.json script runs that script.
                if let Some(scripts) = package_json_expr.as_property(b"scripts") {
                    for task in preinstall_tasks.iter_mut().chain(&mut postinstall_tasks) {
                        if scripts.expr.as_property(*task).is_some() {
                            *task = crate::cli::cli_dupe(&strings::concat(&[b"bun run ", *task]));
                        }
                    }
                }

                let mut buffer_writer = JSPrinter::BufferWriter::init();
                buffer_writer.append_newline = true;
                let mut package_json_writer = JSPrinter::BufferPrinter::init(buffer_writer);

                if let Err(err) = JSPrinter::print_json(
                    &mut package_json_writer,
                    package_json_expr,
                    &source,
                    JSPrinter::PrintJsonOptions {
                        mangled_props: None,
                        indent: indentation,
                        ..Default::default()
                    },
                ) {
                    bun_core::pretty_errorln!("package.json failed to write due to error {}", err,);
                    break 'process_package_json;
                }
                let written = package_json_writer.ctx.get_written();
                if let Err(err) = package_json_file.write_all(written).and_then(|()| {
                    bun_sys::ftruncate(package_json_file.handle, written.len() as i64)
                }) {
                    bun_core::pretty_errorln!(
                        "package.json failed to write due to error {}",
                        bstr::BStr::new(err.name()),
                    );
                }
            }
        }

        if create_options.verbose {
            bun_core::pretty_errorln!("Has dependencies? {}", has_dependencies as u8,);
        }

        // Settings that make `bun install` skip scripts in the current directory also apply to the
        // template's tasks and to the install in the new project.
        let ignore_scripts = create_options.ignore_scripts
            || (!create_options.skip_install
                && bun_install::package_manager::config_ignores_scripts(
                    ctx,
                    env_loader,
                    filesystem.top_level_dir,
                )?);

        // `--no-install` skips the tasks too. No dependencies skips only `bun install`.
        let run_tasks = !create_options.skip_install
            && !ignore_scripts
            && !(preinstall_tasks.is_empty() && postinstall_tasks.is_empty());
        create_options.skip_install = create_options.skip_install || !has_dependencies;

        // `git add` reads the destination, so git must exit before the tasks and the install.
        if !create_options.skip_git {
            create_options.skip_git = had_git
                || !GitHandler::run(destination, path_env, create_options.verbose).unwrap_or(false);
        }

        let bun_exe = if create_options.skip_install {
            None
        } else {
            Some(bun_core::self_exe_path()?)
        };

        if run_tasks {
            // `bun` in a task is this bun, as it is for the install below.
            let path = RunCommand::path_for_run(env_loader, b"", None, destination, true)?;
            env_loader.map.put(b"PATH", &path)?;
            env_loader
                .map
                .put(b"npm_package_name", bun_paths::basename(destination))?;

            for task in &preinstall_tasks {
                exec_task(ctx, task, b"preinstall", destination, env_loader)?;
            }
        }

        if let Some(bun_exe) = bun_exe {
            let start_time = bun_core::time::nano_timestamp();
            let install_args: &[&[u8]] = if ignore_scripts {
                &[bun_exe, b"install", b"--ignore-scripts"]
            } else {
                &[bun_exe, b"install"]
            };
            Output::flush();
            bun_core::pretty!("\n<r><d>$ <b><cyan>bun<r><d> install");
            if ignore_scripts {
                bun_core::pretty!(" --ignore-scripts");
            }
            bun_core::pretty!("<r>\n");
            Output::flush();

            let process = spawn_sync::spawn(&spawn_sync::Options {
                argv: install_args.iter().map(|s| Box::<[u8]>::from(*s)).collect(),
                envp: None,
                cwd: Box::from(destination),
                stderr: spawn_sync::SyncStdio::Inherit,
                stdout: spawn_sync::SyncStdio::Inherit,
                stdin: spawn_sync::SyncStdio::Inherit,
                // Default would zero `loop_` → UB.
                #[cfg(windows)]
                windows: spawn_sync::WindowsOptions {
                    loop_: bun_event_loop::EventLoopHandle::init_mini(
                        bun_event_loop::MiniEventLoop::init_global(None, None),
                    ),
                    ..Default::default()
                },
                ..Default::default()
            });

            Output::print_errorln("");
            Output::print_start_end(start_time, bun_core::time::nano_timestamp());
            bun_core::pretty_error!(" <r><d>bun install<r>\n");
            Output::flush();

            Output::print(format_args!("\n"));
            Output::flush();

            let status = process??.status;
            if !status.is_ok() {
                pretty_errorln!(
                    "<r><red>error<r><d>:<r> <b>bun install<r> failed in {} ({})\n<blue>note<r><d>:<r> template files were written. run <b>bun install<r> there once the error is fixed",
                    bun_core::fmt::quote(destination),
                    status,
                );
                Global::exit(match (status.signal(), &status) {
                    (Some(signal), _) => u32::from(signal.to_exit_code()),
                    (None, Status::Exited(exited)) => u32::from(exited.code),
                    _ => 1,
                });
            }
        }

        if run_tasks {
            for task in &postinstall_tasks {
                exec_task(ctx, task, b"postinstall", destination, env_loader)?;
            }
        }

        Output::print_error("\n");
        Output::print_start_end(ctx.start_time, bun_core::time::nano_timestamp());
        bun_core::pretty_errorln!(" <r><d>bun create {}<r>", bstr::BStr::new(template));

        Output::flush();

        bun_core::pretty!("\n<d>Come hang out in bun's Discord: https://bun.com/discord<r>\n",);

        if !create_options.skip_install {
            bun_core::pretty!("\n<r><d>-----<r>\n");
            Output::flush();
        }

        if !create_options.skip_git && !create_options.skip_install {
            bun_core::pretty!(
                "\n<d>A local git repository was created for you and dependencies were installed automatically.<r>\n",
            );
        } else if !create_options.skip_git {
            bun_core::pretty!("\n<d>A local git repository was created for you.<r>\n",);
        } else if !create_options.skip_install {
            bun_core::pretty!("\n<d>Dependencies were installed automatically.<r>\n",);
        }

        if example_tag == ExampleTag::GithubRepository {
            let mut display_name = template;

            if let Some(first_slash) = strings::index_of_char_usize(template, b'/')
                && let Some(second_slash) =
                    strings::index_of_char_usize(&template[first_slash + 1..], b'/')
            {
                display_name = &template[0..first_slash + 1 + second_slash];
            }

            bun_core::pretty!(
                "\n<b><green>Success!<r> <b>{}<r> loaded into <b>{}<r>\n",
                bstr::BStr::new(display_name),
                bstr::BStr::new(bun_paths::basename(destination)),
            );
        } else {
            bun_core::pretty!(
                "\n<b>Created <green>{}<r> project successfully\n",
                bstr::BStr::new(bun_paths::basename(template)),
            );
        }

        let rel_destination =
            bun_paths::resolve_path::relative(filesystem.top_level_dir, destination);
        if rel_destination.is_empty() {
            bun_core::pretty!(
                "\n<d>#<r><b> To get started, run:<r>\n\n  <b><cyan>{}<r>\n\n",
                bun_core::fmt::EscapeControlChars(bstr::BStr::new(start_command)),
            );
        } else {
            bun_core::pretty!(
                "\n<d>#<r><b> To get started, run:<r>\n\n  <b><cyan>cd {}<r>\n  <b><cyan>{}<r>\n\n",
                bstr::BStr::new(rel_destination),
                bun_core::fmt::EscapeControlChars(bstr::BStr::new(start_command)),
            );
        }

        Output::flush();

        if create_options.open {
            // SAFETY: single-threaded CLI access to module-level static path buffer
            let bun_path_buf = unsafe { &mut *BUN_PATH_BUF.get() };
            if let Some(bin) = which(bun_path_buf, path_env, destination, b"bun") {
                let argv: [&[u8]; 1] = [bin.as_bytes()];
                crate::cli::open::open_url(bun_core::zstr!("http://localhost:3000/"));

                let _ = spawn_sync::spawn(&spawn_sync::Options {
                    argv: argv.iter().map(|s| Box::<[u8]>::from(*s)).collect(),
                    cwd: Box::from(destination),
                    stdin: spawn_sync::SyncStdio::Inherit,
                    stdout: spawn_sync::SyncStdio::Inherit,
                    stderr: spawn_sync::SyncStdio::Inherit,
                    // `bun.spawnSync` on Windows requires a live `loop_` — supply it.
                    #[cfg(windows)]
                    windows: spawn_sync::WindowsOptions {
                        loop_: bun_event_loop::EventLoopHandle::init_mini(
                            bun_event_loop::MiniEventLoop::init_global(None, None),
                        ),
                        ..Default::default()
                    },
                    ..Default::default()
                })?;
            }
        }

        Ok(())
    }

    pub(crate) fn extract_info() -> crate::Result<ExtractedInfo> {
        let example_tag;
        // SAFETY: process-lifetime singleton; init returns *mut.
        let filesystem = unsafe { &*fs::FileSystem::init(None)? };

        let create_options = CreateOptions::parse()?;
        let positionals = &create_options.positionals;
        if positionals.is_empty() {
            crate::cli::command::tag_print_help(crate::Command::Tag::CreateCommand, false);
            Global::crash();
        }

        let mut env_loader = DotEnv::Loader::init();

        env_loader.load_process()?;

        // SAFETY: single-threaded CLI access to module-level static path buffer
        let home_dir_buf = unsafe { &mut *HOME_DIR_BUF.get() };
        // Returns the length of the NUL-terminated path in `buf`, or `None` if it is too long.
        let join = |parts: &[&[u8]], buf: &mut PathBuffer| {
            bun_paths::resolve_path::join_abs_string_buf_z_checked::<
                bun_paths::resolve_path::platform::Loose,
            >(filesystem.top_level_dir, &mut buf[..], parts)
            .map(|path| path.as_bytes().len())
        };
        let template: &[u8] = 'brk: {
            let positional = positionals[0];

            let parts = [filesystem.top_level_dir, positional];
            let Some(len) = join(&parts, home_dir_buf) else {
                pretty_errorln!("<r><red>error<r>: template name too long");
                Global::exit(1);
            };
            let outdir_path_ = bun_core::ZStr::from_buf(&home_dir_buf[..], len);
            if !bun_paths::resolve_path::has_any_illegal_chars(outdir_path_.as_bytes())
                && matches!(
                    bun_sys::exists_at_type(bun_sys::Fd::cwd(), outdir_path_),
                    Ok(bun_sys::ExistsAtType::File)
                )
            {
                let extension = bun_paths::extension(positional);
                if let Some(tag) = ExampleTag::from_file_extension(extension) {
                    example_tag = tag;
                    break 'brk crate::cli::cli_dupe(&home_dir_buf[..len]);
                }
                // Not for .js: a lot of create-* npm packages have .js in the name.
                else if !extension.is_empty() && extension != b".js" {
                    bun_core::warn!(
                        "bun create [local file] only supports .jsx and .tsx files currently",
                    );
                }
            }

            if !names_path_inside_dir(positional) {
                pretty_errorln!(
                    "<r><red>error<r>: <b>\"{}\"<r> is not a template name. Pass a template name, a <b>user/repo<r> on GitHub, or the absolute path of a folder.",
                    bstr::BStr::new(positional),
                );
                Global::exit(1);
            }

            if bun_paths::is_absolute(positional) {
                example_tag = ExampleTag::LocalFolder;
                break 'brk positional;
            }

            let create_dir = env_loader.map.get(b"BUN_CREATE_DIR");
            let home_dir = env_loader.map.get(b"HOME");
            let template_dirs: [Option<Vec<&[u8]>>; 3] = [
                create_dir.map(|dir| vec![dir, positional]),
                Some(vec![filesystem.top_level_dir, BUN_CREATE_DIR, positional]),
                home_dir.map(|dir| vec![dir, BUN_CREATE_DIR, positional]),
            ];
            for parts in template_dirs.iter().flatten() {
                let Some(len) = join(parts, home_dir_buf) else {
                    continue;
                };
                let outdir_path_ = bun_core::ZStr::from_buf(&home_dir_buf[..], len);
                if !bun_paths::resolve_path::has_any_illegal_chars(outdir_path_.as_bytes())
                    && bun_sys::directory_exists_at(bun_sys::Fd::cwd(), outdir_path_)
                        .unwrap_or(false)
                {
                    example_tag = ExampleTag::LocalFolder;
                    break 'brk &home_dir_buf[..len];
                }
            }

            // "https://github.com/foo/bar", "github.com/foo/bar" or "foo/bar"
            let remainder = positional
                .strip_prefix(b"https://github.com/")
                .or_else(|| positional.strip_prefix(b"github.com/"))
                .unwrap_or(positional);
            if let Some(i) = strings::index_of_char_usize(remainder, b'/')
                && i > 0
                && !remainder[i + 1..].is_empty()
            {
                let end = strings::index_of_char_usize(&remainder[i + 1..], b'/')
                    .map_or(remainder.len(), |slash| i + 1 + slash);
                example_tag = ExampleTag::GithubRepository;
                break 'brk strings::trim(&remainder[..end], b"# \r\t");
            }

            example_tag = ExampleTag::Official;
            break 'brk positional;
        };
        Ok(ExtractedInfo {
            example_tag,
            template,
        })
    }
}

pub(crate) struct ExtractedInfo {
    pub example_tag: ExampleTag,
    // A positional or a static buffer, both process-lifetime.
    pub template: &'static [u8],
}

fn file_copier_copy(
    destination_dir_: &bun_sys::Dir,
    walker: &mut bun_sys::walker_skippable::Walker,
    node_: &mut ProgressNode,
    progress_: &mut Progress,
    #[cfg(windows)] dst_base_len: usize,
    #[cfg(windows)] dst_buf: &mut bun_paths::WPathBuffer,
    #[cfg(windows)] src_base_len: usize,
    #[cfg(windows)] src_buf: &mut bun_paths::WPathBuffer,
) -> crate::Result<()> {
    while let Some(entry) = walker.next()? {
        #[cfg(windows)]
        {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            dst_buf[dst_base_len..][..entry.path.len()].copy_from_slice(entry.path);
            dst_buf[dst_base_len + entry.path.len()] = 0;
            let dst = bun_core::WStr::from_buf(&dst_buf[..], dst_base_len + entry.path.len());

            src_buf[src_base_len..][..entry.path.len()].copy_from_slice(entry.path);
            src_buf[src_base_len + entry.path.len()] = 0;
            let src = bun_core::WStr::from_buf(&src_buf[..], src_base_len + entry.path.len());

            match entry.kind {
                bun_sys::FileKind::Directory => {
                    // SAFETY: `src`/`dst` are NUL-terminated wide strings.
                    if unsafe {
                        bun_sys::windows::CreateDirectoryExW(
                            src.as_ptr(),
                            dst.as_ptr(),
                            core::ptr::null_mut(),
                        )
                    } == 0
                    {
                        let _ = bun_sys::MakePath::make_path_u16(destination_dir_, entry.path);
                    }
                }
                bun_sys::FileKind::File => {
                    // A raw pointer, so that the guard holds no unique borrow across `node_.end()` below.
                    let node_ptr: *mut ProgressNode = node_;
                    // SAFETY: `node_` outlives this match arm; single-threaded progress access.
                    scopeguard::defer! { unsafe { (*node_ptr).complete_one() } }
                    // SAFETY: `src`/`dst` are NUL-terminated wide strings.
                    if unsafe { bun_sys::windows::CopyFileW(src.as_ptr(), dst.as_ptr(), 0) }
                        == bun_sys::windows::FALSE
                    {
                        if let Some(entry_dirname) = bun_paths::Dirname::dirname_u16(entry.path) {
                            let _ =
                                bun_sys::MakePath::make_path_u16(destination_dir_, entry_dirname);
                            // SAFETY: same NUL-terminated wide strings as above; retry after mkdir.
                            if unsafe { bun_sys::windows::CopyFileW(src.as_ptr(), dst.as_ptr(), 0) }
                                != bun_sys::windows::FALSE
                            {
                                continue;
                            }
                        }

                        Output::err(
                            bun_sys::windows::last_system_errno(),
                            "failed to copy file {}",
                            format_args!(
                                "{}",
                                bun_core::fmt::fmt_os_path(entry.path, Default::default())
                            ),
                        );
                        node_.end();
                        progress_.refresh();
                        Global::crash();
                    }
                }
                _ => unreachable!(),
            }

            continue;
        }
        #[cfg(not(windows))]
        {
            if entry.kind != bun_sys::FileKind::File {
                continue;
            }

            let open_outfile = || {
                bun_sys::openat(
                    destination_dir_.fd,
                    entry.path,
                    bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
                    0o666,
                )
            };
            let outfile = match open_outfile().or_else(|_| {
                let entry_dirname = bun_resolver::Dirname::dirname(entry.path.as_bytes());
                if !entry_dirname.is_empty() {
                    let _ = destination_dir_.make_path(entry_dirname);
                }
                open_outfile()
            }) {
                Ok(f) => f,
                Err(err) => exit_copy_failed(err, entry.path.as_bytes(), node_, progress_),
            };
            let _close_out = bun_sys::CloseOnDrop::new(outfile);
            // A raw pointer, so that the guard holds no unique borrow across `node_.end()` below.
            let node_ptr: *mut ProgressNode = node_;
            // SAFETY: `node_` outlives this loop body; single-threaded progress access.
            scopeguard::defer! { unsafe { (*node_ptr).complete_one() } }

            let infile = bun_sys::openat(entry.dir, entry.basename, bun_sys::O::RDONLY, 0)?;
            let _close_in = bun_sys::CloseOnDrop::new(infile);

            // What was executable stays executable.
            if let Ok(stat) = bun_sys::fstat(infile) {
                let _ = bun_sys::fchmod(outfile, stat.st_mode as bun_core::Mode);
            }

            if let Err(err) = CopyFile::copy_file(infile, outfile) {
                exit_copy_failed(err, entry.path.as_bytes(), node_, progress_);
            }
        }
    }
    Ok(())
}

#[cfg(not(windows))]
#[cold]
fn exit_copy_failed(
    err: bun_sys::Error,
    path: &[u8],
    node: &mut ProgressNode,
    progress: &mut Progress,
) -> ! {
    node.end();
    progress.refresh();
    Output::err(
        err,
        "failed to copy file {}",
        format_args!("{}", bun_core::fmt::fmt_os_path(path, Default::default())),
    );
    Global::crash();
}

struct Analyzer<'a> {
    overwrite: bool,
    entry_point: &'a [u8],
    node: &'a mut ProgressNode,
}

impl bun_bundler::bundle_v2::OnDependenciesAnalyze for Analyzer<'_> {
    fn on_analyze(
        &mut self,
        result: &mut bun_bundler::bundle_v2::DependenciesScannerResult<'_, '_>,
    ) -> Result<(), bun_bundler::Error> {
        self.node.end();

        SourceFileProjectGenerator::generate(self.overwrite, self.entry_point, result)
            .map_err(Into::into)
    }
}

fn run_on_entry_point(
    ctx: Command::Context<'_>,
    overwrite: bool,
    entry_point: &[u8],
    node: &mut ProgressNode,
) -> crate::Result<()> {
    let mut analyzer = Analyzer {
        overwrite,
        entry_point,
        node,
    };

    let fetcher = bun_bundler::bundle_v2::DependenciesScanner::new(
        &mut analyzer,
        vec![Box::<[u8]>::from(entry_point)].into_boxed_slice(),
    );
    crate::cli::build_command::BuildCommand::exec(ctx, Some(&fetcher))
}

pub(crate) struct Example {
    // Static literals, the CLI arena (remote examples) or `filesystem.filename_store` (local ones).
    pub name: &'static [u8],
    pub(crate) description: &'static [u8],
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum ExampleTag {
    GithubRepository,
    Official,
    LocalFolder,
    JslikeFile,
}

impl ExampleTag {
    pub(crate) fn from_file_extension(extension: &[u8]) -> Option<ExampleTag> {
        matches!(extension, b".tsx" | b".jsx").then_some(ExampleTag::JslikeFile)
    }
}

// Single-threaded CLI scratch state. Static, so that a `URL<'static>` can borrow from the `*_BUF`s.
static URL_: bun_core::RacyCell<Option<URL<'static>>> = bun_core::RacyCell::new(None);
static GITHUB_REPOSITORY_URL_BUF: bun_core::RacyCell<[u8; 1024]> =
    bun_core::RacyCell::new([0u8; 1024]);
static NPM_REGISTRY_URL_BUF: bun_core::RacyCell<[u8; 1024]> = bun_core::RacyCell::new([0u8; 1024]);

impl Example {
    const EXAMPLES_URL: &'static [u8] = b"https://registry.npmjs.org/bun-examples-all/latest";

    pub(crate) fn print(examples: &[Example], default_app_name: Option<&[u8]>) {
        for example in examples {
            let generated = format!(
                "./{}-app",
                bstr::BStr::new(&example.name[0..example.name.len().min(492)])
            );
            let app_name: &[u8] = default_app_name.unwrap_or(generated.as_bytes());

            if !example.description.is_empty() {
                bun_core::pretty!(
                    "  <r># {}<r>\n  <b>bun create <cyan>{}<r><b> {}<r>\n<d>  \n\n",
                    bun_core::fmt::escape_control_chars(example.description),
                    bun_core::fmt::escape_control_chars(example.name),
                    bun_core::fmt::escape_control_chars(app_name),
                );
            } else {
                bun_core::pretty!(
                    "  <r><b>bun create <cyan>{}<r><b> {}<r>\n\n",
                    bun_core::fmt::escape_control_chars(example.name),
                    bun_core::fmt::escape_control_chars(app_name),
                );
            }
        }
    }

    pub(crate) fn fetch_all_local_and_remote(
        ctx: &Command::Context,
        mut node: Option<&mut ProgressNode>,
        env_loader: &mut DotEnv::Loader,
        filesystem: &mut fs::FileSystem,
    ) -> crate::Result<Vec<Example>> {
        let mut examples = Example::fetch_all(ctx, env_loader, node.as_deref_mut())?;
        if let Some(node_) = node {
            node_.end();
        }

        // SAFETY: single-threaded CLI access to module-level static path buffer
        let home_dir_buf = unsafe { &mut *HOME_DIR_BUF.get() };
        let create_dir = env_loader.map.get(b"BUN_CREATE_DIR");
        let home_dir = env_loader.map.get(bun_core::env_var::HOME.key());
        let folders: [Option<bun_sys::Dir>; 3] = [
            create_dir.map(|dir| vec![dir]),
            Some(vec![filesystem.top_level_dir, BUN_CREATE_DIR]),
            home_dir.map(|dir| vec![dir, BUN_CREATE_DIR]),
        ]
        .map(|parts| -> Option<bun_sys::Dir> {
            bun_sys::Dir::open(filesystem.abs_buf(&parts?, home_dir_buf)).ok()
        });

        for folder in folders.iter().flatten() {
            let mut iter = bun_sys::dir_iterator::iterate(folder.fd());

            while let Ok(Some(entry)) = iter.next() {
                if entry.kind != bun_sys::FileKind::Directory
                    || SKIP_DIRS.contains(&entry.name.slice())
                {
                    continue;
                }

                let entry_name = entry.name.slice_u8();
                let len = entry_name.len() + 1 + b"package.json".len();
                home_dir_buf[..entry_name.len()].copy_from_slice(entry_name);
                home_dir_buf[entry_name.len()] = bun_paths::SEP;
                home_dir_buf[entry_name.len() + 1..len].copy_from_slice(b"package.json");
                home_dir_buf[len] = 0;
                let path = bun_core::ZStr::from_buf(&home_dir_buf[..], len);

                if bun_sys::faccessat(folder, path).unwrap_or(false) {
                    examples.push(Example {
                        name: filesystem.filename_store.append_slice(entry_name)?,
                        description: b"",
                    });
                }
            }
        }

        Ok(examples)
    }

    pub(crate) fn fetch_from_github(
        env_loader: &mut DotEnv::Loader,
        name: &[u8],
        refresher: &mut Progress,
        progress: &mut ProgressNode,
    ) -> crate::Result<MutableString> {
        let owner_i = strings::index_of_char_usize(name, b'/').unwrap();
        let owner = &name[0..owner_i];
        let mut repository = &name[owner_i + 1..];

        if let Some(i) = strings::index_of_char_usize(repository, b'/') {
            repository = &repository[0..i];
        }

        progress.name = ProgressBuf::pretty(format_args!(
            "<d>[github] <b>GET<r> <blue>{}/{}<r>",
            bstr::BStr::new(owner),
            bstr::BStr::new(repository),
        ))?;
        refresher.refresh();

        let mut github_api_domain: &[u8] = b"api.github.com";
        if let Some(api_domain) = env_loader.map.get(b"GITHUB_API_DOMAIN") {
            if !api_domain.is_empty() {
                github_api_domain = api_domain;
            }
        }

        // SAFETY: single-threaded CLI access to static buffer
        let url_buf = unsafe { &mut *GITHUB_REPOSITORY_URL_BUF.get() };
        let api_url = URL::parse({
            let mut cursor: &mut [u8] = &mut url_buf[..];
            let cap = cursor.len();
            write!(
                &mut cursor,
                "https://{}/repos/{}/{}/tarball",
                bstr::BStr::new(github_api_domain),
                bstr::BStr::new(owner),
                bstr::BStr::new(repository)
            )?;
            let written = cap - cursor.len();
            &url_buf[..written]
        });

        let mut header_entries: bun_http::headers::EntryList = Default::default();
        let mut headers_buf: &[u8] = b"";

        if let Some(access_token) = env_loader
            .map
            .get(b"GITHUB_TOKEN")
            .or_else(|| env_loader.map.get(b"GITHUB_ACCESS_TOKEN"))
            && !access_token.is_empty()
        {
            let mut buf = Vec::new();
            write!(
                &mut buf,
                "AuthorizationBearer {}",
                bstr::BStr::new(access_token)
            )?;
            headers_buf = crate::cli::cli_dupe(&buf);
            header_entries.append(bun_http::headers::Entry {
                name: bun_http_types::ETag::StringPointer {
                    offset: 0,
                    length: u32::try_from(b"Authorization".len()).expect("int cast"),
                },
                value: bun_http_types::ETag::StringPointer {
                    offset: u32::try_from(b"Authorization".len()).expect("int cast"),
                    length: u32::try_from(headers_buf.len() - b"Authorization".len())
                        .expect("int cast"),
                },
            })?;
        }

        let http_proxy = env_loader.get_http_proxy_for(&api_url);
        let mutable: &'static mut MutableString =
            crate::cli::cli_arena().alloc(MutableString::init(8192)?);

        // ensure very stable memory address
        let mut async_http = Box::new(HTTP::AsyncHTTP::init_sync(
            HTTP::Method::GET,
            api_url,
            header_entries,
            headers_buf,
            b"",
            http_proxy,
            HTTP::ProxySettings::from_env(env_loader),
            HTTP::FetchRedirect::Follow,
        ));
        async_http.client.progress_node = Some(core::ptr::NonNull::from(&mut *progress));
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        let response = async_http.send_sync(mutable)?;

        match response.status_code() {
            404 => return Err(crate::Error::GitHubRepositoryNotFound),
            403 => return Err(crate::Error::HTTPForbidden),
            429 => return Err(crate::Error::HTTPTooManyRequests),
            499..=599 => return Err(crate::Error::GitHubIsDown),
            200 => {}
            _ => return Err(crate::Error::HTTPError),
        }

        let content_type: &[u8] = response.header(b"content-type").unwrap_or(b"");
        if content_type != b"application/x-gzip" {
            progress.end();
            refresher.refresh();

            if !content_type.is_empty() {
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: Unexpected content type from GitHub: {}",
                    bun_core::fmt::escape_control_chars(content_type),
                );
            } else {
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: Invalid response from GitHub (missing content type)",
                );
            }
            Global::crash();
        }

        if mutable.list.is_empty() {
            progress.end();
            refresher.refresh();

            bun_core::pretty_errorln!(
                "<r><red>error<r>: Invalid response from GitHub (missing body)"
            );
            Global::crash();
        }

        Ok(mutable.clone()?)
    }

    pub(crate) fn fetch(
        ctx: &Command::Context,
        env_loader: &mut DotEnv::Loader,
        name: &[u8],
        refresher: &mut Progress,
        progress: &mut ProgressNode,
    ) -> crate::Result<MutableString> {
        progress.name = b"Fetching package.json";
        refresher.refresh();

        // SAFETY: single-threaded CLI access to static buffer.
        let url_buf = unsafe { &mut *NPM_REGISTRY_URL_BUF.get() };
        let mutable: &'static mut MutableString =
            crate::cli::cli_arena().alloc(MutableString::init(2048)?);

        let api_url = URL::parse({
            let mut cursor: &mut [u8] = &mut url_buf[..];
            let cap = cursor.len();
            write!(
                &mut cursor,
                "https://registry.npmjs.org/@bun-examples/{}/latest",
                bstr::BStr::new(name)
            )?;
            let written = cap - cursor.len();
            &url_buf[..written]
        });
        // SAFETY: `api_url` borrows from the process-global `NPM_REGISTRY_URL_BUF`; single-threaded CLI.
        unsafe {
            *URL_.get() = Some(api_url.erase_lifetime());
        }

        // SAFETY: single-threaded CLI access to static URL_ (set just above)
        let mut http_proxy: Option<URL<'static>> = env_loader
            .get_http_proxy_for(unsafe { (*URL_.get()).as_ref().unwrap() })
            .map(|u| URL::parse_single_reader(crate::cli::cli_dupe(u.href)));

        // ensure very stable memory address
        let async_http: &mut HTTP::AsyncHTTP =
            crate::cli::cli_arena().alloc(HTTP::AsyncHTTP::init_sync(
                HTTP::Method::GET,
                // SAFETY: single-threaded CLI access to static URL_ (set just above)
                unsafe { (*URL_.get()).clone() }.unwrap(),
                Default::default(),
                b"",
                b"",
                http_proxy,
                HTTP::ProxySettings::from_env(env_loader),
                HTTP::FetchRedirect::Follow,
            ));
        async_http.client.progress_node = Some(core::ptr::NonNull::from(&mut *progress));
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        let mut response = async_http.send_sync(mutable)?;

        match response.status_code() {
            404 => return Err(crate::Error::ExampleNotFound),
            403 => return Err(crate::Error::HTTPForbidden),
            429 => return Err(crate::Error::HTTPTooManyRequests),
            499..=599 => return Err(crate::Error::NPMIsDown),
            200 => {}
            _ => return Err(crate::Error::HTTPError),
        }

        progress.name = b"Parsing package.json";
        refresher.refresh();
        bun_ast::initialize_store();
        let source = bun_ast::Source::init_path_string(b"package.json", mutable.list.as_slice());
        // SAFETY: single-threaded CLI dispatch; no other borrow of `Cli::LOG_` is live in this scope.
        let log = unsafe { ctx.log_mut() };
        let bump: &'static bun_alloc::Arena = crate::cli::cli_arena();
        let expr = match JSON::parse_utf8(&source, log, bump) {
            Ok(e) => e,
            Err(err) => {
                progress.end();
                refresher.refresh();

                if log.errors > 0 {
                    let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                } else {
                    bun_core::pretty_errorln!("Error parsing package: <r><red>{}<r>", err.name(),);
                }
                Global::exit(1);
            }
        };

        if log.errors > 0 {
            progress.end();
            refresher.refresh();

            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            Global::exit(1);
        }
        let tarball_url: &[u8] = if let Some(q) = expr.as_property(b"dist")
            && let Some(p) = q.expr.as_property(b"tarball")
            && let Some(s) = p.expr.as_utf8_string_literal()
            && (strings::starts_with(s, b"https://") || strings::starts_with(s, b"http://"))
        {
            crate::cli::cli_dupe(s)
        } else {
            progress.end();
            refresher.refresh();

            bun_core::pretty_errorln!(
                "package.json is missing tarball url. This is an internal error!",
            );
            Global::exit(1);
        };

        progress.name = b"Downloading tarball";
        refresher.refresh();

        // The tarball url was copied out of it.
        mutable.reset();

        let parsed_tarball_url = URL::parse(tarball_url);

        http_proxy = env_loader
            .get_http_proxy_for(&parsed_tarball_url)
            .map(|u| URL::parse_single_reader(crate::cli::cli_dupe(u.href)));

        *async_http = HTTP::AsyncHTTP::init_sync(
            HTTP::Method::GET,
            parsed_tarball_url,
            Default::default(),
            b"",
            b"",
            http_proxy,
            HTTP::ProxySettings::from_env(env_loader),
            HTTP::FetchRedirect::Follow,
        );
        async_http.client.progress_node = Some(core::ptr::NonNull::from(&mut *progress));
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        refresher.maybe_refresh();

        response = async_http.send_sync(mutable)?;

        refresher.maybe_refresh();

        if response.status_code() != 200 {
            progress.end();
            refresher.refresh();
            bun_core::pretty_errorln!(
                "Error fetching tarball: <r><red>{}<r>",
                response.status_code(),
            );
            Global::exit(1);
        }

        refresher.refresh();

        Ok(mutable.clone()?)
    }

    pub(crate) fn fetch_all(
        ctx: &Command::Context,
        env_loader: &mut DotEnv::Loader,
        progress_node: Option<&mut ProgressNode>,
    ) -> crate::Result<Vec<Example>> {
        let url = URL::parse(Self::EXAMPLES_URL);
        let http_proxy = env_loader.get_http_proxy_for(&url);

        let mutable: &'static mut MutableString =
            crate::cli::cli_arena().alloc(MutableString::init(2048)?);

        let mut async_http = Box::new(HTTP::AsyncHTTP::init_sync(
            HTTP::Method::GET,
            url,
            Default::default(),
            b"",
            b"",
            http_proxy,
            HTTP::ProxySettings::from_env(env_loader),
            HTTP::FetchRedirect::Follow,
        ));
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        if Output::enable_ansi_colors_stdout() {
            async_http.client.progress_node = progress_node.map(core::ptr::NonNull::from);
        }

        let response = match async_http.send_sync(mutable) {
            Ok(r) => r,
            Err(err) => {
                if err.name() == "EAGAIN" {
                    bun_core::pretty_errorln!(
                        "Request timed out while trying to fetch examples list. Please try again",
                    );
                } else {
                    bun_core::pretty_errorln!(
                        "<r><red>{}<r> while trying to fetch examples list. Please try again",
                        err.name(),
                    );
                }
                Global::exit(1);
            }
        };

        if response.status_code() != 200 {
            bun_core::pretty_errorln!(
                "<r><red>{} {}<r> fetching examples :( ",
                response.status_code(),
                bun_core::fmt::escape_control_chars_multiline(mutable.list.as_slice()),
            );
            Global::exit(1);
        }

        bun_ast::initialize_store();
        let source = bun_ast::Source::init_path_string(b"examples.json", mutable.list.as_slice());
        // Process-lifetime: the examples borrow from it.
        let bump: &'static bun_alloc::Arena = crate::cli::cli_arena();
        // SAFETY: single-threaded CLI dispatch; no other borrow of `Cli::LOG_` is live in this scope.
        let log = unsafe { ctx.log_mut() };
        let examples_object = match JSON::parse_utf8(&source, log, bump) {
            Ok(e) => e,
            Err(err) => {
                if log.errors > 0 {
                    let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                } else {
                    bun_core::pretty_errorln!("Error parsing examples: <r><red>{}<r>", err.name(),);
                }
                Global::exit(1);
            }
        };

        if log.errors > 0 {
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            Global::exit(1);
        }

        if let Some(q) = examples_object.as_property(b"examples")
            && let Some(object) = q.expr.data.e_object()
        {
            let to_example = |property: &bun_ast::G::Property| {
                let name: &'static [u8] = property
                    .key
                    .expect("infallible: prop has key")
                    .data
                    .e_string()
                    .expect("infallible: variant checked")
                    .data
                    .slice();
                Example {
                    name: strings::index_of_char_usize(name, b'/')
                        .map_or(name, |slash| &name[slash + 1..]),
                    description: property
                        .value
                        .and_then(|v| v.as_property(b"description"))
                        .and_then(|q| q.expr.data.e_string())
                        .map(|s| s.data.slice())
                        .unwrap_or(b""),
                }
            };
            return Ok(object.properties.slice().iter().map(to_example).collect());
        }

        bun_core::pretty_errorln!(
            "Corrupt examples data: expected object but received {}",
            examples_object.data.tag_name(),
        );
        Global::exit(1);
    }
}

struct CreateListExamplesCommand;

impl CreateListExamplesCommand {
    fn exec(ctx: &Command::Context) -> crate::Result<()> {
        // SAFETY: FileSystem::init returns the process-global singleton; valid for 'static.
        let filesystem = unsafe { &mut *fs::FileSystem::init(None)? };
        let mut env_loader = DotEnv::Loader::init();

        env_loader.load_process()?;

        let mut progress = Progress {
            supports_ansi_escape_codes: Output::enable_ansi_colors_stderr(),
            ..Default::default()
        };
        // A raw pointer, so that `progress.refresh()` can borrow `progress` again.
        let node: *mut ProgressNode = progress.start(b"Fetching manifest", 0);
        progress.refresh();

        // SAFETY: `node` points into `progress`, which outlives this call; single-threaded.
        let examples = Example::fetch_all_local_and_remote(
            ctx,
            Some(unsafe { &mut *node }),
            &mut env_loader,
            filesystem,
        )?;
        bun_core::prettyln!(
            "Welcome to bun! Create a new project by pasting any of the following:\n",
        );
        Output::flush();

        Example::print(&examples, None);

        bun_core::prettyln!(
            "<r><d>#<r> You can also paste a GitHub repository:\n\n  <b>bun create <cyan>ahfarmer/calculator calc<r>\n",
        );

        let homedir = env_loader.map.get(bun_core::env_var::HOME.key());
        bun_core::prettyln!(
            "<d>This command is completely optional. To add a new local template, create a folder in {}/.bun-create/. To publish a new template, git clone https://github.com/oven-sh/bun, add a new folder to the \"examples\" folder, and submit a PR.<r>",
            bstr::BStr::new(homedir.unwrap_or(b"$HOME")),
        );

        Output::flush();
        Ok(())
    }
}

struct GitHandler;

impl GitHandler {
    fn run(destination: &[u8], path: &[u8], verbose: bool) -> crate::Result<bool> {
        let git_start = bun_core::time::nano_timestamp();

        // The git CLI: libgit2 took three times as long for this.
        // SAFETY: single-threaded CLI access to module-level static path buffer
        let bun_path_buf = unsafe { &mut *BUN_PATH_BUF.get() };
        #[cfg(windows)]
        let win_loop = bun_event_loop::EventLoopHandle::init_mini(
            bun_event_loop::MiniEventLoop::init_global(None, None),
        );
        if let Some(git) = which(bun_path_buf, path, destination, b"git") {
            let git: &[u8] = git.as_bytes();

            if verbose {
                bun_core::pretty_errorln!("git backend: {}", bstr::BStr::new(git));
            }

            let env = DotEnv::Map::for_git_child()?.create_null_delimited_env_map()?;
            use spawn_sync::SyncStdio::{self, Buffer, Ignore, Inherit};
            let spawn = |args: &[&[u8]], output: SyncStdio| -> crate::Result<spawn_sync::Result> {
                Ok(spawn_sync::spawn(&spawn_sync::Options {
                    argv: core::iter::once(&git)
                        .chain(args)
                        .map(|s| Box::<[u8]>::from(*s))
                        .collect(),
                    cwd: Box::from(destination),
                    envp: Some(env.as_ptr()),
                    stdin: Inherit,
                    stdout: output,
                    stderr: output,
                    #[cfg(windows)]
                    windows: spawn_sync::WindowsOptions {
                        loop_: win_loop,
                        ..Default::default()
                    },
                    ..Default::default()
                })??)
            };

            if !spawn(&[b"init", b"--quiet"], Inherit)?.is_ok() {
                return Ok(false);
            }
            // `--ignore-errors` still exits non-zero after it skipped a file.
            let _ = spawn(&[b"add", destination, b"--ignore-errors"], Inherit)?;
            let commit = spawn(
                &[
                    b"commit",
                    b"-am",
                    b"Initial commit (via bun create)",
                    b"--quiet",
                ],
                Buffer,
            )?;
            if !commit.is_ok() {
                if spawn(&[b"var", b"GIT_COMMITTER_IDENT"], Ignore)?.is_ok() {
                    pretty_error!(
                        "{}{}",
                        bun_core::fmt::escape_control_chars_multiline(&commit.stdout),
                        bun_core::fmt::escape_control_chars_multiline(&commit.stderr),
                    );
                } else {
                    bun_core::pretty_errorln!(
                        "<r><blue>note<r><d>:<r> git has no <b>user.name<r> and <b>user.email<r>, files staged but not committed",
                    );
                }
            }

            bun_core::pretty_error!("\n");
            Output::print_start_end(git_start, bun_core::time::nano_timestamp());
            bun_core::pretty_error!(" <d>git<r>\n");
            return Ok(true);
        }

        Ok(false)
    }
}
