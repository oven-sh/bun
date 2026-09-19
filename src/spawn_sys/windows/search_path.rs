//! Finding the image to run, with cmd.exe's rules minus `PATHEXT`:
//! `CreateProcessW` can only start `.com` and `.exe` images, so only those are
//! tried. `CreateProcessW`'s own search is unusable: it resolves against this
//! process's directory and `PATH` rather than the child's.
//!
//! - A name with a directory part (relative or absolute) is not looked up in
//!   `PATH`.
//! - A bare name is looked up in the child's directory first (unless
//!   `NoDefaultCurrentDirectoryInExePath` is in effect), then in every `PATH`
//!   entry. Entries may be relative (to the child's directory), may or may not
//!   end in a separator, may be quoted with `"` or `'`, and are not trimmed.
//! - In each directory the exact name is tried first if it has an extension,
//!   then the name with `.com` appended, then with `.exe` appended.
//! - A directory never matches; an unreadable file does.
//! - UNC paths work in both the name and `PATH`.

const BACKSLASH: u16 = b'\\' as u16;
const SLASH: u16 = b'/' as u16;
const COLON: u16 = b':' as u16;
const DOT: u16 = b'.' as u16;
const SEMICOLON: u16 = b';' as u16;

#[inline]
fn is_slash(c: u16) -> bool {
    c == BACKSLASH || c == SLASH
}

#[inline]
fn is_quote(c: u16) -> bool {
    c == b'"' as u16 || c == b'\'' as u16
}

/// How much of the child's directory `dir` is resolved against.
enum CwdUse {
    None,
    DriveOnly,
    Full,
    /// `D:rel`: the whole directory when it is on drive `D:`, else nothing;
    /// the `D:` prefix of `dir` is dropped in the first case.
    IfSameDrive,
}

fn cwd_use(dir: &[u16]) -> CwdUse {
    if dir.len() > 2 && is_slash(dir[0]) && is_slash(dir[1]) {
        CwdUse::None
    } else if !dir.is_empty() && is_slash(dir[0]) {
        CwdUse::DriveOnly
    } else if dir.len() >= 2 && dir[1] == COLON && (dir.len() < 3 || !is_slash(dir[2])) {
        CwdUse::IfSameDrive
    } else if dir.len() > 2 && dir[1] == COLON {
        CwdUse::None
    } else {
        CwdUse::Full
    }
}

/// Where the file name starts in `file`: after the last `\`, `/` or `:`.
fn file_name_start(file: &[u16]) -> usize {
    file.iter()
        .rposition(|&c| is_slash(c) || c == COLON)
        .map_or(0, |i| i + 1)
}

/// Whether [`search_path`] reads the child's directory for `file`. False only
/// for a name whose directory part is absolute with a drive, or UNC.
pub fn needs_cwd(file: &[u16]) -> bool {
    let name_start = file_name_start(file);
    name_start == 0 || !matches!(cwd_use(&file[..name_start]), CwdUse::None)
}

/// Whether [`search_path`] reads `PATH` for `file`.
pub fn needs_path(file: &[u16]) -> bool {
    file_name_start(file) == 0
}

fn ascii_eq_ignore_case(a: u16, b: u16) -> bool {
    let lower = |c: u16| {
        if (b'A' as u16..=b'Z' as u16).contains(&c) {
            c + 32
        } else {
            c
        }
    };
    lower(a) == lower(b)
}

fn join_test(
    dir: &[u16],
    name: &[u16],
    ext: &[u16],
    cwd: &[u16],
    exists: &mut dyn FnMut(&[u16]) -> bool,
) -> Option<Vec<u16>> {
    let (cwd, dir) = match cwd_use(dir) {
        CwdUse::None => (&cwd[..0], dir),
        CwdUse::DriveOnly => (&cwd[..cwd.len().min(2)], dir),
        CwdUse::Full => (cwd, dir),
        CwdUse::IfSameDrive => {
            if cwd.len() < 2
                || !ascii_eq_ignore_case(cwd[0], dir[0])
                || !ascii_eq_ignore_case(cwd[1], dir[1])
            {
                (&cwd[..0], dir)
            } else {
                (cwd, &dir[2..])
            }
        }
    };

    let ends_in_separator = |s: &[u16]| s.last().is_some_and(|&c| is_slash(c) || c == COLON);

    let mut result: Vec<u16> =
        Vec::with_capacity(cwd.len() + 1 + dir.len() + 1 + name.len() + 1 + ext.len() + 1);
    result.extend_from_slice(cwd);
    if !cwd.is_empty() && !ends_in_separator(cwd) {
        result.push(BACKSLASH);
    }
    result.extend_from_slice(dir);
    if !dir.is_empty() && !ends_in_separator(dir) {
        result.push(BACKSLASH);
    }
    result.extend_from_slice(name);
    if !ext.is_empty() {
        if name.last().is_some_and(|&c| c != DOT) {
            result.push(DOT);
        }
        result.extend_from_slice(ext);
    }
    result.push(0);

    if exists(&result) { Some(result) } else { None }
}

fn walk_ext(
    dir: &[u16],
    name: &[u16],
    cwd: &[u16],
    name_has_ext: bool,
    exists: &mut dyn FnMut(&[u16]) -> bool,
) -> Option<Vec<u16>> {
    const COM: [u16; 3] = [b'c' as u16, b'o' as u16, b'm' as u16];
    const EXE: [u16; 3] = [b'e' as u16, b'x' as u16, b'e' as u16];
    if name_has_ext {
        if let Some(found) = join_test(dir, name, &[], cwd, exists) {
            return Some(found);
        }
    }
    if let Some(found) = join_test(dir, name, &COM, cwd, exists) {
        return Some(found);
    }
    join_test(dir, name, &EXE, cwd, exists)
}

/// The NUL-terminated path of the image `file` names, or `None`.
///
/// `cwd` is the child's directory and `path` its `PATH` (neither
/// NUL-terminated); see [`needs_cwd`] / [`needs_path`] for when they are read.
/// `cwd_first` is `NeedCurrentDirectoryForExePathW("")`. `exists` answers
/// whether a NUL-terminated path names something that is not a directory.
pub fn search_path(
    file: &[u16],
    cwd: &[u16],
    path: &[u16],
    cwd_first: bool,
    exists: &mut dyn FnMut(&[u16]) -> bool,
) -> Option<Vec<u16>> {
    if file.is_empty() || file == [DOT] {
        return None;
    }

    let name_start = file_name_start(file);
    let name = &file[name_start..];
    // An extension is a `.` in the file name that is not its last character.
    let name_has_ext = name
        .iter()
        .position(|&c| c == DOT)
        .is_some_and(|dot| dot + 1 < name.len());

    if name_start != 0 {
        return walk_ext(&file[..name_start], name, cwd, name_has_ext, exists);
    }

    if cwd_first {
        if let Some(found) = walk_ext(&[], file, cwd, name_has_ext, exists) {
            return Some(found);
        }
    }

    let mut dir_end = 0usize;
    loop {
        if dir_end >= path.len() {
            return None;
        }
        // Step over the separator the previous entry ended at.
        if dir_end != 0 || path[0] == SEMICOLON {
            dir_end += 1;
        }
        let dir_start = dir_end;

        // A `;` inside quotes does not end the entry.
        if dir_start < path.len() && is_quote(path[dir_start]) {
            let quote = path[dir_start];
            dir_end = path[dir_start + 1..]
                .iter()
                .position(|&c| c == quote)
                .map_or(path.len(), |i| dir_start + 1 + i);
        }
        dir_end = path[dir_end.min(path.len())..]
            .iter()
            .position(|&c| c == SEMICOLON)
            .map_or(path.len(), |i| dir_end + i);

        if dir_end == dir_start {
            continue;
        }

        let mut dir = &path[dir_start..dir_end];
        if is_quote(dir[0]) {
            dir = &dir[1..];
            if dir.is_empty() {
                continue;
            }
        }
        if is_quote(dir[dir.len() - 1]) {
            dir = &dir[..dir.len() - 1];
        }

        if let Some(found) = walk_ext(dir, file, cwd, name_has_ext, exists) {
            return Some(found);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    /// Runs the search against a fixed set of existing files; returns the match
    /// and every path probed, in order.
    fn run(
        file: &str,
        cwd: &str,
        path: &str,
        cwd_first: bool,
        files: &[&str],
    ) -> (Option<String>, Vec<String>) {
        let mut probed = Vec::new();
        let found = search_path(&w(file), &w(cwd), &w(path), cwd_first, &mut |p| {
            assert_eq!(p.last(), Some(&0));
            let p = String::from_utf16(&p[..p.len() - 1]).unwrap();
            let hit = files.iter().any(|f| f.eq_ignore_ascii_case(&p));
            probed.push(p);
            hit
        })
        .map(|p| String::from_utf16(&p[..p.len() - 1]).unwrap());
        (found, probed)
    }

    #[test]
    fn empty_and_dot_never_match() {
        assert_eq!(run("", "C:\\cwd", "C:\\bin", true, &[]).0, None);
        assert_eq!(
            run(".", "C:\\cwd", "C:\\bin", true, &["C:\\cwd\\..exe"]).0,
            None
        );
    }

    #[test]
    fn bare_name_tries_cwd_then_path_with_com_before_exe() {
        let (found, probed) = run(
            "node",
            "C:\\cwd",
            "C:\\a;C:\\b\\",
            true,
            &["C:\\b\\node.exe"],
        );
        assert_eq!(found.as_deref(), Some("C:\\b\\node.exe"));
        assert_eq!(
            probed,
            [
                "C:\\cwd\\node.com",
                "C:\\cwd\\node.exe",
                "C:\\a\\node.com",
                "C:\\a\\node.exe",
                "C:\\b\\node.com",
                "C:\\b\\node.exe",
            ]
        );
    }

    #[test]
    fn cwd_is_skipped_when_the_system_says_so() {
        let (found, probed) = run("x", "C:\\cwd", "C:\\a", false, &["C:\\cwd\\x.exe"]);
        assert_eq!(found, None);
        assert_eq!(probed, ["C:\\a\\x.com", "C:\\a\\x.exe"]);
    }

    #[test]
    fn a_name_with_an_extension_is_tried_exactly_first() {
        let (found, probed) = run("run.cmd", "C:\\cwd", "", true, &["C:\\cwd\\run.cmd"]);
        assert_eq!(found.as_deref(), Some("C:\\cwd\\run.cmd"));
        assert_eq!(probed, ["C:\\cwd\\run.cmd"]);

        // A trailing dot is not an extension, and no second dot is added.
        let (_, probed) = run("noext.", "C:\\cwd", "", true, &[]);
        assert_eq!(probed, ["C:\\cwd\\noext.com", "C:\\cwd\\noext.exe"]);
    }

    #[test]
    fn a_name_with_a_directory_never_reads_path() {
        let (found, probed) = run(
            "sub/tool",
            "C:\\cwd",
            "C:\\a",
            true,
            &["C:\\a\\tool.exe", "C:\\cwd\\sub/tool.exe"],
        );
        assert_eq!(found.as_deref(), Some("C:\\cwd\\sub/tool.exe"));
        assert_eq!(probed, ["C:\\cwd\\sub/tool.com", "C:\\cwd\\sub/tool.exe"]);
        assert!(!needs_path(&w("sub/tool")));
        assert!(needs_path(&w("tool")));
    }

    #[test]
    fn cwd_rules_for_each_kind_of_directory() {
        // Absolute with a drive, and UNC: cwd unused.
        assert_eq!(
            run("C:\\x\\a.exe", "D:\\cwd", "", true, &["C:\\x\\a.exe"])
                .0
                .as_deref(),
            Some("C:\\x\\a.exe")
        );
        assert!(!needs_cwd(&w("C:\\x\\a.exe")));
        assert_eq!(
            run(
                "\\\\srv\\share\\a.exe",
                "D:\\cwd",
                "",
                true,
                &["\\\\srv\\share\\a.exe"]
            )
            .0
            .as_deref(),
            Some("\\\\srv\\share\\a.exe")
        );
        assert!(!needs_cwd(&w("\\\\srv\\share\\a.exe")));
        // Rooted without a drive: the drive of cwd.
        assert_eq!(
            run("\\x\\a.exe", "D:\\cwd", "", true, &["D:\\x\\a.exe"])
                .0
                .as_deref(),
            Some("D:\\x\\a.exe")
        );
        // Drive-relative: all of cwd on the same drive, none of it otherwise.
        assert_eq!(
            run("d:x\\a.exe", "D:\\cwd", "", true, &["D:\\cwd\\x\\a.exe"])
                .0
                .as_deref(),
            Some("D:\\cwd\\x\\a.exe")
        );
        assert_eq!(
            run("E:x\\a.exe", "D:\\cwd", "", true, &["E:x\\a.exe"])
                .0
                .as_deref(),
            Some("E:x\\a.exe")
        );
        assert!(needs_cwd(&w("E:x\\a.exe")));
        assert!(needs_cwd(&w("a.exe")));
    }

    #[test]
    fn path_entries_may_be_quoted_relative_or_empty() {
        let (found, probed) = run(
            "t",
            "C:\\cwd",
            ";;\"C:\\semi;colon\";rel;'C:\\q'",
            false,
            &["C:\\q\\t.exe"],
        );
        assert_eq!(found.as_deref(), Some("C:\\q\\t.exe"));
        assert_eq!(
            probed,
            [
                "C:\\semi;colon\\t.com",
                "C:\\semi;colon\\t.exe",
                "C:\\cwd\\rel\\t.com",
                "C:\\cwd\\rel\\t.exe",
                "C:\\q\\t.com",
                "C:\\q\\t.exe",
            ]
        );
    }

    #[test]
    fn a_lone_quote_entry_is_skipped() {
        let (found, probed) = run("t", "C:\\cwd", "\";C:\\a", false, &["C:\\a\\t.exe"]);
        // The unterminated quote swallows the rest of PATH.
        assert_eq!(found, None);
        assert_eq!(probed, ["C:\\cwd\\;C:\\a\\t.com", "C:\\cwd\\;C:\\a\\t.exe"]);
        assert_eq!(
            run("t", "C:\\cwd", "\"", false, &[]).1,
            Vec::<String>::new()
        );
    }
}
