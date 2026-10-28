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

fn assert_keys_of_paths(host: &MemoryHost, options: &CodeOptions, cases: &[[&str; 2]]) {
    with_resolver(host, options, |resolver| {
        for &[from, expected] in cases {
            let found = match resolver.enclosing_code_config(from.as_bytes()) {
                Some(config) => text(&bstr::join(" ", config.paths)),
                None => NO_CONFIG.to_owned(),
            };
            assert_eq!(found, expected, "from {from}");
        }
    });
}

fn assert_app_keys_of_paths(options: &str, expected: &str) {
    let host = config_host("/app/tsconfig.json", options);
    assert_keys_of_paths(&host, &bun_run(), &[["/app", expected]]);
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
#[cfg_attr(miri, ignore)]
fn nearest_config_file_decides() {
    let host = create_host(
        r#"
        /tsconfig.json {"compilerOptions": {"paths": {"root/*": ["./a/*"]}}}
        /app/tsconfig.json {"compilerOptions": {"paths": {"outer/*": ["./a/*"]}}}
        /app/nested/tsconfig.json {"compilerOptions": {"paths": {"inner/*": ["./a/*"]}}}
        /app/nested/jsconfig.json {"compilerOptions": {"paths": {"unused/*": ["./a/*"]}}}
        /app/scripts/jsconfig.json {"compilerOptions": {"paths": {"js/*": ["./a/*"]}}}
        /app/rejected/tsconfig.json {
        /app/rejected/jsconfig.json {"compilerOptions": {"paths": {"unused/*": ["./a/*"]}}}
        /app/list/tsconfig.json []
        "#,
    );
    let cases = [
        ["/app/nested", "inner/*"],
        ["/app/nested/deep", "inner/*"],
        ["/app/scripts", "js/*"],
        ["/app", "outer/*"],
        ["/app/node_modules/pkg", "outer/*"],
        ["/other", "root/*"],
        ["/app/rejected/deep", NO_CONFIG],
        ["/app/rejected", NO_CONFIG],
        ["/app/list", ""],
        ["app", NO_CONFIG],
        ["", NO_CONFIG],
    ];
    assert_keys_of_paths(&host, &bun_run(), &cases);
}

#[test]
#[cfg_attr(miri, ignore)]
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
#[cfg_attr(miri, ignore)]
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
        ["/inherits.json", "@/*"],
        ["/chain.json", "@/*"],
        ["/ignores.json", "@/*"],
        ["/rebases.json", "@/*"],
        ["/missing.json", "b"],
        ["/no-ending.json", ""],
        ["/list.json", ""],
        ["/cycle.json", NO_CONFIG],
        ["/node_modules/pkg/inherits.json", ""],
    ];
    for [config, expected] in cases {
        assert_keys_of_paths(&host, &with_override(config), &[["/app", expected]]);
    }
}

#[test]
#[cfg_attr(miri, ignore)]
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
        ["/replaces.json", "b"],
        ["/clears.json", ""],
        ["/through-middle.json", "shared"],
        ["/over-middle.json", "@/*"],
    ];
    for [config, expected] in cases {
        assert_keys_of_paths(&host, &with_override(config), &[["/app", expected]]);
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn extends_chain_has_limit() {
    let create_chain = |length: usize| {
        let files: Vec<String> = (0..length)
            .map(|index| format!(r#"/{index}.json {{"extends": "./{}.json"}}"#, index + 1))
            .collect();
        create_host(&files.join("\n"))
    };
    let options = with_override("/0.json");
    let longest = create_chain(MAX_EXTENDED_CONFIGS);
    assert_keys_of_paths(&longest, &options, &[["/app", ""]]);
    let over_limit = create_chain(MAX_EXTENDED_CONFIGS + 1);
    assert_keys_of_paths(&over_limit, &options, &[["/app", NO_CONFIG]]);
}

#[test]
#[cfg_attr(miri, ignore)]
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
#[cfg_attr(miri, ignore)]
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
#[cfg_attr(miri, ignore)]
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
#[cfg_attr(miri, ignore)]
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
#[cfg_attr(miri, ignore)]
fn first_of_repeated_option_keys_wins() {
    let config = r#"{
        "compilerOptions": {
            "baseUrl": 5, "baseUrl": "./src", "paths": {"first": ["./a"]}, "paths": {}
        },
        "compilerOptions": {"paths": {"second": ["./a"]}}
    }"#;
    let host = MemoryHost::new(&[("/app/tsconfig.json", config)]);
    assert_keys_of_paths(&host, &bun_run(), &[["/app", "first"]]);
    let unusable = r#"{"paths": {"a": ["./first"], "b": [], "c": "./third", "d": ["bare"]}}"#;
    assert_app_keys_of_paths(unusable, "a");
}

#[test]
#[cfg_attr(miri, ignore)]
fn bare_substitution_needs_base_url() {
    let cases = [
        ("", "", "relative/*"),
        (r#""baseUrl": 5, "#, "", "relative/*"),
        (r#""baseUrl": "", "#, "", "bare/* relative/*"),
        (r#""baseUrl": "./x/..", "#, "/app", "bare/* relative/*"),
    ];
    for (written, base_url, expected) in cases {
        let paths = r#"{"bare/*": ["src/*"], "relative/*": ["./lib/*"]}"#;
        let options = format!(r#"{{{written}"paths": {paths}}}"#);
        let host = config_host("/app/tsconfig.json", &options);
        assert_keys_of_paths(&host, &bun_run(), &[["/app", expected]]);
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

fn can_match_prefix(options: &str, prefix: &str) -> bool {
    let host = config_host("/app/tsconfig.json", options);
    with_resolver(&host, &bun_run(), |resolver| {
        let config = resolver.enclosing_code_config(b"/app").unwrap();
        config.can_match_prefix(prefix.as_bytes())
    })
}

#[test]
#[cfg_attr(miri, ignore)]
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
#[cfg_attr(miri, ignore)]
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
#[cfg_attr(miri, ignore)]
fn config_without_paths_matches_no_prefix() {
    for options in ["{}", r#"{"paths": {}}"#, r#"{"baseUrl": "."}"#] {
        for prefix in ["", "@/a", "lib"] {
            assert!(
                !can_match_prefix(options, prefix),
                "{prefix} under {options}"
            );
        }
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn override_replaces_every_config() {
    let host = create_host(
        r#"
        /app/tsconfig.json {"compilerOptions": {"paths": {"app/*": ["./a/*"]}}}
        /app/nested/tsconfig.json {"compilerOptions": {"paths": {"nested/*": ["./a/*"]}}}
        /elsewhere/custom.json {"compilerOptions": {"paths": {"custom/*": ["./a/*"]}}}
        /elsewhere/tsconfig.json {"compilerOptions": {"paths": {"directory/*": ["./a/*"]}, "jsxImportSource": "custom"}}
        "#,
    );
    let cases = [
        ("/elsewhere/custom.json", "custom/*"),
        ("/elsewhere", "directory/*"),
        ("/elsewhere/missing.json", NO_CONFIG),
    ];
    for (path, expected) in cases {
        let directories = ["/app", "/app/nested", "/", "relative"];
        let everywhere = directories.map(|from| [from, expected]);
        assert_keys_of_paths(&host, &with_override(path), &everywhere);
    }
    let options = with_override("/elsewhere");
    let import_source = |path| text(&settings_with(&host, &options, path).jsx.import_source);
    assert_eq!(import_source("/app/a.tsx"), "custom");
    assert_eq!(import_source("/app/nested/a.tsx"), "custom");
    assert_eq!(
        text(&settings(&host, "/app/a.tsx").jsx.import_source),
        "react"
    );
}

#[test]
#[cfg_attr(miri, ignore)]
fn override_is_reported_for_every_directory() {
    let host = create_host("");
    for directory in ["/app", "/elsewhere", ""] {
        let is_under_override = |options: &CodeOptions| {
            with_resolver(&host, options, |resolver| {
                resolver.is_under_tsconfig_override(directory.as_bytes())
            })
        };
        assert!(
            is_under_override(&with_override("/elsewhere/custom.json")),
            "{directory}"
        );
        assert!(!is_under_override(&bun_run()), "{directory}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
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
#[cfg_attr(miri, ignore)]
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
#[cfg_attr(miri, ignore)]
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
#[cfg_attr(miri, ignore)]
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
#[cfg_attr(miri, ignore)]
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
        assert!(
            is_development(production_override(), Some(true), path),
            "{path}"
        );
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn runtime_specifier_follows_development() {
    let mut jsx = lib_settings(r#"{"jsxImportSource": "@emotion/react"}"#).jsx;
    assert_eq!(jsx.runtime_specifier(), b"@emotion/react/jsx-dev-runtime");
    jsx.is_development = false;
    assert_eq!(jsx.runtime_specifier(), b"@emotion/react/jsx-runtime");
}

#[test]
#[cfg_attr(miri, ignore)]
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

const APP_CONFIG: &str = r#"{"compilerOptions": {"useDefineForClassFields": false, "experimentalDecorators": true, "emitDecoratorMetadata": true, "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "F", "jsxImportSource": "preact"}}"#;

fn render_settings(settings: &TranspileSettings) -> String {
    let jsx = render_jsx(&settings.jsx);
    let (legacy, metadata) = (
        settings.experimental_decorators,
        settings.emits_decorator_metadata,
    );
    let define = settings.use_define_for_class_fields;
    format!("{jsx} | legacy {legacy} | metadata {metadata} | define {define:?}")
}

fn aot_package_host(manifest_rest: &str) -> MemoryHost {
    let exports = r#""exports": {".": {"aot": "./index.aot.tsx", "default": "./index.js"}}"#;
    let manifest = format!(r#"{{"name": "shapes", {exports}{manifest_rest}}}"#);
    MemoryHost::new(&[
        ("/app/tsconfig.json", APP_CONFIG),
        ("/app/node_modules/shapes/package.json", manifest.as_str()),
        (
            "/app/node_modules/plain/package.json",
            r#"{"name": "plain"}"#,
        ),
    ])
}

const PACKAGE_DEFAULTS: &str = "Automatic dev React.createElement React.Fragment react | legacy false | metadata false | define None";
const APP_SETTINGS: &str =
    "Classic dev h F preact | legacy true | metadata true | define Some(false)";

#[test]
#[cfg_attr(miri, ignore)]
fn aot_package_ignores_tsconfig_of_the_program() {
    let host = aot_package_host("");
    let of = |path| render_settings(&settings(&host, path));
    assert_eq!(of("/app/main.tsx"), APP_SETTINGS);
    assert_eq!(of("/app/node_modules/plain/index.tsx"), APP_SETTINGS);
    assert_eq!(of("/app/node_modules/shapes/index.js"), APP_SETTINGS);
    assert_eq!(
        of("/app/node_modules/shapes/index.aot.tsx"),
        PACKAGE_DEFAULTS
    );
    assert_eq!(of("/app/node_modules/shapes/lib/a.ts"), PACKAGE_DEFAULTS);
}

#[test]
#[cfg_attr(miri, ignore)]
fn aot_package_ignores_tsconfig_override_and_working_directory() {
    let host = aot_package_host("");
    let path = "/app/node_modules/shapes/index.aot.tsx";
    let overridden = with_override("/app/tsconfig.json");
    let by_working_directory = CodeOptions {
        transpiles_by_working_directory: true,
        ..bun_run()
    };
    for options in [overridden, by_working_directory] {
        let found = render_settings(&settings_with(&host, &options, path));
        assert_eq!(found, PACKAGE_DEFAULTS);
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn aot_package_ignores_jsx_flags_of_the_program() {
    let host = aot_package_host("");
    let mut options = bun_run();
    options.jsx.import_source = b"preact".to_vec();
    options.jsx.runtime = JsxRuntime::Classic;
    let path = "/app/node_modules/shapes/index.aot.tsx";
    let found = render_settings(&settings_with(&host, &options, path));
    assert_eq!(found, PACKAGE_DEFAULTS);
}

#[test]
#[cfg_attr(miri, ignore)]
fn aot_package_states_each_option_in_its_package_json() {
    let cases = [
        (
            r#""useDefineForClassFields": false"#,
            "Automatic dev React.createElement React.Fragment react | legacy false | metadata false | define Some(false)",
        ),
        (
            r#""useDefineForClassFields": true"#,
            "Automatic dev React.createElement React.Fragment react | legacy false | metadata false | define Some(true)",
        ),
        (
            r#""experimentalDecorators": true"#,
            "Automatic dev React.createElement React.Fragment react | legacy true | metadata false | define None",
        ),
        (
            r#""emitDecoratorMetadata": true"#,
            "Automatic dev React.createElement React.Fragment react | legacy false | metadata true | define None",
        ),
        (
            r#""jsx": "react""#,
            "Classic dev React.createElement React.Fragment react | legacy false | metadata false | define None",
        ),
        (
            r#""jsx": "react-jsx""#,
            "Automatic prod React.createElement React.Fragment react | legacy false | metadata false | define None",
        ),
        (
            r#""jsxFactory": "make""#,
            "Automatic dev make React.Fragment react | legacy false | metadata false | define None",
        ),
        (
            r#""jsxFragmentFactory": "Part""#,
            "Automatic dev React.createElement Part react | legacy false | metadata false | define None",
        ),
        (
            r#""jsxImportSource": "solid-js""#,
            "Automatic dev React.createElement React.Fragment solid-js | legacy false | metadata false | define None",
        ),
        (r#""target": "es5""#, PACKAGE_DEFAULTS),
        (r#""verbatimModuleSyntax": true"#, PACKAGE_DEFAULTS),
    ];
    for (option, expected) in cases {
        let host = aot_package_host(&format!(r#", "compilerOptions": {{{option}}}"#));
        let found = settings(&host, "/app/node_modules/shapes/index.aot.tsx");
        assert_eq!(render_settings(&found), expected, "{option}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn build_decides_jsx_development_of_aot_package() {
    let host = aot_package_host(r#", "compilerOptions": {"jsx": "react-jsxdev"}"#);
    let options = CodeOptions {
        forced_jsx_development: Some(false),
        ..bun_run()
    };
    let path = "/app/node_modules/shapes/index.aot.tsx";
    assert!(settings(&host, path).jsx.is_development);
    assert!(!settings_with(&host, &options, path).jsx.is_development);
}

#[test]
#[cfg_attr(miri, ignore)]
fn tsconfig_applies_inside_the_aot_package_being_worked_on() {
    let manifest = r#"{"name": "shapes", "exports": {".": {"aot": "./src/index.ts", "default": "./index.js"}}}"#;
    let host = MemoryHost::new(&[
        ("/app/tsconfig.json", APP_CONFIG),
        ("/app/package.json", manifest),
    ]);
    let inside = CodeOptions::bun_run(b"/app/test");
    for options in [bun_run(), inside] {
        let found = settings_with(&host, &options, "/app/src/index.ts");
        assert_eq!(render_settings(&found), APP_SETTINGS);
    }
    let beside = CodeOptions::bun_run(b"/other");
    let found = settings_with(&host, &beside, "/app/src/index.ts");
    assert_eq!(render_settings(&found), PACKAGE_DEFAULTS);
}
