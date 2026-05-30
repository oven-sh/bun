//! Resolver output and bookkeeping types: `Result`, `MatchResult`, `LoadResult`,
//! `PathPair`, `PendingResolution`, `DebugLogs`, and friends. These are the
//! value types the [`crate::Resolver`] state machine produces and threads
//! through `resolve_without_remapping` / `load_as_file_or_directory`.

use core::ptr::NonNull;
use std::io::Write as _;

use ::bun_ast::import_record as ast;
use ::bun_install_types::resolver_hooks as Install;
use bun_alloc as allocators;
use bun_ast::Msg;
use bun_core::MutableString;
use bun_paths::SEP_STR;
use bun_paths::strings;
use bun_sys::Fd as FD;

use crate::dir_info::DirInfoRef;
use crate::fs as Fs;
use crate::options;
use crate::package_json::PackageJSON;
use crate::resolver::Dependency;

// PORT NOTE: `Path` in the body is the `'static`-interned variant (paths borrow
// DirnameStore/FilenameStore). Alias here so the bare-`Path` use sites resolve
// without a per-site lifetime annotation.
type Path = crate::fs::Path<'static>;

pub struct SideEffectsData {
    pub source: Option<NonNull<bun_ast::Source>>, // TODO(port): lifetime — never instantiated
    pub range: bun_ast::Range,

    // If true, "sideEffects" was an array. If false, "sideEffects" was false.
    pub is_side_effects_array_in_json: bool,
}

pub struct PathPair {
    pub primary: Path,
    pub secondary: Option<Path>,
}

impl Default for PathPair {
    fn default() -> Self {
        Self {
            primary: Path::empty(),
            secondary: None,
        }
    }
}

pub(crate) struct PathPairIter<'a> {
    index: u8, // u2 in Zig
    ctx: &'a mut PathPair,
}

impl<'a> PathPairIter<'a> {
    pub(crate) fn next(&mut self) -> Option<&mut Path> {
        if let Some(path_) = self.next_() {
            let p: *mut Path = path_;
            // SAFETY: `p` is the exclusive `&mut Path` just returned by `next_()`,
            // coerced to a raw pointer so `self` can be re-borrowed for the
            // recursive call; `p` is not dereferenced after that call, so no two
            // live `&mut` into `self.ctx` overlap.
            unsafe {
                if (*p).is_disabled {
                    return self.next();
                }
                return Some(&mut *p);
            }
        }
        None
    }

    fn next_(&mut self) -> Option<&mut Path> {
        let ind = self.index;
        self.index = self.index.saturating_add(1);

        match ind {
            0 => Some(&mut self.ctx.primary),
            1 => self.ctx.secondary.as_mut(),
            _ => None,
        }
    }
}

impl PathPair {
    pub fn iter(&mut self) -> PathPairIter<'_> {
        PathPairIter {
            ctx: self,
            index: 0,
        }
    }
}

// Re-export of `bun_ast::SideEffects`.
// Spec: options.zig:884 `Loader.sideEffects()` returns `bun.resolver.SideEffects`
// — the SAME type stored in `Result.primary_side_effects_data`. Re-export so
// `result.primary_side_effects_data = loader.side_effects()` type-checks.
use bun_ast::SideEffects;

pub struct Result {
    pub path_pair: PathPair,

    pub jsx: options::jsx::Pragma,

    pub package_json: Option<*const PackageJSON>,

    pub diff_case: Option<Fs::file_system::entry::lookup::DifferentCase<'static>>,

    // If present, any ES6 imports to this file can be considered to have no side
    // effects. This means they should be removed if unused.
    pub primary_side_effects_data: SideEffects,

    // This is the "type" field from "package.json"
    pub module_type: options::ModuleType,

    pub debug_meta: Option<DebugMeta>,

    pub dirname_fd: FD,
    pub file_fd: FD,
    pub import_kind: ast::ImportKind,

    /// Pack boolean flags to reduce padding overhead.
    /// Previously 6 separate bool fields caused ~42+ bytes of padding waste.
    pub flags: ResultFlags,
}

impl Default for Result {
    fn default() -> Self {
        Self {
            path_pair: PathPair::default(),
            jsx: options::jsx::Pragma::default(),
            package_json: None,
            diff_case: None,
            primary_side_effects_data: SideEffects::HasSideEffects,
            module_type: options::ModuleType::Unknown,
            debug_meta: None,
            dirname_fd: FD::INVALID,
            file_fd: FD::INVALID,
            import_kind: ast::ImportKind::Stmt, // Zig: undefined
            flags: ResultFlags::default(),
        }
    }
}

bitflags::bitflags! {
    #[derive(Default, Clone, Copy)]
    pub struct ResultFlags: u8 {
        const IS_EXTERNAL = 1 << 0;
        const IS_EXTERNAL_AND_REWRITE_IMPORT_PATH = 1 << 1;
        const IS_STANDALONE_MODULE = 1 << 2;
        // This is true when the package was loaded from within the node_modules directory.
        const IS_FROM_NODE_MODULES = 1 << 3;
        // If true, unused imports are retained in TypeScript code. This matches the
        // behavior of the "importsNotUsedAsValues" field in "tsconfig.json" when the
        // value is not "remove".
        const PRESERVE_UNUSED_IMPORTS_TS = 1 << 4;
        const EMIT_DECORATOR_METADATA = 1 << 5;
        const EXPERIMENTAL_DECORATORS = 1 << 6;
        // _padding: u1
    }
}

// Convenience accessors mirroring the Zig packed-struct field syntax.
impl ResultFlags {
    #[inline]
    pub fn is_external(self) -> bool {
        self.contains(Self::IS_EXTERNAL)
    }
    #[inline]
    pub fn set_is_external(&mut self, v: bool) {
        self.set(Self::IS_EXTERNAL, v)
    }
    #[inline]
    pub fn is_external_and_rewrite_import_path(self) -> bool {
        self.contains(Self::IS_EXTERNAL_AND_REWRITE_IMPORT_PATH)
    }
    #[inline]
    pub fn set_is_external_and_rewrite_import_path(&mut self, v: bool) {
        self.set(Self::IS_EXTERNAL_AND_REWRITE_IMPORT_PATH, v)
    }
    #[inline]
    pub fn is_standalone_module(self) -> bool {
        self.contains(Self::IS_STANDALONE_MODULE)
    }
    #[inline]
    pub fn is_from_node_modules(self) -> bool {
        self.contains(Self::IS_FROM_NODE_MODULES)
    }
    #[inline]
    pub fn set_is_from_node_modules(&mut self, v: bool) {
        self.set(Self::IS_FROM_NODE_MODULES, v)
    }
    #[inline]
    pub fn emit_decorator_metadata(self) -> bool {
        self.contains(Self::EMIT_DECORATOR_METADATA)
    }
    #[inline]
    pub fn set_emit_decorator_metadata(&mut self, v: bool) {
        self.set(Self::EMIT_DECORATOR_METADATA, v)
    }
    #[inline]
    pub fn experimental_decorators(self) -> bool {
        self.contains(Self::EXPERIMENTAL_DECORATORS)
    }
    #[inline]
    pub fn set_experimental_decorators(&mut self, v: bool) {
        self.set(Self::EXPERIMENTAL_DECORATORS, v)
    }
}

pub enum ResultUnion {
    Success(Result),
    Failure(bun_core::Error),
    Pending(PendingResolution),
    NotFound,
}

impl Result {
    /// Read-only view of `package_json`. The field stores `Option<*const _>`
    /// (rather than `Option<&'static _>`) so [`Default`] / zeroed-init stays
    /// bit-valid; callers that only read go through here. Single deref site
    /// for the ARENA-backed pointer — same invariant as
    /// [`dir_info::DirInfo::package_json`].
    #[inline]
    pub fn package_json_ref(&self) -> Option<&'static PackageJSON> {
        Self::deref_package_json(self.package_json)
    }

    /// Field-value form of [`package_json_ref`] for sites where `self` is
    /// already mutably borrowed (e.g. while iterating `path_pair`). Takes the
    /// `Copy` field directly so the borrow checker only sees a field read.
    #[inline]
    pub fn deref_package_json(ptr: Option<*const PackageJSON>) -> Option<&'static PackageJSON> {
        // SAFETY: ARENA — every `*const PackageJSON` stored in
        // `Result::package_json` is interned in the resolver's process-lifetime
        // PackageJSON cache (or a `'static` fallback-module literal); never
        // freed while a `Result` is live (see LIFETIMES.tsv). No
        // `&mut PackageJSON` is ever materialized concurrently with a read.
        ptr.map(|p| unsafe { &*p })
    }

    pub fn path(&mut self) -> Option<&mut Path> {
        if !self.path_pair.primary.is_disabled {
            return Some(&mut self.path_pair.primary);
        }

        if let Some(second) = self.path_pair.secondary.as_mut() {
            if !second.is_disabled {
                return Some(second);
            }
        }

        None
    }

    pub fn path_const(&self) -> Option<&Path> {
        if !self.path_pair.primary.is_disabled {
            return Some(&self.path_pair.primary);
        }

        if let Some(second) = self.path_pair.secondary.as_ref() {
            if !second.is_disabled {
                return Some(second);
            }
        }

        None
    }

    // remember: non-node_modules can have package.json
    // checking package.json may not be relevant
    pub fn is_likely_node_module(&self) -> bool {
        let Some(path_) = self.path_const() else {
            return false;
        };
        self.flags.is_from_node_modules()
            || strings::index_of(path_.text(), b"/node_modules/").is_some()
    }

    // Most NPM modules are CommonJS
    // If unspecified, assume CommonJS.
    // If internal app code, assume ESM.
    pub fn should_assume_common_js(&self, kind: ast::ImportKind) -> bool {
        match self.module_type {
            options::ModuleType::Esm => false,
            options::ModuleType::Cjs => true,
            _ => {
                if kind == ast::ImportKind::Require || kind == ast::ImportKind::RequireResolve {
                    return true;
                }

                // If we rely just on isPackagePath, we mess up tsconfig.json baseUrl paths.
                self.is_likely_node_module()
            }
        }
    }

    pub fn hash(&self, _: &[u8], _: options::Loader) -> u32 {
        let module = self.path_pair.primary.text();
        // SEP_STR ++ "node_modules" ++ SEP_STR
        let node_module_root = const_format::concatcp!(SEP_STR, "node_modules", SEP_STR).as_bytes();
        if let Some(end_) = strings::last_index_of(module, node_module_root) {
            let end: usize = end_ + node_module_root.len();
            return bun_wyhash::hash(&module[end..]) as u32;
        }

        bun_wyhash::hash(self.path_pair.primary.text()) as u32
    }
}

pub struct DebugMeta {
    pub notes: Vec<bun_ast::Data>,
    pub suggestion_text: &'static [u8],
    pub suggestion_message: &'static [u8],
    pub suggestion_range: SuggestionRange,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SuggestionRange {
    Full,
    End,
}

impl DebugMeta {
    pub fn init() -> DebugMeta {
        DebugMeta {
            notes: Vec::new(),
            suggestion_text: b"",
            suggestion_message: b"",
            suggestion_range: SuggestionRange::Full,
        }
    }

    pub fn log_error_msg(
        &mut self,
        log: &mut bun_ast::Log,
        source: Option<&bun_ast::Source>,
        r: bun_ast::Range,
        args: core::fmt::Arguments<'_>,
    ) -> core::result::Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if source.is_some() && !self.suggestion_message.is_empty() {
            let suggestion_range = if self.suggestion_range == SuggestionRange::End {
                bun_ast::Range {
                    loc: bun_ast::Loc {
                        start: r.end_i() as i32 - 1,
                    },
                    ..Default::default()
                }
            } else {
                r
            };
            let data = bun_ast::range_data(source, suggestion_range, self.suggestion_message);
            // PORT NOTE: Zig spec writes `data.location.?.suggestion = m.suggestion_text`
            // here, but `logger.Location` (logger.zig:73) has no `suggestion` field —
            // `logErrorMsg` is uncalled in the Zig source so the field access is never
            // type-checked under lazy compilation. Mirror the effective behavior (no-op).
            let _ = &self.suggestion_text;
            self.notes.push(data);
        }

        let mut msg_text = Vec::new();
        write!(&mut msg_text, "{}", args).ok();
        log.add_msg(Msg {
            kind: bun_ast::Kind::Err,
            data: bun_ast::range_data(source, r, msg_text),
            notes: core::mem::take(&mut self.notes).into_boxed_slice(),
            ..Default::default()
        });
        Ok(())
    }
}

pub struct DirEntryResolveQueueItem {
    pub result: allocators::Result,
    // PORT NOTE: `RawSlice<u8>` (not `&'static [u8]`) — these point into the
    // threadlocal `dir_info_uncached_path` buffer and are consumed before
    // `dir_info_cached_maybe_log` returns. `RawSlice` is `repr(transparent)`
    // over `*const [u8]` so the bit-level zero-init invariant for `Bufs` is
    // unchanged (the array slot is `MaybeUninit`-wrapped), and read sites use
    // safe `.slice()` instead of an open-coded raw-ptr deref.
    pub unsafe_path: bun_ptr::RawSlice<u8>,
    pub safe_path: bun_ptr::RawSlice<u8>,
    pub fd: FD,
}

impl Default for DirEntryResolveQueueItem {
    fn default() -> Self {
        Self {
            result: allocators::Result {
                hash: 0,
                index: allocators::NOT_FOUND,
                status: allocators::ItemStatus::Unknown,
            },
            unsafe_path: bun_ptr::RawSlice::EMPTY,
            safe_path: bun_ptr::RawSlice::EMPTY,
            fd: FD::INVALID,
        }
    }
}

// `bun_alloc::Result` doesn't derive Clone (yet); all its fields are Copy, so
// hand-roll Clone here for the queue-item move at `dir_info_cached`.
impl Clone for DirEntryResolveQueueItem {
    fn clone(&self) -> Self {
        Self {
            result: allocators::Result {
                hash: self.result.hash,
                index: self.result.index,
                status: self.result.status,
            },
            unsafe_path: self.unsafe_path,
            safe_path: self.safe_path,
            fd: self.fd,
        }
    }
}

pub struct DebugLogs {
    pub what: Vec<u8>,
    pub indent: MutableString,
    pub notes: Vec<bun_ast::Data>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FlushMode {
    Fail,
    Success,
}

impl DebugLogs {
    pub fn init() -> core::result::Result<DebugLogs, bun_alloc::AllocError> {
        let mutable = MutableString::init(0)?;
        Ok(DebugLogs {
            what: Vec::new(),
            indent: mutable,
            notes: Vec::new(),
        })
    }

    // deinit → Drop (only frees `notes`; `indent` deinit was commented out in Zig)

    #[cold]
    pub fn increase_indent(&mut self) {
        self.indent.append(b" ").expect("unreachable");
    }

    #[cold]
    pub fn decrease_indent(&mut self) {
        let new_len = self.indent.list.len() - 1;
        self.indent.list.truncate(new_len);
    }

    #[cold]
    pub fn add_note(&mut self, text: Vec<u8>) {
        let len = self.indent.len();
        let final_text = if len > 0 {
            let mut __text = Vec::with_capacity(text.len() + len);
            __text.extend_from_slice(self.indent.list.as_slice());
            __text.extend_from_slice(&text);
            // d.notes.allocator.free(_text) — drop(text) is implicit
            __text
        } else {
            text
        };

        self.notes
            .push(bun_ast::range_data(None, bun_ast::Range::NONE, final_text));
    }

    #[cold]
    pub fn add_note_fmt(&mut self, args: core::fmt::Arguments<'_>) {
        let mut buf = Vec::new();
        write!(&mut buf, "{}", args).expect("unreachable");
        self.add_note(buf);
    }
}

pub struct MatchResult {
    pub path_pair: PathPair,
    pub dirname_fd: FD,
    pub file_fd: FD,
    pub is_node_module: bool,
    pub package_json: Option<*const PackageJSON>,
    pub diff_case: Option<Fs::file_system::entry::lookup::DifferentCase<'static>>,
    pub dir_info: Option<DirInfoRef>,
    pub module_type: options::ModuleType,
    pub is_external: bool,
}

impl Default for MatchResult {
    fn default() -> Self {
        Self {
            path_pair: PathPair::default(),
            dirname_fd: FD::INVALID,
            file_fd: FD::INVALID,
            is_node_module: false,
            package_json: None,
            diff_case: None,
            dir_info: None,
            module_type: options::ModuleType::Unknown,
            is_external: false,
        }
    }
}

/// Discriminant-only return for the resolver call chain. The `MatchResult`
/// payload (~300 bytes) is written through an `out: &mut MatchResult` parameter
/// instead of being moved by value through every nested level. **`out` is only
/// valid to read when the returned status is `Success`**; on `NotFound` /
/// `Pending` / `Failure` it may hold partially-written state from an earlier
/// attempt and must be ignored.
pub enum MatchStatus {
    NotFound,
    Success,
    Pending(Box<PendingResolution>),
    Failure(bun_core::Error),
}

impl MatchStatus {
    #[inline]
    pub fn is_success(&self) -> bool {
        matches!(self, MatchStatus::Success)
    }
}

pub struct PendingResolution {
    pub esm: crate::package_json::PackageExternal,
    pub dependency: Dependency::Version,
    pub resolution_id: Install::PackageID,
    pub root_dependency_id: Install::DependencyID,
    pub import_record_id: u32,
    pub string_buf: Vec<u8>,
    pub tag: PendingResolutionTag,
}

impl Default for PendingResolution {
    fn default() -> Self {
        Self {
            esm: Default::default(),
            dependency: Default::default(),
            resolution_id: Install::INVALID_PACKAGE_ID,
            root_dependency_id: Install::INVALID_PACKAGE_ID,
            import_record_id: u32::MAX,
            string_buf: Vec::new(),
            tag: PendingResolutionTag::Download,
        }
    }
}

impl PendingResolution {
    // PORT NOTE: deinitListItems → Drop on MultiArrayList<PendingResolution>
    // (Zig body only freed `dependency` + `string_buf` per item; both are owned fields with Drop.)

    // deinit → Drop (frees dependency + string_buf; both have Drop)

    pub fn init(
        esm: crate::package_json::Package<'_>,
        dependency: Dependency::Version,
        resolution_id: Install::PackageID,
    ) -> core::result::Result<PendingResolution, bun_core::Error> {
        // PORT NOTE: Zig body called `try esm.copy(allocator)` and left `string_buf`
        // / `tag` defaulted; that fn was never compiled (Zig lazy-analyzes unreferenced
        // fns). `Package::copy` is the count→allocate→clone Builder dance the live
        // call sites open-code, so thread the freshly-allocated buffer into
        // `string_buf` here so `Drop` frees what backs the cloned `esm` strings.
        let (esm, string_buf) = esm.copy()?;
        Ok(PendingResolution {
            esm,
            dependency,
            resolution_id,
            string_buf,
            ..PendingResolution::default()
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PendingResolutionTag {
    Download,
    Resolve,
    Done,
}

pub struct LoadResult {
    pub path: &'static [u8], // TODO(port): lifetime — interned in dirname_store
    pub diff_case: Option<Fs::file_system::entry::lookup::DifferentCase<'static>>,
    pub dirname_fd: FD,
    pub file_fd: FD,
    pub dir_info: Option<DirInfoRef>,
}
