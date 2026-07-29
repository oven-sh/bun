use core::mem::MaybeUninit;

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
// The Iterator borrows the GlobWalker owned by `PackageFilterIterator`. The walker is
// heap-allocated (`*mut GlobWalker` from `Box::into_raw`) so its address is stable even if
// the `PackageFilterIterator` itself moves; the borrow is erased to `'static` because the
// allocation lives until `deinit_walker` drops the iterator first, then frees the walker.
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

pub struct Pattern {
    // PERF: both kinds are `Box<[u8]>` so `Drop` is uniform; revisit if
    // filter-arg construction shows up in profiles.
    pub pattern: Box<[u8]>,
    pub kind: PatternKind,
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

    pub(crate) fn matches_path(&self, path: &[u8]) -> bool {
        for filter in &self.filters {
            if glob::r#match(&filter.pattern, path).matches() {
                return true;
            }
        }
        false
    }

    pub(crate) fn matches_path_name(&self, path: &[u8], name: &[u8]) -> bool {
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

pub(crate) struct PackageFilterIterator {
    // `patterns` and `root_dir` borrow from the caller.
    // Callers keep them alive for the iterator's lifetime — `RawSlice` invariant.
    patterns: bun_ptr::RawSlice<Box<[u8]>>,
    pattern_idx: usize,
    root_dir: bun_ptr::RawSlice<u8>,

    // Heap-allocated via `Box::into_raw` so the `iter` borrow stays valid if `self` moves.
    // Null iff `valid == false` (`init_walker` tears down on failure to keep this).
    // Owned by `self`; freed in `deinit_walker`.
    walker: *mut GlobWalker,
    iter: MaybeUninit<GlobWalkerIterator>,
    valid: bool,
}

impl PackageFilterIterator {
    pub(crate) fn init(
        patterns: &[Box<[u8]>],
        root_dir: &[u8],
    ) -> Result<PackageFilterIterator, crate::Error> {
        Ok(PackageFilterIterator {
            // Caller keeps `patterns`/`root_dir` alive for the iterator's lifetime — `RawSlice` invariant.
            patterns: bun_ptr::RawSlice::new(patterns),
            pattern_idx: 0,
            root_dir: bun_ptr::RawSlice::new(root_dir),
            walker: core::ptr::null_mut(),
            iter: MaybeUninit::uninit(),
            valid: false,
        })
    }

    fn walker_next(&mut self) -> Result<Option<glob::walk::MatchedPath>, crate::Error> {
        loop {
            // SAFETY: `valid == true` (caller invariant) so `iter` is initialized.
            let iter = unsafe { self.iter.assume_init_mut() };
            match iter.next()? {
                Err(err) => {
                    bun_core::pretty_errorln!("Error: {}", err);
                    continue;
                }
                Ok(path) => {
                    return Ok(path);
                }
            }
        }
    }

    fn init_walker(&mut self) -> Result<(), crate::Error> {
        // pattern_idx < patterns.len() checked by caller.
        let pattern: &[u8] = &self.patterns.slice()[self.pattern_idx];
        // bun_glob copies `pattern`/`cwd` internally.
        let cwd: &[u8] = self.root_dir.slice();
        // outer `?` propagates the error, inner converts `Maybe(Self)` to a Result.
        let walker = GlobWalker::init_with_cwd(
            pattern,
            cwd,
            true,
            true,
            false,
            true,
            true,
            Some(glob_ignore_fn),
        )??;
        // Heap-allocate the walker so its address is stable even if `self` moves between
        // `init_walker` and the iterator's last use. `iter` holds a `'static`-erased `&mut`
        // into this allocation; `deinit_walker` drops `iter` before freeing the walker.
        let walker_ptr = Box::into_raw(Box::new(walker));
        self.walker = walker_ptr;
        // SAFETY: `walker_ptr` is a live, uniquely-owned heap allocation that outlives `iter`
        // (freed only in `deinit_walker`, after `iter` is dropped).
        self.iter
            .write(glob::walk::Iterator::new(unsafe { &mut *walker_ptr }));
        // SAFETY: just wrote `iter`.
        let inited: Result<(), crate::Error> =
            (|| Ok(unsafe { self.iter.assume_init_mut() }.init()??))();
        if let Err(err) = inited {
            // Tear down `iter` and the walker allocation so `walker` is null again
            // whenever `valid == false` (the field invariant).
            self.deinit_walker();
            return Err(err);
        }
        Ok(())
    }

    fn deinit_walker(&mut self) {
        // SAFETY: `iter` and `walker` are initialized (caller invariant).
        // Drop iter first (it borrows the walker allocation), then free the walker.
        unsafe {
            self.iter.assume_init_drop();
            drop(Box::from_raw(self.walker));
        }
        self.walker = core::ptr::null_mut();
    }

    pub(crate) fn next(&mut self) -> Result<Option<glob::walk::MatchedPath>, crate::Error> {
        loop {
            if !self.valid {
                // Raw slice pointer `len()` reads only metadata — no deref/autoref needed.
                let patterns_len = self.patterns.len();
                if self.pattern_idx < patterns_len {
                    self.init_walker()?;
                    self.valid = true;
                } else {
                    return Ok(None);
                }
            }
            // Note: shaped for borrowck — we must end the `&mut self` borrow before
            // re-borrowing on the else branch. We rely on NLL to make this work; if
            // it doesn't, restructure.
            if let Some(path) = self.walker_next()? {
                return Ok(Some(path));
            } else {
                self.valid = false;
                self.pattern_idx += 1;
                self.deinit_walker();
            }
        }
    }
}

impl Drop for PackageFilterIterator {
    fn drop(&mut self) {
        if self.valid {
            self.deinit_walker();
        }
    }
}
