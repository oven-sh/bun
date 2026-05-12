use bstr::BStr;

use bun_core::strings;
use bun_core::{Global, Output, err};
use bun_paths::{AbsPath, PathBuffer, platform, resolve_path};
use bun_sys::{self as sys, Dir, Fd, FdDirExt};

use bun_install::Features;
use bun_install::bin as stub_bin;
use bun_install::bin_real as bin;
use bun_install::lockfile_real::{Lockfile, package::Package};
use bun_install::package_manager_real::{
    self as pm, CommandLineArguments, PackageManager, Subcommand, attempt_to_create_package_json,
    global_link_dir_path, options::LogLevel, package_manager_options, setup_global_dir,
};

use crate::command::ContextData;

pub struct UnlinkCommand;

impl UnlinkCommand {
    pub fn exec(ctx: &mut ContextData) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        unlink(ctx)
    }
}

fn unlink(ctx: &mut ContextData) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let cli = CommandLineArguments::parse(Subcommand::Unlink)?;
    let (manager, _original_cwd) = match pm::init(&mut *ctx, cli, Subcommand::Unlink) {
        Ok(v) => v,
        Err(e) if e == err!(MissingPackageJSON) => {
            attempt_to_create_package_json()?;
            // Re-parse argv: `CommandLineArguments` is not `Clone`, and `parse`
            // is deterministic over process argv. Mirrors Zig passing the
            // by-value `cli` struct to both `init` calls.
            let cli = CommandLineArguments::parse(Subcommand::Unlink)?;
            pm::init(&mut *ctx, cli, Subcommand::Unlink)?
        }
        Err(e) => return Err(e),
    };
    // `defer ctx.allocator.free(original_cwd)` — `_original_cwd: Box<[u8]>` drops at scope exit.

    if manager.options.should_print_command_name() {
        Output::prettyln(format_args!(
            "<r><b>bun unlink <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        ));
        Output::flush();
    }

    if manager.options.positionals.len() == 1 {
        // bun unlink

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
                        "failed to read \"{}\" for unlinking: {}",
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

        // PORT NOTE: reshaped for borrowck — `name` borrows `lockfile`; re-derive
        // it after the parse block so its lifetime is decoupled from
        // `package_json_source` (dropped above) while remaining a slice into
        // `lockfile.buffers.string_bytes`.
        let name = lockfile.str(&package.name);

        match sys::lstat(resolve_path::join_abs_string_z::<platform::Auto>(
            global_link_dir_path(manager),
            &[name],
        )) {
            Ok(stat) => {
                if !sys::S::ISLNK(stat.st_mode as _) {
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

        // Step 3b. Link any global bins
        if package.bin.tag != stub_bin::Tag::None {
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
                target_node_modules_path: &raw const target_node_modules_path,
                target_package_name: strings::StringOrTinyString::init(name),
                // `package.bin` is the inline stub `bin::Bin` (struct `Value`);
                // project to the real union-`Value` shape via the
                // `From<bin::Bin> for bin_real::Bin` bridge in `bun_install::lib`.
                bin: bin::Bin::from(package.bin),
                node_modules_path: &mut node_modules_path,
                global_bin_path: manager.options.bin_path,
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
            bin_linker.unlink(true);
        }

        // delete it if it exists
        if let Err(e) = node_modules.delete_tree(name) {
            if manager.options.log_level != LogLevel::Silent {
                Output::pretty_errorln(format_args!(
                    "<r><red>error:<r> failed to unlink package in global dir due to error {}",
                    e.name(),
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
            "<r><red>error:<r> bun unlink {{packageName}} not implemented yet",
        ));
        Global::crash();
    }
}

// ported from: src/cli/unlink_command.zig
