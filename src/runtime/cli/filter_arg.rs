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

    // PERF(port): Zig used `inline for` over a comptime tuple — plain loop over const slice here.
    for skip in SKIP_LIST {
        if val == *skip {
            return true;
        }
    }

    false
}

// PORT NOTE: Zig `glob.GlobWalker(globIgnoreFn, glob.walk.DirEntryAccessor, false)` is a
// comptime type-generator taking (ignore_fn, Accessor type, sentinel: bool). In Rust the
// ignore filter is a runtime parameter on `init_with_cwd`, and `DirEntryAccessor` lives in
// `bun_resolver` (it depends on the resolver's DirEntry cache).
type GlobWalker = glob::GlobWalker<bun_resolver::DirEntryAccessor, false>;
// TODO(port): self-referential — Iterator borrows the GlobWalker stored alongside it in
// `PackageFilterIterator`. Forced to `'static` here; see `init_walker` for the unsafe
// lifetime erasure. Phase B: Pin<Box<Self>> or fold walker+iter into one type.
type GlobWalkerIterator = glob::walk::Iterator<'static, bun_resolver::DirEntryAccessor, false>;

pub fn get_candidate_package_patterns<'a>(
    log: &mut Log,
    out_patterns: &mut Vec<Box<[u8]>>,
    workdir_: &[u8],
    root_buf: &'a mut PathBuffer,
) -> Result<&'a [u8], bun_core::Error> {
    // TODO(port): narrow error set
    bun_ast::expr::data::Store::create();
    bun_ast::stmt::data::Store::create();
    let _store_guard = bun_ast::StoreResetGuard::new();

    let mut workdir = workdir_;

    // PORT NOTE: reshaped Zig `while (true) : (workdir = dirname(workdir) orelse break)` as a
    // labeled loop with an inner labeled block; `continue` → `break 'body`, `break` → `break 'walk`.
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

            // PORT NOTE: `bun.sys.File.toSource` was MOVE_DOWN'd to `bun_ast::to_source`
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

            // PERF(port): Zig threaded `ctx.allocator` through `parsePackageJSONUTF8`; the Rust
            // signature takes a `&Bump` arena explicitly. Nodes go through the global Store, so
            // this only buffers transient parser scratch — fresh per-iteration is fine.
            let bump = bun_alloc::Arena::new();
            let json = json::parse_package_json_utf8(&json_source, log, &bump)?;

            let Some(prop) = json.as_property(b"workspaces") else {
                break 'body;
            };

            let json_array = match prop.expr.data {
                ExprData::EArray(arr) => arr,
                ExprData::EObject(obj) => {
                    // `StoreRef::get` (0-arg) shadows `E::Object::get` under autoderef; force
                    // `Deref` to reach the keyed lookup.
                    if let Some(packages) = (*obj).get(b"packages") {
                        match packages.data {
                            ExprData::EArray(arr) => arr,
                            _ => break 'walk,
                        }
                    } else {
                        break 'walk;
                    }
                }
                _ => break 'walk,
            };

            for expr in json_array.slice() {
                match expr.data {
                    ExprData::EString(pattern_expr) => {
                        let size = pattern_expr.data.len() + b"/package.json".len();
                        let mut pattern = vec![0u8; size].into_boxed_slice();
                        pattern[0..pattern_expr.data.len()].copy_from_slice(&pattern_expr.data);
                        pattern[pattern_expr.data.len()..size].copy_from_slice(b"/package.json");

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

        // continue-expression of the Zig `while`
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

pub struct FilterSet {
    // `std.mem.Allocator param` — deleted (non-AST crate; global mimalloc).

    // TODO: Pattern should be
    //  union (enum) { name: []const u32, path: []const u32, any_name: void }
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
    // PERF(port): in Zig, `.name`-kind patterns borrowed the caller's filter slice and only
    // `.path`-kind patterns were heap-allocated (see `deinit`). Here both are `Box<[u8]>` so
    // `Drop` is uniform; revisit if filter-arg construction shows up in profiles.
    pub pattern: Box<[u8]>,
    pub kind: PatternKind,
    // negate: bool = false,
}

impl FilterSet {
    pub fn matches(&self, path: &[u8], name: &[u8]) -> bool {
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

    pub fn init<F: AsRef<[u8]>>(filters: &[F], cwd_: &[u8]) -> Result<FilterSet, bun_core::Error> {
        // TODO(port): narrow error set
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
                    // PERF(port): Zig borrowed `filter_utf8_` here; we dupe to keep `Pattern` owning.
                    pattern: Box::<[u8]>::from(filter_utf8),
                    kind: PatternKind::Name,
                });
            }
        }
        self_.filters = list;
        Ok(self_)
    }

    // `pub fn deinit` — deleted: `Vec<Pattern>` drops each `Box<[u8]>` automatically.
    // The Zig conditionally freed only `.path`-kind patterns; see PERF note on `Pattern.pattern`.

    pub fn matches_path(&self, path: &[u8]) -> bool {
        for filter in &self.filters {
            if glob::r#match(&filter.pattern, path).matches() {
                return true;
            }
        }
        false
    }

    pub fn matches_path_name(&self, path: &[u8], name: &[u8]) -> bool {
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

pub struct PackageFilterIterator {
    // `patterns` and `root_dir` borrow from the caller (Zig: `[]const u8`).
    // Callers keep them alive for the iterator's lifetime — `RawSlice`
    // invariant. Revisit in Phase B (likely `<'a>` on the struct).
    patterns: bun_ptr::RawSlice<Box<[u8]>>,
    pattern_idx: usize,
    root_dir: bun_ptr::RawSlice<u8>,

    walker: MaybeUninit<GlobWalker>,
    iter: MaybeUninit<GlobWalkerIterator>,
    valid: bool,
    // `std.mem.Allocator param` — deleted (non-AST crate).
}

impl PackageFilterIterator {
    pub fn init(
        patterns: &[Box<[u8]>],
        root_dir: &[u8],
    ) -> Result<PackageFilterIterator, bun_core::Error> {
        // TODO(port): narrow error set (Zig signature was `!PackageFilterIterator` but body is infallible)
        Ok(PackageFilterIterator {
            // Caller keeps `patterns`/`root_dir` alive for the iterator's lifetime — `RawSlice` invariant.
            patterns: bun_ptr::RawSlice::new(patterns),
            pattern_idx: 0,
            root_dir: bun_ptr::RawSlice::new(root_dir),
            walker: MaybeUninit::uninit(),
            iter: MaybeUninit::uninit(),
            valid: false,
        })
    }

    fn walker_next(&mut self) -> Result<Option<glob::walk::MatchedPath>, bun_core::Error> {
        // TODO(port): narrow error set
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

    fn init_walker(&mut self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // pattern_idx < patterns.len() checked by caller.
        let pattern: &[u8] = &self.patterns.slice()[self.pattern_idx];
        // PERF(port): Zig created an `ArenaAllocator` here and handed it to the walker (which takes
        // ownership). bun_glob's Rust API copies `pattern`/`cwd` internally.
        let cwd: &[u8] = self.root_dir.slice();
        // `try (try ...).unwrap()`: outer `?` is the Zig `!`, inner converts `Maybe(Self)` to `!Self`.
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
        self.walker.write(walker);
        // TODO(port): self-referential — `iter.walker` borrows `self.walker`. This is unsound
        // if `PackageFilterIterator` moves after `init_walker`. Phase B: Pin<Box<Self>> or fold
        // walker+iter into a single bun_glob type. Erase the lifetime to `'static` for now.
        // SAFETY: `init_with_cwd` just initialized `self.walker` above; lifetime erased per TODO.
        let walker_ref =
            unsafe { &mut *std::ptr::from_mut::<GlobWalker>(self.walker.assume_init_mut()) };
        self.iter.write(glob::walk::Iterator::new(walker_ref));
        // SAFETY: just wrote `iter`.
        unsafe { self.iter.assume_init_mut() }.init()??;
        Ok(())
    }

    fn deinit_walker(&mut self) {
        // SAFETY: `valid == true` (caller invariant) so both are initialized.
        // Drop iter first (it borrows walker).
        unsafe {
            self.iter.assume_init_drop();
            self.walker.assume_init_drop();
        }
    }

    pub fn next(&mut self) -> Result<Option<glob::walk::MatchedPath>, bun_core::Error> {
        // TODO(port): narrow error set
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
            // PORT NOTE: reshaped for borrowck — Zig captured `path` from `walkerNext` then
            // returned it; here we must end the `&mut self` borrow before re-borrowing on the
            // else branch. We rely on NLL to make this work; if it doesn't, restructure in Phase B.
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

// ported from: src/cli/filter_arg.zig
