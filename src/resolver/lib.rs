// Port of src/resolver/resolver.zig
#![allow(dead_code, unused_variables, unused_imports, unused_mut, non_snake_case)]

use core::ptr::NonNull;
use std::cell::RefCell;
use std::io::Write as _;

use bun_alloc::allocators;
use bun_bundler::cache::Set as CacheSet;
use bun_bundler::options;
use bun_collections::{BoundedArray, MultiArrayList};
use bun_core::Output;
use bun_core::{Environment, FeatureFlags, Generation, Mutex, MutableString, PathString};
use bun_dotenv::env_loader as DotEnv;
use bun_install as Install;
use bun_install::dependency as Dependency;
use bun_install::lockfile::Package;
use bun_install::resolution::Resolution;
use bun_install::PackageManager;
use bun_logger as logger;
use bun_logger::Msg;
use bun_options_types::import_record as ast;
use bun_paths as ResolvePath;
use bun_paths::{PathBuffer, MAX_PATH_BYTES, SEP, SEP_STR};
use bun_perf::system_timer::Timer;
use bun_semver as Semver;
use bun_str::strings;
use bun_sys::Fd as FD;

use crate::fs as Fs;
use crate::fs::Path;
use crate::node_fallbacks as NodeFallbackModules;
use crate::package_json::{BrowserMap, ESModule, PackageJSON};
use crate::tsconfig_json::TSConfigJSON;

pub use crate::data_url::DataURL;
pub use crate::dir_info as DirInfo;
pub use bun_options_types::GlobalCache;

bun_output::declare_scope!(Resolver, hidden);
macro_rules! debuglog {
    ($($arg:tt)*) => { bun_output::scoped_log!(Resolver, $($arg)*) };
}

pub fn is_package_path(path: &[u8]) -> bool {
    // Always check for posix absolute paths (starts with "/")
    // But don't check window's style on posix
    // For a more in depth explanation, look above where `isPackagePathNotAbsolute` is used.
    !bun_paths::is_absolute(path) && is_package_path_not_absolute(path)
}

pub fn is_package_path_not_absolute(non_absolute_path: &[u8]) -> bool {
    if cfg!(debug_assertions) {
        debug_assert!(!bun_paths::is_absolute(non_absolute_path));
        debug_assert!(!non_absolute_path.starts_with(b"/"));
    }

    !non_absolute_path.starts_with(b"./")
        && !non_absolute_path.starts_with(b"../")
        && non_absolute_path != b"."
        && non_absolute_path != b".."
        && if cfg!(windows) {
            !non_absolute_path.starts_with(b".\\") && !non_absolute_path.starts_with(b"..\\")
        } else {
            true
        }
}

pub struct SideEffectsData {
    pub source: Option<NonNull<logger::Source>>, // TODO(port): lifetime — never instantiated
    pub range: logger::Range,

    // If true, "sideEffects" was an array. If false, "sideEffects" was false.
    pub is_side_effects_array_in_json: bool,
}

/// A temporary threadlocal buffer with a lifetime more than the current
/// function call.
///
/// These used to be individual `threadlocal var x: bun.PathBuffer = undefined`
/// declarations. On Windows each `PathBuffer` is 96 KB (vs 4 KB on POSIX) and
/// PE/COFF has no TLS-BSS, so 25 of them here cost ~2.5 MB of raw zeros in
/// bun.exe and in every thread's TLS block. Grouping them behind a lazily
/// allocated pointer brings that down to 8 bytes. See `bun.ThreadlocalBuffers`.
///
/// Experimenting with making this one struct instead of a bunch of different
/// threadlocal vars yielded no performance improvement on macOS when bundling
/// 10 copies of Three.js. Potentially revisit after https://github.com/oven-sh/bun/issues/2716
pub struct Bufs {
    pub extension_path: PathBuffer,
    pub tsconfig_match_full_buf: PathBuffer,
    pub tsconfig_match_full_buf2: PathBuffer,
    pub tsconfig_match_full_buf3: PathBuffer,

    pub esm_subpath: [u8; 512],
    pub esm_absolute_package_path: PathBuffer,
    pub esm_absolute_package_path_joined: PathBuffer,

    pub dir_entry_paths_to_resolve: [DirEntryResolveQueueItem; 256],
    pub open_dirs: [FD; 256],
    pub resolve_without_remapping: PathBuffer,
    pub index: PathBuffer,
    pub dir_info_uncached_filename: PathBuffer,
    pub node_bin_path: PathBuffer,
    pub dir_info_uncached_path: PathBuffer,
    pub tsconfig_base_url: PathBuffer,
    pub relative_abs_path: PathBuffer,
    pub load_as_file_or_directory_via_tsconfig_base_path: PathBuffer,
    pub node_modules_check: PathBuffer,
    pub field_abs_path: PathBuffer,
    pub tsconfig_path_abs: PathBuffer,
    pub check_browser_map: PathBuffer,
    pub remap_path: PathBuffer,
    pub load_as_file: PathBuffer,
    pub remap_path_trailing_slash: PathBuffer,
    pub path_in_global_disk_cache: PathBuffer,
    pub abs_to_rel: PathBuffer,
    pub node_modules_paths_buf: PathBuffer,
    pub import_path_for_standalone_module_graph: PathBuffer,

    #[cfg(windows)]
    pub win32_normalized_dir_info_cache: [u8; MAX_PATH_BYTES * 2],
    #[cfg(not(windows))]
    pub win32_normalized_dir_info_cache: (),
}

// TODO(port): bun.ThreadlocalBuffers(Bufs) — lazily-allocated threadlocal Box<Bufs>.
// In Rust we model it as a `thread_local! { static BUFS_STORAGE: RefCell<Box<Bufs>> }`
// and the `bufs!()` macro hands out `&mut` to a single field. This relies on the
// caller never holding two `bufs!()` borrows simultaneously across the same field;
// the Zig code already obeys that invariant.
thread_local! {
    static BUFS_STORAGE: RefCell<Option<Box<Bufs>>> = const { RefCell::new(None) };
}

#[inline]
fn bufs_storage_get() -> *mut Bufs {
    BUFS_STORAGE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        if borrow.is_none() {
            // SAFETY: Bufs is plain bytes; Zig left these `= undefined`.
            *borrow = Some(unsafe { Box::<Bufs>::new_zeroed().assume_init() });
        }
        &mut **borrow.as_mut().unwrap() as *mut Bufs
    })
}

/// `bufs(.field)` → `bufs!(field)` returns `&mut <field type>`.
/// // SAFETY: callers must not alias the same field; threadlocal so no cross-thread races.
macro_rules! bufs {
    ($field:ident) => {
        // SAFETY: threadlocal storage; callers must not alias the same field within one call frame.
        unsafe { &mut (*bufs_storage_get()).$field }
    };
}

pub struct PathPair {
    pub primary: Path,
    pub secondary: Option<Path>,
}

impl Default for PathPair {
    fn default() -> Self {
        Self { primary: Path::empty(), secondary: None }
    }
}

pub struct PathPairIter<'a> {
    index: u8, // u2 in Zig
    ctx: &'a mut PathPair,
}

impl<'a> PathPairIter<'a> {
    pub fn next(&mut self) -> Option<&mut Path> {
        if let Some(path_) = self.next_() {
            // SAFETY: reshaped for borrowck — recurse via raw ptr to avoid double &mut.
            let p: *mut Path = path_;
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
        PathPairIter { ctx: self, index: 0 }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum SideEffects {
    /// The default value conservatively considers all files to have side effects.
    #[default]
    HasSideEffects,

    /// This file was listed as not having side effects by a "package.json"
    /// file in one of our containing directories with a "sideEffects" field.
    NoSideEffectsPackageJson,

    /// This file is considered to have no side effects because the AST was empty
    /// after parsing finished. This should be the case for ".d.ts" files.
    NoSideEffectsEmptyAst,

    /// This file was loaded using a data-oriented loader (e.g. "text") that is
    /// known to not have side effects.
    NoSideEffectsPureData,
    // /// Same as above but it came from a plugin. We don't want to warn about
    // /// unused imports to these files since running the plugin is a side effect.
    // /// Removing the import would not call the plugin which is observable.
    // NoSideEffectsPureDataFromPlugin,
}

pub struct Result {
    pub path_pair: PathPair,

    pub jsx: options::jsx::Pragma,

    pub package_json: Option<*const PackageJSON>,

    pub diff_case: Option<Fs::file_system::entry::lookup::DifferentCase>,

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
            import_kind: ast::ImportKind::default(), // Zig: undefined
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
    #[inline] pub fn is_external(&self) -> bool { self.contains(Self::IS_EXTERNAL) }
    #[inline] pub fn set_is_external(&mut self, v: bool) { self.set(Self::IS_EXTERNAL, v) }
    #[inline] pub fn is_external_and_rewrite_import_path(&self) -> bool { self.contains(Self::IS_EXTERNAL_AND_REWRITE_IMPORT_PATH) }
    #[inline] pub fn set_is_external_and_rewrite_import_path(&mut self, v: bool) { self.set(Self::IS_EXTERNAL_AND_REWRITE_IMPORT_PATH, v) }
    #[inline] pub fn is_standalone_module(&self) -> bool { self.contains(Self::IS_STANDALONE_MODULE) }
    #[inline] pub fn is_from_node_modules(&self) -> bool { self.contains(Self::IS_FROM_NODE_MODULES) }
    #[inline] pub fn set_is_from_node_modules(&mut self, v: bool) { self.set(Self::IS_FROM_NODE_MODULES, v) }
    #[inline] pub fn emit_decorator_metadata(&self) -> bool { self.contains(Self::EMIT_DECORATOR_METADATA) }
    #[inline] pub fn set_emit_decorator_metadata(&mut self, v: bool) { self.set(Self::EMIT_DECORATOR_METADATA, v) }
    #[inline] pub fn experimental_decorators(&self) -> bool { self.contains(Self::EXPERIMENTAL_DECORATORS) }
    #[inline] pub fn set_experimental_decorators(&mut self, v: bool) { self.set(Self::EXPERIMENTAL_DECORATORS, v) }
}

pub enum ResultUnion {
    Success(Result),
    Failure(bun_core::Error),
    Pending(PendingResolution),
    NotFound,
}

impl Result {
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
        let Some(path_) = self.path_const() else { return false };
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
    pub notes: Vec<logger::Data>,
    pub suggestion_text: &'static [u8],
    pub suggestion_message: &'static [u8],
    pub suggestion_range: SuggestionRange,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SuggestionRange {
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
        log: &mut logger::Log,
        source: Option<&logger::Source>,
        r: logger::Range,
        args: core::fmt::Arguments<'_>,
    ) -> core::result::Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if source.is_some() && !self.suggestion_message.is_empty() {
            let suggestion_range = if self.suggestion_range == SuggestionRange::End {
                logger::Range { loc: logger::Loc { start: r.end_i() as i32 - 1 }, ..Default::default() }
            } else {
                r
            };
            let mut data = logger::range_data(source, suggestion_range, self.suggestion_message);
            data.location.as_mut().unwrap().suggestion = self.suggestion_text;
            self.notes.push(data);
        }

        let mut msg_text = Vec::new();
        write!(&mut msg_text, "{}", args).ok();
        log.add_msg(Msg {
            kind: logger::Kind::Err,
            data: logger::range_data(source, r, msg_text),
            notes: core::mem::take(&mut self.notes).into_boxed_slice(),
            ..Default::default()
        })?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct DirEntryResolveQueueItem {
    pub result: allocators::Result,
    pub unsafe_path: &'static [u8], // TODO(port): lifetime — points into threadlocal buf
    pub safe_path: &'static [u8],
    pub fd: FD,
}

impl Default for DirEntryResolveQueueItem {
    fn default() -> Self {
        Self {
            result: allocators::Result::default(),
            unsafe_path: b"",
            safe_path: b"",
            fd: FD::INVALID,
        }
    }
}

pub struct DebugLogs {
    pub what: Vec<u8>,
    pub indent: MutableString,
    pub notes: Vec<logger::Data>,
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
            .push(logger::range_data(None, logger::Range::NONE, final_text));
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
    pub diff_case: Option<Fs::file_system::entry::lookup::DifferentCase>,
    pub dir_info: Option<*const DirInfo::DirInfo>,
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

pub enum MatchResultUnion {
    NotFound,
    Success(MatchResult),
    Pending(PendingResolution),
    Failure(bun_core::Error),
}

pub struct PendingResolution {
    pub esm: crate::package_json::esmodule::package::External,
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

pub type PendingResolutionList = MultiArrayList<PendingResolution>;

impl PendingResolution {
    // PORT NOTE: deinitListItems → Drop on MultiArrayList<PendingResolution>
    // (Zig body only freed `dependency` + `string_buf` per item; both are owned fields with Drop.)

    // deinit → Drop (frees dependency + string_buf; both have Drop)

    pub fn init(
        esm: crate::package_json::ESModulePackage,
        dependency: Dependency::Version,
        resolution_id: Install::PackageID,
    ) -> core::result::Result<PendingResolution, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(PendingResolution {
            esm: esm.copy()?,
            dependency,
            resolution_id,
            ..Default::default()
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
    pub diff_case: Option<Fs::file_system::entry::lookup::DifferentCase>,
    pub dirname_fd: FD,
    pub file_fd: FD,
    pub dir_info: Option<*const DirInfo::DirInfo>,
}

// This is a global so even if multiple resolvers are created, the mutex will still work
static RESOLVER_MUTEX: Mutex = Mutex::new();
// Zig had `resolver_Mutex_loaded` to lazily zero-init; Rust const init handles that.

type BinFolderArray = BoundedArray<&'static [u8], 128>;
static mut BIN_FOLDERS: BinFolderArray = BinFolderArray::new(); // TODO(port): proper static mut wrapper
static BIN_FOLDERS_LOCK: Mutex = Mutex::new();
static mut BIN_FOLDERS_LOADED: bool = false;

pub struct AnyResolveWatcher {
    pub context: NonNull<()>,
    pub callback: fn(*mut (), &[u8], FD),
}

impl AnyResolveWatcher {
    pub fn watch(&self, dir_path: &[u8], fd: FD) {
        (self.callback)(self.context.as_ptr(), dir_path, fd)
    }
}

// Zig: `pub fn ResolveWatcher(comptime Context: type, comptime onWatch: anytype) type` —
// type-generator returning a struct with `.init(ctx) -> AnyResolveWatcher` and a
// monomorphized `watch` shim. Per PORTING.md (`fn Foo(comptime T) type` → `struct Foo<T>`).
pub struct ResolveWatcher<C, const ON_WATCH: fn(*mut C, &[u8], FD)>;

impl<C, const ON_WATCH: fn(*mut C, &[u8], FD)> ResolveWatcher<C, ON_WATCH> {
    pub fn init(context: *mut C) -> AnyResolveWatcher {
        // TODO(port): const fn-pointer generics are unstable (`adt_const_params`); Phase B may
        // need to reshape to a generic over a ZST `trait OnWatch { fn watch(&mut C, &[u8], FD) }`.
        extern "C" fn watch<C, const ON_WATCH: fn(*mut C, &[u8], FD)>(
            ctx: *mut (),
            dir_path: &[u8],
            fd: FD,
        ) {
            ON_WATCH(ctx as *mut C, dir_path, fd)
        }
        AnyResolveWatcher {
            // SAFETY: caller guarantees `context` is non-null and outlives the watcher.
            context: unsafe { NonNull::new_unchecked(context as *mut ()) },
            callback: watch::<C, ON_WATCH>,
        }
    }
}

pub struct Resolver<'a> {
    pub opts: options::BundleOptions,
    pub fs: &'a mut Fs::FileSystem,
    pub log: &'a mut logger::Log,
    // allocator: dropped — global mimalloc
    pub extension_order: &'static [&'static [u8]], // TODO(port): lifetime — points into opts
    pub timer: Timer,

    pub care_about_bin_folder: bool,
    pub care_about_scripts: bool,

    /// Read the "browser" field in package.json files?
    /// For Bun's runtime, we don't.
    pub care_about_browser_field: bool,

    pub debug_logs: Option<DebugLogs>,
    pub elapsed: u64, // tracing

    pub watcher: Option<AnyResolveWatcher>,

    pub caches: CacheSet,
    pub generation: Generation,

    pub package_manager: Option<NonNull<PackageManager>>, // TODO(port): lifetime
    pub on_wake_package_manager: bun_install::WakeHandler,
    pub env_loader: Option<&'a DotEnv::Loader>,
    pub store_fd: bool,

    pub standalone_module_graph: Option<&'a bun_core::StandaloneModuleGraph>,

    // These are sets that represent various conditions for the "exports" field
    // in package.json.
    // esm_conditions_default: bun.StringHashMap(bool),
    // esm_conditions_import: bun.StringHashMap(bool),
    // esm_conditions_require: bun.StringHashMap(bool),

    // A special filtered import order for CSS "@import" imports.
    //
    // The "resolve extensions" setting determines the order of implicit
    // extensions to try when resolving imports with the extension omitted.
    // Sometimes people create a JavaScript/TypeScript file and a CSS file with
    // the same name when they create a component. At a high level, users expect
    // implicit extensions to resolve to the JS file when being imported from JS
    // and to resolve to the CSS file when being imported from CSS.
    //
    // Different bundlers handle this in different ways. Parcel handles this by
    // having the resolver prefer the same extension as the importing file in
    // front of the configured "resolve extensions" order. Webpack's "css-loader"
    // plugin just explicitly configures a special "resolve extensions" order
    // consisting of only ".css" for CSS files.
    //
    // It's unclear what behavior is best here. What we currently do is to create
    // a special filtered version of the configured "resolve extensions" order
    // for CSS files that filters out any extension that has been explicitly
    // configured with a non-CSS loader. This still gives users control over the
    // order but avoids the scenario where we match an import in a CSS file to a
    // JavaScript-related file. It's probably not perfect with plugins in the
    // picture but it's better than some alternatives and probably pretty good.
    // atImportExtensionOrder []string

    // This mutex serves two purposes. First of all, it guards access to "dirCache"
    // which is potentially mutated during path resolution. But this mutex is also
    // necessary for performance. The "React admin" benchmark mysteriously runs
    // twice as fast when this mutex is locked around the whole resolve operation
    // instead of around individual accesses to "dirCache". For some reason,
    // reducing parallelism in the resolver helps the rest of the bundler go
    // faster. I'm not sure why this is but please don't change this unless you
    // do a lot of testing with various benchmarks and there aren't any regressions.
    pub mutex: &'static Mutex,

    /// This cache maps a directory path to information about that directory and
    /// all parent directories. When interacting with this structure, make sure
    /// to validate your keys with `Resolver.assertValidCacheKey`
    pub dir_cache: &'static mut DirInfo::HashMap,

    /// This is set to false for the runtime. The runtime should choose "main"
    /// over "module" in package.json
    pub prefer_module_field: bool,

    /// This is an array of paths to resolve against. Used for passing an
    /// object '{ paths: string[] }' to `require` and `resolve`; This field
    /// is overwritten while the resolution happens.
    ///
    /// When this is null, it is as if it is set to `&.{ path.dirname(referrer) }`.
    pub custom_dir_paths: Option<&'a [bun_str::String]>,
}

impl<'a> Resolver<'a> {
    pub fn get_package_manager(&mut self) -> &mut PackageManager {
        if let Some(pm) = self.package_manager {
            // SAFETY: BACKREF — pm outlives resolver; lazily inited below.
            return unsafe { &mut *pm.as_ptr() };
        }
        bun_http::HTTPThread::init(&Default::default());
        let pm = PackageManager::init_with_runtime(
            self.log,
            self.opts.install,
            // This cannot be the threadlocal allocator. It goes to the HTTP thread.
            // (allocator param dropped)
            Default::default(),
            self.env_loader.unwrap(),
        );
        // SAFETY: pm is a leaked/global allocation owned by PackageManager itself.
        let pm_ref = unsafe { &mut *pm };
        pm_ref.on_wake = self.on_wake_package_manager.clone();
        self.package_manager = NonNull::new(pm);
        pm_ref
    }

    #[inline]
    pub fn use_package_manager(&self) -> bool {
        // TODO(@paperclover): make this configurable. the rationale for disabling
        // auto-install in standalone mode is that such executable must either:
        //
        // - bundle the dependency itself. dynamic `require`/`import` could be
        //   changed to bundle potential dependencies specified in package.json
        //
        // - want to load the user's node_modules, which is what currently happens.
        //
        // auto install, as of writing, is also quite buggy and untested, it always
        // installs the latest version regardless of a user's package.json or specifier.
        // in addition to being not fully stable, it is completely unexpected to invoke
        // a package manager after bundling an executable. if enough people run into
        // this, we could implement point 1
        if self.standalone_module_graph.is_some() {
            return false;
        }

        self.opts.global_cache.is_enabled()
    }

    pub fn init1(
        log: &'a mut logger::Log,
        _fs: &'a mut Fs::FileSystem,
        opts: options::BundleOptions,
    ) -> Self {
        // resolver_Mutex_loaded check elided; static is const-inited in Rust.

        let extension_order = opts.extension_order.default.default;
        let care_about_browser_field = opts.target == options::Target::Browser;
        Resolver {
            // allocator dropped
            dir_cache: DirInfo::HashMap::init(),
            mutex: &RESOLVER_MUTEX,
            caches: CacheSet::init(),
            opts,
            timer: Timer::start().unwrap_or_else(|_| panic!("Timer fail")),
            fs: _fs,
            log,
            extension_order,
            care_about_browser_field,
            care_about_bin_folder: false,
            care_about_scripts: false,
            debug_logs: None,
            elapsed: 0,
            watcher: None,
            generation: 0,
            package_manager: None,
            on_wake_package_manager: Default::default(),
            env_loader: None,
            store_fd: false,
            standalone_module_graph: None,
            prefer_module_field: true,
            custom_dir_paths: None,
        }
    }

    pub fn is_external_pattern(&self, import_path: &[u8]) -> bool {
        if self.opts.packages == options::Packages::External && is_package_path(import_path) {
            return true;
        }
        self.matches_user_external_pattern(import_path)
    }

    /// True iff `import_path` matches a user-supplied `--external` wildcard
    /// pattern. Does NOT consider `packages = external`; use
    /// `isExternalPattern` for the combined check.
    pub fn matches_user_external_pattern(&self, import_path: &[u8]) -> bool {
        for pattern in self.opts.external.patterns.iter() {
            if import_path.len() >= pattern.prefix.len() + pattern.suffix.len()
                && (import_path.starts_with(pattern.prefix.as_ref())
                    && import_path.ends_with(pattern.suffix.as_ref()))
            {
                return true;
            }
        }
        false
    }

    /// Resolves `import_path` via the enclosing tsconfig's `paths`. Returns
    /// the `MatchResult` iff a key matches AND the mapped target exists on
    /// disk. Used to let path-aliased local files win over `packages=external`
    /// without breaking catch-all `"*"` paths entries that only cover ambient
    /// type stubs.
    pub fn resolve_via_tsconfig_paths(
        &mut self,
        source_dir: &[u8],
        import_path: &[u8],
        kind: ast::ImportKind,
    ) -> Option<MatchResult> {
        if source_dir.is_empty() {
            return None;
        }
        if !bun_paths::is_absolute(source_dir) {
            return None;
        }
        let dir_info = self.dir_info_cached(source_dir).ok().flatten()?;
        // SAFETY: ARENA — DirInfo ptr is a slot in the BSSMap singleton (`dir_cache`) and outlives the resolver (see LIFETIMES.tsv).
        let tsconfig = unsafe { &*dir_info }.enclosing_tsconfig_json?;
        if tsconfig.paths.count() == 0 {
            return None;
        }
        self.match_tsconfig_paths(tsconfig, import_path, kind)
    }

    pub fn flush_debug_logs(&mut self, flush_mode: FlushMode) -> core::result::Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if let Some(debug) = self.debug_logs.as_mut() {
            if flush_mode == FlushMode::Fail {
                self.log.add_range_debug_with_notes(
                    None,
                    logger::Range { loc: logger::Loc::default(), ..Default::default() },
                    &debug.what,
                    core::mem::take(&mut debug.notes).into_boxed_slice(),
                )?;
            } else if (self.log.level as u32) <= (logger::log::Level::Verbose as u32) {
                self.log.add_verbose_with_notes(
                    None,
                    logger::Loc::EMPTY,
                    &debug.what,
                    core::mem::take(&mut debug.notes).into_boxed_slice(),
                )?;
            }
        }
        Ok(())
    }

    // var tracing_start: i128 — unused; dropped.

    pub fn resolve_and_auto_install(
        &mut self,
        source_dir: &[u8],
        import_path: &[u8],
        kind: ast::ImportKind,
        global_cache: GlobalCache,
    ) -> ResultUnion {
        let _tracer = bun_core::perf::trace("ModuleResolver.resolve");

        // Only setting 'current_action' in debug mode because module resolution
        // is done very often, and has a very low crash rate.
        // TODO(port): bun.crash_handler.current_action save/restore (Environment.show_crash_trace gated)
        #[cfg(debug_assertions)]
        let _crash_guard = bun_crash_handler::set_current_action_resolver(source_dir, import_path, kind);

        #[cfg(debug_assertions)]
        if bun_cli::debug_flags::has_resolve_breakpoint(import_path) {
            bun_core::Output::debug(format_args!(
                "Resolving <green>{}<r> from <blue>{}<r>",
                bstr::BStr::new(import_path),
                bstr::BStr::new(source_dir),
            ));
            // @breakpoint() — no Rust equiv; left as TODO(port)
        }

        let original_order = self.extension_order;
        let _restore_ext = scopeguard::guard((), |_| {
            // TODO(port): errdefer-style restore of self.extension_order; reshaped below
        });
        // PORT NOTE: reshaped for borrowck — restore happens at all return points below
        self.extension_order = match kind {
            ast::ImportKind::Url | ast::ImportKind::AtConditional | ast::ImportKind::At => {
                options::bundle_options::defaults::CSS_EXTENSION_ORDER
            }
            ast::ImportKind::EntryPointBuild
            | ast::ImportKind::EntryPointRun
            | ast::ImportKind::Stmt
            | ast::ImportKind::Dynamic => self.opts.extension_order.default.esm,
            _ => self.opts.extension_order.default.default,
        };

        if FeatureFlags::TRACING {
            self.timer.reset();
        }

        // defer { if FeatureFlags::TRACING { r.elapsed += r.timer.read() } }
        // PERF(port): was defer — Phase B convert to scopeguard
        struct ElapsedGuard<'g, 'a>(&'g mut Resolver<'a>);
        // TODO(port): elapsed accumulation moved to end of function for borrowck

        if self.log.level == logger::log::Level::Verbose {
            if self.debug_logs.is_some() {
                // deinit → drop
                self.debug_logs = None;
            }
            self.debug_logs = Some(DebugLogs::init().expect("unreachable"));
        }

        if import_path.is_empty() {
            self.extension_order = original_order;
            return ResultUnion::NotFound;
        }

        if self.opts.mark_builtins_as_external {
            if import_path.starts_with(b"node:")
                || import_path.starts_with(b"bun:")
                || bun_jsc::module_loader::HardcodedModule::Alias::has(
                    import_path,
                    self.opts.target,
                    bun_jsc::module_loader::AliasOptions {
                        rewrite_jest_for_tests: self.opts.rewrite_jest_for_tests,
                    },
                )
            {
                self.extension_order = original_order;
                return ResultUnion::Success(Result {
                    import_kind: kind,
                    path_pair: PathPair { primary: Path::init(import_path), secondary: None },
                    module_type: options::ModuleType::Cjs,
                    primary_side_effects_data: SideEffects::NoSideEffectsPureData,
                    flags: ResultFlags::IS_EXTERNAL,
                    ..Default::default()
                });
            }
        }

        // #29590: a tsconfig `paths` key can look bare (e.g. "@/*") and
        // otherwise collide with `packages=external + isPackagePath`. Try
        // the alias first, but only follow it when it actually resolves to
        // a file on disk — a catch-all `"*": ["./types/*"]` for ambient
        // .d.ts stubs must still let real bare imports stay external.
        if kind != ast::ImportKind::EntryPointBuild
            && kind != ast::ImportKind::EntryPointRun
            && self.opts.packages == options::Packages::External
            && is_package_path(import_path)
            && !self.matches_user_external_pattern(import_path)
        {
            if let Some(res) = self.resolve_via_tsconfig_paths(source_dir, import_path, kind) {
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note(b"Resolved via tsconfig.json \"paths\" before applying packages=external".to_vec());
                }
                let _ = self.flush_debug_logs(FlushMode::Success);
                self.extension_order = original_order;
                return ResultUnion::Success(Result {
                    import_kind: kind,
                    path_pair: res.path_pair,
                    diff_case: res.diff_case,
                    package_json: res.package_json,
                    dirname_fd: res.dirname_fd,
                    file_fd: res.file_fd,
                    jsx: self.opts.jsx.clone(),
                    ..Default::default()
                });
            }
        }

        // Certain types of URLs default to being external for convenience,
        // while these rules should not be applied to the entrypoint as it is never external (#12734)
        if kind != ast::ImportKind::EntryPointBuild
            && kind != ast::ImportKind::EntryPointRun
            && (self.is_external_pattern(import_path)
                // "fill: url(#filter);"
                || (kind.is_from_css() && import_path.starts_with(b"#"))
                // "background: url(http://example.com/images/image.png);"
                || import_path.starts_with(b"http://")
                // "background: url(https://example.com/images/image.png);"
                || import_path.starts_with(b"https://")
                // "background: url(//example.com/images/image.png);"
                || import_path.starts_with(b"//"))
        {
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note(b"Marking this path as implicitly external".to_vec());
            }
            let _ = self.flush_debug_logs(FlushMode::Success);

            self.extension_order = original_order;
            return ResultUnion::Success(Result {
                import_kind: kind,
                path_pair: PathPair { primary: Path::init(import_path), secondary: None },
                module_type: if !kind.is_from_css() { options::ModuleType::Esm } else { options::ModuleType::Unknown },
                flags: ResultFlags::IS_EXTERNAL,
                ..Default::default()
            });
        }

        match DataURL::parse(import_path) {
            Err(_) => {
                self.extension_order = original_order;
                return ResultUnion::Failure(bun_core::err!("InvalidDataURL"));
            }
            Ok(Some(data_url)) => {
                // "import 'data:text/javascript,console.log(123)';"
                // "@import 'data:text/css,body{background:white}';"
                let mime = data_url.decode_mime_type();
                use bun_http::mime_type::Category;
                if matches!(mime.category, Category::Javascript | Category::Css | Category::Json | Category::Text) {
                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note(b"Putting this path in the \"dataurl\" namespace".to_vec());
                    }
                    let _ = self.flush_debug_logs(FlushMode::Success);

                    self.extension_order = original_order;
                    return ResultUnion::Success(Result {
                        path_pair: PathPair { primary: Path::init_with_namespace(import_path, b"dataurl"), secondary: None },
                        ..Default::default()
                    });
                }

                // "background: url(data:image/png;base64,iVBORw0KGgo=);"
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note(b"Marking this \"dataurl\" as external".to_vec());
                }
                let _ = self.flush_debug_logs(FlushMode::Success);

                self.extension_order = original_order;
                return ResultUnion::Success(Result {
                    path_pair: PathPair { primary: Path::init_with_namespace(import_path, b"dataurl"), secondary: None },
                    flags: ResultFlags::IS_EXTERNAL,
                    ..Default::default()
                });
            }
            Ok(None) => {}
        }

        // When using `bun build --compile`, module resolution is never
        // relative to our special /$bunfs/ directory.
        //
        // It's always relative to the current working directory of the project root.
        //
        // ...unless you pass a relative path that exists in the standalone module graph executable.
        let mut source_dir_resolver = bun_paths::PosixToWinNormalizer::default();
        let source_dir_normalized: &[u8] = 'brk: {
            if let Some(graph) = self.standalone_module_graph {
                if bun_core::StandaloneModuleGraph::is_bun_standalone_file_path(import_path) {
                    if graph.find_assume_standalone_path(import_path).is_some() {
                        self.extension_order = original_order;
                        return ResultUnion::Success(Result {
                            import_kind: kind,
                            path_pair: PathPair { primary: Path::init(import_path), secondary: None },
                            module_type: options::ModuleType::Esm,
                            flags: ResultFlags::IS_STANDALONE_MODULE,
                            ..Default::default()
                        });
                    }

                    self.extension_order = original_order;
                    return ResultUnion::NotFound;
                } else if bun_core::StandaloneModuleGraph::is_bun_standalone_file_path(source_dir) {
                    if import_path.len() > 2 && is_dot_slash(&import_path[0..2]) {
                        let buf = bufs!(import_path_for_standalone_module_graph);
                        let joined = bun_paths::join_abs_string_buf(source_dir, buf, &[import_path], bun_paths::Platform::Loose);

                        // Support relative paths in the graph
                        if let Some(file) = graph.find_assume_standalone_path(joined) {
                            self.extension_order = original_order;
                            return ResultUnion::Success(Result {
                                import_kind: kind,
                                path_pair: PathPair { primary: Path::init(file.name()), secondary: None },
                                module_type: options::ModuleType::Esm,
                                flags: ResultFlags::IS_STANDALONE_MODULE,
                                ..Default::default()
                            });
                        }
                    }
                    break 'brk Fs::FileSystem::instance().top_level_dir;
                }
            }

            // Fail now if there is no directory to resolve in. This can happen for
            // virtual modules (e.g. stdin) if a resolve directory is not specified.
            //
            // TODO: This is skipped for now because it is impossible to set a
            // resolveDir so we default to the top level directory instead (this
            // is backwards compat with Bun 1.0 behavior)
            // See https://github.com/oven-sh/bun/issues/8994 for more details.
            if source_dir.is_empty() {
                // if let Some(debug) = self.debug_logs.as_mut() {
                //     debug.add_note(b"Cannot resolve this path without a directory".to_vec());
                //     let _ = self.flush_debug_logs(FlushMode::Fail);
                // }
                // return ResultUnion::Failure(bun_core::err!("MissingResolveDir"));
                break 'brk Fs::FileSystem::instance().top_level_dir;
            }

            // This can also be hit if you use plugins with non-file namespaces,
            // or call the module resolver from javascript (Bun.resolveSync)
            // with a faulty parent specifier.
            if !bun_paths::is_absolute(source_dir) {
                // if let Some(debug) = self.debug_logs.as_mut() {
                //     debug.add_note(b"Cannot resolve this path without an absolute directory".to_vec());
                //     let _ = self.flush_debug_logs(FlushMode::Fail);
                // }
                // return ResultUnion::Failure(bun_core::err!("InvalidResolveDir"));
                break 'brk Fs::FileSystem::instance().top_level_dir;
            }

            break 'brk source_dir_resolver
                .resolve_cwd(source_dir)
                .unwrap_or_else(|_| panic!("Failed to query CWD"));
        };

        // r.mutex.lock();
        // defer r.mutex.unlock();
        // errdefer (r.flushDebugLogs(.fail) catch {}) — handled at each error return below

        // A path with a null byte cannot exist on the filesystem. Continuing
        // anyways would cause assertion failures.
        if strings::index_of_char(import_path, 0).is_some() {
            let _ = self.flush_debug_logs(FlushMode::Fail);
            self.extension_order = original_order;
            return ResultUnion::NotFound;
        }

        let mut tmp = self.resolve_without_symlinks(source_dir_normalized, import_path, kind, global_cache);

        // Fragments in URLs in CSS imports are technically expected to work
        if matches!(tmp, ResultUnion::NotFound) && kind.is_from_css() {
            'try_without_suffix: {
                // If resolution failed, try again with the URL query and/or hash removed
                let maybe_suffix = strings::index_of_any(import_path, b"?#");
                let Some(suffix) = maybe_suffix else { break 'try_without_suffix };
                if suffix < 1 {
                    break 'try_without_suffix;
                }

                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!(
                        "Retrying resolution after removing the suffix {}",
                        bstr::BStr::new(&import_path[suffix..])
                    ));
                }
                let result2 = self.resolve_without_symlinks(source_dir_normalized, &import_path[0..suffix], kind, global_cache);
                if matches!(result2, ResultUnion::NotFound) {
                    break 'try_without_suffix;
                }
                tmp = result2;
            }
        }

        let ret = match tmp {
            ResultUnion::Success(mut result) => {
                if result.path_pair.primary.namespace() != b"node" && !result.flags.is_standalone_module() {
                    if let Err(err) = self.finalize_result(&mut result, kind) {
                        self.extension_order = original_order;
                        return ResultUnion::Failure(err);
                    }
                }

                let _ = self.flush_debug_logs(FlushMode::Success);
                result.import_kind = kind;
                if cfg!(feature = "debug_logs") {
                    // TODO(port): debuglog! with bun.fmt.fmtPath formatting
                }
                ResultUnion::Success(result)
            }
            ResultUnion::Failure(e) => {
                let _ = self.flush_debug_logs(FlushMode::Fail);
                ResultUnion::Failure(e)
            }
            ResultUnion::Pending(pending) => {
                let _ = self.flush_debug_logs(FlushMode::Fail);
                ResultUnion::Pending(pending)
            }
            ResultUnion::NotFound => {
                let _ = self.flush_debug_logs(FlushMode::Fail);
                ResultUnion::NotFound
            }
        };

        if FeatureFlags::TRACING {
            self.elapsed += self.timer.read();
        }
        self.extension_order = original_order;
        ret
    }

    pub fn resolve(
        &mut self,
        source_dir: &[u8],
        import_path: &[u8],
        kind: ast::ImportKind,
    ) -> core::result::Result<Result, bun_core::Error> {
        // TODO(port): narrow error set
        match self.resolve_and_auto_install(source_dir, import_path, kind, GlobalCache::Disable) {
            ResultUnion::Success(result) => Ok(result),
            ResultUnion::Pending(_) | ResultUnion::NotFound => Err(bun_core::err!("ModuleNotFound")),
            ResultUnion::Failure(e) => Err(e),
        }
    }

    /// Runs a resolution but also checking if a Bun Bake framework has an
    /// override. This is used in one place in the bundler.
    pub fn resolve_with_framework(
        &mut self,
        source_dir: &[u8],
        import_path: &[u8],
        kind: ast::ImportKind,
    ) -> core::result::Result<Result, bun_core::Error> {
        // TODO(port): narrow error set
        if let Some(f) = self.opts.framework.as_ref() {
            if let Some(mod_) = f.built_in_modules.get(import_path) {
                match mod_ {
                    bun_bake::framework::BuiltInModule::Code(_) => {
                        return Ok(Result {
                            import_kind: kind,
                            path_pair: PathPair { primary: Fs::Path::init_with_namespace(import_path, b"node"), secondary: None },
                            module_type: options::ModuleType::Esm,
                            primary_side_effects_data: SideEffects::NoSideEffectsPureData,
                            flags: ResultFlags::default(),
                            ..Default::default()
                        });
                    }
                    bun_bake::framework::BuiltInModule::Import(path) => {
                        let top = self.fs.top_level_dir;
                        return self.resolve(top, path, ast::ImportKind::EntryPointBuild);
                    }
                }
                // unreachable in Zig (return after switch)
            }
        }
        self.resolve(source_dir, import_path, kind)
    }

    pub fn finalize_result(&mut self, result: &mut Result, kind: ast::ImportKind) -> core::result::Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if result.flags.is_external() {
            return Ok(());
        }

        let mut iter = result.path_pair.iter();
        let mut module_type = result.module_type;
        while let Some(path) = iter.next() {
            let Ok(Some(dir)) = self.read_dir_info(path.name.dir()) else { continue };
            // SAFETY: ARENA — DirInfo ptr is a slot in the BSSMap singleton (`dir_cache`) and outlives the resolver (see LIFETIMES.tsv).
            let dir: &mut DirInfo::DirInfo = unsafe { &mut *dir };
            let mut needs_side_effects = true;
            if let Some(existing_ptr) = result.package_json {
                // SAFETY: ARENA — PackageJSON ptrs are interned in the global allocator-backed cache and outlive the resolver (see LIFETIMES.tsv).
                let existing = unsafe { &*existing_ptr };
                // if we don't have it here, they might put it in a sideEfffects
                // map of the parent package.json
                // TODO: check if webpack also does this parent lookup
                use crate::package_json::SideEffects as PJSideEffects;
                needs_side_effects = matches!(
                    existing.side_effects,
                    PJSideEffects::Unspecified | PJSideEffects::Glob(_) | PJSideEffects::Mixed(_)
                );

                result.primary_side_effects_data = match &existing.side_effects {
                    PJSideEffects::Unspecified => SideEffects::HasSideEffects,
                    PJSideEffects::False => SideEffects::NoSideEffectsPackageJson,
                    PJSideEffects::Map(map) => {
                        if map.contains(&bun_collections::StringHashMapUnowned::Key::init(path.text())) {
                            SideEffects::HasSideEffects
                        } else {
                            SideEffects::NoSideEffectsPackageJson
                        }
                    }
                    PJSideEffects::Glob(_) => {
                        if existing.side_effects.has_side_effects(path.text()) {
                            SideEffects::HasSideEffects
                        } else {
                            SideEffects::NoSideEffectsPackageJson
                        }
                    }
                    PJSideEffects::Mixed(_) => {
                        if existing.side_effects.has_side_effects(path.text()) {
                            SideEffects::HasSideEffects
                        } else {
                            SideEffects::NoSideEffectsPackageJson
                        }
                    }
                };

                if existing.name.is_empty() || self.care_about_bin_folder {
                    result.package_json = None;
                }
            }

            result.package_json = result.package_json.or(dir.enclosing_package_json.map(|p| p as *const _));

            if needs_side_effects {
                if let Some(pkg_ptr) = result.package_json {
                    // SAFETY: ARENA — PackageJSON ptr outlives the resolver (see LIFETIMES.tsv).
                    let package_json = unsafe { &*pkg_ptr };
                    use crate::package_json::SideEffects as PJSideEffects;
                    result.primary_side_effects_data = match &package_json.side_effects {
                        PJSideEffects::Unspecified => SideEffects::HasSideEffects,
                        PJSideEffects::False => SideEffects::NoSideEffectsPackageJson,
                        PJSideEffects::Map(map) => {
                            if map.contains(&bun_collections::StringHashMapUnowned::Key::init(path.text())) {
                                SideEffects::HasSideEffects
                            } else {
                                SideEffects::NoSideEffectsPackageJson
                            }
                        }
                        PJSideEffects::Glob(_) => {
                            if package_json.side_effects.has_side_effects(path.text()) {
                                SideEffects::HasSideEffects
                            } else {
                                SideEffects::NoSideEffectsPackageJson
                            }
                        }
                        PJSideEffects::Mixed(_) => {
                            if package_json.side_effects.has_side_effects(path.text()) {
                                SideEffects::HasSideEffects
                            } else {
                                SideEffects::NoSideEffectsPackageJson
                            }
                        }
                    };
                }
            }

            if let Some(tsconfig) = dir.enclosing_tsconfig_json {
                result.jsx = tsconfig.merge_jsx(result.jsx.clone());
                result.flags.set_emit_decorator_metadata(result.flags.emit_decorator_metadata() || tsconfig.emit_decorator_metadata);
                result.flags.set_experimental_decorators(result.flags.experimental_decorators() || tsconfig.experimental_decorators);
            }

            // If you use mjs or mts, then you're using esm
            // If you use cjs or cts, then you're using cjs
            // This should win out over the module type from package.json
            if !kind.is_from_css() && module_type == options::ModuleType::Unknown && path.name.ext().len() == 4 {
                module_type = MODULE_TYPE_MAP.get(path.name.ext()).copied().unwrap_or(options::ModuleType::Unknown);
            }

            if let Some(entries) = dir.get_entries(self.generation) {
                if let Some(query) = entries.get(path.name.filename()) {
                    let symlink_path = query.entry.symlink(&mut self.fs.fs, self.store_fd);
                    if !symlink_path.is_empty() {
                        path.set_realpath(symlink_path);
                        if !result.file_fd.is_valid() {
                            result.file_fd = query.entry.cache.fd;
                        }

                        if let Some(debug) = self.debug_logs.as_mut() {
                            debug.add_note_fmt(format_args!(
                                "Resolved symlink \"{}\" to \"{}\"",
                                bstr::BStr::new(path.text()),
                                bstr::BStr::new(symlink_path)
                            ));
                        }
                    } else if !dir.abs_real_path.is_empty() {
                        // When the directory is a symlink, we don't need to call getFdPath.
                        let parts = [dir.abs_real_path.as_ref(), query.entry.base()];
                        let mut buf = bun_paths::PathBuffer::uninit();

                        let out = self.fs.abs_buf(&parts, &mut buf);

                        let store_fd = self.store_fd;

                        if !query.entry.cache.fd.is_valid() && store_fd {
                            buf[out.len()] = 0;
                            // SAFETY: buf[out.len()] == 0 written above
                            let span = unsafe { bun_str::ZStr::from_raw(buf.as_ptr(), out.len()) };
                            // TODO(port): std.fs.openFileAbsoluteZ → bun_sys::open
                            let file = bun_sys::open(span, bun_sys::O::RDONLY, 0).unwrap()?;
                            query.entry.cache.fd = file;
                            Fs::FileSystem::set_max_fd(file.native());
                        }

                        let _close_guard = scopeguard::guard((), |_| {
                            if self.fs.fs.need_to_close_files() {
                                if query.entry.cache.fd.is_valid() {
                                    query.entry.cache.fd.close();
                                    query.entry.cache.fd = FD::INVALID;
                                }
                            }
                        });

                        let symlink = Fs::FileSystem::FilenameStore::instance().append_slice(out)?;
                        if let Some(debug) = self.debug_logs.as_mut() {
                            debug.add_note_fmt(format_args!(
                                "Resolved symlink \"{}\" to \"{}\"",
                                bstr::BStr::new(symlink),
                                bstr::BStr::new(path.text())
                            ));
                        }
                        query.entry.cache.symlink = PathString::init(symlink);
                        if !result.file_fd.is_valid() && store_fd {
                            result.file_fd = query.entry.cache.fd;
                        }

                        path.set_realpath(symlink);
                    }
                }
            }
        }

        if !kind.is_from_css() && module_type == options::ModuleType::Unknown {
            if let Some(pkg) = result.package_json {
                // SAFETY: ARENA — PackageJSON ptr outlives the resolver (see LIFETIMES.tsv).
                module_type = unsafe { &*pkg }.module_type;
            }
        }

        result.module_type = module_type;
        Ok(())
    }

    pub fn resolve_without_symlinks(
        &mut self,
        source_dir: &[u8],
        input_import_path: &[u8],
        kind: ast::ImportKind,
        global_cache: GlobalCache,
    ) -> ResultUnion {
        debug_assert!(bun_paths::is_absolute(source_dir));

        let mut import_path = input_import_path;

        // This implements the module resolution algorithm from node.js, which is
        // described here: https://nodejs.org/api/modules.html#modules_all_together
        let mut result = Result {
            path_pair: PathPair { primary: Path::empty(), secondary: None },
            jsx: self.opts.jsx.clone(),
            ..Default::default()
        };

        // Return early if this is already an absolute path. In addition to asking
        // the file system whether this is an absolute path, we also explicitly check
        // whether it starts with a "/" and consider that an absolute path too. This
        // is because relative paths can technically start with a "/" on Windows
        // because it's not an absolute path on Windows. Then people might write code
        // with imports that start with a "/" that works fine on Windows only to
        // experience unexpected build failures later on other operating systems.
        // Treating these paths as absolute paths on all platforms means Windows
        // users will not be able to accidentally make use of these paths.
        if bun_paths::is_absolute(import_path) {
            // Collapse relative directory specifiers if they exist. Extremely
            // loose check to avoid always doing this copy, but avoid spending
            // too much time on the check.
            if strings::index_of(import_path, b"..").is_some() {
                let platform = bun_paths::Platform::Auto;
                let ends_with_dir = platform.is_separator(import_path[import_path.len() - 1])
                    || (import_path.len() > 3
                        && platform.is_separator(import_path[import_path.len() - 3])
                        && import_path[import_path.len() - 2] == b'.'
                        && import_path[import_path.len() - 1] == b'.');
                let buf = bufs!(relative_abs_path);
                let Some(abs) = self.fs.abs_buf_checked(&[import_path], buf) else {
                    return ResultUnion::NotFound;
                };
                let mut len = abs.len();
                if ends_with_dir {
                    buf[len] = platform.separator();
                    len += 1;
                }
                // SAFETY: buf is threadlocal and outlives this function call
                import_path = unsafe { core::slice::from_raw_parts(buf.as_ptr(), len) };
            }

            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "The import \"{}\" is being treated as an absolute path",
                    bstr::BStr::new(import_path)
                ));
            }

            // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file
            if let Ok(Some(dir_info_ptr)) = self.dir_info_cached(source_dir) {
                // SAFETY: ARENA — DirInfo ptr is a BSSMap slot and outlives the resolver (see LIFETIMES.tsv).
                let dir_info: &DirInfo::DirInfo = unsafe { &*dir_info_ptr };
                if let Some(tsconfig) = dir_info.enclosing_tsconfig_json {
                    if tsconfig.paths.count() > 0 {
                        if let Some(res) = self.match_tsconfig_paths(tsconfig, import_path, kind) {
                            // We don't set the directory fd here because it might remap an entirely different directory
                            return ResultUnion::Success(Result {
                                path_pair: res.path_pair,
                                diff_case: res.diff_case,
                                package_json: res.package_json,
                                dirname_fd: res.dirname_fd,
                                file_fd: res.file_fd,
                                jsx: tsconfig.merge_jsx(result.jsx),
                                ..Default::default()
                            });
                        }
                    }
                }
            }

            if self.opts.external.abs_paths.count() > 0 && self.opts.external.abs_paths.contains(import_path) {
                // If the string literal in the source text is an absolute path and has
                // been marked as an external module, mark it as *not* an absolute path.
                // That way we preserve the literal text in the output and don't generate
                // a relative path from the output directory to that path.
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!(
                        "The path \"{}\" is marked as external by the user",
                        bstr::BStr::new(import_path)
                    ));
                }

                return ResultUnion::Success(Result {
                    path_pair: PathPair { primary: Path::init(import_path), secondary: None },
                    flags: ResultFlags::IS_EXTERNAL,
                    ..Default::default()
                });
            }

            // Run node's resolution rules (e.g. adding ".js")
            let mut normalizer = ResolvePath::PosixToWinNormalizer::default();
            if let Some(entry) = self.load_as_file_or_directory(normalizer.resolve(source_dir, import_path), kind) {
                return ResultUnion::Success(Result {
                    dirname_fd: entry.dirname_fd,
                    path_pair: entry.path_pair,
                    diff_case: entry.diff_case,
                    package_json: entry.package_json,
                    file_fd: entry.file_fd,
                    jsx: self.opts.jsx.clone(),
                    ..Default::default()
                });
            }

            return ResultUnion::NotFound;
        }

        // Check both relative and package paths for CSS URL tokens, with relative
        // paths taking precedence over package paths to match Webpack behavior.
        let is_package_path_ = kind != ast::ImportKind::EntryPointRun && is_package_path_not_absolute(import_path);
        let check_relative = !is_package_path_ || kind.is_from_css();
        let check_package = is_package_path_;

        if check_relative {
            if let Some(custom_paths) = self.custom_dir_paths {
                // @branchHint(.unlikely)
                #[cold] fn cold() {}
                cold();
                for custom_path in custom_paths {
                    let custom_utf8 = custom_path.to_utf8_without_ref();
                    match self.check_relative_path(custom_utf8.slice(), import_path, kind, global_cache) {
                        ResultUnion::Success(res) => return ResultUnion::Success(res),
                        ResultUnion::Pending(p) => return ResultUnion::Pending(p),
                        ResultUnion::Failure(p) => return ResultUnion::Failure(p),
                        ResultUnion::NotFound => {}
                    }
                }
                debug_assert!(!check_package); // always from JavaScript
                return ResultUnion::NotFound; // bail out now since there isn't anywhere else to check
            } else {
                match self.check_relative_path(source_dir, import_path, kind, global_cache) {
                    ResultUnion::Success(res) => return ResultUnion::Success(res),
                    ResultUnion::Pending(p) => return ResultUnion::Pending(p),
                    ResultUnion::Failure(p) => return ResultUnion::Failure(p),
                    ResultUnion::NotFound => {}
                }
            }
        }

        if check_package {
            if self.opts.polyfill_node_globals {
                let had_node_prefix = import_path.starts_with(b"node:");
                let import_path_without_node_prefix = if had_node_prefix { &import_path[b"node:".len()..] } else { import_path };

                if let Some(fallback_module) = NodeFallbackModules::MAP.get(import_path_without_node_prefix) {
                    result.path_pair.primary = fallback_module.path.clone();
                    result.module_type = options::ModuleType::Cjs;
                    // @ptrFromInt(@intFromPtr(...)) — cast away constness
                    result.package_json = Some(fallback_module.package_json as *const PackageJSON);
                    result.flags.set_is_from_node_modules(true);
                    return ResultUnion::Success(result);
                }

                if had_node_prefix {
                    // Module resolution fails automatically for unknown node builtins
                    if !bun_jsc::module_loader::HardcodedModule::Alias::has(
                        import_path_without_node_prefix,
                        options::Target::Node,
                        Default::default(),
                    ) {
                        return ResultUnion::NotFound;
                    }

                    // Valid node:* modules becomes {} in the output
                    result.path_pair.primary.namespace = b"node";
                    result.path_pair.primary.text = import_path_without_node_prefix;
                    result.path_pair.primary.name = Fs::PathName::init(import_path_without_node_prefix);
                    result.module_type = options::ModuleType::Cjs;
                    result.path_pair.primary.is_disabled = true;
                    result.flags.set_is_from_node_modules(true);
                    result.primary_side_effects_data = SideEffects::NoSideEffectsPureData;
                    return ResultUnion::Success(result);
                }

                // Always mark "fs" as disabled, matching Webpack v4 behavior
                if import_path_without_node_prefix.starts_with(b"fs")
                    && (import_path_without_node_prefix.len() == 2
                        || import_path_without_node_prefix[2] == b'/')
                {
                    result.path_pair.primary.namespace = b"node";
                    result.path_pair.primary.text = import_path_without_node_prefix;
                    result.path_pair.primary.name = Fs::PathName::init(import_path_without_node_prefix);
                    result.module_type = options::ModuleType::Cjs;
                    result.path_pair.primary.is_disabled = true;
                    result.flags.set_is_from_node_modules(true);
                    result.primary_side_effects_data = SideEffects::NoSideEffectsPureData;
                    return ResultUnion::Success(result);
                }
            }

            // Check for external packages first
            if self.opts.external.node_modules.count() > 0
                // Imports like "process/" need to resolve to the filesystem, not a builtin
                && !import_path.ends_with(b"/")
            {
                let mut query = import_path;
                loop {
                    if self.opts.external.node_modules.contains(query) {
                        if let Some(debug) = self.debug_logs.as_mut() {
                            debug.add_note_fmt(format_args!(
                                "The path \"{}\" was marked as external by the user",
                                bstr::BStr::new(query)
                            ));
                        }
                        return ResultUnion::Success(Result {
                            path_pair: PathPair { primary: Path::init(query), secondary: None },
                            flags: ResultFlags::IS_EXTERNAL,
                            ..Default::default()
                        });
                    }

                    // If the module "foo" has been marked as external, we also want to treat
                    // paths into that module such as "foo/bar" as external too.
                    let Some(slash) = strings::last_index_of_char(query, b'/') else { break };
                    query = &query[0..slash];
                }
            }

            if let Some(custom_paths) = self.custom_dir_paths {
                #[cold] fn cold() {}
                cold();
                for custom_path in custom_paths {
                    let custom_utf8 = custom_path.to_utf8_without_ref();
                    match self.check_package_path(custom_utf8.slice(), import_path, kind, global_cache) {
                        ResultUnion::Success(res) => return ResultUnion::Success(res),
                        ResultUnion::Pending(p) => return ResultUnion::Pending(p),
                        ResultUnion::Failure(p) => return ResultUnion::Failure(p),
                        ResultUnion::NotFound => {}
                    }
                }
            } else {
                match self.check_package_path(source_dir, import_path, kind, global_cache) {
                    ResultUnion::Success(res) => return ResultUnion::Success(res),
                    ResultUnion::Pending(p) => return ResultUnion::Pending(p),
                    ResultUnion::Failure(p) => return ResultUnion::Failure(p),
                    ResultUnion::NotFound => {}
                }
            }
        }

        ResultUnion::NotFound
    }

    pub fn check_relative_path(
        &mut self,
        source_dir: &[u8],
        import_path: &[u8],
        kind: ast::ImportKind,
        global_cache: GlobalCache,
    ) -> ResultUnion {
        let Some(abs_path) = self.fs.abs_buf_checked(&[source_dir, import_path], bufs!(relative_abs_path)) else {
            return ResultUnion::NotFound;
        };

        if self.opts.external.abs_paths.count() > 0 && self.opts.external.abs_paths.contains(abs_path) {
            // If the string literal in the source text is an absolute path and has
            // been marked as an external module, mark it as *not* an absolute path.
            // That way we preserve the literal text in the output and don't generate
            // a relative path from the output directory to that path.
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "The path \"{}\" is marked as external by the user",
                    bstr::BStr::new(abs_path)
                ));
            }

            return ResultUnion::Success(Result {
                path_pair: PathPair { primary: Path::init(self.fs.dirname_store.append_slice(abs_path).expect("oom")), secondary: None },
                flags: ResultFlags::IS_EXTERNAL,
                ..Default::default()
            });
        }

        // Check the "browser" map
        if self.care_about_browser_field {
            let dirname = bun_paths::dirname(abs_path).expect("unreachable");
            if let Ok(Some(import_dir_info_ptr)) = self.dir_info_cached(dirname) {
                // SAFETY: ARENA — DirInfo ptr is a BSSMap slot and outlives the resolver (see LIFETIMES.tsv).
                let import_dir_info_outer = unsafe { &*import_dir_info_ptr };
                if let Some(import_dir_info) = import_dir_info_outer.get_enclosing_browser_scope() {
                    let pkg = import_dir_info.package_json.unwrap();
                    if let Some(remap) = self.check_browser_map::<{ BrowserMapPathKind::AbsolutePath }>(import_dir_info, abs_path) {
                        // Is the path disabled?
                        if remap.is_empty() {
                            let mut _path = Path::init(self.fs.dirname_store.append_slice(abs_path).expect("unreachable"));
                            _path.is_disabled = true;
                            return ResultUnion::Success(Result {
                                path_pair: PathPair { primary: _path, secondary: None },
                                ..Default::default()
                            });
                        }

                        match self.resolve_without_remapping(import_dir_info, remap, kind, global_cache) {
                            MatchResultUnion::Success(match_result) => {
                                let mut flags = ResultFlags::default();
                                flags.set_is_external(match_result.is_external);
                                flags.set_is_external_and_rewrite_import_path(match_result.is_external);
                                return ResultUnion::Success(Result {
                                    path_pair: match_result.path_pair,
                                    diff_case: match_result.diff_case,
                                    dirname_fd: match_result.dirname_fd,
                                    package_json: Some(pkg as *const _),
                                    jsx: self.opts.jsx.clone(),
                                    module_type: match_result.module_type,
                                    flags,
                                    ..Default::default()
                                });
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        let prev_extension_order = self.extension_order;
        // PORT NOTE: defer restore reshaped — restored before each return
        if strings::path_contains_node_modules_folder(abs_path) {
            self.extension_order = self.opts.extension_order.kind(kind, true);
        }
        let ret = if let Some(res) = self.load_as_file_or_directory(abs_path, kind) {
            ResultUnion::Success(Result {
                path_pair: res.path_pair,
                diff_case: res.diff_case,
                dirname_fd: res.dirname_fd,
                package_json: res.package_json,
                jsx: self.opts.jsx.clone(),
                ..Default::default()
            })
        } else {
            ResultUnion::NotFound
        };
        self.extension_order = prev_extension_order;
        ret
    }

    pub fn check_package_path(
        &mut self,
        source_dir: &[u8],
        unremapped_import_path: &[u8],
        kind: ast::ImportKind,
        global_cache: GlobalCache,
    ) -> ResultUnion {
        let mut import_path = unremapped_import_path;
        let mut source_dir_info: *mut DirInfo::DirInfo = match self.dir_info_cached(source_dir) {
            Err(_) => return ResultUnion::NotFound,
            Ok(Some(d)) => d,
            Ok(None) => 'dir: {
                // It is possible to resolve with a source file that does not exist:
                // A. Bundler plugin refers to a non-existing `resolveDir`.
                // B. `createRequire()` is called with a path that does not exist. This was
                //    hit in Nuxt, specifically the `vite-node` dependency [1].
                //
                // Normally it would make sense to always bail here, but in the case of
                // resolving "hello" from "/project/nonexistent_dir/index.ts", resolution
                // should still query "/project/node_modules" and "/node_modules"
                //
                // For case B in Node.js, they use `_resolveLookupPaths` in
                // combination with `_nodeModulePaths` to collect a listing of
                // all possible parent `node_modules` [2]. Bun has a much smarter
                // approach that caches directory entries, but it (correctly) does
                // not cache non-existing directories. To successfully resolve this,
                // Bun finds the nearest existing directory, and uses that as the base
                // for `node_modules` resolution. Since that directory entry knows how
                // to resolve concrete node_modules, this iteration stops at the first
                // existing directory, regardless of what it is.
                //
                // The resulting `source_dir_info` cannot resolve relative files.
                //
                // [1]: https://github.com/oven-sh/bun/issues/16705
                // [2]: https://github.com/nodejs/node/blob/e346323109b49fa6b9a4705f4e3816fc3a30c151/lib/internal/modules/cjs/loader.js#L1934
                if cfg!(debug_assertions) {
                    debug_assert!(is_package_path(import_path));
                }
                let mut closest_dir = source_dir;
                // Use std.fs.path.dirname to get `null` once the entire
                // directory tree has been visited. `null` is theoretically
                // impossible since the drive root should always exist.
                while let Some(current) = bun_paths::dirname(closest_dir) {
                    match self.dir_info_cached(current) {
                        Err(_) => return ResultUnion::NotFound,
                        Ok(Some(dir)) => break 'dir dir,
                        Ok(None) => {}
                    }
                    closest_dir = current;
                }
                return ResultUnion::NotFound;
            }
        };

        if self.care_about_browser_field {
            // Support remapping one package path to another via the "browser" field
            // SAFETY: ARENA — `source_dir_info` is a BSSMap-backed DirInfo slot that outlives the resolver (see LIFETIMES.tsv).
            if let Some(browser_scope) = unsafe { &*source_dir_info }.get_enclosing_browser_scope() {
                if let Some(package_json) = browser_scope.package_json {
                    if let Some(remapped) = self.check_browser_map::<{ BrowserMapPathKind::PackagePath }>(browser_scope, import_path) {
                        if remapped.is_empty() {
                            // "browser": {"module": false}
                            // does the module exist in the filesystem?
                            // SAFETY: ARENA — DirInfo ptr is a BSSMap slot; uniquely re-borrowed mutably here (see LIFETIMES.tsv).
                            match self.load_node_modules(import_path, kind, unsafe { &mut *source_dir_info }, global_cache, false) {
                                MatchResultUnion::Success(node_module) => {
                                    let mut pair = node_module.path_pair;
                                    pair.primary.is_disabled = true;
                                    if let Some(sec) = pair.secondary.as_mut() {
                                        sec.is_disabled = true;
                                    }
                                    return ResultUnion::Success(Result {
                                        path_pair: pair,
                                        dirname_fd: node_module.dirname_fd,
                                        diff_case: node_module.diff_case,
                                        package_json: Some(package_json as *const _),
                                        jsx: self.opts.jsx.clone(),
                                        ..Default::default()
                                    });
                                }
                                _ => {
                                    // "browser": {"module": false}
                                    // the module doesn't exist and it's disabled
                                    // so we should just not try to load it
                                    let mut primary = Path::init(import_path);
                                    primary.is_disabled = true;
                                    return ResultUnion::Success(Result {
                                        path_pair: PathPair { primary, secondary: None },
                                        diff_case: None,
                                        jsx: self.opts.jsx.clone(),
                                        ..Default::default()
                                    });
                                }
                            }
                        }

                        import_path = remapped;
                        source_dir_info = browser_scope as *const _ as *mut _;
                    }
                }
            }
        }

        // SAFETY: ARENA — DirInfo ptr is a BSSMap slot; uniquely re-borrowed mutably (see LIFETIMES.tsv).
        match self.resolve_without_remapping(unsafe { &mut *source_dir_info }, import_path, kind, global_cache) {
            MatchResultUnion::Success(res) => {
                let mut result = Result {
                    path_pair: PathPair { primary: Path::empty(), secondary: None },
                    jsx: self.opts.jsx.clone(),
                    ..Default::default()
                };
                result.path_pair = res.path_pair;
                result.dirname_fd = res.dirname_fd;
                result.file_fd = res.file_fd;
                result.package_json = res.package_json;
                result.diff_case = res.diff_case;
                result.flags.set_is_from_node_modules(result.flags.is_from_node_modules() || res.is_node_module);
                result.jsx = self.opts.jsx.clone();
                result.module_type = res.module_type;
                result.flags.set_is_external(res.is_external);
                // Potentially rewrite the import path if it's external that
                // was remapped to a different path
                result.flags.set_is_external_and_rewrite_import_path(result.flags.is_external());

                if result.path_pair.primary.is_disabled && result.path_pair.secondary.is_none() {
                    return ResultUnion::Success(result);
                }

                if res.package_json.is_some() && self.care_about_browser_field {
                    let base_dir_info = match res.dir_info {
                        Some(d) => d as *mut DirInfo::DirInfo,
                        None => match self.read_dir_info(result.path_pair.primary.name.dir()) {
                            Ok(Some(d)) => d,
                            _ => return ResultUnion::Success(result),
                        },
                    };
                    // SAFETY: ARENA — DirInfo ptr is a BSSMap slot and outlives the resolver (see LIFETIMES.tsv).
                    if let Some(browser_scope) = unsafe { &*base_dir_info }.get_enclosing_browser_scope() {
                        if let Some(remap) = self.check_browser_map::<{ BrowserMapPathKind::AbsolutePath }>(browser_scope, result.path_pair.primary.text()) {
                            if remap.is_empty() {
                                result.path_pair.primary.is_disabled = true;
                                result.path_pair.primary = Fs::Path::init_with_namespace(remap, b"file");
                            } else {
                                match self.resolve_without_remapping(browser_scope, remap, kind, global_cache) {
                                    MatchResultUnion::Success(remapped) => {
                                        result.path_pair = remapped.path_pair;
                                        result.dirname_fd = remapped.dirname_fd;
                                        result.file_fd = remapped.file_fd;
                                        result.package_json = remapped.package_json;
                                        result.diff_case = remapped.diff_case;
                                        result.module_type = remapped.module_type;
                                        result.flags.set_is_external(remapped.is_external);

                                        // Potentially rewrite the import path if it's external that
                                        // was remapped to a different path
                                        result.flags.set_is_external_and_rewrite_import_path(result.flags.is_external());

                                        result.flags.set_is_from_node_modules(result.flags.is_from_node_modules() || remapped.is_node_module);
                                        return ResultUnion::Success(result);
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }

                ResultUnion::Success(result)
            }
            MatchResultUnion::Pending(p) => ResultUnion::Pending(p),
            MatchResultUnion::Failure(p) => ResultUnion::Failure(p),
            _ => ResultUnion::NotFound,
        }
    }

    // This is a fallback, hopefully not called often. It should be relatively quick because everything should be in the cache.
    pub fn package_json_for_resolved_node_module(
        &mut self,
        result: &Result,
    ) -> Option<*const PackageJSON> {
        let mut dir_info = self.dir_info_cached(result.path_pair.primary.name.dir()).ok().flatten()?;
        loop {
            // SAFETY: ARENA — DirInfo ptr is a BSSMap slot and outlives the resolver (see LIFETIMES.tsv).
            let di = unsafe { &*dir_info };
            if let Some(pkg) = di.package_json {
                // if it doesn't have a name, assume it's something just for adjusting the main fields (react-bootstrap does this)
                // In that case, we really would like the top-level package that you download from NPM
                // so we ignore any unnamed packages
                return Some(pkg as *const _);
            }

            dir_info = di.get_parent()?;
        }
    }

    pub fn root_node_module_package_json(
        &mut self,
        result: &Result,
    ) -> Option<RootPathPair> {
        let path = result.path_const()?;
        let mut absolute = path.text();
        // /foo/node_modules/@babel/standalone/index.js
        //     ^------------^
        let mut end = strings::last_index_of(absolute, NODE_MODULE_ROOT_STRING).or_else(|| {
            // try non-symlinked version
            if path.pretty().len() != absolute.len() {
                absolute = path.pretty();
                return strings::last_index_of(absolute, NODE_MODULE_ROOT_STRING);
            }
            None
        })?;
        end += NODE_MODULE_ROOT_STRING.len();

        let is_scoped_package = absolute[end] == b'@';
        end += strings::index_of_char(&absolute[end..], SEP)? as usize;

        // /foo/node_modules/@babel/standalone/index.js
        //                   ^
        if is_scoped_package {
            end += 1;
            end += strings::index_of_char(&absolute[end..], SEP)? as usize;
        }

        end += 1;

        // /foo/node_modules/@babel/standalone/index.js
        //                                    ^
        let slice = &absolute[0..end];

        // Try to avoid the hash table lookup whenever possible
        // That can cause filesystem lookups in parent directories and it requires a lock
        if let Some(pkg_ptr) = result.package_json {
            // SAFETY: ARENA — PackageJSON ptr outlives the resolver (see LIFETIMES.tsv).
            let pkg = unsafe { &*pkg_ptr };
            if slice == pkg.source.path.name.dir_with_trailing_slash() {
                return Some(RootPathPair {
                    package_json: pkg_ptr,
                    base_path: slice,
                });
            }
        }

        {
            let dir_info = self.dir_info_cached(slice).ok().flatten()?;
            // SAFETY: ARENA — DirInfo ptr is a BSSMap slot and outlives the resolver (see LIFETIMES.tsv).
            let di = unsafe { &*dir_info };
            Some(RootPathPair {
                base_path: slice,
                package_json: di.package_json? as *const _,
            })
        }
    }

    /// Directory cache keys must follow the following rules. If the rules are broken,
    /// then there will be conflicting cache entries, and trying to bust the cache may not work.
    ///
    /// When an incorrect cache key is used, this assertion will trip; ignoring it allows
    /// very very subtle cache invalidation issues to happen, which will cause modules to
    /// mysteriously fail to resolve.
    ///
    /// The rules for this changed in https://github.com/oven-sh/bun/pull/9144 after multiple
    /// cache issues were found on Windows. These issues extended to other platforms because
    /// we never checked if the cache key was following the rules.
    ///
    /// CACHE KEY RULES:
    /// A cache key must use native slashes, and must NOT end with a trailing slash.
    /// But drive roots MUST have a trailing slash ('/' and 'C:\')
    /// UNC paths, even if the root, must not have the trailing slash.
    ///
    /// The helper function bun.strings.withoutTrailingSlashWindowsPath can be used
    /// to remove the trailing slash from a path
    pub fn assert_valid_cache_key(path: &[u8]) {
        if cfg!(debug_assertions) {
            if path.len() > 1
                && strings::char_is_any_slash(path[path.len() - 1])
                && !if cfg!(windows) {
                    path.len() == 3 && path[1] == b':'
                } else {
                    path.len() == 1
                }
            {
                panic!(
                    "Internal Assertion Failure: Invalid cache key \"{}\"\nSee Resolver.assertValidCacheKey for details.",
                    bstr::BStr::new(path)
                );
            }
        }
    }

    /// Bust the directory cache for the given path.
    /// See `assertValidCacheKey` for requirements on the input
    pub fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
        Self::assert_valid_cache_key(path);
        let first_bust = self.fs.fs.bust_entries_cache(path);
        let second_bust = self.dir_cache.remove(path);
        bun_output::scoped_log!(Resolver, "Bust {} = {}, {}", bstr::BStr::new(path), first_bust, second_bust);
        first_bust || second_bust
    }

    /// bust both the named file and a parent directory, because `./hello` can resolve
    /// to `./hello.js` or `./hello/index.js`
    pub fn bust_dir_cache_from_specifier(&mut self, import_source_file: &[u8], specifier: &[u8]) -> bool {
        if bun_paths::is_absolute(specifier) {
            let dir = bun_paths::dirname_platform(specifier, bun_paths::Platform::Auto);
            let a = self.bust_dir_cache(dir);
            let b = self.bust_dir_cache(specifier);
            return a || b;
        }

        if !(specifier.starts_with(b"./") || specifier.starts_with(b"../")) {
            return false;
        }
        if !bun_paths::is_absolute(import_source_file) {
            return false;
        }

        let joined = bun_paths::join_abs(
            bun_paths::dirname_platform(import_source_file, bun_paths::Platform::Auto),
            bun_paths::Platform::Auto,
            specifier,
        );
        let dir = bun_paths::dirname_platform(joined, bun_paths::Platform::Auto);

        let a = self.bust_dir_cache(dir);
        let b = self.bust_dir_cache(joined);
        a || b
    }

    pub fn load_node_modules(
        &mut self,
        import_path: &[u8],
        kind: ast::ImportKind,
        _dir_info: &mut DirInfo::DirInfo,
        global_cache: GlobalCache,
        forbid_imports: bool,
    ) -> MatchResultUnion {
        // SAFETY: (function-wide) every `unsafe { &*dir_info }` / `&*_dir_info_package_json` /
        // `&*pkg_dir_info_ptr` deref below targets an ARENA-backed DirInfo/PackageJSON slot in
        // the BSSMap singleton (`dir_cache`/`DirnameStore`), which outlives the resolver
        // (see LIFETIMES.tsv). Raw ptrs are used only to sidestep borrowck across `&mut self` calls.
        let mut dir_info: *mut DirInfo::DirInfo = _dir_info;
        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!(
                "Searching for {} in \"node_modules\" directories starting from \"{}\"",
                bstr::BStr::new(import_path),
                // SAFETY: see function-wide note above.
                bstr::BStr::new(unsafe { &*dir_info }.abs_path)
            ));
            debug.increase_indent();
        }

        let _decrease = scopeguard::guard((), |_| {
            // TODO(port): defer { debug.decreaseIndent() } — borrowck reshape; done at returns
        });

        // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file

        // SAFETY: see function-wide note above.
        if let Some(tsconfig) = unsafe { &*dir_info }.enclosing_tsconfig_json {
            // Try path substitutions first
            if tsconfig.paths.count() > 0 {
                if let Some(res) = self.match_tsconfig_paths(tsconfig, import_path, kind) {
                    if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                    return MatchResultUnion::Success(res);
                }
            }

            // Try looking up the path relative to the base URL
            if tsconfig.has_base_url() {
                let base = tsconfig.base_url;
                if let Some(abs) = self.fs.abs_buf_checked(&[base, import_path], bufs!(load_as_file_or_directory_via_tsconfig_base_path)) {
                    if let Some(res) = self.load_as_file_or_directory(abs, kind) {
                        if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                        return MatchResultUnion::Success(res);
                    }
                }
            }
        }

        let mut is_self_reference = false;

        // Find the parent directory with the "package.json" file
        let mut dir_info_package_json: Option<*mut DirInfo::DirInfo> = Some(dir_info);
        while let Some(d) = dir_info_package_json {
            // SAFETY: see function-wide note above.
            if unsafe { &*d }.package_json.is_some() {
                break;
            }
            // SAFETY: see function-wide note above.
            dir_info_package_json = unsafe { &*d }.get_parent();
        }

        // Check for subpath imports: https://nodejs.org/api/packages.html#subpath-imports
        if let Some(_dir_info_package_json) = dir_info_package_json {
            // SAFETY: see function-wide note above.
            let package_json = unsafe { &*_dir_info_package_json }.package_json.unwrap();

            if import_path.starts_with(b"#") && !forbid_imports && package_json.imports.is_some() {
                // SAFETY: see function-wide note above.
                let r = self.load_package_imports(import_path, unsafe { &mut *_dir_info_package_json }, kind, global_cache);
                if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                return r;
            }

            // https://nodejs.org/api/packages.html#packages_self_referencing_a_package_using_its_name
            let package_name = ESModule::Package::parse_name(import_path);
            if let Some(_package_name) = package_name {
                if _package_name == package_json.name.as_ref() && package_json.exports.is_some() {
                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note_fmt(format_args!("\"{}\" is a self-reference", bstr::BStr::new(import_path)));
                    }
                    dir_info = _dir_info_package_json;
                    is_self_reference = true;
                }
            }
        }

        let esm_ = ESModule::Package::parse(import_path, bufs!(esm_subpath));

        let source_dir_info = dir_info;
        let mut any_node_modules_folder = false;
        let use_node_module_resolver = global_cache != GlobalCache::Force;

        // Then check for the package in any enclosing "node_modules" directories
        // or in the package root directory if it's a self-reference
        while use_node_module_resolver {
            // Skip directories that are themselves called "node_modules", since we
            // don't ever want to search for "node_modules/node_modules"
            'node_modules: {
                // SAFETY: see function-wide note above.
                if !(unsafe { &*dir_info }.has_node_modules() || is_self_reference) {
                    break 'node_modules;
                }
                any_node_modules_folder = true;
                let abs_path: &[u8] = if is_self_reference {
                    // SAFETY: see function-wide note above.
                    unsafe { &*dir_info }.abs_path
                } else {
                    match self.fs.abs_buf_checked(
                        // SAFETY: see function-wide note above.
                        &[unsafe { &*dir_info }.abs_path, b"node_modules", import_path],
                        bufs!(node_modules_check),
                    ) {
                        Some(p) => p,
                        None => break 'node_modules,
                    }
                };
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!(
                        "Checking for a package in the directory \"{}\"",
                        bstr::BStr::new(abs_path)
                    ));
                }

                let prev_extension_order = self.extension_order;
                // PORT NOTE: defer restore reshaped — restored at end of block

                if let Some(ref esm) = esm_ {
                    let abs_package_path: &[u8] = if is_self_reference {
                        // SAFETY: see function-wide note above.
                        unsafe { &*dir_info }.abs_path
                    } else {
                        // SAFETY: see function-wide note above.
                        let parts = [unsafe { &*dir_info }.abs_path, b"node_modules".as_slice(), esm.name];
                        self.fs.abs_buf(&parts, bufs!(esm_absolute_package_path))
                    };

                    if let Ok(Some(pkg_dir_info_ptr)) = self.dir_info_cached(abs_package_path) {
                        // SAFETY: see function-wide note above.
                        let pkg_dir_info = unsafe { &*pkg_dir_info_ptr };
                        self.extension_order = match kind {
                            ast::ImportKind::Url | ast::ImportKind::AtConditional | ast::ImportKind::At => {
                                options::bundle_options::defaults::CSS_EXTENSION_ORDER
                            }
                            _ => self.opts.extension_order.kind(kind, true),
                        };

                        if let Some(package_json) = pkg_dir_info.package_json {
                            if let Some(exports_map) = package_json.exports.as_ref() {
                                // The condition set is determined by the kind of import
                                let mut module_type = package_json.module_type;
                                let esmodule = ESModule {
                                    conditions: match kind {
                                        ast::ImportKind::Require | ast::ImportKind::RequireResolve => self.opts.conditions.require.clone(),
                                        ast::ImportKind::At | ast::ImportKind::AtConditional => self.opts.conditions.style.clone(),
                                        _ => self.opts.conditions.import.clone(),
                                    },
                                    // allocator dropped
                                    debug_logs: self.debug_logs.as_mut().map(|d| d as *mut _),
                                    module_type: &mut module_type,
                                };

                                // Resolve against the path "/", then join it with the absolute
                                // directory path. This is done because ESM package resolution uses
                                // URLs while our path resolution uses file system paths. We don't
                                // want problems due to Windows paths, which are very unlike URL
                                // paths. We also want to avoid any "%" characters in the absolute
                                // directory path accidentally being interpreted as URL escapes.
                                {
                                    let esm_resolution = esmodule.resolve(b"/", esm.subpath, &exports_map.root);

                                    if let Some(result) = self.handle_esm_resolution(esm_resolution, abs_package_path, kind, package_json, esm.subpath) {
                                        let mut result_copy = result;
                                        result_copy.is_node_module = true;
                                        result_copy.module_type = module_type;
                                        self.extension_order = prev_extension_order;
                                        if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                        return MatchResultUnion::Success(result_copy);
                                    }
                                }

                                // Some popular packages forget to include the extension in their
                                // exports map, so we try again without the extension.
                                //
                                // This is useful for browser-like environments
                                // where you want a file extension in the URL
                                // pathname by convention. Vite does this.
                                //
                                // React is an example of a package that doesn't include file extensions.
                                // {
                                //     "exports": {
                                //         ".": "./index.js",
                                //         "./jsx-runtime": "./jsx-runtime.js",
                                //     }
                                // }
                                //
                                // We limit this behavior just to ".js" files.
                                let extname = bun_paths::extension(esm.subpath);
                                if extname == b".js" && esm.subpath.len() > 3 {
                                    let esm_resolution = esmodule.resolve(b"/", &esm.subpath[0..esm.subpath.len() - 3], &exports_map.root);
                                    if let Some(result) = self.handle_esm_resolution(esm_resolution, abs_package_path, kind, package_json, esm.subpath) {
                                        let mut result_copy = result;
                                        result_copy.is_node_module = true;
                                        result_copy.module_type = module_type;
                                        self.extension_order = prev_extension_order;
                                        if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                        return MatchResultUnion::Success(result_copy);
                                    }
                                }

                                // if they hid "package.json" from "exports", still allow importing it.
                                if esm.subpath == b"./package.json" {
                                    self.extension_order = prev_extension_order;
                                    if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                    return MatchResultUnion::Success(MatchResult {
                                        path_pair: PathPair { primary: package_json.source.path.clone(), secondary: None },
                                        dirname_fd: pkg_dir_info.get_file_descriptor(),
                                        file_fd: FD::INVALID,
                                        is_node_module: package_json.source.path.is_node_module(),
                                        package_json: Some(package_json as *const _),
                                        dir_info: Some(dir_info as *const _),
                                        ..Default::default()
                                    });
                                }

                                self.extension_order = prev_extension_order;
                                if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                return MatchResultUnion::NotFound;
                            }
                        }
                    }
                }

                if let Some(res) = self.load_as_file_or_directory(abs_path, kind) {
                    self.extension_order = prev_extension_order;
                    if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                    return MatchResultUnion::Success(res);
                }
                self.extension_order = prev_extension_order;
            }

            // SAFETY: see function-wide note above.
            match unsafe { &*dir_info }.get_parent() {
                Some(p) => dir_info = p,
                None => break,
            }
        }

        // try resolve from `NODE_PATH`
        // https://nodejs.org/api/modules.html#loading-from-the-global-folders
        let node_path: &[u8] = if let Some(env_loader) = self.env_loader {
            env_loader.get(b"NODE_PATH").unwrap_or(b"")
        } else {
            b""
        };
        if !node_path.is_empty() {
            let delim = if cfg!(windows) { b';' } else { b':' };
            for path in node_path.split(|&b| b == delim).filter(|s| !s.is_empty()) {
                let Some(abs_path) = self.fs.abs_buf_checked(&[path, import_path], bufs!(node_modules_check)) else {
                    continue;
                };
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!(
                        "Checking for a package in the NODE_PATH directory \"{}\"",
                        bstr::BStr::new(abs_path)
                    ));
                }
                if let Some(res) = self.load_as_file_or_directory(abs_path, kind) {
                    if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                    return MatchResultUnion::Success(res);
                }
            }
        }

        dir_info = source_dir_info;

        // this is the magic!
        if global_cache.can_use(any_node_modules_folder)
            && self.use_package_manager()
            && esm_.is_some()
            && strings::is_npm_package_name(esm_.as_ref().unwrap().name)
        {
            let esm = esm_.as_ref().unwrap().with_auto_version();
            'load_module_from_cache: {
                // TODO(port): the global-cache auto-install path below is large and
                // tightly coupled to PackageManager internals. The control flow is
                // ported but several PackageManager method signatures are guesses.
                // If the source directory doesn't have a node_modules directory, we can
                // check the global cache directory for a package.json file.
                let manager = self.get_package_manager();
                let mut dependency_version = Dependency::Version::default();
                let mut dependency_behavior = Dependency::Behavior { prod: true, ..Default::default() };
                let mut string_buf: &[u8] = esm.version;

                // const initial_pending_tasks = manager.pending_tasks;
                let mut resolved_package_id: Install::PackageID = 'brk: {
                    // check if the package.json in the source directory was already added to the lockfile
                    // and try to look up the dependency from there
                    // SAFETY: see function-wide note above.
                    if let Some(package_json) = unsafe { &*dir_info }.package_json_for_dependencies {
                        let mut dependencies_list: &[Dependency::Dependency] = &[];
                        let resolve_from_lockfile = package_json.package_manager_package_id != Install::INVALID_PACKAGE_ID;

                        if resolve_from_lockfile {
                            let dependencies = &manager.lockfile.packages.items_dependencies()[package_json.package_manager_package_id as usize];

                            // try to find this package name in the dependencies of the enclosing package
                            dependencies_list = dependencies.get(manager.lockfile.buffers.dependencies.items());
                            string_buf = manager.lockfile.buffers.string_bytes.items();
                        } else if esm_.as_ref().unwrap().version.is_empty() {
                            // If you don't specify a version, default to the one chosen in your package.json
                            dependencies_list = package_json.dependencies.map.values();
                            string_buf = package_json.dependencies.source_buf;
                        }

                        for (dependency_id, dependency) in dependencies_list.iter().enumerate() {
                            if !strings::eql_long(dependency.name.slice(string_buf), esm.name, true) {
                                continue;
                            }

                            dependency_version = dependency.version.clone();
                            dependency_behavior = dependency.behavior;

                            if resolve_from_lockfile {
                                let resolutions = &manager.lockfile.packages.items_resolutions()[package_json.package_manager_package_id as usize];

                                // found it!
                                break 'brk resolutions.get(manager.lockfile.buffers.resolutions.items())[dependency_id];
                            }

                            break;
                        }
                    }

                    // If we get here, it means that the lockfile doesn't have this package at all.
                    // we know nothing
                    break 'brk Install::INVALID_PACKAGE_ID;
                };

                // Now, there are two possible states:
                // 1) We have resolved the package ID, either from the
                //    lockfile globally OR from the particular package.json
                //    dependencies list
                //
                // 2) We parsed the Dependency.Version but there is no
                //    existing resolved package ID

                // If its an exact version, we can just immediately look it up in the global cache and resolve from there
                // If the resolved package ID is _not_ invalid, we can just check

                // If this returns null, then it means we need to *resolve* the package
                // Even after resolution, we might still need to download the package
                // There are two steps here! Two steps!
                let resolution: Resolution = 'brk: {
                    if resolved_package_id == Install::INVALID_PACKAGE_ID {
                        if dependency_version.tag == Dependency::version::Tag::Uninitialized {
                            let sliced_string = Semver::SlicedString::init(esm.version, esm.version);
                            if !esm_.as_ref().unwrap().version.is_empty()
                                // SAFETY: see function-wide note above.
                                && unsafe { &*dir_info }.enclosing_package_json.is_some()
                                && global_cache.allow_version_specifier()
                            {
                                if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                return MatchResultUnion::Failure(bun_core::err!("VersionSpecifierNotAllowedHere"));
                            }
                            string_buf = esm.version;
                            dependency_version = match Dependency::parse(
                                Semver::String::init(esm.name, esm.name),
                                None,
                                esm.version,
                                &sliced_string,
                                self.log,
                                manager,
                            ) {
                                Some(v) => v,
                                None => break 'load_module_from_cache,
                            };
                        }

                        if let Some(id) = manager.lockfile.resolve_package_from_name_and_version(esm.name, &dependency_version) {
                            resolved_package_id = id;
                        }
                    }

                    if resolved_package_id != Install::INVALID_PACKAGE_ID {
                        break 'brk manager.lockfile.packages.items_resolution()[resolved_package_id as usize].clone();
                    }

                    // unsupported or not found dependency, we might need to install it to the cache
                    match self.enqueue_dependency_to_resolve(
                        // SAFETY: see function-wide note above.
                        unsafe { &*dir_info }.package_json_for_dependencies.or(unsafe { &*dir_info }.package_json),
                        &esm,
                        dependency_behavior,
                        &mut resolved_package_id,
                        dependency_version.clone(),
                        string_buf,
                    ) {
                        DependencyToResolve::Resolution(res) => break 'brk res,
                        DependencyToResolve::Pending(pending) => {
                            if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                            return MatchResultUnion::Pending(pending);
                        }
                        DependencyToResolve::Failure(err) => {
                            if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                            return MatchResultUnion::Failure(err);
                        }
                        // this means we looked it up in the registry and the package doesn't exist or the version doesn't exist
                        DependencyToResolve::NotFound => {
                            if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                            return MatchResultUnion::NotFound;
                        }
                    }
                };

                let dir_path_for_resolution = match manager.path_for_resolution(resolved_package_id, &resolution, bufs!(path_in_global_disk_cache)) {
                    Ok(p) => p,
                    Err(err) => {
                        // if it's missing, we need to install it
                        if err == bun_core::err!("FileNotFound") {
                            match manager.get_preinstall_state(resolved_package_id) {
                                Install::PreinstallState::Done => {
                                    let mut path = Fs::Path::init(import_path);
                                    path.is_disabled = true;
                                    // this might mean the package is disabled
                                    if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                    return MatchResultUnion::Success(MatchResult {
                                        path_pair: PathPair { primary: path, secondary: None },
                                        ..Default::default()
                                    });
                                }
                                st @ (Install::PreinstallState::Extract | Install::PreinstallState::Extracting) => {
                                    if !global_cache.can_install() {
                                        if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                        return MatchResultUnion::NotFound;
                                    }
                                    let mut builder = Semver::string::Builder::default();
                                    esm.count(&mut builder);
                                    builder.allocate().expect("unreachable");
                                    let cloned = esm.clone_into(&mut builder);

                                    if st == Install::PreinstallState::Extract {
                                        if let Err(enqueue_download_err) = manager.enqueue_package_for_download(
                                            esm.name,
                                            manager.lockfile.buffers.legacy_package_to_dependency_id(None, resolved_package_id).expect("unreachable"),
                                            resolved_package_id,
                                            resolution.value.npm.version,
                                            manager.lockfile.str(&resolution.value.npm.url),
                                            Install::TaskCallbackContext { root_request_id: 0 },
                                            None,
                                        ) {
                                            if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                            return MatchResultUnion::Failure(enqueue_download_err);
                                        }
                                    }

                                    if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                    return MatchResultUnion::Pending(PendingResolution {
                                        esm: cloned,
                                        dependency: dependency_version,
                                        resolution_id: resolved_package_id,
                                        string_buf: builder.allocated_slice(),
                                        tag: PendingResolutionTag::Download,
                                        ..Default::default()
                                    });
                                }
                                _ => {}
                            }
                        }

                        if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                        return MatchResultUnion::Failure(err);
                    }
                };

                match self.dir_info_for_resolution(dir_path_for_resolution, resolved_package_id) {
                    Ok(dir_info_to_use_) => {
                        if let Some(pkg_dir_info_ptr) = dir_info_to_use_ {
                            // SAFETY: see function-wide note above.
                            let pkg_dir_info = unsafe { &*pkg_dir_info_ptr };
                            let abs_package_path = pkg_dir_info.abs_path;
                            let mut module_type = options::ModuleType::Unknown;
                            if let Some(package_json) = pkg_dir_info.package_json {
                                if let Some(exports_map) = package_json.exports.as_ref() {
                                    // The condition set is determined by the kind of import
                                    let esmodule = ESModule {
                                        conditions: match kind {
                                            ast::ImportKind::Require | ast::ImportKind::RequireResolve => self.opts.conditions.require.clone(),
                                            _ => self.opts.conditions.import.clone(),
                                        },
                                        module_type: &mut module_type,
                                        debug_logs: self.debug_logs.as_mut().map(|d| d as *mut _),
                                    };

                                    // Resolve against the path "/", then join it with the absolute
                                    // directory path. This is done because ESM package resolution uses
                                    // URLs while our path resolution uses file system paths. We don't
                                    // want problems due to Windows paths, which are very unlike URL
                                    // paths. We also want to avoid any "%" characters in the absolute
                                    // directory path accidentally being interpreted as URL escapes.
                                    {
                                        let esm_resolution = esmodule.resolve(b"/", esm.subpath, &exports_map.root);

                                        if let Some(result) = self.handle_esm_resolution(esm_resolution, abs_package_path, kind, package_json, esm.subpath) {
                                            let mut result_copy = result;
                                            result_copy.is_node_module = true;
                                            if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                            return MatchResultUnion::Success(result_copy);
                                        }
                                    }

                                    // Some popular packages forget to include the extension in their
                                    // exports map, so we try again without the extension.
                                    // (same comment as above)
                                    //
                                    // We limit this behavior just to ".js" files.
                                    let extname = bun_paths::extension(esm.subpath);
                                    if extname == b".js" && esm.subpath.len() > 3 {
                                        let esm_resolution = esmodule.resolve(b"/", &esm.subpath[0..esm.subpath.len() - 3], &exports_map.root);
                                        if let Some(result) = self.handle_esm_resolution(esm_resolution, abs_package_path, kind, package_json, esm.subpath) {
                                            let mut result_copy = result;
                                            result_copy.is_node_module = true;
                                            if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                            return MatchResultUnion::Success(result_copy);
                                        }
                                    }

                                    // if they hid "package.json" from "exports", still allow importing it.
                                    if esm.subpath == b"./package.json" {
                                        if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                        return MatchResultUnion::Success(MatchResult {
                                            path_pair: PathPair { primary: package_json.source.path.clone(), secondary: None },
                                            dirname_fd: pkg_dir_info.get_file_descriptor(),
                                            file_fd: FD::INVALID,
                                            is_node_module: package_json.source.path.is_node_module(),
                                            package_json: Some(package_json as *const _),
                                            dir_info: Some(dir_info as *const _),
                                            ..Default::default()
                                        });
                                    }

                                    if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                    return MatchResultUnion::NotFound;
                                }
                            }

                            let Some(abs_path) = self.fs.abs_buf_checked(&[pkg_dir_info.abs_path, esm.subpath], bufs!(node_modules_check)) else {
                                if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                return MatchResultUnion::NotFound;
                            };
                            if let Some(debug) = self.debug_logs.as_mut() {
                                debug.add_note_fmt(format_args!(
                                    "Checking for a package in the directory \"{}\"",
                                    bstr::BStr::new(abs_path)
                                ));
                            }

                            if let Some(mut res) = self.load_as_file_or_directory(abs_path, kind) {
                                res.is_node_module = true;
                                if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                                return MatchResultUnion::Success(res);
                            }
                        }
                    }
                    Err(err) => {
                        if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                        return MatchResultUnion::Failure(err);
                    }
                }
            }
        }

        if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
        MatchResultUnion::NotFound
    }

    fn dir_info_for_resolution(
        &mut self,
        dir_path_maybe_trail_slash: &[u8],
        package_id: Install::PackageID,
    ) -> core::result::Result<Option<*mut DirInfo::DirInfo>, bun_core::Error> {
        // TODO(port): narrow error set
        debug_assert!(self.package_manager.is_some());

        let dir_path = strings::without_trailing_slash_windows_path(dir_path_maybe_trail_slash);

        Self::assert_valid_cache_key(dir_path);
        let mut dir_cache_info_result = self.dir_cache.get_or_put(dir_path);
        if dir_cache_info_result.status == allocators::Status::Exists {
            // we've already looked up this package before
            return Ok(self.dir_cache.at_index(dir_cache_info_result.index));
        }
        let rfs = &mut self.fs.fs;
        let mut cached_dir_entry_result = rfs.entries.get_or_put(dir_path);

        let mut dir_entries_option: *mut Fs::file_system::real_fs::EntriesOption;
        let mut needs_iter = true;
        let mut in_place: Option<*mut Fs::file_system::DirEntry> = None;
        let open_dir = match bun_sys::open_dir_for_iteration(FD::cwd(), dir_path).unwrap() {
            Ok(d) => d,
            Err(err) => {
                // TODO: handle this error better
                let _ = self.log.add_error_fmt(
                    None,
                    logger::Loc::EMPTY,
                    format_args!("Unable to open directory: {}", err.name()),
                );
                return Err(err.into());
            }
        };

        if let Some(cached_entry) = rfs.entries.at_index(cached_dir_entry_result.index) {
            if let Fs::file_system::real_fs::EntriesOption::Entries(entries) = cached_entry {
                if entries.generation >= self.generation {
                    dir_entries_option = cached_entry;
                    needs_iter = false;
                } else {
                    in_place = Some(entries as *mut _);
                }
            }
        }

        if needs_iter {
            // SAFETY: (block-wide) `in_place`/`dir_entries_ptr`/`dir_entries_option` point to slots
            // in `rfs.entries` (BSSMap singleton) or a fresh leaked Box; both outlive this fn and
            // are accessed under `rfs.entries_mutex` (see LIFETIMES.tsv).
            let mut new_entry = Fs::file_system::DirEntry::init(
                if let Some(existing) = in_place {
                    // SAFETY: see block-wide note above.
                    unsafe { &*existing }.dir
                } else {
                    Fs::file_system::DirnameStore::instance().append_slice(dir_path).expect("unreachable")
                },
                self.generation,
            );

            let mut dir_iterator = bun_sys::iterate_dir(open_dir);
            while let Ok(Some(_value)) = dir_iterator.next().unwrap() {
                new_entry
                    .add_entry(
                        // SAFETY: see block-wide note above.
                        in_place.map(|existing| unsafe { &mut (*existing).data }),
                        &_value,
                        (),
                        (),
                    )
                    .expect("unreachable");
            }
            if let Some(existing) = in_place {
                // SAFETY: see block-wide note above.
                unsafe { &mut *existing }.data.clear_and_free();
            }

            let dir_entries_ptr = match in_place {
                Some(p) => p,
                // SAFETY: all-zero is a valid Fs::file_system::DirEntry (POD, no NonNull/NonZero fields);
                // immediately overwritten with `new_entry` on the next line. TODO(port): proper init.
                None => Box::into_raw(Box::new(unsafe { core::mem::zeroed() })),
            };
            // SAFETY: dir_entries_ptr is either a live BSSMap slot (`in_place`) or a fresh Box.
            unsafe { *dir_entries_ptr = new_entry };

            if self.store_fd {
                // SAFETY: see block-wide note above.
                unsafe { &mut *dir_entries_ptr }.fd = open_dir;
            }

            // bun.fs.debug("readdir({f}, {s}) = {d}", ...) — TODO(port): scoped log

            dir_entries_option = rfs
                .entries
                // SAFETY: see block-wide note above.
                .put(&cached_dir_entry_result, Fs::file_system::real_fs::EntriesOption::Entries(unsafe { &mut *dir_entries_ptr }))
                .expect("unreachable");
        }

        // We must initialize it as empty so that the result index is correct.
        // This is important so that browser_scope has a valid index.
        let dir_info_ptr = self.dir_cache.put(&dir_cache_info_result, DirInfo::DirInfo::default()).expect("unreachable");

        // `dir_path` is a slice into the threadlocal `bufs(.path_in_global_disk_cache)` buffer,
        // which gets overwritten on the next auto-install resolution. `dirInfoUncached` stores
        // its `path` argument directly as `DirInfo.abs_path` in the permanent `dir_cache`, so
        // pass the interned copy from `DirEntry.dir` (always backed by `DirnameStore`) instead.
        self.dir_info_uncached(
            dir_info_ptr,
            // SAFETY: ARENA — `dir_entries_option` is a slot in `rfs.entries` (BSSMap) and outlives the resolver.
            unsafe { &*dir_entries_option }.entries().dir,
            // SAFETY: same as above; uniquely re-borrowed mutably for the call.
            unsafe { &mut *dir_entries_option },
            dir_cache_info_result,
            cached_dir_entry_result.index,
            // Packages in the global disk cache are top-level, we shouldn't try
            // to check for a parent package.json
            None,
            allocators::NOT_FOUND,
            open_dir,
            Some(package_id),
        )?;
        Ok(Some(dir_info_ptr))
    }

    fn enqueue_dependency_to_resolve(
        &mut self,
        package_json_: Option<&mut PackageJSON>,
        esm: &ESModule::Package,
        behavior: Dependency::Behavior,
        input_package_id_: &mut Install::PackageID,
        version: Dependency::Version,
        version_buf: &[u8],
    ) -> DependencyToResolve {
        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!(
                "Enqueueing pending dependency \"{}@{}\"",
                bstr::BStr::new(esm.name),
                bstr::BStr::new(esm.version)
            ));
        }

        let input_package_id = *input_package_id_;
        let pm = self.get_package_manager();
        if cfg!(debug_assertions) {
            // we should never be trying to resolve a dependency that is already resolved
            debug_assert!(pm.lockfile.resolve_package_from_name_and_version(esm.name, &version).is_none());
        }

        // Add the containing package to the lockfile

        let mut package = Package::default();

        let is_main = pm.lockfile.packages.len() == 0 && input_package_id == Install::INVALID_PACKAGE_ID;
        if is_main {
            if let Some(package_json) = package_json_ {
                package = match Package::from_package_json(
                    &mut pm.lockfile,
                    pm,
                    package_json,
                    Install::Features {
                        dev_dependencies: true,
                        is_main: true,
                        dependencies: true,
                        optional_dependencies: true,
                        ..Default::default()
                    },
                ) {
                    Ok(p) => p,
                    Err(err) => return DependencyToResolve::Failure(err),
                };
                package.meta.set_has_install_script(package.scripts.has_any());
                package = match pm.lockfile.append_package(package) {
                    Ok(p) => p,
                    Err(err) => return DependencyToResolve::Failure(err),
                };
                package_json.package_manager_package_id = package.meta.id;
            } else {
                // we're resolving an unknown package
                // the unknown package is the root package
                package = Package {
                    name: Semver::String::from(b""),
                    resolution: Resolution {
                        tag: Install::resolution::Tag::Root,
                        value: Install::resolution::Value::Root,
                    },
                    ..Default::default()
                };
                package.meta.set_has_install_script(package.scripts.has_any());
                package = match pm.lockfile.append_package(package) {
                    Ok(p) => p,
                    Err(err) => return DependencyToResolve::Failure(err),
                };
            }
        }

        if self.opts.prefer_offline_install {
            if let Some(package_id) = pm.resolve_from_disk_cache(esm.name, &version) {
                *input_package_id_ = package_id;
                return DependencyToResolve::Resolution(pm.lockfile.packages.items_resolution()[package_id as usize].clone());
            }
        }

        if input_package_id == Install::INVALID_PACKAGE_ID || input_package_id == 0 {
            // All packages are enqueued to the root
            // because we download all the npm package dependencies
            match pm.enqueue_dependency_to_root(esm.name, &version, version_buf, behavior) {
                Install::EnqueueResult::Resolution(result) => {
                    *input_package_id_ = result.package_id;
                    return DependencyToResolve::Resolution(result.resolution);
                }
                Install::EnqueueResult::Pending(id) => {
                    let mut builder = Semver::string::Builder::default();
                    esm.count(&mut builder);
                    builder.allocate().expect("unreachable");
                    let cloned = esm.clone_into(&mut builder);

                    return DependencyToResolve::Pending(PendingResolution {
                        esm: cloned,
                        dependency: version,
                        root_dependency_id: id,
                        string_buf: builder.allocated_slice(),
                        tag: PendingResolutionTag::Resolve,
                        ..Default::default()
                    });
                }
                Install::EnqueueResult::NotFound => {
                    return DependencyToResolve::NotFound;
                }
                Install::EnqueueResult::Failure(err) => {
                    return DependencyToResolve::Failure(err);
                }
            }
        }

        unreachable!("TODO: implement enqueueDependencyToResolve for non-root packages")
    }

    fn handle_esm_resolution(
        &mut self,
        esm_resolution_: ESModule::Resolution,
        abs_package_path: &[u8],
        kind: ast::ImportKind,
        package_json: &PackageJSON,
        package_subpath: &[u8],
    ) -> Option<MatchResult> {
        let mut esm_resolution = esm_resolution_;
        use crate::package_json::esmodule::Status;
        if !((matches!(esm_resolution.status, Status::Inexact | Status::Exact | Status::ExactEndsWithStar))
            && !esm_resolution.path.is_empty()
            && esm_resolution.path[0] == SEP)
        {
            return None;
        }

        let abs_esm_path: &[u8] = match self.fs.abs_buf_checked(
            &[abs_package_path, strings::without_leading_path_separator(esm_resolution.path)],
            bufs!(esm_absolute_package_path_joined),
        ) {
            Some(p) => p,
            None => {
                esm_resolution.status = Status::ModuleNotFound;
                return None;
            }
        };

        let mut missing_suffix: &[u8] = b"";

        match esm_resolution.status {
            Status::Exact | Status::ExactEndsWithStar => {
                let resolved_dir_info_ptr = match self.dir_info_cached(bun_paths::dirname(abs_esm_path).unwrap()).ok().flatten() {
                    Some(d) => d,
                    None => {
                        esm_resolution.status = Status::ModuleNotFound;
                        return None;
                    }
                };
                // SAFETY: ARENA — DirInfo ptr is a BSSMap slot and outlives the resolver (see LIFETIMES.tsv).
                let resolved_dir_info = unsafe { &*resolved_dir_info_ptr };
                let entries = match resolved_dir_info.get_entries(self.generation) {
                    Some(e) => e,
                    None => {
                        esm_resolution.status = Status::ModuleNotFound;
                        return None;
                    }
                };
                let extension_order = if kind == ast::ImportKind::At || kind == ast::ImportKind::AtConditional {
                    self.extension_order
                } else {
                    self.opts.extension_order.kind(kind, resolved_dir_info.is_inside_node_modules())
                };

                let base = bun_paths::basename(abs_esm_path);
                let entry_query = match entries.get(base) {
                    Some(q) => q,
                    None => {
                        let ends_with_star = esm_resolution.status == Status::ExactEndsWithStar;
                        esm_resolution.status = Status::ModuleNotFound;

                        // Try to have a friendly error message if people forget the extension
                        if ends_with_star {
                            let buf = bufs!(load_as_file);
                            buf[..base.len()].copy_from_slice(base);
                            for ext in extension_order {
                                let file_name = &mut buf[0..base.len() + ext.len()];
                                file_name[base.len()..].copy_from_slice(ext);
                                if entries.get(&file_name[..]).is_some() {
                                    if let Some(debug) = self.debug_logs.as_mut() {
                                        let parts = [package_json.name.as_ref(), package_subpath];
                                        debug.add_note_fmt(format_args!(
                                            "The import {} is missing the extension {}",
                                            bstr::BStr::new(ResolvePath::join(&parts, bun_paths::Platform::Auto)),
                                            bstr::BStr::new(ext)
                                        ));
                                    }
                                    esm_resolution.status = Status::ModuleNotFoundMissingExtension;
                                    missing_suffix = ext;
                                    break;
                                }
                            }
                        }
                        return None;
                    }
                };

                if entry_query.entry.kind(&mut self.fs.fs, self.store_fd) == Fs::file_system::EntryKind::Dir {
                    let ends_with_star = esm_resolution.status == Status::ExactEndsWithStar;
                    esm_resolution.status = Status::UnsupportedDirectoryImport;

                    // Try to have a friendly error message if people forget the "/index.js" suffix
                    if ends_with_star {
                        if let Ok(Some(dir_info_ptr)) = self.dir_info_cached(abs_esm_path) {
                            // SAFETY: ARENA — DirInfo ptr is a BSSMap slot and outlives the resolver (see LIFETIMES.tsv).
                            if let Some(dir_entries) = unsafe { &*dir_info_ptr }.get_entries(self.generation) {
                                let index = b"index";
                                let buf = bufs!(load_as_file);
                                buf[..index.len()].copy_from_slice(index);
                                for ext in extension_order {
                                    let file_name = &mut buf[0..index.len() + ext.len()];
                                    file_name[index.len()..].copy_from_slice(ext);
                                    let index_query = dir_entries.get(&file_name[..]);
                                    if let Some(iq) = index_query {
                                        if iq.entry.kind(&mut self.fs.fs, self.store_fd) == Fs::file_system::EntryKind::File {
                                            if let Some(debug) = self.debug_logs.as_mut() {
                                                let mut ms = Vec::with_capacity(1 + file_name.len());
                                                ms.push(b'/');
                                                ms.extend_from_slice(&file_name[..]);
                                                let parts = [package_json.name.as_ref(), package_subpath];
                                                debug.add_note_fmt(format_args!(
                                                    "The import {} is missing the suffix {}",
                                                    bstr::BStr::new(ResolvePath::join(&parts, bun_paths::Platform::Auto)),
                                                    bstr::BStr::new(&ms)
                                                ));
                                            }
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    return None;
                }

                let absolute_out_path: &[u8] = {
                    if entry_query.entry.abs_path.is_empty() {
                        entry_query.entry.abs_path =
                            PathString::init(self.fs.dirname_store.append_slice(abs_esm_path).expect("unreachable"));
                    }
                    entry_query.entry.abs_path.slice()
                };
                let module_type = if let Some(pkg) = resolved_dir_info.package_json {
                    pkg.module_type
                } else {
                    options::ModuleType::Unknown
                };

                Some(MatchResult {
                    path_pair: PathPair { primary: Path::init_with_namespace(absolute_out_path, b"file"), secondary: None },
                    dirname_fd: entries.fd,
                    file_fd: entry_query.entry.cache.fd,
                    dir_info: Some(resolved_dir_info as *const _),
                    diff_case: entry_query.diff_case,
                    is_node_module: true,
                    package_json: Some(resolved_dir_info.package_json.map(|p| p as *const _).unwrap_or(package_json as *const _)),
                    module_type,
                    ..Default::default()
                })
            }
            Status::Inexact => {
                // If this was resolved against an expansion key ending in a "/"
                // instead of a "*", we need to try CommonJS-style implicit
                // extension and/or directory detection.
                if let Some(res) = self.load_as_file_or_directory(abs_esm_path, kind) {
                    let mut res_copy = res;
                    res_copy.is_node_module = true;
                    res_copy.package_json = res_copy.package_json.or(Some(package_json as *const _));
                    return Some(res_copy);
                }
                esm_resolution.status = Status::ModuleNotFound;
                None
            }
            _ => unreachable!(),
        }
    }

    pub fn resolve_without_remapping(
        &mut self,
        source_dir_info: &mut DirInfo::DirInfo,
        import_path: &[u8],
        kind: ast::ImportKind,
        global_cache: GlobalCache,
    ) -> MatchResultUnion {
        if is_package_path(import_path) {
            self.load_node_modules(import_path, kind, source_dir_info, global_cache, false)
        } else {
            let Some(resolved) = self.fs.abs_buf_checked(&[source_dir_info.abs_path, import_path], bufs!(resolve_without_remapping)) else {
                return MatchResultUnion::NotFound;
            };
            if let Some(result) = self.load_as_file_or_directory(resolved, kind) {
                return MatchResultUnion::Success(result);
            }
            MatchResultUnion::NotFound
        }
    }

    pub fn parse_tsconfig(
        &mut self,
        file: &[u8],
        dirname_fd: FD,
    ) -> core::result::Result<Option<&'static mut TSConfigJSON>, bun_core::Error> {
        // TODO(port): narrow error set
        // Since tsconfig.json is cached permanently, in our DirEntries cache
        // we must use the global allocator
        let mut entry = self.caches.fs.read_file_with_allocator(
            self.fs,
            file,
            dirname_fd,
            false,
            None,
        )?;
        let _close = scopeguard::guard((), |_| {
            let _ = entry.close_fd();
        });

        // The file name needs to be persistent because it can have errors
        // and if those errors need to print the filename
        // then it will be undefined memory if we parse another tsconfig.json late
        let key_path = Fs::Path::init(self.fs.dirname_store.append_slice(file).expect("unreachable"));

        let source = logger::Source::init_path_string(key_path.text(), entry.contents);
        let file_dir = source.path.source_dir();

        let result = match TSConfigJSON::parse(self.log, &source, &mut self.caches.json)? {
            Some(r) => r,
            None => return Ok(None),
        };

        if result.has_base_url() {
            // this might leak
            if !bun_paths::is_absolute(result.base_url) {
                let paths = [file_dir, result.base_url];
                result.base_url = self.fs.dirname_store.append_slice(self.fs.abs_buf(&paths, bufs!(tsconfig_base_url))).expect("unreachable");
            }
        }

        if result.paths.count() > 0 && (result.base_url_for_paths.is_empty() || !bun_paths::is_absolute(result.base_url_for_paths)) {
            // this might leak
            let paths = [file_dir, result.base_url];
            result.base_url_for_paths = self.fs.dirname_store.append_slice(self.fs.abs_buf(&paths, bufs!(tsconfig_base_url))).expect("unreachable");
        }

        Ok(Some(result))
    }

    pub fn bin_dirs(&self) -> &[&'static [u8]] {
        // SAFETY: BIN_FOLDERS protected by BIN_FOLDERS_LOCK at write sites
        unsafe {
            if !BIN_FOLDERS_LOADED {
                return &[];
            }
            BIN_FOLDERS.const_slice()
        }
    }

    pub fn parse_package_json<const ALLOW_DEPENDENCIES: bool>(
        &mut self,
        file: &[u8],
        dirname_fd: FD,
        package_id: Option<Install::PackageID>,
    ) -> core::result::Result<Option<&'static mut PackageJSON>, bun_core::Error> {
        // TODO(port): narrow error set
        let pkg = if !self.care_about_scripts {
            PackageJSON::parse(
                self,
                file,
                dirname_fd,
                package_id,
                crate::package_json::ScriptsOption::IgnoreScripts,
                if ALLOW_DEPENDENCIES { crate::package_json::DepsOption::Local } else { crate::package_json::DepsOption::None },
            )
        } else {
            PackageJSON::parse(
                self,
                file,
                dirname_fd,
                package_id,
                crate::package_json::ScriptsOption::IncludeScripts,
                if ALLOW_DEPENDENCIES { crate::package_json::DepsOption::Local } else { crate::package_json::DepsOption::None },
            )
        };
        let Some(pkg) = pkg else { return Ok(None) };

        Ok(Some(PackageJSON::new(pkg)))
    }

    fn dir_info_cached(&mut self, path: &[u8]) -> core::result::Result<Option<*mut DirInfo::DirInfo>, bun_core::Error> {
        self.dir_info_cached_maybe_log::<true, true>(path)
    }

    pub fn read_dir_info(&mut self, path: &[u8]) -> core::result::Result<Option<*mut DirInfo::DirInfo>, bun_core::Error> {
        self.dir_info_cached_maybe_log::<false, true>(path)
    }

    /// Like `readDirInfo`, but returns `null` instead of throwing an error.
    pub fn read_dir_info_ignore_error(&mut self, path: &[u8]) -> Option<*const DirInfo::DirInfo> {
        self.dir_info_cached_maybe_log::<false, true>(path).ok().flatten().map(|p| p as *const _)
    }

    fn dir_info_cached_maybe_log<const ENABLE_LOGGING: bool, const FOLLOW_SYMLINKS: bool>(
        &mut self,
        raw_input_path: &[u8],
    ) -> core::result::Result<Option<*mut DirInfo::DirInfo>, bun_core::Error> {
        // TODO(port): narrow error set
        self.mutex.lock();
        let _unlock = scopeguard::guard((), |_| self.mutex.unlock());
        let mut input_path = raw_input_path;

        if is_dot_slash(input_path) || input_path == b"." {
            input_path = self.fs.top_level_dir;
        }

        // A path longer than MAX_PATH_BYTES cannot name a real directory.
        // Bailing here also prevents overflowing `dir_info_uncached_path`
        // below when called with user-controlled absolute import paths.
        if input_path.len() > MAX_PATH_BYTES {
            return Ok(None);
        }

        #[cfg(windows)]
        {
            let win32_normalized_dir_info_cache_buf = bufs!(win32_normalized_dir_info_cache);
            input_path = self.fs.normalize_buf(win32_normalized_dir_info_cache_buf, input_path);
            // kind of a patch on the fact normalizeBuf isn't 100% perfect what we want
            if (input_path.len() == 2 && input_path[1] == b':')
                || (input_path.len() == 3 && input_path[1] == b':' && input_path[2] == b'.')
            {
                debug_assert!(input_path.as_ptr() == win32_normalized_dir_info_cache_buf.as_ptr());
                win32_normalized_dir_info_cache_buf[2] = b'\\';
                // SAFETY: buf has capacity ≥ 3
                input_path = unsafe { core::slice::from_raw_parts(win32_normalized_dir_info_cache_buf.as_ptr(), 3) };
            }

            // Filter out \\hello\, a UNC server path but without a share.
            // When there isn't a share name, such path is not considered to exist.
            if input_path.starts_with(b"\\\\") {
                let first_slash = strings::index_of_char(&input_path[2..], b'\\').ok_or(()).ok();
                if first_slash.is_none() { return Ok(None); }
                let first_slash = first_slash.unwrap();
                if strings::index_of_char(&input_path[2 + first_slash as usize..], b'\\').is_none() {
                    return Ok(None);
                }
            }
        }

        bun_core::assertf!(
            bun_paths::is_absolute(input_path),
            "cannot resolve DirInfo for non-absolute path: {}",
            bstr::BStr::new(input_path)
        );

        let path_without_trailing_slash = strings::without_trailing_slash_windows_path(input_path);
        Self::assert_valid_cache_key(path_without_trailing_slash);
        let top_result = self.dir_cache.get_or_put(path_without_trailing_slash)?;
        if top_result.status != allocators::Status::Unknown {
            return Ok(self.dir_cache.at_index(top_result.index));
        }

        let dir_info_uncached_path_buf = bufs!(dir_info_uncached_path);

        let mut i: i32 = 1;
        dir_info_uncached_path_buf[..input_path.len()].copy_from_slice(input_path);
        // SAFETY: threadlocal buffer outlives this fn; len ≤ MAX_PATH_BYTES checked above
        let path: &mut [u8] = unsafe { core::slice::from_raw_parts_mut(dir_info_uncached_path_buf.as_mut_ptr(), input_path.len()) };

        bufs!(dir_entry_paths_to_resolve)[0] = DirEntryResolveQueueItem {
            result: top_result,
            // SAFETY: extending lifetime to 'static for threadlocal buf storage; consumed before fn returns
            unsafe_path: unsafe { &*(path as *const [u8]) },
            safe_path: b"",
            fd: FD::INVALID,
        };
        let mut top = Dirname::dirname(path);

        let mut top_parent = allocators::Result {
            index: allocators::NOT_FOUND,
            hash: 0,
            status: allocators::Status::NotFound,
        };
        #[cfg(windows)]
        let root_path = strings::without_trailing_slash_windows_path(ResolvePath::windows_filesystem_root(path));
        #[cfg(not(windows))]
        // we cannot just use "/"
        // we will write to the buffer past the ptr len so it must be a non-const buffer
        let root_path = &path[0..1];
        Self::assert_valid_cache_key(root_path);

        let rfs = &mut self.fs.fs;

        rfs.entries_mutex.lock();
        let _entries_unlock = scopeguard::guard((), |_| rfs.entries_mutex.unlock());

        while top.len() > root_path.len() {
            debug_assert!(top.as_ptr() == root_path.as_ptr());
            let result = self.dir_cache.get_or_put(top)?;

            if result.status != allocators::Status::Unknown {
                top_parent = result;
                break;
            }
            // Path has more uncached components than our fixed queue can hold.
            // This only happens for user-controlled absolute import paths with
            // hundreds of short components — no real directory is this deep.
            if usize::try_from(i).unwrap() >= bufs!(dir_entry_paths_to_resolve).len() {
                return Ok(None);
            }
            bufs!(dir_entry_paths_to_resolve)[usize::try_from(i).unwrap()] = DirEntryResolveQueueItem {
                // SAFETY: extending lifetime to 'static for threadlocal buf storage; consumed before fn returns.
                unsafe_path: unsafe { &*(top as *const [u8]) },
                result,
                safe_path: b"",
                fd: FD::INVALID,
            };

            if let Some(top_entry) = rfs.entries.get(top) {
                match top_entry {
                    Fs::file_system::real_fs::EntriesOption::Entries(entries) => {
                        bufs!(dir_entry_paths_to_resolve)[usize::try_from(i).unwrap()].safe_path = entries.dir;
                        bufs!(dir_entry_paths_to_resolve)[usize::try_from(i).unwrap()].fd = entries.fd;
                    }
                    Fs::file_system::real_fs::EntriesOption::Err(err) => {
                        debuglog!(
                            "Failed to load DirEntry {}  {} - {}",
                            bstr::BStr::new(top),
                            err.original_err.name(),
                            err.canonical_error.name()
                        );
                        break;
                    }
                }
            }
            i += 1;
            top = Dirname::dirname(top);
        }

        if top == root_path {
            let result = self.dir_cache.get_or_put(root_path)?;
            if result.status != allocators::Status::Unknown {
                top_parent = result;
            } else {
                bufs!(dir_entry_paths_to_resolve)[usize::try_from(i).unwrap()] = DirEntryResolveQueueItem {
                    // SAFETY: extending lifetime to 'static for threadlocal buf storage; consumed before fn returns.
                    unsafe_path: unsafe { &*(root_path as *const [u8]) },
                    result,
                    safe_path: b"",
                    fd: FD::INVALID,
                };
                if let Some(top_entry) = rfs.entries.get(top) {
                    match top_entry {
                        Fs::file_system::real_fs::EntriesOption::Entries(entries) => {
                            bufs!(dir_entry_paths_to_resolve)[usize::try_from(i).unwrap()].safe_path = entries.dir;
                            bufs!(dir_entry_paths_to_resolve)[usize::try_from(i).unwrap()].fd = entries.fd;
                        }
                        Fs::file_system::real_fs::EntriesOption::Err(err) => {
                            debuglog!(
                                "Failed to load DirEntry {}  {} - {}",
                                bstr::BStr::new(top),
                                err.original_err.name(),
                                err.canonical_error.name()
                            );
                            return Err(err.canonical_error);
                        }
                    }
                }

                i += 1;
            }
        }

        let mut queue_slice_len = usize::try_from(i).unwrap();
        if cfg!(debug_assertions) {
            debug_assert!(queue_slice_len > 0);
        }
        let mut open_dir_count: usize = 0;

        // When this function halts, any item not processed means it's not found.
        let _close_dirs = scopeguard::guard((), |_| {
            if open_dir_count > 0 && (!self.store_fd || self.fs.fs.need_to_close_files()) {
                let open_dirs = &bufs!(open_dirs)[0..open_dir_count];
                for open_dir in open_dirs {
                    open_dir.close();
                }
            }
        });
        // TODO(port): the above scopeguard captures &mut self across the loop body — Phase B
        // may need to convert this to manual cleanup at each return point.

        // We want to walk in a straight line from the topmost directory to the desired directory
        // For each directory we visit, we get the entries, but not traverse into child directories
        // (unless those child directories are in the queue)
        // We go top-down instead of bottom-up to increase odds of reusing previously open file handles
        // "/home/jarred/Code/node_modules/react/cjs/react.development.js"
        //       ^
        // If we start there, we will traverse all of /home/jarred, including e.g. /home/jarred/Downloads
        // which is completely irrelevant.

        // After much experimentation...
        // - fts_open is not the fastest way to read directories. fts actually just uses readdir!!
        // - remember
        let mut _safe_path: Option<&'static [u8]> = None;

        // Start at the top.
        while queue_slice_len > 0 {
            let queue_top = bufs!(dir_entry_paths_to_resolve)[queue_slice_len - 1].clone();
            // defer top_parent = queue_top.result — done at end of loop body
            queue_slice_len -= 1;

            let open_dir: FD = if queue_top.fd.is_valid() {
                queue_top.fd
            } else {
                'open_dir: {
                    // This saves us N copies of .toPosixPath
                    // which was likely the perf gain from resolving directories relative to the parent directory, anyway.
                    let prev_char = path[queue_top.unsafe_path.len()..].first().copied().unwrap_or(0);
                    // SAFETY: path is &mut into the threadlocal buffer
                    unsafe { *path.as_mut_ptr().add(queue_top.unsafe_path.len()) = 0 };
                    // SAFETY: path is &mut into the threadlocal buffer; index in-bounds (≤ input_path.len()).
                    let restore = scopeguard::guard((), |_| unsafe {
                        *path.as_mut_ptr().add(queue_top.unsafe_path.len()) = prev_char;
                    });
                    // SAFETY: NUL written above
                    let sentinel = unsafe { bun_str::ZStr::from_raw(path.as_ptr(), queue_top.unsafe_path.len()) };

                    #[cfg(unix)]
                    let open_req: core::result::Result<FD, bun_core::Error> = {
                        // TODO(port): std.fs.openDirAbsoluteZ — using bun_sys equivalent
                        bun_sys::open_dir_absolute_z(sentinel, bun_sys::OpenDirOptions {
                            no_follow: !FOLLOW_SYMLINKS,
                            iterate: true,
                        })
                        .map_err(Into::into)
                    };
                    #[cfg(windows)]
                    let open_req: core::result::Result<FD, bun_core::Error> = {
                        bun_sys::open_dir_at_windows_a(FD::INVALID, sentinel, bun_sys::OpenDirAtWindowsOptions {
                            iterable: true,
                            no_follow: !FOLLOW_SYMLINKS,
                            read_only: true,
                        })
                        .unwrap()
                        .map_err(Into::into)
                    };

                    // bun.fs.debug("open({s})", .{sentinel}) — TODO(port): scoped log
                    drop(restore);

                    match open_req {
                        Ok(fd) => break 'open_dir fd,
                        Err(err) => {
                            // Ignore "ENOTDIR" here so that calling "ReadDirectory" on a file behaves
                            // as if there is nothing there at all instead of causing an error due to
                            // the directory actually being a file. This is a workaround for situations
                            // where people try to import from a path containing a file as a parent
                            // directory. The "pnpm" package manager generates a faulty "NODE_PATH"
                            // list which contains such paths and treating them as missing means we just
                            // ignore them during path resolution.
                            if err == bun_core::err!("ENOTDIR")
                                || err == bun_core::err!("IsDir")
                                || err == bun_core::err!("NotDir")
                            {
                                return Ok(None);
                            }
                            let cached_dir_entry_result = rfs.entries.get_or_put(queue_top.unsafe_path).expect("unreachable");
                            // If we don't properly cache not found, then we repeatedly attempt to open the same directories,
                            // which causes a perf trace that looks like this stupidity;
                            //
                            //   openat(dfd: CWD, filename: "node_modules/react", flags: RDONLY|DIRECTORY) = -1 ENOENT (No such file or directory)
                            //   ...
                            self.dir_cache.mark_not_found(queue_top.result);
                            rfs.entries.mark_not_found(cached_dir_entry_result);
                            if !(err == bun_core::err!("ENOENT") || err == bun_core::err!("FileNotFound")) {
                                if ENABLE_LOGGING {
                                    let pretty = queue_top.unsafe_path;
                                    let _ = self.log.add_error_fmt(
                                        None,
                                        logger::Loc::default(),
                                        format_args!(
                                            "Cannot read directory \"{}\": {}",
                                            bstr::BStr::new(pretty),
                                            err.name()
                                        ),
                                    );
                                }
                            }

                            return Ok(None);
                        }
                    }
                }
            };

            if !queue_top.fd.is_valid() {
                Fs::FileSystem::set_max_fd(open_dir.cast());
                // these objects mostly just wrap the file descriptor, so it's fine to keep it.
                bufs!(open_dirs)[open_dir_count] = open_dir;
                open_dir_count += 1;
            }

            let dir_path: &'static [u8] = if !queue_top.safe_path.is_empty() {
                queue_top.safe_path
            } else {
                // ensure trailing slash
                if _safe_path.is_none() {
                    // Now that we've opened the topmost directory successfully, it's reasonable to store the slice.
                    if path[path.len() - 1] != SEP {
                        let parts: [&[u8]; 2] = [path, SEP_STR.as_bytes()];
                        _safe_path = Some(self.fs.dirname_store.append_parts(&parts)?);
                    } else {
                        _safe_path = Some(self.fs.dirname_store.append_slice(path)?);
                    }
                }

                let safe_path = _safe_path.unwrap();

                let dir_path_i = strings::index_of(safe_path, queue_top.unsafe_path).expect("unreachable");
                let mut end = dir_path_i + queue_top.unsafe_path.len();

                // Directories must always end in a trailing slash or else various bugs can occur.
                // This covers "what happens when the trailing"
                end += usize::from(
                    safe_path.len() > end && end > 0 && safe_path[end - 1] != SEP && safe_path[end] == SEP,
                );
                &safe_path[dir_path_i..end]
            };

            let mut cached_dir_entry_result = rfs.entries.get_or_put(dir_path).expect("unreachable");

            let mut dir_entries_option: *mut Fs::file_system::real_fs::EntriesOption = core::ptr::null_mut();
            let mut needs_iter = true;
            let mut in_place: Option<*mut Fs::file_system::DirEntry> = None;

            if let Some(cached_entry) = rfs.entries.at_index(cached_dir_entry_result.index) {
                if let Fs::file_system::real_fs::EntriesOption::Entries(entries) = cached_entry {
                    if entries.generation >= self.generation {
                        dir_entries_option = cached_entry;
                        needs_iter = false;
                    } else {
                        in_place = Some(entries as *mut _);
                    }
                }
            }

            if needs_iter {
                // SAFETY: (block-wide) `in_place`/`dir_entries_ptr`/`dir_entries_option` point to
                // slots in `rfs.entries` (BSSMap singleton) or a fresh leaked Box; both outlive this
                // fn and are accessed under `rfs.entries_mutex` (see LIFETIMES.tsv).
                let mut new_entry = Fs::file_system::DirEntry::init(
                    if let Some(existing) = in_place {
                        // SAFETY: see block-wide note above.
                        unsafe { &*existing }.dir
                    } else {
                        Fs::file_system::DirnameStore::instance().append_slice(dir_path).expect("unreachable")
                    },
                    self.generation,
                );

                let mut dir_iterator = bun_sys::iterate_dir(open_dir);
                while let Ok(Some(_value)) = dir_iterator.next().unwrap() {
                    new_entry
                        .add_entry(
                            // SAFETY: see block-wide note above.
                            in_place.map(|existing| unsafe { &mut (*existing).data }),
                            &_value,
                            (),
                            (),
                        )
                        .expect("unreachable");
                }
                if let Some(existing) = in_place {
                    // SAFETY: see block-wide note above.
                    unsafe { &mut *existing }.data.clear_and_free();
                }
                new_entry.fd = if self.store_fd { open_dir } else { FD::INVALID };
                let dir_entries_ptr = match in_place {
                    Some(p) => p,
                    // SAFETY: all-zero is a valid Fs::file_system::DirEntry (POD, no NonNull/NonZero fields);
                    // immediately overwritten with `new_entry` on the next line. TODO(port): proper init.
                    None => Box::into_raw(Box::new(unsafe { core::mem::zeroed() })),
                };
                // SAFETY: dir_entries_ptr is either a live BSSMap slot (`in_place`) or a fresh Box.
                unsafe { *dir_entries_ptr = new_entry };
                dir_entries_option = rfs
                    .entries
                    // SAFETY: see block-wide note above.
                    .put(&cached_dir_entry_result, Fs::file_system::real_fs::EntriesOption::Entries(unsafe { &mut *dir_entries_ptr }))?;
                // bun.fs.debug("readdir({f}, {s}) = {d}", ...) — TODO(port): scoped log
            }

            // We must initialize it as empty so that the result index is correct.
            // This is important so that browser_scope has a valid index.
            let dir_info_ptr = self.dir_cache.put(&queue_top.result, DirInfo::DirInfo::default())?;

            self.dir_info_uncached(
                dir_info_ptr,
                dir_path,
                // SAFETY: ARENA — `dir_entries_option` is a slot in `rfs.entries` (BSSMap) and outlives the resolver.
                unsafe { &mut *dir_entries_option },
                queue_top.result,
                cached_dir_entry_result.index,
                self.dir_cache.at_index(top_parent.index),
                top_parent.index,
                open_dir,
                None,
            )?;

            top_parent = queue_top.result;

            if queue_slice_len == 0 {
                return Ok(Some(dir_info_ptr));

                // Is the directory we're searching for actually a file?
            } else if queue_slice_len == 1 {
                // const next_in_queue = queue_slice[0];
                // const next_basename = std.fs.path.basename(next_in_queue.unsafe_path);
                // if (dir_info_ptr.getEntries(r.generation)) |entries| {
                //     if (entries.get(next_basename) != null) {
                //         return null;
                //     }
                // }
            }
        }

        unreachable!()
    }

    // This closely follows the behavior of "tryLoadModuleUsingPaths()" in the
    // official TypeScript compiler
    pub fn match_tsconfig_paths(&mut self, tsconfig: &TSConfigJSON, path: &[u8], kind: ast::ImportKind) -> Option<MatchResult> {
        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!(
                "Matching \"{}\" against \"paths\" in \"{}\"",
                bstr::BStr::new(path),
                bstr::BStr::new(tsconfig.abs_path)
            ));
        }

        let mut abs_base_url = tsconfig.base_url_for_paths;

        // The explicit base URL should take precedence over the implicit base URL
        // if present. This matters when a tsconfig.json file overrides "baseUrl"
        // from another extended tsconfig.json file but doesn't override "paths".
        if tsconfig.has_base_url() {
            abs_base_url = tsconfig.base_url;
        }

        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!("Using \"{}\" as \"baseURL\"", bstr::BStr::new(abs_base_url)));
        }

        // Check for exact matches first
        {
            let mut iter = tsconfig.paths.iter();
            while let Some((key, value)) = iter.next() {
                if strings::eql_long(key, path, true) {
                    for original_path in value.iter() {
                        let mut absolute_original_path: &[u8] = original_path;

                        if !bun_paths::is_absolute(absolute_original_path) {
                            let parts = [abs_base_url, original_path.as_ref()];
                            absolute_original_path = self.fs.abs_buf(&parts, bufs!(tsconfig_path_abs));
                        }

                        if let Some(res) = self.load_as_file_or_directory(absolute_original_path, kind) {
                            return Some(res);
                        }
                    }
                }
            }
        }

        struct TSConfigMatch<'b> {
            prefix: &'b [u8],
            suffix: &'b [u8],
            original_paths: &'b [Box<[u8]>],
        }

        let mut longest_match: Option<TSConfigMatch> = None;
        let mut longest_match_prefix_length: i32 = -1;
        let mut longest_match_suffix_length: i32 = -1;

        let mut iter = tsconfig.paths.iter();
        while let Some((key, original_paths)) = iter.next() {
            if let Some(star) = strings::index_of_char(key, b'*') {
                let star = star as usize;
                let prefix: &[u8] = if star == 0 { b"" } else { &key[0..star] };
                let suffix: &[u8] = if star == key.len() - 1 { b"" } else { &key[star + 1..] };

                // Find the match with the longest prefix. If two matches have the same
                // prefix length, pick the one with the longest suffix. This second edge
                // case isn't handled by the TypeScript compiler, but we handle it
                // because we want the output to always be deterministic
                let plen = i32::try_from(prefix.len()).unwrap();
                let slen = i32::try_from(suffix.len()).unwrap();
                if path.starts_with(prefix)
                    && path.ends_with(suffix)
                    && (plen > longest_match_prefix_length
                        || (plen == longest_match_prefix_length
                            && slen > longest_match_suffix_length))
                {
                    longest_match_prefix_length = plen;
                    longest_match_suffix_length = slen;
                    longest_match = Some(TSConfigMatch { prefix, suffix, original_paths });
                }
            }
        }

        // If there is at least one match, only consider the one with the longest
        // prefix. This matches the behavior of the TypeScript compiler.
        if longest_match_prefix_length != -1 {
            let longest_match = longest_match.unwrap();
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "Found a fuzzy match for \"{}*{}\" in \"paths\"",
                    bstr::BStr::new(longest_match.prefix),
                    bstr::BStr::new(longest_match.suffix)
                ));
            }

            for original_path in longest_match.original_paths.iter() {
                // Swap out the "*" in the original path for whatever the "*" matched
                let matched_text = &path[longest_match.prefix.len()..path.len() - longest_match.suffix.len()];

                let total_length: Option<u32> = strings::index_of_char(original_path, b'*');
                let prefix_end = total_length.map(|v| v as usize).unwrap_or(original_path.len());
                let prefix_parts = [abs_base_url, &original_path[0..prefix_end]];

                // Concatenate the matched text with the suffix from the wildcard path
                let matched_text_with_suffix = bufs!(tsconfig_match_full_buf3);
                let mut matched_text_with_suffix_len: usize = 0;
                if total_length.is_some() {
                    let suffix = strings::trim_left(&original_path[prefix_end..], b"*");
                    matched_text_with_suffix_len = matched_text.len() + suffix.len();
                    if matched_text_with_suffix_len > matched_text_with_suffix.len() {
                        continue;
                    }
                    bun_core::concat(matched_text_with_suffix, &[matched_text, suffix]);
                }

                // 1. Normalize the base path
                // so that "/Users/foo/project/", "../components/*" => "/Users/foo/components/""
                let Some(prefix) = self.fs.abs_buf_checked(&prefix_parts, bufs!(tsconfig_match_full_buf2)) else {
                    continue;
                };

                // 2. Join the new base path with the matched result
                // so that "/Users/foo/components/", "/foo/bar" => /Users/foo/components/foo/bar
                let parts: [&[u8]; 3] = [
                    prefix,
                    if matched_text_with_suffix_len > 0 {
                        strings::trim_left(&matched_text_with_suffix[0..matched_text_with_suffix_len], b"/")
                    } else {
                        b""
                    },
                    strings::trim_left(longest_match.suffix, b"/"),
                ];
                let Some(absolute_original_path) = self.fs.abs_buf_checked(&parts, bufs!(tsconfig_match_full_buf)) else {
                    continue;
                };

                if let Some(res) = self.load_as_file_or_directory(absolute_original_path, kind) {
                    return Some(res);
                }
            }
        }

        None
    }

    pub fn load_package_imports(
        &mut self,
        import_path: &[u8],
        dir_info: &mut DirInfo::DirInfo,
        kind: ast::ImportKind,
        global_cache: GlobalCache,
    ) -> MatchResultUnion {
        let package_json = dir_info.package_json.unwrap();
        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!(
                "Looking for {} in \"imports\" map in {}",
                bstr::BStr::new(import_path),
                bstr::BStr::new(package_json.source.path.text())
            ));
            debug.increase_indent();
            // defer debug.decreaseIndent() — TODO(port): missing matching decrease in Zig too
        }
        let imports_map = package_json.imports.as_ref().unwrap();

        if import_path.len() == 1 || import_path.starts_with(b"#/") {
            if let Some(debug) = self.debug_logs.as_mut() {
                debug.add_note_fmt(format_args!(
                    "The path \"{}\" must not equal \"#\" and must not start with \"#/\"",
                    bstr::BStr::new(import_path)
                ));
            }
            return MatchResultUnion::NotFound;
        }
        let mut module_type = options::ModuleType::Unknown;

        let esmodule = ESModule {
            conditions: match kind {
                ast::ImportKind::Require | ast::ImportKind::RequireResolve => self.opts.conditions.require.clone(),
                _ => self.opts.conditions.import.clone(),
            },
            debug_logs: self.debug_logs.as_mut().map(|d| d as *mut _),
            module_type: &mut module_type,
        };

        let esm_resolution = esmodule.resolve_imports(import_path, &imports_map.root);

        if esm_resolution.status == crate::package_json::esmodule::Status::PackageResolve {
            // https://github.com/oven-sh/bun/issues/4972
            // Resolve a subpath import to a Bun or Node.js builtin
            //
            // Code example:
            //
            //     import { readFileSync } from '#fs';
            //
            // package.json:
            //
            //     "imports": {
            //       "#fs": "node:fs"
            //     }
            //
            if self.opts.mark_builtins_as_external || self.opts.target.is_bun() {
                if let Some(alias) = bun_jsc::module_loader::HardcodedModule::Alias::get(esm_resolution.path, self.opts.target, Default::default()) {
                    return MatchResultUnion::Success(MatchResult {
                        path_pair: PathPair { primary: Fs::Path::init(alias.path), secondary: None },
                        is_external: true,
                        ..Default::default()
                    });
                }
            }

            return self.load_node_modules(esm_resolution.path, kind, dir_info, global_cache, true);
        }

        if let Some(result) = self.handle_esm_resolution(esm_resolution, package_json.source.path.name.dir(), kind, package_json, b"") {
            return MatchResultUnion::Success(result);
        }

        MatchResultUnion::NotFound
    }

    pub fn check_browser_map<const KIND: BrowserMapPathKind>(
        &mut self,
        dir_info: &DirInfo::DirInfo,
        input_path_: &[u8],
    ) -> Option<&'static [u8]> {
        let package_json = dir_info.package_json?;
        let browser_map = &package_json.browser_map;

        if browser_map.count() == 0 {
            return None;
        }

        let mut input_path = input_path_;

        if KIND == BrowserMapPathKind::AbsolutePath {
            let abs_path = dir_info.abs_path;
            // Turn absolute paths into paths relative to the "browser" map location
            if !input_path.starts_with(abs_path) {
                return None;
            }

            input_path = &input_path[abs_path.len()..];
        }

        if input_path.is_empty()
            || (input_path.len() == 1 && (input_path[0] == b'.' || input_path[0] == SEP))
        {
            // No bundler supports remapping ".", so we don't either
            return None;
        }

        // Normalize the path so we can compare against it without getting confused by "./"
        let cleaned = self.fs.normalize_buf(bufs!(check_browser_map), input_path);

        if cleaned.len() == 1 && cleaned[0] == b'.' {
            // No bundler supports remapping ".", so we don't either
            return None;
        }

        let mut checker = BrowserMapPath {
            remapped: b"",
            cleaned,
            input_path,
            extension_order: self.extension_order,
            map: &package_json.browser_map,
        };

        if checker.check_path(input_path) {
            return Some(checker.remapped);
        }

        // First try the import path as a package path
        if is_package_path(checker.input_path) {
            let abs_to_rel = bufs!(abs_to_rel);
            match KIND {
                BrowserMapPathKind::AbsolutePath => {
                    abs_to_rel[0..2].copy_from_slice(b"./");
                    abs_to_rel[2..2 + checker.input_path.len()].copy_from_slice(checker.input_path);
                    if checker.check_path(&abs_to_rel[0..checker.input_path.len() + 2]) {
                        return Some(checker.remapped);
                    }
                }
                BrowserMapPathKind::PackagePath => {
                    // Browserify allows a browser map entry of "./pkg" to override a package
                    // path of "require('pkg')". This is weird, and arguably a bug. But we
                    // replicate this bug for compatibility. However, Browserify only allows
                    // this within the same package. It does not allow such an entry in a
                    // parent package to override this in a child package. So this behavior
                    // is disallowed if there is a "node_modules" folder in between the child
                    // package and the parent package.
                    let is_in_same_package = match dir_info.get_parent() {
                        // SAFETY: ARENA — DirInfo ptr is a BSSMap slot and outlives the resolver (see LIFETIMES.tsv).
                        Some(parent) => !unsafe { &*parent }.is_node_modules(),
                        None => true,
                    };

                    if is_in_same_package {
                        abs_to_rel[0..2].copy_from_slice(b"./");
                        abs_to_rel[2..2 + checker.input_path.len()].copy_from_slice(checker.input_path);

                        if checker.check_path(&abs_to_rel[0..checker.input_path.len() + 2]) {
                            return Some(checker.remapped);
                        }
                    }
                }
            }
        }

        None
    }

    pub fn load_from_main_field(
        &mut self,
        path: &[u8],
        dir_info: &mut DirInfo::DirInfo,
        _field_rel_path: &[u8],
        field: &[u8],
        extension_order: &[&'static [u8]],
    ) -> Option<MatchResult> {
        let mut field_rel_path = _field_rel_path;
        // Is this a directory?
        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!(
                "Found main field \"{}\" with path \"{}\"",
                bstr::BStr::new(field),
                bstr::BStr::new(field_rel_path)
            ));
            debug.increase_indent();
        }

        // defer { debug.decreaseIndent() } — handled at returns
        macro_rules! dec_ret {
            ($e:expr) => {{
                if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                return $e;
            }};
        }

        if self.care_about_browser_field {
            // Potentially remap using the "browser" field
            if let Some(browser_scope) = dir_info.get_enclosing_browser_scope() {
                if let Some(browser_json) = browser_scope.package_json {
                    if let Some(remap) = self.check_browser_map::<{ BrowserMapPathKind::AbsolutePath }>(browser_scope, field_rel_path) {
                        // Is the path disabled?
                        if remap.is_empty() {
                            let paths = [path, field_rel_path];
                            let new_path = self.fs.abs_alloc(&paths).expect("unreachable");
                            let mut _path = Path::init(new_path);
                            _path.is_disabled = true;
                            dec_ret!(Some(MatchResult {
                                path_pair: PathPair { primary: _path, secondary: None },
                                package_json: Some(browser_json as *const _),
                                ..Default::default()
                            }));
                        }

                        field_rel_path = remap;
                    }
                }
            }
        }
        let _paths = [path, field_rel_path];
        let field_abs_path = self.fs.abs_buf(&_paths, bufs!(field_abs_path));

        // Is this a file?
        if let Some(result) = self.load_as_file(field_abs_path, extension_order) {
            if let Some(package_json) = dir_info.package_json {
                dec_ret!(Some(MatchResult {
                    path_pair: PathPair { primary: Fs::Path::init(result.path), secondary: None },
                    package_json: Some(package_json as *const _),
                    dirname_fd: result.dirname_fd,
                    ..Default::default()
                }));
            }

            dec_ret!(Some(MatchResult {
                path_pair: PathPair { primary: Fs::Path::init(result.path), secondary: None },
                dirname_fd: result.dirname_fd,
                diff_case: result.diff_case,
                ..Default::default()
            }));
        }

        // Is it a directory with an index?
        let Some(field_dir_info) = self.dir_info_cached(field_abs_path).ok().flatten() else {
            dec_ret!(None);
        };

        // SAFETY: ARENA — DirInfo ptr is a BSSMap slot; uniquely re-borrowed mutably (see LIFETIMES.tsv).
        let r = self.load_as_index_with_browser_remapping(unsafe { &mut *field_dir_info }, field_abs_path, extension_order);
        if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
        r
    }

    // nodeModulePathsForJS / Resolver__propForRequireMainPaths: see src/jsc/resolver_jsc.zig
    // (no Zig callers; exported to C++ only)

    pub fn load_as_index(&mut self, dir_info: &mut DirInfo::DirInfo, extension_order: &[&'static [u8]]) -> Option<MatchResult> {
        // Try the "index" file with extensions
        for ext in extension_order {
            if let Some(result) = self.load_index_with_extension(dir_info, ext) {
                return Some(result);
            }
        }
        for ext in self.opts.extra_cjs_extensions.iter() {
            if let Some(result) = self.load_index_with_extension(dir_info, ext) {
                return Some(result);
            }
        }

        None
    }

    fn load_index_with_extension(&mut self, dir_info: &mut DirInfo::DirInfo, ext: &[u8]) -> Option<MatchResult> {
        let rfs = &mut self.fs.fs;

        let ext_buf = bufs!(extension_path);

        let base = &mut ext_buf[0..b"index".len() + ext.len()];
        base[0..b"index".len()].copy_from_slice(b"index");
        base[b"index".len()..].copy_from_slice(ext);

        if let Some(entries) = dir_info.get_entries(self.generation) {
            if let Some(lookup) = entries.get(&base[..]) {
                if lookup.entry.kind(rfs, self.store_fd) == Fs::file_system::EntryKind::File {
                    let out_buf: &[u8] = {
                        if lookup.entry.abs_path.is_empty() {
                            let parts = [dir_info.abs_path, &base[..]];
                            let out_buf_ = self.fs.abs_buf(&parts, bufs!(index));
                            lookup.entry.abs_path =
                                PathString::init(self.fs.dirname_store.append_slice(out_buf_).expect("unreachable"));
                        }
                        lookup.entry.abs_path.slice()
                    };

                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note_fmt(format_args!("Found file: \"{}\"", bstr::BStr::new(out_buf)));
                    }

                    if let Some(package_json) = dir_info.package_json {
                        return Some(MatchResult {
                            path_pair: PathPair { primary: Path::init(out_buf), secondary: None },
                            diff_case: lookup.diff_case,
                            package_json: Some(package_json as *const _),
                            dirname_fd: dir_info.get_file_descriptor(),
                            ..Default::default()
                        });
                    }

                    return Some(MatchResult {
                        path_pair: PathPair { primary: Path::init(out_buf), secondary: None },
                        diff_case: lookup.diff_case,
                        dirname_fd: dir_info.get_file_descriptor(),
                        ..Default::default()
                    });
                }
            }
        }

        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!(
                "Failed to find file: \"{}/{}\"",
                bstr::BStr::new(dir_info.abs_path),
                bstr::BStr::new(&base[..])
            ));
        }

        None
    }

    pub fn load_as_index_with_browser_remapping(
        &mut self,
        dir_info: &mut DirInfo::DirInfo,
        path_: &[u8],
        extension_order: &[&'static [u8]],
    ) -> Option<MatchResult> {
        // In order for our path handling logic to be correct, it must end with a trailing slash.
        let mut path = path_;
        if !strings::ends_with_char(path_, SEP) {
            let path_buf = bufs!(remap_path_trailing_slash);
            path_buf[..path.len()].copy_from_slice(path);
            path_buf[path.len()] = SEP;
            path_buf[path.len() + 1] = 0;
            // SAFETY: threadlocal buf
            path = unsafe { core::slice::from_raw_parts(path_buf.as_ptr(), path.len() + 1) };
        }

        if self.care_about_browser_field {
            if let Some(browser_scope) = dir_info.get_enclosing_browser_scope() {
                const FIELD_REL_PATH: &[u8] = b"index";

                if let Some(browser_json) = browser_scope.package_json {
                    if let Some(remap) = self.check_browser_map::<{ BrowserMapPathKind::AbsolutePath }>(browser_scope, FIELD_REL_PATH) {
                        // Is the path disabled?
                        if remap.is_empty() {
                            let paths = [path, FIELD_REL_PATH];
                            let new_path = self.fs.abs_buf(&paths, bufs!(remap_path));
                            let mut _path = Path::init(new_path);
                            _path.is_disabled = true;
                            return Some(MatchResult {
                                path_pair: PathPair { primary: _path, secondary: None },
                                package_json: Some(browser_json as *const _),
                                ..Default::default()
                            });
                        }

                        let new_paths = [path, remap];
                        let remapped_abs = self.fs.abs_buf(&new_paths, bufs!(remap_path));

                        // Is this a file
                        if let Some(file_result) = self.load_as_file(remapped_abs, extension_order) {
                            return Some(MatchResult {
                                dirname_fd: file_result.dirname_fd,
                                path_pair: PathPair { primary: Path::init(file_result.path), secondary: None },
                                diff_case: file_result.diff_case,
                                ..Default::default()
                            });
                        }

                        // Is it a directory with an index?
                        if let Ok(Some(new_dir)) = self.dir_info_cached(remapped_abs) {
                            // SAFETY: ARENA — DirInfo ptr is a BSSMap slot; uniquely re-borrowed mutably (see LIFETIMES.tsv).
                            if let Some(absolute) = self.load_as_index(unsafe { &mut *new_dir }, extension_order) {
                                return Some(absolute);
                            }
                        }

                        return None;
                    }
                }
            }
        }

        self.load_as_index(dir_info, extension_order)
    }

    pub fn load_as_file_or_directory(&mut self, path: &[u8], kind: ast::ImportKind) -> Option<MatchResult> {
        let extension_order = self.extension_order;

        // Is this a file?
        if let Some(file) = self.load_as_file(path, extension_order) {
            // Determine the package folder by looking at the last node_modules/ folder in the path
            let nm_seg = const_format::concatcp!("node_modules", SEP_STR).as_bytes();
            if let Some(last_node_modules_folder) = strings::last_index_of(file.path, nm_seg) {
                let node_modules_folder_offset = last_node_modules_folder + nm_seg.len();
                // Determine the package name by looking at the next separator
                if let Some(package_name_length) = strings::index_of_char(&file.path[node_modules_folder_offset..], SEP) {
                    if let Ok(Some(package_dir_info_ptr)) = self.dir_info_cached(&file.path[0..node_modules_folder_offset + package_name_length as usize]) {
                        // SAFETY: ARENA — DirInfo ptr is a BSSMap slot and outlives the resolver (see LIFETIMES.tsv).
                        if let Some(package_json) = unsafe { &*package_dir_info_ptr }.package_json {
                            return Some(MatchResult {
                                path_pair: PathPair { primary: Path::init(file.path), secondary: None },
                                diff_case: file.diff_case,
                                dirname_fd: file.dirname_fd,
                                package_json: Some(package_json as *const _),
                                file_fd: file.file_fd,
                                ..Default::default()
                            });
                        }
                    }
                }
            }

            if cfg!(debug_assertions) {
                debug_assert!(bun_paths::is_absolute(file.path));
            }

            return Some(MatchResult {
                path_pair: PathPair { primary: Path::init(file.path), secondary: None },
                diff_case: file.diff_case,
                dirname_fd: file.dirname_fd,
                file_fd: file.file_fd,
                ..Default::default()
            });
        }

        // Is this a directory?
        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!("Attempting to load \"{}\" as a directory", bstr::BStr::new(path)));
            debug.increase_indent();
        }
        // defer if (r.debug_logs) |*debug| debug.decreaseIndent();
        macro_rules! dec_ret {
            ($e:expr) => {{
                if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                return $e;
            }};
        }

        let dir_info_ptr = match self.dir_info_cached(path) {
            Ok(Some(d)) => d,
            Ok(None) => dec_ret!(None),
            Err(err) => {
                #[cfg(debug_assertions)]
                Output::pretty_errorln(format_args!("err: {} reading {}", err.name(), bstr::BStr::new(path)));
                dec_ret!(None);
            }
        };
        // SAFETY: ARENA — DirInfo ptr is a BSSMap slot; uniquely re-borrowed mutably (see LIFETIMES.tsv).
        let dir_info = unsafe { &mut *dir_info_ptr };
        let mut package_json: Option<*const PackageJSON> = None;

        // Try using the main field(s) from "package.json"
        if let Some(pkg_json) = dir_info.package_json {
            package_json = Some(pkg_json as *const _);
            if pkg_json.main_fields.count() > 0 {
                let main_field_values = &pkg_json.main_fields;
                let main_field_keys = self.opts.main_fields;
                // TODO: check this works right. Not sure this will really work.
                let auto_main = self.opts.main_fields.as_ptr()
                    == options::Target::DEFAULT_MAIN_FIELDS.get(self.opts.target).as_ptr();

                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!(
                        "Searching for main fields in \"{}\"",
                        bstr::BStr::new(pkg_json.source.path.text())
                    ));
                }

                for key in main_field_keys.iter() {
                    let field_rel_path = match main_field_values.get(key) {
                        Some(v) => v,
                        None => {
                            if let Some(debug) = self.debug_logs.as_mut() {
                                debug.add_note_fmt(format_args!("Did not find main field \"{}\"", bstr::BStr::new(key)));
                            }
                            continue;
                        }
                    };

                    let mut _result = match self.load_from_main_field(
                        path,
                        dir_info,
                        field_rel_path,
                        key,
                        if *key == b"main" { self.opts.main_field_extension_order } else { extension_order },
                    ) {
                        Some(r) => r,
                        None => continue,
                    };

                    // If the user did not manually configure a "main" field order, then
                    // use a special per-module automatic algorithm to decide whether to
                    // use "module" or "main" based on whether the package is imported
                    // using "import" or "require".
                    if auto_main && *key == b"module" {
                        let mut absolute_result: Option<MatchResult> = None;

                        if let Some(main_rel_path) = main_field_values.get(b"main".as_slice()) {
                            if !main_rel_path.is_empty() {
                                absolute_result = self.load_from_main_field(path, dir_info, main_rel_path, b"main", self.opts.main_field_extension_order);
                            }
                        } else {
                            // Some packages have a "module" field without a "main" field but
                            // still have an implicit "index.js" file. In that case, treat that
                            // as the value for "main".
                            absolute_result = self.load_as_index_with_browser_remapping(dir_info, path, self.opts.main_field_extension_order);
                        }

                        if let Some(auto_main_result) = absolute_result {
                            // If both the "main" and "module" fields exist, use "main" if the
                            // path is for "require" and "module" if the path is for "import".
                            // If we're using "module", return enough information to be able to
                            // fall back to "main" later if something ended up using "require()"
                            // with this same path. The goal of this code is to avoid having
                            // both the "module" file and the "main" file in the bundle at the
                            // same time.
                            //
                            // Additionally, if this is for the runtime, use the "main" field.
                            // If it doesn't exist, the "module" field will be used.
                            if self.prefer_module_field && kind != ast::ImportKind::Require {
                                if let Some(debug) = self.debug_logs.as_mut() {
                                    debug.add_note_fmt(format_args!(
                                        "Resolved to \"{}\" using the \"module\" field in \"{}\"",
                                        bstr::BStr::new(auto_main_result.path_pair.primary.text()),
                                        bstr::BStr::new(pkg_json.source.path.text())
                                    ));
                                    debug.add_note_fmt(format_args!(
                                        "The fallback path in case of \"require\" is {}",
                                        bstr::BStr::new(auto_main_result.path_pair.primary.text())
                                    ));
                                }

                                dec_ret!(Some(MatchResult {
                                    path_pair: PathPair {
                                        primary: _result.path_pair.primary,
                                        secondary: Some(auto_main_result.path_pair.primary),
                                    },
                                    diff_case: _result.diff_case,
                                    dirname_fd: _result.dirname_fd,
                                    package_json,
                                    file_fd: auto_main_result.file_fd,
                                    ..Default::default()
                                }));
                            } else {
                                if let Some(debug) = self.debug_logs.as_mut() {
                                    debug.add_note_fmt(format_args!(
                                        "Resolved to \"{}\" using the \"{}\" field in \"{}\"",
                                        bstr::BStr::new(auto_main_result.path_pair.primary.text()),
                                        bstr::BStr::new(key),
                                        bstr::BStr::new(pkg_json.source.path.text())
                                    ));
                                }
                                let mut _auto_main_result = auto_main_result;
                                _auto_main_result.package_json = package_json;
                                dec_ret!(Some(_auto_main_result));
                            }
                        }
                    }

                    _result.package_json = _result.package_json.or(package_json);
                    dec_ret!(Some(_result));
                }
            }
        }

        // Look for an "index" file with known extensions
        if let Some(res) = self.load_as_index_with_browser_remapping(dir_info, path, extension_order) {
            let mut res_copy = res;
            res_copy.package_json = res_copy.package_json.or(package_json);
            dec_ret!(Some(res_copy));
        }

        dec_ret!(None);
    }

    pub fn load_as_file(&mut self, path: &[u8], extension_order: &[&'static [u8]]) -> Option<LoadResult> {
        let rfs: &mut Fs::file_system::RealFS = &mut self.fs.fs;

        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!("Attempting to load \"{}\" as a file", bstr::BStr::new(path)));
            debug.increase_indent();
        }
        macro_rules! dec_ret {
            ($e:expr) => {{
                if let Some(d) = self.debug_logs.as_mut() { d.decrease_indent(); }
                return $e;
            }};
        }

        let dir_path = strings::without_trailing_slash_windows_path(Dirname::dirname(path));

        let dir_entry = match rfs.read_directory(dir_path, None, self.generation, self.store_fd) {
            Ok(e) => e,
            Err(_) => dec_ret!(None),
        };

        if let Fs::file_system::real_fs::EntriesOption::Err(err) = dir_entry {
            match err.original_err {
                e if e == bun_core::err!("ENOENT")
                    || e == bun_core::err!("FileNotFound")
                    || e == bun_core::err!("ENOTDIR")
                    || e == bun_core::err!("NotDir") => {}
                _ => {
                    let _ = self.log.add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "Cannot read directory \"{}\": {}",
                            bstr::BStr::new(dir_path),
                            err.original_err.name()
                        ),
                    );
                }
            }
            dec_ret!(None);
        }

        let entries = dir_entry.entries();

        let base = bun_paths::basename(path);

        // Try the plain path without any extensions
        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!("Checking for file \"{}\" ", bstr::BStr::new(base)));
        }

        if let Some(query) = entries.get(base) {
            if query.entry.kind(rfs, self.store_fd) == Fs::file_system::EntryKind::File {
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!("Found file \"{}\" ", bstr::BStr::new(base)));
                }

                let abs_path: &[u8] = {
                    if query.entry.abs_path.is_empty() {
                        let abs_path_parts = [query.entry.dir, query.entry.base()];
                        query.entry.abs_path = PathString::init(
                            self.fs.dirname_store.append_slice(self.fs.abs_buf(&abs_path_parts, bufs!(load_as_file))).expect("unreachable"),
                        );
                    }
                    query.entry.abs_path.slice()
                };

                dec_ret!(Some(LoadResult {
                    path: abs_path,
                    diff_case: query.diff_case,
                    dirname_fd: entries.fd,
                    file_fd: query.entry.cache.fd,
                    dir_info: None,
                }));
            }
        }

        // Try the path with extensions
        bufs!(load_as_file)[..path.len()].copy_from_slice(path);
        for ext in extension_order {
            if let Some(result) = self.load_extension(base, path, ext, entries) {
                dec_ret!(Some(result));
            }
        }

        for ext in self.opts.extra_cjs_extensions.iter() {
            if let Some(result) = self.load_extension(base, path, ext, entries) {
                dec_ret!(Some(result));
            }
        }

        // TypeScript-specific behavior: if the extension is ".js" or ".jsx", try
        // replacing it with ".ts" or ".tsx". At the time of writing this specific
        // behavior comes from the function "loadModuleFromFile()" in the file
        // "moduleNameThisResolver.ts" in the TypeScript compiler source code. It
        // contains this comment:
        //
        //   If that didn't work, try stripping a ".js" or ".jsx" extension and
        //   replacing it with a TypeScript one; e.g. "./foo.js" can be matched
        //   by "./foo.ts" or "./foo.d.ts"
        //
        // We don't care about ".d.ts" files because we can't do anything with
        // those, so we ignore that part of the behavior.
        //
        // See the discussion here for more historical context:
        // https://github.com/microsoft/TypeScript/issues/4595
        if let Some(last_dot) = strings::last_index_of_char(base, b'.') {
            let ext = &base[last_dot..base.len()];
            if (ext == b".js" || ext == b".jsx" || ext == b".mjs")
                && (!FeatureFlags::DISABLE_AUTO_JS_TO_TS_IN_NODE_MODULES || !strings::path_contains_node_modules_folder(path))
            {
                let segment = &base[0..last_dot];
                let tail = &mut bufs!(load_as_file)[path.len() - base.len()..];
                tail[..segment.len()].copy_from_slice(segment);

                let exts: &[&[u8]] = if ext == b".mjs" {
                    &[b".mts"]
                } else {
                    &[b".ts", b".tsx", b".mts"]
                };

                for ext_to_replace in exts {
                    let buffer = &mut tail[0..segment.len() + ext_to_replace.len()];
                    buffer[segment.len()..].copy_from_slice(ext_to_replace);

                    if let Some(query) = entries.get(&buffer[..]) {
                        if query.entry.kind(rfs, self.store_fd) == Fs::file_system::EntryKind::File {
                            if let Some(debug) = self.debug_logs.as_mut() {
                                debug.add_note_fmt(format_args!("Rewrote to \"{}\" ", bstr::BStr::new(&buffer[..])));
                            }

                            dec_ret!(Some(LoadResult {
                                path: {
                                    if query.entry.abs_path.is_empty() {
                                        if !query.entry.dir.is_empty() && query.entry.dir[query.entry.dir.len() - 1] == SEP {
                                            let parts: [&[u8]; 2] = [query.entry.dir, &buffer[..]];
                                            query.entry.abs_path = PathString::init(self.fs.filename_store.append_parts(&parts).expect("unreachable"));
                                            // the trailing path CAN be missing here
                                        } else {
                                            let parts: [&[u8]; 3] = [query.entry.dir, SEP_STR.as_bytes(), &buffer[..]];
                                            query.entry.abs_path = PathString::init(self.fs.filename_store.append_parts(&parts).expect("unreachable"));
                                        }
                                    }
                                    query.entry.abs_path.slice()
                                },
                                diff_case: query.diff_case,
                                dirname_fd: entries.fd,
                                file_fd: query.entry.cache.fd,
                                dir_info: None,
                            }));
                        }
                    }
                    if let Some(debug) = self.debug_logs.as_mut() {
                        debug.add_note_fmt(format_args!("Failed to rewrite \"{}\" ", bstr::BStr::new(base)));
                    }
                }
            }
        }

        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!("Failed to find \"{}\" ", bstr::BStr::new(path)));
        }

        if FeatureFlags::WATCH_DIRECTORIES {
            // For existent directories which don't find a match
            // Start watching it automatically,
            if let Some(watcher) = self.watcher.as_ref() {
                watcher.watch(entries.dir, entries.fd);
            }
        }
        dec_ret!(None);
    }

    fn load_extension(
        &mut self,
        base: &[u8],
        path: &[u8],
        ext: &[u8],
        entries: &mut Fs::file_system::DirEntry,
    ) -> Option<LoadResult> {
        let rfs: &mut Fs::file_system::RealFS = &mut self.fs.fs;
        let buffer = &mut bufs!(load_as_file)[0..path.len() + ext.len()];
        buffer[path.len()..].copy_from_slice(ext);
        let file_name = &buffer[path.len() - base.len()..buffer.len()];

        if let Some(debug) = self.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!("Checking for file \"{}\" ", bstr::BStr::new(&buffer[..])));
        }

        if let Some(query) = entries.get(file_name) {
            if query.entry.kind(rfs, self.store_fd) == Fs::file_system::EntryKind::File {
                if let Some(debug) = self.debug_logs.as_mut() {
                    debug.add_note_fmt(format_args!("Found file \"{}\" ", bstr::BStr::new(&buffer[..])));
                }

                // now that we've found it, we allocate it.
                return Some(LoadResult {
                    path: {
                        query.entry.abs_path = if query.entry.abs_path.is_empty() {
                            PathString::init(self.fs.dirname_store.append_slice(&buffer[..]).expect("unreachable"))
                        } else {
                            query.entry.abs_path
                        };
                        query.entry.abs_path.slice()
                    },
                    diff_case: query.diff_case,
                    dirname_fd: entries.fd,
                    file_fd: query.entry.cache.fd,
                    dir_info: None,
                });
            }
        }

        None
    }

    fn dir_info_uncached(
        &mut self,
        info: *mut DirInfo::DirInfo,
        path: &'static [u8],
        _entries: &mut Fs::file_system::real_fs::EntriesOption,
        _result: allocators::Result,
        dir_entry_index: allocators::IndexType,
        parent: Option<*mut DirInfo::DirInfo>,
        parent_index: allocators::IndexType,
        fd: FD,
        package_id: Option<Install::PackageID>,
    ) -> core::result::Result<(), bun_core::Error> {
        let result = _result;

        let rfs: &mut Fs::file_system::RealFS = &mut self.fs.fs;
        let entries = _entries.entries_mut();

        if cfg!(debug_assertions) {
            // `path` is stored in the permanent `dir_cache` as `DirInfo.abs_path`. It must not
            // point into a reused threadlocal scratch buffer, or a later resolution will
            // corrupt cached entries. Callers must intern it (e.g. via `DirnameStore`) first.
            bun_core::assertf!(
                !allocators::is_slice_in_buffer(path, bufs!(path_in_global_disk_cache).as_slice()),
                "DirInfo.abs_path must not point into the threadlocal path_in_global_disk_cache buffer (got \"{}\")",
                bstr::BStr::new(path)
            );
        }

        // SAFETY: info is a slot in the BSSMap-backed dir_cache
        let info = unsafe { &mut *info };
        *info = DirInfo::DirInfo {
            abs_path: path,
            // .abs_real_path = path,
            parent: parent_index,
            entries: dir_entry_index,
            ..Default::default()
        };

        // A "node_modules" directory isn't allowed to directly contain another "node_modules" directory
        let mut base = bun_paths::basename(path);

        // base must
        if base.len() > 1 && base[base.len() - 1] == SEP {
            base = &base[0..base.len() - 1];
        }

        info.flags.set_present(DirInfo::Flag::IsNodeModules, base == b"node_modules");

        // if (entries != null) {
        if !info.is_node_modules() {
            if let Some(entry) = entries.get_comptime_query(b"node_modules") {
                info.flags.set_present(DirInfo::Flag::HasNodeModules, entry.entry.kind(rfs, self.store_fd) == Fs::file_system::EntryKind::Dir);
            }
        }

        if self.care_about_bin_folder {
            'append_bin_dir: {
                if info.has_node_modules() {
                    if entries.has_comptime_query(b"node_modules") {
                        // SAFETY: BIN_FOLDERS guarded by BIN_FOLDERS_LOCK below
                        unsafe {
                            if !BIN_FOLDERS_LOADED {
                                BIN_FOLDERS_LOADED = true;
                                BIN_FOLDERS = BinFolderArray::new();
                            }
                        }

                        // TODO(port): std.fs.Dir.openDirZ → bun_sys
                        let Ok(file) = bun_sys::open_dir_z(fd, bun_paths::path_literal(b"node_modules/.bin"), Default::default()) else {
                            break 'append_bin_dir;
                        };
                        let _close = scopeguard::guard((), |_| file.close());
                        let Ok(bin_path) = file.get_fd_path(bufs!(node_bin_path)) else {
                            break 'append_bin_dir;
                        };
                        BIN_FOLDERS_LOCK.lock();
                        let _unlock = scopeguard::guard((), |_| BIN_FOLDERS_LOCK.unlock());

                        // SAFETY: BIN_FOLDERS guarded by BIN_FOLDERS_LOCK acquired above.
                        unsafe {
                            for existing_folder in BIN_FOLDERS.const_slice() {
                                if *existing_folder == bin_path {
                                    break 'append_bin_dir;
                                }
                            }

                            let Ok(stored) = self.fs.dirname_store.append_slice(bin_path) else {
                                break 'append_bin_dir;
                            };
                            let _ = BIN_FOLDERS.append(stored);
                        }
                    }
                }

                if info.is_node_modules() {
                    if let Some(q) = entries.get_comptime_query(b".bin") {
                        if q.entry.kind(rfs, self.store_fd) == Fs::file_system::EntryKind::Dir {
                            // SAFETY: BIN_FOLDERS_LOADED is single-thread init-once; protected by RESOLVER_MUTEX held by callers.
                            unsafe {
                                if !BIN_FOLDERS_LOADED {
                                    BIN_FOLDERS_LOADED = true;
                                    BIN_FOLDERS = BinFolderArray::new();
                                }
                            }

                            let Ok(file) = bun_sys::open_dir_z(fd, b".bin\0", Default::default()) else {
                                break 'append_bin_dir;
                            };
                            let _close = scopeguard::guard((), |_| file.close());
                            let Ok(bin_path) = bun_sys::get_fd_path(file, bufs!(node_bin_path)) else {
                                break 'append_bin_dir;
                            };
                            BIN_FOLDERS_LOCK.lock();
                            let _unlock = scopeguard::guard((), |_| BIN_FOLDERS_LOCK.unlock());

                            // SAFETY: BIN_FOLDERS guarded by BIN_FOLDERS_LOCK acquired above.
                            unsafe {
                                for existing_folder in BIN_FOLDERS.const_slice() {
                                    if *existing_folder == bin_path {
                                        break 'append_bin_dir;
                                    }
                                }

                                let Ok(stored) = self.fs.dirname_store.append_slice(bin_path) else {
                                    break 'append_bin_dir;
                                };
                                let _ = BIN_FOLDERS.append(stored);
                            }
                        }
                    }
                }
            }
        }
        // }

        if let Some(parent_ptr) = parent {
            // SAFETY: ARENA — parent DirInfo ptr is a BSSMap slot and outlives the resolver (see LIFETIMES.tsv).
            let parent_ = unsafe { &*parent_ptr };
            // Propagate the browser scope into child directories
            info.enclosing_browser_scope = parent_.enclosing_browser_scope;
            info.package_json_for_browser_field = parent_.package_json_for_browser_field;
            info.enclosing_tsconfig_json = parent_.enclosing_tsconfig_json;

            if let Some(parent_package_json) = parent_.package_json {
                // https://github.com/oven-sh/bun/issues/229
                if !parent_package_json.name.is_empty() || self.care_about_bin_folder {
                    info.enclosing_package_json = Some(parent_package_json);
                }

                if parent_package_json.dependencies.map.count() > 0
                    || parent_package_json.package_manager_package_id != Install::INVALID_PACKAGE_ID
                {
                    info.package_json_for_dependencies = Some(parent_package_json);
                }
            }

            info.enclosing_package_json = info.enclosing_package_json.or(parent_.enclosing_package_json);
            info.package_json_for_dependencies = info.package_json_for_dependencies.or(parent_.package_json_for_dependencies);

            // Make sure "absRealPath" is the real path of the directory (resolving any symlinks)
            if !self.opts.preserve_symlinks {
                if let Some(parent_entries) = parent_.get_entries(self.generation) {
                    if let Some(lookup) = parent_entries.get(base) {
                        if entries.fd.is_valid() && !lookup.entry.cache.fd.is_valid() && self.store_fd {
                            lookup.entry.cache.fd = entries.fd;
                        }
                        let entry = &lookup.entry;

                        let mut symlink = entry.symlink(rfs, self.store_fd);
                        if !symlink.is_empty() {
                            if let Some(logs) = self.debug_logs.as_mut() {
                                let mut buf = Vec::new();
                                write!(&mut buf, "Resolved symlink \"{}\" to \"{}\"", bstr::BStr::new(path), bstr::BStr::new(symlink)).ok();
                                logs.add_note(buf);
                            }
                            info.abs_real_path = symlink;
                        } else if !parent_.abs_real_path.is_empty() {
                            // this might leak a little i'm not sure
                            let parts = [parent_.abs_real_path, base];
                            symlink = self.fs.dirname_store.append_slice(self.fs.abs_buf(&parts, bufs!(dir_info_uncached_filename))).expect("unreachable");

                            if let Some(logs) = self.debug_logs.as_mut() {
                                let mut buf = Vec::new();
                                write!(&mut buf, "Resolved symlink \"{}\" to \"{}\"", bstr::BStr::new(path), bstr::BStr::new(symlink)).ok();
                                logs.add_note(buf);
                            }
                            lookup.entry.cache.symlink = PathString::init(symlink);
                            info.abs_real_path = symlink;
                        }
                    }
                }
            }

            if parent_.is_node_modules() || parent_.is_inside_node_modules() {
                info.flags.set_present(DirInfo::Flag::InsideNodeModules, true);
            }
        }

        // Record if this directory has a package.json file
        if self.opts.load_package_json {
            if let Some(lookup) = entries.get_comptime_query(b"package.json") {
                let entry = &lookup.entry;
                if entry.kind(rfs, self.store_fd) == Fs::file_system::EntryKind::File {
                    info.package_json = if self.use_package_manager() && !info.has_node_modules() && !info.is_node_modules() {
                        self.parse_package_json::<true>(path, if FeatureFlags::STORE_FILE_DESCRIPTORS { fd } else { FD::INVALID }, package_id).ok().flatten()
                    } else {
                        self.parse_package_json::<false>(path, if FeatureFlags::STORE_FILE_DESCRIPTORS { fd } else { FD::INVALID }, None).ok().flatten()
                    };

                    if let Some(pkg) = info.package_json {
                        if pkg.browser_map.count() > 0 {
                            info.enclosing_browser_scope = result.index;
                            info.package_json_for_browser_field = Some(pkg);
                        }

                        if !pkg.name.is_empty() || self.care_about_bin_folder {
                            info.enclosing_package_json = Some(pkg);
                        }

                        if pkg.dependencies.map.count() > 0 || pkg.package_manager_package_id != Install::INVALID_PACKAGE_ID {
                            info.package_json_for_dependencies = Some(pkg);
                        }

                        if let Some(logs) = self.debug_logs.as_mut() {
                            logs.add_note_fmt(format_args!("Resolved package.json in \"{}\"", bstr::BStr::new(path)));
                        }
                    }
                }
            }
        }

        // Record if this directory has a tsconfig.json or jsconfig.json file
        if self.opts.load_tsconfig_json {
            let mut tsconfig_path: Option<&[u8]> = None;
            if self.opts.tsconfig_override.is_none() {
                if let Some(lookup) = entries.get_comptime_query(b"tsconfig.json") {
                    let entry = &lookup.entry;
                    if entry.kind(rfs, self.store_fd) == Fs::file_system::EntryKind::File {
                        let parts = [path, b"tsconfig.json".as_slice()];
                        tsconfig_path = Some(self.fs.abs_buf(&parts, bufs!(dir_info_uncached_filename)));
                    }
                }
                if tsconfig_path.is_none() {
                    if let Some(lookup) = entries.get_comptime_query(b"jsconfig.json") {
                        let entry = &lookup.entry;
                        if entry.kind(rfs, self.store_fd) == Fs::file_system::EntryKind::File {
                            let parts = [path, b"jsconfig.json".as_slice()];
                            tsconfig_path = Some(self.fs.abs_buf(&parts, bufs!(dir_info_uncached_filename)));
                        }
                    }
                }
            } else if parent.is_none() {
                tsconfig_path = self.opts.tsconfig_override.as_deref();
            }

            if let Some(tsconfigpath) = tsconfig_path {
                info.tsconfig_json = match self.parse_tsconfig(
                    tsconfigpath,
                    if FeatureFlags::STORE_FILE_DESCRIPTORS { fd } else { FD::ZERO },
                ) {
                    Ok(v) => v,
                    Err(err) => {
                        let pretty = tsconfigpath;
                        if err == bun_core::err!("ENOENT") || err == bun_core::err!("FileNotFound") {
                            let _ = self.log.add_error_fmt(None, logger::Loc::EMPTY, format_args!("Cannot find tsconfig file {}", bun_core::fmt::QuotedFormatter::new(pretty)));
                        } else if err != bun_core::err!("ParseErrorAlreadyLogged") && err != bun_core::err!("IsDir") && err != bun_core::err!("EISDIR") {
                            let _ = self.log.add_error_fmt(None, logger::Loc::EMPTY, format_args!("Cannot read file {}: {}", bun_core::fmt::QuotedFormatter::new(pretty), err.name()));
                        }
                        None
                    }
                };
                if let Some(tsconfig_json) = info.tsconfig_json {
                    let mut parent_configs: BoundedArray<*mut TSConfigJSON, 64> = BoundedArray::new();
                    parent_configs.append(tsconfig_json)?;
                    let mut current = tsconfig_json;
                    // SAFETY: (loop-wide) `current`/`parent_config_ptr`/`merged_config` are heap
                    // TSConfigJSON allocations from `parse_tsconfig` (Box::into_raw). They are uniquely
                    // owned by this extends-chain walk and freed via Box::from_raw below.
                    while !unsafe { &*current }.extends.is_empty() {
                        // SAFETY: see loop-wide note above.
                        let ts_dir_name = Dirname::dirname(unsafe { &*current }.abs_path);
                        // SAFETY: see loop-wide note above.
                        let abs_path = ResolvePath::join_abs_string_buf(ts_dir_name, bufs!(tsconfig_path_abs), &[ts_dir_name, unsafe { &*current }.extends], bun_paths::Platform::Auto);
                        let parent_config_maybe = match self.parse_tsconfig(abs_path, FD::INVALID) {
                            Ok(v) => v,
                            Err(err) => {
                                let _ = self.log.add_debug_fmt(None, logger::Loc::EMPTY, format_args!(
                                    "{} loading tsconfig.json extends {}",
                                    err.name(),
                                    bun_core::fmt::QuotedFormatter::new(abs_path)
                                ));
                                break;
                            }
                        };
                        if let Some(parent_config) = parent_config_maybe {
                            parent_configs.append(parent_config)?;
                            current = parent_config;
                        } else {
                            break;
                        }
                    }

                    let mut merged_config = parent_configs.pop().unwrap();
                    // starting from the base config (end of the list)
                    // successively apply the inheritable attributes to the next config
                    while let Some(parent_config_ptr) = parent_configs.pop() {
                        // SAFETY: see loop-wide note above.
                        let parent_config = unsafe { &mut *parent_config_ptr };
                        // SAFETY: see loop-wide note above.
                        let mc = unsafe { &mut *merged_config };
                        mc.emit_decorator_metadata = mc.emit_decorator_metadata || parent_config.emit_decorator_metadata;
                        if !parent_config.base_url.is_empty() {
                            mc.base_url = parent_config.base_url;
                        }
                        mc.jsx = parent_config.merge_jsx(mc.jsx.clone());
                        mc.jsx_flags.set_union(parent_config.jsx_flags);

                        if let Some(value) = parent_config.preserve_imports_not_used_as_values {
                            mc.preserve_imports_not_used_as_values = Some(value);
                        }

                        // TypeScript replaces paths across extends (child overrides parent
                        // entirely), so when a more-specific config defines paths, replace
                        // rather than merge. base_url_for_paths is set whenever the paths
                        // key is present in the JSON (even if empty), so it discriminates
                        // "not defined" from "defined as {}" — the latter clears inherited
                        // paths per TypeScript semantics.
                        if !parent_config.base_url_for_paths.is_empty() {
                            // The previous merged_config.paths is being replaced; free its
                            // backing storage before overwriting so the PathsMap from the
                            // deeper config doesn't leak. Each value is a []string slice
                            // that was separately heap-allocated in TSConfigJSON.parse()
                            // (tsconfig_json.zig), so free those before the map itself.
                            // (In Rust, dropping the map frees values automatically.)
                            mc.paths = core::mem::take(&mut parent_config.paths);
                            mc.base_url_for_paths = parent_config.base_url_for_paths;
                        } else {
                            // paths were not moved to merged_config, so they're still owned
                            // by parent_config. base_url_for_paths.len == 0 implies the map
                            // is empty (it's only set when the `paths` key is present in the
                            // JSON), so this is a no-op but documents the ownership.
                            // (Drop handles parent_config.paths.)
                        }
                        // Every scalar/reference we need has been copied into merged_config
                        // (strings live in dirname_store or default_allocator and outlive the
                        // struct). The heap-allocated TSConfigJSON itself is no longer needed;
                        // without this, every intermediate config in an extends chain leaks on
                        // each dirInfoUncached() call, which is especially bad under HMR where
                        // bustDirCache triggers a re-parse of the whole chain on every reload.
                        // SAFETY: parent_config came from PackageJSON::new (Box::into_raw)
                        drop(unsafe { Box::from_raw(parent_config_ptr) });
                    }
                    // SAFETY: `merged_config` is a leaked Box (Box::into_raw) interned into DirInfo; outlives the resolver.
                    info.tsconfig_json = Some(unsafe { &mut *merged_config });
                }
                info.enclosing_tsconfig_json = info.tsconfig_json.map(|p| &*p);
            }
        }

        Ok(())
    }
}

impl<'a> Drop for Resolver<'a> {
    fn drop(&mut self) {
        // pub fn deinit(r: *ThisResolver) void
        for _di in self.dir_cache.values_mut() {
            // TODO(port): DirInfo.deinit() closes cached FDs (side effect, not just freeing) —
            // must port `di.close_fds()` before this Drop is correct. Do NOT ship without it.
        }
        // dir_cache is &'static — do not deinit the singleton here
        // TODO(port): Zig calls dir_cache.deinit() but it's a global BSSMap; revisit ownership
    }
}

// ─── nested helper types ───────────────────────────────────────────────────

enum DependencyToResolve {
    NotFound,
    Pending(PendingResolution),
    Failure(bun_core::Error),
    Resolution(Resolution),
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum BrowserMapPathKind {
    PackagePath,
    AbsolutePath,
}

pub struct BrowserMapPath<'b> {
    pub remapped: &'static [u8],
    pub cleaned: &'b [u8],
    pub input_path: &'b [u8],
    pub extension_order: &'static [&'static [u8]],
    pub map: &'b BrowserMap,
}

impl<'b> BrowserMapPath<'b> {
    pub fn check_path(&mut self, path_to_check: &[u8]) -> bool {
        let map = self.map;

        let cleaned = self.cleaned;
        // Check for equality
        if let Some(result) = map.get(path_to_check) {
            self.remapped = result;
            // SAFETY: TODO(port): lifetime — extending borrow of caller-owned slice; consumed before checker is dropped.
            self.input_path = unsafe { &*(path_to_check as *const [u8]) };
            return true;
        }

        let ext_buf = bufs!(extension_path);

        if cleaned.len() <= ext_buf.len() {
            ext_buf[..cleaned.len()].copy_from_slice(cleaned);

            // If that failed, try adding implicit extensions
            for ext in self.extension_order {
                if cleaned.len() + ext.len() > ext_buf.len() {
                    continue;
                }
                ext_buf[cleaned.len()..cleaned.len() + ext.len()].copy_from_slice(ext);
                let new_path = &ext_buf[0..cleaned.len() + ext.len()];
                // if let Some(debug) = r.debug_logs.as_mut() {
                //     debug.add_note_fmt(format_args!("Checking for \"{}\" ", bstr::BStr::new(new_path)));
                // }
                if let Some(_remapped) = map.get(new_path) {
                    self.remapped = _remapped;
                    // SAFETY: TODO(port): lifetime — `new_path` borrows the threadlocal `extension_path` buf; consumed before next overwrite.
                    self.cleaned = unsafe { &*(new_path as *const [u8]) };
                    // SAFETY: same as above.
                    self.input_path = unsafe { &*(new_path as *const [u8]) };
                    return true;
                }
            }
        }

        // If that failed, try assuming this is a directory and looking for an "index" file

        let index_path: &[u8] = {
            let trimmed = strings::trim_right(path_to_check, &[SEP]);
            let parts = [trimmed, const_format::concatcp!(SEP_STR, "index").as_bytes()];
            ResolvePath::join_string_buf(bufs!(tsconfig_base_url), &parts, bun_paths::Platform::Auto)
        };

        if let Some(_remapped) = map.get(index_path) {
            self.remapped = _remapped;
            // SAFETY: TODO(port): lifetime — `index_path` borrows the threadlocal `extension_path` buf; consumed before next overwrite.
            self.input_path = unsafe { &*(index_path as *const [u8]) };
            return true;
        }

        if index_path.len() <= ext_buf.len() {
            ext_buf[..index_path.len()].copy_from_slice(index_path);

            for ext in self.extension_order {
                if index_path.len() + ext.len() > ext_buf.len() {
                    continue;
                }
                ext_buf[index_path.len()..index_path.len() + ext.len()].copy_from_slice(ext);
                let new_path = &ext_buf[0..index_path.len() + ext.len()];
                // if let Some(debug) = r.debug_logs.as_mut() {
                //     debug.add_note_fmt(format_args!("Checking for \"{}\" ", bstr::BStr::new(new_path)));
                // }
                if let Some(_remapped) = map.get(new_path) {
                    self.remapped = _remapped;
                    // SAFETY: TODO(port): lifetime — `new_path` borrows the threadlocal `extension_path` buf; consumed before next overwrite.
                    self.cleaned = unsafe { &*(new_path as *const [u8]) };
                    // SAFETY: same as above.
                    self.input_path = unsafe { &*(new_path as *const [u8]) };
                    return true;
                }
            }
        }

        false
    }
}

#[inline]
fn is_dot_slash(path: &[u8]) -> bool {
    #[cfg(not(windows))]
    {
        path == b"./"
    }
    #[cfg(windows)]
    {
        path.len() == 2 && path[0] == b'.' && strings::char_is_any_slash(path[1])
    }
}

// ModuleTypeMap = bun.ComptimeStringMap(options.ModuleType, .{...})
static MODULE_TYPE_MAP: phf::Map<&'static [u8], options::ModuleType> = phf::phf_map! {
    b".mjs" => options::ModuleType::Esm,
    b".mts" => options::ModuleType::Esm,
    b".cjs" => options::ModuleType::Cjs,
    b".cts" => options::ModuleType::Cjs,
};

const NODE_MODULE_ROOT_STRING: &[u8] = const_format::concatcp!(SEP_STR, "node_modules", SEP_STR).as_bytes();

// `dev` scope (Output.scoped(.Resolver, .visible)) — same scope name as `debuglog` but visible.
// Folded into the same `Resolver` declared scope; visibility distinction handled in Phase B.

pub struct Dirname;

impl Dirname {
    pub fn dirname(path: &[u8]) -> &[u8] {
        if path.is_empty() {
            return SEP_STR.as_bytes();
        }

        let root: &[u8] = {
            #[cfg(windows)]
            {
                let root = ResolvePath::windows_filesystem_root(path);
                // Preserve the trailing slash for UNC paths.
                // Going from `\\server\share\folder` should end up
                // at `\\server\share\`, not `\\server\share`
                if root.len() >= 5 && path.len() > root.len() {
                    &path[0..root.len() + 1]
                } else {
                    root
                }
            }
            #[cfg(not(windows))]
            {
                b"/"
            }
        };

        let mut end_index: usize = path.len() - 1;
        while bun_paths::is_sep_any(path[end_index]) {
            if end_index == 0 {
                return root;
            }
            end_index -= 1;
        }

        while !bun_paths::is_sep_any(path[end_index]) {
            if end_index == 0 {
                return root;
            }
            end_index -= 1;
        }

        if end_index == 0 && bun_paths::is_sep_any(path[0]) {
            return &path[0..1];
        }

        if end_index == 0 {
            return root;
        }

        &path[0..end_index + 1]
    }
}

pub struct RootPathPair<'b> {
    pub base_path: &'b [u8],
    pub package_json: *const PackageJSON,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/resolver/resolver.zig (4388 lines)
//   confidence: low
//   todos:      41
//   notes:      heavy reliance on threadlocal raw bufs + BSSMap-interned ptrs; many `defer` reshapes need scopeguard wiring; PackageManager/ESModule API surface guessed; borrowck will need significant Phase-B reshaping around &mut self + cached *DirInfo. Drop must close DirInfo FDs. ResolveWatcher needs stable-Rust reshape (const fn-ptr generic).
// ──────────────────────────────────────────────────────────────────────────
