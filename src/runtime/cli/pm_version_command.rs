use std::io::Write as _;

use bstr::BStr;

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
use bun_paths::{resolve_path as path, resolve_path::platform as path_platform};
use bun_semver as Semver;
use bun_semver::semver_query::Wildcard;
use bun_sys::{self, Fd};
use bun_which::which;

pub(crate) struct PmVersionCommand;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Increment {
    Patch,
    Minor,
    Major,
    Prepatch,
    Preminor,
    Premajor,
    Prerelease,
}

impl Increment {
    fn from_string(str: &[u8]) -> Option<Increment> {
        Some(match str {
            b"patch" => Increment::Patch,
            b"minor" => Increment::Minor,
            b"major" => Increment::Major,
            b"prepatch" => Increment::Prepatch,
            b"preminor" => Increment::Preminor,
            b"premajor" => Increment::Premajor,
            b"prerelease" => Increment::Prerelease,
            _ => return None,
        })
    }

    fn is_prerelease(self) -> bool {
        matches!(
            self,
            Increment::Prepatch | Increment::Preminor | Increment::Premajor | Increment::Prerelease
        )
    }
}

enum VersionArgument {
    Increment(Increment),
    Specific(PackageVersion),
    FromGit,
}

/// One dot-separated piece of a prerelease (`beta`, `1`) or of a `--preid` value.
#[derive(Clone, PartialEq, Eq)]
enum Identifier {
    Numeric(u64),
    Alphanumeric(Box<[u8]>),
}

impl Identifier {
    fn parse(bytes: &[u8]) -> Option<Identifier> {
        if bytes.is_empty() {
            return None;
        }
        if bytes.iter().all(u8::is_ascii_digit) {
            // Like node-semver, a number too large to count with stays a string.
            return Some(match bun_core::fmt::parse_unsigned::<u64>(bytes, 10) {
                Ok(n) if n <= MAX_SAFE_INTEGER => Identifier::Numeric(n),
                _ => Identifier::Alphanumeric(bytes.into()),
            });
        }
        if bytes
            .iter()
            .all(|&c| matches!(c, b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z' | b'-'))
        {
            return Some(Identifier::Alphanumeric(bytes.into()));
        }
        None
    }

    fn parse_dot_separated(bytes: &[u8]) -> Option<Vec<Identifier>> {
        strings::split(bytes, b".").map(Identifier::parse).collect()
    }
}

/// `major.minor.patch[-prerelease]` as `npm version` reads and writes it. Build
/// metadata is accepted when parsing and dropped, like node-semver's `SemVer.version`.
#[derive(Clone)]
struct PackageVersion {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Vec<Identifier>,
}

/// node-semver does not treat larger numbers as version components.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

impl PackageVersion {
    /// node-semver `clean()`: surrounding whitespace and a `v`/`=` prefix are
    /// allowed, the rest must be exactly `major.minor.patch[-pre][+build]`.
    fn parse(input: &[u8]) -> Option<PackageVersion> {
        let input = strings::trim(input, b" \t\n\r");
        let result = Semver::Version::parse(Semver::SlicedString::init(input, input));
        if !result.valid || result.wildcard != Wildcard::None || result.len as usize != input.len()
        {
            return None;
        }
        let version = result.version.min();
        if version.major > MAX_SAFE_INTEGER
            || version.minor > MAX_SAFE_INTEGER
            || version.patch > MAX_SAFE_INTEGER
        {
            return None;
        }
        if version.tag.has_build() {
            Identifier::parse_dot_separated(version.tag.build.slice(input))?;
        }
        let prerelease = if version.tag.has_pre() {
            Identifier::parse_dot_separated(version.tag.pre.slice(input))?
        } else {
            Vec::new()
        };
        Some(PackageVersion {
            major: version.major,
            minor: version.minor,
            patch: version.patch,
            prerelease,
        })
    }

    /// node-semver `SemVer.inc()`, which `npm version` and `yarn version` use.
    fn increment(&mut self, by: Increment, preid: &[Identifier]) {
        match by {
            Increment::Premajor => {
                self.major += 1;
                self.minor = 0;
                self.patch = 0;
                self.prerelease.clear();
                self.increment_prerelease(preid);
            }
            Increment::Preminor => {
                self.minor += 1;
                self.patch = 0;
                self.prerelease.clear();
                self.increment_prerelease(preid);
            }
            Increment::Prepatch => {
                self.patch += 1;
                self.prerelease.clear();
                self.increment_prerelease(preid);
            }
            Increment::Prerelease => {
                if self.prerelease.is_empty() {
                    self.patch += 1;
                }
                self.increment_prerelease(preid);
            }
            // A prerelease of X.0.0 / X.Y.0 / X.Y.Z is released as that version
            // by the matching increment instead of skipping past it.
            Increment::Major => {
                if self.minor != 0 || self.patch != 0 || self.prerelease.is_empty() {
                    self.major += 1;
                }
                self.minor = 0;
                self.patch = 0;
                self.prerelease.clear();
            }
            Increment::Minor => {
                if self.patch != 0 || self.prerelease.is_empty() {
                    self.minor += 1;
                }
                self.patch = 0;
                self.prerelease.clear();
            }
            Increment::Patch => {
                if self.prerelease.is_empty() {
                    self.patch += 1;
                }
                self.prerelease.clear();
            }
        }
    }

    fn increment_prerelease(&mut self, preid: &[Identifier]) {
        let last_number = self.prerelease.iter_mut().rev().find_map(|id| match id {
            Identifier::Numeric(n) => Some(n),
            Identifier::Alphanumeric(_) => None,
        });
        match last_number {
            Some(n) => *n += 1,
            None => self.prerelease.push(Identifier::Numeric(0)),
        }

        if preid.is_empty() {
            return;
        }
        // `--preid rc` on `1.0.0-beta.3` starts over at `rc.0`; so does `--preid beta`
        // on `1.0.0-beta.foo`, where no counter follows the identifier.
        let continues_preid = self.prerelease.len() > preid.len()
            && self.prerelease[..preid.len()] == *preid
            && matches!(self.prerelease[preid.len()], Identifier::Numeric(_));
        if !continues_preid {
            self.prerelease.clear();
            self.prerelease.extend_from_slice(preid);
            self.prerelease.push(Identifier::Numeric(0));
        }
    }

    fn to_bytes(&self) -> Vec<u8> {
        let mut out = fmt_bytes(format_args!("{}.{}.{}", self.major, self.minor, self.patch));
        for (i, identifier) in self.prerelease.iter().enumerate() {
            out.push(if i == 0 { b'-' } else { b'.' });
            match identifier {
                Identifier::Numeric(n) => {
                    out.write_fmt(format_args!("{}", n)).expect("unreachable")
                }
                Identifier::Alphanumeric(bytes) => out.extend_from_slice(bytes),
            }
        }
        out
    }
}

impl PmVersionCommand {
    pub(crate) fn exec(
        ctx: command::Context<'_>,
        pm: &mut PackageManager,
        positionals: &[&[u8]],
        original_cwd: &[u8],
    ) -> Result<(), crate::Error> {
        let package_json_dir = Self::find_package_dir(original_cwd)?;

        if positionals.len() <= 1 {
            Self::show_help(ctx, pm, &package_json_dir);
            return Ok(());
        }

        let argument = Self::parse_version_argument(positionals[1]);

        Self::verify_git(&package_json_dir, pm)?;

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
        // `defer ctx.allocator.free(package_json_contents)` — handled by Drop.

        let package_json_source = bun_ast::Source::init_path_string(
            package_json_path.as_bytes(),
            &*package_json_contents,
        );
        // Hand the parser a local bump arena for its scratch allocations.
        let json_bump = Arena::new();
        let json_result = match JSON::parse_package_json_utf8_with_opts(
            JSON::JSONOptions {
                json_warn_duplicate_keys: false,
                guess_indentation: true,
                ..JSON::PACKAGE_JSON_OPTS
            },
            &package_json_source,
            // SAFETY: single-threaded CLI dispatch; the returned `&mut Log` is
            // passed straight into this parse call and no other borrow of the
            // process-static `Log` (via `ctx` or `pm`) is live for its duration.
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
            current_version,
            argument,
            pm.options.preid,
            &package_json_dir,
        )?;

        if let Some(version) = current_version {
            let current_clean = PackageVersion::parse(version).map(|v| v.to_bytes());
            if !pm.options.allow_same_version
                && current_clean.as_deref().unwrap_or(version) == new_version_str.as_slice()
            {
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
                json,
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
        let mut path_buf = bun_paths::path_buffer_pool::get();
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

        let mut path_buf = bun_paths::path_buffer_pool::get();
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

    fn parse_version_argument(arg: &[u8]) -> VersionArgument {
        if let Some(increment) = Increment::from_string(arg) {
            return VersionArgument::Increment(increment);
        }
        if arg == b"from-git" {
            return VersionArgument::FromGit;
        }
        if let Some(version) = PackageVersion::parse(arg) {
            return VersionArgument::Specific(version);
        }

        Output::err_generic("Invalid version argument: \"{}\"", (BStr::new(arg),));
        bun_core::note!(
            "Valid options: patch, minor, major, prepatch, preminor, premajor, prerelease, from-git, or a specific semver version"
        );
        Global::exit(1);
    }

    fn parse_current_version(current: &[u8]) -> PackageVersion {
        let Some(version) = PackageVersion::parse(current) else {
            Output::err_generic(
                "Current version \"{}\" is not a valid semver",
                (BStr::new(current),),
            );
            Global::exit(1);
        };
        version
    }

    fn parse_preid(preid: &[u8]) -> Vec<Identifier> {
        if preid.is_empty() {
            return Vec::new();
        }
        let Some(identifiers) = Identifier::parse_dot_separated(preid) else {
            Output::err_generic("Invalid prerelease identifier: \"{}\"", (BStr::new(preid),));
            bun_core::note!(
                "--preid takes dot-separated identifiers of letters, digits and hyphens, for example \"beta\""
            );
            Global::exit(1);
        };
        identifiers
    }

    fn bump(current: &PackageVersion, by: Increment, preid: &[Identifier]) -> Vec<u8> {
        let mut version = current.clone();
        version.increment(by, preid);
        version.to_bytes()
    }

    fn get_current_version(ctx: &command::ContextData, cwd: &[u8]) -> Option<Vec<u8>> {
        // Returns an owned Vec<u8> (no borrow of the package.json bytes).
        let mut path_buf = bun_paths::path_buffer_pool::get();
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
            // SAFETY: single-threaded CLI dispatch; the returned `&mut Log` is
            // passed straight into this parse call and no other borrow of the
            // process-static `Log` is live for its duration.
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

        let current = Self::parse_current_version(current_version);
        let preid = Self::parse_preid(pm.options.preid);

        let patch_version = Self::bump(&current, Increment::Patch, &preid);
        let minor_version = Self::bump(&current, Increment::Minor, &preid);
        let major_version = Self::bump(&current, Increment::Major, &preid);
        let prerelease_version = Self::bump(&current, Increment::Prerelease, &preid);

        bun_core::pretty!(
            "\n<b>Increment<r>:\n  <cyan>patch<r>      <d>{0} → {1}<r>\n  <cyan>minor<r>      <d>{0} → {2}<r>\n  <cyan>major<r>      <d>{0} → {3}<r>\n  <cyan>prerelease<r> <d>{0} → {4}<r>\n",
            BStr::new(current_version),
            BStr::new(&patch_version),
            BStr::new(&minor_version),
            BStr::new(&major_version),
            BStr::new(&prerelease_version),
        );

        if !current.prerelease.is_empty() || !preid.is_empty() {
            let prepatch_version = Self::bump(&current, Increment::Prepatch, &preid);
            let preminor_version = Self::bump(&current, Increment::Preminor, &preid);
            let premajor_version = Self::bump(&current, Increment::Premajor, &preid);

            bun_core::pretty!(
                "  <cyan>prepatch<r>   <d>{0} → {1}<r>\n  <cyan>preminor<r>   <d>{0} → {2}<r>\n  <cyan>premajor<r>   <d>{0} → {3}<r>\n",
                BStr::new(current_version),
                BStr::new(&prepatch_version),
                BStr::new(&preminor_version),
                BStr::new(&premajor_version),
            );
        }

        let beta_prerelease_version = Self::bump(
            &current,
            Increment::Prerelease,
            &[Identifier::Alphanumeric(Box::from(&b"beta"[..]))],
        );

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
        current: Option<&[u8]>,
        argument: VersionArgument,
        preid: &[u8],
        cwd: &[u8],
    ) -> Result<Vec<u8>, AllocError> {
        match argument {
            VersionArgument::Specific(version) => Ok(version.to_bytes()),
            VersionArgument::FromGit => Self::get_version_from_git(cwd),
            VersionArgument::Increment(by) => {
                // npm counts a missing or empty "version" as 0.0.0.
                let current = Self::parse_current_version(
                    current.filter(|v| !v.is_empty()).unwrap_or(b"0.0.0"),
                );
                let preid = if by.is_prerelease() {
                    Self::parse_preid(preid)
                } else {
                    Vec::new()
                };
                Ok(Self::bump(&current, by, &preid))
            }
        }
    }

    fn is_git_clean(cwd: &[u8]) -> Result<bool, AllocError> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
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
        let mut path_buf = bun_paths::path_buffer_pool::get();
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
        let mut path_buf = bun_paths::path_buffer_pool::get();
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
            strings::replace_owned(msg, b"%s", version)
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

// Builds formatted output into a `Vec<u8>` (never `format!`).
#[inline]
fn fmt_bytes(args: core::fmt::Arguments<'_>) -> Vec<u8> {
    let mut v = Vec::new();
    v.write_fmt(args).expect("unreachable");
    v
}

// Note: build `sync::Options.argv: Vec<Box<[u8]>>` from a slice of byte
// slices.
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
