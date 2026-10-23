use core::cell::Cell;
use core::cmp::Ordering;

use bun_collections::index_sort;
use bun_core::{Output, strings};
use bun_semver::{ExternalString, String as SemverString};

use crate::bun_json::Expr;
use crate::dependency::{TagExt as _, VersionTag};
use crate::lockfile_real::package::{Diff, Package, PackageColumns, ResolverContext};
use crate::lockfile_real::{DependencySlice, Lockfile, PackageIDSlice, QueuedRows, StringBuilder};
use crate::package_manager_real::options::LogLevel;
use crate::package_manager_real::{ArrivedPackage, PackageManager, RemoteTurn, enqueue, run_tasks};
use crate::package_manager_task as Task;
use crate::repository_real::{RepositoryExt as _, locked_scp_like};
use crate::resolution::{ResolutionType, Tag as ResolutionTag, TaggedValue};
use crate::{
    Dependency, DependencyID, ExtractData, ExtractDataJson, Features, INVALID_PACKAGE_ID,
    PackageID, Resolution, TaskCallbackContext, dependency,
};

/// The dependencies of a package.json, parsed into a separate lockfile. `LookAhead` reads it to
/// request manifests for a package before the package is resolved.
#[derive(Default)]
pub(crate) struct ListedDependencies {
    pub(crate) lockfile: Lockfile,
    pub(crate) package: Package,
}

/// Parses a package.json for `ListedDependencies`, where the package's resolution does not matter.
pub(crate) struct OnlyDependencies;

impl ResolverContext for OnlyDependencies {
    fn is_void(&self) -> bool {
        true
    }

    fn check_bundled_dependencies(&self) -> bool {
        true
    }

    fn resolve(
        &mut self,
        _builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> Result<ResolutionType<u64>, crate::Error> {
        Ok(ResolutionType::default())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GitResolver
// ──────────────────────────────────────────────────────────────────────────

pub struct GitResolver<'a> {
    pub(crate) resolved: &'a [u8],
    pub(crate) resolution: &'a Resolution,
    /// Copied out of the lockfile string buffer, which parsing appends to.
    pub(crate) fallback_name: &'a [u8],
    /// Written to the lockfile in place of a `host:path` repository. See `locked_scp_like`.
    pub(crate) locked_repo: Option<Vec<u8>>,
}

impl<'a> ResolverContext for GitResolver<'a> {
    fn check_bundled_dependencies(&self) -> bool {
        true
    }

    fn count(&mut self, builder: &mut StringBuilder<'_>, _json: &Expr) {
        builder.count(self.resolved);
        builder.count(self.locked_repo.as_deref().unwrap_or_default());
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
        if let Some(locked) = &self.locked_repo {
            repo.repo = builder.append::<SemverString>(locked);
        }
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

/// Reads `<package_dir>/<folder>/package.json` without following any symlink, so the file that is
/// read is always inside the package.
fn read_contained_package_json(package_dir: &[u8], folder: &[u8]) -> bun_sys::Maybe<Vec<u8>> {
    use bun_sys::O;
    let mut dir = bun_sys::Dir::open(package_dir)?;
    for component in strings::split_any(folder, b"/\\") {
        if !matches!(component, b"" | b".") {
            dir = dir.open_at_with(component, O::RDONLY | O::CLOEXEC | O::NOFOLLOW)?;
        }
    }
    crate::git_runner::read_package_json_in(&dir)
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
            Diff::keep_while_refreshing(
                self,
                existing_id,
                existing.dependencies,
                package.dependencies,
            );
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

        bun_core::handle_oom(
            (self.lockfile.scratch.dependency_list_queue).push(QueuedRows {
                rows: package.dependencies,
                install_peer: false,
                from_command: false,
            }),
        );

        package
    }

    fn parse_extracted<R: ResolverContext>(
        &mut self,
        package: &mut Package,
        source: &bun_ast::Source,
        resolver: &mut R,
    ) -> crate::Result<()> {
        // SAFETY: `self` is a live `&mut PackageManager`; the callee
        // split-borrows `self.lockfile` / `self.log` (separate
        // allocations) alongside `self` for the call's duration.
        unsafe {
            package.parse_from_real_manager(
                std::ptr::from_mut::<PackageManager>(self),
                source,
                resolver,
                Features::NPM,
            )
        }
    }

    /// Parses the package.json of an extracted package and adds what its `file:` folders depend on.
    fn parse_with_folders<R: ResolverContext>(
        &mut self,
        package: &mut Package,
        json: &ExtractDataJson,
        resolver: &mut R,
    ) -> crate::Result<()> {
        let source = bun_ast::Source::init_path_string(&json.path[..], &json.buf[..]);
        self.parse_extracted(package, &source, resolver)?;
        self.adopt_contained_folders(package, &json.path, &mut |this, source| {
            let start = this.lockfile.buffers.dependencies.len();
            this.parse_extracted(&mut Package::default(), source, resolver)?;
            this.lockfile.buffers.resolutions.truncate(start);
            Ok(this.lockfile.buffers.dependencies.split_off(start))
        })
    }

    /// Adds the dependencies of the `file:` folders inside `package` to its own rows, because Node
    /// resolves what such a folder imports from the package's `node_modules`. `package` is parsed
    /// but not appended yet, so its rows are the last in the buffer. `parse` returns a folder's
    /// rows.
    fn adopt_contained_folders(
        &mut self,
        package: &mut Package,
        package_json_path: &[u8],
        parse: &mut dyn FnMut(&mut Self, &bun_ast::Source) -> crate::Result<Vec<Dependency>>,
    ) -> crate::Result<()> {
        let off = package.dependencies.off as usize;
        let own_len = package.dependencies.len as usize;
        debug_assert_eq!(off + own_len, self.lockfile.buffers.dependencies.len());
        let package_dir = bun_paths::dirname(package_json_path).unwrap_or_default();

        // The added rows are visited too, because a folder can depend on the folder next to it.
        let mut next = off;
        while next < self.lockfile.buffers.dependencies.len() {
            let row = self.lockfile.buffers.dependencies[next].clone();
            next += 1;
            let buf = self.lockfile.buffers.string_bytes.as_slice();
            if row.version.tag != VersionTag::Folder
                || row.behavior.is_bundled()
                || (self.lockfile.overrides).contains_name(row.name_hash, row.name.slice(buf), buf)
            {
                continue;
            }
            let folder = row.version.folder().slice(buf).to_vec();
            // The resolver rejects a folder outside the package, so its package.json is not read.
            if crate::bin::bin_target_escapes_package_dir(&folder) {
                continue;
            }
            let json = match read_contained_package_json(package_dir, &folder) {
                Ok(json) => json,
                Err(err) => {
                    if row.behavior.is_required() {
                        self.log_mut().add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "failed to read package.json of \"{}@{}\" declared by {}@{}: {}",
                                bun_core::fmt::escape_control_chars(row.name.slice(buf)),
                                bun_core::fmt::escape_control_chars(row.version.literal.slice(buf)),
                                bun_core::fmt::escape_control_chars(package.name.slice(buf)),
                                bun_core::fmt::for_terminal(
                                    package.resolution.fmt(buf, bun_core::fmt::PathSep::Posix)
                                ),
                                bstr::BStr::new(err.name()),
                            ),
                        );
                    }
                    continue;
                }
            };
            let path = bun_resolver::fs::FileSystem::instance()
                .dirname_store()
                .append(&[package_dir, b"/", &folder, b"/package.json"].concat())?;
            let source = bun_ast::Source::init_path_string(path, &json[..]);

            for declared in parse(self, &source)? {
                // Each name is only added once. The package's own dependency wins, then the one of
                // the folder that was read first.
                if (self.lockfile.buffers.dependencies[off..].iter())
                    .any(|row| row.name_hash == declared.name_hash)
                {
                    continue;
                }
                let adopted = match declared.version.tag {
                    VersionTag::Folder => self.rebase_contained_folder(declared, &folder)?,
                    VersionTag::Npm
                    | VersionTag::DistTag
                    | VersionTag::Git
                    | VersionTag::Github => declared,
                    VersionTag::Tarball
                        if matches!(
                            declared.version.tarball().uri,
                            dependency::tarball::Uri::Remote(_)
                        ) =>
                    {
                        declared
                    }
                    // `workspace:`, `link:`, `catalog:` and a tarball's path mean something in the
                    // project of the package's author. Here they would be read in the user's.
                    _ => continue,
                };
                self.lockfile.buffers.dependencies.push(adopted);
                self.lockfile.buffers.resolutions.push(INVALID_PACKAGE_ID);
            }
        }

        let len = self.lockfile.buffers.dependencies.len() - off;
        if len != own_len {
            let buffers = &mut self.lockfile.buffers;
            let buf = buffers.string_bytes.as_slice();
            index_sort::sort_slice_by(&mut buffers.dependencies[off..], |a, b| {
                Dependency::cmp(buf, a, b)
            });
            package.dependencies = DependencySlice::new(off as u32, len as u32);
            package.resolutions = PackageIDSlice::new(off as u32, len as u32);
        }
        Ok(())
    }

    /// Returns `row`, a `file:` dependency that the package.json in the folder `base` declares,
    /// with its path made relative to the package's root.
    fn rebase_contained_folder(
        &mut self,
        row: Dependency,
        base: &[u8],
    ) -> Result<Dependency, bun_alloc::AllocError> {
        let folder = (row.version.folder()).slice(self.lockfile.buffers.string_bytes.as_slice());
        // An absolute path is left as it is, and the resolver rejects it.
        if bun_paths::is_absolute(folder) {
            return Ok(row);
        }
        let joined = [base, b"/", folder].concat();
        let mut spill = Vec::new();
        let literal = [
            b"file:".as_slice(),
            bun_paths::resolve_path::normalize_string_spill::<true, bun_paths::platform::Loose>(
                &mut spill, &joined,
            ),
        ]
        .concat();
        let literal = self.lockfile.string_buf().append(&literal)?;
        let sliced = literal.sliced(self.lockfile.buffers.string_bytes.as_slice());
        let version = dependency::parse_with_tag(
            row.name,
            Some(row.name_hash),
            sliced.slice,
            VersionTag::infer(sliced.slice),
            &sliced,
            Some(self.log_mut()),
            None,
        )
        .unwrap_or_default();
        Ok(Dependency { version, ..row })
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
                    let repo = self.lockfile.str(&resolution.repository().repo);
                    let mut resolver = GitResolver {
                        resolved: &data.resolved,
                        resolution,
                        fallback_name: &fallback_name,
                        locked_repo: locked_scp_like(repo),
                    };

                    let mut pkg = Package::default();
                    if let Some(json) = &data.json {
                        if let Err(err) = self.parse_with_folders(&mut pkg, json, &mut resolver) {
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
                let mut package = Package::default();

                let mut resolver = TarballResolver {
                    url: &data.url,
                    resolution,
                };

                if let Err(err) = self.parse_with_folders(&mut package, json, &mut resolver) {
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

    /// Returns true if the package that `task_id` downloaded has to wait for its turn. See
    /// `RemotePackages`. The runtime's auto-install writes no lockfile, and an import only waits
    /// for its own package.
    pub(crate) fn defers_remote_package(&self, task_id: Task::Id, resolution: &Resolution) -> bool {
        !self.options.runtime_auto_install
            && matches!(
                resolution.tag,
                ResolutionTag::Git
                    | ResolutionTag::Github
                    | ResolutionTag::LocalTarball
                    | ResolutionTag::RemoteTarball
            )
            // `bun pm fetch` downloads what's in bun.lock and doesn't resolve any dependency.
            && self.task_queue.get(&task_id).is_some_and(|waiting| {
                (waiting.iter()).any(|waiter| matches!(waiter, TaskCallbackContext::Dependency(_)))
            })
    }

    /// Keeps a downloaded package until `append_next_remote_package` adds it to the lockfile.
    /// Until then the manifests that its dependencies need are requested.
    #[cold]
    pub(crate) fn keep_arrived_package(
        &mut self,
        task_id: Task::Id,
        resolution: &Resolution,
        data: &ExtractData,
    ) {
        if let Some(json) = &data.json {
            let source = bun_ast::Source::init_path_string(&json.path[..], &json.buf[..]);
            let mut listed = ListedDependencies::default();
            // Errors in the package.json are reported when the package is added.
            let parsed = listed.package.parse(
                &mut listed.lockfile,
                self,
                &mut bun_ast::Log::init(),
                &source,
                &mut OnlyDependencies,
                Features::NPM,
            );
            if parsed.is_ok() {
                enqueue::look_ahead_from(self, &listed, &[]);
            }
        }
        let data = ExtractData {
            url: data.url.clone(),
            resolved: data.resolved.clone(),
            json: data.json.as_ref().map(|json| ExtractDataJson {
                path: json.path.clone(),
                buf: json.buf.clone(),
            }),
            integrity: data.integrity,
        };
        let arrived = ArrivedPackage {
            resolution: *resolution,
            data,
        };
        let _ = self.remote_packages.arrived.insert(task_id, arrived);
    }

    /// Returns, for each task that fetches a git, GitHub or tarball package, the lowest dependency
    /// that's waiting for it. Skips a task that failed, and a task that was never started, which is
    /// what a deferred peer waits for.
    fn remote_rows_waiting(&self) -> impl core::iter::Iterator<Item = (DependencyID, Task::Id)> {
        self.remote_packages.tasks.iter().filter_map(|&task_id| {
            if !self.network_dedupe_map.contains_key(&task_id)
                || self.network_task_has_failed(task_id)
            {
                return None;
            }
            let lowest = (self.task_queue.get(&task_id)?.iter())
                .filter_map(|waiter| match *waiter {
                    TaskCallbackContext::Dependency(id) => Some(id),
                    _ => None,
                })
                .min()?;
            Some((lowest, task_id))
        })
    }

    /// Returns true if a git, GitHub or tarball package still has to be added to the lockfile.
    pub(crate) fn waits_for_remote_package(&self) -> bool {
        !self.remote_packages.tasks.is_empty()
            // With nothing running and nothing downloaded, none of them can be added any more.
            && (self.pending_task_count() > 0 || !self.remote_packages.arrived.is_empty())
            && self.remote_rows_waiting().next().is_some()
    }

    /// Adds the next git, GitHub or tarball package to the lockfile and resolves the dependencies
    /// that were waiting for it. Only call this when the queue is empty, because it queues the
    /// package's own dependencies. Returns false if no package was added.
    #[cold]
    pub(crate) fn append_next_remote_package(&mut self, turn: RemoteTurn) -> bool {
        if self.remote_packages.arrived.is_empty() {
            return false;
        }
        let has_arrived = |task_id: &Task::Id| self.remote_packages.arrived.contains_key(task_id);
        let next = self
            .remote_rows_waiting()
            .filter(|(_, task_id)| turn == RemoteTurn::InOrder || has_arrived(task_id))
            .min_by_key(|&(row, _)| row);
        let Some((row, task_id)) = next else {
            return false;
        };
        let Some(arrived) = self.remote_packages.arrived.remove(&task_id) else {
            return false;
        };

        let mut package_id = INVALID_PACKAGE_ID;
        let log_level = self.options.log_level;
        let Some(package) = self.process_extracted_tarball_package(
            &mut package_id,
            &arrived.resolution,
            &arrived.data,
            log_level,
        ) else {
            return true;
        };
        let install_peer = self.look_ahead.in_peer_pass;
        if let Err(err) = run_tasks::resolve_waiters_of_appended_package(
            self,
            task_id,
            &package,
            install_peer,
            &Cell::new(false),
        ) {
            let dependency = self.lockfile.buffers.dependencies[row as usize].clone();
            enqueue::add_dependency_error(self, &dependency, err);
        }
        // A git checkout is not a tarball that the linker would otherwise extract again.
        if arrived.resolution.tag != ResolutionTag::Git {
            self.set_preinstall_state(package_id, crate::PreinstallState::Done);
        }
        true
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

                let row = enqueue::bind_row(
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
                // An import of the runtime has put itself on the list of the task it waits for.
                if row != enqueue::Row::Done && !is_root {
                    (self.lockfile.scratch.dependency_list_queue).push(QueuedRows {
                        rows: DependencySlice::new(dependency_id, 1),
                        install_peer,
                        from_command: false,
                    })?;
                }
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

    /// Returns true if `process_peer_dependency_list` has something to do. The peers that were
    /// found while the queue was being resolved wait until it's empty, so that they all see the
    /// same tree. A git, GitHub or tarball package brings its own dependencies, so the peers wait
    /// for it too.
    pub(crate) fn has_peers_to_process(&self) -> bool {
        self.peer_dependencies.readable_length() > 0
            && self.lockfile.scratch.dependency_list_queue.is_empty()
            && !self.waits_for_remote_package()
    }

    /// Returns true if the deferred peers are all that's left to resolve, and are worth resolving.
    pub(crate) fn is_ready_for_peers(&self) -> bool {
        self.has_peers_to_process()
            // An error ends the install, so the peers are not worth their requests.
            && !self.log_mut().has_errors()
    }

    /// Queues the deferred peers for `drain_dependency_list`, in `peer_batch_order`. The first
    /// dependency on a name to be resolved decides what the others bind to.
    pub(crate) fn process_peer_dependency_list(&mut self) -> Result<(), crate::Error> {
        if !self.has_peers_to_process() {
            return Ok(());
        }
        let mut batch: Vec<DependencyID> =
            Vec::with_capacity(self.peer_dependencies.readable_length());
        while let Some(peer_dependency_id) = self.peer_dependencies.read_item() {
            batch.push(peer_dependency_id);
        }
        self.look_ahead.in_peer_pass = true;
        self.look_ahead.deferred_peers_seen = 0;
        for i in self.peer_batch_order(&mut batch) {
            (self.lockfile.scratch.dependency_list_queue).push(QueuedRows {
                rows: DependencySlice::new(batch[i as usize], 1),
                install_peer: true,
                from_command: true,
            })?;
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
        // The project's own ranges are resolved first. A package's peer then uses what they
        // resolved to.
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
