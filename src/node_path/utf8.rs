//! For callers that have the bytes of a path, and the working directory that the process has.

use bun_core::strings::{self, PathByte};

use crate::{Answer, CodeUnits, Failure, Resolved, Scratch};

fn to_bytes(text: CodeUnits<'_>) -> Vec<u8> {
    match text {
        CodeUnits::U8(bytes) => bytes.to_vec(),
        CodeUnits::U16(utf16) => strings::to_utf8_alloc(utf16),
    }
}

fn unfailing<T>(result: Result<T, Failure>) -> T {
    result.unwrap_or_else(|_| bun_core::out_of_memory())
}

/// What a function answered whose operands are `paths`.
fn owned(answer: Answer<'_>, paths: &[CodeUnits<'_>]) -> Vec<u8> {
    match answer {
        Answer::Operand(index) => to_bytes(paths[index]),
        Answer::Part(index, range) => {
            of_either_width!(paths[index], |path| to_bytes(PathByte::units(&path[range])))
        }
        Answer::Text(text) => to_bytes(text),
        Answer::Upwards(upwards) if upwards.is_wide() => {
            strings::to_utf8_alloc(unfailing(upwards.written(&mut Scratch::new())))
        }
        Answer::Upwards(upwards) => {
            let mut text = Vec::with_capacity(upwards.len());
            bun_core::vec::append_with(&mut text, upwards.len(), |to| upwards.write(to));
            text
        }
    }
}

/// The path, or the drive whose working directory it takes.
fn owned_if_resolved(
    resolved: Result<Resolved<'_>, Failure>,
    paths: &[CodeUnits<'_>],
) -> Result<Vec<u8>, Option<u8>> {
    match unfailing(resolved) {
        Resolved::Answer(answer) => Ok(owned(answer, paths)),
        Resolved::Needs(drive) => Err(drive),
    }
}

fn working_directory() -> &'static [u8] {
    bun_core::working_directory_in_executable().unwrap_or_else(|| {
        bun_paths::without_trailing_sep(bun_paths::fs::FileSystem::instance().top_level_dir())
    })
}

pub mod posix {
    use super::{CodeUnits, Scratch, owned, owned_if_resolved, unfailing, working_directory};
    use crate::posix;

    pub fn dirname(path: &[u8]) -> &[u8] {
        posix::dirname(path).map_or(b".", |end| &path[..end])
    }

    pub fn normalize(path: &[u8]) -> Vec<u8> {
        let mut scratch = Scratch::new();
        let normalized = unfailing(posix::normalize(path, &mut scratch));
        owned(normalized, &[CodeUnits::U8(path)])
    }

    pub fn join<const N: usize>(paths: [&[u8]; N]) -> Vec<u8> {
        let paths = &paths.map(CodeUnits::U8)[..];
        match unfailing(posix::join(paths, &mut Scratch::new())) {
            Some(joined) => owned(joined, paths),
            None => b".".to_vec(),
        }
    }

    pub fn resolve<const N: usize>(paths: [&[u8]; N]) -> Vec<u8> {
        resolve_all(&paths.map(CodeUnits::U8))
    }

    fn resolve_all(paths: &[CodeUnits<'_>]) -> Vec<u8> {
        let resolve_from = |directory: Option<&[u8]>| {
            let (directory, mut scratch) = (directory.map(CodeUnits::U8), Scratch::new());
            owned_if_resolved(posix::resolve(directory, paths, &mut scratch), paths)
        };
        resolve_from(None).unwrap_or_else(|_| {
            let mut scratch = Scratch::new();
            let directory = if cfg!(windows) {
                unfailing(crate::respell(working_directory(), false, &mut scratch))
            } else {
                working_directory()
            };
            resolve_from(Some(directory)).expect("it has been given what it needs")
        })
    }

    pub fn relative(from: &[u8], to: &[u8]) -> Vec<u8> {
        let (from, to) = (resolve([from]), resolve([to]));
        let paths = [CodeUnits::U8(&from), CodeUnits::U8(&to)];
        let relative = unfailing(posix::relative_of_resolved(paths[0], paths[1]));
        owned(relative, &paths)
    }
}

pub mod win32 {
    use super::{
        CodeUnits, Scratch, owned, owned_if_resolved, strings, unfailing, working_directory,
    };
    use crate::win32;

    /// Calls `with` with `paths` in UTF-16, which is what lengths and case go by, unless they are ASCII or not UTF-8 at all.
    fn decoded<const N: usize>(
        paths: [&[u8]; N],
        with: impl FnOnce(&[CodeUnits<'_>]) -> Vec<u8>,
    ) -> Vec<u8> {
        let is_ascii = paths.iter().all(|path| strings::is_all_ascii(path));
        if is_ascii || !paths.iter().all(|path| strings::is_valid_utf8(path)) {
            return with(&paths.map(CodeUnits::U8));
        }
        let wide = paths.map(|path| {
            strings::to_utf16_alloc_for_real(path, false, false)
                .unwrap_or_else(|_| bun_core::out_of_memory())
        });
        with(&wide.each_ref().map(|path| CodeUnits::U16(path)))
    }

    pub fn dirname(path: &[u8]) -> &[u8] {
        win32::dirname(path).map_or(b".", |end| &path[..end])
    }

    pub fn normalize(path: &[u8]) -> Vec<u8> {
        decoded([path], |paths| {
            let mut scratch = Scratch::new();
            let normalized = of_either_width!(paths[0], |it| win32::normalize(it, &mut scratch));
            owned(unfailing(normalized), paths)
        })
    }

    pub fn join<const N: usize>(paths: [&[u8]; N]) -> Vec<u8> {
        decoded(paths, |paths| {
            let mut scratch = Scratch::new();
            match unfailing(win32::join(paths, &mut scratch)) {
                Some(joined) => owned(joined, paths),
                None => owned(unfailing(win32::concatenate(paths, &mut scratch)), paths),
            }
        })
    }

    /// Only what is ASCII makes a difference to it.
    pub fn resolve<const N: usize>(paths: [&[u8]; N]) -> Vec<u8> {
        resolve_all(&paths.map(CodeUnits::U8))
    }

    fn resolve_all(paths: &[CodeUnits<'_>]) -> Vec<u8> {
        let resolve_from = |directory: Option<&[u8]>| {
            let (directory, mut scratch) = (directory.map(CodeUnits::U8), Scratch::new());
            owned_if_resolved(win32::resolve(directory, paths, &mut scratch), paths)
        };
        resolve_from(None).unwrap_or_else(|drive| {
            let of_drive = drive.and_then(win32::working_directory_of_drive);
            let of_drive = of_drive.map(|directory| strings::to_utf8_alloc(&directory));
            let directory = match of_drive.as_deref() {
                None | Some([]) => working_directory(),
                Some(directory) => directory,
            };
            resolve_from(Some(directory)).expect("it has been given what it needs")
        })
    }

    pub fn relative(from: &[u8], to: &[u8]) -> Vec<u8> {
        let (from, to) = (resolve([from]), resolve([to]));
        decoded([&from, &to], |paths| {
            let relative = unfailing(win32::relative_of_resolved(paths[0], paths[1]));
            owned(relative, paths)
        })
    }

    pub fn to_namespaced_path(path: &[u8]) -> Vec<u8> {
        if path.is_empty() {
            return Vec::new();
        }
        let resolved = resolve([path]);
        match resolved[..] {
            _ if strings::element_length_utf8_into_utf16(&resolved) <= 2 => path.to_vec(),
            [b'\\', b'\\', b'?' | b'.', ..] => resolved,
            [b'\\', b'\\', ref share @ ..] => [br"\\?\UNC\", share].concat(),
            [drive, b':', b'\\', ..] if drive.is_ascii_alphabetic() => {
                [br"\\?\", &resolved[..]].concat()
            }
            _ => resolved,
        }
    }
}
