//! Where a bun puts the `node` and `bun` links that package.json scripts get, and what such a link looks like.

pub const DIR_PREFIX: &str = "bun-node";

/// On POSIX the link directory is directly in this one.
pub const POSIX_ROOT: &str = if cfg!(target_os = "macos") {
    "/private/tmp"
} else if cfg!(target_os = "android") {
    "/data/local/tmp"
} else {
    "/tmp"
};

/// Whether `path` is a `node` link of some bun: of any uid, commit or build, by its form alone.
pub fn is_bun_node_link(path: &[u8]) -> bool {
    if cfg!(windows) {
        is_windows_link(path)
    } else {
        is_posix_link(path)
    }
}

fn is_dir_name_rest(rest: &[u8]) -> bool {
    rest.is_empty() || rest[0] == b'-'
}

fn is_posix_link(path: &[u8]) -> bool {
    const DIR: &[u8] = const_format::concatcp!(POSIX_ROOT, "/", DIR_PREFIX).as_bytes();
    path.strip_prefix(DIR)
        .and_then(|rest| rest.strip_suffix(b"/node"))
        .is_some_and(|rest| is_dir_name_rest(rest) && !bun_core::strings::contains_char(rest, b'/'))
}

/// The directory is under `%TEMP%` or beside bun.exe, so only its name is known.
fn is_windows_link(path: &[u8]) -> bool {
    path.strip_suffix(b"node.exe")
        .filter(|dir| matches!(dir.last(), Some(b'\\' | b'/')))
        .and_then(|dir| crate::basename_windows(dir).strip_prefix(DIR_PREFIX.as_bytes()))
        .is_some_and(is_dir_name_rest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn posix_link() {
        for (path, want) in [
            ("/bun-node/node", true),
            ("/bun-node-1000/node", true),
            ("/bun-node-1000-abc123def/node", true),
            ("/bun-node-0-debug/node", true),
            ("/bun-node-1000-abc123def", false),
            ("/bun-node-1000-abc123def/", false),
            ("/bun-node-1000-abc123def/bun", false),
            ("/bun-node-1000-abc123def/bin/node", false),
            ("/bun-nodes/node", false),
            ("/other/bun-node-1000/node", false),
            ("", false),
        ] {
            let path = format!("{POSIX_ROOT}{path}");
            assert_eq!(is_posix_link(path.as_bytes()), want, "{path}");
        }
        for path in [
            "/usr/local/bun-node-fallback-bin/node",
            "/home/me/bun-node-1000/node",
            "/usr/local/bin/node",
            "bun-node/node",
            "",
        ] {
            assert!(!is_posix_link(path.as_bytes()), "{path}");
        }
    }

    #[test]
    fn windows_link() {
        for (path, want) in [
            (
                r"C:\Users\me\AppData\Local\Temp\bun-node-abc123def\node.exe",
                true,
            ),
            (
                r"C:\Users\me\AppData\Local\Temp\bun-node-debug\node.exe",
                true,
            ),
            (r"C:\Users\me\AppData\Local\Temp\bun-node\node.exe", true),
            (r"D:\tools\bun-node\node.exe", true),
            ("C:/Temp/bun-node-abc123def/node.exe", true),
            (r"C:\Program Files\nodejs\node.exe", false),
            (r"C:\Temp\bun-nodes\node.exe", false),
            (r"C:\Temp\bun-node-abc123def\bin\node.exe", false),
            (r"C:\Temp\bun-node-abc123def\bun.exe", false),
            (r"C:\Temp\bun-node-abc123def\xnode.exe", false),
            (r"C:\Temp\bun-node-abc123def\node", false),
            (r"C:\Temp\bun-node-abc123def", false),
            ("node.exe", false),
            ("", false),
        ] {
            assert_eq!(is_windows_link(path.as_bytes()), want, "{path}");
        }
    }
}
