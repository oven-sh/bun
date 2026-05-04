use bstr::BStr;

use bun_core::{Global, Output};
use bun_paths::{self as path, PathBuffer};
use bun_str::{strings, ZStr};
use bun_sys::File;

use bun_fs::FileSystem;

use bun_install::bin::{self, Bin};
use bun_install::lockfile::Lockfile;
use bun_install::package_manager::{
    attempt_to_create_package_json, CommandLineArguments, Options, PackageManager, Subcommand,
};
use bun_install::Features;

use crate::command;

pub struct LinkCommand;

impl LinkCommand {
    pub fn exec(ctx: command::Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        link(ctx)
    }
}

fn link(ctx: command::Context) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let cli = CommandLineArguments::parse(Subcommand::Link)?;
    let (mut manager, original_cwd) = match PackageManager::init(ctx, &cli, Subcommand::Link) {
        Ok(v) => v,
        Err(err) if err == bun_core::err!(MissingPackageJSON) => {
            attempt_to_create_package_json()?;
            PackageManager::init(ctx, &cli, Subcommand::Link)?
        }
        Err(err) => return Err(err),
    };
    // `defer ctx.allocator.free(original_cwd)` — original_cwd is now owned (Box<[u8]>); Drop frees it.

    if manager.options.should_print_command_name() {
        Output::prettyln(
            const_format::concatcp!(
                "<r><b>bun link <r><d>v",
                Global::PACKAGE_JSON_VERSION_WITH_SHA,
                "<r>\n"
            ),
            format_args!(""),
        );
        Output::flush();
    }

    if manager.options.positionals.len() == 1 {
        // bun link

        let mut lockfile: Lockfile;
        let name: &[u8];
        let mut package = Lockfile::Package::default();

        // Step 1. parse the nearest package.json file
        {
            let package_json_source = match File::to_source(
                &manager.original_package_json_path,
                Default::default(),
            ) {
                Ok(s) => s,
                Err(err) => {
                    // TODO(port): Output fmt API — multi-arg placeholders
                    Output::err_generic(
                        "{}",
                        format_args!(
                            "failed to read \"{}\" for linking: {}",
                            BStr::new(&manager.original_package_json_path),
                            err.name()
                        ),
                    );
                    Global::crash();
                }
            };
            lockfile = Lockfile::init_empty();

            let mut resolver: () = ();
            package.parse::<()>(
                &mut lockfile,
                &mut manager,
                manager.log,
                &package_json_source,
                &mut resolver,
                Features::folder(),
            )?;
            name = lockfile.str(&package.name);
            if name.is_empty() {
                if manager.options.log_level != Options::LogLevel::Silent {
                    Output::pretty_errorln(
                        "<r><red>error:<r> package.json missing \"name\" <d>in \"{}\"<r>",
                        format_args!("{}", BStr::new(package_json_source.path.text())),
                    );
                }
                Global::crash();
            } else if !strings::is_npm_package_name(name) {
                if manager.options.log_level != Options::LogLevel::Silent {
                    // TODO(port): Output fmt API — multi-arg placeholders
                    Output::pretty_errorln(
                        "{}",
                        format_args!(
                            "<r><red>error:<r> invalid package.json name \"{}\" <d>in \"{}\"<r>",
                            BStr::new(name),
                            BStr::new(package_json_source.path.text())
                        ),
                    );
                }
                Global::crash();
            }
        }

        // Step 2. Setup the global directory
        // TODO(port): std.fs.Dir — replace with bun_sys::Dir / bun_sys::Fd equivalent
        let mut node_modules = 'brk: {
            bin::Linker::ensure_umask();
            let mut explicit_global_dir: &[u8] = b"";
            if let Some(install_) = ctx.install {
                explicit_global_dir = install_.global_dir.as_deref().unwrap_or(explicit_global_dir);
            }
            manager.global_dir = Some(Options::open_global_dir(explicit_global_dir)?);

            manager.setup_global_dir(ctx)?;

            match manager
                .global_dir
                .as_mut()
                .unwrap()
                .make_open_path(b"node_modules", Default::default())
            {
                Ok(d) => break 'brk d,
                Err(err) => {
                    if manager.options.log_level != Options::LogLevel::Silent {
                        Output::pretty_errorln(
                            "<r><red>error:<r> failed to create node_modules in global dir due to error {}",
                            format_args!("{}", err.name()),
                        );
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
                    if let Err(err) = node_modules.make_dir(&name[..i as usize]) {
                        if err != bun_core::err!(PathAlreadyExists) {
                            if manager.options.log_level != Options::LogLevel::Silent {
                                Output::pretty_errorln(
                                    "<r><red>error:<r> failed to create scope in global dir due to error {}",
                                    format_args!("{}", err.name()),
                                );
                            }
                            Global::crash();
                        }
                    }
                }
            }

            #[cfg(windows)]
            {
                // create the junction
                let top_level = FileSystem::instance().top_level_dir_without_trailing_slash();
                let mut link_path_buf = PathBuffer::uninit();
                link_path_buf[..top_level.len()].copy_from_slice(top_level);
                link_path_buf[top_level.len()] = 0;
                // SAFETY: link_path_buf[top_level.len()] == 0 written above
                let link_path =
                    unsafe { ZStr::from_raw(link_path_buf.as_ptr(), top_level.len()) };
                let global_path = manager.global_link_dir_path();
                let dest_path =
                    path::join_abs_string_z(global_path, &[name], path::Platform::Windows);
                match bun_sys::sys_uv::symlink_uv(
                    link_path,
                    dest_path,
                    bun_sys::windows::libuv::UV_FS_SYMLINK_JUNCTION,
                ) {
                    Err(err) => {
                        Output::pretty_errorln(
                            "<r><red>error:<r> failed to create junction to node_modules in global dir due to error {}",
                            format_args!("{}", err),
                        );
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
                    bun_sys::SymLinkFlags { is_directory: true },
                ) {
                    if manager.options.log_level != Options::LogLevel::Silent {
                        Output::pretty_errorln(
                            "<r><red>error:<r> failed to create symlink to node_modules in global dir due to error {}",
                            format_args!("{}", err.name()),
                        );
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

            // TODO(port): bun.AbsPath(.{}) comptime opts — using default-opts AbsPath
            let mut node_modules_path =
                match bun_paths::AbsPath::init_fd_path(bun_sys::Fd::from_std_dir(&node_modules)) {
                    Ok(p) => p,
                    Err(err) => {
                        if manager.options.log_level != Options::LogLevel::Silent {
                            Output::err(err, "failed to link binary", format_args!(""));
                        }
                        Global::crash();
                    }
                };
            // `defer node_modules_path.deinit()` — handled by Drop

            let mut bin_linker = bin::Linker {
                bin: package.bin,
                node_modules_path: &mut node_modules_path,
                global_bin_path: manager.options.bin_path,
                target_node_modules_path: &mut node_modules_path,
                // PORT NOTE: reshaped for borrowck — Zig had two `&node_modules_path` borrows on
                // the same struct; Phase B may need to split or use raw ptrs here.
                // TODO(port): two &mut to same node_modules_path — verify Linker field types
                target_package_name: bun_str::StringOrTinyString::init(name),

                // .destination_dir_subpath = destination_dir_subpath,
                package_name: bun_str::StringOrTinyString::init(name),
                string_buf: lockfile.buffers.string_bytes.as_slice(),
                extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
                seen: None,
                abs_target_buf: &mut link_target_buf,
                abs_dest_buf: &mut link_dest_buf,
                rel_buf: &mut link_rel_buf,
            };
            bin_linker.link(true);

            if let Some(err) = bin_linker.err {
                if manager.options.log_level != Options::LogLevel::Silent {
                    Output::pretty_errorln(
                        "<r><red>error:<r> failed to link bin due to error {}",
                        format_args!("{}", err.name()),
                    );
                }
                Global::crash();
            }
        }

        Output::flush();

        // Done
        if manager.options.log_level != Options::LogLevel::Silent {
            Output::prettyln(
                concat!(
                    "<r><green>Success!<r> Registered \"{name}\"\n",
                    "\n",
                    "To use {name} in a project, run:\n",
                    "  <cyan>bun link {name}<r>\n",
                    "\n",
                    "Or add it in dependencies in your package.json file:\n",
                    "  <cyan>\"{name}\": \"link:{name}\"<r>\n",
                ),
                format_args!("{name}", name = BStr::new(name)),
            );
        }

        Output::flush();
        Global::exit(0);
    } else {
        // bun link lodash
        manager.update_package_json_and_install_with_manager(ctx, &original_cwd)?;
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/link_command.zig (217 lines)
//   confidence: medium
//   todos:      6
//   notes:      Output fmt-string API shape guessed (multi-arg calls flattened into format_args!); Bin.Linker has aliasing &mut to node_modules_path; std.fs.Dir needs bun_sys mapping
// ──────────────────────────────────────────────────────────────────────────
