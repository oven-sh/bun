use super::CodeImportKind::{Import, Require};
use super::memory_host::{ComputedPattern, MemoryHost, resolve_computed_with};
use super::*;

const STEM: &[u8] = b"./a";
const TYPESCRIPT_EXTENSIONS: [&[u8]; 4] = [b".ts", b".tsx", b".mts", b".cts"];

fn classify<'a>(prefix: &'a str, suffix: &str) -> PrefixKind<'a> {
    classify_prefix(prefix.as_bytes(), suffix.as_bytes())
}

fn extensions_of(kind: CodeImportKind) -> Vec<Vec<u8>> {
    let orders = CodeOptions::bun_run(b"/p").extension_orders;
    [orders.for_kind(kind, false), orders.for_kind(kind, true)].concat()
}

fn spellings_of(written: &str, kind: CodeImportKind) -> Vec<String> {
    let spellings = specifier_spellings(written.as_bytes(), &extensions_of(kind));
    let spellings = spellings.iter();
    spellings
        .map(|spelling| spelling.as_bstr().to_string())
        .collect()
}

fn import_pattern<'a>(prefix: &'a str, directory: &'a str) -> ComputedCodeRequest<'a> {
    ComputedCodeRequest {
        prefix: prefix.as_bytes(),
        suffix: b"",
        importer: b"/p/main.ts",
        directory: directory.as_bytes(),
        kind: Import,
        form: CodeImportForm::Static,
    }
}

fn with_search<T>(
    host: &MemoryHost,
    request: &ComputedCodeRequest<'_>,
    run: impl FnOnce(&mut CandidateSearch<'_, '_>) -> T,
) -> T {
    let session = Session::new();
    let options = Options::default();
    let code = CodeOptions {
        max_computed_candidates: 7,
        ..CodeOptions::bun_run(b"/p")
    };
    let resolver = Resolver::for_compile(&session, host, &options, &code);
    run(&mut CandidateSearch::new(&resolver, *request))
}

#[test]
fn empty_prefix_has_own_kind() {
    for suffix in ["", ".js", "?", "/../a"] {
        assert_eq!(classify("", suffix), PrefixKind::Empty, "{suffix}");
    }
}

#[test]
fn path_prefix_is_rooted_or_starts_with_dot_segment() {
    for prefix in ["./", "../", "./a", "./a/b/", "../a", "/abs/", "/abs/a"] {
        assert_eq!(classify(prefix, ""), PrefixKind::Path, "{prefix}");
    }
    for suffix in [".js", "/index.js", "...", "a..b"] {
        assert_eq!(classify("./a/", suffix), PrefixKind::Path, "{suffix}");
    }
}

#[test]
fn package_prefix_has_complete_name() {
    let complete = [
        ("pkg/", "pkg"),
        ("pkg/lib/a", "pkg"),
        ("@scope/pkg/", "@scope/pkg"),
        ("@scope/pkg/lib", "@scope/pkg"),
    ];
    for (prefix, name) in complete {
        let expected = PrefixKind::Package {
            name: name.as_bytes(),
        };
        assert_eq!(classify(prefix, ""), expected, "{prefix}");
    }
    for prefix in ["pkg", "@", "@scope", "@scope/", "@scope/pkg", "node", "bun"] {
        assert_eq!(
            classify(prefix, ""),
            PrefixKind::IncompletePackageName,
            "{prefix}"
        );
    }
}

#[test]
fn host_scheme_prefix_has_whole_scheme() {
    for prefix in ["node:", "node:f", "node:fs/", "bun:", "bun:sql"] {
        assert_eq!(classify(prefix, ""), PrefixKind::HostScheme, "{prefix}");
    }
}

#[test]
fn hash_prefix_names_package_imports() {
    for prefix in ["#", "#a", "#internal/"] {
        assert_eq!(classify(prefix, ""), PrefixKind::PackageImports, "{prefix}");
    }
}

#[test]
fn url_prefix_is_url_and_part_of_one_is_unclear() {
    for prefix in [
        "http://",
        "https://x/",
        "//",
        "//cdn/",
        "data:",
        "data:text,",
    ] {
        assert_eq!(classify(prefix, ""), PrefixKind::Url, "{prefix}");
    }
    assert_eq!(classify("https://x/", "?query"), PrefixKind::Url);
    for prefix in ["h", "http", "https:/", "/", "d", "data"] {
        assert_eq!(classify(prefix, ""), PrefixKind::Unclear, "{prefix}");
    }
    assert_eq!(classify("h", "?query"), PrefixKind::Unclear);
}

#[test]
fn query_or_nul_never_resolves() {
    let cases = [
        ("./a/?", ""),
        ("./a/", "?x"),
        ("./a/\0", ""),
        ("./a/", "\0"),
        ("./a/..", "?x"),
        ("pkg/", "?x"),
        ("pkg", "?x"),
        ("node:", "?x"),
        ("#a/", "?x"),
    ];
    for (prefix, suffix) in cases {
        let kind = classify(prefix, suffix);
        assert_eq!(kind, PrefixKind::NeverResolves, "{prefix:?} {suffix:?}");
    }
}

#[test]
fn pattern_able_to_name_other_directory_is_unclear() {
    let cases = [
        (".", ""),
        ("..", ""),
        (".hidden", ""),
        ("./a/.", ""),
        ("./a/..", ""),
        ("pkg/..", ""),
        ("./a/", ".."),
        ("./a/", "/../b"),
        ("./a/", "/./b"),
        ("pkg/", "/../b"),
        ("./a\\", ""),
        ("./a/", "\\b"),
    ];
    for (prefix, suffix) in cases {
        assert_eq!(
            classify(prefix, suffix),
            PrefixKind::Unclear,
            "{prefix:?} {suffix:?}"
        );
    }
}

#[test]
fn typescript_file_is_spelled_with_javascript_extensions() {
    assert_eq!(
        spellings_of("./a.ts", Import),
        ["./a.ts", "./a", "./a.js", "./a.jsx"]
    );
    assert_eq!(
        spellings_of("./a.tsx", Import),
        ["./a.tsx", "./a", "./a.js", "./a.jsx"]
    );
    let module = ["./a.mts", "./a", "./a.js", "./a.jsx", "./a.mjs"];
    assert_eq!(spellings_of("./a.mts", Import), module);
    assert_eq!(
        spellings_of("./a.cts", Import),
        ["./a.cts", "./a", "./a.cjs"]
    );
}

#[test]
fn extension_in_extension_order_is_optional() {
    assert_eq!(spellings_of("./a.js", Import), ["./a.js", "./a"]);
    assert_eq!(spellings_of("./a.json", Import), ["./a.json", "./a"]);
    assert_eq!(spellings_of("./a.txt", Import), ["./a.txt"]);
    assert_eq!(spellings_of("./a.node", Import), ["./a.node"]);
    assert_eq!(spellings_of("./a.node", Require), ["./a.node", "./a"]);
}

#[test]
fn only_last_extension_of_file_name_is_replaced() {
    assert_eq!(spellings_of("./a", Import), ["./a"]);
    assert_eq!(spellings_of("./d.ts/a", Import), ["./d.ts/a"]);
    assert_eq!(
        spellings_of("./a.test.js", Import),
        ["./a.test.js", "./a.test"]
    );
    let declarations = ["./a.d.ts", "./a.d", "./a.d.js", "./a.d.jsx"];
    assert_eq!(spellings_of("./a.d.ts", Import), declarations);
}

#[test]
fn spellings_invert_rewritten_extensions() {
    for written in REWRITABLE_EXTENSIONS {
        for &found in rewritten_extensions(written) {
            let spellings = specifier_spellings(&[STEM, found].concat(), &[]);
            let spelling = [STEM, written].concat();
            assert!(spellings.contains(&spelling), "{}", spelling.as_bstr());
        }
    }
    for found in TYPESCRIPT_EXTENSIONS {
        let file = [STEM, found].concat();
        let spellings = specifier_spellings(&file, &[]);
        assert_eq!(spellings[0], file);
        assert!(spellings.len() > 1, "{}", file.as_bstr());
        for spelling in &spellings[1..] {
            let rewritten = rewritten_extensions(&spelling[STEM.len()..]);
            assert!(
                rewritten.iter().any(|it| *it == found),
                "{}",
                spelling.as_bstr()
            );
        }
    }
}

#[test]
fn prefix_and_suffix_do_not_overlap() {
    assert!(matches_pattern(b"./ab", b"./a", b"b"));
    assert!(matches_pattern(b"./axb", b"./a", b"b"));
    assert!(matches_pattern(b"./a", b"./a", b""));
    assert!(matches_pattern(b"", b"", b""));
    assert!(!matches_pattern(b"./a", b"./a", b"a"));
    assert!(!matches_pattern(b"./aba", b"./ab", b"ba"));
    assert!(!matches_pattern(b"./b", b"./a", b""));
    assert!(!matches_pattern(b"./ab", b"./a", b"c"));
}

#[test]
fn target_pattern_matches_same_text_at_every_star() {
    assert_eq!(
        match_target(b"./lib/*.js", b"./lib/a/b.js"),
        Some(&b"a/b"[..])
    );
    assert_eq!(match_target(b"./*/*.js", b"./x/x.js"), Some(&b"x"[..]));
    assert_eq!(match_target(b"./*/*.js", b"./x/y.js"), None);
    assert_eq!(match_target(b"./lib/*.js", b"./src/a.js"), None);
    assert_eq!(match_target(b"./lib/*.js", b"./a.js"), None);
    assert_eq!(match_target(b"./lib/a.js", b"./lib/a.js"), None);
}

#[test]
fn text_is_split_after_last_slash() {
    let cases: [(&[u8], &[u8], &[u8]); 5] = [
        (b"./a/b", b"./a/", b"b"),
        (b"./a/", b"./a/", b""),
        (b"/", b"/", b""),
        (b"a", b"", b"a"),
        (b"", b"", b""),
    ];
    for (text, directory, name) in cases {
        assert_eq!(split_after_last_slash(text), (directory, name));
    }
}

#[test]
fn dot_segment_is_one_or_two_dots() {
    assert!(is_dot_segment(b"."));
    assert!(is_dot_segment(b".."));
    assert!(!is_dot_segment(b""));
    assert!(!is_dot_segment(b"..."));
    assert!(!is_dot_segment(b".a"));
}

#[test]
fn candidates_are_sorted_and_unique() {
    let file = |path: &'static [u8], host_module: Option<u32>| {
        ComputedCandidate::File(CodeFile {
            path,
            host_module: host_module.map(HostModuleId),
        })
    };
    let module = |id: u32| ComputedCandidate::HostModule(HostModuleId(id));
    let candidates = vec![
        module(9),
        file(b"/b.ts", None),
        module(4),
        file(b"/a.ts", Some(1)),
        file(b"/b.ts", None),
        file(b"/a.ts", None),
        module(9),
    ];
    let expected = [
        file(b"/a.ts", None),
        file(b"/a.ts", Some(1)),
        file(b"/b.ts", None),
        module(4),
        module(9),
    ];
    let arena = Arena::new();
    assert_eq!(sorted_candidates_in(candidates, &arena), expected);
    assert!(sorted_candidates_in(Vec::new(), &arena).is_empty());
}

#[test]
#[cfg_attr(miri, ignore)]
fn search_starts_in_request_directory_or_working_directory() {
    let host = MemoryHost::new(&[]);
    let directory_of = |directory: &str| {
        let request = import_pattern("./", directory);
        with_search(&host, &request, |search| {
            search.directory.as_bstr().to_string()
        })
    };
    assert_eq!(directory_of("/q/src"), "/q/src");
    assert_eq!(directory_of("/q/src/"), "/q/src");
    assert_eq!(directory_of(""), "/p");
    assert_eq!(directory_of("src"), "/p");
}

#[test]
#[cfg_attr(miri, ignore)]
fn search_has_limit_and_extension_orders_of_options() {
    let host = MemoryHost::new(&[]);
    with_search(&host, &import_pattern("./", "/p"), |search| {
        assert_eq!(search.limit, 7);
        assert_eq!(search.extensions, extensions_of(Import));
    });
    let required = ComputedCodeRequest {
        kind: Require,
        ..import_pattern("./", "/p")
    };
    with_search(&host, &required, |search| {
        assert_eq!(search.extensions, extensions_of(Require));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn specifier_outside_pattern_is_not_resolved() {
    let host = MemoryHost::new(&[("/p/a.ts", ""), ("/p/b.ts", "")]);
    with_search(&host, &import_pattern("./a", "/p"), |search| {
        assert_eq!(search.try_specifier(b"./b.ts"), Ok(()));
        assert!(search.tried.is_empty());
        assert!(search.candidates.is_empty());
        assert!(search.spellings.is_empty());
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn specifier_is_resolved_once() {
    let host = MemoryHost::new(&[("/p/a.ts", "")]);
    with_search(&host, &import_pattern("./a", "/p"), |search| {
        for _ in 0..2 {
            assert_eq!(search.try_specifier(b"./a.ts"), Ok(()));
            assert_eq!(search.try_specifier(b"./a.missing"), Ok(()));
        }
        let file = CodeFile {
            path: b"/p/a.ts",
            host_module: None,
        };
        let candidate = ComputedCandidate::File(file);
        assert_eq!(search.candidates, [candidate]);
        assert_eq!(search.spellings, [(b"./a.ts".to_vec(), candidate)]);
        assert_eq!(search.tried.len(), 2);
    });
}

#[test]
fn spellings_are_sorted_and_name_sorted_candidates() {
    let file = |path: &'static [u8]| {
        ComputedCandidate::File(CodeFile {
            path,
            host_module: None,
        })
    };
    let module = ComputedCandidate::HostModule(HostModuleId(4));
    let candidates = [file(b"/a.ts"), file(b"/b.ts"), module];
    let spellings = vec![
        (b"./b".to_vec(), file(b"/b.ts")),
        (b"fs".to_vec(), module),
        (b"./a.js".to_vec(), file(b"/a.ts")),
        (b"./a".to_vec(), file(b"/a.ts")),
    ];
    let spelling = |text: &'static [u8], candidate| ComputedSpelling { text, candidate };
    let expected = [
        spelling(b"./a", 0),
        spelling(b"./a.js", 0),
        spelling(b"./b", 1),
        spelling(b"fs", 2),
    ];
    let arena = Arena::new();
    assert_eq!(
        sorted_spellings_in(spellings, &candidates, &arena),
        expected
    );
    assert!(sorted_spellings_in(Vec::new(), &candidates, &arena).is_empty());
}

#[test]
#[cfg_attr(miri, ignore)]
fn answer_lists_every_spelling_inside_pattern() {
    let host = MemoryHost::new(&[
        ("/p/plugins/a.ts", ""),
        ("/p/plugins/b/index.js", ""),
        ("/p/other.ts", ""),
    ]);
    let session = Session::new();
    let (options, code) = (Options::default(), CodeOptions::bun_run(b"/p"));
    let resolver = Resolver::for_compile(&session, &host, &options, &code);
    let answer = resolver.resolve_computed_code(&import_pattern("./plugins/", "/p"));
    let ComputedResolution::Candidates {
        candidates,
        spellings,
    } = answer
    else {
        panic!("{answer:?}");
    };
    let paths = candidates.iter().map(|candidate| match candidate {
        ComputedCandidate::File(file) => file.path,
        ComputedCandidate::HostModule(module) => panic!("{module:?}"),
    });
    let paths: Vec<&[u8]> = paths.collect();
    assert_eq!(paths, [&b"/p/plugins/a.ts"[..], b"/p/plugins/b/index.js"]);
    let spellings: Vec<(&str, u32)> = spellings
        .iter()
        .map(|it| (core::str::from_utf8(it.text).unwrap(), it.candidate))
        .collect();
    let expected = [
        ("./plugins/a", 0),
        ("./plugins/a.js", 0),
        ("./plugins/a.jsx", 0),
        ("./plugins/a.ts", 0),
        ("./plugins/b", 1),
        ("./plugins/b/", 1),
        ("./plugins/b/index", 1),
        ("./plugins/b/index.js", 1),
    ];
    assert_eq!(spellings, expected);
}

#[test]
#[cfg_attr(miri, ignore)]
fn exported_specifier_is_also_tried_with_javascript_extension() {
    let host = MemoryHost::new(&[]);
    with_search(&host, &import_pattern("pkg/", "/p"), |search| {
        assert_eq!(search.try_exported_specifier(b"pkg/a"), Ok(()));
        let mut tried: Vec<Vec<u8>> = search.tried.iter().cloned().collect();
        tried.sort_unstable();
        assert_eq!(tried, [&b"pkg/a"[..], b"pkg/a.js"]);
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn uncompiled_specifier_ends_search() {
    let uncompiled = HostResolution::External {
        specifier: b"./a.ts".to_vec(),
        kind: ExternalKind::UncompiledCode,
    };
    let host = MemoryHost::new(&[("/p/a.ts", "")]).claim("./a.ts", uncompiled);
    with_search(&host, &import_pattern("./a", "/p"), |search| {
        let outcome = search.try_specifier(b"./a.ts");
        assert_eq!(outcome, Err(ComputedUnknown::ExternalCandidate));
        assert!(search.candidates.is_empty());
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn packages_in_node_path_are_listed() {
    let host = MemoryHost::new(&[
        ("/p/main.ts", ""),
        ("/global/pkg/a.js", ""),
        ("/global/other/b.js", ""),
    ])
    .node_path("/global");
    let pattern = ComputedPattern {
        importer: "/p/main.ts",
        prefix: "pkg/",
        suffix: "",
        kind: Import,
    };
    let with_node_path = CodeOptions {
        node_paths: vec![b"/global".to_vec()],
        ..CodeOptions::bun_run(b"/p")
    };
    assert_eq!(
        resolve_computed_with(&host, &with_node_path, pattern),
        "/global/pkg/a.js"
    );
    assert_eq!(
        resolve_computed_with(&host, &CodeOptions::bun_run(b"/p"), pattern),
        ""
    );
}
