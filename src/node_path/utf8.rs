//! For callers that have bytes. Relative paths resolve against [`real_cwd`]. Out of memory ends the process.

use bun_core::UnwrapOrOom;
use bun_core::strings::{self, CodeUnits};
use bun_paths::fs::FileSystem;
use bun_paths::{PathBuffer, path_buffer_pool};

use crate::{Output, ResolveStep, Result, Scratch};

/// Where a relative path that is passed to the file system starts. Once that directory is removed, its path as of startup or the last `process.chdir()`.
pub fn real_cwd(buf: &mut PathBuffer) -> &[u8] {
    if let Some(directory) = bun_core::working_directory_in_executable() {
        return directory;
    }
    match bun_core::getcwd(buf) {
        Ok(cwd) => cwd,
        Err(_) => bun_paths::without_trailing_sep(FileSystem::instance().top_level_dir()),
    }
}

fn to_bytes(text: CodeUnits<'_>) -> Vec<u8> {
    match text {
        CodeUnits::U8(bytes) => bytes.to_vec(),
        CodeUnits::U16(utf16) => strings::to_utf8_alloc(utf16),
    }
}

fn into_bytes(output: Output<'_>, args: &[CodeUnits<'_>]) -> Vec<u8> {
    match output {
        Output::Arg(index) => to_bytes(args[index]),
        Output::ArgSlice(index, range) => to_bytes(args[index].slice(range)),
        Output::Built(text) => to_bytes(text),
        Output::DotDots(dotdots) if dotdots.is_16bit() => {
            strings::to_utf8_alloc(dotdots.to_utf16_in(&mut Scratch::new()).unwrap_or_oom())
        }
        Output::DotDots(dotdots) => {
            let mut bytes = Vec::with_capacity(dotdots.len());
            bun_core::vec::append_with(&mut bytes, dotdots.len(), |to| dotdots.write(to));
            bytes
        }
    }
}

fn step_into_bytes(step: Result<ResolveStep<Output<'_>>>, args: &[CodeUnits<'_>]) -> Vec<u8> {
    into_bytes(step.unwrap_or_oom().unwrap_done(), args)
}

pub mod posix {
    use super::*;
    use crate::posix;

    pub fn dirname(path: &[u8]) -> &[u8] {
        posix::dirname(path).map_or(b".", |end| &path[..end])
    }

    pub fn normalize(path: &[u8]) -> Vec<u8> {
        let mut scratch = Scratch::new();
        let normalized = posix::normalize(path, &mut scratch).unwrap_or_oom();
        into_bytes(normalized, &[CodeUnits::U8(path)])
    }

    pub fn join<const N: usize>(paths: [&[u8]; N]) -> Vec<u8> {
        let paths = &paths.map(CodeUnits::U8)[..];
        let mut scratch = Scratch::new();
        let joined = posix::join(paths, &mut scratch).unwrap_or_oom();
        into_bytes(joined.unwrap_or(Output::DOT), paths)
    }

    pub fn resolve<const N: usize>(paths: [&[u8]; N]) -> Vec<u8> {
        resolve_slice(&paths.map(CodeUnits::U8))
    }

    fn resolve_slice(paths: &[CodeUnits<'_>]) -> Vec<u8> {
        let (mut scratch, mut cwd_scratch) = (Scratch::new(), Scratch::new());
        if let ResolveStep::Done(output) = posix::resolve(None, paths, &mut scratch).unwrap_or_oom()
        {
            return into_bytes(output, paths);
        }
        let mut buf = path_buffer_pool::get();
        let mut cwd = real_cwd(&mut buf);
        if cfg!(windows) {
            cwd = posix::cwd_from_win32(cwd, &mut cwd_scratch).unwrap_or_oom();
        }
        let cwd = Some(CodeUnits::U8(cwd));
        step_into_bytes(posix::resolve(cwd, paths, &mut scratch), paths)
    }

    pub fn relative(from: &[u8], to: &[u8]) -> Vec<u8> {
        let (from, to) = (resolve([from]), resolve([to]));
        let args = [CodeUnits::U8(&from), CodeUnits::U8(&to)];
        into_bytes(posix::relative_of_resolved(args[0], args[1]), &args)
    }
}

pub mod win32 {
    use super::*;
    use crate::win32;

    /// Lengths and case are defined on UTF-16. ASCII needs no decoding, and invalid UTF-8 is passed through.
    fn with_code_units<const N: usize>(
        paths: [&[u8]; N],
        callback: impl FnOnce(&[CodeUnits<'_>]) -> Vec<u8>,
    ) -> Vec<u8> {
        let is_ascii = paths.iter().all(|path| strings::is_all_ascii(path));
        if is_ascii || !paths.iter().all(|path| strings::is_valid_utf8(path)) {
            return callback(&paths.map(CodeUnits::U8));
        }
        let utf16 =
            paths.map(|path| strings::to_utf16_alloc_for_real(path, false, false).unwrap_or_oom());
        callback(&utf16.each_ref().map(|path| CodeUnits::U16(path)))
    }

    pub fn dirname(path: &[u8]) -> &[u8] {
        win32::dirname(path).map_or(b".", |end| &path[..end])
    }

    pub fn normalize(path: &[u8]) -> Vec<u8> {
        with_code_units([path], |args| {
            let mut scratch = Scratch::new();
            let normalized = match_code_units!(args[0], |it| win32::normalize(it, &mut scratch));
            into_bytes(normalized.unwrap_or_oom(), args)
        })
    }

    pub fn join<const N: usize>(paths: [&[u8]; N]) -> Vec<u8> {
        with_code_units(paths, |args| {
            let mut scratch = Scratch::new();
            let joined = win32::join(args, &mut scratch).unwrap_or_oom();
            into_bytes(joined.unwrap_or(Output::DOT), args)
        })
    }

    /// Only ASCII units are significant to it.
    pub fn resolve<const N: usize>(paths: [&[u8]; N]) -> Vec<u8> {
        resolve_slice(&paths.map(CodeUnits::U8))
    }

    fn resolve_slice(paths: &[CodeUnits<'_>]) -> Vec<u8> {
        let mut scratch = Scratch::new();
        let drive_cwd = match win32::resolve(None, paths, &mut scratch).unwrap_or_oom() {
            ResolveStep::Done(output) => return into_bytes(output, paths),
            ResolveStep::NeedsCwd => None,
            ResolveStep::NeedsDriveCwd(letter) => win32::drive_cwd(letter),
        };
        let drive_cwd = drive_cwd.map(|cwd| strings::to_utf8_alloc(&cwd));
        let mut buf = path_buffer_pool::get();
        let cwd = match drive_cwd.as_deref() {
            None | Some([]) => real_cwd(&mut buf),
            Some(cwd) => cwd,
        };
        let cwd = Some(CodeUnits::U8(cwd));
        step_into_bytes(win32::resolve(cwd, paths, &mut scratch), paths)
    }

    pub fn relative(from: &[u8], to: &[u8]) -> Vec<u8> {
        let (from, to) = (resolve([from]), resolve([to]));
        with_code_units([&from, &to], |args| {
            let relative = win32::relative_of_resolved(args[0], args[1]);
            into_bytes(relative.unwrap_or_oom(), args)
        })
    }

    /// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L768-L797>
    pub fn to_namespaced_path(path: &[u8]) -> Vec<u8> {
        if path.is_empty() {
            return Vec::new();
        }
        let resolved = resolve([path]);
        match resolved[..] {
            _ if strings::element_length_utf8_into_utf16(&resolved) <= 2 => path.to_vec(),
            [b'\\', b'\\', b'?' | b'.', ..] => resolved,
            [b'\\', b'\\', ref unc @ ..] => [br"\\?\UNC\", unc].concat(),
            [drive, b':', b'\\', ..] if drive.is_ascii_alphabetic() => {
                [br"\\?\", &resolved[..]].concat()
            }
            _ => resolved,
        }
    }
}
