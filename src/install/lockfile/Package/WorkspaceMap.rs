use bstr::BStr;
use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_ast as js_ast;
use bun_collections::StringArrayHashMap;
use bun_core::strings;
use bun_glob as glob;
use bun_paths as path;
use bun_paths::resolve_path;
use bun_paths::{MAX_PATH_BYTES, SEP_STR};

use crate::lockfile_real::{Lockfile, StringBuilder, pruned_workspaces};
use crate::package_manager::workspace_package_json_cache::{
    GetJSONOptions, WorkspacePackageJSONCache,
};

bun_output::declare_scope!(Lockfile, hidden);

pub(crate) struct WorkspaceMap {
    map: Map,
}

type Map = StringArrayHashMap<Entry>;

#[derive(Default)]
pub struct Entry {
    pub(crate) name: Box<[u8]>,
    pub(crate) version: Option<Box<[u8]>>,
    pub(crate) name_loc: bun_ast::Loc,
    /// `"installConfig": { "hoistingLimits": "workspaces" }` — this workspace's
    /// node_modules must be self-contained (see `Lockfile::self_contained_workspaces`).
    pub(crate) hoisting_limits: bool,
    /// An `installConfig.hoistingLimits` value other than "workspaces" or "none", kept so
    /// the caller can warn about it (outside `process_names_array`'s log window).
    pub(crate) unsupported_hoisting_limits: Option<Box<[u8]>>,
}

impl WorkspaceMap {
    pub(crate) fn init() -> WorkspaceMap {
        WorkspaceMap {
            map: Map::default(),
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

    fn insert(&mut self, key: &[u8], value: Entry) -> Result<(), bun_alloc::AllocError> {
        // No `bun.sys.exists(key)` debug check here: `key` is
        // relative to the workspace root while `exists` resolves against process
        // cwd — false positive whenever the two differ (e.g. `bun unlink` from a
        // workspace package). Existence is already verified by the caller via
        // `process_workspace_name`, so the check is dropped.
        let entry = self.map.get_or_put(key)?;
        if !entry.found_existing {
            *entry.key_ptr = Box::<[u8]>::from(key);
        }
        // old value (incl. owned `name`) dropped automatically on assignment
        *entry.value_ptr = Entry {
            name: value.name,
            version: value.version,
            name_loc: value.name_loc,
            hoisting_limits: value.hoisting_limits,
            unsupported_hoisting_limits: value.unsupported_hoisting_limits,
        };
        Ok(())
    }
}

// Drop: all fields are owned (Box<[u8]> keys, Entry { Box<[u8]>, Option<Box<[u8]>> })
// — Rust drops them automatically; no explicit `deinit` body needed.

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
}

fn process_workspace_name(
    json_cache: &mut WorkspacePackageJSONCache,
    abs_package_json_path: &[u8],
    log: &mut bun_ast::Log,
) -> crate::Result<Entry> {
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

    // Scratch arena for `as_string_cloned`;
    // results are immediately boxed so the bump can drop at scope exit.
    let scratch = Arena::new();

    let name_expr = workspace_json
        .root
        .get(b"name")
        .ok_or(crate::Error::MissingPackageName)?;
    let name = name_expr
        .as_string_cloned(&scratch)?
        .ok_or(crate::Error::MissingPackageName)?;

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
        name_loc: name_expr.loc,
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
    };
    bun_output::scoped_log!(
        Lockfile,
        "processWorkspaceName({}) = {}",
        BStr::new(abs_package_json_path),
        BStr::new(&entry.name)
    );

    Ok(entry)
}

fn workspace_dir_of(abs_package_json_path: &[u8]) -> &[u8] {
    strings::without_suffix_comptime(
        abs_package_json_path,
        const_format::concatcp!(SEP_STR, "package.json").as_bytes(),
    )
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
        let mut filepath_buf_os = path::path_buffer_pool::get();
        let filepath_buf: &mut [u8] = &mut filepath_buf_os.0[..];
        let mut rel_path_buf = path::path_buffer_pool::get();
        let root_dir: &[u8] = source.path.name().dir;

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
                workspace_globs.push(Box::<[u8]>::from(input_path));
                continue;
            }

            let abs_package_json_path = resolve_path::join_abs_string_buf_checked::<
                path::platform::Auto,
            >(
                root_dir, filepath_buf, &[input_path, b"package.json"]
            );
            let processed = match abs_package_json_path {
                Some(abs_package_json_path) => {
                    // skip root package.json
                    if strings::eql_long(
                        resolve_path::dirname::<path::platform::Auto>(abs_package_json_path),
                        root_dir,
                        true,
                    ) {
                        continue;
                    }

                    process_workspace_name(json_cache, abs_package_json_path, log)
                        .map(|entry| (abs_package_json_path, entry))
                }
                None => Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG)),
            };

            let (abs_package_json_path, workspace_entry) = match processed {
                Ok(processed) => processed,
                Err(err) => {
                    if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                        let tolerated = match missing_workspace {
                            MissingWorkspace::Skip => true,
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
                            format_args!("Workspace not found \"{}\"", BStr::new(input_path)),
                        );
                    } else if err == crate::Error::MissingPackageName {
                        let _ = log.add_error_fmt(
                            Some(source),
                            loc,
                            format_args!(
                                "Missing \"name\" from package.json in {}",
                                BStr::new(input_path)
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
                                BStr::new(input_path),
                                BStr::new(&cwd_buf[..cwd_len]),
                            ),
                        );
                    }
                    continue;
                }
            };

            if workspace_entry.name.len() == 0 {
                continue;
            }

            let rel_input_path = relative_workspace_path(
                &mut rel_path_buf.0,
                root_dir,
                workspace_dir_of(abs_package_json_path),
            );

            if let Some(builder) = string_builder.as_deref_mut() {
                builder.count(&workspace_entry.name);
                builder.count(rel_input_path);
                builder.cap += MAX_PATH_BYTES;
                if let Some(version_string) = &workspace_entry.version {
                    builder.count(version_string);
                }
            }

            workspace_names.insert(
                rel_input_path,
                Entry {
                    name: workspace_entry.name,
                    name_loc: workspace_entry.name_loc,
                    version: workspace_entry.version,
                    hoisting_limits: workspace_entry.hoisting_limits,
                    unsupported_hoisting_limits: workspace_entry.unsupported_hoisting_limits,
                },
            )?;
        }

        if workspace_globs.len() > 0 {
            let mut arena = Arena::new();
            for (i, user_pattern) in workspace_globs.iter().enumerate() {
                // walker/iter borrow `&arena` and Drop at scope exit,
                // so resetting here (top of next iter) ensures they drop before invalidation.
                // Last iter's allocs are freed when `arena` itself drops after the loop.
                // Capacity is retained to keep the `mi_heap` warm
                // across glob patterns × matched dirs.
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

                let mut cwd = resolve_path::dirname::<path::platform::Auto>(source.path.text);
                if cwd.is_empty() {
                    cwd = bun_resolver::fs::FileSystem::instance().top_level_dir();
                }
                // GlobWalker::init_with_cwd is now an associated constructor
                // returning `Result<Maybe<Self>>`; arena param dropped (heap-backed),
                // ignore filter supplied as final arg.
                let mut walker = match GlobWalker::init_with_cwd(
                    glob_pattern,
                    cwd,
                    false,
                    false,
                    false,
                    false,
                    true,
                    Some(ignored_workspace_paths),
                )? {
                    Ok(w) => w,
                    Err(e) => {
                        let _ = bun_ast::add_error_pretty!(
                            log,
                            Some(source),
                            loc,
                            "Failed to run workspace pattern <b>{}<r> due to error <b>{}<r>",
                            BStr::new(user_pattern),
                            BStr::new(e.name()),
                        );
                        return Err(crate::Error::GlobError);
                    }
                };
                // walker dropped at end of loop iter; GlobWalker is heap-backed with no
                // arena, and its Drop only logs + frees owned Vec/Box fields.

                let mut iter = glob::walk::Iterator::new(&mut walker);
                if let Err(e) = iter.init()? {
                    let _ = bun_ast::add_error_pretty!(
                        log,
                        Some(source),
                        loc,
                        "Failed to run workspace pattern <b>{}<r> due to error <b>{}<r>",
                        BStr::new(user_pattern),
                        BStr::new(e.name()),
                    );
                    return Err(crate::Error::GlobError);
                }

                'next_match: loop {
                    let matched_path_owned = match iter.next()? {
                        Ok(Some(r)) => r,
                        Ok(None) => break,
                        Err(e) => {
                            let _ = bun_ast::add_error_pretty!(
                                log,
                                Some(source),
                                loc,
                                "Failed to run workspace pattern <b>{}<r> due to error <b>{}<r>",
                                BStr::new(user_pattern),
                                BStr::new(e.name()),
                            );
                            return Err(crate::Error::GlobError);
                        }
                    };
                    let matched_path: &[u8] = &matched_path_owned;

                    let entry_dir: &[u8] =
                        resolve_path::dirname::<path::platform::Auto>(matched_path);

                    // skip root package.json
                    if matched_path == b"package.json" {
                        continue;
                    }

                    {
                        let matched_path_without_package_json = strings::without_trailing_slash(
                            strings::without_suffix_comptime(matched_path, b"package.json"),
                        );

                        // check if it's negated by any remaining patterns
                        for next_pattern in &workspace_globs[i + 1..] {
                            let result =
                                glob::r#match(next_pattern, matched_path_without_package_json);
                            if result.is_negated() && !result.matches() {
                                bun_output::scoped_log!(
                                    Lockfile,
                                    "skipping negated path: {}, {}\n",
                                    BStr::new(matched_path_without_package_json),
                                    BStr::new(next_pattern)
                                );
                                continue 'next_match;
                            }
                        }
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
                        cwd, filepath_buf, &[entry_dir, b"package.json"]
                    ) {
                        Some(abs_package_json_path) => {
                            process_workspace_name(json_cache, abs_package_json_path, log)
                                .map(|entry| (abs_package_json_path, entry))
                        }
                        None => Err(crate::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG)),
                    };

                    let (abs_package_json_path, workspace_entry) = match processed {
                        Ok(processed) => processed,
                        Err(err) => {
                            let entry_base: &[u8] = path::basename(matched_path);
                            if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                                continue;
                            } else if err == crate::Error::MissingPackageName {
                                let _ = log.add_error_fmt(
                                    Some(source),
                                    bun_ast::Loc::EMPTY,
                                    format_args!(
                                        "Missing \"name\" from package.json in {}{}{}",
                                        BStr::new(entry_dir),
                                        SEP_STR,
                                        BStr::new(entry_base),
                                    ),
                                );
                            } else {
                                let _ = log.add_error_fmt(
                                    Some(source),
                                    bun_ast::Loc::EMPTY,
                                    format_args!(
                                        "{} reading package.json for workspace package \"{}\" from \"{}\"",
                                        err.name(),
                                        BStr::new(entry_dir),
                                        BStr::new(entry_base),
                                    ),
                                );
                            }

                            continue;
                        }
                    };

                    if workspace_entry.name.len() == 0 {
                        continue;
                    }

                    let workspace_path: &[u8] = relative_workspace_path(
                        &mut rel_path_buf.0,
                        root_dir,
                        workspace_dir_of(abs_package_json_path),
                    );

                    if let Some(builder) = string_builder.as_deref_mut() {
                        builder.count(&workspace_entry.name);
                        builder.count(workspace_path);
                        builder.cap += MAX_PATH_BYTES;
                        if let Some(version) = &workspace_entry.version {
                            builder.count(version);
                        }
                    }

                    workspace_names.insert(
                        workspace_path,
                        Entry {
                            name: workspace_entry.name,
                            version: workspace_entry.version,
                            name_loc: workspace_entry.name_loc,
                            hoisting_limits: workspace_entry.hoisting_limits,
                            unsupported_hoisting_limits: workspace_entry
                                .unsupported_hoisting_limits,
                        },
                    )?;
                }
            }
        }

        if orig_msgs_len != log.msgs.len() {
            return Err(crate::Error::InstallFailed);
        }

        // Sort the names for determinism
        // ArrayHashMap::sort provides values internally to the comparator.
        workspace_names
            .map
            .sort(|_keys, values: &[Entry], a: usize, b: usize| {
                strings::order(&values[a].name, &values[b].name) == core::cmp::Ordering::Less
            });

        Ok(workspace_names.count() as u32)
    }
}

const IGNORED_PATHS: &[&[u8]] = &[b"node_modules", b".git", b"CMakeFiles"];

fn ignored_workspace_paths(path: &[u8]) -> bool {
    for ignored in IGNORED_PATHS {
        if path == *ignored {
            return true;
        }
    }
    false
}

// The ignore-filter is a runtime fn-pointer field on
// `bun_glob::GlobWalker` (const-generic fn ptrs are unstable). Supplied via
// `init_with_cwd(..., Some(ignored_workspace_paths))`.
type GlobWalker = glob::GlobWalker<glob::walk::SyscallAccessor, false>;
