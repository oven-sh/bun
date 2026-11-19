//! The program and the command line for `CreateProcessW`. None of the strings ends with a NUL.

use bun_core::w;
use bun_paths::is_sep_any_t;

const BACKSLASH: u16 = b'\\' as u16;
const COLON: u16 = b':' as u16;
const DOT: u16 = b'.' as u16;
const QUOTE: u16 = b'"' as u16;
const SPACE: u16 = b' ' as u16;

fn is_any(unit: u16, set: &[u8]) -> bool {
    set.iter().any(|&byte| u16::from(byte) == unit)
}

fn has_any(text: &[u16], set: &[u8]) -> bool {
    text.iter().any(|&unit| is_any(unit, set))
}

fn eq_ignore_ascii_case(a: &[u16], b: &[u16]) -> bool {
    let lower = |unit: u16| u8::try_from(unit).map_or(unit, |b| b.to_ascii_lowercase().into());
    a.iter()
        .map(|&it| lower(it))
        .eq(b.iter().map(|&it| lower(it)))
}

/// An argument that the program would not see as it was given.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CannotQuote;

/// For the parser of the C runtime.
pub fn push_argument(out: &mut Vec<u16>, argument: &[u16]) {
    if !argument.is_empty() && !has_any(argument, b" \t\"") {
        return out.extend_from_slice(argument);
    }
    out.push(QUOTE);
    let mut backslashes = 0;
    for &unit in argument {
        if unit == QUOTE {
            out.extend(core::iter::repeat_n(BACKSLASH, backslashes + 1));
        }
        backslashes = if unit == BACKSLASH {
            backslashes + 1
        } else {
            0
        };
        out.push(unit);
    }
    out.extend(core::iter::repeat_n(BACKSLASH, backslashes));
    out.push(QUOTE);
}

pub(crate) fn join_verbatim(arguments: &[Vec<u16>]) -> Vec<u16> {
    arguments.join(&SPACE)
}

pub(crate) fn join(arguments: &[Vec<u16>]) -> Result<Vec<u16>, CannotQuote> {
    let mut out = Vec::with_capacity(arguments.iter().map(|it| it.len() + 3).sum());
    let Some((name, rest)) = arguments.split_first() else {
        return Ok(out);
    };
    if name.contains(&QUOTE) {
        return Err(CannotQuote);
    }
    push_argument(&mut out, name);
    for argument in rest {
        out.push(SPACE);
        push_argument(&mut out, argument);
    }
    Ok(out)
}

/// `full_path` is from `GetFullPathNameW`.
pub(crate) fn is_batch_file(full_path: &[u16]) -> bool {
    full_path.last_chunk::<4>().is_some_and(|extension| {
        [w!(".bat"), w!(".cmd")]
            .iter()
            .any(|batch| eq_ignore_ascii_case(extension, batch))
    })
}

fn is_plain_for_cmd(argument: &[u16]) -> bool {
    let is_plain = |&unit: &u16| {
        u8::try_from(unit).is_ok_and(|byte| byte.is_ascii_alphanumeric())
            || is_any(unit, b"#$*+-./:=?@\\_")
    };
    let mut parts = argument.split(|&unit| unit == u16::from(b'='));
    !argument.is_empty()
        && argument.iter().all(is_plain)
        && parts.all(|part| part.last() != Some(&BACKSLASH))
}

fn push_for_cmd(out: &mut Vec<u16>, text: &[u16], needs_quotes: bool) -> Result<(), CannotQuote> {
    if has_any(text, b"\"\r\n") {
        return Err(CannotQuote);
    }
    out.extend(needs_quotes.then_some(QUOTE));
    for &unit in text {
        out.push(unit);
        if unit == u16::from(b'%') {
            // Expands to nothing, and leaves no pair of them around the name of a variable.
            out.extend_from_slice(w!("%cd:~,%"));
        }
    }
    if needs_quotes {
        let backslashes = text.iter().rev().take_while(|&&it| it == BACKSLASH).count();
        out.extend(core::iter::repeat_n(BACKSLASH, backslashes));
        out.push(QUOTE);
    }
    Ok(())
}

/// For `cmd.exe` to run the batch file at `full_path`. `arguments` does not have the name of the program.
pub(crate) fn join_for_batch_file(
    full_path: &[u16],
    arguments: &[Vec<u16>],
    is_verbatim: bool,
) -> Result<Vec<u16>, CannotQuote> {
    let mut out = Vec::new();
    out.extend_from_slice(w!("cmd.exe /d /e:ON /v:OFF /s /c \""));
    // It does not know the prefix.
    push_for_cmd(&mut out, &without_verbatim_prefix(full_path), true)?;
    for argument in arguments {
        out.push(SPACE);
        if is_verbatim {
            out.extend_from_slice(argument);
        } else {
            push_for_cmd(&mut out, argument, !is_plain_for_cmd(argument))?;
        }
    }
    out.push(QUOTE);
    Ok(out)
}

pub(crate) fn with_verbatim_prefix(full_path: &[u16]) -> Vec<u16> {
    match full_path {
        [_, COLON, ..] => [w!("\\\\?\\"), full_path].concat(),
        [BACKSLASH, BACKSLASH, _, BACKSLASH, ..] if is_any(full_path[2], b"?.") => {
            full_path.to_vec()
        }
        [BACKSLASH, rest @ ..] => [w!("\\\\?\\UNC"), rest].concat(),
        _ => full_path.to_vec(),
    }
}

pub(crate) fn without_verbatim_prefix(path: &[u16]) -> Vec<u16> {
    match path.strip_prefix(w!("\\\\?\\")) {
        Some(rest @ [_, COLON, BACKSLASH, ..]) => rest.to_vec(),
        Some(rest) if rest.starts_with(w!("UNC\\")) => [&path[..2], &rest[4..]].concat(),
        _ => path.to_vec(),
    }
}

/// `C:` or `\\server\share`
fn root_of(absolute: &[u16]) -> &[u16] {
    if !absolute.iter().take(2).all(|&unit| is_sep_any_t(unit)) {
        return &absolute[..absolute.len().min(2)];
    }
    let is_verbatim_unc = absolute
        .get(2..8)
        .is_some_and(|it| eq_ignore_ascii_case(it, w!("?\\unc\\")));
    let mut separators = (0..absolute.len()).filter(|&index| is_sep_any_t(absolute[index]));
    let end = separators.nth(if is_verbatim_unc { 5 } else { 3 });
    &absolute[..end.unwrap_or(absolute.len())]
}

fn push_directory(out: &mut Vec<u16>, directory: &[u16]) {
    out.extend_from_slice(directory);
    if directory.last().is_some_and(|&last| !is_any(last, b"\\/:")) {
        out.push(BACKSLASH);
    }
}

/// With a separator at its end.
fn resolve_directory(cwd: &[u16], directory: &[u16]) -> Vec<u16> {
    let mut out = Vec::new();
    match *directory {
        [first, second, _, ..] if is_sep_any_t(first) && is_sep_any_t(second) => {}
        [first, ..] if is_sep_any_t(first) => out.extend_from_slice(root_of(cwd)),
        [_, COLON, third, ..] if is_sep_any_t(third) => {}
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

/// The entries of `PATH`. One that is quoted can have a `;` in it.
fn path_entries(mut path: &[u16]) -> impl Iterator<Item = &[u16]> {
    core::iter::from_fn(move || {
        let (&first, rest) = path.split_first()?;
        let is_quote = |unit: &u16| is_any(*unit, b"\"'");
        let quoted_len = if is_quote(&first) {
            1 + rest
                .iter()
                .position(|&unit| unit == first)
                .unwrap_or(rest.len())
        } else {
            0
        };
        let mut parts = path[quoted_len..].splitn(2, |&unit| unit == u16::from(b';'));
        let mut entry = &path[..quoted_len + parts.next().map_or(0, <[u16]>::len)];
        path = parts.next().unwrap_or_default();
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

pub(crate) struct Search<'a> {
    /// Of the new process, and absolute.
    pub(crate) cwd: &'a [u16],
    pub(crate) path: &'a [u16],
    pub(crate) includes_cwd: bool,
}

/// As Node.js does it.
pub(crate) fn find_program(
    file: &[u16],
    search: &Search<'_>,
    is_file: impl Fn(&mut Vec<u16>) -> bool,
) -> Option<Vec<u16>> {
    let name_start = file.iter().rposition(|&unit| is_any(unit, b"\\/:"));
    let (directory, name) = file.split_at(name_start.map_or(0, |index| index + 1));
    if name.iter().all(|&unit| is_any(unit, b". ")) {
        return None;
    }
    let first_dot = name.iter().position(|&unit| unit == DOT);
    let has_extension = first_dot.is_some_and(|index| index + 1 < name.len());

    let find_in = |directory: &[u16]| {
        let mut candidate = resolve_directory(search.cwd, directory);
        candidate.extend_from_slice(name);
        if has_extension && is_file(&mut candidate) {
            return Some(candidate);
        }
        if name.last().is_some_and(|&last| last != DOT) {
            candidate.push(DOT);
        }
        let stem_len = candidate.len();
        for extension in [w!("com"), w!("exe")] {
            candidate.truncate(stem_len);
            candidate.extend_from_slice(extension);
            if is_file(&mut candidate) {
                return Some(candidate);
            }
        }
        None
    };

    if !directory.is_empty() {
        return find_in(directory);
    }
    let cwd = search.includes_cwd.then_some(&[][..]);
    cwd.into_iter()
        .chain(path_entries(search.path))
        .find_map(find_in)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    fn all_wide(texts: &[&str]) -> Vec<Vec<u16>> {
        texts.iter().map(|it| wide(it)).collect()
    }

    fn narrow(text: &[u16]) -> String {
        String::from_utf16(text).unwrap()
    }

    #[test]
    fn arguments() {
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
            let line = join(&all_wide(&["x", argument])).unwrap();
            assert_eq!(narrow(&line), format!("x {quoted}"));
        }
    }

    #[test]
    fn name_of_the_program() {
        let line = |name| join(&all_wide(&[name, "a"])).map(|it| narrow(&it));
        assert_eq!(line(r"C:\a b\").unwrap(), r#""C:\a b\\" a"#);
        assert_eq!(line("").unwrap(), r#""" a"#);
        assert_eq!(join(&[]), Ok(vec![]));
    }

    #[test]
    fn verbatim() {
        let line = join_verbatim(&all_wide(&["cmd.exe", "/c", r#""a b" c"#]));
        assert_eq!(narrow(&line), r#"cmd.exe /c "a b" c"#);
    }

    #[test]
    fn batch_files() {
        assert!(is_batch_file(&wide(r"C:\a.CMD")));
        assert!(is_batch_file(&wide(r"C:\.bat")));
        assert!(!is_batch_file(&wide(r"C:\a.cmd.exe")));
        assert!(!is_batch_file(&wide("bat")));

        let line = |path, arguments: &[&str], is_verbatim| {
            let line = join_for_batch_file(&wide(path), &all_wide(arguments), is_verbatim)?;
            Ok(narrow(&line[29..]))
        };
        assert_eq!(
            line(r"C:\a b\x.cmd", &["k=v", "c d", "", r"e f\", "g&h"], false),
            Ok(r#" ""C:\a b\x.cmd" k=v "c d" "" "e f\\" "g&h"""#.to_owned())
        );
        assert_eq!(
            line(r"\\?\C:\x.cmd", &["%b%"], false),
            Ok(r#" ""C:\x.cmd" "%%cd:~,%b%%cd:~,%"""#.to_owned())
        );
        assert_eq!(
            line(r"\\?\UNC\s\x.cmd", &[r#""a b" c"#], true),
            Ok(r#" ""\\s\x.cmd" "a b" c""#.to_owned())
        );
        for argument in ["a\"b", "a\nb", "a\rb"] {
            assert_eq!(line(r"C:\x.cmd", &[argument], false), Err(CannotQuote));
        }
    }

    #[test]
    fn verbatim_prefix() {
        for (plain, verbatim) in [(r"C:\a", r"\\?\C:\a"), (r"\\s\t\a", r"\\?\UNC\s\t\a")] {
            assert_eq!(narrow(&with_verbatim_prefix(&wide(plain))), verbatim);
            assert_eq!(narrow(&with_verbatim_prefix(&wide(verbatim))), verbatim);
            assert_eq!(narrow(&without_verbatim_prefix(&wide(verbatim))), plain);
            assert_eq!(narrow(&without_verbatim_prefix(&wide(plain))), plain);
        }
    }

    #[test]
    fn entries_of_path() {
        let entries = |path| path_entries(&wide(path)).map(narrow).collect::<Vec<_>>();
        assert_eq!(entries("a;b;;c;"), ["a", "b", "c"]);
        assert_eq!(entries(r#";"a;b";'c;d';e""#), ["a;b", "c;d", "e"]);
        for path in ["", ";"] {
            assert_eq!(entries(path), [""; 0]);
        }
    }

    fn candidates(file: &str, cwd: &str, path: &str, includes_cwd: bool) -> Vec<String> {
        let tried = core::cell::RefCell::new(Vec::new());
        let search = Search {
            cwd: &wide(cwd),
            path: &wide(path),
            includes_cwd,
        };
        find_program(&wide(file), &search, |candidate| {
            tried.borrow_mut().push(narrow(candidate));
            false
        });
        tried.into_inner()
    }

    #[test]
    fn order_of_the_search() {
        assert_eq!(
            candidates("x", r"C:\w", r"D:\p;rel", true),
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
            candidates("x.y", r"C:\", r"D:\p\", false),
            [r"D:\p\x.y", r"D:\p\x.y.com", r"D:\p\x.y.exe"]
        );
        assert_eq!(
            candidates("x.", r"C:\", "", true),
            [r"C:\x.com", r"C:\x.exe"]
        );
        assert_eq!(candidates("", r"C:\", "a", true), [""; 0]);
    }

    #[test]
    fn names_with_a_directory() {
        let first = |file, cwd| candidates(file, cwd, "unused", true).remove(0);
        assert_eq!(first("./x.exe", r"C:\w"), r"C:\w\./x.exe");
        assert_eq!(first(r"D:\x.exe", r"C:\w"), r"D:\x.exe");
        assert_eq!(first(r"\\s\t\x.exe", r"C:\w"), r"\\s\t\x.exe");
        assert_eq!(first("c:x.exe", r"C:\w"), r"C:\w\x.exe");
        assert_eq!(first(r"c:y\x.exe", r"C:\w"), r"C:\w\y\x.exe");
        assert_eq!(first("D:x.exe", r"C:\w"), "D:x.exe");
        assert_eq!(first(r"\x.exe", r"C:\w"), r"C:\x.exe");
    }
}
