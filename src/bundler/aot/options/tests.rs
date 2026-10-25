use std::borrow::Cow;
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;
use std::sync::Arc;

use bun_aot::options::default_loaders;
use bun_ast::runtime::ReactCompilerMode;
use bun_options_types::schema::api;

use super::*;
use crate::bake_types::Framework;
use crate::bun_fs as Fs;
use crate::options::{ForceNodeEnv, SourceMapOption, WildcardPattern};

type Configure = fn(&mut BundleOptions<'_>);

#[derive(Copy, Clone)]
struct Case<'c> {
    entry_points: &'c [&'c [u8]],
    working_directory: &'c [u8],
    file_map: Option<&'c FileMap>,
    node_path: Option<&'c [u8]>,
    omits_builtin_modules: bool,
    runs_tests: bool,
}

impl Default for Case<'_> {
    fn default() -> Self {
        Case {
            entry_points: &[b"main.ts"],
            working_directory: b"/project",
            file_map: None,
            node_path: None,
            omits_builtin_modules: false,
            runs_tests: false,
        }
    }
}

fn default_options<'a>(log: &mut Log) -> BundleOptions<'a> {
    let file_system = Fs::FileSystem::init(None).ok().expect("file system");
    let transform = api::TransformOptions {
        target: Some(api::Target::bun),
        ..Default::default()
    };
    // SAFETY: `FileSystem::init` returns the process-lifetime instance, and tests do not keep this borrow.
    let file_system = unsafe { &mut *file_system };
    BundleOptions::from_api(file_system, log, transform)
        .ok()
        .expect("default options")
}

fn convert<R>(
    case: Case<'_>,
    configure: impl FnOnce(&mut BundleOptions<'_>),
    check: impl FnOnce(Option<Options<'_>>, &Log) -> R,
) -> R {
    let mut log = Log::init();
    let mut options = default_options(&mut log);
    configure(&mut options);
    let aot = AotOptions {
        omits_builtin_modules: case.omits_builtin_modules,
        runs_tests: case.runs_tests,
        ..AotOptions::default()
    };
    let input = OptionsInput {
        bundle_options: &options,
        entry_points: case.entry_points,
        assets: &[],
        aot: &aot,
        executable_identity: ExecutableIdentity([0; 16]),
        image_form: None,
        module_prefix: b"/$bunfs/root/",
        typescript_libs: Libs::Directory(b"/project"),
        file_map: case.file_map,
        working_directory: case.working_directory,
        node_path: case.node_path,
    };
    let result = options_from_bundler(&input, &mut log);
    check(result, &log)
}

fn errors(log: &Log) -> Vec<String> {
    let messages = log.msgs.iter();
    messages
        .map(|message| bstr::BStr::new(&message.data.text).to_string())
        .collect()
}

fn convert_code(configure: impl FnOnce(&mut BundleOptions<'_>)) -> CodeOptions {
    convert(Case::default(), configure, |result, _| {
        result.expect("options").code
    })
}

#[test]
#[cfg_attr(miri, ignore)]
fn options_about_what_can_be_removed_are_passed_on() {
    let convert_removable = |configure: fn(&mut BundleOptions<'_>)| {
        convert(Case::default(), configure, |result, _| {
            result.expect("options").removable
        })
    };
    let plain = convert_removable(|options| options.minify_syntax = false);
    assert_eq!(plain, RemovableOptions::default());
    let ignoring = convert_removable(|options| options.ignore_dce_annotations = true);
    assert!(ignoring.ignores_pure_annotations && !ignoring.jsx_has_side_effects);
    let with_side_effects = convert_removable(|options| options.jsx.side_effects = true);
    assert!(with_side_effects.jsx_has_side_effects && !with_side_effects.ignores_pure_annotations);
    let minifying = convert_removable(|options| options.minify_syntax = true);
    assert!(minifying.minifies_syntax && !minifying.ignores_pure_annotations);
}

#[test]
#[cfg_attr(miri, ignore)]
fn minified_identifiers_are_passed_on() {
    let convert_flag = |configure: fn(&mut BundleOptions<'_>)| {
        convert(Case::default(), configure, |result, _| {
            result.expect("options").minifies_identifiers
        })
    };
    assert!(!convert_flag(|options| options.minify_identifiers = false));
    assert!(convert_flag(|options| options.minify_identifiers = true));
}

fn convert_load(configure: impl FnOnce(&mut BundleOptions<'_>)) -> LoadOptions {
    convert(Case::default(), configure, |result, _| {
        result.expect("options").load
    })
}

fn convert_paths(
    entry_points: &[&[u8]],
    configure: impl FnOnce(&mut BundleOptions<'_>),
) -> PathOptions {
    let case = Case {
        entry_points,
        ..Case::default()
    };
    convert(case, configure, |result, _| result.expect("options").paths)
}

fn report_errors(configure: impl FnOnce(&mut BundleOptions<'_>)) -> Vec<String> {
    convert(Case::default(), configure, |result, log| {
        assert_eq!(result.is_none(), !log.msgs.is_empty());
        errors(log)
    })
}

fn byte_lists(texts: &[&str]) -> Vec<Vec<u8>> {
    texts.iter().map(|text| text.as_bytes().to_vec()).collect()
}

fn set_framework(options: &mut BundleOptions<'_>) {
    let built_in_modules = bun_collections::StringArrayHashMap::new();
    let framework = Framework::new(built_in_modules, None, None, Vec::new());
    options.framework = Some(Box::leak(Box::new(framework)));
}

fn set_root_and_compile_name(options: &mut BundleOptions<'_>) {
    options.root_dir = Box::from(&b"src"[..]);
    options.compile_entry_point_name = Box::from(&b"app"[..]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn default_options_convert() {
    convert(
        Case::default(),
        |_| {},
        |result, log| {
            let options = result.expect("options");
            assert!(log.msgs.is_empty());
            assert_eq!(
                options.code.conditions,
                byte_lists(&["bun", "node", "node-addons", "aot"])
            );
            assert_eq!(options.load.loaders, default_loaders());
            assert_eq!(options.load.project_root, b"/project");
            assert!(options.load.runs_macros);
            assert!(!options.load.omits_builtin_modules);
            assert!(!options.load.runs_tests);
            assert_eq!(options.paths.module_prefix, b"/$bunfs/root/");
            assert_eq!(options.paths.root_directory, b"/project");
            options.debug_assert_valid();
        },
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn unsupported_values_report_argument() {
    let cases: [(Configure, &str); 22] = [
        (
            |o| o.banner = Cow::Borrowed(b"let a;"),
            "--banner with code",
        ),
        (
            |o| o.footer = Cow::Borrowed(b"let a;"),
            "--footer with code",
        ),
        (|o| o.output_format = Format::Cjs, "--format=cjs"),
        (|o| o.output_format = Format::Iife, "--format=iife"),
        (
            |o| o.output_format = Format::InternalBakeDev,
            "a development server",
        ),
        (|o| o.target = Target::Browser, "--target=browser"),
        (|o| o.target = Target::Node, "--target=node"),
        (|o| o.target = Target::BunMacro, "this target"),
        (|o| o.target = Target::ServerComponentsSsr, "this target"),
        (|o| o.bytecode = true, "--bytecode"),
        (|o| o.transform_only = true, "--no-bundle"),
        (|o| o.server_components = true, "--server-components"),
        (
            |o| o.allow_unresolved = AllowUnresolved::None,
            "--allow-unresolved",
        ),
        (
            |o| o.macro_remap.put(b"a", Default::default()).expect("oom"),
            "the \"macros\" map of bunfig.toml",
        ),
        (
            |o| o.inject = Some(Box::new([Box::from(&b"a"[..])])),
            "inject",
        ),
        (
            |o| o.react_compiler_parse_test_pragmas = true,
            "reactCompilerParseTestPragmas",
        ),
        (set_framework, "a development server"),
        (|o| o.hot_module_reloading = true, "a development server"),
        (
            |o| o.dev_server = core::ptr::NonNull::<()>::dangling().as_ptr(),
            "a development server",
        ),
        (|o| o.ignore_module_resolution_errors = true, "this command"),
        (|o| o.disable_transpilation = true, "this command"),
        (|o| o.repl_mode = true, "this command"),
    ];
    for (configure, argument) in cases {
        let messages = report_errors(configure);
        assert_eq!(messages.len(), 1, "{argument}");
        assert!(messages[0].ends_with(argument), "{}", messages[0]);
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn other_commands_report_once() {
    let messages = report_errors(|options| {
        options.ignore_module_resolution_errors = true;
        options.disable_transpilation = true;
        options.repl_mode = true;
    });
    assert_eq!(messages.len(), 1);
    assert!(messages[0].ends_with("this command"));
}

#[test]
#[cfg_attr(miri, ignore)]
fn development_server_reports_once() {
    let messages = report_errors(|options| {
        options.output_format = Format::InternalBakeDev;
        options.hot_module_reloading = true;
    });
    assert_eq!(messages.len(), 1);
}

#[test]
#[cfg_attr(miri, ignore)]
fn each_unsupported_field_reports() {
    let messages = report_errors(|options| {
        options.bytecode = true;
        options.transform_only = true;
    });
    assert_eq!(messages.len(), 2);
}

#[test]
#[cfg_attr(miri, ignore)]
fn empty_inject_is_accepted() {
    assert!(report_errors(|options| options.inject = Some(Box::default())).is_empty());
}

#[test]
fn banner_comments_are_not_code() {
    for text in [
        &b""[..],
        b"// x",
        b"/* y */",
        b"#!/usr/bin/env bun\n",
        b"#!/usr/bin/env bun",
        b" \n\t// a\n/* b */\n",
        b"// a\r\n// b\r",
        "// a\u{2028}// b\u{2029}/* c */".as_bytes(),
        "// \u{2020}let a;".as_bytes(),
        "\u{FEFF}// a".as_bytes(),
    ] {
        assert!(!has_code(text), "{}", bstr::BStr::new(text));
    }
}

#[test]
fn banner_statements_are_code() {
    for text in [
        &b"/* open"[..],
        b"\"use client\"",
        b"let a;",
        b"// a\nlet a;",
        b"// a\rlet a;",
        "// a\u{2028}let a;".as_bytes(),
        "// a\u{2029}let a;".as_bytes(),
        b"#!x\rlet a;",
        "#!x\u{2028}let a;".as_bytes(),
        b" #!/bin/sh",
    ] {
        assert!(has_code(text), "{}", bstr::BStr::new(text));
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn server_code_flags_change_nothing() {
    let describe = |load: &LoadOptions, paths: &PathOptions| format!("{load:?} {paths:?}");
    let summarize = |configure: Configure| {
        convert(Case::default(), configure, |result, _| {
            let options = result.expect("options");
            describe(&options.load, &options.paths)
        })
    };
    let expected = summarize(|_| {});
    let flags: [Configure; 4] = [
        |o| o.minify_syntax = true,
        |o| o.code_splitting = true,
        |o| o.source_map = SourceMapOption::External,
        |o| o.keep_names = true,
    ];
    for configure in flags {
        assert_eq!(summarize(configure), expected);
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn custom_conditions_append_once() {
    let code = convert_code(|options| {
        options.custom_conditions = vec![Box::from(&b"custom"[..]), Box::from(&b"bun"[..])];
        options
            .conditions
            .append_slice(&[b"development" as &[u8]])
            .expect("oom");
    });
    assert_eq!(
        code.conditions,
        byte_lists(&["bun", "node", "node-addons", "aot", "custom"])
    );
    assert_eq!(
        code.custom_conditions,
        byte_lists(&["aot", "custom", "bun"])
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn disabled_addons_remove_condition() {
    let code = convert_code(|options| {
        options.transform_options = Arc::new(api::TransformOptions {
            allow_addons: Some(false),
            ..Default::default()
        });
    });
    assert_eq!(code.conditions, byte_lists(&["bun", "node", "aot"]));
}

#[test]
#[cfg_attr(miri, ignore)]
fn symbolic_link_option_is_copied() {
    assert!(!convert_code(|_| {}).preserves_symlinks);
    assert!(convert_code(|options| options.preserve_symlinks = true).preserves_symlinks);
}

#[test]
#[cfg_attr(miri, ignore)]
fn written_configuration_path_is_absolute() {
    assert_eq!(convert_code(|_| {}).tsconfig_override, None);
    let code = convert_code(|options| {
        options.tsconfig_override = Some(Box::from(&b"config/tsconfig.build.json"[..]));
    });
    let expected = b"/project/config/tsconfig.build.json".to_vec();
    assert_eq!(code.tsconfig_override, Some(expected));
}

#[test]
#[cfg_attr(miri, ignore)]
fn computed_candidate_limit_stays_default() {
    let default_limit = CodeOptions::bun_run(b"/project").max_computed_candidates;
    assert_eq!(convert_code(|_| {}).max_computed_candidates, default_limit);
}

#[test]
#[cfg_attr(miri, ignore)]
fn node_path_splits_and_resolves() {
    let case = Case {
        node_path: Some(b"/a::relative"),
        ..Case::default()
    };
    let code = convert(case, |_| {}, |result, _| result.expect("options").code);
    assert_eq!(code.node_paths, byte_lists(&["/a", "/project/relative"]));
}

#[test]
#[cfg_attr(miri, ignore)]
fn jsx_pragma_converts() {
    let code = convert_code(|options| {
        options.jsx.runtime = jsx::Runtime::Classic;
        options.jsx.development = false;
        options.jsx.factory = jsx::MemberList::Owned(Box::new([Box::from(&b"h"[..])]));
        options.jsx.package_name = Cow::Borrowed(b"preact");
    });
    assert_eq!(code.jsx.runtime, JsxRuntime::Classic);
    assert!(!code.jsx.is_development);
    assert_eq!(code.jsx.factory, byte_lists(&["h"]));
    assert_eq!(code.jsx.fragment, byte_lists(&["React", "Fragment"]));
    assert_eq!(code.jsx.import_source, b"preact");
}

#[test]
#[cfg_attr(miri, ignore)]
fn node_env_decides_jsx_development() {
    let cases = [
        (ForceNodeEnv::Production, true, false),
        (ForceNodeEnv::Development, false, true),
        (ForceNodeEnv::Unspecified, true, true),
        (ForceNodeEnv::Unspecified, false, false),
    ];
    for (node_env, is_pragma_development, expected) in cases {
        let code = convert_code(|options| {
            options.force_node_env = node_env;
            options.jsx.development = is_pragma_development;
        });
        assert_eq!(code.forced_jsx_development, Some(expected), "{node_env:?}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn macros_and_react_compiler_follow_options() {
    let load = convert_load(|options| {
        options.no_macros = true;
        options.react_compiler = ReactCompilerMode::Ssr;
    });
    assert!(!load.runs_macros);
    assert_eq!(load.react_compiler, ReactCompilerMode::Ssr);
    assert_eq!(
        convert_load(|_| {}).react_compiler,
        ReactCompilerMode::Disabled
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn external_packages_option_marks_every_package() {
    assert!(!convert_load(|_| {}).externals.are_all_packages);
    let load = convert_load(|options| options.packages = PackagesOption::External);
    assert!(load.externals.are_all_packages);
}

#[test]
#[cfg_attr(miri, ignore)]
fn build_without_external_option_has_no_externals() {
    assert!(convert_load(|_| {}).externals.is_empty());
    let load = convert_load(|options| {
        options.external.patterns.push(WildcardPattern {
            prefix: Box::from(&b"@scope/"[..]),
            suffix: Box::default(),
        });
    });
    assert_eq!(load.externals.patterns, [(b"@scope/".to_vec(), Vec::new())]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn externals_ignore_insertion_order() {
    fn insert(options: &mut BundleOptions<'_>, names: [&[u8]; 2]) {
        for name in names {
            options.external.node_modules.insert(name).expect("oom");
            options.external.abs_paths.insert(name).expect("oom");
            options.external.patterns.push(WildcardPattern {
                prefix: Box::from(name),
                suffix: Box::default(),
            });
        }
    }
    let first = convert_load(|options| insert(options, [b"a", b"b"])).externals;
    let second = convert_load(|options| insert(options, [b"b", b"a"])).externals;
    assert_eq!(first.packages, byte_lists(&["a", "b"]));
    assert_eq!(first.packages, second.packages);
    assert_eq!(first.paths, second.paths);
    assert_eq!(first.patterns, second.patterns);
}

fn convert_in_memory_files(files: &[(&[u8], &[u8])]) -> Vec<(Vec<u8>, Vec<u8>)> {
    let mut file_map = FileMap::default();
    for &(key, contents) in files {
        file_map.map.put(key, Box::from(contents)).expect("oom");
    }
    let case = Case {
        file_map: Some(&file_map),
        ..Case::default()
    };
    convert(
        case,
        |_| {},
        |result, _| result.expect("options").load.in_memory_files,
    )
}

#[test]
#[cfg_attr(miri, ignore)]
fn in_memory_files_are_absolute_and_sorted() {
    let files = convert_in_memory_files(&[(b"b.ts", b"b"), (b"/x/a.ts", b"a")]);
    let expected = vec![
        (b"/project/b.ts".to_vec(), b"b".to_vec()),
        (b"/x/a.ts".to_vec(), b"a".to_vec()),
    ];
    assert_eq!(files, expected);
}

#[test]
#[cfg_attr(miri, ignore)]
fn duplicate_in_memory_paths_keep_last_sorted_key() {
    let files = convert_in_memory_files(&[(b"a.ts", b"relative"), (b"/project/a.ts", b"absolute")]);
    assert_eq!(
        files,
        vec![(b"/project/a.ts".to_vec(), b"relative".to_vec())]
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn in_memory_paths_are_normalized() {
    let files = convert_in_memory_files(&[(b"/x/y/../a.png", b"a"), (b"./b/./c.png", b"c")]);
    let expected = vec![
        (b"/project/b/c.png".to_vec(), b"c".to_vec()),
        (b"/x/a.png".to_vec(), b"a".to_vec()),
    ];
    assert_eq!(files, expected);
}

#[test]
#[cfg_attr(miri, ignore)]
fn long_in_memory_key_converts() {
    let key = [b'a'; 5000];
    let files = convert_in_memory_files(&[(&key, b"")]);
    assert_eq!(files[0].0, [&b"/project/"[..], &key].concat());
}

#[test]
#[cfg_attr(miri, ignore)]
fn long_entry_point_is_an_error() {
    let entry = [b'a'; 5000];
    let case = Case {
        entry_points: &[&entry, b"main.ts"],
        ..Case::default()
    };
    let messages = convert(
        case,
        |_| {},
        |result, log| {
            assert!(result.is_none());
            errors(log)
        },
    );
    assert_eq!(messages.len(), 1);
    assert!(messages[0].starts_with("the entry point \"aaa"));
    assert!(messages[0].ends_with("\" is too long"));
}

#[test]
#[cfg_attr(miri, ignore)]
fn long_root_directory_is_an_error() {
    let messages = report_errors(|options| options.root_dir = Box::from(&[b'a'; 5000][..]));
    assert_eq!(messages.len(), 1);
    assert!(messages[0].starts_with("the root directory \"aaa"));
}

#[test]
#[cfg_attr(miri, ignore)]
fn written_root_directory_is_absolute() {
    let paths = convert_paths(&[b"src/main.ts"], |options| {
        options.root_dir = Box::from(&b"lib"[..]);
    });
    assert_eq!(paths.root_directory, b"/project/lib");
}

#[test]
#[cfg_attr(miri, ignore)]
fn single_entry_point_directory_is_root() {
    let cases: [(&[u8], &[u8]); 4] = [
        (b"main.ts", b"/project"),
        (b"src/main.ts", b"/project/src"),
        (b"./src/../lib/main.ts", b"/project/lib"),
        (b"/main.ts", b"/"),
    ];
    for (entry_point, root_directory) in cases {
        assert_eq!(
            convert_paths(&[entry_point], |_| {}).root_directory,
            root_directory
        );
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn common_entry_point_directory_is_root() {
    let cases: [(&[&[u8]], &[u8]); 6] = [
        (&[b"src/a.ts", b"lib/b.ts"], b"/project"),
        (&[b"src/a.ts", b"src/lib/b.ts"], b"/project/src"),
        (&[b"src/lib/b.ts", b"src/a.ts"], b"/project/src"),
        (&[b"src/a.ts", b"src-gen/b.ts"], b"/project"),
        (&[b"src/a.ts", b"./src/b.ts"], b"/project/src"),
        (&[b"a.ts", b"/other/b.ts"], b"/"),
    ];
    for (entry_points, root_directory) in cases {
        assert_eq!(
            convert_paths(entry_points, |_| {}).root_directory,
            root_directory
        );
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn entry_point_count_does_not_change_root() {
    let files: Vec<String> = (0..9).map(|index| format!("src/e{index}.ts")).collect();
    let entry_points: Vec<&[u8]> = files.iter().map(|file| file.as_bytes()).collect();
    let paths = convert_paths(&entry_points, |_| {});
    assert_eq!(paths.root_directory, b"/project/src");
    assert_eq!(paths.entry_point_names[8], b"e8.ts");
}

#[test]
#[cfg_attr(miri, ignore)]
fn early_difference_among_nine_entry_points_decides_root() {
    let mut files: Vec<String> = (0..9)
        .map(|index| format!("src/deep/e{index}.ts"))
        .collect();
    files[1] = "lib/deep/e1.ts".to_owned();
    let entry_points: Vec<&[u8]> = files.iter().map(|file| file.as_bytes()).collect();
    let paths = convert_paths(&entry_points, |_| {});
    assert_eq!(paths.root_directory, b"/project");
    assert_eq!(paths.entry_point_names[1], b"lib/deep/e1.ts");
    assert_eq!(paths.entry_point_names[8], b"src/deep/e8.ts");
}

#[test]
#[cfg_attr(miri, ignore)]
fn entry_point_far_from_root_is_an_error() {
    let root_directory = b"/a".repeat(MAX_PATH_BYTES / 2 - 2);
    let messages = report_errors(|options| options.root_dir = Box::from(&root_directory[..]));
    assert_eq!(messages, ["the entry point \"main.ts\" is too long"]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn builtin_modules_follow_option() {
    let case = Case {
        omits_builtin_modules: true,
        ..Case::default()
    };
    let load = convert(case, |_| {}, |result, _| result.expect("options").load);
    assert!(load.omits_builtin_modules);
    assert!(!load.runs_tests);
}

#[test]
#[cfg_attr(miri, ignore)]
fn test_runner_follows_option() {
    let case = Case {
        runs_tests: true,
        ..Case::default()
    };
    let load = convert(case, |_| {}, |result, _| result.expect("options").load);
    assert!(load.runs_tests);
    assert!(!load.omits_builtin_modules);
}

#[test]
#[cfg_attr(miri, ignore)]
fn entry_names_follow_root_and_not_compile_name() {
    let case = Case {
        entry_points: &[b"src/main.ts", b"src/workers/w.ts"],
        ..Case::default()
    };
    let names = convert(case, set_root_and_compile_name, |result, _| {
        result.expect("options").paths.entry_point_names
    });
    assert_eq!(names, byte_lists(&["main.ts", "workers/w.ts"]));
}

fn embedded_names(
    entry_points: &[&str],
    configure: impl FnOnce(&mut BundleOptions<'_>),
) -> (Option<Vec<Vec<u8>>>, Vec<String>) {
    let mut log = Log::init();
    let mut options = default_options(&mut log);
    configure(&mut options);
    let entry_points = byte_lists(entry_points);
    let names = embedded_entry_point_names(
        &options,
        b"/project",
        &entry_points,
        b"/project/src",
        &mut log,
    );
    (names, errors(&log))
}

#[test]
#[cfg_attr(miri, ignore)]
fn embedded_names_are_those_of_bundle() {
    let entry_points = [
        "/project/src/main.ts",
        "/project/src/workers/w.ts",
        "/project/src/data.mjs",
        "/project/src/c.cjs",
    ];
    let (names, _) = embedded_names(&entry_points, |_| {});
    assert_eq!(
        names,
        Some(byte_lists(&["main.js", "workers/w.js", "data.js", "c.js"]))
    );
    let (names, _) = embedded_names(&entry_points, set_root_and_compile_name);
    assert_eq!(
        names,
        Some(byte_lists(&["app", "workers/w.js", "data.js", "c.js"]))
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn equal_embedded_names_are_an_error() {
    let (names, messages) = embedded_names(
        &[
            "/project/src/main.ts",
            "/project/src/a.ts",
            "/project/src/a.mjs",
        ],
        |_| {},
    );
    assert_eq!(names, None);
    assert_eq!(
        messages,
        ["Multiple files share the same output path: a.js"]
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn equal_entry_names_are_an_error() {
    let case = Case {
        entry_points: &[b"a.ts", b"a.js"],
        ..Case::default()
    };
    let name_without_source_extension =
        |options: &mut BundleOptions<'_>| options.entry_naming = Box::from(&b"[name].[ext]"[..]);
    let messages = convert(case, name_without_source_extension, |result, log| {
        assert!(result.is_none());
        errors(log)
    });
    assert_eq!(
        messages,
        ["Multiple files share the same output path: a.js"]
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn hash_in_entry_naming_is_unsupported() {
    let messages = report_errors(|options| {
        options.entry_naming = Box::from(&b"[name]-[hash].[ext]"[..]);
    });
    assert_eq!(messages.len(), 1);
    assert!(messages[0].ends_with("[hash] in --entry-naming"));
}

#[test]
#[cfg_attr(miri, ignore)]
fn target_in_entry_naming_is_bun() {
    let names = convert(
        Case::default(),
        |options| options.entry_naming = Box::from(&b"[target]/[name].[ext]"[..]),
        |result, _| result.expect("options").paths.entry_point_names,
    );
    assert_eq!(names, byte_lists(&["bun/main.js"]));
}

struct TemporaryProject {
    directory: PathBuf,
}

#[allow(clippy::disallowed_methods)]
impl TemporaryProject {
    fn new(name: &str, files: &[&str]) -> TemporaryProject {
        let unique_name = format!("bun-aot-options-{}-{name}", std::process::id());
        let directory = std::env::temp_dir().join(unique_name);
        let _ = std::fs::remove_dir_all(&directory);
        for file in files {
            let path = directory.join(file);
            std::fs::create_dir_all(path.parent().expect("parent")).expect("directory");
            std::fs::write(path, b"").expect("file");
        }
        TemporaryProject {
            directory: directory.canonicalize().expect("directory"),
        }
    }

    fn case<'c>(&'c self, entry_points: &'c [&'c [u8]]) -> Case<'c> {
        Case {
            entry_points,
            working_directory: self.directory.as_os_str().as_bytes(),
            ..Case::default()
        }
    }

    fn expand(&self, entry_points: &[&[u8]]) -> (Option<Vec<Vec<u8>>>, Vec<String>) {
        let case = self.case(entry_points);
        convert(
            case,
            |_| {},
            |result, log| (result.map(|it| it.entry_points), errors(log)),
        )
    }

    fn convert_paths(&self, entry_points: &[&[u8]]) -> PathOptions {
        convert(
            self.case(entry_points),
            |_| {},
            |result, _| result.expect("options").paths,
        )
    }

    fn path_of(&self, name: &str) -> Vec<u8> {
        self.directory.join(name).as_os_str().as_bytes().to_vec()
    }
}

impl Drop for TemporaryProject {
    #[allow(clippy::disallowed_methods)]
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

const PROJECT_FILES: [&str; 9] = [
    "main.cjs",
    "plugins/b.cjs",
    "plugins/a.cjs",
    "plugins/.DS_Store",
    "plugins/nested/c.cjs",
    "lib/d.cjs",
    "lib/deep/e.mjs",
    "lib/deep/f.txt",
    ".hidden/[id]/deep.cjs",
];

#[test]
#[cfg_attr(miri, ignore)]
fn patterns_expand_in_position() {
    let project = TemporaryProject::new("positions", &PROJECT_FILES);
    let (entries, messages) = project.expand(&[b"main.cjs", b"plugins/*", b"lib/**/*.{cjs,mjs}"]);
    let expected = [
        "main.cjs",
        "plugins/a.cjs",
        "plugins/b.cjs",
        "lib/d.cjs",
        "lib/deep/e.mjs",
    ];
    assert_eq!(entries, Some(byte_lists(&expected)), "{messages:?}");
}

#[test]
#[cfg_attr(miri, ignore)]
fn owned_entry_points_expand() {
    let project = TemporaryProject::new("owned", &PROJECT_FILES);
    let entry_points: [Box<[u8]>; 2] = [Box::from(&b"main.cjs"[..]), Box::from(&b"plugins/*"[..])];
    let working_directory = project.directory.as_os_str().as_bytes();
    let mut log = Log::init();
    let entries = expand_entry_points(&entry_points, working_directory, None, &mut log);
    assert_eq!(
        entries,
        Some(byte_lists(&["main.cjs", "plugins/a.cjs", "plugins/b.cjs"]))
    );
    assert!(log.msgs.is_empty());
}

#[test]
#[cfg_attr(miri, ignore)]
fn written_file_matching_pattern_is_listed_once() {
    let project = TemporaryProject::new("duplicates", &PROJECT_FILES);
    let (entries, _) = project.expand(&[b"plugins/a.cjs", b"plugins/*"]);
    assert_eq!(
        entries,
        Some(byte_lists(&["plugins/a.cjs", "plugins/b.cjs"]))
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn pattern_naming_dot_directory_finds_files() {
    let project = TemporaryProject::new("dot", &PROJECT_FILES);
    let (entries, _) = project.expand(&[b".hidden/**/*.cjs"]);
    assert_eq!(entries, Some(byte_lists(&[".hidden/[id]/deep.cjs"])));
}

#[test]
#[cfg_attr(miri, ignore)]
fn existing_file_with_pattern_syntax_is_taken_as_written() {
    let project = TemporaryProject::new("literal", &["a[1].ts", "a1.ts"]);
    let (entries, _) = project.expand(&[b"a[1].ts"]);
    assert_eq!(entries, Some(byte_lists(&["a[1].ts"])));
}

#[test]
#[cfg_attr(miri, ignore)]
fn in_memory_file_with_pattern_syntax_is_taken_as_written() {
    let mut file_map = FileMap::default();
    file_map.map.put(b"[id].ts", Box::default()).expect("oom");
    let case = Case {
        entry_points: &[b"[id].ts"],
        file_map: Some(&file_map),
        ..Case::default()
    };
    let entries = convert(
        case,
        |_| {},
        |result, _| result.expect("options").entry_points,
    );
    assert_eq!(entries, byte_lists(&["[id].ts"]));
}

#[test]
#[cfg_attr(miri, ignore)]
fn pattern_without_match_is_an_error() {
    let project = TemporaryProject::new("missing", &PROJECT_FILES);
    let (entries, messages) = project.expand(&[b"nothing/**/*.cjs", b"main.cjs"]);
    assert_eq!(entries, None);
    assert_eq!(
        messages,
        ["no file matches the entry point \"nothing/**/*.cjs\""]
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn pattern_and_written_files_get_equal_names() {
    let project = TemporaryProject::new("names", &["apps/a/main.ts", "apps/b/main.ts"]);
    let from_pattern = project.convert_paths(&[b"apps/*/main.ts"]);
    let from_files = project.convert_paths(&[b"apps/a/main.ts", b"apps/b/main.ts"]);
    assert_eq!(from_pattern.root_directory, project.path_of("apps"));
    assert_eq!(
        from_pattern.entry_point_names,
        byte_lists(&["a/main.ts", "b/main.ts"])
    );
    assert_eq!(from_files.root_directory, from_pattern.root_directory);
    assert_eq!(from_files.entry_point_names, from_pattern.entry_point_names);
}

#[test]
#[cfg_attr(miri, ignore)]
fn pattern_with_one_match_has_match_directory_as_root() {
    let project = TemporaryProject::new("one-match", &["apps/a/main.ts", "apps/b/other.ts"]);
    let paths = project.convert_paths(&[b"apps/*/main.ts"]);
    assert_eq!(paths.root_directory, project.path_of("apps/a"));
    assert_eq!(paths.entry_point_names, byte_lists(&["main.ts"]));
}

#[test]
#[cfg_attr(miri, ignore)]
#[allow(clippy::disallowed_methods)]
fn derived_root_directory_follows_symbolic_links() {
    let project = TemporaryProject::new("links", &["real/main.ts"]);
    std::os::unix::fs::symlink(
        project.directory.join("real"),
        project.directory.join("link"),
    )
    .expect("symbolic link");
    let paths = project.convert_paths(&[b"link/main.ts"]);
    assert_eq!(paths.root_directory, project.path_of("real"));
}
