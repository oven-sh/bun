use bun_collections::VecExt;
use core::sync::atomic::{AtomicU32, Ordering};
use std::cell::Cell;
use std::io::Write as _;

use crate::api::bun_process::sync as spawn_sync;
use bun_clap as clap;
use bun_core::Progress::{Node as ProgressNode, Progress};
use bun_core::{Global, Output, pretty, pretty_error, pretty_errorln};
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
use bun_threading::Futex;
use bun_url::URL;
use bun_which::which;
use bun_zlib as Zlib;

use crate::Command;
use crate::cli::which_npm_client::NPMClient;

// PORT NOTE: `cli/create/` has no mod.rs yet; mount the generator directly here
// so `SourceFileProjectGenerator::generate(...)` resolves. The submodule itself
// reaches back into `crate::cli::create_command::Example` via absolute path.
#[path = "create/SourceFileProjectGenerator.rs"]
pub mod SourceFileProjectGenerator;

// PORTING.md §Global mutable state: single-thread CLI scratch buffer →
// RacyCell. Touched on the main thread for `--open` *and* the spawned git
// thread (sequenced — git thread writes after main is done with it).
static BUN_PATH_BUF: bun_core::RacyCell<PathBuffer> = bun_core::RacyCell::new(PathBuffer::ZEROED);

#[cfg(not(windows))]
const SKIP_DIRS: &[&OSPathSlice] = &[b"node_modules", b".git"];
#[cfg(not(windows))]
const SKIP_FILES: &[&OSPathSlice] = &[b"package-lock.json", b"yarn.lock", b"pnpm-lock.yaml"];
#[cfg(windows)]
const SKIP_DIRS: &[&OSPathSlice] = &[bun_core::w!("node_modules"), bun_core::w!(".git")];
#[cfg(windows)]
const SKIP_FILES: &[&OSPathSlice] = &[
    bun_core::w!("package-lock.json"),
    bun_core::w!("yarn.lock"),
    bun_core::w!("pnpm-lock.yaml"),
];

const NEVER_CONFLICT: &[&[u8]] = &[b"README.md", b"gitignore", b".gitignore", b".git/"];

const NPM_TASK_ARGS: &[&[u8]] = &[b"run"];

fn exec_task(task_: &[u8], cwd: &[u8], _path: &[u8], npm_client: Option<NPMClient>) {
    let task = strings::trim(task_, b" \n\r\t");
    if task.is_empty() {
        return;
    }

    let mut count: usize = 0;
    for _ in task.split(|b| *b == b' ') {
        count += 1;
    }

    let npm_args = 2 * usize::from(npm_client.is_some());
    let total = count + npm_args;
    // Zig fills `alloc(string, total)` by index; in Rust, `set_len` + index-write into
    // uninitialized `&[u8]` slots is UB (invalid references exist before assignment).
    // Build with `push` instead — same allocation, no unsafe.
    let mut argv: Vec<&[u8]> = Vec::with_capacity(total);

    if let Some(ref client) = npm_client {
        argv.push(client.bin);
        argv.push(NPM_TASK_ARGS[0]);
    }

    for split in task.split(|b| *b == b' ') {
        argv.push(split);
    }
    debug_assert_eq!(argv.len(), total);

    let mut argv: &[&[u8]] = &argv;
    if npm_client.is_some() && strings::starts_with(task, b"bun ") {
        argv = &argv[2..];
    }

    pretty!("\n<r><d>$<b>");
    for (i, arg) in argv.iter().enumerate() {
        if i > argv.len() - 1 {
            Output::print(format_args!(" {} ", bstr::BStr::new(arg)));
        } else {
            Output::print(format_args!(" {}", bstr::BStr::new(arg)));
        }
    }
    pretty!("<r>");
    Output::print(format_args!("\n"));
    Output::flush();

    let _unbuffered = Output::disable_buffering_scope();

    let _ = spawn_sync::spawn(&spawn_sync::Options {
        argv: argv.iter().map(|s| Box::<[u8]>::from(*s)).collect(),
        envp: None,
        cwd: Box::from(cwd),
        stderr: spawn_sync::SyncStdio::Inherit,
        stdout: spawn_sync::SyncStdio::Inherit,
        stdin: spawn_sync::SyncStdio::Inherit,
        // Zig: `.windows = if (Environment.isWindows) .{ .loop = EventLoopHandle.init(
        //   MiniEventLoop.initGlobal(null, null)) }`. `WindowsOptions::default()` zeroes
        // `loop_` (UB — null `uv_loop` deref in `spawn_process_windows`), so populate it.
        #[cfg(windows)]
        windows: spawn_sync::WindowsOptions {
            loop_: bun_event_loop::EventLoopHandle::init_mini(
                bun_event_loop::MiniEventLoop::init_global(None, None),
            ),
            ..Default::default()
        },
        #[cfg(not(windows))]
        windows: (),
        ..Default::default()
    });
}

// We don't want to allocate memory each time
// But we cannot print over an existing buffer or weird stuff will happen
// so we keep two and switch between them
pub(crate) struct ProgressBuf;

impl ProgressBuf {
    // TODO(port): mutable global buffers — single-threaded CLI usage
    thread_local! {
        static BUFS: core::cell::RefCell<[[u8; 1024]; 2]> = const { core::cell::RefCell::new([[0u8; 1024]; 2]) };
        static BUF_INDEX: Cell<usize> = const { Cell::new(0) };
    }

    pub(crate) fn print(args: core::fmt::Arguments<'_>) -> Result<&'static [u8], bun_core::Error> {
        // TODO(port): narrow error set
        Self::BUF_INDEX.with(|i| i.set(i.get() + 1));
        let idx = Self::BUF_INDEX.with(|i| i.get()) % 2;
        Self::BUFS.with_borrow_mut(|bufs| {
            let buf = &mut bufs[idx];
            let mut cursor: &mut [u8] = &mut buf[..];
            let cap = cursor.len();
            write!(&mut cursor, "{}", args).map_err(|_| bun_core::err!("NoSpaceLeft"))?;
            let written = cap - cursor.len();
            // SAFETY: thread-local static buffer; lifetime extended for CLI usage. Matches Zig
            // returning a slice into a module-level static.
            let out: &'static [u8] = unsafe { bun_ptr::detach_lifetime(&buf[..written]) };
            Ok(out)
        })
    }

    pub(crate) fn pretty(
        _fmt: &'static str,
        args: core::fmt::Arguments<'_>,
    ) -> Result<&'static [u8], bun_core::Error> {
        // TODO(port): Output.prettyFmt is a comptime fmt-string transform; the Rust
        // `pretty_fmt` takes a single rendered payload, so callers should pre-render
        // `args` with the color template baked in. `_fmt` is retained for API parity.
        if Output::enable_ansi_colors_stdout() {
            ProgressBuf::print(format_args!("{}", Output::pretty_fmt::<true>(args)))
        } else {
            ProgressBuf::print(format_args!("{}", Output::pretty_fmt::<false>(args)))
        }
    }
}

#[derive(Default)]
struct CreateOptions {
    skip_install: bool,
    overwrite: bool,
    skip_git: bool,
    skip_package_json: bool,
    positionals: Box<[&'static [u8]]>, // TODO(port): lifetime — borrows from clap args
    verbose: bool,
    open: bool,
}

impl CreateOptions {
    fn params() -> &'static [clap::Param<clap::Help>] {
        static PARAMS: &[clap::Param<clap::Help>] = &[
            clap::param!("-h, --help                     Print this menu"),
            clap::param!("--force                        Overwrite existing files"),
            clap::param!("--no-install                   Don't install node_modules"),
            clap::param!("--no-git                       Don't create a git repository"),
            clap::param!("--verbose                      Too many logs"),
            clap::param!("--no-package-json              Disable package.json transforms"),
            clap::param!("--open                         On finish, start bun & open in-browser"),
            clap::param!("<POS>...                       "),
        ];
        PARAMS
    }

    pub(crate) fn parse(_ctx: &Command::Context<'_>) -> Result<CreateOptions, bun_core::Error> {
        // Zig: `Output.is_verbose = Output.isVerbose();` — Rust has no setter; the
        // `is_verbose()` accessor reads the env directly each call, so this is a no-op.
        let _ = Output::is_verbose();

        let mut diag = clap::Diagnostic::default();

        let args = match clap::parse::<clap::Help>(
            Self::params(),
            clap::ParseOptions {
                diagnostic: Some(&mut diag),
                ..Default::default()
            },
        ) {
            Ok(a) => a,
            Err(err) => {
                // Report useful error and exit
                let _ = diag.report(Output::error_writer(), err);
                return Err(err);
            }
        };

        let mut opts = CreateOptions {
            // PORT NOTE: clap positionals borrow from process argv; dupe each
            // entry into the process-lifetime CLI arena to obtain
            // `&'static [u8]` (mirrors Zig where argv is process-static).
            positionals: args
                .positionals()
                .iter()
                .map(|p| crate::cli::cli_dupe(p))
                .collect::<Vec<&'static [u8]>>()
                .into_boxed_slice(),
            ..Default::default()
        };

        if opts.positionals.len() >= 1
            && (opts.positionals[0] == b"c" || opts.positionals[0] == b"create")
        {
            // TODO(port): re-slicing Box<[T]> — store as Vec or slice with offset.
            opts.positionals = opts.positionals[1..].to_vec().into_boxed_slice();
        }

        opts.skip_package_json = args.flag(b"--no-package-json");

        opts.verbose = args.flag(b"--verbose") || Output::is_verbose();
        opts.open = args.flag(b"--open");
        opts.skip_install = args.flag(b"--no-install");
        opts.skip_git = args.flag(b"--no-git");
        opts.overwrite = args.flag(b"--force");

        Ok(opts)
    }
}

const BUN_CREATE_DIR: &[u8] = b".bun-create";
// PORTING.md §Global mutable state: single-thread CLI scratch buffer → RacyCell.
static HOME_DIR_BUF: bun_core::RacyCell<PathBuffer> = bun_core::RacyCell::new(PathBuffer::ZEROED);

pub(crate) struct CreateCommand;

impl CreateCommand {
    #[cold]
    pub(crate) fn exec(
        ctx: &Command::Context<'_>,
        example_tag: ExampleTag,
        template: &[u8],
    ) -> Result<(), bun_core::Error> {
        Global::configure_allocator(Global::AllocatorConfiguration {
            long_running: false,
            ..Default::default()
        });
        HTTP::http_thread::init(&Default::default());

        let mut create_options = CreateOptions::parse(ctx)?;
        let positionals = &create_options.positionals;

        if positionals.is_empty() {
            return CreateListExamplesCommand::exec(ctx);
        }

        // SAFETY: `fs::FileSystem::init` returns a process-global singleton pointer.
        let filesystem: &mut fs::FileSystem = unsafe { &mut *fs::FileSystem::init(None)? };
        let mut env_loader: DotEnv::Loader =
            { DotEnv::Loader::init(crate::cli::cli_arena().alloc(DotEnv::Map::init())) };

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
        let node: *mut ProgressNode = match example_tag {
            ExampleTag::JslikeFile => progress.start(
                ProgressBuf::print(format_args!("Analyzing {}", bstr::BStr::new(template)))?,
                0,
            ),
            _ => progress.start(
                ProgressBuf::print(format_args!("Loading {}", bstr::BStr::new(template)))?,
                0,
            ),
        };
        // SAFETY: `node` is `&mut progress.root`; both live on this stack frame
        // for all of `exec`. Laundering through `*mut` decouples the borrowck-
        // tracked exclusive borrow of `progress` (Node already holds
        // `*mut Progress` internally).
        let node: &mut ProgressNode = unsafe { &mut *node };

        // alacritty is fast
        if env_loader.map.get(b"ALACRITTY_LOG").is_some() {
            progress.refresh_rate_ns = (bun_core::time::NS_PER_MS * 8) as u64;
        }

        // PORT NOTE: Zig `defer progress.refresh()`. Capture `*mut Progress` so
        // the guard does not hold an exclusive borrow for the whole fn body;
        // `progress` is declared earlier so it is still alive when this drops.
        let progress_ptr: *mut Progress = &raw mut progress;
        let _refresh_on_exit = scopeguard::guard(progress_ptr, |p| {
            // SAFETY: see PORT NOTE above — `progress` outlives this guard.
            unsafe { (*p).refresh() };
        });

        let mut package_json_contents: MutableString = MutableString::default();
        let mut package_json_file: Option<bun_sys::File> = None;

        if example_tag != ExampleTag::LocalFolder {
            if create_options.verbose {
                pretty_errorln!("Downloading as {}\n", <&'static str>::from(example_tag),);
            }
        }

        match example_tag {
            ExampleTag::JslikeFile => {
                return run_on_entry_point(ctx, example_tag, template, node);
            }
            ExampleTag::GithubRepository | ExampleTag::Official => {
                let tarball_bytes: MutableString = match example_tag {
                    ExampleTag::Official => {
                        match Example::fetch(ctx, &mut env_loader, template, &mut progress, node) {
                            Ok(b) => b,
                            Err(err) => {
                                if err == bun_core::err!("HTTPForbidden")
                                    || err == bun_core::err!("ExampleNotFound")
                                {
                                    node.end();
                                    progress.refresh();

                                    pretty_error!(
                                        "\n<r><red>error:<r> <b>\"{}\"<r> was not found. Here are templates you can use:\n\n",
                                        bstr::BStr::new(template),
                                    );
                                    Output::flush();

                                    let examples = Example::fetch_all_local_and_remote(
                                        ctx,
                                        None,
                                        &mut env_loader,
                                        filesystem,
                                    )?;
                                    Example::print(&examples, Some(dirname));
                                    Global::exit(1);
                                } else {
                                    node.end();
                                    progress.refresh();

                                    pretty_errorln!("\n\n");

                                    return Err(err);
                                }
                            }
                        }
                    }
                    ExampleTag::GithubRepository => match Example::fetch_from_github(
                        ctx,
                        &mut env_loader,
                        template,
                        &mut progress,
                        node,
                    ) {
                        Ok(b) => b,
                        Err(err) => {
                            if err == bun_core::err!("HTTPForbidden") {
                                node.end();
                                progress.refresh();

                                pretty_error!(
                                    "\n<r><red>error:<r> GitHub returned 403. This usually means GitHub is rate limiting your requests.\nTo fix this, either:<r>  <b>A) pass a <r><cyan>GITHUB_ACCESS_TOKEN<r> environment variable to bun<r>\n  <b>B)Wait a little and try again<r>\n",
                                );
                                Global::crash();
                            } else if err == bun_core::err!("GitHubRepositoryNotFound") {
                                node.end();
                                progress.refresh();

                                pretty_error!(
                                    "\n<r><red>error:<r> <b>\"{}\"<r> was not found on GitHub. Here are templates you can use:\n\n",
                                    bstr::BStr::new(template),
                                );
                                Output::flush();

                                let examples = Example::fetch_all_local_and_remote(
                                    ctx,
                                    None,
                                    &mut env_loader,
                                    filesystem,
                                )?;
                                Example::print(&examples, Some(dirname));
                                Global::crash();
                            } else {
                                node.end();
                                progress.refresh();

                                pretty_errorln!("\n\n");

                                return Err(err);
                            }
                        }
                    },
                    _ => unreachable!(),
                };

                node.name = ProgressBuf::print(format_args!(
                    "Decompressing {}",
                    bstr::BStr::new(template)
                ))?;
                node.set_completed_items(0);
                node.set_estimated_total_items(0);

                progress.refresh();

                let file_buf = vec![0u8; 16384];

                // TODO(port): ArrayListUnmanaged with pre-allocated buffer — using Vec directly
                let mut tarball_buf_list: Vec<u8> = file_buf;
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

                // PORT NOTE: see SKIP_DIRS note re: os_path_literal — Plucker::init
                // takes `&[OSPathChar]`, which is `&[u8]` on POSIX / `&[u16]` on Windows.
                #[cfg(not(windows))]
                let package_json_lit: &OSPathSlice = b"package.json";
                #[cfg(windows)]
                let package_json_lit: &OSPathSlice = bun_core::w!("package.json");
                let pluckers: Vec<archiver::Plucker> = if !create_options.skip_package_json {
                    vec![archiver::Plucker::init(package_json_lit, 2048)?]
                } else {
                    Vec::new()
                };

                let mut archive_context = archiver::Context {
                    pluckers,
                    all_files: Default::default(), // undefined in Zig
                    overwrite_list: bun_collections::StringArrayHashMap::<()>::default(),
                };

                if !create_options.overwrite {
                    // TODO(port): blocked_on bun_libarchive::ArchiveAppender impl for
                    // fs::DirnameStore — Zig passed `FileSystem.DirnameStore` (has
                    // appendMutable). For now route through the no-op `()` appender.
                    Archiver::get_overwriting_file_list::<(), 1>(
                        &tarball_buf_list,
                        destination,
                        &mut archive_context,
                        &mut (),
                    )?;

                    for never_conflict_path in NEVER_CONFLICT {
                        let _ = archive_context
                            .overwrite_list
                            .swap_remove(never_conflict_path);
                    }

                    if archive_context.overwrite_list.count() > 0 {
                        node.end();
                        progress.refresh();

                        // Thank you create-react-app for this copy (and idea)
                        pretty_errorln!(
                            "<r>\n<red>error<r><d>: <r>The directory <b><blue>{}<r>/ contains files that could conflict:\n\n",
                            bstr::BStr::new(bun_paths::basename(destination)),
                        );
                        for path in archive_context.overwrite_list.keys() {
                            if strings::ends_with(path, bun_paths::SEP_STR.as_bytes()) {
                                pretty_error!(
                                    "<r>  <blue>{}<r>",
                                    bstr::BStr::new(&path[0..path.len().max(1) - 1]),
                                );
                                Output::pretty_errorln(bun_paths::SEP_STR);
                            } else {
                                pretty_errorln!("<r>  {}", bstr::BStr::new(path));
                            }
                        }

                        pretty_errorln!(
                            "<r>\n<d>To download {} anyway, use --force<r>",
                            bstr::BStr::new(template),
                        );
                        Global::exit(1);
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
                let template_parts = [template];

                node.name = b"Copying files";
                progress.refresh();

                let abs_template_path = filesystem.abs(&template_parts);
                // TODO(port): std.fs.openDirAbsolute — use bun_sys directory APIs
                let _ = bun_sys::OpenDirOptions {
                    iterate: true,
                    ..Default::default()
                };
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

                // TODO(port): std.fs.deleteTreeAbsolute — bun_sys lacks an absolute helper;
                // route through cwd-relative delete_tree (absolute paths bypass dirfd on POSIX).
                let _ = bun_sys::Dir::cwd().delete_tree(destination);
                let destination_dir__ = match bun_sys::Fd::cwd().make_open_path(destination) {
                    Ok(d) => d,
                    Err(err) => {
                        node.end();
                        progress.refresh();

                        pretty_errorln!(
                            "<r><red>{}<r>: creating dir {}",
                            err.name(),
                            bstr::BStr::new(destination),
                        );
                        Global::exit(1);
                    }
                };

                #[cfg(windows)]
                let mut destination_buf: bun_paths::WPathBuffer = bun_paths::WPathBuffer::uninit();
                #[cfg(windows)]
                let dst_without_trailing_slash: &[u8] =
                    strings::without_trailing_slash(destination);
                #[cfg(windows)]
                {
                    strings::copy_u8_into_u16(&mut destination_buf, dst_without_trailing_slash);
                    destination_buf[dst_without_trailing_slash.len()] = bun_paths::SEP as u16;
                }

                #[cfg(windows)]
                let mut template_path_buf: bun_paths::WPathBuffer =
                    bun_paths::WPathBuffer::uninit();
                #[cfg(windows)]
                let src_without_trailing_slash: &[u8] =
                    strings::without_trailing_slash(abs_template_path);
                #[cfg(windows)]
                {
                    strings::copy_u8_into_u16(&mut template_path_buf, src_without_trailing_slash);
                    template_path_buf[src_without_trailing_slash.len()] = bun_paths::SEP as u16;
                }

                let destination_dir = destination_dir__;
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
                    (dst_without_trailing_slash.len() + 1),
                    #[cfg(windows)]
                    &mut destination_buf,
                    #[cfg(windows)]
                    (src_without_trailing_slash.len() + 1),
                    #[cfg(windows)]
                    &mut template_path_buf,
                )?;

                package_json_file = destination_dir
                    .open_file(b"package.json", bun_sys::O::RDWR, 0)
                    .ok();

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
                        // Zig: list.expandToCapacity() — set len to capacity so the buffer is readable.
                        let cap = package_json_contents.list.capacity();
                        package_json_contents.list.resize(cap, 0);

                        #[cfg(windows)]
                        let prev_file_pos = pkg.get_pos()?;
                        #[cfg(not(windows))]
                        let _prev_file_pos: u64 = 0;

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
            _ => unreachable!(),
        }

        node.end();
        progress.refresh();

        let is_nextjs = false;
        let is_create_react_app = false;
        let create_react_app_entry_point_path: &[u8] = b"";
        let mut preinstall_tasks: Vec<&[u8]> = Vec::new();
        let mut postinstall_tasks: Vec<&[u8]> = Vec::new();
        let mut has_dependencies: bool = false;
        let path_env = env_loader.map.get(b"PATH").unwrap_or(b"");

        {
            // TODO(port): std.fs.openDirAbsolute — use bun_sys
            let parent_dir = bun_sys::Dir::open(destination)?;
            #[cfg(windows)]
            {
                let _ = parent_dir.copy_file(
                    b"gitignore",
                    &parent_dir,
                    b".gitignore",
                    Default::default(),
                );
            }
            #[cfg(not(windows))]
            {
                let _ = bun_sys::linkat(
                    parent_dir.fd(),
                    bun_core::zstr!("gitignore"),
                    parent_dir.fd(),
                    bun_core::zstr!(".gitignore"),
                );
            }

            let _ = bun_sys::unlinkat(&parent_dir, bun_core::zstr!("gitignore"));
            let _ = bun_sys::unlinkat(&parent_dir, bun_core::zstr!(".npmignore"));
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

                // SAFETY: single-threaded CLI dispatch; no other borrow of the
                // process-static `Cli::LOG_` is live across this scope.
                let log: &mut bun_ast::Log = unsafe { ctx.log_mut() };
                let bump = bun_alloc::Arena::new();
                let mut package_json_expr = match JSON::parse_utf8(&source, log, &bump) {
                    Ok(e) => e,
                    Err(_) => {
                        break 'process_package_json;
                    }
                };

                if package_json_expr.data.e_object().is_none() {
                    break 'process_package_json;
                }

                if log.errors > 0 {
                    let _ = log.print(std::ptr::from_mut(Output::error_writer()));

                    break 'process_package_json;
                }

                if let Some(name_expr) = package_json_expr.as_property(b"name") {
                    if let Some(mut s) = name_expr.expr.data.e_string() {
                        let basename = bun_paths::basename(destination);
                        // SAFETY: `destination` is interned in the process-global DirnameStore
                        // (`append_slice` returns `&'static [u8]`); re-erase the borrow lifetime
                        // to `'static` to match `EString.data: &'static [u8]`. Mirrors Zig's
                        // `@ptrFromInt(@intFromPtr(...))` cast.
                        s.data = bun_ast::StoreStr::new(unsafe {
                            core::slice::from_raw_parts(basename.as_ptr(), basename.len())
                        });
                    }
                }

                let mut dev_dependencies: Option<bun_ast::Expr> = None;
                let mut dependencies: Option<bun_ast::Expr> = None;

                if let Some(q) = package_json_expr.as_property(b"devDependencies") {
                    let property = q.expr;

                    if property.data.is_e_object()
                        && property
                            .data
                            .e_object()
                            .expect("infallible: variant checked")
                            .properties
                            .len_u32()
                            > 0
                    {
                        if property
                            .data
                            .e_object()
                            .expect("infallible: variant checked")
                            .properties
                            .len_u32()
                            > 0
                        {
                            has_dependencies = true;
                            dev_dependencies = Some(q.expr);
                        }
                    }
                }

                if let Some(q) = package_json_expr.as_property(b"dependencies") {
                    let property = q.expr;

                    if property.data.is_e_object()
                        && property
                            .data
                            .e_object()
                            .expect("infallible: variant checked")
                            .properties
                            .len_u32()
                            > 0
                    {
                        if property
                            .data
                            .e_object()
                            .expect("infallible: variant checked")
                            .properties
                            .len_u32()
                            > 0
                        {
                            has_dependencies = true;
                            dependencies = Some(q.expr);
                        }
                    }
                }

                let _ = (dev_dependencies, dependencies);

                mod injection_prefill {
                    // TODO(port): these wire up the static objects above; only feeds dead code
                    pub(crate) fn wire() {
                        // InjectionPrefill.bun_macro_relay_object.properties = ...fromBorrowedSliceDangerous(bun_macro_relay_properties[0..]);
                        // InjectionPrefill.bun_macros_relay_object.properties = ...fromBorrowedSliceDangerous(&bun_macros_relay_object_properties);
                        // InjectionPrefill.bun_macros_relay_only_object.properties = ...fromBorrowedSliceDangerous(&bun_macros_relay_only_object_properties);
                    }

                    pub(crate) fn npx_react_scripts_build() -> bun_ast::Expr {
                        // TODO(port): build bun_ast::Expr { .e_string = "npx react-scripts build" }
                        bun_ast::Expr::init(
                            bun_ast::E::EString::init(b"npx react-scripts build"),
                            bun_ast::Loc::EMPTY,
                        )
                    }
                }

                injection_prefill::wire();

                package_json_expr
                    .data
                    .e_object_mut()
                    .expect("infallible: variant checked")
                    .is_single_line = false;

                // (Zig: `properties = .moveFromList(&properties_list)` — see note
                // above; the aliasing round-trip is a no-op while the injection
                // appends remain commented out, so `properties` is already current.)
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

                        if key == b"scripts" {
                            let mut value_data = props.slice()[i].value.unwrap().data;
                            if value_data.is_e_object() {
                                // SAFETY: StoreRef<E::Object> derefs to arena-backed storage; mutating
                                // through the local `value_data` copy mutates the same arena E::Object.
                                let scripts_obj = value_data
                                    .e_object_mut()
                                    .expect("infallible: variant checked");
                                let mut script_property_out_i: usize = 0;
                                {
                                    let scripts_properties = scripts_obj.properties.slice_mut();

                                    // if they're starting the app with "react-scripts start" or "next dev", that won't make sense
                                    // if they launch with npm run start it will just be slower
                                    let mut script_property_i: usize = 0;

                                    while script_property_i < scripts_properties.len() {
                                        let Some(script_value) =
                                            scripts_properties[script_property_i].value
                                        else {
                                            scripts_properties
                                                .swap(script_property_out_i, script_property_i);
                                            script_property_out_i += 1;
                                            script_property_i += 1;
                                            continue;
                                        };
                                        let Some(script_value) = script_value.data.e_string()
                                        else {
                                            scripts_properties
                                                .swap(script_property_out_i, script_property_i);
                                            script_property_out_i += 1;
                                            script_property_i += 1;
                                            continue;
                                        };
                                        let script = script_value.data.slice();

                                        if strings::contains(script, b"react-scripts start")
                                            || strings::contains(script, b"next dev")
                                            || strings::contains(script, b"react-scripts eject")
                                        {
                                            if create_options.verbose {
                                                Output::pretty_errorln(format_args!(
                                                    "<r><d>[package.json] Pruned unnecessary script: {}<r>",
                                                    bstr::BStr::new(script),
                                                ));
                                            }

                                            script_property_i += 1;
                                            continue;
                                        }

                                        if strings::contains(script, b"react-scripts build") {
                                            scripts_properties[script_property_i].value =
                                                Some(injection_prefill::npx_react_scripts_build());
                                        }

                                        scripts_properties
                                            .swap(script_property_out_i, script_property_i);
                                        script_property_out_i += 1;
                                        script_property_i += 1;
                                    }
                                }

                                scripts_obj
                                    .properties
                                    .shrink_retaining_capacity(script_property_out_i);
                            }
                        }

                        if key.is_empty() || key != b"bun-create" {
                            props.slice_mut().swap(property_i, i);
                            property_i += 1;
                            i += 1;
                            continue;
                        }

                        let value = props.slice()[i].value.unwrap();
                        let arena_str = |s: &[u8]| -> &'static [u8] {
                            // SAFETY: `s` always points into the JSON arena
                            // (initialized via `initialize_store()`), which
                            // lives for the rest of `exec`.
                            unsafe { &*std::ptr::from_ref::<[u8]>(s) }
                        };
                        if let Some(postinstall) = value.as_property(b"postinstall") {
                            match postinstall.expr.data {
                                LExprData::EString(single_task) => {
                                    postinstall_tasks.push(arena_str(single_task.data.slice()));
                                }
                                LExprData::EArray(tasks) => {
                                    let items = tasks.slice();
                                    for task in items {
                                        if let Some(task_entry) = task.as_utf8_string_literal() {
                                            postinstall_tasks.push(arena_str(task_entry));
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }

                        if let Some(preinstall) = value.as_property(b"preinstall") {
                            match preinstall.expr.data {
                                LExprData::EString(single_task) => {
                                    preinstall_tasks.push(arena_str(single_task.data.slice()));
                                }
                                LExprData::EArray(tasks) => {
                                    for task in tasks.items.slice() {
                                        if let Some(task_entry) = task.as_utf8_string_literal() {
                                            preinstall_tasks.push(arena_str(task_entry));
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }

                        if let Some(start) = value.as_property(b"start") {
                            if let Some(start_str) = start.expr.as_utf8_string_literal() {
                                if !start_str.is_empty() {
                                    start_command = arena_str(start_str);
                                }
                            }
                        }

                        i += 1;
                    }
                    props.shrink_retaining_capacity(property_i);
                }

                let file: bun_sys::Fd = package_json_file.handle;

                let mut buffer_writer = JSPrinter::BufferWriter::init();
                buffer_writer.append_newline = true;
                let mut package_json_writer = JSPrinter::BufferPrinter::init(buffer_writer);

                if let Err(err) = JSPrinter::print_json(
                    &mut package_json_writer,
                    package_json_expr,
                    &source,
                    JSPrinter::PrintJsonOptions {
                        mangled_props: None,
                        indent: Default::default(),
                        ..Default::default()
                    },
                ) {
                    Output::pretty_errorln(format_args!(
                        "package.json failed to write due to error {}",
                        err,
                    ));
                    break 'process_package_json;
                }
                let written = package_json_writer.ctx.get_written();
                // `file` is the fd still owned by `package_json_file`; borrow it
                // (constructing an owning `File` here would double-close on drop).
                if let Err(err) = bun_sys::File::borrow(&file).write_all(written) {
                    Output::pretty_errorln(format_args!(
                        "package.json failed to write due to error {}",
                        bstr::BStr::new(err.name()),
                    ));
                    break 'process_package_json;
                }
                if let Err(err) = bun_sys::ftruncate(file, written.len() as i64) {
                    Output::pretty_errorln(format_args!(
                        "package.json failed to write due to error {}",
                        bstr::BStr::new(err.name()),
                    ));
                    break 'process_package_json;
                }
            }
        }

        if create_options.verbose {
            Output::pretty_errorln(format_args!("Has dependencies? {}", has_dependencies as u8,));
        }

        let mut npm_client_: Option<NPMClient> = None;

        let user_skipped_install = create_options.skip_install;
        create_options.skip_install = create_options.skip_install || !has_dependencies;

        if !create_options.skip_git {
            if !create_options.skip_install {
                GitHandler::spawn(destination, path_env, create_options.verbose);
            } else {
                if create_options.verbose {
                    create_options.skip_git =
                        GitHandler::run::<true>(destination, path_env).unwrap_or(false);
                } else {
                    create_options.skip_git =
                        GitHandler::run::<false>(destination, path_env).unwrap_or(false);
                }
            }
        }

        if !create_options.skip_install {
            npm_client_ = Some(NPMClient {
                tag: crate::cli::which_npm_client::Tag::Bun,
                bin: bun_core::self_exe_path()?,
            });
        }

        if npm_client_.is_some() && !preinstall_tasks.is_empty() {
            for task in &preinstall_tasks {
                exec_task(task, destination, path_env, npm_client_);
            }
        }

        if let Some(ref npm_client) = npm_client_ {
            let start_time = bun_core::time::nano_timestamp();
            let install_args: &[&[u8]] = &[npm_client.bin, b"install"];
            Output::flush();
            Output::pretty(format_args!(
                "\n<r><d>$ <b><cyan>{}<r><d> install",
                npm_client.tag.as_str(),
            ));

            if install_args.len() > 2 {
                for arg in &install_args[2..] {
                    Output::pretty(format_args!(" "));
                    Output::pretty(format_args!("{}", bstr::BStr::new(arg)));
                }
            }

            Output::pretty(format_args!("<r>\n"));
            Output::flush();
            scopeguard::defer! {
                Output::print_errorln("\n");
                Output::print_start_end(start_time, bun_core::time::nano_timestamp());
                Output::pretty_error(format_args!(
                    " <r><d>{} install<r>\n",
                    npm_client.tag.as_str(),
                ));
                Output::flush();

                Output::print(format_args!("\n"));
                Output::flush();
            }

            let process = spawn_sync::spawn(&spawn_sync::Options {
                argv: install_args.iter().map(|s| Box::<[u8]>::from(*s)).collect(),
                envp: None,
                cwd: Box::from(destination),
                stderr: spawn_sync::SyncStdio::Inherit,
                stdout: spawn_sync::SyncStdio::Inherit,
                stdin: spawn_sync::SyncStdio::Inherit,
                // Zig: `.windows = if (Environment.isWindows) .{ .loop = EventLoopHandle.init(
                //   MiniEventLoop.initGlobal(null, null)) }`. Default would zero `loop_` → UB.
                #[cfg(windows)]
                windows: spawn_sync::WindowsOptions {
                    loop_: bun_event_loop::EventLoopHandle::init_mini(
                        bun_event_loop::MiniEventLoop::init_global(None, None),
                    ),
                    ..Default::default()
                },
                #[cfg(not(windows))]
                windows: (),
                ..Default::default()
            })?;
            let _ = process?;
        }

        if !user_skipped_install && !postinstall_tasks.is_empty() {
            for task in &postinstall_tasks {
                exec_task(task, destination, path_env, npm_client_);
            }
        }

        if !create_options.skip_install && !create_options.skip_git {
            create_options.skip_git = !GitHandler::wait();
        }

        Output::print_error("\n");
        Output::print_start_end(ctx.start_time, bun_core::time::nano_timestamp());
        Output::pretty_errorln(format_args!(
            " <r><d>bun create {}<r>",
            bstr::BStr::new(template)
        ));

        Output::flush();

        Output::pretty(format_args!(
            "\n<d>Come hang out in bun's Discord: https://bun.com/discord<r>\n",
        ));

        if !create_options.skip_install {
            Output::pretty(format_args!("\n<r><d>-----<r>\n"));
            Output::flush();
        }

        if !create_options.skip_git && !create_options.skip_install {
            Output::pretty(format_args!(
                "\n<d>A local git repository was created for you and dependencies were installed automatically.<r>\n",
            ));
        } else if !create_options.skip_git {
            Output::pretty(format_args!(
                "\n<d>A local git repository was created for you.<r>\n",
            ));
        } else if !create_options.skip_install {
            Output::pretty(format_args!(
                "\n<d>Dependencies were installed automatically.<r>\n",
            ));
        }

        if example_tag == ExampleTag::GithubRepository {
            let mut display_name = template;

            if let Some(first_slash) = bun_core::index_of_char(display_name, b'/') {
                let first_slash = first_slash as usize;
                if let Some(second_slash) =
                    bun_core::index_of_char(&display_name[first_slash + 1..], b'/')
                {
                    display_name = &template[0..first_slash + 1 + second_slash as usize];
                }
            }

            Output::pretty(format_args!(
                "\n<b><green>Success!<r> <b>{}<r> loaded into <b>{}<r>\n",
                bstr::BStr::new(display_name),
                bstr::BStr::new(bun_paths::basename(destination)),
            ));
        } else {
            Output::pretty(format_args!(
                "\n<b>Created <green>{}<r> project successfully\n",
                bstr::BStr::new(bun_paths::basename(template)),
            ));
        }

        if is_nextjs {
            Output::pretty(format_args!(
                "\n<r><d>#<r> When dependencies change, run this to update node_modules.bun:\n\n  <b><cyan>bun bun --use next<r>\n",
            ));
        } else if is_create_react_app {
            Output::pretty(format_args!(
                "\n<r><d>#<r> When dependencies change, run this to update node_modules.bun:\n\n  <b><cyan>bun bun {}<r>\n",
                bstr::BStr::new(create_react_app_entry_point_path),
            ));
        }

        // PORT NOTE: Zig `filesystem.relativeTo(destination)` —
        // `bun_resolver::fs::FileSystem` (the inline shim) has no `relative_to`; call
        // the resolver path helper directly with the singleton's `top_level_dir`.
        let rel_destination =
            bun_paths::resolve_path::relative(filesystem.top_level_dir, destination);
        let is_empty_destination = rel_destination.is_empty();

        if is_empty_destination {
            Output::pretty(format_args!(
                "\n<d>#<r><b> To get started, run:<r>\n\n  <b><cyan>{}<r>\n\n",
                bstr::BStr::new(start_command),
            ));
        } else {
            Output::pretty(format_args!(
                "\n<d>#<r><b> To get started, run:<r>\n\n  <b><cyan>cd {}<r>\n  <b><cyan>{}<r>\n\n",
                bstr::BStr::new(rel_destination),
                bstr::BStr::new(start_command),
            ));
        }

        Output::flush();

        if create_options.open {
            // SAFETY: single-threaded CLI access to module-level static path buffer
            let bun_path_buf = unsafe { &mut *BUN_PATH_BUF.get() };
            if let Some(bin) = which(bun_path_buf, path_env, destination, b"bun") {
                let argv: [&[u8]; 1] = [bin.as_bytes()];
                // Zig used `std.process.Child`; PORTING.md bans std::process — route through
                // bun.spawnSync (`crate::api::bun_process::sync::spawn`).
                crate::cli::open::open_url(bun_core::zstr!("http://localhost:3000/"));

                let _ = spawn_sync::spawn(&spawn_sync::Options {
                    argv: argv.iter().map(|s| Box::<[u8]>::from(*s)).collect(),
                    cwd: Box::from(destination),
                    stdin: spawn_sync::SyncStdio::Inherit,
                    stdout: spawn_sync::SyncStdio::Inherit,
                    stderr: spawn_sync::SyncStdio::Inherit,
                    // Zig used `std.process.Child` (no uv loop). PORTING.md routes this through
                    // `bun.spawnSync`, which on Windows requires a live `loop_` — supply it.
                    #[cfg(windows)]
                    windows: spawn_sync::WindowsOptions {
                        loop_: bun_event_loop::EventLoopHandle::init_mini(
                            bun_event_loop::MiniEventLoop::init_global(None, None),
                        ),
                        ..Default::default()
                    },
                    #[cfg(not(windows))]
                    windows: (),
                    ..Default::default()
                })?;
            }
        }

        Ok(())
    }

    pub(crate) fn extract_info(
        ctx: &Command::Context<'_>,
    ) -> Result<ExtractedInfo, bun_core::Error> {
        let example_tag;
        // SAFETY: process-lifetime singleton; init returns *mut.
        let filesystem = unsafe { &*fs::FileSystem::init(None)? };

        let create_options = CreateOptions::parse(ctx)?;
        let positionals = &create_options.positionals;
        if positionals.is_empty() {
            crate::cli::command::tag_print_help(crate::Command::Tag::CreateCommand, false);
            Global::crash();
        }

        let mut env_loader: DotEnv::Loader =
            { DotEnv::Loader::init(crate::cli::cli_arena().alloc(DotEnv::Map::init())) };

        env_loader.load_process()?;

        // var unsupported_packages = UnsupportedPackages{};
        // SAFETY: single-threaded CLI access to module-level static path buffer
        let home_dir_buf = unsafe { &mut *HOME_DIR_BUF.get() };
        let template: &[u8] = 'brk: {
            let positional = positionals[0];

            'outer: {
                let parts = [filesystem.top_level_dir, positional];
                let outdir_path = filesystem.abs_buf(&parts, home_dir_buf);
                let len = outdir_path.len();
                home_dir_buf[len] = 0;
                // SAFETY: home_dir_buf[len] == 0 written above
                let outdir_path_ = bun_core::ZStr::from_buf(&home_dir_buf[..], len);
                if bun_paths::resolve_path::has_any_illegal_chars(outdir_path_.as_bytes()) {
                    break 'outer;
                }

                if let Ok(exists_at_type) =
                    bun_sys::exists_at_type(bun_sys::Fd::cwd(), outdir_path_)
                {
                    if exists_at_type == bun_sys::ExistsAtType::File {
                        let extension = bun_paths::extension(positional);
                        if let Some(tag) = ExampleTag::from_file_extension(extension) {
                            example_tag = tag;
                            break 'brk crate::cli::cli_dupe(&home_dir_buf[..len]);
                        }
                        // Show a warning when the local file exists and it's not a .js file
                        // A lot of create-* npm packages have .js in the name, so you could end up with that warning.
                        else if !extension.is_empty() && extension != b".js" {
                            Output::warn(
                                "bun create [local file] only supports .jsx and .tsx files currently",
                            );
                        }
                    }
                }
            }

            if !bun_paths::is_absolute(positional) {
                'outer: {
                    if let Some(home_dir) = env_loader.map.get(b"BUN_CREATE_DIR") {
                        let parts = [home_dir, positional];
                        let outdir_path = filesystem.abs_buf(&parts, home_dir_buf);
                        let len = outdir_path.len();
                        home_dir_buf[len] = 0;
                        // SAFETY: home_dir_buf[len] == 0 written above
                        let outdir_path_ = bun_core::ZStr::from_buf(&home_dir_buf[..], len);
                        if bun_paths::resolve_path::has_any_illegal_chars(outdir_path_.as_bytes()) {
                            break 'outer;
                        }
                        if bun_sys::directory_exists_at(bun_sys::Fd::cwd(), outdir_path_)
                            .unwrap_or(false)
                        {
                            example_tag = ExampleTag::LocalFolder;
                            break 'brk &home_dir_buf[..len];
                        }
                    }
                }

                'outer: {
                    let parts = [filesystem.top_level_dir, BUN_CREATE_DIR, positional];
                    let outdir_path = filesystem.abs_buf(&parts, home_dir_buf);
                    let len = outdir_path.len();
                    home_dir_buf[len] = 0;
                    // SAFETY: home_dir_buf[len] == 0 written above
                    let outdir_path_ = bun_core::ZStr::from_buf(&home_dir_buf[..], len);
                    if bun_paths::resolve_path::has_any_illegal_chars(outdir_path_.as_bytes()) {
                        break 'outer;
                    }
                    if bun_sys::directory_exists_at(bun_sys::Fd::cwd(), outdir_path_)
                        .unwrap_or(false)
                    {
                        example_tag = ExampleTag::LocalFolder;
                        break 'brk &home_dir_buf[..len];
                    }
                }

                'outer: {
                    if let Some(home_dir) = env_loader.map.get(b"HOME") {
                        let parts = [home_dir, BUN_CREATE_DIR, positional];
                        let outdir_path = filesystem.abs_buf(&parts, home_dir_buf);
                        let len = outdir_path.len();
                        home_dir_buf[len] = 0;
                        // SAFETY: home_dir_buf[len] == 0 written above
                        let outdir_path_ = bun_core::ZStr::from_buf(&home_dir_buf[..], len);
                        if bun_paths::resolve_path::has_any_illegal_chars(outdir_path_.as_bytes()) {
                            break 'outer;
                        }
                        if bun_sys::directory_exists_at(bun_sys::Fd::cwd(), outdir_path_)
                            .unwrap_or(false)
                        {
                            example_tag = ExampleTag::LocalFolder;
                            break 'brk &home_dir_buf[..len];
                        }
                    }
                }

                if bun_paths::is_absolute(positional) {
                    example_tag = ExampleTag::LocalFolder;
                    break 'brk positional;
                }

                let mut repo_begin: usize = usize::MAX;
                // "https://github.com/foo/bar"
                if strings::starts_with(positional, b"github.com/") {
                    repo_begin = b"github.com/".len();
                }

                if strings::starts_with(positional, b"https://github.com/") {
                    repo_begin = b"https://github.com/".len();
                }

                if repo_begin == usize::MAX && positional[0] != b'/' {
                    if let Some(first_slash_index) = bun_core::index_of_char(positional, b'/') {
                        let first_slash_index = first_slash_index as usize;
                        if let Some(last_slash_index) = bun_core::index_of_char(positional, b'/') {
                            let last_slash_index = last_slash_index as usize;
                            if first_slash_index == last_slash_index
                                && !positional[last_slash_index..].is_empty()
                                && last_slash_index > 0
                            {
                                repo_begin = 0;
                            }
                        }
                    }
                }

                if repo_begin != usize::MAX {
                    let remainder = &positional[repo_begin..];
                    if let Some(i) = bun_core::index_of_char(remainder, b'/') {
                        let i = i as usize;
                        if i > 0 && !remainder[i + 1..].is_empty() {
                            if let Some(last_slash) =
                                bun_core::index_of_char(&remainder[i + 1..], b'/')
                            {
                                let last_slash = last_slash as usize;
                                example_tag = ExampleTag::GithubRepository;
                                break 'brk strings::trim(
                                    &remainder[0..i + 1 + last_slash],
                                    b"# \r\t",
                                );
                            } else {
                                example_tag = ExampleTag::GithubRepository;
                                break 'brk strings::trim(remainder, b"# \r\t");
                            }
                        }
                    }
                }
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
    pub template: &'static [u8], // TODO(port): lifetime — borrows from positionals/static buffer
}

// PORT NOTE: hoisted from Zig fn-local `const FileCopier = struct { pub fn copy(...) }` inside
// CreateCommand.exec, because Rust does not allow capturing-closure-style nested fns and the
// fn body is large.
fn file_copier_copy(
    destination_dir_: &bun_sys::Dir,
    walker: &mut bun_sys::walker_skippable::Walker,
    node_: &mut ProgressNode,
    progress_: &mut Progress,
    #[cfg(windows)] dst_base_len: usize,
    #[cfg(windows)] dst_buf: &mut bun_paths::WPathBuffer,
    #[cfg(windows)] src_base_len: usize,
    #[cfg(windows)] src_buf: &mut bun_paths::WPathBuffer,
) -> Result<(), bun_core::Error> {
    while let Some(entry) = walker.next()? {
        #[cfg(windows)]
        {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            dst_buf[dst_base_len..][..entry.path.len()].copy_from_slice(entry.path);
            dst_buf[dst_base_len + entry.path.len()] = 0;
            // SAFETY: NUL written at [dst_base_len + entry.path.len()]
            let dst = bun_core::WStr::from_buf(&dst_buf[..], dst_base_len + entry.path.len());

            src_buf[src_base_len..][..entry.path.len()].copy_from_slice(entry.path);
            src_buf[src_base_len + entry.path.len()] = 0;
            // SAFETY: NUL written at [src_base_len + entry.path.len()]
            let src = bun_core::WStr::from_buf(&src_buf[..], src_base_len + entry.path.len());

            match entry.kind {
                bun_sys::FileKind::Directory => {
                    // SAFETY: `src`/`dst` are NUL-terminated wide strings built into
                    // `src_buf`/`dst_buf` above; raw Win32 FFI.
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
                    // PORT NOTE: capture `node_` as a raw pointer so the defer closure
                    // doesn't hold a unique borrow across the error-path `node_.end()` below.
                    let node_ptr: *mut ProgressNode = node_;
                    // SAFETY: `node_` outlives this match arm; single-threaded progress access.
                    scopeguard::defer! { unsafe { (*node_ptr).complete_one() } }
                    // SAFETY: `src`/`dst` are NUL-terminated wide strings built into
                    // `src_buf`/`dst_buf` above; raw Win32 FFI.
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

                        use bun_sys::windows::Win32ErrorExt as _;
                        if let Some(err) = bun_sys::windows::Win32Error::get().to_system_errno() {
                            Output::err(
                                err,
                                "failed to copy file {}",
                                format_args!(
                                    "{}",
                                    bun_core::fmt::fmt_os_path(entry.path, Default::default())
                                ),
                            );
                        } else {
                            Output::err_generic(
                                "failed to copy file {}",
                                format_args!(
                                    "{}",
                                    bun_core::fmt::fmt_os_path(entry.path, Default::default())
                                ),
                            );
                        }
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

            let outfile = match bun_sys::openat(
                destination_dir_.fd,
                entry.path,
                bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
                0o666,
            ) {
                Ok(f) => f,
                Err(_) => 'brk: {
                    let entry_dirname = bun_resolver::Dirname::dirname(entry.path.as_bytes());
                    if !entry_dirname.is_empty() {
                        let _ = destination_dir_.make_path(entry_dirname);
                    }
                    match bun_sys::openat(
                        destination_dir_.fd,
                        entry.path,
                        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
                        0o666,
                    ) {
                        Ok(f) => break 'brk f,
                        Err(err) => {
                            node_.end();
                            progress_.refresh();
                            Output::err(
                                err,
                                "failed to copy file {}",
                                format_args!(
                                    "{}",
                                    bun_core::fmt::fmt_os_path(
                                        entry.path.as_bytes(),
                                        Default::default()
                                    )
                                ),
                            );
                            Global::crash();
                        }
                    }
                }
            };
            let _close_out = bun_sys::CloseOnDrop::new(outfile);
            // PORT NOTE: capture `node_` as a raw pointer so the defer body
            // doesn't hold a unique borrow across the error-path `node_.end()` below.
            let node_ptr: *mut ProgressNode = node_;
            // SAFETY: `node_` outlives this loop body; single-threaded progress access.
            scopeguard::defer! { unsafe { (*node_ptr).complete_one() } }

            let infile = bun_sys::openat(entry.dir, entry.basename, bun_sys::O::RDONLY, 0)?;
            let _close_in = bun_sys::CloseOnDrop::new(infile);

            // Assumption: you only really care about making sure something that was executable is still executable
            match bun_sys::fstat(infile) {
                Err(_) => {}
                Ok(stat) => {
                    let _ = bun_sys::fchmod(outfile, stat.st_mode as bun_core::Mode);
                }
            }

            if let Err(err) = CopyFile::copy_file(infile, outfile) {
                node_.end();
                progress_.refresh();
                Output::err(
                    err,
                    "failed to copy file {}",
                    format_args!(
                        "{}",
                        bun_core::fmt::fmt_os_path(entry.path.as_bytes(), Default::default())
                    ),
                );
                Global::crash();
            }
        }
    }
    Ok(())
}

// PORT NOTE: hoisted from Zig fn-local `const Analyzer = struct {...}` inside runOnEntryPoint.
struct Analyzer<'a> {
    ctx: &'a Command::Context<'a>,
    example_tag: ExampleTag,
    entry_point: &'a [u8],
    node: &'a mut ProgressNode,
}

impl bun_bundler::bundle_v2::OnDependenciesAnalyze for Analyzer<'_> {
    fn on_analyze(
        &mut self,
        result: &mut bun_bundler::bundle_v2::DependenciesScannerResult<'_, '_>,
    ) -> Result<(), bun_core::Error> {
        let this = self;
        this.node.end();

        SourceFileProjectGenerator::generate(this.ctx, this.example_tag, this.entry_point, result)
    }
}

fn run_on_entry_point(
    ctx: &Command::Context,
    example_tag: ExampleTag,
    entry_point: &[u8],
    node: &mut ProgressNode,
) -> Result<(), bun_core::Error> {
    let mut analyzer = Analyzer {
        ctx,
        example_tag,
        entry_point,
        node,
    };

    let fetcher = bun_bundler::bundle_v2::DependenciesScanner::new(
        &mut analyzer,
        vec![Box::<[u8]>::from(entry_point)].into_boxed_slice(),
    );
    crate::cli::build_command::BuildCommand::exec(crate::cli::Command::get(), Some(&fetcher))
}

// `Commands` was a Zig anonymous tuple of three single-element string arrays, used only to
// drive `inline for` over its three fields in GitHandler.run. In Rust we just iterate the
// three git command arrays directly (see GitHandler::run).

pub struct Example {
    pub name: &'static [u8],        // TODO(port): lifetime
    pub version: &'static [u8],     // TODO(port): lifetime
    pub description: &'static [u8], // TODO(port): lifetime
    pub local: bool,
}

impl Default for Example {
    fn default() -> Self {
        Self {
            name: b"",
            version: b"",
            description: b"",
            local: false,
        }
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum ExampleTag {
    Unknown,
    GithubRepository,
    Official,
    LocalFolder,
    JslikeFile,
}

static EXTENSION_TAG_MAP: phf::Map<&'static [u8], ExampleTag> = phf::phf_map! {
    b".tsx" => ExampleTag::JslikeFile,
    b".jsx" => ExampleTag::JslikeFile,
};

impl ExampleTag {
    pub fn from_file_extension(extension: &[u8]) -> Option<ExampleTag> {
        EXTENSION_TAG_MAP.get(extension).copied()
    }
}

// PORTING.md §Global mutable state: single-threaded CLI scratch state →
// RacyCell. `URL_` borrows into the `*_BUF` statics so they must remain
// process-lifetime, not stack locals.
static URL_: bun_core::RacyCell<Option<URL<'static>>> = bun_core::RacyCell::new(None);
static APP_NAME_BUF: bun_core::RacyCell<[u8; 512]> = bun_core::RacyCell::new([0u8; 512]);
static GITHUB_REPOSITORY_URL_BUF: bun_core::RacyCell<[u8; 1024]> =
    bun_core::RacyCell::new([0u8; 1024]);
static NPM_REGISTRY_URL_BUF: bun_core::RacyCell<[u8; 1024]> = bun_core::RacyCell::new([0u8; 1024]);

impl Example {
    const EXAMPLES_URL: &'static [u8] = b"https://registry.npmjs.org/bun-examples-all/latest";

    pub fn print(examples: &[Example], default_app_name: Option<&[u8]>) {
        for example in examples {
            // SAFETY: single-threaded CLI access to static buffer
            let app_name_buf = unsafe { &mut *APP_NAME_BUF.get() };
            let app_name: &[u8] = default_app_name.unwrap_or_else(|| {
                let mut cursor: &mut [u8] = &mut app_name_buf[..];
                let cap = cursor.len();
                write!(
                    &mut cursor,
                    "./{}-app",
                    bstr::BStr::new(&example.name[0..example.name.len().min(492)])
                )
                .expect("unreachable");
                let written = cap - cursor.len();
                &app_name_buf[..written]
            });

            if !example.description.is_empty() {
                Output::pretty(format_args!(
                    "  <r># {}<r>\n  <b>bun create <cyan>{}<r><b> {}<r>\n<d>  \n\n",
                    bstr::BStr::new(example.description),
                    bstr::BStr::new(example.name),
                    bstr::BStr::new(app_name),
                ));
            } else {
                Output::pretty(format_args!(
                    "  <r><b>bun create <cyan>{}<r><b> {}<r>\n\n",
                    bstr::BStr::new(example.name),
                    bstr::BStr::new(app_name),
                ));
            }
        }
    }

    pub fn fetch_all_local_and_remote(
        ctx: &Command::Context,
        mut node: Option<&mut ProgressNode>,
        env_loader: &mut DotEnv::Loader,
        filesystem: &mut fs::FileSystem,
    ) -> Result<Vec<Example>, bun_core::Error> {
        let remote_examples = Example::fetch_all(ctx, env_loader, node.as_deref_mut())?;
        if let Some(node_) = node {
            node_.end();
        }

        let mut examples: Vec<Example> = remote_examples.into_vec();
        {
            // SAFETY: single-threaded CLI access to module-level static path buffer
            let home_dir_buf = unsafe { &mut *HOME_DIR_BUF.get() };
            let mut folders: [bun_sys::Dir; 3] = [
                bun_sys::Dir::from_fd(bun_sys::Fd::invalid()),
                bun_sys::Dir::from_fd(bun_sys::Fd::invalid()),
                bun_sys::Dir::from_fd(bun_sys::Fd::invalid()),
            ];
            if let Some(home_dir) = env_loader.map.get(b"BUN_CREATE_DIR") {
                let parts = [home_dir];
                let outdir_path = filesystem.abs_buf(&parts, home_dir_buf);
                folders[0] = bun_sys::Dir::open(outdir_path)
                    .unwrap_or_else(|_| bun_sys::Dir::from_fd(bun_sys::Fd::invalid()));
            }

            {
                let parts = [filesystem.top_level_dir, BUN_CREATE_DIR];
                let outdir_path = filesystem.abs_buf(&parts, home_dir_buf);
                folders[1] = bun_sys::Dir::open(outdir_path)
                    .unwrap_or_else(|_| bun_sys::Dir::from_fd(bun_sys::Fd::invalid()));
            }

            if let Some(home_dir) = env_loader.map.get(bun_core::env_var::HOME.key()) {
                let parts = [home_dir, BUN_CREATE_DIR];
                let outdir_path = filesystem.abs_buf(&parts, home_dir_buf);
                folders[2] = bun_sys::Dir::open(outdir_path)
                    .unwrap_or_else(|_| bun_sys::Dir::from_fd(bun_sys::Fd::invalid()));
            }

            // subfolders with package.json
            for folder in &folders {
                if folder.fd() != bun_sys::Fd::invalid() {
                    let mut iter = bun_sys::dir_iterator::iterate(folder.fd());

                    'loop_: while let Some(entry) = iter.next().ok().flatten() {
                        let entry_name = entry.name.slice_u8();
                        match entry.kind {
                            bun_sys::FileKind::Directory => {
                                for skip_dir in SKIP_DIRS {
                                    // PORT NOTE: `bun.pathLiteral` is a comptime cast to OSPathSlice
                                    // already applied in the `SKIP_DIRS` literal table; compare directly.
                                    if entry.name.slice() == *skip_dir {
                                        continue 'loop_;
                                    }
                                }

                                home_dir_buf[..entry_name.len()].copy_from_slice(entry_name);
                                home_dir_buf[entry_name.len()] = bun_paths::SEP;
                                home_dir_buf[entry_name.len() + 1..][..b"package.json".len()]
                                    .copy_from_slice(b"package.json");
                                home_dir_buf[entry_name.len() + 1 + b"package.json".len()] = 0;

                                // SAFETY: NUL written at [entry_name.len() + 1 + "package.json".len()]
                                let path = unsafe {
                                    bun_core::ZStr::from_raw_mut(
                                        home_dir_buf.as_mut_ptr(),
                                        entry_name.len() + 1 + b"package.json".len(),
                                    )
                                };

                                // Zig: `folder.accessZ(path, .{ .mode = .read_only })` (std.fs.Dir.accessZ).
                                // bun_sys exposes `faccessat` for F_OK only; use it as the existence
                                // gate here. TODO(port): plumb R_OK once bun_sys grows an accessor.
                                if !bun_sys::faccessat(folder, path).unwrap_or(false) {
                                    continue 'loop_;
                                }

                                examples.push(Example {
                                    name: filesystem.filename_store.append_slice(entry_name)?,
                                    version: b"",
                                    local: true,
                                    description: b"",
                                });
                                continue 'loop_;
                            }
                            _ => continue,
                        }
                    }
                }
            }
        }

        Ok(examples)
    }

    pub fn fetch_from_github(
        _ctx: &Command::Context,
        env_loader: &mut DotEnv::Loader,
        name: &[u8],
        refresher: &mut Progress,
        progress: &mut ProgressNode,
    ) -> Result<MutableString, bun_core::Error> {
        let owner_i = bun_core::index_of_char(name, b'/').unwrap() as usize;
        let owner = &name[0..owner_i];
        let mut repository = &name[owner_i + 1..];

        if let Some(i) = bun_core::index_of_char(repository, b'/') {
            repository = &repository[0..i as usize];
        }

        progress.name = ProgressBuf::pretty(
            "<d>[github] <b>GET<r> <blue>{}/{}<r>",
            format_args!("{}/{}", bstr::BStr::new(owner), bstr::BStr::new(repository)),
        )?;
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
        {
            if !access_token.is_empty() {
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
            mutable,
            b"",
            http_proxy,
            None,
            HTTP::FetchRedirect::Follow,
        ));
        async_http.client.progress_node = Some(core::ptr::NonNull::from(&mut *progress));
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        let response = async_http.send_sync()?;

        match response.status_code {
            404 => return Err(bun_core::err!("GitHubRepositoryNotFound")),
            403 => return Err(bun_core::err!("HTTPForbidden")),
            429 => return Err(bun_core::err!("HTTPTooManyRequests")),
            499..=599 => return Err(bun_core::err!("NPMIsDown")),
            200 => {}
            _ => return Err(bun_core::err!("HTTPError")),
        }

        let content_type: &[u8] = response.headers.get(b"content-type").unwrap_or(b"");
        let is_expected_content_type = content_type == b"application/x-gzip";

        if !is_expected_content_type {
            progress.end();
            refresher.refresh();

            if !content_type.is_empty() {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Unexpected content type from GitHub: {}",
                    bstr::BStr::new(content_type),
                ));
                Global::crash();
            } else {
                Output::pretty_errorln(
                    "<r><red>error<r>: Invalid response from GitHub (missing content type)",
                );
                Global::crash();
            }
        }

        if mutable.list.is_empty() {
            progress.end();
            refresher.refresh();

            Output::pretty_errorln("<r><red>error<r>: Invalid response from GitHub (missing body)");
            Global::crash();
        }

        // TODO(port): Zig returned `mutable.*` (deref-copy of struct). MutableString may need Clone.
        Ok(mutable.clone()?)
    }

    pub fn fetch(
        ctx: &Command::Context,
        env_loader: &mut DotEnv::Loader,
        name: &[u8],
        refresher: &mut Progress,
        progress: &mut ProgressNode,
    ) -> Result<MutableString, bun_core::Error> {
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
        // SAFETY: `api_url` borrows from the process-global `NPM_REGISTRY_URL_BUF`;
        // erase the local reborrow lifetime for storage in `URL_` /
        // `AsyncHTTP::init_sync` (single-threaded CLI; same as
        // `fetch_from_github`).
        unsafe {
            *URL_.get() = Some(api_url.erase_lifetime());
        }

        // SAFETY: `http_proxy` borrows from `env_loader`'s arena-backed map
        // (see `DotEnv::Loader::init(cli_arena().alloc(...))` in `exec`); erase
        // to `'static` for `AsyncHTTP::init_sync` — same as `fetch_from_github`.
        let mut http_proxy: Option<URL<'static>> = env_loader
            .get_http_proxy_for(unsafe { (*URL_.get()).as_ref().unwrap() })
            .map(|u| unsafe { u.erase_lifetime() });

        // ensure very stable memory address
        let async_http: &mut HTTP::AsyncHTTP =
            crate::cli::cli_arena().alloc(HTTP::AsyncHTTP::init_sync(
                HTTP::Method::GET,
                // SAFETY: single-threaded CLI access to static URL_ (set just above)
                unsafe { (*URL_.get()).clone() }.unwrap(),
                Default::default(),
                b"",
                mutable,
                b"",
                http_proxy,
                None,
                HTTP::FetchRedirect::Follow,
            ));
        async_http.client.progress_node = Some(core::ptr::NonNull::from(&mut *progress));
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        let mut response = async_http.send_sync()?;

        match response.status_code {
            404 => return Err(bun_core::err!("ExampleNotFound")),
            403 => return Err(bun_core::err!("HTTPForbidden")),
            429 => return Err(bun_core::err!("HTTPTooManyRequests")),
            499..=599 => return Err(bun_core::err!("NPMIsDown")),
            200 => {}
            _ => return Err(bun_core::err!("HTTPError")),
        }

        progress.name = b"Parsing package.json";
        refresher.refresh();
        bun_ast::initialize_store();
        let source = bun_ast::Source::init_path_string(b"package.json", mutable.list.as_slice());
        // SAFETY: single-threaded CLI dispatch; no other borrow of the
        // process-static `Cli::LOG_` is live across this scope.
        let log = unsafe { ctx.log_mut() };
        let bump: &'static bun_alloc::Arena = crate::cli::cli_arena();
        let expr = match JSON::parse_utf8(&source, log, bump) {
            Ok(e) => e,
            Err(err) => {
                progress.end();
                refresher.refresh();

                if log.errors > 0 {
                    let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                    Global::exit(1);
                } else {
                    Output::pretty_errorln(format_args!(
                        "Error parsing package: <r><red>{}<r>",
                        err.name(),
                    ));
                    Global::exit(1);
                }
            }
        };

        if log.errors > 0 {
            progress.end();
            refresher.refresh();

            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            Global::exit(1);
        } // `bun_ast::Expr` cover the same surface (Zig: `asProperty`/
        // `asString` for parse_utf8-produced UTF-8 literals).
        let tarball_url: &[u8] = 'brk: {
            if let Some(q) = expr.as_property(b"dist") {
                if let Some(p) = q.expr.as_property(b"tarball") {
                    if let Some(s) = p.expr.as_utf8_string_literal() {
                        if !s.is_empty()
                            && (strings::starts_with(s, b"https://")
                                || strings::starts_with(s, b"http://"))
                        {
                            break 'brk crate::cli::cli_dupe(s);
                        }
                    }
                }
            }

            progress.end();
            refresher.refresh();

            Output::pretty_errorln(
                "package.json is missing tarball url. This is an internal error!",
            );
            Global::exit(1);
        };

        progress.name = b"Downloading tarball";
        refresher.refresh();

        // reuse mutable buffer
        // safe because the only thing we care about is the tarball url
        mutable.reset();

        // ensure very stable memory address
        let parsed_tarball_url = URL::parse(tarball_url);

        // SAFETY: see note on `http_proxy` above — env-loader-backed `'static`.
        http_proxy = env_loader
            .get_http_proxy_for(&parsed_tarball_url)
            .map(|u| unsafe { u.erase_lifetime() });

        *async_http = HTTP::AsyncHTTP::init_sync(
            HTTP::Method::GET,
            parsed_tarball_url,
            Default::default(),
            b"",
            mutable,
            b"",
            http_proxy,
            None,
            HTTP::FetchRedirect::Follow,
        );
        async_http.client.progress_node = Some(core::ptr::NonNull::from(&mut *progress));
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        refresher.maybe_refresh();

        response = async_http.send_sync()?;

        refresher.maybe_refresh();

        if response.status_code != 200 {
            progress.end();
            refresher.refresh();
            Output::pretty_errorln(format_args!(
                "Error fetching tarball: <r><red>{}<r>",
                response.status_code,
            ));
            Global::exit(1);
        }

        refresher.refresh();

        // TODO(port): see note above re: returning MutableString by value
        Ok(mutable.clone()?)
    }

    pub fn fetch_all(
        ctx: &Command::Context,
        env_loader: &mut DotEnv::Loader,
        progress_node: Option<&mut ProgressNode>,
    ) -> Result<Box<[Example]>, bun_core::Error> {
        let url = URL::parse(Self::EXAMPLES_URL);
        let http_proxy = env_loader.get_http_proxy_for(&url);

        let mutable: &'static mut MutableString =
            crate::cli::cli_arena().alloc(MutableString::init(2048)?);

        let mut async_http = Box::new(HTTP::AsyncHTTP::init_sync(
            HTTP::Method::GET,
            url,
            Default::default(),
            b"",
            mutable,
            b"",
            http_proxy,
            None,
            HTTP::FetchRedirect::Follow,
        ));
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        if Output::enable_ansi_colors_stdout() {
            async_http.client.progress_node = progress_node.map(core::ptr::NonNull::from);
        }

        let response = match async_http.send_sync() {
            Ok(r) => r,
            Err(err) => {
                if err == bun_core::err!("WouldBlock") {
                    Output::pretty_errorln(
                        "Request timed out while trying to fetch examples list. Please try again",
                    );
                    Global::exit(1);
                } else {
                    Output::pretty_errorln(format_args!(
                        "<r><red>{}<r> while trying to fetch examples list. Please try again",
                        err.name(),
                    ));
                    Global::exit(1);
                }
            }
        };

        if response.status_code != 200 {
            Output::pretty_errorln(format_args!(
                "<r><red>{} {}<r> fetching examples :( ",
                response.status_code,
                bstr::BStr::new(mutable.list.as_slice()),
            ));
            Global::exit(1);
        }

        bun_ast::initialize_store();
        let source = bun_ast::Source::init_path_string(b"examples.json", mutable.list.as_slice());
        // PORT NOTE: Zig passed `ctx.allocator`; ContextData dropped the allocator
        // field (global mimalloc) — use the process-lifetime CLI arena (examples
        // slices borrow from it and the CLI exits shortly after).
        let bump: &'static bun_alloc::Arena = crate::cli::cli_arena();
        // SAFETY: single-threaded CLI dispatch; no other borrow of the
        // process-static `Cli::LOG_` is live across this scope.
        let log = unsafe { ctx.log_mut() };
        let examples_object = match JSON::parse_utf8(&source, log, bump) {
            Ok(e) => e,
            Err(err) => {
                if log.errors > 0 {
                    let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                    Global::exit(1);
                } else {
                    Output::pretty_errorln(format_args!(
                        "Error parsing examples: <r><red>{}<r>",
                        err.name(),
                    ));
                    Global::exit(1);
                }
            }
        };

        if log.errors > 0 {
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            Global::exit(1);
        }

        if let Some(q) = examples_object.as_property(b"examples") {
            if q.expr.data.is_e_object() {
                let count = q
                    .expr
                    .data
                    .e_object()
                    .expect("infallible: variant checked")
                    .properties
                    .len_u32() as usize;

                let mut list: Box<[Example]> = (0..count).map(|_| Example::default()).collect();
                for (i, property) in q
                    .expr
                    .data
                    .e_object()
                    .expect("infallible: variant checked")
                    .properties
                    .slice()
                    .iter()
                    .enumerate()
                {
                    let name = property
                        .key
                        .expect("infallible: prop has key")
                        .data
                        .e_string()
                        .expect("infallible: variant checked")
                        .data
                        .slice();
                    list[i] = Example {
                        name: if let Some(slash) = bun_core::index_of_char(name, b'/') {
                            &name[slash as usize + 1..]
                        } else {
                            name
                        },
                        version: property
                            .value
                            .unwrap()
                            .as_property(b"version")
                            .unwrap()
                            .expr
                            .data
                            .e_string()
                            .unwrap()
                            .data
                            .slice(),
                        description: property
                            .value
                            .unwrap()
                            .as_property(b"description")
                            .unwrap()
                            .expr
                            .data
                            .e_string()
                            .unwrap()
                            .data
                            .slice(),
                        local: false,
                    };
                }
                return Ok(list);
            }
        }

        Output::pretty_errorln(format_args!(
            "Corrupt examples data: expected object but received {}",
            examples_object.data.tag_name(),
        ));
        Global::exit(1);
    }
}

pub(crate) struct CreateListExamplesCommand;

impl CreateListExamplesCommand {
    pub(crate) fn exec(ctx: &Command::Context) -> Result<(), bun_core::Error> {
        let filesystem = fs::FileSystem::init(None)?;
        let mut env_loader: DotEnv::Loader =
            { DotEnv::Loader::init(crate::cli::cli_arena().alloc(DotEnv::Map::init())) };

        env_loader.load_process()?;

        let mut progress = Progress {
            supports_ansi_escape_codes: Output::enable_ansi_colors_stderr(),
            ..Default::default()
        };
        // PORT NOTE: `Progress::start` returns `&mut Node` borrowing `progress`; detach
        // via raw pointer so `progress.refresh()` can re-borrow below (mirrors Zig where
        // both held independent `*Node`/`*Progress` pointers).
        let node: *mut ProgressNode = progress.start(b"Fetching manifest", 0);
        progress.refresh();

        // SAFETY: FileSystem::init returns the process-global singleton; valid for 'static.
        let filesystem = unsafe { &mut *filesystem };
        // SAFETY: `node` points into `progress`, which outlives this call; single-threaded.
        let examples = Example::fetch_all_local_and_remote(
            ctx,
            Some(unsafe { &mut *node }),
            &mut env_loader,
            filesystem,
        )?;
        Output::prettyln(format_args!(
            "Welcome to bun! Create a new project by pasting any of the following:\n",
        ));
        Output::flush();

        Example::print(&examples, None);

        Output::prettyln(format_args!(
            "<r><d>#<r> You can also paste a GitHub repository:\n\n  <b>bun create <cyan>ahfarmer/calculator calc<r>\n",
        ));

        if let Some(homedir) = env_loader.map.get(bun_core::env_var::HOME.key()) {
            Output::prettyln(format_args!(
                "<d>This command is completely optional. To add a new local template, create a folder in {}/.bun-create/. To publish a new template, git clone https://github.com/oven-sh/bun, add a new folder to the \"examples\" folder, and submit a PR.<r>",
                bstr::BStr::new(homedir),
            ));
        } else {
            Output::prettyln(format_args!(
                "<d>This command is completely optional. To add a new local template, create a folder in $HOME/.bun-create/. To publish a new template, git clone https://github.com/oven-sh/bun, add a new folder to the \"examples\" folder, and submit a PR.<r>",
            ));
        }

        Output::flush();
        Ok(())
    }
}

struct GitHandler;

// TODO(port): mutable static atomic + thread handle — single use per process
static SUCCESS: AtomicU32 = AtomicU32::new(0);
static THREAD: bun_core::RacyCell<Option<std::thread::JoinHandle<()>>> =
    bun_core::RacyCell::new(None);

impl GitHandler {
    pub(crate) fn spawn(destination: &[u8], path: &[u8], verbose: bool) {
        SUCCESS.store(0, Ordering::Relaxed);

        // TODO(port): std.Thread.spawn — destination/path borrowed across thread; Zig relied on
        // them being long-lived (filesystem dirname_store / env). Ensure 'static or own.
        // SAFETY: `destination` lives in `filesystem.dirname_store` and `path` in env loader;
        // both are 'static for the CLI process. Extend lifetimes to satisfy `spawn`.
        let destination: &'static [u8] = unsafe { bun_ptr::detach_lifetime(destination) };
        // SAFETY: `path` is owned by the process-lifetime env loader; valid for `'static`.
        let path: &'static [u8] = unsafe { bun_ptr::detach_lifetime(path) };
        let thread = match std::thread::Builder::new()
            .spawn(move || Self::spawn_thread(destination, path, verbose))
        {
            Ok(t) => t,
            Err(err) => {
                Output::pretty_errorln(format_args!("<r><red>{}<r>", err));
                Global::exit(1);
            }
        };
        // SAFETY: single-threaded CLI; written once before wait()
        unsafe { *THREAD.get() = Some(thread) };
    }

    fn spawn_thread(destination: &[u8], path: &[u8], verbose: bool) {
        Output::Source::configure_named_thread(bun_core::zstr!("git"));
        let outcome = if verbose {
            Self::run::<true>(destination, path).unwrap_or(false)
        } else {
            Self::run::<false>(destination, path).unwrap_or(false)
        };

        SUCCESS.store(if outcome { 1 } else { 2 }, Ordering::Release);
        Futex::wake(&SUCCESS, 1);
        Output::flush();
    }

    pub(crate) fn wait() -> bool {
        while SUCCESS.load(Ordering::Acquire) == 0 {
            let _ = Futex::wait(&SUCCESS, 0, Some(1000));
        }

        let outcome = SUCCESS.load(Ordering::Acquire) == 1;
        // SAFETY: THREAD set in spawn() on this same thread before wait() called
        let _ = unsafe { (*THREAD.get()).take() }.unwrap().join();
        outcome
    }

    pub(crate) fn run<const VERBOSE: bool>(
        destination: &[u8],
        path: &[u8],
    ) -> Result<bool, bun_core::Error> {
        let git_start = bun_core::time::nano_timestamp();

        // SAFETY: single-threaded CLI access to module-level static path buffer (note: this fn
        // may run on the git thread; BUN_PATH_BUF is also touched on main thread for `--open`.
        // The two uses are sequenced — git runs before `--open` block. Matches Zig.)
        let bun_path_buf = unsafe { &mut *BUN_PATH_BUF.get() };
        #[cfg(windows)]
        let win_loop = bun_event_loop::EventLoopHandle::init_mini(
            bun_event_loop::MiniEventLoop::init_global(None, None),
        );
        if let Some(git) = which(bun_path_buf, path, destination, b"git") {
            let git: &[u8] = git.as_bytes();
            let git_commands: [&[&[u8]]; 3] = [
                &[git, b"init", b"--quiet"],
                &[git, b"add", destination, b"--ignore-errors"],
                &[
                    git,
                    b"commit",
                    b"-am",
                    b"Initial commit (via bun create)",
                    b"--quiet",
                ],
            ];

            if VERBOSE {
                Output::pretty_errorln(format_args!("git backend: {}", bstr::BStr::new(git)));
            }

            // same names, just comptime known values
            // PORT NOTE: Zig used `inline for` over std.meta.fieldNames(@TypeOf(Commands)) to
            // index into git_commands by tuple field index. We just iterate the array directly.
            for command in git_commands {
                // Zig used `std.process.Child`; PORTING.md bans std::process — use bun.spawnSync.
                let _ = spawn_sync::spawn(&spawn_sync::Options {
                    argv: command.iter().map(|s| Box::<[u8]>::from(*s)).collect(),
                    cwd: Box::from(destination),
                    stdin: spawn_sync::SyncStdio::Inherit,
                    stdout: spawn_sync::SyncStdio::Inherit,
                    stderr: spawn_sync::SyncStdio::Inherit,
                    #[cfg(windows)]
                    windows: spawn_sync::WindowsOptions {
                        loop_: win_loop,
                        ..Default::default()
                    },
                    #[cfg(not(windows))]
                    windows: (),
                    ..Default::default()
                })?;
            }

            Output::pretty_error("\n");
            Output::print_start_end(git_start, bun_core::time::nano_timestamp());
            Output::pretty_error(" <d>git<r>\n");
            return Ok(true);
        }

        Ok(false)
    }
}

// ported from: src/cli/create_command.zig
