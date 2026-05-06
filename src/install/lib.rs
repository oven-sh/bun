#![allow(unused, nonstandard_style, ambiguous_glob_reexports, incomplete_features)]
#![feature(adt_const_params)]

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

    impl Resolution {
        /// Port of `Resolution.fmt` (src/install/resolution.zig:275).
        pub fn fmt<'a>(
            &'a self,
            buf: &'a [u8],
            path_sep: bun_core::fmt::PathSep,
        ) -> Formatter<'a> {
            Formatter { resolution: self, buf, path_sep }
        }
    }

    /// Port of `Resolution.Formatter` (src/install/resolution.zig:400).
    pub struct Formatter<'a> {
        pub resolution: &'a Resolution,
        pub buf: &'a [u8],
        pub path_sep: bun_core::fmt::PathSep,
    }

    impl<'a> core::fmt::Display for Formatter<'a> {
        fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            use bun_core::fmt::{fmt_path_u8, PathFormatOptions};
            let buf = self.buf;
            let value = &self.resolution.value;
            let opts = PathFormatOptions { path_sep: self.path_sep, ..Default::default() };
            match self.resolution.tag {
                Tag::Npm => write!(writer, "{}", value.npm.version.fmt(buf)),
                Tag::LocalTarball => {
                    write!(writer, "{}", fmt_path_u8(value.local_tarball.slice(buf), opts))
                }
                Tag::Folder => write!(writer, "{}", fmt_path_u8(value.folder.slice(buf), opts)),
                Tag::RemoteTarball => {
                    writer.write_str(&String::from_utf8_lossy(value.remote_tarball.slice(buf)))
                }
                Tag::Git => value.git.format_as("git+", buf, writer),
                Tag::Github => value.github.format_as("github:", buf, writer),
                Tag::Workspace => {
                    write!(writer, "workspace:{}", fmt_path_u8(value.workspace.slice(buf), opts))
                }
                Tag::Symlink => {
                    write!(writer, "link:{}", fmt_path_u8(value.symlink.slice(buf), opts))
                }
                Tag::SingleFileModule => write!(
                    writer,
                    "module:{}",
                    bstr::BStr::new(value.single_file_module.slice(buf))
                ),
                _ => Ok(()),
            }
        }
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
        /// Zig: `Repository.tryHTTPS(url)` (src/install/repository.zig).
        /// Returns the URL rewritten for an HTTPS clone if the input looks
        /// like a git URL with a host component, else `None`. Full rewrite
        /// table lives in the gated `repository_real`; this preserves the
        /// `git+https://`/`https://` passthrough so callers can attempt the
        /// HTTPS path first.
        pub fn try_https(url: &[u8]) -> Option<&[u8]> {
            if strings::has_prefix_comptime(url, b"git+https://") {
                return Some(&url[b"git+".len()..]);
            }
            if strings::has_prefix_comptime(url, b"https://") {
                return Some(url);
            }
            None
        }

        /// Zig: `Repository.trySSH(url)` (src/install/repository.zig).
        pub fn try_ssh(url: &[u8]) -> Option<&[u8]> {
            if strings::has_prefix_comptime(url, b"git+ssh://")
                || strings::has_prefix_comptime(url, b"ssh://")
            {
                return Some(url);
            }
            if strings::index_of_char(url, b'@').is_some() && !strings::contains(url, b"://") {
                // scp-style `user@host:path` — git accepts as-is
                return Some(url);
            }
            None
        }

        /// Zig: `Repository.download(...)` — spawns `git clone`. Real body in
        /// gated `repository_real`; stub returns a typed error so the caller's
        /// fallback chain (`try_https` → `try_ssh`) is exercised.
        pub fn download(
            _env: &bun_dotenv::Map,
            _log: &mut bun_logger::Log,
            _cache_dir: bun_sys::Fd,
            _task_id: crate::package_manager_task::Id,
            _name: &[u8],
            _url: &[u8],
            _attempt: u8,
        ) -> Result<bun_sys::Dir, bun_core::Error> {
            Err(bun_core::err!("RepositoryNotPorted"))
        }

        /// Zig: `Repository.checkout(...)`. Real body in gated `repository_real`.
        pub fn checkout(
            _env: &bun_dotenv::Map,
            _log: &mut bun_logger::Log,
            _cache_dir: bun_sys::Fd,
            _repo_dir: bun_sys::Dir,
            _name: &[u8],
            _url: &[u8],
            _resolved: &[u8],
        ) -> Result<crate::ExtractData, bun_core::Error> {
            Err(bun_core::err!("RepositoryNotPorted"))
        }

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
    use crate::{Dependency, DependencyID, PackageID, PackageNameHash};
    use crate::external_slice::ExternalSlice;
    use crate::resolution::Resolution;

    pub type DependencyIDSlice = ExternalSlice<DependencyID>;
    pub type DependencyIDList = Vec<DependencyID>;
    pub type DependencySlice = ExternalSlice<Dependency>;
    pub type PackageIDList = Vec<PackageID>;

    pub use crate::Origin;

    /// Port of `Lockfile.DepSorter` (src/install/lockfile.zig) — comparator over
    /// `buffers.dependencies` by `(behavior, name)`. Kept in the stub module so it
    /// types against the stub `Lockfile`/`Buffers` until `lockfile_real` un-gates.
    pub struct DepSorter<'a> {
        pub lockfile: &'a Lockfile,
    }
    impl<'a> DepSorter<'a> {
        pub fn is_less_than(&self, l: DependencyID, r: DependencyID) -> bool {
            use core::cmp::Ordering;
            let deps_buf = self.lockfile.buffers.dependencies.as_slice();
            let string_buf = self.lockfile.buffers.string_bytes.as_slice();
            let l_dep = &deps_buf[l as usize];
            let r_dep = &deps_buf[r as usize];
            match l_dep.behavior.cmp(&r_dep.behavior) {
                Ordering::Less => true,
                Ordering::Greater => false,
                Ordering::Equal => {
                    bun_string::order(
                        l_dep.name.slice(string_buf),
                        r_dep.name.slice(string_buf),
                    ) == Ordering::Less
                }
            }
        }
    }

    #[derive(Default)] pub struct Lockfile {
        pub buffers: Buffers,
        pub packages: PackageList,
    }
    impl Lockfile {
        /// Port of `Lockfile.getWorkspacePackageID`
        /// (src/install/lockfile.zig:621). Returns the package id whose
        /// resolution tag is `.workspace` and whose `name_hash` matches; falls
        /// back to root (0) when no match / no workspace hash.
        pub fn get_workspace_package_id(
            &self,
            workspace_name_hash: Option<PackageNameHash>,
        ) -> PackageID {
            let Some(hash) = workspace_name_hash else { return 0 };
            let pkgs = self.packages.slice();
            let name_hashes = pkgs.items_name_hash();
            let resolutions = pkgs.items_resolution();
            for (i, (res, name_hash)) in
                resolutions.iter().zip(name_hashes.iter()).enumerate()
            {
                if res.tag == crate::resolution::Tag::Workspace && *name_hash == hash {
                    return i as PackageID;
                }
            }
            // should not hit this, default to root just in case
            0
        }
    }
    /// Stub: `MultiArrayList<Package>` column accessor surface. Real body in
    /// `lockfile.rs` (gated behind `package_manager_real`, reconciler-6).
    /// Backed by per-column Vecs so the audit/why CLI walkers can iterate
    /// `name` / `dependencies` / `resolutions` / `resolution` without
    /// instantiating the full `MultiArrayList<Package>` (which still has 1200+
    /// port errors against `bun_semver` generics).
    #[derive(Default)] pub struct PackageList {
        pub name: Vec<bun_semver::String>,
        pub name_hash: Vec<PackageNameHash>,
        pub dependencies: Vec<ExternalSlice<Dependency>>,
        pub resolutions: Vec<ExternalSlice<PackageID>>,
        pub resolution: Vec<Resolution>,
    }
    impl PackageList {
        #[inline] pub fn slice(&self) -> &Self { self }
        #[inline] pub fn len(&self) -> usize { self.name.len() }
        #[inline] pub fn is_empty(&self) -> bool { self.name.is_empty() }
        #[inline] pub fn items_name(&self) -> &[bun_semver::String] { &self.name }
        #[inline] pub fn items_name_hash(&self) -> &[PackageNameHash] { &self.name_hash }
        #[inline] pub fn items_dependencies(&self) -> &[ExternalSlice<Dependency>] { &self.dependencies }
        #[inline] pub fn items_resolutions(&self) -> &[ExternalSlice<PackageID>] { &self.resolutions }
        #[inline] pub fn items_resolution(&self) -> &[Resolution] { &self.resolution }
    }
    #[derive(Default)] pub struct Buffers {
        pub string_bytes: Vec<u8>,
        pub dependencies: Vec<Dependency>,
        pub resolutions: Vec<PackageID>,
    }
    #[derive(Default)] pub struct PatchedDep;
    #[derive(Default)] pub struct LoadStep;

    /// Port of `Lockfile.LoadResult` (src/install/lockfile.zig). Typed against
    /// the stub `Lockfile` so migration entrypoints (`yarn.rs` / `pnpm.rs` /
    /// `migration.rs`) can construct the `Ok` payload before `lockfile_real`
    /// un-gates.
    pub enum LoadResult<'a> {
        NotFound,
        Err(LoadResultErr),
        Ok(LoadResultOk<'a>),
    }
    impl Default for LoadResult<'_> {
        fn default() -> Self { LoadResult::NotFound }
    }
    #[derive(Default)]
    pub struct LoadResultErr {
        pub step: LoadStep,
        pub value: bun_core::Error,
        pub lockfile_path: &'static [u8],
        pub format: Format,
    }
    pub struct LoadResultOk<'a> {
        pub lockfile: &'a mut Lockfile,
        pub loaded_from_binary_lockfile: bool,
        pub migrated: Migrated,
        pub serializer_result: SerializerLoadResult,
        pub format: Format,
    }
    /// Stub: `Serializer.LoadResult` (src/install/lockfile/bun.lockb.zig).
    #[derive(Default)] pub struct SerializerLoadResult;

    /// Port of `Lockfile.LoadResult.Migrated` (src/install/lockfile.zig).
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub enum Migrated { #[default] None, Npm, Yarn, Pnpm }

    /// Port of `Lockfile.Format` (src/install/lockfile.zig).
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub enum Format { #[default] Text, Binary }

    /// Port of `Lockfile.PackageIndex.Entry` (src/install/lockfile.zig).
    pub enum PackageIndexEntry {
        Id(PackageID),
        Ids(PackageIDList),
    }

    pub use package::{Meta, HasInstallScript};
    pub use tree::Tree;

    pub mod package {
        use bun_semver::String;
        use crate::integrity::Integrity;
        use crate::{Origin, PackageID};

        /// Port of `Package.Meta` (src/install/lockfile/Package/Meta.zig).
        #[derive(Default, Clone, Copy)]
        pub struct Meta {
            pub origin: Origin,
            pub arch: crate::npm::Architecture,
            pub os: crate::npm::OperatingSystem,
            pub id: PackageID,
            pub man_dir: String,
            pub integrity: Integrity,
            pub has_install_script: HasInstallScript,
        }

        /// Port of `Package.Meta.HasInstallScript`
        /// (src/install/lockfile/Package/Meta.zig).
        #[derive(Default, Clone, Copy, PartialEq, Eq)]
        #[repr(u8)]
        pub enum HasInstallScript {
            /// Legacy lockfiles wrote 0 unconditionally; treated as "unknown".
            Old = 0,
            #[default]
            False = 1,
            True = 2,
        }

        /// Port: `Lockfile.Package` (src/install/lockfile/Package.zig) — the
        /// real generic instantiated at `u64` (matches Zig `Package(u64)`).
        /// Re-exported from the file-backed module so callers in
        /// `package_manager_real` (runTasks / Enqueue) can name
        /// `bun_install::lockfile::Package` until `lockfile_real` un-gates.
        pub type Package = crate::lockfile_real::package::Package<u64>;

        /// Port of `Package.Scripts` / `Package.Scripts.List`
        /// (src/install/lockfile/Package/Scripts.zig). Stub shapes so
        /// `isolated_install::{Installer,Store}` resolve until
        /// `lockfile_real::package::scripts` un-gates; real bodies live in
        /// `lockfile/Package/Scripts.rs`.
        pub mod scripts {
            use bun_semver::String;
            use crate::resolution::Resolution;
            use crate::Lockfile;

            #[derive(Default, Clone, Copy)]
            pub struct Scripts {
                pub preinstall: String,
                pub install: String,
                pub postinstall: String,
                pub preprepare: String,
                pub prepare: String,
                pub postprepare: String,
                pub filled: bool,
            }
            impl Scripts {
                /// Stub: real impl in `lockfile/Package/Scripts.rs::get_list`.
                pub fn get_list(
                    &mut self,
                    _log: &mut bun_logger::Log,
                    _lockfile: &Lockfile,
                    _cwd: &mut impl bun_paths::PathLike,
                    _name: &[u8],
                    _res: &Resolution,
                ) -> Result<Option<List>, bun_core::Error> {
                    todo!("blocked_on: lockfile_real::package::scripts un-gate (reconciler-6)")
                }
            }
            /// `Package.Scripts.List` — the resolved per-hook command list.
            #[derive(Default)]
            pub struct List {
                pub first_index: u8,
                pub total: u8,
                pub items: [Option<Box<[u8]>>; 6],
                pub cwd: Box<[u8]>,
                pub package_name: Box<[u8]>,
            }
        }
    }
    pub use package::Package;
    /// `Lockfile.Scripts` (src/install/lockfile.zig) — re-export the real
    /// impl so `Lockfile::Scripts::NAMES` resolves for lifecycle scripts.
    pub use crate::lockfile_real::Scripts;
    pub mod tree {
        use crate::DependencyID;
        use super::DependencyIDSlice;

        pub type Id = u32;

        /// `Lockfile.Tree.invalid_id` (src/install/lockfile/Tree.zig).
        pub const INVALID_ID: Id = Id::MAX;
        /// `Lockfile.Tree.max_depth`.
        pub const MAX_DEPTH: usize = 256;
        /// `Lockfile.Tree.DepthBuf` — fixed-size hoist-depth scratch.
        pub type DepthBuf = [Id; MAX_DEPTH];
        /// `Lockfile.Tree.Iterator.PathStyle`
        /// (src/install/lockfile/Tree.zig). Aliased as `PathStyle` to match
        /// the Zig namespace `Tree.Iterator(.node_modules)` callers use.
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub enum IteratorPathStyle { NodeModules, PkgPath }
        pub use IteratorPathStyle as PathStyle;

        /// Port of `Lockfile.Tree` (src/install/lockfile/Tree.zig) — the
        /// hoisted dependency tree node. Associated consts mirror the Zig
        /// module-level `invalid_id` / `root_dep_id`.
        #[derive(Clone, Copy)]
        pub struct Tree {
            pub id: Id,
            pub dependency_id: DependencyID,
            pub parent: Id,
            pub dependencies: DependencyIDSlice,
        }
        impl Tree {
            pub const INVALID_ID: Id = Id::MAX;
            pub const ROOT_DEP_ID: DependencyID = crate::INVALID_PACKAGE_ID - 1;
        }
        impl Default for Tree {
            fn default() -> Self {
                Self {
                    id: Self::INVALID_ID,
                    dependency_id: crate::INVALID_PACKAGE_ID,
                    parent: Self::INVALID_ID,
                    dependencies: DependencyIDSlice::default(),
                }
            }
        }

        /// Port of `Lockfile.Tree.relativePathAndDepth`
        /// (src/install/lockfile/Tree.zig). Typed against the stub `Lockfile`
        /// so `PackageInstaller::link_remaining_bins` can call it before
        /// `lockfile_real` un-gates. Full body lives in
        /// `lockfile_real::tree::relative_path_and_depth`.
        pub fn relative_path_and_depth<'b>(
            _lockfile: &super::Lockfile,
            _tree_id: Id,
            path_buf: &'b mut bun_paths::PathBuffer,
            _depth_buf: &mut DepthBuf,
            _style: IteratorPathStyle,
        ) -> (&'b [u8], usize) {
            // TODO(port): the stub `Buffers` lacks `.trees`; route to the real
            // impl once the Lockfile types unify (reconciler-6).
            path_buf[0] = 0;
            (&path_buf[..0], 0)
        }
    }
    pub mod bun_lock {}
}
/// `UpdateRequest` — mounted directly (sibling of the gated
/// `package_manager_real`) so `bunx_command` / `outdated_command` can name
/// `bun_install::update_request::{UpdateRequest, Array}` while
#[path = "PackageManager/UpdateRequest.rs"]
pub mod update_request;
pub use update_request::UpdateRequest;

/// Stub: `package_manager` — `PackageManager` struct + `Subcommand` enum only.
pub mod package_manager {
    pub use super::PackageManager;
    pub use super::Subcommand;
    pub use super::update_request;
    /// Stub: `PackageManager.Options` (src/install/PackageManager/PackageManagerOptions.zig).
    #[allow(non_snake_case)]
    pub mod Options {
        #[derive(Copy, Clone, PartialEq, Eq, Default, Debug)]
        pub enum LogLevel {
            #[default] Default,
            Verbose,
            Silent,
            Quiet,
            DefaultNoProgress,
            VerboseNoProgress,
        }
        /// Port of `Options.openGlobalDir` (src/install/PackageManager/PackageManagerOptions.zig).
        /// Resolution order matches Zig: `$BUN_INSTALL_GLOBAL_DIR` → explicit arg →
        /// `$BUN_INSTALL/install/global` → `{$XDG_CACHE_HOME,$HOME}/.bun/install/global`.
        pub fn open_global_dir(explicit_global_dir: &[u8]) -> Result<bun_sys::Dir, bun_core::Error> {
            use bun_core::env_var;
            use bun_paths::{resolve_path::join_abs_string_buf, platform, PathBuffer};
            use bun_sys::{Dir, OpenDirOptions};

            if let Some(home_dir) = env_var::BUN_INSTALL_GLOBAL_DIR.get() {
                return Dir::cwd().make_open_path(home_dir, OpenDirOptions::default());
            }

            if !explicit_global_dir.is_empty() {
                return Dir::cwd().make_open_path(explicit_global_dir, OpenDirOptions::default());
            }

            if let Some(home_dir) = env_var::BUN_INSTALL.get() {
                let mut buf = PathBuffer::uninit();
                let parts: [&[u8]; 2] = [b"install", b"global"];
                let path = join_abs_string_buf::<platform::Auto>(home_dir, &mut buf.0, &parts);
                return Dir::cwd().make_open_path(path, OpenDirOptions::default());
            }

            if let Some(home_dir) = env_var::XDG_CACHE_HOME.get().or_else(|| env_var::HOME.get()) {
                let mut buf = PathBuffer::uninit();
                let parts: [&[u8]; 3] = [b".bun", b"install", b"global"];
                let path = join_abs_string_buf::<platform::Auto>(home_dir, &mut buf.0, &parts);
                return Dir::cwd().make_open_path(path, OpenDirOptions::default());
            }

            Err(bun_core::err!("No global directory found"))
        }
    }
    pub use Options::LogLevel;

    /// Stub: `PackageManager.WorkspacePackageJSONCache`
    /// (src/install/PackageManager/WorkspacePackageJSONCache.zig). Real body
    /// Surfaced for `bun_runtime::cli::pack_command` / `publish_command`.
    pub mod workspace_package_json_cache {
        use bun_collections::StringHashMap;
        #[derive(Default)]
        pub struct MapEntry {
            pub root: bun_js_parser::Expr,
            pub source: bun_logger::Source,
            pub indentation: bun_js_printer::options::Indentation,
        }
        pub type Map = StringHashMap<MapEntry>;
        #[derive(Clone, Copy)]
        pub struct GetJSONOptions {
            pub init_reset_store: bool,
            pub guess_indentation: bool,
        }
        impl Default for GetJSONOptions {
            fn default() -> Self { Self { init_reset_store: true, guess_indentation: false } }
        }
        pub enum GetResult<'a> {
            Entry(&'a mut MapEntry),
            ReadErr(bun_core::Error),
            ParseErr(bun_core::Error),
        }
        #[derive(Default)]
        pub struct WorkspacePackageJSONCache {
            pub map: Map,
        }
        impl WorkspacePackageJSONCache {
            pub fn get_with_path(
                &mut self,
                _log: &mut bun_logger::Log,
                _abs_package_json_path: &[u8],
                _opts: GetJSONOptions,
            ) -> GetResult<'_> {
                todo!("blocked_on: bun_install::package_manager_real un-gate (reconciler-6)")
            }
        }
    }
    pub use workspace_package_json_cache::WorkspacePackageJSONCache;

    /// Port of `WorkspaceFilter` (src/install/PackageManager.zig). Variant
    /// payloads are owned glob patterns (Zig allocated via `allocator.alloc`;
    /// here `Box<[u8]>` so `deinit` is just Drop).
    pub enum WorkspaceFilter {
        All,
        Name(Box<[u8]>),
        Path(Box<[u8]>),
    }
    impl WorkspaceFilter {
        /// Port of `WorkspaceFilter.init` (src/install/PackageManager.zig).
        /// `*` / `**` → `All`; leading `!`s toggle a negate prefix re-prepended
        /// onto the owned pattern; leading `.` (after `!`-stripping) means a
        /// path filter resolved against `cwd`, else a name filter.
        pub fn init(
            input: &[u8],
            cwd: &[u8],
            path_buf: &mut bun_paths::PathBuffer,
        ) -> Self {
            use bun_string::strings;
            if (input.len() == 1 && input[0] == b'*') || strings::eql_comptime(input, b"**") {
                return WorkspaceFilter::All;
            }

            let mut remain = input;
            let mut prepend_negate = false;
            while !remain.is_empty() && remain[0] == b'!' {
                prepend_negate = !prepend_negate;
                remain = &remain[1..];
            }

            let is_path = !remain.is_empty() && remain[0] == b'.';

            let filter: &[u8] = if is_path {
                strings::without_trailing_slash(
                    bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Posix>(
                        cwd,
                        &mut path_buf.0,
                        &[remain],
                    ),
                )
            } else {
                remain
            };

            if filter.is_empty() {
                // won't match anything
                return WorkspaceFilter::Path(Box::from(&b""[..]));
            }

            let copy_start = usize::from(prepend_negate);
            let copy_end = copy_start + filter.len();
            let mut buf = vec![0u8; copy_end].into_boxed_slice();
            buf[copy_start..copy_end].copy_from_slice(filter);
            if prepend_negate {
                buf[0] = b'!';
            }

            if is_path {
                WorkspaceFilter::Path(buf)
            } else {
                WorkspaceFilter::Name(buf)
            }
        }
    }

    /// Stub: `populateManifestCache` `Packages` union
    /// (src/install/PackageManager/PopulateManifestCache.zig).
    pub enum ManifestCacheOptions<'a> {
        Ids(&'a [crate::PackageID]),
        Names(&'a [&'a [u8]]),
    }
    /// Alias used by `outdated_command.rs`.
    pub type ManifestCacheRequest<'a> = ManifestCacheOptions<'a>;

    /// Stub: `PackageManifestMap.load` `When` enum.
    #[derive(Clone, Copy)]
    pub enum ManifestLoad { LoadFromMemory, LoadFromDisk, LoadFromMemoryFallbackToDisk }

    pub use workspace_package_json_cache::MapEntry as WorkspacePackageJsonCacheEntry;
    pub use workspace_package_json_cache::{GetJSONOptions as GetJsonOptions, GetResult as GetJsonResult};

    /// Stub: real body lives in `PackageManager/CommandLineArguments.rs`,
    /// Only the `AuditLevel` enum is surfaced for `bun_runtime::cli::audit_command`.
    pub mod command_line_arguments {
        #[derive(Copy, Clone, Eq, PartialEq, PartialOrd, Ord)]
        pub enum AuditLevel { Low, Moderate, High, Critical }
        impl AuditLevel {
            pub fn from_string(str: &[u8]) -> Option<AuditLevel> {
                match str {
                    b"low" => Some(AuditLevel::Low),
                    b"moderate" => Some(AuditLevel::Moderate),
                    b"high" => Some(AuditLevel::High),
                    b"critical" => Some(AuditLevel::Critical),
                    _ => None,
                }
            }
            pub fn should_include_severity(self, severity: &[u8]) -> bool {
                let severity_level = AuditLevel::from_string(severity).unwrap_or(AuditLevel::Moderate);
                (severity_level as u8) >= (self as u8)
            }
        }
    }
    pub mod security_scanner {
        pub use crate::SecurityScanSubprocess;

        /// Port of `SecurityAdvisory.Level` (src/install/PackageManager/security_scanner.zig).
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub enum SecurityAdvisoryLevel { Fatal, Warn }

        /// Port of `SecurityAdvisory` (src/install/PackageManager/security_scanner.zig).
        pub struct SecurityAdvisory {
            pub level: SecurityAdvisoryLevel,
            pub package: Box<[u8]>,
            pub url: Option<Box<[u8]>>,
            pub description: Option<Box<[u8]>>,
            pub pkg_path: Option<Box<[crate::PackageID]>>,
        }

        /// Port of `SecurityScanResults` (src/install/PackageManager/security_scanner.zig).
        /// Zig `deinit` only freed owned fields → Rust drops `Box`/`Vec`
        /// automatically, so no explicit Drop.
        #[derive(Default)]
        pub struct SecurityScanResults {
            pub advisories: Box<[SecurityAdvisory]>,
            pub fatal_count: usize,
            pub warn_count: usize,
            pub packages_scanned: usize,
            pub duration_ms: i64,
            // Zig borrows from `manager.options.security_scanner`; Box to avoid
            // a struct lifetime in Phase A.
            pub security_scanner: Box<[u8]>,
        }
        impl SecurityScanResults {
            #[inline] pub fn has_fatal_advisories(&self) -> bool { self.fatal_count > 0 }
            #[inline] pub fn has_warnings(&self) -> bool { self.warn_count > 0 }
            #[inline] pub fn has_advisories(&self) -> bool { !self.advisories.is_empty() }
        }

        /// Stub: real body in `PackageManager/security_scanner.rs`, gated behind
        /// `PackageManager::lockfile` iteration + subprocess scan loop. Generic
        /// over `Ctx` because `bun_runtime::command::Context` would be a circular dep.
        pub fn perform_security_scan_for_all<Ctx>(
            _manager: &mut crate::PackageManager,
            _command_ctx: Ctx,
            _original_cwd: &[u8],
        ) -> Result<Option<SecurityScanResults>, bun_core::Error> {
            todo!("blocked_on: bun_install::package_manager_real un-gate (reconciler-6)")
        }

        /// Port of `printSecurityAdvisories` (src/install/PackageManager/security_scanner.zig).
        /// Reads `manager.lockfile.packages`/`string_bytes` for the `via …`
        /// ancestry line — those are populated only once the gated
        /// `lockfile_real` un-gates, but the stub `Lockfile` carries the same
        /// fields so this compiles against either.
        pub fn print_security_advisories(
            manager: &crate::PackageManager,
            results: &SecurityScanResults,
        ) {
            use bun_core::Output;
            if !results.has_advisories() { return; }

            let pkgs = manager.lockfile.packages.slice();
            let pkg_names = pkgs.items_name();
            let string_buf = &manager.lockfile.buffers.string_bytes;

            for advisory in results.advisories.iter() {
                Output::print(format_args!("\n"));
                match advisory.level {
                    SecurityAdvisoryLevel::Fatal => Output::pretty(format_args!(
                        "  <red>FATAL<r>: {}\n",
                        bstr::BStr::new(&advisory.package)
                    )),
                    SecurityAdvisoryLevel::Warn => Output::pretty(format_args!(
                        "  <yellow>WARNING<r>: {}\n",
                        bstr::BStr::new(&advisory.package)
                    )),
                }

                if let Some(pkg_path) = &advisory.pkg_path {
                    if pkg_path.len() > 1 {
                        Output::pretty(format_args!("    <d>via "));
                        for (idx, &ancestor_id) in pkg_path[..pkg_path.len() - 1].iter().enumerate() {
                            if idx > 0 { Output::pretty(format_args!(" › ")); }
                            let ancestor_name = pkg_names[ancestor_id as usize].slice(string_buf);
                            Output::pretty(format_args!("{}", bstr::BStr::new(ancestor_name)));
                        }
                        Output::pretty(format_args!(
                            " › <red>{}<r>\n",
                            bstr::BStr::new(&advisory.package)
                        ));
                    } else {
                        Output::pretty(format_args!("    <d>(direct dependency)<r>\n"));
                    }
                }

                if let Some(desc) = &advisory.description {
                    if !desc.is_empty() {
                        Output::pretty(format_args!("    {}\n", bstr::BStr::new(desc)));
                    }
                }
                if let Some(url) = &advisory.url {
                    if !url.is_empty() {
                        Output::pretty(format_args!("    <cyan>{}<r>\n", bstr::BStr::new(url)));
                    }
                }
            }

            Output::print(format_args!("\n"));
            let total = results.fatal_count + results.warn_count;
            if total == 1 {
                if results.fatal_count == 1 {
                    Output::pretty(format_args!("<b>1 advisory (<red>1 fatal<r>)<r>\n"));
                } else {
                    Output::pretty(format_args!("<b>1 advisory (<yellow>1 warning<r>)<r>\n"));
                }
            } else if results.fatal_count > 0 && results.warn_count > 0 {
                Output::pretty(format_args!(
                    "<b>{} advisories (<red>{} fatal<r>, <yellow>{} warning{}<r>)<r>\n",
                    total,
                    results.fatal_count,
                    results.warn_count,
                    if results.warn_count == 1 { "" } else { "s" }
                ));
            } else if results.fatal_count > 0 {
                Output::pretty(format_args!(
                    "<b>{} advisories (<red>{} fatal<r>)<r>\n",
                    total, results.fatal_count
                ));
            } else {
                Output::pretty(format_args!(
                    "<b>{} advisories (<yellow>{} warning{}<r>)<r>\n",
                    total,
                    results.warn_count,
                    if results.warn_count == 1 { "" } else { "s" }
                ));
            }
        }
    }
    /// Stub: real body lives in `PackageManager/updatePackageJSONAndInstall.rs`,
    /// Generic over `Ctx` because `bun_runtime::command::Context` isn't visible
    /// from this crate (would be a circular dep).
    pub fn update_package_json_and_install_catch_error<Ctx>(
        _ctx: Ctx,
        _subcommand: Subcommand,
    ) -> Result<(), bun_core::Error> {
        todo!("blocked_on: bun_install::package_manager_real un-gate (reconciler-6)")
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
// These opaque stubs keep `bun_jsc::AsyncModule` / `bun_runtime` callers
// type-checking until the bodies un-gate per-file.
pub use lockfile::bun_lock as TextLockfile;
pub use patch_install as patch;
pub use bin::Bin;
pub use repository::Repository;
pub use lockfile::{Lockfile, PatchedDep, LoadResult, LoadStep};
pub use package_manager::Options::LogLevel;
pub use package_manager::{
    WorkspaceFilter, ManifestCacheOptions, ManifestCacheRequest, ManifestLoad,
    WorkspacePackageJsonCacheEntry, GetJsonOptions, GetJsonResult,
};
pub use resolution::Tag as ResolutionTag;
pub use dependency::Tag as DependencyVersionTag;
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
/// Port of `RootPackageId` (src/install/PackageManager.zig:38) — lazy cache
/// for the root/workspace package id. `get()` resolves on first call via
/// `Lockfile::get_workspace_package_id` and memoises.
#[derive(Default)] pub struct RootPackageId {
    pub id: Option<PackageID>,
}
impl RootPackageId {
    pub fn get(
        &mut self,
        lockfile: &Lockfile,
        workspace_name_hash: Option<PackageNameHash>,
    ) -> PackageID {
        if let Some(id) = self.id {
            return id;
        }
        let id = lockfile.get_workspace_package_id(workspace_name_hash);
        self.id = Some(id);
        id
    }
}
#[derive(Default)] pub struct PackageManager {
    pub options: PackageManagerOptionsStub,
    pub timestamp_for_manifest_cache_control: u32,
    /// Zig: `lockfile: *Lockfile` (src/install/PackageManager.zig:88) — owned,
    /// heap-allocated at `init()`. Stub holds it inline (`Default`-derive
    /// sentinel) until `package_manager_real` un-gates and the real
    /// `Box<Lockfile>` shape lands.
    pub lockfile: Lockfile,
    /// Zig: `root_package_id: RootPackageId = .{}`.
    pub root_package_id: RootPackageId,
    /// Zig: `workspace_name_hash: ?PackageNameHash = null`.
    pub workspace_name_hash: Option<PackageNameHash>,
    /// Zig: `env: *DotEnv.Loader` (src/install/PackageManager.zig:11) — set
    /// once by `PackageManager.init()` and never null afterward. `Option` is
    /// only the `Default`-derive sentinel; accessors `env()`/`env_mut()` unwrap
    /// it. UNKNOWN ownership (mixed: sometimes leaked-heap, sometimes borrowed
    /// from `Transpiler`), so stored as `NonNull` not `Box`.
    // TODO(port): lifetime — see `package_manager_real::PackageManager::env`.
    pub env: Option<core::ptr::NonNull<bun_dotenv::Loader<'static>>>,
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
    /// off-thread tasks awaiting main-thread `runTasks` drain. The `'static`
    /// erases the per-callback `'a` borrow on `NetworkTask` (Zig's queue is
    /// lifetime-less; see `PackageManagerTask::callback` for the cast).
    pub resolve_tasks: bun_threading::UnboundedQueue<package_manager_task::Task<'static>>,
    /// Zig: `thread_pool: ThreadPool`.
    pub thread_pool: bun_threading::ThreadPool,
}
#[derive(Default)] pub struct PackageManagerOptionsStub {
    pub log_level: package_manager::Options::LogLevel,
    pub enable: PackageManagerEnableStub,
    /// Zig: `Options.dry_run: bool = false`.
    pub dry_run: bool,
    /// Zig: `Options.cache_directory` — bunfig override.
    pub cache_directory: Vec<u8>,
    /// Zig: `Options.scope: Npm.Registry.Scope`.
    pub scope: npm::registry::Scope,
    /// Zig: `Options.publish_config`.
    pub publish_config: PublishConfigStub,
}
/// Port of `PublishConfig` (src/install/PackageManager/PackageManagerOptions.zig).
#[derive(Default)] pub struct PublishConfigStub {
    pub access: Option<Access>,
    pub tag: Vec<u8>,
    pub otp: Vec<u8>,
    pub auth_type: Option<AuthType>,
    pub tolerate_republish: bool,
}
/// Port of `AuthType` (src/install/PackageManager/PackageManagerOptions.zig).
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AuthType { Legacy, Web }
impl From<AuthType> for &'static str {
    fn from(a: AuthType) -> &'static str {
        match a { AuthType::Legacy => "legacy", AuthType::Web => "web" }
    }
}
/// Port of `Access` (src/install/PackageManager/PackageManagerOptions.zig).
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Access { Public, Restricted }
impl Access {
    pub fn from_str(str: &[u8]) -> Option<Access> {
        match str {
            b"public" => Some(Access::Public),
            b"restricted" => Some(Access::Restricted),
            _ => None,
        }
    }
}
impl From<Access> for &'static str {
    fn from(a: Access) -> &'static str {
        match a { Access::Public => "public", Access::Restricted => "restricted" }
    }
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
    /// Owned copy of `PackageManager.temp_directory_path`. The stub is a
    /// by-value snapshot, so it cannot safely borrow from `&mut self`; clone
    /// the bytes instead of manufacturing a `&'static` (PORTING.md §Forbidden).
    pub path: Box<[u8]>,
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

    /// Zig: field access `manager.env` (src/install/PackageManager.zig:11).
    /// SAFETY: `env` is populated by `init()` before any caller reaches this;
    /// mirrors Zig's non-optional `*DotEnv.Loader`.
    #[inline]
    pub fn env(&self) -> &bun_dotenv::Loader<'static> {
        unsafe { self.env.unwrap().as_ref() }
    }
    /// Mutable variant of [`env`](Self::env).
    #[inline]
    pub fn env_mut(&mut self) -> &mut bun_dotenv::Loader<'static> {
        unsafe { self.env.unwrap().as_mut() }
    }
    /// Raw pointer form for FFI-ish out-param plumbing
    /// (`RunCommand::configure_env_for_run` takes `*mut Loader`).
    #[inline]
    pub fn env_ptr(&self) -> *mut bun_dotenv::Loader<'static> {
        self.env.unwrap().as_ptr()
    }

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

    /// Port of `directories.updateLockfileIfNeeded`
    /// (src/install/PackageManager/PackageManagerDirectories.zig:671). Real
    /// body iterates `self.lockfile.packages.slice().items(.meta)` and clears
    /// `has_install_script` when `load_result == .ok` and
    /// `serializer_result.packages_need_update`. The stub `LoadResult` is a
    /// unit struct (no `.ok` variant) and `PackageList` has no
    /// `slice()/items_meta_mut()` columns yet, so the body defers to
    /// `package_manager_real`.
    pub fn update_lockfile_if_needed(
        &mut self,
        _load_result: &lockfile::LoadResult<'_>,
    ) -> Result<(), bun_core::Error> {
        todo!("blocked_on: bun_install::package_manager_real un-gate (reconciler-6) — LoadResult::Ok / PackageList::items_meta_mut")
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
                    bun_core::Output::pretty_errorln(format_args!(
                        "<r><red>error<r>: bun is unable to write files: {}",
                        err,
                    ));
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
            return PackageManagerTmpDirStub {
                handle: fd,
                path: self.temp_directory_path.clone().into_boxed_slice(),
                name: b".tmp",
            };
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
        let tempdir = match (Dir { fd: cache_directory })
            .make_open_path(b".tmp", OpenDirOptions::default())
        {
            Ok(d) => d,
            Err(err) => {
                bun_core::Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: bun is unable to access tempdir: {}",
                    err,
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

        PackageManagerTmpDirStub {
            handle: tempdir.fd,
            path: self.temp_directory_path.clone().into_boxed_slice(),
            name: b".tmp",
        }
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
                strings::w(const_format::concatcp!("bun-node-", bun_core::env::GIT_SHA_SHORT))
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

// TODO(b2-blocked): bun_resolver::DirInfo
// TODO(b2-blocked): bun_schema::api::DotEnvBehavior

/// Process-lifetime arena for the install-tier `Transpiler` constructed in
/// `RunCommand::configure_env_for_run`. Mirrors `runner_arena()` in
/// `runtime/cli/run_command.rs` — `bun_alloc::Arena` is `!Sync`, so guard a
/// `static mut MaybeUninit` with `Once` (PORTING.md §Forbidden bars
/// `Box::leak`).
fn install_runner_arena() -> &'static bun_alloc::Arena {
    static ONCE: std::sync::Once = std::sync::Once::new();
    static mut ARENA: ::core::mem::MaybeUninit<bun_alloc::Arena> =
        ::core::mem::MaybeUninit::uninit();
    ONCE.call_once(|| {
        // SAFETY: one-time init under `Once`; no concurrent writer.
        unsafe { (*(&raw mut ARENA)).write(bun_alloc::Arena::new()) };
    });
    // SAFETY: initialized exactly once above. `configure_env_for_run` is only
    // ever called from the single CLI dispatch thread, so the `!Sync` Bump is
    // never observed concurrently.
    unsafe { (*(&raw const ARENA)).assume_init_ref() }
}

impl RunCommand {
    /// Port of `RunCommand.configureEnvForRun` (src/cli/run_command.zig:780).
    ///
    /// DEP-CYCLE NOTE: the full Zig body walks `bun_resolver::DirInfo` and
    /// reads `package.json` via the resolver — T6 work that lives in
    /// `bun_runtime::cli::RunCommand::configure_env_for_run`. The install
    /// tier needs the *Transpiler-initialisation* half of that contract
    /// (run_command.zig:780 `this_transpiler.* = try Transpiler.init(...)`)
    /// because callers (`configure_env_for_scripts_run`) `assume_init()` the
    /// out-param. This shim performs the init + the env-var seeding that has
    /// no T6 dependency; the `*mut ()` return stands in for `*mut DirInfo`
    /// (opaque to install — every caller discards it).
    pub fn configure_env_for_run(
        ctx: &mut bun_options_types::Context::ContextData,
        this_transpiler: &mut ::core::mem::MaybeUninit<bun_transpiler::Transpiler<'static>>,
        env: Option<*mut bun_dotenv::Loader<'static>>,
        _log_errors: bool,
        store_root_fd: bool,
    ) -> Result<*mut (), bun_core::Error> {
        use bun_core::Global;

        let args = ctx.args.clone();
        // Spec run_command.zig:780: `this_transpiler.* = try Transpiler.init(ctx.allocator, ctx.log, args, env)`.
        this_transpiler.write(bun_transpiler::Transpiler::init(
            install_runner_arena(),
            ctx.log,
            args,
            env,
        )?);
        // SAFETY: fully written on the line above.
        let this_transpiler = unsafe { this_transpiler.assume_init_mut() };
        this_transpiler.options.env.behavior =
            bun_options_types::schema::api::DotEnvBehavior::load_all;
        this_transpiler.resolver.care_about_bin_folder = true;
        this_transpiler.resolver.care_about_scripts = true;
        this_transpiler.resolver.store_fd = store_root_fd;

        // SAFETY: `Transpiler::init` always sets `env` (caller-provided or
        // singleton); never null. Re-derive per-use rather than holding a
        // long-lived `&mut` (matches Zig's per-statement `this_transpiler.env`
        // deref and avoids Stacked-Borrows overlap with `run_env_loader`).
        let env_loader = unsafe { &mut *this_transpiler.env };

        // Propagate --no-orphans / [run] noOrphans to the script's env so any
        // Bun process the script spawns enables its own watchdog. The env
        // loader snapshots `environ` before flag parsing runs, so the
        // `setenv()` in `enable()` isn't reflected here.
        if bun_aio::parent_death_watchdog::is_enabled() {
            let _ = env_loader.map.put(b"BUN_FEATURE_FLAG_NO_ORPHANS", b"1");
        }

        // we have no way of knowing what version they're expecting without
        // running the node executable; running the node executable is too
        // slow, so we will just hardcode it to LTS
        let _ = env_loader.map.put_default(
            b"npm_config_user_agent",
            // the use of npm/? is copying yarn
            // e.g.
            // > "yarn/1.22.4 npm/? node/v12.16.3 darwin x64",
            const_format::concatcp!(
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

        if env_loader.get(b"npm_execpath").is_none() {
            // we don't care if this fails
            if let Ok(self_exe) = bun_core::self_exe_path() {
                let _ = env_loader.map.put_default(b"npm_execpath", self_exe.as_bytes());
            }
        }

        // DirInfo walk / npm_package_* seeding is performed by the T6 impl
        // (`bun_runtime::cli::RunCommand::configure_env_for_run`); install
        // callers discard the return value.
        Ok(core::ptr::null_mut())
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
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum Origin {
    #[default]
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
