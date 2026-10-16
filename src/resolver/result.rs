//! Resolver output and bookkeeping types: `Result`, `MatchResult`, `LoadResult`,
//! `PathPair`, `PendingResolution`, `DebugLogs`, and friends. These are the
//! value types the [`crate::Resolver`] state machine produces and threads
//! through `resolve_without_remapping` / `load_as_file_or_directory`.

use std::io::Write as _;

use ::bun_ast::import_record as ast;
use ::bun_install_types::resolver_hooks as Install;
use bun_alloc as allocators;
use bun_core::MutableString;
use bun_sys::Fd as FD;

use crate::dir_info::DirInfoRef;
use crate::options;
use crate::package_json::PackageJSON;
use crate::resolver::Dependency;

// NOTE: `Path` in the body is the `'static`-interned variant (paths borrow
// DirnameStore/FilenameStore). Alias here so the bare-`Path` use sites resolve
// without a per-site lifetime annotation.
type Path = crate::fs::Path<'static>;

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
    index: u8,
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
    pub(crate) fn iter(&mut self) -> PathPairIter<'_> {
        PathPairIter {
            ctx: self,
            index: 0,
        }
    }
}

// Re-export of `bun_ast::SideEffects`.
// `Loader.sideEffects()` returns
// the SAME type stored in `Result.primary_side_effects_data`. Re-export so
// `result.primary_side_effects_data = loader.side_effects()` type-checks.
use bun_ast::SideEffects;

pub struct Result {
    pub path_pair: PathPair,

    pub jsx: options::jsx::Pragma,

    pub package_json: Option<*const PackageJSON>,

    // If present, any ES6 imports to this file can be considered to have no side
    // effects. This means they should be removed if unused.
    pub primary_side_effects_data: SideEffects,

    // This is the "type" field from "package.json"
    pub module_type: options::ModuleType,

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
            primary_side_effects_data: SideEffects::HasSideEffects,
            module_type: options::ModuleType::Unknown,
            dirname_fd: FD::INVALID,
            file_fd: FD::INVALID,
            import_kind: ast::ImportKind::Stmt,
            flags: ResultFlags::default(),
        }
    }
}

bitflags::bitflags! {
    #[derive(Default, Clone, Copy)]
    pub struct ResultFlags: u8 {
        // Bits 0..=1 encode [`ExternalKind`]; write via `set_external_kind`.
        const IS_EXTERNAL = 1 << 0;
        const REWRITE_IMPORT_PATH = 1 << 1;
        const IS_STANDALONE_MODULE = 1 << 2;
        // This is true when the package was loaded from within the node_modules directory.
        const IS_FROM_NODE_MODULES = 1 << 3;
        const EMIT_DECORATOR_METADATA = 1 << 5;
        const EXPERIMENTAL_DECORATORS = 1 << 6;
        /// tsconfig `"useDefineForClassFields": false` was set explicitly.
        const SET_SEMANTICS_FOR_CLASS_FIELDS = 1 << 7;
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum ExternalKind {
    #[default]
    NotExternal,
    External,
    /// External, and the import specifier should be rewritten to the resolved path.
    ExternalRewritePath,
}

/// Why a successful resolve has no path to load: every path is `is_disabled`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DisabledReason {
    /// A Node.js builtin stubbed out under the browser target.
    NodeBuiltin,
    /// The package.json `"browser"` field maps the module to `false`.
    BrowserField,
}

impl ResultFlags {
    #[inline]
    pub fn is_external(self) -> bool {
        self.contains(Self::IS_EXTERNAL)
    }
    #[inline]
    pub fn external_kind(self) -> ExternalKind {
        debug_assert!(
            !self.contains(Self::REWRITE_IMPORT_PATH) || self.contains(Self::IS_EXTERNAL)
        );
        if !self.contains(Self::IS_EXTERNAL) {
            ExternalKind::NotExternal
        } else if self.contains(Self::REWRITE_IMPORT_PATH) {
            ExternalKind::ExternalRewritePath
        } else {
            ExternalKind::External
        }
    }
    #[inline]
    pub(crate) fn set_external_kind(&mut self, kind: ExternalKind) {
        self.set(
            Self::IS_EXTERNAL,
            !matches!(kind, ExternalKind::NotExternal),
        );
        self.set(
            Self::REWRITE_IMPORT_PATH,
            matches!(kind, ExternalKind::ExternalRewritePath),
        );
    }
    #[inline]
    pub(crate) fn is_standalone_module(self) -> bool {
        self.contains(Self::IS_STANDALONE_MODULE)
    }
    #[inline]
    pub(crate) fn is_from_node_modules(self) -> bool {
        self.contains(Self::IS_FROM_NODE_MODULES)
    }
    #[inline]
    pub(crate) fn set_is_from_node_modules(&mut self, v: bool) {
        self.set(Self::IS_FROM_NODE_MODULES, v)
    }
    #[inline]
    pub fn emit_decorator_metadata(self) -> bool {
        self.contains(Self::EMIT_DECORATOR_METADATA)
    }
    #[inline]
    pub(crate) fn set_emit_decorator_metadata(&mut self, v: bool) {
        self.set(Self::EMIT_DECORATOR_METADATA, v)
    }
    #[inline]
    pub fn experimental_decorators(self) -> bool {
        self.contains(Self::EXPERIMENTAL_DECORATORS)
    }
    #[inline]
    pub(crate) fn set_experimental_decorators(&mut self, v: bool) {
        self.set(Self::EXPERIMENTAL_DECORATORS, v)
    }
    /// Effective `useDefineForClassFields`; `false` only when tsconfig set it to `false`.
    #[inline]
    pub fn use_define_for_class_fields(self) -> bool {
        !self.contains(Self::SET_SEMANTICS_FOR_CLASS_FIELDS)
    }
    #[inline]
    pub(crate) fn set_use_define_for_class_fields(&mut self, v: bool) {
        self.set(Self::SET_SEMANTICS_FOR_CLASS_FIELDS, !v)
    }
}

pub enum ResultUnion {
    Success(Result),
    Failure(crate::Error),
    Pending(PendingResolution),
    NotFound,
}

impl Result {
    /// Read-only view of the `package_json` field. It stores `Option<*const _>`
    /// (rather than `Option<&'static _>`) so [`Default`] / zeroed-init stays
    /// bit-valid. Takes the `Copy` field, not `&self`, so a site that already
    /// borrows `self` mutably (e.g. while iterating `path_pair`) can read it.
    /// Single deref site for the ARENA-backed pointer — same invariant as
    /// [`dir_info::DirInfo::package_json`].
    #[inline]
    pub(crate) fn deref_package_json(
        ptr: Option<*const PackageJSON>,
    ) -> Option<&'static PackageJSON> {
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

    /// The path to load, or why there is none.
    pub fn path_or_disabled(&self) -> core::result::Result<&Path, DisabledReason> {
        if let Some(path) = self.path_const() {
            return Ok(path);
        }
        // Stubbed builtins carry the "node" namespace; anything else came from a "browser" map.
        Err(if self.path_pair.primary.namespace == b"node" {
            DisabledReason::NodeBuiltin
        } else {
            DisabledReason::BrowserField
        })
    }
}

pub struct DirEntryResolveQueueItem {
    pub(crate) result: allocators::Result,
    // NOTE: `RawSlice<u8>` (not `&'static [u8]`) — these point into the
    // threadlocal `dir_info_uncached_path` buffer and are consumed before
    // `dir_info_cached_maybe_log` returns. `RawSlice` is `repr(transparent)`
    // over `*const [u8]` so the bit-level zero-init invariant for `Bufs` is
    // unchanged (the array slot is `MaybeUninit`-wrapped), and read sites use
    // safe `.slice()` instead of an open-coded raw-ptr deref.
    pub(crate) unsafe_path: bun_ptr::RawSlice<u8>,
    pub(crate) safe_path: bun_ptr::RawSlice<u8>,
    pub(crate) fd: FD,
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
    pub(crate) what: Vec<u8>,
    pub(crate) indent: MutableString,
    pub(crate) notes: Vec<bun_ast::Data>,
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

    // deinit → Drop (only frees `notes`)

    #[cold]
    pub(crate) fn increase_indent(&mut self) {
        self.indent.append(b" ").expect("unreachable");
    }

    #[cold]
    pub(crate) fn decrease_indent(&mut self) {
        let new_len = self.indent.list.len() - 1;
        self.indent.list.truncate(new_len);
    }

    #[cold]
    pub(crate) fn add_note(&mut self, text: Vec<u8>) {
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
    pub(crate) fn add_note_fmt(&mut self, args: core::fmt::Arguments<'_>) {
        let mut buf = Vec::new();
        write!(&mut buf, "{}", args).expect("unreachable");
        self.add_note(buf);
    }
}

pub struct MatchResult {
    pub(crate) path_pair: PathPair,
    pub(crate) dirname_fd: FD,
    pub(crate) file_fd: FD,
    pub(crate) is_node_module: bool,
    pub(crate) package_json: Option<*const PackageJSON>,
    pub(crate) dir_info: Option<DirInfoRef>,
    pub(crate) module_type: options::ModuleType,
    pub(crate) is_external: bool,
}

impl Default for MatchResult {
    fn default() -> Self {
        Self {
            path_pair: PathPair::default(),
            dirname_fd: FD::INVALID,
            file_fd: FD::INVALID,
            is_node_module: false,
            package_json: None,
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
    Failure(crate::Error),
}

impl MatchStatus {
    #[inline]
    pub(crate) fn is_success(&self) -> bool {
        matches!(self, MatchStatus::Success)
    }
}

pub struct PendingResolution {
    pub esm: crate::package_json::PackageExternal,
    pub dependency: Dependency::Version,
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
            root_dependency_id: Install::INVALID_PACKAGE_ID,
            import_record_id: u32::MAX,
            string_buf: Vec::new(),
            tag: PendingResolutionTag::Download,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PendingResolutionTag {
    Download,
    Resolve,
    Done,
}

pub struct LoadResult {
    /// Interned in `DirnameStore`/`FilenameStore` (process-lifetime singletons),
    /// so the `'static` borrow is genuine.
    pub(crate) path: &'static [u8],
    pub(crate) dirname_fd: FD,
    pub(crate) file_fd: FD,
}
