//! `bun check`, `bun lint` and `bun format` ran the script of that name in `package.json` before they
//! were commands, so where a project has such a script they still do. In that script, and in what it
//! runs, they are the commands: `"lint": "bun lint"`. So it is with a file `lint.ts` and with
//! `node_modules/.bin/lint`.

use bun_core::{UnwrapOrOom, env_var};

use super::check_command::working_directory;

/// Whether `bun <command>` runs something of the project, as it did before `command` was one: a script
/// of the nearest `package.json`, which is where `bun run` looks, a file, or what a package installs.
#[cold]
#[inline(never)]
pub(crate) fn is_of_the_project(command: &[u8]) -> bool {
    use bun_paths::platform::Auto;
    use bun_paths::resolve_path::join_abs_string;
    let mut cwd = working_directory();
    let mut args = bun_core::argv().into_iter();
    while let Some(arg) = args.next() {
        // What follows the name of a script is for the script.
        if arg == command {
            break;
        }
        // These are about scripts: those of several packages, whatever this one has, or none.
        if matches!(
            arg,
            b"--workspaces" | b"--parallel" | b"--sequential" | b"--if-present"
        ) || arg.starts_with(b"--filter")
            || arg.starts_with(b"-F")
        {
            return true;
        }
        let given = match arg.strip_prefix(b"--cwd") {
            Some(b"") => args.next(),
            Some(rest) => rest.strip_prefix(b"="),
            None => None,
        };
        if let Some(given) = given {
            cwd = join_abs_string::<Auto>(&cwd, &[given]).to_vec();
        }
    }
    let Some((dir, path, contents)) = nearest_package_json(&cwd) else {
        return is_file_or_executable(command, &cwd);
    };
    // In that script, and in what it runs, it is the command: `"lint": "bun lint"`.
    let running = env_var::BUN_INTERNAL_SCRIPTS_OF_COMMANDS::get();
    if running
        .is_some_and(|running| running_package_scripts(running).any(|it| it == (command, dir)))
    {
        return false;
    }
    let by_an_older_bun =
        env_var::BUN_INTERNAL_CHECK_SCRIPTS::get().filter(|_| command == b"check");
    if by_an_older_bun.is_some_and(|running| running_check_scripts(running).any(|it| it == dir)) {
        return false;
    }
    if package_of_inherited_script(command).is_some_and(|it| it == dir) {
        return false;
    }
    has_script(command, &path, &contents) || is_file_or_executable(command, &cwd)
}

/// Whether the `package.json` at `path`, which has `contents`, has the script `name`.
fn has_script(name: &[u8], path: &[u8], contents: &[u8]) -> bool {
    // Most have no such word in them.
    if !bun_core::strings::contains(contents, &[&b"\""[..], name, b"\""].concat()) {
        return false;
    }
    bun_ast::initialize_store();
    let source = bun_ast::Source::init_path_string(path, contents);
    let (mut log, bump) = (bun_ast::Log::init(), bun_alloc::Arena::new());
    let Ok(json) = bun_parsers::json::parse_package_json_utf8(&source, &mut log, &bump) else {
        return false;
    };
    (json.as_property(b"scripts"))
        .and_then(|scripts| scripts.expr.as_property(name))
        .is_some_and(|script| matches!(script.expr.data, bun_ast::ExprData::EString(_)))
}

/// Whether `bun <name>` in `cwd` finds a file to run, `name`, `name.ts` or `name/index.ts`, or an executable that a package has
/// installed, here or further up. Not for `check`, which has been a command for longer.
fn is_file_or_executable(name: &[u8], cwd: &[u8]) -> bool {
    use bun_paths::platform::Auto;
    use bun_paths::resolve_path::{dirname, join_abs_string};
    use bun_sys::ExistsAtType;
    if name == b"check" {
        return false;
    }
    let kind = |dir: &[u8], parts: &[&[u8]]| {
        let path = bun_core::ZBox::from_bytes(join_abs_string::<Auto>(dir, &[&parts.concat()]));
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
        let parent = dirname::<Auto>(dir);
        if parent.is_empty() || parent.len() >= dir.len() {
            return false;
        }
        dir = parent;
    }
}

/// The `package.json` nearest to `dir`, which is where `bun run` looks: its directory, its path and
/// its text.
fn nearest_package_json(mut dir: &[u8]) -> Option<(&[u8], Vec<u8>, Vec<u8>)> {
    use bun_paths::platform::Auto;
    use bun_paths::resolve_path::{dirname, join_abs_string};
    loop {
        let path = join_abs_string::<Auto>(dir, &[b"package.json"]).to_vec();
        if let Ok(contents) = bun_sys::File::read_from(bun_core::Fd::cwd(), &path) {
            let dir = bun_core::strings::without_trailing_slash(dir);
            return Some((dir, path, contents));
        }
        let parent = dirname::<Auto>(dir);
        if parent.is_empty() || parent.len() >= dir.len() {
            return None;
        }
        dir = parent;
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
        b"format" | b"preformat" | b"postformat" => Some(b"format"),
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
    // As `is_of_the_project` finds it, wherever in the package the script is started.
    let Some((dir, ..)) = nearest_package_json(dir) else {
        return;
    };
    let mut running = env.get(key).unwrap_or_default().to_vec();
    let mut note = |command: &[u8], dir: &[u8]| {
        if !running_package_scripts(&running).any(|it| it == (command, dir)) {
            running.extend_from_slice(command);
            let _ = write!(running, ":{}:", dir.len());
            running.extend_from_slice(dir);
        }
    };
    // `name` takes the place of what another package manager has said, for what the script runs.
    for command in [&b"check"[..], b"lint", b"format"] {
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
