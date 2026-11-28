use bstr::BStr;
use bun_ast::Expr;
use bun_core::{Global, Output};
use bun_install::PackageManager;
use bun_install::lockfile::printer::Sbom;
use bun_install::package_manager::LogLevel;
use bun_jsc::uuid::UUID;
use bun_paths::resolve_path::{self, platform};
use bun_resolver::fs::FileSystem;

use crate::cli::pack_command::package_json_entry;
use crate::cli::package_manager_command::PackageManagerCommand;
use crate::cli::test_command::write_iso_8601;

pub(crate) struct PmSbomCommand;

impl PmSbomCommand {
    pub(crate) fn exec(
        pm: &mut PackageManager,
        positionals: &[&[u8]],
        format: Sbom::Format,
    ) -> crate::Result<()> {
        let log_level = pm.options.log_level;

        // positionals[0] is "sbom" itself
        if positionals.len() > 1 {
            if log_level != LogLevel::Silent {
                Output::err_generic("bun pm sbom does not take arguments", ());
            }
            Global::exit(1);
        }

        let load_lockfile = pm.load_lockfile_from_cwd::<true>();
        PackageManagerCommand::handle_load_lockfile_errors_for(&load_lockfile, log_level, "list");

        let root = pm.root_package_id.get(&pm.lockfile, pm.workspace_name_hash);
        // The lookup answers with the root package for a workspace that the lockfile does not have.
        if root == 0 && pm.workspace_name_hash.is_some() {
            if log_level != LogLevel::Silent {
                Output::err_generic("this workspace is not in the lockfile, nothing to list", ());
                bun_core::note!("run 'bun install' first");
            }
            Global::exit(1);
        }
        let plan = Sbom::Plan::new(&pm.lockfile, root, pm.options.local_package_features);
        let manifests: Vec<Option<Sbom::Manifest>> = (plan.project_paths())
            .map(|path| manifest(pm, path))
            .collect();

        let mut serial_number = [0u8; 36];
        UUID::init().print(&mut serial_number);
        let mut timestamp: Vec<u8> = Vec::new();
        write_iso_8601(&mut timestamp, bun_core::time::milli_timestamp());

        let mut out: Vec<u8> = Vec::new();
        Sbom::print(
            &pm.lockfile,
            format,
            &plan,
            &Sbom::Input {
                serial_number: &serial_number,
                timestamp: &timestamp,
                manifests: &manifests,
            },
            &mut out,
        )?;
        let _ = Output::writer().write_all(&out);
        Global::exit(0);
    }
}

/// The `name` and `version` in the package.json at `path`, or `None` for a workspace that is not in this checkout.
fn manifest(pm: &mut PackageManager, path: &[u8]) -> Option<Sbom::Manifest> {
    let top_level_dir = FileSystem::get().top_level_dir();
    let root = if path.is_empty() {
        let abs_package_json_path = pm.root_package_json_path;
        package_json_entry(pm, abs_package_json_path).root
    } else {
        let mut buf = bun_paths::path_buffer_pool::get();
        let Some(abs_package_json_path) = resolve_path::join_abs_string_buf_z_checked::<
            platform::Auto,
        >(
            top_level_dir, &mut buf[..], &[path, b"package.json"]
        ) else {
            Output::err_generic("the path of workspace {} is too long", (BStr::new(path),));
            Global::exit(1);
        };
        if let Err(err) = bun_sys::stat(abs_package_json_path)
            && err.get_errno() == bun_sys::E::ENOENT
        {
            return None;
        }
        package_json_entry(pm, abs_package_json_path).root
    };
    let string_field = |key: &[u8]| -> Vec<u8> {
        let value = root.get(key);
        let value = value.as_ref().and_then(Expr::as_utf8_string_literal);
        value.unwrap_or(b"").to_vec()
    };

    let mut name = string_field(b"name");
    if name.is_empty() && path.is_empty() {
        // `bun add` creates a package.json without a name, and a project at `/` is in a directory without one.
        let directory = bun_paths::basename(top_level_dir);
        name = if directory.is_empty() {
            b"root".to_vec()
        } else {
            directory.to_vec()
        };
    }
    Some(Sbom::Manifest {
        name,
        version: string_field(b"version"),
    })
}
