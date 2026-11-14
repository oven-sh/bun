use super::{GlobPattern, PathParts, Segment, Usage, parse_segments};

fn each_path(parts: &[&'static [u8]], longest: usize) -> Vec<Vec<&'static [u8]>> {
    let mut paths: Vec<Vec<&'static [u8]>> = vec![Vec::new()];
    let mut from = 0;
    for _ in 0..longest {
        let to = paths.len();
        for at in from..to {
            for &part in parts {
                let mut path = paths[at].clone();
                path.push(part);
                paths.push(path);
            }
        }
        from = to;
    }
    paths
}

#[test]
fn directory_pattern_matches_paths() {
    let specs: [&[u8]; 24] = [
        b"**/*",
        b"*",
        b"src",
        b"src/**/*",
        b"src/**",
        b"src/*/a",
        b"src/*",
        b"src/a.ts",
        b"**/src/**/*",
        b"**/src/*",
        b"**/a",
        b"**/*.ts",
        b"src/**/a/**/*.ts",
        b"**/src/**/a/**/*",
        b"**/node_modules/**",
        b"**/.hidden/*",
        b"src/node_modules/*",
        b"*/a/*",
        b"*/**/a.ts",
        b"**/a/**/a.ts",
        b"src/a/../b",
        b"./**/b.test.ts",
        b"**",
        b"s*c/?",
    ];
    let names: [&[u8]; 8] = [
        b"src",
        b"a",
        b"a.ts",
        b"b.test.ts",
        b"x.min.js",
        b".hidden",
        b"node_modules",
        b"b",
    ];
    let folders: [&[u8]; 5] = [b"src", b"a", b"node_modules", b".hidden", b"b"];
    let (deepest, name_step) = if cfg!(miri) { (1, 4) } else { (4, 1) };
    for spec in specs {
        for usage in [Usage::Files, Usage::Directories, Usage::Exclude] {
            let prefix_only = usage == Usage::Directories;
            let Some(pattern) = GlobPattern::compile(spec, b"/base", usage, true) else {
                continue;
            };
            for below in each_path(&folders, deepest) {
                for root in [&[&b""[..], b"base"][..], &[b""], &[b"", b"other"]] {
                    let directory: Vec<&[u8]> = root.iter().copied().chain(below.clone()).collect();
                    let entered = pattern.in_directory(&directory);
                    for name in names.into_iter().step_by(name_step) {
                        let path = PathParts {
                            directory: &directory,
                            name,
                        };
                        assert_eq!(
                            entered.matches(name, prefix_only),
                            pattern.match_parts(path, 0, 0, prefix_only),
                            "{} in {:?} of {:?}",
                            bstr::BStr::new(spec),
                            bstr::BStr::new(name),
                            directory
                                .iter()
                                .map(|it| bstr::BStr::new(it))
                                .collect::<Vec<_>>(),
                        );
                    }
                }
            }
        }
    }
}

fn each_text(pieces: &[&str], longest: usize) -> Vec<String> {
    let mut texts = vec![String::new()];
    let mut from = 0;
    for _ in 0..longest {
        let to = texts.len();
        for at in from..to {
            for piece in pieces {
                texts.push(format!("{}{piece}", texts[at]));
            }
        }
        from = to;
    }
    texts
}

fn matches_sequentially(pattern: &GlobPattern, segments: &[Segment], name: &str) -> bool {
    let Some((first, others)) = segments.split_first() else {
        return name.is_empty();
    };
    let mut suffixes = name.char_indices().map(|(at, _)| &name[at..]).chain([""]);
    match first {
        Segment::Literal(literal) => {
            (name.as_bytes().get(..literal.len()))
                .is_some_and(|start| pattern.equal(literal, start))
                && matches_sequentially(pattern, others, &name[literal.len()..])
        }
        Segment::Question => {
            !name.is_empty() && {
                suffixes.next();
                suffixes
                    .next()
                    .is_some_and(|rest| matches_sequentially(pattern, others, rest))
            }
        }
        Segment::Star => suffixes.any(|rest| matches_sequentially(pattern, others, rest)),
    }
}

#[test]
fn segments_match_sequentially() {
    let (longest_spec, longest_name) = if cfg!(miri) { (2, 1) } else { (4, 3) };
    let specs = each_text(&["*", "?", "a", "b", "\u{e9}", "K"], longest_spec);
    let names = each_text(&["a", "b", "\u{e9}", "k"], longest_name);
    for case_sensitive in [true, false] {
        let pattern = GlobPattern {
            components: Vec::new(),
            is_exclude: true,
            case_sensitive,
            exclude_min_js: false,
        };
        for spec in &specs {
            let segments = parse_segments(spec.as_bytes());
            for name in &names {
                assert_eq!(
                    pattern.match_segments(&segments, name.as_bytes()),
                    matches_sequentially(&pattern, &segments, name),
                    "{spec} {name} {case_sensitive}",
                );
            }
        }
    }
}
