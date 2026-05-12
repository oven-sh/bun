use core::cell::Cell;

use bun_core::{Global, Output};
use bun_paths::dirname;
use bun_paths::platform;
use bun_paths::resolve_path::join_abs_string_z;
use bun_semver::{ExternalString, String as SemverString};
use bun_sys as sys;

use crate::bun_json as json;
use crate::bun_json::Expr;
use crate::lockfile_real::StringBuilder;
use crate::lockfile_real::package::{Package, PackageColumns, ResolverContext, Scripts};
use crate::package_manager_real::options::LogLevel;
use crate::package_manager_real::{
    PackageManager, TaskCallbackList, enqueue, resolution as pm_resolution,
};
use crate::repository_real::{Repository, RepositoryExt as _};
use crate::resolution::{ResolutionType, Tag as ResolutionTag, TaggedValue};
use crate::{
    DependencyID, ExtractData, Features, INVALID_PACKAGE_ID, PackageID, Resolution,
    TaskCallbackContext, initialize_store,
};

// ──────────────────────────────────────────────────────────────────────────
// GitResolver
// ──────────────────────────────────────────────────────────────────────────

pub struct GitResolver<'a> {
    pub resolved: &'a [u8],
    pub resolution: &'a Resolution,
    pub dep_id: DependencyID,
    /// Zig: `new_name: []u8 = ""` — owned scratch buffer that
    /// `Package::parse_with_json` may assign when the package.json `name`
    /// field is missing (see `ResolverContext::set_new_name`).
    pub new_name: Vec<u8>,
}

impl<'a> ResolverContext for GitResolver<'a> {
    const IS_GIT_RESOLVER: bool = true;

    fn check_bundled_dependencies() -> bool {
        true
    }

    fn count(&mut self, builder: &mut StringBuilder<'_>, _json: &Expr) {
        builder.count(self.resolved);
    }

    fn resolve(
        &mut self,
        builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> Result<ResolutionType<u64>, bun_core::Error> {
        // Zig: `var resolution = this.resolution.*;
        //       resolution.value.github.resolved = builder.append(String, this.resolved);`
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

    fn resolution(&self) -> &Resolution {
        self.resolution
    }
    fn dep_id(&self) -> DependencyID {
        self.dep_id
    }
    fn new_name(&self) -> &[u8] {
        &self.new_name
    }
    fn set_new_name(&mut self, name: Vec<u8>) {
        self.new_name = name;
    }
    fn take_new_name(&mut self) -> Vec<u8> {
        core::mem::take(&mut self.new_name)
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
    fn check_bundled_dependencies() -> bool {
        true
    }

    fn count(&mut self, builder: &mut StringBuilder<'_>, _json: &Expr) {
        builder.count(self.url);
    }

    fn resolve(
        &mut self,
        builder: &mut StringBuilder<'_>,
        _json: &Expr,
    ) -> Result<ResolutionType<u64>, bun_core::Error> {
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
}

// ──────────────────────────────────────────────────────────────────────────
// PackageManager impl
// ──────────────────────────────────────────────────────────────────────────

impl PackageManager {
    /// Returns true if we need to drain dependencies
    pub fn process_extracted_tarball_package(
        &mut self,
        package_id: &mut PackageID,
        dep_id: DependencyID,
        resolution: &Resolution,
        data: &ExtractData,
        log_level: LogLevel,
    ) -> Option<Package> {
        match resolution.tag {
            ResolutionTag::Git | ResolutionTag::Github => {
                let mut package = 'package: {
                    let mut resolver = GitResolver {
                        resolved: &data.resolved,
                        resolution,
                        dep_id,
                        new_name: Vec::new(),
                    };

                    let mut pkg = Package::default();
                    if let Some(json) = &data.json {
                        let package_json_source =
                            &bun_ast::Source::init_path_string(&json.path[..], &json.buf[..]);

                        if let Err(err) = pkg.parse_from_real_manager(
                            std::ptr::from_mut::<PackageManager>(self),
                            package_json_source,
                            &mut resolver,
                            Features::NPM,
                        ) {
                            if log_level != LogLevel::Silent {
                                let string_buf = self.lockfile.buffers.string_bytes.as_slice();
                                Output::err(
                                    err,
                                    "failed to parse package.json for <b>{}<r>",
                                    format_args!("{}", resolution.fmt_url(string_buf)),
                                );
                            }
                            Global::crash();
                        }

                        let has_scripts = pkg.scripts.has_any() || {
                            let dir = dirname(&json.path).unwrap_or(b"");
                            let binding_dot_gyp_path = join_abs_string_z::<platform::Auto>(
                                dir,
                                &[b"binding.gyp" as &[u8]],
                            );
                            sys::exists(binding_dot_gyp_path.as_bytes())
                        };

                        pkg.meta.set_has_install_script(has_scripts);
                        break 'package pkg;
                    }

                    // package.json doesn't exist, no dependencies to worry about but we need to decide on a name for the dependency
                    // tag is `.git` or `.github`; both store `Repository`.
                    let repo = *resolution.repository();

                    let new_name = Repository::create_dependency_name_from_version_literal(
                        &repo,
                        self.lockfile.buffers.string_bytes.as_slice(),
                        &self.lockfile.buffers.dependencies[dep_id as usize],
                    );
                    // `defer manager.allocator.free(new_name)` — `new_name: Vec<u8>` drops at scope end.

                    {
                        let mut builder = self.lockfile.string_builder();

                        builder.count(&new_name);
                        // Zig passed `undefined` for the unused `JSAst.Expr` arg.
                        resolver.count(&mut builder, &Expr::default());

                        bun_core::handle_oom(builder.allocate());

                        let name = builder.append::<ExternalString>(&new_name);
                        pkg.name = name.value;
                        pkg.name_hash = name.hash;

                        pkg.resolution = resolver
                            .resolve(&mut builder, &Expr::default())
                            .expect("unreachable");
                    }

                    pkg
                };

                // Store the tarball integrity hash so the lockfile can pin the
                // exact content downloaded from the remote (GitHub) server.
                if data.integrity.tag.is_supported() {
                    package.meta.integrity = data.integrity;
                }

                package = self.lockfile.append_package(package).expect("unreachable");
                *package_id = package.meta.id;

                if package.dependencies.len > 0 {
                    bun_core::handle_oom(
                        self.lockfile
                            .scratch
                            .dependency_list_queue
                            .write_item(package.dependencies),
                    );
                }

                Some(package)
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

                if let Err(err) = package.parse_from_real_manager(
                    std::ptr::from_mut::<PackageManager>(self),
                    package_json_source,
                    &mut resolver,
                    Features::NPM,
                ) {
                    if log_level != LogLevel::Silent {
                        let string_buf = self.lockfile.buffers.string_bytes.as_slice();
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> expected package.json in <b>{}<r> to be a JSON file: {}\n",
                            resolution.fmt_url(string_buf),
                            err.name(),
                        ));
                    }
                    Global::crash();
                }

                let has_scripts = package.scripts.has_any() || {
                    let dir = dirname(&json.path).unwrap_or(b"");
                    let binding_dot_gyp_path =
                        join_abs_string_z::<platform::Auto>(dir, &[b"binding.gyp" as &[u8]]);
                    sys::exists(binding_dot_gyp_path.as_bytes())
                };

                package.meta.set_has_install_script(has_scripts);
                if data.integrity.tag.is_supported() {
                    package.meta.integrity = data.integrity;
                }

                package = self.lockfile.append_package(package).expect("unreachable");
                *package_id = package.meta.id;

                if package.dependencies.len > 0 {
                    bun_core::handle_oom(
                        self.lockfile
                            .scratch
                            .dependency_list_queue
                            .write_item(package.dependencies),
                    );
                }

                Some(package)
            }
            _ => {
                if !data.json.as_ref().unwrap().buf.is_empty() {
                    let json = data.json.as_ref().unwrap();
                    let package_json_source =
                        &bun_ast::Source::init_path_string(&json.path[..], &json.buf[..]);
                    initialize_store();
                    // SAFETY: `self.log` is set once by `PackageManager::init()` and
                    // never null while tasks run (mirrors Zig's non-optional `*logger.Log`).
                    let log = self.log_mut();
                    let bump = bun_alloc::Arena::new();
                    let json_root = match json::parse_package_json_utf8(
                        package_json_source,
                        log,
                        &bump,
                    ) {
                        Ok(v) => v,
                        Err(err) => {
                            if log_level != LogLevel::Silent {
                                let string_buf = self.lockfile.buffers.string_bytes.as_slice();
                                Output::pretty_errorln(format_args!(
                                    "<r><red>error:<r> expected package.json in <b>{}<r> to be a JSON file: {}\n",
                                    resolution.fmt_url(string_buf),
                                    err.name(),
                                ));
                            }
                            Global::crash();
                        }
                    };
                    // PORT NOTE (spec parity): Zig writes
                    //   var scripts = manager.lockfile.packages.items(.scripts)[package_id.*];
                    // which COPIES the `Scripts` struct into a local; the
                    // subsequent `parseAlloc` / `.filled = true` mutate the
                    // local and are never stored back, so
                    // `lockfile.packages[id].scripts` is not updated. This is
                    // a latent dead-store bug in processDependencyList.zig,
                    // but we match it exactly so .rs/.zig observable behavior
                    // agree. The `builder` appends still land in
                    // `lockfile.buffers.string_bytes`, preserving that side
                    // effect. (Hoisted above `string_builder()` for borrowck —
                    // `parse_count`/`allocate` don't touch `packages`.)
                    debug_assert!(*package_id != INVALID_PACKAGE_ID);
                    let mut scripts: Scripts =
                        self.lockfile.packages.items_scripts()[*package_id as usize];
                    let mut builder = self.lockfile.string_builder();
                    Scripts::parse_count(&mut builder, json_root);
                    builder.allocate().expect("unreachable");
                    scripts.parse_alloc(&mut builder, json_root);
                    scripts.filled = true;
                }

                None
            }
        }
    }

    pub fn process_dependency_list_item(
        &mut self,
        item: TaskCallbackContext,
        any_root: Option<&Cell<bool>>,
        install_peer: bool,
    ) -> Result<(), bun_core::Error> {
        match item {
            TaskCallbackContext::Dependency(dependency_id) => {
                // PORT NOTE: reshaped for borrowck — clone the dependency row
                // out of the buffer before re-borrowing `self` for enqueue.
                let dependency = Clone::clone(
                    &self.lockfile.buffers.dependencies.as_slice()[dependency_id as usize],
                );
                let resolution =
                    self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize];

                enqueue::enqueue_dependency_with_main(
                    self,
                    dependency_id,
                    &dependency,
                    resolution,
                    install_peer,
                )?;
            }
            TaskCallbackContext::RootDependency(dependency_id) => {
                let dependency = Clone::clone(
                    &self.lockfile.buffers.dependencies.as_slice()[dependency_id as usize],
                );
                let resolution =
                    self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize];

                enqueue::enqueue_dependency_with_main_and_success_fn(
                    self,
                    dependency_id,
                    &dependency,
                    resolution,
                    install_peer,
                    pm_resolution::assign_root_resolution,
                    Some(PackageManager::fail_root_resolution),
                    true,
                )?;
                if let Some(ptr) = any_root {
                    let new_resolution_id =
                        self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize];
                    if new_resolution_id != resolution {
                        ptr.set(true);
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub fn process_peer_dependency_list(&mut self) -> Result<(), bun_core::Error> {
        while let Some(peer_dependency_id) = self.peer_dependencies.read_item() {
            // PORT NOTE: reshaped for borrowck — clone the dependency row out
            // of the buffer before re-borrowing `self` for enqueue.
            let dependency = Clone::clone(
                &self.lockfile.buffers.dependencies.as_slice()[peer_dependency_id as usize],
            );
            let resolution =
                self.lockfile.buffers.resolutions.as_slice()[peer_dependency_id as usize];

            enqueue::enqueue_dependency_with_main(
                self,
                peer_dependency_id,
                &dependency,
                resolution,
                true,
            )?;
        }
        Ok(())
    }

    /// Zig: `callbacks` was `comptime anytype` with a
    /// `@TypeOf(callbacks) != void and @TypeOf(callbacks.onResolve) != void`
    /// check. Modeled as `Option<impl FnOnce(C)>` — only `onResolve` is ever
    /// read, and the void path is `None`.
    pub fn process_dependency_list<C>(
        &mut self,
        dep_list: TaskCallbackList,
        ctx: C,
        on_resolve: Option<impl FnOnce(C)>,
        install_peer: bool,
    ) -> Result<(), bun_core::Error> {
        if !dep_list.is_empty() {
            let dependency_list = dep_list;
            let any_root = Cell::new(false);
            for item in dependency_list.iter().cloned() {
                self.process_dependency_list_item(item, Some(&any_root), install_peer)?;
            }

            if let Some(on_resolve) = on_resolve {
                if any_root.get() {
                    on_resolve(ctx);
                }
            }

            // `dependency_list.deinit(this.allocator)` — owned `Vec`; drops here.
            drop(dependency_list);
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Free-function re-export surface — Zig declares these at file scope with an
// explicit `*PackageManager` first param. Thin shims over the
// `impl PackageManager` bodies above so `pub use process_dependency_list::{…}`
// in `PackageManager.rs` resolves (matching the directories/enqueue pattern).
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn process_extracted_tarball_package(
    manager: &mut PackageManager,
    package_id: &mut PackageID,
    dep_id: DependencyID,
    resolution: &Resolution,
    data: &ExtractData,
    log_level: LogLevel,
) -> Option<Package> {
    manager.process_extracted_tarball_package(package_id, dep_id, resolution, data, log_level)
}

#[inline]
pub fn process_dependency_list_item(
    this: &mut PackageManager,
    item: TaskCallbackContext,
    any_root: Option<&Cell<bool>>,
    install_peer: bool,
) -> Result<(), bun_core::Error> {
    this.process_dependency_list_item(item, any_root, install_peer)
}

#[inline]
pub fn process_peer_dependency_list(this: &mut PackageManager) -> Result<(), bun_core::Error> {
    this.process_peer_dependency_list()
}

#[inline]
pub fn process_dependency_list<C>(
    this: &mut PackageManager,
    dep_list: TaskCallbackList,
    ctx: C,
    on_resolve: Option<impl FnOnce(C)>,
    install_peer: bool,
) -> Result<(), bun_core::Error> {
    this.process_dependency_list(dep_list, ctx, on_resolve, install_peer)
}
