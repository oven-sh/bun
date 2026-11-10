use bun_collections::{DynamicBitSet, HashMap};
use bun_io::Write;
use bun_semver as semver;

use crate::lockfile_real::package::PackageColumns as _;
use crate::package_manager_real::{PackageUpdateInfo, TrackInstalledBin};
use bun_core::fmt::{PathSep, escape_control_chars};
use bun_install::lockfile::{Printer, package::Meta as PackageMeta, reachable};
use bun_install::{
    self as install, Bin, Dependency, DependencyID, DependencyVersionTag, INVALID_PACKAGE_ID,
    PackageID, PackageManager, PackageNameHash, Resolution, Subcommand, bin, resolution,
};
use bun_sys::Fd;

type Bitset = DynamicBitSet;

fn print_installed_workspace_section<W: Write>(
    this: &Printer,
    manager: &mut PackageManager,
    writer: &mut W,
    workspace_package_id: PackageID,
    installed: &Bitset,
    printed_new_install: &mut bool,
    id_map: Option<&mut [DependencyID]>,
    update_owners: &[PackageID],
    // The summary has no other sections, so `print_catalog_entry_updates` runs here.
    sole_section: bool,
    enable_ansi_colors: bool,
    print_section_header: bool,
) -> Result<(), crate::Error> {
    let lockfile = &this.lockfile;
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let packages_slice = lockfile.packages.slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let workspace_res = &packages_slice.items_resolution()[workspace_package_id as usize];
    let names = packages_slice.items_name();
    let pkg_metas = packages_slice.items_meta();
    debug_assert!(
        workspace_res.tag == resolution::Tag::Workspace
            || workspace_res.tag == resolution::Tag::Root
    );
    let resolutions_list = packages_slice.items_resolutions();
    let mut printed_section_header = false;
    let mut printed_update = false;

    // It's possible to have duplicate dependencies with the same version and resolution.
    // While both are technically installed, only one was chosen and should be printed.
    let mut dep_dedupe: HashMap<PackageNameHash, ()> = HashMap::new();
    // `updating_packages` holds one original per name, so a name declared by several owners (or groups) is one row.
    let mut update_dedupe: HashMap<PackageNameHash, ()> = HashMap::new();

    let mut id_map = id_map;
    macro_rules! print_section_header_once {
        () => {
            if print_section_header && !printed_section_header {
                printed_section_header = true;
                bun_core::write_pretty!(
                    writer,
                    enable_ansi_colors,
                    "<r>\n<cyan>{s}<r><d>:<r>\n",
                    bstr::BStr::new(names[workspace_package_id as usize].slice(string_buf)),
                )?;
            }
        };
    }

    // find the updated packages
    for &owner in update_owners {
        for dep_id in
            resolutions_list[owner as usize].begin()..resolutions_list[owner as usize].end()
        {
            match should_print_package_install(
                this,
                manager,
                dep_id,
                installed,
                if owner == workspace_package_id {
                    id_map.as_deref_mut()
                } else {
                    None
                },
                pkg_metas,
            ) {
                ShouldPrintPackageInstallResult::Yes
                | ShouldPrintPackageInstallResult::No
                | ShouldPrintPackageInstallResult::Return => {}
                ShouldPrintPackageInstallResult::Update(update_info) => {
                    if update_dedupe
                        .get_or_put(dependencies[dep_id as usize].name_hash)?
                        .found_existing
                    {
                        continue;
                    }
                    *printed_new_install = true;
                    printed_update = true;

                    print_section_header_once!();
                    print_updated_package(this, manager, &update_info, writer, enable_ansi_colors)?;
                }
            }
        }
    }

    if !print_section_header {
        if sole_section
            && print_catalog_entry_updates(
                this,
                manager,
                installed,
                pkg_metas,
                &mut update_dedupe,
                writer,
                enable_ansi_colors,
            )?
        {
            *printed_new_install = true;
            printed_update = true;
        }
        if print_transitive_updates(
            this,
            manager,
            update_owners,
            installed,
            writer,
            enable_ansi_colors,
        )? {
            *printed_new_install = true;
            printed_update = true;
        }
        if manager.subcommand == Subcommand::Update && !manager.kept_patched_text.is_empty() {
            writer.write_all(&manager.kept_patched_text)?;
            manager.kept_patched_text.clear();
            *printed_new_install = true;
            printed_update = true;
        }
    }

    for dep_id in resolutions_list[workspace_package_id as usize].begin()
        ..resolutions_list[workspace_package_id as usize].end()
    {
        match should_print_package_install(
            this,
            manager,
            dep_id,
            installed,
            id_map.as_deref_mut(),
            pkg_metas,
        ) {
            ShouldPrintPackageInstallResult::Return => return Ok(()),
            ShouldPrintPackageInstallResult::Yes => {}
            ShouldPrintPackageInstallResult::No | ShouldPrintPackageInstallResult::Update(_) => {
                continue;
            }
        }

        let dep = &dependencies[dep_id as usize];
        let package_id = resolutions[dep_id as usize];

        if dep_dedupe.get_or_put(dep.name_hash)?.found_existing {
            continue;
        }

        *printed_new_install = true;

        print_section_header_once!();

        if printed_update {
            printed_update = false;
            writer.write_str("\n")?;
        }
        print_installed_package(this, manager, dep, package_id, writer, enable_ansi_colors)?;
    }

    Ok(())
}

struct PackageUpdatePrintInfo {
    version: semver::Version,
    resolution: Resolution,
    dependency_id: DependencyID,
    package_id: PackageID,
}

enum ShouldPrintPackageInstallResult {
    Yes,
    No,
    Return,
    Update(Box<PackageUpdatePrintInfo>),
}

fn should_print_package_install(
    this: &Printer,
    manager: &PackageManager,
    dep_id: DependencyID,
    installed: &Bitset,
    id_map: Option<&mut [DependencyID]>,
    pkg_metas: &[PackageMeta],
) -> ShouldPrintPackageInstallResult {
    let dependencies = this.lockfile.buffers.dependencies.as_slice();
    let resolutions = this.lockfile.buffers.resolutions.as_slice();
    let dependency = &dependencies[dep_id as usize];
    let package_id = resolutions[dep_id as usize];

    if dependency.behavior.is_workspace() || (package_id as usize) >= this.lockfile.packages.len() {
        return ShouldPrintPackageInstallResult::No;
    }

    if let Some(map) = id_map {
        debug_assert_eq!(this.updates.len(), map.len());
        let is_update = manager.subcommand == Subcommand::Update;
        for (update, update_dependency_id) in this.updates.iter().zip(map.iter_mut()) {
            if update.failed {
                return ShouldPrintPackageInstallResult::Return;
            }
            if !is_update
                && update.matches(dependency, this.lockfile.buffers.string_bytes.as_slice())
            {
                if *update_dependency_id == INVALID_PACKAGE_ID {
                    *update_dependency_id = dep_id;
                }

                return ShouldPrintPackageInstallResult::No;
            }
        }
    }

    // `bun update` reports a row that moved onto a package that was already on disk, so its update check runs before the installed check.
    let is_installed = installed.is_set(package_id as usize);
    if !is_installed && manager.subcommand != Subcommand::Update {
        return ShouldPrintPackageInstallResult::No;
    }

    // It's possible this package was installed but the dependency is disabled.
    // Have "zod@1.0.0" in dependencies and `zod2@npm:zod@1.0.0` in devDependencies
    // and install with --omit=dev.
    if this.lockfile.is_resolved_dependency_disabled(
        dep_id,
        this.options.local_package_features,
        &pkg_metas[package_id as usize],
        this.options.cpu,
        this.options.os,
        this.options.libc,
    ) {
        return ShouldPrintPackageInstallResult::No;
    }

    let resolution = this.lockfile.packages.items_resolution()[package_id as usize];
    if resolution.tag == resolution::Tag::Npm {
        let npm_version = resolution.npm().version;
        let string_buf = this.lockfile.buffers.string_bytes.as_slice();
        if let Some(entry) = update_info_of(manager, dependency, string_buf) {
            if let Some(original_version) = entry.original_version {
                if !original_version.eql(npm_version) {
                    return ShouldPrintPackageInstallResult::Update(Box::new(
                        PackageUpdatePrintInfo {
                            version: original_version,
                            resolution,
                            dependency_id: dep_id,
                            package_id,
                        },
                    ));
                }
            }
        }
    }

    if !is_installed {
        return ShouldPrintPackageInstallResult::No;
    }

    ShouldPrintPackageInstallResult::Yes
}

/// The original of a `catalog:` row whose entry `record_catalog_originals` recorded.
fn catalog_update_info<'a>(
    manager: &'a PackageManager,
    dependency: &Dependency,
    string_buf: &[u8],
) -> Option<&'a PackageUpdateInfo> {
    if dependency.version.tag != DependencyVersionTag::Catalog
        || manager.updating_packages.is_empty()
    {
        return None;
    }
    manager
        .updating_packages
        .get(&PackageUpdateInfo::catalog_row_key(
            dependency.name.slice(string_buf),
            dependency.version.catalog().slice(string_buf),
        ))
}

fn update_info_of<'a>(
    manager: &'a PackageManager,
    dependency: &Dependency,
    string_buf: &[u8],
) -> Option<&'a PackageUpdateInfo> {
    catalog_update_info(manager, dependency, string_buf).or_else(|| {
        manager
            .updating_packages
            .get(dependency.name.slice(string_buf))
    })
}

fn print_updated_package<W: Write>(
    this: &Printer,
    manager: &mut PackageManager,
    update_info: &PackageUpdatePrintInfo,
    writer: &mut W,
    enable_ansi_colors: bool,
) -> Result<(), crate::Error> {
    let string_buf = this.lockfile.buffers.string_bytes.as_slice();
    let packages_slice = this.lockfile.packages.slice();
    let package_id = update_info.package_id as usize;
    let dependency =
        &this.lockfile.buffers.dependencies.as_slice()[update_info.dependency_id as usize];
    let dep_name = dependency.name.slice(string_buf);
    let later = later_version_text(
        manager,
        packages_slice.items_name()[package_id].slice(string_buf),
        packages_slice.items_name_hash()[package_id],
        &update_info.resolution,
    )?;
    let Some(entry) = update_info_of(manager, dependency, string_buf) else {
        return Ok(());
    };
    write_updated_row(
        writer,
        dep_name,
        update_info.version,
        &entry.original_version_string_buf,
        update_info.resolution.npm().version,
        string_buf,
        later.as_deref(),
        enable_ansi_colors,
    )
}

fn later_version_text(
    manager: &mut PackageManager,
    package_name: &[u8],
    name_hash: PackageNameHash,
    resolution: &Resolution,
) -> Result<Option<Vec<u8>>, crate::Error> {
    let Some(later) = manager.format_later_version_in_cache(package_name, name_hash, resolution)
    else {
        return Ok(None);
    };
    let mut text: Vec<u8> = Vec::new();
    write!(text, "{later}")?;
    Ok(Some(text))
}

fn write_updated_row<W: Write>(
    writer: &mut W,
    name: &[u8],
    from: semver::Version,
    from_buf: &[u8],
    to: semver::Version,
    to_buf: &[u8],
    later: Option<&[u8]>,
    enable_ansi_colors: bool,
) -> Result<(), crate::Error> {
    if enable_ansi_colors {
        write!(
            writer,
            bun_core::pretty_fmt!("<r><cyan>↑<r> <b>{s}<r> <d>{f} →<r> <b><cyan>{f}<r>", true),
            bstr::BStr::new(name),
            from.fmt(from_buf),
            to.fmt(to_buf),
        )?;
    } else {
        write!(
            writer,
            bun_core::pretty_fmt!("<r>^ <b>{s}<r> <d>{f} -\\><r> <b>{f}<r>", false),
            bstr::BStr::new(name),
            from.fmt(from_buf),
            to.fmt(to_buf),
        )?;
    }

    if let Some(later) = later {
        bun_core::write_pretty!(
            writer,
            enable_ansi_colors,
            " <d>(<blue>v{s} available<r><d>)<r>",
            bstr::BStr::new(later),
        )?;
    }
    writer.write_str("\n")?;

    Ok(())
}

/// The one-section summary only walks the dependencies of `update_owners`, but other workspaces use
/// catalog entries too.
fn print_catalog_entry_updates<W: Write>(
    this: &Printer,
    manager: &mut PackageManager,
    installed: &Bitset,
    pkg_metas: &[PackageMeta],
    update_dedupe: &mut HashMap<PackageNameHash, ()>,
    writer: &mut W,
    enable_ansi_colors: bool,
) -> Result<bool, crate::Error> {
    let string_buf = this.lockfile.buffers.string_bytes.as_slice();
    let dependencies = this.lockfile.buffers.dependencies.as_slice();
    let mut printed = false;
    for (dep_id, dep) in dependencies.iter().enumerate() {
        if catalog_update_info(manager, dep, string_buf).is_none() {
            continue;
        }
        let dep_id = dep_id as DependencyID;
        let ShouldPrintPackageInstallResult::Update(update_info) =
            should_print_package_install(this, manager, dep_id, installed, None, pkg_metas)
        else {
            continue;
        };
        if update_dedupe.get_or_put(dep.name_hash)?.found_existing {
            continue;
        }
        print_updated_package(this, manager, &update_info, writer, enable_ansi_colors)?;
        printed = true;
    }
    Ok(printed)
}

/// The transitive half of `bun update` registers packages that are rows of no walked workspace.
fn print_transitive_updates<W: Write>(
    this: &Printer,
    manager: &mut PackageManager,
    update_owners: &[PackageID],
    installed: &Bitset,
    writer: &mut W,
    enable_ansi_colors: bool,
) -> Result<bool, crate::Error> {
    if !manager
        .updating_packages
        .values()
        .iter()
        .any(|info| info.original_version_literal.is_empty() && info.original_version.is_some())
    {
        return Ok(false);
    }
    let lockfile = this.lockfile;
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let packages_slice = lockfile.packages.slice();
    let names = packages_slice.items_name();
    let name_hashes = packages_slice.items_name_hash();
    let pkg_resolutions = packages_slice.items_resolution();
    let mut workspace_targets = Bitset::init_empty(pkg_resolutions.len())?;
    for &owner in update_owners {
        for &package_id in packages_slice.items_resolutions()[owner as usize]
            .get(lockfile.buffers.resolutions.as_slice())
        {
            if (package_id as usize) < pkg_resolutions.len() {
                workspace_targets.set(package_id as usize);
            }
        }
    }
    let rows = lockfile.buffers.dependencies.iter();
    for (dep, &package_id) in rows.zip(lockfile.buffers.resolutions.iter()) {
        if (package_id as usize) < pkg_resolutions.len()
            && catalog_update_info(manager, dep, string_buf).is_some()
        {
            workspace_targets.set(package_id as usize);
        }
    }

    let mut printed = false;
    let mut installed_ids = installed.iterator::<true, true>();
    while let Some(package_id) = installed_ids.next() {
        if package_id >= pkg_resolutions.len() || workspace_targets.is_set(package_id) {
            continue;
        }
        let resolution = &pkg_resolutions[package_id];
        if resolution.tag != resolution::Tag::Npm {
            continue;
        }
        let name = names[package_id].slice(string_buf);
        let Some(info) = manager.updating_packages.get(name) else {
            continue;
        };
        if !info.original_version_literal.is_empty() {
            continue;
        }
        let Some(original) = info.original_version else {
            continue;
        };
        let version = resolution.npm().version;
        if original.eql(version) {
            continue;
        }
        let later = later_version_text(manager, name, name_hashes[package_id], resolution)?;
        let Some(info) = manager.updating_packages.get(name) else {
            continue;
        };
        write_updated_row(
            writer,
            name,
            original,
            &info.original_version_string_buf,
            version,
            string_buf,
            later.as_deref(),
            enable_ansi_colors,
        )?;
        printed = true;
    }
    Ok(printed)
}

fn print_installed_package<W: Write>(
    this: &Printer,
    manager: &mut PackageManager,
    dependency: &Dependency,
    package_id: PackageID,
    writer: &mut W,
    enable_ansi_colors: bool,
) -> Result<(), crate::Error> {
    let string_buf = this.lockfile.buffers.string_bytes.as_slice();
    let packages_slice = this.lockfile.packages.slice();
    let resolution: Resolution = packages_slice.items_resolution()[package_id as usize];
    let name = dependency.name.slice(string_buf);
    let version = bun_core::fmt::for_terminal(resolution.fmt(string_buf, PathSep::Posix));

    let package_name = packages_slice.items_name()[package_id as usize].slice(string_buf);
    if let Some(later_version_fmt) =
        manager.format_later_version_in_cache(package_name, dependency.name_hash, &resolution)
    {
        if enable_ansi_colors {
            write!(
                writer,
                bun_core::pretty_fmt!(
                    "<r><green>+<r> <b>{s}<r><d>@{f}<r> <d>(<blue>v{f} available<r><d>)<r>\n",
                    true
                ),
                escape_control_chars(name),
                version,
                later_version_fmt,
            )?;
        } else {
            write!(
                writer,
                bun_core::pretty_fmt!("<r>+ {s}<r><d>@{f}<r> <d>(v{f} available)<r>\n", false),
                escape_control_chars(name),
                version,
                later_version_fmt,
            )?;
        }

        return Ok(());
    }

    if enable_ansi_colors {
        write!(
            writer,
            bun_core::pretty_fmt!("<r><green>+<r> <b>{s}<r><d>@{f}<r>\n", true),
            escape_control_chars(name),
            version,
        )?;
    } else {
        write!(
            writer,
            bun_core::pretty_fmt!("<r>+ {s}<r><d>@{f}<r>\n", false),
            escape_control_chars(name),
            version,
        )?;
    }

    Ok(())
}

fn print_installed_update_request<W: Write>(
    writer: &mut W,
    dependency: &Dependency,
    resolution: &Resolution,
    string_buf: &[u8],
    has_binaries: bool,
    enable_ansi_colors: bool,
) -> Result<(), crate::Error> {
    bun_core::write_pretty!(
        writer,
        enable_ansi_colors,
        "<r><green>installed<r> <b>{s}<r>",
        escape_control_chars(dependency.name.slice(string_buf)),
    )?;

    if let Some(npm) = dependency.version.try_npm().filter(|npm| npm.is_alias) {
        bun_core::write_pretty!(
            writer,
            enable_ansi_colors,
            "<d>@npm:<r><b>{s}<r>",
            escape_control_chars(npm.name.slice(string_buf)),
        )?;
    }

    bun_core::write_pretty!(
        writer,
        enable_ansi_colors,
        "<d>@{f}<r>",
        bun_core::fmt::for_terminal(resolution.fmt(string_buf, PathSep::Posix)),
    )?;
    writer.write_str(if has_binaries {
        " with binaries:\n"
    } else {
        "\n"
    })?;

    Ok(())
}

/// - Prints an empty newline with no diffs
/// - Prints a leading and trailing blank newline with diffs
#[inline(never)]
pub(crate) fn print<W: Write>(
    this: &Printer,
    manager: &mut PackageManager,
    writer: &mut W,
    log_level: install::package_manager::Options::LogLevel,
    enable_ansi_colors: bool,
) -> Result<(), crate::Error> {
    writer.write_str("\n")?;
    let slice = this.lockfile.packages.slice();
    let bins: &[Bin] = slice.items_bin();
    let resolved: &[Resolution] = slice.items_resolution();
    if resolved.is_empty() {
        return Ok(());
    }
    let string_buf = this.lockfile.buffers.string_bytes.as_slice();
    let resolutions_list = slice.items_resolutions();
    let pkg_metas = slice.items_meta();
    let resolutions_buffer: &[PackageID] = this.lockfile.buffers.resolutions.as_slice();
    let dependencies_buffer: &[Dependency] = this.lockfile.buffers.dependencies.as_slice();
    if dependencies_buffer.is_empty() {
        return Ok(());
    }
    let mut id_map: Vec<DependencyID> = vec![INVALID_PACKAGE_ID; this.updates.len()];

    let end = resolved.len() as PackageID;

    let mut had_printed_new_install = false;
    if let Some(installed) = this.successfully_installed.as_ref() {
        if log_level.is_verbose() {
            let mut workspaces_to_print: Vec<DependencyID> = Vec::new();

            for dep_id in resolutions_list[0].begin()..resolutions_list[0].end() {
                let dep = &dependencies_buffer[dep_id as usize];
                if dep.behavior.is_workspace() {
                    workspaces_to_print.push(dep_id);
                }
            }

            // Fills `id_map`.
            for &workspace_dep_id in &workspaces_to_print {
                let workspace_package_id = resolutions_buffer[workspace_dep_id as usize];
                for dep_id in resolutions_list[workspace_package_id as usize].begin()
                    ..resolutions_list[workspace_package_id as usize].end()
                {
                    let _ = should_print_package_install(
                        this,
                        manager,
                        dep_id,
                        installed,
                        Some(&mut id_map),
                        pkg_metas,
                    );
                }
            }

            print_installed_workspace_section(
                this,
                manager,
                writer,
                0,
                installed,
                &mut had_printed_new_install,
                None,
                &[0],
                /* sole_section */ false,
                enable_ansi_colors,
                /* print_section_header */ false,
            )?;

            for &workspace_dep_id in &workspaces_to_print {
                let workspace_package_id = resolutions_buffer[workspace_dep_id as usize];
                print_installed_workspace_section(
                    this,
                    manager,
                    writer,
                    workspace_package_id,
                    installed,
                    &mut had_printed_new_install,
                    None,
                    &[workspace_package_id],
                    /* sole_section */ false,
                    enable_ansi_colors,
                    /* print_section_header */ true,
                )?;
            }
        } else {
            // just print installed packages for the current workspace
            let mut workspace_package_id: PackageID = 0;
            if let Some(workspace_name_hash) = manager.workspace_name_hash {
                for dep_id in resolutions_list[0].begin()..resolutions_list[0].end() {
                    let dep = &dependencies_buffer[dep_id as usize];
                    if dep.behavior.is_workspace() && dep.name_hash == workspace_name_hash {
                        workspace_package_id = resolutions_buffer[dep_id as usize];
                        break;
                    }
                }
            }

            // `bun update -r` / `--filter`: the `^` rows of every selected workspace, whether or not the cwd is one of them.
            let mut update_owners: Vec<PackageID> = vec![workspace_package_id];
            if manager.subcommand == Subcommand::Update {
                if let Some(targets) = manager.update_target_workspaces.as_deref() {
                    let names = slice.items_name();
                    let name_hashes = slice.items_name_hash();
                    let members = (resolutions_list[0].begin()..resolutions_list[0].end())
                        .filter(|&dep_id| {
                            dependencies_buffer[dep_id as usize].behavior.is_workspace()
                        })
                        .map(|dep_id| resolutions_buffer[dep_id as usize]);
                    update_owners = core::iter::once(0)
                        .chain(members)
                        .filter(|&importer| {
                            importer < end
                                && targets.iter().any(|target| {
                                    target.matches(
                                        importer == 0,
                                        name_hashes[importer as usize],
                                        names[importer as usize].slice(string_buf),
                                    )
                                })
                        })
                        .collect();
                }
            }

            print_installed_workspace_section(
                this,
                manager,
                writer,
                workspace_package_id,
                installed,
                &mut had_printed_new_install,
                Some(&mut id_map),
                &update_owners,
                /* sole_section */ true,
                enable_ansi_colors,
                /* print_section_header */ false,
            )?;
        }
    } else {
        debug_assert_eq!(dependencies_buffer.len(), resolutions_buffer.len());
        let is_update = manager.subcommand == Subcommand::Update;
        // List only the packages that an install would put on disk, and each of them once.
        let wanted = reachable::packages(
            this.lockfile,
            resolutions_buffer,
            reachable::Options {
                bundled: true,
                ..reachable::Options::install(manager)
            },
        );
        let mut listed = Bitset::init_empty(resolved.len())?;
        // A package is printed under the name of the first edge that reaches it. Peer edges come
        // last, so a peer dependency's name is used only when no other edge reaches the package.
        let edges = || {
            dependencies_buffer
                .iter()
                .zip(resolutions_buffer)
                .enumerate()
        };
        'outer: for (dep_id, (dependency, &package_id)) in edges()
            .filter(|(_, (dependency, _))| !dependency.behavior.is_peer())
            .chain(edges().filter(|(_, (dependency, _))| dependency.behavior.is_peer()))
        {
            if package_id >= end {
                continue;
            }
            let listed_before = listed.is_set(package_id as usize);
            listed.set(package_id as usize);
            let package_name = dependency.name.slice(string_buf);

            if !this.updates.is_empty() {
                debug_assert_eq!(this.updates.len(), id_map.len());
                for (update, dependency_id) in this.updates.iter().zip(id_map.iter_mut()) {
                    if update.failed {
                        return Ok(());
                    }
                    if !is_update && update.matches(dependency, string_buf) {
                        if *dependency_id == INVALID_PACKAGE_ID {
                            *dependency_id = dep_id as DependencyID;
                        }

                        continue 'outer;
                    }
                }
            }
            if listed_before || !wanted.is_set(package_id as usize) {
                continue;
            }

            bun_core::write_pretty!(
                writer,
                enable_ansi_colors,
                " <r><b>{s}<r><d>@<b>{f}<r>\n",
                bun_core::fmt::escape_control_chars(package_name),
                bun_core::fmt::for_terminal(
                    resolved[package_id as usize].fmt(string_buf, PathSep::Auto)
                ),
            )?;
        }
    }

    if had_printed_new_install {
        writer.write_str("\n")?;
    }

    let mut printed_installed_update_request = false;
    for &dependency_id in &id_map {
        if dependency_id == INVALID_PACKAGE_ID {
            continue;
        }
        printed_installed_update_request = true;

        let dependency = &dependencies_buffer[dependency_id as usize];
        let package_id = resolutions_buffer[dependency_id as usize];
        let bin = bins[package_id as usize];
        let resolution = &resolved[package_id as usize];

        if pkg_metas[package_id as usize].is_disabled(
            this.options.cpu,
            this.options.os,
            this.options.libc.for_dependency(dependency.behavior),
        ) {
            bun_core::write_pretty!(
                writer,
                enable_ansi_colors,
                "<r><yellow>skipped<r> <b>{s}<r><d>@{f}<r> <d>(unsupported platform)<r>\n",
                escape_control_chars(dependency.name.slice(string_buf)),
                bun_core::fmt::for_terminal(resolution.fmt(string_buf, PathSep::Posix)),
            )?;
            continue;
        }

        let has_binaries = !matches!(bin.tag, bin::Tag::None | bin::Tag::Dir);
        print_installed_update_request(
            writer,
            dependency,
            resolution,
            string_buf,
            has_binaries,
            enable_ansi_colors,
        )?;
        if !has_binaries {
            continue;
        }

        let mut iterator = bin::NamesIterator {
            bin,
            i: 0,
            done: false,
            dir_iterator: None,
            package_name: dependency.name,
            // Never read on the .map/.file/.named_file paths.
            destination_node_modules: Fd::INVALID,
            buf: bun_paths::path_buffer_pool::get(),
            string_buffer: string_buf,
            extern_string_buf: this.lockfile.buffers.extern_strings.as_slice(),
        };
        while let Some(bin_name) = iterator.next().unwrap_or(None) {
            bun_core::write_pretty!(
                writer,
                enable_ansi_colors,
                "<r> <d>- <r><b>{s}<r>\n",
                escape_control_chars(bin_name),
            )?;
            if matches!(manager.track_installed_bin, TrackInstalledBin::Pending) {
                manager.track_installed_bin = TrackInstalledBin::Basename(Box::from(bin_name));
            }
        }
    }

    if printed_installed_update_request {
        writer.write_str("\n")?;
    }

    Ok(())
}
