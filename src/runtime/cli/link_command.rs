use bstr::BStr;

use bun_core::strings;
use bun_core::{Global, Output, err};
use bun_paths::{AbsPath, PathBuffer};
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

pub struct LinkCommand;

impl LinkCommand {
    pub fn exec(ctx: command::Context) -> Result<(), bun_core::Error> {
        link(ctx)
    }
}

fn link(ctx: command::Context) -> Result<(), bun_core::Error> {
    let cli = CommandLineArguments::parse(Subcommand::Link)?;
    let (manager, original_cwd) = match pm::init(&mut *ctx, cli, Subcommand::Link) {
        Ok(v) => v,
        Err(e) if e == err!(MissingPackageJSON) => {
            attempt_to_create_package_json()?;
            // Re-parse argv: `CommandLineArguments` is not `Clone`, and `parse`
            // is deterministic over process argv. Mirrors Zig passing the
            // by-value `cli` struct to both `init` calls.
            let cli = CommandLineArguments::parse(Subcommand::Link)?;
            pm::init(&mut *ctx, cli, Subcommand::Link)?
        }
        Err(e) => return Err(e),
    };
    // `defer ctx.allocator.free(original_cwd)` — `original_cwd: Box<[u8]>` drops at scope exit.

    if manager.options.should_print_command_name() {
        Output::prettyln(format_args!(
            "<r><b>bun link <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        ));
        Output::flush();
    }

    if manager.options.positionals.len() == 1 {
        // bun link

        let mut lockfile = Lockfile::default();
        let mut package = Package::default();

        // Step 1. parse the nearest package.json file
        {
            let package_json_source = match bun_ast::to_source(
                manager.original_package_json_path.as_zstr(),
                Default::default(),
            ) {
                Ok(s) => s,
                Err(e) => {
                    Output::err_generic(
                        "failed to read \"{s}\" for linking: {s}",
                        (
                            BStr::new(manager.original_package_json_path.as_bytes()),
                            BStr::new(e.name()),
                        ),
                    );
                    Global::crash();
                }
            };
            lockfile.init_empty();

            let mut resolver: () = ();
            // `log_mut()` returns a borrow decoupled from `&self`; disjoint
            // storage from `&mut PackageManager` (owned by the CLI `Context`).
            let log = manager.log_mut();
            package.parse::<()>(
                &mut lockfile,
                manager,
                log,
                &package_json_source,
                &mut resolver,
                Features::FOLDER,
            )?;
            let name = lockfile.str(&package.name);
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
        }

        // PORT NOTE: reshaped for borrowck — re-derive `name` here so its
        // lifetime is tied only to `lockfile.buffers.string_bytes`, decoupled
        // from `package_json_source` (dropped above).
        let name = lockfile.str(&package.name);

        // Step 2. Setup the global directory
        let node_modules: Dir = 'brk: {
            bin::Linker::ensure_umask();
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
                .unwrap()
                .make_open_path(b"node_modules", Default::default())
            {
                Ok(d) => break 'brk d,
                Err(e) => {
                    if manager.options.log_level != LogLevel::Silent {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> failed to create node_modules in global dir due to error {}",
                            e.name(),
                        ));
                    }
                    Global::crash();
                }
            }
        };

        // Step 3a. symlink to the node_modules folder
        {
            // delete it if it exists
            let _ = node_modules.delete_tree(name);

            // create scope if specified
            if name[0] == b'@' {
                if let Some(i) = strings::index_of_char(name, b'/') {
                    if let Err(e) = node_modules.make_dir(&name[..i as usize]) {
                        if e != err!(PathAlreadyExists) {
                            if manager.options.log_level != LogLevel::Silent {
                                Output::pretty_errorln(format_args!(
                                    "<r><red>error:<r> failed to create scope in global dir due to error {}",
                                    e.name(),
                                ));
                            }
                            Global::crash();
                        }
                    }
                }
            }

            #[cfg(windows)]
            {
                use bun_core::ZStr;
                use bun_paths::{platform, resolve_path};
                // create the junction
                let top_level = FileSystem::instance().top_level_dir_without_trailing_slash();
                let mut link_path_buf = PathBuffer::uninit();
                link_path_buf.0[..top_level.len()].copy_from_slice(top_level);
                link_path_buf.0[top_level.len()] = 0;
                // SAFETY: NUL written at link_path_buf[top_level.len()] above.
                let link_path = ZStr::from_buf(&link_path_buf.0[..], top_level.len());
                let global_path = pm::global_link_dir_path(manager);
                let dest_path =
                    resolve_path::join_abs_string_z::<platform::Windows>(global_path, &[name]);
                match bun_sys::sys_uv::symlink_uv(
                    link_path,
                    dest_path,
                    bun_sys::windows::libuv::UV_FS_SYMLINK_JUNCTION,
                ) {
                    Err(e) => {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> failed to create junction to node_modules in global dir due to error {}",
                            e,
                        ));
                        Global::crash();
                    }
                    Ok(()) => {}
                }
            }
            #[cfg(not(windows))]
            {
                // create the symlink
                if let Err(e) = node_modules.sym_link(
                    FileSystem::instance().top_level_dir_without_trailing_slash(),
                    name,
                    // Zig: `.{ .is_directory = true }` — std.fs.Dir.SymLinkFlags.
                    true,
                ) {
                    if manager.options.log_level != LogLevel::Silent {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> failed to create symlink to node_modules in global dir due to error {}",
                            e.name(),
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

            // PORT NOTE: Zig passed `&node_modules_path` for both
            // `target_node_modules_path` (`*const`) and `node_modules_path`
            // (`*mut`). Rust forbids `&` + `&mut` to the same value, so resolve
            // the fd path twice (cheap: one `getFdPath` syscall) into two
            // independent `AbsPath` buffers.
            let mut node_modules_path =
                match <AbsPath>::init_fd_path(Fd::from_std_dir(&node_modules)) {
                    Ok(p) => p,
                    Err(e) => {
                        if manager.options.log_level != LogLevel::Silent {
                            Output::err(e, "failed to link binary", ());
                        }
                        Global::crash();
                    }
                };
            let target_node_modules_path =
                match <AbsPath>::init_fd_path(Fd::from_std_dir(&node_modules)) {
                    Ok(p) => p,
                    Err(e) => {
                        if manager.options.log_level != LogLevel::Silent {
                            Output::err(e, "failed to link binary", ());
                        }
                        Global::crash();
                    }
                };
            // `defer node_modules_path.deinit()` — handled by Drop.

            let mut bin_linker = bin::Linker {
                bin: package.bin,
                node_modules_path: &mut node_modules_path,
                global_bin_path: manager.options.bin_path,
                target_node_modules_path: &raw const target_node_modules_path,
                target_package_name: strings::StringOrTinyString::init(name),

                // .destination_dir_subpath = destination_dir_subpath,
                package_name: strings::StringOrTinyString::init(name),
                string_buf: lockfile.buffers.string_bytes.as_slice(),
                extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
                seen: None,
                abs_target_buf: link_target_buf.as_mut_slice(),
                abs_dest_buf: link_dest_buf.as_mut_slice(),
                rel_buf: link_rel_buf.as_mut_slice(),
                err: None,
                skipped_due_to_missing_bin: false,
            };
            bin_linker.link(true);

            if let Some(e) = bin_linker.err {
                if manager.options.log_level != LogLevel::Silent {
                    Output::pretty_errorln(format_args!(
                        "<r><red>error:<r> failed to link bin due to error {}",
                        e.name(),
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
        update_package_json_and_install_with_manager(manager, &mut *ctx, &original_cwd)?;
    }

    Ok(())
}

// ported from: src/cli/link_command.zig
