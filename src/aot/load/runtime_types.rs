use std::sync::OnceLock;

use bun_builtin_sources::Archive;

use crate::builtins::{BuiltinName, table};

pub(crate) const TYPE_ROOT: &[u8] = b"/$bun/packages/node_modules/@types";
pub(crate) const GLOBALS_OF_TEST_RUNNER: &[u8] =
    b"/$bun/packages/node_modules/bun-types/test-globals.d.ts";

pub(crate) const OTHER_NAMES_OF_TEST_RUNNER_PATH: &[u8] = b"/$bun/types/test-runner.d.ts";
pub(crate) const OTHER_NAMES_OF_TEST_RUNNER: &[u8] = b"declare module \"@jest/globals\" {
  export * from \"bun:test\";
}
declare module \"vitest\" {
  export * from \"bun:test\";
}
";

pub(crate) const GLOBALS_THAT_NOTHING_DECLARES_PATH: &[u8] = b"/$bun/types/globals.d.ts";

// Each global of the run time, of type `any`. It counts for a name that nothing else declares: `self`, `onerror`.
pub(crate) fn globals_that_nothing_declares() -> &'static [u8] {
    static TEXT: OnceLock<Vec<u8>> = OnceLock::new();
    TEXT.get_or_init(|| {
        let is_start = |byte: u8| byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$');
        let mut text = Vec::new();
        for name in (0..BuiltinName::COUNT).map(BuiltinName) {
            let written = table::text_of_name(name);
            let is_identifier = written.first().is_some_and(|&first| is_start(first))
                && (written.iter()).all(|&byte| is_start(byte) || byte.is_ascii_digit());
            let is_known_by_itself = matches!(written, b"undefined" | b"globalThis");
            if is_identifier
                && !is_known_by_itself
                && !table::is_symbol_name(name)
                && table::global(name).is_some()
            {
                text.extend_from_slice(&[b"declare var ", written, b": any;\n"].concat());
            }
        }
        text
    })
}

/// The module "bun" of a project that has not installed Bun's types. `tsc` finds no such module, and `any` in place of what
/// is imported from it. `int32` is a promise to the build, so a value that breaks it is an error there too.
pub(crate) const PROMISED_TYPES_PATH: &[u8] = b"/$bun/types/promised.d.ts";
pub(crate) const PROMISED_TYPES: &[u8] = b"declare module \"bun\" {
  export type int32 = number;
}
";

pub(crate) const PACKAGES: &[u8] = b"/$bun/packages/node_modules/";
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

/// Every file of the packages, with its path.
pub(crate) fn read_all() -> impl Iterator<Item = (Vec<u8>, Vec<u8>)> {
    Archive::names_that_begin_with(IN_ARCHIVE).filter_map(|name| {
        let path = [PACKAGES, &name[IN_ARCHIVE.len()..]].concat();
        Some((path, Archive::read(name)?))
    })
}

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
    use bstr::BStr;
    use bun_ast::import_record::is_test_module;
    use bun_core::strings::contains;
    use bun_sema::resolve::is_declaration_file_name;

    use super::*;
    use crate::load::is_host_path;

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
    }

    #[test]
    fn other_names_of_test_runner_re_export_bun_test() {
        let path = OTHER_NAMES_OF_TEST_RUNNER_PATH;
        assert!(is_host_path(path) && is_declaration_file_name(path));
        assert!(!is_file(path));
        for name in [&b"@jest/globals"[..], b"vitest"] {
            assert!(is_test_module(name), "{}", BStr::new(name));
            let module = [
                &b"declare module \""[..],
                name,
                b"\" {\n  export * from \"bun:test\";\n}\n",
            ]
            .concat();
            assert!(
                contains(OTHER_NAMES_OF_TEST_RUNNER, &module),
                "{}",
                BStr::new(name)
            );
        }
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
