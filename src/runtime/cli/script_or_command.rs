//! `bun check`, `bun lint` and `bun fmt` ran the script of that name in `package.json` before they
//! were commands, so where a project has such a script they still do. In that script, and in what it
//! runs, they are the commands: `"lint": "bun lint"`. So it is with a file `lint.ts` and with
//! `node_modules/.bin/lint`. With `--no-script` they are the commands whatever the project has.
//! A `package.json` that names the script and can't be parsed stops `bun lint` and `bun fmt`, which can write files.

use bun_core::{Global, UnwrapOrOom, env_var};

use super::check_command::working_directory;

/// The kind of thing `bun <command>` runs.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Runs {
    Command,
    /// A script in the nearest `package.json`, which is where `bun run` looks.
    Script,
    /// A file, an executable that a package installs, or scripts in other packages.
    Other,
}

/// The parser's errors for a `package.json` that may have the script.
pub(crate) struct Unparsable(String);

impl Unparsable {
    fn stop(&self, command: &[u8]) -> ! {
        bun_core::pretty_error!("{}", self.0);
        bun_core::note!(
            "package.json may have a \"{}\" script, so nothing was run\n  Fix the file, or pass <b>--no-script<r> to skip the script",
            bstr::BStr::new(command),
        );
        Global::exit(2);
    }
}

/// What the flag of `bun` takes that `is_it` says yes to. `None`: there is no such flag.
fn values_of(is_it: &dyn Fn(&bun_clap::Names) -> bool) -> Option<&'static bun_clap::Values> {
    let mut flags = super::arguments::AUTO_PARAMS.iter();
    flags.find(|it| is_it(&it.names)).map(|it| &it.takes_value)
}

/// Where the first of `shorts`, the letters of a chain like `-be`, is that takes a value: the rest of the chain, as in
/// `-Fpattern`, or else the next argument. `None` also where the value is optional, which is never the next argument. What
/// follows that letter in `-bc=bunfig.toml` is a value too, not more letters.
fn place_of_short_with_value(shorts: &[u8]) -> Option<usize> {
    use bun_clap::Values;
    for (at, short) in shorts.iter().enumerate() {
        match values_of(&|names| names.short == Some(*short)) {
            Some(Values::One | Values::Many) => return Some(at),
            Some(Values::OneOptional) => return None,
            Some(Values::None) => {}
            // It isn't a chain of flags of `bun`: `-f=agent` is for `bun lint`.
            None => return None,
        }
    }
    None
}

/// Whether `flag` is one of `bun`'s that has its value in the argument after it.
fn has_value_in_next_argument(flag: &[u8]) -> bool {
    match flag {
        [b'-', b'-', long @ ..] => matches!(
            values_of(&|names| names.matches_long(long)),
            Some(bun_clap::Values::One | bun_clap::Values::Many)
        ),
        [b'-', shorts @ ..] => {
            place_of_short_with_value(shorts).is_some_and(|at| at + 1 == shorts.len())
        }
        _ => false,
    }
}

/// The letter of `flag` that takes a value, if `flag` is a chain of letters: `e` for `-e` and `-be`, `F` for `-bFpattern`.
fn short_with_value(flag: &[u8]) -> Option<u8> {
    match flag {
        [b'-', b'-', ..] => None,
        [b'-', shorts @ ..] => place_of_short_with_value(shorts).map(|at| shorts[at]),
        _ => None,
    }
}

/// Whether `flag` is `--eval` or `--print`.
fn evaluates(flag: &[u8]) -> bool {
    let name = bun_core::strings::split_once_char(flag, b'=').map_or(flag, |it| it.0);
    matches!(name, b"--eval" | b"--print") || matches!(short_with_value(flag), Some(b'e' | b'p'))
}

/// Whether `bun <command> <flag>` is a valid command line.
fn has_flag(command: &[u8], flag: &[u8]) -> bool {
    match command {
        b"lint" => super::lint_command::LintCommand::has_flag(flag),
        b"fmt" => super::format_command::FormatCommand::has_flag(flag),
        // `--project`, which for `bun` is `--print`.
        b"check" => short_with_value(flag) == Some(b'p'),
        _ => false,
    }
}

/// Where the first of `args` is that is neither a flag of `bun` nor the value of one: the command, or what to run.
/// There is none with `--eval` and `--print`.
fn place_of_first_word(args: &[&[u8]]) -> Option<usize> {
    let mut at = 1;
    while let Some(arg) = args.get(at).copied() {
        if !arg.starts_with(b"-") || arg == b"-" {
            return Some(at);
        }
        if arg == b"--" {
            return Some(at + 1).filter(|next| *next < args.len());
        }
        // `bun -l fmt`, `bun -ptsconfig.json check`: the flags of these commands count before them too.
        let is_of_next = args.get(at + 1).is_some_and(|next| has_flag(next, arg));
        if evaluates(arg) && !is_of_next {
            return None;
        }
        at += if has_value_in_next_argument(arg) && !is_of_next && at + 1 < args.len() {
            2
        } else {
            1
        };
    }
    None
}

/// Where `command` is among the arguments of this process, if it is what `bun` is asked for.
pub(crate) fn place_of_command(command: &[u8]) -> Option<usize> {
    let args: Vec<&[u8]> = bun_core::argv().into_iter().collect();
    place_of_first_word(&args).filter(|at| args.get(*at) == Some(&command))
}

/// The arguments of this process before `command`: the flags of `bun` and their values, one of which can read like `command`.
pub(crate) fn arguments_before(command: &[u8]) -> Vec<&'static [u8]> {
    let mut args: Vec<&'static [u8]> = bun_core::argv().into_iter().collect();
    args.truncate(place_of_command(command).unwrap_or(args.len()));
    args
}

/// `bun --cwd <dir> lint`: the command, which comes after the flags of `bun` and their values.
#[cold]
#[inline(never)]
pub(crate) fn command_after_flags() -> Option<&'static [u8]> {
    let args: Vec<&'static [u8]> = bun_core::argv().into_iter().collect();
    let is_command = |arg: &&[u8]| matches!(*arg, b"check" | b"lint" | b"fmt");
    if !args.iter().any(is_command) {
        return None;
    }
    let word = args.get(place_of_first_word(&args)?)?;
    is_command(word).then_some(*word)
}

/// Whether `arg` asks `bun <command>` about itself, so it isn't passed to the project's own `command`.
///
/// Only flags that the tools behind such scripts don't have. `-v`, `--version`, `--init`, `--rules` and `--print-config` mean
/// something to ESLint, oxlint, Prettier and others, and `bun lint -v` must not turn a failing script into exit code 0.
/// `--doctor` and `--explain` are here because the migration guides send people to them who still have `"lint": "eslint ."`.
/// `--no-script` is for tools that run these commands in projects they know nothing about.
fn asks_the_command(command: &[u8], arg: &[u8]) -> bool {
    let name = bun_core::strings::split_once_char(arg, b'=').map_or(arg, |it| it.0);
    match name {
        b"--help" | b"-h" | b"--no-script" => true,
        b"--help-all" | b"--doctor" => command != b"check",
        b"--explain" => command == b"lint",
        _ => false,
    }
}

/// Whether `bun <command>` runs something from the project, as it did before `command` became a built-in command.
#[cold]
#[inline(never)]
pub(crate) fn is_of_the_project(command: &[u8]) -> bool {
    let args: Vec<&[u8]> = bun_core::argv().into_iter().collect();
    // `bun --cwd lint dev`: `lint` is a directory.
    let Some(at) = place_of_command(command) else {
        return true;
    };
    let (before, of_command) = args.split_at(at);
    // `bun --no-script lint`: the flags of these commands count before them too.
    if before.iter().any(|arg| *arg == b"--no-script") {
        return false;
    }
    let mut of_command = of_command.iter().take_while(|arg| **arg != b"--");
    if of_command.any(|arg| asks_the_command(command, arg)) {
        return false;
    }
    let is_before = |flags: &[&[u8]]| before.iter().any(|arg| flags.contains(arg));
    match runs(command) {
        Ok(runs) => runs != Runs::Command,
        // Neither needs the project: the help of the command, the version of `bun`.
        Err(_) if is_before(&[b"--help", b"-h"]) => false,
        Err(_) if is_before(&[b"--version", b"-v", b"--revision"]) => true,
        Err(unparsable) => unparsable.stop(command),
    }
}

/// The directory that `--cwd <given>` names, as `bun run` takes it: `..` is folded before links are followed, and an empty
/// value is the working directory. Unlike there, a `\` is part of a name on POSIX where there is such a name.
pub(crate) fn directory_of_cwd(given: &[u8]) -> Vec<u8> {
    use bun_paths::platform::Loose;
    use bun_paths::resolve_path::{join_abs_string_spill, normalize_string_generic_t};
    // An absolute one needs no working directory, which may be deleted.
    let base = match bun_paths::is_absolute(given) {
        true => b"/".to_vec(),
        false => working_directory(),
    };
    if cfg!(windows) {
        return join_abs_string_spill::<Loose>(&base, &mut Vec::new(), &[given]).to_vec();
    }
    // On POSIX, that function takes every `\` for a separator, also one in the name of the working directory.
    let fold = |given: &[u8]| {
        let path = [&base[..], b"/", given].concat();
        let mut folded = vec![b'/'; path.len() + 1];
        let rest = &mut folded[1..];
        let is_separator = |byte| byte == b'/';
        let len =
            normalize_string_generic_t::<u8, false, false>(&path, rest, b'/', is_separator).len();
        folded.truncate(1 + len);
        folded
    };
    let as_written = fold(given);
    let exists = |path: &[u8]| {
        bun_sys::exists_at_type(bun_core::Fd::cwd(), &bun_core::ZBox::from_bytes(path)).is_ok()
    };
    if !bun_core::strings::contains_char(given, b'\\') || exists(&as_written) {
        return as_written;
    }
    // `--cwd apps\web`, from a script that was written on Windows. `bun run` takes it on every platform.
    let with_slashes: Vec<u8> = (given.iter())
        .map(|byte| if *byte == b'\\' { b'/' } else { *byte })
        .collect();
    fold(&with_slashes)
}

/// Decides what `bun <command>` runs, without looking at `command`'s own arguments.
pub(crate) fn runs(command: &[u8]) -> Result<Runs, Unparsable> {
    let args: Vec<&[u8]> = bun_core::argv().into_iter().collect();
    // What follows the name of a script is for the script.
    let before = place_of_first_word(&args).map_or(&args[..], |at| &args[..at]);
    let mut before = before.iter().copied();
    let mut given = None;
    while let Some(arg) = before.next() {
        // These are about scripts: those of several packages, whatever this one has, or none.
        if matches!(
            arg,
            b"--workspaces" | b"--parallel" | b"--sequential" | b"--if-present"
        ) || arg.starts_with(b"--filter")
            || short_with_value(arg) == Some(b'F')
        {
            return Ok(Runs::Other);
        }
        let value = match arg.strip_prefix(b"--cwd") {
            Some(b"") => before.next(),
            Some(rest) => rest.strip_prefix(b"="),
            None => None,
        };
        given = value.or(given);
    }
    let cwd = match given {
        Some(given) => {
            let mut buffer = bun_paths::path_buffer_pool::get();
            let given = bun_core::ZBox::from_vec(directory_of_cwd(given));
            // The command says that it can't go there.
            let Ok(real) = bun_sys::realpath(&given, &mut buffer) else {
                return Ok(Runs::Command);
            };
            real.to_vec()
        }
        None => working_directory(),
    };
    let nearest = nearest_package_json(&cwd);
    let dir = (nearest.as_ref()).map_or_else(
        || bun_core::strings::without_trailing_slash(&cwd),
        |it| it.0,
    );
    // In that script, and in what it runs, it is the command: `"lint": "bun lint"`.
    let running = env_var::BUN_INTERNAL_SCRIPTS_OF_COMMANDS::get();
    if running
        .is_some_and(|running| running_package_scripts(running).any(|it| it == (command, dir)))
    {
        return Ok(Runs::Command);
    }
    let by_an_older_bun =
        env_var::BUN_INTERNAL_CHECK_SCRIPTS::get().filter(|_| command == b"check");
    if by_an_older_bun.is_some_and(|running| running_check_scripts(running).any(|it| it == dir)) {
        return Ok(Runs::Command);
    }
    if package_of_inherited_script(command).is_some_and(|it| it == dir) {
        return Ok(Runs::Command);
    }
    let other_if = |found: bool| if found { Runs::Other } else { Runs::Command };
    let Some((dir, path, contents)) = &nearest else {
        return Ok(other_if(is_file_or_executable(command, &cwd)));
    };
    if has_script(command, path, contents)? {
        return Ok(Runs::Script);
    }
    Ok(other_if(
        is_file_or_executable(command, &cwd)
            || is_executable_beside_package_json(command, dir, &cwd),
    ))
}

/// `bun run` puts the directory of the `package.json` in `PATH`, in front of every `node_modules/.bin`.
fn is_executable_beside_package_json(name: &[u8], dir: &[u8], cwd: &[u8]) -> bool {
    let mut buffer = bun_paths::path_buffer_pool::get();
    // On macOS a directory that can be searched is executable for `which`.
    name != b"check"
        && bun_which::which(&mut buffer, dir, cwd, name).is_some_and(|found| {
            bun_sys::exists_at_type(bun_core::Fd::cwd(), found).ok()
                == Some(bun_sys::ExistsAtType::File)
        })
}

/// Whether the `package.json` at `path`, which has `contents`, has the script `name`.
fn has_script(name: &[u8], path: &[u8], contents: &[u8]) -> Result<bool, Unparsable> {
    // Most have no such string in them, and no escape that could spell it.
    let quoted = |quote: &[u8]| [quote, name, quote].concat();
    let spellings: [&[u8]; 4] = [&quoted(b"\""), &quoted(b"'"), b"\\u", b"\\x"];
    if !(spellings.iter()).any(|it| bun_core::strings::contains(contents, it)) {
        return Ok(false);
    }
    bun_ast::initialize_store();
    let source = bun_ast::Source::init_path_string(path, contents);
    let (mut log, bump) = (bun_ast::Log::init(), bun_alloc::Arena::new());
    match bun_parsers::json::parse_package_json_utf8(&source, &mut log, &bump) {
        Ok(json) => Ok((json.as_property(b"scripts"))
            .and_then(|scripts| scripts.expr.as_property(name))
            .is_some_and(|script| matches!(script.expr.data, bun_ast::ExprData::EString(_)))),
        // `bun check` writes nothing.
        Err(_) if name == b"check" => Ok(false),
        Err(_) => {
            let mut said = String::new();
            let _ = log.print(&mut said);
            Err(Unparsable(said))
        }
    }
}

/// The path of `name` below `dir`, which is absolute.
fn below(dir: &[u8], name: &[u8]) -> Vec<u8> {
    use bun_paths::{platform::Auto, resolve_path::join_abs_string_spill};
    // On POSIX, that function takes a `\` in a name for a separator.
    if cfg!(windows) {
        return join_abs_string_spill::<Auto>(dir, &mut Vec::new(), &[name]).to_vec();
    }
    let separator: &[u8] = if dir.ends_with(b"/") { b"" } else { b"/" };
    [dir, separator, name].concat()
}

/// Whether `bun <name>` in `cwd` finds a file to run, `name`, `name.ts` or `name/index.ts`, or an executable that a package has
/// installed, here or further up. Not for `check`, which has been a command for longer.
fn is_file_or_executable(name: &[u8], cwd: &[u8]) -> bool {
    use bun_sys::ExistsAtType;
    if name == b"check" {
        return false;
    }
    let kind = |dir: &[u8], parts: &[&[u8]]| {
        let path = bun_core::ZBox::from_vec(below(dir, &parts.concat()));
        bun_sys::exists_at_type(bun_core::Fd::cwd(), &path).ok()
    };
    // Those of the resolver that can be run: `bun lint -o lint.json` must not take the name away.
    let extensions: [&[u8]; 8] = [
        b".tsx", b".ts", b".jsx", b".cts", b".cjs", b".js", b".mjs", b".mts",
    ];
    let is_file = |parts: &[&[u8]]| kind(cwd, parts) == Some(ExistsAtType::File);
    let found = match kind(cwd, &[name]) {
        Some(ExistsAtType::File) => true,
        Some(ExistsAtType::Directory) => {
            is_file(&[name, b"/package.json"])
                || extensions.iter().any(|it| is_file(&[name, b"/index", it]))
        }
        None => false,
    };
    if found || extensions.iter().any(|it| is_file(&[name, it])) {
        return true;
    }
    let suffixes: &[&[u8]] = match cfg!(windows) {
        true => &[b".bunx", b".exe", b".cmd"],
        false => &[b""],
    };
    let mut dir = cwd;
    loop {
        if (suffixes.iter()).any(|it| kind(dir, &[b"node_modules/.bin/", name, it]).is_some()) {
            return true;
        }
        let Some(parent) = bun_paths::dirname(dir) else {
            return false;
        };
        dir = parent;
    }
}

/// The text of the `package.json` at `path`. A link in a repository can lead to `/dev/zero`: `bun run` stops at such a file, and
/// finds no script in it.
fn read_package_json(path: &[u8]) -> Option<Vec<u8>> {
    use bun_sys::{EntryKind, O};
    // Otherwise opening a named pipe waits for somebody to open it for writing, who may never come.
    let without_waiting = if cfg!(unix) { O::NONBLOCK } else { 0 };
    let flags = O::RDONLY | without_waiting;
    let file = bun_sys::File::openat(bun_core::Fd::cwd(), path, flags, 0).ok()?;
    let found = file.stat().ok()?;
    match bun_sys::kind_from_mode(found.st_mode as _) {
        EntryKind::File if (found.st_size as u64) < 1 << 29 => {
            let text = file.read_to_end().ok()?;
            // As `bun run` reads it. PowerShell's `>` writes UTF-16.
            Some(match bun_core::strings::BOM::detect(&text) {
                Some(bom) => bom.remove_and_convert_to_utf8_and_free(text),
                None => text,
            })
        }
        EntryKind::Directory => None,
        _ => Some(Vec::new()),
    }
}

/// The `package.json` nearest to `dir`, which is where `bun run` looks: its directory, its path and
/// its text.
fn nearest_package_json(mut dir: &[u8]) -> Option<(&[u8], Vec<u8>, Vec<u8>)> {
    loop {
        let path = below(dir, b"package.json");
        if let Some(contents) = read_package_json(&path) {
            let dir = bun_core::strings::without_trailing_slash(dir);
            return Some((dir, path, contents));
        }
        dir = bun_paths::dirname(dir)?;
    }
}

/// The entries of `BUN_INTERNAL_SCRIPTS_OF_COMMANDS`: a command and the directory of a package. Each is
/// the command, `:`, a length, `:` and as many bytes, since a path can have any byte in it.
fn running_package_scripts(mut running: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    core::iter::from_fn(move || {
        let colon = bun_core::strings::index_of_char_usize(running, b':')?;
        let (command, rest) = (&running[..colon], &running[colon + 1..]);
        let colon = bun_core::strings::index_of_char_usize(rest, b':')?;
        let len: usize = core::str::from_utf8(&rest[..colon]).ok()?.parse().ok()?;
        let (dir, rest) = rest[colon + 1..].split_at_checked(len)?;
        running = rest;
        Some((command, dir))
    })
}

/// The entries of `BUN_INTERNAL_CHECK_SCRIPTS`: the directories of packages. Each is a length, `:` and as many bytes.
fn running_check_scripts(mut running: &[u8]) -> impl Iterator<Item = &[u8]> {
    core::iter::from_fn(move || {
        let colon = bun_core::strings::index_of_char_usize(running, b':')?;
        let len: usize = core::str::from_utf8(&running[..colon]).ok()?.parse().ok()?;
        let (dir, rest) = running[colon + 1..].split_at_checked(len)?;
        running = rest;
        Some(dir)
    })
}

/// The command whose script `name` is, or runs with: `bun run lint` runs `prelint`, `lint` and
/// `postlint`.
fn command_of_script(name: &[u8]) -> Option<&'static [u8]> {
    match name {
        b"check" | b"precheck" | b"postcheck" => Some(b"check"),
        b"lint" | b"prelint" | b"postlint" => Some(b"lint"),
        b"fmt" | b"prefmt" | b"postfmt" => Some(b"fmt"),
        _ => None,
    }
}

/// The directory of the package whose `command` script another package manager has started, with
/// this process in it. npm, pnpm and yarn say which script they run. Not all say of which package:
/// then it is the one that this process is started in, not each one whose scripts it runs.
fn package_of_inherited_script(command: &[u8]) -> Option<Vec<u8>> {
    use bun_paths::{platform::Auto, resolve_path::dirname};
    if env_var::npm_lifecycle_event::get().and_then(command_of_script) != Some(command) {
        return None;
    }
    match env_var::npm_package_json::get() {
        Some(of) => Some(bun_core::strings::without_trailing_slash(dirname::<Auto>(of)).to_vec()),
        None if env_var::BUN_INTERNAL_SCRIPTS_OF_COMMANDS::get().is_some() => None,
        None if env_var::BUN_INTERNAL_CHECK_SCRIPTS::get().is_some() => None,
        None => Some(nearest_package_json(&working_directory())?.0.to_vec()),
    }
}

/// Makes `env` that of the script `name` of the package that has `dir`. See `is_of_the_project`.
pub(crate) fn note_package_script(env: &mut bun_dotenv::Loader, name: &[u8], dir: &[u8]) {
    use std::io::Write;
    let key = b"BUN_INTERNAL_SCRIPTS_OF_COMMANDS";
    // As `runs` finds it, wherever in the package the script is started.
    let dir = nearest_package_json(dir)
        .map_or_else(|| bun_core::strings::without_trailing_slash(dir), |it| it.0);
    let mut running = env.get(key).unwrap_or_default().to_vec();
    let mut note = |command: &[u8], dir: &[u8]| {
        if !running_package_scripts(&running).any(|it| it == (command, dir)) {
            running.extend_from_slice(command);
            let _ = write!(running, ":{}:", dir.len());
            running.extend_from_slice(dir);
        }
    };
    // `name` takes the place of what another package manager has said, for what the script runs.
    for command in [&b"check"[..], b"lint", b"fmt"] {
        if let Some(inherited) = package_of_inherited_script(command) {
            note(command, &inherited);
        }
    }
    if let Some(command) = command_of_script(name) {
        note(command, dir);
    }
    if !running.is_empty() {
        env.map.put(key, &running).unwrap_or_oom();
    }
}

/// `note_package_script` for the file or the executable `name` that `bun <name>` or `bun run <name>` starts in `cwd`.
pub(crate) fn note_file_or_executable(env: &mut bun_dotenv::Loader, name: &[u8], cwd: &[u8]) {
    if matches!(name, b"check" | b"lint" | b"fmt") {
        note_package_script(env, name, cwd);
    }
}

/// `note_package_script` for as long as `with` takes: `env` is that of other scripts too.
pub(crate) fn with_package_script<R>(
    env: &mut bun_dotenv::Loader,
    name: &[u8],
    dir: &[u8],
    with: impl FnOnce(&mut bun_dotenv::Loader) -> R,
) -> R {
    let key = b"BUN_INTERNAL_SCRIPTS_OF_COMMANDS";
    let before = env.get(key).map(<[u8]>::to_vec);
    note_package_script(env, name, dir);
    let result = with(env);
    match before {
        Some(before) => env.map.put(key, &before).unwrap_or_oom(),
        None => env.map.remove(key),
    }
    result
}
