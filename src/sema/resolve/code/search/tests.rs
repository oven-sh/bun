use super::CodeImportKind::{EntryPoint, Import, Require};
use super::*;

const KINDS: [CodeImportKind; 3] = [EntryPoint, Import, Require];

const OTHER_FAILURES: [CodeFailure; 9] = [
    CodeFailure::PackageNotFound,
    CodeFailure::BuiltinModuleNotFound,
    CodeFailure::PackagePathNotExported,
    CodeFailure::PackageImportNotDefined,
    CodeFailure::InvalidModuleSpecifier,
    CodeFailure::InvalidPackageTarget,
    CodeFailure::InvalidPackageConfiguration,
    CodeFailure::UnsupportedDirectoryImport,
    CodeFailure::QueryString,
];

#[test]
fn only_module_not_found_is_refined() {
    let specifiers: [&[u8]; 3] = [b"nope", b"node:nope", b"./nope"];
    for failure in OTHER_FAILURES {
        for specifier in specifiers {
            for kind in KINDS {
                assert_eq!(refine_failure(failure, specifier, kind), failure);
            }
        }
    }
}

#[test]
fn module_not_found_is_refined_by_specifier_form() {
    let refine = |specifier: &[u8], kind: CodeImportKind| {
        refine_failure(CodeFailure::ModuleNotFound, specifier, kind)
    };
    let paths: [&[u8]; 4] = [b"./nope", b"/nope", b"pkg/nope", b"@scope/nope"];
    for kind in KINDS {
        assert_eq!(
            refine(b"node:nope", kind),
            CodeFailure::BuiltinModuleNotFound
        );
        for path in paths {
            assert_eq!(refine(path, kind), CodeFailure::ModuleNotFound);
        }
    }
    assert_eq!(refine(b"nope", Import), CodeFailure::PackageNotFound);
    assert_eq!(refine(b"nope", Require), CodeFailure::PackageNotFound);
    assert_eq!(refine(b"nope", EntryPoint), CodeFailure::ModuleNotFound);
}

#[test]
fn resolution_key_has_directory_kind_and_specifier() {
    let key = code_resolution_key(b"/p", Import, b"a");
    assert_eq!(key, code_resolution_key(b"/p", Import, b"a"));
    assert_ne!(key, code_resolution_key(b"/q", Import, b"a"));
    assert_ne!(key, code_resolution_key(b"/p", Require, b"a"));
    assert_ne!(key, code_resolution_key(b"/p", EntryPoint, b"a"));
    assert_ne!(key, code_resolution_key(b"/p", Import, b"b"));
    assert_ne!(
        code_resolution_key(b"/p/a", Import, b"b"),
        code_resolution_key(b"/p", Import, b"a/b")
    );
}
