use bun_collections::{DynamicBitSet, HashMap};
use bun_core::Output;
use bun_io::Write;
use bun_semver as semver;

use bun_core::fmt::PathSep;
use bun_install::lockfile::{Printer, package::Meta as PackageMeta};
use bun_install::{
    self as install, Bin, Dependency, DependencyID, INVALID_PACKAGE_ID, PackageID, PackageManager,
    PackageNameHash, Resolution, bin, resolution,
};
// PORT NOTE: Zig `slice.items(.field)` → trait-provided `items_<field>()`
// accessors on `MultiArrayList<Package>` / its `Slice`.
use crate::lockfile_real::package::{PackageColumns as _};
use crate::package_manager_real::TrackInstalledBin;
use bun_sys::{Dir as SysDir, Fd};

type Bitset = DynamicBitSet;

// PORT NOTE: `comptime print_section_header: enum(u1) { print_section_header, dont_print_section_header }`
// is a two-state comptime flag; mapped to `const PRINT_SECTION_HEADER: bool`.
fn print_installed_workspace_section<
    W,
    const ENABLE_ANSI_COLORS: bool,
    const PRINT_SECTION_HEADER: bool,
>(
    this: &Printer,
    manager: &mut PackageManager,
    writer: &mut W,
    workspace_package_id: PackageID,
    installed: &Bitset,
    printed_new_install: &mut bool,
    id_map: Option<&mut [DependencyID]>,
) -> Result<(), bun_core::Error>
where
    W: Write,
{
    // TODO(port): narrow error set
    let lockfile = &this.lockfile;
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let packages_slice = lockfile.packages.slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    // PORT NOTE: Zig `slice.items(.field)` → derive(MultiArrayElement)-generated `items_<field>()`.
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
    // `defer dep_dedupe.deinit()` — Drop handles this.

    // PORT NOTE: reshaped for borrowck — `id_map` is reborrowed per call below.
    let mut id_map = id_map;

    // find the updated packages
    for _dep_id in resolutions_list[workspace_package_id as usize].begin()
        ..resolutions_list[workspace_package_id as usize].end()
    {
        let dep_id: DependencyID = DependencyID::try_from(_dep_id).expect("int cast");

        match should_print_package_install(
            this,
            manager,
            dep_id,
            installed,
            id_map.as_deref_mut(),
            pkg_metas,
        ) {
            ShouldPrintPackageInstallResult::Yes
            | ShouldPrintPackageInstallResult::No
            | ShouldPrintPackageInstallResult::Return => {}
            ShouldPrintPackageInstallResult::Update(update_info) => {
                *printed_new_install = true;
                printed_update = true;

                if PRINT_SECTION_HEADER {
                    if !printed_section_header {
                        printed_section_header = true;
                        let workspace_name = names[workspace_package_id as usize].slice(string_buf);
                        // TODO(port): Output.prettyFmt comptime ANSI format string
                        write!(
                            writer,
                            "{}",
                            Output::pretty_fmt_args(
                                "<r>\n<cyan>{s}<r><d>:<r>\n",
                                ENABLE_ANSI_COLORS,
                                (bstr::BStr::new(workspace_name),),
                            ),
                        )?;
                    }
                }

                print_updated_package::<W, ENABLE_ANSI_COLORS>(this, update_info, writer)?;
            }
        }
    }

    for _dep_id in resolutions_list[workspace_package_id as usize].begin()
        ..resolutions_list[workspace_package_id as usize].end()
    {
        let dep_id: DependencyID = DependencyID::try_from(_dep_id).expect("int cast");

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

        if PRINT_SECTION_HEADER {
            if !printed_section_header {
                printed_section_header = true;
                let workspace_name = names[workspace_package_id as usize].slice(string_buf);
                // TODO(port): Output.prettyFmt comptime ANSI format string
                write!(
                    writer,
                    "{}",
                    Output::pretty_fmt_args(
                        "<r>\n<cyan>{s}<r><d>:<r>\n",
                        ENABLE_ANSI_COLORS,
                        (bstr::BStr::new(workspace_name),),
                    ),
                )?;
            }
        }

        if printed_update {
            printed_update = false;
            writer.write_str("\n")?;
        }
        print_installed_package::<W, ENABLE_ANSI_COLORS>(this, manager, dep, package_id, writer)?;
    }

    Ok(())
}

// TODO(port): lifetime — `version_buf` borrows from `PackageManager.updating_packages` entry;
// this struct is a transient return value. PORTING.md says no struct lifetimes in Phase A,
// but raw `*const [u8]` here would be strictly worse. Revisit in Phase B.
struct PackageUpdatePrintInfo<'a> {
    version: semver::Version,
    version_buf: &'a [u8],
    resolution: Resolution,
    dependency_id: DependencyID,
}

enum ShouldPrintPackageInstallResult<'a> {
    Yes,
    No,
    Return,
    Update(PackageUpdatePrintInfo<'a>),
}

fn should_print_package_install<'a>(
    this: &Printer,
    manager: &'a PackageManager,
    dep_id: DependencyID,
    installed: &Bitset,
    id_map: Option<&mut [DependencyID]>,
    pkg_metas: &[PackageMeta],
) -> ShouldPrintPackageInstallResult<'a> {
    let dependencies = this.lockfile.buffers.dependencies.as_slice();
    let resolutions = this.lockfile.buffers.resolutions.as_slice();
    let dependency = &dependencies[dep_id as usize];
    let package_id = resolutions[dep_id as usize];

    if dependency.behavior.is_workspace() || (package_id as usize) >= this.lockfile.packages.len() {
        return ShouldPrintPackageInstallResult::No;
    }

    if let Some(map) = id_map {
        debug_assert_eq!(this.updates.len(), map.len());
        for (update, update_dependency_id) in this.updates.iter().zip(map.iter_mut()) {
            if update.failed {
                return ShouldPrintPackageInstallResult::Return;
            }
            if update.matches(dependency, this.lockfile.buffers.string_bytes.as_slice()) {
                if *update_dependency_id == INVALID_PACKAGE_ID {
                    *update_dependency_id = dep_id;
                }

                return ShouldPrintPackageInstallResult::No;
            }
        }
    }

    if !installed.is_set(package_id as usize) {
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
    ) {
        return ShouldPrintPackageInstallResult::No;
    }

    let resolution = this.lockfile.packages.items_resolution()[package_id as usize];
    if resolution.tag == resolution::Tag::Npm {
        let npm_version = resolution.npm().version;
        let name = dependency
            .name
            .slice(this.lockfile.buffers.string_bytes.as_slice());
        if let Some(entry) = manager.updating_packages.get(name) {
            if let Some(original_version) = entry.original_version {
                if !original_version.eql(npm_version) {
                    return ShouldPrintPackageInstallResult::Update(PackageUpdatePrintInfo {
                        version: original_version,
                        version_buf: entry.original_version_string_buf.as_ref(),
                        resolution,
                        dependency_id: dep_id,
                    });
                }
            }
        }
    }

    ShouldPrintPackageInstallResult::Yes
}

fn print_updated_package<W, const ENABLE_ANSI_COLORS: bool>(
    this: &Printer,
    update_info: PackageUpdatePrintInfo<'_>,
    writer: &mut W,
) -> Result<(), bun_core::Error>
where
    W: Write,
{
    // TODO(port): narrow error set
    let string_buf = this.lockfile.buffers.string_bytes.as_slice();
    let dependency =
        &this.lockfile.buffers.dependencies.as_slice()[update_info.dependency_id as usize];

    // TODO(port): Output.prettyFmt comptime ANSI format string
    let fmt = if ENABLE_ANSI_COLORS {
        "<r><cyan>↑<r> <b>{s}<r><d> <b>{f} →<r> <b><cyan>{f}<r>\n"
    } else {
        "<r>^ <b>{s}<r><d> <b>{f} -\\><r> <b>{f}<r>\n"
    };

    write!(
        writer,
        "{}",
        Output::pretty_fmt_args(
            fmt,
            ENABLE_ANSI_COLORS,
            (
                bstr::BStr::new(dependency.name.slice(string_buf)),
                update_info.version.fmt(update_info.version_buf),
                update_info.resolution.npm().version.fmt(string_buf),
            ),
        ),
    )?;

    Ok(())
}

fn print_installed_package<W, const ENABLE_ANSI_COLORS: bool>(
    this: &Printer,
    manager: &mut PackageManager,
    dependency: &Dependency,
    package_id: PackageID,
    writer: &mut W,
) -> Result<(), bun_core::Error>
where
    W: Write,
{
    // TODO(port): narrow error set
    let string_buf = this.lockfile.buffers.string_bytes.as_slice();
    let packages_slice = this.lockfile.packages.slice();
    let resolution: Resolution = packages_slice.items_resolution()[package_id as usize];
    let name = dependency.name.slice(string_buf);

    let package_name = packages_slice.items_name()[package_id as usize].slice(string_buf);
    if let Some(later_version_fmt) =
        manager.format_later_version_in_cache(package_name, dependency.name_hash, resolution)
    {
        // TODO(port): Output.prettyFmt comptime ANSI format string
        let fmt = if ENABLE_ANSI_COLORS {
            "<r><green>+<r> <b>{s}<r><d>@{f}<r> <d>(<blue>v{f} available<r><d>)<r>\n"
        } else {
            "<r>+ {s}<r><d>@{f}<r> <d>(v{f} available)<r>\n"
        };
        write!(
            writer,
            "{}",
            Output::pretty_fmt_args(
                fmt,
                ENABLE_ANSI_COLORS,
                (
                    bstr::BStr::new(name),
                    resolution.fmt(string_buf, PathSep::Posix),
                    later_version_fmt,
                ),
            ),
        )?;

        return Ok(());
    }

    // TODO(port): Output.prettyFmt comptime ANSI format string
    let fmt = if ENABLE_ANSI_COLORS {
        "<r><green>+<r> <b>{s}<r><d>@{f}<r>\n"
    } else {
        "<r>+ {s}<r><d>@{f}<r>\n"
    };

    write!(
        writer,
        "{}",
        Output::pretty_fmt_args(
            fmt,
            ENABLE_ANSI_COLORS,
            (
                bstr::BStr::new(name),
                resolution.fmt(string_buf, PathSep::Posix),
            ),
        ),
    )?;

    Ok(())
}

/// - Prints an empty newline with no diffs
/// - Prints a leading and trailing blank newline with diffs
pub fn print<W, const ENABLE_ANSI_COLORS: bool>(
    this: &Printer,
    manager: &mut PackageManager,
    writer: &mut W,
    log_level: install::package_manager::Options::LogLevel,
) -> Result<(), bun_core::Error>
where
    W: Write,
{
    // TODO(port): narrow error set
    writer.write_str("\n")?;
    // `allocator` param dropped — global mimalloc.
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
    // `defer free` — Drop handles this.

    let end = resolved.len() as PackageID;

    let mut had_printed_new_install = false;
    if let Some(installed) = this.successfully_installed.as_ref() {
        if log_level.is_verbose() {
            let mut workspaces_to_print: Vec<DependencyID> = Vec::new();
            // `defer deinit` — Drop handles this.

            for dep_id in resolutions_list[0].begin()..resolutions_list[0].end() {
                let dep = &dependencies_buffer[dep_id as usize];
                if dep.behavior.is_workspace() {
                    workspaces_to_print.push(DependencyID::try_from(dep_id).expect("int cast"));
                }
            }

            let mut found_workspace_to_print = false;
            for &workspace_dep_id in &workspaces_to_print {
                let workspace_package_id = resolutions_buffer[workspace_dep_id as usize];
                for dep_id in resolutions_list[workspace_package_id as usize].begin()
                    ..resolutions_list[workspace_package_id as usize].end()
                {
                    match should_print_package_install(
                        this,
                        manager,
                        DependencyID::try_from(dep_id).expect("int cast"),
                        installed,
                        Some(&mut id_map),
                        pkg_metas,
                    ) {
                        ShouldPrintPackageInstallResult::Yes => found_workspace_to_print = true,
                        _ => {}
                    }
                }
            }
            let _ = found_workspace_to_print;

            print_installed_workspace_section::<W, ENABLE_ANSI_COLORS, false>(
                this,
                manager,
                writer,
                0,
                installed,
                &mut had_printed_new_install,
                None,
            )?;

            for &workspace_dep_id in &workspaces_to_print {
                print_installed_workspace_section::<W, ENABLE_ANSI_COLORS, true>(
                    this,
                    manager,
                    writer,
                    resolutions_buffer[workspace_dep_id as usize],
                    installed,
                    &mut had_printed_new_install,
                    None,
                )?;
            }
        } else {
            // just print installed packages for the current workspace
            let mut workspace_package_id: DependencyID = 0;
            if let Some(workspace_name_hash) = manager.workspace_name_hash {
                for dep_id in resolutions_list[0].begin()..resolutions_list[0].end() {
                    let dep = &dependencies_buffer[dep_id as usize];
                    if dep.behavior.is_workspace() && dep.name_hash == workspace_name_hash {
                        workspace_package_id = resolutions_buffer[dep_id as usize];
                        break;
                    }
                }
            }

            print_installed_workspace_section::<W, ENABLE_ANSI_COLORS, false>(
                this,
                manager,
                writer,
                workspace_package_id,
                installed,
                &mut had_printed_new_install,
                Some(&mut id_map),
            )?;
        }
    } else {
        debug_assert_eq!(dependencies_buffer.len(), resolutions_buffer.len());
        'outer: for (dep_id, (dependency, &package_id)) in dependencies_buffer
            .iter()
            .zip(resolutions_buffer)
            .enumerate()
        {
            if package_id >= end {
                continue;
            }
            if dependency.behavior.is_peer() {
                continue;
            }
            let package_name = dependency.name.slice(string_buf);

            if !this.updates.is_empty() {
                debug_assert_eq!(this.updates.len(), id_map.len());
                for (update, dependency_id) in this.updates.iter().zip(id_map.iter_mut()) {
                    if update.failed {
                        return Ok(());
                    }
                    if update.matches(dependency, string_buf) {
                        if *dependency_id == INVALID_PACKAGE_ID {
                            *dependency_id = dep_id as DependencyID;
                        }

                        continue 'outer;
                    }
                }
            }

            // TODO(port): Output.prettyFmt comptime ANSI format string
            write!(
                writer,
                "{}",
                Output::pretty_fmt_args(
                    " <r><b>{s}<r><d>@<b>{f}<r>\n",
                    ENABLE_ANSI_COLORS,
                    (
                        bstr::BStr::new(package_name),
                        resolved[package_id as usize].fmt(string_buf, PathSep::Auto),
                    ),
                ),
            )?;
        }
    }

    if had_printed_new_install {
        writer.write_str("\n")?;
    }

    if cfg!(debug_assertions) {
        had_printed_new_install = false;
    }

    let mut printed_installed_update_request = false;
    for &dependency_id in &id_map {
        if dependency_id == INVALID_PACKAGE_ID {
            continue;
        }
        if cfg!(debug_assertions) {
            had_printed_new_install = true;
        }

        let name = dependencies_buffer[dependency_id as usize].name;
        let package_id = resolutions_buffer[dependency_id as usize];
        let bin = bins[package_id as usize];

        let package_name = name.slice(string_buf);

        match bin.tag {
            bin::Tag::None | bin::Tag::Dir => {
                printed_installed_update_request = true;

                // TODO(port): Output.prettyFmt comptime ANSI format string
                write!(
                    writer,
                    "{}",
                    Output::pretty_fmt_args(
                        "<r><green>installed<r> <b>{s}<r><d>@{f}<r>\n",
                        ENABLE_ANSI_COLORS,
                        (
                            bstr::BStr::new(package_name),
                            resolved[package_id as usize].fmt(string_buf, PathSep::Posix),
                        ),
                    ),
                )?;
            }
            bin::Tag::Map | bin::Tag::File | bin::Tag::NamedFile => {
                printed_installed_update_request = true;

                let mut iterator = bin::NamesIterator {
                    bin,
                    i: 0,
                    done: false,
                    dir_iterator: None,
                    package_name: name,
                    // PORT NOTE: Zig default `bun.invalid_fd.stdDir()` — never read on
                    // the .map/.file/.named_file paths this arm covers.
                    destination_node_modules: SysDir::from_fd(Fd::INVALID),
                    buf: bun_paths::PathBuffer::uninit(),
                    string_buffer: string_buf,
                    extern_string_buf: this.lockfile.buffers.extern_strings.as_slice(),
                };

                {
                    // TODO(port): Output.prettyFmt comptime ANSI format string
                    write!(
                        writer,
                        "{}",
                        Output::pretty_fmt_args(
                            "<r><green>installed<r> {s}<r><d>@{f}<r> with binaries:\n",
                            ENABLE_ANSI_COLORS,
                            (
                                bstr::BStr::new(package_name),
                                resolved[package_id as usize].fmt(string_buf, PathSep::Posix),
                            ),
                        ),
                    )?;
                }

                {
                    // TODO(port): Output.prettyFmt comptime ANSI format string
                    let fmt = "<r> <d>- <r><b>{s}<r>\n";

                    if matches!(manager.track_installed_bin, TrackInstalledBin::Pending) {
                        // PORT NOTE: `iterator.next()` returns `Result<Option<&[u8]>, E>` (Zig `!?[]const u8`);
                        // `catch null` → `.unwrap_or(None)`. Reshaped for borrowck — `bin_name`'s
                        // borrow of `iterator.buf` must end before the loop's `iterator.next()`.
                        if let Some(bin_name) = iterator.next().unwrap_or(None) {
                            let owned = Box::<[u8]>::from(bin_name);

                            write!(
                                writer,
                                "{}",
                                Output::pretty_fmt_args(
                                    fmt,
                                    ENABLE_ANSI_COLORS,
                                    (bstr::BStr::new(&owned[..]),),
                                ),
                            )?;

                            manager.track_installed_bin = TrackInstalledBin::Basename(owned);
                        }
                    }

                    while let Some(bin_name) = iterator.next().unwrap_or(None) {
                        write!(
                            writer,
                            "{}",
                            Output::pretty_fmt_args(
                                fmt,
                                ENABLE_ANSI_COLORS,
                                (bstr::BStr::new(bin_name),),
                            ),
                        )?;
                    }
                }
            }
        }
    }

    let _ = had_printed_new_install;

    if printed_installed_update_request {
        writer.write_str("\n")?;
    }

    Ok(())
}

// ported from: src/install/lockfile/printer/tree_printer.zig
