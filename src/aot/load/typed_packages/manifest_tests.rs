use super::*;
use crate::compile::testing::{TemporaryDirectory, set_up_output};
use bun_sema_driver::host::{AlreadyRead, from_native};

const CODE: &str = "exports.x = 1;\n";
const P: (&str, &str) = ("p", "1.0.0");
const Q: (&str, &str) = ("q", "1.0.0");
const NOT_JSON: &str = "full-types.json is not valid JSON";
const NO_FORMAT: &str = "\"format\" in full-types.json is missing or not valid";
const NO_NAME: &str = "\"name\" in full-types.json is missing or not valid";
const NO_VERSION: &str = "\"version\" in full-types.json is missing or not valid";
const INVALID_WHEN: &str = "\"when\" in full-types.json is missing or not valid";
const INVALID_LAY: &str = "\"lay\" in full-types.json is missing or not valid";
const OTHER_NAME: &str = "the \"name\" in full-types.json is \"q\", but the folder is for \"p\"";
const UNSUPPORTED_FORMAT: &str =
    "this version of Bun doesn't support the \"format\" in full-types.json";
const INVALID_NEEDS: &str = "\"needs\" in full-types.json must be a list of package names";
const EMPTY_LAY: &str = "\"lay\" in full-types.json is empty";
const ADDS_FILE: &str = "they add y.ts, and full types can only replace installed files";
const OTHER_VERSION: &str = "they are for version 1.0.0, but 1.0.1 is installed. \
                             Replace them with the full types for 1.0.1, or remove them";
const NEEDS_PRODUCTION: &str = "they need process.env.NODE_ENV to be defined as \"production\". \
                                Pass --define 'process.env.NODE_ENV=\"production\"'";
const NEEDS_Q: &str = "they need the full types of \"q\", which are not used";

struct Project {
    directory: TemporaryDirectory,
}

impl Project {
    fn new(name: &str) -> Project {
        let directory = TemporaryDirectory::new(&format!("sound_manifest_{name}"));
        let project = Project { directory };
        project.install("node_modules/p", "p", "1.0.0");
        project.add_typed_version("p", &manifest("p", ""));
        project
    }

    fn install(&self, at: &str, name: &str, version: &str) {
        let package_json = format!(r#"{{"name":"{name}","version":"{version}"}}"#);
        self.directory
            .write(&format!("{at}/package.json"), &package_json);
        self.directory.write(&format!("{at}/x.js"), CODE);
    }

    fn add_typed_version(&self, name: &str, manifest: &str) {
        self.directory
            .write(&format!(".full-types/{name}/full-types.json"), manifest);
        self.directory
            .write(&format!(".full-types/{name}/lay/x.js"), CODE);
    }

    fn with_packages<R>(&self, then: impl FnOnce(&TypedPackages<'_>, &[u8]) -> R) -> R {
        set_up_output();
        let root = from_native(self.directory.path());
        let disk = Disk::with_already_read(1, AlreadyRead::default(), &root);
        then(&TypedPackages::new(&disk, &root), &root)
    }

    fn find_mismatch(
        &self,
        (name, version): (&str, &str),
        defines: &[(&str, &str)],
    ) -> Option<String> {
        let defined = |path: &[u8]| {
            let define = defines.iter().find(|define| define.0.as_bytes() == path)?;
            Some(define.1.as_bytes().to_vec())
        };
        let sentence = self.with_packages(|packages, root| {
            let directory = inside(root, format!("node_modules/{name}").as_bytes());
            let package = EnclosingPackage {
                directory: &directory,
                name: name.as_bytes(),
                version: version.as_bytes(),
            };
            packages.find_manifest_mismatch(package, &defined)
        })?;
        Some(String::from_utf8(sentence).unwrap())
    }
}

fn manifest(name: &str, more: &str) -> String {
    format!(r#"{{"format":2,"name":"{name}","version":"1.0.0","lay":{{"x.js":""}}{more}}}"#)
}

#[test]
fn matching_manifest_has_no_mismatch() {
    let project = Project::new("matching");
    assert_eq!(project.find_mismatch(P, &[]), None);
    let every_field = r#","when":{},"basis":{},"needs":[],"compilerOptions":{"strict":true}"#;
    project.add_typed_version("p", &manifest("p", every_field));
    assert_eq!(project.find_mismatch(P, &[]), None);
}

#[test]
fn package_without_typed_version_has_no_mismatch() {
    let project = Project::new("no_typed_version");
    project.add_typed_version("p", "{");
    project.install("node_modules/q", "q", "1.0.0");
    assert_eq!(project.find_mismatch(Q, &[]), None);
    assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some(NOT_JSON));
}

#[test]
fn scoped_package_is_checked() {
    let project = Project::new("scoped");
    project.install("node_modules/@s/p", "@s/p", "1.0.0");
    project.add_typed_version("@s/p", &manifest("@s/p", ""));
    project.add_typed_version("p", &manifest("p", r#","needs":["@s/p"]"#));
    assert_eq!(project.find_mismatch(("@s/p", "1.0.0"), &[]), None);
    let found = project.find_mismatch(("@s/p", "1.0.1"), &[]);
    assert_eq!(found.as_deref(), Some(OTHER_VERSION));
    assert_eq!(project.find_mismatch(P, &[]), None);
}

#[test]
fn text_that_is_no_manifest_is_mismatch() {
    let project = Project::new("no_manifest");
    for (text, expected) in [
        ("{", NOT_JSON),
        (r#"{"format":2"#, NOT_JSON),
        ("", NO_FORMAT),
        ("[]", NO_FORMAT),
        ("{}", NO_FORMAT),
        (r#"{"format":"2"}"#, NO_FORMAT),
        (r#"{"format":1}"#, UNSUPPORTED_FORMAT),
        (r#"{"format":99}"#, UNSUPPORTED_FORMAT),
        (r#"{"format":2}"#, NO_NAME),
        (r#"{"format":2,"name":"p"}"#, NO_VERSION),
        (r#"{"format":2,"name":"p","version":"1.0.0"}"#, EMPTY_LAY),
    ] {
        project.add_typed_version("p", text);
        let found = project.find_mismatch(P, &[]);
        assert_eq!(found.as_deref(), Some(expected), "{text}");
    }
}

#[test]
fn field_of_wrong_shape_is_mismatch() {
    let project = Project::new("wrong_shape");
    for (more, expected) in [
        (r#","name":"q""#, OTHER_NAME),
        (r#","name":1"#, NO_NAME),
        (r#","version":1"#, NO_VERSION),
        (r#","when":[]"#, INVALID_WHEN),
        (r#","when":{"MODE":true}"#, INVALID_WHEN),
        (r#","lay":[]"#, INVALID_LAY),
        (r#","lay":{"x.js":1}"#, INVALID_LAY),
        (r#","needs":{}"#, INVALID_NEEDS),
        (r#","needs":[1]"#, INVALID_NEEDS),
        (r#","needs":["../x"]"#, INVALID_NEEDS),
        (r#","needs":["a/b"]"#, INVALID_NEEDS),
        (r#","lay":{}"#, EMPTY_LAY),
        (r#","lay":{"x.js":"","y.ts":"new"}"#, ADDS_FILE),
        (
            r#","lay":{"x.js":"","../q/x.js":""}"#,
            "\"../q/x.js\" in full-types.json is not a path inside the package",
        ),
        (
            r#","lay":{"package.json":""}"#,
            "\"package.json\" in full-types.json is not a path inside the package",
        ),
    ] {
        project.add_typed_version("p", &manifest("p", more));
        let found = project.find_mismatch(P, &[]);
        assert_eq!(found.as_deref(), Some(expected), "{more}");
    }
}

#[test]
fn first_mismatch_is_reported() {
    let project = Project::new("first_mismatch");
    let installed = ("p", "1.0.1");
    for (more, expected) in [
        (r#","format":1,"name":"q""#, UNSUPPORTED_FORMAT),
        (r#","name":"q","needs":{}"#, OTHER_NAME),
        (r#","needs":{},"lay":{"../x":""}"#, INVALID_NEEDS),
        (
            r#","lay":{"../x":"new"}"#,
            "\"../x\" in full-types.json is not a path inside the package",
        ),
        (r#","lay":{"x.js":"","y.ts":"new"}"#, ADDS_FILE),
        (
            r#","when":{"MODE":"test"},"lay":{"y.js":""},"needs":["q"]"#,
            OTHER_VERSION,
        ),
    ] {
        project.add_typed_version("p", &manifest("p", more));
        let found = project.find_mismatch(installed, &[]);
        assert_eq!(found.as_deref(), Some(expected), "{more}");
    }
    let more = r#","when":{"MODE":"test"},"lay":{"y.js":""},"needs":["q"]"#;
    project.add_typed_version("p", &manifest("p", more));
    let needs_define = "they need MODE to be defined as \"test\". Pass --define 'MODE=\"test\"'";
    assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some(needs_define));
    let defines = [("MODE", "test")];
    let found = project.find_mismatch(P, &defines);
    assert_eq!(found.as_deref(), Some("lay/y.js is missing"));
    project.directory.write(".full-types/p/lay/y.js", CODE);
    let adds_file = "they add y.js, and full types can only replace installed files";
    let found = project.find_mismatch(P, &defines);
    assert_eq!(found.as_deref(), Some(adds_file));
    project.directory.write("node_modules/p/y.js", CODE);
    assert_eq!(project.find_mismatch(P, &defines).as_deref(), Some(NEEDS_Q));
}

#[test]
fn other_installed_version_is_mismatch() {
    let project = Project::new("other_version");
    let found = project.find_mismatch(("p", "1.0.1"), &[]);
    assert_eq!(found.as_deref(), Some(OTHER_VERSION));
}

#[test]
fn build_must_define_what_manifest_states() {
    let project = Project::new("when");
    let more = r#","when":{"process.env.NODE_ENV":"production"}"#;
    project.add_typed_version("p", &manifest("p", more));
    let insufficient: [&[(&str, &str)]; 3] = [
        &[],
        &[("process.env.NODE_ENV", "staging")],
        &[("NODE_ENV", "production")],
    ];
    for defines in insufficient {
        let found = project.find_mismatch(P, defines);
        assert_eq!(found.as_deref(), Some(NEEDS_PRODUCTION), "{defines:?}");
    }
    let defines = [("MODE", "test"), ("process.env.NODE_ENV", "production")];
    assert_eq!(project.find_mismatch(P, &defines), None);
}

#[test]
fn listed_file_must_be_below_lay() {
    let project = Project::new("typed_file");
    let more = r#","lay":{"x.js":"","cjs/y.js":""}"#;
    project.add_typed_version("p", &manifest("p", more));
    let found = project.find_mismatch(P, &[]);
    assert_eq!(found.as_deref(), Some("lay/cjs/y.js is missing"));
    project.directory.write(".full-types/p/lay/cjs/y.js", CODE);
    assert_eq!(
        project.find_mismatch(P, &[]).as_deref(),
        Some("they add cjs/y.js, and full types can only replace installed files")
    );
    project.directory.write("node_modules/p/cjs/y.js", CODE);
    assert_eq!(project.find_mismatch(P, &[]), None);
}

#[test]
fn installed_bytes_are_not_compared() {
    let project = Project::new("installed_bytes");
    let more = r#","basis":{"missing.js":"00"},"lay":{"x.js":"00"}"#;
    project.add_typed_version("p", &manifest("p", more));
    project
        .directory
        .write("node_modules/p/x.js", "exports.x = 1; // patched\n");
    assert_eq!(project.find_mismatch(P, &[]), None);
}

#[test]
fn needed_package_must_have_matching_typed_version() {
    let project = Project::new("needs");
    project.add_typed_version("p", &manifest("p", r#","needs":["q"]"#));
    assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some(NEEDS_Q));
    project.install("node_modules/q", "q", "1.0.0");
    assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some(NEEDS_Q));
    project.add_typed_version("q", &manifest("q", ""));
    assert_eq!(project.find_mismatch(P, &[]), None);
    project.add_typed_version("q", &manifest("q", r#","when":{"MODE":"test"}"#));
    assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some(NEEDS_Q));
    assert_eq!(project.find_mismatch(P, &[("MODE", "test")]), None);
    project.install("node_modules/q", "q", "1.0.1");
    let found = project.find_mismatch(P, &[("MODE", "test")]);
    assert_eq!(found.as_deref(), Some(NEEDS_Q));
}

#[test]
fn packages_that_need_each_other_are_both_used() {
    let project = Project::new("needs_cycle");
    project.install("node_modules/q", "q", "1.0.0");
    project.add_typed_version("p", &manifest("p", r#","needs":["q"]"#));
    project.add_typed_version("q", &manifest("q", r#","needs":["p"]"#));
    assert_eq!(project.find_mismatch(P, &[]), None);
    assert_eq!(project.find_mismatch(Q, &[]), None);
    project.install("node_modules/q", "q", "1.0.1");
    assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some(NEEDS_Q));
    let found = project.find_mismatch(("q", "1.0.1"), &[]);
    assert_eq!(found.as_deref(), Some(OTHER_VERSION));
}

#[test]
fn need_of_needed_package_counts() {
    let project = Project::new("needs_chain");
    project.install("node_modules/q", "q", "1.0.0");
    project.add_typed_version("p", &manifest("p", r#","needs":["q"]"#));
    project.add_typed_version("q", &manifest("q", r#","needs":["r"]"#));
    let needs_r = "they need the full types of \"r\", which are not used";
    assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some(needs_r));
    project.install("node_modules/r", "r", "1.0.0");
    project.add_typed_version("r", &manifest("r", ""));
    assert_eq!(project.find_mismatch(P, &[]), None);
}

#[test]
fn needed_package_is_nearest_installed_copy() {
    let project = Project::new("needs_nearest");
    project.install("node_modules/q", "q", "1.0.0");
    project.add_typed_version("p", &manifest("p", r#","needs":["q"]"#));
    project.add_typed_version("q", &manifest("q", ""));
    assert_eq!(project.find_mismatch(P, &[]), None);
    project.install("node_modules/p/node_modules/q", "q", "2.0.0");
    assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some(NEEDS_Q));
}

#[test]
fn package_is_shown_below_sound_directory() {
    let project = Project::new("display_directory");
    project.with_packages(|packages, _| {
        assert_eq!(
            packages.display_directory_of_package(b"p"),
            b".full-types/p"
        );
        assert_eq!(
            packages.display_directory_of_package(b"@s/p"),
            b".full-types/@s/p"
        );
    });
}
