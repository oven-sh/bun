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
            ExprAccessors::as_property(self, key).map(|q| q.expr)
        }
    }
}

/// `bun_fs` → resolver-tier `FileSystem` is shimmed under `bun_sys::fs`
/// (see MOVE_DOWN(b0) note in src/sys/lib.rs).
pub(crate) mod bun_fs {
    pub use bun_sys::fs::*;
}

/// `bun_progress` → port of the slice of `std.Progress` that `bun install`
/// touches. Zig's `std.Progress` drives an ANSI spinner on a background
/// thread; Bun never actually shows it (stderr is owned by `bun.Output`),
/// it only threads `*Node` handles around for `setEstimatedTotalItems` /
/// `completeOne`. Model `Node` as a value-type counter (Zig `Progress.Node`
/// is `extern struct { index: OptionalIndex }` — also a small value type),
/// and have `start` hand back a fresh detached node. Real CLI rendering, if
/// ever wired, lives in `bun_cli`.
pub(crate) mod bun_progress {
    #[derive(Default)]
    pub struct Progress {
        root: Node,
    }
    #[derive(Default, Clone, Copy)]
    pub struct Node {
        /// `std.Progress.Node.unprotected_estimated_total_items`
        pub estimated_total_items: usize,
        /// `std.Progress.Node.unprotected_completed_items`
        pub completed_items: usize,
    }
    impl Progress {
        /// Zig: `std.Progress.start(name, estimated_total_items) *Node` —
        /// initialises the root node and returns it. Gated callers
        /// (`hoisted_install.rs`, `isolated_install.rs`) bind the result by
        /// value and immediately spawn children off it, so return `Node`
        /// rather than `&mut Node` to avoid the aliasing the Zig API never
        /// had (Zig's `*Node` is a non-exclusive pointer).
        pub fn start(&mut self, _name: &str, estimated_total_items: usize) -> Node {
            self.root = Node { estimated_total_items, completed_items: 0 };
            self.root
        }
        /// Zig: `std.Progress.refresh()` — repaint. Bun's stderr is owned by
        /// `bun.Output`, so this is a no-op here (matches the
        /// `supports_ansi_escape_codes == false` path in std.Progress).
        pub fn refresh(&mut self) {}
    }
    impl Node {
        /// Zig: `Node.start(name, estimated_total_items) *Node` — spawn a
        /// child node. Detached (non-rendering) parents return a fresh
        /// detached child; mirror that.
        pub fn start(&mut self, _name: &str, estimated_total_items: usize) -> Node {
            Node { estimated_total_items, completed_items: 0 }
        }
        pub fn set_estimated_total_items(&mut self, count: usize) {
            self.estimated_total_items = count;
        }
        pub fn complete_one(&mut self) {
            self.completed_items += 1;
        }
        pub fn set_completed_items(&mut self, count: usize) {
            self.completed_items = count;
        }
        pub fn end(&mut self) {}
        pub fn activate(&mut self) {}
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
 #[path = "lockfile.rs"] pub mod lockfile_real;
 #[path = "bin.rs"] pub mod bin_real;
 pub mod lifecycle_script_runner;
 #[path = "PackageInstall.rs"] pub mod package_install;
 #[path = "PackageInstaller.rs"] pub mod package_installer;
 #[path = "repository.rs"] pub mod repository_real;
 pub mod isolated_install;
 pub mod patch_install;
 pub mod hoisted_install;
 pub mod migration;
 pub mod pnpm;
 pub mod yarn;

/// Port of `Repository` (src/install/repository.zig) — string-handle struct
/// plus the comparison/serialise helpers `resolution.rs` / `dependency.rs`
/// need. The git-spawning side (`exec`, `tryHTTPS`, `download`, `checkout`)
/// stays in the gated `repository_real` module; only the lockfile-layout
/// methods live here so the un-gated callers compile against real bodies.
pub mod repository {
    use core::cmp::Ordering;
    use core::fmt;
    use bun_alloc::AllocError;
    use bun_semver::{String, StringBuilder};
    use bun_semver::semver_string::Buf as StringBuf;
    use bun_string::strings;

    #[derive(Default, Clone, Copy)]
    #[repr(C)]
    pub struct Repository {
        pub owner: String,
        pub repo: String,
        pub committish: String,
        pub resolved: String,
        pub package_name: String,
    }

    impl Repository {
        /// Zig: `Repository.parseAppendGit(input, *String.Buf) OOM!Repository`
        /// (src/install/repository.zig). Strips a leading `git+`, then splits
        /// on the **last** `#` into `repo` / `committish`.
        pub fn parse_append_git(
            input: &[u8],
            buf: &mut StringBuf<'_>,
        ) -> Result<Self, AllocError> {
            let mut remain = input;
            if strings::has_prefix_comptime(remain, b"git+") {
                remain = &remain[b"git+".len()..];
            }
            if let Some(hash) = strings::last_index_of_char(remain, b'#') {
                return Ok(Self {
                    repo: buf.append(&remain[..hash])?,
                    committish: buf.append(&remain[hash + 1..])?,
                    ..Self::default()
                });
            }
            Ok(Self { repo: buf.append(remain)?, ..Self::default() })
        }

        /// Zig: `Repository.parseAppendGithub(input, *String.Buf) OOM!Repository`.
        /// Strips a leading `github:`, then splits on the last `/` (owner/repo)
        /// and last `#` (committish). Mirrors the single-pass Zig loop exactly
        /// — it records the **last** of each, so `a/b/c#d#e` → owner=`a/b`,
        /// repo=`c#d`, committish=`e` (matching Zig bug-for-bug).
        pub fn parse_append_github(
            input: &[u8],
            buf: &mut StringBuf<'_>,
        ) -> Result<Self, AllocError> {
            let mut remain = input;
            if strings::has_prefix_comptime(remain, b"github:") {
                remain = &remain[b"github:".len()..];
            }
            let mut hash: usize = 0;
            let mut slash: usize = 0;
            for (i, &c) in remain.iter().enumerate() {
                match c {
                    b'/' => slash = i,
                    b'#' => hash = i,
                    _ => {}
                }
            }

            let repo = if hash == 0 {
                &remain[slash + 1..]
            } else {
                &remain[slash + 1..hash]
            };

            let mut result = Self {
                owner: buf.append(&remain[..slash])?,
                repo: buf.append(repo)?,
                ..Self::default()
            };

            if hash != 0 {
                result.committish = buf.append(&remain[hash + 1..])?;
            }

            Ok(result)
        }

        /// Zig: `Repository.order` — lexicographic on owner→repo→committish.
        pub fn order(&self, rhs: &Self, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
            let owner_order = self.owner.order(&rhs.owner, lhs_buf, rhs_buf);
            if owner_order != Ordering::Equal {
                return owner_order;
            }
            let repo_order = self.repo.order(&rhs.repo, lhs_buf, rhs_buf);
            if repo_order != Ordering::Equal {
                return repo_order;
            }
            self.committish.order(&rhs.committish, lhs_buf, rhs_buf)
        }

        /// Zig: `Repository.count(buf, comptime StringBuilder, builder)` —
        /// register every string field with the two-phase builder.
        pub fn count<B: StringBuilder>(&self, buf: &[u8], builder: &mut B) {
            builder.count(self.owner.slice(buf));
            builder.count(self.repo.slice(buf));
            builder.count(self.committish.slice(buf));
            builder.count(self.resolved.slice(buf));
            builder.count(self.package_name.slice(buf));
        }

        /// Zig: `Repository.clone(buf, comptime StringBuilder, builder)`.
        pub fn clone<B: StringBuilder>(&self, buf: &[u8], builder: &mut B) -> Self {
            Self {
                owner: builder.append::<String>(self.owner.slice(buf)),
                repo: builder.append::<String>(self.repo.slice(buf)),
                committish: builder.append::<String>(self.committish.slice(buf)),
                resolved: builder.append::<String>(self.resolved.slice(buf)),
                package_name: builder.append::<String>(self.package_name.slice(buf)),
            }
        }

        /// Zig: `Repository.eql` — owner+repo must match; then `resolved` if
        /// both non-empty, else fall back to `committish`.
        pub fn eql(&self, rhs: &Self, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool {
            if !self.owner.eql(rhs.owner, lhs_buf, rhs_buf) {
                return false;
            }
            if !self.repo.eql(rhs.repo, lhs_buf, rhs_buf) {
                return false;
            }
            if self.resolved.is_empty() || rhs.resolved.is_empty() {
                return self.committish.eql(rhs.committish, lhs_buf, rhs_buf);
            }
            self.resolved.eql(rhs.resolved, lhs_buf, rhs_buf)
        }

        /// Zig: `Repository.formatAs(label, buf, writer)` — direct port of
        /// `Repository.Formatter.format`.
        pub fn format_as(
            &self,
            label: &str,
            buf: &[u8],
            writer: &mut fmt::Formatter<'_>,
        ) -> fmt::Result {
            debug_assert!(!label.is_empty());
            writer.write_str(label)?;

            let repo = self.repo.slice(buf);
            if !self.owner.is_empty() {
                write!(writer, "{}", bstr::BStr::new(self.owner.slice(buf)))?;
                writer.write_str("/")?;
            } else if crate::dependency::is_scp_like_path(repo) {
                writer.write_str("ssh://")?;
            }
            write!(writer, "{}", bstr::BStr::new(repo))?;

            if !self.resolved.is_empty() {
                writer.write_str("#")?;
                let mut resolved = self.resolved.slice(buf);
                if let Some(i) = strings::last_index_of_char(resolved, b'-') {
                    resolved = &resolved[i + 1..];
                }
                write!(writer, "{}", bstr::BStr::new(resolved))?;
            } else if !self.committish.is_empty() {
                writer.write_str("#")?;
                write!(writer, "{}", bstr::BStr::new(self.committish.slice(buf)))?;
            }
            Ok(())
        }

        /// Zig: `Repository.fmt(label, buf) Formatter` — Display adapter over
        /// `format_as`.
        pub fn fmt<'a>(&'a self, label: &'a str, buf: &'a [u8]) -> Formatter<'a> {
            Formatter { label, buf, repository: self }
        }

        /// Zig: `Repository.fmtStorePath(label, string_buf) StorePathFormatter`.
        pub fn fmt_store_path<'a>(
            &'a self,
            label: &'a str,
            string_buf: &'a [u8],
        ) -> StorePathFormatter<'a> {
            StorePathFormatter { repo: self, label, string_buf }
        }
    }

    pub struct Formatter<'a> {
        pub label: &'a str,
        pub buf: &'a [u8],
        pub repository: &'a Repository,
    }
    impl fmt::Display for Formatter<'_> {
        fn fmt(&self, w: &mut fmt::Formatter<'_>) -> fmt::Result {
            self.repository.format_as(self.label, self.buf, w)
        }
    }

    /// Port of `Repository.StorePathFormatter` (src/install/repository.zig).
    /// Filesystem-safe rendering: `/`→`+`, `#`→`+`, individual segments go
    /// through `Install.fmtStorePath` (= `crate::fmt_store_path`).
    pub struct StorePathFormatter<'a> {
        pub repo: &'a Repository,
        pub label: &'a str,
        pub string_buf: &'a [u8],
    }
    impl fmt::Display for StorePathFormatter<'_> {
        fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(writer, "{}", crate::fmt_store_path(self.label.as_bytes()))?;

            if !self.repo.owner.is_empty() {
                write!(writer, "{}", self.repo.owner.fmt_store_path(self.string_buf))?;
                // would be '/' but that's a path separator
                writer.write_str("+")?;
            } else if crate::dependency::is_scp_like_path(self.repo.repo.slice(self.string_buf)) {
                // would be "ssh://" but '/' is a path separator
                writer.write_str("ssh++")?;
            }

            write!(writer, "{}", self.repo.repo.fmt_store_path(self.string_buf))?;

            if !self.repo.resolved.is_empty() {
                // would be '#' but that's not valid on windows
                writer.write_str("+")?;
                let mut resolved = self.repo.resolved.slice(self.string_buf);
                if let Some(i) = strings::last_index_of_char(resolved, b'-') {
                    resolved = &resolved[i + 1..];
                }
                write!(writer, "{}", crate::fmt_store_path(resolved))?;
            } else if !self.repo.committish.is_empty() {
                writer.write_str("+")?;
                write!(
                    writer,
                    "{}",
                    self.repo.committish.fmt_store_path(self.string_buf)
                )?;
            }
            Ok(())
        }
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
        #[derive(Default, Clone, Copy)] pub struct Meta {
            pub arch: crate::npm::Architecture,
            pub os: crate::npm::OperatingSystem,
        }
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

// B-2: `hosted_git_info_stub` removed — the real `hosted_git_info` module
// (src/install/hosted_git_info.rs) is un-gated above and carries the full
// `HostedGitInfo::from_url` / `parse_url` / `is_github_shorthand` ports. The
// inline stub had zero call sites and its `UrlProtocol`/`Representation`
// shapes had already diverged from the Zig source.

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
impl ExtractTarball {
    /// Stub for `ExtractTarball.run` (src/install/extract_tarball.zig). Real
    /// body lives in the gated `extract_tarball.rs`; this signature lets
    /// `PackageManagerTask` type-check until that module is un-gated.
    pub fn run(
        &self,
        _log: &mut bun_logger::Log,
        _bytes: &[u8],
    ) -> Result<ExtractData, bun_core::Error> {
        Err(bun_core::err!("ExtractTarballNotPorted"))
    }
}
/// Stub for `NetworkTask` — only the fields `PackageManagerTask::callback`
/// reads are exposed. Full struct lives in the gated `NetworkTask.rs`.
#[derive(Default)] pub struct NetworkTask {
    pub response_buffer: bun_string::MutableString,
    pub response: NetworkTaskResponseStub,
    pub callback: NetworkTaskCallbackStub,
}
/// Owned subset of `bun_http::HTTPClientResult` (the real one borrows the body
/// slice so cannot be `'static` here).
#[derive(Default)] pub struct NetworkTaskResponseStub {
    pub metadata: Option<bun_http::HTTPResponseMetadata>,
    pub fail: Option<bun_core::Error>,
}
#[derive(Default)] pub struct NetworkTaskCallbackStub {
    pub package_manifest: NetworkTaskManifestCallbackStub,
}
#[derive(Default)] pub struct NetworkTaskManifestCallbackStub {
    pub loaded_manifest: Option<npm::PackageManifest>,
    pub is_extended_manifest: bool,
}
#[derive(Default)] pub struct TarballStream;
#[derive(Default)] pub struct PackageManager {
    pub options: PackageManagerOptionsStub,
    pub timestamp_for_manifest_cache_control: u32,
    /// Zig: `cache_directory_: ?std.fs.Dir` — lazy-initialised by
    /// `getCacheDirectory`.
    pub cache_directory_: Option<bun_sys::Fd>,
    /// Zig: `cache_directory_path: stringZ` — populated as a side-effect of
    /// `ensureCacheDirectory`.
    pub cache_directory_path: Vec<u8>,
    /// Zig: held inside `getTemporaryDirectoryOnce`; lifted onto the struct
    /// here so the stub doesn't need a global `bun.once`.
    temp_directory_: Option<bun_sys::Fd>,
    temp_directory_path: Vec<u8>,
    /// Zig: `known_npm_aliases: std.AutoHashMapUnmanaged(u64, void)`.
    pub known_npm_aliases: std::collections::HashMap<u64, ()>,
    /// Zig: `resolve_tasks: bun.UnboundedQueue(Task, .next)` — completed
    /// off-thread tasks awaiting main-thread `runTasks` drain.
    pub resolve_tasks: bun_threading::UnboundedQueue<package_manager_task::Task>,
    /// Zig: `thread_pool: ThreadPool`.
    pub thread_pool: bun_threading::ThreadPool,
}
#[derive(Default)] pub struct PackageManagerOptionsStub {
    pub enable: PackageManagerEnableStub,
    /// Zig: `Options.cache_directory` — bunfig override.
    pub cache_directory: Vec<u8>,
    /// Zig: `Options.scope: Npm.Registry.Scope`.
    pub scope: npm::registry::Scope,
    /// Zig: `Options.publish_config`.
    pub publish_config: PublishConfigStub,
}
#[derive(Default)] pub struct PublishConfigStub {
    pub auth_type: Option<bun_options_types::schema::api::AuthType>,
}
#[derive(Default)] pub struct PackageManagerEnableStub {
    pub manifest_cache: bool,
    pub manifest_cache_control: bool,
    /// Zig: `Options.Enable.cache` — drives the `ensureCacheDirectory`
    /// fallback to `node_modules/.cache`.
    pub cache: bool,
}
pub struct PackageManagerTmpDirStub {
    pub handle: bun_sys::Fd,
    pub path: &'static [u8],
    pub name: &'static [u8],
}
#[derive(Default)] pub struct FolderResolution;
#[derive(Default)] pub struct LifecycleScriptSubprocess;
#[derive(Default)] pub struct SecurityScanSubprocess;
#[derive(Default)] pub struct PackageInstall;
#[derive(Default)] pub struct Store;
#[derive(Default)] pub struct FileCopier;
#[derive(Default)] pub struct PatchTask {
    pub callback: PatchTaskCallbackStub,
}
#[derive(Default)] pub struct PatchTaskCallbackStub {
    pub apply: PatchTaskApplyStub,
}
#[derive(Default)] pub struct PatchTaskApplyStub {
    pub logger: bun_logger::Log,
}
impl PatchTask {
    /// Stub for `PatchTask.apply` (src/install/patch_install.zig). Real body
    /// lives in the gated `patch_install.rs`.
    pub fn apply(&mut self) {}
}

/// `crate::ci_info` — install-tier shim for `bun_runtime::cli::ci_info`
/// (`src/runtime/cli/ci_info.rs`). Only `detect_ci_name` is exposed; the
/// CI-probe table itself is generated at build time in `bun_runtime` and is
/// not reachable from this tier, so the shim returns the `CI` env var name
/// when set (the same fallback `npm-registry-fetch` uses) and `None` otherwise.
pub mod ci_info {
    pub fn detect_ci_name() -> Option<&'static [u8]> {
        // Port of the trailing fallback in `ci_info.zig:detectCiName` —
        // the per-vendor probes live in `bun_runtime` (T6) and are wired in
        // there; install only needs *some* answer for the user-agent string.
        if std::env::var_os("CI").is_some() {
            return Some(b"ci");
        }
        None
    }
}

/// Process-lifetime singleton — Zig: `var instance: PackageManager = undefined;`
/// (src/install/PackageManager.zig). Allocated at `PackageManager.init()`.
static mut PACKAGE_MANAGER_INSTANCE: *mut PackageManager = core::ptr::null_mut();

impl PackageManager {
    pub fn verbose_install() -> bool { false }

    /// Zig: `PackageManager.get()` — returns the process-global instance.
    /// SAFETY: callers must ensure `init()` has run (mirrors Zig's
    /// `&instance` which is undefined before init).
    pub fn get() -> &'static mut PackageManager {
        // SAFETY: process-lifetime singleton; mirrors Zig `&instance`.
        unsafe {
            if PACKAGE_MANAGER_INSTANCE.is_null() {
                PACKAGE_MANAGER_INSTANCE = Box::into_raw(Box::<PackageManager>::default());
            }
            &mut *PACKAGE_MANAGER_INSTANCE
        }
    }

    /// Zig: `PackageManager.wake()` — nudges the event loop to drain
    /// `resolve_tasks`. Real impl posts to `uws.Loop`; stubbed until
    /// `bun_event_loop` exposes the package-manager loop handle.
    pub fn wake(&self) {}

    /// Zig: `PackageManager.scopeForPackageName(name)`.
    pub fn scope_for_package_name(&self, _name: &[u8]) -> &npm::registry::Scope {
        &self.options.scope
    }

    /// Port of `directories.getCacheDirectory`
    /// (src/install/PackageManager/PackageManagerDirectories.zig:1).
    /// Lazy-init: first call runs `ensure_cache_directory`, stashes the fd,
    /// and every subsequent call returns it.
    pub fn get_cache_directory(&mut self) -> bun_sys::Fd {
        if let Some(d) = self.cache_directory_ {
            return d;
        }
        let d = self.ensure_cache_directory();
        self.cache_directory_ = Some(d);
        d
    }

    /// Port of `directories.ensureCacheDirectory`
    /// (src/install/PackageManager/PackageManagerDirectories.zig:121).
    #[inline(never)]
    fn ensure_cache_directory(&mut self) -> bun_sys::Fd {
        use bun_sys::{Dir, OpenDirOptions};
        loop {
            if self.options.enable.cache {
                // Zig: `fetchCacheDirectoryPath(this.env, &this.options)`.
                // The DotEnv loader isn't on the stub; route through the
                // process env directly (same precedence — see
                // PackageManagerDirectories.zig:152).
                let cache_dir_path = if !self.options.cache_directory.is_empty() {
                    self.options.cache_directory.clone()
                } else {
                    bun_sys::fetch_cache_directory_path()
                };
                self.cache_directory_path = cache_dir_path.clone();

                match Dir::cwd().make_open_path(&cache_dir_path, OpenDirOptions::default()) {
                    Ok(dir) => return dir.fd,
                    Err(_) => {
                        self.options.enable.cache = false;
                        self.cache_directory_path.clear();
                        continue;
                    }
                }
            }

            // Fallback: `node_modules/.cache` under cwd. Zig joins against
            // `Fs.FileSystem.instance.top_level_dir`; that singleton lives in
            // `bun_resolver` (T4). Until the vtable is wired the cwd-relative
            // path is equivalent — `top_level_dir` is initialised to cwd.
            self.cache_directory_path = b"node_modules/.cache".to_vec();
            match Dir::cwd().make_open_path(b"node_modules/.cache", OpenDirOptions::default()) {
                Ok(dir) => return dir.fd,
                Err(err) => {
                    bun_core::Output::pretty_errorln(
                        format_args!("<r><red>error<r>: bun is unable to write files: {}", err),
                    );
                    bun_core::Global::crash();
                }
            }
        }
    }

    /// Port of `directories.getTemporaryDirectory`
    /// (src/install/PackageManager/PackageManagerDirectories.zig:13).
    /// The chosen tempdir must be on the **same filesystem** as the cache
    /// directory so `renameat()` works (extract→cache moves). Mirror the Zig
    /// strategy: try the system tempdir, but if creating/renaming a probe
    /// file fails, fall back to `<cache>/.tmp`.
    pub fn get_temporary_directory(&mut self) -> PackageManagerTmpDirStub {
        if let Some(fd) = self.temp_directory_ {
            // SAFETY: temp_directory_path is set whenever temp_directory_ is.
            // Leak as 'static — PackageManager is process-lifetime.
            let path: &'static [u8] = unsafe {
                core::slice::from_raw_parts(
                    self.temp_directory_path.as_ptr(),
                    self.temp_directory_path.len(),
                )
            };
            return PackageManagerTmpDirStub { handle: fd, path, name: b".tmp" };
        }

        use bun_sys::{Dir, OpenDirOptions};
        let cache_directory = self.get_cache_directory();

        // The chosen tempdir must be on the same filesystem as the cache
        // directory — this makes renameat() work.
        // PORT NOTE: Zig also tries `Fs.FileSystem.RealFS.getDefaultTempDir()`
        // first and probes with a renameat() across the boundary; that helper
        // lives in `bun_resolver`. Until it's reachable from this tier, go
        // straight to the cache-relative `.tmp` (the path Zig falls back to
        // anyway whenever the system tempdir is on a different mount — which
        // it almost always is on Linux/macOS with `/tmp` on tmpfs).
        let tempdir = match Dir { fd: cache_directory }
            .make_open_path(b".tmp", OpenDirOptions::default())
        {
            Ok(d) => d,
            Err(err) => {
                bun_core::Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: bun is unable to access tempdir: {}",
                    err
                ));
                bun_core::Global::crash();
            }
        };

        let mut path = self.cache_directory_path.clone();
        if !path.is_empty() && *path.last().unwrap() != bun_paths::SEP {
            path.push(bun_paths::SEP);
        }
        path.extend_from_slice(b".tmp");
        self.temp_directory_path = path;
        self.temp_directory_ = Some(tempdir.fd);

        // SAFETY: temp_directory_path lives as long as PackageManager (process-lifetime).
        let path_ref: &'static [u8] = unsafe {
            core::slice::from_raw_parts(
                self.temp_directory_path.as_ptr(),
                self.temp_directory_path.len(),
            )
        };
        PackageManagerTmpDirStub { handle: tempdir.fd, path: path_ref, name: b".tmp" }
    }
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
        // Zig: `var this_transpiler: Transpiler = undefined` out-param. Taking
        // `&mut MaybeUninit<T>` so the caller never has to materialize a `&mut T`
        // pointing at uninitialized memory (which is UB regardless of whether the
        // callee writes-before-read).
        this_transpiler_out: &mut core::mem::MaybeUninit<bun_transpiler::Transpiler>,
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
        let this_transpiler = this_transpiler_out
            .write(bun_transpiler::Transpiler::init(ctx.allocator, ctx.log, ctx.args, Some(env))?);
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
            // SAFETY: pointer was Box::into_raw'd on this thread in the branch above and is
            // never freed; INSTANCE is thread-local and `Cell::get` copies the raw pointer
            // out (no borrow of the Cell is held), so this `&mut` is the sole live reference
            // to the allocation for its entire scope — no aliasing. Mirrors Zig's
            // `threadlocal var instance: ?*MiniStore` single-owner deref.
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
    pub fn write<T, W: bun_io::Write>(writer: &mut W, pos: u64) -> bun_io::Result<usize> {
        // TODO(port): narrow error set
        let to_write = Self::skip_amount::<T>(pos as usize);

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
