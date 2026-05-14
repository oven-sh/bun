use bstr::BStr;
use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_ast as js_ast;
use bun_collections::StringArrayHashMap;
use bun_collections::VecExt;
use bun_core::{ZStr, strings};
use bun_glob as glob;
use bun_paths as path;
use bun_paths::resolve_path;
use bun_paths::{MAX_PATH_BYTES, PathBuffer, SEP_STR};

use crate::lockfile_real::StringBuilder;
use crate::package_manager::workspace_package_json_cache::{
    GetJSONOptions, WorkspacePackageJSONCache,
};

bun_output::declare_scope!(Lockfile, hidden);

pub struct WorkspaceMap {
    map: Map,
}

type Map = StringArrayHashMap<Entry>;

#[derive(Default)]
pub struct Entry {
    pub name: Box<[u8]>,
    pub version: Option<Box<[u8]>>,
    pub name_loc: bun_ast::Loc,
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

    #[inline]
    pub fn get(&self, key: &[u8]) -> Option<&Entry> {
        self.map.get(key)
    }

    pub fn insert(&mut self, key: &[u8], value: Entry) -> Result<(), bun_alloc::AllocError> {
        // Zig has a debug-only `bun.sys.exists(key)` check here, but `key` is
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
        };
        Ok(())
    }

    pub fn sort(&mut self, mut sort_ctx: impl FnMut(usize, usize) -> bool) {
        // ArrayHashMap::sort hands us key/value slices; this wrapper exposes the
        // Zig-shaped (a_idx, b_idx) -> bool surface.
        self.map.sort(|_keys, _values, a, b| sort_ctx(a, b));
    }
}

// Drop: all fields are owned (Box<[u8]> keys, Entry { Box<[u8]>, Option<Box<[u8]>> })
// — Rust drops them automatically; no explicit `deinit` body needed.

fn process_workspace_name(
    json_cache: &mut WorkspacePackageJSONCache,
    abs_package_json_path: &ZStr,
    log: &mut bun_ast::Log,
) -> Result<Entry, bun_core::Error> {
    let workspace_json = json_cache
        .get_with_path(
            log,
            abs_package_json_path.as_bytes(),
            GetJSONOptions {
                init_reset_store: false,
                guess_indentation: true,
                ..Default::default()
            },
        )
        .unwrap()?;

    // Scratch arena for `as_string_cloned` (Zig threaded the heap allocator);
    // results are immediately boxed so the bump can drop at scope exit.
    let scratch = Arena::new();

    let name_expr = workspace_json
        .root
        .get(b"name")
        .ok_or(bun_core::err!("MissingPackageName"))?;
    let name = name_expr
        .as_string_cloned(&scratch)?
        .ok_or(bun_core::err!("MissingPackageName"))?;

    let entry = Entry {
        name: Box::<[u8]>::from(name),
        name_loc: name_expr.loc,
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
        BStr::new(abs_package_json_path.as_bytes()),
        BStr::new(&entry.name)
    );

    Ok(entry)
}

impl WorkspaceMap {
    pub fn process_names_array(
        &mut self,
        json_cache: &mut WorkspacePackageJSONCache,
        log: &mut bun_ast::Log,
        arr: &js_ast::E::Array,
        source: &bun_ast::Source,
        loc: bun_ast::Loc,
        mut string_builder: Option<&mut StringBuilder<'_>>,
    ) -> Result<u32, bun_core::Error> {
        let workspace_names = self;
        if arr.items.len_u32() == 0 {
            return Ok(0);
        }

        let orig_msgs_len = log.msgs.len();

        let mut workspace_globs: Vec<Box<[u8]>> = Vec::new();
        let mut filepath_buf_os: Box<PathBuffer> = Box::new(PathBuffer::uninit());
        // PERF(port): Zig used allocator.create(PathBuffer) to avoid large stack frame
        let filepath_buf: &mut [u8] = &mut filepath_buf_os.0[..];

        // Scratch arena for `as_string_z` (Zig threaded the heap allocator).
        let scratch = Arena::new();

        for item in arr.slice() {
            // TODO: when does this get deallocated?
            let Some(input_path) = item.as_string_z(&scratch)? else {
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

            let abs_package_json_path: &ZStr =
                resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
                    source.path.name.dir,
                    filepath_buf,
                    &[input_path.as_bytes(), b"package.json"],
                );

            // skip root package.json
            if strings::eql_long(
                resolve_path::dirname::<path::platform::Auto>(abs_package_json_path.as_bytes()),
                source.path.name.dir,
                true,
            ) {
                continue;
            }

            let workspace_entry =
                match process_workspace_name(json_cache, abs_package_json_path, log) {
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
                                format_args!(
                                    "Workspace not found \"{}\"",
                                    BStr::new(input_path.as_bytes())
                                ),
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
                            let cwd_len = bun_sys::getcwd(&mut cwd_buf).expect("unreachable");
                            let _ = log.add_error_fmt(
                            Some(source),
                            item.loc,
                            format_args!(
                                "{} reading package.json for workspace package \"{}\" from \"{}\"",
                                err.name(),
                                BStr::new(input_path.as_bytes()),
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

            let rel_input_path = resolve_path::relative_platform::<path::platform::Auto, true>(
                source.path.name.dir,
                strings::without_suffix_comptime(
                    abs_package_json_path.as_bytes(),
                    const_format::concatcp!(SEP_STR, "package.json").as_bytes(),
                ),
            );
            #[cfg(windows)]
            let rel_input_path: &[u8] = {
                // `rel_input_path` is a shared borrow into the thread-local
                // `relative_to_common_path_buf()`. Deriving a `&mut` from
                // `rel_input_path.as_ptr().cast_mut()` and writing through it is
                // Stacked-Borrows UB (SharedReadOnly provenance), and the still-live
                // shared ref would alias it. Instead capture the length, drop the
                // shared borrow, take a single fresh `&mut` reborrow from the raw
                // threadlocal pointer, mutate, then downgrade to `&[u8]`.
                let len = rel_input_path.len();
                let _ = rel_input_path;
                // SAFETY: thread-local scratch; this is the only live borrow on this
                // thread for the remainder of this block.
                let s: &mut [u8] =
                    &mut unsafe { &mut *resolve_path::relative_to_common_path_buf() }[0..len];
                path::dangerously_convert_path_to_posix_in_place::<u8>(s);
                &*s
            };

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
                // Spec is `.reset(.retain_capacity)` — keep the `mi_heap` warm
                // across glob patterns × matched dirs.
                arena.reset_retain_with_limit(8 * 1024 * 1024);
                let glob_pattern: &[u8] = if user_pattern.len() == 0 {
                    b"package.json"
                } else {
                    let parts: [&[u8]; 2] = [user_pattern, b"package.json"];
                    arena.alloc_slice_copy(resolve_path::join::<path::platform::Auto>(&parts))
                };

                let mut cwd = resolve_path::dirname::<path::platform::Auto>(&source.path.text);
                if cwd.is_empty() {
                    cwd = bun_resolver::fs::FileSystem::instance().top_level_dir();
                }
                // PORT NOTE: GlobWalker::init_with_cwd is now an associated constructor
                // returning `Result<Maybe<Self>>`; arena param dropped (Phase A: heap-backed),
                // ignore filter supplied as final arg (was comptime fn param in Zig).
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
                // walker dropped at end of loop iter (Drop impl handles deinit(false))
                // TODO(port): GlobWalker::deinit(false) — Drop cannot take params; assume default Drop matches `false`

                let mut iter = glob::walk::Iterator::new(&mut walker);
                if let Err(e) = iter.init()? {
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
                    let matched_path_owned = match iter.next()? {
                        Ok(Some(r)) => r,
                        Ok(None) => break,
                        Err(e) => {
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

                    let abs_package_json_path = resolve_path::join_abs_string_buf_z::<
                        path::platform::Auto,
                    >(
                        cwd, filepath_buf, &[entry_dir, b"package.json"]
                    );
                    let abs_workspace_dir_path: &[u8] = strings::without_suffix_comptime(
                        abs_package_json_path.as_bytes(),
                        b"package.json",
                    );

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
                                    bun_ast::Loc::EMPTY,
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

                    let workspace_path: &[u8] =
                        resolve_path::relative_platform::<path::platform::Auto, true>(
                            source.path.name.dir,
                            abs_workspace_dir_path,
                        );
                    #[cfg(windows)]
                    let workspace_path: &[u8] = {
                        // `workspace_path` is a shared borrow into the thread-local
                        // `relative_to_common_path_buf()`. Deriving a `&mut` from
                        // `workspace_path.as_ptr().cast_mut()` and writing through it is
                        // Stacked-Borrows UB (SharedReadOnly provenance), and the
                        // still-live shared ref would alias it. Instead capture the
                        // length, drop the shared borrow, take a single fresh `&mut`
                        // reborrow from the raw threadlocal pointer, mutate, then
                        // downgrade to `&[u8]`.
                        let len = workspace_path.len();
                        let _ = workspace_path;
                        // SAFETY: thread-local scratch; this is the only live borrow on
                        // this thread for the remainder of this block.
                        let s: &mut [u8] =
                            &mut unsafe { &mut *resolve_path::relative_to_common_path_buf() }
                                [0..len];
                        path::dangerously_convert_path_to_posix_in_place::<u8>(s);
                        &*s
                    };

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

// PORT NOTE: Zig `glob.GlobWalker(ignoredWorkspacePaths, glob.walk.SyscallAccessor, false)` —
// the comptime ignore-filter fn param was lowered to a runtime fn-pointer field on
// `bun_glob::GlobWalker` (const-generic fn ptrs are unstable). Supplied via
// `init_with_cwd(..., Some(ignored_workspace_paths))`.
type GlobWalker = glob::GlobWalker<glob::walk::SyscallAccessor, false>;

// ported from: src/install/lockfile/Package/WorkspaceMap.zig
