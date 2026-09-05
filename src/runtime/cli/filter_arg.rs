use core::ptr::NonNull;

use bstr::BStr;
use bun_ast::{self, ExprData, Log};
use bun_core::Global;
use bun_core::Output;
use bun_core::{ZStr, strings};
use bun_glob as glob;
use bun_install::package_manager::workspace_selection::{
    self, Candidate, RootSelection, WorkspaceGraph,
};
use bun_parsers::json;
use bun_paths::path_buffer_pool;
use bun_paths::{PathBuffer, platform, resolve_path};
use bun_resolver::package_json::{IncludeDependencies, IncludeScripts};
use bun_sys;

use crate::cli::Command;

const SKIP_LIST: &[&[u8]] = &[
    // skip hidden directories
    b".",
    // skip node_modules
    b"node_modules",
    // skip .git folder
    b".git",
];

fn glob_ignore_fn(val: &[u8]) -> bool {
    if val.is_empty() {
        return false;
    }

    for skip in SKIP_LIST {
        if val == *skip {
            return true;
        }
    }

    false
}

// The ignore filter is a runtime parameter on `init_with_cwd`, and
// `DirEntryAccessor` lives in `bun_resolver` (it depends on the resolver's
// DirEntry cache).
type GlobWalker = glob::GlobWalker<bun_resolver::DirEntryAccessor, false>;
// Borrows the `OwnedWalker` stored next to it in `ActiveWalk`, with the lifetime erased.
type GlobWalkerIterator = glob::walk::Iterator<'static, bun_resolver::DirEntryAccessor, false>;

fn get_candidate_package_patterns<'a>(
    log: &mut Log,
    out_patterns: &mut Vec<Box<[u8]>>,
    workdir_: &[u8],
    root_buf: &'a mut PathBuffer,
) -> Result<&'a [u8], crate::Error> {
    bun_ast::expr::data::Store::create();
    bun_ast::stmt::data::Store::create();
    let _store_guard = bun_ast::StoreResetGuard::new();

    let mut workdir = workdir_;

    // Labeled loop with an inner labeled block; `continue` → `break 'body`,
    // `break` → `break 'walk`.
    'walk: loop {
        'body: {
            let mut name_buf = PathBuffer::uninit();
            let name_buf_len = name_buf.len();
            // Does not fit: as unreadable as a missing package.json, so try the parent.
            let Some(json_path) = resolve_path::join_abs_string_buf_checked::<platform::Auto>(
                workdir,
                &mut name_buf[..name_buf_len - 1],
                &[b"package.json".as_slice()],
            ) else {
                break 'body;
            };
            let json_path_len = json_path.len();
            name_buf[json_path_len] = 0;
            let json_path: &ZStr = ZStr::from_buf(&name_buf[..], json_path_len);

            log.msgs.clear();
            log.errors = 0;
            log.warnings = 0;

            // Note: `bun.sys.File.toSource` was MOVE_DOWN'd to `bun_ast::to_source`
            // (T1 cannot name T2 — see src/sys/File.rs:446).
            let json_source = match bun_ast::to_source(json_path, Default::default()) {
                Err(err) => match err.get_errno() {
                    bun_sys::Errno::ENOENT | bun_sys::Errno::EACCES | bun_sys::Errno::EPERM => {
                        break 'body;
                    }
                    _ => return Err(err.into()),
                },
                Ok(source) => source,
            };
            // `defer allocator.free(json_source.contents)` — deleted; `json_source` owns its
            // contents and drops at end of scope.

            let parsed = json::ParsedJson::parse_package_json(&json_source, log)?;
            let json = parsed.root;

            let Some(prop) = json.as_property(b"workspaces") else {
                break 'body;
            };

            let json_array = match prop.expr.data {
                ExprData::EArrayJSON(arr) => arr,
                ExprData::EObjectJSON(obj) => match (*obj).get(b"packages") {
                    Some(bun_ast::e::JsonValue::Array(arr)) => *arr,
                    _ => break 'walk,
                },
                _ => break 'walk,
            };

            for item in json_array.get().items() {
                match item {
                    bun_ast::e::JsonValue::String(pattern_str) => {
                        let pattern_bytes = pattern_str.slice();
                        let size = pattern_bytes.len() + b"/package.json".len();
                        let mut pattern = vec![0u8; size].into_boxed_slice();
                        pattern[0..pattern_bytes.len()].copy_from_slice(pattern_bytes);
                        pattern[pattern_bytes.len()..size].copy_from_slice(b"/package.json");

                        out_patterns.push(pattern);
                    }
                    _ => {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r>: Failed to parse \"workspaces\" property: all items must be strings"
                        );
                        Global::exit(1);
                    }
                }
            }

            let parent_trimmed = strings::without_trailing_slash(workdir);
            root_buf[0..parent_trimmed.len()].copy_from_slice(parent_trimmed);
            return Ok(&root_buf[0..parent_trimmed.len()]);
        }

        workdir = match bun_core::dirname(workdir) {
            Some(d) => d,
            None => break 'walk,
        };
    }

    // if we were not able to find a workspace root, we simply glob for all package.json files
    out_patterns.push(Box::<[u8]>::from(b"**/package.json".as_slice()));
    let root_dir = strings::without_trailing_slash(workdir_);
    root_buf[0..root_dir.len()].copy_from_slice(root_dir);
    Ok(&root_buf[0..root_dir.len()])
}

pub(crate) struct WorkspacePackage {
    pub(crate) package_json_path: Box<[u8]>,
    pub(crate) dir: Box<[u8]>,
    pub(crate) json: bun_resolver::PackageJSON,
}

pub(crate) struct SelectedPackages {
    pub(crate) root_dir: Box<[u8]>,
    pub(crate) packages: Vec<WorkspacePackage>,
}

/// Discovers the workspace packages under `cwd` and returns the ones `--filter` / `--workspaces` select, in discovery order.
pub(crate) fn select_packages(
    ctx: &Command::ContextData,
    resolver: &mut bun_resolver::Resolver<'_>,
    cwd: &[u8],
) -> Result<SelectedPackages, crate::Error> {
    let patterns: Vec<&[u8]> = if ctx.workspaces {
        vec![b"*".as_slice()]
    } else {
        ctx.filters.iter().map(|f| &f[..]).collect()
    };

    let mut glob_patterns: Vec<Box<[u8]>> = Vec::new();
    let mut root_buf = PathBuffer::uninit();
    let root_dir: Box<[u8]> = get_candidate_package_patterns(
        // SAFETY: `ctx.log` is the process-static `Cli::LOG_`; CLI dispatch is single-threaded and no other `&mut Log` is live.
        unsafe { ctx.log_mut() },
        &mut glob_patterns,
        cwd,
        &mut root_buf,
    )?
    .into();

    let mut iter = PackageFilterIterator::init(&glob_patterns, &root_dir)?;
    let mut discovered: Vec<WorkspacePackage> = Vec::new();
    while let Some(package_json_path) = iter.next()? {
        let dir = strings::without_trailing_slash(resolve_path::dirname::<platform::Auto>(
            &package_json_path,
        ));
        if ctx.workspaces && dir == &*root_dir {
            continue;
        }
        let Some(json) = bun_resolver::PackageJSON::parse::<{ IncludeDependencies::Main }>(
            resolver,
            dir,
            bun_sys::Fd::invalid(),
            None,
            IncludeScripts::IncludeScripts,
        ) else {
            bun_core::warn!(
                "Failed to read {}, skipping this workspace package\n",
                bun_core::fmt::quote(&*package_json_path),
            );
            continue;
        };
        discovered.push(WorkspacePackage {
            dir: dir.into(),
            package_json_path,
            json,
        });
    }

    let mut path_buf = path_buffer_pool::get();
    let posix_dirs: Vec<Box<[u8]>> = discovered
        .iter()
        .map(|p| {
            strings::without_trailing_slash(resolve_path::join_abs_string_buf::<platform::Posix>(
                &p.dir,
                &mut path_buf.0,
                &[b".".as_slice()],
            ))
            .into()
        })
        .collect();
    drop(path_buf);

    let candidates: Vec<Candidate<'_>> = discovered
        .iter()
        .zip(&posix_dirs)
        .map(|(p, dir)| Candidate {
            name: &p.json.name,
            abs_posix_dir: dir,
            is_root: false,
        })
        .collect();

    let graph: Option<WorkspaceGraph> =
        workspace_selection::first_relational(&patterns).map(|_| {
            let names: Vec<&[u8]> = discovered.iter().map(|p| &p.json.name[..]).collect();
            WorkspaceGraph::from_dependency_names(&names, |i| {
                let deps = &discovered[i].json.dependencies;
                let buf = deps.source_buf;
                deps.map.keys().iter().map(move |k| k.slice(buf))
            })
        });

    let selection = workspace_selection::select(
        &patterns,
        cwd,
        &candidates,
        graph.as_ref(),
        RootSelection::Implicit,
    );
    let packages: Vec<WorkspacePackage> = discovered
        .into_iter()
        .enumerate()
        .filter(|&(i, _)| selection.selected.is_set(i))
        .map(|(_, p)| p)
        .collect();
    if packages.is_empty() {
        if ctx.if_present {
            Global::exit(0);
        }
        if ctx.workspaces {
            Output::err_generic("No workspace packages found", ());
            Global::exit(1);
        }
        workspace_selection::error_unmatched(&patterns);
    }
    workspace_selection::warn_unmatched(&patterns, &selection.unmatched_patterns);
    Ok(SelectedPackages { root_dir, packages })
}

impl WorkspacePackage {
    /// `package.json` name, or the directory relative to the workspace root for unnamed packages.
    pub(crate) fn display_name(&self, root_dir: &[u8]) -> Box<[u8]> {
        if self.json.name.is_empty() {
            Box::from(resolve_path::relative_platform::<platform::Posix, false>(
                root_dir, &self.dir,
            ))
        } else {
            Box::from(&self.json.name[..])
        }
    }
}

impl SelectedPackages {
    /// `error: Script "x" not found in package "a"` / `... in 3 packages matching "a*"` /
    /// `... in 3 workspace packages`, then exit 1. `scripts` is already quoted.
    pub(crate) fn error_script_not_found(&self, ctx: &Command::ContextData, scripts: &[u8]) -> ! {
        let n = self.packages.len();
        if n == 1 {
            Output::err_generic(
                "Script {} not found in package \"{}\"",
                (
                    BStr::new(scripts),
                    BStr::new(&self.packages[0].display_name(&self.root_dir)),
                ),
            );
        } else if ctx.workspaces {
            Output::err_generic(
                "Script {} not found in {} workspace packages",
                (BStr::new(scripts), n),
            );
        } else {
            let patterns: Vec<&[u8]> = ctx.filters.iter().map(|f| &**f).collect();
            Output::err_generic(
                "Script {} not found in {} packages matching {}",
                (
                    BStr::new(scripts),
                    n,
                    BStr::new(&workspace_selection::quote_patterns(&patterns)),
                ),
            );
        }
        Global::exit(1);
    }
}

// Heap-allocated so the walker keeps its address while the `PackageFilterIterator` moves. Held as
// a `NonNull` rather than a `Box` because moving a `Box` asserts unique access, which the
// `GlobWalkerIterator` borrowing the walker would violate.
struct OwnedWalker(NonNull<GlobWalker>);

impl Drop for OwnedWalker {
    fn drop(&mut self) {
        // SAFETY: allocated by `heap::alloc_nn` in `start_walk` and freed only here; the
        // `GlobWalkerIterator` borrowing it is always dropped first (see `ActiveWalk`).
        unsafe { bun_core::heap::destroy(self.0.as_ptr()) };
    }
}

// Field order is drop order: `iter` borrows `_walker`, so it must go first.
struct ActiveWalk {
    iter: GlobWalkerIterator,
    _walker: OwnedWalker,
}

struct PackageFilterIterator<'a> {
    patterns: &'a [Box<[u8]>],
    pattern_idx: usize,
    root_dir: &'a [u8],
    /// The walk for `patterns[pattern_idx]`; `None` until `next` starts it.
    active: Option<ActiveWalk>,
}

impl<'a> PackageFilterIterator<'a> {
    fn init(
        patterns: &'a [Box<[u8]>],
        root_dir: &'a [u8],
    ) -> Result<PackageFilterIterator<'a>, crate::Error> {
        Ok(PackageFilterIterator {
            patterns,
            pattern_idx: 0,
            root_dir,
            active: None,
        })
    }

    fn start_walk(&self) -> Result<ActiveWalk, crate::Error> {
        // pattern_idx < patterns.len() checked by caller.
        let pattern: &[u8] = &self.patterns[self.pattern_idx];
        // bun_glob copies `pattern`/`cwd` internally.
        // outer `?` propagates the error, inner converts `Maybe(Self)` to a Result.
        let walker = OwnedWalker(bun_core::heap::alloc_nn(GlobWalker::init_with_cwd(
            pattern,
            self.root_dir,
            true,
            true,
            false,
            true,
            true,
            Some(glob_ignore_fn),
        )??));
        // SAFETY: `walker` does not touch the allocation until it frees it, and `iter` is dropped
        // before that on every path (as the later local here, as the earlier field of `ActiveWalk`
        // afterwards), so this is the only access to the walker while the erased borrow is live.
        let mut iter: GlobWalkerIterator =
            glob::walk::Iterator::new(unsafe { &mut *walker.0.as_ptr() });
        iter.init()??;
        Ok(ActiveWalk {
            iter,
            _walker: walker,
        })
    }

    fn next(&mut self) -> Result<Option<glob::walk::MatchedPath>, crate::Error> {
        loop {
            let Some(active) = &mut self.active else {
                if self.pattern_idx >= self.patterns.len() {
                    return Ok(None);
                }
                self.active = Some(self.start_walk()?);
                continue;
            };
            match active.iter.next()? {
                Ok(Some(path)) => return Ok(Some(path)),
                Ok(None) => {
                    self.active = None;
                    self.pattern_idx += 1;
                }
                Err(err) => bun_core::pretty_errorln!("Error: {}", err),
            }
        }
    }
}
