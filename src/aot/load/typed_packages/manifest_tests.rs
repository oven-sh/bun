use super::*;
use crate::compile::testing::{TemporaryDirectory, set_up_output};
use bun_sema_driver::host::{AlreadyRead, from_native};

const CODE: &str = "exports.x = 1;\n";
const P: (&str, &str) = ("p", "1.0.0");
const Q: (&str, &str) = ("q", "1.0.0");
const NOT_JSON: &str = "its sound.json is not valid JSON";
const NOT_VALID: &str = "its sound.json is not valid";
const UNSUPPORTED_FORMAT: &str =
    "this version of Bun doesn't support the \"sound\" version in its sound.json";
const INVALID_NEEDS: &str = "\"needs\" in its sound.json must be a list of package names";
const EMPTY_LAY: &str = "\"lay\" in its sound.json is empty";
const ADDS_FILE: &str = "it adds y.ts, and a typed version can only replace installed files";
const OTHER_VERSION: &str = "it is for version 1.0.0, but 1.0.1 is installed. \
                             Replace it with the typed version for 1.0.1, or remove it";
const NEEDS_PRODUCTION: &str = "it needs process.env.NODE_ENV to be defined as \"production\". \
                                Pass --define 'process.env.NODE_ENV=\"production\"'";
const NEEDS_Q: &str = "it needs the typed version of \"q\", which is not used";

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
        self.directory.write(&format!("{at}/package.json"), &package_json);
        self.directory.write(&format!("{at}/x.js"), CODE);
    }

    fn add_typed_version(&self, name: &str, manifest: &str) {
        self.directory.write(&format!(".sound/{name}/sound.json"), manifest);
        self.directory.write(&format!(".sound/{name}/lay/x.js"), CODE);
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
    format!(r#"{{"sound":2,"name":"{name}","version":"1.0.0","lay":{{"x.js":""}}{more}}}"#)
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
    assert_eq!(project.find_mismatch(("@s/p", "1.0.1"), &[]).as_deref(), Some(OTHER_VERSION));
    assert_eq!(project.find_mismatch(P, &[]), None);
}

#[test]
fn text_that_is_no_manifest_is_mismatch() {
    let project = Project::new("no_manifest");
    for (text, expected) in [
        ("{", NOT_JSON),
        (r#"{"sound":2"#, NOT_JSON),
        ("", NOT_VALID),
        ("[]", NOT_VALID),
        ("{}", NOT_VALID),
        (r#"{"sound":"2"}"#, NOT_VALID),
        (r#"{"sound":1}"#, UNSUPPORTED_FORMAT),
        (r#"{"sound":99}"#, UNSUPPORTED_FORMAT),
        (r#"{"sound":2}"#, NOT_VALID),
        (r#"{"sound":2,"name":"p"}"#, NOT_VALID),
        (r#"{"sound":2,"name":"p","version":"1.0.0"}"#, EMPTY_LAY),
    ] {
        project.add_typed_version("p", text);
        assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some(expected), "{text}");
    }
}

#[test]
fn field_of_wrong_shape_is_mismatch() {
    let project = Project::new("wrong_shape");
    for (more, expected) in [
        (r#","name":"q""#, NOT_VALID),
        (r#","name":1"#, NOT_VALID),
        (r#","version":1"#, NOT_VALID),
        (r#","when":[]"#, NOT_VALID),
        (r#","when":{"MODE":true}"#, NOT_VALID),
        (r#","lay":[]"#, NOT_VALID),
        (r#","lay":{"x.js":1}"#, NOT_VALID),
        (r#","needs":{}"#, INVALID_NEEDS),
        (r#","needs":[1]"#, INVALID_NEEDS),
        (r#","needs":["../x"]"#, INVALID_NEEDS),
        (r#","needs":["a/b"]"#, INVALID_NEEDS),
        (r#","lay":{}"#, EMPTY_LAY),
        (r#","lay":{"x.js":"","y.ts":"new"}"#, ADDS_FILE),
        (
            r#","lay":{"x.js":"","../q/x.js":""}"#,
            "\"../q/x.js\" in its sound.json is not a path inside the package",
        ),
        (
            r#","lay":{"package.json":""}"#,
            "\"package.json\" in its sound.json is not a path inside the package",
        ),
    ] {
        project.add_typed_version("p", &manifest("p", more));
        assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some(expected), "{more}");
    }
}

#[test]
fn first_mismatch_is_reported() {
    let project = Project::new("first_mismatch");
    let installed = ("p", "1.0.1");
    for (more, expected) in [
        (r#","sound":1,"name":"q""#, UNSUPPORTED_FORMAT),
        (r#","name":"q","needs":{}"#, NOT_VALID),
        (r#","needs":{},"lay":{"../x":""}"#, INVALID_NEEDS),
        (
            r#","lay":{"../x":"new"}"#,
            "\"../x\" in its sound.json is not a path inside the package",
        ),
        (r#","lay":{"x.js":"","y.ts":"new"}"#, ADDS_FILE),
        (r#","when":{"MODE":"test"},"lay":{"y.js":""},"needs":["q"]"#, OTHER_VERSION),
    ] {
        project.add_typed_version("p", &manifest("p", more));
        assert_eq!(project.find_mismatch(installed, &[]).as_deref(), Some(expected), "{more}");
    }
    let more = r#","when":{"MODE":"test"},"lay":{"y.js":""},"needs":["q"]"#;
    project.add_typed_version("p", &manifest("p", more));
    let needs_define = "it needs MODE to be defined as \"test\". Pass --define 'MODE=\"test\"'";
    assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some(needs_define));
    let defines = [("MODE", "test")];
    assert_eq!(project.find_mismatch(P, &defines).as_deref(), Some("lay/y.js is missing"));
    project.directory.write(".sound/p/lay/y.js", CODE);
    assert_eq!(project.find_mismatch(P, &defines).as_deref(), Some(NEEDS_Q));
}

#[test]
fn other_installed_version_is_mismatch() {
    let project = Project::new("other_version");
    assert_eq!(project.find_mismatch(("p", "1.0.1"), &[]).as_deref(), Some(OTHER_VERSION));
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
    assert_eq!(project.find_mismatch(P, &[]).as_deref(), Some("lay/cjs/y.js is missing"));
    project.directory.write(".sound/p/lay/cjs/y.js", CODE);
    assert_eq!(project.find_mismatch(P, &[]), None);
}

#[test]
fn installed_bytes_are_not_compared() {
    let project = Project::new("installed_bytes");
    let more = r#","basis":{"missing.js":"00"},"lay":{"x.js":"00"}"#;
    project.add_typed_version("p", &manifest("p", more));
    project.directory.write("node_modules/p/x.js", "exports.x = 1; // patched\n");
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
    assert_eq!(project.find_mismatch(P, &[("MODE", "test")]).as_deref(), Some(NEEDS_Q));
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
    assert_eq!(project.find_mismatch(("q", "1.0.1"), &[]).as_deref(), Some(OTHER_VERSION));
}

#[test]
fn need_of_needed_package_counts() {
    let project = Project::new("needs_chain");
    project.install("node_modules/q", "q", "1.0.0");
    project.add_typed_version("p", &manifest("p", r#","needs":["q"]"#));
    project.add_typed_version("q", &manifest("q", r#","needs":["r"]"#));
    let needs_r = "it needs the typed version of \"r\", which is not used";
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
        assert_eq!(packages.display_directory_of_package(b"p"), b".sound/p");
        assert_eq!(packages.display_directory_of_package(b"@s/p"), b".sound/@s/p");
    });
}
