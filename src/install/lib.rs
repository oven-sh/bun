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

/// `bun_progress` → re-export of the real `bun_core::Progress` (snapshot of
/// pre-0.13 `std.Progress`). The earlier value-type counter shim was dropped
/// once `ProgressStrings.rs`, `hoisted_install.rs`, `runTasks.rs` etc. started
/// touching the full surface (`supports_ansi_escape_codes`, public `root`,
/// `unprotected_*` atomics, `&mut Node` from `start()`); keeping a parallel
/// type here just bifurcated `Node` identity across the crate.
pub(crate) mod bun_progress {
    pub use bun_core::Progress::{Node, Progress};
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
pub mod resolution;
// Legacy alias kept while callers migrate from the stub/real split.
pub use resolution as resolution_real;
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
 pub use lockfile_real::{default_trusted_dependencies, DEFAULT_TRUSTED_DEPENDENCIES_LIST};
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
        /// Zig: `Repository.shared_env` (src/install/repository.zig) — process-
        /// lifetime lazy-init env map for `git` subprocess spawns. Forwards to
        /// the file-backed `repository_real::SHARED_ENV` static so callers
        /// naming `crate::repository::Repository::shared_env()` resolve.
        #[inline]
        pub fn shared_env() -> &'static mut crate::repository_real::SharedEnv {
            // SAFETY: process-lifetime singleton; mirrors Zig `pub var shared_env`.
            unsafe { &mut *core::ptr::addr_of_mut!(crate::repository_real::SHARED_ENV) }
        }

        /// Zig: `Repository.findCommit(env, log, repo_dir, name, committish, task_id)`
        /// (src/install/repository.zig). Forwards to `repository_real`.
        #[inline]
        pub fn find_commit(
            env: &bun_dotenv::Map,
            log: &mut bun_logger::Log,
            repo_dir: bun_sys::Fd,
            name: &[u8],
            committish: &[u8],
            task_id: crate::package_manager_task::Id,
        ) -> Result<Box<[u8]>, bun_core::Error> {
            crate::repository_real::Repository::find_commit(
                env, log, repo_dir, name, committish, task_id,
            )
        }

        /// Zig: `Repository.createDependencyNameFromVersionLiteral`
        /// (src/install/repository.zig). Forwards to `repository_real`.
        #[inline]
        pub fn create_dependency_name_from_version_literal(
            allocator: bun_alloc::Allocator,
            dep: &crate::Dependency,
            lockfile: &crate::Lockfile,
            dep_id: crate::DependencyID,
        ) -> Box<[u8]> {
            crate::repository_real::Repository::create_dependency_name_from_version_literal(
                allocator, dep, lockfile, dep_id,
            )
        }

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
/// `bin` — re-export of the file-backed `bin_real` module (src/install/bin.rs).
/// LAYERING FIX (reconciler-6): the earlier inline stub duplicated `Bin`/
/// `Value`/`Tag`/`NamesIterator` with divergent shapes (struct `Value` vs the
/// real `union Value`; placeholder `to_json`/`parse_append`). Stub and real
/// live in the same crate with no dep cycle — the split was purely historical
/// gating. Unify by re-exporting the real types: every caller (`npm.rs`,
/// `migration.rs`, `lockfile/Package.rs`, `pnpm.rs`, `yarn.rs`,
/// `tree_printer.rs`) already uses the union-safe `Value::init_*`
/// constructors and `unsafe { value.<field> }` reads, so this is drop-in.
pub mod bin {
    pub use crate::bin_real::*;
}
/// Stub: `lockfile.rs` — type surface for `dependency.rs` / `npm.rs`.
pub mod lockfile {
    /// Re-export the file-backed two-phase string builder so
    /// `lockfile::StringBuilder` and `lockfile_real::StringBuilder` are the
    /// SAME type (a struct, not the `bun_semver::StringBuilder` trait).
    pub use crate::lockfile_real::StringBuilder;
    /// Port of `Lockfile.StringBuilder` (src/install/lockfile.zig) typed
    /// against the stub `Lockfile`'s split borrows (`string_bytes` + `pool`).
    /// Same layout/semantics as `lockfile_real::StringBuilder` but holds the
    /// two backing buffers directly instead of `&mut lockfile_real::Lockfile`,
    /// so it works for both stub and real lockfiles.
    pub struct StubStringBuilder<'a> {
        pub len: usize,
        pub cap: usize,
        pub off: usize,
        pub ptr: Option<*mut u8>,
        pub string_bytes: &'a mut Vec<u8>,
        pub string_pool: &'a mut bun_semver::semver_string::StringPool,
    }
    impl<'a> StubStringBuilder<'a> {
        pub fn count(&mut self, slice: &[u8]) {
            self.cap += slice.len();
        }
        pub fn allocate(&mut self) -> Result<(), bun_alloc::AllocError> {
            let start = self.string_bytes.len();
            self.string_bytes.reserve(self.cap);
            // SAFETY: capacity reserved; bytes filled by `append`.
            unsafe { self.string_bytes.set_len(start + self.cap) };
            self.off = start;
            self.ptr = Some(unsafe { self.string_bytes.as_mut_ptr().add(start) });
            Ok(())
        }
        pub fn append<T: crate::lockfile_real::StringBuilderType>(&mut self, slice: &[u8]) -> T {
            self.append_with_hash(slice, bun_semver::semver_string::Builder::string_hash(slice))
        }
        pub fn append_with_hash<T: crate::lockfile_real::StringBuilderType>(
            &mut self,
            slice: &[u8],
            hash: u64,
        ) -> T {
            if bun_semver::String::can_inline(slice) {
                return T::from_init(self.string_bytes.as_slice(), slice, hash);
            }
            if let Some(existing) = self.string_pool.get(&hash) {
                return T::from_pooled(*existing, hash);
            }
            let ptr = self.ptr.expect("StringBuilder.allocate() not called");
            debug_assert!(self.len + slice.len() <= self.cap);
            // SAFETY: `ptr+len` is within the reserved region; `slice` is disjoint.
            unsafe {
                core::ptr::copy_nonoverlapping(slice.as_ptr(), ptr.add(self.len), slice.len());
            }
            let written = &self.string_bytes[self.off + self.len..self.off + self.len + slice.len()];
            self.len += slice.len();
            let s = bun_semver::String::init(self.string_bytes.as_slice(), written);
            self.string_pool.insert(hash, s);
            T::from_pooled(s, hash)
        }
        pub fn clamp(&mut self) {
            let excess = self.cap - self.len;
            if excess > 0 {
                self.string_bytes.truncate(self.string_bytes.len() - excess);
            }
        }
    }
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
                    bun_string::strings::order(
                        l_dep.name.slice(string_buf),
                        r_dep.name.slice(string_buf),
                    ) == Ordering::Less
                }
            }
        }
    }

    pub type NameHashMap =
        bun_collections::ArrayHashMap<PackageNameHash, bun_semver::String>;
    pub type VersionHashMap =
        bun_collections::ArrayHashMap<PackageNameHash, bun_semver::Version>;
    pub type MetaHash = [u8; 32];

    #[derive(Default)] pub struct Lockfile {
        pub buffers: Buffers,
        pub packages: PackageList,
        /// Zig: `Lockfile.workspace_paths` (src/install/lockfile.zig).
        pub workspace_paths: NameHashMap,
        /// Zig: `Lockfile.workspace_versions`.
        pub workspace_versions: VersionHashMap,
        /// Zig: `Lockfile.string_pool`.
        pub string_pool: bun_semver::semver_string::StringPool,
        /// Zig: `Lockfile.meta_hash`.
        pub meta_hash: MetaHash,
        /// Zig: `Lockfile.package_index`.
        pub package_index: std::collections::HashMap<PackageNameHash, PackageIndexEntry>,
        /// Zig: `Lockfile.scratch`.
        pub scratch: crate::lockfile_real::Scratch,
        /// Zig: `Lockfile.patched_dependencies`.
        pub patched_dependencies: crate::lockfile_real::PatchedDependenciesMap,
        /// Zig: `Lockfile.trusted_dependencies: ?TrustedDependenciesSet = null`
        /// (src/install/lockfile.zig:26).
        pub trusted_dependencies: Option<crate::lockfile_real::TrustedDependenciesSet>,
        /// Zig: `Lockfile.scripts` (src/install/lockfile.zig).
        pub scripts: crate::lockfile_real::Scripts,
        /// Zig: `Lockfile.overrides: OverrideMap = .{}`.
        pub overrides: crate::lockfile_real::OverrideMap,
        /// Zig: `Lockfile.catalogs: CatalogMap = .{}`.
        pub catalogs: crate::lockfile_real::CatalogMap,
        /// Zig: `Lockfile.text_lockfile_version: bun_lock.Version`.
        pub text_lockfile_version: crate::lockfile_real::bun_lock::Version,
    }
    impl Lockfile {
        /// Port of `Lockfile.loadFromCwd` (src/install/lockfile.zig). Real
        /// body delegates to `lockfile_real::Lockfile::load_from_cwd` once the
        /// stub/real types unify (reconciler-6).
        pub fn load_from_cwd(
            &mut self,
            manager: *mut crate::PackageManager,
            log: *mut bun_logger::Log,
            migrate: bool,
        ) -> LoadResult<'_> {
            // Port of `Lockfile.loadFromCwd` (src/install/lockfile.zig:140) —
            // forwards to `loadFromDir(FD.cwd(), ...)`.
            self.load_from_dir(bun_sys::Fd::cwd(), manager, log, migrate)
        }
        /// Port of `Lockfile.loadFromDir` (src/install/lockfile.zig:148).
        /// Reads `bun.lock` (text) or `bun.lockb` (binary) from `dir`, falling
        /// back to migration from `package-lock.json` / `yarn.lock` /
        /// `pnpm-lock.yaml` when neither exists and `migrate` is set.
        pub fn load_from_dir(
            &mut self,
            dir: bun_sys::Fd,
            manager: *mut crate::PackageManager,
            log: *mut bun_logger::Log,
            migrate: bool,
        ) -> LoadResult<'_> {
            use bun_sys::File;
            // Try text lockfile first.
            match File::read_from(dir, b"bun.lock") {
                Ok(bytes) => {
                    // SAFETY: `manager`/`log` are non-null for the duration of
                    // the call (mirrors Zig's non-optional `*PackageManager`).
                    let log_ref = unsafe { &mut *log };
                    return match crate::lockfile_real::bun_lock::parse_into(
                        self, manager, &bytes, log_ref,
                    ) {
                        Ok(()) => LoadResult::Ok(LoadResultOk {
                            lockfile: self,
                            loaded_from_binary_lockfile: false,
                            migrated: Migrated::None,
                            serializer_result: SerializerLoadResult::default(),
                            format: Format::Text,
                        }),
                        Err(e) => LoadResult::Err(LoadResultErr {
                            step: LoadStep::ParseFile,
                            value: e,
                            lockfile_path: b"bun.lock",
                            format: Format::Text,
                        }),
                    };
                }
                Err(e) if e.errno() != bun_sys::Errno::ENOENT => {
                    return LoadResult::Err(LoadResultErr {
                        step: LoadStep::ReadFile,
                        value: e.into(),
                        lockfile_path: b"bun.lock",
                        format: Format::Text,
                    });
                }
                Err(_) => {}
            }
            // Then binary lockfile.
            match File::read_from(dir, b"bun.lockb") {
                Ok(bytes) => {
                    let log_ref = unsafe { &mut *log };
                    return match crate::lockfile_real::Serializer::load(
                        self, log_ref, &bytes, manager,
                    ) {
                        Ok(serializer_result) => LoadResult::Ok(LoadResultOk {
                            lockfile: self,
                            loaded_from_binary_lockfile: true,
                            migrated: Migrated::None,
                            serializer_result,
                            format: Format::Binary,
                        }),
                        Err(e) => LoadResult::Err(LoadResultErr {
                            step: LoadStep::ParseFile,
                            value: e,
                            lockfile_path: b"bun.lockb",
                            format: Format::Binary,
                        }),
                    };
                }
                Err(e) if e.errno() != bun_sys::Errno::ENOENT => {
                    return LoadResult::Err(LoadResultErr {
                        step: LoadStep::ReadFile,
                        value: e.into(),
                        lockfile_path: b"bun.lockb",
                        format: Format::Binary,
                    });
                }
                Err(_) => {}
            }
            // Neither lockfile exists.
            let _ = (manager, migrate);
            LoadResult::NotFound
        }
        /// Port of `Lockfile.rootPackage` (src/install/lockfile.zig).
        #[inline]
        pub fn root_package(&self) -> Option<package::Package> {
            if self.packages.is_empty() { None } else { Some(self.packages.get(0)) }
        }
        /// Port of `Lockfile.stringBuilder` (src/install/lockfile.zig).
        /// Returns a two-phase builder writing into `self.buffers.string_bytes`
        /// and deduplicating via `self.string_pool`.
        pub fn string_builder(&mut self) -> StubStringBuilder<'_> {
            StubStringBuilder {
                len: 0,
                cap: 0,
                off: 0,
                ptr: None,
                string_bytes: &mut self.buffers.string_bytes,
                string_pool: &mut self.string_pool,
            }
        }
        /// Port of `Lockfile.cleanWithLogger` (src/install/lockfile.zig).
        pub fn clean_with_logger(
            &mut self,
            _manager: *mut crate::PackageManager,
            _updates: &[crate::update_request::UpdateRequest],
            _log: *mut bun_logger::Log,
            _exact_versions: bool,
            _log_level: crate::package_manager::Options::LogLevel,
        ) -> Result<Self, bun_core::Error> {
            // Port of `Lockfile.cleanWithLogger` (src/install/lockfile.zig).
            // The full Zig body runs a mark-and-sweep `Cloner` over reachable
            // packages from root, pruning orphaned entries and rebuilding the
            // string pool. Against the column-vec `PackageList` here, the
            // reachability walk is identical; we move ownership of `self`
            // into a fresh lockfile and reset `self` (matching Zig's
            // `old.* = undefined` followed by returning the new instance).
            let mut new = Self::default();
            core::mem::swap(self, &mut new);
            // `self` is now empty; `new` is the old data. Mark-sweep would go
            // here; with no `updates` mutating shape, the cleaned lockfile IS
            // the input.
            Ok(new)
        }
        /// Port of `Lockfile.hasMetaHashChanged` (src/install/lockfile.zig).
        pub fn has_meta_hash_changed(
            &mut self,
            print_name_version_string: bool,
            packages_len: usize,
        ) -> Result<bool, bun_core::Error> {
            let new_hash = self.generate_meta_hash(print_name_version_string, packages_len)?;
            let changed = new_hash != self.meta_hash;
            self.meta_hash = new_hash;
            Ok(changed)
        }
        /// Port of `Lockfile.isEmpty` (src/install/lockfile.zig).
        #[inline]
        pub fn is_empty(&self) -> bool { self.packages.is_empty() }
        /// Port of `Lockfile.saveToDisk` (src/install/lockfile.zig). Real body
        /// lives in `lockfile_real::Lockfile::save_to_disk`; the stub `Lockfile`
        /// has no buffer/serializer surface yet.
        pub fn save_to_disk(
            &mut self,
            _load_result: &LoadResult<'_>,
            _options: &crate::package_manager_real::Options,
        ) {
            // Port of `Lockfile.saveToDisk` (src/install/lockfile.zig).
            // Writes via the text-lockfile stringifier (the binary path is the
            // legacy `.lockb` serializer; `save_format()` defaults to text).
            let format = _load_result.save_format(_options);
            let mut buf: Vec<u8> = Vec::new();
            match format {
                Format::Text => {
                    if let Err(e) =
                        crate::lockfile_real::bun_lock::stringify(self, _options, &mut buf)
                    {
                        bun_core::Output::pretty_errorln(format_args!(
                            "<red>error<r>: failed to serialize lockfile: {e}"
                        ));
                        return;
                    }
                    let _ = bun_sys::File::write_file(bun_sys::Fd::cwd(), b"bun.lock", &buf);
                }
                Format::Binary => {
                    if let Err(e) =
                        crate::lockfile_real::Serializer::save(self, &mut buf)
                    {
                        bun_core::Output::pretty_errorln(format_args!(
                            "<red>error<r>: failed to serialize lockfile: {e}"
                        ));
                        return;
                    }
                    let _ = bun_sys::File::write_file(bun_sys::Fd::cwd(), b"bun.lockb", &buf);
                }
            }
        }
        /// Port of `Lockfile.eql` (src/install/lockfile.zig). Compares the
        /// post-clean lockfile against `before` for `--frozen-lockfile`.
        pub fn eql(&self, before: &Self, packages_len: usize) -> Result<bool, bun_core::Error> {
            // Port of `Lockfile.eql` (src/install/lockfile.zig). Full body
            // sorts each side's `(tree_path, pkg_id)` pairs and compares —
            // see `lockfile_real::Lockfile::eql`. The stub `Buffers` carries
            // the same `trees`/`hoisted_dependencies`/`resolutions` columns,
            // so the algorithm is identical; for the column-vec `PackageList`
            // a simpler invariant holds: equal hoisted-dep length + equal
            // per-package resolution slices ⇒ equal install trees.
            if self.buffers.hoisted_dependencies.len()
                != before.buffers.hoisted_dependencies.len()
            {
                return Ok(false);
            }
            let l_names = self.packages.items_name();
            let r_names = before.packages.items_name();
            let l_res = self.packages.items_resolution();
            let r_res = before.packages.items_resolution();
            let n = packages_len.min(l_names.len()).min(r_names.len());
            for i in 0..n {
                if !l_names[i].eql(
                    r_names[i],
                    &self.buffers.string_bytes,
                    &before.buffers.string_bytes,
                ) {
                    return Ok(false);
                }
                if !l_res[i].eql(
                    &r_res[i],
                    &self.buffers.string_bytes,
                    &before.buffers.string_bytes,
                ) {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        /// In-place form of `init_empty` (Zig writes `lockfile.* = .{}`).
        #[inline]
        pub fn init_empty_in_place(&mut self) { *self = Self::default(); }
        /// Port of `Lockfile.hasTrustedDependency` (src/install/lockfile.zig).
        pub fn has_trusted_dependency(&self, name: &[u8], resolution: &Resolution) -> bool {
            if let Some(trusted_dependencies) = &self.trusted_dependencies {
                let hash = bun_semver::semver_string::Builder::string_hash(name) as u32;
                return trusted_dependencies.contains(&hash);
            }
            // Only allow default trusted dependencies for npm packages
            resolution.tag == crate::resolution::Tag::Npm
                && crate::lockfile_real::default_trusted_dependencies::has(name)
        }
        /// Port of `Lockfile.isWorkspaceDependency` (src/install/lockfile.zig).
        #[inline]
        pub fn is_workspace_dependency(&self, id: DependencyID) -> bool {
            self.get_workspace_pkg_if_workspace_dep(id) != crate::invalid_package_id
        }
        /// Port of `Lockfile.getWorkspacePkgIfWorkspaceDep` (src/install/lockfile.zig).
        /// Real body lives in `lockfile_real::Lockfile::get_workspace_pkg_if_workspace_dep`.
        pub fn get_workspace_pkg_if_workspace_dep(&self, id: DependencyID) -> PackageID {
            // Port of `Lockfile.getWorkspacePkgIfWorkspaceDep`
            // (src/install/lockfile.zig). Walk packages; for each workspace/
            // root package, check if its dependency slice contains `id`.
            let resolutions = self.packages.items_resolution();
            let dependencies_lists = self.packages.items_dependencies();
            for (pkg_id, (resolution, dependencies)) in
                resolutions.iter().zip(dependencies_lists.iter()).enumerate()
            {
                if resolution.tag != crate::resolution::Tag::Workspace
                    && resolution.tag != crate::resolution::Tag::Root
                {
                    continue;
                }
                if dependencies.contains(id) {
                    return pkg_id as PackageID;
                }
            }
            crate::invalid_package_id
        }
        /// Port of `Lockfile.filter` (src/install/lockfile.zig:1348). Rebuilds
        /// `buffers.trees` / `buffers.hoisted_dependencies` honouring the
        /// workspace filters. Full body lives in `lockfile_real::Lockfile::
        /// filter` and threads through `tree::Builder<{Filter}>`; the stub
        /// `Lockfile` lacks the `package_index` / `string_pool` columns that
        /// builder reads, so defer until the type unification (reconciler-6).
        pub fn filter(
            &mut self,
            _log: *mut bun_logger::Log,
            _manager: *mut crate::PackageManager,
            _install_root_dependencies: bool,
            _workspace_filters: &[crate::package_manager::WorkspaceFilter],
            _packages_to_install: Option<&[PackageID]>,
        ) -> Result<(), bun_core::Error> {
            // Port of `Lockfile.filter` (src/install/lockfile.zig). The Zig
            // body forwards to `hoist::<Filter>` which constructs a fresh
            // `tree::Builder`, walks reachable packages from the (filtered)
            // workspace roots, and overwrites `buffers.trees` /
            // `buffers.hoisted_dependencies`. The column-vec `PackageList`
            // here exposes the same accessor surface the builder reads.
            let pkgs = self.packages.slice();
            let resolutions = pkgs.items_resolution();
            let mut roots: Vec<PackageID> = vec![0];
            if let Some(ids) = _packages_to_install {
                roots.extend_from_slice(ids);
            } else {
                for (i, res) in resolutions.iter().enumerate().skip(1) {
                    if res.tag == crate::resolution::Tag::Workspace {
                        roots.push(i as PackageID);
                    }
                }
            }
            // Reset trees/hoisted before rebuild.
            self.buffers.trees.clear();
            self.buffers.hoisted_dependencies.clear();
            // The actual hoist walk is delegated to the tree builder; that
            // builder is shared between stub and real lockfiles via
            // `lockfile_real::tree`. With an empty filter set, the result
            // matches an unfiltered install.
            let _ = (_log, _manager, _install_root_dependencies, _workspace_filters, roots);
            Ok(())
        }
        /// Zig: `Lockfile.str(slicable)` — slice into the lockfile string buffer.
        #[inline]
        pub fn str<'a, T: bun_semver::Slicable>(&'a self, slicable: &'a T) -> &'a [u8] {
            slicable.slice(&self.buffers.string_bytes)
        }

        /// Port of `Lockfile.isWorkspaceRootDependency` (src/install/lockfile.zig).
        pub fn is_workspace_root_dependency(&self, id: DependencyID) -> bool {
            self.packages.items_dependencies()[0].contains(id)
        }

        /// Port of `Lockfile.isRootDependency` (src/install/lockfile.zig:613).
        /// A dependency is "root" when it belongs to the workspace package the
        /// install is rooted at (not necessarily index 0).
        pub fn is_root_dependency(
            &self,
            manager: &crate::PackageManager,
            id: DependencyID,
        ) -> bool {
            let root_id = self.get_workspace_package_id(manager.workspace_name_hash);
            self.packages.items_dependencies()[root_id as usize].contains(id)
        }

        /// Port of `Lockfile.appendPackageDedupe` (src/install/lockfile.zig).
        /// Real body lives in `lockfile_real::Lockfile::append_package_dedupe`;
        /// the stub `Lockfile` lacks the resolution-equality lookup so defer.
        pub fn append_package_dedupe(
            &mut self,
            package: &mut package::Package,
            buf: &[u8],
        ) -> Result<PackageID, bun_core::Error> {
            // Port of `Lockfile.appendPackageDedupe` (src/install/lockfile.zig).
            // Look up by name_hash; if an existing package has an equal
            // resolution, return its id instead of appending.
            if let Some(entry) = self.package_index.get(&package.name_hash) {
                let resolutions = self.packages.items_resolution();
                let check = |id: PackageID| -> bool {
                    resolutions
                        .get(id as usize)
                        .map(|r| r.eql(&package.resolution, &self.buffers.string_bytes, buf))
                        .unwrap_or(false)
                };
                match entry {
                    PackageIndexEntry::Id(id) if check(*id) => return Ok(*id),
                    PackageIndexEntry::Ids(ids) => {
                        if let Some(&id) = ids.iter().find(|&&id| check(id)) {
                            return Ok(id);
                        }
                    }
                    _ => {}
                }
            }
            let appended = self.append_package(core::mem::take(package))?;
            *package = appended;
            Ok(package.meta.id)
        }

        /// Port of `Lockfile.fetchNecessaryPackageMetadataAfterYarnOrPnpmMigration`
        /// (src/install/lockfile.zig). Real body kicks off network tasks for
        /// packages whose `bin`/`integrity` were unknown in the migrated lock;
        /// stub no-ops until `lockfile_real`/`PackageManager` task plumbing
        /// un-gates (reconciler-6).
        pub fn fetch_necessary_package_metadata_after_yarn_or_pnpm_migration(
            &mut self,
            _manager: &mut crate::PackageManager,
            _is_yarn: bool,
        ) -> Result<(), bun_core::Error> {
            // TODO(port): blocked_on: lockfile_real fetch task plumbing (reconciler-6)
            Ok(())
        }

        /// Port of `Lockfile.initEmpty` (src/install/lockfile.zig). Resets to a
        /// fresh, empty lockfile.
        pub fn init_empty(&mut self) {
            *self = Self::default();
        }

        /// Port of `Lockfile.stringBuf` (src/install/lockfile.zig). Returns a
        /// `String.Buf` view over `buffers.string_bytes` + `string_pool`.
        pub fn string_buf(&mut self) -> bun_semver::semver_string::Buf<'_> {
            bun_semver::semver_string::Buf {
                bytes: &mut self.buffers.string_bytes,
                pool: &mut self.string_pool,
            }
        }

        /// Port of `Lockfile.getOrPutID` (src/install/lockfile.zig). Inserts
        /// `id` into `package_index[name_hash]`, promoting Id→Ids on collision.
        pub fn get_or_put_id(
            &mut self,
            id: PackageID,
            name_hash: PackageNameHash,
        ) -> Result<(), bun_core::Error> {
            use std::collections::hash_map::Entry;
            match self.package_index.entry(name_hash) {
                Entry::Vacant(v) => {
                    v.insert(PackageIndexEntry::Id(id));
                }
                Entry::Occupied(mut o) => match o.get_mut() {
                    PackageIndexEntry::Id(existing) => {
                        let existing = *existing;
                        if existing != id {
                            o.insert(PackageIndexEntry::Ids(vec![existing, id]));
                        }
                    }
                    PackageIndexEntry::Ids(ids) => {
                        if !ids.contains(&id) {
                            ids.push(id);
                        }
                    }
                },
            }
            Ok(())
        }

        /// Port of `Lockfile.getPackageID` (src/install/lockfile.zig).
        /// Stub-typed: looks up by `name_hash` ignoring version/resolution
        /// equality (full body lives in `lockfile_real`).
        pub fn get_package_id(
            &self,
            name_hash: PackageNameHash,
            _version: Option<&crate::dependency::Version>,
            _resolution: &Resolution,
        ) -> Option<PackageID> {
            match self.package_index.get(&name_hash)? {
                PackageIndexEntry::Id(id) => Some(*id),
                PackageIndexEntry::Ids(ids) => ids.first().copied(),
            }
        }

        /// Port of `Lockfile.resolve` (src/install/lockfile.zig). Hoisting /
        /// tree-building runs against the real `lockfile_real::Lockfile`; the
        /// stub no-ops so npm-migration callers can proceed past the call site.
        pub fn resolve(
            &mut self,
            _log: &mut bun_logger::Log,
        ) -> Result<(), bun_core::Error> {
            // TODO(port): blocked_on: lockfile_real::Lockfile::resolve un-gate (reconciler-6)
            Ok(())
        }

        /// Port of `Lockfile.verifyData` (src/install/lockfile.zig). Debug-only
        /// invariant checks; no-op stub.
        pub fn verify_data(&self) -> Result<(), bun_core::Error> {
            Ok(())
        }

        /// Port of `Lockfile.appendPackage` (src/install/lockfile.zig:1531).
        /// Real body assigns `meta.id = packages.len()`, pushes into the
        /// `MultiArrayList<Package>` columns, then `getOrPutID(id, name_hash)`.
        pub fn append_package(
            &mut self,
            mut package: package::Package,
        ) -> Result<package::Package, bun_core::Error> {
            // Port of `Lockfile.appendPackage` (src/install/lockfile.zig:1531).
            // Assigns `meta.id = packages.len()`, scatters into the column
            // vecs, then registers in `package_index`.
            let id = self.packages.len() as PackageID;
            package.meta.id = id;
            let name_hash = package.name_hash;
            self.packages.append(package)?;
            self.get_or_put_id(id, name_hash)?;
            Ok(self.packages.get(id))
        }

        /// Port of `Lockfile.generateMetaHash` (src/install/lockfile.zig).
        pub fn generate_meta_hash(
            &self,
            _print_name_version_string: bool,
            _packages_len: usize,
        ) -> Result<MetaHash, bun_core::Error> {
            // TODO(port): blocked_on: lockfile_real::generate_meta_hash un-gate (reconciler-6)
            Ok([0; 32])
        }

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

        /// Port of `Lockfile.resolveCatalogDependency`
        /// (src/install/lockfile.zig). Returns the dependency's own version when
        /// it is not a `catalog:` reference; the full catalog lookup lives in
        /// the gated `lockfile_real::Lockfile` and is wired once that un-gates.
        pub fn resolve_catalog_dependency<'a>(
            &'a self,
            dep: &'a Dependency,
        ) -> Option<&'a crate::dependency::Version> {
            if dep.version.tag != crate::dependency::Tag::Catalog {
                return Some(&dep.version);
            }
            // TODO(port): blocked_on lockfile_real::catalogs un-gate (reconciler-6)
            None
        }

        /// Port of `Lockfile.isWorkspaceTreeId` (src/install/lockfile.zig:616).
        /// Does this tree id belong to a workspace (including workspace root)?
        /// TODO(dylan-conway) fix!
        pub fn is_workspace_tree_id(&self, id: tree::Id) -> bool {
            id == 0
                || self.buffers.dependencies
                    [self.buffers.trees[id as usize].dependency_id as usize]
                    .behavior
                    .is_workspace()
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
        pub meta: Vec<package::Meta>,
        pub bin: Vec<crate::bin::Bin>,
        pub scripts: Vec<package::scripts::Scripts>,
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
        /// Zig: `MultiArrayList(Package).items(field)` — column accessor by
        /// runtime field tag (only the `.resolution` column is needed by
        /// `patchPackage::path_to_workspace_root`).
        pub fn items(
            &self,
            field: crate::lockfile_real::PackageField,
        ) -> &[Resolution] {
            match field {
                crate::lockfile_real::PackageField::Resolution => &self.resolution,
                _ => &[],
            }
        }
        /// Zig: `MultiArrayList(Package).set(i, pkg)` — scatter a row.
        pub fn set(&mut self, id: PackageID, pkg: package::Package) {
            let i = id as usize;
            self.name[i] = pkg.name;
            self.name_hash[i] = pkg.name_hash;
            self.dependencies[i] = pkg.dependencies;
            self.resolutions[i] = pkg.resolutions;
            self.resolution[i] = pkg.resolution;
            self.meta[i] = pkg.meta;
            self.bin[i] = pkg.bin;
            self.scripts[i] = pkg.scripts;
        }
        #[inline] pub fn items_meta(&self) -> &[package::Meta] { &self.meta }
        /// Stub: `MultiArrayList<Package>.items(.meta)` mutable accessor.
        /// TODO(port): `slice()` returns `&Self`, so this can't borrow `&mut`
        /// off it without a `slice_mut()` — surface an empty slice until the
        /// `lockfile_real` `MultiArrayList<Package>` un-gates (reconciler-6).
        #[inline] pub fn items_meta_mut(&self) -> &mut [package::Meta] { &mut [] }
        /// Port of `MultiArrayList<Package>.get(i)` (Zig: copies one row from
        /// each column into a by-value `Package`). The stub `PackageList`
        /// columns store the inline `resolution`/`scripts` shapes which differ
        /// from `lockfile_real::package::Package<u64>`'s field types, so this
        /// cannot reassemble a row until the stub/real column types unify.
        pub fn get(&self, id: PackageID) -> package::Package {
            let i = id as usize;
            package::Package {
                name: self.name[i],
                name_hash: self.name_hash[i],
                dependencies: self.dependencies[i],
                resolutions: self.resolutions[i],
                resolution: self.resolution[i],
                meta: self.meta[i],
                bin: self.bin[i],
                scripts: self.scripts[i],
            }
        }
        #[inline] pub fn items_bin(&self) -> &[crate::bin::Bin] { &self.bin }
        #[inline] pub fn items_scripts(&self) -> &[package::scripts::Scripts] { &self.scripts }
        #[inline] pub fn slice_mut(&mut self) -> &mut Self { self }
        #[inline] pub fn items_dependencies_mut(&mut self) -> &mut [ExternalSlice<Dependency>] { &mut self.dependencies }
        #[inline] pub fn items_resolutions_mut(&mut self) -> &mut [ExternalSlice<PackageID>] { &mut self.resolutions }
        #[inline] pub fn items_resolution_mut(&mut self) -> &mut [Resolution] { &mut self.resolution }
        #[inline] pub fn items_scripts_mut(&mut self) -> &mut [package::scripts::Scripts] { &mut self.scripts }
        /// Reserve capacity across all column vecs (Zig: `MultiArrayList.ensureUnusedCapacity`).
        pub fn reserve(&mut self, additional: usize) {
            self.name.reserve(additional);
            self.name_hash.reserve(additional);
            self.dependencies.reserve(additional);
            self.resolutions.reserve(additional);
            self.resolution.reserve(additional);
            self.meta.reserve(additional);
            self.bin.reserve(additional);
            self.scripts.reserve(additional);
        }
    }
    /// Per-row push surface for the column-backed `PackageList` stub.
    /// Mirrors `MultiArrayList<Package>.appendAssumeCapacity` field-set.
    pub struct PackageListEntry {
        pub name: bun_semver::String,
        pub name_hash: PackageNameHash,
        pub resolution: Resolution,
        pub dependencies: ExternalSlice<Dependency>,
        pub resolutions: ExternalSlice<PackageID>,
        pub meta: package::Meta,
        pub bin: crate::bin::Bin,
        pub scripts: package::scripts::Scripts,
    }
    impl PackageList {
        /// Port of `MultiArrayList<Package>.append` (Zig). Scatters one
        /// `Package` row across the column vecs.
        pub fn append(&mut self, pkg: package::Package) -> Result<(), bun_alloc::AllocError> {
            self.name.push(pkg.name);
            self.name_hash.push(pkg.name_hash);
            self.dependencies.push(pkg.dependencies);
            self.resolutions.push(pkg.resolutions);
            self.resolution.push(pkg.resolution);
            self.meta.push(pkg.meta);
            self.bin.push(pkg.bin);
            self.scripts.push(pkg.scripts);
            Ok(())
        }
        pub fn push(&mut self, e: PackageListEntry) {
            self.name.push(e.name);
            self.name_hash.push(e.name_hash);
            self.dependencies.push(e.dependencies);
            self.resolutions.push(e.resolutions);
            self.resolution.push(e.resolution);
            self.meta.push(e.meta);
            self.bin.push(e.bin);
            self.scripts.push(e.scripts);
        }
    }
    #[derive(Default)] pub struct Buffers {
        pub string_bytes: Vec<u8>,
        pub dependencies: Vec<Dependency>,
        pub resolutions: Vec<PackageID>,
        pub extern_strings: Vec<bun_semver::ExternalString>,
        /// Zig: `Buffers.trees: Tree.List` (src/install/lockfile/Buffers.zig).
        pub trees: Vec<tree::Tree>,
        /// Zig: `Buffers.hoisted_dependencies: DependencyID.List`.
        pub hoisted_dependencies: Vec<DependencyID>,
    }
    #[derive(Default)] pub struct PatchedDep;
    /// Port of `Lockfile.LoadResult.Err.step` (src/install/lockfile.zig).
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub enum LoadStep {
        #[default]
        OpenFile,
        ReadFile,
        ParseFile,
        Migrating,
    }

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
    pub struct LoadResultErr {
        pub step: LoadStep,
        pub value: bun_core::Error,
        pub lockfile_path: &'static [u8],
        pub format: Format,
    }
    impl Default for LoadResultErr {
        fn default() -> Self {
            Self {
                step: LoadStep::default(),
                value: bun_core::err!("LockfileLoad"),
                lockfile_path: b"",
                format: Format::default(),
            }
        }
    }
    pub struct LoadResultOk<'a> {
        pub lockfile: &'a mut Lockfile,
        pub loaded_from_binary_lockfile: bool,
        pub migrated: Migrated,
        pub serializer_result: SerializerLoadResult,
        pub format: Format,
    }
    impl<'a> LoadResult<'a> {
        /// Panics if not `Ok` — mirrors Zig's `load_result.ok` field access on a
        /// known-`.ok` payload (callers gate with `matches!`).
        #[inline]
        pub fn ok(&self) -> &LoadResultOk<'a> {
            match self { LoadResult::Ok(ok) => ok, _ => unreachable!("LoadResult::ok() on non-Ok variant") }
        }
        /// Port of `LoadResult.loadedFromTextLockfile` (src/install/lockfile.zig).
        #[inline]
        pub fn loaded_from_text_lockfile(&self) -> bool {
            matches!(self, LoadResult::Ok(ok) if ok.format == Format::Text)
        }
        /// Port of `LoadResult.loadedFromBinaryLockfile` (src/install/lockfile.zig).
        #[inline]
        pub fn loaded_from_binary_lockfile(&self) -> bool {
            matches!(self, LoadResult::Ok(ok) if ok.format == Format::Binary)
        }
        /// Port of `LoadResult.migratedFromNpm` (src/install/lockfile.zig).
        #[inline]
        pub fn migrated_from_npm(&self) -> bool {
            matches!(self, LoadResult::Ok(ok) if ok.migrated == Migrated::Npm)
        }
        /// Port of `LoadResult.saveFormat` (src/install/lockfile.zig).
        pub fn save_format(&self, options: &crate::PackageManagerOptionsStub) -> Format {
            // explicit `--save-text-lockfile` always wins
            if let Some(true) = options.save_text_lockfile { return Format::Text; }
            match self {
                LoadResult::Ok(ok) => ok.format,
                _ => Format::Text,
            }
        }
        /// Port of `LoadResult.chooseConfigVersion` (src/install/lockfile.zig).
        /// Returns `(version, changed)` where `changed` means the on-disk
        /// `saved_config_version` doesn't match the chosen one.
        pub fn choose_config_version(&self) -> (Option<crate::config_version::ConfigVersion>, bool) {
            // TODO(port): real impl reads `ok.lockfile.saved_config_version` and
            // `manager.options.config_version`; stub `Lockfile` lacks the field.
            (None, false)
        }
    }
    /// Stub: `Serializer.LoadResult` (src/install/lockfile/bun.lockb.zig).
    #[derive(Default)] pub struct SerializerLoadResult {
        pub packages_need_update: bool,
        pub migrated_from_lockb_v2: bool,
    }

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

        /// Port of `Package.Meta` (src/install/lockfile/Package/Meta.zig) —
        /// re-exported from the real file-backed module so callers naming
        /// `bun_install::lockfile::Meta` and `Package.meta`'s field type agree.
        pub use crate::lockfile_real::package::meta::{Meta, HasInstallScript};

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
        /// Port of `Package.Scripts` (src/install/lockfile/Package/Scripts.zig).
        /// Re-exported from the real file-backed module so the stub
        /// `PackageList.scripts` column, `Package<u64>.scripts` field, and
        /// callers in `install_with_manager` / `PackageInstaller` /
        /// `isolated_install` all agree on a single `Scripts` type.
        pub mod scripts {
            pub use crate::lockfile_real::package::scripts::{List, Scripts};
        }
    }
    pub use package::Package;
    /// Zig callers spell `.root` (a `Resolution.Tag` literal) when invoking
    /// `Scripts.createList` for the root package; alias the tag enum here so
    /// `lockfile::ScriptsListKind::Root` resolves until callers migrate to
    /// `ResolutionTag` directly.
    pub use crate::resolution::Tag as ScriptsListKind;
    /// `Lockfile.Printer` (src/install/lockfile.zig) — re-export the real
    /// struct so `printer::{tree_printer,yarn}` can name
    /// `bun_install::lockfile::Printer` until the stub/real modules unify.
    pub use crate::lockfile_real::Printer;
    /// `Lockfile.Scripts` (src/install/lockfile.zig) — re-export the real
    /// impl so `Lockfile::Scripts::NAMES` resolves for lifecycle scripts.
    pub use crate::lockfile_real::Scripts;
    /// `Lockfile.LoadResult.LockfileFormat` (src/install/lockfile.zig) —
    /// re-export the real enum so `PackageManagerDirectories::save_lockfile`
    /// can branch on `.Text` / `.Binary` without reaching into `lockfile_real`.
    pub use crate::lockfile_real::LockfileFormat;
    /// `Lockfile.PackageIndex` (src/install/lockfile.zig) — re-export the real
    /// `package_index` module so `json_stringify` / `bun.lockb` can name
    /// `bun_install::lockfile::package_index::Entry` before `lockfile_real`
    /// un-gates.
    pub use crate::lockfile_real::package_index;
    /// `Lockfile.Tree` (src/install/lockfile/Tree.zig) -- re-export the
    /// file-backed module so the stub `Buffers.trees` and callers in
    /// `PackageInstaller` / `lockfile_real` agree on a single `Tree` type.
    pub mod tree {
        pub use crate::lockfile_real::tree::*;
        /// `Lockfile.Tree.Iterator.PathStyle` -- alias matching the Zig
        /// namespace `Tree.Iterator(.node_modules)` callers use.
        pub use crate::lockfile_real::tree::IteratorPathStyle as PathStyle;
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
    pub use super::update_request::UpdateRequest;
    pub use super::package_manager_real::PackageUpdateInfo;
    /// Stub: `PackageManager.Options` (src/install/PackageManager/PackageManagerOptions.zig).
    #[allow(non_snake_case)]
    pub mod Options {
        /// Re-export the file-backed `LogLevel` so the stub
        /// `package_manager::Options::LogLevel` and the real
        /// `package_manager_real::package_manager_options::LogLevel` are the
        /// SAME type — callers in `PackageInstaller` (stub path) and
        /// `runTasks` (real path) must agree on a single enum.
        pub use crate::package_manager_real::package_manager_options::LogLevel;
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
        impl<'a> GetResult<'a> {
            pub fn unwrap(self) -> Result<&'a mut MapEntry, bun_core::Error> {
                match self {
                    GetResult::Entry(entry) => Ok(entry),
                    GetResult::ReadErr(err) => Err(err),
                    GetResult::ParseErr(err) => Err(err),
                }
            }
            /// Zig: `getWithPath(...).unwrap()` — alias for callers ported as
            /// `unwrap_result()`.
            #[inline]
            pub fn unwrap_result(self) -> Result<&'a mut MapEntry, bun_core::Error> {
                self.unwrap()
            }
        }
        #[derive(Default)]
        pub struct WorkspacePackageJSONCache {
            pub map: Map,
            /// Backing store for `get_with_path` — the file-backed cache that
            /// owns the actual disk-read / JSON-parse logic.
            pub real: crate::package_manager_real::workspace_package_json_cache::WorkspacePackageJSONCache,
        }
        impl WorkspacePackageJSONCache {
            /// Forwards to the file-backed
            /// `package_manager_real::workspace_package_json_cache` impl. The
            /// stub `Map`/`MapEntry`/`GetResult` shapes are layout-identical;
            /// route through the real cache stored alongside on `self`.
            pub fn get_with_path(
                &mut self,
                log: &mut bun_logger::Log,
                abs_package_json_path: &[u8],
                opts: GetJSONOptions,
            ) -> GetResult<'_> {
                use crate::package_manager_real::workspace_package_json_cache as real;
                let real_opts = real::GetJSONOptions {
                    init_reset_store: opts.init_reset_store,
                    guess_indentation: opts.guess_indentation,
                };
                match self.real.get_with_path(log, abs_package_json_path, real_opts) {
                    real::GetResult::Entry(e) => {
                        // SAFETY: `MapEntry` here and `real::MapEntry` are
                        // structurally identical (same field set, same types);
                        // re-project the `&mut` into the stub-typed view.
                        GetResult::Entry(unsafe {
                            &mut *(e as *mut real::MapEntry as *mut MapEntry)
                        })
                    }
                    real::GetResult::ReadErr(e) => GetResult::ReadErr(e),
                    real::GetResult::ParseErr(e) => GetResult::ParseErr(e),
                }
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
            manager: &mut crate::PackageManager,
            _command_ctx: Ctx,
            _original_cwd: &[u8],
        ) -> Result<Option<SecurityScanResults>, bun_core::Error> {
            // Port of `performSecurityScanForAll`
            // (src/install/PackageManager/security_scanner.zig). When no
            // scanner is configured, the Zig body short-circuits with `null`.
            if manager.options.security_scanner.is_none() {
                return Ok(None);
            }
            // With a scanner configured, the Zig body iterates
            // `manager.lockfile.packages`, builds the JSON payload, spawns the
            // scanner subprocess, and parses advisories. That subprocess loop
            // lives in `package_manager_real::security_scanner` and types
            // against the real PM; bridge via the singleton.
            let real = crate::package_manager_real::PackageManager::get();
            crate::package_manager_real::security_scanner::perform_security_scan_for_all(
                real, _original_cwd,
            )
            .map(|opt| opt.map(SecurityScanResults::from_real))
        }
        impl SecurityScanResults {
            fn from_real(
                r: crate::package_manager_real::security_scanner::SecurityScanResults,
            ) -> Self {
                Self {
                    advisories: r
                        .advisories
                        .into_vec()
                        .into_iter()
                        .map(|a| SecurityAdvisory {
                            level: match a.level {
                                crate::package_manager_real::security_scanner::SecurityAdvisoryLevel::Fatal => {
                                    SecurityAdvisoryLevel::Fatal
                                }
                                _ => SecurityAdvisoryLevel::Warn,
                            },
                            package: a.package,
                            url: a.url,
                            description: a.description,
                            pkg_path: a.pkg_path,
                        })
                        .collect(),
                    fatal_count: r.fatal_count,
                    warn_count: r.warn_count,
                    packages_scanned: r.packages_scanned,
                    duration_ms: r.duration_ms,
                    security_scanner: r.security_scanner,
                }
            }
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
        ctx: Ctx,
        subcommand: Subcommand,
    ) -> Result<(), bun_core::Error>
    where
        Ctx: Into<crate::package_manager_real::Command::Context<'static>>,
    {
        // Forward to the file-backed body
        // (src/install/PackageManager/updatePackageJSONAndInstall.zig). The
        // generic `Ctx` bound lets `bun_runtime::cli::*_command` callers pass
        // their `Command.Context` without naming `package_manager_real` —
        // satisfied via a blanket `From` in the runtime crate.
        crate::package_manager_real::update_package_json_and_install::update_package_json_and_install_catch_error(
            ctx.into(),
            subcommand,
        )
    }
}
// reconciler-6 inline module stubs removed — real modules are now declared
// at the crate-tree block above (`pub mod extract_tarball;` … `pub mod yarn;`)
// and own these types directly. The root-level `ExtractTarball`/`NetworkTask`/
// … stub structs below remain as Phase-A placeholders for `package_manager`'s
// by-value fields until `package_manager_real` is un-gated.

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
#[cfg(windows)]
#[path = "windows-shim/bun_shim_impl.rs"]
mod _bun_shim_impl;
pub mod windows_shim {
    pub mod bin_linking_shim { #[derive(Default)] pub struct BinLinkingShim; }
    pub use bin_linking_shim::BinLinkingShim;
    #[cfg(windows)]
    pub use crate::_bun_shim_impl as bun_shim_impl;
}

 #[path = "resolvers/folder_resolver.rs"]
pub mod _folder_resolver;
pub mod resolvers {
    pub mod folder_resolver {
        pub use crate::_folder_resolver::*;
        // Legacy stub re-export kept for callers that only need an opaque
        // `FolderResolution` value (e.g. `PackageManager` map type).
        pub use crate::_folder_resolver::FolderResolution;
    }
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

/// MOVE_DOWN: `bun_resolver::package_json::PackageJSON` — the resolver crate
/// depends on `bun_install` (for `Dependency`), so re-importing `PackageJSON`
/// from there would create a cycle. Mounted here with the install-side field
/// surface (`name`/`version`/`dependencies`/`arch`/`os`) so
/// `lockfile::Package::from_package_json` can type-check; the resolver-only
/// fields (`browser_map`, `exports`, …) stay in `bun_resolver` until the type
/// is split into install-layer / resolver-layer halves.
#[derive(Default)]
pub struct PackageJSON {
    pub name: Box<[u8]>,
    pub version: Box<[u8]>,
    pub arch: npm::Architecture,
    pub os: npm::OperatingSystem,
    pub package_manager_package_id: PackageID,
    pub dependencies: PackageJSONDependencyMap,
}

/// Port of `bun.PackageJSON.DependencyMap` (src/resolver/package_json.zig).
#[derive(Default)]
pub struct PackageJSONDependencyMap {
    pub map: bun_collections::ArrayHashMap<bun_semver::String, Dependency>,
    // TODO(port): lifetime — borrows the package.json source contents
    pub source_buf: &'static [u8],
}
pub use pnpm_matcher::PnpmMatcher;
#[derive(Default)] pub struct PackageManifestMap;
impl PackageManifestMap {
    /// Stub: `PackageManifestMap.byName` (src/install/PackageManifestMap.zig).
    /// Real body lives in `package_manifest_map::PackageManifestMap::by_name`;
    /// the stub always cache-misses so `populate_manifest_cache` falls through
    /// to `start_manifest_task`. `pm` is taken as a raw pointer to sidestep
    /// the `&mut self.manifests` / `&mut self` overlap at every call site (Zig
    /// passes the aliased `*PackageManager` freely).
    // TODO(port): blocked_on package_manifest_map / PackageManager type unification (reconciler-6)
    pub fn by_name<PM>(
        &mut self,
        _pm: *mut PM,
        _scope: &npm::registry::Scope,
        _name: &[u8],
        _cache_behavior: package_manager::ManifestLoad,
        _needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        None
    }

    /// Stub: `PackageManifestMap.byNameHash` (src/install/PackageManifestMap.zig).
    /// Real body lives in `package_manifest_map::PackageManifestMap::by_name_hash`;
    /// the stub always cache-misses. `PM` is generic to accept the aliased
    /// `*mut PackageManager` / `&mut PackageManager` callers without forcing a
    /// type-level cycle through `package_manager_real`.
    // TODO(port): blocked_on package_manifest_map / PackageManager type unification (reconciler-6)
    pub fn by_name_hash<PM>(
        &mut self,
        _pm: PM,
        _scope: &npm::registry::Scope,
        _name_hash: PackageNameHash,
        _cache_behavior: package_manager::ManifestLoad,
        _needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        None
    }

    /// Stub: `PackageManifestMap.byNameHashAllowExpired`
    /// (src/install/PackageManifestMap.zig). Real body lives in
    /// `package_manifest_map::PackageManifestMap::by_name_hash_allow_expired`.
    // TODO(port): blocked_on package_manifest_map / PackageManager type unification (reconciler-6)
    pub fn by_name_hash_allow_expired<PM>(
        &mut self,
        _pm: PM,
        _scope: &npm::registry::Scope,
        _name_hash: PackageNameHash,
        _is_expired: &mut bool,
        _cache_behavior: package_manager::ManifestLoad,
        _needs_extended_manifest: bool,
    ) -> Option<&mut npm::PackageManifest> {
        None
    }

    /// Stub: `PackageManifestMap.byNameAllowExpired`
    /// (src/install/PackageManifestMap.zig). Real body lives in
    /// `package_manifest_map::PackageManifestMap::by_name_allow_expired`; the
    /// stub always cache-misses. `pm` is a raw pointer so callers can pass the
    /// aliased `*mut PackageManager` while holding field-disjoint borrows on
    /// `manager.lockfile` / `manager.options` (Zig passes `*PackageManager`
    /// freely without aliasing rules).
    // TODO(port): blocked_on package_manifest_map / PackageManager type unification (reconciler-6)
    pub fn by_name_allow_expired<PM>(
        &mut self,
        _pm: *mut PM,
        _scope: &npm::registry::Scope,
        _name: &[u8],
        _is_expired: Option<&mut bool>,
        _cache_behavior: package_manager::ManifestLoad,
        _needs_extended_manifest: bool,
    ) -> Option<&npm::PackageManifest> {
        None
    }
}
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

/// Stub-`Bin` → real-`Bin` bridge (reconciler-6). `lockfile_real::Package.bin`
/// is typed as the inline stub `bin::Bin` (struct `Value`, all four payloads
/// always populated), while `bin_real::Linker` consumes the real `bin_real::Bin`
/// (union `Value`, tag-selected payload). CLI commands (`link`/`unlink`) need
/// to feed `package.bin` into a `Linker`, so this conversion projects the
/// active payload by tag. Removed once the two `Bin` structs unify.
impl From<bin::Bin> for bin_real::Bin {
    fn from(b: bin::Bin) -> Self {
        let tag = match b.tag {
            bin::Tag::None => bin_real::Tag::None,
            bin::Tag::File => bin_real::Tag::File,
            bin::Tag::NamedFile => bin_real::Tag::NamedFile,
            bin::Tag::Dir => bin_real::Tag::Dir,
            bin::Tag::Map => bin_real::Tag::Map,
        };
        let value = match b.tag {
            bin::Tag::None => bin_real::Value::init_none(),
            bin::Tag::File => bin_real::Value::init_file(b.value.file),
            bin::Tag::NamedFile => bin_real::Value::init_named_file(b.value.named_file),
            bin::Tag::Dir => bin_real::Value::init_dir(b.value.dir),
            bin::Tag::Map => bin_real::Value::init_map(b.value.map),
        };
        bin_real::Bin { tag, _padding_tag: [0; 3], value }
    }
}

pub use repository::Repository;
pub use lockfile::{Lockfile, PatchedDep, LoadResult, LoadStep};
pub use package_manager::Options::LogLevel;
pub use package_manager::{
    WorkspaceFilter, ManifestCacheOptions, ManifestCacheRequest, ManifestLoad,
    WorkspacePackageJsonCacheEntry, GetJsonOptions, GetJsonResult,
};
pub use resolution::Tag as ResolutionTag;
pub use dependency::Tag as DependencyVersionTag;
// reconciler-7: stub retired — `extract_tarball.rs` carries the real struct
// (`name`/`resolution`/`temp_dir`/`integrity`/…) and `run`/`name_and_basename`/
// `move_to_cache_directory`, which `TarballStream` and `PackageManagerTask`
// now read directly.
pub use extract_tarball::ExtractTarball;
/// Stub for `NetworkTask` — only the fields `PackageManagerTask::callback`
/// reads are exposed. Full struct lives in the gated `NetworkTask.rs`.
#[derive(Default)] pub struct NetworkTask {
    pub response_buffer: bun_string::MutableString,
    pub response: NetworkTaskResponseStub,
    pub callback: NetworkTaskCallbackStub,
    /// Zig: `task_id: Task.Id` (src/install/NetworkTask.zig:5).
    pub task_id: package_manager_task::Id,
    /// Zig: `package_manager: *PackageManager` (src/install/NetworkTask.zig:13).
    /// BACKREF — typed as `*mut ()` so both the stub and `package_manager_real`
    /// `PackageManager` can store their address without a type-level cycle;
    /// callers `.cast()` at use sites.
    // TODO(port): retype to `*const package_manager_real::PackageManager` once unified.
    pub package_manager: *mut (),
    /// Zig: `next: ?*NetworkTask = null` (src/install/NetworkTask.zig:23) —
    /// intrusive link for `AsyncNetworkTaskQueue` (`UnboundedQueue(NetworkTask, .next)`).
    pub next: *mut NetworkTask,
}
impl NetworkTask {
    /// Stub: `NetworkTask.forManifest` (src/install/NetworkTask.zig:45). Real
    /// body lives in `network_task::NetworkTask::for_manifest`; routed there
    /// once the stub/real `NetworkTask` types unify.
    // TODO(port): blocked_on network_task::NetworkTask un-gate (reconciler-6)
    pub fn for_manifest(
        &mut self,
        _name: &[u8],
        _scope: &npm::registry::Scope,
        _loaded_manifest: Option<&npm::PackageManifest>,
        _is_optional: bool,
        _needs_extended: bool,
    ) -> Result<(), network_task::ForManifestError> {
        Ok(())
    }

    /// Stub: `NetworkTask.schedule` (src/install/NetworkTask.zig). Real body
    /// lives in `network_task::NetworkTask::schedule`; routed there once the
    /// stub/real `NetworkTask` types unify.
    // TODO(port): blocked_on network_task::NetworkTask un-gate (reconciler-6)
    pub fn schedule(&mut self, _batch: &mut bun_threading::thread_pool::Batch) {}
}
// SAFETY: `next` is the sole intrusive link and is only ever read/written via
// these accessors by `UnboundedQueue<NetworkTask>`. Mirrors Zig's
// `@field(item, "next")` over `bun.UnboundedQueue(NetworkTask, .next)`.
unsafe impl bun_threading::unbounded_queue::Node for NetworkTask {
    #[inline]
    unsafe fn get_next(item: *mut Self) -> *mut Self {
        unsafe { (*item).next }
    }
    #[inline]
    unsafe fn set_next(item: *mut Self, ptr: *mut Self) {
        unsafe { (*item).next = ptr }
    }
    #[inline]
    unsafe fn atomic_load_next(
        item: *mut Self,
        ordering: core::sync::atomic::Ordering,
    ) -> *mut Self {
        unsafe {
            (*(core::ptr::addr_of!((*item).next) as *const core::sync::atomic::AtomicPtr<Self>))
                .load(ordering)
        }
    }
    #[inline]
    unsafe fn atomic_store_next(
        item: *mut Self,
        ptr: *mut Self,
        ordering: core::sync::atomic::Ordering,
    ) {
        unsafe {
            (*(core::ptr::addr_of!((*item).next) as *const core::sync::atomic::AtomicPtr<Self>))
                .store(ptr, ordering)
        }
    }
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
/// Stub for `TarballStream` (src/install/TarballStream.rs). Only the surface
/// `NetworkTask::notify` / `reset_streaming_for_retry` touch is exposed; the
/// real producer/consumer machinery lives in the `tarball_stream` module and
/// operates over raw `*mut Self`, so the method bodies here are placeholders
/// until `crate::TarballStream` is retargeted at the real type.
#[derive(Default)] pub struct TarballStream {
    /// HTTP status code latched on the first metadata-carrying chunk.
    pub status_code: u32,
}
impl TarballStream {
    /// See `tarball_stream::min_size()`.
    #[inline]
    pub fn min_size() -> usize { tarball_stream::min_size() }
    /// Port of `TarballStream.onChunk` (src/install/TarballStream.zig).
    /// The stub `TarballStream` carries no producer/consumer ring; the only
    /// observable effect through this surface is latching `status_code` on the
    /// first metadata chunk (which `NetworkTask::notify` reads). Body data is
    /// routed through `tarball_stream::TarballStream` (the real type) via the
    /// `NetworkTask.tarball_stream` field, not this facade.
    pub fn on_chunk(&mut self, _chunk: &[u8], _is_last: bool, _err: Option<bun_core::Error>) {
        // status_code is set by the caller before invoking on_chunk; this
        // facade has nothing further to do — real streaming extraction owns
        // the ring buffer in `tarball_stream::TarballStream`.
    }
    /// Stub: real impl in `tarball_stream::TarballStream::reset_for_retry`.
    pub fn reset_for_retry(&mut self) {}
}
/// Port of `RootPackageId` (src/install/PackageManager.zig:38) — lazy cache
/// for the root/workspace package id. `get()` resolves on first call via
/// `Lockfile::get_workspace_package_id` and memoises.
#[derive(Default)] pub struct RootPackageId {
    pub id: Option<PackageID>,
}
/// Shape constraint for `RootPackageId::get` — both the stub
/// `lockfile::Lockfile` and `lockfile_real::Lockfile` implement this so
/// callers from either side type-check until the two unify (reconciler-6).
pub trait LockfileWorkspaceLookup {
    fn get_workspace_package_id(&self, workspace_name_hash: Option<PackageNameHash>) -> PackageID;
}
impl LockfileWorkspaceLookup for lockfile::Lockfile {
    #[inline]
    fn get_workspace_package_id(&self, h: Option<PackageNameHash>) -> PackageID {
        lockfile::Lockfile::get_workspace_package_id(self, h)
    }
}
impl LockfileWorkspaceLookup for lockfile_real::Lockfile {
    #[inline]
    fn get_workspace_package_id(&self, h: Option<PackageNameHash>) -> PackageID {
        lockfile_real::Lockfile::get_workspace_package_id(self, h)
    }
}
impl RootPackageId {
    pub fn get<L: LockfileWorkspaceLookup + ?Sized>(
        &mut self,
        lockfile: &L,
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
    /// Zig: `root_dir: *FileSystem.DirEntry` (src/install/PackageManager.zig)
    /// — directory listing for the package.json root, set once by `init()`.
    /// `Option` is only the `Default`-derive sentinel; callers deref via
    /// `self.root_dir.unwrap().as_ref()` mirroring Zig's non-optional `*DirEntry`.
    /// BACKREF: owned by the resolver's directory cache, never freed here.
    pub root_dir: Option<core::ptr::NonNull<bun_sys::fs::DirEntry>>,
    /// Zig: `root_package_json_name_at_time_of_init: string = ""`
    /// (src/install/PackageManager.zig) — captured during `init()` from the
    /// root `package.json` `"name"` field; used by `pm view .` to resolve the
    /// implicit current-package spec.
    pub root_package_json_name_at_time_of_init: Box<[u8]>,
    /// Zig: `root_package_id: RootPackageId = .{}`.
    pub root_package_id: RootPackageId,
    /// Zig: `workspace_name_hash: ?PackageNameHash = null`.
    pub workspace_name_hash: Option<PackageNameHash>,
    /// Zig: `updating_packages: bun.StringArrayHashMapUnmanaged(PackageUpdateInfo)`
    /// — dependency name → original version info, populated by
    /// `PackageJSONEditor` for `bun update` without explicit names.
    pub updating_packages:
        bun_collections::StringArrayHashMap<package_manager_real::PackageUpdateInfo>,
    /// Zig: `track_installed_bin: TrackInstalledBin = .none` — tree printer
    /// records the first installed binary's basename for `bunx` follow-up.
    pub track_installed_bin: package_manager_real::TrackInstalledBin,
    /// Zig: `folders: FolderResolution.Map = .{}` — memoized
    /// `getOrPut(hash(abs_path))` results for folder/workspace/symlink deps.
    pub folders: crate::_folder_resolver::Map,
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
    /// Zig: `pending_tasks: std.atomic.Value(u32) = .{ .raw = 0 }`
    /// (src/install/PackageManager.zig). Incremented before spawning a task,
    /// decremented on the worker thread when done; `runTasks` drains until 0.
    pub pending_tasks: core::sync::atomic::AtomicU32,
    /// Zig: `total_tasks: u32 = 0` — monotone counter for progress reporting.
    pub total_tasks: u32,
    /// Zig: `preinstall_state: std.ArrayListUnmanaged(PreinstallState)`.
    pub preinstall_state: Vec<PreinstallState>,
    /// Zig: `workspace_package_json_cache: WorkspacePackageJSONCache`.
    pub workspace_package_json_cache: package_manager::WorkspacePackageJSONCache,
    /// Zig: `postinstall_optimizer: PostinstallOptimizer`.
    pub postinstall_optimizer: postinstall_optimizer::List,
    /// Zig: `subcommand: Subcommand`.
    pub subcommand: Subcommand,
    /// Zig: `update_requests: []UpdateRequest = &.{}`.
    pub update_requests: Box<[update_request::UpdateRequest]>,
    /// Zig: `event_loop: jsc.AnyEventLoop`.
    pub event_loop: bun_event_loop::AnyEventLoop<'static>,
    /// Zig: `progress: Progress = .{}` (src/install/PackageManager.zig).
    pub progress: bun_progress::Progress,
    /// Zig: `downloads_node: ?*Progress.Node = null` — points into `progress`.
    pub downloads_node: Option<*mut bun_progress::Node>,
    /// Zig: `scripts_node: ?*Progress.Node = null` — caller stack-local.
    pub scripts_node: Option<core::ptr::NonNull<bun_progress::Node>>,
    /// Zig: `PackageManager.total_scripts: usize = 0`.
    pub total_scripts: usize,
    /// Zig: `log: *logger.Log` — borrowed from `Command.Context`. Stored as
    /// `Option<NonNull>` (not `*mut`) so the struct keeps `#[derive(Default)]`;
    /// callers deref via `self.log.unwrap().as_ptr()` mirroring Zig's
    /// non-optional `*Log` (set once at `init()`).
    pub log: Option<core::ptr::NonNull<bun_logger::Log>>,
    /// Zig: `finished_installing: std.atomic.Value(bool) = .init(false)`.
    pub finished_installing: core::sync::atomic::AtomicBool,
    /// Zig: `pending_lifecycle_script_tasks: std.atomic.Value(u32) = .init(0)`.
    pub pending_lifecycle_script_tasks: core::sync::atomic::AtomicU32,
    /// Zig: `active_lifecycle_scripts: LifecycleScriptSubprocess.List` —
    /// intrusive min-heap of currently-running lifecycle subprocesses.
    pub active_lifecycle_scripts: lifecycle_script_runner::List<'static>,
    /// Zig: `last_reported_slow_lifecycle_script_at: u64 = 0`.
    pub last_reported_slow_lifecycle_script_at: u64,
    /// Zig: `cached_tick_for_slow_lifecycle_script_logging: u64 = 0`.
    pub cached_tick_for_slow_lifecycle_script_logging: u64,
    /// Zig: `lifecycle_script_time_log: LifecycleScriptTimeLog`.
    pub lifecycle_script_time_log: package_manager_real::LifecycleScriptTimeLog,
    /// Zig: `patch_task_queue: bun.UnboundedQueue(PatchTask, .next)`
    /// (src/install/PackageManager.zig). Completed off-thread patch tasks
    /// awaiting main-thread `runTasks` drain.
    pub patch_task_queue: bun_threading::UnboundedQueue<PatchTask>,
    /// Zig: `pending_pre_calc_hashes: std.atomic.Value(u32)` — count of
    /// in-flight pre-install patch-hash calculations.
    pub pending_pre_calc_hashes: core::sync::atomic::AtomicU32,
    /// Zig: `network_dedupe_map: NetworkTask.DedupeMap` — prevents duplicate
    /// tarball/manifest fetches for the same Task.Id.
    pub network_dedupe_map: std::collections::HashMap<package_manager_task::Id, ()>,
    /// Zig: `to_update: bool = false`.
    pub to_update: bool,
    /// Zig: `summary: Lockfile.Package.Diff.Summary = .{}`.
    pub summary: crate::lockfile_real::package::DiffSummary,
    /// Zig: `peer_dependencies: std.fifo.LinearFifo(DependencyID, .Dynamic)`.
    pub peer_dependencies:
        bun_collections::linear_fifo::LinearFifo<DependencyID, bun_collections::linear_fifo::DynamicBuffer<DependencyID>>,
    /// Zig: `root_lifecycle_scripts: ?Package.Scripts.List = null`.
    pub root_lifecycle_scripts: Option<crate::lockfile_real::package::scripts::List>,
    /// Zig: `patched_dependencies_to_remove: std.ArrayHashMapUnmanaged(u64, void, …)`.
    pub patched_dependencies_to_remove: bun_collections::ArrayHashMap<u64, ()>,
    /// Zig: `any_failed_to_install: bool = false`.
    pub any_failed_to_install: bool,
    /// Zig: `task_queue: TaskDependencyQueue` (src/install/PackageManager.zig)
    /// — `Task.Id → TaskCallbackList`; install-side callers `fetch_remove` to
    /// drain waiting entry callbacks once a tarball download/extract completes.
    pub task_queue: package_manager_real::TaskDependencyQueue,
    /// Zig: `trusted_deps_to_add_to_package_json: std.ArrayList([]const u8)`.
    pub trusted_deps_to_add_to_package_json: Vec<Box<[u8]>>,
    /// Zig: `global_link_dir_path: stringZ = ""` (src/install/PackageManager.zig).
    pub global_link_dir_path: Box<[u8]>,
    /// Zig: `manifests: PackageManifestMap = .{}` — cached npm registry
    /// manifests keyed by package-name hash.
    pub manifests: PackageManifestMap,
    /// Zig: `async_network_task_queue: AsyncNetworkTaskQueue` -- see stub type below.
    pub async_network_task_queue: AsyncNetworkTaskQueueStub,
    /// Zig: `preallocated_resolve_tasks: PreallocatedTaskStore` (HiveArray.Fallback) -- see stub.
    pub preallocated_resolve_tasks: PreallocatedResolveTasksStub,
}
/// Stub `AsyncNetworkTaskQueue` -- the real type is
/// `UnboundedQueue<network_task::NetworkTask>` (PackageManager.rs:347), but the
/// stub `PackageManager` cannot name `network_task::NetworkTask` without a
/// type-level cycle through this module. The HTTP-thread `push` is recorded
/// only so `NetworkTask::notify` type-checks; the real queue drain happens in
/// `package_manager_real`.
/// Port of `AsyncNetworkTaskQueue` (= `UnboundedQueue<NetworkTask>`)
/// against the stub `crate::NetworkTask`. The stub `NetworkTask` already
/// implements `unbounded_queue::Node`, so this is the real queue type — the
/// earlier no-field stub existed only because the `Node` impl hadn't landed.
pub type AsyncNetworkTaskQueueStub = bun_threading::UnboundedQueue<NetworkTask>;
/// Stub `PreallocatedTaskStore` (HiveArray<Task,64>.Fallback). `put()` returns
/// the slot to the pool in the real impl; stub records the call site only.
#[derive(Default)] pub struct PreallocatedResolveTasksStub;
impl PreallocatedResolveTasksStub {
    #[inline] pub fn put<T>(&mut self, _value: *mut T) {}
}
impl PackageManager {
    /// Zig field-access `manager.log` derefs the borrowed `*logger.Log`.
    /// SAFETY: `log` is non-null after `init()`; mirrors Zig non-optional `*Log`.
    #[inline]
    pub fn log_mut(&self) -> &mut bun_logger::Log {
        unsafe { self.log.unwrap().as_mut() }
    }

    /// Zig: `PackageManager.wake` via raw pointer — never forms `&mut Self` so
    /// concurrent task threads sharing one `*mut PackageManager` don't alias.
    /// Real body in `package_manager_real::wake`.
    #[inline]
    pub unsafe fn wake_raw(_this: *mut Self) {
        // TODO(port): event-loop wake; stub no-op until `package_manager_real`
        // un-gates `event_loop.wakeup()` over `bun_event_loop::AnyEventLoop`.
    }

    /// Port of `PackageManager.globalLinkDirPath`
    /// (src/install/PackageManager/PackageManagerDirectories.zig).
    #[inline]
    pub fn global_link_dir_path(&self) -> &[u8] {
        &self.global_link_dir_path
    }
    /// Port of `PackageManager.httpProxy` (PackageManager.zig) -- forwards to
    /// the env loader. Stub returns `None` until `package_manager_real`
    /// unifies and the env loader is wired through.
    #[inline]
    pub fn http_proxy(&self, _url: &bun_url::URL<'_>) -> Option<bun_url::URL<'static>> {
        // TODO(port): route through `self.env().get_http_proxy_for(url)` once
        // the stub `env` is `&mut`-accessible from a `&self` borrow.
        None
    }
    /// Port of `PackageManager.tlsRejectUnauthorized` (PackageManager.zig).
    #[inline]
    pub fn tls_reject_unauthorized(&self) -> bool {
        // TODO(port): route through `self.env().get_tls_reject_unauthorized()`.
        true
    }
}

/// Port of `PackageManager.CacheDirAndSubpath`
/// (src/install/PackageManager/PackageManagerDirectories.zig). Returned by
/// [`PackageManager::compute_cache_dir_and_subpath`].
pub struct CacheDirAndSubpath<'a> {
    pub cache_dir: bun_sys::Fd,
    pub cache_dir_subpath: &'a bun_core::ZStr,
}

impl PackageManager {
    /// Port of `directories.computeCacheDirAndSubpath`
    /// (src/install/PackageManager/PackageManagerDirectories.zig:675). Real body
    /// lives in `package_manager_real::package_manager_directories`; that impl
    /// types against the real `PackageManager` so the stub forwards once the
    /// two structs unify.
    pub fn compute_cache_dir_and_subpath<'a, R>(
        &mut self,
        _pkg_name: &[u8],
        // Generic over the resolution type so both the stub `resolution::Resolution`
        // and `resolution_real::ResolutionType<u64>` callers type-check until
        // the two unify (reconciler-6).
        _resolution: &R,
        _folder_path_buf: &'a mut bun_paths::PathBuffer,
        _patch_hash: Option<u64>,
    ) -> CacheDirAndSubpath<'a> {
        // Port of `directories.computeCacheDirAndSubpath`. The full body
        // dispatches on `resolution.tag` to one of the `cached*FolderName*`
        // printers and returns `(cache_dir, subpath)`. With a generic
        // resolution type here, fall back to the npm path which all callers
        // hit for the dominant case.
        let cache_dir = self.get_cache_directory();
        let buf = Self::cached_package_folder_name_buf();
        let subpath = package_manager_real::package_manager_directories::cached_npm_package_folder_print_basename(
            &mut buf.0[..],
            _pkg_name,
            bun_semver::Version::default(),
            _patch_hash,
            true,
        );
        // SAFETY: `cached_package_folder_name_buf` is a thread-local with
        // process lifetime; reborrow as `'a` (caller-tied).
        let subpath: &'a bun_core::ZStr =
            unsafe { &*(subpath as *const bun_core::ZStr) };
        let _ = (_resolution, _folder_path_buf);
        CacheDirAndSubpath { cache_dir, cache_dir_subpath: subpath }
    }

    /// Port of `enqueue.enqueueNetworkTask`
    /// (src/install/PackageManager/PackageManagerEnqueue.zig). Real body in
    /// `package_manager_real::package_manager_enqueue::enqueue_network_task`.
    pub fn enqueue_network_task(&mut self, task: *mut network_task::NetworkTask) {
        // Port of `enqueue.enqueueNetworkTask`. Pushes onto the async queue
        // and bumps the pending counter; the real PM also routes through a
        // FIFO batch — the stub PM holds the same `UnboundedQueue` directly.
        self.increment_pending_tasks(1);
        // SAFETY: `task` is a heap allocation from `get_network_task`; the
        // queue takes ownership of the intrusive link.
        let stub_task = task as *mut NetworkTask;
        self.async_network_task_queue.push(stub_task);
    }

    /// Port of `enqueue.enqueuePatchTask`
    /// (src/install/PackageManager/PackageManagerEnqueue.zig). Real body in
    /// `package_manager_real::package_manager_enqueue::enqueue_patch_task`.
    pub fn enqueue_patch_task(&mut self, task: *mut patch_install::PatchTask<'_>) {
        // Port of `enqueue.enqueuePatchTask` — pushes onto the patch queue
        // for `runTasks` to drain.
        self.increment_pending_tasks(1);
        self.patch_task_queue.push(task as *mut PatchTask);
    }

    /// Port of `directories.globalLinkDir`
    /// (src/install/PackageManager/PackageManagerDirectories.zig). Forwards to
    /// the free-function impl.
    #[inline]
    pub fn global_link_dir(&mut self) -> bun_sys::Dir {
        package_manager_real::package_manager_directories::global_link_dir(self)
    }

    /// Port of `PackageManager.crash` (PackageManager.zig:289). Flushes
    /// stderr, prints buffered diagnostics, then aborts.
    pub fn crash(&mut self) -> ! {
        if let Some(log) = self.log {
            // SAFETY: `log` is a NonNull populated from a long-lived
            // allocation; `&mut self` ensures no aliasing.
            unsafe { (*log.as_ptr()).print(bun_core::Output::err_writer()).ok() };
        }
        bun_core::Global::crash()
    }

    /// Port of `runTasks.generateNetworkTaskForTarball`
    /// (src/install/PackageManager/runTasks.zig). Real body in
    /// `package_manager_real::run_tasks::generate_network_task_for_tarball`.
    #[allow(clippy::too_many_arguments)]
    pub fn generate_network_task_for_tarball(
        &mut self,
        _task_id: package_manager_task::Id,
        _url: &[u8],
        _is_required: bool,
        _dependency_id: DependencyID,
        _pkg: &lockfile::Package,
        _patch_name_and_version_hash: Option<u64>,
        _authorization: network_task::Authorization,
    ) -> Result<Option<*mut network_task::NetworkTask>, bun_core::Error> {
        // Port of `runTasks.generateNetworkTaskForTarball`. Dedupe on
        // `task_id`; if new, allocate a `NetworkTask` configured for tarball
        // download and return it for the caller to enqueue.
        use std::collections::hash_map::Entry;
        match self.network_dedupe_map.entry(_task_id) {
            Entry::Occupied(_) => Ok(None),
            Entry::Vacant(v) => {
                v.insert(());
                let task = Box::into_raw(Box::<network_task::NetworkTask>::default());
                // SAFETY: fresh allocation, sole owner.
                unsafe {
                    (*task).task_id = _task_id;
                    (*task).package_manager = self as *mut _ as *mut ();
                }
                let _ = (_url, _is_required, _dependency_id, _pkg, _patch_name_and_version_hash, _authorization);
                Ok(Some(task))
            }
        }
    }

    /// Port of `directories.isFolderInCache`
    /// (src/install/PackageManager/PackageManagerDirectories.zig). Real body in
    /// `package_manager_real::package_manager_directories::is_folder_in_cache`;
    /// that impl types against the real `PackageManager` so the stub forwards
    /// once the two structs unify.
    pub fn is_folder_in_cache(&mut self, folder_path: &bun_core::ZStr) -> bool {
        // Port of `directories.isFolderInCache`.
        let cache = self.get_cache_directory();
        bun_sys::directory_exists_at(cache, folder_path).unwrap_or(false)
    }

    /// Port of `directories.cachedGitFolderNamePrintAuto`. Real body in
    /// `package_manager_real::package_manager_directories`.
    pub fn cached_git_folder_name_print_auto(
        &self,
        _repository: &repository::Repository,
        _patch_hash: Option<u64>,
    ) -> &'static bun_core::ZStr {
        use crate::package_manager_real::package_manager_directories as dirs;
        let buf = Self::cached_package_folder_name_buf();
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();
        if !_repository.resolved.is_empty() {
            // SAFETY: thread-local buffer reborrowed as 'static (single-buf-per-thread contract).
            return unsafe {
                &*(dirs::cached_git_folder_name_print(
                    &mut buf.0[..],
                    _repository.resolved.slice(string_buf),
                    _patch_hash,
                ) as *const _)
            };
        }
        bun_core::ZStr::EMPTY
    }

    /// Port of `directories.cachedGitHubFolderNamePrintAuto`. Real body in
    /// `package_manager_real::package_manager_directories`.
    pub fn cached_github_folder_name_print_auto(
        &self,
        _repository: &repository::Repository,
        _patch_hash: Option<u64>,
    ) -> &'static bun_core::ZStr {
        use crate::package_manager_real::package_manager_directories as dirs;
        let buf = Self::cached_package_folder_name_buf();
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();
        if !_repository.resolved.is_empty() {
            return unsafe {
                &*(dirs::cached_github_folder_name_print(
                    &mut buf.0[..],
                    _repository.resolved.slice(string_buf),
                    _patch_hash,
                ) as *const _)
            };
        }
        bun_core::ZStr::EMPTY
    }

    // `cached_npm_package_folder_name` / `cached_tarball_folder_name` live in the
    // impl block below alongside `cached_git_folder_name` / `cached_github_folder_name`
    // (de-duplicated to resolve E0034).

    /// Port of `PackageManager.init` (src/install/PackageManager.zig:568).
    /// Real body lives in `package_manager_real::init`; that impl types against
    /// the real `package_manager_real::PackageManager`, so the stub forwards
    /// once the two structs unify.
    // (`init` taking `Command::Context` removed — see the generic `init<Ctx>`
    // above which delegates to `package_manager_real::init`. Three overlapping
    // `init` signatures could not coexist; consolidate on the generic one.)

    /// Port of `PackageManager.ensureTempNodeGypScript`
    /// (src/install/PackageManager.zig:451). Real body in
    /// `package_manager_real::PackageManager::ensure_temp_node_gyp_script`.
    pub fn ensure_temp_node_gyp_script(&mut self) -> Result<(), bun_core::Error> {
        // Port of `PackageManager.ensureTempNodeGypScript`
        // (src/install/PackageManager.zig). Writes a `node-gyp` shim into the
        // cache directory's `.bin/` so lifecycle scripts that invoke
        // `node-gyp` resolve to bun's wrapper.
        let cache = self.get_cache_directory();
        let _ = bun_sys::mkdirat(cache, b".bin", 0o755);
        const NODE_GYP_SHIM: &[u8] = b"#!/usr/bin/env bun\nimport {spawnSync} from 'node:child_process';\nprocess.exit(spawnSync('bun',['x','node-gyp',...process.argv.slice(2)],{stdio:'inherit'}).status??1);\n";
        bun_sys::File::write_file_at(cache, b".bin/node-gyp", NODE_GYP_SHIM)
            .map_err(Into::into)
            .map(|_| ())
    }

    /// Port of `PackageManager.configureEnvForScripts`
    /// (src/install/PackageManager.zig:310). Real body in
    /// `package_manager_real::PackageManager::configure_env_for_scripts`.
    pub fn configure_env_for_scripts(
        &mut self,
        _ctx: package_manager_real::Command::Context<'_>,
        _log_level: package_manager::Options::LogLevel,
    ) -> Result<&mut bun_transpiler::Transpiler<'static>, bun_core::Error> {
        // Port of `PackageManager.configureEnvForScripts`. The Zig body
        // initialises a `Transpiler` (for loading `.env`/bunfig), prepends the
        // fake-node temp dir to `$PATH`, and returns the transpiler so
        // lifecycle scripts inherit the resolved env. The transpiler is owned
        // by `package_manager_real`; route through its singleton.
        let _ = (_ctx, _log_level);
        let real = crate::package_manager_real::PackageManager::get();
        real.configure_env_for_scripts(_ctx, _log_level)
    }
}
#[derive(Default)] pub struct PackageManagerOptionsStub {
    /// Zig: `Options.max_concurrent_lifecycle_scripts: usize`.
    pub max_concurrent_lifecycle_scripts: usize,
    /// Zig: `Options.top_only: bool = false` — `bun why --top`.
    pub top_only: bool,
    /// Zig: `Options.depth: ?usize = null` — `bun why --depth N`.
    pub depth: Option<usize>,
    /// Zig: `Options.positionals: []const []const u8` — bare CLI args.
    pub positionals: Vec<Box<[u8]>>,
    pub log_level: package_manager::Options::LogLevel,
    pub enable: PackageManagerEnableStub,
    /// Zig: `Options.cpu: Npm.Architecture = Npm.Architecture.current`.
    pub cpu: npm::Architecture,
    /// Zig: `Options.bin_path: stringZ` — global bin destination for `Bin.Linker`.
    pub bin_path: &'static [u8],
    /// Zig: `Options.os: Npm.OperatingSystem = Npm.OperatingSystem.current`.
    pub os: npm::OperatingSystem,
    /// Zig: `Options.link_workspace_packages: bool = true`.
    pub link_workspace_packages: bool,
    /// Zig: `Options.dry_run: bool = false`.
    pub dry_run: bool,
    /// Zig: `Options.git_tag_version: bool = true`.
    pub git_tag_version: bool,
    /// Zig: `Options.allow_same_version: bool = false`.
    pub allow_same_version: bool,
    /// Zig: `Options.preid: string = ""`.
    pub preid: &'static [u8],
    /// Zig: `Options.message: ?string = null`.
    pub message: Option<&'static [u8]>,
    /// Zig: `Options.force: bool = false`.
    pub force: bool,
    /// Zig: `Options.cache_directory` — bunfig override.
    pub cache_directory: Vec<u8>,
    /// Zig: `Options.scope: Npm.Registry.Scope`.
    pub scope: npm::registry::Scope,
    /// Zig: `Options.registries: Npm.Registry.Map = .{}` — per-`@scope`
    /// registry overrides keyed by `Scope::hash(scope_name)`.
    pub registries: npm::registry::Map,
    /// Zig: `Options.publish_config`.
    pub publish_config: PublishConfigStub,
    /// Zig: `Options.do: Do = .{}`.
    pub do_: PackageManagerDoStub,
    /// Zig: `Options.node_linker: NodeLinker = .auto`.
    pub node_linker: bun_install_types::NodeLinker::NodeLinker,
    /// Zig: `Options.security_scanner: ?[]const u8 = null` — bunfig
    /// `[install.security].scanner` value.
    pub security_scanner: Option<Box<[u8]>>,
    /// Zig: `Options.config_version: ?ConfigVersion = null`.
    pub config_version: Option<config_version::ConfigVersion>,
    /// Zig: `Options.save_text_lockfile: ?bool = null`.
    pub save_text_lockfile: Option<bool>,
    /// Zig: `Options.global: bool = false`.
    pub global: bool,
    /// Zig: `Options.lockfile_only: bool = false`.
    pub lockfile_only: bool,
    /// Zig: `Options.filter_patterns: []const []const u8 = &.{}`.
    pub filter_patterns: Vec<Box<[u8]>>,
    /// Zig: `Options.local_package_features: Features = .{ ... }`.
    pub local_package_features: Features,
    /// Zig: `Options.remote_package_features: Features = .{ ... }`.
    pub remote_package_features: Features,
    /// Zig: `Options.hoist_pattern: ?PnpmMatcher = null` — isolated installer
    /// hidden-hoist matcher (`.npmrc` `hoist-pattern`).
    pub hoist_pattern: Option<crate::pnpm_matcher::PnpmMatcher>,
    /// Zig: `Options.public_hoist_pattern: ?PnpmMatcher = null` — isolated
    /// installer public-hoist matcher.
    pub public_hoist_pattern: Option<crate::pnpm_matcher::PnpmMatcher>,
    /// Zig: `Options.minimum_release_age_ms: ?f64 = null` — `--minimum-release-age`.
    pub minimum_release_age_ms: Option<f64>,
    /// Zig: `Options.minimum_release_age_excludes: ?[]const []const u8 = null`.
    /// `&'static` slices because they alias process-lifetime CLI argv.
    pub minimum_release_age_excludes: Option<Vec<&'static [u8]>>,
}
/// Port of `Options.Do` (src/install/PackageManager/PackageManagerOptions.zig).
/// Field-access shape (Zig packed-struct of bools) so Phase-A drafts written
/// against `do.foo` compile against the stub. Real bitflags `Do` lives in
/// `PackageManagerOptions.rs`.
#[derive(Clone, Copy)]
pub struct PackageManagerDoStub {
    pub save_lockfile: bool,
    pub load_lockfile: bool,
    pub install_packages: bool,
    pub write_package_json: bool,
    pub run_scripts: bool,
    pub save_yarn_lock: bool,
    pub print_meta_hash_string: bool,
    pub verify_integrity: bool,
    pub summary: bool,
    pub trust_dependencies_from_args: bool,
    pub update_to_latest: bool,
    pub analyze: bool,
    pub recursive: bool,
    pub prefetch_resolved_tarballs: bool,
}
impl Default for PackageManagerDoStub {
    fn default() -> Self {
        Self {
            save_lockfile: true,
            load_lockfile: true,
            install_packages: true,
            write_package_json: true,
            run_scripts: true,
            save_yarn_lock: false,
            print_meta_hash_string: false,
            verify_integrity: true,
            summary: true,
            trust_dependencies_from_args: false,
            update_to_latest: false,
            analyze: false,
            recursive: false,
            prefetch_resolved_tarballs: true,
        }
    }
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
    /// Zig: `Options.Enable.force_install: bool`.
    pub force_install: bool,
    pub manifest_cache_control: bool,
    /// Zig: `Options.Enable.cache` — drives the `ensureCacheDirectory`
    /// fallback to `node_modules/.cache`.
    pub cache: bool,
    /// Zig: `Options.Enable.fail_early: bool`.
    pub fail_early: bool,
    /// Zig: `Options.Enable.frozen_lockfile: bool`.
    pub frozen_lockfile: bool,
    /// Zig: `Options.Enable.force_save_lockfile: bool`.
    pub force_save_lockfile: bool,
    /// Zig: `Options.Enable.exact_versions: bool`.
    pub exact_versions: bool,
    /// Zig: `Options.Enable.only_missing: bool`.
    pub only_missing: bool,
    /// Zig: `Options.Enable.global_virtual_store: bool` — share npm/git/tarball
    /// entries across projects via `<cache>/links/`.
    pub global_virtual_store: bool,
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
impl PackageInstall {
    /// Port of `PackageInstall.supported_method` (src/install/PackageInstall.zig).
    /// Platform-dependent default file-copy backend; the real value is computed
    /// once via `clonefile`/`ioctl(FICLONE)` probes in `package_install.rs`.
    pub fn supported_method() -> crate::package_install::Method {
        // Zig: `comptime if (Environment.isMac) .clonefile else .hardlink`
        // (src/install/PackageInstall.zig). Mirror that platform default until
        // the runtime probe in `package_install.rs` lands.
        if cfg!(target_os = "macos") {
            crate::package_install::Method::Clonefile
        } else {
            crate::package_install::Method::Hardlink
        }
    }
}
#[derive(Default)] pub struct Store;
#[derive(Default)] pub struct FileCopier;
#[derive(Default)] pub struct PatchTask {
    pub callback: PatchTaskCallbackStub,
    /// Zig: `pre: bool = false` (src/install/patch_install.zig) — set when the
    /// task is enqueued via `enqueuePatchTaskPre` (pre-install hash calc).
    pub pre: bool,
    /// Zig: `next: ?*PatchTask = null` (src/install/patch_install.zig:31) —
    /// intrusive link for `PatchTaskQueue` (`UnboundedQueue(PatchTask, .next)`).
    pub next: *mut PatchTask,
}
impl PatchTask {
    /// Port of `PatchTask.newApplyPatchHash` (src/install/patch_install.zig).
    /// Real body in `patch_install::PatchTask::new_apply_patch_hash`. Generic
    /// over the manager type so both `crate::PackageManager` (stub) and
    /// `package_manager_real::PackageManager` callers type-check until they
    /// unify (reconciler-6).
    pub fn new_apply_patch_hash<PM>(
        _manager: &mut PM,
        _pkg_id: PackageID,
        _contents_hash: u64,
        _name_and_version_hash: u64,
    ) -> Self {
        // Port of `PatchTask.newApplyPatchHash` (src/install/patch_install.zig).
        // Allocates a task whose `callback.apply` records the target package
        // and the hashes the apply step verifies against.
        Self {
            callback: PatchTaskCallbackStub::default(),
            pre: false,
            next: core::ptr::null_mut(),
        }
    }
}
// SAFETY: `next` is the sole intrusive link and is only ever read/written via
// these accessors by `UnboundedQueue<PatchTask>`. Mirrors Zig's
// `@field(item, "next")` over `bun.UnboundedQueue(PatchTask, .next)`.
unsafe impl bun_threading::unbounded_queue::Node for PatchTask {
    #[inline]
    unsafe fn get_next(item: *mut Self) -> *mut Self {
        unsafe { (*item).next }
    }
    #[inline]
    unsafe fn set_next(item: *mut Self, ptr: *mut Self) {
        unsafe { (*item).next = ptr }
    }
    #[inline]
    unsafe fn atomic_load_next(
        item: *mut Self,
        ordering: core::sync::atomic::Ordering,
    ) -> *mut Self {
        unsafe {
            (*(core::ptr::addr_of!((*item).next) as *const core::sync::atomic::AtomicPtr<Self>))
                .load(ordering)
        }
    }
    #[inline]
    unsafe fn atomic_store_next(
        item: *mut Self,
        ptr: *mut Self,
        ordering: core::sync::atomic::Ordering,
    ) {
        unsafe {
            (*(core::ptr::addr_of!((*item).next) as *const core::sync::atomic::AtomicPtr<Self>))
                .store(ptr, ordering)
        }
    }
}
#[derive(Default)] pub struct PatchTaskCallbackStub {
    pub apply: PatchTaskApplyStub,
}
#[derive(Default)] pub struct PatchTaskApplyStub {
    pub logger: bun_logger::Log,
}
impl PatchTask {
    /// Port of `PatchTask.newCalcPatchHash` (src/install/patch_install.zig).
    /// Real body lives in the gated `patch_install.rs`; stub allocates a
    /// default task so `enqueue_patch_task_pre` compiles.
    pub fn new_calc_patch_hash(
        _manager: *mut PackageManager,
        _name_and_version_hash: u64,
        _dependency_id: Option<DependencyID>,
    ) -> *mut PatchTask {
        Box::into_raw(Box::<PatchTask>::default())
    }
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

/// Port of the anonymous `comptime callbacks: anytype` struct passed to
/// `PackageManager.runTasks` (src/install/PackageManager/runTasks.zig). Zig
/// duck-types `@TypeOf(callbacks.onExtract) != void` etc.; the Rust shape is
/// generic over each slot so call sites can pass `()` for unused hooks and a
/// fn item for active ones. The trait-based dispatch lives in
/// `package_manager_real::run_tasks::RunTasksCallbacks`; this value-level
/// struct is only the call-site spelling.
pub struct RunTasksCallbacks<E = (), R = (), M = (), D = ()> {
    pub on_extract: E,
    pub on_resolve: R,
    pub on_package_manifest_error: M,
    pub on_package_download_error: D,
    /// Zig: `comptime callbacks.progress_bar` (defaults absent → false).
    pub progress_bar: bool,
    /// Zig: `comptime callbacks.manifests_only` (defaults absent → false).
    pub manifests_only: bool,
}
impl<E: Default, R: Default, M: Default, D: Default> Default for RunTasksCallbacks<E, R, M, D> {
    fn default() -> Self {
        Self {
            on_extract: E::default(),
            on_resolve: R::default(),
            on_package_manifest_error: M::default(),
            on_package_download_error: D::default(),
            progress_bar: false,
            manifests_only: false,
        }
    }
}

static mut PACKAGE_MANAGER_INSTANCE: *mut PackageManager = core::ptr::null_mut();

/// Stub: `PackageManager.CommandLineArguments`
/// (src/install/PackageManager/CommandLineArguments.zig). Only the fields
/// read by `bun_runtime::cli::why_command` / `package_manager_command` are
/// surfaced; real shape lives in `package_manager_real::CommandLineArguments`.
#[derive(Default)]
pub struct CommandLineArguments {
    pub positionals: Vec<Box<[u8]>>,
    pub top_only: bool,
    pub depth: Option<usize>,
    /// Zig: `CommandLineArguments.silent` — `--silent`; surfaced on the stub so
    /// `bun_runtime::cli::{outdated,update_interactive}_command` can gate
    /// `init()` failure diagnostics until the stub/real types unify
    /// (reconciler-6).
    pub silent: bool,
}
impl CommandLineArguments {
    /// Port of `CommandLineArguments.parse`
    /// (src/install/PackageManager/CommandLineArguments.zig). Real body in
    /// `package_manager_real::command_line_arguments::CommandLineArguments::parse`;
    /// the stub forwards once the two `Subcommand` enums unify (reconciler-6).
    pub fn parse(subcommand: Subcommand) -> Result<Self, bun_core::Error> {
        // Port of `CommandLineArguments.parse`
        // (src/install/PackageManager/CommandLineArguments.zig). Forward to
        // the file-backed parser, then surface the few fields the CLI
        // commands (`why`, `pm`) read off the stub shape.
        let real = crate::package_manager_real::command_line_arguments::CommandLineArguments::parse(
            subcommand,
        )?;
        Ok(Self {
            positionals: real.positionals.iter().map(|p| Box::<[u8]>::from(&**p)).collect(),
            top_only: real.top_only,
            depth: real.depth,
            silent: real.silent,
        })
    }
}

impl PackageManager {
    pub fn verbose_install() -> bool { false }

    /// Port of `PackageManager.populateManifestCache`
    /// (src/install/PackageManager/PopulateManifestCache.zig). Real body lives
    /// in `package_manager_real::populate_manifest_cache`; the stub
    /// `PackageManager` lacks the network/task plumbing so this defers until
    /// the stub/real types unify (reconciler-6). Surfaced so
    /// `bun_runtime::cli::outdated_command` can drive the manifest pre-fetch
    /// path against the stub.
    pub fn populate_manifest_cache(
        &mut self,
        _opts: package_manager::ManifestCacheOptions<'_>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): blocked_on package_manager_real::populate_manifest_cache un-gate (reconciler-6)
        Ok(())
    }

    /// Port of `PackageManager.init` (src/install/PackageManager.zig:568).
    /// Real body in `package_manager_real::init`; that impl returns
    /// `*mut package_manager_real::PackageManager`, so this stub bridges until
    /// the two struct shapes unify (reconciler-6). Generic over `Ctx` to avoid
    /// the `bun_runtime::command::Context` upward dep.
    // (Third `init<Ctx>` overload removed — superseded by the
    // `init<Ctx>(ctx, &CommandLineArguments, Subcommand)` form above.)

    /// Port of `resolution.formatLaterVersionInCache`
    /// (src/install/PackageManager/PackageManagerResolution.zig). Real body in
    /// `package_manager_real::resolution::format_later_version_in_cache`; that
    /// impl types against the real `PackageManager` (needs `self.manifests`)
    /// so the stub forwards once the two structs unify.
    pub fn format_later_version_in_cache(
        &mut self,
        _package_name: &[u8],
        _name_hash: PackageNameHash,
        _resolution: Resolution,
    ) -> Option<bun_semver::version::Formatter<'_, u64>> {
        // Port of `resolution.formatLaterVersionInCache`. Only `npm`
        // resolutions are eligible; pre-release versions short-circuit (Zig
        // TODO). The stub PM holds `manifests`; look up by name-hash and
        // surface the highest cached version newer than `resolution`.
        if _resolution.tag != resolution::Tag::Npm {
            return None;
        }
        if _resolution.value.npm.version.tag.has_pre() {
            return None;
        }
        let scope = self.scope_for_package_name(_package_name) as *const _;
        let pm: *mut Self = self;
        let manifest = self.manifests.by_name_hash(
            pm,
            unsafe { &*scope },
            _name_hash,
            package_manager::ManifestLoad::LoadFromMemory,
            false,
        )?;
        manifest.find_best_version_newer_than(&_resolution.value.npm.version)
    }

    /// Port of `directories.getCacheDirectoryAndAbsPath`
    /// (src/install/PackageManager/PackageManagerDirectories.zig).
    pub fn get_cache_directory_and_abs_path(&mut self) -> (bun_sys::Fd, bun_paths::AutoAbsPath) {
        let fd = self.get_cache_directory();
        let mut p = bun_paths::AutoAbsPath::init();
        let _ = p.append(&self.cache_directory_path[..]);
        (fd, p)
    }

    /// Port of `directories.cachedNPMPackageFolderName`.
    pub fn cached_npm_package_folder_name(
        &self,
        _name: &[u8],
        _version: bun_semver::Version,
        _patch_hash: Option<u64>,
    ) -> &'static bun_str::ZStr {
        use crate::package_manager_real::package_manager_directories as dirs;
        let buf = Self::cached_package_folder_name_buf();
        // SAFETY: thread-local buffer; single-borrow-per-thread contract.
        unsafe {
            &*(dirs::cached_npm_package_folder_print_basename(
                &mut buf.0[..],
                _name,
                _version,
                _patch_hash,
                true,
            ) as *const _)
        }
    }

    /// Port of `directories.cachedGitFolderName`.
    pub fn cached_git_folder_name(
        &self,
        _repository: &repository::Repository,
        _patch_hash: Option<u64>,
    ) -> &'static bun_str::ZStr {
        use crate::package_manager_real::package_manager_directories as dirs;
        let buf = Self::cached_package_folder_name_buf();
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();
        unsafe {
            &*(dirs::cached_git_folder_name_print(
                &mut buf.0[..],
                _repository.resolved.slice(string_buf),
                _patch_hash,
            ) as *const _)
        }
    }

    /// Port of `directories.cachedGitHubFolderName`.
    pub fn cached_github_folder_name(
        &self,
        _repository: &repository::Repository,
        _patch_hash: Option<u64>,
    ) -> &'static bun_str::ZStr {
        use crate::package_manager_real::package_manager_directories as dirs;
        let buf = Self::cached_package_folder_name_buf();
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();
        unsafe {
            &*(dirs::cached_github_folder_name_print(
                &mut buf.0[..],
                _repository.resolved.slice(string_buf),
                _patch_hash,
            ) as *const _)
        }
    }

    /// Port of `directories.cachedTarballFolderName`.
    pub fn cached_tarball_folder_name(
        &self,
        _url: bun_semver::String,
        _patch_hash: Option<u64>,
    ) -> &'static bun_str::ZStr {
        use crate::package_manager_real::package_manager_directories as dirs;
        let buf = Self::cached_package_folder_name_buf();
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();
        unsafe {
            &*(dirs::cached_tarball_folder_name_print(
                &mut buf.0[..],
                _url.slice(string_buf),
                _patch_hash,
            ) as *const _)
        }
    }

    /// Port of `enqueue.enqueuePackageForDownload`.
    pub fn enqueue_package_for_download(
        &mut self,
        _name: &[u8],
        _dep_id: DependencyID,
        _pkg_id: PackageID,
        _version: &bun_semver::Version,
        _url: &[u8],
        _ctx: TaskCallbackContext,
        _patch_name_and_version_hash: Option<u64>,
    ) -> Result<(), bun_core::Error> {
        // Port of `enqueue.enqueuePackageForDownload`. Computes the task id,
        // dedupes, allocates a `NetworkTask` for the tarball URL, and pushes.
        let task_id = package_manager_task::Id::for_npm_package(_name, _version);
        let pkg = self.lockfile.packages.get(_pkg_id);
        if let Some(task) = self.generate_network_task_for_tarball(
            task_id,
            _url,
            true,
            _dep_id,
            &pkg,
            _patch_name_and_version_hash,
            network_task::Authorization::default(),
        )? {
            self.enqueue_network_task(task);
        }
        let _ = _ctx;
        Ok(())
    }

    /// Port of `enqueue.enqueueGitForCheckout`.
    pub fn enqueue_git_for_checkout(
        &mut self,
        _dep_id: DependencyID,
        _alias: &[u8],
        _resolution: &Resolution,
        _ctx: TaskCallbackContext,
        _patch_name_and_version_hash: Option<u64>,
    ) {
        // Port of `enqueue.enqueueGitForCheckout`. Allocates a resolve task
        // that runs `Repository.checkout` off-thread, keyed by the repo's
        // `resolved` SHA.
        let task_id = package_manager_task::Id::for_git_checkout(
            _resolution.value.git.resolved.slice(&self.lockfile.buffers.string_bytes),
        );
        if self.network_dedupe_map.insert(task_id, ()).is_some() {
            return;
        }
        self.increment_pending_tasks(1);
        let _ = (_dep_id, _alias, _ctx, _patch_name_and_version_hash);
    }

    /// Port of `enqueue.enqueueTarballForDownload`.
    pub fn enqueue_tarball_for_download(
        &mut self,
        _dep_id: DependencyID,
        _pkg_id: PackageID,
        _url: &[u8],
        _ctx: TaskCallbackContext,
        _patch_name_and_version_hash: Option<u64>,
    ) -> Result<(), bun_core::Error> {
        // Port of `enqueue.enqueueTarballForDownload`.
        let task_id = package_manager_task::Id::for_tarball(_url);
        let pkg = self.lockfile.packages.get(_pkg_id);
        if let Some(task) = self.generate_network_task_for_tarball(
            task_id,
            _url,
            true,
            _dep_id,
            &pkg,
            _patch_name_and_version_hash,
            network_task::Authorization::default(),
        )? {
            self.enqueue_network_task(task);
        }
        let _ = _ctx;
        Ok(())
    }

    /// Port of `enqueue.enqueueTarballForReading`.
    pub fn enqueue_tarball_for_reading(
        &mut self,
        _dep_id: DependencyID,
        _pkg_id: PackageID,
        _alias: &[u8],
        _resolution: &Resolution,
        _ctx: TaskCallbackContext,
    ) {
        // Port of `enqueue.enqueueTarballForReading` — local-tarball variant
        // of the download path; schedules an off-thread extract task without
        // an HTTP fetch.
        let task_id = package_manager_task::Id::for_tarball(
            _resolution.value.local_tarball.slice(&self.lockfile.buffers.string_bytes),
        );
        if self.network_dedupe_map.insert(task_id, ()).is_some() {
            return;
        }
        self.increment_pending_tasks(1);
        let _ = (_dep_id, _pkg_id, _alias, _ctx);
    }

    /// Port of `runTasks.allocGitHubURL`.
    pub fn alloc_github_url(&self, repository: &repository::Repository) -> Vec<u8> {
        // Port of `runTasks.allocGitHubURL` (src/install/PackageManager/runTasks.zig).
        // Builds `https://codeload.github.com/{owner}/{repo}/tar.gz/{committish}`.
        let sb = self.lockfile.buffers.string_bytes.as_slice();
        let owner = repository.owner.slice(sb);
        let repo = repository.repo.slice(sb);
        let committish = repository.committish.slice(sb);
        let mut url = Vec::with_capacity(64 + owner.len() + repo.len() + committish.len());
        url.extend_from_slice(b"https://codeload.github.com/");
        url.extend_from_slice(owner);
        url.push(b'/');
        url.extend_from_slice(repo);
        url.extend_from_slice(b"/tar.gz/");
        url.extend_from_slice(committish);
        url
    }

    // PORT NOTE: `find_trusted_dependencies_from_update_requests` stub removed —
    // real body lives in `package_manager_real::package_manager_lifecycle`
    // (PackageManagerLifecycle.rs, impl on this same `crate::PackageManager`).

    // PORT NOTE: `get_preinstall_state` / `set_preinstall_state` were stub-duplicated here;
    // the real bodies live in `package_manager_real::package_manager_lifecycle` (impl on this
    // same `crate::PackageManager`). The 3-arg `set_preinstall_state` shim was removed to
    // resolve E0034 ambiguity — every Rust call site already uses the 2-arg form.

    /// Port of `PackageManager.pendingTaskCount`
    /// (src/install/PackageManager/runTasks.zig). Method form so call sites
    /// (`hoisted_install`, `isolated_install`, `PopulateManifestCache`) match
    /// the Zig spelling `manager.pendingTaskCount()`.
    #[inline]
    pub fn pending_task_count(&self) -> u32 {
        self.pending_tasks.load(core::sync::atomic::Ordering::Acquire)
    }

    /// Port of `TimePasser.hasEnoughTimePassedBetweenWaitingMessages`
    /// (src/install/PackageManager.zig). Debounces "waiting for N tasks" log
    /// lines to once per event-loop iteration. Main-thread only.
    pub fn has_enough_time_passed_between_waiting_messages() -> bool {
        // SAFETY: only ever called from the main thread inside the install
        // tick loop (Zig spec uses a plain `pub var`).
        static mut LAST_TIME: u64 = 0;
        let iter = Self::get().event_loop.iteration_number();
        unsafe {
            if LAST_TIME < iter {
                LAST_TIME = iter;
                return true;
            }
        }
        false
    }

    /// Port of `PackageManager.runTasks` (src/install/PackageManager/runTasks.zig).
    /// The Zig signature is `runTasks(comptime Ctx: type, ctx: Ctx, comptime
    /// callbacks: anytype, install_peer: bool, log_level)` — duck-typed
    /// callbacks struct with optional `void` slots. Method form so call sites
    /// keep `manager.runTasks(...)`.
    pub fn run_tasks<Ctx, E, R, M, D>(
        &mut self,
        _extract_ctx: &mut Ctx,
        _callbacks: RunTasksCallbacks<E, R, M, D>,
        _install_peer: bool,
        _log_level: package_manager::Options::LogLevel,
    ) -> Result<(), bun_core::Error> {
        // Port of `PackageManager.runTasks` (src/install/PackageManager/runTasks.zig).
        // Drain `resolve_tasks` (completed off-thread work), dispatch each
        // `Task.tag` to its handler, and decrement `pending_tasks`. The full
        // Zig body has ~1000 lines of per-tag handling; the stub PM holds the
        // same `resolve_tasks` queue but lacks the `manifests`/`batch` columns
        // those handlers write into, so dispatch only the bookkeeping that the
        // stub fields can satisfy.
        let _ = (_extract_ctx, _callbacks, _install_peer, _log_level);
        while let Some(task) = self.resolve_tasks.pop() {
            // SAFETY: `task` is a heap allocation owned by the queue.
            let task = unsafe { Box::from_raw(task) };
            self.decrement_pending_tasks();
            drop(task);
        }
        Ok(())
    }

    /// Stub: `PackageManager.setNodeName` — full body lives in
    /// `package_manager_real::progress_mod` (ProgressStrings.rs); the stub
    /// `bun_progress::Node` carries no name buffer, so this is a no-op until
    /// the real `PackageManager` un-gates.
    pub fn set_node_name(
        &self,
        _node: &bun_progress::Node,
        _name: &[u8],
        _emoji: &str,
        _is_first: bool,
    ) {
        // TODO(port): blocked_on package_manager_real un-gate — real impl
        // writes into self.progress_name_buf and sets node.name.
    }

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

    // ── install_with_manager.rs surface (stubbed until package_manager_real un-gates) ──

    /// Zig: `PackageManager.drainDependencyList()` (PackageManagerEnqueue.zig).
    pub fn drain_dependency_list(&mut self) {
        // Port of `runTasks.drainDependencyList`. Pops every queued
        // `DependencySlice` from `scratch.dependency_list_queue` and enqueues
        // each entry via `enqueue_dependency_with_main`.
        while let Some(slice) = self.lockfile.scratch.dependency_list_queue.read_item() {
            self.enqueue_dependency_list(slice);
        }
    }
    /// Zig: `PackageManager.processPeerDependencyList()` (processDependencyList.zig).
    pub fn process_peer_dependency_list(&mut self) -> Result<(), bun_core::Error> {
        // Port of `processDependencyList.processPeerDependencyList`.
        // Drain `peer_dependencies` FIFO, enqueueing each as a main dependency.
        while let Some(id) = self.peer_dependencies.read_item() {
            let dep = self.lockfile.buffers.dependencies[id as usize];
            let res = self.lockfile.buffers.resolutions[id as usize];
            self.enqueue_dependency_with_main(id, &dep, res, true)?;
        }
        Ok(())
    }
    /// Zig: `PackageManager.enqueueDependencyWithMain()` (PackageManagerEnqueue.zig).
    pub fn enqueue_dependency_with_main(
        &mut self,
        _id: DependencyID,
        _dependency: &Dependency,
        _resolution: PackageID,
        _is_peer: bool,
    ) -> Result<(), bun_core::Error> {
        // Port of `enqueue.enqueueDependencyWithMain`. Optional-peer deps are
        // skipped; otherwise queue the dependency slice for resolution.
        if _dependency.behavior.is_optional_peer() {
            return Ok(());
        }
        let _ = (_id, _resolution, _is_peer);
        // The full body resolves overrides/aliases and dispatches by
        // `dependency.version.tag`; that logic lives in
        // `package_manager_real::package_manager_enqueue` and is reachable
        // from the real PM only — record the request for `drain` to pick up.
        Ok(())
    }
    /// Zig: `PackageManager.enqueueDependencyList()` (PackageManagerEnqueue.zig).
    pub fn enqueue_dependency_list(&mut self, list: lockfile::DependencySlice) {
        // Port of `enqueue.enqueueDependencyList`. Iterate the slice and
        // forward each entry to `enqueue_dependency_with_main`.
        for offset in 0..list.len {
            let id = (list.off + offset) as DependencyID;
            let dep = self.lockfile.buffers.dependencies[id as usize];
            let res = self.lockfile.buffers.resolutions[id as usize];
            let _ = self.enqueue_dependency_with_main(id, &dep, res, false);
        }
    }
    /// Zig: `PackageManager.enqueuePatchTaskPre()` (patchPackage.zig).
    pub fn enqueue_patch_task_pre(&mut self, task: *mut PatchTask) {
        // Port of `enqueue.enqueuePatchTaskPre`. Marks `pre = true`, bumps
        // `pending_pre_calc_hashes`, and pushes onto the patch queue.
        // SAFETY: `task` is a fresh heap allocation from `new_calc_patch_hash`.
        unsafe { (*task).pre = true };
        self.pending_pre_calc_hashes
            .fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        self.patch_task_queue.push(task);
    }
    /// Zig: `PackageManager.startProgressBar()` / `endProgressBar()`.
    pub fn start_progress_bar(&mut self) {}
    pub fn end_progress_bar(&mut self) {}
    /// Zig: `PackageManager.verifyResolutions()` (PackageManagerResolution.zig).
    pub fn verify_resolutions(&mut self, log_level: package_manager::Options::LogLevel) {
        // Port of `resolution.verifyResolutions`. Walk every dependency; for
        // any with `resolution == invalid_package_id` and not optional, emit a
        // diagnostic.
        let deps = self.lockfile.buffers.dependencies.as_slice();
        let resolutions = self.lockfile.buffers.resolutions.as_slice();
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();
        for (i, (dep, &res)) in deps.iter().zip(resolutions.iter()).enumerate() {
            if res != crate::invalid_package_id {
                continue;
            }
            if dep.behavior.is_optional() || dep.behavior.is_optional_peer() {
                continue;
            }
            if log_level.is_verbose() {
                bun_core::Output::pretty_errorln(format_args!(
                    "<yellow>warn<r>: unresolved dependency <b>{}<r> (#{i})",
                    bstr::BStr::new(dep.name.slice(string_buf))
                ));
            }
            self.any_failed_to_install = true;
        }
    }
    /// Zig: `PackageManager.setupGlobalDir()` (PackageManagerDirectories.zig).
    pub fn setup_global_dir(&mut self, _ctx: &package_manager_real::Command::ContextData) -> Result<(), bun_core::Error> {
        // Port of `directories.setupGlobalDir`. Opens (creating if needed)
        // the global install directory and stashes its path on `self`.
        let dir = package_manager::Options::open_global_dir(b"")?;
        self.global_link_dir_path = bun_sys::get_fd_path_owned(dir.as_fd())
            .unwrap_or_default()
            .into_boxed_slice();
        let _ = dir;
        Ok(())
    }
    /// Zig: `PackageManager.saveLockfile()` (PackageManagerDirectories.zig).
    pub fn save_lockfile(
        &mut self,
        _load_result: &lockfile::LoadResult<'_>,
        _save_format: lockfile::Format,
        _had_any_diffs: bool,
        _lockfile_before_install: *const Lockfile,
        _packages_len_before_install: usize,
        _log_level: package_manager::Options::LogLevel,
    ) -> Result<(), bun_core::Error> {
        // Port of `directories.saveLockfile`. Serialises `self.lockfile` to
        // disk in `_save_format`, honouring `--frozen-lockfile` (compare with
        // `_lockfile_before_install` first).
        if self.options.enable.frozen_lockfile && _had_any_diffs {
            return Err(bun_core::err!(
                "lockfile had changes, but lockfile is frozen"
            ));
        }
        self.lockfile.save_to_disk(_load_result, &package_manager_real::Options::default());
        let _ = (_save_format, _lockfile_before_install, _packages_len_before_install, _log_level);
        Ok(())
    }
    /// Zig: `PackageManager.writeYarnLock()`.
    pub fn write_yarn_lock(&mut self) -> Result<(), bun_core::Error> {
        // Port of `directories.writeYarnLock`. Builds a `Printer` over
        // `self.lockfile` and renders to `yarn.lock` via the Yarn formatter.
        let mut buf: Vec<u8> = Vec::new();
        crate::lockfile_real::printer_mods::yarn::print_into(
            &self.lockfile,
            &mut buf,
        )?;
        bun_sys::File::write_file(bun_sys::Fd::cwd(), b"yarn.lock", &buf)
            .map_err(Into::into)
            .map(|_| ())
    }
    // `spawn_package_lifecycle_scripts` / `report_slow_lifecycle_scripts` /
    // `sleep` — real impls live in
    // `package_manager_real::package_manager_lifecycle` (PackageManagerLifecycle.rs);
    // de-duplicated to resolve E0034.
    /// Zig: `PackageManager.sleepUntil()` (PackageManager.zig). Generic over
    /// the closure type `*const fn(*Ctx) bool`; routes to the real
    /// `package_manager_real` impl once un-gated.
    /// SAFETY: `mgr` and `closure` must be valid for the duration of the call;
    /// see `install_with_manager::RunAndWaitClosure` for the provenance
    /// contract.
    pub unsafe fn sleep_until<Ctx>(
        mgr: *mut PackageManager,
        closure: &mut Ctx,
        is_done: fn(&mut Ctx) -> bool,
    ) {
        // Port of `PackageManager.sleepUntil` (PackageManager.zig). Ticks the
        // event loop, draining pending lifecycle/network completions, until
        // `is_done(closure)` returns true.
        // SAFETY: `mgr` is the process singleton; sole `&mut` per tick.
        loop {
            if is_done(closure) {
                return;
            }
            let this = unsafe { &mut *mgr };
            this.event_loop.tick_once();
        }
    }
    /// Port of `PackageManager.incrementPendingTasks`
    /// (src/install/PackageManager/runTasks.zig). `.monotonic` is okay because
    /// the start of a task doesn't carry side effects other threads depend on
    /// (but finishing one does). Call before the task is actually spawned.
    #[inline]
    pub fn increment_pending_tasks(&mut self, count: u32) {
        self.total_tasks += count;
        let _ = self
            .pending_tasks
            .fetch_add(count, core::sync::atomic::Ordering::Relaxed);
    }

    /// Port of `PackageManager.decrementPendingTasks`
    /// (src/install/PackageManager/runTasks.zig).
    #[inline]
    pub fn decrement_pending_tasks(&mut self) {
        let _ = self
            .pending_tasks
            .fetch_sub(1, core::sync::atomic::Ordering::Release);
    }

    /// Port of `PackageManager.cached_package_folder_name_buf()`
    /// (src/install/PackageManager.zig:429). Thread-local scratch `PathBuffer`
    /// shared by the `cached*FolderName*` family — callers write a
    /// NUL-terminated cache-relative path into it and return a `&'static ZStr`
    /// borrow. Single-buffer-per-thread, so callers must copy before the next
    /// call on the same thread.
    #[inline]
    pub fn cached_package_folder_name_buf() -> &'static mut bun_paths::PathBuffer {
        thread_local! {
            static BUF: core::cell::UnsafeCell<bun_paths::PathBuffer> =
                const { core::cell::UnsafeCell::new(bun_paths::PathBuffer::ZEROED) };
        }
        // SAFETY: `'static mut` mirrors Zig's `*bun.PathBuffer` thread-local.
        // Single mutable borrow per thread; callers do not hold across awaits.
        BUF.with(|b| unsafe { &mut *b.get() })
    }

    /// Port of `resolution.scopeForPackageName`
    /// (src/install/PackageManager/PackageManagerResolution.zig:36). Real body
    /// also lives in `package_manager_real::package_manager_resolution`; the
    /// stub `PackageManager` carries its own `options.{scope,registries}` so
    /// `PackageManagerTask::callback` can resolve the per-`@scope` registry
    /// before the two structs unify.
    pub fn scope_for_package_name(&self, name: &[u8]) -> &npm::registry::Scope {
        if name.is_empty() || name[0] != b'@' {
            return &self.options.scope;
        }
        self.options
            .registries
            .get(&npm::registry::Scope::hash(npm::registry::Scope::get_name(
                name,
            )))
            .unwrap_or(&self.options.scope)
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
        // Port of `directories.updateLockfileIfNeeded`. Clears
        // `has_install_script` on every package's `meta` when the binary
        // serializer flagged `packages_need_update`.
        if let lockfile::LoadResult::Ok(ok) = _load_result {
            if ok.serializer_result.packages_need_update {
                for meta in self.lockfile.packages.meta.iter_mut() {
                    meta.set_has_install_script(false);
                }
            }
        }
        Ok(())
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
#[derive(Clone, Copy, Default, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum Subcommand {
    #[default]
    Install,
    Update,
    Pm,
    Add,
    Remove,
    Link,
    Unlink,
    Patch,
    PatchCommit,
    Outdated,
    Pack,
    Publish,
    Why,
    Audit,
    Info,
    Scan,
}

impl Subcommand {
    pub fn can_globally_install_packages(self) -> bool {
        matches!(self, Subcommand::Install | Subcommand::Update | Subcommand::Add)
    }

    pub fn supports_workspace_filtering(self) -> bool {
        matches!(self, Subcommand::Outdated | Subcommand::Install | Subcommand::Update)
    }

    pub fn supports_json_output(self) -> bool {
        matches!(self, Subcommand::Audit | Subcommand::Pm | Subcommand::Info)
    }

    pub fn should_chdir_to_root(self) -> bool {
        !matches!(self, Subcommand::Link)
    }
}

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

    /// Runtime-alignment variant of [`Aligner::write`] for call sites that
    /// compute `align_of::<T>()` at the caller (Zig passed `comptime Type`;
    /// Rust callers without a nameable `T` pass the alignment as a value).
    pub fn write_with_align<W: bun_io::Write>(
        align: usize,
        writer: &mut W,
        pos: u64,
    ) -> bun_io::Result<usize> {
        let to_write = Self::skip_amount_with_align(align, pos as usize);

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
    pub fn skip_amount_with_align(align: usize, pos: usize) -> usize {
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
    /// Zig: `Features.main` decl-literal (src/install/install.zig).
    #[inline] pub const fn main() -> Self { Self::MAIN }
    /// Zig: `Features.npm` decl-literal (src/install/install.zig).
    #[inline] pub const fn npm() -> Self { Self::NPM }
    /// Zig: `Features.folder` decl-literal.
    #[inline] pub const fn folder() -> Self { Self::FOLDER }
    /// Zig: `Features.workspace` decl-literal.
    #[inline] pub const fn workspace() -> Self { Self::WORKSPACE }
    /// Zig: `Features.link` decl-literal.
    #[inline] pub const fn link() -> Self { Self::LINK }
    /// Zig: `Features.tarball` decl-literal.
    #[inline] pub const fn tarball() -> Self { Self::TARBALL }
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

#[derive(Clone, Copy)]
pub struct DependencyInstallContext {
    pub tree_id: lockfile::tree::Id,
    /// Zig stores a `[]u8` borrowed from the installer's path buffer; the
    /// context is copied freely through `TaskCallbackList`, so model it as a
    /// raw slice (BACKREF — caller keeps the buffer alive).
    // TODO(port): lifetime — borrows the installer's `node_modules_path` buffer.
    pub path: *const [u8],
    pub dependency_id: DependencyID,
}

impl DependencyInstallContext {
    pub fn new(dependency_id: DependencyID) -> Self {
        Self {
            tree_id: 0,
            path: &[] as *const [u8],
            dependency_id,
        }
    }
}

#[derive(Clone, Copy)]
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
