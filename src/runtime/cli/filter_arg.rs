use core::ptr::NonNull;

use bun_ast::{self, ExprData, Log};
use bun_core::Global;
use bun_core::{ZStr, strings};
use bun_glob as glob;
use bun_parsers::json;
use bun_paths::{self, PathBuffer, platform, resolve_path};
use bun_sys;

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

pub(crate) fn get_candidate_package_patterns<'a>(
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
            let json_path: &ZStr = resolve_path::join_abs_string_buf_z::<platform::Auto>(
                workdir,
                &mut name_buf[..],
                &[b"package.json".as_slice()],
            );

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

pub(crate) struct FilterSet {
    // TODO: Pattern should be an enum: Name(Vec<u32>) | Path(Vec<u32>) | AnyName.
    pub filters: Vec<Pattern>,
    pub has_name_filters: bool,
    pub match_all: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PatternKind {
    Name,
    /// THIS MEANS THE PATTERN IS ALLOCATED ON THE HEAP! FREE IT!
    Path,
}

pub(crate) struct Pattern {
    // PERF: both kinds are `Box<[u8]>` so `Drop` is uniform; revisit if
    // filter-arg construction shows up in profiles.
    pub(crate) pattern: Box<[u8]>,
    pub(crate) kind: PatternKind,
    // negate: bool = false,
}

impl FilterSet {
    pub(crate) fn matches(&self, path: &[u8], name: &[u8]) -> bool {
        if self.match_all {
            // allow empty name if there are any filters which are a relative path
            // --filter="*" --filter="./bar" script
            if !name.is_empty() {
                return true;
            }
        }

        if self.has_name_filters {
            return self.matches_path_name(path, name);
        }

        self.matches_path(path)
    }

    pub(crate) fn init<F: AsRef<[u8]>>(
        filters: &[F],
        cwd_: &[u8],
    ) -> Result<FilterSet, crate::Error> {
        let cwd = cwd_;

        let mut buf = PathBuffer::uninit();
        // TODO fixed buffer allocator with fallback?
        let mut list: Vec<Pattern> = Vec::with_capacity(filters.len());
        let mut self_ = FilterSet {
            filters: Vec::new(),
            has_name_filters: false,
            match_all: false,
        };
        for filter_utf8_ in filters {
            let filter_utf8_: &[u8] = filter_utf8_.as_ref();
            if filter_utf8_ == b"*" || filter_utf8_ == b"**" {
                self_.match_all = true;
                continue;
            }

            let filter_utf8 = filter_utf8_;
            let is_path = !filter_utf8.is_empty() && filter_utf8[0] == b'.';
            if is_path {
                let parts: [&[u8]; 1] = [filter_utf8];
                let joined =
                    resolve_path::join_abs_string_buf::<platform::Loose>(cwd, &mut buf[..], &parts);
                let mut filter_utf8_temp = Box::<[u8]>::from(joined);
                bun_paths::slashes_to_posix_in_place(&mut filter_utf8_temp[..]);
                list.push(Pattern {
                    pattern: filter_utf8_temp,
                    kind: PatternKind::Path,
                });
            } else {
                self_.has_name_filters = true;
                list.push(Pattern {
                    // PERF: dupe to keep `Pattern` owning.
                    pattern: Box::<[u8]>::from(filter_utf8),
                    kind: PatternKind::Name,
                });
            }
        }
        self_.filters = list;
        Ok(self_)
    }

    // No explicit deinit: `Vec<Pattern>` drops each `Box<[u8]>` automatically.

    fn matches_path(&self, path: &[u8]) -> bool {
        for filter in &self.filters {
            if glob::r#match(&filter.pattern, path).matches() {
                return true;
            }
        }
        false
    }

    fn matches_path_name(&self, path: &[u8], name: &[u8]) -> bool {
        for filter in &self.filters {
            let target = match filter.kind {
                PatternKind::Name => name,
                PatternKind::Path => path,
            };
            if glob::r#match(&filter.pattern, target).matches() {
                return true;
            }
        }
        false
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

pub(crate) struct PackageFilterIterator<'a> {
    patterns: &'a [Box<[u8]>],
    pattern_idx: usize,
    root_dir: &'a [u8],
    /// The walk for `patterns[pattern_idx]`; `None` until `next` starts it.
    active: Option<ActiveWalk>,
}

impl<'a> PackageFilterIterator<'a> {
    pub(crate) fn init(
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

    pub(crate) fn next(&mut self) -> Result<Option<glob::walk::MatchedPath>, crate::Error> {
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
