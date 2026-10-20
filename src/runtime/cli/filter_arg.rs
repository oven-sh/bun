use core::ptr::NonNull;

use bstr::BStr;
use bun_ast::{self, ExprData, Log};
use bun_collections::index_sort;
use bun_core::Global;
use bun_core::Output;
use bun_core::strings;
use bun_glob as glob;
use bun_install::package_manager::workspace_selection::{
    self, Candidate, NegatedWorkspaces, RootSelection, WorkspaceGraph,
};
use bun_options_types::context::PackageFilter;
use bun_parsers::json;
use bun_paths::path_buffer_pool;
use bun_paths::{PathBuffer, platform, resolve_path};
use bun_resolver::package_json::{IncludeDependencies, IncludeScripts};

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
    negated: &mut NegatedWorkspaces,
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
            let mut name_buf = bun_paths::path_buffer_pool::get();
            // Treat a path that's too long like a missing package.json and try the parent.
            let Some(json_path) = resolve_path::join_abs_string_buf_z_checked::<platform::Auto>(
                workdir,
                &mut name_buf[..],
                &[b"package.json".as_slice()],
            ) else {
                break 'body;
            };

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
                        if negated.take(pattern_bytes) {
                            continue;
                        }
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
    /// The first `--workspace` value that selects the package, if one does.
    workspace_value: Option<usize>,
    /// The entry of `workspaces` that the package comes from.
    entry: usize,
}

pub(crate) struct SelectedPackages {
    pub(crate) root_dir: Box<[u8]>,
    pub(crate) packages: Vec<WorkspacePackage>,
    /// Only `--workspace` values select: as in npm, the packages are in the order of the values and run one after another.
    pub(crate) in_given_order: bool,
}

/// Discovers the workspace packages under `cwd` and returns the ones `--filter` / `--workspace` / `--workspaces` select, in discovery order unless `SelectedPackages::in_given_order`.
pub(crate) fn select_packages(
    ctx: &Command::ContextData,
    resolver: &mut bun_resolver::Resolver<'_>,
    cwd: &[u8],
) -> Result<SelectedPackages, crate::Error> {
    let mut patterns: Vec<&[u8]> = Vec::new();
    let mut workspaces: Vec<&[u8]> = Vec::new();
    for filter in &ctx.filters {
        match filter {
            PackageFilter::Pattern(pattern) => patterns.push(pattern),
            PackageFilter::Workspace(workspace) => workspaces.push(workspace),
        }
    }
    // As in npm, `--workspaces` adds nothing to what `--workspace` names.
    let all_workspaces = ctx.workspaces && workspaces.is_empty();
    if all_workspaces {
        patterns = vec![b"*".as_slice()];
    }

    let mut glob_patterns: Vec<Box<[u8]>> = Vec::new();
    let mut negated = NegatedWorkspaces::default();
    let mut root_buf = bun_paths::path_buffer_pool::get();
    let root_dir: Box<[u8]> = get_candidate_package_patterns(
        // SAFETY: `ctx.log` is the process-static `Cli::LOG_`; CLI dispatch is single-threaded and no other `&mut Log` is live.
        unsafe { ctx.log_mut() },
        &mut glob_patterns,
        &mut negated,
        cwd,
        &mut root_buf,
    )?
    .into();

    let mut iter = PackageFilterIterator::init(&glob_patterns, &negated, &root_dir)?;
    let mut discovered: Vec<WorkspacePackage> = Vec::new();
    while let Some(package_json_path) = iter.next()? {
        let dir = strings::without_trailing_slash(resolve_path::dirname::<platform::Auto>(
            &package_json_path,
        ));
        if all_workspaces && dir == &*root_dir {
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
            workspace_value: None,
            entry: iter.pattern_idx,
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
                let buf: &[u8] = &deps.source_buf;
                deps.map.keys().iter().map(move |k| k.slice(buf))
            })
        });

    // `select` reads a list of only `!` patterns as every package, so next to a `--workspace` value they are asked on their own.
    let mut excluded_patterns: Vec<&[u8]> = Vec::new();
    if !workspaces.is_empty() {
        let all = core::mem::take(&mut patterns);
        for (pattern, is_negated) in all.into_iter().map(workspace_selection::strip_negations) {
            if is_negated {
                excluded_patterns.push(pattern);
            } else {
                patterns.push(pattern);
            }
        }
    }
    let select = |patterns: &[&[u8]]| {
        (!patterns.is_empty()).then(|| {
            workspace_selection::select(
                patterns,
                cwd,
                &candidates,
                graph.as_ref(),
                RootSelection::Implicit,
            )
        })
    };
    let (included, excluded) = (select(&patterns), select(&excluded_patterns));
    let (workspace_values, unmatched_workspaces) =
        select_npm_workspaces(&workspaces, cwd, &root_dir, &candidates);

    let mut packages: Vec<WorkspacePackage> = discovered
        .into_iter()
        .enumerate()
        .filter_map(|(i, mut package)| {
            package.workspace_value = workspace_values.get(i).copied().flatten();
            let is_selected = package.workspace_value.is_some()
                || included.as_ref().is_some_and(|it| it.selected.is_set(i));
            let is_excluded = excluded.as_ref().is_some_and(|it| it.selected.is_set(i));
            (is_selected && !is_excluded).then_some(package)
        })
        .collect();
    if packages.is_empty() {
        // npm fails here with `--if-present` too.
        if !workspaces.is_empty() {
            let filters: Vec<&[u8]> = (ctx.filters.iter())
                .filter(|filter| matches!(filter, PackageFilter::Pattern(_)))
                .map(PackageFilter::text)
                .collect();
            let message = unmatched_workspaces_message(&workspaces, &filters);
            Output::err_generic("{}", (BStr::new(&message),));
            Global::exit(1);
        }
        if ctx.if_present {
            Global::exit(0);
        }
        if ctx.workspaces {
            Output::err_generic("No workspace packages found", ());
            Global::exit(1);
        }
        workspace_selection::error_unmatched(&patterns);
    }
    if let Some(included) = &included {
        workspace_selection::warn_unmatched(&patterns, &included.unmatched_patterns);
    }
    if !unmatched_workspaces.is_empty() {
        let unmatched: Vec<&[u8]> = unmatched_workspaces
            .iter()
            .map(|&i| workspaces[i])
            .collect();
        bun_core::warn!(
            "{}",
            BStr::new(&unmatched_workspaces_message(&unmatched, &[]))
        );
    }

    // npm runs in the order of the values, and for one value in the order of `workspaces`.
    let in_given_order = !workspaces.is_empty() && patterns.is_empty();
    if in_given_order {
        index_sort::sort_slice_by(&mut packages, |a, b| {
            (a.workspace_value, a.entry, &a.dir).cmp(&(b.workspace_value, b.entry, &b.dir))
        });
    }
    Ok(SelectedPackages {
        root_dir,
        packages,
        in_given_order,
    })
}

/// `No workspace packages matched --workspace "a", "b"`, with ` or --filter "c"` for `patterns`.
fn unmatched_workspaces_message(workspaces: &[&[u8]], patterns: &[&[u8]]) -> Vec<u8> {
    let mut out = b"No workspace packages matched --workspace ".to_vec();
    out.extend_from_slice(&workspace_selection::quote_patterns(workspaces));
    if !patterns.is_empty() {
        out.extend_from_slice(b" or --filter ");
        out.extend_from_slice(&workspace_selection::quote_patterns(patterns));
    }
    out
}

/// The four tests of npm 11's `lib/utils/get-workspaces.js`. Returns the first value that selects each candidate, and the values that select nothing.
fn select_npm_workspaces(
    values: &[&[u8]],
    cwd: &[u8],
    root_dir: &[u8],
    candidates: &[Candidate<'_>],
) -> (Vec<Option<usize>>, Vec<usize>) {
    if values.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let (mut buf, mut joined) = (path_buffer_pool::get(), path_buffer_pool::get());
    // The form of `Candidate::abs_posix_dir`.
    let mut posix = |dir: &[u8]| -> Box<[u8]> {
        strings::without_trailing_slash(resolve_path::join_abs_string_buf::<platform::Posix>(
            dir,
            &mut buf.0,
            &[b".".as_slice()],
        ))
        .into()
    };
    let (from, root) = (posix(cwd), posix(root_dir));
    let relative = resolve_path::relative_platform::<platform::Posix, true>;
    // `./` and the directory as the cwd sees it. npm compares with the `./` when the value has one.
    let from_cwd: Vec<Vec<u8>> = candidates
        .iter()
        .map(|c| [b"./".as_slice(), relative(&from, c.abs_posix_dir)].concat())
        .collect();
    let children_of = |folder: &[u8]| {
        let pattern = [folder, b"/*".as_slice()].concat();
        let shape = glob::matcher::Shape::of(&pattern);
        (pattern, shape)
    };

    let mut first_values: Vec<Option<usize>> = vec![None; candidates.len()];
    let mut unmatched: Vec<usize> = Vec::new();
    for (at, &value) in values.iter().enumerate() {
        let mut path = value.to_vec();
        resolve_path::platform_to_posix_in_place::<u8>(&mut path);
        // The join of the platform reads a drive letter.
        let dir = resolve_path::join_abs_string_buf_checked::<platform::Auto>(
            cwd,
            &mut joined.0,
            &[value],
        )
        .map(&mut posix);
        let dir = dir.as_deref();
        // The packages in the folder, which npm writes as a path from the root and as it was given.
        let in_folder = [
            dir.map(|dir| children_of(relative(&root, dir))),
            Some(children_of(strings::without_trailing_slash(&path))),
        ];

        let mut selects = false;
        for (i, c) in candidates.iter().enumerate() {
            let from_cwd = &from_cwd[i][if path.starts_with(b"./") { 0 } else { 2 }..];
            // `Dots::Hide` is minimatch's `dot: false`, which npm matches with.
            let is_in_folder = |(pattern, shape): &(Vec<u8>, glob::matcher::Shape)| {
                let hide = glob::Dots::Hide;
                glob::matcher::match_prepared::<false>(pattern, shape, from_cwd, hide).matches()
            };
            if (!c.name.is_empty() && c.name == value)
                || dir == Some(c.abs_posix_dir)
                || in_folder.iter().flatten().any(is_in_folder)
            {
                first_values[i].get_or_insert(at);
                selects = true;
            }
        }
        if !selects {
            unmatched.push(at);
        }
    }
    (first_values, unmatched)
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
    /// As in npm, a package that `--workspace` selects must have the scripts, unless `--if-present` is set. A name with a `*` is a pattern and is not asked for.
    pub(crate) fn require_scripts(&self, ctx: &Command::ContextData, names: &[&[u8]]) {
        if ctx.if_present {
            return;
        }
        let mut is_missing = false;
        for package in &self.packages {
            if package.workspace_value.is_none() {
                continue;
            }
            for name in names {
                if strings::contains_char(name, b'*')
                    || (package.json.scripts.as_ref()).is_some_and(|it| it.get(name).is_some())
                {
                    continue;
                }
                Output::err_generic(
                    "Script \"{}\" not found in package \"{}\"",
                    (
                        BStr::new(name),
                        BStr::new(&package.display_name(&self.root_dir)),
                    ),
                );
                is_missing = true;
            }
        }
        if is_missing {
            Global::exit(1);
        }
    }

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
            let patterns: Vec<&[u8]> = ctx.filters.iter().map(PackageFilter::text).collect();
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
    negated: &'a NegatedWorkspaces,
    pattern_idx: usize,
    root_dir: &'a [u8],
    /// The walk for `patterns[pattern_idx]`; `None` until `next` starts it.
    active: Option<ActiveWalk>,
}

impl<'a> PackageFilterIterator<'a> {
    fn init(
        patterns: &'a [Box<[u8]>],
        negated: &'a NegatedWorkspaces,
        root_dir: &'a [u8],
    ) -> Result<PackageFilterIterator<'a>, crate::Error> {
        Ok(PackageFilterIterator {
            patterns,
            negated,
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

    /// As in `bun install`, a `!` entry removes a glob match, but never a path that's listed
    /// literally.
    fn is_excluded(&self, package_json_path: &[u8]) -> bool {
        glob::detect_glob_syntax(&self.patterns[self.pattern_idx])
            && self
                .negated
                .excludes(resolve_path::relative_platform::<platform::Auto, false>(
                    self.root_dir,
                    resolve_path::dirname::<platform::Auto>(package_json_path),
                ))
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
                Ok(Some(path)) => {
                    if !self.is_excluded(&path) {
                        return Ok(Some(path));
                    }
                }
                Ok(None) => {
                    self.active = None;
                    self.pattern_idx += 1;
                }
                Err(err) => bun_core::pretty_errorln!("Error: {}", err),
            }
        }
    }
}
