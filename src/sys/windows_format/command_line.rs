//! Program lookup and command lines for `CreateProcessW`. Strings are not NUL-terminated.

use bun_core::strings::has_prefix_case_insensitive_t;
use bun_core::w;
use bun_paths::portable::is_sep;

const BACKSLASH: u16 = b'\\' as u16;
const COLON: u16 = b':' as u16;
const DOT: u16 = b'.' as u16;
const QUOTE: u16 = b'"' as u16;
const SPACE: u16 = b' ' as u16;

fn is_one_of(unit: u16, set: &[u8]) -> bool {
    set.iter().any(|&byte| u16::from(byte) == unit)
}

fn contains_any(text: &[u16], set: &[u8]) -> bool {
    text.iter().any(|&unit| is_one_of(unit, set))
}

fn eq_ignore_ascii_case(a: &[u16], b: &[u16]) -> bool {
    let to_lower =
        |&unit: &u16| u8::try_from(unit).map_or(unit, |byte| byte.to_ascii_lowercase().into());
    a.iter().map(to_lower).eq(b.iter().map(to_lower))
}

/// An argument that cannot be represented on the command line.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct InvalidArgument;

/// Quotes `argument` for the C runtime's command line parser.
pub fn push_argument(out: &mut Vec<u16>, argument: &[u16]) {
    if !argument.is_empty() && !contains_any(argument, b" \t\"") {
        return out.extend_from_slice(argument);
    }
    out.push(QUOTE);
    let mut backslash_count = 0;
    for &unit in argument {
        if unit == QUOTE {
            out.extend(core::iter::repeat_n(BACKSLASH, backslash_count + 1));
        }
        backslash_count = if unit == BACKSLASH {
            backslash_count + 1
        } else {
            0
        };
        out.push(unit);
    }
    out.extend(core::iter::repeat_n(BACKSLASH, backslash_count));
    out.push(QUOTE);
}

pub(crate) fn join_verbatim(arguments: &[Vec<u16>]) -> Vec<u16> {
    arguments.join(&SPACE)
}

pub(crate) fn join(arguments: &[Vec<u16>]) -> Result<Vec<u16>, InvalidArgument> {
    let mut out = Vec::with_capacity(arguments.iter().map(|argument| argument.len() + 3).sum());
    let Some((program, rest)) = arguments.split_first() else {
        return Ok(out);
    };
    if program.contains(&QUOTE) {
        return Err(InvalidArgument);
    }
    push_argument(&mut out, program);
    for argument in rest {
        out.push(SPACE);
        push_argument(&mut out, argument);
    }
    Ok(out)
}

/// `full_path` is the output of `GetFullPathNameW`.
pub(crate) fn is_batch_file(full_path: &[u16]) -> bool {
    full_path.last_chunk::<4>().is_some_and(|extension| {
        [w!(".bat"), w!(".cmd")]
            .iter()
            .any(|batch_extension| eq_ignore_ascii_case(extension, batch_extension))
    })
}

fn can_omit_cmd_quotes(argument: &[u16]) -> bool {
    let is_unquoted = |&unit: &u16| {
        char::from_u32(unit.into()).is_some_and(char::is_alphanumeric)
            || is_one_of(unit, b"#$*+-./:=?@\\_")
    };
    let mut segments = argument.split(|&unit| unit == u16::from(b'='));
    !argument.is_empty()
        && argument.iter().all(is_unquoted)
        && segments.all(|segment| segment.last() != Some(&BACKSLASH))
}

fn push_cmd_argument(
    out: &mut Vec<u16>,
    argument: &[u16],
    should_quote: bool,
) -> Result<(), InvalidArgument> {
    if contains_any(argument, b"\"\r\n") {
        return Err(InvalidArgument);
    }
    if should_quote {
        out.push(QUOTE);
    }
    for &unit in argument {
        out.push(unit);
        if unit == u16::from(b'%') {
            // `%cd:~,%` expands to an empty string and keeps the preceding `%` literal.
            out.extend_from_slice(w!("%cd:~,%"));
        }
    }
    if should_quote {
        let backslash_count = argument
            .iter()
            .rev()
            .take_while(|&&unit| unit == BACKSLASH)
            .count();
        out.extend(core::iter::repeat_n(BACKSLASH, backslash_count));
        out.push(QUOTE);
    }
    Ok(())
}

/// The `cmd.exe` command line that runs a batch file. `arguments` excludes the program name.
pub(crate) fn build_batch_command(
    full_path: &[u16],
    arguments: &[Vec<u16>],
    is_verbatim: bool,
) -> Result<Vec<u16>, InvalidArgument> {
    let mut out = Vec::new();
    out.extend_from_slice(w!("cmd.exe /d /e:ON /v:OFF /s /c \""));
    // `cmd.exe` does not support the `\\?\` prefix.
    push_cmd_argument(&mut out, &strip_verbatim_prefix(full_path), true)?;
    for argument in arguments {
        out.push(SPACE);
        if is_verbatim {
            out.extend_from_slice(argument);
        } else {
            push_cmd_argument(&mut out, argument, !can_omit_cmd_quotes(argument))?;
        }
    }
    out.push(QUOTE);
    Ok(out)
}

pub(crate) fn add_verbatim_prefix(full_path: &[u16]) -> Vec<u16> {
    match full_path {
        [_, COLON, ..] => [w!("\\\\?\\"), full_path].concat(),
        [BACKSLASH, BACKSLASH, _, BACKSLASH, ..] if is_one_of(full_path[2], b"?.") => {
            full_path.to_vec()
        }
        [BACKSLASH, rest @ ..] => [w!("\\\\?\\UNC"), rest].concat(),
        _ => full_path.to_vec(),
    }
}

pub(crate) fn strip_verbatim_prefix(path: &[u16]) -> Vec<u16> {
    match path.strip_prefix(w!("\\\\?\\")) {
        Some(rest @ [_, COLON, BACKSLASH, ..]) => rest.to_vec(),
        Some(rest) if has_prefix_case_insensitive_t(rest, b"UNC\\") => {
            [&path[..2], &rest[4..]].concat()
        }
        _ => path.to_vec(),
    }
}

/// The root of an absolute path without its separator: `C:` or `\\server\share`.
fn volume(path: &[u16]) -> &[u16] {
    if !path.iter().take(2).all(|&unit| is_sep(unit)) {
        return &path[..path.len().min(2)];
    }
    let is_verbatim_unc = path
        .get(2..8)
        .is_some_and(|prefix| eq_ignore_ascii_case(prefix, w!("?\\unc\\")));
    let mut separators = (0..path.len()).filter(|&index| is_sep(path[index]));
    let end = separators.nth(if is_verbatim_unc { 5 } else { 3 });
    &path[..end.unwrap_or(path.len())]
}

fn push_directory(out: &mut Vec<u16>, directory: &[u16]) {
    out.extend_from_slice(directory);
    if directory
        .last()
        .is_some_and(|&last| !is_one_of(last, b"\\/:"))
    {
        out.push(BACKSLASH);
    }
}

/// A file name can be appended directly to the result.
fn resolve_directory(cwd: &[u16], directory: &[u16]) -> Vec<u16> {
    let mut out = Vec::new();
    match *directory {
        [first, second, _, ..] if is_sep(first) && is_sep(second) => {}
        [first, ..] if is_sep(first) => out.extend_from_slice(volume(cwd)),
        [_, COLON, third, ..] if is_sep(third) => {}
        [_, COLON, ref relative @ ..] => {
            if cwd
                .get(..2)
                .is_some_and(|drive| eq_ignore_ascii_case(drive, &directory[..2]))
            {
                push_directory(&mut out, cwd);
                push_directory(&mut out, relative);
                return out;
            }
        }
        _ => push_directory(&mut out, cwd),
    }
    push_directory(&mut out, directory);
    out
}

/// A quoted entry of `PATH` may contain `;`.
fn split_paths(mut path_env: &[u16]) -> impl Iterator<Item = &[u16]> {
    core::iter::from_fn(move || {
        let (&first, rest) = path_env.split_first()?;
        let is_quote = |unit: &u16| is_one_of(*unit, b"\"'");
        let quoted_len = if is_quote(&first) {
            1 + rest
                .iter()
                .position(|&unit| unit == first)
                .unwrap_or(rest.len())
        } else {
            0
        };
        let mut split = path_env[quoted_len..].splitn(2, |&unit| unit == u16::from(b';'));
        let mut entry = &path_env[..quoted_len + split.next().map_or(0, <[u16]>::len)];
        path_env = split.next().unwrap_or_default();
        if entry.first().is_some_and(is_quote) {
            entry = &entry[1..];
        }
        if entry.last().is_some_and(is_quote) {
            entry = &entry[..entry.len() - 1];
        }
        Some(entry)
    })
    .filter(|entry| !entry.is_empty())
}

pub(crate) struct SearchOptions<'a> {
    /// Absolute working directory of the new process.
    pub(crate) cwd: &'a [u16],
    pub(crate) path_env: &'a [u16],
    pub(crate) should_check_cwd: bool,
}

/// Uses the same search order as Node.js.
pub(crate) fn find_program(
    file: &[u16],
    options: &SearchOptions<'_>,
    is_file: impl Fn(&mut Vec<u16>) -> bool,
) -> Option<Vec<u16>> {
    let last_separator = file.iter().rposition(|&unit| is_one_of(unit, b"\\/:"));
    let (directory, name) = file.split_at(last_separator.map_or(0, |index| index + 1));
    if name.iter().all(|&unit| is_one_of(unit, b". ")) {
        return None;
    }
    let first_dot = name.iter().position(|&unit| unit == DOT);
    let has_extension = first_dot.is_some_and(|index| index + 1 < name.len());

    let search_directory = |directory: &[u16]| {
        let mut candidate = resolve_directory(options.cwd, directory);
        candidate.extend_from_slice(name);
        if has_extension && is_file(&mut candidate) {
            return Some(candidate);
        }
        if name.last().is_some_and(|&last| last != DOT) {
            candidate.push(DOT);
        }
        let extension_start = candidate.len();
        for extension in [w!("com"), w!("exe")] {
            candidate.truncate(extension_start);
            candidate.extend_from_slice(extension);
            if is_file(&mut candidate) {
                return Some(candidate);
            }
        }
        None
    };

    if !directory.is_empty() {
        return search_directory(directory);
    }
    let cwd_entry = options.should_check_cwd.then_some(&[][..]);
    cwd_entry
        .into_iter()
        .chain(split_paths(options.path_env))
        .find_map(search_directory)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to_wide(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    fn to_wide_list(texts: &[&str]) -> Vec<Vec<u16>> {
        texts.iter().map(|text| to_wide(text)).collect()
    }

    fn from_wide(text: &[u16]) -> String {
        String::from_utf16(text).unwrap()
    }

    #[test]
    fn join_quotes_arguments() {
        for (argument, quoted) in [
            ("", r#""""#),
            ("HelloWorld", "HelloWorld"),
            ("Hello World", r#""Hello World""#),
            ("Hello\tWorld", "\"Hello\tWorld\""),
            (r#"Hello"World"#, r#""Hello\"World""#),
            (r#"Hello World\"#, r#""Hello World\\""#),
            (r#"Hello\"World"#, r#""Hello\\\"World""#),
            (r"Hello\World", r"Hello\World"),
            (r"Hello\\World", r"Hello\\World"),
            (r"Hello World\\", r#""Hello World\\\\""#),
            (
                r#"c:\path\to\node.exe --eval "require('c:\\path\\to\\test.js')""#,
                r#""c:\path\to\node.exe --eval \"require('c:\\path\\to\\test.js')\"""#,
            ),
        ] {
            let command_line = join(&to_wide_list(&["x", argument])).unwrap();
            assert_eq!(from_wide(&command_line), format!("x {quoted}"));
        }
    }

    #[test]
    fn join_quotes_program_name() {
        let join_program =
            |program| join(&to_wide_list(&[program, "a"])).map(|joined| from_wide(&joined));
        assert_eq!(join_program(r"C:\a b\").unwrap(), r#""C:\a b\\" a"#);
        assert_eq!(join_program("").unwrap(), r#""" a"#);
        assert_eq!(join(&[]), Ok(vec![]));
    }

    #[test]
    fn join_verbatim_adds_only_spaces() {
        let command_line = join_verbatim(&to_wide_list(&["cmd.exe", "/c", r#""a b" c"#]));
        assert_eq!(from_wide(&command_line), r#"cmd.exe /c "a b" c"#);
    }

    #[test]
    fn detects_batch_files_and_builds_command() {
        assert!(is_batch_file(&to_wide(r"C:\a.CMD")));
        assert!(is_batch_file(&to_wide(r"C:\.bat")));
        assert!(!is_batch_file(&to_wide(r"C:\a.cmd.exe")));
        assert!(!is_batch_file(&to_wide("bat")));

        let build = |path, arguments: &[&str], is_verbatim| {
            let command_line =
                build_batch_command(&to_wide(path), &to_wide_list(arguments), is_verbatim)?;
            Ok(from_wide(&command_line[29..]))
        };
        assert_eq!(
            build(r"C:\a b\x.cmd", &["k=v", "c d", "", r"e f\", "g&h"], false),
            Ok(r#" ""C:\a b\x.cmd" k=v "c d" "" "e f\\" "g&h"""#.to_owned())
        );
        assert_eq!(
            build(r"C:\x.cmd", &["é", "日本", "a\u{a0}b"], false),
            Ok(" \"\"C:\\x.cmd\" é 日本 \"a\u{a0}b\"\"".to_owned())
        );
        assert_eq!(
            build(r"\\?\C:\x.cmd", &["%b%"], false),
            Ok(r#" ""C:\x.cmd" "%%cd:~,%b%%cd:~,%"""#.to_owned())
        );
        assert_eq!(
            build(r"\\?\UNC\s\x.cmd", &[r#""a b" c"#], true),
            Ok(r#" ""\\s\x.cmd" "a b" c""#.to_owned())
        );
        for argument in ["a\"b", "a\nb", "a\rb"] {
            assert_eq!(build(r"C:\x.cmd", &[argument], false), Err(InvalidArgument));
        }
    }

    #[test]
    fn adds_and_strips_verbatim_prefix() {
        for (path, verbatim) in [(r"C:\a", r"\\?\C:\a"), (r"\\s\t\a", r"\\?\UNC\s\t\a")] {
            assert_eq!(from_wide(&add_verbatim_prefix(&to_wide(path))), verbatim);
            assert_eq!(
                from_wide(&add_verbatim_prefix(&to_wide(verbatim))),
                verbatim
            );
            assert_eq!(from_wide(&strip_verbatim_prefix(&to_wide(verbatim))), path);
            assert_eq!(from_wide(&strip_verbatim_prefix(&to_wide(path))), path);
        }
        let lowercase = to_wide(r"\\?\unc\s\t\a");
        assert_eq!(from_wide(&strip_verbatim_prefix(&lowercase)), r"\\s\t\a");
    }

    #[test]
    fn split_paths_unquotes_and_skips_empty_entries() {
        let split = |path_env| {
            split_paths(&to_wide(path_env))
                .map(from_wide)
                .collect::<Vec<_>>()
        };
        assert_eq!(split("a;b;;c;"), ["a", "b", "c"]);
        assert_eq!(split(r#";"a;b";'c;d';e""#), ["a;b", "c;d", "e"]);
        for path_env in ["", ";"] {
            assert_eq!(split(path_env), [""; 0]);
        }
    }

    fn collect_candidates(
        file: &str,
        cwd: &str,
        path_env: &str,
        should_check_cwd: bool,
    ) -> Vec<String> {
        let candidates = core::cell::RefCell::new(Vec::new());
        let options = SearchOptions {
            cwd: &to_wide(cwd),
            path_env: &to_wide(path_env),
            should_check_cwd,
        };
        find_program(&to_wide(file), &options, |candidate| {
            candidates.borrow_mut().push(from_wide(candidate));
            false
        });
        candidates.into_inner()
    }

    #[test]
    fn find_program_tries_candidates_in_order() {
        assert_eq!(
            collect_candidates("x", r"C:\w", r"D:\p;rel", true),
            [
                r"C:\w\x.com",
                r"C:\w\x.exe",
                r"D:\p\x.com",
                r"D:\p\x.exe",
                r"C:\w\rel\x.com",
                r"C:\w\rel\x.exe",
            ]
        );
        assert_eq!(
            collect_candidates("x.y", r"C:\", r"D:\p\", false),
            [r"D:\p\x.y", r"D:\p\x.y.com", r"D:\p\x.y.exe"]
        );
        assert_eq!(
            collect_candidates("x.", r"C:\", "", true),
            [r"C:\x.com", r"C:\x.exe"]
        );
        assert_eq!(collect_candidates("", r"C:\", "a", true), [""; 0]);
    }

    #[test]
    fn find_program_resolves_directory_against_cwd() {
        let first_candidate = |file, cwd| collect_candidates(file, cwd, "unused", true).remove(0);
        assert_eq!(first_candidate("./x.exe", r"C:\w"), r"C:\w\./x.exe");
        assert_eq!(first_candidate(r"D:\x.exe", r"C:\w"), r"D:\x.exe");
        assert_eq!(first_candidate(r"\\s\t\x.exe", r"C:\w"), r"\\s\t\x.exe");
        assert_eq!(first_candidate("c:x.exe", r"C:\w"), r"C:\w\x.exe");
        assert_eq!(first_candidate(r"c:y\x.exe", r"C:\w"), r"C:\w\y\x.exe");
        assert_eq!(first_candidate("D:x.exe", r"C:\w"), "D:x.exe");
        assert_eq!(first_candidate(r"\x.exe", r"C:\w"), r"C:\x.exe");
    }
}
