//! The declarations of what the run time provides: `bun-types` and the packages that it rests on, as the executable of Bun holds them. A build reads them where a project has not installed `@types/bun`.

use bun_builtin_sources::Archive;

pub(crate) const TYPE_ROOT: &[u8] = b"/$bun/packages/node_modules/@types";
pub(crate) const GLOBALS_OF_TEST_RUNNER: &[u8] =
    b"/$bun/packages/node_modules/bun-types/test-globals.d.ts";

const PACKAGES: &[u8] = b"/$bun/packages/node_modules/";
const IN_ARCHIVE: &[u8] = b"types/";

fn name_in_archive(path: &[u8]) -> Option<Vec<u8>> {
    Some([IN_ARCHIVE, path.strip_prefix(PACKAGES)?].concat())
}

fn name_of_directory(path: &[u8]) -> Option<Vec<u8>> {
    name_in_archive(&[path, b"/"].concat())
}

pub(crate) fn is_file(path: &[u8]) -> bool {
    name_in_archive(path).is_some_and(|name| Archive::has(&name))
}

pub(crate) fn is_dir(path: &[u8]) -> bool {
    name_of_directory(path)
        .is_some_and(|name| Archive::names_that_begin_with(&name).next().is_some())
}

pub(crate) fn read(path: &[u8]) -> Option<Vec<u8>> {
    Archive::read(&name_in_archive(path)?)
}

/// The files and the directories.
pub(crate) fn entries(path: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
    let (mut files, mut directories): (Vec<Vec<u8>>, Vec<Vec<u8>>) = Default::default();
    let Some(directory) = name_of_directory(path) else {
        return (files, directories);
    };
    for name in Archive::names_that_begin_with(&directory) {
        let rest = &name[directory.len()..];
        match bun_core::strings::index_of_char_usize(rest, b'/') {
            None => files.push(rest.to_vec()),
            Some(end) if directories.last().is_none_or(|last| last != &rest[..end]) => {
                directories.push(rest[..end].to_vec());
            }
            Some(_) => {}
        }
    }
    (files, directories)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_the_packages_as_an_install_lays_them_out() {
        for file in [
            "@types/bun/package.json",
            "@types/bun/index.d.ts",
            "@types/node/package.json",
            "@types/node/LICENSE",
            "@types/node/fs/promises.d.ts",
            "bun-types/index.d.ts",
            "undici-types/index.d.ts",
            "undici-types/LICENSE",
        ] {
            let path = [PACKAGES, file.as_bytes()].concat();
            assert!(is_file(&path) && !is_dir(&path), "{file}");
            assert!(read(&path).is_some_and(|text| !text.is_empty()), "{file}");
        }
        assert!(is_file(GLOBALS_OF_TEST_RUNNER));
        for directory in [TYPE_ROOT, &PACKAGES[..PACKAGES.len() - 1]] {
            assert!(is_dir(directory) && !is_file(directory));
        }
        assert_eq!(
            entries(TYPE_ROOT),
            (vec![], vec![b"bun".to_vec(), b"node".to_vec()])
        );
        assert!(!is_dir(
            b"/$bun/packages/node_modules/bun-types/node_modules"
        ));
        assert!(!is_file(b"/$bun/types/runtime.d.ts"));
    }

    #[test]
    fn keeps_copyright_notices() {
        for file in [
            "@types/node/index.d.ts",
            "bun-types/test.d.ts",
            "bun-types/vendor/expect-type/index.d.ts",
        ] {
            let text = read(&[PACKAGES, file.as_bytes()].concat()).unwrap();
            assert!(text.windows(9).any(|word| word == b"Copyright"), "{file}");
        }
    }
}
