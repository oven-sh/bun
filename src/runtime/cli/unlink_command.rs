use bstr::BStr;

use bun_core::Global;
use bun_paths::{platform, resolve_path};
use bun_sys::{self as sys, Dir};

use bun_install::package_manager_real::{Subcommand, global_link_dir_path, options::LogLevel};

use super::link_command;
use crate::command::ContextData;

pub(crate) struct UnlinkCommand;

impl UnlinkCommand {
    pub(crate) fn exec(ctx: &mut ContextData) -> crate::Result<()> {
        let (manager, _original_cwd) = link_command::init_for_link(&mut *ctx, Subcommand::Unlink)?;

        if manager.options.positionals.len() != 1 {
            bun_core::prettyln!("<r><red>error:<r> bun unlink {{packageName}} not implemented yet");
            Global::crash();
        }

        let (lockfile, package) = link_command::load_package_for_link(manager, "unlinking")?;
        let name = lockfile.str(&package.name);

        let link_path = resolve_path::join_abs_string_z::<platform::Auto>(
            global_link_dir_path(manager),
            &[name],
        );
        if !sys::lstat(link_path).is_ok_and(|stat| sys::S::ISLNK(stat.st_mode as _)) {
            bun_core::pretty_errorln!(
                "<r><green>success:<r> package \"{}\" is not globally linked, so there's nothing to do.",
                BStr::new(name),
            );
            Global::exit(0);
        }

        link_command::exit_if_dry_run(manager, "unlink", name);

        let node_modules: Dir = link_command::open_global_node_modules(manager, &mut *ctx)?;

        link_command::link_global_bins(manager, &node_modules, &lockfile, &package, true);

        if let Err(e) = node_modules.delete_tree(name) {
            if manager.options.log_level != LogLevel::Silent {
                bun_core::pretty_errorln!(
                    "<r><red>error:<r> failed to unlink package in global dir due to error {}",
                    BStr::new(e.name()),
                );
            }
            Global::crash();
        }

        bun_core::prettyln!(
            "<r><green>success:<r> unlinked package \"{}\"",
            BStr::new(name),
        );
        Global::exit(0);
    }
}
