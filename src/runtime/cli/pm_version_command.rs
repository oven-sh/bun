use std::io::Write as _;

use bstr::BStr;

use crate::api::bun::process::Status as ProcStatus;
use crate::api::bun::process::sync::{
    Options as SpawnSyncOptions, Result as SpawnSyncResult, SyncStdio as Stdio, spawn as spawn_sync,
};
use crate::cli::command;
use crate::cli::run_command::RunCommand;
use bun_alloc::Arena;
use bun_ast::ExprData;
use bun_core::strings;
use bun_core::{Global, Output, env_var};
use bun_install::LogLevel;
use bun_install::PackageManager;
use bun_js_printer as JSPrinter;
use bun_parsers::json as JSON;
use bun_paths::{resolve_path as path, resolve_path::platform as path_platform};
use bun_semver as Semver;
use bun_sys::{self, Fd};
use bun_which::which;

pub(crate) struct PmVersionCommand;

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
    fn from_string(str: &[u8]) -> Option<VersionType> {
        Some(match str {
            b"patch" => VersionType::Patch,
            b"minor" => VersionType::Minor,
            b"major" => VersionType::Major,
            b"prepatch" => VersionType::Prepatch,
            b"preminor" => VersionType::Preminor,
            b"premajor" => VersionType::Premajor,
            b"prerelease" => VersionType::Prerelease,
            b"from-git" => VersionType::FromGit,
            _ => return None,
        })
    }
}

impl PmVersionCommand {
    pub(crate) fn exec(
        ctx: command::Context<'_>,
        pm: &mut PackageManager,
        positionals: &[&[u8]],
        original_cwd: &[u8],
    ) -> Result<(), crate::Error> {
        let package_json_dir = Self::find_package_dir(original_cwd);

        if positionals.len() <= 1 {
            Self::show_help(ctx, pm, &package_json_dir);
            return Ok(());
        }

        let (version_type, new_version) = Self::parse_version_argument(positionals[1]);

        Self::verify_git(&package_json_dir, pm);

        let mut path_buf = bun_paths::path_buffer_pool::get();
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

        let package_json_source = bun_ast::Source::init_path_string(
            package_json_path.as_bytes(),
            &*package_json_contents,
        );
        let json_bump = Arena::new();
        let json_result = match JSON::parse_package_json_utf8_with_opts(
            JSON::JSONOptions {
                json_warn_duplicate_keys: false,
                guess_indentation: true,
                ..JSON::PACKAGE_JSON_OPTS
            },
            &package_json_source,
            // SAFETY: no other borrow of the process-static `Log` is live during this call.
            unsafe { ctx.log_mut() },
            &json_bump,
        ) {
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

        let dry_run = pm.options.dry_run;
        let scripts_obj = (pm.options.do_.run_scripts() && !dry_run)
            .then(|| json.get(b"scripts"))
            .flatten()
            .filter(|scripts| matches!(scripts.data, ExprData::EObject(_)));

        let silent = pm.options.log_level == LogLevel::Silent;
        let use_system_shell = ctx.debug.use_system_shell;

        let mut run_script = |name: &[u8]| -> Result<(), crate::Error> {
            let script = scripts_obj.and_then(|scripts| scripts.get(name));
            let Some(script_command) = script.and_then(|script| script.as_string(&json_bump))
            else {
                return Ok(());
            };
            RunCommand::run_package_script_foreground(
                &mut *ctx,
                script_command,
                name,
                &package_json_dir,
                pm.env_mut(),
                &[],
                silent,
                use_system_shell,
            )
        };

        run_script(b"preversion")?;

        let current_version: Option<&[u8]> = match json.get(b"version").map(|v| v.data) {
            Some(ExprData::EString(s)) => Some(s.data.slice()),
            _ => None,
        };

        let new_version_str = Self::calculate_new_version(
            current_version.unwrap_or(b"0.0.0"),
            version_type,
            new_version,
            pm.options.preid,
            &package_json_dir,
        );

        if let Some(version) = current_version {
            if !pm.options.allow_same_version && version == new_version_str.as_slice() {
                Output::err_generic("Version not changed", ());
                Global::exit(1);
            }
        }

        if dry_run {
            Output::print(format_args!("v{}\n", BStr::new(&new_version_str)));
            Output::flush();
            return Ok(());
        }

        json.data
            .e_object_mut()
            .expect("checked e_object above")
            .put_string(&json_bump, b"version", &new_version_str)?;

        let mut buffer_writer = JSPrinter::BufferWriter::init();
        buffer_writer.append_newline = package_json_contents.ends_with(b"\n");
        let mut package_json_writer = JSPrinter::BufferPrinter::init(buffer_writer);

        if let Err(err) = JSPrinter::print_json(
            &mut package_json_writer,
            json,
            &package_json_source,
            JSPrinter::PrintJsonOptions {
                indent: json_result.indentation,
                mangled_props: None,
                ..Default::default()
            },
        ) {
            Output::err_generic("Failed to save package.json: {}", (err.name(),));
            Global::exit(1);
        }

        if let Err(err) = bun_sys::File::write_file(
            Fd::cwd(),
            package_json_path,
            package_json_writer.ctx.written_without_trailing_zero(),
        ) {
            Output::err_generic("Failed to write package.json: {}", (BStr::new(err.name()),));
            Global::exit(1);
        }

        run_script(b"version")?;

        if pm.options.git_tag_version {
            Self::git_commit_and_tag(&new_version_str, pm.options.message, &package_json_dir);
        }

        run_script(b"postversion")?;

        Output::print(format_args!("v{}\n", BStr::new(&new_version_str)));
        Output::flush();
        Ok(())
    }

    fn find_package_dir(start_dir: &[u8]) -> Vec<u8> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let mut current_dir = start_dir;

        loop {
            let package_json_path_z = path::join_abs_string_buf_z::<path_platform::Auto>(
                current_dir,
                &mut path_buf.0,
                &[b"package.json"],
            );
            if bun_sys::exists_at(Fd::cwd(), package_json_path_z) {
                return current_dir.to_vec();
            }

            let parent = path::dirname::<path_platform::Auto>(current_dir);
            if parent == current_dir {
                return start_dir.to_vec();
            }
            current_dir = parent;
        }
    }

    fn verify_git(cwd: &[u8], pm: &mut PackageManager) {
        if !pm.options.git_tag_version {
            return;
        }

        let mut path_buf = bun_paths::path_buffer_pool::get();
        let git_dir_path =
            path::join_abs_string_buf_z::<path_platform::Auto>(cwd, &mut path_buf.0, &[b".git"]);
        // `.git` is a file, not a directory, in a linked worktree or a submodule.
        if !bun_sys::exists_z(git_dir_path) {
            pm.options.git_tag_version = false;
        } else if !pm.options.force && !Self::is_git_clean(cwd) {
            Output::err_generic("Git working directory not clean.", ());
            Global::exit(1);
        }
    }

    /// node-semver's limit: https://github.com/npm/node-semver/blob/v7.7.2/classes/semver.js#L50-L60
    fn is_valid_version(result: &Semver::version::ParseResult<u64>) -> bool {
        const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
        let version = result.version.min();
        result.valid && version.major.max(version.minor).max(version.patch) <= MAX_SAFE_INTEGER
    }

    fn parse_version_argument(arg: &[u8]) -> (VersionType, Option<&[u8]>) {
        if let Some(vtype) = VersionType::from_string(arg) {
            return (vtype, None);
        }

        let version = Semver::Version::parse(Semver::SlicedString::init(arg, arg));
        if Self::is_valid_version(&version) {
            return (VersionType::Specific, Some(arg));
        }

        Output::err_generic("Invalid version argument: \"{}\"", (BStr::new(arg),));
        bun_core::note!(
            "Valid options: patch, minor, major, prepatch, preminor, premajor, prerelease, from-git, or a specific semver version"
        );
        Global::exit(1);
    }

    fn get_current_version(ctx: &command::ContextData, cwd: &[u8]) -> Option<Vec<u8>> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let package_json_path = path::join_abs_string_buf_z::<path_platform::Auto>(
            cwd,
            &mut path_buf.0,
            &[b"package.json"],
        );

        let package_json_contents = bun_sys::File::read_from(Fd::cwd(), package_json_path).ok()?;

        let package_json_source = bun_ast::Source::init_path_string(
            package_json_path.as_bytes(),
            &*package_json_contents,
        );
        let json_bump = Arena::new();
        let json = JSON::parse_package_json_utf8(
            &package_json_source,
            // SAFETY: no other borrow of the process-static `Log` is live during this call.
            unsafe { ctx.log_mut() },
            &json_bump,
        )
        .ok()?;

        match json.get(b"version")?.data {
            ExprData::EString(s) => Some(s.data.to_vec()),
            _ => None,
        }
    }

    fn show_help(ctx: &command::ContextData, pm: &PackageManager, cwd: &[u8]) {
        let _current_version = Self::get_current_version(ctx, cwd);
        let current_version: &[u8] = _current_version.as_deref().unwrap_or(b"1.0.0");

        bun_core::prettyln!(
            "<r><b>bun pm version<r> <d>v{}<r>",
            Global::package_json_version_with_sha
        );
        if let Some(version) = &_current_version {
            bun_core::prettyln!("Current package version: <green>v{}<r>", BStr::new(version));
        }

        let preid = pm.options.preid;
        let next = |version_type: VersionType, preid: &[u8]| {
            Self::calculate_new_version(current_version, version_type, None, preid, cwd)
        };

        bun_core::pretty!(
            "\n<b>Increment<r>:\n  <cyan>patch<r>      <d>{0} → {1}<r>\n  <cyan>minor<r>      <d>{0} → {2}<r>\n  <cyan>major<r>      <d>{0} → {3}<r>\n  <cyan>prerelease<r> <d>{0} → {4}<r>\n",
            BStr::new(current_version),
            BStr::new(&next(VersionType::Patch, preid)),
            BStr::new(&next(VersionType::Minor, preid)),
            BStr::new(&next(VersionType::Major, preid)),
            BStr::new(&next(VersionType::Prerelease, preid)),
        );

        if strings::index_of_char(current_version, b'-').is_some() || !preid.is_empty() {
            bun_core::pretty!(
                "  <cyan>prepatch<r>   <d>{0} → {1}<r>\n  <cyan>preminor<r>   <d>{0} → {2}<r>\n  <cyan>premajor<r>   <d>{0} → {3}<r>\n",
                BStr::new(current_version),
                BStr::new(&next(VersionType::Prepatch, preid)),
                BStr::new(&next(VersionType::Preminor, preid)),
                BStr::new(&next(VersionType::Premajor, preid)),
            );
        }

        let beta_prerelease_version = next(VersionType::Prerelease, b"beta");

        bun_core::pretty!(
            "  <cyan>from-git<r>   <d>Use version from latest git tag<r>\n\
             \x20 <blue>1.2.3<r>      <d>Set specific version<r>\n\
             \n\
             <b>Options<r>:\n\
             \x20 <cyan>--no-git-tag-version<r> <d>Skip git operations<r>\n\
             \x20 <cyan>--allow-same-version<r> <d>Prevents throwing error if version is the same<r>\n\
             \x20 <cyan>--message<d>=\\<val\\><r>, <cyan>-m<r>  <d>Custom commit message, use %s for version substitution<r>\n\
             \x20 <cyan>--preid<d>=\\<val\\><r>        <d>Prerelease identifier (i.e beta → {})<r>\n\
             \x20 <cyan>--force<r>, <cyan>-f<r>          <d>Bypass dirty git history check<r>\n\
             \x20 <cyan>--dry-run<r>            <d>Print the new version without writing, running scripts, or tagging<r>\n\
             \n\
             <b>Examples<r>:\n\
             \x20 <d>$<r> <b><green>bun pm version<r> <cyan>patch<r>\n\
             \x20 <d>$<r> <b><green>bun pm version<r> <blue>1.2.3<r> <cyan>--no-git-tag-version<r>\n\
             \x20 <d>$<r> <b><green>bun pm version<r> <cyan>prerelease<r> <cyan>--preid<r> <blue>beta<r> <cyan>--message<r> <blue>\"Release beta: %s\"<r>\n\
             \n\
             More info: <magenta>https://bun.com/docs/cli/pm#version<r>\n",
            BStr::new(&beta_prerelease_version),
        );
        Output::flush();
    }

    fn calculate_new_version(
        current_str: &[u8],
        version_type: VersionType,
        specific_version: Option<&[u8]>,
        preid: &[u8],
        cwd: &[u8],
    ) -> Vec<u8> {
        if version_type == VersionType::Specific {
            return specific_version.unwrap().to_vec();
        }

        if version_type == VersionType::FromGit {
            return Self::get_version_from_git(cwd);
        }

        let current = Semver::Version::parse(Semver::SlicedString::init(current_str, current_str));
        if !Self::is_valid_version(&current) {
            Output::err_generic(
                "Current version \"{}\" is not a valid semver",
                (BStr::new(current_str),),
            );
            Global::exit(1);
        }

        let current_prerelease = current.version.tag.pre.slice(current_str);
        let prerelease_id: &[u8] = if !preid.is_empty() {
            preid
        } else if !current.version.tag.has_pre() {
            b""
        } else if let Some(dot_index) = strings::index_of_char(current_prerelease, b'.') {
            &current_prerelease[..dot_index as usize]
        } else if Self::next_prerelease_number(current_prerelease).is_some() {
            b""
        } else {
            current_prerelease
        };

        Self::increment_version(current_str, &current, version_type, prerelease_id)
    }

    /// `None` for a name, and for a number with no successor in the u64 `Tag::order_pre` compares in.
    fn next_prerelease_number(identifier: &[u8]) -> Option<u64> {
        bun_core::fmt::parse_decimal::<u64>(identifier)?.checked_add(1)
    }

    fn increment_version(
        current_str: &[u8],
        current: &Semver::version::ParseResult<u64>,
        version_type: VersionType,
        preid: &[u8],
    ) -> Vec<u8> {
        let v = current.version.min();
        // The first prerelease of a version.
        let first = if preid.is_empty() {
            "0".to_owned()
        } else {
            format!("{}.0", BStr::new(preid))
        };

        let (major, minor, patch, pre) = match version_type {
            VersionType::Patch => (v.major, v.minor, v.patch + 1, None),
            VersionType::Minor => (v.major, v.minor + 1, 0, None),
            VersionType::Major => (v.major + 1, 0, 0, None),
            VersionType::Prepatch => (v.major, v.minor, v.patch + 1, Some(first)),
            VersionType::Preminor => (v.major, v.minor + 1, 0, Some(first)),
            VersionType::Premajor => (v.major + 1, 0, 0, Some(first)),
            VersionType::Prerelease if !current.version.tag.has_pre() => {
                (v.major, v.minor, v.patch + 1, Some(first))
            }
            VersionType::Prerelease => {
                let current_prerelease = current.version.tag.pre.slice(current_str);
                let identifier = BStr::new(if !preid.is_empty() {
                    preid
                } else {
                    current_prerelease
                });
                let pre = match strings::last_index_of_char(current_prerelease, b'.') {
                    Some(dot_index) => {
                        let number_str = &current_prerelease[dot_index + 1..];
                        let next_num = Self::next_prerelease_number(number_str).unwrap_or(1);
                        format!("{identifier}.{next_num}")
                    }
                    None => match Self::next_prerelease_number(current_prerelease) {
                        Some(next_num) if preid.is_empty() => next_num.to_string(),
                        next_num => format!("{identifier}.{}", next_num.unwrap_or(1)),
                    },
                };
                (v.major, v.minor, v.patch, Some(pre))
            }
            VersionType::Specific | VersionType::FromGit => (v.major, v.minor, v.patch, None),
        };

        match pre {
            Some(pre) => fmt_bytes(format_args!("{major}.{minor}.{patch}-{pre}")),
            None => fmt_bytes(format_args!("{major}.{minor}.{patch}")),
        }
    }

    fn find_git<'a>(
        path_buf: &'a mut bun_paths::PathBuffer,
        cwd: &[u8],
        used_for: &str,
    ) -> &'a [u8] {
        let Some(git_path) = which(path_buf, env_var::PATH.get().unwrap_or(b""), cwd, b"git")
        else {
            Output::err_generic(
                "git must be installed to use `bun pm version {}`",
                (used_for,),
            );
            Global::exit(1);
        };
        git_path.as_bytes()
    }

    /// Runs `argv` in `cwd` with its stdout buffered.
    fn spawn_git(
        argv: &[&[u8]],
        cwd: &[u8],
        stderr: Stdio,
    ) -> Result<bun_sys::Maybe<SpawnSyncResult>, bun_spawn::Error> {
        spawn_sync(&SpawnSyncOptions {
            argv: argv.iter().map(|arg| Box::<[u8]>::from(*arg)).collect(),
            stdout: Stdio::Buffer,
            stderr,
            stdin: Stdio::Ignore,
            cwd: Box::<[u8]>::from(cwd),
            envp: None,
            #[cfg(windows)]
            windows: spawn_windows_options(),
            ..Default::default()
        })
    }

    fn is_git_clean(cwd: &[u8]) -> bool {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let git_path = Self::find_git(&mut path_buf, cwd, "--git-tag-version");

        match Self::spawn_git(&[git_path, b"status", b"--porcelain"], cwd, Stdio::Ignore) {
            Ok(Ok(result)) => result.is_ok() && result.stdout.is_empty(),
            Ok(Err(err)) => {
                Output::err(err, "Failed to spawn git process", ());
                Global::exit(1);
            }
            Err(err) => {
                Output::err_generic("Failed to spawn git process: {}", (err.name(),));
                Global::exit(1);
            }
        }
    }

    fn get_version_from_git(cwd: &[u8]) -> Vec<u8> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let git_path = Self::find_git(&mut path_buf, cwd, "from-git");

        let argv: [&[u8]; 4] = [git_path, b"describe", b"--tags", b"--abbrev=0"];
        let result = match Self::spawn_git(&argv, cwd, Stdio::Buffer) {
            Ok(Ok(result)) => result,
            Ok(Err(err)) => {
                Output::err(err, "Git command failed unexpectedly", ());
                Global::exit(1);
            }
            Err(err) => {
                Output::err(err, "Failed to spawn git process", ());
                Global::exit(1);
            }
        };

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

        let version_str = strings::trim(&result.stdout, b" \n\r\t");
        version_str
            .strip_prefix(b"v")
            .unwrap_or(version_str)
            .to_vec()
    }

    /// `git <what>`, which may have exited with a failure.
    fn run_git(what: &str, argv: &[&[u8]], cwd: &[u8]) -> SpawnSyncResult {
        match Self::spawn_git(argv, cwd, Stdio::Buffer) {
            Ok(Ok(result)) => result,
            Ok(Err(err)) => {
                Output::err(err, "Git {} failed unexpectedly", (what,));
                Global::exit(1);
            }
            Err(err) => {
                Output::err_generic("Git {} failed: {}", (what, err.name()));
                Global::exit(1);
            }
        }
    }

    fn git_commit_and_tag(version: &[u8], custom_message: Option<&[u8]>, cwd: &[u8]) {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let git_path = Self::find_git(&mut path_buf, cwd, "--git-tag-version");

        let staged = Self::run_git("add", &[git_path, b"add", b"package.json"], cwd);
        if !staged.is_ok() {
            let exit_code: i32 = match &staged.status {
                ProcStatus::Exited(e) => i32::from(e.code),
                _ => -1,
            };
            Output::err_generic("Git add failed with exit code {}", (exit_code,));
            Global::exit(1);
        }

        let tag_name = fmt_bytes(format_args!("v{}", BStr::new(version)));
        let commit_message: Vec<u8> = match custom_message {
            Some(msg) => strings::replace_owned(msg, b"%s", version),
            None => tag_name.clone(),
        };

        let commit: [&[u8]; 4] = [git_path, b"commit", b"-m", &commit_message];
        if !Self::run_git("commit", &commit, cwd).is_ok() {
            Output::err_generic("Git commit failed", ());
            Global::exit(1);
        }

        let tag: [&[u8]; 6] = [git_path, b"tag", b"-a", &tag_name, b"-m", &tag_name];
        if !Self::run_git("tag", &tag, cwd).is_ok() {
            Output::err_generic("Git tag failed", ());
            Global::exit(1);
        }
    }
}

fn fmt_bytes(args: core::fmt::Arguments<'_>) -> Vec<u8> {
    let mut v = Vec::new();
    v.write_fmt(args).expect("unreachable");
    v
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
