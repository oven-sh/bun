use bun_core::{Global, Output};
use bun_js_parser::Expr;
use bun_json as json;
use bun_logger as logger;
use bun_paths as path;
use bun_semver::{ExternalString, String as SemverString};
use bun_sys as sys;

use crate::lockfile::{self, Lockfile, StringBuilder};
use crate::package_manager::options::{self, LogLevel};
use crate::package_manager::{
    assign_root_resolution, fail_root_resolution, PackageManager, TaskCallbackList,
};
use crate::{
    initialize_store, DependencyID, ExtractData, Features, PackageID, Repository, Resolution,
    TaskCallbackContext, INVALID_PACKAGE_ID,
};

pub struct GitResolver<'a> {
    pub resolved: &'a [u8],
    pub resolution: &'a Resolution,
    pub dep_id: DependencyID,
    // TODO(port): `new_name: []u8 = ""` — unused in this file; verify whether mutability is needed.
    pub new_name: &'a [u8],
}

impl<'a> GitResolver<'a> {
    // TODO(port): add trait bound for `builder` (.count/.append) once StringBuilder trait exists
    pub fn count<B>(&self, builder: &mut B, _: Expr) {
        builder.count(self.resolved);
    }

    pub fn resolve<B>(&self, builder: &mut B, _: Expr) -> Result<Resolution, bun_core::Error> {
        // TODO(port): narrow error set
        let mut resolution = *self.resolution;
        resolution.value.github.resolved = builder.append::<SemverString>(self.resolved);
        Ok(resolution)
    }

    pub fn check_bundled_dependencies() -> bool {
        true
    }
}

struct TarballResolver<'a> {
    url: &'a [u8],
    resolution: &'a Resolution,
}

impl<'a> TarballResolver<'a> {
    // TODO(port): add trait bound for `builder` (.count/.append) once StringBuilder trait exists
    pub fn count<B>(&self, builder: &mut B, _: Expr) {
        builder.count(self.url);
    }

    pub fn resolve<B>(&self, builder: &mut B, _: Expr) -> Result<Resolution, bun_core::Error> {
        // TODO(port): narrow error set
        let mut resolution = *self.resolution;
        match resolution.tag {
            ResolutionTag::LocalTarball => {
                resolution.value.local_tarball = builder.append::<SemverString>(self.url);
            }
            ResolutionTag::RemoteTarball => {
                resolution.value.remote_tarball = builder.append::<SemverString>(self.url);
            }
            _ => unreachable!(),
        }
        Ok(resolution)
    }

    pub fn check_bundled_dependencies() -> bool {
        true
    }
}

impl PackageManager {
    /// Returns true if we need to drain dependencies
    pub fn process_extracted_tarball_package(
        &mut self,
        package_id: &mut PackageID,
        dep_id: DependencyID,
        resolution: &Resolution,
        data: &ExtractData,
        log_level: LogLevel,
    ) -> Option<lockfile::Package> {
        match resolution.tag {
            ResolutionTag::Git | ResolutionTag::Github => {
                let mut package = 'package: {
                    let mut resolver = GitResolver {
                        resolved: &data.resolved,
                        resolution,
                        dep_id,
                        new_name: b"",
                    };

                    let mut pkg = lockfile::Package::default();
                    if let Some(json) = &data.json {
                        let package_json_source =
                            &logger::Source::init_path_string(&json.path, &json.buf);

                        if let Err(err) = pkg.parse(
                            self.lockfile,
                            self,
                            self.log,
                            package_json_source,
                            &mut resolver,
                            Features::NPM,
                        ) {
                            if log_level != LogLevel::Silent {
                                let string_buf = self.lockfile.buffers.string_bytes.as_slice();
                                Output::err(
                                    err,
                                    format_args!(
                                        "failed to parse package.json for <b>{}<r>",
                                        resolution.fmt_url(string_buf),
                                    ),
                                );
                            }
                            Global::crash();
                        }

                        let has_scripts = pkg.scripts.has_any() || 'brk: {
                            let dir = path::dirname(&json.path).unwrap_or(b"");
                            let binding_dot_gyp_path = path::join_abs_string_z(
                                dir,
                                &[b"binding.gyp" as &[u8]],
                                path::Style::Auto,
                            );

                            break 'brk sys::exists(binding_dot_gyp_path);
                        };

                        pkg.meta.set_has_install_script(has_scripts);
                        break 'package pkg;
                    }

                    // package.json doesn't exist, no dependencies to worry about but we need to decide on a name for the dependency
                    let mut repo = match resolution.tag {
                        ResolutionTag::Git => resolution.value.git,
                        ResolutionTag::Github => resolution.value.github,
                        _ => unreachable!(),
                    };

                    let new_name = Repository::create_dependency_name_from_version_literal(
                        &mut repo,
                        self.lockfile,
                        dep_id,
                    );
                    // `defer manager.allocator.free(new_name)` — `new_name` is owned (Vec<u8>/Box<[u8]>); drops at scope end.

                    {
                        let mut builder = self.lockfile.string_builder();

                        builder.count(&new_name);
                        // TODO(port): Zig passed `undefined` for the unused Expr param
                        resolver.count(&mut builder, Expr::default());

                        builder.allocate();

                        let name = builder.append::<ExternalString>(&new_name);
                        pkg.name = name.value;
                        pkg.name_hash = name.hash;

                        pkg.resolution = resolver
                            .resolve(&mut builder, Expr::default())
                            .expect("unreachable");
                    }

                    break 'package pkg;
                };

                // Store the tarball integrity hash so the lockfile can pin the
                // exact content downloaded from the remote (GitHub) server.
                if data.integrity.tag.is_supported() {
                    package.meta.integrity = data.integrity;
                }

                package = self.lockfile.append_package(package).expect("unreachable");
                *package_id = package.meta.id;

                if package.dependencies.len > 0 {
                    self.lockfile
                        .scratch
                        .dependency_list_queue
                        .write_item(package.dependencies);
                }

                Some(package)
            }
            ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                let json = data.json.as_ref().unwrap();
                let package_json_source = &logger::Source::init_path_string(&json.path, &json.buf);
                let mut package = lockfile::Package::default();

                let mut resolver = TarballResolver {
                    url: &data.url,
                    resolution,
                };

                if let Err(err) = package.parse(
                    self.lockfile,
                    self,
                    self.log,
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

                let has_scripts = package.scripts.has_any() || 'brk: {
                    let dir = path::dirname(&json.path).unwrap_or(b"");
                    let binding_dot_gyp_path = path::join_abs_string_z(
                        dir,
                        &[b"binding.gyp" as &[u8]],
                        path::Style::Auto,
                    );

                    break 'brk sys::exists(binding_dot_gyp_path);
                };

                package.meta.set_has_install_script(has_scripts);
                if data.integrity.tag.is_supported() {
                    package.meta.integrity = data.integrity;
                }

                package = self.lockfile.append_package(package).expect("unreachable");
                *package_id = package.meta.id;

                if package.dependencies.len > 0 {
                    self.lockfile
                        .scratch
                        .dependency_list_queue
                        .write_item(package.dependencies);
                }

                Some(package)
            }
            _ => {
                if !data.json.as_ref().unwrap().buf.is_empty() {
                    let json = data.json.as_ref().unwrap();
                    let package_json_source =
                        &logger::Source::init_path_string(&json.path, &json.buf);
                    initialize_store();
                    let json_root = match json::parse_package_json_utf8(
                        package_json_source,
                        self.log,
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
                    let mut builder = self.lockfile.string_builder();
                    lockfile::Package::Scripts::parse_count(&mut builder, &json_root);
                    builder.allocate().expect("unreachable");
                    debug_assert!(*package_id != INVALID_PACKAGE_ID);
                    // TODO(port): MultiArrayList SoA accessor — verify .items(.scripts) mapping
                    let scripts = &mut self.lockfile.packages.items_mut().scripts[*package_id as usize];
                    scripts.parse_alloc(&mut builder, &json_root);
                    scripts.filled = true;
                }

                None
            }
        }
    }

    pub fn process_dependency_list_item(
        &mut self,
        item: TaskCallbackContext,
        any_root: Option<&mut bool>,
        install_peer: bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        match item {
            TaskCallbackContext::Dependency(dependency_id) => {
                // PORT NOTE: reshaped for borrowck
                let dependency =
                    self.lockfile.buffers.dependencies.as_slice()[dependency_id as usize];
                let resolution =
                    self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize];

                self.enqueue_dependency_with_main(
                    dependency_id,
                    &dependency,
                    resolution,
                    install_peer,
                )?;
            }
            TaskCallbackContext::RootDependency(dependency_id) => {
                let dependency =
                    self.lockfile.buffers.dependencies.as_slice()[dependency_id as usize];
                let resolution =
                    self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize];

                self.enqueue_dependency_with_main_and_success_fn(
                    dependency_id,
                    &dependency,
                    resolution,
                    install_peer,
                    assign_root_resolution,
                    fail_root_resolution,
                )?;
                if let Some(ptr) = any_root {
                    let new_resolution_id =
                        self.lockfile.buffers.resolutions.as_slice()[dependency_id as usize];
                    if new_resolution_id != resolution {
                        *ptr = true;
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub fn process_peer_dependency_list(&mut self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        while let Some(peer_dependency_id) = self.peer_dependencies.read_item() {
            let dependency =
                self.lockfile.buffers.dependencies.as_slice()[peer_dependency_id as usize];
            let resolution =
                self.lockfile.buffers.resolutions.as_slice()[peer_dependency_id as usize];

            self.enqueue_dependency_with_main(
                peer_dependency_id,
                &dependency,
                resolution,
                true,
            )?;
        }
        Ok(())
    }

    // TODO(port): `callbacks` was `comptime anytype` with a `@TypeOf(callbacks) != void and
    // @TypeOf(callbacks.onResolve) != void` check. Modeled as `Option<impl FnOnce(C)>`; Phase B
    // may want a dedicated trait if other callback fields are added.
    pub fn process_dependency_list<C>(
        &mut self,
        dep_list: TaskCallbackList,
        ctx: C,
        on_resolve: Option<impl FnOnce(C)>,
        install_peer: bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if !dep_list.as_slice().is_empty() {
            let dependency_list = dep_list;
            let mut any_root = false;
            for item in dependency_list.as_slice().iter().copied() {
                self.process_dependency_list_item(item, Some(&mut any_root), install_peer)?;
            }

            if let Some(on_resolve) = on_resolve {
                if any_root {
                    on_resolve(ctx);
                }
            }

            // `dependency_list.deinit(this.allocator)` — drops at scope end.
            drop(dependency_list);
        }
        Ok(())
    }
}

// TODO(port): `Resolution.tag` enum path — adjust once `crate::Resolution` lands.
use crate::resolution::Tag as ResolutionTag;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/processDependencyList.zig (360 lines)
//   confidence: medium
//   todos:      11
//   notes:      Resolver count/resolve are unbounded generics pending a StringBuilder trait; `callbacks: anytype` flattened to Option<FnOnce>; borrowck reshape on lockfile buffer indexing.
// ──────────────────────────────────────────────────────────────────────────
