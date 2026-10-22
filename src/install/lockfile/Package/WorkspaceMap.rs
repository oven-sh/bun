use bstr::BStr;
use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_ast as js_ast;
use bun_collections::StringArrayHashMap;
use bun_core::strings;
use bun_glob as glob;
use bun_paths as path;
use bun_paths::resolve_path;
use bun_paths::{MAX_PATH_BYTES, SEP_STR};

use super::DependencyGroup;
use crate::lockfile_real::{Lockfile, StringBuilder, pruned_workspaces};
use crate::package_manager::workspace_package_json_cache::{
    GetJSONOptions, WorkspacePackageJSONCache,
};
use crate::package_manager::workspace_selection::NegatedWorkspaces;

bun_output::declare_scope!(Lockfile, hidden);

pub(crate) struct WorkspaceMap {
    map: Map,
    /// Relative dirs of nameless members that declare dependencies, for `warn_skipped`.
    skipped_with_dependencies: Vec<Box<[u8]>>,
}

type Map = StringArrayHashMap<Entry>;

#[derive(Default)]
pub struct Entry {
    pub(crate) name: Box<[u8]>,
    pub(crate) version: Option<Box<[u8]>>,
    /// `"installConfig": { "hoistingLimits": "workspaces" }` — this workspace's
    /// node_modules must be self-contained (see `Lockfile::self_contained_workspaces`).
    pub(crate) hoisting_limits: bool,
    /// An `installConfig.hoistingLimits` value other than "workspaces" or "none", kept so
    /// the caller can warn about it (outside `process_names_array`'s log window).
    pub(crate) unsupported_hoisting_limits: Option<Box<[u8]>>,
    /// Whether the glob walk followed a symlink to reach this workspace's folder. `None` means no
    /// walk could tell, so the code that needs the answer has to check the disk.
    pub(crate) is_behind_link: Option<bool>,
}

impl WorkspaceMap {
    pub(crate) fn init() -> WorkspaceMap {
        WorkspaceMap {
            map: Map::default(),
            skipped_with_dependencies: Vec::new(),
        }
    }

    pub(crate) fn warn_skipped(&self, log: &mut bun_ast::Log) {
        for dir in &self.skipped_with_dependencies {
            log.add_warning_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "skipping workspace \"{}\": package.json has no \"name\"",
                    bun_core::fmt::escape_control_chars(dir)
                ),
            );
        }
    }

    pub(crate) fn keys(&self) -> &[Box<[u8]>] {
        self.map.keys()
    }

    pub(crate) fn values(&self) -> &[Entry] {
        self.map.values()
    }

    /// Mark the workspaces listed in the root manifest's `workspaces.selfContained`
    /// (by relative path or by package name) as self-contained. Returns the entries
    /// that matched no workspace, for the caller to warn about.
    pub(crate) fn mark_self_contained<'l>(&mut self, list: &[&'l [u8]]) -> Vec<&'l [u8]> {
        let keys: Vec<Box<[u8]>> = self.map.keys().to_vec();
        let mut matched = vec![false; list.len()];
        for (i, entry) in self.map.values_mut().iter_mut().enumerate() {
            let path = strings::without_trailing_slash(&keys[i]);
            for (j, item) in list.iter().enumerate() {
                let item = strings::without_trailing_slash(item);
                let item = item.strip_prefix(b"./").unwrap_or(item);
                if item == path || item == &*entry.name {
                    entry.hoisting_limits = true;
                    matched[j] = true;
                }
            }
        }
        list.iter()
            .zip(matched)
            .filter(|(_, m)| !m)
            .map(|(item, _)| *item)
            .collect()
    }

    pub(crate) fn count(&self) -> usize {
        self.map.count()
    }

    #[inline]
    pub(crate) fn get(&self, key: &[u8]) -> Option<&Entry> {
        self.map.get(key)
    }

    /// `key` is the member's directory relative to the workspace root.
    fn insert(
        &mut self,
        string_builder: Option<&mut StringBuilder<'_>>,
        key: &[u8],
        value: Entry,
    ) -> Result<(), bun_alloc::AllocError> {
        if let Some(builder) = string_builder {
            builder.count(&value.name);
            builder.count(key);
            builder.cap += MAX_PATH_BYTES;
            if let Some(version) = &value.version {
                builder.count(version);
            }
        }
        let entry = self.map.get_or_put(key)?;
        if !entry.found_existing {
            *entry.key_ptr = Box::<[u8]>::from(key);
        }
        *entry.value_ptr = value;
        Ok(())
    }
}

#[derive(Clone, Copy)]
pub(crate) enum NamesArray<'a> {
    Mutable(&'a js_ast::E::Array),
    Immutable(&'a js_ast::E::ArrayJSON, bun_ast::Loc),
}

impl<'a> NamesArray<'a> {
    pub(crate) fn from_expr(expr: &'a js_ast::Expr, value_loc: bun_ast::Loc) -> Option<Self> {
        match &expr.data {
            js_ast::ExprData::EArray(arr) => Some(NamesArray::Mutable(arr.get())),
            js_ast::ExprData::EArrayJSON(arr) => Some(NamesArray::Immutable(arr.get(), value_loc)),
            _ => None,
        }
    }

    fn len(&self) -> usize {
        match self {
            NamesArray::Mutable(arr) => arr.items.len(),
            NamesArray::Immutable(arr, _) => arr.items().len(),
        }
    }

    fn item_str<'s>(&'s self, i: usize, scratch: &'s Arena) -> Option<&'s [u8]> {
        match self {
            NamesArray::Mutable(arr) => arr.slice()[i].as_string(scratch),
            NamesArray::Immutable(arr, _) => arr.items()[i].as_str(),
        }
    }

    fn item_loc(&self, source: &bun_ast::Source, i: usize) -> bun_ast::Loc {
        match self {
            NamesArray::Mutable(arr) => arr.slice()[i].loc,
            NamesArray::Immutable(_, array_loc) => {
                crate::bun_json::array_item_loc(&source.contents, *array_loc, i)
                    .unwrap_or(*array_loc)
            }
        }
    }
}

// What to do with a listed (non-glob) workspace whose package.json is missing.
#[derive(Clone, Copy)]
pub(crate) enum MissingWorkspace<'a> {
    Error,
    Skip,
    SkipIfInLockfile(&'a Lockfile),
    /// Like `Skip`, and also skips a workspace whose package.json is empty. `bun install` exits on
    /// an empty package.json, but runtime auto-install must let the running program continue.
    SkipEmptyToo,
}

/// Returns `None` if there's no usable `"name"`. Nothing could link to or resolve such a workspace,
/// so it's skipped, like in pnpm and npm.
fn process_workspace_name(
    workspace_names: &mut WorkspaceMap,
    json_cache: &mut WorkspacePackageJSONCache,
    abs_package_json_path: &[u8],
    dir: &[u8],
    log: &mut bun_ast::Log,
    missing_workspace: MissingWorkspace<'_>,
) -> crate::Result<Option<Entry>> {
    let workspace_json = json_cache
        .get_with_path(
            log,
            abs_package_json_path,
            GetJSONOptions {
                init_reset_store: false,
                guess_indentation: true,
                ..Default::default()
            },
        )
        .unwrap()?;
    if workspace_json.source.contents.is_empty() {
        if matches!(missing_workspace, MissingWorkspace::SkipEmptyToo) {
            return Ok(None);
        }
        crate::package_manager_real::install_with_manager::exit_on_empty_package_json(
            abs_package_json_path,
        );
    }

    // Scratch arena for `as_string_cloned`;
    // results are immediately boxed so the bump can drop at scope exit.
    let scratch = Arena::new();

    let name = match workspace_json.root.get(b"name") {
        Some(name_expr) => name_expr
            .as_string_cloned(&scratch)?
            .filter(|name| !name.is_empty()),
        None => None,
    };
    let Some(name) = name else {
        bun_output::scoped_log!(
            Lockfile,
            "processWorkspaceName({}) has no name, skipping",
            BStr::new(abs_package_json_path)
        );
        let json = &workspace_json.root;
        let declares_dependencies = DependencyGroup::FOUR.iter().any(|group| {
            json.get(group.prop)
                .is_some_and(|deps| deps.property_count() > 0)
        });
        // Overlapping patterns match the same directory more than once.
        let skipped = &mut workspace_names.skipped_with_dependencies;
        if declares_dependencies && !skipped.iter().any(|skipped| **skipped == *dir) {
            skipped.push(dir.into());
        }
        return Ok(None);
    };

    let hoisting_limits: Option<Box<[u8]>> = match workspace_json
        .root
        .get(b"installConfig")
        .and_then(|c| c.get(b"hoistingLimits"))
    {
        Some(h) => Some(match h.as_string_cloned(&scratch)? {
            Some(v) => Box::<[u8]>::from(v),
            // present but not a string
            None => Box::<[u8]>::from(&b"<non-string>"[..]),
        }),
        None => None,
    };
    let entry = Entry {
        name: Box::<[u8]>::from(name),
        hoisting_limits: hoisting_limits.as_deref() == Some(b"workspaces".as_slice()),
        unsupported_hoisting_limits: match hoisting_limits {
            // "none" is yarn's default: no limit, which is how every workspace hoists
            Some(v) if !matches!(&*v, b"workspaces" | b"none") => Some(v),
            _ => None,
        },
        version: 'brk: {
            if let Some(version_expr) = workspace_json.root.get(b"version") {
                if let Some(version) = version_expr.as_string_cloned(&scratch)? {
                    break 'brk Some(Box::<[u8]>::from(version));
                }
            }
            break 'brk None;
        },
        is_behind_link: None,
    };
    bun_output::scoped_log!(
        Lockfile,
        "processWorkspaceName({}) = {}",
        BStr::new(abs_package_json_path),
        BStr::new(&entry.name)
    );

    Ok(Some(entry))
}

/// `dir`, or the filesystem root for a package.json in it, where `dir` is `""` or `C:`.
fn keeping_root<'a>(dir: &'a [u8], package_json_path: &'a [u8]) -> &'a [u8] {
    if path::is_absolute(dir) {
        return dir;
    }
    path::dirname(package_json_path).unwrap_or_default()
}

fn workspace_dir_of(abs_package_json_path: &[u8]) -> &[u8] {
    keeping_root(
        strings::without_suffix_comptime(
            abs_package_json_path,
            const_format::concatcp!(SEP_STR, "package.json").as_bytes(),
        ),
        abs_package_json_path,
    )
}

/// The absolute directory that the `workspaces` of `source` are relative to.
pub(crate) fn package_json_dir(source: &bun_ast::Source) -> &[u8] {
    let dir = keeping_root(source.path.name().dir, source.path.text);
    if dir.is_empty() {
        return bun_resolver::fs::FileSystem::instance().top_level_dir();
    }
    dir
}

/// `err.path` is relative to `root_dir`, or absolute when the pattern is.
#[cold]
fn add_glob_error(
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    loc: bun_ast::Loc,
    user_pattern: &[u8],
    root_dir: &[u8],
    err: &bun_sys::Error,
) -> crate::Error {
    let mut buf = path::path_buffer_pool::get();
    let failed_path = path::string_paths::without_trailing_slash_windows_path(
        resolve_path::join_abs_string_buf_checked::<path::platform::Auto>(
            root_dir,
            &mut buf.0[..],
            &[&err.path],
        )
        .unwrap_or(&err.path),
    );
    let _ = bun_ast::add_error_pretty!(
        log,
        Some(source),
        loc,
        "Failed to run workspace pattern <b>{}<r> due to error <b>{}<r> ({} \"{}\")",
        bun_core::fmt::escape_control_chars(user_pattern),
        BStr::new(err.name()),
        <&'static str>::from(err.syscall),
        bun_core::fmt::escape_control_chars(failed_path),
    );
    crate::Error::InstallFailed
}

fn relative_workspace_path<'b>(
    buf: &'b mut [u8],
    root_dir: &[u8],
    abs_workspace_dir: &[u8],
) -> &'b [u8] {
    let len = resolve_path::relative_platform_buf::<path::platform::Auto, true>(
        buf,
        root_dir,
        abs_workspace_dir,
    )
    .len();
    resolve_path::platform_to_posix_in_place::<u8>(&mut buf[..len]);
    &buf[..len]
}

impl WorkspaceMap {
    /// `"workspaces"` is an array, or an object with a `"packages"` array. Any other value means no
    /// workspaces.
    pub(crate) fn process_manifest(
        &mut self,
        json_cache: &mut WorkspacePackageJSONCache,
        log: &mut bun_ast::Log,
        manifest: &js_ast::Expr,
        source: &bun_ast::Source,
        missing_workspace: MissingWorkspace<'_>,
    ) -> crate::Result<u32> {
        let names = manifest.as_property(b"workspaces").and_then(|q| {
            if q.expr.is_array() {
                Some(q)
            } else {
                q.expr.as_property(b"packages")
            }
        });
        let Some(q) = names else { return Ok(0) };
        let Some(arr) = NamesArray::from_expr(&q.expr, super::value_loc_of(source, q.loc)) else {
            return Ok(0);
        };
        self.process_names_array(json_cache, log, arr, source, q.loc, None, missing_workspace)
    }

    pub(crate) fn process_names_array(
        &mut self,
        json_cache: &mut WorkspacePackageJSONCache,
        log: &mut bun_ast::Log,
        arr: NamesArray<'_>,
        source: &bun_ast::Source,
        loc: bun_ast::Loc,
        mut string_builder: Option<&mut StringBuilder<'_>>,
        missing_workspace: MissingWorkspace<'_>,
    ) -> crate::Result<u32> {
        let workspace_names = self;
        let item_count = arr.len();
        if item_count == 0 {
            return Ok(0);
        }

        let orig_msgs_len = log.msgs.len();

        let mut workspace_globs: Vec<Box<[u8]>> = Vec::new();
        let mut negated = NegatedWorkspaces::default();
        let mut filepath_buf_os = path::path_buffer_pool::get();
        let filepath_buf: &mut [u8] = &mut filepath_buf_os.0[..];
        let mut rel_path_buf = path::path_buffer_pool::get();
        let root_dir: &[u8] = package_json_dir(source);

        let scratch = Arena::new();

        for i in 0..item_count {
            let Some(input_path) = arr.item_str(i, &scratch) else {
                let _ = bun_ast::add_error_pretty!(
                    log,
                    Some(source),
                    arr.item_loc(source, i),
                    "Workspaces expects an array of strings, like:\n  <r><green>\"workspaces\"<r>: [\n    <green>\"path/to/package\"<r>\n  ]"
                );
                return Err(crate::Error::InvalidPackageJSON);
            };

            if input_path.is_empty()
                || input_path == b"."
                || input_path == b"./"
                || input_path == b".\\"
            {
                continue;
            }

            if glob::detect_glob_syntax(input_path) {
                if !negated.take(input_path) {
                    workspace_globs.push(Box::<[u8]>::from(input_path));
                }
                continue;
            }

            let abs_package_json_path = resolve_path::join_abs_string_buf_checked::<
                path::platform::Auto,
            >(
                root_dir, filepath_buf, &[input_path, b"package.json"]
            );
            let processed = match abs_package_json_path {
                Some(abs_package_json_path) => {
                    let dir = relative_workspace_path(
                        &mut rel_path_buf.0,
                        root_dir,
                        workspace_dir_of(abs_package_json_path),
                    );
                    // skip root package.json
                    if dir.is_empty() {
                        continue;
                    }

                    process_workspace_name(
                        workspace_names,
                        json_cache,
                        abs_package_json_path,
                        dir,
                        log,
                        missing_workspace,
                    )
                    .map(|entry| (dir, entry))
                }
                None => Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG)),
            };

            let (rel_input_path, workspace_entry) = match processed {
                Ok(processed) => processed,
                Err(err) => {
                    if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                        let tolerated = match missing_workspace {
                            MissingWorkspace::Skip | MissingWorkspace::SkipEmptyToo => true,
                            MissingWorkspace::Error => false,
                            MissingWorkspace::SkipIfInLockfile(lockfile) => abs_package_json_path
                                .is_some_and(|abs| {
                                    pruned_workspaces::lockfile_lists_workspace_path(
                                        lockfile,
                                        relative_workspace_path(
                                            &mut rel_path_buf.0,
                                            root_dir,
                                            workspace_dir_of(abs),
                                        ),
                                    )
                                }),
                        };
                        if tolerated {
                            continue;
                        }
                    }
                    if err == crate::Error::Sys(bun_errno::SystemErrno::EISDIR)
                        || err == crate::Error::Sys(bun_errno::SystemErrno::EPERM)
                        || err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT)
                    {
                        let _ = log.add_error_fmt(
                            Some(source),
                            arr.item_loc(source, i),
                            format_args!(
                                "Workspace not found \"{}\"",
                                bun_core::fmt::escape_control_chars(input_path)
                            ),
                        );
                    } else {
                        let mut cwd_buf = vec![0u8; MAX_PATH_BYTES];
                        let cwd_len = bun_sys::getcwd(&mut cwd_buf).expect("unreachable");
                        let _ = log.add_error_fmt(
                            Some(source),
                            arr.item_loc(source, i),
                            format_args!(
                                "{} reading package.json for workspace package \"{}\" from \"{}\"",
                                err.name(),
                                bun_core::fmt::escape_control_chars(input_path),
                                BStr::new(&cwd_buf[..cwd_len]),
                            ),
                        );
                    }
                    continue;
                }
            };

            let Some(workspace_entry) = workspace_entry else {
                continue;
            };
            workspace_names.insert(
                string_builder.as_deref_mut(),
                rel_input_path,
                workspace_entry,
            )?;
        }

        if workspace_globs.len() > 0 {
            let mut arena = Arena::new();
            for user_pattern in &workspace_globs {
                // Capacity is retained to keep the `mi_heap` warm across patterns × matched dirs.
                arena.reset_retain_with_limit(8 * 1024 * 1024);
                let glob_pattern: &[u8] = if user_pattern.len() == 0 {
                    b"package.json"
                } else {
                    let parts: [&[u8]; 2] = [user_pattern, b"package.json"];
                    let mut spill: Vec<u8> = Vec::new();
                    arena.alloc_slice_copy(resolve_path::join_spill::<path::platform::Auto>(
                        &mut spill, &parts,
                    ))
                };

                let mut walker = match GlobWalker::init_with_cwd(
                    glob_pattern,
                    root_dir,
                    false,
                    false,
                    false,
                    false,
                    true,
                    Some(ignored_workspace_paths),
                )? {
                    Ok(mut w) => {
                        w.follow_matched_symlinks();
                        w
                    }
                    Err(e) => {
                        return Err(add_glob_error(log, source, loc, user_pattern, root_dir, &e));
                    }
                };
                let mut iter = glob::walk::Iterator::new(&mut walker);
                if let Err(e) = iter.init()? {
                    return Err(add_glob_error(log, source, loc, user_pattern, root_dir, &e));
                }

                loop {
                    let matched_path_owned = match iter.next()? {
                        Ok(Some(r)) => r,
                        Ok(None) => break,
                        Err(e) => {
                            return Err(add_glob_error(
                                log,
                                source,
                                loc,
                                user_pattern,
                                root_dir,
                                &e,
                            ));
                        }
                    };
                    let matched_path: &[u8] = &matched_path_owned;
                    // The walk of an absolute pattern starts at its first wildcard, so it cannot
                    // see symlinks in the part of the path before that.
                    let is_behind_link =
                        (!path::is_absolute(user_pattern)).then(|| iter.followed_link());

                    let entry_dir: &[u8] =
                        resolve_path::dirname::<path::platform::Auto>(matched_path);

                    if negated.excludes(entry_dir) {
                        continue;
                    }

                    bun_output::scoped_log!(
                        Lockfile,
                        "matched path: {}, dirname: {}\n",
                        BStr::new(matched_path),
                        BStr::new(entry_dir)
                    );

                    let processed = match resolve_path::join_abs_string_buf_checked::<
                        path::platform::Auto,
                    >(
                        root_dir, filepath_buf, &[entry_dir, b"package.json"]
                    ) {
                        Some(abs_package_json_path) => {
                            let dir = relative_workspace_path(
                                &mut rel_path_buf.0,
                                root_dir,
                                workspace_dir_of(abs_package_json_path),
                            );
                            // Skip the root package.json, which `**` or `../*` can match again.
                            if dir.is_empty() {
                                continue;
                            }

                            process_workspace_name(
                                workspace_names,
                                json_cache,
                                abs_package_json_path,
                                dir,
                                log,
                                missing_workspace,
                            )
                            .map(|entry| (dir, entry))
                        }
                        None => Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG)),
                    };

                    let (workspace_path, workspace_entry) = match processed {
                        Ok(processed) => processed,
                        Err(err) => {
                            if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                                continue;
                            }
                            let entry_base: &[u8] = path::basename(matched_path);
                            let _ = log.add_error_fmt(
                                Some(source),
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "{} reading package.json for workspace package \"{}\" from \"{}\"",
                                    err.name(),
                                    bun_core::fmt::escape_control_chars(entry_dir),
                                    bun_core::fmt::escape_control_chars(entry_base),
                                ),
                            );
                            continue;
                        }
                    };

                    let Some(workspace_entry) = workspace_entry else {
                        continue;
                    };
                    workspace_names.insert(
                        string_builder.as_deref_mut(),
                        workspace_path,
                        Entry {
                            is_behind_link,
                            ..workspace_entry
                        },
                    )?;
                }
            }
        }

        if orig_msgs_len != log.msgs.len() {
            return Err(crate::Error::InstallFailed);
        }

        // Sort the names for determinism
        workspace_names
            .map
            .sort(|_keys, values: &[Entry], a: usize, b: usize| {
                strings::order(&values[a].name, &values[b].name) == core::cmp::Ordering::Less
            });

        Ok(workspace_names.count() as u32)
    }

    /// Returns true if [`Self::process_names_array`] would make `abs_dir` a workspace, given that
    /// `abs_dir` has a named package.json. It never reads the disk, so `**` also matches through a
    /// symlink.
    pub(crate) fn lists(arr: NamesArray<'_>, source: &bun_ast::Source, abs_dir: &[u8]) -> bool {
        let root_dir: &[u8] = package_json_dir(source);
        let mut dir_buf = path::path_buffer_pool::get();
        let dir = relative_workspace_path(&mut dir_buf.0, root_dir, abs_dir);
        if dir.is_empty() {
            return false;
        }
        let mut abs_buf = path::path_buffer_pool::get();
        let mut rel_buf = path::path_buffer_pool::get();
        let scratch = Arena::new();
        let mut negated = NegatedWorkspaces::default();
        let mut matched = false;
        for i in 0..arr.len() {
            let Some(input_path) = arr.item_str(i, &scratch) else {
                return false;
            };
            if matches!(input_path, b"" | b"." | b"./" | b".\\") {
                continue;
            }
            if glob::detect_glob_syntax(input_path) {
                if !negated.take(input_path) {
                    matched = matched || glob_lists(input_path, dir, abs_dir);
                }
                continue;
            }
            // A workspace listed by its exact path is a member even if a negated pattern matches.
            if resolve_path::join_abs_string_buf_checked::<path::platform::Auto>(
                root_dir,
                &mut abs_buf.0[..],
                &[input_path],
            )
            .is_some_and(|abs| relative_workspace_path(&mut rel_buf.0, root_dir, abs) == dir)
            {
                return true;
            }
        }
        matched && !negated.excludes(dir)
    }
}

/// Returns true if the glob `user_pattern` matches the package.json in `dir`. `abs_dir` is the
/// absolute path of `dir`, which is what an absolute pattern is matched against.
fn glob_lists(user_pattern: &[u8], dir: &[u8], abs_dir: &[u8]) -> bool {
    let dir = if path::is_absolute(user_pattern) {
        abs_dir
    } else {
        dir
    };
    if strings::split_any(dir, b"/\\").any(ignored_workspace_paths) {
        return false;
    }
    let mut spill: Vec<u8> = Vec::new();
    let mut pattern = resolve_path::join_spill::<path::platform::Auto>(
        &mut spill,
        &[user_pattern, b"package.json"],
    )
    .to_vec();
    resolve_path::platform_to_posix_in_place::<u8>(&mut pattern);
    glob::matcher::match_prepared::<{ cfg!(windows) }>(
        &pattern,
        &glob::matcher::Shape::of(&pattern),
        &[dir, b"/package.json"].concat(),
        glob::Dots::Hide,
    )
    .matches()
}

const IGNORED_PATHS: &[&[u8]] = &[b"node_modules", b".git", b"CMakeFiles"];

fn ignored_workspace_paths(path: &[u8]) -> bool {
    IGNORED_PATHS.contains(&path)
}

type GlobWalker = glob::GlobWalker<glob::walk::SyscallAccessor, false>;
