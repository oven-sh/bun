use super::*;
use crate::compile::testing::{TemporaryDirectory, describe_messages, set_up_output};
use crate::compile::{Build, LoadedBuild};
use crate::engine::ExecutableIdentity;
use crate::load::source_provider::WithoutServices;
use crate::options::{LoadOptions, Options, PathOptions, RemovableOptions};
use crate::statistics::{LimitValues, StatisticId, Statistics};
use bun_ast::Log;
use bun_options_types::aot_options::AotOptions;
use bun_sema::resolve::{CodeOptions, Options as CheckerOptions, Resolver};
use bun_sema::session::Session;
use bun_sema_driver::host::{AlreadyRead, from_native};
use bun_sema_driver::{Libs, ThreadCaches};
use std::num::NonZeroU32;

const INSTALLED_FILE: &str = "node_modules/p/cjs/x.js";
const INSTALLED_CODE: &str = "exports.x = 1;\n";

struct Project {
    directory: TemporaryDirectory,
}

impl Project {
    fn new(name: &str) -> Project {
        let directory = TemporaryDirectory::new(&format!("typed_packages_{name}"));
        Project { directory }
    }

    fn with_typed_package(name: &str) -> Project {
        let project = Project::new(name);
        project.install("node_modules/p", "p", "1.0.0");
        project.add_typed_version("p");
        project
    }

    fn root(&self) -> Vec<u8> {
        from_native(self.directory.path())
    }

    fn path(&self, relative: &str) -> Vec<u8> {
        inside(&self.root(), relative.as_bytes())
    }

    fn write(&self, relative: &str, text: &str) {
        self.directory.write(relative, text);
    }

    #[cfg(unix)]
    #[allow(clippy::disallowed_methods)]
    fn link(&self, relative: &str, target: &str) {
        use std::os::unix::ffi::OsStrExt;
        let directory = std::path::Path::new(std::ffi::OsStr::from_bytes(self.directory.path()));
        std::os::unix::fs::symlink(directory.join(target), directory.join(relative)).unwrap();
    }

    fn install(&self, directory: &str, name: &str, version: &str) {
        let manifest = format!(r#"{{"name":"{name}","version":"{version}"}}"#);
        self.write(&format!("{directory}/package.json"), &manifest);
        self.write(&format!("{directory}/cjs/x.js"), INSTALLED_CODE);
    }

    fn add_typed_version(&self, folder: &str) {
        let manifest = sound_manifest(folder, &["cjs/x.js"]);
        self.write(&format!(".sound/{folder}/sound.json"), &manifest);
        self.write(&format!(".sound/{folder}/lay/cjs/x.js"), INSTALLED_CODE);
    }
}

fn sound_manifest(name: &str, replaced_files: &[&str]) -> String {
    let entries = replaced_files.iter().map(|path| format!(r#""{path}":"""#));
    let lay = entries.collect::<Vec<String>>().join(",");
    format!(
        r#"{{"sound":2,"name":"{name}","version":"1.0.0","when":{{}},"lay":{{{lay}}},"needs":[]}}"#
    )
}

struct Fixture<'f, 'h> {
    packages: &'f TypedPackages<'f>,
    resolver: &'f Resolver<'h>,
}

impl Fixture<'_, '_> {
    fn typed_version(&self, path: &[u8]) -> Option<Vec<u8>> {
        let package = self.resolver.enclosing_package(path);
        self.packages.typed_version(path, package)
    }

    fn package_names(&self) -> Vec<&[u8]> {
        let found = self.packages.packages.iter();
        found.map(|package| package.name.as_slice()).collect()
    }
}

fn with_packages<R>(project: &Project, then: impl FnOnce(&Fixture<'_, '_>) -> R) -> R {
    let session = Session::new();
    let project_root = project.root();
    set_up_output();
    let disk = Disk::with_already_read(1, AlreadyRead::default(), &project_root);
    let checker_options = CheckerOptions::default();
    let code_options = CodeOptions::bun_run(&project_root);
    let resolver = Resolver::for_compile(&session, &disk, &checker_options, &code_options);
    let packages = TypedPackages::new(&disk, &project_root);
    then(&Fixture {
        packages: &packages,
        resolver: &resolver,
    })
}

fn load_project<R>(
    project: &Project,
    entry_point: &str,
    then: impl for<'b, 's> FnOnce(&LoadedBuild<'b, 's>) -> R,
) -> Result<(R, Statistics), (Statistics, String)> {
    set_up_output();
    let aot = AotOptions {
        thread_count: Some(NonZeroU32::MIN),
        ..AotOptions::default()
    };
    let root = project.directory.path();
    let entry_points = vec![entry_point.as_bytes().to_vec()];
    let options = Options {
        aot: &aot,
        executable_identity: ExecutableIdentity([0; 16]),
        image_form: None,
        entry_points: entry_points.clone(),
        code: CodeOptions::bun_run(&from_native(root)),
        typescript_libs: Libs::Bundled(bun_sema_standalone::TYPESCRIPT_LIBS),
        load: LoadOptions::new(root.to_vec()),
        paths: PathOptions {
            module_prefix: b"/$bunfs/root/".to_vec(),
            root_directory: root.to_vec(),
            entry_point_names: entry_points,
        },
        removable: RemovableOptions::default(),
    };
    let caches = ThreadCaches::default();
    let mut build = Build::new(&options, &WithoutServices, &caches, LimitValues::for_host());
    let result = build.with_loaded_projects(|_, loaded| Ok(then(&loaded)));
    let mut log = Log::init();
    build.finish(result, &mut log).map_err(|failed| {
        let stage = failed.stage.name();
        let messages = describe_messages(&log);
        let failure = format!("the build failed in stage \"{stage}\":\n{messages}");
        (failed.statistics, failure)
    })
}

#[test]
fn typed_file_is_found_by_relative_path() {
    let project = Project::with_typed_package("relative_path");
    project.write("node_modules/p/a.jsx", INSTALLED_CODE);
    project.write(".sound/p/lay/a.jsx", INSTALLED_CODE);
    with_packages(&project, |fixture| {
        let packages = fixture.packages;
        let typed = project.path(".sound/p/lay/cjs/x.js");
        let found = fixture.typed_version(&project.path(INSTALLED_FILE));
        assert_eq!(found.as_ref(), Some(&typed));
        assert_eq!(packages.script_kind(&typed), Some(ScriptKind::Ts));
        assert_eq!(packages.display_directory(&typed), b".sound/p");
        assert_eq!(packages.display_relative_path(&typed), b"lay/cjs/x.js");

        let typed = project.path(".sound/p/lay/a.jsx");
        let found = fixture.typed_version(&project.path("node_modules/p/a.jsx"));
        assert_eq!(found.as_ref(), Some(&typed));
        assert_eq!(packages.script_kind(&typed), Some(ScriptKind::Tsx));
    });
}

#[test]
fn file_without_typed_version_is_none() {
    let project = Project::with_typed_package("no_typed_file");
    project.write("node_modules/p/index.js", INSTALLED_CODE);
    project.write("node_modules/p/x.js", INSTALLED_CODE);
    project.install("node_modules/other", "other", "1.0.0");
    with_packages(&project, |fixture| {
        assert!(
            fixture
                .typed_version(&project.path(INSTALLED_FILE))
                .is_some()
        );
        assert_eq!(
            fixture.typed_version(&project.path("node_modules/p/index.js")),
            None
        );
        assert_eq!(
            fixture.typed_version(&project.path("node_modules/p/x.js")),
            None
        );
        let file_of_other_package = project.path("node_modules/other/cjs/x.js");
        assert_eq!(fixture.typed_version(&file_of_other_package), None);
    });
}

#[test]
fn file_without_package_has_no_typed_version() {
    let project = Project::with_typed_package("no_enclosing_package");
    with_packages(&project, |fixture| {
        let installed_file = project.path(INSTALLED_FILE);
        assert_eq!(fixture.packages.typed_version(&installed_file, None), None);
    });
}

#[test]
fn other_version_still_has_typed_files() {
    let project = Project::with_typed_package("other_version");
    project.install("node_modules/q/node_modules/p", "p", "2.0.0");
    with_packages(&project, |fixture| {
        let typed = project.path(".sound/p/lay/cjs/x.js");
        let nested_file = project.path("node_modules/q/node_modules/p/cjs/x.js");
        assert_eq!(
            fixture
                .typed_version(&project.path(INSTALLED_FILE))
                .as_ref(),
            Some(&typed)
        );
        assert_eq!(fixture.typed_version(&nested_file).as_ref(), Some(&typed));

        let directory = project.path("node_modules/p");
        let package = EnclosingPackage {
            directory: &directory,
            name: b"p",
            version: b"9.9.9",
        };
        let installed_file = project.path(INSTALLED_FILE);
        let found = fixture
            .packages
            .typed_version(&installed_file, Some(package));
        assert_eq!(found, Some(typed));
        let mismatch = fixture.packages.find_manifest_mismatch(package, &|_| None);
        let expected = b"it is for version 1.0.0, but 9.9.9 is installed. \
                         Replace it with the typed version for 9.9.9, or remove it";
        assert_eq!(mismatch.as_deref(), Some(&expected[..]));
    });
}

#[test]
fn package_manifest_has_no_typed_version() {
    let project = Project::with_typed_package("package_manifest");
    project.write(".sound/p/lay/package.json", "{}");
    project.write("node_modules/p/dist/package.json", "{}");
    project.write(".sound/p/lay/dist/package.json", "{}");
    with_packages(&project, |fixture| {
        assert_eq!(
            fixture.typed_version(&project.path("node_modules/p/package.json")),
            None
        );
        let nested_manifest = project.path("node_modules/p/dist/package.json");
        let typed = project.path(".sound/p/lay/dist/package.json");
        assert_eq!(fixture.typed_version(&nested_manifest), Some(typed));
    });
}

#[test]
fn scoped_package_is_found() {
    let project = Project::new("scoped_package");
    project.install("node_modules/@s/p", "@s/p", "1.0.0");
    project.add_typed_version("@s/p");
    project.add_typed_version("@s-x");
    project.add_typed_version("b");
    project.write(".sound/notes/readme.txt", "");
    with_packages(&project, |fixture| {
        let expected: [&[u8]; 3] = [b"@s-x", b"@s/p", b"b"];
        assert_eq!(fixture.package_names(), expected);

        let typed = project.path(".sound/@s/p/lay/cjs/x.js");
        let found = fixture.typed_version(&project.path("node_modules/@s/p/cjs/x.js"));
        assert_eq!(found.as_ref(), Some(&typed));
        assert_eq!(fixture.packages.script_kind(&typed), Some(ScriptKind::Ts));
        assert_eq!(fixture.packages.display_directory(&typed), b".sound/@s/p");
        assert_eq!(
            fixture.packages.display_relative_path(&typed),
            b"lay/cjs/x.js"
        );
    });
}

#[test]
fn directory_without_valid_name_or_manifest_is_no_package() {
    let project = Project::new("invalid_names");
    project.add_typed_version("group/member");
    project.add_typed_version("@s/p/deeper");
    project.write(".sound/without-manifest/lay/cjs/x.js", INSTALLED_CODE);
    project.add_typed_version("valid");
    with_packages(&project, |fixture| {
        let expected: [&[u8]; 1] = [b"valid"];
        assert_eq!(fixture.package_names(), expected);
        for folder in ["group/member", "@s/p/deeper", "without-manifest"] {
            let typed = project.path(&format!(".sound/{folder}/lay/cjs/x.js"));
            assert_eq!(fixture.packages.script_kind(&typed), None, "{folder}");
        }
    });
}

#[cfg(unix)]
#[test]
fn linked_package_is_found_by_real_path() {
    const STORE: &str = "node_modules/.store/linked@1.0.0/node_modules/linked";
    let project = Project::new("linked");
    project.install(STORE, "linked", "1.0.0");
    project.add_typed_version("linked");
    project.link("node_modules/linked", STORE);
    with_packages(&project, |fixture| {
        let link = project.path("node_modules/linked");
        let real_file = fixture.packages.disk.realpath(&inside(&link, b"cjs/x.js"));
        assert_eq!(real_file, inside(&project.path(STORE), b"cjs/x.js"));
        let typed = project.path(".sound/linked/lay/cjs/x.js");
        assert_eq!(fixture.typed_version(&real_file), Some(typed));
    });
}

#[test]
fn nameless_manifest_does_not_hide_package() {
    let files = ["dist/index.js", "lib/index.js"];
    let project = Project::new("nameless_manifest");
    project.install("node_modules/s", "s", "1.0.0");
    project.write("node_modules/s/dist/package.json", r#"{"type":"module"}"#);
    let empty_name = r#"{"name":"","version":"0"}"#;
    project.write("node_modules/s/lib/package.json", empty_name);
    project.add_typed_version("s");
    for file in files {
        project.write(&format!("node_modules/s/{file}"), INSTALLED_CODE);
        project.write(&format!(".sound/s/lay/{file}"), INSTALLED_CODE);
    }
    with_packages(&project, |fixture| {
        for file in files {
            let typed = fixture.typed_version(&project.path(&format!("node_modules/s/{file}")));
            let expected = project.path(&format!(".sound/s/lay/{file}"));
            assert_eq!(typed, Some(expected), "{file}");
        }
    });
}

#[test]
fn only_files_below_lay_are_typed_files() {
    let project = Project::with_typed_package("script_kind");
    with_packages(&project, |fixture| {
        let kind_of = |relative: &str| fixture.packages.script_kind(&project.path(relative));
        assert_eq!(kind_of(".sound/p/lay/cjs/x.js"), Some(ScriptKind::Ts));
        assert_eq!(kind_of(".sound/p/lay/missing.js"), Some(ScriptKind::Ts));
        assert_eq!(kind_of(".sound/p/sound.json"), None);
        assert_eq!(kind_of(".sound/p/notes/x.js"), None);
        assert_eq!(kind_of(".sound/q/lay/x.js"), None);
        assert_eq!(kind_of(INSTALLED_FILE), None);
        assert_eq!(kind_of("lay/x.js"), None);
    });
}

#[test]
fn shipped_version_directory_is_relative_to_project() {
    let project = Project::new("shipped_version");
    with_packages(&project, |fixture| {
        let packages = fixture.packages;
        let typed = project.path("node_modules/s/dist/index.aot.ts");
        assert_eq!(packages.display_directory(&typed), b"node_modules/s/dist");
        assert_eq!(packages.display_relative_path(&typed), b"index.aot.ts");
        let outside_project = b"/other/s/index.aot.ts";
        assert_eq!(packages.display_directory(outside_project), b"/other/s");
        assert_eq!(
            packages.display_relative_path(outside_project),
            b"index.aot.ts"
        );
    });
}

#[test]
fn project_without_typed_packages_has_no_typed_files() {
    let project = Project::new("no_typed_packages");
    project.install("node_modules/p", "p", "1.0.0");
    let manifest = sound_manifest("p", &["cjs/x.js"]);
    project.write("node_modules/@sound/p/sound.json", &manifest);
    project.write("node_modules/@sound/p/lay/cjs/x.js", INSTALLED_CODE);
    with_packages(&project, |fixture| {
        assert!(fixture.package_names().is_empty());
        let installed_file = project.path(INSTALLED_FILE);
        assert_eq!(fixture.typed_version(&installed_file), None);
        assert_eq!(fixture.packages.script_kind(&installed_file), None);
    });
}

#[test]
fn typed_files_are_typescript() {
    let kind_of = |name: &str| typed_script_kind(name.as_bytes());
    for name in ["x.js", "x.cjs", "x.mjs", "x.ts", "x.node", "bin/x"] {
        assert_eq!(kind_of(name), ScriptKind::Ts, "{name}");
    }
    for name in ["x.jsx", "x.tsx"] {
        assert_eq!(kind_of(name), ScriptKind::Tsx, "{name}");
    }
}

#[test]
fn relative_paths_stay_inside_package() {
    for path in ["x.js", "cjs/x.js", "dist/package.json", "..x/.y"] {
        assert!(is_valid_path(path.as_bytes()), "{path}");
    }
    for path in [
        "",
        "/x",
        "x/",
        "x//y",
        "./x",
        "..",
        "x/../y",
        "x\\y",
        "package.json",
    ] {
        assert!(!is_valid_path(path.as_bytes()), "{path}");
    }
    for name in ["react", "@s/p", "@s"] {
        assert!(is_valid_package_name(name.as_bytes()), "{name}");
    }
    for name in ["", "a/b", "@s/p/x", "@s/..", "../x"] {
        assert!(!is_valid_package_name(name.as_bytes()), "{name}");
    }
}

#[test]
fn one_rejected_file_is_compiled_from_the_installed_file() {
    let project = Project::new("one_rejected_file");
    let directory = &project.directory;
    directory.write_typed_package("export const x = 1;\n", "export const x: number = 1;\n");
    project.write("node_modules/p/y.js", "export const y = 2;\n");
    let typed_with_extra_statement = "export const y: number = 2;\nexport const z = 3;\n";
    project.write(".sound/p/lay/y.js", typed_with_extra_statement);
    project.write(
        ".sound/p/sound.json",
        &sound_manifest("p", &["x.js", "y.js"]),
    );
    let main = "import { x } from \"p\";\n\
                import { y } from \"p/y.js\";\n\
                export const sum = x + y;\n";
    project.write("app.ts", main);

    let loaded = load_project(&project, "app.ts", |_| ());
    let ((), statistics) = loaded.unwrap_or_else(|(_, failure)| panic!("{failure}"));
    assert_eq!(statistics.get(StatisticId::TypedVersionsUsed), 1);
    assert_eq!(statistics.get(StatisticId::TypedVersionsRejected), 1);
}
