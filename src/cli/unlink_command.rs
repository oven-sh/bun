use bstr::BStr;

use crate::Command;
use bun_core::{Global, Output};
use bun_install::Bin;
use bun_install::Features;
use bun_install::Lockfile;
use bun_install::PackageManager;
use bun_install::package_manager::Options;
use bun_paths as path;
use bun_paths::{AbsPath, PathBuffer};
use bun_str::strings;
use bun_sys as syscall;
use bun_sys::File;

pub struct UnlinkCommand;

impl UnlinkCommand {
    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        unlink(ctx)
    }
}

fn unlink(ctx: Command::Context) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let cli = PackageManager::CommandLineArguments::parse(PackageManager::Subcommand::Unlink)?;
    let (mut manager, _original_cwd) = 'brk: {
        match PackageManager::init(&ctx, &cli, PackageManager::Subcommand::Unlink) {
            Ok(v) => break 'brk v,
            Err(err) => {
                if err == bun_core::err!("MissingPackageJSON") {
                    PackageManager::attempt_to_create_package_json()?;
                    break 'brk PackageManager::init(&ctx, &cli, PackageManager::Subcommand::Unlink)?;
                }
                return Err(err);
            }
        }
    };
    // `defer ctx.allocator.free(original_cwd)` — dropped; _original_cwd is Box<[u8]> and frees on scope exit.

    if manager.options.should_print_command_name() {
        Output::prettyln(format_args!(
            const_format::concatcp!(
                "<r><b>bun unlink <r><d>v",
                Global::PACKAGE_JSON_VERSION_WITH_SHA,
                "<r>\n"
            )
        ));
        Output::flush();
    }

    if manager.options.positionals.len() == 1 {
        // bun unlink

        let mut lockfile: Lockfile;
        let name: &[u8];
        let mut package = Lockfile::Package::default();

        // Step 1. parse the nearest package.json file
        {
            let package_json_source = &(match File::to_source(
                &manager.original_package_json_path,
                Default::default(),
            ) {
                Ok(s) => s,
                Err(err) => {
                    Output::err_generic(format_args!(
                        "failed to read \"{}\" for unlinking: {}",
                        BStr::new(&manager.original_package_json_path),
                        err.name(),
                    ));
                    Global::crash();
                }
            });
            lockfile = Lockfile::init_empty();

            let mut resolver: () = ();
            package.parse::<()>(
                &mut lockfile,
                &mut manager,
                manager.log,
                package_json_source,
                &mut resolver,
                Features::FOLDER,
            )?;
            // PORT NOTE: reshaped for borrowck — `name` borrows `lockfile`; Phase B may need to
            // restructure if `lockfile` is mutated after this point (it is not in this fn).
            name = lockfile.str(&package.name);
            if name.is_empty() {
                if manager.options.log_level != Options::LogLevel::Silent {
                    Output::pretty_errorln(format_args!(
                        "<r><red>error:<r> package.json missing \"name\" <d>in \"{}\"<r>",
                        BStr::new(&package_json_source.path.text),
                    ));
                }
                Global::crash();
            } else if !strings::is_npm_package_name(name) {
                if manager.options.log_level != Options::LogLevel::Silent {
                    Output::pretty_errorln(format_args!(
                        "<r><red>error:<r> invalid package.json name \"{}\" <d>in \"{}\"<r>",
                        BStr::new(name),
                        BStr::new(&package_json_source.path.text),
                    ));
                }
                Global::crash();
            }
        }

        match syscall::lstat(path::join_abs_string_z(
            manager.global_link_dir_path(),
            &[name],
            path::Platform::Auto,
        )) {
            Ok(stat) => {
                if !bun_sys::S::ISLNK(u32::try_from(stat.mode).unwrap()) {
                    Output::pretty_errorln(format_args!(
                        "<r><green>success:<r> package \"{}\" is not globally linked, so there's nothing to do.",
                        BStr::new(name),
                    ));
                    Global::exit(0);
                }
            }
            Err(_) => {
                Output::pretty_errorln(format_args!(
                    "<r><green>success:<r> package \"{}\" is not globally linked, so there's nothing to do.",
                    BStr::new(name),
                ));
                Global::exit(0);
            }
        }

        // Step 2. Setup the global directory
        // TODO(port): `std.fs.Dir` has no direct Rust mapping; using bun_sys::Dir placeholder.
        let node_modules: bun_sys::Dir = 'brk: {
            Bin::Linker::ensure_umask();
            let mut explicit_global_dir: &[u8] = b"";
            if let Some(install_) = &ctx.install {
                explicit_global_dir = install_.global_dir.as_deref().unwrap_or(explicit_global_dir);
            }
            manager.global_dir = Some(Options::open_global_dir(explicit_global_dir)?);

            manager.setup_global_dir(&ctx)?;

            break 'brk match manager
                .global_dir
                .as_ref()
                .unwrap()
                .make_open_path(b"node_modules", Default::default())
            {
                Ok(d) => d,
                Err(err) => {
                    if manager.options.log_level != Options::LogLevel::Silent {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error:<r> failed to create node_modules in global dir due to error {}",
                            err.name(),
                        ));
                    }
                    Global::crash();
                }
            };
        };

        // Step 3b. Link any global bins
        if package.bin.tag != Bin::Tag::None {
            let mut link_target_buf = PathBuffer::uninit();
            let mut link_dest_buf = PathBuffer::uninit();
            let mut link_rel_buf = PathBuffer::uninit();

            // `bun.AbsPath(.{})` is a type-generator (default const-generic opts); `.initFdPath` is the associated ctor.
            let node_modules_path =
                match AbsPath::init_fd_path(bun_sys::Fd::from_std_dir(&node_modules)) {
                    Ok(p) => p,
                    Err(err) => {
                        if manager.options.log_level != Options::LogLevel::Silent {
                            Output::err(err, format_args!("failed to link binary"));
                        }
                        Global::crash();
                    }
                };
            // `defer node_modules_path.deinit()` — Drop handles cleanup.

            let mut bin_linker = Bin::Linker {
                target_node_modules_path: &node_modules_path,
                target_package_name: strings::StringOrTinyString::init(name),
                bin: package.bin,
                node_modules_path: &node_modules_path,
                global_bin_path: manager.options.bin_path,
                package_name: strings::StringOrTinyString::init(name),
                string_buf: lockfile.buffers.string_bytes.as_slice(),
                extern_string_buf: lockfile.buffers.extern_strings.as_slice(),
                seen: None,
                abs_target_buf: &mut link_target_buf,
                abs_dest_buf: &mut link_dest_buf,
                rel_buf: &mut link_rel_buf,
            };
            bin_linker.unlink(true);
        }

        // delete it if it exists
        if let Err(err) = node_modules.delete_tree(name) {
            if manager.options.log_level != Options::LogLevel::Silent {
                Output::pretty_errorln(format_args!(
                    "<r><red>error:<r> failed to unlink package in global dir due to error {}",
                    err.name(),
                ));
            }
            Global::crash();
        }

        Output::prettyln(format_args!(
            "<r><green>success:<r> unlinked package \"{}\"",
            BStr::new(name),
        ));
        Global::exit(0);
    } else {
        Output::prettyln(format_args!(
            "<r><red>error:<r> bun unlink {{packageName}} not implemented yet"
        ));
        Global::crash();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/unlink_command.zig (158 lines)
//   confidence: medium
//   todos:      2
//   notes:      std.fs.Dir → bun_sys::Dir placeholder; Bin::Linker struct-literal field types (raw ptrs vs refs) need Phase-B reconciliation with bun_install
// ──────────────────────────────────────────────────────────────────────────
