//! Implements `bun test --changed` (vitest-compatible).
//!
//! 1. Ask git for the set of changed files relative to HEAD (uncommitted,
//!    staged, and untracked) or relative to a user-supplied ref.
//! 2. Run the bundler over every discovered test file with packages marked
//!    external so node_modules are not entered. This produces the full parse
//!    graph (transitive imports) without linking or emitting code.
//! 3. Starting from each changed file that appears in the graph, walk the
//!    reverse import edges to find every test entry point that can reach it.
//!
//! Only those test entry points are returned.

use bun_bundler::mal_prelude::*;
use bun_collections::{ByteVecExt, VecExt};
use core::ffi::{c_char, c_int};

use bstr::BStr;

use bun_alloc::{AllocError, Arena};
use bun_ast::Index;
use bun_bundler::{BundleV2, Transpiler};
use bun_collections::{DynamicBitSet, StringHashMap, StringSet};
use bun_core::PathBuffer as CorePathBuffer;
use bun_core::{self, Global, Output, ZBox, env_var, fmt as bun_fmt, getenv_z};
use bun_core::{PathString, ZStr, strings};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, EventLoopHandle};
use bun_paths::{self, PathBuffer, SEP, platform, resolve_path};
use bun_resolver::fs::RealFS;
use bun_sys as sys;
use bun_which::which;

use crate::Command;
use crate::api::bun_process::sync as spawn_sync;

// PORT NOTE: named `Result` in Zig; kept verbatim for side-by-side diffing.
// `core::result::Result` is fully qualified throughout this file to avoid the
// shadow.
pub struct Result<'a> {
    /// The filtered list of test files. Slice of the original `test_files`
    /// allocation, owned by the caller.
    pub test_files: &'a mut [PathString],
    /// Number of files git reported as changed.
    pub changed_count: usize,
    /// Number of test files before filtering.
    pub total_tests: usize,
    /// Absolute paths of every local source file that participates in the
    /// module graph (test entry points and everything they transitively
    /// import, excluding node_modules). Used by `--changed --watch` to watch
    /// files that would not otherwise be loaded when a subset of tests runs.
    /// Owned by the caller; each element is individually allocated.
    pub module_graph_files: Vec<Box<[u8]>>,
}

/// Filter `test_files` in place to only the entries whose module graph
/// reaches a changed file. On success, `test_files` is compacted (preserving
/// order) and the new length is returned via `Result.test_files`.
// TODO(port): narrow error set
pub fn filter<'a>(
    ctx: &Command::Context,
    vm: &mut VirtualMachine,
    test_files: &'a mut [PathString],
    changed_since: &[u8],
) -> core::result::Result<Result<'a>, bun_core::Error> {
    let top_level_dir: &[u8] = bun_resolver::fs::FileSystem::get().top_level_dir;

    // If this process was restarted by the --watch file watcher, it
    // recorded exactly which files changed in this env var before
    // exec()ing. Use that as the changed-file set instead of re-querying
    // git, so editing one file re-runs only the tests that reach that
    // file rather than every test affected by any uncommitted change.
    // (On Windows the watcher restarts via TerminateProcess + parent
    // respawn, which cannot carry state, so this is POSIX-only; Windows
    // falls through to git below.)
    let changed_files = if let Some(trigger_set) = consume_watch_trigger() {
        trigger_set
    } else {
        match get_changed_files(top_level_dir, changed_since) {
            Ok(set) => set,
            Err(GitError::GitNotFound) => {
                Output::err_generic(
                    "<b>--changed<r> requires <b>git<r> to be installed and in PATH",
                    (),
                );
                Global::exit(1);
            }
            Err(GitError::GitFailed) => {
                // get_changed_files already printed the git error output.
                Global::exit(1);
            }
        }
    };

    if test_files.is_empty() {
        return Ok(Result {
            test_files: &mut test_files[0..0],
            changed_count: changed_files.count(),
            total_tests: 0,
            module_graph_files: Vec::new(),
        });
    }

    // With a clean working tree and no --watch, nothing can be affected and
    // there is no watcher to seed, so skip the module-graph scan entirely.
    if changed_files.count() == 0 && ctx.debug.hot_reload != HotReload::Watch {
        // TODO(port): `HotReload::Watch` enum path — confirm crate::cli::Command::HotReload
        let total = test_files.len();
        return Ok(Result {
            test_files: &mut test_files[0..0],
            changed_count: 0,
            total_tests: total,
            module_graph_files: Vec::new(),
        });
    }

    // Convert PathString list to []const []const u8 for the bundler.
    let entry_points: Vec<&[u8]> = test_files.iter().map(|p| p.slice()).collect();

    // Build a dedicated transpiler for scanning. We do not reuse the VM's
    // transpiler because BundleV2.init takes ownership of the allocator and
    // log, and we want the runtime transpiler left untouched for actually
    // executing tests afterward.
    //
    // PORT NOTE: `BundleV2::scan_module_graph_from_cli` takes
    // `&'a mut Transpiler<'a>` (invariant), so the arena, log, and transpiler
    // are process-lifetime. The Zig original does the same — see the comment
    // after the call about intentionally leaving the ThreadLocalArena and
    // worker pool alive. Route through the shared CLI arena.
    let arena: &'static Arena = crate::cli::cli_arena();
    let log: &'static mut bun_ast::Log = arena.alloc(bun_ast::Log::new());

    let scan_transpiler: &'static mut Transpiler<'static> = arena.alloc(
        match Transpiler::init(arena, log, ctx.args.clone(), Some(vm.transpiler.env)) {
            Ok(t) => t,
            Err(err) => {
                Output::err_generic(
                    "Failed to initialize module graph scanner for --changed: {s}",
                    (err.name(),),
                );
                Global::exit(1);
            }
        },
    );
    scan_transpiler.options.target = bun_ast::Target::Bun;
    // Do not follow bare specifiers into node_modules; changes there are not
    // considered local edits.
    scan_transpiler.options.packages = bun_bundler::options::PackagesOption::External;
    // The module graph scan is best-effort. A test file that imports
    // something unresolved should still be considered, not abort --changed.
    scan_transpiler.options.ignore_module_resolution_errors = true;
    scan_transpiler.options.output_dir = Box::default();
    scan_transpiler.options.tree_shaking = false;
    scan_transpiler.configure_linker();
    let _ = scan_transpiler.configure_defines();
    // Zig assigns `resolver.opts = options` by value; `Transpiler::init`
    // already projected resolver.opts, so sync only the fields we changed above.
    scan_transpiler.resolver.opts.target = scan_transpiler.options.target;
    scan_transpiler.resolver.opts.packages = bun_resolver::options::Packages::External;
    scan_transpiler.resolver.opts.output_dir = Box::default();
    scan_transpiler.resolver.env_loader = core::ptr::NonNull::new(scan_transpiler.env);

    // Zig: `jsc.AnyEventLoop.init(allocator)` — Mini loop that
    // `wait_for_parse` ticks to drain parse tasks; `None` panics there.
    let event_loop = arena.alloc(bun_event_loop::AnyEventLoop::init());

    let bundle = match BundleV2::scan_module_graph_from_cli(
        scan_transpiler,
        arena,
        Some(core::ptr::NonNull::from(event_loop)),
        &entry_points,
    ) {
        Ok(b) => b,
        Err(err) => {
            // Fall back to running every test rather than aborting the run.
            Output::warn(format_args!(
                "--changed: failed to build module graph ({}); running all tests",
                err.name()
            ));
            Output::flush();
            let total = test_files.len();
            return Ok(Result {
                test_files,
                changed_count: changed_files.count(),
                total_tests: total,
                module_graph_files: Vec::new(),
            });
        }
    };
    // The bundler's ThreadLocalArena and worker pool are intentionally
    // left in place for the remainder of the process. `bun test --watch`
    // exec()s a fresh process on each reload, so nothing accumulates
    // across restarts; tearing the pool down here blocks on worker
    // shutdown and competes with the runtime VM's own parse threads.

    // TODO(port): MultiArrayList `.items(.field)` accessor — confirm bun_collections API
    let sources = bundle.graph.input_files.items_source();
    let import_records = bundle.graph.ast.items_import_records();

    // Map absolute source path -> source index for paths that participate in
    // the graph. This lets us look up changed-file paths quickly.
    let mut path_to_index: StringHashMap<u32> = StringHashMap::new();
    path_to_index.reserve(sources.len());

    // Reverse graph: for each source index, the list of source indexes that
    // import it. Built once, then used for a backward BFS from every changed
    // file.
    let mut importers: Vec<Vec<u32>> = vec![Vec::new(); sources.len()];

    // Reserve once so the dupe+append below cannot leak a duped path if the
    // list ever needed to grow and failed.
    let mut graph_files: Vec<Box<[u8]>> = Vec::with_capacity(sources.len());

    for (idx, source) in sources.iter().enumerate() {
        let index = Index::init(u32::try_from(idx).unwrap());
        if index.is_runtime() {
            continue;
        }
        let path_text: &[u8] = source.path.text;
        if path_text.is_empty() {
            continue;
        }
        // Only record real on-disk files (the bundler reserves a few
        // virtual slots whose namespace is not "file").
        if !source.path.is_file() {
            continue;
        }
        // All scanned entry points are absolute, and the resolver emits
        // absolute file paths as well.
        // PERF(port): was putAssumeCapacity — profile in Phase B
        path_to_index.put_assume_capacity(path_text, u32::try_from(idx).unwrap());
        // Copy out of the bundler's arena so the caller can use these paths
        // after the BundleV2 heap is gone.
        // PERF(port): was appendAssumeCapacity — profile in Phase B
        graph_files.push(Box::<[u8]>::from(path_text));
    }

    for (idx, records) in import_records.iter().enumerate() {
        let importer = u32::try_from(idx).unwrap();
        for record in records.slice() {
            let dep = record.source_index;
            if !dep.is_valid() || dep.is_runtime() {
                continue;
            }
            if dep.get() as usize >= sources.len() {
                continue;
            }
            importers[dep.get() as usize].push(importer);
        }
    }

    // Map the original test_files slot -> bundler source index. An entry
    // point that failed to resolve is skipped by enqueueEntryPoints, so
    // match by absolute path via path_to_index rather than by position.
    let mut slot_to_source: Vec<Option<u32>> = vec![None; test_files.len()];
    debug_assert_eq!(test_files.len(), slot_to_source.len());
    for (tf, out) in test_files.iter().zip(slot_to_source.iter_mut()) {
        *out = path_to_index.get(tf.slice()).copied();
    }

    // BFS backward from every changed file that participates in the graph.
    let mut affected = bun_core::handle_oom(DynamicBitSet::init_empty(sources.len()));
    let mut queue: Vec<u32> = Vec::new();

    {
        // TODO(port): StringSet iteration API — Zig accesses `.map.iterator()`
        for changed_path in changed_files.keys() {
            if let Some(&idx) = path_to_index.get(changed_path.as_ref()) {
                if !affected.is_set(idx as usize) {
                    affected.set(idx as usize);
                    queue.push(idx);
                }
            }
        }
    }

    while let Some(idx) = queue.pop() {
        for &importer in &importers[idx as usize] {
            if affected.is_set(importer as usize) {
                continue;
            }
            affected.set(importer as usize);
            queue.push(importer);
        }
    }

    // A test file is selected if (a) its entry point source index is marked
    // affected, or (b) the test file itself is in the changed set (covers
    // test files that failed to enter the graph for any reason).
    let mut write: usize = 0;
    // PORT NOTE: reshaped for borrowck — capture len before re-borrowing test_files
    let total = test_files.len();
    debug_assert_eq!(test_files.len(), slot_to_source.len());
    for i in 0..total {
        let tf = test_files[i];
        let maybe_source = slot_to_source[i];
        let keep = changed_files.contains(tf.slice())
            || maybe_source.map_or(false, |src| affected.is_set(src as usize));

        if keep {
            test_files[write] = tf;
            write += 1;
        }
    }

    Ok(Result {
        test_files: &mut test_files[0..write],
        changed_count: changed_files.count(),
        total_tests: total,
        module_graph_files: graph_files,
    })
}

/// Env var carrying the absolute path of the temp file that the
/// previous process's watcher wrote its changed-path list into before
/// exec()ing. Set once by `initWatchTrigger` in the first process and
/// inherited through every restart. The value is a short path, never
/// the list itself, so there is no env size concern.
pub const TRIGGER_FILE_ENV_VAR: &str = "BUN_INTERNAL_TEST_CHANGED_TRIGGER_FILE";
const TRIGGER_FILE_ENV_VAR_Z: &ZStr =
    ZStr::from_static(b"BUN_INTERNAL_TEST_CHANGED_TRIGGER_FILE\0");

/// Make sure the trigger-file env var is set (generating a fresh temp
/// path if this is the first process in the --watch chain) and wire up
/// the hot-reloader collector to record changed paths. The collector
/// and the path string intentionally live for the rest of the process;
/// --watch exec()s on reload so nothing accumulates across restarts.
pub fn init_watch_trigger() {
    #[cfg(windows)]
    {
        // Windows --watch restarts via TerminateProcess + parent
        // respawn with the parent's (unchanged) env, so a setenv in
        // the first child would not reach subsequent children. Fall
        // back to re-querying git on each restart there for now.
        return;
    }

    #[cfg(not(windows))]
    {
        let path: ZBox = if let Some(existing) = getenv_z(TRIGGER_FILE_ENV_VAR_Z) {
            ZBox::from_bytes(existing)
        } else {
            // TODO(port): std.Random.DefaultPrng / std.time.milliTimestamp / std.c.getpid —
            // pick Rust equivalents (likely bun_core::time::milli_timestamp() ^ libc::getpid())
            // SAFETY: getpid is always safe.
            let seed: u64 =
                bun_core::time::milli_timestamp() as u64 ^ unsafe { libc::getpid() } as u64;
            let rand: u64 = bun_wyhash::hash(&seed.to_ne_bytes());
            // TODO(port): Zig used DefaultPrng (xoshiro256++); wyhash-of-seed is a placeholder
            let tmpdir = RealFS::tmpdir_path();
            let mut fresh: Vec<u8> = Vec::new();
            {
                use std::io::Write as _;
                write!(
                    &mut fresh,
                    "{}{}{}{:x}{}",
                    BStr::new(strings::without_trailing_slash(tmpdir)),
                    SEP as char,
                    ".bun-test-changed-",
                    rand,
                    ".trigger",
                )
                .expect("unreachable");
            }
            let fresh = ZBox::from_vec(fresh);
            // Export once so every exec()'d descendant inherits the same
            // path. Adding (not removing) an env var is safe w.r.t.
            // `std.os.environ`; it simply won't be visible to code that
            // iterates the startup-captured slice in this process.
            // SAFETY: both strings are NUL-terminated; setenv copies into libc env storage.
            unsafe {
                setenv(TRIGGER_FILE_ENV_VAR_Z.as_ptr(), fresh.as_ptr(), 1);
            }
            fresh
        };

        // Process-lifetime singletons — store in the CLI arena so the borrows
        // are legitimately `&'static`.
        let arena = crate::cli::cli_arena();
        let set: &'static mut StringSet = arena.alloc(StringSet::new());
        // Written once on the main thread before the watcher thread starts;
        // after that only the watcher thread touches these. See doc on
        // `hot_reloader::WATCH_CHANGED_PATHS`.
        let _ = jsc::hot_reloader::WATCH_CHANGED_TRIGGER_FILE.set(arena.alloc(path).as_zstr());
        let _ = jsc::hot_reloader::WATCH_CHANGED_PATHS
            .set(jsc::hot_reloader::WatchChangedPaths::new(set));
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub fn setenv(name: *const c_char, value: *const c_char, overwrite: c_int) -> c_int;
}

/// If the previous process's watcher recorded which files triggered
/// this restart, read the newline-separated absolute-path list out of
/// the trigger file, delete the file, and return the set. Returns null
/// if the file is absent, empty, or every path no longer exists (in
/// which case the caller falls back to querying git).
fn consume_watch_trigger() -> Option<StringSet> {
    #[cfg(windows)]
    {
        return None;
    }

    #[cfg(not(windows))]
    {
        let trigger_path_raw = getenv_z(TRIGGER_FILE_ENV_VAR_Z)?;
        if trigger_path_raw.is_empty() {
            return None;
        }
        let trigger_path = ZBox::from_bytes(trigger_path_raw);

        let contents = match sys::File::read_from(sys::Fd::cwd(), &trigger_path) {
            sys::Result::Ok(bytes) => bytes,
            sys::Result::Err(_) => return None,
        };
        // Consume-once: the next restart writes a fresh list. If the
        // process restarts for any other reason (crash + auto-reload) it
        // should fall back to git, not re-read a stale list.
        let _ = sys::unlink(&trigger_path);

        let mut set = StringSet::new();
        for path in contents
            .split(|b| *b == b'\r' || *b == b'\n')
            .filter(|s| !s.is_empty())
        {
            if path.is_empty() {
                continue;
            }
            // The watcher may see a file disappear (delete/rename). A path
            // that no longer exists cannot appear in the module graph this
            // run, so drop it; its importers will still be picked up if the
            // importer file itself was touched.
            if !sys::exists(path) {
                continue;
            }
            let _ = set.insert(path); // OOM-only Result (Zig: catch unreachable)
        }
        // If every triggering path was a deletion, fall back to git so the
        // user at least gets the same behaviour as the initial run rather
        // than "0 changed files, nothing to run".
        if set.count() == 0 {
            return None;
        }
        Some(set)
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum GitError {
    #[error("GitNotFound")]
    GitNotFound,
    #[error("GitFailed")]
    GitFailed,
    // PORT NOTE: Zig union'd `std.mem.Allocator.Error` here; allocator params
    // were dropped (global mimalloc aborts on OOM), so OutOfMemory is gone.
}

bun_core::named_error_set!(GitError);

/// Return the set of changed files (absolute paths) according to git.
///
/// With `since == ""` this is the union of unstaged, staged, and
/// untracked files. With a ref, it is `git diff --name-only <since>`
/// unioned with untracked files (a brand-new file is "changed since"
/// any prior commit). Paths that do not exist on disk (deletions) are
/// skipped since they cannot appear in the module graph.
fn get_changed_files(
    top_level_dir: &[u8],
    since: &[u8],
) -> core::result::Result<StringSet, GitError> {
    let mut which_buf = CorePathBuffer([0u8; bun_core::MAX_PATH_BYTES]);
    let Some(git_path) = which(
        &mut which_buf,
        env_var::PATH.get().unwrap_or(b""),
        top_level_dir,
        b"git",
    ) else {
        return Err(GitError::GitNotFound);
    };

    // Find the git repository root so we can make the paths git prints
    // absolute (git prints paths relative to the repo toplevel with these
    // commands).
    let git_root: Box<[u8]> = 'blk: {
        let result = run_git(git_path, top_level_dir, &[b"rev-parse", b"--show-toplevel"]);
        if !result.ok {
            if result.spawn_failed {
                // run_git already printed the spawn error.
            } else if !result.stderr.is_empty() {
                Output::err_generic(
                    "--changed: {s}",
                    (BStr::new(strings::trim(&result.stderr, b" \r\n\t")),),
                );
            } else {
                Output::err_generic("--changed requires running inside a git repository", ());
            }
            return Err(GitError::GitFailed);
        }
        break 'blk Box::<[u8]>::from(strings::trim(&result.stdout, b" \r\n\t"));
    };

    let mut set = StringSet::new();

    if since.is_empty() {
        // Uncommitted (unstaged + staged). `git diff HEAD` covers both.
        // On a repo with no commits, `HEAD` is unresolved; fall back to just
        // `git diff` (unstaged) + staged.
        let diff = run_git(
            git_path,
            top_level_dir,
            &[b"diff", b"--name-only", b"HEAD", b"--"],
        );
        if diff.spawn_failed {
            return Err(GitError::GitFailed);
        }
        if diff.ok {
            append_paths(&mut set, &git_root, &diff.stdout);
        } else {
            let unstaged = run_git(git_path, top_level_dir, &[b"diff", b"--name-only", b"--"]);
            if unstaged.spawn_failed {
                return Err(GitError::GitFailed);
            }
            if unstaged.ok {
                append_paths(&mut set, &git_root, &unstaged.stdout);
            }

            let staged = run_git(
                git_path,
                top_level_dir,
                &[b"diff", b"--name-only", b"--cached", b"--"],
            );
            if staged.spawn_failed {
                return Err(GitError::GitFailed);
            }
            if staged.ok {
                append_paths(&mut set, &git_root, &staged.stdout);
            }
        }
    } else {
        let diff = run_git(
            git_path,
            top_level_dir,
            &[b"diff", b"--name-only", since, b"--"],
        );
        if !diff.ok {
            if diff.spawn_failed {
                // run_git already printed the spawn error.
            } else if !diff.stderr.is_empty() {
                Output::err_generic(
                    "--changed: {s}",
                    (BStr::new(strings::trim(&diff.stderr, b" \r\n\t")),),
                );
            } else {
                Output::err_generic(
                    "--changed: git diff against {f} failed",
                    (bun_fmt::quote(since),),
                );
            }
            return Err(GitError::GitFailed);
        }
        append_paths(&mut set, &git_root, &diff.stdout);
    }

    // Untracked files are always considered changed — a brand-new file
    // did not exist at HEAD or at `since`, so it is "changed since"
    // either. `git diff --name-only` never reports untracked files, so
    // supplement with ls-files in both branches above. `--full-name`
    // forces repo-root-relative output regardless of our cwd, matching
    // `git diff --name-only`.
    {
        let untracked = run_git(
            git_path,
            top_level_dir,
            &[
                b"ls-files",
                b"--others",
                b"--exclude-standard",
                b"--full-name",
            ],
        );
        if untracked.spawn_failed {
            return Err(GitError::GitFailed);
        }
        if untracked.ok {
            append_paths(&mut set, &git_root, &untracked.stdout);
        }
    }

    Ok(set)
}

pub struct GitResult {
    pub ok: bool,
    /// Set when the git process could not be spawned at all. The failure
    /// has already been reported; callers should not print a second
    /// "not a git repo" style message.
    pub spawn_failed: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl Default for GitResult {
    fn default() -> Self {
        Self {
            ok: false,
            spawn_failed: false,
            stdout: Vec::new(),
            stderr: Vec::new(),
        }
    }
}

fn run_git(git_path: &[u8], cwd: &[u8], args: &[&[u8]]) -> GitResult {
    let mut argv: Vec<&[u8]> = Vec::with_capacity(args.len() + 3);
    // PERF(port): was appendAssumeCapacity — profile in Phase B
    argv.push(git_path);
    // `core.quotePath` (on by default) wraps non-ASCII filenames in quotes
    // and emits octal escapes. We want raw UTF-8 paths so they match the
    // bundler's resolved paths byte-for-byte.
    argv.push(b"-c");
    argv.push(b"core.quotePath=off");
    argv.extend_from_slice(args);

    let proc = match spawn_sync::spawn(&spawn_sync::Options {
        argv: argv.iter().map(|s| Box::<[u8]>::from(*s)).collect(),
        cwd: Box::<[u8]>::from(cwd),
        stdout: spawn_sync::SyncStdio::Buffer,
        stderr: spawn_sync::SyncStdio::Buffer,
        stdin: spawn_sync::SyncStdio::Ignore,
        envp: None,
        // The test command has a JSC VM running; reuse its event loop on
        // Windows rather than spinning up a MiniEventLoop.
        #[cfg(windows)]
        windows: spawn_sync::WindowsOptions {
            // PORT NOTE: Zig `EventLoopHandle.init(anytype)` accepted a
            // `*VirtualMachine` and called `vm.eventLoop()` internally; the
            // Rust split keeps `init` taking the erased `*mut ()` event-loop
            // pointer directly, so unwrap it here.
            loop_: EventLoopHandle::init(VirtualMachine::get().event_loop().cast()),
            ..Default::default()
        },
        ..Default::default()
    }) {
        Ok(p) => p,
        Err(err) => {
            Output::err_generic("--changed: failed to spawn git: {s}", (err.name(),));
            return GitResult {
                ok: false,
                spawn_failed: true,
                stdout: Vec::new(),
                stderr: Vec::new(),
            };
        }
    };

    match proc {
        sys::Result::Err(err) => {
            Output::err_generic(
                "--changed: failed to spawn git: {f}",
                format_args!("{}", err),
            );
            GitResult {
                ok: false,
                spawn_failed: true,
                stdout: Vec::new(),
                stderr: Vec::new(),
            }
        }
        sys::Result::Ok(result) => GitResult {
            ok: result.is_ok(),
            spawn_failed: false,
            stdout: result.stdout,
            stderr: result.stderr,
        },
    }
}

/// Parse newline-delimited repo-relative paths from git output, join each
/// with the repository root, and insert existing files into `set`.
fn append_paths(set: &mut StringSet, git_root: &[u8], stdout: &[u8]) {
    let mut buf = PathBuffer::uninit();
    for line in stdout
        .split(|b| *b == b'\r' || *b == b'\n')
        .filter(|s| !s.is_empty())
    {
        let rel = strings::trim(line, b" \t");
        if rel.is_empty() {
            continue;
        }
        let abs = resolve_path::join_abs_string_buf::<platform::Auto>(git_root, &mut buf.0, &[rel]);
        // Skip deletions; the bundler can only parse files that exist.
        if !sys::exists(abs) {
            continue;
        }
        // `StringSet.insert` dupes the key internally; abort on OOM rather
        // than propagating so the set can never be left holding a pointer
        // into our stack `buf` on the errdefer cleanup path.
        let _ = set.insert(abs); // OOM-only Result (Zig: catch unreachable)
    }
}

// TODO(port): `HotReload` enum import — placeholder for `ctx.debug.hot_reload != .watch` check
use crate::Command::HotReload;

// ported from: src/cli/test/ChangedFilesFilter.zig
