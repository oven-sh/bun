use std::io::Write as _;

use bstr::{BStr, ByteSlice};

use crate::api::bun::process::Status as ProcStatus;
use crate::api::bun::process::sync::{
    Options as SpawnSyncOptions, SyncStdio as Stdio, spawn as spawn_sync,
};
use crate::cli::command;
use crate::cli::run_command::RunCommand;
use bun_alloc::{AllocError, Arena};
use bun_ast::ExprData;
use bun_core::strings;
use bun_core::{Global, Output, env_var};
use bun_install::LogLevel;
use bun_install::PackageManager;
use bun_js_printer as JSPrinter;
use bun_parsers::json as JSON;
use bun_paths::{PathBuffer, resolve_path as path, resolve_path::platform as path_platform};
use bun_semver as Semver;
use bun_sys::{self, Fd};
use bun_which::which;

pub struct PmVersionCommand;

#[derive(Clone, Copy, PartialEq, Eq)]
enum VersionType {
    Patch,
    Minor,
    Major,
    Prepatch,
    Preminor,
    Premajor,
    Prerelease,
    Specific,
    FromGit,
}

impl VersionType {
    pub fn from_string(str: &[u8]) -> Option<VersionType> {
        if str == b"patch" {
            return Some(VersionType::Patch);
        }
        if str == b"minor" {
            return Some(VersionType::Minor);
        }
        if str == b"major" {
            return Some(VersionType::Major);
        }
        if str == b"prepatch" {
            return Some(VersionType::Prepatch);
        }
        if str == b"preminor" {
            return Some(VersionType::Preminor);
        }
        if str == b"premajor" {
            return Some(VersionType::Premajor);
        }
        if str == b"prerelease" {
            return Some(VersionType::Prerelease);
        }
        if str == b"from-git" {
            return Some(VersionType::FromGit);
        }
        None
    }
}

impl PmVersionCommand {
    pub fn exec(
        ctx: command::Context<'_>,
        pm: &mut PackageManager,
        positionals: &[&[u8]],
        original_cwd: &[u8],
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let package_json_dir = Self::find_package_dir(original_cwd)?;

        if positionals.len() <= 1 {
            Self::show_help(ctx, pm, &package_json_dir)?;
            return Ok(());
        }

        let (version_type, new_version) = Self::parse_version_argument(positionals[1]);

        Self::verify_git(&package_json_dir, pm)?;

        let mut path_buf = PathBuffer::uninit();
        let package_json_path = path::join_abs_string_buf_z::<path_platform::Auto>(
            &package_json_dir,
            &mut path_buf.0,
            &[b"package.json"],
        );

        let package_json_contents = match bun_sys::File::read_from(Fd::cwd(), package_json_path) {
            Ok(c) => c,
            Err(err) => {
                Output::err_generic("Failed to read package.json: {}", (BStr::new(err.name()),));
                Global::exit(1);
            }
        };
        // `defer ctx.allocator.free(package_json_contents)` — handled by Drop.

        let package_json_source = bun_ast::Source::init_path_string(
            package_json_path.as_bytes(),
            &*package_json_contents,
        );
        // PORT NOTE: Zig passed `ctx.allocator`; Rust ctx dropped allocator (global mimalloc),
        // so we hand the parser a local bump arena for its scratch allocations.
        let json_bump = Arena::new();
        let json_result = match JSON::parse_package_json_utf8_with_opts::<
            true,  // IS_JSON
            true,  // ALLOW_COMMENTS
            true,  // ALLOW_TRAILING_COMMAS
            false, // IGNORE_LEADING_ESCAPE_SEQUENCES
            false, // IGNORE_TRAILING_ESCAPE_SEQUENCES
            false, // JSON_WARN_DUPLICATE_KEYS
            false, // WAS_ORIGINALLY_MACRO
            true,  // GUESS_INDENTATION
        >(&package_json_source, unsafe { ctx.log_mut() }, &json_bump)
        {
            Ok(r) => r,
            Err(err) => {
                Output::err_generic("Failed to parse package.json: {}", (err.name(),));
                Global::exit(1);
            }
        };

        let mut json = json_result.root;

        if !matches!(json.data, ExprData::EObject(_)) {
            Output::err_generic("Failed to parse package.json: root must be an object", ());
            Global::exit(1);
        }

        let scripts = if pm.options.do_.run_scripts() {
            json.as_property(b"scripts")
        } else {
            None
        };
        let scripts_obj = if let Some(s) = &scripts {
            if matches!(s.expr.data, ExprData::EObject(_)) {
                Some(s.expr)
            } else {
                None
            }
        } else {
            None
        };

        let silent = pm.options.log_level == LogLevel::Silent;
        let use_system_shell = ctx.debug.use_system_shell;

        if let Some(s) = &scripts_obj {
            if let Some(script) = s.get(b"preversion") {
                if let Some(script_command) = script.as_string(&json_bump) {
                    RunCommand::run_package_script_foreground(
                        ctx,
                        script_command,
                        b"preversion",
                        &package_json_dir,
                        pm.env_mut(),
                        &[],
                        silent,
                        use_system_shell,
                    )?;
                }
            }
        }

        let current_version: Option<&[u8]> = 'brk_version: {
            if let Some(v) = json.as_property(b"version") {
                if let ExprData::EString(s) = &v.expr.data {
                    break 'brk_version Some(s.data.slice());
                }
            }
            break 'brk_version None;
        };

        let new_version_str = Self::calculate_new_version(
            current_version.unwrap_or(b"0.0.0"),
            version_type,
            new_version,
            pm.options.preid,
            &package_json_dir,
        )?;
        // `defer ctx.allocator.free(new_version_str)` — handled by Drop.

        if let Some(version) = current_version {
            if !pm.options.allow_same_version && version == new_version_str.as_slice() {
                Output::err_generic("Version not changed", ());
                Global::exit(1);
            }
        }

        {
            json.data
                .e_object_mut()
                .expect("checked e_object above")
                .put_string(&json_bump, b"version", &new_version_str)?;

            let mut buffer_writer = JSPrinter::BufferWriter::init();
            buffer_writer.append_newline = !package_json_contents.is_empty()
                && package_json_contents[package_json_contents.len() - 1] == b'\n';
            let mut package_json_writer = JSPrinter::BufferPrinter::init(buffer_writer);

            // `bun_ast::Indentation` is the same type the printer consumes.
            let printer_indent: bun_ast::Indentation = json_result.indentation;

            if let Err(err) = JSPrinter::print_json(
                &mut package_json_writer,
                bun_ast::Expr::from(json),
                &package_json_source,
                JSPrinter::PrintJsonOptions {
                    indent: printer_indent,
                    mangled_props: None,
                    ..Default::default()
                },
            ) {
                Output::err_generic("Failed to save package.json: {}", (err.name(),));
                Global::exit(1);
            }

            // Zig used `std.fs.cwd().writeFile`; ported to bun_sys (no std::fs).
            if let Err(err) = bun_sys::File::write_file(
                Fd::cwd(),
                package_json_path,
                package_json_writer.ctx.written_without_trailing_zero(),
            ) {
                Output::err_generic("Failed to write package.json: {}", (BStr::new(err.name()),));
                Global::exit(1);
            }
        }

        if let Some(s) = &scripts_obj {
            if let Some(script) = s.get(b"version") {
                if let Some(script_command) = script.as_string(&json_bump) {
                    RunCommand::run_package_script_foreground(
                        ctx,
                        script_command,
                        b"version",
                        &package_json_dir,
                        pm.env_mut(),
                        &[],
                        silent,
                        use_system_shell,
                    )?;
                }
            }
        }

        if pm.options.git_tag_version {
            Self::git_commit_and_tag(&new_version_str, pm.options.message, &package_json_dir)?;
        }

        if let Some(s) = &scripts_obj {
            if let Some(script) = s.get(b"postversion") {
                if let Some(script_command) = script.as_string(&json_bump) {
                    RunCommand::run_package_script_foreground(
                        ctx,
                        script_command,
                        b"postversion",
                        &package_json_dir,
                        pm.env_mut(),
                        &[],
                        silent,
                        use_system_shell,
                    )?;
                }
            }
        }

        Output::print(format_args!("v{}\n", BStr::new(&new_version_str)));
        Output::flush();
        Ok(())
    }

    fn find_package_dir(start_dir: &[u8]) -> Result<Vec<u8>, AllocError> {
        let mut path_buf = PathBuffer::uninit();
        let mut current_dir = start_dir;

        loop {
            let package_json_path_z = path::join_abs_string_buf_z::<path_platform::Auto>(
                current_dir,
                &mut path_buf.0,
                &[b"package.json"],
            );
            if bun_sys::exists_at(Fd::cwd(), package_json_path_z) {
                return Ok(current_dir.to_vec());
            }

            let parent = path::dirname::<path_platform::Auto>(current_dir);
            if parent == current_dir {
                break;
            }
            current_dir = parent;
        }

        Ok(start_dir.to_vec())
    }

    fn verify_git(cwd: &[u8], pm: &mut PackageManager) -> Result<(), AllocError> {
        if !pm.options.git_tag_version {
            return Ok(());
        }

        let mut path_buf = PathBuffer::uninit();
        let git_dir_path =
            path::join_abs_string_buf_z::<path_platform::Auto>(cwd, &mut path_buf.0, &[b".git"]);
        if !matches!(
            bun_sys::directory_exists_at(Fd::cwd(), git_dir_path),
            Ok(true)
        ) {
            pm.options.git_tag_version = false;
            return Ok(());
        }

        if !pm.options.force && !Self::is_git_clean(cwd)? {
            Output::err_generic("Git working directory not clean.", ());
            Global::exit(1);
        }
        Ok(())
    }

    fn parse_version_argument(arg: &[u8]) -> (VersionType, Option<&[u8]>) {
        if let Some(vtype) = VersionType::from_string(arg) {
            return (vtype, None);
        }

        let version = Semver::Version::parse(Semver::SlicedString::init(arg, arg));
        if version.valid {
            return (VersionType::Specific, Some(arg));
        }

        Output::err_generic("Invalid version argument: \"{}\"", (BStr::new(arg),));
        Output::note(
            "Valid options: patch, minor, major, prepatch, preminor, premajor, prerelease, from-git, or a specific semver version",
        );
        Global::exit(1);
    }

    fn get_current_version(ctx: &command::ContextData, cwd: &[u8]) -> Option<Vec<u8>> {
        // PORT NOTE: reshaped — Zig returned a slice borrowing from ctx.allocator-owned
        // package.json bytes (leaked for process lifetime). Return owned Vec<u8> instead.
        let mut path_buf = PathBuffer::uninit();
        let package_json_path = path::join_abs_string_buf_z::<path_platform::Auto>(
            cwd,
            &mut path_buf.0,
            &[b"package.json"],
        );

        let Ok(package_json_contents) = bun_sys::File::read_from(Fd::cwd(), package_json_path)
        else {
            return None;
        };

        let package_json_source = bun_ast::Source::init_path_string(
            package_json_path.as_bytes(),
            &*package_json_contents,
        );
        let json_bump = Arena::new();
        let Ok(json) = JSON::parse_package_json_utf8(
            &package_json_source,
            unsafe { ctx.log_mut() },
            &json_bump,
        ) else {
            return None;
        };

        if let Some(v) = json.as_property(b"version") {
            if let ExprData::EString(s) = &v.expr.data {
                return Some(s.data.to_vec());
            }
        }

        None
    }

    fn show_help(
        ctx: &command::ContextData,
        pm: &PackageManager,
        cwd: &[u8],
    ) -> Result<(), AllocError> {
        let _current_version = Self::get_current_version(ctx, cwd);
        let current_version: &[u8] = _current_version.as_deref().unwrap_or(b"1.0.0");

        Output::prettyln(format_args!(
            "<r><b>bun pm version<r> <d>v{}<r>",
            Global::package_json_version_with_sha
        ));
        if let Some(version) = &_current_version {
            Output::prettyln(format_args!(
                "Current package version: <green>v{}<r>",
                BStr::new(version)
            ));
        }

        let preid = pm.options.preid;

        let patch_version =
            Self::calculate_new_version(current_version, VersionType::Patch, None, preid, cwd)?;
        let minor_version =
            Self::calculate_new_version(current_version, VersionType::Minor, None, preid, cwd)?;
        let major_version =
            Self::calculate_new_version(current_version, VersionType::Major, None, preid, cwd)?;
        let prerelease_version = Self::calculate_new_version(
            current_version,
            VersionType::Prerelease,
            None,
            preid,
            cwd,
        )?;
        // `defer ctx.allocator.free(...)` — handled by Drop.

        Output::pretty(format_args!(
            "\n<b>Increment<r>:\n  <cyan>patch<r>      <d>{cv} → {pv}<r>\n  <cyan>minor<r>      <d>{cv} → {miv}<r>\n  <cyan>major<r>      <d>{cv} → {mav}<r>\n  <cyan>prerelease<r> <d>{cv} → {prv}<r>\n",
            cv = BStr::new(current_version),
            pv = BStr::new(&patch_version),
            miv = BStr::new(&minor_version),
            mav = BStr::new(&major_version),
            prv = BStr::new(&prerelease_version),
        ));

        if strings::index_of_char(current_version, b'-').is_some() || !preid.is_empty() {
            let prepatch_version = Self::calculate_new_version(
                current_version,
                VersionType::Prepatch,
                None,
                preid,
                cwd,
            )?;
            let preminor_version = Self::calculate_new_version(
                current_version,
                VersionType::Preminor,
                None,
                preid,
                cwd,
            )?;
            let premajor_version = Self::calculate_new_version(
                current_version,
                VersionType::Premajor,
                None,
                preid,
                cwd,
            )?;

            Output::pretty(format_args!(
                "  <cyan>prepatch<r>   <d>{cv} → {pp}<r>\n  <cyan>preminor<r>   <d>{cv} → {pmi}<r>\n  <cyan>premajor<r>   <d>{cv} → {pma}<r>\n",
                cv = BStr::new(current_version),
                pp = BStr::new(&prepatch_version),
                pmi = BStr::new(&preminor_version),
                pma = BStr::new(&premajor_version),
            ));
        }

        let beta_prerelease_version = Self::calculate_new_version(
            current_version,
            VersionType::Prerelease,
            None,
            b"beta",
            cwd,
        )?;

        Output::pretty(format_args!(
            "  <cyan>from-git<r>   <d>Use version from latest git tag<r>\n\
             \x20 <blue>1.2.3<r>      <d>Set specific version<r>\n\
             \n\
             <b>Options<r>:\n\
             \x20 <cyan>--no-git-tag-version<r> <d>Skip git operations<r>\n\
             \x20 <cyan>--allow-same-version<r> <d>Prevents throwing error if version is the same<r>\n\
             \x20 <cyan>--message<d>=\\<val\\><r>, <cyan>-m<r>  <d>Custom commit message, use %s for version substitution<r>\n\
             \x20 <cyan>--preid<d>=\\<val\\><r>        <d>Prerelease identifier (i.e beta → {bpv})<r>\n\
             \x20 <cyan>--force<r>, <cyan>-f<r>          <d>Bypass dirty git history check<r>\n\
             \n\
             <b>Examples<r>:\n\
             \x20 <d>$<r> <b><green>bun pm version<r> <cyan>patch<r>\n\
             \x20 <d>$<r> <b><green>bun pm version<r> <blue>1.2.3<r> <cyan>--no-git-tag-version<r>\n\
             \x20 <d>$<r> <b><green>bun pm version<r> <cyan>prerelease<r> <cyan>--preid<r> <blue>beta<r> <cyan>--message<r> <blue>\"Release beta: %s\"<r>\n\
             \n\
             More info: <magenta>https://bun.com/docs/cli/pm#version<r>\n",
            bpv = BStr::new(&beta_prerelease_version),
        ));
        Output::flush();
        Ok(())
    }

    fn calculate_new_version(
        current_str: &[u8],
        version_type: VersionType,
        specific_version: Option<&[u8]>,
        preid: &[u8],
        cwd: &[u8],
    ) -> Result<Vec<u8>, AllocError> {
        if version_type == VersionType::Specific {
            return Ok(specific_version.unwrap().to_vec());
        }

        if version_type == VersionType::FromGit {
            return Self::get_version_from_git(cwd);
        }

        let current = Semver::Version::parse(Semver::SlicedString::init(current_str, current_str));
        if !current.valid {
            Output::err_generic(
                "Current version \"{}\" is not a valid semver",
                (BStr::new(current_str),),
            );
            Global::exit(1);
        }

        let prerelease_id: Vec<u8> = if !preid.is_empty() {
            preid.to_vec()
        } else if !current.version.tag.has_pre() {
            Vec::new()
        } else {
            'blk: {
                let current_prerelease = current.version.tag.pre.slice(current_str);

                if let Some(dot_index) = strings::index_of_char(current_prerelease, b'.') {
                    break 'blk current_prerelease[..dot_index as usize].to_vec();
                }

                break 'blk if bun_core::fmt::parse_decimal::<u32>(current_prerelease).is_some() {
                    Vec::new()
                } else {
                    current_prerelease.to_vec()
                };
            }
        };
        // `defer allocator.free(prerelease_id)` — handled by Drop.

        Self::increment_version(current_str, &current, version_type, &prerelease_id)
    }

    fn increment_version(
        current_str: &[u8],
        current: &Semver::version::ParseResult<u64>,
        version_type: VersionType,
        preid: &[u8],
    ) -> Result<Vec<u8>, AllocError> {
        let mut new_version = current.version.min();

        match version_type {
            VersionType::Patch => {
                return Ok(fmt_bytes(format_args!(
                    "{}.{}.{}",
                    new_version.major,
                    new_version.minor,
                    new_version.patch + 1
                )));
            }
            VersionType::Minor => {
                return Ok(fmt_bytes(format_args!(
                    "{}.{}.0",
                    new_version.major,
                    new_version.minor + 1
                )));
            }
            VersionType::Major => {
                return Ok(fmt_bytes(format_args!("{}.0.0", new_version.major + 1)));
            }
            VersionType::Prepatch => {
                if !preid.is_empty() {
                    return Ok(fmt_bytes(format_args!(
                        "{}.{}.{}-{}.0",
                        new_version.major,
                        new_version.minor,
                        new_version.patch + 1,
                        BStr::new(preid)
                    )));
                } else {
                    return Ok(fmt_bytes(format_args!(
                        "{}.{}.{}-0",
                        new_version.major,
                        new_version.minor,
                        new_version.patch + 1
                    )));
                }
            }
            VersionType::Preminor => {
                if !preid.is_empty() {
                    return Ok(fmt_bytes(format_args!(
                        "{}.{}.0-{}.0",
                        new_version.major,
                        new_version.minor + 1,
                        BStr::new(preid)
                    )));
                } else {
                    return Ok(fmt_bytes(format_args!(
                        "{}.{}.0-0",
                        new_version.major,
                        new_version.minor + 1
                    )));
                }
            }
            VersionType::Premajor => {
                if !preid.is_empty() {
                    return Ok(fmt_bytes(format_args!(
                        "{}.0.0-{}.0",
                        new_version.major + 1,
                        BStr::new(preid)
                    )));
                } else {
                    return Ok(fmt_bytes(format_args!("{}.0.0-0", new_version.major + 1)));
                }
            }
            VersionType::Prerelease => {
                if current.version.tag.has_pre() {
                    let current_prerelease = current.version.tag.pre.slice(current_str);
                    let identifier: &[u8] = if !preid.is_empty() {
                        preid
                    } else {
                        current_prerelease
                    };

                    if let Some(dot_index) = strings::last_index_of_char(current_prerelease, b'.') {
                        let number_str = &current_prerelease[(dot_index as usize) + 1..];
                        let next_num = bun_core::fmt::parse_decimal::<u32>(number_str).unwrap_or(0);
                        return Ok(fmt_bytes(format_args!(
                            "{}.{}.{}-{}.{}",
                            new_version.major,
                            new_version.minor,
                            new_version.patch,
                            BStr::new(identifier),
                            next_num + 1
                        )));
                    } else {
                        let num = bun_core::fmt::parse_decimal::<u32>(current_prerelease);
                        if let Some(n) = num {
                            if !preid.is_empty() {
                                return Ok(fmt_bytes(format_args!(
                                    "{}.{}.{}-{}.{}",
                                    new_version.major,
                                    new_version.minor,
                                    new_version.patch,
                                    BStr::new(preid),
                                    n + 1
                                )));
                            } else {
                                return Ok(fmt_bytes(format_args!(
                                    "{}.{}.{}-{}",
                                    new_version.major,
                                    new_version.minor,
                                    new_version.patch,
                                    n + 1
                                )));
                            }
                        } else {
                            return Ok(fmt_bytes(format_args!(
                                "{}.{}.{}-{}.1",
                                new_version.major,
                                new_version.minor,
                                new_version.patch,
                                BStr::new(identifier)
                            )));
                        }
                    }
                } else {
                    new_version.patch += 1;
                    if !preid.is_empty() {
                        return Ok(fmt_bytes(format_args!(
                            "{}.{}.{}-{}.0",
                            new_version.major,
                            new_version.minor,
                            new_version.patch,
                            BStr::new(preid)
                        )));
                    } else {
                        return Ok(fmt_bytes(format_args!(
                            "{}.{}.{}-0",
                            new_version.major, new_version.minor, new_version.patch
                        )));
                    }
                }
            }
            _ => {}
        }
        Ok(fmt_bytes(format_args!(
            "{}.{}.{}",
            new_version.major, new_version.minor, new_version.patch
        )))
    }

    fn is_git_clean(cwd: &[u8]) -> Result<bool, AllocError> {
        let mut path_buf = PathBuffer::uninit();
        let Some(git_path) = which(
            &mut path_buf,
            env_var::PATH.get().unwrap_or(b""),
            cwd,
            b"git",
        ) else {
            Output::err_generic(
                "git must be installed to use `bun pm version --git-tag-version`",
                (),
            );
            Global::exit(1);
        };

        let proc = match spawn_sync(&SpawnSyncOptions {
            argv: build_argv(&[git_path.as_bytes(), b"status", b"--porcelain"]),
            stdout: Stdio::Buffer,
            stderr: Stdio::Ignore,
            stdin: Stdio::Ignore,
            cwd: Box::<[u8]>::from(cwd),
            envp: None,
            #[cfg(windows)]
            windows: spawn_windows_options(),
            ..Default::default()
        }) {
            Ok(p) => p,
            Err(err) => {
                Output::err_generic("Failed to spawn git process: {}", (err.name(),));
                Global::exit(1);
            }
        };

        match proc {
            Err(err) => {
                Output::err(err, "Failed to spawn git process", ());
                Global::exit(1);
            }
            Ok(result) => Ok(result.is_ok() && result.stdout.is_empty()),
        }
    }

    fn get_version_from_git(cwd: &[u8]) -> Result<Vec<u8>, AllocError> {
        let mut path_buf = PathBuffer::uninit();
        let Some(git_path) = which(
            &mut path_buf,
            env_var::PATH.get().unwrap_or(b""),
            cwd,
            b"git",
        ) else {
            Output::err_generic("git must be installed to use `bun pm version from-git`", ());
            Global::exit(1);
        };

        let proc = match spawn_sync(&SpawnSyncOptions {
            argv: build_argv(&[git_path.as_bytes(), b"describe", b"--tags", b"--abbrev=0"]),
            stdout: Stdio::Buffer,
            stderr: Stdio::Buffer,
            stdin: Stdio::Ignore,
            cwd: Box::<[u8]>::from(cwd),
            envp: None,
            #[cfg(windows)]
            windows: spawn_windows_options(),
            ..Default::default()
        }) {
            Ok(p) => p,
            Err(err) => {
                Output::err(err, "Failed to spawn git process", ());
                Global::exit(1);
            }
        };

        match proc {
            Err(err) => {
                Output::err(err, "Git command failed unexpectedly", ());
                Global::exit(1);
            }
            Ok(result) => {
                if !result.is_ok() {
                    if !result.stderr.is_empty() {
                        Output::err_generic(
                            "Git error: {}",
                            (BStr::new(strings::trim(&result.stderr, b" \n\r\t")),),
                        );
                    } else {
                        Output::err_generic("No git tags found", ());
                    }
                    Global::exit(1);
                }

                let mut version_str = strings::trim(&result.stdout, b" \n\r\t");
                if version_str.starts_with(b"v") {
                    version_str = &version_str[1..];
                }

                Ok(version_str.to_vec())
            }
        }
    }

    fn git_commit_and_tag(
        version: &[u8],
        custom_message: Option<&[u8]>,
        cwd: &[u8],
    ) -> Result<(), AllocError> {
        let mut path_buf = PathBuffer::uninit();
        let Some(git_path) = which(
            &mut path_buf,
            env_var::PATH.get().unwrap_or(b""),
            cwd,
            b"git",
        ) else {
            Output::err_generic(
                "git must be installed to use `bun pm version --git-tag-version`",
                (),
            );
            Global::exit(1);
        };

        let stage_proc = match spawn_sync(&SpawnSyncOptions {
            argv: build_argv(&[git_path.as_bytes(), b"add", b"package.json"]),
            cwd: Box::<[u8]>::from(cwd),
            stdout: Stdio::Buffer,
            stderr: Stdio::Buffer,
            stdin: Stdio::Ignore,
            envp: None,
            #[cfg(windows)]
            windows: spawn_windows_options(),
            ..Default::default()
        }) {
            Ok(p) => p,
            Err(err) => {
                Output::err_generic("Git add failed: {}", (err.name(),));
                Global::exit(1);
            }
        };

        match stage_proc {
            Err(err) => {
                Output::err(err, "Git add failed unexpectedly", ());
                Global::exit(1);
            }
            Ok(result) => {
                if !result.is_ok() {
                    let exit_code: i32 = match &result.status {
                        ProcStatus::Exited(e) => i32::from(e.code),
                        _ => -1,
                    };
                    Output::err_generic("Git add failed with exit code {}", (exit_code,));
                    Global::exit(1);
                }
            }
        }

        let commit_message: Vec<u8> = if let Some(msg) = custom_message {
            // std.mem.replaceOwned(u8, allocator, msg, "%s", version)
            msg.replace(b"%s", version)
        } else {
            fmt_bytes(format_args!("v{}", BStr::new(version)))
        };
        // `defer allocator.free(commit_message)` — handled by Drop.

        let commit_proc = match spawn_sync(&SpawnSyncOptions {
            argv: build_argv(&[git_path.as_bytes(), b"commit", b"-m", &commit_message]),
            cwd: Box::<[u8]>::from(cwd),
            stdout: Stdio::Buffer,
            stderr: Stdio::Buffer,
            stdin: Stdio::Ignore,
            envp: None,
            #[cfg(windows)]
            windows: spawn_windows_options(),
            ..Default::default()
        }) {
            Ok(p) => p,
            Err(err) => {
                Output::err_generic("Git commit failed: {}", (err.name(),));
                Global::exit(1);
            }
        };

        match commit_proc {
            Err(err) => {
                Output::err(err, "Git commit failed unexpectedly", ());
                Global::exit(1);
            }
            Ok(result) => {
                if !result.is_ok() {
                    Output::err_generic("Git commit failed", ());
                    Global::exit(1);
                }
            }
        }

        let tag_name = fmt_bytes(format_args!("v{}", BStr::new(version)));
        // `defer allocator.free(tag_name)` — handled by Drop.

        let tag_proc = match spawn_sync(&SpawnSyncOptions {
            argv: build_argv(&[
                git_path.as_bytes(),
                b"tag",
                b"-a",
                &tag_name,
                b"-m",
                &tag_name,
            ]),
            cwd: Box::<[u8]>::from(cwd),
            stdout: Stdio::Buffer,
            stderr: Stdio::Buffer,
            stdin: Stdio::Ignore,
            envp: None,
            #[cfg(windows)]
            windows: spawn_windows_options(),
            ..Default::default()
        }) {
            Ok(p) => p,
            Err(err) => {
                Output::err_generic("Git tag failed: {}", (err.name(),));
                Global::exit(1);
            }
        };

        match tag_proc {
            Err(err) => {
                Output::err(err, "Git tag failed unexpectedly", ());
                Global::exit(1);
            }
            Ok(result) => {
                if !result.is_ok() {
                    Output::err_generic("Git tag failed", ());
                    Global::exit(1);
                }
            }
        }
        Ok(())
    }
}

// PORT NOTE: helper for `std.fmt.allocPrint` — builds into Vec<u8> (never `format!`).
#[inline]
fn fmt_bytes(args: core::fmt::Arguments<'_>) -> Vec<u8> {
    let mut v = Vec::new();
    v.write_fmt(args).expect("unreachable");
    v
}

// PORT NOTE: build `sync::Options.argv: Vec<Box<[u8]>>` from a slice of byte
// slices (Zig was `&.{...}` of `[]const u8`).
#[inline]
fn build_argv(parts: &[&[u8]]) -> Vec<Box<[u8]>> {
    parts.iter().map(|p| Box::<[u8]>::from(*p)).collect()
}

#[cfg(windows)]
#[inline]
fn spawn_windows_options() -> crate::api::bun::process::WindowsOptions {
    crate::api::bun::process::WindowsOptions {
        loop_: bun_jsc::EventLoopHandle::init_mini(bun_event_loop::MiniEventLoop::init_global(
            None, None,
        )),
        ..Default::default()
    }
}

// ported from: src/cli/pm_version_command.zig
