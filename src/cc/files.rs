//! Reading source files and finding the directories a platform keeps its C headers in.

use bun_core::{env_var, strings};
use bun_sys::{Dir, Fd, File};

use crate::types::{Os, Target};

/// A source file that was read: its bytes, and which file it is (device and inode, or what
/// Windows has for them), so that two names of one file are known to be one.
pub(crate) struct Loaded {
    pub(crate) bytes: Vec<u8>,
    pub(crate) identity: Option<(u64, u64)>,
}

/// Why a path gave no source text.
pub(crate) enum Unreadable {
    /// Nothing has that name: the search goes on.
    NotFound,
    /// Something has, and this is what is wrong with it.
    Because(String),
}

/// The largest source file there can be: positions in one are 32 bits.
pub const MAX_SOURCE_BYTES: u64 = 1 << 30;

/// Opens, checks and reads: only a regular file of a sane size is source text. (A FIFO would
/// block, `/dev/zero` never ends, a directory is not text.)
fn read_regular_file(path: &[u8]) -> Result<Loaded, Unreadable> {
    let because = |error: bun_sys::Error| {
        if error.get_errno() == bun_sys::E::ENOENT || error.get_errno() == bun_sys::E::ENOTDIR {
            return Unreadable::NotFound;
        }
        let what = error.msg().unwrap_or_else(|| error.name());
        Unreadable::Because(crate::token::display_bytes(what))
    };
    // Opening a FIFO nobody writes to waits for a writer unless asked not to; what it is shows in
    // `stat` below. Windows has no such files and no such flag.
    #[cfg(unix)]
    let flags = bun_sys::O::RDONLY | bun_sys::O::NONBLOCK;
    #[cfg(not(unix))]
    let flags = bun_sys::O::RDONLY;
    let file = File::openat(Fd::cwd(), path, flags, 0).map_err(because)?;
    let stat = file.stat().map_err(because)?;
    if !bun_sys::is_regular_file(stat.st_mode as bun_sys::Mode) {
        return Err(Unreadable::Because("not a regular file".to_string()));
    }
    if stat.st_size as u64 > MAX_SOURCE_BYTES {
        return Err(Unreadable::Because(format!(
            "larger than {MAX_SOURCE_BYTES} bytes"
        )));
    }
    let bytes = file.read_to_end().map_err(because)?;
    Ok(Loaded {
        bytes,
        identity: Some((stat.st_dev as u64, stat.st_ino as u64)),
    })
}

/// The contents of `path`.
///
/// `any_case` reads the file system the way Windows does: a name that does not exist as spelled
/// is looked for whatever the case of its letters, and `\` separates directories too. That is
/// for compiling against a copy of the Windows SDK, whose headers name each other that way, on
/// a file system that tells `Windows.h` from `windows.h`.
pub(crate) fn read(path: &[u8], any_case: bool) -> Result<Loaded, Unreadable> {
    match read_regular_file(path) {
        Err(Unreadable::NotFound) if any_case => {}
        other => return other,
    }
    let mut forward = path.to_vec();
    for byte in &mut forward {
        if *byte == b'\\' {
            *byte = b'/';
        }
    }
    match spelled_on_disk(&forward) {
        Some(spelled) => read_regular_file(&spelled),
        None => Err(Unreadable::NotFound),
    }
}

/// `path` with each component spelled the way the directory that holds it spells it: from the
/// front, one directory at a time, a component that is not there under its own spelling looked
/// for among the directory's entries without regard to case.
fn spelled_on_disk(path: &[u8]) -> Option<Vec<u8>> {
    if bun_sys::exists(path) {
        return Some(path.to_vec());
    }
    // What has been found so far: the root, or nothing for the working directory.
    let mut found: Vec<u8> = if path.starts_with(b"/") {
        b"/".to_vec()
    } else {
        Vec::new()
    };
    for name in strings::split(path, b"/") {
        if name.is_empty() || name == b"." {
            continue;
        }
        let mut next = found.clone();
        if !next.is_empty() && next.last() != Some(&b'/') {
            next.push(b'/');
        }
        let directory_end = next.len();
        next.extend_from_slice(name);
        if name != b".." && !bun_sys::exists(&next) {
            let holder: &[u8] = if found.is_empty() { b"." } else { &found };
            let spelled = spelled_in(holder, name)?;
            next.truncate(directory_end);
            next.extend_from_slice(&spelled);
        }
        found = next;
    }
    bun_sys::exists(&found).then_some(found)
}

/// The entry of `directory` that is `name` but for the case of its letters.
fn spelled_in(directory: &[u8], name: &[u8]) -> Option<Vec<u8>> {
    let dir = Dir::open(directory).ok()?;
    let mut entries = bun_sys::dir_iterator::iterate(dir.fd());
    while let Ok(Some(entry)) = entries.next() {
        let spelled = entry.name.slice_u8();
        if strings::eql_case_insensitive_ascii(spelled, name, true) {
            return Some(spelled.to_vec());
        }
    }
    None
}

fn is_directory(path: &[u8]) -> bool {
    Dir::open(path).is_ok()
}

/// The directories searched for `<...>` headers after the compiler's own, when compiling for
/// `target`: `C_INCLUDE_PATH` first (what gcc and clang search as `-isystem` directories, so that
/// a project's copy of a header is the one found), then, when the target is this machine, where
/// its C library's headers are.
pub(crate) fn system_include_dirs(target: Target) -> Vec<String> {
    let mut dirs = Vec::new();
    if let Some(list) = env_var::C_INCLUDE_PATH::get() {
        let separator: &[u8] = if cfg!(windows) { b";" } else { b":" };
        for directory in strings::split(list, separator) {
            if let Ok(directory) = core::str::from_utf8(directory)
                && !directory.is_empty()
            {
                dirs.push(directory.to_owned());
            }
        }
    }
    if Some(target) != Target::host() {
        return dirs;
    }
    match target.os {
        Os::Linux => {
            let multiarch = "/usr/include/x86_64-linux-gnu";
            for dir in ["/usr/local/include", multiarch, "/usr/include"] {
                if is_directory(dir.as_bytes()) {
                    dirs.push(dir.to_owned());
                }
            }
        }
        Os::MacOs => {
            for dir in ["/usr/local/include", "/opt/homebrew/include"] {
                if is_directory(dir.as_bytes()) {
                    dirs.push(dir.to_owned());
                }
            }
            // The C library's headers are in the SDK: the one `SDKROOT` names, which is how `xcrun`,
            // Xcode and clang are told which, or else the first of the places `xcrun
            // --show-sdk-path` names that has one.
            const SDKS: [&str; 2] = [
                "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
                "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
            ];
            let named = env_var::SDKROOT::platform_get()
                .and_then(|sdk| core::str::from_utf8(sdk).ok())
                .filter(|sdk| !sdk.is_empty());
            let installed = || {
                SDKS.into_iter()
                    .find(|sdk| bun_sys::exists([sdk, "/usr/include/stdio.h"].concat().as_bytes()))
            };
            if let Some(sdk) = named.or_else(installed) {
                dirs.push([sdk, "/usr/include"].concat());
            }
        }
        Os::Windows => dirs.extend(microsoft_include_dirs()),
    }
    dirs
}

/// Where Microsoft's toolchain keeps the C headers: the compiler's own (Visual Studio), the
/// Universal C Runtime's and the Windows SDK's. The `INCLUDE` variable of a developer prompt says
/// exactly; without it the newest of each under `ProgramFiles` and `ProgramFiles(x86)` is taken,
/// in the order cl.exe searches them.
fn microsoft_include_dirs() -> Vec<String> {
    // (Looked for once: nothing installs a toolchain while a program is being compiled, and every
    // C file of it asks.)
    static FOUND: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    FOUND.get_or_init(find_microsoft_include_dirs).clone()
}

fn find_microsoft_include_dirs() -> Vec<String> {
    let text =
        |value: Option<&'static [u8]>| value.and_then(|value| core::str::from_utf8(value).ok());
    if let Some(list) = text(env_var::INCLUDE::platform_get()) {
        let dirs: Vec<String> = strings::split(list.as_bytes(), b";")
            .filter_map(|dir| core::str::from_utf8(dir).ok())
            .filter(|dir| !dir.is_empty() && is_directory(dir.as_bytes()))
            .map(str::to_owned)
            .collect();
        if !dirs.is_empty() {
            return dirs;
        }
    }
    let program_files: Vec<&str> = [
        text(env_var::PROGRAMFILES::platform_get()),
        text(env_var::PROGRAMFILES_X86::platform_get()),
    ]
    .into_iter()
    .flatten()
    .collect();

    let mut dirs = Vec::new();
    // <ProgramFiles>\Microsoft Visual Studio\<year>\<edition>\VC\Tools\MSVC\<version>\include
    'compiler: for root in &program_files {
        let studio = [root, "\\Microsoft Visual Studio"].concat();
        let mut years = subdirectories(&studio);
        years.sort();
        for year in years.iter().rev() {
            for edition in [
                "Enterprise",
                "Professional",
                "Community",
                "BuildTools",
                "Preview",
            ] {
                let tools = [&studio, "\\", year, "\\", edition, "\\VC\\Tools\\MSVC"].concat();
                if let Some(toolset) = newest_version(&tools, "\\include\\vcruntime.h") {
                    dirs.push([&toolset, "\\include"].concat());
                    break 'compiler;
                }
            }
        }
    }
    // <ProgramFiles(x86)>\Windows Kits\10\Include\<version>\{ucrt,shared,um}
    for root in &program_files {
        let kits = [root, "\\Windows Kits\\10\\Include"].concat();
        if let Some(sdk) = newest_version(&kits, "\\ucrt\\stdio.h") {
            for part in ["\\ucrt", "\\shared", "\\um"] {
                let dir = [&sdk, part].concat();
                if is_directory(dir.as_bytes()) {
                    dirs.push(dir);
                }
            }
            break;
        }
    }
    dirs
}

fn subdirectories(dir: &str) -> Vec<String> {
    let mut names = Vec::new();
    let Ok(dir) = Dir::open(dir.as_bytes()) else {
        return names;
    };
    let mut entries = bun_sys::dir_iterator::iterate(dir.fd());
    while let Ok(Some(entry)) = entries.next() {
        if let Ok(name) = core::str::from_utf8(entry.name.slice_u8()) {
            names.push(name.to_owned());
        }
    }
    names
}

/// The subdirectory of `dir` with the highest dotted version number for a name, among those that
/// have the file `marker` (a path relative to the subdirectory, starting with a separator).
fn newest_version(dir: &str, marker: &str) -> Option<String> {
    let version = |name: &str| -> Vec<u64> {
        strings::split(name.as_bytes(), b".")
            .map(|part| strings::parse_int::<u64>(part, 10).unwrap_or(0))
            .collect()
    };
    subdirectories(dir)
        .into_iter()
        .filter(|name| bun_sys::exists([dir, "\\", name, marker].concat().as_bytes()))
        .max_by_key(|name| version(name))
        .map(|name| [dir, "\\", &name].concat())
}
