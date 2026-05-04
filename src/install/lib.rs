use core::cell::Cell;
use core::fmt;

use bun_alloc::Arena;
use bun_js_parser as js_ast;
use bun_str::ZStr;

// ──────────────────────────────────────────────────────────────────────────
// Module declarations / re-exports (from @import block at bottom of install.zig)
// TODO(port): verify module file paths in Phase B — Zig basenames preserved per
// PORTING.md, so some .rs files keep PascalCase names and may need #[path] attrs.
// ──────────────────────────────────────────────────────────────────────────

pub mod extract_tarball;
pub mod network_task;
pub mod tarball_stream;
pub mod npm;
pub mod package_manager;
pub mod package_manifest_map;
pub mod package_manager_task;
pub mod lockfile;
pub mod bin;
pub mod resolvers;
pub mod lifecycle_script_runner;
pub mod package_install;
pub mod repository;
pub mod resolution;
pub mod isolated_install;
pub mod pnpm_matcher;
pub mod postinstall_optimizer;
pub mod external_slice;
pub mod integrity;
pub mod dependency;
pub mod patch_install;

pub use extract_tarball::ExtractTarball;
pub use network_task::NetworkTask;
pub use tarball_stream::TarballStream;
pub use npm as Npm;
pub use package_manager::PackageManager;
pub use package_manifest_map::PackageManifestMap;
pub use package_manager_task::Task;
pub use lockfile::bun_lock as TextLockfile;
pub use bin::Bin;
pub use resolvers::folder_resolver::FolderResolution;
pub use lifecycle_script_runner::LifecycleScriptSubprocess;
pub use package_manager::security_scanner::SecurityScanSubprocess;
pub use package_install::PackageInstall;
pub use repository::Repository;
pub use resolution::Resolution;
pub use isolated_install::store::Store;
pub use isolated_install::file_copier::FileCopier;
pub use pnpm_matcher::PnpmMatcher;
pub use postinstall_optimizer::PostinstallOptimizer;

pub use bun_collections::identity_context::ArrayIdentityContext;
pub use bun_collections::identity_context::IdentityContext;

pub use external_slice as external;
pub use external::ExternalPackageNameHashList;
pub use external::ExternalSlice;
pub use external::ExternalStringList;
pub use external::ExternalStringMap;
pub use external::VersionSlice;

pub use integrity::Integrity;
pub use dependency::Dependency;
pub use dependency::Behavior;

pub use lockfile::Lockfile;
pub use lockfile::PatchedDep;

pub use patch_install as patch;
pub use patch::PatchTask;

// ──────────────────────────────────────────────────────────────────────────

thread_local! {
    static INITIALIZED_STORE: Cell<bool> = const { Cell::new(false) };
}

pub const BUN_HASH_TAG: &[u8] = b".bun-tag-";

/// Length of `u64::MAX` formatted as lowercase hex (`ffffffffffffffff`).
pub const MAX_HEX_HASH_LEN: usize = {
    // Zig computed this with std.fmt.bufPrint at comptime; u64::MAX in hex is
    // always 16 nibbles.
    let mut n = u64::MAX;
    let mut len = 0usize;
    while n != 0 {
        n >>= 4;
        len += 1;
    }
    len
};
const _: () = assert!(MAX_HEX_HASH_LEN == 16);

pub const MAX_BUNTAG_HASH_BUF_LEN: usize = MAX_HEX_HASH_LEN + BUN_HASH_TAG.len() + 1;
pub type BuntagHashBuf = [u8; MAX_BUNTAG_HASH_BUF_LEN];

pub fn buntaghashbuf_make(buf: &mut BuntagHashBuf, patch_hash: u64) -> &mut ZStr {
    buf[0..BUN_HASH_TAG.len()].copy_from_slice(BUN_HASH_TAG);
    // std.fmt.bufPrint(buf[bun_hash_tag.len..], "{x}", .{patch_hash})
    let digits_len = {
        use std::io::Write;
        let mut cursor = &mut buf[BUN_HASH_TAG.len()..];
        let before = cursor.len();
        write!(cursor, "{:x}", patch_hash).expect("unreachable"); // error.NoSpaceLeft => unreachable
        before - cursor.len()
    };
    buf[BUN_HASH_TAG.len() + digits_len] = 0;
    // SAFETY: buf[BUN_HASH_TAG.len() + digits_len] == 0 written above
    unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), BUN_HASH_TAG.len() + digits_len) }
}

pub struct StorePathFormatter<'a> {
    str: &'a [u8],
}

impl<'a> fmt::Display for StorePathFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // if (!this.opts.replace_slashes) {
        //     try writer.writeAll(this.str);
        //     return;
        // }

        for &c in self.str {
            match c {
                b'/' => f.write_str("+")?,
                b'\\' => f.write_str("+")?,
                _ => write!(f, "{}", bstr::BStr::new(core::slice::from_ref(&c)))?,
            }
        }
        Ok(())
    }
}

pub fn fmt_store_path(str: &[u8]) -> StorePathFormatter<'_> {
    StorePathFormatter { str }
}

// these bytes are skipped
// so we just make it repeat bun bun bun bun bun bun bun bun bun
pub static ALIGNMENT_BYTES_TO_REPEAT_BUFFER: [u8; 144] = [0u8; 144];

pub fn initialize_store() {
    if INITIALIZED_STORE.with(|c| c.get()) {
        js_ast::Expr::Data::Store::reset();
        js_ast::Stmt::Data::Store::reset();
        return;
    }

    INITIALIZED_STORE.with(|c| c.set(true));
    js_ast::Expr::Data::Store::create();
    js_ast::Stmt::Data::Store::create();
}

/// The default store we use pre-allocates around 16 MB of memory per thread
/// That adds up in multi-threaded scenarios.
/// ASTMemoryAllocator uses a smaller fixed buffer allocator
pub fn initialize_mini_store() {
    struct MiniStore {
        heap: Arena,
        memory_allocator: js_ast::ASTMemoryAllocator,
    }

    thread_local! {
        static INSTANCE: Cell<Option<*mut MiniStore>> = const { Cell::new(None) };
    }

    INSTANCE.with(|instance| {
        if instance.get().is_none() {
            let mut heap = Arena::new();
            // TODO(port): ASTMemoryAllocator construction — Zig threads heap.allocator()
            // into the AST allocator; in Rust the Bump (`Arena`) is passed by reference.
            let memory_allocator = js_ast::ASTMemoryAllocator::new(&heap);
            let mini_store = Box::into_raw(Box::new(MiniStore {
                heap,
                memory_allocator,
            }));
            // SAFETY: just allocated, non-null, thread-local exclusive access
            unsafe {
                (*mini_store).memory_allocator.reset();
                (*mini_store).memory_allocator.push();
            }
            instance.set(Some(mini_store));
        } else {
            // SAFETY: set above on this thread, never freed
            let mini_store = unsafe { &mut *instance.get().unwrap() };
            if mini_store
                .memory_allocator
                .stack_allocator
                .fixed_buffer_allocator
                .end_index
                >= mini_store
                    .memory_allocator
                    .stack_allocator
                    .fixed_buffer_allocator
                    .buffer
                    .len()
                    .saturating_sub(1)
            {
                // PERF(port): was arena bulk-free (heap.deinit() + re-init) — profile in Phase B
                mini_store.heap = Arena::new();
                // TODO(port): re-seat memory_allocator.allocator at the new heap
            }
            mini_store.memory_allocator.reset();
            mini_store.memory_allocator.push();
        }
    });
}

pub type PackageID = u32;
pub type DependencyID = u32;

// pub enum DependencyID: u32 {
//     root = max - 1,
//     invalid = max,
//     _,
//
//     const max = u32::MAX;
// }

pub const INVALID_PACKAGE_ID: PackageID = PackageID::MAX;
pub const INVALID_DEPENDENCY_ID: DependencyID = DependencyID::MAX;

pub type PackageNameAndVersionHash = u64;
/// Use String.Builder.stringHash to compute this
pub type PackageNameHash = u64;
/// @truncate String.Builder.stringHash to compute this
pub type TruncatedPackageNameHash = u32;

pub struct Aligner;

impl Aligner {
    pub fn write<T, W: bun_io::Write>(writer: &mut W, pos: usize) -> Result<usize, bun_core::Error> {
        // TODO(port): narrow error set
        let to_write = Self::skip_amount::<T>(pos);

        let remainder: &[u8] =
            &ALIGNMENT_BYTES_TO_REPEAT_BUFFER[0..to_write.min(ALIGNMENT_BYTES_TO_REPEAT_BUFFER.len())];
        writer.write_all(remainder)?;

        Ok(to_write)
    }

    #[inline]
    pub fn skip_amount<T>(pos: usize) -> usize {
        let align = core::mem::align_of::<T>();
        // std.mem.alignForward(usize, pos, align) - pos
        pos.next_multiple_of(align) - pos
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Origin {
    Local = 0,
    Npm = 1,
    Tarball = 2,
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Features {
    pub dependencies: bool,
    pub dev_dependencies: bool,
    pub is_main: bool,
    pub optional_dependencies: bool,
    pub peer_dependencies: bool,
    pub trusted_dependencies: bool,
    pub workspaces: bool,
    pub patched_dependencies: bool,

    pub check_for_duplicate_dependencies: bool,
}

impl Default for Features {
    fn default() -> Self {
        Self {
            dependencies: true,
            dev_dependencies: false,
            is_main: false,
            optional_dependencies: false,
            peer_dependencies: true,
            trusted_dependencies: false,
            workspaces: false,
            patched_dependencies: false,
            check_for_duplicate_dependencies: false,
        }
    }
}

impl Features {
    pub fn behavior(self) -> Behavior {
        let mut out: u8 = 0;
        out |= (self.dependencies as u8) << 1;
        out |= (self.optional_dependencies as u8) << 2;
        out |= (self.dev_dependencies as u8) << 3;
        out |= (self.peer_dependencies as u8) << 4;
        out |= (self.workspaces as u8) << 5;
        // SAFETY: Behavior is #[repr(u8)] / bitflags over u8 in dependency.rs
        // TODO(port): use Behavior::from_bits_retain if Behavior becomes bitflags!
        unsafe { core::mem::transmute::<u8, Behavior>(out) }
    }

    pub const MAIN: Features = Features {
        check_for_duplicate_dependencies: true,
        dev_dependencies: true,
        is_main: true,
        optional_dependencies: true,
        trusted_dependencies: true,
        patched_dependencies: true,
        workspaces: true,
        dependencies: true,
        peer_dependencies: true,
    };

    pub const FOLDER: Features = Features {
        dev_dependencies: true,
        optional_dependencies: true,
        dependencies: true,
        is_main: false,
        peer_dependencies: true,
        trusted_dependencies: false,
        workspaces: false,
        patched_dependencies: false,
        check_for_duplicate_dependencies: false,
    };

    pub const WORKSPACE: Features = Features {
        dev_dependencies: true,
        optional_dependencies: true,
        trusted_dependencies: true,
        dependencies: true,
        is_main: false,
        peer_dependencies: true,
        workspaces: false,
        patched_dependencies: false,
        check_for_duplicate_dependencies: false,
    };

    pub const LINK: Features = Features {
        dependencies: false,
        peer_dependencies: false,
        dev_dependencies: false,
        is_main: false,
        optional_dependencies: false,
        trusted_dependencies: false,
        workspaces: false,
        patched_dependencies: false,
        check_for_duplicate_dependencies: false,
    };

    pub const NPM: Features = Features {
        optional_dependencies: true,
        dependencies: true,
        dev_dependencies: false,
        is_main: false,
        peer_dependencies: true,
        trusted_dependencies: false,
        workspaces: false,
        patched_dependencies: false,
        check_for_duplicate_dependencies: false,
    };

    pub const TARBALL: Features = Self::NPM;

    pub const NPM_MANIFEST: Features = Features {
        optional_dependencies: true,
        dependencies: true,
        dev_dependencies: false,
        is_main: false,
        peer_dependencies: true,
        trusted_dependencies: false,
        workspaces: false,
        patched_dependencies: false,
        check_for_duplicate_dependencies: false,
    };
}

#[repr(u8)] // Zig: enum(u4); u8 is the smallest repr Rust allows
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum PreinstallState {
    Unknown = 0,
    Done,
    Extract,
    Extracting,
    CalcPatchHash,
    CalcingPatchHash,
    ApplyPatch,
    ApplyingPatch,
}

#[derive(Default)]
pub struct ExtractDataJson {
    pub path: Box<[u8]>,
    pub buf: Vec<u8>,
}

#[derive(Default)]
pub struct ExtractData {
    pub url: Box<[u8]>,
    pub resolved: Box<[u8]>,
    pub json: Option<ExtractDataJson>,
    /// Integrity hash computed from the raw tarball bytes.
    /// Used for HTTPS/local tarball dependencies where the hash
    /// is not available from a registry manifest.
    pub integrity: Integrity,
}

pub struct DependencyInstallContext {
    pub tree_id: lockfile::tree::Id,
    pub path: Vec<u8>,
    pub dependency_id: DependencyID,
}

impl DependencyInstallContext {
    pub fn new(dependency_id: DependencyID) -> Self {
        Self {
            tree_id: 0,
            path: Vec::new(),
            dependency_id,
        }
    }
}

pub enum TaskCallbackContext {
    Dependency(DependencyID),
    DependencyInstallContext(DependencyInstallContext),
    IsolatedPackageInstallContext(isolated_install::store::EntryId),
    RootDependency(DependencyID),
    RootRequestId(PackageID),
}

// We can't know all the packages we need until we've downloaded all the packages
// The easy way would be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependencies for resolution
// 2.

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Copy, Clone, Eq, PartialEq)]
pub enum PackageManifestError {
    #[error("PackageManifestHTTP400")]
    PackageManifestHTTP400,
    #[error("PackageManifestHTTP401")]
    PackageManifestHTTP401,
    #[error("PackageManifestHTTP402")]
    PackageManifestHTTP402,
    #[error("PackageManifestHTTP403")]
    PackageManifestHTTP403,
    #[error("PackageManifestHTTP404")]
    PackageManifestHTTP404,
    #[error("PackageManifestHTTP4xx")]
    PackageManifestHTTP4xx,
    #[error("PackageManifestHTTP5xx")]
    PackageManifestHTTP5xx,
}

impl From<PackageManifestError> for bun_core::Error {
    fn from(e: PackageManifestError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/install.zig (295 lines)
//   confidence: medium
//   todos:      5
//   notes:      lib.rs for bun_install crate; module decls/re-exports need Phase B path fixup; ASTMemoryAllocator/Arena interop in initialize_mini_store needs verification
// ──────────────────────────────────────────────────────────────────────────
