//! Reading source files and finding the directories a platform keeps its C headers in.

use bun_core::{env_var, strings};
use bun_paths::resolve_path::{self, platform};
use bun_sys::{Dir, Fd, File};

use crate::types::{Arch, Os, Target};

/// The contents of `path`, or `None` if there is no such file.
///
/// `any_case` reads the file system the way Windows does: a name that does not exist as spelled
/// is looked for whatever the case of its letters, and `\` separates directories too. That is
/// for compiling against a copy of the Windows SDK, whose headers name each other that way, on
/// a file system that tells `Windows.h` from `windows.h`.
pub(crate) fn read(path: &[u8], any_case: bool) -> Option<Vec<u8>> {
    if let Ok(contents) = File::read_from(Fd::cwd(), path) {
        return Some(contents);
    }
    if !any_case {
        return None;
    }
    let mut forward = path.to_vec();
    for byte in &mut forward {
        if *byte == b'\\' {
            *byte = b'/';
        }
    }
    File::read_from(Fd::cwd(), &spelled_on_disk(&forward)?).ok()
}

/// `path` with each component spelled the way the directory that holds it spells it.
fn spelled_on_disk(path: &[u8]) -> Option<Vec<u8>> {
    if bun_sys::exists(path) {
        return Some(path.to_vec());
    }
    let name = bun_paths::basename(path);
    if name.is_empty() || name.len() == path.len() {
        return None;
    }
    let parent = resolve_path::dirname::<platform::Posix>(path);
    let parent = spelled_on_disk(parent)?;
    let dir = Dir::open(&parent).ok()?;
    let mut entries = bun_sys::dir_iterator::iterate(dir.fd());
    while let Ok(Some(entry)) = entries.next() {
        let spelled = entry.name.slice_u8();
        if strings::eql_case_insensitive_ascii(spelled, name, true) {
            let mut found = parent;
            if found.last() != Some(&b'/') {
                found.push(b'/');
            }
            found.extend_from_slice(spelled);
            return Some(found);
        }
    }
    None
}

fn is_directory(path: &[u8]) -> bool {
    Dir::open(path).is_ok()
}

fn joined(parts: &[&str]) -> String {
    parts.concat()
}

/// The directories searched for `<...>` headers after the compiler's own, when compiling for
/// `target`: `C_INCLUDE_PATH` first (what gcc and clang search as `-isystem` directories, so that
/// a project's copy of a header is the one found), then, when the target is this machine, where
/// its C library's headers are.
pub fn system_include_dirs(target: Target) -> Vec<String> {
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
    if target != Target::host() {
        return dirs;
    }
    match target.os {
        Os::Linux => {
            let multiarch = match target.arch {
                Arch::X86_64 => "/usr/include/x86_64-linux-gnu",
                Arch::Aarch64 => "/usr/include/aarch64-linux-gnu",
            };
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
            // The C library's headers are in the SDK, which `xcrun --show-sdk-path` would name;
            // these are the places it names, and `SDKROOT` is what clang reads for another.
            const SDKS: [&str; 2] = [
                "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
                "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
            ];
            if let Some(sdk) = SDKS
                .into_iter()
                .find(|sdk| bun_sys::exists(joined(&[sdk, "/usr/include/stdio.h"]).as_bytes()))
            {
                dirs.push(joined(&[sdk, "/usr/include"]));
            }
            if let Some(sdk) = env_var::SDKROOT::platform_get()
                && let Ok(sdk) = core::str::from_utf8(sdk)
                && !sdk.is_empty()
            {
                dirs.push(joined(&[sdk, "/usr/include"]));
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
        let studio = joined(&[root, "\\Microsoft Visual Studio"]);
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
                let tools = joined(&[&studio, "\\", year, "\\", edition, "\\VC\\Tools\\MSVC"]);
                if let Some(toolset) = newest_version(&tools, "\\include\\vcruntime.h") {
                    dirs.push(joined(&[&toolset, "\\include"]));
                    break 'compiler;
                }
            }
        }
    }
    // <ProgramFiles(x86)>\Windows Kits\10\Include\<version>\{ucrt,shared,um}
    for root in &program_files {
        let kits = joined(&[root, "\\Windows Kits\\10\\Include"]);
        if let Some(sdk) = newest_version(&kits, "\\ucrt\\stdio.h") {
            for part in ["\\ucrt", "\\shared", "\\um"] {
                let dir = joined(&[&sdk, part]);
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
        .filter(|name| bun_sys::exists(joined(&[dir, "\\", name, marker]).as_bytes()))
        .max_by_key(|name| version(name))
        .map(|name| joined(&[dir, "\\", &name]))
}
