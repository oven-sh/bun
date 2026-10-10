//! `packageExtensions`: graft extra dependency edges onto registry packages
//! whose own manifest is missing them (the yarn / pnpm feature of the same
//! name; parsed shape lives in `bun_install_types::PackageExtensions`).
//!
//! Applied to npm-resolved packages in two places so the lockfile always
//! carries the configured edges:
//!
//! - right after a package is created from a registry manifest
//!   (`Package::from_npm` -> `apply_package_extensions_to`), and
//! - to every package of a lockfile that was just loaded from disk
//!   (`apply_package_extensions`), so adding an extension to the config takes
//!   effect on the next install without re-resolving anything else.
//!
//! An injected edge is an ordinary `Dependency` in the package's dependency
//! list with no resolution yet; it is resolved, installed and written to
//! `bun.lock` exactly like a dependency the package declared itself. Edges the
//! package already declares are never touched (declared wins), which is also
//! what makes a lockfile that already recorded the injected edges stable under
//! `--frozen-lockfile`.

use bun_semver::{self as semver, ExternalString, String as SemverString};

use crate::bun_schema::api::PackageExtension;
use crate::dependency::{Behavior, DependencyExt as _};
use crate::lockfile_real::package::PackageColumns as _;
use crate::lockfile_real::{self as lockfile, DependencySlice, Lockfile, PackageIDSlice};
use crate::package_manager_real::workspace_package_json_cache::GetResult as WorkspacePackageJsonCacheResult;
use crate::resolution_real::Tag as ResolutionTag;
use crate::{Dependency, DependencyID, PackageID, PackageManager, invalid_package_id};
use bun_install_types::NodeLinker::FromExprError;
use bun_install_types::PackageExtensions::{
    Strictness, parse_from_expr as parse_package_extensions,
};

/// Does `range` (extension key suffix, `""`/`"*"` = any) admit `version`?
/// `parse_from_expr` already rejected keys whose range does not parse.
fn range_matches(range: &[u8], version: semver::Version, version_buf: &[u8]) -> bool {
    if range.is_empty() || range == b"*" {
        return true;
    }
    let query = semver::query::parse(range, semver::SlicedString::init(range, range))
        .unwrap_or_else(|_| bun_core::out_of_memory());
    !query.is_empty() && query.satisfies(version, range, version_buf)
}

impl PackageManager {
    /// Append the root `package.json`'s `packageExtensions` and, pnpm-style,
    /// `pnpm.packageExtensions` to `options.package_extensions`, after the
    /// ones bunfig contributed (replacing any read by an earlier call).
    /// Malformed entries warn and are skipped.
    pub(crate) fn load_package_extensions_from_package_json(
        &mut self,
        root_package_json_path: &[u8],
    ) -> crate::Result<()> {
        self.options
            .package_extensions
            .truncate(self.options.package_extensions_from_bunfig);
        let log = self.log_mut();
        // This runs before the paths that report a missing/unparsable root
        // package.json (and exit). A failed read is not cached, so those paths
        // read it again: parse into a scratch log and only keep its messages
        // when the read succeeds, otherwise the parse error would print twice.
        let mut scratch_log = bun_ast::Log::init();
        scratch_log.level = log.level;
        let WorkspacePackageJsonCacheResult::Entry(entry) = self
            .workspace_package_json_cache
            .get_with_path(&mut scratch_log, root_package_json_path, Default::default())
        else {
            return Ok(());
        };
        scratch_log.append_to_maybe_recycled(log, &entry.source);
        // Top-level first, then pnpm's namespaced field; both are read.
        let sources = [
            entry.root.get(b"packageExtensions"),
            entry
                .root
                .get(b"pnpm")
                .and_then(|pnpm| pnpm.get(b"packageExtensions")),
        ];
        for expr in sources.into_iter().flatten() {
            match parse_package_extensions(
                &mut self.options.package_extensions,
                &expr,
                log,
                &entry.source,
                Strictness::Warn,
            ) {
                Ok(()) | Err(FromExprError::UnexpectedExpr) => {}
                Err(FromExprError::OutOfMemory) => {
                    return Err(crate::Error::Alloc(bun_alloc::AllocError));
                }
            }
        }
        Ok(())
    }
}

impl Lockfile {
    /// Append the edges of every extension matching `package_id` (an
    /// npm-resolved package) that the package does not already declare.
    /// Returns how many edges were added; their ids are pushed to `added_ids`
    /// when given.
    pub(crate) fn apply_package_extensions_to(
        &mut self,
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        extensions: &[PackageExtension],
        package_id: PackageID,
        added_ids: Option<&mut Vec<DependencyID>>,
    ) -> crate::Result<u32> {
        if extensions.is_empty() {
            return Ok(0);
        }
        let idx = package_id as usize;
        let resolution = self.packages.items_resolution()[idx];
        if resolution.tag != ResolutionTag::Npm {
            return Ok(0);
        }
        let version = resolution.npm().version;

        // Which edges to add: matching extensions, minus names the package (or
        // an earlier extension) already declares. `to_add` borrows from
        // `extensions`, not from `self`, so the lockfile can be mutated below.
        let mut to_add: Vec<(&[u8], &[u8], Behavior, u64)> = Vec::new();
        // For diagnostics; borrowed from the matching extension, not `self`.
        let mut package_name: &[u8] = b"";
        {
            let buf = self.buffers.string_bytes.as_slice();
            let name = self.packages.items_name()[idx].slice(buf);
            let existing: &[Dependency] =
                self.packages.items_dependencies()[idx].get(self.buffers.dependencies.as_slice());
            for extension in extensions {
                if *extension.name != *name || !range_matches(&extension.range, version, buf) {
                    continue;
                }
                package_name = &extension.name;
                for dep in &extension.dependencies {
                    let hash = semver::string::Builder::string_hash(&dep.name);
                    if existing.iter().any(|d| d.name_hash == hash)
                        || to_add.iter().any(|(_, _, _, h)| *h == hash)
                    {
                        continue;
                    }
                    to_add.push((&dep.name, &dep.version, dep.behavior, hash));
                }
            }
        }
        if to_add.is_empty() {
            return Ok(0);
        }

        // Strings first (count -> allocate -> append), then the `Dependency`
        // values, parsed like a manifest entry in `Package::from_npm` (except
        // that an unparseable version is warned about and the edge skipped).
        let mut new_deps: Vec<Dependency> = Vec::with_capacity(to_add.len());
        {
            let mut builder = crate::string_builder!(self);
            for (name, version, _, _) in &to_add {
                builder.count(name);
                builder.count(version);
            }
            builder.allocate()?;
            for (name_text, version_text, behavior, hash) in &to_add {
                let name: ExternalString =
                    builder.append_with_hash::<ExternalString>(name_text, *hash);
                let version: SemverString = builder.append::<SemverString>(version_text);
                let sliced = version.sliced(builder.string_bytes.as_slice());
                let Some(version) = Dependency::parse(
                    name.value,
                    Some(name.hash),
                    sliced.slice,
                    &sliced,
                    Some(&mut *log),
                    Some(&mut *pm),
                ) else {
                    log.add_warning_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "packageExtensions: ignoring \"{}\": \"{}\" for {}, invalid dependency version",
                            bstr::BStr::new(name_text),
                            bstr::BStr::new(version_text),
                            bstr::BStr::new(package_name),
                        ),
                    );
                    continue;
                };
                let mut dependency = Dependency {
                    name: name.value,
                    name_hash: name.hash,
                    behavior: *behavior,
                    version,
                };
                lockfile::CatalogMap::strip_reference(&mut dependency);
                new_deps.push(dependency);
            }
            builder.clamp();
        }
        if new_deps.is_empty() {
            return Ok(0);
        }

        // Splice into the package's dependency slice. When the slice is the
        // tail of the buffer (a package that was just appended) this is an
        // in-place extend; otherwise the slice is first relocated to the end
        // (the old rows become unreferenced garbage that `clean()` drops, the
        // same thing the root package's re-layout in `install_with_manager`
        // does). Each edge is appended to the end of its own group so the list
        // keeps the `dependencies, optionalDependencies, peerDependencies`
        // order `from_npm` produces and a reload from `bun.lock` reproduces.
        let DependencySlice { off, len, .. } = self.packages.items_dependencies()[idx];
        let (off, len) = (off as usize, len as usize);
        let deps = &mut self.buffers.dependencies;
        let ress = &mut self.buffers.resolutions;
        debug_assert_eq!(deps.len(), ress.len());
        let new_off = if off + len == deps.len() {
            off
        } else {
            let start = deps.len();
            deps.extend_from_within(off..off + len);
            ress.extend_from_within(off..off + len);
            start
        };
        let group = |d: &Dependency| -> u8 {
            if d.behavior.is_peer() {
                2
            } else if d.behavior.is_optional() {
                1
            } else {
                0
            }
        };
        // Insertion points (relative to `new_off`): the end of the prod group
        // and the end of the optional group. Peers are simply pushed.
        let existing = &deps[new_off..new_off + len];
        let mut group_end = [
            existing.iter().filter(|d| group(d) == 0).count(),
            existing.iter().filter(|d| group(d) <= 1).count(),
        ];
        let added = new_deps.len();
        for dependency in new_deps {
            let g = group(&dependency) as usize;
            if g == 2 {
                deps.push(dependency);
                ress.push(invalid_package_id);
                continue;
            }
            let at = new_off + group_end[g];
            deps.insert(at, dependency);
            ress.insert(at, invalid_package_id);
            for end in &mut group_end[g..] {
                *end += 1;
            }
        }
        let new_len = u32::try_from(len + added).expect("int cast");
        let new_off = u32::try_from(new_off).expect("int cast");
        self.packages.items_dependencies_mut()[idx] = DependencySlice::new(new_off, new_len);
        self.packages.items_resolutions_mut()[idx] = PackageIDSlice::new(new_off, new_len);

        if let Some(ids) = added_ids {
            for (i, dependency) in deps[new_off as usize..(new_off + new_len) as usize]
                .iter()
                .enumerate()
            {
                if to_add
                    .iter()
                    .any(|(_, _, _, hash)| *hash == dependency.name_hash)
                {
                    ids.push(new_off + u32::try_from(i).expect("int cast"));
                }
            }
        }
        Ok(u32::try_from(added).expect("int cast"))
    }

    /// Apply `extensions` to every package currently in the lockfile (right
    /// after it was loaded from disk). Returns the ids of the injected,
    /// still-unresolved edges so the caller can enqueue them: their owners are
    /// not new packages, so nothing else would walk their dependency lists.
    pub(crate) fn apply_package_extensions(
        &mut self,
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        extensions: &[PackageExtension],
    ) -> crate::Result<Vec<DependencyID>> {
        let mut added_ids: Vec<DependencyID> = Vec::new();
        if extensions.is_empty() {
            return Ok(added_ids);
        }
        let len = u32::try_from(self.packages.len()).expect("int cast");
        for package_id in 0..len {
            self.apply_package_extensions_to(
                pm,
                log,
                extensions,
                package_id,
                Some(&mut added_ids),
            )?;
        }
        Ok(added_ids)
    }
}
