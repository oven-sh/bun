use core::cell::Cell;
use core::cmp::Ordering;

use bun_collections::index_sort;
use bun_core::{Output, strings};
use bun_semver::{ExternalString, String as SemverString};

use crate::bun_json::Expr;
use crate::lockfile_real::StringBuilder;
use crate::lockfile_real::package::{Package, PackageColumns, ResolverContext};
use crate::package_manager_real::options::LogLevel;
use crate::package_manager_real::{PackageManager, enqueue};
use crate::repository_real::RepositoryExt as _;
use crate::resolution::{ResolutionType, Tag as ResolutionTag, TaggedValue};
use crate::{
    DependencyID, ExtractData, Features, INVALID_PACKAGE_ID, PackageID, Resolution,
    TaskCallbackContext, dependency,
};

// ──────────────────────────────────────────────────────────────────────────
// GitResolver
// ──────────────────────────────────────────────────────────────────────────

pub struct GitResolver<'a> {
    pub(crate) resolved: &'a [u8],
    pub(crate) resolution: &'a Resolution,
    /// Copied out of the lockfile string buffer, which parsing appends to.
    pub(crate) fallback_name: &'a [u8],
}

impl<'a> ResolverContext for GitResolver<'a> {
    fn check_bundled_dependencies(&self) -> bool {
        true
    }

    fn count(&mut self, builder: &mut StringBuilder<'_>, _json: &Expr) {
        builder.count(self.resolved);
    }

    fn resolve(
        &mut self,
        builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> Result<ResolutionType<u64>, crate::Error> {
        // `git` and `github` share the `Repository` payload in the value union,
        // so writing through `.github` is correct for both tags.
        // SAFETY: caller guarantees `tag` is `.git` or `.github` (see
        // `process_extracted_tarball_package`); both store a `Repository`.
        let mut repo = *self.resolution.repository();
        repo.resolved = builder.append::<SemverString>(self.resolved);
        Ok(ResolutionType::init(match self.resolution.tag {
            ResolutionTag::Git => TaggedValue::Git(repo),
            ResolutionTag::Github => TaggedValue::Github(repo),
            // Only constructed inside the `.git | .github` arm of
            // `process_extracted_tarball_package`; any other tag is a bug.
            _ => unreachable!(),
        }))
    }

    fn fallback_name(&self) -> Option<Vec<u8>> {
        Some(self.fallback_name.to_vec())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TarballResolver
// ──────────────────────────────────────────────────────────────────────────

struct TarballResolver<'a> {
    url: &'a [u8],
    resolution: &'a Resolution,
}

impl<'a> ResolverContext for TarballResolver<'a> {
    fn check_bundled_dependencies(&self) -> bool {
        true
    }

    fn count(&mut self, builder: &mut StringBuilder<'_>, _json: &Expr) {
        builder.count(self.url);
    }

    fn resolve(
        &mut self,
        builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> Result<ResolutionType<u64>, crate::Error> {
        Ok(ResolutionType::<u64>::init(match self.resolution.tag {
            ResolutionTag::LocalTarball => {
                TaggedValue::LocalTarball(builder.append::<SemverString>(self.url))
            }
            ResolutionTag::RemoteTarball => {
                TaggedValue::RemoteTarball(builder.append::<SemverString>(self.url))
            }
            _ => unreachable!(),
        }))
    }

    fn fallback_name(&self) -> Option<Vec<u8>> {
        Some(dependency::fallback_package_name(self.url).to_vec())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PackageManager impl
// ──────────────────────────────────────────────────────────────────────────

impl PackageManager {
    /// Appends `package` and queues its dependencies, or reuses one of its name and resolution.
    fn append_extracted_package(
        &mut self,
        mut package: Package,
        data: &ExtractData,
        package_id: &mut PackageID,
    ) -> Package {
        if let Some(existing_id) =
            self.lockfile
                .get_package_id(package.name_hash, None, &package.resolution)
        {
            *package_id = existing_id;
            let mut existing = *self.lockfile.packages.get(existing_id as usize);
            let from_lockfile = existing_id < self.lockfile.loaded_package_count;
            let moved = match existing.resolution.tag {
                // A nested git ref can move, so `bun update` resolves the dependencies again.
                ResolutionTag::Git | ResolutionTag::Github => self.to_update,
                // Only `repins_tarball` reads one again that bun.lock has.
                ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                    existing.meta.integrity != data.integrity
                }
                _ => false,
            };
            if !(from_lockfile && moved) {
                return existing;
            }
            if existing.resolution.tag.is_tarball() && existing.meta.integrity.tag.is_supported() {
                let name = self.lockfile.str(&existing.name).to_vec();
                self.log_mut().add_warning_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "\"{}\" has changed: bun.lock recorded {}, now {}",
                        bstr::BStr::new(&name),
                        existing.meta.integrity,
                        data.integrity,
                    ),
                );
            }
            existing.dependencies = package.dependencies;
            existing.resolutions = package.resolutions;
            existing.bin = package.bin;
            if data.integrity.tag.is_supported() {
                existing.meta.integrity = data.integrity;
            }
            self.lockfile.packages.set(existing_id as usize, existing);
            package = existing;
        } else {
            // The lockfile pins the content that the server sent.
            if data.integrity.tag.is_supported() {
                package.meta.integrity = data.integrity;
            }
            package = self.lockfile.append_package(&package).expect("unreachable");
            *package_id = package.meta.id;
        }

        if package.dependencies.len > 0 {
            bun_core::handle_oom(
                self.lockfile
                    .scratch
                    .dependency_list_queue
                    .write_item(package.dependencies),
            );
        }

        package
    }

    /// Returns true if we need to drain dependencies
    pub(crate) fn process_extracted_tarball_package(
        &mut self,
        package_id: &mut PackageID,
        resolution: &Resolution,
        data: &ExtractData,
        log_level: LogLevel,
    ) -> Option<Package> {
        match resolution.tag {
            ResolutionTag::Git | ResolutionTag::Github => {
                let package = 'package: {
                    let fallback_name: Vec<u8> = resolution
                        .repository()
                        .fallback_package_name(self.lockfile.buffers.string_bytes.as_slice())
                        .to_vec();
                    let mut resolver = GitResolver {
                        resolved: &data.resolved,
                        resolution,
                        fallback_name: &fallback_name,
                    };

                    let mut pkg = Package::default();
                    if let Some(json) = &data.json {
                        let package_json_source =
                            &bun_ast::Source::init_path_string(&json.path[..], &json.buf[..]);

                        // SAFETY: `self` is a live `&mut PackageManager`; the callee
                        // split-borrows `self.lockfile` / `self.log` (separate
                        // allocations) alongside `self` for the call's duration.
                        if let Err(err) = unsafe {
                            pkg.parse_from_real_manager(
                                std::ptr::from_mut::<PackageManager>(self),
                                package_json_source,
                                &mut resolver,
                                Features::NPM,
                            )
                        } {
                            if log_level != LogLevel::Silent {
                                let string_buf = self.lockfile.buffers.string_bytes.as_slice();
                                Output::err(
                                    err,
                                    "failed to parse package.json for <b>{}<r>",
                                    format_args!(
                                        "{}",
                                        bun_core::fmt::for_terminal(resolution.fmt_url(string_buf))
                                    ),
                                );
                            }
                            self.crash();
                        }

                        break 'package pkg;
                    }

                    // package.json doesn't exist, no dependencies to worry about but we need to decide on a name for the dependency
                    {
                        let mut builder = self.lockfile.string_builder();

                        builder.count(&fallback_name);
                        resolver.count(&mut builder, &Expr::default());

                        bun_core::handle_oom(builder.allocate());

                        let name = builder.append::<ExternalString>(&fallback_name);
                        pkg.name = name.value;
                        pkg.name_hash = name.hash;

                        pkg.resolution = resolver
                            .resolve(&mut builder, &Expr::default())
                            .expect("unreachable");
                    }

                    pkg
                };

                Some(self.append_extracted_package(package, data, package_id))
            }
            ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                let json = data.json.as_ref().unwrap();
                let package_json_source =
                    &bun_ast::Source::init_path_string(&json.path[..], &json.buf[..]);
                let mut package = Package::default();

                let mut resolver = TarballResolver {
                    url: &data.url,
                    resolution,
                };

                // SAFETY: `self` is a live `&mut PackageManager`; the callee
                // split-borrows `self.lockfile` / `self.log` (separate
                // allocations) alongside `self` for the call's duration.
                if let Err(err) = unsafe {
                    package.parse_from_real_manager(
                        std::ptr::from_mut::<PackageManager>(self),
                        package_json_source,
                        &mut resolver,
                        Features::NPM,
                    )
                } {
                    if log_level != LogLevel::Silent {
                        let string_buf = self.lockfile.buffers.string_bytes.as_slice();
                        bun_core::pretty_errorln!(
                            "<r><red>error:<r> expected package.json in <b>{}<r> to be a JSON file: {}\n",
                            bun_core::fmt::for_terminal(resolution.fmt_url(string_buf)),
                            err.name(),
                        );
                    }
                    self.crash();
                }

                Some(self.append_extracted_package(package, data, package_id))
            }
            _ => None,
        }
    }

    pub(crate) fn process_dependency_list_item(
        &mut self,
        item: &TaskCallbackContext,
        any_root: Option<&Cell<bool>>,
        install_peer: bool,
    ) -> Result<(), crate::Error> {
        match *item {
            TaskCallbackContext::Dependency(dependency_id)
            | TaskCallbackContext::RootDependency(dependency_id) => {
                let is_root = matches!(item, TaskCallbackContext::RootDependency(_));
                // Cloned out of the buffer, which the enqueue can grow.
                let dependency = self.lockfile.buffers.dependencies[dependency_id as usize].clone();
                let resolution = self.lockfile.buffers.resolutions[dependency_id as usize];

                enqueue::enqueue_dependency_with_main_and_success_fn(
                    self,
                    dependency_id,
                    &dependency,
                    resolution,
                    install_peer,
                    if is_root {
                        PackageManager::assign_root_resolution
                    } else {
                        PackageManager::assign_resolution
                    },
                    is_root,
                )?;
                if is_root
                    && let Some(any_root) = any_root
                    && self.lockfile.buffers.resolutions[dependency_id as usize] != resolution
                {
                    any_root.set(true);
                }
            }
            // A linker's `run_tasks` starts this checkout. Here it would be dropped.
            TaskCallbackContext::GitCheckout { .. } => {
                debug_assert!(false, "git checkout waiter outside the install phase");
            }
            _ => {}
        }
        Ok(())
    }

    /// In `peer_batch_order`: the first row of a name to resolve decides what the others bind to.
    pub(crate) fn process_peer_dependency_list(&mut self) -> Result<(), crate::Error> {
        while self.peer_dependencies.readable_length() > 0 {
            let mut batch: Vec<DependencyID> =
                Vec::with_capacity(self.peer_dependencies.readable_length());
            while let Some(peer_dependency_id) = self.peer_dependencies.read_item() {
                batch.push(peer_dependency_id);
            }
            for i in self.peer_batch_order(&mut batch) {
                let peer_dependency_id = batch[i as usize];
                let id = peer_dependency_id as usize;
                let dependency = self.lockfile.buffers.dependencies[id].clone();
                let resolution = self.lockfile.buffers.resolutions[id];

                enqueue::enqueue_dependency_with_main(
                    self,
                    peer_dependency_id,
                    &dependency,
                    resolution,
                    true,
                )?;
            }
        }
        Ok(())
    }

    /// Sorts `batch` by id and returns indices into it, in an order independent of arrival.
    fn peer_batch_order(&self, batch: &mut [DependencyID]) -> Vec<u32> {
        let mut order = index_sort::identity(batch.len());
        if batch.len() < 2 {
            return order;
        }
        index_sort::sort_indices_unstable(batch, &mut |a, b| a.cmp(&b));

        let lockfile = &*self.lockfile;
        let mut owners: Vec<PackageID> = vec![INVALID_PACKAGE_ID; batch.len()];
        for (owner, slice) in lockfile.packages.items_dependencies().iter().enumerate() {
            let first = batch.partition_point(|&id| id < slice.begin());
            let end = first + batch[first..].partition_point(|&id| id < slice.end());
            owners[first..end].fill(owner as PackageID);
        }

        let buf = lockfile.buffers.string_bytes.as_slice();
        let names = lockfile.packages.items_name();
        let resolutions = lockfile.packages.items_resolution();
        let dependencies = lockfile.buffers.dependencies.as_slice();
        // The project's own ranges decide first; a package's peer then takes what they resolved to.
        let rank = |owner: usize| match resolutions[owner].tag {
            ResolutionTag::Root => 0u8,
            ResolutionTag::Workspace => 1,
            _ => 2,
        };
        index_sort::sort_indices_unstable(&mut order, &mut |a, b| {
            let (a, b) = (a as usize, b as usize);
            let by_owner = match (owners[a] as usize, owners[b] as usize) {
                (x, y) if x == y => Ordering::Equal,
                (x, y) if x >= names.len() || y >= names.len() => x.cmp(&y),
                (x, y) => rank(x)
                    .cmp(&rank(y))
                    .then_with(|| strings::order(names[x].slice(buf), names[y].slice(buf)))
                    .then_with(|| resolutions[x].order(&resolutions[y], buf, buf)),
            };
            by_owner
                .then_with(|| {
                    strings::order(
                        dependencies[batch[a] as usize].name.slice(buf),
                        dependencies[batch[b] as usize].name.slice(buf),
                    )
                })
                .then(batch[a].cmp(&batch[b]))
        });
        order
    }
}
