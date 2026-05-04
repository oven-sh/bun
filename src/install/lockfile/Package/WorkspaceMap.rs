use bun_collections::ArrayHashMap;
use bun_logger as logger;
use bun_paths as path;
use bun_paths::{PathBuffer, MAX_PATH_BYTES, SEP_STR};
use bun_str::{strings, ZStr};
use bun_glob as glob;
use bun_js_parser as js_ast;
use bun_alloc::Arena; // bumpalo::Bump re-export
use bstr::BStr;

use crate::PackageManager;
use crate::lockfile::StringBuilder;

bun_output::declare_scope!(Lockfile, hidden);

pub struct WorkspaceMap {
    map: Map,
}

type Map = ArrayHashMap<Box<[u8]>, Entry>;

pub struct Entry {
    pub name: Box<[u8]>,
    pub version: Option<Box<[u8]>>,
    pub name_loc: logger::Loc,
}

impl WorkspaceMap {
    pub fn init() -> WorkspaceMap {
        WorkspaceMap {
            map: Map::default(),
        }
    }

    pub fn keys(&self) -> &[Box<[u8]>] {
        self.map.keys()
    }

    pub fn values(&self) -> &[Entry] {
        self.map.values()
    }

    pub fn count(&self) -> usize {
        self.map.count()
    }

    pub fn insert(&mut self, key: &[u8], value: Entry) -> Result<(), bun_alloc::AllocError> {
        #[cfg(debug_assertions)]
        {
            if !bun_sys::exists(key) {
                bun_core::Output::debug_warn(format_args!(
                    "WorkspaceMap.insert: key {} does not exist",
                    BStr::new(key)
                ));
            }
        }

        // TODO(port): ArrayHashMap::get_or_put exact API — mirrors Zig getOrPut
        let entry = self.map.get_or_put(key)?;
        if !entry.found_existing {
            *entry.key_ptr = Box::<[u8]>::from(key);
        }
        // old value (incl. owned `name`) dropped automatically on assignment
        *entry.value_ptr = Entry {
            name: value.name,
            version: value.version,
            name_loc: value.name_loc,
        };
        Ok(())
    }

    pub fn sort(&mut self, sort_ctx: impl FnMut(usize, usize) -> bool) {
        // TODO(port): ArrayHashMap::sort signature — Zig takes ctx with lessThan(a_idx, b_idx)
        self.map.sort(sort_ctx);
    }
}

// Drop: all fields are owned (Box<[u8]> keys, Entry { Box<[u8]>, Option<Box<[u8]>> })
// — Rust drops them automatically; no explicit `deinit` body needed.

fn process_workspace_name(
    json_cache: &mut PackageManager::WorkspacePackageJSONCache,
    abs_package_json_path: &ZStr,
    log: &mut logger::Log,
) -> Result<Entry, bun_core::Error> {
    let workspace_json = json_cache
        .get_with_path(
            log,
            abs_package_json_path,
            PackageManager::WorkspacePackageJSONCache::GetJSONOptions {
                init_reset_store: false,
                guess_indentation: true,
                ..Default::default()
            },
        )
        .unwrap()?;

    let name_expr = workspace_json
        .root
        .get(b"name")
        .ok_or(bun_core::err!("MissingPackageName"))?;
    let name = name_expr
        .as_string_cloned()?
        .ok_or(bun_core::err!("MissingPackageName"))?;

    let entry = Entry {
        name,
        name_loc: name_expr.loc,
        version: 'brk: {
            if let Some(version_expr) = workspace_json.root.get(b"version") {
                if let Some(version) = version_expr.as_string_cloned()? {
                    break 'brk Some(version);
                }
            }
            break 'brk None;
        },
    };
    bun_output::scoped_log!(
        Lockfile,
        "processWorkspaceName({}) = {}",
        BStr::new(abs_package_json_path.as_bytes()),
        BStr::new(&entry.name)
    );

    Ok(entry)
}

impl WorkspaceMap {
    pub fn process_names_array(
        workspace_names: &mut WorkspaceMap,
        json_cache: &mut PackageManager::WorkspacePackageJSONCache,
        log: &mut logger::Log,
        arr: &mut js_ast::E::Array,
        source: &logger::Source,
        loc: logger::Loc,
        mut string_builder: Option<&mut StringBuilder>,
    ) -> Result<u32, bun_core::Error> {
        if arr.items.len() == 0 {
            return Ok(0);
        }

        let orig_msgs_len = log.msgs.len();

        let mut workspace_globs: Vec<Box<[u8]>> = Vec::new();
        let mut filepath_buf_os: Box<PathBuffer> = Box::new(PathBuffer::uninit());
        // PERF(port): Zig used allocator.create(PathBuffer) to avoid large stack frame
        let filepath_buf: &mut [u8] = filepath_buf_os.as_bytes_mut();

        for item in arr.slice() {
            // TODO: when does this get deallocated?
            let Some(input_path) = item.as_string_z()? else {
                let _ = log.add_error_fmt(
                    Some(source),
                    item.loc,
                    format_args!(
                        "Workspaces expects an array of strings, like:\n  <r><green>\"workspaces\"<r>: [\n    <green>\"path/to/package\"<r>\n  ]"
                    ),
                );
                return Err(bun_core::err!("InvalidPackageJSON"));
            };

            if input_path.len() == 0
                || (input_path.len() == 1 && input_path.as_bytes()[0] == b'.')
                || input_path.as_bytes() == b"./"
                || input_path.as_bytes() == b".\\"
            {
                continue;
            }

            if glob::detect_glob_syntax(input_path.as_bytes()) {
                workspace_globs.push(Box::<[u8]>::from(input_path.as_bytes()));
                continue;
            }

            let abs_package_json_path: &ZStr = path::join_abs_string_buf_z(
                source.path.name.dir(),
                filepath_buf,
                &[input_path.as_bytes(), b"package.json"],
                path::Platform::Auto,
            );

            // skip root package.json
            if strings::eql_long(
                path::dirname(abs_package_json_path.as_bytes(), path::Platform::Auto),
                source.path.name.dir(),
                true,
            ) {
                continue;
            }

            let workspace_entry = match process_workspace_name(json_cache, abs_package_json_path, log) {
                Ok(e) => e,
                Err(err) => {
                    // TODO(port): bun.handleErrorReturnTrace — no Rust equivalent (Zig error return traces)
                    if err == bun_core::err!("EISNOTDIR")
                        || err == bun_core::err!("EISDIR")
                        || err == bun_core::err!("EACCESS")
                        || err == bun_core::err!("EPERM")
                        || err == bun_core::err!("ENOENT")
                        || err == bun_core::err!("FileNotFound")
                    {
                        let _ = log.add_error_fmt(
                            Some(source),
                            item.loc,
                            format_args!("Workspace not found \"{}\"", BStr::new(input_path.as_bytes())),
                        );
                    } else if err == bun_core::err!("MissingPackageName") {
                        let _ = log.add_error_fmt(
                            Some(source),
                            loc,
                            format_args!(
                                "Missing \"name\" from package.json in {}",
                                BStr::new(input_path.as_bytes())
                            ),
                        );
                    } else {
                        let mut cwd_buf = vec![0u8; MAX_PATH_BYTES];
                        let cwd = bun_sys::getcwd(&mut cwd_buf).expect("unreachable");
                        let _ = log.add_error_fmt(
                            Some(source),
                            item.loc,
                            format_args!(
                                "{} reading package.json for workspace package \"{}\" from \"{}\"",
                                err.name(),
                                BStr::new(input_path.as_bytes()),
                                BStr::new(cwd),
                            ),
                        );
                    }
                    continue;
                }
            };

            if workspace_entry.name.len() == 0 {
                continue;
            }

            let rel_input_path = path::relative_platform(
                source.path.name.dir(),
                strings::without_suffix(
                    abs_package_json_path.as_bytes(),
                    const_format::concatcp!(SEP_STR, "package.json").as_bytes(),
                ),
                path::Platform::Auto,
                true,
            );
            #[cfg(windows)]
            {
                // SAFETY: rel_input_path points into a mutable threadlocal buffer; Zig @constCast'd it.
                let rel_mut = unsafe {
                    core::slice::from_raw_parts_mut(
                        rel_input_path.as_ptr() as *mut u8,
                        rel_input_path.len(),
                    )
                };
                path::dangerously_convert_path_to_posix_in_place::<u8>(rel_mut);
            }

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
                },
            )?;
        }

        if workspace_globs.len() > 0 {
            let mut arena = Arena::new();
            // PERF(port): was arena bulk-free per-iteration via reset(.retain_capacity)
            for (i, user_pattern) in workspace_globs.iter().enumerate() {
                // PORT NOTE: Zig `defer arena.reset()` ran *after* iter.deinit()/walker.deinit() at
                // end of each iter. In Rust, walker/iter borrow `&arena` and Drop at scope exit,
                // so resetting here (top of next iter) ensures they drop before invalidation.
                // Last iter's allocs are freed when `arena` itself drops after the loop.
                arena.reset();
                let glob_pattern: &[u8] = if user_pattern.len() == 0 {
                    b"package.json"
                } else {
                    let parts: [&[u8]; 2] = [user_pattern, b"package.json"];
                    arena.alloc_slice_copy(path::join(&parts, path::Platform::Auto))
                };

                let mut walker = GlobWalker::default();
                let mut cwd = path::dirname(&source.path.text, path::Platform::Auto);
                if cwd.is_empty() {
                    cwd = bun_fs::FileSystem::instance().top_level_dir();
                }
                if let Some(e) = walker
                    .init_with_cwd(&arena, glob_pattern, cwd, false, false, false, false, true)?
                    .as_err()
                {
                    let _ = log.add_error_fmt(
                        Some(source),
                        loc,
                        format_args!(
                            "Failed to run workspace pattern <b>{}<r> due to error <b>{}<r>",
                            BStr::new(user_pattern),
                            <&'static str>::from(e.get_errno()),
                        ),
                    );
                    return Err(bun_core::err!("GlobError"));
                }
                // walker dropped at end of loop iter (Drop impl handles deinit(false))
                // TODO(port): GlobWalker::deinit(false) — Drop cannot take params; assume default Drop matches `false`

                let mut iter = GlobWalker::Iterator {
                    walker: &mut walker,
                    ..Default::default()
                };
                if let Some(e) = iter.init()?.as_err() {
                    let _ = log.add_error_fmt(
                        Some(source),
                        loc,
                        format_args!(
                            "Failed to run workspace pattern <b>{}<r> due to error <b>{}<r>",
                            BStr::new(user_pattern),
                            <&'static str>::from(e.get_errno()),
                        ),
                    );
                    return Err(bun_core::err!("GlobError"));
                }

                'next_match: loop {
                    let matched_path = match iter.next()? {
                        bun_sys::Result::Ok(Some(r)) => r,
                        bun_sys::Result::Ok(None) => break,
                        bun_sys::Result::Err(e) => {
                            let _ = log.add_error_fmt(
                                Some(source),
                                loc,
                                format_args!(
                                    "Failed to run workspace pattern <b>{}<r> due to error <b>{}<r>",
                                    BStr::new(user_pattern),
                                    <&'static str>::from(e.get_errno()),
                                ),
                            );
                            return Err(bun_core::err!("GlobError"));
                        }
                    };

                    let entry_dir: &[u8] = path::dirname(matched_path, path::Platform::Auto);

                    // skip root package.json
                    if matched_path == b"package.json" {
                        continue;
                    }

                    {
                        let matched_path_without_package_json = strings::without_trailing_slash(
                            strings::without_suffix(matched_path, b"package.json"),
                        );

                        // check if it's negated by any remaining patterns
                        for next_pattern in &workspace_globs[i + 1..] {
                            match glob::r#match(next_pattern, matched_path_without_package_json) {
                                glob::MatchResult::NoMatch
                                | glob::MatchResult::Match
                                | glob::MatchResult::NegateMatch => {}

                                glob::MatchResult::NegateNoMatch => {
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
                    }

                    bun_output::scoped_log!(
                        Lockfile,
                        "matched path: {}, dirname: {}\n",
                        BStr::new(matched_path),
                        BStr::new(entry_dir)
                    );

                    let abs_package_json_path = path::join_abs_string_buf_z(
                        cwd,
                        filepath_buf,
                        &[entry_dir, b"package.json"],
                        path::Platform::Auto,
                    );
                    let abs_workspace_dir_path: &[u8] =
                        strings::without_suffix(abs_package_json_path.as_bytes(), b"package.json");

                    let workspace_entry = match process_workspace_name(
                        json_cache,
                        abs_package_json_path,
                        log,
                    ) {
                        Ok(e) => e,
                        Err(err) => {
                            // TODO(port): bun.handleErrorReturnTrace — no Rust equivalent

                            let entry_base: &[u8] = path::basename(matched_path);
                            if err == bun_core::err!("FileNotFound")
                                || err == bun_core::err!("PermissionDenied")
                            {
                                continue;
                            } else if err == bun_core::err!("MissingPackageName") {
                                let _ = log.add_error_fmt(
                                    Some(source),
                                    logger::Loc::EMPTY,
                                    format_args!(
                                        // TODO(port): comptime concat with sep_str — using runtime sep
                                        "Missing \"name\" from package.json in {}{}{}",
                                        BStr::new(entry_dir),
                                        SEP_STR,
                                        BStr::new(entry_base),
                                    ),
                                );
                            } else {
                                let _ = log.add_error_fmt(
                                    Some(source),
                                    logger::Loc::EMPTY,
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

                    let workspace_path: &[u8] = path::relative_platform(
                        source.path.name.dir(),
                        abs_workspace_dir_path,
                        path::Platform::Auto,
                        true,
                    );
                    #[cfg(windows)]
                    {
                        // SAFETY: workspace_path points into a mutable threadlocal buffer; Zig @constCast'd it.
                        let wp_mut = unsafe {
                            core::slice::from_raw_parts_mut(
                                workspace_path.as_ptr() as *mut u8,
                                workspace_path.len(),
                            )
                        };
                        path::dangerously_convert_path_to_posix_in_place::<u8>(wp_mut);
                    }

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
                        },
                    )?;
                }
            }
        }

        if orig_msgs_len != log.msgs.len() {
            return Err(bun_core::err!("InstallFailed"));
        }

        // Sort the names for determinism
        // PORT NOTE: reshaped for borrowck — Zig captured `values()` slice in sort ctx;
        // here ArrayHashMap::sort provides values internally to the comparator.
        // TODO(port): verify ArrayHashMap::sort closure signature matches (a_idx, b_idx) -> bool
        workspace_names.map.sort_by(|_keys, values, a: usize, b: usize| {
            strings::order(&values[a].name, &values[b].name) == core::cmp::Ordering::Less
        });

        Ok(workspace_names.count() as u32)
    }
}

const IGNORED_PATHS: &[&[u8]] = &[
    b"node_modules",
    b".git",
    b"CMakeFiles",
];

fn ignored_workspace_paths(path: &[u8]) -> bool {
    for ignored in IGNORED_PATHS {
        if path == *ignored {
            return true;
        }
    }
    false
}

// TODO(port): Zig `glob.GlobWalker(ignoredWorkspacePaths, glob.walk.SyscallAccessor, false)` —
// comptime fn param threaded as const fn-pointer generic so node_modules/.git/CMakeFiles are
// skipped. Phase B: confirm `bun_glob::GlobWalker` exposes this as `<const IGNORE: fn(&[u8])->bool, A, const ERR_ON_BROKEN: bool>`
// or accepts the callback via `init_with_cwd`.
type GlobWalker = glob::GlobWalker<{ ignored_workspace_paths as fn(&[u8]) -> bool }, glob::walk::SyscallAccessor, false>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/Package/WorkspaceMap.zig (422 lines)
//   confidence: medium
//   todos:      7
//   notes:      ArrayHashMap get_or_put/sort APIs assumed; GlobWalker ignore-callback threaded as const fn-ptr generic (Phase B verify); iter.next() Maybe(?T) shape guessed; arena.reset() hoisted to top-of-iter so walker/iter Drop before invalidation
// ──────────────────────────────────────────────────────────────────────────
