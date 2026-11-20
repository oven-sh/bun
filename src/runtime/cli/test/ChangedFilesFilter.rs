//! Implements `bun test --changed` (vitest-compatible).
//!
//! 1. Ask git for the set of changed files relative to HEAD (uncommitted,
//!    staged, and untracked) or relative to a user-supplied ref.
//! 2. Run the bundler over every discovered test file with packages marked
//!    external so node_modules are not entered. This produces the full parse
//!    graph (transitive imports) without linking or emitting code.
//! 3. Starting from each changed file that appears in the graph, walk the
//!    reverse import edges to find every test entry point that can reach it.
//!    A changed file that is not in the graph starts from the files whose
//!    import of it no longer resolves (it was deleted or renamed).
//!
//! Only those test entry points are returned. Preloads are entry points of
//! the scan too: every test file runs them, so a change that reaches one
//! selects every test file.

use bun_bundler::mal_prelude::*;

use bstr::BStr;

use bun_alloc::Arena;
use bun_ast::{ImportRecordFlags, Index};
use bun_bundler::{BundleV2, Transpiler};
use bun_collections::{DynamicBitSet, StringHashMap, StringSet};
use bun_core::PathBuffer as CorePathBuffer;
use bun_core::strings;
use bun_core::{self, Global, Output, ZBox, env_var, fmt as bun_fmt};
#[cfg(not(windows))]
use bun_core::{ZStr, getenv_z};
#[cfg(windows)]
use bun_jsc::EventLoopHandle;
use bun_jsc::virtual_machine::VirtualMachine;
#[cfg(not(windows))]
use bun_paths::SEP;
use bun_paths::{self, platform, resolve_path};
use bun_ptr::Interned;
#[cfg(not(windows))]
use bun_resolver::fs::RealFS;
use bun_resolver::resolver::rewritten_file_extensions;
use bun_sys as sys;
use bun_which::which;

use crate::Command;
use crate::api::bun_process::sync as spawn_sync;
use crate::cli::test::scanner::TEST_NAME_SUFFIXES;

// `core::result::Result` is fully qualified throughout this file to avoid the
// shadow.
pub(crate) struct Result<'a> {
    /// The filtered list of test files. Slice of the original `test_files`
    /// allocation, owned by the caller.
    pub(crate) test_files: &'a mut [Interned],
    /// Number of files git reported as changed.
    pub(crate) changed_count: usize,
    /// Number of test files before filtering.
    pub(crate) total_tests: usize,
    /// Absolute paths of every local source file that participates in the
    /// module graph (test entry points and everything they transitively
    /// import, excluding node_modules). Used by `--changed --watch` to watch
    /// files that would not otherwise be loaded when a subset of tests runs.
    /// Owned by the caller; each element is individually allocated.
    pub(crate) module_graph_files: Vec<Box<[u8]>>,
    /// Up to `CHANGED_SAMPLE` of the changed files, relative to the top-level
    /// dir. Filled only when they select no test file.
    pub(crate) changed_sample: Vec<Box<[u8]>>,
}

const CHANGED_SAMPLE: usize = 5;

/// A `--preload`, `[test] preload` or top-level `preload` entry.
enum Preload {
    /// The local file it resolves to. An entry point of the scan.
    File(Box<[u8]>),
    /// The path it names, which no file answers.
    Missing(Box<[u8]>),
}

/// What a set of changed files selects.
struct Selection {
    /// The sources that reach a changed file.
    affected: DynamicBitSet,
    /// A preload reaches a changed file. Every test file runs the preloads.
    preload_affected: bool,
    /// Indexes into the changed set: the paths that the scan did not parse
    /// and that no import and no preload names.
    unclaimed: Vec<usize>,
}

/// Filter `test_files` in place to only the entries whose module graph
/// reaches a changed file. On success, `test_files` is compacted (preserving
/// order) and the new length is returned via `Result.test_files`.
#[optimize(size)]
pub(crate) fn filter<'a>(
    ctx: &Command::Context,
    vm: &VirtualMachine,
    test_files: &'a mut [Interned],
    changed_since: &[u8],
) -> core::result::Result<Result<'a>, crate::Error> {
    let top_level_dir: &[u8] = bun_resolver::fs::FileSystem::get().top_level_dir();

    // If this process was restarted by the --watch file watcher, it
    // recorded exactly which files changed in this env var before
    // exec()ing. Use that as the changed-file set instead of re-querying
    // git, so editing one file re-runs only the tests that reach that
    // file rather than every test affected by any uncommitted change.
    // (On Windows the watcher restarts via TerminateProcess + parent
    // respawn, which cannot carry state, so this is POSIX-only; Windows
    // falls through to git below.)
    let watch_trigger = consume_watch_trigger();
    let from_watch_trigger = watch_trigger.is_some();
    let mut changed_files = if let Some(trigger_set) = watch_trigger {
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
            changed_sample: Vec::new(),
        });
    }

    // With a clean working tree and no --watch, nothing can be affected and
    // there is no watcher to seed, so skip the module-graph scan entirely.
    if changed_files.count() == 0 && ctx.debug.hot_reload != HotReload::Watch {
        let total = test_files.len();
        return Ok(Result {
            test_files: &mut test_files[0..0],
            changed_count: 0,
            total_tests: total,
            module_graph_files: Vec::new(),
            changed_sample: Vec::new(),
        });
    }

    // Build a dedicated transpiler for scanning. We do not reuse the VM's
    // transpiler because BundleV2.init takes ownership of the allocator and
    // log, and we want the runtime transpiler left untouched for actually
    // executing tests afterward.
    let arena: &'static Arena = crate::cli::cli_arena();
    let log: &'static mut bun_ast::Log = arena.alloc(bun_ast::Log::new());

    let mut scan_transpiler =
        match Transpiler::init(arena, log, ctx.args.clone(), Some(vm.transpiler.get().env)) {
            Ok(t) => t,
            Err(err) => {
                Output::err_generic(
                    "Failed to initialize module graph scanner for --changed: {s}",
                    (err.name(),),
                );
                Global::exit(1);
            }
        };
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
    // `Transpiler::init` already projected resolver.opts, so sync only the
    // fields we changed above.
    scan_transpiler.resolver.opts.target = scan_transpiler.options.target;
    scan_transpiler.resolver.opts.output_dir = Box::default();
    scan_transpiler.resolver.env_loader = core::ptr::NonNull::new(scan_transpiler.env);
    // A preload may be a package, so they are resolved before imports of
    // packages become external.
    let preloads = resolve_preloads(&mut scan_transpiler.resolver, &ctx.preloads, top_level_dir);
    scan_transpiler.resolver.opts.packages = bun_resolver::options::Packages::External;

    // Convert the interned-path list to []const []const u8 for the bundler.
    let mut entry_points: Vec<&[u8]> = test_files.iter().map(|p| p.as_bytes()).collect();
    for preload in &preloads {
        if let Preload::File(path) = preload {
            entry_points.push(path);
        }
    }

    // Stack-owned Mini loop so its tasks/concurrent_tasks queues drop at
    // scope exit; the arena bulk-free skips Drop.
    let event_loop = bun_event_loop::AnyEventLoop::init();

    let mut bundle = match BundleV2::scan_module_graph_from_cli(
        &mut scan_transpiler,
        arena,
        Some(core::ptr::NonNull::from(&event_loop)),
        &entry_points,
    ) {
        Ok(b) => b,
        Err(err) => {
            // Fall back to running every test rather than aborting the run.
            bun_core::warn!(
                "--changed: failed to build module graph ({}); running all tests",
                err.name()
            );
            Output::flush();
            let total = test_files.len();
            return Ok(Result {
                test_files,
                changed_count: changed_files.count(),
                total_tests: total,
                module_graph_files: Vec::new(),
                changed_sample: Vec::new(),
            });
        }
    };

    let scanned = &mut *bundle;
    let resolver = &mut scanned.transpiler.resolver;
    let sources = scanned.graph.input_files.items_source();
    let import_records = scanned.graph.ast.items_import_records();

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
        let first = bun_core::handle_oom(path_to_index.get_or_put(path_text));
        if first.found_existing {
            // One file under two `with { type }` loaders is two modules. An entry point is enqueued first.
            continue;
        }
        *first.value_ptr = u32::try_from(idx).unwrap();
        // Copy out of the bundler's arena so the caller can use these paths
        // after the BundleV2 heap is gone.
        graph_files.push(Box::<[u8]>::from(path_text));
    }

    for (idx, records) in import_records.iter().enumerate() {
        let importer = u32::try_from(idx).unwrap();
        for record in records.as_slice() {
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
        *out = path_to_index.get(tf.as_bytes()).copied();
    }

    let mut path_buf = bun_paths::path_buffer_pool::get();
    let mut select = |changed: &StringSet| -> Selection {
        // BFS backward from every changed file that participates in the graph.
        let mut affected = bun_core::handle_oom(DynamicBitSet::init_empty(sources.len()));
        let mut queue: Vec<u32> = Vec::new();
        let mut claimed = vec![false; changed.count()];

        for (idx, source) in sources.iter().enumerate() {
            if !source.path.is_file() {
                continue;
            }
            if let Some(entry) = changed.map.get_index(source.path.text) {
                claimed[entry] = true;
                affected.set(idx);
                queue.push(u32::try_from(idx).unwrap());
            }
        }

        // A changed path the scan did not parse is a deleted or renamed file
        // when an import that resolves to no source names it.
        let mut unclaimed: Vec<usize> = (0..claimed.len()).filter(|&i| !claimed[i]).collect();
        let mut preload_affected = false;
        if !unclaimed.is_empty() {
            let named = NamedByImports::new(changed.keys(), &unclaimed);
            for (idx, records) in import_records.iter().enumerate() {
                if !sources[idx].path.is_file() {
                    continue;
                }
                let dir = resolve_path::dirname::<platform::Auto>(sources[idx].path.text);
                let mut names_changed = false;
                for record in records.as_slice() {
                    let specifier = record.path.text;
                    if record.source_index.is_valid() {
                        continue;
                    }
                    if bun_paths::is_package_path(specifier) {
                        // A tsconfig.json "paths" alias whose file is gone is external to the scan.
                        resolver.for_each_tsconfig_paths_target(dir, specifier, |target| {
                            names_changed |= named.claim(target, &mut claimed);
                        });
                    } else if record.flags.contains(ImportRecordFlags::WAS_UNRESOLVED) {
                        let target = resolve_path::join_abs_string_buf_checked::<platform::Auto>(
                            dir,
                            &mut path_buf.0,
                            &[specifier],
                        );
                        if let Some(target) = target {
                            names_changed |= named.claim(target, &mut claimed);
                            resolver.for_each_main_field_target(target, |main| {
                                names_changed |= named.claim(main, &mut claimed);
                            });
                        }
                    }
                }
                if names_changed && !affected.is_set(idx) {
                    affected.set(idx);
                    queue.push(u32::try_from(idx).unwrap());
                }
            }
            for preload in &preloads {
                if let Preload::Missing(path) = preload {
                    preload_affected |= named.claim(path, &mut claimed);
                }
            }
            unclaimed.retain(|&i| !claimed[i]);
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

        for preload in &preloads {
            if let Preload::File(path) = preload {
                preload_affected |= match path_to_index.get(&**path) {
                    Some(&source) => affected.is_set(source as usize),
                    None => changed.contains(path),
                };
            }
        }

        Selection {
            affected,
            preload_affected,
            unclaimed,
        }
    };

    let mut selection = select(&changed_files);
    // The watcher names the files it watched. A test file that is gone was
    // deleted or renamed: git knows the new name.
    let is_gone_test_file = |&entry: &usize| {
        let path = &changed_files.keys()[entry];
        let name = without_extension(resolve_path::basename(path));
        TEST_NAME_SUFFIXES
            .iter()
            .any(|suffix| name.ends_with(suffix))
            && !sys::exists(path)
    };
    if from_watch_trigger && selection.unclaimed.iter().any(is_gone_test_file) {
        if let Ok(known_to_git) = get_changed_files(top_level_dir, changed_since) {
            for path in known_to_git.keys() {
                let _ = changed_files.insert(path); // OOM-only Result
            }
            selection = select(&changed_files);
        }
    }

    // A test file is selected if (a) its entry point source index is marked
    // affected, (b) the test file itself is in the changed set (covers
    // test files that failed to enter the graph for any reason), or (c) a
    // preload is affected.
    let mut write: usize = 0;
    // reshaped for borrowck — capture len before re-borrowing test_files
    let total = test_files.len();
    debug_assert_eq!(test_files.len(), slot_to_source.len());
    for i in 0..total {
        let tf = test_files[i];
        let maybe_source = slot_to_source[i];
        let keep = selection.preload_affected
            || changed_files.contains(tf.as_bytes())
            || maybe_source.is_some_and(|src| selection.affected.is_set(src as usize));

        if keep {
            test_files[write] = tf;
            write += 1;
        }
    }

    let mut changed_sample: Vec<Box<[u8]>> = Vec::new();
    if write == 0 {
        for path in changed_files.keys().iter().take(CHANGED_SAMPLE) {
            changed_sample.push(Box::from(resolve_path::relative(top_level_dir, path)));
        }
    }

    // `to_ast()` materializes `Vec<Symbol>` / `Vec<Part>` / `Vec<ImportRecord>` on the
    // global heap and the slab-only `MultiArrayList` drop never frees them, so
    // release the graph columns and the bundler-owned worker pool now that
    // everything needed has been copied out above.
    drop(bundle);

    Ok(Result {
        test_files: &mut test_files[0..write],
        changed_count: changed_files.count(),
        total_tests: total,
        module_graph_files: graph_files,
        changed_sample,
    })
}

/// Resolves the preloads like the runtime does when it loads them. A preload
/// in node_modules is left out: a change there is not a local edit.
fn resolve_preloads(
    resolver: &mut bun_resolver::Resolver<'_>,
    names: &[Box<[u8]>],
    top_level_dir: &[u8],
) -> Vec<Preload> {
    let mut preloads: Vec<Preload> = Vec::new();
    if names.is_empty() {
        return preloads;
    }
    let mut unread_log = bun_ast::Log::init();
    // SAFETY: the resolver and `unread_log` outlive the guard.
    let _log_scope = unsafe {
        bun_resolver::Resolver::scoped_log(
            &raw mut *resolver,
            core::ptr::NonNull::from(&mut unread_log),
        )
    };
    let mut buf = bun_paths::path_buffer_pool::get();
    for name in names {
        let name: &[u8] = name.strip_prefix(b"file://".as_slice()).unwrap_or(name);
        match resolver.resolve(top_level_dir, name, bun_ast::ImportKind::Stmt) {
            Ok(found) => {
                let file = found.path_pair.primary.text();
                if bun_paths::is_absolute(file)
                    && !bun_paths::string_paths::path_contains_node_modules_folder(file)
                {
                    preloads.push(Preload::File(Box::from(file)));
                }
            }
            Err(_) if bun_paths::is_package_path(name) => {}
            Err(_) => {
                let path = resolve_path::join_abs_string_buf_checked::<platform::Auto>(
                    top_level_dir,
                    &mut buf.0,
                    &[name],
                );
                if let Some(path) = path {
                    preloads.push(Preload::Missing(Box::from(path)));
                }
            }
        }
    }
    preloads
}

/// The changed paths that the scan did not parse, under each path that an
/// import which resolves to no source can name them with.
struct NamedByImports<'a> {
    paths: &'a [Box<[u8]>],
    /// (name, index into `paths`), sorted.
    names: Vec<(&'a [u8], usize)>,
}

impl<'a> NamedByImports<'a> {
    fn new(paths: &'a [Box<[u8]>], unclaimed: &[usize]) -> Self {
        let mut names: Vec<(&'a [u8], usize)> = Vec::with_capacity(unclaimed.len() * 2);
        for &entry in unclaimed {
            let path: &[u8] = &paths[entry];
            names.push((path, entry));
            // An import can leave the extension out.
            let stem = without_extension(path);
            if stem.len() != path.len() {
                names.push((stem, entry));
            }
            // An import of a directory reads its package.json or its index file.
            let name = resolve_path::basename(path);
            if name == b"package.json" || without_extension(name) == b"index" {
                names.push((resolve_path::dirname::<platform::Auto>(path), entry));
            }
        }
        names.sort_unstable();
        Self { paths, names }
    }

    /// `target` is a path that an import or a preload names and that resolved
    /// to no source. Marks the changed paths that the resolver could have
    /// picked for it while they existed, and reports whether there is one.
    fn claim(&self, target: &[u8], claimed: &mut [bool]) -> bool {
        let target = strings::without_trailing_slash(target);
        let mut any = self.claim_named(target, |_| true, claimed);
        // `./lib.js` finds lib.ts.
        let stem = without_extension(target);
        let rewritten = rewritten_file_extensions(&target[stem.len()..], || false);
        if !rewritten.is_empty() {
            let is_rewrite = |path: &[u8]| {
                without_extension(path) == stem && rewritten.contains(&&path[stem.len()..])
            };
            any |= self.claim_named(stem, is_rewrite, claimed);
        }
        any
    }

    fn claim_named(
        &self,
        name: &[u8],
        accept: impl Fn(&[u8]) -> bool,
        claimed: &mut [bool],
    ) -> bool {
        let first = self.names.partition_point(|&(other, _)| other < name);
        let mut any = false;
        for &(other, entry) in &self.names[first..] {
            if other != name {
                break;
            }
            if accept(&self.paths[entry]) {
                claimed[entry] = true;
                any = true;
            }
        }
        any
    }
}

fn without_extension(path: &[u8]) -> &[u8] {
    let name = resolve_path::basename(path);
    match strings::last_index_of_char(name, b'.') {
        Some(dot) if dot > 0 => &path[..path.len() - (name.len() - dot)],
        _ => path,
    }
}

#[cfg(not(windows))]
const TRIGGER_FILE_ENV_VAR_Z: &ZStr = bun_core::zstr!("BUN_INTERNAL_TEST_CHANGED_TRIGGER_FILE");

/// Make sure the trigger-file env var is set (generating a fresh temp
/// path if this is the first process in the --watch chain) and return the path.
pub(crate) fn init_watch_trigger() -> Option<ZBox> {
    #[cfg(windows)]
    {
        // Windows --watch restarts via TerminateProcess + parent
        // respawn with the parent's (unchanged) env, so a setenv in
        // the first child would not reach subsequent children. Fall
        // back to re-querying git on each restart there for now.
        return None;
    }

    #[cfg(not(windows))]
    {
        let path: ZBox = if let Some(existing) = getenv_z(TRIGGER_FILE_ENV_VAR_Z) {
            ZBox::from_bytes(existing)
        } else {
            let mut rand = [0u8; 16];
            bun_boringssl_sys::rand_bytes(&mut rand);
            let tmpdir = RealFS::tmpdir_path();
            let mut fresh: Vec<u8> = Vec::new();
            {
                use std::io::Write as _;
                write!(
                    &mut fresh,
                    "{}{}.bun-test-changed-{}.trigger",
                    BStr::new(strings::without_trailing_slash(tmpdir)),
                    SEP as char,
                    bun_fmt::hex_lower(&rand),
                )
                .expect("unreachable");
            }
            let fresh = ZBox::from_vec(fresh);
            // Export once so every exec()'d descendant inherits the same
            // path. Adding (not removing) an env var is safe w.r.t.
            // the environ snapshot; it simply won't be visible to code that
            // iterates the startup-captured slice in this process.
            // SAFETY: both strings are NUL-terminated; setenv copies into libc env storage.
            unsafe {
                libc::setenv(TRIGGER_FILE_ENV_VAR_Z.as_ptr(), fresh.as_ptr(), 1);
            }
            fresh
        };

        Some(path)
    }
}

/// If the previous process's watcher recorded which files triggered
/// this restart, read the newline-separated absolute-path list out of
/// the trigger file, delete the file, and return the set. Returns null
/// if the file is absent or empty (in which case the caller falls back
/// to querying git).
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
        for path in strings::tokenize_any(&contents, b"\r\n") {
            let _ = set.insert(path); // OOM-only Result
        }
        if set.count() == 0 {
            return None;
        }
        Some(set)
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub(crate) enum GitError {
    #[error("GitNotFound")]
    GitNotFound,
    #[error("GitFailed")]
    GitFailed,
}

/// Return the set of changed files (absolute paths) according to git.
///
/// With `since == ""` this is the union of unstaged, staged, and
/// untracked files. With a ref, it is `git diff --name-only <since>`
/// unioned with untracked files (a brand-new file is "changed since"
/// any prior commit). A deleted file is listed, and so is the old name
/// of a renamed one: their importers are affected.
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
    let git_root: Box<[u8]> =
        match run_git(git_path, top_level_dir, &[b"rev-parse", b"--show-toplevel"]) {
            GitResult::SpawnFailed => return Err(GitError::GitFailed),
            GitResult::ExitError { stderr } => {
                if !stderr.is_empty() {
                    Output::err_generic(
                        "--changed: {s}",
                        (BStr::new(strings::trim(&stderr, b" \r\n\t")),),
                    );
                } else {
                    Output::err_generic("--changed requires running inside a git repository", ());
                }
                return Err(GitError::GitFailed);
            }
            GitResult::Ok { stdout } => Box::<[u8]>::from(strings::trim(&stdout, b" \r\n\t")),
        };

    let mut set = StringSet::new();

    if since.is_empty() {
        // Uncommitted (unstaged + staged). `git diff HEAD` covers both.
        // On a repo with no commits, `HEAD` is unresolved; fall back to just
        // `git diff` (unstaged) + staged.
        match run_git(
            git_path,
            top_level_dir,
            &[&DIFF_NAMES[..], &[b"HEAD", b"--"]].concat(),
        ) {
            GitResult::SpawnFailed => return Err(GitError::GitFailed),
            GitResult::Ok { stdout } => append_paths(&mut set, &git_root, &stdout),
            GitResult::ExitError { .. } => {
                match run_git(
                    git_path,
                    top_level_dir,
                    &[&DIFF_NAMES[..], &[b"--"]].concat(),
                ) {
                    GitResult::SpawnFailed => return Err(GitError::GitFailed),
                    GitResult::Ok { stdout } => append_paths(&mut set, &git_root, &stdout),
                    GitResult::ExitError { .. } => {}
                }

                match run_git(
                    git_path,
                    top_level_dir,
                    &[&DIFF_NAMES[..], &[b"--cached", b"--"]].concat(),
                ) {
                    GitResult::SpawnFailed => return Err(GitError::GitFailed),
                    GitResult::Ok { stdout } => append_paths(&mut set, &git_root, &stdout),
                    GitResult::ExitError { .. } => {}
                }
            }
        }
    } else {
        match run_git(
            git_path,
            top_level_dir,
            &[&DIFF_NAMES[..], &[since, b"--"]].concat(),
        ) {
            GitResult::SpawnFailed => return Err(GitError::GitFailed),
            GitResult::ExitError { stderr } => {
                if !stderr.is_empty() {
                    Output::err_generic(
                        "--changed: {s}",
                        (BStr::new(strings::trim(&stderr, b" \r\n\t")),),
                    );
                } else {
                    Output::err_generic(
                        "--changed: git diff against {f} failed",
                        (bun_fmt::quote(since),),
                    );
                }
                return Err(GitError::GitFailed);
            }
            GitResult::Ok { stdout } => append_paths(&mut set, &git_root, &stdout),
        }
    }

    // Untracked files are always considered changed — a brand-new file
    // did not exist at HEAD or at `since`, so it is "changed since"
    // either. `git diff --name-only` never reports untracked files, so
    // supplement with ls-files in both branches above. `--full-name`
    // forces repo-root-relative output regardless of our cwd, matching
    // `git diff --name-only`.
    match run_git(
        git_path,
        top_level_dir,
        &[
            b"ls-files",
            b"-z",
            b"--others",
            b"--exclude-standard",
            b"--full-name",
        ],
    ) {
        GitResult::SpawnFailed => return Err(GitError::GitFailed),
        GitResult::Ok { stdout } => append_paths(&mut set, &git_root, &stdout),
        GitResult::ExitError { .. } => {}
    }

    Ok(set)
}

/// `git diff` that prints NUL-terminated paths relative to the repository
/// root, whatever the user's git config says. With renames off, the old name
/// of a renamed file is listed too.
const DIFF_NAMES: [&[u8]; 6] = [
    b"-c",
    b"diff.relative=false",
    b"diff",
    b"--name-only",
    b"-z",
    b"--no-renames",
];

pub(crate) enum GitResult {
    /// `run_git` has already reported the spawn error.
    SpawnFailed,
    ExitError {
        stderr: Vec<u8>,
    },
    Ok {
        stdout: Vec<u8>,
    },
}

#[optimize(size)]
fn run_git(git_path: &[u8], cwd: &[u8], args: &[&[u8]]) -> GitResult {
    let mut argv: Vec<&[u8]> = Vec::with_capacity(args.len() + 1);
    argv.push(git_path);
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
            // `init` takes the erased `*mut ()` event-loop pointer
            // directly, so unwrap it here.
            loop_: EventLoopHandle::init(VirtualMachine::get().event_loop_ptr()),
            ..Default::default()
        },
        ..Default::default()
    }) {
        Ok(p) => p,
        Err(err) => {
            Output::err_generic("--changed: failed to spawn git: {s}", (err.name(),));
            return GitResult::SpawnFailed;
        }
    };

    match proc {
        sys::Result::Err(err) => {
            Output::err_generic(
                "--changed: failed to spawn git: {f}",
                format_args!("{}", err),
            );
            GitResult::SpawnFailed
        }
        sys::Result::Ok(result) => {
            if result.is_ok() {
                GitResult::Ok {
                    stdout: result.stdout,
                }
            } else {
                GitResult::ExitError {
                    stderr: result.stderr,
                }
            }
        }
    }
}

/// Parse NUL-terminated repo-relative paths from `git -z` output, join each
/// with the repository root, and insert it into `set`.
fn append_paths(set: &mut StringSet, git_root: &[u8], stdout: &[u8]) {
    let mut buf = bun_paths::path_buffer_pool::get();
    for rel in strings::tokenize(stdout, b"\0") {
        let abs = resolve_path::join_abs_string_buf_checked::<platform::Auto>(
            git_root,
            &mut buf.0,
            &[rel],
        );
        let Some(abs) = abs else {
            continue;
        };
        // `StringSet.insert` dupes the key internally; abort on OOM rather
        // than propagating so the set can never be left holding a pointer
        // into our stack `buf` on the errdefer cleanup path.
        let _ = set.insert(abs); // OOM-only Result
    }
}

use crate::Command::HotReload;
