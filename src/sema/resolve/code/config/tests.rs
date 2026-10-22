use super::*;
use crate::resolve::code::memory_host::MemoryHost;

const NO_CONFIG: &str = "no config";
const DEFAULT_JSX: &str = "Automatic dev React.createElement React.Fragment react";

fn bun_run() -> CodeOptions {
    CodeOptions::bun_run(b"/app")
}

fn with_override(path: &str) -> CodeOptions {
    CodeOptions {
        tsconfig_override: Some(path.into()),
        ..bun_run()
    }
}

fn create_host(files: &str) -> MemoryHost {
    let to_str = |bytes| std::str::from_utf8(bytes).unwrap();
    let files: Vec<(&str, &str)> = strings::split(files.as_bytes(), b"\n")
        .filter_map(|line| strings::split_once_char(line.trim_ascii(), b' '))
        .map(|(path, text)| (to_str(path), to_str(text)))
        .collect();
    MemoryHost::new(&files)
}

fn config_host(path: &str, options: &str) -> MemoryHost {
    let config = format!(r#"{{"compilerOptions": {options}}}"#);
    MemoryHost::new(&[(path, config.as_str())])
}

fn with_resolver<T>(
    host: &MemoryHost,
    options: &CodeOptions,
    run: impl FnOnce(&Resolver<'_>) -> T,
) -> T {
    let session = Session::new();
    let type_options = Options::default();
    let resolver = Resolver::for_compile(&session, host, &type_options, options);
    run(&resolver)
}

fn text(bytes: &[u8]) -> String {
    bstr::BStr::new(bytes).to_string()
}

fn render_candidates(config: Option<&CodeConfig<'_>>, specifier: &str) -> String {
    match config {
        Some(config) => text(&bstr::join(" ", config.path_candidates(specifier.as_bytes()))),
        None => NO_CONFIG.to_owned(),
    }
}

fn assert_candidates(host: &MemoryHost, options: &CodeOptions, cases: &[[&str; 3]]) {
    with_resolver(host, options, |resolver| {
        for &[from, specifier, expected] in cases {
            let config = resolver.enclosing_code_config(from.as_bytes());
            let found = render_candidates(config, specifier);
            assert_eq!(found, expected, "{specifier} from {from}");
        }
    });
}

fn assert_app_candidates(options: &str, cases: &[[&str; 2]]) {
    let host = config_host("/app/tsconfig.json", options);
    for &[specifier, expected] in cases {
        assert_candidates(&host, &bun_run(), &[["/app", specifier, expected]]);
    }
}

fn settings_with(host: &MemoryHost, options: &CodeOptions, path: &str) -> TranspileSettings {
    with_resolver(host, options, |resolver| {
        resolver.transpile_settings(path.as_bytes()).clone()
    })
}

fn settings(host: &MemoryHost, path: &str) -> TranspileSettings {
    settings_with(host, &bun_run(), path)
}

fn lib_settings(options: &str) -> TranspileSettings {
    settings(&config_host("/lib/tsconfig.json", options), "/lib/a.tsx")
}

fn render_jsx(jsx: &JsxSettings) -> String {
    let mode = if jsx.is_development { "dev" } else { "prod" };
    let dotted = |members: &[Vec<u8>]| text(&bstr::join(".", members));
    let (factory, fragment) = (dotted(&jsx.factory), dotted(&jsx.fragment));
    let (runtime, import_source) = (jsx.runtime, text(&jsx.import_source));
    format!("{runtime:?} {mode} {factory} {fragment} {import_source}")
}

fn extends_chain_settings(option: &str, written: &[Option<bool>]) -> TranspileSettings {
    let files: Vec<(String, String)> = (written.iter().enumerate())
        .map(|(index, value)| {
            let path = match index {
                0 => "/lib/tsconfig.json".to_owned(),
                _ => format!("/lib/{index}.json"),
            };
            let options = match value {
                Some(value) => format!(r#""{option}": {value}"#),
                None => String::new(),
            };
            let next = index + 1;
            let config =
                format!(r#"{{"extends": "./{next}.json", "compilerOptions": {{{options}}}}}"#);
            (path, config)
        })
        .collect();
    let files: Vec<(&str, &str)> = (files.iter())
        .map(|(path, config)| (path.as_str(), config.as_str()))
        .collect();
    settings(&MemoryHost::new(&files), "/lib/a.ts")
}

#[test]
fn nearest_config_file_decides() {
    let host = create_host(
        r#"
        /tsconfig.json {"compilerOptions": {"paths": {"@/*": ["./root/*"]}}}
        /app/tsconfig.json {"compilerOptions": {"paths": {"@/*": ["./outer/*"]}}}
        /app/nested/tsconfig.json {"compilerOptions": {"paths": {"@/*": ["./inner/*"]}}}
        /app/nested/jsconfig.json {"compilerOptions": {"paths": {"@/*": ["./unused/*"]}}}
        /app/scripts/jsconfig.json {"compilerOptions": {"paths": {"@/*": ["./js/*"]}}}
        /app/rejected/tsconfig.json {
        /app/rejected/jsconfig.json {"compilerOptions": {"paths": {"@/*": ["./unused/*"]}}}
        /app/list/tsconfig.json []
        "#,
    );
    let cases = [
        ["/app/nested", "@/a", "/app/nested/inner/a"],
        ["/app/nested/deep", "@/a", "/app/nested/inner/a"],
        ["/app/scripts", "@/a", "/app/scripts/js/a"],
        ["/app", "@/a", "/app/outer/a"],
        ["/app/node_modules/pkg", "@/a", "/app/outer/a"],
        ["/other", "@/a", "/root/a"],
        ["/app/rejected/deep", "@/a", NO_CONFIG],
        ["/app/rejected", "@/a", NO_CONFIG],
        ["/app/list", "@/a", ""],
        ["app", "@/a", NO_CONFIG],
        ["", "@/a", NO_CONFIG],
    ];
    assert_candidates(&host, &bun_run(), &cases);
}

#[test]
fn config_is_loaded_once() {
    let host = config_host("/lib/tsconfig.json", "{}");
    with_resolver(&host, &bun_run(), |resolver| {
        let first = resolver.enclosing_code_config(b"/lib/a/b").unwrap();
        let second = resolver.enclosing_code_config(b"/lib/a/c").unwrap();
        assert!(std::ptr::eq(first, second));
    });
    assert_eq!(host.reads("/lib/tsconfig.json"), 1);
}

#[test]
fn extends_inherits_unset_options() {
    let host = create_host(
        r#"
        /base.json {"compilerOptions": {"paths": {"@/*": ["./base/*"]}}}
        /inherits.json {"extends": "./base.json"}
        /chain.json {"extends": "./inherits.json"}
        /ignores.json {"extends": "./base.json", "compilerOptions": {"paths": []}}
        /rebases.json {"extends": "./base.json", "compilerOptions": {"baseUrl": "./src"}}
        /missing.json {"extends": "./none.json", "compilerOptions": {"paths": {"b": ["./b"]}}}
        /no-ending.json {"extends": "./base"}
        /list.json {"extends": ["./base.json"]}
        /cycle.json {"extends": "./cycle-back.json"}
        /cycle-back.json {"extends": "./cycle.json"}
        /node_modules/pkg/inherits.json {"extends": "../../base.json"}
        "#,
    );
    let cases = [
        ["/inherits.json", "@/a", "/base/a"],
        ["/chain.json", "@/a", "/base/a"],
        ["/ignores.json", "@/a", "/base/a"],
        ["/rebases.json", "@/a", "/src/base/a"],
        ["/missing.json", "b", "/b"],
        ["/no-ending.json", "@/a", ""],
        ["/list.json", "@/a", ""],
        ["/cycle.json", "@/a", NO_CONFIG],
        ["/node_modules/pkg/inherits.json", "@/a", ""],
    ];
    for [config, specifier, expected] in cases {
        let options = with_override(config);
        assert_candidates(&host, &options, &[["/app", specifier, expected]]);
    }
}

#[test]
fn child_paths_replace_parent_paths() {
    let host = create_host(
        r#"
        /configs/base.json {"compilerOptions": {"paths": {"@/*": ["./base/*"], "shared": ["./base-shared"]}}}
        /middle/middle.json {"extends": "../configs/base.json", "compilerOptions": {"paths": {"shared": ["./middle-shared"]}}}
        /replaces.json {"extends": "./configs/base.json", "compilerOptions": {"paths": {"b": ["./b"]}}}
        /clears.json {"extends": "./configs/base.json", "compilerOptions": {"paths": {}}}
        /through-middle.json {"extends": "./middle/middle.json"}
        /over-middle.json {"extends": "./middle/middle.json", "compilerOptions": {"paths": {"@/*": ["./own/*"]}}}
        "#,
    );
    let cases = [
        ["/replaces.json", "b", "/b"],
        ["/replaces.json", "@/a", ""],
        ["/replaces.json", "shared", ""],
        ["/clears.json", "@/a", ""],
        ["/through-middle.json", "shared", "/middle/middle-shared"],
        ["/through-middle.json", "@/a", ""],
        ["/over-middle.json", "@/a", "/own/a"],
        ["/over-middle.json", "shared", ""],
    ];
    for [config, specifier, expected] in cases {
        let options = with_override(config);
        assert_candidates(&host, &options, &[["/app", specifier, expected]]);
    }
}

#[test]
fn extends_chain_has_limit() {
    let create_chain = |length: usize| {
        let files: Vec<String> = (0..length)
            .map(|index| format!(r#"/{index}.json {{"extends": "./{}.json"}}"#, index + 1))
            .collect();
        create_host(&files.join("\n"))
    };
    let options = with_override("/0.json");
    let longest = create_chain(MAX_EXTENDED_CONFIGS);
    assert_candidates(&longest, &options, &[["/app", "a", ""]]);
    let over_limit = create_chain(MAX_EXTENDED_CONFIGS + 1);
    assert_candidates(&over_limit, &options, &[["/app", "a", NO_CONFIG]]);
}

#[test]
fn extends_merges_settings_by_option() {
    let child = r#"{
        "extends": "./base.json",
        "compilerOptions": {
            "experimentalDecorators": true, "useDefineForClassFields": false,
            "jsx": "react", "jsxFactory": "h"
        }
    }"#;
    let base = r#"{
        "compilerOptions": {
            "emitDecoratorMetadata": true, "useDefineForClassFields": true,
            "jsx": "automatic", "jsxFactory": "unused", "jsxFragmentFactory": "Fragment",
            "jsxImportSource": "preact"
        }
    }"#;
    let host = MemoryHost::new(&[("/lib/tsconfig.json", child), ("/lib/base.json", base)]);
    let merged = settings(&host, "/lib/a.tsx");
    assert!(merged.emits_decorator_metadata);
    assert!(!merged.experimental_decorators);
    assert_eq!(merged.use_define_for_class_fields, Some(false));
    assert_eq!(render_jsx(&merged.jsx), "Classic dev h Fragment preact");
}

#[test]
fn last_extended_file_decides_experimental_decorators() {
    let cases: [(&[Option<bool>], bool); 9] = [
        (&[Some(true)], true),
        (&[None], false),
        (&[Some(true), None], false),
        (&[Some(true), Some(false)], false),
        (&[None, Some(true)], true),
        (&[Some(false), Some(true)], true),
        (&[Some(true), Some(true), None], false),
        (&[None, Some(true), Some(false)], false),
        (&[None, None, Some(true)], true),
    ];
    for (written, expected) in cases {
        let merged = extends_chain_settings("experimentalDecorators", written);
        assert_eq!(merged.experimental_decorators, expected, "{written:?}");
        assert!(!merged.emits_decorator_metadata, "{written:?}");
    }
}

#[test]
fn any_extended_file_sets_decorator_metadata() {
    let cases: [(&[Option<bool>], bool); 8] = [
        (&[Some(true)], true),
        (&[None], false),
        (&[Some(true), None], true),
        (&[Some(true), Some(false)], true),
        (&[Some(false), Some(true)], true),
        (&[None, Some(true), None], true),
        (&[None, None, Some(true)], true),
        (&[Some(false), None, Some(false)], false),
    ];
    for (written, expected) in cases {
        let merged = extends_chain_settings("emitDecoratorMetadata", written);
        assert_eq!(merged.emits_decorator_metadata, expected, "{written:?}");
        assert!(!merged.experimental_decorators, "{written:?}");
    }
}

#[test]
fn nearest_extended_file_decides_class_field_semantics() {
    let cases: [(&[Option<bool>], Option<bool>); 5] = [
        (&[None, None], None),
        (&[Some(false), Some(true)], Some(false)),
        (&[Some(true), Some(false)], Some(true)),
        (&[None, Some(false), Some(true)], Some(false)),
        (&[None, None, Some(true)], Some(true)),
    ];
    for (written, expected) in cases {
        let merged = extends_chain_settings("useDefineForClassFields", written);
        assert_eq!(merged.use_define_for_class_fields, expected, "{written:?}");
    }
}

#[test]
fn first_of_repeated_option_keys_wins() {
    let config = r#"{
        "compilerOptions": {
            "baseUrl": 5, "baseUrl": "./src", "paths": {"a": ["./first"]}, "paths": {}
        },
        "compilerOptions": {"paths": {"a": ["./second"]}}
    }"#;
    let host = MemoryHost::new(&[("/app/tsconfig.json", config)]);
    assert_candidates(&host, &bun_run(), &[["/app", "a", "/app/first"]]);
    let replaced = r#"{"paths": {"a": ["./first"], "a": ["./second"]}}"#;
    assert_app_candidates(replaced, &[["a", "/app/second"]]);
    let unusable = r#"{"paths": {"a": ["./first"], "a": [], "a": "./third", "a": ["bare"]}}"#;
    assert_app_candidates(unusable, &[["a", "/app/first"]]);
}

#[test]
fn config_dir_is_directory_of_writing_file() {
    let host = create_host(
        r#"
        /tsconfig.json {"compilerOptions": {"paths": {"@/*": ["${configDir}/a/*"]}}}
        /config/base.json {"compilerOptions": {"paths": {"@/*": ["${configDir}a/*", "./b/*"]}}}
        /child/tsconfig.json {"extends": "../config/base.json"}
        "#,
    );
    let cases = [
        ["/child", "@/x", "/config/a/x /config/b/x"],
        ["/other", "@/x", "/a/x"],
    ];
    assert_candidates(&host, &bun_run(), &cases);
    let in_base_url = r#"{"baseUrl": "${configDir}/src", "paths": {"@/*": ["${other}/*"]}}"#;
    assert_app_candidates(in_base_url, &[["@/x", "/app/src/${other}/x"]]);
}

#[test]
fn bare_substitution_needs_base_url() {
    let cases = [
        ("", "", "/app/lib/a"),
        (r#""baseUrl": 5, "#, "", "/app/lib/a"),
        (r#""baseUrl": "", "#, "", "/app/src/a /app/lib/a"),
        (r#""baseUrl": "./x/..", "#, "/app", "/app/src/a /app/lib/a"),
    ];
    for (written, base_url, expected) in cases {
        let options = format!(r#"{{{written}"paths": {{"@/*": ["src/*", "./lib/*"]}}}}"#);
        let host = config_host("/app/tsconfig.json", &options);
        assert_candidates(&host, &bun_run(), &[["/app", "@/a", expected]]);
        let found = with_resolver(&host, &bun_run(), |resolver| {
            resolver.enclosing_code_config(b"/app")?.base_url.map(text)
        });
        assert_eq!(found.unwrap_or_default(), base_url, "{written}");
    }
}

#[test]
fn relative_and_rooted_text_needs_no_base_url() {
    let accepted = [
        ".", "..", "./", ".\\", "./a", ".\\a", "../a", "..\\a", "c:/", "C:\\a", "/ab", "\\ab",
    ];
    for text in accepted {
        assert!(is_relative_or_rooted(text.as_bytes()), "{text}");
    }
    let rejected = [
        "", "a", "/", "/a", "\\a", "a/", "src/*", ".a", "..a", "...", "1:/a", "c:a", "*",
    ];
    for text in rejected {
        assert!(!is_relative_or_rooted(text.as_bytes()), "{text}");
    }
}

#[test]
fn most_specific_key_is_selected() {
    let options = r#"{
        "paths": {
            "lib*": ["./pattern/*"], "lib": ["./exact", "./second"],
            "@/*": ["./short/*"], "@/deep/*": ["./long/*"],
            "pre-*": ["./prefix/*"], "pre-*-post": ["./middle/*"], "ab*ba": ["./overlap/*"]
        }
    }"#;
    let cases = [
        ["lib", "/app/exact /app/second /app/pattern/"],
        ["lib/a", "/app/pattern/a"],
        ["li", ""],
        ["@/deep/a", "/app/long/a"],
        ["@/a", "/app/short/a"],
        ["pre-x-post", "/app/middle/x"],
        ["pre-y", "/app/prefix/y"],
        ["abba", "/app/overlap/"],
        ["aba", ""],
    ];
    assert_app_candidates(options, &cases);
}

#[test]
fn substitutions_resolve_against_base() {
    let options = r#"{
        "baseUrl": "./src",
        "paths": {
            "~*": ["*"], "fixed/*": ["./fixed"], "both/*": ["first/*", "../second/*"],
            "rooted/*": ["/lib/x/../*"], "rooted": ["/lib/.", "/lib/x/../a/", "./lib/."],
            "@/*": ["./*"],
            "types": ["./types.d.ts", "./types.D.MTS", "./types.d.cts", "./code.ts"],
            "types/*": ["./types/*.d.ts", "./code/*"],
            "two/*/*": ["./two/*"], "text/*": "./text/*", "empty/*": [],
            "stars/*": ["./*/*", "./stars/*"], "mixed/*": [5, null, ["./nested/*"], "./mixed/*"]
        }
    }"#;
    let cases = [
        ["~/a", "/app/src/a"],
        ["~\\a", "/app/src/a"],
        ["~c:/a", "/app/src/c:/a"],
        ["~a://b/c", "/app/src/a:/b/c"],
        ["fixed/a", "/app/src/fixed"],
        ["both/a", "/app/src/first/a /app/second/a"],
        ["rooted/a", "/lib/a"],
        ["rooted/.", "/lib"],
        ["rooted", "/lib/. /lib/x/../a/ /app/src/lib"],
        ["types", "/app/src/code.ts"],
        ["types/a", "/app/src/code/a"],
        ["@/env.d.ts", "/app/src/env.d.ts"],
        ["two/a/b", ""],
        ["text/a", ""],
        ["empty/a", ""],
        ["stars/a", "/app/src/stars/a"],
        ["mixed/a", "/app/src/mixed/a"],
    ];
    assert_app_candidates(options, &cases);
}

fn can_match_prefix(options: &str, prefix: &str) -> bool {
    let host = config_host("/app/tsconfig.json", options);
    with_resolver(&host, &bun_run(), |resolver| {
        let config = resolver.enclosing_code_config(b"/app").unwrap();
        config.can_match_prefix(prefix.as_bytes())
    })
}

#[test]
fn pattern_key_matches_prefix_in_either_direction() {
    let options = r#"{"paths": {"@/*": ["./src/*"]}}"#;
    for prefix in ["@/a", "@/", "@", "", "@/a/b"] {
        assert!(can_match_prefix(options, prefix), "{prefix}");
    }
    for prefix in ["x", "@x", "a@/"] {
        assert!(!can_match_prefix(options, prefix), "{prefix}");
    }
    let with_suffix = r#"{"paths": {"pre-*-post": ["./src/*"]}}"#;
    assert!(can_match_prefix(with_suffix, "pre-x"));
    assert!(can_match_prefix(with_suffix, "pr"));
    assert!(!can_match_prefix(with_suffix, "post"));
}

#[test]
fn exact_key_matches_only_own_prefixes() {
    let options = r#"{"paths": {"lib/core": ["./src/core.ts"]}}"#;
    for prefix in ["lib/core", "lib/", "l", ""] {
        assert!(can_match_prefix(options, prefix), "{prefix}");
    }
    for prefix in ["lib/core/", "lib/cores", "core"] {
        assert!(!can_match_prefix(options, prefix), "{prefix}");
    }
}

#[test]
fn config_without_paths_matches_no_prefix() {
    for options in ["{}", r#"{"paths": {}}"#, r#"{"baseUrl": "."}"#] {
        for prefix in ["", "@/a", "lib"] {
            assert!(!can_match_prefix(options, prefix), "{prefix} under {options}");
        }
    }
}

#[test]
fn override_replaces_every_config() {
    let host = create_host(
        r#"
        /app/tsconfig.json {"compilerOptions": {"paths": {"@/*": ["./app/*"]}}}
        /app/nested/tsconfig.json {"compilerOptions": {"paths": {"@/*": ["./nested/*"]}}}
        /elsewhere/custom.json {"compilerOptions": {"paths": {"@/*": ["./custom/*"]}}}
        /elsewhere/tsconfig.json {"compilerOptions": {"paths": {"@/*": ["./directory/*"]}, "jsxImportSource": "custom"}}
        "#,
    );
    let cases = [
        ("/elsewhere/custom.json", "/elsewhere/custom/a"),
        ("/elsewhere", "/elsewhere/directory/a"),
        ("/elsewhere/missing.json", NO_CONFIG),
    ];
    for (path, expected) in cases {
        let directories = ["/app", "/app/nested", "/", "relative"];
        let everywhere = directories.map(|from| [from, "@/a", expected]);
        assert_candidates(&host, &with_override(path), &everywhere);
    }
    let options = with_override("/elsewhere");
    let import_source = |path| text(&settings_with(&host, &options, path).jsx.import_source);
    assert_eq!(import_source("/app/a.tsx"), "custom");
    assert_eq!(import_source("/app/nested/a.tsx"), "custom");
    assert_eq!(text(&settings(&host, "/app/a.tsx").jsx.import_source), "react");
}

#[test]
fn override_is_reported_for_every_directory() {
    let host = create_host("");
    for directory in ["/app", "/elsewhere", ""] {
        let is_under_override = |options: &CodeOptions| {
            with_resolver(&host, options, |resolver| {
                resolver.is_under_tsconfig_override(directory.as_bytes())
            })
        };
        assert!(is_under_override(&with_override("/elsewhere/custom.json")), "{directory}");
        assert!(!is_under_override(&bun_run()), "{directory}");
    }
}

#[test]
fn settings_start_from_command_line() {
    let expected = TranspileSettings {
        jsx: JsxSettings::default(),
        experimental_decorators: false,
        emits_decorator_metadata: false,
        use_define_for_class_fields: None,
    };
    assert_eq!(settings(&create_host(""), "/app/a.tsx"), expected);
    assert_eq!(lib_settings("{}"), expected);
    assert_eq!(lib_settings("[]"), expected);

    let mut options = bun_run();
    options.jsx.runtime = JsxRuntime::Classic;
    options.jsx.is_development = false;
    let host = config_host("/lib/tsconfig.json", r#"{"jsxFactory": "h"}"#);
    let lib = settings_with(&host, &options, "/lib/a.tsx");
    assert_eq!(render_jsx(&lib.jsx), "Classic prod h React.Fragment react");

    let host = config_host("/tsconfig.json", r#"{"experimentalDecorators": true}"#);
    assert!(settings(&host, "/a.ts").experimental_decorators);
    assert!(!settings(&host, "a.ts").experimental_decorators);
}

#[test]
fn options_of_other_json_types_are_ignored() {
    let ignored = lib_settings(
        r#"{
            "emitDecoratorMetadata": "true", "experimentalDecorators": 1,
            "useDefineForClassFields": null, "jsx": true, "jsxFactory": ["h"],
            "jsxFragmentFactory": {}, "jsxImportSource": 5
        }"#,
    );
    assert_eq!(ignored, lib_settings("{}"));
}

#[test]
fn jsx_emit_names_ignore_case() {
    use JsxRuntime::{Automatic, Classic};
    let parse = |name: &str| parse_jsx_emit(name.as_bytes());
    assert_eq!(parse("classic"), Some((Classic, None)));
    assert_eq!(parse("React"), Some((Classic, None)));
    assert_eq!(parse("automatic"), Some((Automatic, None)));
    assert_eq!(parse("react-jsx"), Some((Automatic, Some(false))));
    assert_eq!(parse("REACT-JSXDEV"), Some((Automatic, Some(true))));
    assert_eq!(parse("preserve"), None);
}

#[test]
fn jsx_factories_are_identifier_chains() {
    let cases = [
        ("Preact.h", "Automatic dev Preact.h Preact.h react"),
        (".a..$b.", "Automatic dev a.$b a.$b react"),
        (".", DEFAULT_JSX),
        ("a-b", DEFAULT_JSX),
        ("a.1", DEFAULT_JSX),
    ];
    for (text, expected) in cases {
        let options = format!(r#"{{"jsxFactory": "{text}", "jsxFragmentFactory": "{text}"}}"#);
        assert_eq!(render_jsx(&lib_settings(&options).jsx), expected, "{text}");
    }
}

#[test]
fn working_directory_config_decides_development() {
    let host = create_host(
        r#"
        /app/jsconfig.json {"extends": "./base.json"}
        /app/base.json {"compilerOptions": {"jsx": "react-jsx"}}
        /app/packages/ui/tsconfig.json {"compilerOptions": {"jsx": "react-jsxdev"}}
        /elsewhere/custom.json {"compilerOptions": {"jsx": "react-jsxdev"}}
        "#,
    );
    for path in ["/app/a.tsx", "/app/packages/ui/a.tsx", "/outside/a.tsx"] {
        assert!(!settings(&host, path).jsx.is_development, "{path}");
        for override_path in ["/elsewhere/custom.json", "/elsewhere/missing.json"] {
            let found = settings_with(&host, &with_override(override_path), path);
            assert!(found.jsx.is_development, "{path} under {override_path}");
        }
    }
    let host = create_host(
        r#"
        /tsconfig.json {"compilerOptions": {"jsx": "react-jsx"}}
        /app/packages/ui/tsconfig.json {"compilerOptions": {"jsx": "react-jsx"}}
        "#,
    );
    for path in ["/a.tsx", "/app/a.tsx", "/app/packages/ui/a.tsx"] {
        assert!(settings(&host, path).jsx.is_development, "{path}");
    }
}

#[test]
fn forced_development_wins_over_config() {
    let host = create_host(
        r#"
        /app/tsconfig.json {"compilerOptions": {"jsx": "react-jsxdev"}}
        /app/packages/ui/tsconfig.json {"compilerOptions": {"jsx": "react-jsxdev"}}
        /elsewhere/custom.json {"compilerOptions": {"jsx": "react-jsx"}}
        "#,
    );
    let is_development = |base: CodeOptions, forced_jsx_development, path| {
        let options = CodeOptions {
            forced_jsx_development,
            ..base
        };
        settings_with(&host, &options, path).jsx.is_development
    };
    let production_override = || with_override("/elsewhere/custom.json");
    for path in ["/app/a.tsx", "/app/packages/ui/a.tsx", "/outside/a.tsx"] {
        assert!(is_development(bun_run(), None, path), "{path}");
        assert!(!is_development(bun_run(), Some(false), path), "{path}");
        assert!(!is_development(production_override(), None, path), "{path}");
        assert!(is_development(production_override(), Some(true), path), "{path}");
    }
}

#[test]
fn runtime_specifier_follows_development() {
    let mut jsx = lib_settings(r#"{"jsxImportSource": "@emotion/react"}"#).jsx;
    assert_eq!(jsx.runtime_specifier(), b"@emotion/react/jsx-dev-runtime");
    jsx.is_development = false;
    assert_eq!(jsx.runtime_specifier(), b"@emotion/react/jsx-runtime");
}

#[test]
fn pragmas_override_one_member_each() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let base = JsxSettings {
        is_development: false,
        factory: vec![b"f".to_vec()],
        fragment: vec![b"g".to_vec()],
        ..JsxSettings::default()
    };
    assert_eq!(base.with_pragmas(&JsxPragmas::default(), &atoms), None);
    let cases = [
        (Some(true), ["", "", ""], "Classic prod f g react"),
        (Some(false), ["", "", ""], "Automatic prod f g react"),
        (None, ["h.x", "", ""], "Automatic prod h.x g react"),
        (None, ["", "a-b", ""], "Automatic prod f a-b react"),
        (None, ["", "", "preact"], "Automatic prod f g preact"),
        (None, [".", "..", ""], "Automatic prod f g react"),
        (Some(true), ["h", "F", "preact"], "Classic prod h F preact"),
    ];
    for (classic, texts, expected) in cases {
        let [factory, fragment_factory, import_source] = texts.map(|text| match text {
            "" => Atom::NONE,
            _ => atoms.intern(text.as_bytes()),
        });
        let pragmas = JsxPragmas {
            classic,
            factory,
            fragment_factory,
            import_source,
        };
        let once = base.with_pragmas(&pragmas, &atoms).unwrap();
        assert_eq!(render_jsx(&once), expected, "{classic:?} {texts:?}");
        assert_eq!(once.with_pragmas(&pragmas, &atoms).as_ref(), Some(&once));
    }
}
