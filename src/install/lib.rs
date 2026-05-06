#![allow(unused, nonstandard_style, ambiguous_glob_reexports)]

// ──────────────────────────────────────────────────────────────────────────
// Crate aliases — Phase-A drafts use the porting-doc crate names; map them
// to the real workspace crates here so module bodies stay diff-minimal.
// ──────────────────────────────────────────────────────────────────────────
// Self-alias so Phase-A drafts written against `bun_install::…` resolve
// without rewriting every `use` (e.g. yarn.rs, extract_tarball.rs,
// lifecycle_script_runner.rs).
extern crate self as bun_install;
extern crate bun_string as bun_str;
extern crate bun_sha_hmac as bun_sha;
// `bun_output::declare_scope!` / `scoped_log!` in Phase-A drafts → the macros
// live at `bun_core` crate root (#[macro_export]); alias the crate so the
// `bun_output::` path resolves in un-gated install modules.
extern crate bun_core as bun_output;
extern crate bun_analytics as analytics;
// `bun_simdutf` → real crate is `bun_simdutf_sys`.
extern crate bun_simdutf_sys as bun_simdutf;

/// `bun_schema::api` → schema lives in `bun_options_types::schema::api`.
pub(crate) mod bun_schema {
    pub use bun_options_types::schema::api;
}

/// `bun_json` → JSON parser lives in `bun_interchange::json`; AST nodes
/// (`Expr`, `ExprData`, `E*` variants) live in `bun_logger::js_ast`.
pub(crate) mod bun_json {
    pub use bun_interchange::json::*;
    pub use bun_logger::js_ast::{Expr, ExprData, e as E, expr::Query, G::Property};

    /// Phase-B accessor shim — Zig's `Expr.asString`/`asProperty`/`get` route
    /// through `E.Object`/`E.String`; the T2 `Expr` type only exposes the raw
    /// `data` enum, so add a thin extension trait here so install drafts don't
    /// have to pattern-match at every call site. JSON parse_utf8 always
    /// produces UTF-8 strings, so `as_string` can return the raw slice.
    pub trait ExprAccessors {
        fn as_string(&self) -> Option<&'static [u8]>;
        fn as_property(&self, key: impl AsRef<[u8]>) -> Option<Query>;
        fn get(&self, key: impl AsRef<[u8]>) -> Option<Expr>;
    }
    impl ExprAccessors for Expr {
        #[inline]
        fn as_string(&self) -> Option<&'static [u8]> {
            if let ExprData::EString(s) = &self.data {
                if s.is_utf8() {
                    return Some(s.data);
                }
            }
            None
        }
        #[inline]
        fn as_property(&self, key: impl AsRef<[u8]>) -> Option<Query> {
            if let ExprData::EObject(o) = &self.data { o.as_property(key.as_ref()) } else { None }
        }
        #[inline]
        fn get(&self, key: impl AsRef<[u8]>) -> Option<Expr> {
            // Zig `Expr.get(name)` (src/js_parser/ast/Expr.zig) is sugar over
            // `asProperty(name).?.expr`. Route through the trait's own
            // `as_property` so the `EObject` payload-shape question stays in
            // one place.
            self.as_property(key).map(|q| q.expr)
        }
    }
}

/// `bun_fs` → resolver-tier `FileSystem` is shimmed under `bun_sys::fs`
/// (see MOVE_DOWN(b0) note in src/sys/lib.rs).
pub(crate) mod bun_fs {
    pub use bun_sys::fs::*;
}

/// `bun_progress` → no real crate yet; opaque handle so PackageManager
/// fields type-check. Real impl arrives with the CLI tier.
pub(crate) mod bun_progress {
    #[derive(Default)]
    pub struct Progress;
    #[derive(Default)]
    pub struct Node;
    impl Progress {
        pub fn start(&mut self, _name: &str, _estimated: usize) -> &mut Node {
            todo!("b2-blocked: bun_progress::Progress::start")
        }
        pub fn refresh(&mut self) {}
    }
}

/// `bun_bunfig` → config-loading entrypoint; install only needs the
/// `Arguments` shape for `Transpiler::init` plumbing (gated body).
pub(crate) mod bun_bunfig {
    pub use bun_options_types::Context as Arguments;
}

use core::cell::Cell;
use core::fmt;

// ──────────────────────────────────────────────────────────────────────────
// B-1 gate-and-stub: Phase-A draft modules are preserved on disk but gated
// behind `` so the crate type-checks. Un-gating happens in B-2.
// Each gated module has a sibling stub mod exposing the minimal surface other
// crates / this crate's lib.rs re-exports.
// ──────────────────────────────────────────────────────────────────────────

macro_rules! gated_mod {
    ($vis:vis mod $name:ident = $path:literal ;) => {
        
        #[path = $path]
        $vis mod $name;
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Module declarations (gated) — Zig basenames preserved per PORTING.md, hence
// explicit #[path] attrs for PascalCase files.
// ──────────────────────────────────────────────────────────────────────────

pub mod npm;
 #[path = "PackageManifestMap.rs"]
pub mod package_manifest_map;
 #[path = "resolution.rs"]
pub mod resolution_real;
/// Stub: `resolution.rs` — `Resolution` struct only (used as opaque field in
/// `bun_jsc::AsyncModule::PendingResolution`). Full impl re-gated above
/// (26 errors against `Repository` stub method shapes).
pub mod resolution {
    #[derive(Default, Clone, Copy)]
    pub struct Resolution {
        pub tag: Tag,
        pub _padding: [u8; 7],
        pub value: Value,
    }
    #[derive(Default, Clone, Copy)]
    pub struct Value {
        pub npm: NpmVersionInfo,
        pub git: crate::repository::Repository,
        pub github: crate::repository::Repository,
        pub local_tarball: bun_semver::String,
        pub remote_tarball: bun_semver::String,
        pub folder: bun_semver::String,
        pub workspace: bun_semver::String,
        pub symlink: bun_semver::String,
        pub single_file_module: bun_semver::String,
    }
    #[derive(Default, Clone, Copy)]
    pub struct NpmVersionInfo {
        pub version: bun_semver::Version,
        pub url: bun_semver::String,
    }
    #[derive(Default, Clone, Copy, PartialEq, Eq, Debug)]
    #[repr(u8)]
    pub enum Tag {
        #[default] Uninitialized, Root, Npm, Folder, LocalTarball, Github, Git,
        Symlink, Workspace, RemoteTarball, SingleFileModule,
    }
}
#[path = "PnpmMatcher.rs"]
pub mod pnpm_matcher;
 pub mod postinstall_optimizer;
#[path = "ExternalSlice.rs"]
pub mod external_slice;
pub mod integrity;
pub mod dependency;
#[path = "ConfigVersion.rs"]
pub mod config_version;
pub mod hosted_git_info;
pub mod padding_checker;
pub mod versioned_url;

// ─── reconciler-6: heavy modules re-gated wholesale ────────────────────────
// File bodies preserved on disk under `#![cfg(any())]` (1200+ port errors).
// Declared here under `` so the crate tree is addressable for
// diff-pass; sibling inline stubs below expose the minimal surface that
// `npm.rs`/`resolution.rs`/`dependency.rs` and downstream `bun_jsc` need.
 pub mod extract_tarball;
 #[path = "NetworkTask.rs"] pub mod network_task;
 #[path = "TarballStream.rs"] pub mod tarball_stream;
 #[path = "PackageManager.rs"] pub mod package_manager_real;
 #[path = "PackageManagerTask.rs"] pub mod package_manager_task;
 pub mod lockfile_real;
 pub mod bin_real;
 pub mod lifecycle_script_runner;
 #[path = "PackageInstall.rs"] pub mod package_install;
 #[path = "PackageInstaller.rs"] pub mod package_installer;
 pub mod repository_real;
 pub mod isolated_install;
 pub mod patch_install;
 pub mod hoisted_install;
 pub mod migration;
 pub mod pnpm;
 pub mod yarn;

/// Stub: `repository.rs` — `Repository` struct shape + method stubs read by
/// `resolution.rs` / `dependency.rs`.
pub mod repository {
    use core::cmp::Ordering;
    #[derive(Default, Clone, Copy)]
    pub struct Repository {
        pub owner: bun_semver::String,
        pub repo: bun_semver::String,
        pub committish: bun_semver::String,
        pub resolved: bun_semver::String,
        pub package_name: bun_semver::String,
    }
    impl Repository {
        pub fn parse_append_git<B>(_b: &mut B, _s: bun_semver::SlicedString) -> Self { todo!("phase-b2: Repository::parse_append_git (gated)") }
        pub fn parse_append_github<B>(_b: &mut B, _s: bun_semver::SlicedString) -> Self { todo!("phase-b2: Repository::parse_append_github (gated)") }
        pub fn order(&self, _o: &Self, _a: &[u8], _b: &[u8]) -> Ordering { todo!("phase-b2: Repository::order (gated)") }
        pub fn count<B>(&self, _b: &mut B, _s: &[u8]) { todo!("phase-b2: Repository::count (gated)") }
        pub fn eql(&self, _o: &Self, _a: &[u8], _b: &[u8]) -> bool { todo!("phase-b2: Repository::eql (gated)") }
        pub fn fmt_store_path<W: core::fmt::Write>(&self, _w: &mut W, _s: &[u8]) -> core::fmt::Result { todo!("phase-b2: Repository::fmt_store_path (gated)") }
        pub fn format_as<'a>(&'a self, _label: &'a str, _buf: &'a [u8]) -> impl core::fmt::Display + 'a { struct F; impl core::fmt::Display for F { fn fmt(&self, _: &mut core::fmt::Formatter<'_>) -> core::fmt::Result { todo!("phase-b2: Repository::format_as (gated)") } } F }
        pub fn clone<B>(&self, _b: &mut B, _s: &[u8]) -> Self { todo!("phase-b2: Repository::clone (gated)") }
    }
}
/// Stub: `bin.rs` — `Bin` struct + Value union read by `npm.rs` parse.
pub mod bin {
    #[derive(Default, Clone, Copy)]
    pub struct Bin {
        pub tag: Tag,
        pub value: Value,
        pub _padding_tag: [u8; 3],
    }
    impl Bin {
        pub fn init() -> Self { Self::default() }
    }
    #[derive(Default, Clone, Copy)]
    pub struct Value {
        pub file: bun_semver::String,
        pub named_file: [bun_semver::String; 2],
        pub dir: bun_semver::String,
        pub map: crate::ExternalStringList,
    }
    impl Value {
        pub fn init(_v: impl core::any::Any) -> Self { Self::default() }
        pub fn init_file(_v: bun_semver::String) -> Self { Self::default() }
        pub fn init_named_file(_v: [bun_semver::String; 2]) -> Self { Self::default() }
        pub fn init_dir(_v: bun_semver::String) -> Self { Self::default() }
        pub fn init_map(_v: crate::ExternalStringList) -> Self { Self::default() }
    }
    #[derive(Default, Clone, Copy, PartialEq, Eq)]
    #[repr(u8)]
    pub enum Tag { #[default] None, File, NamedFile, Dir, Map }
}
/// Stub: `lockfile.rs` — type surface for `dependency.rs` / `npm.rs`.
pub mod lockfile {
    pub use bun_semver::StringBuilder;
    #[derive(Default)] pub struct Lockfile {
        pub buffers: Buffers,
    }
    #[derive(Default)] pub struct Buffers {
        pub string_bytes: Vec<u8>,
    }
    #[derive(Default)] pub struct PatchedDep;
    #[derive(Default)] pub struct LoadResult;
    #[derive(Default)] pub struct LoadStep;
    pub mod package {
        #[derive(Default, Clone, Copy)] pub struct Meta;
    }
    pub mod tree {
        pub type Id = u32;
    }
    pub mod bun_lock {}
}
/// Stub: `package_manager` — `PackageManager` struct + `Subcommand` enum only.
pub mod package_manager {
    pub use super::PackageManager;
    pub use super::Subcommand;
    pub mod security_scanner {
        pub use crate::SecurityScanSubprocess;
    }
}
pub mod extract_tarball { pub use super::ExtractTarball; }
pub mod network_task { pub use super::NetworkTask; }
pub mod tarball_stream { pub use super::TarballStream; }
pub mod package_manager_task { pub type Task = (); }
pub mod lifecycle_script_runner { pub use super::LifecycleScriptSubprocess; }
pub mod package_install { pub use super::PackageInstall; }
pub mod package_installer {}
pub mod isolated_install {
    pub use super::Store;
    pub use super::FileCopier;
    pub type EntryId = u32;
}
pub mod patch_install { pub use super::PatchTask; }
pub mod hoisted_install {}
pub mod migration {}
pub mod pnpm {}
pub mod yarn {}

/// `crate::install::…` shim — Phase-A drafts (bin.rs, repository.rs,
/// migration.rs, resolvers/folder_resolver.rs) were written against a
/// `bun_install::install` submodule path mirroring `install.zig`. The crate
/// root *is* that file now, so re-export everything under both names.
pub(crate) mod install {
    pub use crate::*;
}

/// `windows-shim/BinLinkingShim.zig` — `.bunx` shim encoder consumed by
/// `bin::Linker` (Windows only at runtime, but the encoder types are
/// referenced unconditionally so the module must exist on all targets).
// PORT NOTE: `#[path]` inside an inline `mod {}` resolves relative to the
// synthetic `windows_shim/` directory, which doesn't exist on disk. Hoist the
// file-backed module to crate level with an absolute-ish path and re-export
// through the inline mod so `windows_shim::bin_linking_shim` keeps resolving.
 #[path = "windows-shim/BinLinkingShim.rs"]
mod _bin_linking_shim;
pub mod windows_shim {
    pub mod bin_linking_shim { #[derive(Default)] pub struct BinLinkingShim; }
    pub use bin_linking_shim::BinLinkingShim;
}

 #[path = "resolvers/folder_resolver.rs"]
mod _folder_resolver;
pub mod resolvers {
    pub mod folder_resolver { pub use crate::FolderResolution; }
}

// ──────────────────────────────────────────────────────────────────────────
// Stub surface (B-1): retired. Real impls live in the file-backed modules
// above. Disabled stubs are kept as `` reference shapes only.
// ──────────────────────────────────────────────────────────────────────────

 // un-gated: real impl in npm.rs
pub mod npm {
    /// Stub for `npm.PackageManifest` (src/install/npm.zig). Only the fields
    /// read by `PackageManifestMap` are exposed; full layout lives in the
    /// gated `npm.rs`.
    #[derive(Clone, Default)]
    pub struct PackageManifest {
        pub pkg: NpmPackage,
    }

    /// Stub for `npm.PackageManifest.NpmPackage` — minimal fields for
    /// `PackageManifestMap::by_name_hash_allow_expired`.
    #[derive(Clone, Default)]
    pub struct NpmPackage {
        pub has_extended_manifest: bool,
        pub public_max_age: u32,
    }

    pub struct Registry;
    impl Registry {
        /// Zig: `npm.Registry.default_url` (src/install/npm.zig)
        pub const DEFAULT_URL: &'static str = "https://registry.npmjs.org/";
        // NOTE: Zig computes this at comptime via Wyhash11; lazy-init here because
        // bun_wyhash::Wyhash11::hash is not `const fn` yet.
        pub fn default_url_hash() -> u64 {
            static H: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
            *H.get_or_init(|| {
                let url = Self::DEFAULT_URL.as_bytes();
                // strings.withoutTrailingSlash(default_url)
                let trimmed = url.strip_suffix(b"/").unwrap_or(url);
                bun_wyhash::Wyhash11::hash(0, trimmed)
            })
        }
        // TODO(b2): make this a true const once Wyhash11::hash is const fn.
        pub const DEFAULT_URL_HASH: u64 = 0; // placeholder — callers should use default_url_hash()
    }

    /// Port of `Negatable(T)` generic struct (src/install/npm.zig).
    #[derive(Clone, Copy, Default)]
    pub struct Negatable<T: NegatableSet> {
        pub added: T,
        pub removed: T,
        pub had_wildcard: bool,
        pub had_unrecognized_values: bool,
    }

    /// Common trait for `OperatingSystem` / `Libc` / `Architecture` so the
    /// `Negatable<T>` generic can dispatch on bitwidth + name table without
    /// macro duplication. Mirrors the Zig `enum(uN) { none, all, _ }` shape.
    pub trait NegatableSet: Copy + Default {
        type Repr: Copy
            + core::ops::BitOr<Output = Self::Repr>
            + core::ops::BitAnd<Output = Self::Repr>
            + core::ops::Not<Output = Self::Repr>
            + PartialEq
            + From<u8>;
        const ALL_VALUE: Self::Repr;
        fn from_repr(v: Self::Repr) -> Self;
        fn to_repr(self) -> Self::Repr;
        fn name_map_get(name: &[u8]) -> Option<Self::Repr>;
    }

    impl<T: NegatableSet> Negatable<T> {
        // https://github.com/pnpm/pnpm/blob/1f228b0aeec2ef9a2c8577df1d17186ac83790f9/config/package-is-installable/src/checkPlatform.ts#L56-L86
        // https://github.com/npm/cli/blob/fefd509992a05c2dfddbe7bc46931c42f1da69d7/node_modules/npm-install-checks/lib/index.js#L2-L96
        pub fn combine(self) -> T {
            let zero: T::Repr = 0u8.into();
            let added = if self.had_wildcard { T::ALL_VALUE } else { self.added.to_repr() };
            let removed = self.removed.to_repr();

            if added == zero && removed == zero {
                if self.had_unrecognized_values {
                    return T::from_repr(zero);
                }
                return T::from_repr(T::ALL_VALUE);
            }
            if added == zero && removed != zero {
                return T::from_repr(T::ALL_VALUE & !removed);
            }
            if removed == zero {
                return T::from_repr(added);
            }
            T::from_repr(added & !removed)
        }

        pub fn apply(&mut self, str: &[u8]) {
            if str.is_empty() {
                return;
            }
            if str == b"any" {
                self.had_wildcard = true;
                return;
            }
            if str == b"none" {
                self.had_unrecognized_values = true;
                return;
            }
            let is_not = str[0] == b'!';
            let body = if is_not { &str[1..] } else { str };
            let Some(field) = T::name_map_get(body) else {
                if !is_not {
                    self.had_unrecognized_values = true;
                }
                return;
            };
            // Zig does `this.* = .{ .added = ..., .removed = ... }` here, which
            // re-initializes the whole struct and resets the flags to `false`.
            if is_not {
                *self = Negatable {
                    added: self.added,
                    removed: T::from_repr(self.removed.to_repr() | field),
                    had_unrecognized_values: false,
                    had_wildcard: false,
                };
            } else {
                *self = Negatable {
                    added: T::from_repr(self.added.to_repr() | field),
                    removed: self.removed,
                    had_unrecognized_values: false,
                    had_wildcard: false,
                };
            }
        }
    }

    macro_rules! negatable_bitset {
        (
            $(#[$m:meta])*
            $name:ident : $repr:ty {
                $( $variant:ident = $shift:expr ),* $(,)?
            }
            current = $current:expr ;
        ) => {
            $(#[$m])*
            #[repr(transparent)]
            #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
            pub struct $name(pub $repr);

            #[allow(non_upper_case_globals)]
            impl $name {
                pub const NONE: $name = $name(0);
                $( pub const $variant: $repr = 1 << $shift; )*
                pub const ALL_VALUE: $repr = 0 $( | (1 << $shift) )*;
                pub const ALL: $name = $name(Self::ALL_VALUE);
                pub const CURRENT: $name = $name($current);

                #[inline] pub fn is_match(self, target: $name) -> bool { self.0 & target.0 != 0 }
                #[inline] pub fn has(self, other: $repr) -> bool { self.0 & other != 0 }
                #[inline] pub fn negatable(self) -> Negatable<$name> {
                    Negatable { added: self, removed: $name::NONE, had_wildcard: false, had_unrecognized_values: false }
                }

                pub fn name_map_get(name: &[u8]) -> Option<$repr> {
                    match name {
                        $( s if s == stringify!($variant).as_bytes() => Some(Self::$variant), )*
                        _ => None,
                    }
                }
            }

            impl NegatableSet for $name {
                type Repr = $repr;
                const ALL_VALUE: $repr = $name::ALL_VALUE;
                #[inline] fn from_repr(v: $repr) -> Self { $name(v) }
                #[inline] fn to_repr(self) -> $repr { self.0 }
                #[inline] fn name_map_get(name: &[u8]) -> Option<$repr> { $name::name_map_get(name) }
            }
        };
    }

    // src/install/npm.zig: OperatingSystem
    negatable_bitset! {
        OperatingSystem: u16 {
            aix = 1, darwin = 2, freebsd = 3, linux = 4,
            openbsd = 5, sunos = 6, win32 = 7, android = 8,
        }
        current = if cfg!(target_os = "linux") { 1u16 << 4 }
            else if cfg!(target_os = "macos") { 1u16 << 2 }
            else if cfg!(target_os = "windows") { 1u16 << 7 }
            else if cfg!(target_os = "freebsd") { 1u16 << 3 }
            else if cfg!(target_os = "android") { 1u16 << 8 }
            else { 0 };
    }

    // src/install/npm.zig: Libc
    negatable_bitset! {
        Libc: u8 {
            glibc = 1, musl = 2,
        }
        // TODO(port): Zig hardcodes glibc; revisit musl detection.
        current = 1u8 << 1;
    }

    // src/install/npm.zig: Architecture
    negatable_bitset! {
        /// https://docs.npmjs.com/cli/v8/configuring-npm/package-json#cpu
        Architecture: u16 {
            arm = 1, arm64 = 2, ia32 = 3, mips = 4, mipsel = 5,
            ppc = 6, ppc64 = 7, s390 = 8, s390x = 9, x32 = 10, x64 = 11,
        }
        current = if cfg!(target_arch = "aarch64") { 1u16 << 2 }
            else if cfg!(target_arch = "x86_64") { 1u16 << 11 }
            else { 0 };
    }

    /// Lower-case path alias so `npm::registry::Scope` resolves (Zig:
    /// `npm.Registry.Scope`). Real defs live in gated `npm.rs`.
    pub mod registry {
        pub use super::Registry;

        #[derive(Default)]
        pub struct Url<'a> {
            pub host: &'a [u8],
            pub hostname: &'a [u8],
            pub href: &'a [u8],
            pub origin: &'a [u8],
            pub protocol: &'a [u8],
        }

        #[derive(Default)]
        pub struct Scope<'a> {
            pub name: &'a [u8],
            pub url: Url<'a>,
            pub url_hash: u64,
        }
        impl<'a> Scope<'a> {
            #[inline]
            pub fn hash(name: &[u8]) -> u64 { bun_wyhash::Wyhash11::hash(0, name) }
        }
    }

    /// Lower-case path alias so `npm::package_manifest::Serializer` resolves.
    pub mod package_manifest {
        pub use super::PackageManifest;
        pub struct Serializer;
        impl Serializer {
            pub fn load_by_file(
                _scope: &super::registry::Scope<'_>,
                _file: impl Sized,
            ) -> Result<Option<PackageManifest>, bun_core::Error> {
                todo!("B-2: npm::PackageManifest::Serializer::load_by_file")
            }
            /// Zig: `Serializer.loadByFileID(allocator, scope, cache_dir, file_id)`.
            pub fn load_by_file_id(
                _scope: &super::registry::Scope<'_>,
                _cache_dir: bun_sys::Fd,
                _file_id: u64,
            ) -> Result<Option<PackageManifest>, bun_core::Error> {
                todo!("B-2: npm::PackageManifest::Serializer::load_by_file_id")
            }
        }
    }
}

 // B-2: replaced by real module above
pub mod hosted_git_info_stub {
    /// Port of `HostedGitInfo` (src/install/hosted_git_info.zig). Owned-buffer
    /// fields collapse to `Box<[u8]>`; the Zig `_memory_buffer`/`_allocator`
    /// pair is the backing arena and drops with the struct.
    pub struct HostedGitInfo {
        pub committish: Option<Box<[u8]>>,
        pub project: Box<[u8]>,
        pub user: Option<Box<[u8]>>,
        pub host_provider: HostProvider,
        pub default_representation: Representation,
    }

    impl HostedGitInfo {
        // PORT NOTE: Zig signature is `fromUrl(allocator, npa_str: []u8)` (mutable
        // — it rewrites scp-style `git@host:user/repo` in place). Callers in
        // `dependency.rs` only have `&[u8]`; the real impl will need to dupe into
        // a scratch buffer before mutation. Stub takes `&[u8]` so call sites
        // type-check.
        pub fn from_url(_npa_str: &[u8]) -> Result<Option<Self>, bun_core::Error> {
            todo!("B-2: HostedGitInfo::from_url")
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum HostProvider { Github, Gitlab, Bitbucket, Gist, Sourcehut }
    impl HostProvider {
        pub fn type_str(self) -> &'static [u8] {
            match self {
                Self::Github => b"github", Self::Gitlab => b"gitlab",
                Self::Bitbucket => b"bitbucket", Self::Gist => b"gist",
                Self::Sourcehut => b"sourcehut",
            }
        }
        pub fn domain(self) -> &'static [u8] {
            match self {
                Self::Github => b"github.com", Self::Gitlab => b"gitlab.com",
                Self::Bitbucket => b"bitbucket.org", Self::Gist => b"gist.github.com",
                Self::Sourcehut => b"git.sr.ht",
            }
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, Debug, strum::IntoStaticStr)]
    #[strum(serialize_all = "lowercase")]
    pub enum Representation { Shortcut, Https, Ssh, Git }

    pub struct ParsedUrl {
        /// Zig: `url: *jsc.URL` (WTF::URL handle, src/install/hosted_git_info.zig).
        /// `MOVE_DOWN(b0)` placed the WTF::URL FFI in `bun_url::whatwg`, so this
        /// no longer needs a `bun_jsc` dep.
        pub url: WhatwgUrl,
        pub proto: UrlProtocol,
    }

    /// Owned WTF::URL handle — RAII over `bun_url::whatwg::URL` (opaque C++).
    /// Zig held `*jsc.URL` and called `.deinit()` at scope exit; `Drop` does it here.
    pub struct WhatwgUrl(core::ptr::NonNull<bun_url::whatwg::URL>);
    impl WhatwgUrl {
        pub fn from_string(s: &bun_string::String) -> Option<Self> {
            bun_url::whatwg::URL::from_string(s).map(Self)
        }
        pub fn from_utf8(input: &[u8]) -> Option<Self> {
            bun_url::whatwg::URL::from_utf8(input).map(Self)
        }
        /// Zig: `jsc.URL.href()` → `bun.String`.
        pub fn href(&mut self) -> bun_string::String {
            // SAFETY: handle is live for `'self`; C++ side reads, never invalidates.
            unsafe { self.0.as_mut() }.href()
        }
        pub fn as_raw(&mut self) -> &mut bun_url::whatwg::URL {
            // SAFETY: handle is live for `'self`.
            unsafe { self.0.as_mut() }
        }
    }
    impl Drop for WhatwgUrl {
        fn drop(&mut self) {
            // SAFETY: `from_string`/`from_utf8` returned a heap-allocated WTF::URL we own.
            unsafe { self.0.as_mut() }.deinit();
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum UrlProtocol { Git, GitSsh, GitHttps, Http, Https, Ssh, File, Other }

    /// Zig: `parseUrl(allocator, npa_str) error{InvalidGitUrl,OOM}!{ url, proto }`.
    pub fn parse_url(_npa_str: &mut [u8]) -> Result<ParsedUrl, bun_core::Error> {
        todo!("B-2: hosted_git_info::parse_url")
    }

    /// Zig: `hosted_git_info.isGitHubShorthand(spec)` — owner/repo[#committish].
    pub fn is_github_shorthand(_spec: &[u8]) -> bool {
        todo!("B-2: hosted_git_info::is_github_shorthand — un-gate hosted_git_info.rs")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Re-exports
// ──────────────────────────────────────────────────────────────────────────

pub use npm as Npm;
pub use resolution::Resolution;
pub use pnpm_matcher::PnpmMatcher;
#[derive(Default)] pub struct PackageManifestMap;
#[derive(Default)] pub struct PostinstallOptimizer;
pub type Task = ();

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

// ─── reconciler-6: stub surface for re-gated heavy modules ──────────────────
// The file-backed bodies are `#![cfg(any())]`-gated (1200+ port errors).
// These opaque stubs keep `bun_jsc::AsyncModule` / `bun_runtime` callers
// type-checking until the bodies un-gate per-file.
pub use lockfile::bun_lock as TextLockfile;
pub use patch_install as patch;
pub use bin::Bin;
pub use repository::Repository;
pub use lockfile::{Lockfile, PatchedDep, LoadResult, LoadStep};
#[derive(Default)] pub struct ExtractTarball;
#[derive(Default)] pub struct NetworkTask;
#[derive(Default)] pub struct TarballStream;
#[derive(Default)] pub struct PackageManager {
    pub options: PackageManagerOptionsStub,
    pub timestamp_for_manifest_cache_control: u32,
}
#[derive(Default)] pub struct PackageManagerOptionsStub {
    pub enable: PackageManagerEnableStub,
}
#[derive(Default)] pub struct PackageManagerEnableStub {
    pub manifest_cache: bool,
}
pub struct PackageManagerTmpDirStub { pub handle: bun_sys::Fd }
#[derive(Default)] pub struct FolderResolution;
#[derive(Default)] pub struct LifecycleScriptSubprocess;
#[derive(Default)] pub struct SecurityScanSubprocess;
#[derive(Default)] pub struct PackageInstall;
#[derive(Default)] pub struct Store;
#[derive(Default)] pub struct FileCopier;
#[derive(Default)] pub struct PatchTask;
impl PackageManager {
    pub fn verbose_install() -> bool { false }
    pub fn get_cache_directory(&mut self) -> bun_sys::Fd { todo!("phase-b2: PackageManager::get_cache_directory (gated)") }
    pub fn get_temporary_directory(&mut self) -> PackageManagerTmpDirStub { todo!("phase-b2: PackageManager::get_temporary_directory (gated)") }
}
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum Subcommand { #[default] Install, Add, Remove, Update, Link, Unlink, Pm, Patch, PatchCommit, Outdated }

// ──────────────────────────────────────────────────────────────────────────
// MOVE_DOWN(b0): bun_runtime::cli::ShellCompletions → install
// Only the `Shell` enum (variant detection) is consumed here — the embedded
// completion script bodies stay in bun_cli (they pull in @embedFile assets).
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_snake_case)]
pub mod ShellCompletions {
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub enum Shell {
        #[default]
        Unknown,
        Bash,
        Zsh,
        Fish,
        Pwsh,
    }

    impl Shell {
        /// Port of `Shell.fromEnv` (src/cli/shell_completions.zig). The Zig version was
        /// generic over the string type purely so it could accept both `[]const u8` and
        /// `[:0]const u8`; in Rust both coerce to `&[u8]`.
        pub fn from_env(shell: &[u8]) -> Shell {
            use bun_string::strings;
            let basename = bun_paths::basename(shell);
            if strings::eql_comptime(basename, b"bash") {
                Shell::Bash
            } else if strings::eql_comptime(basename, b"zsh") {
                Shell::Zsh
            } else if strings::eql_comptime(basename, b"fish") {
                Shell::Fish
            } else if strings::eql_comptime(basename, b"pwsh")
                || strings::eql_comptime(basename, b"powershell")
            {
                Shell::Pwsh
            } else {
                Shell::Unknown
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// MOVE_DOWN(b0): bun_runtime::cli::RunCommand (subset) → install
// Only the helpers the package manager needs: shell discovery, fake `node`
// shim creation, and env bootstrap for lifecycle scripts. The interactive
// `bun run` entrypoint stays in bun_cli.
// ──────────────────────────────────────────────────────────────────────────
pub struct RunCommand;

/// Hook (GENUINE b0): mirrors `bun_runtime::cli::PRETEND_TO_BE_NODE`. Set once at
/// startup by bun_cli when argv[0] basename == "node"; install only reads it.
/// Lives at module scope because Rust forbids `static` inside `impl`.
pub static PRETEND_TO_BE_NODE: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

use bun_core::ZStr;

impl RunCommand {
    const SHELLS_TO_SEARCH: &'static [&'static [u8]] = &[b"bash", b"sh", b"zsh"];

    /// `/tmp/bun-node-<sha>` (or debug variant). Windows builds compute the path
    /// at runtime via GetTempPathW, so this constant is POSIX-only.
    #[cfg(not(windows))]
    pub const BUN_NODE_DIR: &'static str = {
        // PORT NOTE: Zig used comptime `++`; `const_format::concatcp!` cannot host
        // `if` expressions inline, so split into helper consts.
        use const_format::concatcp;
        const TMP: &str = if cfg!(target_os = "macos") {
            "/private/tmp"
        } else if cfg!(target_os = "android") {
            "/data/local/tmp"
        } else {
            "/tmp"
        };
        const SUFFIX: &str = if cfg!(debug_assertions) {
            "/bun-node-debug"
        } else if bun_core::env::GIT_SHA_SHORT.is_empty() {
            "/bun-node"
        } else {
            concatcp!("/bun-node-", bun_core::env::GIT_SHA_SHORT)
        };
        concatcp!(TMP, SUFFIX)
    };

    fn find_shell_impl<'a>(
        buf: &'a mut bun_paths::PathBuffer,
        path: &[u8],
        cwd: &[u8],
    ) -> Option<&'a ZStr> {
        #[cfg(windows)]
        {
            let _ = (buf, path, cwd);
            return Some(bun_core::zstr!("C:\\Windows\\System32\\cmd.exe"));
        }

        #[cfg(not(windows))]
        {
            for shell in Self::SHELLS_TO_SEARCH {
                if let Some(found) = bun_which::which(buf, path, cwd, shell) {
                    // SAFETY: which() writes a NUL-terminated path into `buf` and returns a
                    // borrow of it; reborrow as &ZStr with the buffer's lifetime.
                    let len = found.len();
                    return Some(unsafe { ZStr::from_raw(buf.as_ptr(), len) });
                }
            }

            const HARDCODED_POPULAR_ONES: &[&ZStr] = &[
                bun_core::zstr!("/bin/bash"),
                bun_core::zstr!("/usr/bin/bash"),
                bun_core::zstr!("/usr/local/bin/bash"), // don't think this is a real one
                bun_core::zstr!("/bin/sh"),
                bun_core::zstr!("/usr/bin/sh"), // don't think this is a real one
                bun_core::zstr!("/usr/bin/zsh"),
                bun_core::zstr!("/usr/local/bin/zsh"),
                bun_core::zstr!("/system/bin/sh"), // Android
            ];
            for &shell in HARDCODED_POPULAR_ONES {
                if bun_sys::is_executable_file_path(shell) {
                    let body = shell.as_bytes();
                    buf[..body.len()].copy_from_slice(body);
                    buf[body.len()] = 0;
                    // SAFETY: just wrote body + NUL into buf.
                    return Some(unsafe { ZStr::from_raw(buf.as_ptr(), body.len()) });
                }
            }

            None
        }
    }

    /// Find the "best" shell to use. Cached to only run once.
    /// Returns a slice into a process-lifetime static buffer (includes trailing NUL).
    pub fn find_shell(path: &[u8], cwd: &[u8]) -> Option<&'static [u8]> {
        // PORTING.md §Concurrency: `bun.once` + static buf → OnceLock. Store the
        // result bytes (including NUL) directly in the OnceLock so the borrow is
        // trivially `'static` — avoids the Mutex+data_ptr dance from the draft.
        static ONCE: std::sync::OnceLock<Option<Vec<u8>>> = std::sync::OnceLock::new();

        ONCE.get_or_init(|| {
            let mut scratch = bun_paths::PathBuffer::uninit();
            let found = Self::find_shell_impl(&mut scratch, path, cwd)?;
            // Includes trailing NUL so the caller may treat it as `[:0]const u8`.
            Some(found.as_bytes_with_nul().to_vec())
        })
        .as_deref()
    }

    /// Port of `RunCommand.createFakeTemporaryNodeExecutable`
    /// (src/cli/run_command.zig). Symlinks/hardlinks the running bun binary as
    /// `node` + `bun` inside a temp dir and prepends that dir to `path`.
    pub fn create_fake_temporary_node_executable(
        path: &mut Vec<u8>,
        optional_bun_path: &mut &[u8],
    ) -> Result<(), bun_core::Error> {
        // If we are already running as "node", the path should exist
        if PRETEND_TO_BE_NODE.load(core::sync::atomic::Ordering::Relaxed) {
            return Ok(());
        }

        #[cfg(not(windows))]
        {
            use const_format::concatcp;

            let argv0: &ZStr = bun_core::argv().get(0).unwrap_or(bun_core::zstr!("bun"));

            // if we are already an absolute path, use that
            // if the user started the application via a shebang, it's likely that the path is absolute already
            let argv0_z: &ZStr = if argv0.as_bytes().first() == Some(&b'/') {
                *optional_bun_path = argv0.as_bytes();
                argv0
            } else if optional_bun_path.is_empty() {
                // otherwise, ask the OS for the absolute path
                // Zig: `try bun.selfExePath()` — propagate the error.
                let self_path = bun_core::self_exe_path()?;
                if !self_path.as_bytes().is_empty() {
                    *optional_bun_path = self_path.as_bytes();
                    self_path
                } else {
                    // Zig: trailing `if (optional_bun_path.len == 0) argv0 = bun.argv[0];`
                    argv0
                }
            } else {
                // Zig: `var argv0 = @ptrCast(optional_bun_path.ptr)` — when argv[0] is
                // not absolute and the caller pre-supplied a path, that path is the
                // symlink target (NOT bun.argv[0]).
                // SAFETY: callers pass a slice borrowed from a `ZStr` (argv[0] /
                // self_exe_path / static literal), so `ptr[len] == 0` holds — same
                // precondition Zig's `@ptrCast` relies on.
                unsafe { ZStr::from_raw(optional_bun_path.as_ptr(), optional_bun_path.len()) }
            };

            #[cfg(debug_assertions)]
            {
                // TODO(port): Zig used `std.fs.deleteTreeAbsolute` (debug-only cleanup).
                // bun_sys has no recursive-rmdir yet; skipping is harmless — the
                // EEXIST branch below handles a stale dir.
            }

            const NODE_LINK: &ZStr = {
                const B: &[u8] = concatcp!(RunCommand::BUN_NODE_DIR, "/node\0").as_bytes();
                // SAFETY: literal ends in NUL; len excludes it.
                unsafe { ZStr::from_raw(B.as_ptr(), B.len() - 1) }
            };
            const BUN_LINK: &ZStr = {
                const B: &[u8] = concatcp!(RunCommand::BUN_NODE_DIR, "/bun\0").as_bytes();
                // SAFETY: literal ends in NUL; len excludes it.
                unsafe { ZStr::from_raw(B.as_ptr(), B.len() - 1) }
            };
            const DIR_Z: &ZStr = {
                const B: &[u8] = concatcp!(RunCommand::BUN_NODE_DIR, "\0").as_bytes();
                // SAFETY: literal ends in NUL; len excludes it.
                unsafe { ZStr::from_raw(B.as_ptr(), B.len() - 1) }
            };

            for dest in [NODE_LINK, BUN_LINK] {
                let mut retried = false;
                loop {
                    match bun_sys::symlink(argv0_z, dest) {
                        Ok(()) => break,
                        Err(e) if e.get_errno() == bun_sys::E::EEXIST => break,
                        Err(_) if !retried => {
                            let _ = bun_sys::mkdir(DIR_Z, 0o755);
                            retried = true;
                        }
                        Err(_) => return Ok(()),
                    }
                }
            }

            if !path.is_empty() && *path.last().unwrap() != bun_paths::DELIMITER {
                path.push(bun_paths::DELIMITER);
            }

            // The reason for the extra delim is because we are going to append the system PATH
            // later on. this is done by the caller, and explains why we are adding bun_node_dir
            // to the end of the path slice rather than the start.
            path.extend_from_slice(Self::BUN_NODE_DIR.as_bytes());
            path.push(bun_paths::DELIMITER);
            Ok(())
        }

        #[cfg(windows)]
        
        {
            use bun_str::strings;

            let mut target_path_buffer: bun_paths::WPathBuffer =
                [0u16; bun_paths::PATH_MAX_WIDE];
            let prefix: &[u16] = strings::w("\\??\\");

            let len = unsafe {
                bun_windows::GetTempPathW(
                    (target_path_buffer.len() - prefix.len()) as u32,
                    target_path_buffer.as_mut_ptr().add(prefix.len()),
                )
            } as usize;
            if len == 0 {
                bun_output::scoped_log!(
                    RUN,
                    "Failed to create temporary node dir: {:?}",
                    unsafe { bun_windows::GetLastError() }
                );
                return Ok(());
            }

            target_path_buffer[..prefix.len()].copy_from_slice(prefix);

            let dir_name: &[u16] = if cfg!(debug_assertions) {
                strings::w("bun-node-debug")
            } else if bun_core::env::GIT_SHA_SHORT.is_empty() {
                strings::w("bun-node")
            } else {
                strings::w(const_str::concat!("bun-node-", bun_core::env::GIT_SHA_SHORT))
            };
            target_path_buffer[prefix.len() + len..][..dir_name.len()].copy_from_slice(dir_name);
            let dir_slice_len = prefix.len() + len + dir_name.len();

            let image_path = bun_windows::exe_path_w();
            for name in [strings::w("\\node.exe\0"), strings::w("\\bun.exe\0")] {
                target_path_buffer[dir_slice_len..][..name.len()].copy_from_slice(name);
                let file_slice = &target_path_buffer[..dir_slice_len + name.len() - 1];

                if unsafe {
                    bun_windows::CreateHardLinkW(
                        file_slice.as_ptr(),
                        image_path.as_ptr(),
                        core::ptr::null_mut(),
                    )
                } == 0
                {
                    match unsafe { bun_windows::GetLastError() } {
                        bun_windows::ERROR_ALREADY_EXISTS => {}
                        _ => {
                            target_path_buffer[dir_slice_len] = 0;
                            let _ = bun_sys::mkdir_w(&target_path_buffer[..dir_slice_len], 0);
                            target_path_buffer[dir_slice_len] = b'\\' as u16;

                            if unsafe {
                                bun_windows::CreateHardLinkW(
                                    file_slice.as_ptr(),
                                    image_path.as_ptr(),
                                    core::ptr::null_mut(),
                                )
                            } == 0
                            {
                                return Ok(());
                            }
                        }
                    }
                }
            }

            if !path.is_empty() && *path.last().unwrap() != bun_paths::DELIMITER {
                path.push(bun_paths::DELIMITER);
            }

            // The reason for the extra delim is because we are going to append the system PATH
            // later on. this is done by the caller, and explains why we are adding bun_node_dir
            // to the end of the path slice rather than the start.
            strings::to_utf8_append_to_list(
                path,
                &target_path_buffer[prefix.len()..dir_slice_len],
            )?;
            path.push(bun_paths::DELIMITER);
            let _ = optional_bun_path;
            Ok(())
        }
        #[cfg(windows)]
        #[cfg(any())]
        {
            // TODO(b2-blocked): bun_windows::{GetTempPathW,CreateHardLinkW,exe_path_w}
            // TODO(b2-blocked): bun_string::strings::w / to_utf8_append_to_list
            let _ = (path, optional_bun_path);
            todo!("b2-blocked: create_fake_temporary_node_executable (windows)")
        }
    }
}

// TODO(b2-blocked): bun_transpiler::Transpiler
// TODO(b2-blocked): bun_resolver::DirInfo
// TODO(b2-blocked): bun_bunfig::Command::Context
// TODO(b2-blocked): bun_schema::api::DotEnvBehavior

impl RunCommand {
    /// Port of `RunCommand.configureEnvForRun` (src/cli/run_command.zig).
    /// Initializes a fresh `Transpiler` via out-param, loads `.env`, and seeds
    /// the npm_* environment variables lifecycle scripts expect. Returns the
    /// resolved root `DirInfo` (opaque to install — caller discards).
    pub fn configure_env_for_run(
        ctx: bun_bunfig::Command::Context,
        this_transpiler: &mut bun_transpiler::Transpiler,
        // Zig: `env: ?*DotEnv.Loader` — call site passes `this.env_mut()` (always Some).
        env: &mut bun_dotenv::Loader,
        log_errors: bool,
        store_root_fd: bool,
    ) -> Result<*mut bun_resolver::DirInfo, bun_core::Error> {
        use bun_core::{Global, Output};
        use bun_schema::api;

        // TODO(port): Zig branched on `env == null` to decide whether to run
        // loadProcess()/runEnvLoader(). The only install caller always passes a
        // loader, so the `had_env` path is the only one exercised here.
        let had_env = true;
        *this_transpiler =
            bun_transpiler::Transpiler::init(ctx.allocator, ctx.log, ctx.args, Some(env))?;
        this_transpiler.options.env.behavior = api::DotEnvBehavior::LoadAll;
        this_transpiler.env.quiet = true;
        this_transpiler.options.env.prefix = b"";

        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = store_root_fd;

        this_transpiler.resolver.opts.load_tsconfig_json = true;
        this_transpiler.options.load_tsconfig_json = true;

        this_transpiler.configure_linker();

        let root_dir_info = match this_transpiler
            .resolver
            .read_dir_info(this_transpiler.fs.top_level_dir)
        {
            Ok(Some(info)) => info,
            Ok(None) => {
                let _ = ctx.log.print(Output::error_writer());
                Output::pretty_errorln(format_args!("error loading current directory"));
                Output::flush();
                return Err(bun_core::err!(CouldntReadCurrentDirectory));
            }
            Err(err) => {
                if !log_errors {
                    return Err(bun_core::err!(CouldntReadCurrentDirectory));
                }
                let _ = ctx.log.print(Output::error_writer());
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r><d>:<r> <b>{}<r> loading directory {}",
                    err,
                    bun_core::fmt::quote(this_transpiler.fs.top_level_dir),
                ));
                Output::flush();
                return Err(err);
            }
        };

        this_transpiler.resolver.store_fd = false;

        if !had_env {
            this_transpiler.env.load_process()?;

            if let Some(node_env) = this_transpiler.env.get(b"NODE_ENV") {
                if bun_str::strings::eql_comptime(node_env, b"production") {
                    this_transpiler.options.production = true;
                }
            }

            // Always skip default .env files for package.json script runner
            // (see comment in env_loader.zig:542-548 - the script's own bun instance loads .env)
            let _ = this_transpiler.run_env_loader(true);
        }

        let _ = this_transpiler
            .env
            .map
            .put_default(b"npm_config_local_prefix", this_transpiler.fs.top_level_dir);

        // Propagate --no-orphans / [run] noOrphans to the script's env so any
        // Bun process the script spawns enables its own watchdog. The env
        // loader snapshots `environ` before flag parsing runs, so the
        // `setenv()` in `enable()` isn't reflected here.
        if bun_aio::parent_death_watchdog::is_enabled() {
            let _ = this_transpiler
                .env
                .map
                .put(b"BUN_FEATURE_FLAG_NO_ORPHANS", b"1");
        }

        // we have no way of knowing what version they're expecting without running the node executable
        // running the node executable is too slow
        // so we will just hardcode it to LTS
        let _ = this_transpiler.env.map.put_default(
            b"npm_config_user_agent",
            // the use of npm/? is copying yarn
            // e.g.
            // > "yarn/1.22.4 npm/? node/v12.16.3 darwin x64",
            const_str::concat!(
                "bun/",
                Global::package_json_version,
                " npm/? node/v",
                bun_core::env::REPORTED_NODEJS_VERSION,
                " ",
                Global::os_name,
                " ",
                Global::arch_name,
            )
            .as_bytes(),
        );

        if this_transpiler.env.get(b"npm_execpath").is_none() {
            // we don't care if this fails
            if let Ok(self_exe) = bun_core::self_exe_path() {
                let _ = this_transpiler
                    .env
                    .map
                    .put_default(b"npm_execpath", self_exe.as_bytes());
            }
        }

        // SAFETY: read_dir_info returned Some — pointer is owned by resolver's arena and
        // valid for the resolver's lifetime.
        if let Some(package_json) = unsafe { (*root_dir_info).enclosing_package_json } {
            let pkg = unsafe { &*package_json };
            if !pkg.name.is_empty()
                && this_transpiler.env.map.get(b"npm_package_name").is_none()
            {
                let _ = this_transpiler.env.map.put(b"npm_package_name", pkg.name);
            }

            let _ = this_transpiler
                .env
                .map
                .put_default(b"npm_package_json", pkg.source.path.text);

            if !pkg.version.is_empty()
                && this_transpiler.env.map.get(b"npm_package_version").is_none()
            {
                let _ = this_transpiler
                    .env
                    .map
                    .put(b"npm_package_version", pkg.version);
            }

            if let Some(config) = pkg.config.as_ref() {
                let _ = this_transpiler.env.map.ensure_unused_capacity(config.len());
                for (k, v) in config.iter() {
                    let key = bun_str::strings::concat(&[b"npm_package_config_", k]);
                    this_transpiler.env.map.put_assume_capacity(&key, v);
                }
            }
        }

        Ok(root_dir_info)
    }
}

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

pub fn buntaghashbuf_make(buf: &mut BuntagHashBuf, patch_hash: u64) -> &mut [u8] {
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
    // TODO(b1): return &mut ZStr once bun_str::ZStr::from_raw_mut is available
    &mut buf[..BUN_HASH_TAG.len() + digits_len]
}

pub struct StorePathFormatter<'a> {
    str: &'a [u8],
}

impl<'a> StorePathFormatter<'a> {
    /// Spec install.zig:31-37 — `for (this.str) |c| writer.writeByte(c)` emits raw bytes
    /// verbatim (mapping `/` and `\` to `+`). This is the byte-faithful sink; callers that
    /// need an on-disk store path (legal non-UTF-8 on Linux) must use this, not `Display`.
    pub fn write_to<W: std::io::Write>(&self, w: &mut W) -> std::io::Result<()> {
        // if (!this.opts.replace_slashes) {
        //     try writer.writeAll(this.str);
        //     return;
        // }
        for &c in self.str {
            match c {
                b'/' | b'\\' => w.write_all(b"+")?,
                _ => w.write_all(core::slice::from_ref(&c))?,
            }
        }
        Ok(())
    }
}

impl<'a> fmt::Display for StorePathFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // PORT NOTE: `core::fmt` cannot emit non-UTF-8 bytes. The Zig spec writes raw
        // bytes via `writer.writeByte(c)`; routing through `to_str_lossy()` here was wrong
        // (it silently expanded each invalid byte to U+FFFD = 3 bytes, changing on-disk
        // store directory names). We now build the raw byte sequence via `write_to` and
        // pass it through only when it is already valid UTF-8 — otherwise we surface
        // `fmt::Error` rather than corrupt the path.
        // TODO(port): migrate callers (repository.rs, resolution.rs, isolated_install/*)
        // to the `write_to` byte sink so non-UTF-8 store paths round-trip exactly.
        let mut buf = Vec::with_capacity(self.str.len());
        self.write_to(&mut buf).map_err(|_| fmt::Error)?;
        f.write_str(core::str::from_utf8(&buf).map_err(|_| fmt::Error)?)
    }
}

pub fn fmt_store_path(str: &[u8]) -> StorePathFormatter<'_> {
    StorePathFormatter { str }
}

// these bytes are skipped
// so we just make it repeat bun bun bun bun bun bun bun bun bun
pub static ALIGNMENT_BYTES_TO_REPEAT_BUFFER: [u8; 144] = [0u8; 144];

pub fn initialize_store() {
    use bun_js_parser as js_ast;
    if INITIALIZED_STORE.with(|c| c.get()) {
        js_ast::ast::expr::data::Store::reset();
        js_ast::ast::stmt::data::Store::reset();
        return;
    }

    INITIALIZED_STORE.with(|c| c.set(true));
    js_ast::ast::expr::data::Store::create();
    js_ast::ast::stmt::data::Store::create();
}

/// The default store we use pre-allocates around 16 MB of memory per thread
/// That adds up in multi-threaded scenarios.
/// ASTMemoryAllocator uses a smaller fixed buffer allocator
pub fn initialize_mini_store() {
    use bun_alloc::Arena;
    use bun_js_parser as js_ast;

    struct MiniStore {
        heap: Arena,
        memory_allocator: js_ast::ASTMemoryAllocator,
    }

    thread_local! {
        static INSTANCE: Cell<Option<*mut MiniStore>> = const { Cell::new(None) };
    }

    INSTANCE.with(|instance| {
        if instance.get().is_none() {
            let heap = Arena::new();
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
            // PORT NOTE: Zig checked `stack_allocator.fixed_buffer_allocator.end_index >=
            // buffer.len() - 1` to decide whether to recycle the heap arena. The Rust
            // `ASTMemoryAllocator` collapses SFA+fallback into a single bumpalo arena
            // (see ASTMemoryAllocator.rs PORT STATUS), so there is no stack-buffer
            // watermark to inspect — `reset()` already releases all bump allocations.
            // PERF(port): was arena bulk-free (heap.deinit() + re-init) — profile in Phase B
            let _ = &mini_store.heap;
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
// Phase-A drafts use the Zig field-style lowercase names; alias both spellings.
pub const invalid_package_id: PackageID = INVALID_PACKAGE_ID;
pub const invalid_dependency_id: DependencyID = INVALID_DEPENDENCY_ID;
pub const bun_hash_tag: &[u8] = BUN_HASH_TAG;

pub type PackageNameAndVersionHash = u64;
/// Use String.Builder.stringHash to compute this
pub type PackageNameHash = u64;
/// @truncate String.Builder.stringHash to compute this
pub type TruncatedPackageNameHash = u32;

pub struct Aligner;

impl Aligner {
    pub fn write<T, W: std::io::Write>(writer: &mut W, pos: usize) -> std::io::Result<usize> {
        // TODO(port): narrow error set / use bun_io::Write once available
        let to_write = Self::skip_amount::<T>(pos);

        let remainder: &[u8] =
            &ALIGNMENT_BYTES_TO_REPEAT_BUFFER[0..to_write.min(ALIGNMENT_BYTES_TO_REPEAT_BUFFER.len())];
        writer.write_all(remainder)?;

        Ok(to_write)
    }

    #[inline]
    pub fn skip_amount<T>(pos: usize) -> usize {
        Self::skip_amount_with_align(core::mem::align_of::<T>(), pos)
    }

    #[inline]
    fn skip_amount_with_align(align: usize, pos: usize) -> usize {
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
        // SAFETY: Behavior is #[repr(transparent)] over u8 in dependency stub
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
    IsolatedPackageInstallContext(isolated_install::EntryId),
    RootDependency(DependencyID),
    RootRequestId(PackageID),
}

// We can't know all the packages we need until we've downloaded all the packages
// The easy way would be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependencies for resolution
// 2.

// TODO(b1): thiserror::Error derive removed — re-add once error chain is wired
#[derive(strum::IntoStaticStr, Debug, Copy, Clone, Eq, PartialEq)]
pub enum PackageManifestError {
    PackageManifestHTTP400,
    PackageManifestHTTP401,
    PackageManifestHTTP402,
    PackageManifestHTTP403,
    PackageManifestHTTP404,
    PackageManifestHTTP4xx,
    PackageManifestHTTP5xx,
}

impl core::fmt::Display for PackageManifestError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(<&'static str>::from(*self))
    }
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
