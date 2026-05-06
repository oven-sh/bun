use bstr::BStr;

use bun_core::{Global, Output};
use bun_paths::{AbsPath, PathBuffer};
use bun_string::strings;
use bun_sys::{fs::FileSystem, Dir, Fd, FdDirExt};

use bun_install::bin_real as bin;
use bun_install::lockfile_real::{package::Package, Lockfile};
use bun_install::package_manager_real::{
    self as pm, attempt_to_create_package_json,
    command_line_arguments::CommandLineArguments,
    directories,
    package_manager_options::{self as options, LogLevel},
    update_package_json_and_install_with_manager, PackageManager, Subcommand,
};
use bun_install::Features;

use crate::command;

pub struct LinkCommand;

impl LinkCommand {
    pub fn exec(ctx: command::Context) -> Result<(), bun_core::Error> {
        link(ctx)
    }
}

fn link(ctx: command::Context) -> Result<(), bun_core::Error> {
    let cli = CommandLineArguments::parse(Subcommand::Link)?;
    let (manager_ptr, original_cwd) = match pm::init(ctx, cli, Subcommand::Link) {
        Ok(v) => v,
        Err(err) if err == bun_core::err!(MissingPackageJSON) => {
            attempt_to_create_package_json()?;
            let cli = CommandLineArguments::parse(Subcommand::Link)?;
            pm::init(ctx, cli, Subcommand::Link)?
        }
        Err(err) => return Err(err),
    };
    // `defer ctx.allocator.free(original_cwd)` — `original_cwd: Box<[u8]>` drops at scope exit.

    // SAFETY: `pm::init` heap-allocates the manager and returns the sole
    // pointer; we hold the unique reference for the rest of this CLI command.
    let manager: &mut PackageManager = unsafe { &mut *manager_ptr };

    if manager.options.should_print_command_name() {
        Output::prettyln(format_args!(
            "<r><b>bun link <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        ));
        Output::flush();
    }

    if manager.options.positionals.len() == 1 {
        // bun link

        let mut lockfile: Lockfile;
        let name: &[u8];
        let mut package = Package::default();

        // Step 1. parse the nearest package.json file
        let package_json_source = match bun_logger::to_source(
            manager.original_package_json_path.as_zstr(),
            Default::default(),
        ) {
            Ok(s) => s,
            Err(err) => {
                Output::err_generic(
                    "failed to read \"{s}\" for linking: {s}",
                    (
                        BStr::new(manager.original_package_json_path.as_bytes()),
                        err.name(),
                    ),
                );
                Global::crash();
            }
        };
        lockfile = Lockfile::default();
        lockfile.init_empty();

        let mut resolver: () = ();
        // SAFETY: `manager.log` is set by `pm::init` and outlives this call.
        let log = unsafe { &mut *manager.log };
        package.parse::<()>(
            &mut lockfile,
            manager,
            log,
            &package_json_source,
            &mut resolver,
            Features::folder(),
        )?;
        name = lockfile.str(&package.name);
        if name.is_empty() {
            if manager.options.log_level != LogLevel::Silent {
                Output::pretty_errorln(format_args!(
                    "<r><red>error:<r> package.json missing \"name\" <d>in \"{}\"<r>",
                    BStr::new(package_json_source.path.text),
                ));
            }
            Global::crash();
        } else if !strings::is_npm_package_name(name) {
            if manager.options.log_level != LogLevel::Silent {
                Output::pretty_errorln(format_args!(
                    "<r><red>error:<r> invalid package.json name \"{}\" <d>in \"{}\"<r>",
                    BStr::new(name),
                    BStr::new(package_json_source.path.text),
                ));
            }
            Global::crash();
        }

        // Step 2. Setup the global directory
        let node_modules: Dir = 'brk: {
            bin::Linker::ensure_umask();
            let mut explicit_global_dir: &[u8] = b"";
            if let Some(install_) = ctx.install.as_ref() {
                explicit_global_dir = install_.global_dir.as_deref().unwrap_or(explicit_global_dir);
            }
            manager.global_dir = Some(Dir::from_fd(options::open_global_dir(explicit_global_dir)?));

            directories::setup_global_dir(manager, ctx)?;

            break 'brk match manager
                .global_dir
                .unwrap()
                .make_open_path(b"node_modules", Default::default())
            {
                Ok(d) => d,
                Err(err) => {
                    if manager.options.log_level != LogLevel::Silent {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> failed to create node_modules in global dir due to error {}",
                            err.name(),
                        ));
                    }
                    Global::crash();
                }
            };
        };

        // Step 3a. symlink to the node_modules folder
        {
            // delete it if it exists
            let _ = node_modules.delete_tree(name);

            // create scope if specified
            if name[0] == b'@' {
                if let Some(i) = strings::index_of_char(name, b'/') {
                    if let Err(err) = node_modules.make_dir(&name[..i as usize]) {
                        if err != bun_core::err!(PathAlreadyExists) {
                            if manager.options.log_level != LogLevel::Silent {
                                Output::pretty_errorln(format_args!(
                                    "<r><red>error:<r> failed to create scope in global dir due to error {}",
                                    err.name(),
                                ));
                            }
                            Global::crash();
                        }
                    }
                }
            }

            #[cfg(windows)]
            {
                use bun_paths::resolve_path;
                use bun_string::ZStr;
                // create the junction
                let top_level = FileSystem::instance().top_level_dir_without_trailing_slash();
                let mut link_path_buf = PathBuffer::uninit();
                link_path_buf.0[..top_level.len()].copy_from_slice(top_level);
                link_path_buf.0[top_level.len()] = 0;
                // SAFETY: NUL written at link_path_buf[top_level.len()] above.
                let link_path =
                    unsafe { ZStr::from_raw(link_path_buf.0.as_ptr(), top_level.len()) };
                let global_path = directories::global_link_dir_path(manager);
                let dest_path = resolve_path::join_abs_string_z::<bun_paths::platform::Windows>(
                    global_path,
                    &[name],
                );
                match bun_sys::sys_uv::symlink_uv(
                    link_path,
                    dest_path,
                    bun_sys::windows::libuv::UV_FS_SYMLINK_JUNCTION,
                ) {
                    Err(err) => {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> failed to create junction to node_modules in global dir due to error {}",
                            err,
                        ));
                        Global::crash();
                    }
                    Ok(()) => {}
                }
            }
            #[cfg(not(windows))]
            {
                // create the symlink
                if let Err(err) = node_modules.sym_link(
                    FileSystem::instance().top_level_dir_without_trailing_slash(),
                    name,
                    // Zig: `.{ .is_directory = true }` — std.fs.Dir.SymLinkFlags.
                    true,
                ) {
                    if manager.options.log_level != LogLevel::Silent {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> failed to create symlink to node_modules in global dir due to error {}",
                            err.name(),
                        ));
                    }
                    Global::crash();
                }
            }
        }

        // Step 3b. Link any global bins
        if package.bin.tag != bin::Tag::None {
            let mut link_target_buf = PathBuffer::uninit();
            let mut link_dest_buf = PathBuffer::uninit();
            let mut link_rel_buf = PathBuffer::uninit();

            let mut node_modules_path =
                match AbsPath::<u8>::init_fd_path(Fd::from_std_dir(&node_modules)) {
                    Ok(p) => p,
                    Err(err) => {
                        if manager.options.log_level != LogLevel::Silent {
                            Output::err(err, "failed to link binary", ());
                        }
                        Global::crash();
                    }
                };
            // `defer node_modules_path.deinit()` — handled by Drop.

            // PORT NOTE: Zig aliased `&node_modules_path` for both fields.
            // `Linker` holds `&mut` + `&` to the same `AbsPath`, which the
            // borrow checker rejects; clone the path so the `target_*` borrow
            // is independent (it is only ever read via `.slice()`).
            let target_node_modules_path = node_modules_path.clone();

            let mut bin_linker = bin::Linker {
                bin: package.bin,
                node_modules_path: &mut node_modules_path,
                global_bin_path: manager.options.bin_path,
                target_node_modules_path: &target_node_modules_path,
                target_package_name: strings::StringOrTinyString::init(name),

                // .destination_dir_subpath = destination_dir_subpath,
                package_name: strings::StringOrTinyString::init(name),
                string_buf: lockfile.buffers.string_bytes.as_slice(),
                extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
                seen: None,
                abs_target_buf: &mut link_target_buf.0,
                abs_dest_buf: &mut link_dest_buf.0,
                rel_buf: &mut link_rel_buf.0,
                err: None,
                skipped_due_to_missing_bin: false,
            };
            bin_linker.link(true);

            if let Some(err) = bin_linker.err {
                if manager.options.log_level != LogLevel::Silent {
                    Output::pretty_errorln(format_args!(
                        "<r><red>error:<r> failed to link bin due to error {}",
                        err.name(),
                    ));
                }
                Global::crash();
            }
        }

        Output::flush();

        // Done
        if manager.options.log_level != LogLevel::Silent {
            let name = BStr::new(name);
            Output::prettyln(format_args!(
                "<r><green>Success!<r> Registered \"{name}\"\n\
                 \n\
                 To use {name} in a project, run:\n  \
                 <cyan>bun link {name}<r>\n\
                 \n\
                 Or add it in dependencies in your package.json file:\n  \
                 <cyan>\"{name}\": \"link:{name}\"<r>\n",
            ));
        }

        Output::flush();
        Global::exit(0);
    } else {
        // bun link lodash
        update_package_json_and_install_with_manager(manager, ctx, &original_cwd)?;
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/link_command.zig (217 lines)
//   confidence: medium
// ──────────────────────────────────────────────────────────────────────────
