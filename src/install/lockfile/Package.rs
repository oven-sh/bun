use bun_collections::VecExt;
use core::mem;

use bun_collections::{ArrayHashMap, ArrayIdentityContext, MultiArrayList, StringSet};
use bun_core::strings;
use bun_core::{Global, Output};
use bun_paths::{self as path, AutoAbsPath, MAX_PATH_BYTES, PathBuffer, resolve_path};
use bun_resolver::fs::FileSystem;
use bun_semver::semver_query::Wildcard;
use bun_semver::version::VersionInt;
use bun_semver::{self as semver, ExternalString, String, Version as SemverVersion};
use bun_sys::File;

use crate::bun_json::{Expr, ExprData};
use crate::dependency::{Behavior, DependencyExt as _, TagExt as _};
use crate::repository::RepositoryExt as _;
use crate::{
    self as install, Aligner, Bin, Dependency, ExternalStringList, ExternalStringMap, Features,
    Npm, PackageID, PackageJSON, PackageManager, PackageNameHash, Repository,
    TruncatedPackageNameHash, UpdateRequest, bin, bun_json, default_trusted_dependencies,
    dependency, initialize_store, invalid_package_id,
};
// `Package.rs` is mounted as `crate::lockfile_real::package`; the parent module
// (`super`) is the real `lockfile.rs`, distinct from the `crate::lockfile`
// stub that lib.rs exposes for downstream crates during the staged port.
// PORT NOTE: bare `use super as lockfile;` fails when this file is reached via
// `#[path]` from a non-module context (rust-lang/rust#48067). Name the parent
// module by its absolute crate path instead.
use crate::lockfile_real as lockfile;
use crate::lockfile_real::{
    Cloner, DependencySlice, Lockfile, PackageIDSlice, PatchedDep, PendingResolution,
    PositionalStream, Stream, StringBuilder, TrustedDependenciesSet,
    assert_no_uninitialized_padding,
};
use crate::resolution_real::{ResolutionType, Tag as ResolutionTag, TaggedValue};
use crate::versioned_url::VersionedURLType;

#[path = "Package/Meta.rs"]
pub mod meta;
#[path = "Package/Scripts.rs"]
pub mod scripts;
#[path = "Package/WorkspaceMap.rs"]
pub mod workspace_map;

pub use meta::Meta;
pub use scripts::Scripts;
#[allow(non_snake_case)]
pub use workspace_map as WorkspaceMap;

bun_output::declare_scope!(Lockfile, hidden);

trait ExprStr {
    fn as_utf8<'b>(&self, bump: &'b bun_alloc::Arena) -> Option<&'b [u8]>;
}
impl ExprStr for Expr {
    // Zig `Expr.asString` (expr.zig:477) — transparently transcodes UTF-16
    // `EString`s. The earlier `is_utf8()` guard returned `None` for keys the
    // lexer stored as UTF-16 (e.g. `\u`-escaped non-ASCII), tripping the
    // `expect("unreachable")` callers below.
    #[inline]
    fn as_utf8<'b>(&self, bump: &'b bun_alloc::Arena) -> Option<&'b [u8]> {
        if let ExprData::EString(s) = &self.data {
            return Some(s.string(bump).expect("OOM"));
        }
        None
    }
}

// Zig: `pub fn Package(comptime SemverIntType: type) type { return extern struct { ... } }`
// Defaulted to `u64` so bare `Package` matches Zig's primary `Package(u64)`
// instantiation (the only one the lockfile/PM call sites name unqualified).
//
// PORT NOTE: `` cannot be used here — the derive
// emits a `PackageField` enum with snake_case variants and an inherent
// `__MAL_SIZES` const that fail to const-eval through the defaulted
// `SemverIntType` param. The trait impl, field enum, and `PackageColumns` /
// `PackageColumns` accessor traits are therefore expanded by hand below
// (mirroring Zig's `MultiArrayList(Package).items(.field)`).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Package<SemverIntType: VersionInt = u64> {
    pub name: String,
    pub name_hash: PackageNameHash,

    /// How this package has been resolved
    /// When .tag is uninitialized, that means the package is not resolved yet.
    pub resolution: ResolutionType<SemverIntType>,

    /// dependencies & resolutions must be the same length
    /// resolutions[i] is the resolved package ID for dependencies[i]
    /// if resolutions[i] is an invalid package ID, then dependencies[i] is not resolved
    pub dependencies: DependencySlice,

    /// The resolved package IDs for this package's dependencies. Instead of storing this
    /// on the `Dependency` struct within `.dependencies`, it is stored on the package itself
    /// so we can access it faster.
    ///
    /// Each index in this array corresponds to the same index in dependencies.
    /// Each value in this array corresponds to the resolved package ID for that dependency.
    ///
    /// So this is how you say "what package ID for lodash does this package actually resolve to?"
    ///
    /// By default, the underlying buffer is filled with "invalid_id" to indicate this package ID
    /// was not resolved
    pub resolutions: PackageIDSlice,

    pub meta: Meta,
    pub bin: Bin,

    /// If any of these scripts run, they will run in order:
    /// 1. preinstall
    /// 2. install
    /// 3. postinstall
    /// 4. preprepare
    /// 5. prepare
    /// 6. postprepare
    pub scripts: Scripts,
}

type Resolution<SemverIntType> = ResolutionType<SemverIntType>;

// ─── ResolverContext ─────────────────────────────────────────────────────────
//
// Zig used `comptime ResolverContext: type` for `parse`/`parseWithJSON` and
// branched on `ResolverContext == void` / `== PackageManager.GitResolver` at
// comptime. Rust models this as a trait with associated consts; concrete
// resolvers (folder/cache/git) override what they need. The `()` impl gives
// the `void` semantics.
pub trait ResolverContext {
    /// Zig: `comptime ResolverContext == void`.
    const IS_VOID: bool = false;
    /// Zig: `comptime ResolverContext == PackageManager.GitResolver`.
    const IS_GIT_RESOLVER: bool = false;

    /// Zig: `ResolverContext.checkBundledDependencies()`.
    fn check_bundled_dependencies() -> bool {
        false
    }

    /// Zig: `resolver.count(builder, json)` — counts strings to be appended by
    /// `resolve`. Default no-op for void/folder resolvers that don't need it.
    fn count(&mut self, _builder: &mut StringBuilder<'_>, _json: &Expr) {}

    /// Zig: `resolver.resolve(builder, json)` — produces the package's
    /// `Resolution`. Only called when `!IS_VOID`.
    ///
    /// No default body: Zig enforced this at comptime (a non-void resolver
    /// without `resolve` failed to compile). Each concrete resolver supplies
    /// its own body; `()` returns the zero-value `Resolution` to mirror Zig's
    /// "void leaves `package.resolution` uninitialized" path.
    ///
    /// Zig threaded `comptime IntType` through `parseWithJSON`, but the only
    /// instantiation is `u64` (`Package.resolution: ResolutionType<u64>`), so
    /// the trait method is monomorphic — keeps `CacheFolderResolver::resolve`
    /// free of an identity `transmute`.
    fn resolve(
        &mut self,
        builder: &mut StringBuilder<'_>,
        json: &Expr,
    ) -> Result<ResolutionType<u64>, bun_core::Error>;

    // ── GitResolver-only surface ────────────────────────────────────────────
    // Zig accessed `resolver.resolved`, `resolver.new_name`, `resolver.dep_id`
    // directly when `ResolverContext == GitResolver`. Trait methods so non-git
    // resolvers don't need the fields; default impls are dead code (gated on
    // `IS_GIT_RESOLVER`). The bodies here are never executed — calls are
    // statically guarded by `if R::IS_GIT_RESOLVER` — so a debug assertion
    // documents the invariant without panicking in release.
    fn resolution(&self) -> &ResolutionType<u64> {
        debug_assert!(
            false,
            "ResolverContext::resolution called on non-git resolver"
        );
        // SAFETY: unreachable in practice; never dereferenced when the
        // `IS_GIT_RESOLVER` gate is false. `ZEROED` is an associated const on a
        // trait-bounded generic impl, which Rust refuses to evaluate in `const`
        // position; a `static` (with `Sync` POD payload) sidesteps that.
        static EMPTY: ResolutionType<u64> = ResolutionType::<u64>::ZEROED;
        &EMPTY
    }
    fn dep_id(&self) -> install::DependencyID {
        debug_assert!(false, "ResolverContext::dep_id called on non-git resolver");
        0
    }
    fn new_name(&self) -> &[u8] {
        b""
    }
    fn set_new_name(&mut self, _name: Vec<u8>) {}
    fn take_new_name(&mut self) -> Vec<u8> {
        Vec::new()
    }
}

impl ResolverContext for () {
    const IS_VOID: bool = true;

    fn resolve(
        &mut self,
        _builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> Result<ResolutionType<u64>, bun_core::Error> {
        // Zig: `if (comptime ResolverContext != void) { … }` — the void
        // resolver never assigned `package.resolution`, so it kept its
        // zero-initialized value. The call site still gates on `!IS_VOID`,
        // but provide the equivalent behavior for trait completeness.
        Ok(ResolutionType::default())
    }
}

// ─── ResolverContextDyn ──────────────────────────────────────────────────────
//
// Object-safe projection of `ResolverContext` so the ~960-line body of
// `parse_with_json` is compiled exactly once instead of being re-stamped per
// `R` (six instantiations × ~49kB ≈ 292kB of identical machine code, plus a
// duplicate `<()>` copy across CGUs). The associated consts become `&self`
// predicates; everything else forwards 1:1. The generic `parse_with_json<R>`
// stays as a thin shim that erases `&mut R` → `&mut dyn ResolverContextDyn`
// and delegates to the non-generic `parse_with_json_impl`.
//
// `count`/`resolve` keep their `StringBuilder<'_>` borrow — lifetimes are
// permitted on object-safe trait methods, only type generics are not.
pub trait ResolverContextDyn {
    fn is_void(&self) -> bool;
    fn is_git(&self) -> bool;
    fn check_bundled_dependencies(&self) -> bool;

    fn count(&mut self, builder: &mut StringBuilder<'_>, json: &Expr);
    fn resolve(
        &mut self,
        builder: &mut StringBuilder<'_>,
        json: &Expr,
    ) -> Result<ResolutionType<u64>, bun_core::Error>;

    fn resolution(&self) -> &ResolutionType<u64>;
    fn dep_id(&self) -> install::DependencyID;
    fn new_name(&self) -> &[u8];
    fn set_new_name(&mut self, name: Vec<u8>);
    fn take_new_name(&mut self) -> Vec<u8>;
}

impl<R: ResolverContext> ResolverContextDyn for R {
    #[inline]
    fn is_void(&self) -> bool {
        R::IS_VOID
    }
    #[inline]
    fn is_git(&self) -> bool {
        R::IS_GIT_RESOLVER
    }
    #[inline]
    fn check_bundled_dependencies(&self) -> bool {
        R::check_bundled_dependencies()
    }

    #[inline]
    fn count(&mut self, builder: &mut StringBuilder<'_>, json: &Expr) {
        ResolverContext::count(self, builder, json)
    }
    #[inline]
    fn resolve(
        &mut self,
        builder: &mut StringBuilder<'_>,
        json: &Expr,
    ) -> Result<ResolutionType<u64>, bun_core::Error> {
        ResolverContext::resolve(self, builder, json)
    }

    #[inline]
    fn resolution(&self) -> &ResolutionType<u64> {
        ResolverContext::resolution(self)
    }
    #[inline]
    fn dep_id(&self) -> install::DependencyID {
        ResolverContext::dep_id(self)
    }
    #[inline]
    fn new_name(&self) -> &[u8] {
        ResolverContext::new_name(self)
    }
    #[inline]
    fn set_new_name(&mut self, name: Vec<u8>) {
        ResolverContext::set_new_name(self, name)
    }
    #[inline]
    fn take_new_name(&mut self) -> Vec<u8> {
        ResolverContext::take_new_name(self)
    }
}

/// Comparator for the post-build dependency sort. Hoisted out of
/// `parse_with_json_impl` so `<[Dependency]>::sort_by` is instantiated once
/// (the closure it wraps is zero-capture modulo `buf`, and the impl fn is
/// itself non-generic, so the 6.5kB pdqsort + 2.2kB drift is emitted exactly
/// once instead of per-`R`).
#[inline]
fn dep_sort_cmp(buf: &[u8], a: &Dependency, b: &Dependency) -> core::cmp::Ordering {
    // Zig used `std.sort.pdq` with a `<` predicate. `slice::sort_by` requires
    // a total order (and panics since 1.81 when violated), so derive
    // `Ordering::Equal` from the predicate symmetrically.
    if Dependency::is_less_than(buf, a, b) {
        core::cmp::Ordering::Less
    } else if Dependency::is_less_than(buf, b, a) {
        core::cmp::Ordering::Greater
    } else {
        core::cmp::Ordering::Equal
    }
}

/// Field tags for the binary lockfile serializer (`bun.lockb`). The
/// reflection-backed `MultiArrayList` no longer needs an enum, but the
/// serializer iterates fields by tag to write column blobs in a fixed order.
#[repr(usize)]
#[derive(Copy, Clone)]
pub enum PackageField {
    Name = 0,
    NameHash = 1,
    Resolution = 2,
    Dependencies = 3,
    Resolutions = 4,
    Meta = 5,
    Bin = 6,
    Scripts = 7,
}

impl PackageField {
    pub const ALL: [PackageField; 8] = [
        PackageField::Name,
        PackageField::NameHash,
        PackageField::Resolution,
        PackageField::Dependencies,
        PackageField::Resolutions,
        PackageField::Meta,
        PackageField::Bin,
        PackageField::Scripts,
    ];

    pub fn name(self) -> &'static [u8] {
        match self {
            PackageField::Name => b"name",
            PackageField::NameHash => b"name_hash",
            PackageField::Resolution => b"resolution",
            PackageField::Dependencies => b"dependencies",
            PackageField::Resolutions => b"resolutions",
            PackageField::Meta => b"meta",
            PackageField::Bin => b"bin",
            PackageField::Scripts => b"scripts",
        }
    }
}

bun_collections::multi_array_columns! {
    pub trait PackageColumns [SemverIntType: VersionInt] for Package<SemverIntType> {
        name: String,
        name_hash: PackageNameHash,
        resolution: ResolutionType<SemverIntType>,
        dependencies: DependencySlice,
        resolutions: PackageIDSlice,
        meta: Meta,
        bin: Bin,
        scripts: Scripts,
    }
}

impl<SemverIntType: VersionInt> Default for Package<SemverIntType> {
    fn default() -> Self {
        Self {
            name: String::default(),
            name_hash: 0,
            resolution: Resolution::<SemverIntType>::default(),
            dependencies: DependencySlice::default(),
            resolutions: PackageIDSlice::default(),
            meta: Meta::init(),
            bin: Bin::default(),
            scripts: Scripts::default(),
        }
    }
}

pub use bun_install_types::DependencyGroup;

// Borrows into lockfile.packages SoA columns + string_bytes; `RawSlice`
// carries the outlives-holder invariant (the lockfile outlives every sort
// pass that constructs an Alphabetizer).
pub struct Alphabetizer<SemverIntType: VersionInt> {
    pub names: bun_ptr::RawSlice<String>,
    pub buf: bun_ptr::RawSlice<u8>,
    pub resolutions: bun_ptr::RawSlice<Resolution<SemverIntType>>,
}

impl<SemverIntType: VersionInt> Alphabetizer<SemverIntType> {
    pub fn order(&self, lhs: PackageID, rhs: PackageID) -> core::cmp::Ordering {
        let (names, buf, resolutions) = (
            self.names.slice(),
            self.buf.slice(),
            self.resolutions.slice(),
        );
        names[lhs as usize]
            .order(&names[rhs as usize], buf, buf)
            .then_with(|| resolutions[lhs as usize].order(&resolutions[rhs as usize], buf, buf))
    }

    pub fn is_alphabetical(&self, lhs: PackageID, rhs: PackageID) -> bool {
        self.order(lhs, rhs) == core::cmp::Ordering::Less
    }
}

impl<SemverIntType: VersionInt> Package<SemverIntType> {
    #[inline]
    pub fn is_disabled(&self, cpu: Npm::Architecture, os: Npm::OperatingSystem) -> bool {
        self.meta.is_disabled(cpu, os)
    }
}

// PORT NOTE: `clone` / `from_package_json` / `from_npm` / `parse*` all interact
// with `Lockfile`, whose package list is concretely `MultiArrayList<Package<u64>>`.
// Zig's `Package(SemverIntType)` is only ever instantiated at `u64` for these
// paths (the `u32` instantiation is migration-only and routed through
// `Serializer::load`). Binding the impl to `u64` avoids spurious
// `Package<SemverIntType>` ≠ `Package<u64>` mismatches at every Lockfile call
// site.
impl Package<u64> {
    pub fn clone(&self, cloner: &mut Cloner) -> Result<PackageID, bun_core::Error> {
        // TODO(port): narrow error set
        // PORT NOTE: Zig passes (`pm`, `old`, `new`, `package_id_mapping`,
        // `cloner`) separately, but `cloner` already owns `&mut` to all four.
        // Rust borrowck rejects the redundant aliasing at the call site, so
        // route everything through `cloner`'s disjoint fields here instead.
        // `old`/`new`/`mapping` are reborrowed for the whole body (disjoint
        // from `cloner.clone_queue` / `.trees_count` / `.old_preinstall_state`);
        // `manager` is accessed via `cloner.manager` at each use so the borrow
        // doesn't span the `cloner.*` accesses below.
        let old = &mut *cloner.old;
        let new = &mut *cloner.lockfile;
        let package_id_mapping = &mut *cloner.mapping;
        let old_string_buf = old.buffers.string_bytes.as_slice();
        let old_extern_string_buf = old.buffers.extern_strings.as_slice();
        // PORT NOTE: `string_builder!` split-borrows only `new.buffers
        // .string_bytes` + `new.string_pool`, leaving sibling buffer fields
        // (`dependencies`, `resolutions`, `extern_strings`, `packages`) free
        // for the disjoint borrows below.
        let mut builder_ = crate::string_builder!(new);
        let builder = &mut builder_;
        bun_output::scoped_log!(
            Lockfile,
            "Clone: {}@{} ({:?}, {} dependencies)",
            bstr::BStr::new(self.name.slice(old_string_buf)),
            self.resolution
                .fmt(old_string_buf, bun_core::fmt::PathSep::Auto),
            self.resolution.tag,
            self.dependencies.len,
        );

        builder.count(self.name.slice(old_string_buf));
        self.resolution.count(old_string_buf, &mut *builder);
        self.meta.count(old_string_buf, &mut *builder);
        self.scripts.count(old_string_buf, &mut *builder);
        for patched_dep in old.patched_dependencies.values() {
            builder.count(patched_dep.path.slice(old.buffers.string_bytes.as_slice()));
        }
        let new_extern_string_count =
            self.bin
                .count(old_string_buf, old_extern_string_buf, &mut *builder) as usize;
        let old_dependencies: &[Dependency] =
            self.dependencies.get(old.buffers.dependencies.as_slice());
        let old_resolutions: &[PackageID] =
            self.resolutions.get(old.buffers.resolutions.as_slice());

        for dependency in old_dependencies {
            dependency.count(old_string_buf, &mut *builder);
        }

        builder.allocate()?;

        // should be unnecessary, but Just In Case
        new.buffers.dependencies.reserve(old_dependencies.len());
        new.buffers.resolutions.reserve(old_dependencies.len());
        new.buffers.extern_strings.reserve(new_extern_string_count);

        let prev_len = new.buffers.dependencies.len() as u32;
        let end = prev_len + (old_dependencies.len() as u32);
        let max_package_id = old.packages.len() as PackageID;

        // Grow both buffers by `old_dependencies.len()`, default-filling the
        // new tail. The zip-loops further below overwrite each slot with the
        // real cloned value; pre-filling avoids ever forming `&mut T` over
        // uninitialized storage (the old `set_len`-then-assign dropped uninit).
        bun_core::vec::extend_from_fn(
            &mut new.buffers.dependencies,
            old_dependencies.len(),
            |_| Dependency::default(),
        );
        bun_core::vec::extend_from_fn(&mut new.buffers.resolutions, old_dependencies.len(), |_| {
            invalid_package_id
        });
        debug_assert_eq!(new.buffers.dependencies.len(), end as usize);
        debug_assert_eq!(new.buffers.resolutions.len(), end as usize);

        let extern_strings_old_len = new.buffers.extern_strings.len();
        // Default-fill the tail so it is valid before `bin.clone` overwrites
        // it (replaces `reserve` + raw `set_len`).
        bun_core::vec::grow_default(&mut new.buffers.extern_strings, new_extern_string_count);
        // PORT NOTE: Zig passes both `new.buffers.extern_strings.items` (full slice) and a
        // tail subslice into `bin.clone`; the full slice is only used to compute the tail's
        // offset for `ExternalStringList::init`. In Rust those two views would alias, so
        // `Bin::clone_with_buffers` takes the precomputed offset directly.
        let new_extern_strings_start = new.buffers.extern_strings.len() - new_extern_string_count;

        let id = new.packages.len() as PackageID;

        // PORT NOTE: Zig calls `appendPackageWithID` mid-body while still
        // holding live slices into `new.buffers` and the `builder`. Rust can't
        // express that (the method borrows `&mut Lockfile` whole), so build the
        // `Package` value and clone the dependency strings *first* (only needs
        // disjoint buffer fields), drop the builder, then append, then write
        // resolutions. `appendPackageWithID` touches `packages` /
        // `package_index` / `string_bytes` only — none of which the dependency
        // pass mutates — so the reorder is observationally identical.
        let pkg_value = Package {
            name: builder
                .append_with_hash::<String>(self.name.slice(old_string_buf), self.name_hash),
            bin: self.bin.clone_with_buffers(
                old_string_buf,
                old_extern_string_buf,
                new_extern_strings_start as u32,
                &mut new.buffers.extern_strings[new_extern_strings_start..],
                &mut *builder,
            ),
            name_hash: self.name_hash,
            meta: Meta::clone_into(&self.meta, id, old_string_buf, &mut *builder),
            resolution: self.resolution.clone_into(old_string_buf, &mut *builder),
            scripts: self.scripts.clone_into(old_string_buf, &mut *builder),
            dependencies: DependencySlice::new(prev_len, end - prev_len),
            resolutions: PackageIDSlice::new(prev_len, end - prev_len),
        };

        {
            let dependencies: &mut [Dependency] =
                &mut new.buffers.dependencies[prev_len as usize..end as usize];
            debug_assert_eq!(old_dependencies.len(), dependencies.len());
            for (old_dep, new_dep) in old_dependencies.iter().zip(dependencies.iter_mut()) {
                *new_dep = old_dep.clone_in(cloner.manager, old_string_buf, &mut *builder)?;
            }
        }

        builder.clamp();
        drop(builder_); // release `&mut new.buffers.string_bytes` / `string_pool`

        let new_package = new.append_package_with_id(pkg_value, id)?;

        package_id_mapping[self.meta.id as usize] = new_package.meta.id;

        if cloner.manager.preinstall_state.len() > 0 {
            cloner.manager.preinstall_state[new_package.meta.id as usize] =
                cloner.old_preinstall_state[self.meta.id as usize];
        }

        cloner.trees_count += (old_resolutions.len() > 0) as u32;

        let resolutions: &mut [PackageID] =
            &mut new.buffers.resolutions[prev_len as usize..end as usize];
        debug_assert_eq!(old_resolutions.len(), resolutions.len());
        for (i, (old_resolution, resolution)) in old_resolutions
            .iter()
            .zip(resolutions.iter_mut())
            .enumerate()
        {
            if *old_resolution >= max_package_id {
                *resolution = invalid_package_id;
                continue;
            }

            let mapped = package_id_mapping[*old_resolution as usize];
            if mapped < max_package_id {
                *resolution = mapped;
            } else {
                cloner.clone_queue.push(PendingResolution {
                    old_resolution: *old_resolution,
                    parent: new_package.meta.id,
                    resolve_id: new_package.resolutions.off
                        + PackageID::try_from(i).expect("int cast"),
                });
            }
        }

        Ok(new_package.meta.id)
    }

    pub fn from_package_json(
        lockfile: &mut Lockfile,
        pm: &mut PackageManager,
        package_json: &mut PackageJSON,
        features: Features,
    ) -> Result<Self, bun_core::Error> {
        #[allow(non_snake_case)]
        let FEATURES = features;
        // TODO(port): narrow error set
        let mut package = Self::default();

        // var string_buf = package_json;

        // PORT NOTE: split-borrow `string_bytes`/`string_pool` so the disjoint
        // `lockfile.buffers.dependencies/resolutions` borrows below pass.
        let mut string_builder = crate::string_builder!(lockfile);

        let mut total_dependencies_count: u32 = 0;
        // var bin_extern_strings_count: u32 = 0;

        // --- Counting
        {
            string_builder.count(&package_json.name);
            string_builder.count(&package_json.version);
            let dependencies = package_json.dependencies.map.values();
            for dep in dependencies {
                if dep.behavior.is_enabled(FEATURES) {
                    dep.count(package_json.dependencies.source_buf, &mut string_builder);
                    total_dependencies_count += 1;
                }
            }
        }

        // string_builder.count(manifest.str(&package_version_ptr.tarball_url));

        string_builder.allocate()?;
        // defer string_builder.clamp(); — handled at end of scope below
        // var extern_strings_list = &lockfile.buffers.extern_strings;
        let dependencies_list = &mut lockfile.buffers.dependencies;
        let resolutions_list = &mut lockfile.buffers.resolutions;
        dependencies_list.reserve(total_dependencies_count as usize);
        resolutions_list.reserve(total_dependencies_count as usize);
        // try extern_strings_list.ensureUnusedCapacity(lockfile.allocator, bin_extern_strings_count);
        // extern_strings_list.items.len += bin_extern_strings_count;

        // -- Cloning
        {
            let package_name: ExternalString =
                string_builder.append::<ExternalString>(&package_json.name);
            package.name_hash = package_name.hash;
            package.name = package_name.value;

            package.resolution = Resolution::<u64>::init(TaggedValue::Root);

            let total_len = dependencies_list.len() + total_dependencies_count as usize;
            if cfg!(debug_assertions) {
                debug_assert!(dependencies_list.len() == resolutions_list.len());
            }

            let dep_start = dependencies_list.len();
            // Zig: `@memset(items.ptr[len..total_len], .{})` then bump `.items.len`.
            bun_core::vec::extend_from_fn(
                dependencies_list,
                total_dependencies_count as usize,
                |_| Dependency::default(),
            );
            debug_assert_eq!(dependencies_list.len(), total_len);
            let mut dependencies: &mut [Dependency] = &mut dependencies_list[dep_start..total_len];

            let package_dependencies = package_json.dependencies.map.values();
            let source_buf = package_json.dependencies.source_buf;
            for dep in package_dependencies {
                if !dep.behavior.is_enabled(FEATURES) {
                    continue;
                }

                dependencies[0] = dep.clone_in(pm, source_buf, &mut string_builder)?;
                dependencies = &mut dependencies[1..];
                if dependencies.is_empty() {
                    break;
                }
            }

            // We lose the bin info here
            // package.bin = package_version.bin.clone(string_buf, manifest.extern_strings_bin_entries, extern_strings_list.items, extern_strings_slice, @TypeOf(&string_builder), &string_builder);
            // and the integriy hash
            // package.meta.integrity = package_version.integrity;

            package.meta.arch = package_json.arch;
            package.meta.os = package_json.os;

            package.dependencies.off = dep_start as u32;
            package.dependencies.len = total_dependencies_count - (dependencies.len() as u32);
            package.resolutions.off = package.dependencies.off;
            package.resolutions.len = package.dependencies.len;

            let new_length = package.dependencies.len as usize + dep_start;

            debug_assert_eq!(resolutions_list.len(), dep_start);
            bun_core::vec::extend_from_fn(
                resolutions_list,
                package.dependencies.len as usize,
                |_| invalid_package_id,
            );
            debug_assert_eq!(resolutions_list.len(), new_length);

            // Shrink off the unused default-initialized tail (`new_length <= total_len`).
            dependencies_list.truncate(new_length);

            string_builder.clamp();
            return Ok(package);
        }
    }

    pub fn from_npm(
        pm: &mut PackageManager,
        lockfile: &mut Lockfile,
        log: &mut bun_ast::Log,
        manifest: &Npm::PackageManifest,
        version: SemverVersion,
        package_version_ptr: &Npm::PackageVersion,
        features: Features,
    ) -> Result<Self, bun_core::Error> {
        #[allow(non_snake_case)]
        let FEATURES = features;
        // TODO(port): narrow error set
        let mut package = Self::default();

        let package_version = *package_version_ptr;

        // PERF(port): was comptime-computed array — profile in Phase B
        let dependency_groups: &[DependencyGroup] = &{
            let mut out: Vec<DependencyGroup> = Vec::with_capacity(4);
            if FEATURES.dependencies {
                out.push(DependencyGroup::DEPENDENCIES);
            }
            if FEATURES.dev_dependencies {
                out.push(DependencyGroup::DEV);
            }
            if FEATURES.optional_dependencies {
                out.push(DependencyGroup::OPTIONAL);
            }
            if FEATURES.peer_dependencies {
                out.push(DependencyGroup::PEER);
            }
            out
        };

        // PORT NOTE: split-borrow so `lockfile.buffers.dependencies/resolutions
        // /extern_strings` below are disjoint from the builder's `string_bytes`.
        let mut string_builder = crate::string_builder!(lockfile);

        let mut total_dependencies_count: u32 = 0;
        let mut bin_extern_strings_count: u32 = 0;

        // --- Counting
        {
            string_builder.count(manifest.name());
            version.count(&manifest.string_buf, &mut string_builder);

            // PERF(port): was `inline for` — profile in Phase B
            for group in dependency_groups {
                // Zig uses `@field(package_version, group.field)` reflection;
                // ported as `PackageVersion::dep_group(field) -> ExternalStringMap`.
                let map: ExternalStringMap = package_version.dep_group(group.field);
                let keys = map.name.get(&manifest.external_strings);
                let version_strings = map.value.get(&manifest.external_strings_for_versions);
                total_dependencies_count += map.value.len;

                if cfg!(debug_assertions) {
                    debug_assert!(keys.len() == version_strings.len());
                }

                debug_assert_eq!(keys.len(), version_strings.len());
                for (key, ver) in keys.iter().zip(version_strings.iter()) {
                    string_builder.count(key.slice(&manifest.string_buf));
                    string_builder.count(ver.slice(&manifest.string_buf));
                }
            }

            bin_extern_strings_count = package_version.bin.count(
                &manifest.string_buf,
                &manifest.extern_strings_bin_entries,
                &mut string_builder,
            );
        }

        string_builder.count(manifest.str(&package_version_ptr.tarball_url));

        string_builder.allocate()?;
        // defer string_builder.clamp(); — handled at end of scope
        let extern_strings_list = &mut lockfile.buffers.extern_strings;
        let dependencies_list = &mut lockfile.buffers.dependencies;
        let resolutions_list = &mut lockfile.buffers.resolutions;
        dependencies_list.reserve(total_dependencies_count as usize);
        resolutions_list.reserve(total_dependencies_count as usize);
        let extern_old_len = extern_strings_list.len();
        // Default-fill the tail so it is valid before `bin.clone` overwrites
        // it (replaces `reserve` + raw `set_len`).
        let extern_strings_slice =
            bun_core::vec::grow_default(extern_strings_list, bin_extern_strings_count as usize);

        // -- Cloning
        {
            let package_name: ExternalString = string_builder
                .append_with_hash::<ExternalString>(manifest.name(), manifest.pkg.name.hash);
            package.name_hash = package_name.hash;
            package.name = package_name.value;
            package.resolution =
                Resolution::<u64>::init(TaggedValue::Npm(VersionedURLType::<u64> {
                    version: version.append(&manifest.string_buf, &mut string_builder),
                    url: string_builder
                        .append::<String>(manifest.str(&package_version_ptr.tarball_url)),
                }));

            let total_len = dependencies_list.len() + total_dependencies_count as usize;
            if cfg!(debug_assertions) {
                debug_assert!(dependencies_list.len() == resolutions_list.len());
            }

            let dep_start = dependencies_list.len();
            // Zig: `@memset(items.ptr[len..total_len], .{})` then bump `.items.len`.
            bun_core::vec::extend_from_fn(
                dependencies_list,
                total_dependencies_count as usize,
                |_| Dependency::default(),
            );
            debug_assert_eq!(dependencies_list.len(), total_len);
            let dependencies = &mut dependencies_list[dep_start..total_len];

            total_dependencies_count = 0;
            // PERF(port): was `inline for` — profile in Phase B
            for group in dependency_groups {
                // TODO(port): @field reflection — see note above
                let map: ExternalStringMap = package_version.dep_group(group.field);
                let keys = map.name.get(&manifest.external_strings);
                let version_strings = map.value.get(&manifest.external_strings_for_versions);

                if cfg!(debug_assertions) {
                    debug_assert!(keys.len() == version_strings.len());
                }
                let is_peer = group.field == b"peer_dependencies";

                debug_assert_eq!(keys.len(), version_strings.len());
                'list: for (i, (key, version_string_)) in
                    keys.iter().zip(version_strings.iter()).enumerate()
                {
                    // Duplicate peer & dev dependencies are promoted to whichever appeared first
                    // In practice, npm validates this so it shouldn't happen
                    let mut duplicate_at: Option<usize> = None;
                    if group.behavior.is_peer()
                        || group.behavior.is_dev()
                        || group.behavior.is_optional()
                    {
                        for (j, dependency) in dependencies[0..total_dependencies_count as usize]
                            .iter()
                            .enumerate()
                        {
                            if dependency.name_hash == key.hash {
                                if group.behavior.is_optional() {
                                    duplicate_at = Some(j);
                                    break;
                                }

                                continue 'list;
                            }
                        }
                    }

                    let name: ExternalString = string_builder.append_with_hash::<ExternalString>(
                        key.slice(&manifest.string_buf),
                        key.hash,
                    );
                    let dep_version = string_builder.append_with_hash::<String>(
                        version_string_.slice(&manifest.string_buf),
                        version_string_.hash,
                    );
                    // `string_builder` holds the `&mut string_bytes` borrow; read
                    // through it instead of `lockfile.buffers.string_bytes`.
                    let sliced = dep_version.sliced(string_builder.string_bytes.as_slice());

                    let mut behavior = group.behavior;
                    if is_peer {
                        behavior.set(
                            Behavior::OPTIONAL,
                            (i as u32) < package_version.non_optional_peer_dependencies_start,
                        );
                    }
                    if package_version_ptr.all_dependencies_bundled() {
                        behavior.insert(Behavior::BUNDLED);
                    } else {
                        for bundled_dep_name_hash in package_version
                            .bundled_dependencies
                            .get(&manifest.bundled_deps_buf)
                        {
                            if *bundled_dep_name_hash == name.hash {
                                behavior.insert(Behavior::BUNDLED);
                                break;
                            }
                        }
                    }

                    let dependency = Dependency {
                        name: name.value,
                        name_hash: name.hash,
                        behavior,
                        version: Dependency::parse(
                            name.value,
                            Some(name.hash),
                            sliced.slice,
                            &sliced,
                            Some(&mut *log),
                            Some(&mut *pm),
                        )
                        .unwrap_or_default(),
                    };

                    // If a dependency appears in both "dependencies" and "optionalDependencies", it is considered optional!
                    if group.behavior.is_optional() {
                        if let Some(j) = duplicate_at {
                            // need to shift dependencies after the duplicate to maintain sort order
                            // (in-place left-rotate by 1 over `[j .. total_dependencies_count)`)
                            dependencies[j..total_dependencies_count as usize].rotate_left(1);

                            // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies
                            // > Entries in optionalDependencies will override entries of the same name in dependencies, so it's usually best to only put in one place.
                            dependencies[total_dependencies_count as usize - 1] = dependency;
                            continue 'list;
                        }
                    }

                    dependencies[total_dependencies_count as usize] = dependency;
                    total_dependencies_count += 1;
                }
            }

            package.bin = package_version.bin.clone_with_buffers(
                &manifest.string_buf,
                &manifest.extern_strings_bin_entries,
                extern_old_len as u32,
                extern_strings_slice,
                &mut string_builder,
            );

            package.meta.arch = package_version.cpu;
            package.meta.os = package_version.os;
            package.meta.integrity = package_version.integrity;
            package
                .meta
                .set_has_install_script(package_version.has_install_script);

            package.dependencies.off = dep_start as u32;
            package.dependencies.len = total_dependencies_count;
            package.resolutions.off = package.dependencies.off;
            package.resolutions.len = package.dependencies.len;

            let new_length = package.dependencies.len as usize + dep_start;

            debug_assert_eq!(resolutions_list.len(), dep_start);
            bun_core::vec::extend_from_fn(
                resolutions_list,
                package.dependencies.len as usize,
                |_| invalid_package_id,
            );
            debug_assert_eq!(resolutions_list.len(), new_length);

            // Shrink off the unused default-initialized tail (`new_length <= total_len`).
            dependencies_list.truncate(new_length);

            #[cfg(debug_assertions)]
            {
                if package.resolution.npm().url.is_empty() {
                    Output::panic(format_args!(
                        "tarball_url is empty for package {}@{}",
                        bstr::BStr::new(manifest.name()),
                        version.fmt(&manifest.string_buf),
                    ));
                }
            }

            string_builder.clamp();
            return Ok(package);
        }
    }
}

// ─── Diff ────────────────────────────────────────────────────────────────────

pub struct Diff;

#[repr(u8)]
pub enum DiffOp {
    Add,
    Remove,
    Update,
    Unlink,
    Link,
}

#[derive(Default)]
pub struct DiffSummary {
    pub add: u32,
    pub remove: u32,
    pub update: u32,
    pub overrides_changed: bool,
    pub catalogs_changed: bool,

    /// bool for if this dependency should be added to lockfile trusted dependencies.
    /// it is false when the new trusted dependency is coming from the default list.
    pub added_trusted_dependencies:
        ArrayHashMap<TruncatedPackageNameHash, bool, ArrayIdentityContext>,
    pub removed_trusted_dependencies: TrustedDependenciesSet,

    pub patched_dependencies_changed: bool,
}

impl DiffSummary {
    #[inline]
    pub fn sum(&mut self, that: &DiffSummary) {
        self.add += that.add;
        self.remove += that.remove;
        self.update += that.update;
    }

    #[inline]
    pub fn has_diffs(&self) -> bool {
        self.add > 0
            || self.remove > 0
            || self.update > 0
            || self.overrides_changed
            || self.catalogs_changed
            || self.added_trusted_dependencies.count() > 0
            || self.removed_trusted_dependencies.count() > 0
            || self.patched_dependencies_changed
    }
}

impl Diff {
    // PORT NOTE: Zig's `Package` here is the canonical `Package(u64)` (the only
    // instantiation `Lockfile` ever holds). Dropping the generic avoids a
    // spurious `Package<I>` ≠ `Package<u64>` mismatch on the recursive call
    // through `from_lockfile.packages.get(...)`.
    pub fn generate(
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        from_lockfile: &mut Lockfile,
        to_lockfile: &mut Lockfile,
        from: &Package,
        to: &Package,
        update_requests: Option<&[UpdateRequest]>,
        mut id_mapping: Option<&mut [PackageID]>,
    ) -> Result<DiffSummary, bun_core::Error> {
        // TODO(port): narrow error set
        let mut summary = DiffSummary::default();
        let is_root = id_mapping.is_some();
        // PORT NOTE: Zig held `to_deps` as a mutable slice binding and reassigned
        // it after `parseWithJSON` (which may grow `to_lockfile.buffers
        // .dependencies` and invalidate the old slice). Mirror that with raw fat
        // pointers so the `&mut to_lockfile`/`&mut from_lockfile` reborrows below
        // (sort, recursive `generate`) don't conflict with these read views; the
        // recursive call only sorts `overrides`/`catalogs` and never reallocates
        // either lockfile's `buffers.dependencies`/`resolutions`, so the raw
        // pointers remain valid for the loop body.
        let mut to_deps: bun_ptr::RawSlice<Dependency> = to
            .dependencies
            .get(to_lockfile.buffers.dependencies.as_slice())
            .into();
        macro_rules! to_deps {
            () => {
                to_deps.slice()
            };
        }
        let from_deps: bun_ptr::RawSlice<Dependency> = from
            .dependencies
            .get(from_lockfile.buffers.dependencies.as_slice())
            .into();
        let from_resolutions: bun_ptr::RawSlice<PackageID> = from
            .resolutions
            .get(from_lockfile.buffers.resolutions.as_slice())
            .into();
        // See PORT NOTE above — `from_lockfile.buffers` is not reallocated for
        // the lifetime of these references.
        let (from_deps, from_resolutions) = (from_deps.slice(), from_resolutions.slice());
        let mut to_i: usize = 0;

        if from_lockfile.overrides.map.count() != to_lockfile.overrides.map.count() {
            summary.overrides_changed = true;

            if PackageManager::verbose_install() {
                Output::pretty_errorln(format_args!("Overrides changed since last install"));
            }
        } else {
            // PORT NOTE: reshaped for borrowck — Zig passed `from_lockfile`
            // twice (once as `&mut self` via `.overrides`, once as `lockfile`).
            // `OverrideMap::sort` only reads `lockfile.buffers.string_bytes`,
            // so split the borrow at the field.
            lockfile::OverrideMap::sort(
                &mut from_lockfile.overrides,
                from_lockfile.buffers.string_bytes.as_slice(),
            );
            lockfile::OverrideMap::sort(
                &mut to_lockfile.overrides,
                to_lockfile.buffers.string_bytes.as_slice(),
            );
            debug_assert_eq!(
                from_lockfile.overrides.map.keys().len(),
                to_lockfile.overrides.map.keys().len()
            );
            for (((from_k, from_override), to_k), to_override) in from_lockfile
                .overrides
                .map
                .keys()
                .iter()
                .zip(from_lockfile.overrides.map.values())
                .zip(to_lockfile.overrides.map.keys())
                .zip(to_lockfile.overrides.map.values())
            {
                if (from_k != to_k)
                    || (!Dependency::eql(
                        from_override,
                        to_override,
                        from_lockfile.buffers.string_bytes.as_slice(),
                        to_lockfile.buffers.string_bytes.as_slice(),
                    ))
                {
                    summary.overrides_changed = true;
                    if PackageManager::verbose_install() {
                        Output::pretty_errorln(format_args!(
                            "Overrides changed since last install"
                        ));
                    }
                    break;
                }
            }
        }

        if is_root {
            'catalogs: {
                // don't sort if lengths are different
                if from_lockfile.catalogs.default.count() != to_lockfile.catalogs.default.count() {
                    summary.catalogs_changed = true;
                    break 'catalogs;
                }

                if from_lockfile.catalogs.groups.count() != to_lockfile.catalogs.groups.count() {
                    summary.catalogs_changed = true;
                    break 'catalogs;
                }

                // PORT NOTE: reshaped for borrowck — see `overrides.sort` note above.
                lockfile::CatalogMap::sort(&mut from_lockfile.catalogs, &from_lockfile.buffers);
                lockfile::CatalogMap::sort(&mut to_lockfile.catalogs, &to_lockfile.buffers);

                for (((from_dep_name, from_dep), to_dep_name), to_dep) in from_lockfile
                    .catalogs
                    .default
                    .keys()
                    .iter()
                    .zip(from_lockfile.catalogs.default.values())
                    .zip(to_lockfile.catalogs.default.keys())
                    .zip(to_lockfile.catalogs.default.values())
                {
                    if !String::eql(
                        *from_dep_name,
                        *to_dep_name,
                        from_lockfile.buffers.string_bytes.as_slice(),
                        to_lockfile.buffers.string_bytes.as_slice(),
                    ) {
                        summary.catalogs_changed = true;
                        break 'catalogs;
                    }

                    if !Dependency::eql(
                        from_dep,
                        to_dep,
                        from_lockfile.buffers.string_bytes.as_slice(),
                        to_lockfile.buffers.string_bytes.as_slice(),
                    ) {
                        summary.catalogs_changed = true;
                        break 'catalogs;
                    }
                }

                for (((from_catalog_name, from_catalog_deps), to_catalog_name), to_catalog_deps) in
                    from_lockfile
                        .catalogs
                        .groups
                        .keys()
                        .iter()
                        .zip(from_lockfile.catalogs.groups.values())
                        .zip(to_lockfile.catalogs.groups.keys())
                        .zip(to_lockfile.catalogs.groups.values())
                {
                    if !String::eql(
                        *from_catalog_name,
                        *to_catalog_name,
                        from_lockfile.buffers.string_bytes.as_slice(),
                        to_lockfile.buffers.string_bytes.as_slice(),
                    ) {
                        summary.catalogs_changed = true;
                        break 'catalogs;
                    }

                    if from_catalog_deps.count() != to_catalog_deps.count() {
                        summary.catalogs_changed = true;
                        break 'catalogs;
                    }

                    for (((from_dep_name, from_dep), to_dep_name), to_dep) in from_catalog_deps
                        .keys()
                        .iter()
                        .zip(from_catalog_deps.values())
                        .zip(to_catalog_deps.keys())
                        .zip(to_catalog_deps.values())
                    {
                        if !String::eql(
                            *from_dep_name,
                            *to_dep_name,
                            from_lockfile.buffers.string_bytes.as_slice(),
                            to_lockfile.buffers.string_bytes.as_slice(),
                        ) {
                            summary.catalogs_changed = true;
                            break 'catalogs;
                        }

                        if !Dependency::eql(
                            from_dep,
                            to_dep,
                            from_lockfile.buffers.string_bytes.as_slice(),
                            to_lockfile.buffers.string_bytes.as_slice(),
                        ) {
                            summary.catalogs_changed = true;
                            break 'catalogs;
                        }
                    }
                }
            }
        }

        'trusted_dependencies: {
            // trusted dependency diff
            //
            // situations:
            // 1 - Both old lockfile and new lockfile use default trusted dependencies, no diffs
            // 2 - Both exist, only diffs are from additions and removals
            //
            // 3 - Old lockfile has trusted dependencies, new lockfile does not. Added are dependencies
            //     from default list that didn't exist previously. We need to be careful not to add these
            //     to the new lockfile. Removed are dependencies from old list that
            //     don't exist in the default list.
            //
            // 4 - Old lockfile used the default list, new lockfile has trusted dependencies. Added
            //     are dependencies are all from the new lockfile. Removed is empty because the default
            //     list isn't appended to the lockfile.

            // 1
            if from_lockfile.trusted_dependencies.is_none()
                && to_lockfile.trusted_dependencies.is_none()
            {
                break 'trusted_dependencies;
            }

            // 2
            if from_lockfile.trusted_dependencies.is_some()
                && to_lockfile.trusted_dependencies.is_some()
            {
                let from_trusted_dependencies =
                    from_lockfile.trusted_dependencies.as_ref().unwrap();
                let to_trusted_dependencies = to_lockfile.trusted_dependencies.as_ref().unwrap();

                // added
                for &to_trusted in to_trusted_dependencies.keys() {
                    if !from_trusted_dependencies.contains(&to_trusted) {
                        summary.added_trusted_dependencies.put(to_trusted, true)?;
                    }
                }

                // removed
                for &from_trusted in from_trusted_dependencies.keys() {
                    if !to_trusted_dependencies.contains(&from_trusted) {
                        summary.removed_trusted_dependencies.put(from_trusted, ())?;
                    }
                }

                break 'trusted_dependencies;
            }

            // 3
            if from_lockfile.trusted_dependencies.is_some()
                && to_lockfile.trusted_dependencies.is_none()
            {
                let from_trusted_dependencies =
                    from_lockfile.trusted_dependencies.as_ref().unwrap();

                // added
                for entry in default_trusted_dependencies::entries() {
                    if !from_trusted_dependencies
                        .contains(&(entry.hash as TruncatedPackageNameHash))
                    {
                        // although this is a new trusted dependency, it is from the default
                        // list so it shouldn't be added to the lockfile
                        summary
                            .added_trusted_dependencies
                            .put(entry.hash as TruncatedPackageNameHash, false)?;
                    }
                }

                // removed
                for &from_trusted in from_trusted_dependencies.keys() {
                    if !default_trusted_dependencies::has_with_hash(
                        u64::try_from(from_trusted).expect("int cast"),
                    ) {
                        summary.removed_trusted_dependencies.put(from_trusted, ())?;
                    }
                }

                break 'trusted_dependencies;
            }

            // 4
            if from_lockfile.trusted_dependencies.is_none()
                && to_lockfile.trusted_dependencies.is_some()
            {
                let to_trusted_dependencies = to_lockfile.trusted_dependencies.as_ref().unwrap();

                // add all to trusted dependencies, even if they exist in default because they weren't in the
                // lockfile originally
                for &to_trusted in to_trusted_dependencies.keys() {
                    summary.added_trusted_dependencies.put(to_trusted, true)?;
                }

                {
                    // removed
                    // none
                }

                break 'trusted_dependencies;
            }
        }

        summary.patched_dependencies_changed = 'patched_dependencies_changed: {
            if from_lockfile.patched_dependencies.count()
                != to_lockfile.patched_dependencies.count()
            {
                break 'patched_dependencies_changed true;
            }
            let mut iter = to_lockfile.patched_dependencies.iterator();
            while let Some(entry) = iter.next() {
                if let Some(val) = from_lockfile.patched_dependencies.get(&*entry.key_ptr) {
                    if val
                        .path
                        .slice(from_lockfile.buffers.string_bytes.as_slice())
                        != entry
                            .value_ptr
                            .path
                            .slice(to_lockfile.buffers.string_bytes.as_slice())
                    {
                        break 'patched_dependencies_changed true;
                    }
                } else {
                    break 'patched_dependencies_changed true;
                }
            }
            for key in from_lockfile.patched_dependencies.keys() {
                if !to_lockfile.patched_dependencies.contains(key) {
                    break 'patched_dependencies_changed true;
                }
            }
            false
        };

        for (i, from_dep) in from_deps.iter().enumerate() {
            let found = 'found: {
                let prev_i = to_i;

                // common case, dependency is present in both versions:
                // - in the same position
                // - shifted by a constant offset
                while to_i < to_deps!().len() {
                    if from_dep.name_hash == to_deps!()[to_i].name_hash {
                        let from_behavior = from_dep.behavior;
                        let to_behavior = to_deps!()[to_i].behavior;

                        if from_behavior != to_behavior {
                            to_i += 1;
                            continue;
                        }

                        break 'found true;
                    }
                    to_i += 1;
                }

                // less common, o(n^2) case
                to_i = 0;
                while to_i < prev_i {
                    if from_dep.name_hash == to_deps!()[to_i].name_hash {
                        let from_behavior = from_dep.behavior;
                        let to_behavior = to_deps!()[to_i].behavior;

                        if from_behavior != to_behavior {
                            to_i += 1;
                            continue;
                        }

                        break 'found true;
                    }
                    to_i += 1;
                }

                false
            };

            if !found {
                // We found a removed dependency!
                // We don't need to remove it
                // It will be cleaned up later
                summary.remove += 1;
                continue;
            }
            // defer to_i += 1; — applied at end of iteration body
            let cur_to_i = to_i;
            to_i += 1;

            if Dependency::eql(
                &to_deps!()[cur_to_i],
                from_dep,
                to_lockfile.buffers.string_bytes.as_slice(),
                from_lockfile.buffers.string_bytes.as_slice(),
            ) {
                if let Some(updates) = update_requests {
                    if updates.is_empty()
                        || 'brk: {
                            for request in updates {
                                if from_dep.name_hash == request.name_hash {
                                    break 'brk true;
                                }
                            }
                            false
                        }
                    {
                        // Listed as to be updated
                        summary.update += 1;
                        continue;
                    }
                }

                if let Some(mapping) = id_mapping.as_deref_mut() {
                    let update_mapping = 'update_mapping: {
                        if !is_root || !from_dep.behavior.is_workspace() {
                            break 'update_mapping true;
                        }

                        let Some(workspace_path) = to_lockfile
                            .workspace_paths
                            .get(&from_dep.name_hash)
                            .copied()
                        else {
                            break 'update_mapping false;
                        };

                        let mut package_json_path: AutoAbsPath = AutoAbsPath::init_top_level_dir();
                        // defer package_json_path.deinit(); — Drop handles it

                        // OOM/capacity: Zig aborts; port keeps fire-and-forget
                        let _ = package_json_path.append(
                            workspace_path.slice(to_lockfile.buffers.string_bytes.as_slice()),
                        );
                        let _ = package_json_path.append(b"package.json"); // OOM/capacity: Zig aborts; port keeps fire-and-forget

                        // PORT NOTE: `bun.sys.File.toSource` was removed from
                        // T1 (`bun_sys`) because `bun_ast::Source` lives in T2.
                        // Route through the workspace cache's path-based getter
                        // instead, which both reads and parses.
                        let mut workspace_pkg = Package::default();

                        // The cache entry borrows `pm.workspace_package_json_cache`;
                        // capture a stable BACKREF to its `source` so the
                        // `&mut pm` reborrow below doesn't conflict. The entry
                        // lives in a `StringHashMap` whose backing storage is
                        // not touched by `parse_with_json`.
                        let (source_ref, json_root): (bun_ptr::ParentRef<bun_ast::Source>, Expr) =
                            match pm
                                .workspace_package_json_cache
                                .get_with_path(
                                    &mut *log,
                                    package_json_path.slice(),
                                    Default::default(),
                                )
                                .unwrap()
                            {
                                Ok(entry) => (bun_ptr::ParentRef::new(&entry.source), entry.root),
                                Err(_) => break 'update_mapping false,
                            };
                        // BACKREF — entry storage is stable for the remainder
                        // of this block (see note above).
                        let source = source_ref.get();

                        let mut resolver: () = ();
                        workspace_pkg.parse_with_json::<()>(
                            to_lockfile,
                            pm,
                            log,
                            source,
                            json_root,
                            &mut resolver,
                            Features::WORKSPACE,
                        )?;

                        // `parse_with_json` may have grown `to_lockfile.buffers
                        // .dependencies` — re-derive the slice (Zig did the same).
                        to_deps = to
                            .dependencies
                            .get(to_lockfile.buffers.dependencies.as_slice())
                            .into();

                        let from_pkg = from_lockfile.packages.get(from_resolutions[i] as usize);
                        let diff = Self::generate(
                            pm,
                            log,
                            from_lockfile,
                            to_lockfile,
                            &from_pkg,
                            &workspace_pkg,
                            update_requests,
                            None,
                        )?;

                        if pm.options.log_level.is_verbose()
                            && (diff.add + diff.remove + diff.update) > 0
                        {
                            Output::pretty_errorln(format_args!(
                                "Workspace package \"{}\" has added <green>{}<r> dependencies, removed <red>{}<r> dependencies, and updated <cyan>{}<r> dependencies",
                                bstr::BStr::new(
                                    workspace_path
                                        .slice(to_lockfile.buffers.string_bytes.as_slice())
                                ),
                                diff.add,
                                diff.remove,
                                diff.update,
                            ));
                        }

                        !diff.has_diffs()
                    };

                    if update_mapping {
                        mapping[cur_to_i] = i as PackageID;
                        continue;
                    }
                } else {
                    continue;
                }
            }

            // We found a changed dependency!
            //
            // If only the *version literal* changed and the previously-resolved
            // package still satisfies the new range, keep the existing
            // resolution. Otherwise widening a range (e.g. `"4.0.0"` → `"*"`)
            // re-resolves to latest on the next `bun add <unrelated>`, which
            // surprises migrations from npm/pnpm lockfiles whose package.json
            // range diverged from the locked version. This matches npm's
            // sticky-lockfile behaviour and lets `Lockfile::get_package_id`
            // apply its order-independence guard without overriding a locked
            // pin.
            //
            // Skipped when the dependency is an explicit update target
            // (`bun update <pkg>` or bare `bun update`): the user is asking
            // for a fresh resolve and the old resolution must not be
            // preserved. Same gate as the `Dependency::eql == true` branch
            // above.
            let is_explicit_update_target = matches!(update_requests, Some(updates)
                if updates.is_empty()
                    || updates.iter().any(|r| r.name_hash == from_dep.name_hash));
            if !is_explicit_update_target {
                if let Some(mapping) = id_mapping.as_deref_mut() {
                    let from_res_id = from_resolutions[i];
                    if (from_res_id as usize) < from_lockfile.packages.len() {
                        let from_pkg_resolution =
                            from_lockfile.packages.items_resolution()[from_res_id as usize];
                        let to_dep = &to_deps!()[cur_to_i];
                        if to_dep.version.tag == dependency::version::Tag::Npm
                            && from_pkg_resolution.tag == ResolutionTag::Npm
                            && to_dep.version.npm().version.satisfies(
                                from_pkg_resolution.npm().version,
                                to_lockfile.buffers.string_bytes.as_slice(),
                                from_lockfile.buffers.string_bytes.as_slice(),
                            )
                        {
                            mapping[cur_to_i] = i as PackageID;
                            // Still counted as an update so `had_any_diffs`
                            // triggers the rebuild path; we just preserved
                            // the resolved package.
                        }
                    }
                }
            }
            summary.update += 1;
        }

        // Use saturating arithmetic here because a migrated
        // package-lock.json could be out of sync with the package.json, so the
        // number of from_deps could be greater than to_deps.
        summary.add = (to_deps!()
            .len()
            .saturating_sub(from_deps.len().saturating_sub(summary.remove as usize)))
            as u32;

        if from.resolution.tag != ResolutionTag::Root {
            // PERF(port): was `inline for` over Lockfile.Scripts.names — profile in Phase B
            for (to_hook, from_hook) in to.scripts.hooks().iter().zip(from.scripts.hooks().iter()) {
                if !String::eql(
                    **to_hook,
                    **from_hook,
                    to_lockfile.buffers.string_bytes.as_slice(),
                    from_lockfile.buffers.string_bytes.as_slice(),
                ) {
                    // We found a changed life-cycle script
                    summary.update += 1;
                }
            }
        }

        Ok(summary)
    }
}

impl Package<u64> {
    pub fn hash(name: &[u8], version: SemverVersion) -> u64 {
        let mut hasher = bun_wyhash::Wyhash::init(0);
        hasher.update(name);
        // SAFETY: Semver.Version is POD; reading its raw bytes is sound.
        hasher.update(unsafe {
            bun_core::ffi::slice(
                (&raw const version).cast::<u8>(),
                mem::size_of::<SemverVersion>(),
            )
        });
        hasher.final_()
    }

    pub fn parse<R: ResolverContext>(
        &mut self,
        lockfile: &mut Lockfile,
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        resolver: &mut R,
        features: Features,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        initialize_store();
        // Zig threaded `lockfile.allocator` for the JSON arena. The returned
        // `Expr` tree only needs to live until `parse_with_json` finishes, so
        // a function-local arena is sufficient (matches Scripts.rs / lockfile.rs
        // call sites) and avoids leaking.
        let bump = bun_alloc::Arena::new();
        let json = match crate::bun_json::parse_package_json_utf8(source, log, &bump) {
            Ok(j) => j,
            Err(err) => {
                let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                Output::pretty_errorln(format_args!(
                    "<r><red>{}<r> parsing package.json in <b>\"{}\"<r>",
                    err.name(),
                    bstr::BStr::new(source.path.pretty_dir()),
                ));
                Global::crash();
            }
        };

        self.parse_with_json::<R>(lockfile, pm, log, source, json, resolver, features)
    }

    /// Borrow-splitting bridge for `PackageManager` callers
    /// (`processDependencyList`, `folder_resolver`). Zig passes
    /// `manager.lockfile`, `manager`, `manager.log` as three separate args;
    /// Rust borrowck rejects the overlap on `&mut self`, so split via raw
    /// pointer here once instead of at every call site.
    pub fn parse_from_real_manager<R: ResolverContext>(
        &mut self,
        manager: *mut crate::package_manager_real::PackageManager,
        source: &bun_ast::Source,
        resolver: &mut R,
        features: Features,
    ) -> Result<(), bun_core::Error> {
        // SAFETY: `manager` points to a live `PackageManager` for the duration
        // of this call (caller passes `self as *mut _`); `lockfile` and `log`
        // are disjoint fields, and `parse_with_json` only reaches `manager`
        // through the `pm` argument it receives here — no re-entrancy.
        let (lockfile, pm, log) = unsafe {
            let m = &mut *manager;
            let lockfile: *mut Lockfile = &raw mut *m.lockfile;
            let log: *mut bun_ast::Log = m.log;
            (&mut *lockfile, &mut *manager, &mut *log)
        };
        self.parse(lockfile, pm, log, source, resolver, features)
    }

    // Zig: `comptime group: DependencyGroup`, `comptime features: Features`, `comptime tag: ?Dependency.Version.Tag`
    // PERF(port): was comptime monomorphization on `group`/`tag` — profile in Phase B
    //
    // PORT NOTE: Zig took `lockfile: *Lockfile`, but the live `StringBuilder`
    // (also passed) already holds `&mut lockfile.buffers.string_bytes`. The
    // body only otherwise touches `workspace_paths` / `workspace_versions`,
    // so accept those two maps directly and read `string_bytes` via the
    // builder — caller can then split-borrow at the field level.
    fn parse_dependency(
        workspace_paths: &mut lockfile::NameHashMap,
        workspace_versions: &mut lockfile::VersionHashMap,
        duplicate_checker_map: &mut lockfile::DuplicateCheckerMap,
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        group: &DependencyGroup,
        string_builder: &mut StringBuilder<'_>,
        features: Features,
        package_dependencies: &mut [Dependency],
        dependencies_count: u32,
        tag: Option<dependency::version::Tag>,
        workspace_ver: Option<SemverVersion>,
        external_alias: ExternalString,
        version: &[u8],
        key_loc: bun_ast::Loc,
        value_loc: bun_ast::Loc,
    ) -> Result<Option<Dependency>, bun_core::Error> {
        // TODO(port): narrow error set
        let external_version = 'brk: {
            #[cfg(windows)]
            {
                match tag.unwrap_or_else(|| dependency::version::Tag::infer(version)) {
                    dependency::version::Tag::Workspace
                    | dependency::version::Tag::Folder
                    | dependency::version::Tag::Symlink
                    | dependency::version::Tag::Tarball => {
                        if String::can_inline(version) {
                            let mut copy = string_builder.append::<String>(version);
                            path::dangerously_convert_path_to_posix_in_place::<u8>(&mut copy.bytes);
                            break 'brk copy;
                        } else {
                            let str_ = string_builder.append::<String>(version);
                            let ptr = str_.ptr();
                            path::dangerously_convert_path_to_posix_in_place::<u8>(
                                &mut string_builder.string_bytes
                                    [ptr.off as usize..(ptr.off + ptr.len) as usize],
                            );
                            break 'brk str_;
                        }
                    }
                    _ => {}
                }
            }

            string_builder.append::<String>(version)
        };

        // SAFETY: `buf` aliases `string_builder.string_bytes` while later
        // `string_builder.append()` calls write into the *pre-reserved* tail
        // (`allocate()` ran before this fn). No realloc occurs, so the detached
        // borrow stays valid; a tracked `&[u8]` would needlessly lock the builder.
        let buf: &[u8] =
            unsafe { bun_ptr::detach_lifetime(string_builder.string_bytes.as_slice()) };
        let sliced = external_version.sliced(buf);

        let mut dependency_version = Dependency::parse_with_optional_tag(
            external_alias.value,
            Some(external_alias.hash),
            sliced.slice,
            tag,
            &sliced,
            Some(&mut *log),
            Some(&mut *pm),
        )
        .unwrap_or_default();
        let mut workspace_range: Option<semver::query::Group> = None;
        #[allow(non_snake_case)]
        let FEATURES = features;
        let name_hash = match dependency_version.tag {
            dependency::version::Tag::Npm => {
                let npm_name = dependency_version.npm().name;
                semver::string::Builder::string_hash(npm_name.slice(buf))
            }
            dependency::version::Tag::Workspace => {
                if strings::has_prefix(sliced.slice, b"workspace:") {
                    'brk: {
                        let input = &sliced.slice[b"workspace:".len()..];
                        let trimmed = strings::trim(input, &strings::WHITESPACE_CHARS);
                        if trimmed.len() != 1
                            || (trimmed[0] != b'*' && trimmed[0] != b'^' && trimmed[0] != b'~')
                        {
                            let at = strings::last_index_of_char(input, b'@').unwrap_or(0);
                            if at > 0 {
                                workspace_range = Some(
                                    semver::query::parse(&input[at as usize + 1..], sliced)
                                        .unwrap_or_else(|_| bun_core::out_of_memory()),
                                );
                                break 'brk semver::string::Builder::string_hash(
                                    &input[0..at as usize],
                                );
                            }
                            workspace_range = Some(
                                semver::query::parse(input, sliced)
                                    .unwrap_or_else(|_| bun_core::out_of_memory()),
                            );
                        }
                        external_alias.hash
                    }
                } else {
                    external_alias.hash
                }
            }
            _ => external_alias.hash,
        };

        let mut workspace_path: Option<String> = None;
        let mut workspace_version = workspace_ver;
        if tag.is_none() {
            workspace_path = workspace_paths.get(&name_hash).copied();
            workspace_version = workspace_versions.get(&name_hash).copied();
        }

        if tag.is_some() {
            debug_assert!(
                dependency_version.tag != dependency::version::Tag::Npm
                    && dependency_version.tag != dependency::version::Tag::DistTag
            );
        }

        match dependency_version.tag {
            dependency::version::Tag::Folder => {
                let folder = *dependency_version.folder();
                let relative = resolve_path::relative(
                    FileSystem::instance().top_level_dir(),
                    resolve_path::join_abs_string::<path::platform::Auto>(
                        FileSystem::instance().top_level_dir(),
                        &[source.path.name.dir, folder.slice(buf)],
                    ),
                );
                // if relative is empty, we are linking the package to itself
                dependency_version.value.folder = string_builder
                    .append::<String>(if relative.is_empty() { b"." } else { relative });
            }
            dependency::version::Tag::Npm => {
                if workspace_version.is_some() {
                    let satisfies = dependency_version.npm().version.satisfies(
                        workspace_version.unwrap(),
                        buf,
                        buf,
                    );
                    if pm.options.link_workspace_packages && satisfies {
                        // `String::sliced` takes `&'a self`; bind the unwrapped
                        // value so the borrow outlives the parse call.
                        let wp = workspace_path.unwrap();
                        let path = wp.sliced(buf);
                        if let Some(dep) = dependency::parse_with_tag(
                            external_alias.value,
                            Some(external_alias.hash),
                            path.slice,
                            dependency::version::Tag::Workspace,
                            &path,
                            Some(&mut *log),
                            Some(&mut *pm),
                        ) {
                            dependency_version.tag = dep.tag;
                            dependency_version.value = dep.value;
                        }
                    } else {
                        // It doesn't satisfy, but a workspace shares the same name. Override the workspace with the other dependency
                        for dep in &mut package_dependencies[0..dependencies_count as usize] {
                            if dep.name_hash == name_hash && dep.behavior.is_workspace() {
                                *dep = Dependency {
                                    behavior: group.behavior,
                                    name: external_alias.value,
                                    name_hash: external_alias.hash,
                                    version: dependency_version,
                                };
                                return Ok(None);
                            }
                        }
                    }
                }
            }
            dependency::version::Tag::Workspace => 'workspace: {
                if let Some(path) = workspace_path {
                    if let Some(range) = &workspace_range {
                        if let Some(ver) = workspace_version {
                            if range.satisfies(ver, buf, buf) {
                                dependency_version.value.workspace = path;
                                break 'workspace;
                            }
                        }

                        // important to trim before len == 0 check. `workspace:foo@      ` should install successfully
                        // SAFETY: `range.input` borrows `lockfile.buffers.string_bytes`
                        // (set by `semver::query::parse` above), which is live here.
                        let version_literal =
                            strings::trim(unsafe { &*range.input }, &strings::WHITESPACE_CHARS);
                        if version_literal.is_empty()
                            || range.is_star()
                            || SemverVersion::is_tagged_version_only(version_literal)
                        {
                            dependency_version.value.workspace = path;
                            break 'workspace;
                        }

                        // workspace is not required to have a version, but if it does
                        // and this version doesn't match it, fail to install
                        log.add_error_fmt(
                            source,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "No matching version for workspace dependency \"{}\". Version: \"{}\"",
                                bstr::BStr::new(external_alias.slice(buf)),
                                bstr::BStr::new(dependency_version.literal.slice(buf)),
                            ),
                        );
                        return Err(bun_core::err!("InstallFailed"));
                    }

                    dependency_version.value.workspace = path;
                } else {
                    // SAFETY: tag == Workspace selects the `workspace` union member.
                    // Bind the (Copy) union field first so `slice()`'s `&self`
                    // borrow has a named place to point at.
                    let workspace_str = *dependency_version.workspace();
                    let workspace = workspace_str.slice(buf);
                    let path =
                        string_builder.append::<String>(if workspace == b"*" {
                            b"*"
                        } else {
                            'brk: {
                                let mut buf2 = PathBuffer::uninit();
                                let rel =
                                    resolve_path::relative_platform::<path::platform::Auto, false>(
                                        FileSystem::instance().top_level_dir(),
                                        resolve_path::join_abs_string_buf::<path::platform::Auto>(
                                            FileSystem::instance().top_level_dir(),
                                            &mut buf2.0,
                                            &[source.path.name.dir, workspace],
                                        ),
                                    );
                                #[cfg(windows)]
                                {
                                    // Zig spec (Package.zig:1175-1178) converts
                                    // `relative_to_common_path_buf()[0..rel.len]` in place but then
                                    // returns `rel`. With ALWAYS_COPY=false, `rel` may instead borrow
                                    // RELATIVE_TO_BUF (resolve_path.rs early returns at L450/457/500/
                                    // 522) or be `b""`. Re-deriving a slice of the common-path buf
                                    // would yield stale bytes in those cases. Copy `rel` into the
                                    // common-path scratch when it isn't already there, then convert
                                    // and return that — preserving the spec's "return `rel`'s bytes"
                                    // contract while avoiding aliasing UB.
                                    let len = rel.len();
                                    let common_raw = path::relative_to_common_path_buf();
                                    // `PathBuffer` is `repr(transparent)` over `[u8; N]`, so the
                                    // struct pointer equals `(&*common_raw).as_ptr()`.
                                    let rel_is_common =
                                        core::ptr::eq(rel.as_ptr(), common_raw.cast::<u8>());
                                    // SAFETY: thread-local scratch; sole live mut borrow on this
                                    // thread for the remainder of this block. When `rel` aliased
                                    // it, its last use was the `.as_ptr()` above (NLL-dead);
                                    // otherwise `rel` borrows a disjoint allocation.
                                    let common = unsafe { &mut *common_raw };
                                    if !rel_is_common {
                                        // `rel` is into a disjoint thread-local (RELATIVE_TO_BUF)
                                        // or `b""` (len==0 → no read).
                                        common[..len].copy_from_slice(rel);
                                    }
                                    let s: &mut [u8] = &mut common[..len];
                                    path::dangerously_convert_path_to_posix_in_place::<u8>(s);
                                    break 'brk &*s;
                                }
                                #[cfg(not(windows))]
                                break 'brk rel;
                            }
                        });
                    if cfg!(debug_assertions) {
                        debug_assert!(path.len() > 0);
                        debug_assert!(!bun_paths::is_absolute(path.slice(buf)));
                    }
                    dependency_version.value.workspace = path;

                    let workspace_entry = workspace_paths.get_or_put(name_hash)?;
                    let found_matching_workspace = workspace_entry.found_existing;

                    if let Some(ver) = workspace_version {
                        workspace_versions.put(name_hash, ver)?;
                        for package_dep in &mut package_dependencies[0..dependencies_count as usize]
                        {
                            if match package_dep.version.tag {
                                // `dependencies` & `workspaces` defined within the same `package.json`
                                dependency::version::Tag::Npm => {
                                    semver::string::Builder::string_hash(
                                        package_dep.realname().slice(buf),
                                    ) == name_hash
                                        // SAFETY: tag == Npm selects the `npm` union member.
                                        && unsafe {
                                            package_dep
                                                .version
                                                .value
                                                .npm
                                                .version
                                                .satisfies(ver, buf, buf)
                                        }
                                }
                                // `workspace:*`
                                dependency::version::Tag::Workspace => {
                                    found_matching_workspace
                                        && semver::string::Builder::string_hash(
                                            package_dep.realname().slice(buf),
                                        ) == name_hash
                                }
                                _ => false,
                            } {
                                package_dep.version = dependency_version;
                                *workspace_entry.value_ptr = path;
                                return Ok(None);
                            }
                        }
                    } else if workspace_entry.found_existing {
                        for package_dep in &mut package_dependencies[0..dependencies_count as usize]
                        {
                            if package_dep.version.tag == dependency::version::Tag::Workspace
                                && semver::string::Builder::string_hash(
                                    package_dep.realname().slice(buf),
                                ) == name_hash
                            {
                                package_dep.version = dependency_version;
                                return Ok(None);
                            }
                        }
                        return Err(bun_core::err!("InstallFailed"));
                    }

                    *workspace_entry.value_ptr = path;
                }
            }
            _ => {}
        }

        let this_dep = Dependency {
            behavior: group.behavior,
            name: external_alias.value,
            name_hash: external_alias.hash,
            version: dependency_version,
        };

        // `peerDependencies` may be specified on existing dependencies. Packages in `workspaces` are deduplicated when
        // the array is processed
        if FEATURES.check_for_duplicate_dependencies
            && !group.behavior.is_peer()
            && !group.behavior.is_workspace()
        {
            // PERF(port): was assume_capacity
            let entry = duplicate_checker_map.get_or_put(external_alias.hash)?;
            if entry.found_existing {
                // duplicate dependencies are allowed in optionalDependencies
                if group.behavior.is_optional() {
                    for package_dep in &mut package_dependencies[0..dependencies_count as usize] {
                        if package_dep.name_hash == this_dep.name_hash {
                            *package_dep = this_dep;
                            break;
                        }
                    }
                    return Ok(None);
                } else {
                    let mut notes: Vec<bun_ast::Data> = Vec::with_capacity(1);

                    let mut text = Vec::new();
                    {
                        use std::io::Write;
                        let _ = write!(
                            &mut text,
                            "\"{}\" originally specified here",
                            bstr::BStr::new(external_alias.slice(buf))
                        );
                    }
                    notes.push(bun_ast::Data {
                        text: text.into(),
                        location: bun_ast::Location::init_or_null(
                            Some(source),
                            source.range_of_string(*entry.value_ptr),
                        ),
                        ..Default::default()
                    });

                    log.add_range_warning_fmt_with_notes(
                        Some(source),
                        source.range_of_string(key_loc),
                        notes.into(),
                        format_args!(
                            "Duplicate dependency: \"{}\" specified in package.json",
                            bstr::BStr::new(external_alias.slice(buf))
                        ),
                    );
                }
            }

            *entry.value_ptr = value_loc;
        }

        Ok(Some(this_dep))
    }

    pub fn parse_with_json<R: ResolverContext>(
        &mut self,
        lockfile: &mut Lockfile,
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        json: Expr,
        resolver: &mut R,
        features: Features,
    ) -> Result<(), bun_core::Error> {
        // Thin monomorphic shim: erase `R` to `dyn ResolverContextDyn` so the
        // ~960-line body below is codegen'd once. The half-dozen vtable calls
        // are noise next to the JSON walking / string-building this does.
        self.parse_with_json_impl(lockfile, pm, log, source, json, resolver, features)
    }

    #[inline(never)]
    fn parse_with_json_impl(
        &mut self,
        lockfile: &mut Lockfile,
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        json: Expr,
        resolver: &mut dyn ResolverContextDyn,
        features: Features,
    ) -> Result<(), bun_core::Error> {
        #[allow(non_snake_case)]
        let FEATURES = features;
        // TODO(port): narrow error set
        // Zig threads `allocator` for `asString` transcoding; the Rust signature
        // dropped it, so use a function-local arena (transcoded strings are only
        // borrowed until `string_builder.append` copies them).
        let bump = bun_alloc::Arena::new();
        // PORT NOTE: split-borrow `string_bytes`/`string_pool` so the dozens of
        // disjoint `lockfile.{buffers.*, overrides, catalogs, workspace_*, …}`
        // accesses below pass borrowck. Reads of `lockfile.buffers.string_bytes`
        // must go through `string_builder.string_bytes` while it's live.
        let mut string_builder = crate::string_builder!(lockfile);
        let mut total_dependencies_count: u32 = 0;

        self.meta.origin = if FEATURES.is_main {
            install::Origin::Local
        } else {
            install::Origin::Npm
        };
        self.name = String::default();
        self.name_hash = 0;

        // -- Count the sizes
        'name: {
            if let Some(name_q) = json.as_property(b"name") {
                if let Some(name) = name_q.expr.as_utf8(&bump) {
                    if !name.is_empty() {
                        string_builder.count(name);
                        break 'name;
                    }
                }
            }

            // name is not validated by npm, so fallback to creating a new from the version literal
            if resolver.is_git() {
                let resolution: &Resolution<u64> = resolver.resolution();
                let repo = match resolution.tag {
                    ResolutionTag::Git => *resolution.git(),
                    ResolutionTag::Github => *resolution.github(),
                    _ => break 'name,
                };

                resolver.set_new_name(Repository::create_dependency_name_from_version_literal(
                    &repo,
                    string_builder.string_bytes.as_slice(),
                    &lockfile.buffers.dependencies[resolver.dep_id() as usize],
                ));

                string_builder.count(resolver.new_name());
            }
        }

        if let Some(patched_deps) = json.as_property(b"patchedDependencies") {
            if let ExprData::EObject(obj) = &patched_deps.expr.data {
                for prop in obj.properties.slice() {
                    let key = prop.key.expect("infallible: prop has key");
                    let value = prop.value.expect("infallible: prop has value");
                    if key.is_string() && value.is_string() {
                        string_builder.count(value.as_utf8(&bump).unwrap());
                    }
                }
            }
        }

        if !FEATURES.is_main {
            if let Some(version_q) = json.as_property(b"version") {
                if let Some(version_str) = version_q.expr.as_utf8(&bump) {
                    string_builder.count(version_str);
                }
            }
        }
        'bin: {
            if let Some(bin) = json.as_property(b"bin") {
                match &bin.expr.data {
                    ExprData::EObject(obj) => {
                        for bin_prop in obj.properties.slice() {
                            let Some(k) = bin_prop
                                .key
                                .expect("infallible: prop has key")
                                .as_utf8(&bump)
                            else {
                                break 'bin;
                            };
                            string_builder.count(k);
                            let Some(v) = bin_prop
                                .value
                                .expect("infallible: prop has value")
                                .as_utf8(&bump)
                            else {
                                break 'bin;
                            };
                            string_builder.count(v);
                        }
                        break 'bin;
                    }
                    ExprData::EString(_) => {
                        if let Some(str_) = bin.expr.as_utf8(&bump) {
                            string_builder.count(str_);
                            break 'bin;
                        }
                    }
                    _ => {}
                }
            }

            if let Some(dirs) = json.as_property(b"directories") {
                if let Some(bin_prop) = dirs.expr.as_property(b"bin") {
                    if let Some(str_) = bin_prop.expr.as_utf8(&bump) {
                        string_builder.count(str_);
                        break 'bin;
                    }
                }
            }
        }

        Scripts::parse_count(&mut string_builder, json);

        if !resolver.is_void() {
            resolver.count(&mut string_builder, &json);
        }

        // PERF(port): was comptime-computed array — profile in Phase B
        let dependency_groups: Vec<DependencyGroup> = {
            let mut out: Vec<DependencyGroup> = Vec::with_capacity(5);
            if FEATURES.workspaces {
                out.push(DependencyGroup::WORKSPACES);
            }
            if FEATURES.dependencies {
                out.push(DependencyGroup::DEPENDENCIES);
            }
            if FEATURES.dev_dependencies {
                out.push(DependencyGroup::DEV);
            }
            if FEATURES.optional_dependencies {
                out.push(DependencyGroup::OPTIONAL);
            }
            if FEATURES.peer_dependencies {
                out.push(DependencyGroup::PEER);
            }
            out
        };

        let mut workspace_names = workspace_map::WorkspaceMap::init();
        // defer workspace_names.deinit(); — Drop handles it

        // pnpm/yarn synthesise an implicit `"*"` optional peer for entries
        // that appear in `peerDependenciesMeta` but not in
        // `peerDependencies`. Track the original key string so the
        // post-build pass can emit a real `Dependency` for any meta-only
        // names that nothing in the build loop consumed.
        let mut optional_peer_dependencies: ArrayHashMap<
            PackageNameHash,
            &[u8],
            bun_collections::identity_context::U64,
        > = ArrayHashMap::default();
        // defer optional_peer_dependencies.deinit(); — Drop handles it

        if FEATURES.peer_dependencies {
            if let Some(peer_dependencies_meta) = json.as_property(b"peerDependenciesMeta") {
                if let ExprData::EObject(obj) = &peer_dependencies_meta.expr.data {
                    let props = obj.properties.slice();
                    optional_peer_dependencies.ensure_unused_capacity(props.len())?;
                    for prop in props {
                        if let Some(optional) = prop
                            .value
                            .expect("infallible: prop has value")
                            .as_property(b"optional")
                        {
                            if !matches!(
                                &optional.expr.data,
                                ExprData::EBoolean(b) if b.value
                            ) {
                                continue;
                            }

                            let key = prop
                                .key
                                .expect("infallible: prop has key")
                                .as_utf8(&bump)
                                .expect("unreachable");
                            // PERF(port): was assume_capacity
                            optional_peer_dependencies.put_assume_capacity(
                                semver::string::Builder::string_hash(key),
                                key,
                            );
                            // Reserve space for a synthesised entry. If the
                            // matching name later appears in `peerDependencies`
                            // the slot just goes unused.
                            string_builder.count(key);
                            string_builder.count(b"*");
                            total_dependencies_count += 1;
                        }
                    }
                }
            }
        }

        // PERF(port): was `inline for` — profile in Phase B
        for group in &dependency_groups {
            if let Some(dependencies_q) = json.as_property(group.prop) {
                'brk: {
                    match &dependencies_q.expr.data {
                        ExprData::EArray(arr) => {
                            if !group.behavior.is_workspace() {
                                let _ = bun_ast::add_error_pretty!(
                                    log,
                                    source,
                                    dependencies_q.loc,
                                    "{0} expects a map of specifiers, e.g.\n  <r><green>\"{0}\"<r>: {{\n    <green>\"bun\"<r>: <green>\"latest\"<r>\n  }}",
                                    bstr::BStr::new(group.prop)
                                );
                                return Err(bun_core::err!("InvalidPackageJSON"));
                            }
                            total_dependencies_count += workspace_names.process_names_array(
                                &mut pm.workspace_package_json_cache,
                                log,
                                &**arr,
                                source,
                                dependencies_q.loc,
                                Some(&mut string_builder),
                            )?;
                        }
                        ExprData::EObject(obj) => {
                            if group.behavior.is_workspace() {
                                // yarn workspaces expects a "workspaces" property shaped like this:
                                //
                                //    "workspaces": {
                                //        "packages": [
                                //           "path/to/package"
                                //        ]
                                //    }
                                //
                                if let Some(packages_query) = obj.as_property(b"packages") {
                                    let packages_expr = packages_query.expr;
                                    if !matches!(packages_expr.data, ExprData::EArray(_)) {
                                        let _ = log.add_error_fmt(
                                            source,
                                            packages_expr.loc,
                                            // TODO: what if we could comptime call the syntax highlighter
                                            format_args!(
                                                "\"workspaces.packages\" expects an array of strings, e.g.\n  \"workspaces\": {{\n    \"packages\": [\n      \"path/to/package\"\n    ]\n  }}"
                                            ),
                                        );
                                        return Err(bun_core::err!("InvalidPackageJSON"));
                                    }
                                    let ExprData::EArray(packages_arr) = &packages_expr.data else {
                                        unreachable!()
                                    };
                                    total_dependencies_count += workspace_names
                                        .process_names_array(
                                            &mut pm.workspace_package_json_cache,
                                            log,
                                            &**packages_arr,
                                            source,
                                            packages_expr.loc,
                                            Some(&mut string_builder),
                                        )?;
                                }

                                break 'brk;
                            }
                            for item in obj.properties.slice() {
                                let key = item
                                    .key
                                    .expect("infallible: prop has key")
                                    .as_utf8(&bump)
                                    .unwrap();
                                let Some(value) = item
                                    .value
                                    .expect("infallible: prop has value")
                                    .as_utf8(&bump)
                                else {
                                    let _ = bun_ast::add_error_pretty!(
                                        log,
                                        source,
                                        item.value.expect("infallible: prop has value").loc,
                                        // TODO: what if we could comptime call the syntax highlighter
                                        "{0} expects a map of specifiers, e.g.\n  <r><green>\"{0}\"<r>: {{\n    <green>\"bun\"<r>: <green>\"latest\"<r>\n  }}",
                                        bstr::BStr::new(group.prop)
                                    );
                                    return Err(bun_core::err!("InvalidPackageJSON"));
                                };

                                string_builder.count(key);
                                string_builder.count(value);

                                // If it's a folder or workspace, pessimistically assume we will need a maximum path
                                match dependency::version::Tag::infer(value) {
                                    dependency::version::Tag::Folder
                                    | dependency::version::Tag::Workspace => {
                                        string_builder.cap += MAX_PATH_BYTES;
                                    }
                                    _ => {}
                                }
                            }
                            total_dependencies_count += obj.properties.len_u32() as u32;
                        }
                        _ => {
                            if group.behavior.is_workspace() {
                                let _ = bun_ast::add_error_pretty!(
                                    log,
                                    source,
                                    dependencies_q.loc,
                                    // TODO: what if we could comptime call the syntax highlighter
                                    "\"workspaces\" expects an array of strings, e.g.\n  <r><green>\"workspaces\"<r>: [\n    <green>\"path/to/package\"<r>\n  ]"
                                );
                            } else {
                                let _ = bun_ast::add_error_pretty!(
                                    log,
                                    source,
                                    dependencies_q.loc,
                                    "{0} expects a map of specifiers, e.g.\n  <r><green>\"{0}\"<r>: {{\n    <green>\"bun\"<r>: <green>\"latest\"<r>\n  }}",
                                    bstr::BStr::new(group.prop)
                                );
                            }
                            return Err(bun_core::err!("InvalidPackageJSON"));
                        }
                    }
                }
            }
        }

        if FEATURES.trusted_dependencies {
            if let Some(q) = json.as_property(b"trustedDependencies") {
                match &q.expr.data {
                    ExprData::EArray(arr) => {
                        if lockfile.trusted_dependencies.is_none() {
                            lockfile.trusted_dependencies = Some(Default::default());
                        }
                        lockfile
                            .trusted_dependencies
                            .as_mut()
                            .unwrap()
                            .ensure_unused_capacity(arr.items.len_u32() as usize)?;
                        for item in arr.slice() {
                            let Some(name) = item.as_utf8(&bump) else {
                                let _ = log.add_error_fmt(
                                    source,
                                    q.loc,
                                    format_args!(
                                        "trustedDependencies expects an array of strings, e.g.\n  <r><green>\"trustedDependencies\"<r>: [\n    <green>\"package_name\"<r>\n  ]"
                                    ),
                                );
                                return Err(bun_core::err!("InvalidPackageJSON"));
                            };
                            // PERF(port): was assume_capacity
                            lockfile
                                .trusted_dependencies
                                .as_mut()
                                .unwrap()
                                .put_assume_capacity(
                                    semver::string::Builder::string_hash(name)
                                        as TruncatedPackageNameHash,
                                    (),
                                );
                        }
                    }
                    _ => {
                        let _ = log.add_error_fmt(
                            source,
                            q.loc,
                            format_args!(
                                "trustedDependencies expects an array of strings, e.g.\n  <r><green>\"trustedDependencies\"<r>: [\n    <green>\"package_name\"<r>\n  ]"
                            ),
                        );
                        return Err(bun_core::err!("InvalidPackageJSON"));
                    }
                }
            }
        }

        if FEATURES.is_main {
            lockfile.overrides.parse_count(json, &mut string_builder);

            if let Some(workspaces_expr) = json.get(b"workspaces") {
                lockfile
                    .catalogs
                    .parse_count(workspaces_expr, &mut string_builder);
            }

            // Count catalog strings in top-level package.json as well, since parseAppend
            // might process them later if no catalogs were found in workspaces
            lockfile.catalogs.parse_count(json, &mut string_builder);

            install::postinstall_optimizer::PostinstallOptimizer::from_package_json(
                &mut pm.postinstall_optimizer,
                &json,
            )?;
        }

        string_builder.allocate()?;
        lockfile
            .buffers
            .dependencies
            .reserve(total_dependencies_count as usize);
        lockfile
            .buffers
            .resolutions
            .reserve(total_dependencies_count as usize);

        let off = lockfile.buffers.dependencies.len();
        let total_len = off + total_dependencies_count as usize;
        if cfg!(debug_assertions) {
            debug_assert!(
                lockfile.buffers.dependencies.len() == lockfile.buffers.resolutions.len()
            );
        }

        // PORT NOTE: Zig slices `lockfile.buffers.dependencies.items.ptr[off..total_len]`
        // — i.e. into reserved-but-uncommitted capacity *without* bumping `items.len`.
        // Mirroring that here matters: `parse_dependency` can return early with an error
        // (e.g. `InstallFailed` for a non-matching `workspace:` range), and the caller
        // may swallow it and re-enter for the next package. If we eagerly grow
        // `dependencies` and then bail, `dependencies.len() != resolutions.len()` on the
        // next call and the debug_assert above trips.
        //
        // Rather than `from_raw_parts_mut` over spare capacity (which yields a `&mut [T]`
        // to uninitialized memory — UB, and `Dependency` is not `Copy` so indexed
        // assignment would drop garbage), build into a local `Vec` and `append` into the
        // lockfile buffer once all `?`-points are past. On early error the local vec is
        // dropped and `lockfile.buffers.dependencies.len()` is left untouched, preserving
        // the `== resolutions.len()` invariant exactly as the Zig spare-capacity write
        // did. Capacity for the final `append` was reserved above so it does not realloc.
        let mut package_dependencies: Vec<Dependency> = Vec::with_capacity(total_len - off);

        'name: {
            if resolver.is_git() {
                if !resolver.new_name().is_empty() {
                    let new_name = resolver.take_new_name();
                    let external_string = string_builder.append::<ExternalString>(&new_name);
                    self.name = external_string.value;
                    self.name_hash = external_string.hash;
                    break 'name;
                }
            }

            if let Some(name_q) = json.as_property(b"name") {
                if let Some(name) = name_q.expr.as_utf8(&bump) {
                    if !name.is_empty() {
                        let external_string = string_builder.append::<ExternalString>(name);

                        self.name = external_string.value;
                        self.name_hash = external_string.hash;
                        break 'name;
                    }
                }
            }
        }

        if !FEATURES.is_main {
            if !resolver.is_void() {
                self.resolution = resolver.resolve(&mut string_builder, &json)?;
            }
        } else {
            self.resolution = Resolution::<u64>::init(TaggedValue::Root);
        }

        if let Some(patched_deps) = json.as_property(b"patchedDependencies") {
            if let ExprData::EObject(obj) = &patched_deps.expr.data {
                lockfile
                    .patched_dependencies
                    .ensure_total_capacity(obj.properties.len_u32() as usize)
                    .expect("unreachable");
                for prop in obj.properties.slice() {
                    let key = prop.key.expect("infallible: prop has key");
                    let value = prop.value.expect("infallible: prop has value");
                    if key.is_string() && value.is_string() {
                        // PERF(port): was stack-fallback
                        let keyhash =
                            semver::string::Builder::string_hash(key.as_utf8(&bump).unwrap());
                        let patch_path =
                            string_builder.append::<String>(value.as_utf8(&bump).unwrap());
                        lockfile
                            .patched_dependencies
                            .put(
                                keyhash,
                                PatchedDep {
                                    path: patch_path,
                                    ..Default::default()
                                },
                            )
                            .expect("unreachable");
                    }
                }
            }
        }

        'bin: {
            if let Some(bin) = json.as_property(b"bin") {
                match &bin.expr.data {
                    ExprData::EObject(obj) => {
                        match obj.properties.len_u32() {
                            0 => {}
                            1 => {
                                let first = &obj.properties.slice()[0];
                                let Some(bin_name) = first.key.unwrap().as_utf8(&bump) else {
                                    break 'bin;
                                };
                                let Some(value) = first.value.unwrap().as_utf8(&bump) else {
                                    break 'bin;
                                };

                                self.bin = Bin {
                                    tag: bin::Tag::NamedFile,
                                    value: bin::Value::init_named_file([
                                        string_builder.append::<String>(bin_name),
                                        string_builder.append::<String>(value),
                                    ]),
                                    ..Default::default()
                                };
                            }
                            _ => {
                                let current_len = lockfile.buffers.extern_strings.len();
                                let count = obj.properties.len_u32() as usize * 2;
                                lockfile.buffers.extern_strings.reserve_exact(count);
                                // Default-fill the tail; the loop below
                                // overwrites each slot. Keeps every exposed
                                // `ExternalString` valid even if `break 'bin`
                                // fires partway through (replaces raw
                                // `set_len`).
                                let extern_strings = bun_core::vec::grow_default(
                                    &mut lockfile.buffers.extern_strings,
                                    count,
                                );

                                let mut i: usize = 0;
                                for bin_prop in obj.properties.slice() {
                                    let Some(k) = bin_prop
                                        .key
                                        .expect("infallible: prop has key")
                                        .as_utf8(&bump)
                                    else {
                                        break 'bin;
                                    };
                                    extern_strings[i] = string_builder.append::<ExternalString>(k);
                                    i += 1;
                                    let Some(v) = bin_prop
                                        .value
                                        .expect("infallible: prop has value")
                                        .as_utf8(&bump)
                                    else {
                                        break 'bin;
                                    };
                                    extern_strings[i] = string_builder.append::<ExternalString>(v);
                                    i += 1;
                                }
                                if cfg!(debug_assertions) {
                                    debug_assert!(i == extern_strings.len());
                                }
                                // PORT NOTE: Zig passed the full extern_strings
                                // buffer + tail subslice; `init` only needs the
                                // tail's offset, so construct directly to avoid
                                // the aliasing borrow.
                                self.bin = Bin {
                                    tag: bin::Tag::Map,
                                    value: bin::Value {
                                        map: ExternalStringList::new(
                                            current_len as u32,
                                            extern_strings.len() as u32,
                                        ),
                                    },
                                    ..Default::default()
                                };
                            }
                        }

                        break 'bin;
                    }
                    ExprData::EString(stri) => {
                        if !stri.data.is_empty() {
                            self.bin = Bin {
                                tag: bin::Tag::File,
                                value: bin::Value {
                                    file: string_builder.append::<String>(&stri.data),
                                },
                                ..Default::default()
                            };
                            break 'bin;
                        }
                    }
                    _ => {}
                }
            }

            if let Some(dirs) = json.as_property(b"directories") {
                // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#directoriesbin
                // Because of the way the bin directive works,
                // specifying both a bin path and setting
                // directories.bin is an error. If you want to
                // specify individual files, use bin, and for all
                // the files in an existing bin directory, use
                // directories.bin.
                if let Some(bin_prop) = dirs.expr.as_property(b"bin") {
                    if let Some(str_) = bin_prop.expr.as_utf8(&bump) {
                        if !str_.is_empty() {
                            self.bin = Bin {
                                tag: bin::Tag::Dir,
                                value: bin::Value {
                                    dir: string_builder.append::<String>(str_),
                                },
                                ..Default::default()
                            };
                            break 'bin;
                        }
                    }
                }
            }
        }

        self.scripts.parse_alloc(&mut string_builder, json);
        self.scripts.filled = true;

        // It is allowed for duplicate dependencies to exist in optionalDependencies and regular dependencies
        if FEATURES.check_for_duplicate_dependencies {
            lockfile.scratch.duplicate_checker_map.clear();
            lockfile
                .scratch
                .duplicate_checker_map
                .reserve(total_dependencies_count as usize);
        }

        let mut bundled_deps = StringSet::init();
        // defer bundled_deps.deinit(); — Drop handles it
        let mut bundle_all_deps = false;
        if !resolver.is_void() && resolver.check_bundled_dependencies() {
            if let Some(bundled_deps_expr) = json
                .get(b"bundleDependencies")
                .or_else(|| json.get(b"bundledDependencies"))
            {
                match &bundled_deps_expr.data {
                    ExprData::EBoolean(boolean) => {
                        bundle_all_deps = boolean.value;
                    }
                    ExprData::EArray(arr) => {
                        for item in arr.slice() {
                            let Some(s) = item.as_utf8(&bump) else {
                                continue;
                            };
                            bundled_deps.insert(s)?;
                        }
                    }
                    _ => {}
                }
            }
        }

        total_dependencies_count = 0;

        // PERF(port): was `inline for` — profile in Phase B
        for group in &dependency_groups {
            if group.behavior.is_workspace() {
                let mut seen_workspace_names = TrustedDependenciesSet::default();
                // defer seen_workspace_names.deinit(allocator); — Drop handles it
                for (entry, path_) in workspace_names
                    .values()
                    .iter()
                    .zip(workspace_names.keys().iter())
                {
                    // workspace names from their package jsons. duplicates not allowed
                    let gop = seen_workspace_names
                        .get_or_put(semver::string::Builder::string_hash(&entry.name)
                            as TruncatedPackageNameHash)?;
                    if gop.found_existing {
                        // this path does alot of extra work to format the error message
                        // but this is ok because the install is going to fail anyways, so this
                        // has zero effect on the happy path.
                        let mut cwd_buf = PathBuffer::uninit();
                        // Zig `bun.getcwd` returned the slice; Rust port returns
                        // the byte length — slice the buffer ourselves.
                        let cwd_len = bun_sys::getcwd(&mut cwd_buf.0[..])?;
                        let cwd: &[u8] = &cwd_buf.0[..cwd_len];

                        let num_notes = 'count: {
                            let mut i: usize = 0;
                            for value in workspace_names.values() {
                                if strings::eql_long(&value.name, &entry.name, true) {
                                    i += 1;
                                }
                            }
                            break 'count i;
                        };
                        let notes = 'notes: {
                            let mut notes: Vec<bun_ast::Data> = Vec::with_capacity(num_notes);
                            let mut i: usize = 0;
                            for (value, note_path) in workspace_names
                                .values()
                                .iter()
                                .zip(workspace_names.keys().iter())
                            {
                                if note_path.as_ptr() == path_.as_ptr() {
                                    continue;
                                }
                                if strings::eql_long(&value.name, &entry.name, true) {
                                    let note_abs_path = bun_core::ZBox::from_bytes(
                                        resolve_path::join_abs_string_z::<path::platform::Auto>(
                                            cwd,
                                            &[note_path, b"package.json"],
                                        )
                                        .as_bytes(),
                                    );

                                    let note_src = match bun_ast::to_source(
                                        &note_abs_path,
                                        Default::default(),
                                    ) {
                                        Ok(s) => s,
                                        Err(_) => bun_ast::Source::init_empty_file(
                                            note_abs_path.as_bytes(),
                                        ),
                                    };

                                    // `Location::init_or_null` borrows `file` from
                                    // `note_src.path.text`, which itself borrows
                                    // `note_abs_path`; both drop before the log is
                                    // printed. `Location::clone` deep-copies `file`
                                    // into a `Cow::Owned`, matching the Zig
                                    // `allocator.dupeZ` lifetime.
                                    notes.push(bun_ast::Data {
                                        text: b"Package name is also declared here".to_vec().into(),
                                        location: bun_ast::Location::init_or_null(
                                            Some(&note_src),
                                            note_src.range_of_string(value.name_loc),
                                        )
                                        .as_ref()
                                        .cloned(),
                                        ..Default::default()
                                    });
                                    i += 1;
                                }
                            }
                            notes.truncate(i);
                            break 'notes notes;
                        };

                        let abs_path = bun_core::ZBox::from_bytes(
                            resolve_path::join_abs_string_z::<path::platform::Auto>(
                                cwd,
                                &[path_, b"package.json"],
                            )
                            .as_bytes(),
                        );

                        let src = match bun_ast::to_source(&abs_path, Default::default()) {
                            Ok(s) => s,
                            Err(_) => bun_ast::Source::init_empty_file(abs_path.as_bytes()),
                        };

                        let _ = log.add_range_error_fmt_with_notes(
                            Some(&src),
                            src.range_of_string(entry.name_loc),
                            notes.into(),
                            format_args!(
                                "Workspace name \"{}\" already exists",
                                bstr::BStr::new(&entry.name),
                            ),
                        );
                        return Err(bun_core::err!("InstallFailed"));
                    }

                    let external_name = string_builder.append::<ExternalString>(&entry.name);

                    let workspace_version = 'brk: {
                        if let Some(version_string) = &entry.version {
                            let external_version =
                                string_builder.append::<ExternalString>(version_string);
                            // allocator.free(version_string); — Drop handles it (Box<[u8]>)
                            let sliced = external_version
                                .value
                                .sliced(string_builder.string_bytes.as_slice());
                            let result = SemverVersion::parse(sliced);
                            if result.valid && result.wildcard == Wildcard::None {
                                break 'brk Some(result.version.min());
                            }
                        }

                        None
                    };

                    if let Some(dep_) = Self::parse_dependency(
                        &mut lockfile.workspace_paths,
                        &mut lockfile.workspace_versions,
                        &mut lockfile.scratch.duplicate_checker_map,
                        pm,
                        log,
                        source,
                        group,
                        &mut string_builder,
                        FEATURES,
                        package_dependencies.as_mut_slice(),
                        total_dependencies_count,
                        Some(dependency::version::Tag::Workspace),
                        workspace_version,
                        external_name,
                        path_,
                        bun_ast::Loc::EMPTY,
                        bun_ast::Loc::EMPTY,
                    )? {
                        let mut dep = dep_;
                        if group.behavior.is_peer()
                            && optional_peer_dependencies.swap_remove(&external_name.hash)
                        {
                            dep.behavior = dep.behavior.add(Behavior::OPTIONAL);
                        }

                        // `parse_dependency` was called with `Tag::Workspace`,
                        // so the workspace accessor's tag-check holds.
                        let ws_path = *dep.version.workspace();
                        package_dependencies.push(dep);
                        total_dependencies_count += 1;

                        lockfile.workspace_paths.put(external_name.hash, ws_path)?;
                        if let Some(version) = workspace_version {
                            lockfile
                                .workspace_versions
                                .put(external_name.hash, version)?;
                        }
                    }
                }
            } else {
                if let Some(dependencies_q) = json.as_property(group.prop) {
                    match &dependencies_q.expr.data {
                        ExprData::EObject(obj) => {
                            for item in obj.properties.slice() {
                                let key = item.key.expect("infallible: prop has key");
                                let value = item.value.expect("infallible: prop has value");
                                let external_name = string_builder
                                    .append::<ExternalString>(key.as_utf8(&bump).unwrap());
                                let version = value.as_utf8(&bump).unwrap_or(b"");

                                if let Some(dep_) = Self::parse_dependency(
                                    &mut lockfile.workspace_paths,
                                    &mut lockfile.workspace_versions,
                                    &mut lockfile.scratch.duplicate_checker_map,
                                    pm,
                                    log,
                                    source,
                                    group,
                                    &mut string_builder,
                                    FEATURES,
                                    package_dependencies.as_mut_slice(),
                                    total_dependencies_count,
                                    None,
                                    None,
                                    external_name,
                                    version,
                                    key.loc,
                                    value.loc,
                                )? {
                                    let mut dep = dep_;
                                    // swapRemove (not contains): drain names that
                                    // have a real `peerDependencies` entry so the
                                    // meta-only synthesis pass below only sees
                                    // names that appear *only* in
                                    // `peerDependenciesMeta`.
                                    if group.behavior.is_peer()
                                        && optional_peer_dependencies
                                            .swap_remove(&external_name.hash)
                                    {
                                        dep.behavior.insert(Behavior::OPTIONAL);
                                    }

                                    if bundle_all_deps
                                        || bundled_deps.contains(
                                            dep.name.slice(string_builder.string_bytes.as_slice()),
                                        )
                                    {
                                        dep.behavior.insert(Behavior::BUNDLED);
                                    }

                                    package_dependencies.push(dep);
                                    total_dependencies_count += 1;
                                }
                            }
                        }
                        _ => unreachable!(),
                    }
                }
            }
        }

        // Anything left in `optional_peer_dependencies` was listed only in
        // `peerDependenciesMeta`. Synthesise an optional peer dep with
        // version `"*"` so resolution can pick up a sibling install when
        // one exists (matching pnpm/yarn). Webpack relies on this for
        // `webpack-cli`, which it lists in meta but not in
        // `peerDependencies`.
        let mut meta_only = optional_peer_dependencies.iterator();
        while let Some(entry) = meta_only.next() {
            let external_name = string_builder.append::<ExternalString>(*entry.value_ptr);
            if let Some(dep_) = Self::parse_dependency(
                &mut lockfile.workspace_paths,
                &mut lockfile.workspace_versions,
                &mut lockfile.scratch.duplicate_checker_map,
                pm,
                log,
                source,
                &DependencyGroup::PEER,
                &mut string_builder,
                FEATURES,
                package_dependencies.as_mut_slice(),
                total_dependencies_count,
                None,
                None,
                external_name,
                b"*",
                bun_ast::Loc::EMPTY,
                bun_ast::Loc::EMPTY,
            )? {
                let mut dep = dep_;
                dep.behavior.insert(Behavior::OPTIONAL);
                package_dependencies.push(dep);
                total_dependencies_count += 1;
            }
        }

        debug_assert_eq!(
            package_dependencies.len(),
            total_dependencies_count as usize
        );
        {
            let buf = string_builder.string_bytes.as_slice();
            package_dependencies.sort_by(|a, b| dep_sort_cmp(buf, a, b));
        }

        self.dependencies.off = off as u32;
        self.dependencies.len = total_dependencies_count as u32;

        // PackageIDSlice and DependencySlice are both `ExternalSlice<_>` — same
        // `{off: u32, len: u32}` window into different backing buffers.
        self.resolutions =
            lockfile::PackageIDSlice::new(self.dependencies.off, self.dependencies.len);

        // Prior len == `off` (asserted above), so `resize` fills exactly
        // `[off..total_len]` — equivalent to the old `set_len` + `fill`.
        lockfile
            .buffers
            .resolutions
            .resize(total_len, invalid_package_id);

        let new_len = off + total_dependencies_count as usize;
        // Capacity for `[off..total_len]` was reserved above; `append` is a
        // single memcpy into it (no realloc). All `?`-points are past, so the
        // `dependencies.len() == resolutions.len()` invariant is committed
        // together with the `resolutions` resize/truncate that brackets this.
        debug_assert_eq!(lockfile.buffers.dependencies.len(), off);
        lockfile
            .buffers
            .dependencies
            .append(&mut package_dependencies);
        debug_assert_eq!(lockfile.buffers.dependencies.len(), new_len);
        lockfile.buffers.resolutions.truncate(new_len);

        // This function depends on package.dependencies being set, so it is done at the very end.
        if FEATURES.is_main {
            lockfile.overrides.parse_append(
                pm,
                lockfile.buffers.dependencies.as_slice(),
                self,
                log,
                source,
                json,
                &mut string_builder,
            )?;

            let mut found_any_catalog_or_catalog_object = false;
            let mut has_workspaces = false;
            if let Some(workspaces_expr) = json.get(b"workspaces") {
                found_any_catalog_or_catalog_object = lockfile.catalogs.parse_append(
                    pm,
                    log,
                    source,
                    workspaces_expr,
                    &mut string_builder,
                )?;
                has_workspaces = true;
            }

            // `"workspaces"` being an object instead of an array is sometimes
            // unexpected to people. therefore if you also are using workspaces,
            // allow "catalog" and "catalogs" in top-level "package.json"
            // so it's easier to guess.
            if !found_any_catalog_or_catalog_object && has_workspaces {
                let _ =
                    lockfile
                        .catalogs
                        .parse_append(pm, log, source, json, &mut string_builder)?;
            }
        }

        string_builder.clamp();
        Ok(())
    }
}

pub type List<SemverIntType> = MultiArrayList<Package<SemverIntType>>;

// ─── Serializer ──────────────────────────────────────────────────────────────

pub mod serializer {
    use super::*;

    /// Number of columns in the on-disk package table. Zig: `sizes.Types.len`.
    pub const FIELD_COUNT: usize = PackageField::ALL.len();

    // Zig: comptime block computing per-field sizes/indices sorted by alignment
    // (descending) via `@typeInfo`/`std.meta.fields`. Rust has no struct
    // reflection, so the 8 fields are hand-expanded and the same stable
    // insertion sort is reproduced at call time. (`Types` is dropped — Rust
    // can't store a `[type; N]`, and the only consumer was `AlignmentType`,
    // which is unused on the load/save paths we port.)
    pub struct Sizes {
        pub bytes: [usize; FIELD_COUNT],
        pub fields: [usize; FIELD_COUNT],
    }

    /// Port of Package.zig `Serializer.sizes` comptime block, evaluated per
    /// `SemverIntType` instantiation.
    pub fn sizes<SemverIntType: VersionInt>() -> Sizes {
        #[derive(Copy, Clone)]
        struct Data {
            size: usize,
            size_index: usize,
            alignment: usize,
        }

        macro_rules! entry {
            ($i:expr, $T:ty) => {
                Data {
                    size: mem::size_of::<$T>(),
                    size_index: $i,
                    alignment: if mem::size_of::<$T>() == 0 {
                        1
                    } else {
                        mem::align_of::<$T>()
                    },
                }
            };
        }
        // Declaration order — must match `struct Package` field order exactly.
        let mut data: [Data; FIELD_COUNT] = [
            entry!(0, String),
            entry!(1, PackageNameHash),
            entry!(2, ResolutionType<SemverIntType>),
            entry!(3, DependencySlice),
            entry!(4, PackageIDSlice),
            entry!(5, Meta),
            entry!(6, Bin),
            entry!(7, Scripts),
        ];
        // Stable insertion sort, key = alignment descending (Zig:
        // `std.sort.insertionContext` with `lessThan = lhs.align > rhs.align`).
        let mut i = 1;
        while i < FIELD_COUNT {
            let mut j = i;
            while j > 0 && data[j].alignment > data[j - 1].alignment {
                data.swap(j, j - 1);
                j -= 1;
            }
            i += 1;
        }
        let mut bytes = [0usize; FIELD_COUNT];
        let mut fields = [0usize; FIELD_COUNT];
        let mut k = 0;
        while k < FIELD_COUNT {
            bytes[k] = data[k].size;
            fields[k] = data[k].size_index;
            k += 1;
        }
        Sizes { bytes, fields }
    }

    // Zig: `const FieldsEnum = @typeInfo(List.Field).@"enum";`
    // → `PackageField::ALL` (declaration order, same as the MultiArrayList
    //    field enum Zig reflects over).

    pub fn byte_size<SemverIntType: VersionInt>(list: &List<SemverIntType>) -> usize {
        // Zig used a SIMD @Vector reduction over `sizes.bytes`; equivalent
        // scalar dot-product. Order is irrelevant for the sum, so use the
        // declaration-order size table directly.
        // PERF(port): comptime @Vector reduce — profile in Phase B.
        let len = list.len();
        let mut sum: usize = 0;
        for fi in 0..FIELD_COUNT {
            let sz =
                bun_collections::multi_array_list::Slice::<Package<SemverIntType>>::field_size(fi);
            sum += sz * len;
        }
        sum
    }

    // Zig: `const AlignmentType = sizes.Types[sizes.fields[0]];`
    // Unused by save/load (the live aligner uses `@TypeOf(list.bytes)`), so
    // it is intentionally not ported.

    pub fn save<SemverIntType: VersionInt, S>(
        list: &List<SemverIntType>,
        stream: &mut S,
    ) -> Result<(), bun_core::Error>
    where
        // PORT NOTE: Zig threaded a separate `stream` (anytype) and `writer` over
        // the same buffer. Two `&mut` to one object is UB in Rust regardless of
        // access order, so the port collapses both roles onto one type —
        // `Serializer::StreamType` impls both `PositionalStream` and
        // `bun_io::Write`.
        S: PositionalStream + bun_io::Write,
    {
        // TODO(port): narrow error set
        stream.write_int_le::<u64>(list.len() as u64)?;
        // TODO(port): @alignOf(@TypeOf(list.bytes)) — needs concrete type from MultiArrayList.
        stream.write_int_le::<u64>(mem::align_of::<*mut u8>() as u64)?;
        stream.write_int_le::<u64>(FIELD_COUNT as u64)?;
        let begin_at = stream.get_pos()?;
        stream.write_int_le::<u64>(0)?;
        let end_at = stream.get_pos()?;
        stream.write_int_le::<u64>(0)?;

        // TODO(port): Aligner.write needs the bytes-pointer alignment type.
        let pos = stream.get_pos()? as u64;
        let _ = Aligner::write::<*mut u8, _>(&mut *stream, pos)?;

        let really_begin_at = stream.get_pos()?;
        let mut sliced = list.slice();

        // PERF(port): was `inline for (FieldsEnum.fields)` — profile in Phase B
        for field in PackageField::ALL {
            // SAFETY: each `PackageField` discriminant corresponds to a column
            // whose element size matches `SIZES_BYTES[field as usize]`; we
            // address the column as raw bytes for serialisation.
            let bytes: &[u8] = unsafe {
                let n = list.len();
                let sz =
                    bun_collections::multi_array_list::Slice::<Package<SemverIntType>>::field_size(
                        field as usize,
                    );
                {
                    let _ = sz;
                    &*sliced.column_bytes_mut(field as usize)
                }
            };
            #[cfg(debug_assertions)]
            {
                bun_output::scoped_log!(
                    Lockfile,
                    "save(\"{}\") = {} bytes",
                    bstr::BStr::new(field.name()),
                    bytes.len(),
                );
            }
            // TODO(port): assert_no_uninitialized_padding once a typed accessor
            // is exposed; for now `Package`'s field types are all `#[repr(C)]`
            // with explicit padding zeroed by their `Default`/`init` paths.
            if matches!(field, PackageField::Resolution) {
                // copy each resolution to make sure the union is zero initialized
                let resolutions: &[Resolution<SemverIntType>] =
                    unsafe { sliced.items::<"resolution", Resolution<SemverIntType>>() };
                for val in resolutions {
                    // `ResolutionType::copy` builds a fresh zero-initialised
                    // `Resolution` and writes only the active union member,
                    // matching Zig `val.copy()`. A bare `*val` would serialise
                    // garbage in the inactive union bytes (non-deterministic
                    // lockfile output).
                    let copy = val.copy();
                    // SAFETY: Resolution is #[repr(C)] POD; reading raw bytes is sound.
                    stream.write_all(unsafe {
                        bun_core::ffi::slice(
                            (&raw const copy).cast::<u8>(),
                            mem::size_of_val(&copy),
                        )
                    })?;
                }
            } else {
                stream.write_all(bytes)?;
            }
        }

        let really_end_at = stream.get_pos()?;

        let _ = stream.pwrite(&really_begin_at.to_ne_bytes(), begin_at);
        let _ = stream.pwrite(&really_end_at.to_ne_bytes(), end_at);
        Ok(())
    }

    #[derive(Default)]
    pub struct PackagesLoadResult<SemverIntType: VersionInt> {
        pub list: List<SemverIntType>,
        pub needs_update: bool,
    }

    // PORT NOTE: Zig parameterised on `SemverIntType`, but the v2-migration arm
    // below hard-codes `u32 → u64` (`VersionedURL.migrate()` returns `<u64>`).
    // The only caller (`bun.lockb.rs`) instantiates at `u64`, so bind concretely
    // instead of carrying a phantom generic that can't typecheck the migrate arm.
    pub fn load(
        stream: &mut Stream,
        end: usize,
        migrate_from_v2: bool,
    ) -> Result<PackagesLoadResult<u64>, bun_core::Error> {
        type SemverIntType = u64;
        // TODO(port): narrow error set
        let mut reader = stream.reader();

        let list_len = reader.read_int_le::<u64>()?;
        if list_len > u32::MAX as u64 - 1 {
            return Err(bun_core::err!(
                "Lockfile validation failed: list is impossibly long"
            ));
        }

        let input_alignment = reader.read_int_le::<u64>()?;

        let mut list = List::<SemverIntType>::default();

        // TODO(port): @alignOf(@TypeOf(list.bytes)) — needs MultiArrayList bytes ptr type.
        let expected_alignment = mem::align_of::<*mut u8>() as u64;
        if expected_alignment != input_alignment {
            return Err(bun_core::err!(
                "Lockfile validation failed: alignment mismatch"
            ));
        }

        let field_count = reader.read_int_le::<u64>()? as usize;
        match field_count {
            FIELD_COUNT => {}
            // "scripts" field is absent before v0.6.8
            // we will back-fill from each package.json
            n if n == FIELD_COUNT - 1 => {}
            _ => {
                return Err(bun_core::err!(
                    "Lockfile validation failed: unexpected number of package fields"
                ));
            }
        }

        let begin_at = reader.read_int_le::<u64>()? as usize;
        let end_at = reader.read_int_le::<u64>()? as usize;
        if begin_at > end || end_at > end || begin_at > end_at {
            return Err(bun_core::err!(
                "Lockfile validation failed: invalid package list range"
            ));
        }
        stream.pos = begin_at;
        list.ensure_total_capacity(list_len as usize)?;

        let mut needs_update = false;
        if migrate_from_v2 {
            type OldPackageV2 = Package<u32>;
            let mut list_for_migrating_from_v2 = <List<u32>>::default();
            // defer list_for_migrating_from_v2.deinit(allocator); — Drop handles it

            list_for_migrating_from_v2.ensure_total_capacity(list_len as usize)?;
            // SAFETY: capacity reserved above; `load_fields` writes every column.
            unsafe { list_for_migrating_from_v2.set_len(list_len as usize) };

            load_fields::<u32>(
                stream,
                end_at as u64,
                &mut list_for_migrating_from_v2,
                &mut needs_update,
            )?;

            for pkg_id_ in 0..list_for_migrating_from_v2.len() {
                let pkg_id: PackageID = PackageID::try_from(pkg_id_).expect("int cast");
                let _ = pkg_id;
                let old: OldPackageV2 = *list_for_migrating_from_v2.get(pkg_id_);
                let new = Package::<SemverIntType> {
                    name: old.name,
                    name_hash: old.name_hash,
                    meta: old.meta,
                    bin: old.bin,
                    dependencies: old.dependencies,
                    resolutions: old.resolutions,
                    scripts: old.scripts,
                    resolution: match old.resolution.tag {
                        ResolutionTag::Uninitialized => {
                            Resolution::init(TaggedValue::Uninitialized)
                        }
                        ResolutionTag::Root => Resolution::init(TaggedValue::Root),
                        ResolutionTag::Npm => {
                            Resolution::init(TaggedValue::Npm(old.resolution.npm().migrate()))
                        }
                        ResolutionTag::Folder => {
                            Resolution::init(TaggedValue::Folder(*old.resolution.folder()))
                        }
                        ResolutionTag::LocalTarball => Resolution::init(TaggedValue::LocalTarball(
                            *old.resolution.local_tarball(),
                        )),
                        ResolutionTag::Github => {
                            Resolution::init(TaggedValue::Github(*old.resolution.github()))
                        }
                        ResolutionTag::Git => {
                            Resolution::init(TaggedValue::Git(*old.resolution.git()))
                        }
                        ResolutionTag::Symlink => {
                            Resolution::init(TaggedValue::Symlink(*old.resolution.symlink()))
                        }
                        ResolutionTag::Workspace => {
                            Resolution::init(TaggedValue::Workspace(*old.resolution.workspace()))
                        }
                        ResolutionTag::RemoteTarball => Resolution::init(
                            TaggedValue::RemoteTarball(*old.resolution.remote_tarball()),
                        ),
                        ResolutionTag::SingleFileModule => Resolution::init(
                            TaggedValue::SingleFileModule(*old.resolution.single_file_module()),
                        ),
                        _ => Resolution::init(TaggedValue::Uninitialized),
                    },
                };

                // PERF(port): was assume_capacity
                list.append(new)?;
            }
        } else {
            // SAFETY: capacity reserved above; `load_fields` writes every column.
            unsafe { list.set_len(list_len as usize) };
            load_fields::<SemverIntType>(stream, end_at as u64, &mut list, &mut needs_update)?;
        }

        Ok(PackagesLoadResult { list, needs_update })
    }

    fn load_fields<SemverIntType: VersionInt>(
        stream: &mut Stream,
        end_at: u64,
        list: &mut List<SemverIntType>,
        needs_update: &mut bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let n = list.len();
        let mut sliced = list.slice();

        // PERF(port): was `inline for (FieldsEnum.fields)` — profile in Phase B
        for field in PackageField::ALL {
            let sz = bun_collections::multi_array_list::Slice::<Package<SemverIntType>>::field_size(
                field as usize,
            );
            // SAFETY: `items_raw` returns a column pointer with `n` elements of
            // `sz` bytes each; the byte view is used solely for memcpy from the
            // serialised lockfile stream.
            let bytes: &mut [u8] = unsafe {
                {
                    let _ = sz;
                    sliced.column_bytes_mut(field as usize)
                }
            };
            // TODO(port): assert_no_uninitialized_padding once a typed accessor lands.
            let end_pos = stream.pos + bytes.len();
            if end_pos as u64 <= end_at {
                bytes.copy_from_slice(&stream.buffer[stream.pos..stream.pos + bytes.len()]);
                stream.pos = end_pos;
                if matches!(field, PackageField::Meta) {
                    // need to check if any values were created from an older version of bun
                    // (currently just `has_install_script`). If any are found, the values need
                    // to be updated before saving the lockfile.
                    let metas: &mut [Meta] = unsafe { sliced.items_mut::<"meta", Meta>() };
                    for meta in metas {
                        if meta.needs_update() {
                            *needs_update = true;
                            break;
                        }
                    }
                }
            } else if matches!(field, PackageField::Scripts) {
                bytes.fill(0);
            } else {
                return Err(bun_core::err!(
                    "Lockfile validation failed: invalid package list range"
                ));
            }
        }
        Ok(())
    }
}

pub use serializer as Serializer;

// ported from: src/install/lockfile/Package.zig
