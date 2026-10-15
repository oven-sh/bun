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

/// A version as node-semver stores it: the prerelease is split at its dots, and the build metadata
/// is dropped.
struct Version {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Vec<Vec<u8>>,
}

impl Version {
    /// The largest major, minor, or patch number that node-semver accepts:
    /// https://github.com/npm/node-semver/blob/v7.7.2/classes/semver.js#L50-L60
    const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

    /// Does what node-semver's `semver.parse(semver.clean(text), { loose: true })` does.
    fn parse(text: &[u8]) -> Option<Version> {
        let version = Semver::Version::parse_exact(Semver::SlicedString::init(text, text))?;
        if version.major.max(version.minor).max(version.patch) > Self::MAX_SAFE_INTEGER {
            return None;
        }
        Some(Version {
            major: version.major,
            minor: version.minor,
            patch: version.patch,
            prerelease: match version.tag.pre.slice(text) {
                b"" => Vec::new(),
                prerelease => Self::identifiers(prerelease)?,
            },
        })
    }

    /// Splits a prerelease into its dot-separated identifiers. Returns `None` if one of them is
    /// empty or has a character that semver does not allow.
    fn identifiers(prerelease: &[u8]) -> Option<Vec<Vec<u8>>> {
        strings::split(prerelease, b".")
            .map(|identifier| {
                let is_valid = !identifier.is_empty()
                    && (identifier.iter())
                        .all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'-'));
                is_valid.then(|| match Self::number(identifier) {
                    Some(number) => number.to_string().into_bytes(),
                    None => identifier.to_vec(),
                })
            })
            .collect()
    }

    /// Like node-semver, treats an identifier made of digits as a number only if it is below
    /// `Number.MAX_SAFE_INTEGER`. A larger one is treated as a string.
    fn number(identifier: &[u8]) -> Option<u64> {
        bun_core::parse_unsigned::<u64>(identifier, 10)
            .ok()
            .filter(|number| *number < Self::MAX_SAFE_INTEGER)
    }

    /// Does what node-semver's `semver.inc(self, release, preid)` does. Returns `None` if `preid`
    /// is not a valid prerelease.
    fn increment(mut self, release: VersionType, preid: &[u8]) -> Option<Version> {
        // Bumping a prerelease of x.0.0, x.y.0, or x.y.z gives that release, not the one after it.
        let is_release = self.prerelease.is_empty();
        match release {
            VersionType::Major | VersionType::Premajor => {
                if release == VersionType::Premajor
                    || is_release
                    || self.minor != 0
                    || self.patch != 0
                {
                    self.major += 1;
                }
                (self.minor, self.patch) = (0, 0);
            }
            VersionType::Minor | VersionType::Preminor => {
                if release == VersionType::Preminor || is_release || self.patch != 0 {
                    self.minor += 1;
                }
                self.patch = 0;
            }
            VersionType::Patch | VersionType::Prerelease if !is_release => {}
            VersionType::Patch | VersionType::Prerelease | VersionType::Prepatch => {
                self.patch += 1;
            }
            VersionType::Specific | VersionType::FromGit => return Some(self),
        }
        if release != VersionType::Prerelease {
            self.prerelease.clear();
        }
        if matches!(
            release,
            VersionType::Major | VersionType::Minor | VersionType::Patch
        ) {
            return Some(self);
        }

        let last_number = (self.prerelease.iter_mut().rev())
            .find_map(|identifier| Some((Self::number(identifier)?, identifier)));
        match last_number {
            Some((number, identifier)) => *identifier = (number + 1).to_string().into_bytes(),
            None => self.prerelease.push(b"0".to_vec()),
        }
        if !preid.is_empty() {
            Self::identifiers(preid)?;
            // `preid` is parsed strictly, so `01` is invalid. Only the current version is parsed
            // loosely, where `01` means 1.
            if strings::split(preid, b".")
                .any(|it| it.len() > 1 && it[0] == b'0' && it.iter().all(u8::is_ascii_digit))
            {
                return None;
            }
            let first = self.prerelease[0].as_slice();
            let is_same_name = match (Self::number(first), Self::number(preid)) {
                (Some(first), Some(preid)) => first == preid,
                _ => first == preid,
            };
            let second = self.prerelease.get(1);
            if !is_same_name || !second.is_some_and(|it| it.iter().all(u8::is_ascii_digit)) {
                self.prerelease = vec![preid.to_vec(), b"0".to_vec()];
            }
        }
        Some(self)
    }

    fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = fmt_bytes(format_args!("{}.{}.{}", self.major, self.minor, self.patch));
        if !self.prerelease.is_empty() {
            bytes.push(b'-');
            bytes.extend_from_slice(&self.prerelease.join(&b'.'));
        }
        bytes
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

        // Bun's shell runs the scripts with the global `MiniEventLoop`'s environment, which only
        // the first `init_global` call sets. On Windows, spawning git would otherwise be that call.
        bun_event_loop::MiniEventLoop::init_global(Some(pm.env_mut()), Some(&package_json_dir));

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

        let mut run_script = |name: &[u8]| -> Result<(), crate::Error> {
            let script = scripts_obj.and_then(|scripts| scripts.get(name));
            let Some(script_command) = script.and_then(|script| script.as_string(&json_bump))
            else {
                return Ok(());
            };
            RunCommand::run_lifecycle_script_foreground(
                &mut *ctx,
                script_command,
                name,
                &package_json_dir,
                pm.env_mut(),
                silent,
            )
        };

        let current_version: Option<&[u8]> = match json.get(b"version").map(|v| v.data) {
            Some(ExprData::EString(s)) => Some(s.data.slice()),
            _ => None,
        };

        let new_version_str = Self::calculate_new_version(
            current_version.unwrap_or(b"0.0.0"),
            version_type,
            new_version.as_deref(),
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

        // `npm version` sets these variables for `preversion`, `version`, and `postversion`.
        let name = json
            .get(b"name")
            .and_then(|name| name.as_string(&json_bump));
        let variables: [(&[u8], Option<&[u8]>); 6] = [
            (b"npm_command", Some(b"version".as_slice())),
            (b"npm_package_json", Some(package_json_path.as_bytes())),
            (b"npm_package_name", name),
            (b"npm_package_version", current_version),
            (
                b"npm_old_version",
                Some(current_version.unwrap_or(b"0.0.0")),
            ),
            (b"npm_new_version", Some(new_version_str.as_slice())),
        ];
        for (key, value) in variables {
            if let Some(value) = value {
                pm.env_mut().map.put(key, value)?;
            }
        }

        run_script(b"preversion")?;

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

        pm.env_mut()
            .map
            .put(b"npm_package_version", &new_version_str)?;
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

    fn parse_version_argument(arg: &[u8]) -> (VersionType, Option<Vec<u8>>) {
        if let Some(vtype) = VersionType::from_string(arg) {
            return (vtype, None);
        }

        if let Some(version) = Version::parse(arg) {
            return (VersionType::Specific, Some(version.to_bytes()));
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
            bun_core::prettyln!(
                "Current package version: <green>v{}<r>",
                bun_core::fmt::escape_control_chars(version)
            );
        }

        let preid = pm.options.preid;
        let next = |version_type: VersionType, preid: &[u8]| {
            Self::calculate_new_version(current_version, version_type, None, preid, cwd)
        };

        bun_core::pretty!(
            "\n<b>Increment<r>:\n  <cyan>patch<r>      <d>{0} → {1}<r>\n  <cyan>minor<r>      <d>{0} → {2}<r>\n  <cyan>major<r>      <d>{0} → {3}<r>\n  <cyan>prerelease<r> <d>{0} → {4}<r>\n",
            bun_core::fmt::escape_control_chars(current_version),
            BStr::new(&next(VersionType::Patch, preid)),
            BStr::new(&next(VersionType::Minor, preid)),
            BStr::new(&next(VersionType::Major, preid)),
            BStr::new(&next(VersionType::Prerelease, preid)),
        );

        if strings::index_of_char(current_version, b'-').is_some() || !preid.is_empty() {
            bun_core::pretty!(
                "  <cyan>prepatch<r>   <d>{0} → {1}<r>\n  <cyan>preminor<r>   <d>{0} → {2}<r>\n  <cyan>premajor<r>   <d>{0} → {3}<r>\n",
                bun_core::fmt::escape_control_chars(current_version),
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

        let Some(current) = Version::parse(current_str) else {
            Output::err_generic(
                "Current version \"{}\" is not a valid semver",
                (bun_core::fmt::escape_control_chars(current_str),),
            );
            Global::exit(1);
        };

        let Some(next) = current.increment(version_type, preid) else {
            Output::err_generic("Invalid --preid: \"{}\"", (BStr::new(preid),));
            Global::exit(1);
        };
        next.to_bytes()
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

        // Like `npm version from-git`, `--match` skips tags that are not versions, like `nightly`.
        let argv: [&[u8]; 5] = [
            git_path,
            b"describe",
            b"--tags",
            b"--abbrev=0",
            b"--match=*.*.*",
        ];
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

        // The version can follow a prefix, as in `v1.2.3` or `name@1.2.3`.
        let tag = strings::trim(&result.stdout, b" \n\r\t");
        let prefix = tag.iter().take_while(|c| !c.is_ascii_digit()).count();
        let Some(version) = Version::parse(&tag[prefix..]) else {
            Output::err_generic(
                "Tag is not a valid version: \"{}\"",
                (bun_core::fmt::escape_control_chars(tag),),
            );
            Global::exit(1);
        };
        version.to_bytes()
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
