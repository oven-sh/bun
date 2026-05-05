use core::sync::atomic::{AtomicU32, Ordering};
use std::cell::Cell;
use std::io::Write as _;

use bun_core::{Global, Output, Progress, Futex};
use bun_str::{strings, MutableString};
use bun_paths::{self as resolve_path, PathBuffer, OSPathSlice};
use bun_logger as logger;
use bun_js_parser::ast as js_ast;
use bun_json as JSON;
use bun_js_printer as JSPrinter;
use bun_http as HTTP;
use bun_http::Headers;
use bun_libarchive::Archiver;
use bun_dotenv as DotEnv;
use bun_resolver::fs;
use bun_zlib as Zlib;
use bun_sys::copy_file as CopyFile;
use bun_url::URL;
use bun_which::which;
use bun_clap as clap;

use crate::Command;
use crate::which_npm_client::NPMClient;
use crate::create::SourceFileProjectGenerator;

// TODO(port): mutable global PathBuffer — wrap appropriately for thread-safety in Phase B
static mut BUN_PATH_BUF: PathBuffer = PathBuffer::ZEROED;

const TARGET_NEXTJS_VERSION: &[u8] = b"12.2.3";
pub static mut INITIALIZED_STORE: bool = false;
pub fn initialize_store() {
    // SAFETY: single-threaded CLI init
    unsafe {
        if INITIALIZED_STORE {
            return;
        }
        INITIALIZED_STORE = true;
    }
    js_ast::Expr::Data::Store::create();
    js_ast::Stmt::Data::Store::create();
}

// TODO(port): bun.OSPathLiteral — use bun_paths::os_path_literal! macro for cross-platform u8/u16 literals
const SKIP_DIRS: &[OSPathSlice] = &[
    bun_paths::os_path_literal!("node_modules"),
    bun_paths::os_path_literal!(".git"),
];
const SKIP_FILES: &[OSPathSlice] = &[
    bun_paths::os_path_literal!("package-lock.json"),
    bun_paths::os_path_literal!("yarn.lock"),
    bun_paths::os_path_literal!("pnpm-lock.yaml"),
];

const NEVER_CONFLICT: &[&[u8]] = &[
    b"README.md",
    b"gitignore",
    b".gitignore",
    b".git/",
];

const NPM_TASK_ARGS: &[&[u8]] = &[b"run"];

#[derive(Default)]
struct UnsupportedPackages {
    styled_jsx: bool,
}

impl UnsupportedPackages {
    pub fn update(&mut self, expr: js_ast::Expr) {
        for prop in expr.data.e_object().properties.slice() {
            // inline for over field names — only one field: "styled-jsx"
            if prop.key.unwrap().data.e_string().data == b"styled-jsx" {
                self.styled_jsx = true;
            }
        }
    }

    pub fn print(&self) {
        if self.styled_jsx {
            Output::pretty_errorln(
                "<r><yellow>warn<r><d>:<r> <b>\"{}\"<r> won't work in bun yet\n",
                format_args!("{}", "styled-jsx"),
            );
        }
    }
}

// TODO(port): mutable global — single-threaded CLI usage
static mut BUN_PATH: Option<&'static bun_str::ZStr> = None;

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
    let mut argv: Vec<&[u8]> = Vec::with_capacity(total);
    // SAFETY: we fill all `total` entries below before reading
    unsafe { argv.set_len(total) };

    if let Some(ref client) = npm_client {
        argv[0] = client.bin;
        argv[1] = NPM_TASK_ARGS[0];
    }

    {
        let mut i: usize = npm_args;
        for split in task.split(|b| *b == b' ') {
            argv[i] = split;
            i += 1;
        }
    }

    let mut argv: &[&[u8]] = &argv;
    if npm_client.is_some() && strings::starts_with(task, b"bun ") {
        argv = &argv[2..];
    }

    Output::pretty("\n<r><d>$<b>", format_args!(""));
    for (i, arg) in argv.iter().enumerate() {
        if i > argv.len() - 1 {
            Output::print(format_args!(" {} ", bstr::BStr::new(arg)));
        } else {
            Output::print(format_args!(" {}", bstr::BStr::new(arg)));
        }
    }
    Output::pretty("<r>", format_args!(""));
    Output::print(format_args!("\n"));
    Output::flush();

    Output::disable_buffering();
    let _reenable = scopeguard::guard((), |_| Output::enable_buffering());

    let _ = bun_core::spawn_sync(&bun_core::SpawnOptions {
        argv,
        envp: None,
        cwd,
        stderr: bun_core::Stdio::Inherit,
        stdout: bun_core::Stdio::Inherit,
        stdin: bun_core::Stdio::Inherit,
        #[cfg(windows)]
        windows: bun_core::WindowsSpawnOptions {
            loop_: bun_jsc::EventLoopHandle::init(bun_event_loop::MiniEventLoop::init_global(None, None)),
        },
        ..Default::default()
    });
}

// We don't want to allocate memory each time
// But we cannot print over an existing buffer or weird stuff will happen
// so we keep two and switch between them
pub struct ProgressBuf;

impl ProgressBuf {
    // TODO(port): mutable global buffers — single-threaded CLI usage
    thread_local! {
        static BUFS: core::cell::RefCell<[[u8; 1024]; 2]> = const { core::cell::RefCell::new([[0u8; 1024]; 2]) };
        static BUF_INDEX: Cell<usize> = const { Cell::new(0) };
    }

    pub fn print(args: core::fmt::Arguments<'_>) -> Result<&'static [u8], bun_core::Error> {
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
            let out: &'static [u8] = unsafe { core::mem::transmute::<&[u8], &'static [u8]>(&buf[..written]) };
            Ok(out)
        })
    }

    pub fn pretty(fmt: &'static str, args: core::fmt::Arguments<'_>) -> Result<&'static [u8], bun_core::Error> {
        // TODO(port): Output.prettyFmt is a comptime fmt-string transform; emulate via runtime branch
        if Output::enable_ansi_colors_stdout() {
            ProgressBuf::print(format_args!("{}", Output::pretty_fmt::<true>(fmt, args)))
        } else {
            ProgressBuf::print(format_args!("{}", Output::pretty_fmt::<false>(fmt, args)))
        }
    }
}

#[derive(Default)]
struct CreateOptions {
    npm_client: Option<crate::which_npm_client::NPMClientTag>,
    skip_install: bool,
    overwrite: bool,
    skip_git: bool,
    skip_package_json: bool,
    positionals: Box<[&'static [u8]]>, // TODO(port): lifetime — borrows from clap args
    verbose: bool,
    open: bool,
}

impl CreateOptions {
    // TODO(port): clap.parseParam at comptime — represent as static array initialized via clap macros in Phase B
    fn params() -> &'static [clap::Param<clap::Help>] {
        static PARAMS: once_cell::sync::Lazy<[clap::Param<clap::Help>; 8]> = once_cell::sync::Lazy::new(|| {
            [
                clap::parse_param("-h, --help                     Print this menu").expect("unreachable"),
                clap::parse_param("--force                        Overwrite existing files").expect("unreachable"),
                clap::parse_param("--no-install                   Don't install node_modules").expect("unreachable"),
                clap::parse_param("--no-git                       Don't create a git repository").expect("unreachable"),
                clap::parse_param("--verbose                      Too many logs").expect("unreachable"),
                clap::parse_param("--no-package-json              Disable package.json transforms").expect("unreachable"),
                clap::parse_param("--open                         On finish, start bun & open in-browser").expect("unreachable"),
                clap::parse_param("<POS>...                       ").expect("unreachable"),
            ]
        });
        &*PARAMS
    }

    pub fn parse(ctx: &Command::Context) -> Result<CreateOptions, bun_core::Error> {
        Output::set_is_verbose(Output::is_verbose());

        let mut diag = clap::Diagnostic::default();

        let args = match clap::parse(clap::Help, Self::params(), clap::ParseOptions { diagnostic: Some(&mut diag), ..Default::default() }) {
            Ok(a) => a,
            Err(err) => {
                // Report useful error and exit
                let _ = diag.report(Output::error_writer(), err);
                return Err(err);
            }
        };

        let mut opts = CreateOptions {
            positionals: args.positionals().into(),
            ..Default::default()
        };

        if opts.positionals.len() >= 1
            && (opts.positionals[0] == b"c" || opts.positionals[0] == b"create")
        {
            // TODO(port): re-slicing Box<[T]> — store as Vec or slice with offset in Phase B
            opts.positionals = opts.positionals[1..].to_vec().into_boxed_slice();
        }

        opts.skip_package_json = args.flag("--no-package-json");

        opts.verbose = args.flag("--verbose") || Output::is_verbose();
        opts.open = args.flag("--open");
        opts.skip_install = args.flag("--no-install");
        opts.skip_git = args.flag("--no-git");
        opts.overwrite = args.flag("--force");

        Ok(opts)
    }
}

const BUN_CREATE_DIR: &[u8] = b".bun-create";
// TODO(port): mutable global PathBuffer — single-threaded CLI usage
static mut HOME_DIR_BUF: PathBuffer = PathBuffer::ZEROED;

pub struct CreateCommand;

impl CreateCommand {
    #[cold]
    pub fn exec(
        ctx: &Command::Context,
        example_tag: ExampleTag,
        template: &[u8],
    ) -> Result<(), bun_core::Error> {
        Global::configure_allocator(bun_core::AllocatorConfig { long_running: false });
        HTTP::HTTPThread::init(&Default::default());

        let mut create_options = CreateOptions::parse(ctx)?;
        let positionals = &create_options.positionals;

        if positionals.is_empty() {
            return CreateListExamplesCommand::exec(ctx);
        }

        let filesystem = fs::FileSystem::init(None)?;
        let mut env_loader: DotEnv::Loader = {
            let map = Box::new(DotEnv::Map::init());
            DotEnv::Loader::init(Box::leak(map))
        };

        env_loader.load_process()?;

        let dirname: &[u8] = if positionals.len() == 1 {
            bun_paths::basename(template)
        } else {
            positionals[1]
        };

        let destination = filesystem
            .dirname_store
            .append(resolve_path::join_abs(filesystem.top_level_dir, resolve_path::Style::Loose, dirname))?;

        let mut progress = Progress::default();
        progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        let mut node = match example_tag {
            ExampleTag::JslikeFile => progress.start(
                ProgressBuf::print(format_args!("Analyzing {}", bstr::BStr::new(template)))?,
                0,
            ),
            _ => progress.start(
                ProgressBuf::print(format_args!("Loading {}", bstr::BStr::new(template)))?,
                0,
            ),
        };

        // alacritty is fast
        if env_loader.map.get(b"ALACRITTY_LOG").is_some() {
            progress.refresh_rate_ns = bun_core::time::NS_PER_MS * 8;
        }

        let _refresh_on_exit = scopeguard::guard((), |_| progress.refresh());
        // PORT NOTE: reshaped for borrowck — original Zig had `defer progress.refresh()`;
        // we call progress.refresh() at fn exit explicitly because progress is borrowed mutably below.
        // TODO(port): verify scopeguard borrow doesn't conflict with &mut progress uses below

        let mut package_json_contents: MutableString = MutableString::default();
        let mut package_json_file: Option<bun_sys::File> = None;

        if example_tag != ExampleTag::LocalFolder {
            if create_options.verbose {
                Output::pretty_errorln(
                    "Downloading as {}\n",
                    format_args!("{}", <&'static str>::from(example_tag)),
                );
            }
        }

        match example_tag {
            ExampleTag::JslikeFile => {
                return run_on_entry_point(ctx, example_tag, template, &mut progress, &mut node);
            }
            ExampleTag::GithubRepository | ExampleTag::Official => {
                let tarball_bytes: MutableString = match example_tag {
                    ExampleTag::Official => match Example::fetch(ctx, &mut env_loader, template, &mut progress, &mut node) {
                        Ok(b) => b,
                        Err(err) => {
                            if err == bun_core::err!("HTTPForbidden") || err == bun_core::err!("ExampleNotFound") {
                                node.end();
                                progress.refresh();

                                Output::pretty_error(
                                    "\n<r><red>error:<r> <b>\"{}\"<r> was not found. Here are templates you can use:\n\n",
                                    format_args!("{}", bstr::BStr::new(template)),
                                );
                                Output::flush();

                                let examples = Example::fetch_all_local_and_remote(ctx, None, &mut env_loader, filesystem)?;
                                Example::print(&examples, Some(dirname));
                                Global::exit(1);
                            } else {
                                node.end();
                                progress.refresh();

                                Output::pretty_errorln("\n\n", format_args!(""));

                                return Err(err);
                            }
                        }
                    },
                    ExampleTag::GithubRepository => match Example::fetch_from_github(ctx, &mut env_loader, template, &mut progress, &mut node) {
                        Ok(b) => b,
                        Err(err) => {
                            if err == bun_core::err!("HTTPForbidden") {
                                node.end();
                                progress.refresh();

                                Output::pretty_error(
                                    "\n<r><red>error:<r> GitHub returned 403. This usually means GitHub is rate limiting your requests.\nTo fix this, either:<r>  <b>A) pass a <r><cyan>GITHUB_ACCESS_TOKEN<r> environment variable to bun<r>\n  <b>B)Wait a little and try again<r>\n",
                                    format_args!(""),
                                );
                                Global::crash();
                            } else if err == bun_core::err!("GitHubRepositoryNotFound") {
                                node.end();
                                progress.refresh();

                                Output::pretty_error(
                                    "\n<r><red>error:<r> <b>\"{}\"<r> was not found on GitHub. Here are templates you can use:\n\n",
                                    format_args!("{}", bstr::BStr::new(template)),
                                );
                                Output::flush();

                                let examples = Example::fetch_all_local_and_remote(ctx, None, &mut env_loader, filesystem)?;
                                Example::print(&examples, Some(dirname));
                                Global::crash();
                            } else {
                                node.end();
                                progress.refresh();

                                Output::pretty_errorln("\n\n", format_args!(""));

                                return Err(err);
                            }
                        }
                    },
                    _ => unreachable!(),
                };

                node.name = ProgressBuf::print(format_args!("Decompressing {}", bstr::BStr::new(template)))?;
                node.set_completed_items(0);
                node.set_estimated_total_items(0);

                progress.refresh();

                let file_buf = vec![0u8; 16384];

                // TODO(port): ArrayListUnmanaged with pre-allocated buffer — using Vec directly
                let mut tarball_buf_list: Vec<u8> = file_buf;
                let mut gunzip = Zlib::ZlibReaderArrayList::init(tarball_bytes.list.as_slice(), &mut tarball_buf_list)?;
                gunzip.read_all(true)?;
                drop(gunzip);

                node.name = ProgressBuf::print(format_args!("Extracting {}", bstr::BStr::new(template)))?;
                node.set_completed_items(0);
                node.set_estimated_total_items(0);

                progress.refresh();

                let mut pluckers: [Archiver::Plucker; 1] = if !create_options.skip_package_json {
                    [Archiver::Plucker::init(bun_paths::os_path_literal!("package.json"), 2048)?]
                } else {
                    // SAFETY: never read when skip_package_json is true
                    [unsafe { core::mem::zeroed() }]
                };

                let mut archive_context = Archiver::Context {
                    pluckers: &mut pluckers[0..usize::from(!create_options.skip_package_json)],
                    all_files: Default::default(), // undefined in Zig
                    overwrite_list: bun_collections::StringArrayHashMap::<()>::default(),
                };

                if !create_options.overwrite {
                    Archiver::get_overwriting_file_list(
                        &tarball_buf_list,
                        destination,
                        &mut archive_context,
                        &filesystem.dirname_store,
                        1,
                    )?;

                    for never_conflict_path in NEVER_CONFLICT {
                        let _ = archive_context.overwrite_list.swap_remove(never_conflict_path);
                    }

                    if archive_context.overwrite_list.count() > 0 {
                        node.end();
                        progress.refresh();

                        // Thank you create-react-app for this copy (and idea)
                        Output::pretty_errorln(
                            "<r>\n<red>error<r><d>: <r>The directory <b><blue>{}<r>/ contains files that could conflict:\n\n",
                            format_args!("{}", bstr::BStr::new(bun_paths::basename(destination))),
                        );
                        for path in archive_context.overwrite_list.keys() {
                            if strings::ends_with(path, bun_paths::SEP_STR.as_bytes()) {
                                Output::pretty_error(
                                    "<r>  <blue>{}<r>",
                                    format_args!("{}", bstr::BStr::new(&path[0..path.len().max(1) - 1])),
                                );
                                Output::pretty_errorln(bun_paths::SEP_STR, format_args!(""));
                            } else {
                                Output::pretty_errorln("<r>  {}", format_args!("{}", bstr::BStr::new(path)));
                            }
                        }

                        Output::pretty_errorln(
                            "<r>\n<d>To download {} anyway, use --force<r>",
                            format_args!("{}", bstr::BStr::new(template)),
                        );
                        Global::exit(1);
                    }
                }

                let _ = Archiver::extract_to_disk(
                    &tarball_buf_list,
                    destination,
                    &mut archive_context,
                    (),
                    Archiver::ExtractOptions { depth_to_skip: 1, ..Default::default() },
                )?;

                if !create_options.skip_package_json {
                    let plucker = &pluckers[0];

                    if plucker.found && plucker.fd.is_valid() {
                        node.name = b"Updating package.json";
                        progress.refresh();

                        package_json_contents = plucker.contents.clone();
                        package_json_file = Some(plucker.fd.to_file());
                    }
                }
            }
            ExampleTag::LocalFolder => {
                let template_parts = [template];

                node.name = b"Copying files";
                progress.refresh();

                let abs_template_path = filesystem.abs(&template_parts);
                // TODO(port): std.fs.openDirAbsolute — use bun_sys directory APIs
                let template_dir = match bun_sys::Dir::open_absolute(abs_template_path, bun_sys::DirOpenOptions { iterate: true }) {
                    Ok(d) => d,
                    Err(err) => {
                        node.end();
                        progress.refresh();

                        Output::pretty_errorln(
                            "<r><red>{}<r>: opening dir {}",
                            format_args!("{} {}", err.name(), bstr::BStr::new(template)),
                        );
                        Global::exit(1);
                    }
                };

                let _ = bun_sys::delete_tree_absolute(destination);
                let destination_dir__ = match bun_sys::Fd::cwd().make_open_path(destination) {
                    Ok(d) => d,
                    Err(err) => {
                        node.end();
                        progress.refresh();

                        Output::pretty_errorln(
                            "<r><red>{}<r>: creating dir {}",
                            format_args!("{} {}", err.name(), bstr::BStr::new(destination)),
                        );
                        Global::exit(1);
                    }
                };

                #[cfg(windows)]
                let mut destination_buf: bun_paths::WPathBuffer = bun_paths::WPathBuffer::uninit();
                #[cfg(windows)]
                let dst_without_trailing_slash: &[u8] = strings::without_trailing_slash(destination);
                #[cfg(windows)]
                {
                    strings::copy_u8_into_u16(&mut destination_buf, dst_without_trailing_slash);
                    destination_buf[dst_without_trailing_slash.len()] = bun_paths::SEP as u16;
                }

                #[cfg(windows)]
                let mut template_path_buf: bun_paths::WPathBuffer = bun_paths::WPathBuffer::uninit();
                #[cfg(windows)]
                let src_without_trailing_slash: &[u8] = strings::without_trailing_slash(abs_template_path);
                #[cfg(windows)]
                {
                    strings::copy_u8_into_u16(&mut template_path_buf, src_without_trailing_slash);
                    template_path_buf[src_without_trailing_slash.len()] = bun_paths::SEP as u16;
                }

                let destination_dir = destination_dir__;
                let mut walker_ = bun_sys::walker_skippable::Walker::walk(
                    bun_sys::Fd::from_std_dir(template_dir),
                    SKIP_FILES,
                    SKIP_DIRS,
                )?;

                file_copier_copy(
                    destination_dir,
                    &mut walker_,
                    &mut node,
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

                package_json_file = bun_sys::File::openat(
                    destination_dir,
                    b"package.json",
                    bun_sys::O::RDWR,
                    0,
                )
                .ok();

                'read_package_json: {
                    if let Some(ref pkg) = package_json_file {
                        let size: u64 = 'brk: {
                            #[cfg(windows)]
                            {
                                break 'brk pkg.get_end_pos()?;
                            }
                            #[cfg(not(windows))]
                            {
                                let stat = match pkg.stat() {
                                    Ok(s) => s,
                                    Err(err) => {
                                        node.end();
                                        progress.refresh();

                                        package_json_file = None;
                                        Output::pretty_errorln(
                                            "Error reading package.json: <r><red>{}",
                                            format_args!("{}", err.name()),
                                        );
                                        break 'read_package_json;
                                    }
                                };

                                if stat.kind() != bun_sys::FileKind::File || stat.size() == 0 {
                                    package_json_file = None;
                                    node.end();
                                    progress.refresh();
                                    break 'read_package_json;
                                }

                                break 'brk stat.size();
                            }
                        };

                        package_json_contents = MutableString::init(usize::try_from(size).unwrap())?;
                        package_json_contents.list.expand_to_capacity();

                        #[cfg(windows)]
                        let prev_file_pos = pkg.get_pos()?;
                        #[cfg(not(windows))]
                        let _prev_file_pos: u64 = 0;

                        if let Err(err) = pkg.pread_all(package_json_contents.list.as_mut_slice(), 0) {
                            package_json_file = None;
                            node.end();
                            progress.refresh();

                            Output::pretty_errorln(
                                "Error reading package.json: <r><red>{}",
                                format_args!("{}", err.name()),
                            );
                            break 'read_package_json;
                        }
                        #[cfg(windows)]
                        pkg.seek_to(prev_file_pos)?;
                        // The printer doesn't truncate, so we must do so manually
                        let _ = bun_sys::ftruncate(pkg.handle(), 0);

                        initialize_store();
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
            let parent_dir = bun_sys::Dir::open_absolute(destination, Default::default())?;
            #[cfg(windows)]
            {
                let _ = parent_dir.copy_file(b"gitignore", &parent_dir, b".gitignore", Default::default());
            }
            #[cfg(not(windows))]
            {
                let _ = bun_sys::linkat(parent_dir.fd(), b"gitignore", parent_dir.fd(), b".gitignore", 0);
            }

            let _ = bun_sys::unlinkat(parent_dir.fd(), b"gitignore", 0);
            let _ = bun_sys::unlinkat(parent_dir.fd(), b".npmignore", 0);
            // parent_dir dropped here -> closed
        }

        let mut start_command: &[u8] = b"bun dev";

        'process_package_json: {
            if create_options.skip_package_json {
                package_json_file = None;
            }

            if package_json_file.is_some() {
                initialize_store();

                let source = logger::Source::init_path_string(b"package.json", package_json_contents.list.as_slice());

                let mut package_json_expr = match JSON::parse_utf8(&source, ctx.log, /* allocator */) {
                    Ok(e) => e,
                    Err(_) => {
                        package_json_file = None;
                        break 'process_package_json;
                    }
                };

                if !package_json_expr.data.is_e_object() {
                    package_json_file = None;
                    break 'process_package_json;
                }

                let mut properties_list: Vec<js_ast::G::Property> =
                    package_json_expr.data.e_object_mut().properties.slice().to_vec();
                // PORT NOTE: Zig used fromOwnedSlice; here we copy into Vec for mutation.

                if ctx.log.errors > 0 {
                    ctx.log.print(Output::error_writer())?;

                    package_json_file = None;
                    break 'process_package_json;
                }

                if let Some(name_expr) = package_json_expr.as_property(b"name") {
                    if name_expr.expr.data.is_e_string() {
                        let basename = bun_paths::basename(destination);
                        // SAFETY: casting away const to match Zig's @ptrFromInt(@intFromPtr(...))
                        // pattern; the string is never mutated through this pointer.
                        name_expr.expr.data.e_string_mut().data = unsafe {
                            core::slice::from_raw_parts_mut(basename.as_ptr() as *mut u8, basename.len())
                        };
                    }
                }

                // const Needs = struct {
                //     bun_bun_for_nextjs: bool = false,
                //     bun_macro_relay: bool = false,
                //     bun_macro_relay_dependency: bool = false,
                //     bun_framework_next: bool = false,
                //     react_refresh: bool = false,
                // };
                // var needs = Needs{};
                // var has_relay = false;
                // var has_bun_framework_next = false;
                // var has_react_refresh = false;
                // var has_bun_macro_relay = false;
                // var has_react = false;
                // var has_react_scripts = false;

                // const Prune = struct {
                //     pub const packages = ComptimeStringMap(void, .{
                //         .{ "@parcel/babel-preset", {} },
                //         .{ "@parcel/core", {} },
                //         .{ "@swc/cli", {} },
                //         .{ "@swc/core", {} },
                //         .{ "@webpack/cli", {} },
                //         .{ "react-scripts", {} },
                //         .{ "webpack-cli", {} },
                //         .{ "webpack", {} },
                //         // one of cosmic config's imports breaks stuff
                //         .{ "cosmiconfig", {} },
                //     });
                //     pub var prune_count: u16 = 0;
                //
                //     pub fn prune(list: []js_ast.G.Property) []js_ast.G.Property {
                //         var i: usize = 0;
                //         var out_i: usize = 0;
                //         while (i < list.len) : (i += 1) {
                //             const key = list[i].key.?.data.e_string.data;
                //             const do_prune = packages.has(key);
                //             prune_count += @as(u16, @intCast(@intFromBool(do_prune)));
                //             if (!do_prune) {
                //                 list[out_i] = list[i];
                //                 out_i += 1;
                //             }
                //         }
                //         return list[0..out_i];
                //     }
                // };

                let mut dev_dependencies: Option<js_ast::Expr> = None;
                let mut dependencies: Option<js_ast::Expr> = None;

                if let Some(q) = package_json_expr.as_property(b"devDependencies") {
                    let property = q.expr;

                    if property.data.is_e_object() && property.data.e_object().properties.len() > 0 {
                        // unsupported_packages.update(property);
                        // has_react_scripts = has_react_scripts or property.hasAnyPropertyNamed(&.{"react-scripts"});
                        // has_relay = has_relay or property.hasAnyPropertyNamed(&.{ "react-relay", "relay-runtime", "babel-plugin-relay" });
                        // property.data.e_object.properties = js_ast.G.Property.List.fromBorrowedSliceDangerous(Prune.prune(property.data.e_object.properties.slice()));
                        if property.data.e_object().properties.len() > 0 {
                            has_dependencies = true;
                            dev_dependencies = Some(q.expr);

                            // has_bun_framework_next = has_bun_framework_next or property.hasAnyPropertyNamed(&.{"bun-framework-next"});
                            // has_react = has_react or property.hasAnyPropertyNamed(&.{ "react", "react-dom", "react-relay", "@emotion/react" });
                            // has_bun_macro_relay = has_bun_macro_relay or property.hasAnyPropertyNamed(&.{"bun-macro-relay"});
                            // has_react_refresh = has_react_refresh or property.hasAnyPropertyNamed(&.{"react-refresh"});
                        }
                    }
                }

                if let Some(q) = package_json_expr.as_property(b"dependencies") {
                    let property = q.expr;

                    if property.data.is_e_object() && property.data.e_object().properties.len() > 0 {
                        // unsupported_packages.update(property);
                        // has_react_scripts = has_react_scripts or property.hasAnyPropertyNamed(&.{"react-scripts"});
                        // has_relay = has_relay or property.hasAnyPropertyNamed(&.{ "react-relay", "relay-runtime", "babel-plugin-relay" });
                        // property.data.e_object.properties = js_ast.G.Property.List.fromBorrowedSliceDangerous(Prune.prune(property.data.e_object.properties.slice()));
                        if property.data.e_object().properties.len() > 0 {
                            has_dependencies = true;
                            dependencies = Some(q.expr);

                            // if (property.asProperty("next")) |next_q| {
                            //     is_nextjs = true;
                            //     needs.bun_bun_for_nextjs = true;
                            //     next_q.expr.data.e_string.data = @constCast(target_nextjs_version);
                            // }
                            // has_bun_framework_next = has_bun_framework_next or property.hasAnyPropertyNamed(&.{"bun-framework-next"});
                            // has_react = has_react or is_nextjs or property.hasAnyPropertyNamed(&.{ "react", "react-dom", "react-relay", "@emotion/react" });
                            // has_react_refresh = has_react_refresh or property.hasAnyPropertyNamed(&.{"react-refresh"});
                            // has_bun_macro_relay = has_bun_macro_relay or property.hasAnyPropertyNamed(&.{"bun-macro-relay"});
                        }
                    }
                }

                let _ = (dev_dependencies, dependencies);

                // needs.bun_macro_relay = !has_bun_macro_relay and has_relay;
                // needs.react_refresh = !has_react_refresh and has_react;
                // needs.bun_framework_next = is_nextjs and !has_bun_framework_next;
                // needs.bun_bun_for_nextjs = is_nextjs;
                // needs.bun_macro_relay_dependency = needs.bun_macro_relay;
                // var bun_bun_for_react_scripts = false;
                //
                // var bun_macros_prop: ?js_ast.Expr = null;
                // var bun_prop: ?js_ast.Expr = null;
                // var bun_relay_prop: ?js_ast.Expr = null;
                //
                // var needs_bun_prop = needs.bun_macro_relay or has_bun_macro_relay;
                // var needs_bun_macros_prop = needs_bun_prop;
                //
                // if (needs_bun_macros_prop) {
                //     if (package_json_expr.asProperty("bun")) |bun_| {
                //         needs_bun_prop = false;
                //         bun_prop = bun_.expr;
                //         if (bun_.expr.asProperty("macros")) |macros_q| {
                //             bun_macros_prop = macros_q.expr;
                //             needs_bun_macros_prop = false;
                //             if (macros_q.expr.asProperty("react-relay")) |react_relay_q| {
                //                 bun_relay_prop = react_relay_q.expr;
                //                 needs.bun_macro_relay = react_relay_q.expr.asProperty("graphql") == null;
                //             }
                //             if (macros_q.expr.asProperty("babel-plugin-relay/macro")) |react_relay_q| {
                //                 bun_relay_prop = react_relay_q.expr;
                //                 needs.bun_macro_relay = react_relay_q.expr.asProperty("graphql") == null;
                //             }
                //         }
                //     }
                // }
                //
                // if (Prune.prune_count > 0) {
                //     Output.prettyErrorln("<r><d>[package.json] Pruned {d} unnecessary packages<r>", .{Prune.prune_count});
                // }
                //
                // if (create_options.verbose) {
                //   if (needs.bun_macro_relay) {
                //       Output.prettyErrorln("<r><d>[package.json] Detected Relay -> added \"bun-macro-relay\"<r>", .{});
                //   }
                //   if (needs.react_refresh) {
                //       Output.prettyErrorln("<r><d>[package.json] Detected React -> added \"react-refresh\"<r>", .{});
                //   }
                //   if (needs.bun_framework_next) {
                //       Output.prettyErrorln("<r><d>[package.json] Detected Next -> added \"bun-framework-next\"<r>", .{});
                //   } else if (is_nextjs) {
                //       Output.prettyErrorln("<r><d>[package.json] Detected Next.js<r>", .{});
                //   }
                // }
                //
                // var needs_to_inject_dev_dependency = needs.react_refresh or needs.bun_macro_relay;
                // var needs_to_inject_dependency = needs.bun_framework_next;
                //
                // const dependencies_to_inject_count = @as(usize, @intCast(@intFromBool(needs.bun_framework_next)));
                //
                // const dev_dependencies_to_inject_count = @as(usize, @intCast(@intFromBool(needs.react_refresh))) +
                //     @as(usize, @intCast(@intFromBool(needs.bun_macro_relay)));
                //
                // const new_properties_count = @as(usize, @intCast(@intFromBool(needs_to_inject_dev_dependency and dev_dependencies == null))) +
                //     @as(usize, @intCast(@intFromBool(needs_to_inject_dependency and dependencies == null))) +
                //     @as(usize, @intCast(@intFromBool(needs_bun_prop)));
                //
                // if (new_properties_count != 0) {
                //     try properties_list.ensureUnusedCapacity(new_properties_count);
                // }

                use js_ast::E;

                // TODO(port): InjectionPrefill — large block of mutable static AST nodes used to
                // inject "bun"/"macros"/dependency properties into package.json. The Zig code builds
                // a tree of `E.String`/`E.Object`/`G.Property` values stored in `pub var` statics
                // and wires their `.properties` lists together at runtime. In Rust, mutable statics
                // of non-Sync AST types require careful redesign (likely thread_local! + Lazy or
                // building the tree on the stack/arena per call). Since every consumer of
                // InjectionPrefill below is commented out except `npx_react_scripts_build` and the
                // three `.properties =` wiring lines (which themselves only feed commented-out
                // code), we stub the module here and leave the full structure as a comment for
                // Phase B reference.
                mod injection_prefill {
                    use super::*;
                    pub const DEPENDENCIES_STRING: &[u8] = b"dependencies";
                    pub const DEV_DEPENDENCIES_STRING: &[u8] = b"devDependencies";
                    pub const BUN_STRING: &[u8] = b"bun";
                    pub const MACROS_STRING: &[u8] = b"macros";
                    pub const BUN_MACROS_RELAY_PATH: &[u8] = b"bun-macro-relay";

                    // pub var dependencies_e_string = E.String.init(dependencies_string);
                    // pub var devDependencies_e_string = E.String.init(dev_dependencies_string);
                    // pub var bun_e_string = E.String.init(bun_string);
                    // pub var macros_e_string = E.String.init(macros_string);
                    // pub var react_relay_string = E.String.init("react-relay");
                    // pub var bun_macros_relay_path_string = E.String.init("bun-macro-relay");
                    // pub var babel_plugin_relay_macro = E.String.init("babel-plugin-relay/macro");
                    // pub var babel_plugin_relay_macro_js = E.String.init("babel-plugin-relay/macro.js");
                    // pub var graphql_string = E.String.init("graphql");
                    //
                    // var npx_react_scripts_build_str = E.String.init("npx react-scripts build");
                    // pub const npx_react_scripts_build = js_ast.Expr{ .data = .{ .e_string = &npx_react_scripts_build_str }, .loc = logger.Loc.Empty };
                    //
                    // var bun_macro_relay_properties = [_]js_ast.G.Property{
                    //     js_ast.G.Property{
                    //         .key   = js_ast.Expr{ .data = .{ .e_string = &graphql_string }, .loc = logger.Loc.Empty },
                    //         .value = js_ast.Expr{ .data = .{ .e_string = &bun_macros_relay_path_string }, .loc = logger.Loc.Empty },
                    //     },
                    // };
                    // var bun_macro_relay_object = js_ast.E.Object{ .properties = undefined };
                    //
                    // var bun_macros_relay_object_properties = [_]js_ast.G.Property{
                    //     .{ .key = Expr{ .e_string = &react_relay_string },           .value = Expr{ .e_object = &bun_macro_relay_object } },
                    //     .{ .key = Expr{ .e_string = &babel_plugin_relay_macro },     .value = Expr{ .e_object = &bun_macro_relay_object } },
                    //     .{ .key = Expr{ .e_string = &babel_plugin_relay_macro_js },  .value = Expr{ .e_object = &bun_macro_relay_object } },
                    // };
                    // pub var bun_macros_relay_object = E.Object{ .properties = undefined };
                    //
                    // var bun_macros_relay_only_object_string = js_ast.E.String.init("macros");
                    // pub var bun_macros_relay_only_object_properties = [_]js_ast.G.Property{
                    //     .{ .key = Expr{ .e_string = &bun_macros_relay_only_object_string }, .value = Expr{ .e_object = &bun_macros_relay_object } },
                    // };
                    // pub var bun_macros_relay_only_object = E.Object{ .properties = undefined };
                    //
                    // var bun_only_macros_string = js_ast.E.String.init("bun");
                    // pub var bun_only_macros_relay_property = js_ast.G.Property{
                    //     .key   = Expr{ .e_string = &bun_only_macros_string },
                    //     .value = Expr{ .e_object = &bun_macros_relay_only_object },
                    // };
                    //
                    // pub var bun_framework_next_string  = js_ast.E.String.init("bun-framework-next");
                    // pub var bun_framework_next_version = js_ast.E.String.init("latest");
                    // pub var bun_framework_next_property = js_ast.G.Property{
                    //     .key   = Expr{ .e_string = &bun_framework_next_string },
                    //     .value = Expr{ .e_string = &bun_framework_next_version },
                    // };
                    //
                    // pub var bun_macro_relay_dependency_string  = js_ast.E.String.init("bun-macro-relay");
                    // pub var bun_macro_relay_dependency_version = js_ast.E.String.init("latest");
                    // pub var bun_macro_relay_dependency = js_ast.G.Property{
                    //     .key   = Expr{ .e_string = &bun_macro_relay_dependency_string },
                    //     .value = Expr{ .e_string = &bun_macro_relay_dependency_version },
                    // };
                    //
                    // pub var refresh_runtime_string  = js_ast.E.String.init("react-refresh");
                    // pub var refresh_runtime_version = js_ast.E.String.init("0.10.0");
                    // pub var react_refresh_dependency = js_ast.G.Property{
                    //     .key   = Expr{ .e_string = &refresh_runtime_string },
                    //     .value = Expr{ .e_string = &refresh_runtime_version },
                    // };
                    //
                    // pub var dev_dependencies_key = js_ast.Expr{ .data = .{ .e_string = &devDependencies_e_string }, .loc = logger.Loc.Empty };
                    // pub var dependencies_key     = js_ast.Expr{ .data = .{ .e_string = &dependencies_e_string },    .loc = logger.Loc.Empty };

                    pub const BUN_BUN_FOR_NEXTJS_TASK: &[u8] = b"bun bun --use next";

                    // TODO(port): these wire up the static objects above; only feeds dead code
                    pub fn wire() {
                        // InjectionPrefill.bun_macro_relay_object.properties = ...fromBorrowedSliceDangerous(bun_macro_relay_properties[0..]);
                        // InjectionPrefill.bun_macros_relay_object.properties = ...fromBorrowedSliceDangerous(&bun_macros_relay_object_properties);
                        // InjectionPrefill.bun_macros_relay_only_object.properties = ...fromBorrowedSliceDangerous(&bun_macros_relay_only_object_properties);
                    }

                    pub fn npx_react_scripts_build() -> js_ast::Expr {
                        // TODO(port): build js_ast::Expr { .e_string = "npx react-scripts build" }
                        js_ast::Expr::new_string(b"npx react-scripts build", logger::Loc::EMPTY)
                    }
                }

                injection_prefill::wire();

                // if (needs_to_inject_dev_dependency and dev_dependencies == null) {
                //     var e_object = try ctx.allocator.create(E.Object);
                //     e_object.* = E.Object{};
                //     const value = js_ast.Expr{ .data = .{ .e_object = e_object }, .loc = logger.Loc.Empty };
                //     properties_list.appendAssumeCapacity(js_ast.G.Property{
                //         .key = InjectionPrefill.dev_dependencies_key,
                //         .value = value,
                //     });
                //     dev_dependencies = value;
                // }
                //
                // if (needs_to_inject_dependency and dependencies == null) {
                //     var e_object = try ctx.allocator.create(E.Object);
                //     e_object.* = E.Object{};
                //     const value = js_ast.Expr{ .data = .{ .e_object = e_object }, .loc = logger.Loc.Empty };
                //     properties_list.appendAssumeCapacity(js_ast.G.Property{
                //         .key = InjectionPrefill.dependencies_key,
                //         .value = value,
                //     });
                //     dependencies = value;
                // }

                // inject an object like this, handling each permutation of what may or may not exist:
                // {
                //    "bun": {
                //       "macros": {
                //          "react-relay": {
                //              "graphql": "bun-macro-relay"
                //          }
                //        }
                //    }
                // }
                // bun_section: {
                //   // "bun.macros.react-relay.graphql"
                //   if (needs.bun_macro_relay and !needs_bun_prop and !needs_bun_macros_prop) {
                //       bun_relay_prop.?.data.e_object = InjectionPrefill.bun_macros_relay_object.properties.ptr[0].value.?.data.e_object;
                //       needs_bun_macros_prop = false; needs_bun_prop = false; needs.bun_macro_relay = false;
                //       break :bun_section;
                //   }
                //   // "bun.macros"
                //   if (needs_bun_macros_prop and !needs_bun_prop) {
                //       var obj = bun_prop.?.data.e_object;
                //       var properties = try std.ArrayList(js_ast.G.Property).initCapacity(ctx.allocator,
                //           obj.properties.len + InjectionPrefill.bun_macros_relay_object.properties.len);
                //       defer obj.properties.update(properties);
                //       try properties.insertSlice(0, obj.properties.slice());
                //       try properties.insertSlice(0, InjectionPrefill.bun_macros_relay_object.properties.slice());
                //       needs_bun_macros_prop = false; needs_bun_prop = false; needs.bun_macro_relay = false;
                //       break :bun_section;
                //   }
                //   // "bun"
                //   if (needs_bun_prop) {
                //       try properties_list.append(InjectionPrefill.bun_only_macros_relay_property);
                //       needs_bun_macros_prop = false; needs_bun_prop = false; needs.bun_macro_relay = false;
                //       break :bun_section;
                //   }
                // }
                //
                // if (needs_to_inject_dependency) {
                //     defer needs_to_inject_dependency = false;
                //     var obj = dependencies.?.data.e_object;
                //     var properties = try std.ArrayList(js_ast.G.Property).initCapacity(ctx.allocator,
                //         obj.properties.len + dependencies_to_inject_count);
                //     try properties.insertSlice(0, obj.properties.slice());
                //     defer obj.properties.update(properties);
                //     if (needs.bun_framework_next) {
                //         properties.appendAssumeCapacity(InjectionPrefill.bun_framework_next_property);
                //         needs.bun_framework_next = false;
                //     }
                // }
                //
                // if (needs_to_inject_dev_dependency) {
                //     defer needs_to_inject_dev_dependency = false;
                //     var obj = dev_dependencies.?.data.e_object;
                //     var properties = try std.ArrayList(js_ast.G.Property).initCapacity(ctx.allocator,
                //         obj.properties.len + dev_dependencies_to_inject_count);
                //     try properties.insertSlice(0, obj.properties.slice());
                //     defer obj.properties.update(properties);
                //     if (needs.bun_macro_relay_dependency) {
                //         properties.appendAssumeCapacity(InjectionPrefill.bun_macro_relay_dependency);
                //         needs.bun_macro_relay_dependency = false;
                //     }
                //     if (needs.react_refresh) {
                //         properties.appendAssumeCapacity(InjectionPrefill.react_refresh_dependency);
                //         needs.react_refresh = false;
                //     }
                // }

                // this is a little dicey
                // The idea is:
                // Before the closing </body> tag of Create React App's public/index.html
                // Inject "<script type="module" src="/src/index.js" async></script>"
                // Only do this for create-react-app
                // Which we define as:
                // 1. has a "public/index.html"
                // 2. "react-scripts" in package.json dependencies or devDependencies
                // 3. has a src/index.{jsx,tsx,ts,mts,mcjs}
                // If at any point those expectations are not matched OR the string /src/index.js already exists in the HTML
                // don't do it!
                // if (has_react_scripts) {
                //     bail: {
                //         // ... (large CRA index.html injection block; see Zig source lines 1183-1265)
                //         // TODO(port): commented-out CRA HTML rewrite logic — preserved verbatim in Zig source
                //     }
                // }

                package_json_expr.data.e_object_mut().is_single_line = false;

                package_json_expr.data.e_object_mut().properties =
                    js_ast::G::Property::List::move_from_list(&mut properties_list);
                {
                    let mut i: usize = 0;
                    let mut property_i: usize = 0;
                    let props = &mut package_json_expr.data.e_object_mut().properties;
                    while i < props.len() {
                        let property: js_ast::G::Property = props.ptr()[i];
                        let key = property.key.unwrap().as_string().unwrap();

                        if key == b"scripts" {
                            if property.value.unwrap().data.is_e_object() {
                                let scripts_properties = property.value.unwrap().data.e_object_mut().properties.slice_mut();

                                // if they're starting the app with "react-scripts start" or "next dev", that won't make sense
                                // if they launch with npm run start it will just be slower
                                let mut script_property_i: usize = 0;
                                let mut script_property_out_i: usize = 0;

                                while script_property_i < scripts_properties.len() {
                                    let script = scripts_properties[script_property_i]
                                        .value
                                        .unwrap()
                                        .data
                                        .e_string()
                                        .data;

                                    if strings::contains(script, b"react-scripts start")
                                        || strings::contains(script, b"next dev")
                                        || strings::contains(script, b"react-scripts eject")
                                    {
                                        if create_options.verbose {
                                            Output::pretty_errorln(
                                                "<r><d>[package.json] Pruned unnecessary script: {}<r>",
                                                format_args!("{}", bstr::BStr::new(script)),
                                            );
                                        }

                                        script_property_i += 1;
                                        continue;
                                    }

                                    if strings::contains(script, b"react-scripts build") {
                                        scripts_properties[script_property_i].value =
                                            Some(injection_prefill::npx_react_scripts_build());
                                    }

                                    scripts_properties[script_property_out_i] = scripts_properties[script_property_i];
                                    script_property_out_i += 1;
                                    script_property_i += 1;
                                }

                                property.value.unwrap().data.e_object_mut().properties =
                                    js_ast::G::Property::List::from_borrowed_slice_dangerous(
                                        &mut scripts_properties[0..script_property_out_i],
                                    );
                            }
                        }

                        if key.is_empty() || key != b"bun-create" {
                            props.ptr_mut()[property_i] = property;
                            property_i += 1;
                            i += 1;
                            continue;
                        }

                        let value = property.value.unwrap();
                        if let Some(postinstall) = value.as_property(b"postinstall") {
                            match &postinstall.expr.data {
                                js_ast::Expr::Data::EString(single_task) => {
                                    postinstall_tasks.push(single_task.string()?);
                                }
                                js_ast::Expr::Data::EArray(tasks) => {
                                    let items = tasks.slice();
                                    for task in items {
                                        if let Some(task_entry) = task.as_string() {
                                            // if (needs.bun_bun_for_nextjs or bun_bun_for_react_scripts) {
                                            //     var iter = std.mem.splitScalar(u8, task_entry, ' ');
                                            //     var last_was_bun = false;
                                            //     while (iter.next()) |current| {
                                            //         if (strings.eqlComptime(current, "bun")) {
                                            //             if (last_was_bun) {
                                            //                 needs.bun_bun_for_nextjs = false;
                                            //                 bun_bun_for_react_scripts = false;
                                            //                 break;
                                            //             }
                                            //             last_was_bun = true;
                                            //         }
                                            //     }
                                            // }

                                            postinstall_tasks.push(task_entry);
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }

                        if let Some(preinstall) = value.as_property(b"preinstall") {
                            match &preinstall.expr.data {
                                js_ast::Expr::Data::EString(single_task) => {
                                    preinstall_tasks.push(single_task.string()?);
                                }
                                js_ast::Expr::Data::EArray(tasks) => {
                                    for task in tasks.items.slice() {
                                        if let Some(task_entry) = task.as_string() {
                                            preinstall_tasks.push(task_entry);
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }

                        if let Some(start) = value.as_property(b"start") {
                            if let Some(start_str) = start.expr.as_string() {
                                if !start_str.is_empty() {
                                    start_command = start_str;
                                }
                            }
                        }

                        i += 1;
                    }
                    props.shrink_retaining_capacity(property_i);
                }

                let file: bun_sys::Fd = bun_sys::Fd::from_std_file(package_json_file.as_ref().unwrap());

                let mut buffer_writer = JSPrinter::BufferWriter::init();
                buffer_writer.append_newline = true;
                let mut package_json_writer = JSPrinter::BufferPrinter::init(buffer_writer);

                if let Err(err) = JSPrinter::print_json(
                    &mut package_json_writer,
                    package_json_expr,
                    &source,
                    JSPrinter::PrintJsonOptions { mangled_props: None },
                ) {
                    Output::pretty_errorln(
                        "package.json failed to write due to error {}",
                        format_args!("{}", err.name()),
                    );
                    package_json_file = None;
                    break 'process_package_json;
                }
                let written = package_json_writer.ctx.get_written();
                if let Err(err) = bun_sys::File { handle: file }.write_all(written).unwrap_result() {
                    Output::pretty_errorln(
                        "package.json failed to write due to error {}",
                        format_args!("{}", err.name()),
                    );
                    package_json_file = None;
                    break 'process_package_json;
                }
                if let Err(err) = file.truncate(u64::try_from(written.len()).unwrap()).unwrap_result() {
                    Output::pretty_errorln(
                        "package.json failed to write due to error {}",
                        format_args!("{}", err.name()),
                    );
                    package_json_file = None;
                    break 'process_package_json;
                }
            }
        }

        if create_options.verbose {
            Output::pretty_errorln(
                "Has dependencies? {}",
                format_args!("{}", has_dependencies as u8),
            );
        }

        let mut npm_client_: Option<NPMClient> = None;

        create_options.skip_install = create_options.skip_install || !has_dependencies;

        if !create_options.skip_git {
            if !create_options.skip_install {
                GitHandler::spawn(destination, path_env, create_options.verbose);
            } else {
                if create_options.verbose {
                    create_options.skip_git = GitHandler::run::<true>(destination, path_env).unwrap_or(false);
                } else {
                    create_options.skip_git = GitHandler::run::<false>(destination, path_env).unwrap_or(false);
                }
            }
        }

        if !create_options.skip_install {
            npm_client_ = Some(NPMClient {
                tag: crate::which_npm_client::NPMClientTag::Bun,
                bin: bun_core::self_exe_path()?,
            });
        }

        if npm_client_.is_some() && !preinstall_tasks.is_empty() {
            for task in &preinstall_tasks {
                exec_task(task, destination, path_env, npm_client_.clone());
            }
        }

        if let Some(ref npm_client) = npm_client_ {
            let start_time = bun_core::time::nano_timestamp();
            let install_args: &[&[u8]] = &[npm_client.bin, b"install"];
            Output::flush();
            Output::pretty(
                "\n<r><d>$ <b><cyan>{}<r><d> install",
                format_args!("{}", <&'static str>::from(npm_client.tag)),
            );

            if install_args.len() > 2 {
                for arg in &install_args[2..] {
                    Output::pretty(" ", format_args!(""));
                    Output::pretty("{}", format_args!("{}", bstr::BStr::new(arg)));
                }
            }

            Output::pretty("<r>\n", format_args!(""));
            Output::flush();
            let _trailer = scopeguard::guard((), |_| {
                Output::print_errorln("\n", format_args!(""));
                Output::print_start_end(start_time, bun_core::time::nano_timestamp());
                Output::pretty_error(
                    " <r><d>{} install<r>\n",
                    format_args!("{}", <&'static str>::from(npm_client.tag)),
                );
                Output::flush();

                Output::print(format_args!("\n"));
                Output::flush();
            });

            let process = bun_core::spawn_sync(&bun_core::SpawnOptions {
                argv: install_args,
                envp: None,
                cwd: destination,
                stderr: bun_core::Stdio::Inherit,
                stdout: bun_core::Stdio::Inherit,
                stdin: bun_core::Stdio::Inherit,
                #[cfg(windows)]
                windows: bun_core::WindowsSpawnOptions {
                    loop_: bun_jsc::EventLoopHandle::init(bun_event_loop::MiniEventLoop::init_global(None, None)),
                },
                ..Default::default()
            })?;
            let _ = process.unwrap_result()?;
        }

        if !postinstall_tasks.is_empty() {
            for task in &postinstall_tasks {
                exec_task(task, destination, path_env, npm_client_.clone());
            }
        }

        if !create_options.skip_install && !create_options.skip_git {
            create_options.skip_git = !GitHandler::wait();
        }

        Output::print_error("\n", format_args!(""));
        Output::print_start_end(ctx.start_time, bun_core::time::nano_timestamp());
        Output::pretty_errorln(" <r><d>bun create {}<r>", format_args!("{}", bstr::BStr::new(template)));

        Output::flush();

        Output::pretty(
            "\n<d>Come hang out in bun's Discord: https://bun.com/discord<r>\n",
            format_args!(""),
        );

        if !create_options.skip_install {
            Output::pretty("\n<r><d>-----<r>\n", format_args!(""));
            Output::flush();
        }

        // if (unsupported_packages.@"styled-jsx") {
        //     Output.prettyErrorln("\n", .{});
        //     unsupported_packages.print();
        //     Output.prettyErrorln("\n", .{});
        //     Output.flush();
        // }

        if !create_options.skip_git && !create_options.skip_install {
            Output::pretty(
                "\n<d>A local git repository was created for you and dependencies were installed automatically.<r>\n",
                format_args!(""),
            );
        } else if !create_options.skip_git {
            Output::pretty(
                "\n<d>A local git repository was created for you.<r>\n",
                format_args!(""),
            );
        } else if !create_options.skip_install {
            Output::pretty(
                "\n<d>Dependencies were installed automatically.<r>\n",
                format_args!(""),
            );
        }

        if example_tag == ExampleTag::GithubRepository {
            let mut display_name = template;

            if let Some(first_slash) = bun_str::strings::index_of_char(display_name, b'/') {
                if let Some(second_slash) =
                    bun_str::strings::index_of_char(&display_name[first_slash + 1..], b'/')
                {
                    display_name = &template[0..first_slash + 1 + second_slash];
                }
            }

            Output::pretty(
                "\n<b><green>Success!<r> <b>{}<r> loaded into <b>{}<r>\n",
                format_args!(
                    "{} {}",
                    bstr::BStr::new(display_name),
                    bstr::BStr::new(bun_paths::basename(destination))
                ),
            );
        } else {
            Output::pretty(
                "\n<b>Created <green>{}<r> project successfully\n",
                format_args!("{}", bstr::BStr::new(bun_paths::basename(template))),
            );
        }

        if is_nextjs {
            Output::pretty(
                "\n<r><d>#<r> When dependencies change, run this to update node_modules.bun:\n\n  <b><cyan>bun bun --use next<r>\n",
                format_args!(""),
            );
        } else if is_create_react_app {
            Output::pretty(
                "\n<r><d>#<r> When dependencies change, run this to update node_modules.bun:\n\n  <b><cyan>bun bun {}<r>\n",
                format_args!("{}", bstr::BStr::new(create_react_app_entry_point_path)),
            );
        }

        let rel_destination = filesystem.relative_to(destination);
        let is_empty_destination = rel_destination.is_empty();

        if is_empty_destination {
            Output::pretty(
                "\n<d>#<r><b> To get started, run:<r>\n\n  <b><cyan>{}<r>\n\n",
                format_args!("{}", bstr::BStr::new(start_command)),
            );
        } else {
            Output::pretty(
                "\n<d>#<r><b> To get started, run:<r>\n\n  <b><cyan>cd {}<r>\n  <b><cyan>{}<r>\n\n",
                format_args!(
                    "{} {}",
                    bstr::BStr::new(rel_destination),
                    bstr::BStr::new(start_command)
                ),
            );
        }

        Output::flush();

        if create_options.open {
            // SAFETY: single-threaded CLI access to module-level static path buffer
            let bun_path_buf = unsafe { &mut BUN_PATH_BUF };
            if let Some(bin) = which(bun_path_buf, path_env, destination, b"bun") {
                let argv: [&[u8]; 1] = [bun_core::as_byte_slice(bin)];
                // TODO(port): std.process.Child — replace with bun_core::spawn_sync in Phase B
                let mut child = bun_core::process::Child::init(&argv);
                child.cwd = destination;
                child.stdin_behavior = bun_core::process::Stdio::Inherit;
                child.stdout_behavior = bun_core::process::Stdio::Inherit;
                child.stderr_behavior = bun_core::process::Stdio::Inherit;

                crate::open::open_url(b"http://localhost:3000/");

                child.spawn()?;
                let _ = child.wait();
            }
        }

        Ok(())
    }

    pub fn extract_info(
        ctx: &Command::Context,
    ) -> Result<ExtractedInfo, bun_core::Error> {
        let mut example_tag = ExampleTag::Unknown;
        let filesystem = fs::FileSystem::init(None)?;

        let create_options = CreateOptions::parse(ctx)?;
        let positionals = &create_options.positionals;
        if positionals.is_empty() {
            crate::Command::Tag::print_help(crate::Command::Tag::CreateCommand, false);
            Global::crash();
        }

        let mut env_loader: DotEnv::Loader = {
            let map = Box::new(DotEnv::Map::init());
            DotEnv::Loader::init(Box::leak(map))
        };

        env_loader.load_process()?;

        // var unsupported_packages = UnsupportedPackages{};
        // SAFETY: single-threaded CLI access to module-level static path buffer
        let home_dir_buf = unsafe { &mut HOME_DIR_BUF };
        let template: &[u8] = 'brk: {
            let positional = positionals[0];

            'outer: {
                let parts = [filesystem.top_level_dir, positional];
                let outdir_path = filesystem.abs_buf(&parts, home_dir_buf);
                let len = outdir_path.len();
                home_dir_buf[len] = 0;
                // SAFETY: home_dir_buf[len] == 0 written above
                let outdir_path_ = unsafe { bun_str::ZStr::from_raw(home_dir_buf.as_ptr(), len) };
                if bun_paths::has_any_illegal_chars(outdir_path_.as_bytes()) {
                    break 'outer;
                }

                if let Some(exists_at_type) = bun_sys::Fd::cwd().exists_at_type(outdir_path_).as_value() {
                    if exists_at_type == bun_sys::ExistsAtType::File {
                        let extension = bun_paths::extension(positional);
                        if let Some(tag) = ExampleTag::from_file_extension(extension) {
                            example_tag = tag;
                            break 'brk Box::leak(Box::<[u8]>::from(&home_dir_buf[..len]));
                        }
                        // Show a warning when the local file exists and it's not a .js file
                        // A lot of create-* npm packages have .js in the name, so you could end up with that warning.
                        else if !extension.is_empty() && extension != b".js" {
                            Output::warn(
                                "bun create [local file] only supports .jsx and .tsx files currently",
                                format_args!(""),
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
                        let outdir_path_ = unsafe { bun_str::ZStr::from_raw(home_dir_buf.as_ptr(), len) };
                        if bun_paths::has_any_illegal_chars(outdir_path_.as_bytes()) {
                            break 'outer;
                        }
                        if bun_sys::Fd::cwd().directory_exists_at(outdir_path_).is_true() {
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
                    let outdir_path_ = unsafe { bun_str::ZStr::from_raw(home_dir_buf.as_ptr(), len) };
                    if bun_paths::has_any_illegal_chars(outdir_path_.as_bytes()) {
                        break 'outer;
                    }
                    if bun_sys::Fd::cwd().directory_exists_at(outdir_path_).is_true() {
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
                        let outdir_path_ = unsafe { bun_str::ZStr::from_raw(home_dir_buf.as_ptr(), len) };
                        if bun_paths::has_any_illegal_chars(outdir_path_.as_bytes()) {
                            break 'outer;
                        }
                        if bun_sys::Fd::cwd().directory_exists_at(outdir_path_).is_true() {
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
                    if let Some(first_slash_index) = bun_str::strings::index_of_char(positional, b'/') {
                        if let Some(last_slash_index) = bun_str::strings::index_of_char(positional, b'/') {
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
                    if let Some(i) = bun_str::strings::index_of_char(remainder, b'/') {
                        if i > 0 && !remainder[i + 1..].is_empty() {
                            if let Some(last_slash) =
                                bun_str::strings::index_of_char(&remainder[i + 1..], b'/')
                            {
                                example_tag = ExampleTag::GithubRepository;
                                break 'brk strings::trim(&remainder[0..i + 1 + last_slash], b"# \r\t");
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
        Ok(ExtractedInfo { example_tag, template })
    }
}

pub struct ExtractedInfo {
    pub example_tag: ExampleTag,
    pub template: &'static [u8], // TODO(port): lifetime — borrows from positionals/static buffer
}

// PORT NOTE: hoisted from Zig fn-local `const FileCopier = struct { pub fn copy(...) }` inside
// CreateCommand.exec, because Rust does not allow capturing-closure-style nested fns and the
// fn body is large.
fn file_copier_copy(
    destination_dir_: bun_sys::Dir,
    walker: &mut bun_sys::walker_skippable::Walker,
    node_: &mut Progress::Node,
    progress_: &mut Progress,
    #[cfg(windows)] dst_base_len: usize,
    #[cfg(windows)] dst_buf: &mut bun_paths::WPathBuffer,
    #[cfg(windows)] src_base_len: usize,
    #[cfg(windows)] src_buf: &mut bun_paths::WPathBuffer,
) -> Result<(), bun_core::Error> {
    while let Some(entry) = walker.next().unwrap_result()? {
        #[cfg(windows)]
        {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            dst_buf[dst_base_len..][..entry.path.len()].copy_from_slice(entry.path);
            dst_buf[dst_base_len + entry.path.len()] = 0;
            // SAFETY: NUL written at [dst_base_len + entry.path.len()]
            let dst = unsafe { bun_str::WStr::from_raw(dst_buf.as_ptr(), dst_base_len + entry.path.len()) };

            src_buf[src_base_len..][..entry.path.len()].copy_from_slice(entry.path);
            src_buf[src_base_len + entry.path.len()] = 0;
            // SAFETY: NUL written at [src_base_len + entry.path.len()]
            let src = unsafe { bun_str::WStr::from_raw(src_buf.as_ptr(), src_base_len + entry.path.len()) };

            match entry.kind {
                bun_sys::FileKind::Directory => {
                    if bun_sys::windows::CreateDirectoryExW(src.as_ptr(), dst.as_ptr(), core::ptr::null_mut()) == 0 {
                        let _ = bun_sys::MakePath::make_path_u16(destination_dir_, entry.path);
                    }
                }
                bun_sys::FileKind::File => {
                    let _complete = scopeguard::guard((), |_| node_.complete_one());
                    if bun_sys::windows::CopyFileW(src.as_ptr(), dst.as_ptr(), 0) == bun_sys::windows::FALSE {
                        if let Some(entry_dirname) = bun_paths::Dirname::dirname_u16(entry.path) {
                            let _ = bun_sys::MakePath::make_path_u16(destination_dir_, entry_dirname);
                            if bun_sys::windows::CopyFileW(src.as_ptr(), dst.as_ptr(), 0) != bun_sys::windows::FALSE {
                                continue;
                            }
                        }

                        if let Some(err) = bun_sys::windows::Win32Error::get().to_system_errno() {
                            Output::err(
                                err,
                                "failed to copy file {}",
                                format_args!("{}", bun_core::fmt::fmt_os_path(entry.path, Default::default())),
                            );
                        } else {
                            Output::err_generic(
                                "failed to copy file {}",
                                format_args!("{}", bun_core::fmt::fmt_os_path(entry.path, Default::default())),
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

            let outfile = match destination_dir_.create_file(entry.path, Default::default()) {
                Ok(f) => bun_sys::Fd::from_std_file(f),
                Err(_) => 'brk: {
                    if let Some(entry_dirname) = bun_paths::Dirname::dirname(entry.path) {
                        let _ = bun_sys::MakePath::make_path(destination_dir_, entry_dirname);
                    }
                    match destination_dir_.create_file(entry.path, Default::default()) {
                        Ok(f) => break 'brk bun_sys::Fd::from_std_file(f),
                        Err(err) => {
                            node_.end();
                            progress_.refresh();
                            Output::err(
                                err,
                                "failed to copy file {}",
                                format_args!("{}", bun_core::fmt::fmt_os_path(entry.path, Default::default())),
                            );
                            Global::crash();
                        }
                    }
                }
            };
            let _close_out = scopeguard::guard((), |_| outfile.close());
            let _complete = scopeguard::guard((), |_| node_.complete_one());

            let infile = entry.dir.openat(entry.basename, bun_sys::O::RDONLY, 0).unwrap_result()?;
            let _close_in = scopeguard::guard((), |_| infile.close());

            // Assumption: you only really care about making sure something that was executable is still executable
            match infile.stat() {
                bun_sys::Result::Err(_) => {}
                bun_sys::Result::Ok(stat) => {
                    let _ = outfile.chmod(u32::try_from(stat.mode()).unwrap());
                }
            }

            if let Err(err) = CopyFile::copy_file(infile, outfile).unwrap_result() {
                node_.end();
                progress_.refresh();
                Output::err(
                    err,
                    "failed to copy file {}",
                    format_args!("{}", bun_core::fmt::fmt_os_path(entry.path, Default::default())),
                );
                Global::crash();
            }
        }
    }
    Ok(())
}

// PORT NOTE: hoisted from Zig fn-local `const Analyzer = struct {...}` inside runOnEntryPoint.
struct Analyzer<'a> {
    ctx: &'a Command::Context,
    example_tag: ExampleTag,
    entry_point: &'a [u8],
    node: &'a mut Progress::Node,
    progress: &'a mut Progress,
}

impl<'a> Analyzer<'a> {
    pub fn on_analyze(
        this: &mut Self,
        result: &mut bun_bundler::BundleV2::DependenciesScanner::Result,
    ) -> Result<(), bun_core::Error> {
        this.node.end();

        SourceFileProjectGenerator::generate(this.ctx, this.example_tag, this.entry_point, result)
    }
}

fn run_on_entry_point(
    ctx: &Command::Context,
    example_tag: ExampleTag,
    entry_point: &[u8],
    progress: &mut Progress,
    node: &mut Progress::Node,
) -> Result<(), bun_core::Error> {
    let mut analyzer = Analyzer {
        ctx,
        example_tag,
        entry_point,
        progress,
        node,
    };

    let mut fetcher = bun_bundler::BundleV2::DependenciesScanner {
        ctx: &mut analyzer as *mut _ as *mut core::ffi::c_void,
        entry_points: &[analyzer.entry_point],
        // TODO(port): @ptrCast on fn pointer — verify ABI matches DependenciesScanner.onFetch
        // SAFETY: Analyzer::on_analyze has the same in-memory fn-pointer layout as OnFetchFn
        // (ctx is *mut c_void downcast); mirrors Zig @ptrCast.
        on_fetch: unsafe {
            core::mem::transmute::<
                fn(&mut Analyzer<'_>, &mut bun_bundler::BundleV2::DependenciesScanner::Result) -> Result<(), bun_core::Error>,
                bun_bundler::BundleV2::DependenciesScanner::OnFetchFn,
            >(Analyzer::on_analyze)
        },
    };
    crate::BuildCommand::exec(crate::Command::get(), &mut fetcher)
}

// `Commands` was a Zig anonymous tuple of three single-element string arrays, used only to
// drive `inline for` over its three fields in GitHandler.run. In Rust we just iterate the
// three git command arrays directly (see GitHandler::run).

pub struct DownloadedExample {
    pub tarball_bytes: MutableString,
    pub example: Example,
}

pub struct Example {
    pub name: &'static [u8],        // TODO(port): lifetime
    pub version: &'static [u8],     // TODO(port): lifetime
    pub description: &'static [u8], // TODO(port): lifetime
    pub local: bool,
}

impl Default for Example {
    fn default() -> Self {
        Self { name: b"", version: b"", description: b"", local: false }
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

impl ExampleTag {
    static EXTENSION_TAG_MAP: phf::Map<&'static [u8], ExampleTag> = phf::phf_map! {
        b".tsx" => ExampleTag::JslikeFile,
        b".jsx" => ExampleTag::JslikeFile,
    };

    pub fn from_file_extension(extension: &[u8]) -> Option<ExampleTag> {
        Self::EXTENSION_TAG_MAP.get(extension).copied()
    }
}

impl Example {
    const EXAMPLES_URL: &'static [u8] = b"https://registry.npmjs.org/bun-examples-all/latest";
    // TODO(port): mutable static URL — single-threaded CLI usage
    static mut URL_: URL = URL::ZEROED;

    static mut APP_NAME_BUF: [u8; 512] = [0u8; 512];

    pub fn print(examples: &[Example], default_app_name: Option<&[u8]>) {
        for example in examples {
            // SAFETY: single-threaded CLI access to static buffer
            let app_name_buf = unsafe { &mut APP_NAME_BUF };
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
                Output::pretty(
                    "  <r># {}<r>\n  <b>bun create <cyan>{}<r><b> {}<r>\n<d>  \n\n",
                    format_args!(
                        "{} {} {}",
                        bstr::BStr::new(example.description),
                        bstr::BStr::new(example.name),
                        bstr::BStr::new(app_name)
                    ),
                );
            } else {
                Output::pretty(
                    "  <r><b>bun create <cyan>{}<r><b> {}<r>\n\n",
                    format_args!("{} {}", bstr::BStr::new(example.name), bstr::BStr::new(app_name)),
                );
            }
        }
    }

    pub fn fetch_all_local_and_remote(
        ctx: &Command::Context,
        node: Option<&mut Progress::Node>,
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
            let home_dir_buf = unsafe { &mut HOME_DIR_BUF };
            let mut folders: [bun_sys::Dir; 3] = [
                bun_sys::Fd::invalid().std_dir(),
                bun_sys::Fd::invalid().std_dir(),
                bun_sys::Fd::invalid().std_dir(),
            ];
            if let Some(home_dir) = env_loader.map.get(b"BUN_CREATE_DIR") {
                let parts = [home_dir];
                let outdir_path = filesystem.abs_buf(&parts, home_dir_buf);
                folders[0] = bun_sys::Fd::cwd()
                    .open_dir(outdir_path, Default::default())
                    .unwrap_or(bun_sys::Fd::invalid().std_dir());
            }

            {
                let parts = [filesystem.top_level_dir, BUN_CREATE_DIR];
                let outdir_path = filesystem.abs_buf(&parts, home_dir_buf);
                folders[1] = bun_sys::Fd::cwd()
                    .open_dir(outdir_path, Default::default())
                    .unwrap_or(bun_sys::Fd::invalid().std_dir());
            }

            if let Some(home_dir) = env_loader.map.get(bun_core::env_var::HOME.key()) {
                let parts = [home_dir, BUN_CREATE_DIR];
                let outdir_path = filesystem.abs_buf(&parts, home_dir_buf);
                folders[2] = bun_sys::Fd::cwd()
                    .open_dir(outdir_path, Default::default())
                    .unwrap_or(bun_sys::Fd::invalid().std_dir());
            }

            // subfolders with package.json
            for folder in &folders {
                if folder.fd() != bun_sys::Fd::invalid().cast() {
                    let mut iter = folder.iterate();

                    'loop_: while let Some(entry) = iter.next().ok().flatten() {
                        match entry.kind {
                            bun_sys::FileKind::Directory => {
                                for skip_dir in SKIP_DIRS {
                                    // TODO(port): bun.pathLiteral wraps OSPathSlice; here entry.name is &[u8]
                                    if entry.name == bun_paths::path_literal(skip_dir) {
                                        continue 'loop_;
                                    }
                                }

                                home_dir_buf[..entry.name.len()].copy_from_slice(entry.name);
                                home_dir_buf[entry.name.len()] = bun_paths::SEP;
                                home_dir_buf[entry.name.len() + 1..][..b"package.json".len()]
                                    .copy_from_slice(b"package.json");
                                home_dir_buf[entry.name.len() + 1 + b"package.json".len()] = 0;

                                // SAFETY: NUL written at [entry.name.len() + 1 + "package.json".len()]
                                let path = unsafe {
                                    bun_str::ZStr::from_raw_mut(
                                        home_dir_buf.as_mut_ptr(),
                                        entry.name.len() + 1 + b"package.json".len(),
                                    )
                                };

                                if folder.access_z(path, bun_sys::AccessMode::ReadOnly).is_err() {
                                    continue 'loop_;
                                }

                                examples.push(Example {
                                    name: filesystem.filename_store.append(entry.name)?,
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

    static mut GITHUB_REPOSITORY_URL_BUF: [u8; 1024] = [0u8; 1024];

    pub fn fetch_from_github(
        ctx: &Command::Context,
        env_loader: &mut DotEnv::Loader,
        name: &[u8],
        refresher: &mut Progress,
        progress: &mut Progress::Node,
    ) -> Result<MutableString, bun_core::Error> {
        let owner_i = bun_str::strings::index_of_char(name, b'/').unwrap();
        let owner = &name[0..owner_i];
        let mut repository = &name[owner_i + 1..];

        if let Some(i) = bun_str::strings::index_of_char(repository, b'/') {
            repository = &repository[0..i];
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
        let url_buf = unsafe { &mut GITHUB_REPOSITORY_URL_BUF };
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

        let mut header_entries: Headers::Entry::List = Default::default();
        let mut headers_buf: &[u8] = b"";

        if let Some(access_token) = env_loader
            .map
            .get(b"GITHUB_TOKEN")
            .or_else(|| env_loader.map.get(b"GITHUB_ACCESS_TOKEN"))
        {
            if !access_token.is_empty() {
                let mut buf = Vec::new();
                write!(&mut buf, "AuthorizationBearer {}", bstr::BStr::new(access_token))?;
                headers_buf = Box::leak(buf.into_boxed_slice());
                header_entries.push(Headers::Entry {
                    name: Headers::Slice {
                        offset: 0,
                        length: u32::try_from(b"Authorization".len()).unwrap(),
                    },
                    value: Headers::Slice {
                        offset: u32::try_from(b"Authorization".len()).unwrap(),
                        length: u32::try_from(headers_buf.len() - b"Authorization".len()).unwrap(),
                    },
                });
            }
        }

        let http_proxy: Option<URL> = env_loader.get_http_proxy_for(&api_url);
        let mutable = Box::leak(Box::new(MutableString::init(8192)?));

        // ensure very stable memory address
        let async_http: &mut HTTP::AsyncHTTP = Box::leak(Box::new(HTTP::AsyncHTTP::init_sync(
            HTTP::Method::GET,
            api_url,
            header_entries,
            headers_buf,
            mutable,
            b"",
            http_proxy,
            None,
            HTTP::FetchRedirect::Follow,
        )));
        async_http.client.progress_node = Some(progress);
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

        let mut is_expected_content_type = false;
        let mut content_type: &[u8] = b"";
        for header in response.headers.list.iter() {
            if strings::eql_case_insensitive_ascii(header.name, b"content-type", true) {
                content_type = header.value;

                if header.value == b"application/x-gzip" {
                    is_expected_content_type = true;
                    break;
                }
            }
        }

        if !is_expected_content_type {
            progress.end();
            refresher.refresh();

            if !content_type.is_empty() {
                Output::pretty_errorln(
                    "<r><red>error<r>: Unexpected content type from GitHub: {}",
                    format_args!("{}", bstr::BStr::new(content_type)),
                );
                Global::crash();
            } else {
                Output::pretty_errorln(
                    "<r><red>error<r>: Invalid response from GitHub (missing content type)",
                    format_args!(""),
                );
                Global::crash();
            }
        }

        if mutable.list.is_empty() {
            progress.end();
            refresher.refresh();

            Output::pretty_errorln(
                "<r><red>error<r>: Invalid response from GitHub (missing body)",
                format_args!(""),
            );
            Global::crash();
        }

        // TODO(port): Zig returned `mutable.*` (deref-copy of struct). MutableString may need Clone.
        Ok(mutable.clone())
    }

    pub fn fetch(
        ctx: &Command::Context,
        env_loader: &mut DotEnv::Loader,
        name: &[u8],
        refresher: &mut Progress,
        progress: &mut Progress::Node,
    ) -> Result<MutableString, bun_core::Error> {
        progress.name = b"Fetching package.json";
        refresher.refresh();

        let mut url_buf = [0u8; 1024];
        let mutable = Box::leak(Box::new(MutableString::init(2048)?));

        // SAFETY: single-threaded CLI access to static URL_
        unsafe {
            URL_ = URL::parse({
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
        }

        // SAFETY: single-threaded CLI access to static URL_
        let mut http_proxy: Option<URL> = unsafe { env_loader.get_http_proxy_for(&URL_) };

        // ensure very stable memory address
        let async_http: &mut HTTP::AsyncHTTP = Box::leak(Box::new(HTTP::AsyncHTTP::init_sync(
            HTTP::Method::GET,
            // SAFETY: single-threaded CLI access to static URL_
            unsafe { URL_.clone() },
            Default::default(),
            b"",
            mutable,
            b"",
            http_proxy,
            None,
            HTTP::FetchRedirect::Follow,
        )));
        async_http.client.progress_node = Some(progress);
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
        initialize_store();
        let source = logger::Source::init_path_string(b"package.json", mutable.list.as_slice());
        let expr = match JSON::parse_utf8(&source, ctx.log) {
            Ok(e) => e,
            Err(err) => {
                progress.end();
                refresher.refresh();

                if ctx.log.errors > 0 {
                    ctx.log.print(Output::error_writer())?;
                    Global::exit(1);
                } else {
                    Output::pretty_errorln(
                        "Error parsing package: <r><red>{}<r>",
                        format_args!("{}", err.name()),
                    );
                    Global::exit(1);
                }
            }
        };

        if ctx.log.errors > 0 {
            progress.end();
            refresher.refresh();

            ctx.log.print(Output::error_writer())?;
            Global::exit(1);
        }

        let tarball_url: &[u8] = 'brk: {
            if let Some(q) = expr.as_property(b"dist") {
                if let Some(p) = q.expr.as_property(b"tarball") {
                    if let Some(s) = p.expr.as_string() {
                        if !s.is_empty()
                            && (strings::starts_with(s, b"https://") || strings::starts_with(s, b"http://"))
                        {
                            break 'brk Box::leak(Box::<[u8]>::from(s));
                        }
                    }
                }
            }

            progress.end();
            refresher.refresh();

            Output::pretty_errorln(
                "package.json is missing tarball url. This is an internal error!",
                format_args!(""),
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

        http_proxy = env_loader.get_http_proxy_for(&parsed_tarball_url);

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
        async_http.client.progress_node = Some(progress);
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        refresher.maybe_refresh();

        response = async_http.send_sync()?;

        refresher.maybe_refresh();

        if response.status_code != 200 {
            progress.end();
            refresher.refresh();
            Output::pretty_errorln(
                "Error fetching tarball: <r><red>{}<r>",
                format_args!("{}", response.status_code),
            );
            Global::exit(1);
        }

        refresher.refresh();

        // TODO(port): see note above re: returning MutableString by value
        Ok(mutable.clone())
    }

    pub fn fetch_all(
        ctx: &Command::Context,
        env_loader: &mut DotEnv::Loader,
        progress_node: Option<&mut Progress::Node>,
    ) -> Result<Box<[Example]>, bun_core::Error> {
        // SAFETY: single-threaded CLI access to static URL_
        unsafe {
            URL_ = URL::parse(Self::EXAMPLES_URL);
        }

        // SAFETY: single-threaded CLI access to static URL_
        let http_proxy: Option<URL> = unsafe { env_loader.get_http_proxy_for(&URL_) };

        let mutable = Box::leak(Box::new(MutableString::init(2048)?));

        let async_http: &mut HTTP::AsyncHTTP = Box::leak(Box::new(HTTP::AsyncHTTP::init_sync(
            HTTP::Method::GET,
            // SAFETY: single-threaded CLI access to static URL_
            unsafe { URL_.clone() },
            Default::default(),
            b"",
            mutable,
            b"",
            http_proxy,
            None,
            HTTP::FetchRedirect::Follow,
        )));
        async_http.client.flags.reject_unauthorized = env_loader.get_tls_reject_unauthorized();

        if Output::enable_ansi_colors_stdout() {
            async_http.client.progress_node = progress_node;
        }

        let response = match async_http.send_sync() {
            Ok(r) => r,
            Err(err) => {
                if err == bun_core::err!("WouldBlock") {
                    Output::pretty_errorln(
                        "Request timed out while trying to fetch examples list. Please try again",
                        format_args!(""),
                    );
                    Global::exit(1);
                } else {
                    Output::pretty_errorln(
                        "<r><red>{}<r> while trying to fetch examples list. Please try again",
                        format_args!("{}", err.name()),
                    );
                    Global::exit(1);
                }
            }
        };

        if response.status_code != 200 {
            Output::pretty_errorln(
                "<r><red>{}<r> fetching examples :( {}",
                format_args!("{} {}", response.status_code, bstr::BStr::new(mutable.list.as_slice())),
            );
            Global::exit(1);
        }

        initialize_store();
        let source = logger::Source::init_path_string(b"examples.json", mutable.list.as_slice());
        let examples_object = match JSON::parse_utf8(&source, ctx.log) {
            Ok(e) => e,
            Err(err) => {
                if ctx.log.errors > 0 {
                    ctx.log.print(Output::error_writer())?;
                    Global::exit(1);
                } else {
                    Output::pretty_errorln(
                        "Error parsing examples: <r><red>{}<r>",
                        format_args!("{}", err.name()),
                    );
                    Global::exit(1);
                }
            }
        };

        if ctx.log.errors > 0 {
            ctx.log.print(Output::error_writer())?;
            Global::exit(1);
        }

        if let Some(q) = examples_object.as_property(b"examples") {
            if q.expr.data.is_e_object() {
                let count = q.expr.data.e_object().properties.len();

                let mut list: Box<[Example]> = (0..count).map(|_| Example::default()).collect();
                for (i, property) in q.expr.data.e_object().properties.slice().iter().enumerate() {
                    let name = property.key.unwrap().data.e_string().data;
                    list[i] = Example {
                        name: if let Some(slash) = bun_str::strings::index_of_char(name, b'/') {
                            &name[slash + 1..]
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
                            .data,
                        description: property
                            .value
                            .unwrap()
                            .as_property(b"description")
                            .unwrap()
                            .expr
                            .data
                            .e_string()
                            .data,
                        local: false,
                    };
                }
                return Ok(list);
            }
        }

        Output::pretty_errorln(
            "Corrupt examples data: expected object but received {}",
            format_args!("{}", <&'static str>::from(examples_object.data.tag())),
        );
        Global::exit(1);
    }
}

pub struct CreateListExamplesCommand;

impl CreateListExamplesCommand {
    pub fn exec(ctx: &Command::Context) -> Result<(), bun_core::Error> {
        let filesystem = fs::FileSystem::init(None)?;
        let mut env_loader: DotEnv::Loader = {
            let map = Box::new(DotEnv::Map::init());
            DotEnv::Loader::init(Box::leak(map))
        };

        env_loader.load_process()?;

        let mut progress = Progress::default();
        progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        let node = progress.start(b"Fetching manifest", 0);
        progress.refresh();

        let examples = Example::fetch_all_local_and_remote(ctx, Some(node), &mut env_loader, filesystem)?;
        Output::prettyln(
            "Welcome to bun! Create a new project by pasting any of the following:\n\n",
            format_args!(""),
        );
        Output::flush();

        Example::print(&examples, None);

        Output::prettyln(
            "<r><d>#<r> You can also paste a GitHub repository:\n\n  <b>bun create <cyan>ahfarmer/calculator calc<r>\n\n",
            format_args!(""),
        );

        if let Some(homedir) = env_loader.map.get(bun_core::env_var::HOME.key()) {
            Output::prettyln(
                "<d>This command is completely optional. To add a new local template, create a folder in {}/.bun-create/. To publish a new template, git clone https://github.com/oven-sh/bun, add a new folder to the \"examples\" folder, and submit a PR.<r>",
                format_args!("{}", bstr::BStr::new(homedir)),
            );
        } else {
            Output::prettyln(
                "<d>This command is completely optional. To add a new local template, create a folder in $HOME/.bun-create/. To publish a new template, git clone https://github.com/oven-sh/bun, add a new folder to the \"examples\" folder, and submit a PR.<r>",
                format_args!(""),
            );
        }

        Output::flush();
        Ok(())
    }
}

struct GitHandler;

impl GitHandler {
    // TODO(port): mutable static atomic + thread handle — single use per process
    static SUCCESS: AtomicU32 = AtomicU32::new(0);
    static mut THREAD: Option<bun_threading::Thread> = None;

    pub fn spawn(destination: &[u8], path: &[u8], verbose: bool) {
        Self::SUCCESS.store(0, Ordering::Relaxed);

        // TODO(port): std.Thread.spawn — destination/path borrowed across thread; Zig relied on
        // them being long-lived (filesystem dirname_store / env). Phase B: ensure 'static or own.
        let thread = match bun_threading::Thread::spawn(
            Default::default(),
            move || Self::spawn_thread(destination, path, verbose),
        ) {
            Ok(t) => t,
            Err(err) => {
                Output::pretty_errorln("<r><red>{}<r>", format_args!("{}", err.name()));
                Global::exit(1);
            }
        };
        // SAFETY: single-threaded CLI; written once before wait()
        unsafe { THREAD = Some(thread) };
    }

    fn spawn_thread(destination: &[u8], path: &[u8], verbose: bool) {
        Output::Source::configure_named_thread("git");
        let _flush = scopeguard::guard((), |_| Output::flush());
        let outcome = if verbose {
            Self::run::<true>(destination, path).unwrap_or(false)
        } else {
            Self::run::<false>(destination, path).unwrap_or(false)
        };

        Self::SUCCESS.store(if outcome { 1 } else { 2 }, Ordering::Release);
        Futex::wake(&Self::SUCCESS, 1);
    }

    pub fn wait() -> bool {
        while Self::SUCCESS.load(Ordering::Acquire) == 0 {
            let _ = Futex::wait(&Self::SUCCESS, 0, 1000);
        }

        let outcome = Self::SUCCESS.load(Ordering::Acquire) == 1;
        // SAFETY: THREAD set in spawn() on this same thread before wait() called
        unsafe { THREAD.take() }.unwrap().join();
        outcome
    }

    pub fn run<const VERBOSE: bool>(
        destination: &[u8],
        path: &[u8],
    ) -> Result<bool, bun_core::Error> {
        let git_start = bun_core::time::nano_timestamp();

        // Not sure why...
        // But using libgit for this operation is slower than the CLI!
        // Used to have a feature flag to try it but was removed:
        // https://github.com/oven-sh/bun/commit/deafd3d0d42fb8d7ddf2b06cde2d7c7ee8bc7144
        //
        // ~/Build/throw
        // ❯ hyperfine "bun create react3 app --force --no-install" --prepare="rm -rf app"
        // Benchmark #1: bun create react3 app --force --no-install
        //   Time (mean ± σ):     974.6 ms ±   6.8 ms    [User: 170.5 ms, System: 798.3 ms]
        //   Range (min … max):   960.8 ms … 984.6 ms    10 runs
        //
        // ❯ mv /usr/local/opt/libgit2/lib/libgit2.dylib /usr/local/opt/libgit2/lib/libgit2.dylib.1
        //
        // ~/Build/throw
        // ❯ hyperfine "bun create react3 app --force --no-install" --prepare="rm -rf app"
        // Benchmark #1: bun create react3 app --force --no-install
        //   Time (mean ± σ):     306.7 ms ±   6.1 ms    [User: 31.7 ms, System: 269.8 ms]
        //   Range (min … max):   299.5 ms … 318.8 ms    10 runs

        // SAFETY: single-threaded CLI access to module-level static path buffer (note: this fn
        // may run on the git thread; BUN_PATH_BUF is also touched on main thread for `--open`.
        // The two uses are sequenced — git runs before `--open` block. Matches Zig.)
        let bun_path_buf = unsafe { &mut BUN_PATH_BUF };
        if let Some(git) = which(bun_path_buf, path, destination, b"git") {
            let git = bun_core::as_byte_slice(git);
            let git_commands: [&[&[u8]]; 3] = [
                &[git, b"init", b"--quiet"],
                &[git, b"add", destination, b"--ignore-errors"],
                &[git, b"commit", b"-am", b"Initial commit (via bun create)", b"--quiet"],
            ];

            if VERBOSE {
                Output::pretty_errorln("git backend: {}", format_args!("{}", bstr::BStr::new(git)));
            }

            // same names, just comptime known values
            // PORT NOTE: Zig used `inline for` over std.meta.fieldNames(@TypeOf(Commands)) to
            // index into git_commands by tuple field index. We just iterate the array directly.
            for command in git_commands {
                // TODO(port): std.process.Child — replace with bun_core::spawn_sync in Phase B
                let mut process = bun_core::process::Child::init(command);
                process.cwd = destination;
                process.stdin_behavior = bun_core::process::Stdio::Inherit;
                process.stdout_behavior = bun_core::process::Stdio::Inherit;
                process.stderr_behavior = bun_core::process::Stdio::Inherit;

                let _ = process.spawn_and_wait()?;
                let _ = process.kill();
            }

            Output::pretty_error("\n", format_args!(""));
            Output::print_start_end(git_start, bun_core::time::nano_timestamp());
            Output::pretty_error(" <d>git<r>\n", format_args!(""));
            return Ok(true);
        }

        Ok(false)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/create_command.zig (2460 lines)
//   confidence: low
//   todos:      31
//   notes:      Heavy use of mutable statics + std.fs/std.process; InjectionPrefill AST-static tree stubbed (only feeds dead code + npx_react_scripts_build); Output::pretty fmt-string positional args need macro rework; many borrow lifetimes faked as 'static.
// ──────────────────────────────────────────────────────────────────────────
