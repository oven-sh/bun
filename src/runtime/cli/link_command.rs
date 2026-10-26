use bstr::BStr;

use bun_core::strings;
use bun_core::{Global, Output};
use bun_paths::AbsPath;
use bun_resolver::fs::FileSystem;
use bun_sys::{Dir, Fd, FdDirExt};

use bun_install::Features;
use bun_install::bin_real as bin;
use bun_install::lockfile_real::{Lockfile, package::Package};
use bun_install::package_manager_real::{
    self as pm, CommandLineArguments, PackageManager, Subcommand, attempt_to_create_package_json,
    options::LogLevel, package_manager_options, setup_global_dir,
    update_package_json_and_install_with_manager,
};

use crate::command;

pub(crate) struct LinkCommand;

impl LinkCommand {
    pub(crate) fn exec(ctx: command::Context) -> crate::Result<()> {
        link(ctx)
    }
}

/// The setup that `bun link` and `bun unlink` have in common.
pub(crate) fn init_for_link(
    ctx: &mut command::ContextData,
    subcommand: Subcommand,
) -> crate::Result<(&'static mut PackageManager, Box<[u8]>)> {
    let cli = CommandLineArguments::parse(subcommand)?;
    let (manager, original_cwd) = match pm::init(&mut *ctx, &cli, subcommand) {
        Ok(v) => v,
        Err(bun_install::Error::MissingPackageJSON) if !cli.dry_run => {
            attempt_to_create_package_json()?;
            pm::init(&mut *ctx, &cli, subcommand)?
        }
        Err(e) => return Err(e.into()),
    };

    if manager.options.should_print_command_name() {
        bun_core::prettyln!(
            "<r><b>bun {} <r><d>v{}<r>\n",
            <&'static str>::from(subcommand),
            Global::package_json_version_with_sha,
        );
        Output::flush();
    }

    // Print the messages from loading the config files, because nothing below does.
    if manager.log_mut().has_any() {
        let _ = manager
            .log_mut()
            .print(std::ptr::from_mut(Output::error_writer()));
        manager.log_mut().reset();
    }

    Ok((manager, original_cwd))
}

/// Parses the nearest package.json into an empty lockfile. Exits unless its name is a valid package name.
pub(crate) fn load_package_for_link(
    manager: &mut PackageManager,
    verb: &str,
) -> crate::Result<(Lockfile, Package)> {
    let mut lockfile = Lockfile::default();
    let mut package = Package::default();

    let package_json_source = match bun_ast::to_source(
        manager.original_package_json_path.as_zstr(),
        Default::default(),
    ) {
        Ok(s) => s,
        Err(e) => {
            Output::err_generic(
                "failed to read \"{}\" for {}: {}",
                (
                    BStr::new(manager.original_package_json_path.as_bytes()),
                    verb,
                    BStr::new(e.name()),
                ),
            );
            Global::crash();
        }
    };
    lockfile.init_empty();

    let log = manager.log_mut();
    package.parse::<()>(
        &mut lockfile,
        manager,
        log,
        &package_json_source,
        &mut (),
        Features::FOLDER,
    )?;
    let name = lockfile.str(&package.name);
    if name.is_empty() {
        if manager.options.log_level != LogLevel::Silent {
            bun_core::pretty_errorln!(
                "<r><red>error:<r> package.json missing \"name\" <d>in \"{}\"<r>",
                BStr::new(package_json_source.path.text),
            );
        }
        Global::crash();
    } else if !strings::is_npm_package_name(name) {
        if manager.options.log_level != LogLevel::Silent {
            bun_core::pretty_errorln!(
                "<r><red>error:<r> invalid package.json name \"{}\" <d>in \"{}\"<r>",
                bun_core::fmt::escape_control_chars(name),
                BStr::new(package_json_source.path.text),
            );
        }
        Global::crash();
    }

    Ok((lockfile, package))
}

/// `--dry-run` ends the command here, before the global directory is touched.
pub(crate) fn exit_if_dry_run(manager: &PackageManager, verb: &str, name: &[u8]) {
    if !manager.options.dry_run {
        return;
    }
    if manager.options.log_level != LogLevel::Silent {
        bun_core::prettyln!("<r><d>dry run:<r> would {} \"{}\"", verb, BStr::new(name));
    }
    Output::flush();
    Global::exit(0);
}

/// Opens the global directory (kept in `manager.global_dir`) and its `node_modules`, which it creates.
pub(crate) fn open_global_node_modules(
    manager: &mut PackageManager,
    ctx: &mut command::ContextData,
) -> crate::Result<Dir> {
    let explicit_global_dir: &[u8] = match &ctx.install {
        Some(install_) => install_.global_dir.as_deref().unwrap_or(b""),
        None => b"",
    };
    manager.global_dir = Some(Dir::from_fd(package_manager_options::open_global_dir(
        explicit_global_dir,
    )?));

    setup_global_dir(manager, &&mut *ctx)?;

    match manager
        .global_dir
        .as_ref()
        .unwrap()
        .make_open_path(b"node_modules", Default::default())
    {
        Ok(d) => Ok(d),
        Err(e) => {
            if manager.options.log_level != LogLevel::Silent {
                bun_core::pretty_errorln!(
                    "<r><red>error:<r> failed to create node_modules in global dir due to error {}",
                    BStr::new(e.name()),
                );
            }
            Global::crash();
        }
    }
}

/// Links the package's bins into the global bin dir, or (`unlink`) removes them from it.
pub(crate) fn link_global_bins(
    manager: &PackageManager,
    node_modules: &Dir,
    lockfile: &Lockfile,
    package: &Package,
    unlink: bool,
) -> Option<bun_install::Error> {
    if package.bin.tag == bin::Tag::None {
        return None;
    }
    let name = lockfile.str(&package.name);
    let mut link_target_buf = bun_paths::path_buffer_pool::get();
    let mut link_dest_buf = bun_paths::path_buffer_pool::get();
    let mut link_rel_buf = bun_paths::path_buffer_pool::get();

    // Built twice, because `target_node_modules_path` (`&`) and `node_modules_path` (`&mut`) can't
    // be the same value.
    let node_modules_path = || match <AbsPath>::init_fd_path(Fd::from_std_dir(node_modules)) {
        Ok(p) => p,
        Err(e) => {
            if manager.options.log_level != LogLevel::Silent {
                Output::err(e, "failed to link binary", ());
            }
            Global::crash();
        }
    };
    let target_node_modules_path = node_modules_path();
    let mut node_modules_path = node_modules_path();

    let mut bin_linker = bin::Linker {
        bin: package.bin,
        node_modules_path: &mut node_modules_path,
        global_bin_path: manager.options.bin_path,
        target_node_modules_path: &raw const target_node_modules_path,
        target_package_name: strings::StringOrTinyString::init(name),
        package_name: strings::StringOrTinyString::init(name),
        string_buf: lockfile.buffers.string_bytes.as_slice(),
        extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
        seen: None,
        abs_target_buf: link_target_buf.as_mut_slice(),
        abs_dest_buf: link_dest_buf.as_mut_slice(),
        rel_buf: link_rel_buf.as_mut_slice(),
        is_behind_link: Some(false),
        err: None,
        skipped_due_to_missing_bin: false,
    };
    if unlink {
        bin_linker.unlink(true);
    } else {
        bin_linker.link(true);
    }
    bin_linker.err
}

fn link(ctx: command::Context) -> crate::Result<()> {
    let (manager, original_cwd) = init_for_link(&mut *ctx, Subcommand::Link)?;

    if manager.options.positionals.len() == 1 {
        // bun link
        let (lockfile, package) = load_package_for_link(manager, "linking")?;
        let name = lockfile.str(&package.name);

        exit_if_dry_run(manager, "link", name);

        let node_modules: Dir = open_global_node_modules(manager, &mut *ctx)?;

        let _ = node_modules.delete_tree(name);

        // create scope if specified
        if name[0] == b'@'
            && let Some(i) = strings::index_of_char(name, b'/')
            && let Err(e) = node_modules.make_dir(&name[..i as usize])
            && e != bun_sys::SystemErrno::EEXIST
        {
            if manager.options.log_level != LogLevel::Silent {
                bun_core::pretty_errorln!(
                    "<r><red>error:<r> failed to create scope in global dir due to error {}",
                    e,
                );
            }
            Global::crash();
        }

        #[cfg(windows)]
        {
            use bun_core::ZStr;
            use bun_paths::{platform, resolve_path};
            let top_level = bun_paths::string_paths::without_trailing_slash_windows_path(
                FileSystem::instance().top_level_dir(),
            );
            let mut link_path_buf = bun_paths::path_buffer_pool::get();
            link_path_buf.0[..top_level.len()].copy_from_slice(top_level);
            link_path_buf.0[top_level.len()] = 0;
            let link_path = ZStr::from_buf(&link_path_buf.0[..], top_level.len());
            let global_path = pm::global_link_dir_path(manager);
            let dest_path =
                resolve_path::join_abs_string_z::<platform::Windows>(global_path, &[name]);
            if let Err(e) = bun_sys::sys_uv::symlink_uv(
                link_path,
                dest_path,
                bun_sys::windows::libuv::UV_FS_SYMLINK_JUNCTION,
            ) {
                bun_core::pretty_errorln!(
                    "<r><red>error:<r> failed to create junction to node_modules in global dir due to error {}",
                    e,
                );
                Global::crash();
            }
        }
        #[cfg(not(windows))]
        {
            if let Err(e) = node_modules.sym_link(
                FileSystem::instance().top_level_dir_without_trailing_slash(),
                name,
                // is_directory
                true,
            ) {
                if manager.options.log_level != LogLevel::Silent {
                    bun_core::pretty_errorln!(
                        "<r><red>error:<r> failed to create symlink to node_modules in global dir due to error {}",
                        BStr::new(e.name()),
                    );
                }
                Global::crash();
            }
        }

        if let Some(e) = link_global_bins(manager, &node_modules, &lockfile, &package, false) {
            if manager.options.log_level != LogLevel::Silent {
                bun_core::pretty_errorln!(
                    "<r><red>error:<r> failed to link bin due to error {}",
                    e.name(),
                );
            }
            Global::crash();
        }

        Output::flush();

        if manager.options.log_level != LogLevel::Silent {
            let name = BStr::new(name);
            bun_core::prettyln!(
                "<r><green>Success!<r> Registered \"{}\"\n\
                 \n\
                 To use {} in a project, run:\n  \
                 <cyan>bun link {}<r>\n\
                 \n\
                 Or add it in dependencies in your package.json file:\n  \
                 <cyan>\"{}\": \"link:{}\"<r>\n",
                name,
                name,
                name,
                name,
                name,
            );
        }

        Output::flush();
        Global::exit(0);
    } else {
        // bun link lodash
        update_package_json_and_install_with_manager(manager, &mut *ctx, &original_cwd)?;
    }

    Ok(())
}
