use bun_lint_oxlint::regex_flags::rust_regex;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule triggers an error when a file is considered a test file, but its name does not match an expected filename format.
pub struct ConsistentTestFilename {
    /// By default `.*\.(test|spec)\.[tj]sx?$`
    all_test_pattern: Matcher,
    /// By default `.*\.test\.[tj]sx?$`
    pattern: Matcher,
    /// As `help` has it.
    pattern_source: String,
}

enum Matcher {
    Default,
    /// The option, if it is a pattern.
    Pattern(Option<Box<Regex>>),
}

const CONSISTENT_TEST_FILENAME: Message =
    Message::new("", "The file {{file_path}} is a test file, but its name does not match the expected pattern.");

/// Of `/pattern/flags`, of which the flags are ignored, the pattern.
fn source_of(pattern: &str) -> &str {
    let literal = pattern.strip_prefix('/').and_then(|it| it.get(..strings::last_index_of_char(it.as_bytes(), b'/')?));
    literal.unwrap_or(pattern)
}

fn matcher_pattern(configured: Option<&str>) -> Matcher {
    match configured {
        Some(pattern) => Matcher::Pattern(rust_regex(source_of(pattern), false).map(Box::new)),
        None => Matcher::Default,
    }
}

/// The `test` or `spec` of a path that `\.(test|spec)\.[tj]sx?$` matches.
fn kind_of_test(path: &[u8]) -> Option<&'static [u8]> {
    let extensions: [&[u8]; 4] = [b".ts", b".tsx", b".js", b".jsx"];
    let rest = extensions.iter().find_map(|it| path.strip_suffix(*it))?;
    let kinds: [&'static [u8]; 2] = [b"test", b"spec"];
    (kinds.into_iter()).find(|it| rest.strip_suffix(*it).is_some_and(|rest| rest.ends_with(b".")))
}

impl Rule for ConsistentTestFilename {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "consistent-test-filename", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        ConsistentTestFilename {
            all_test_pattern: matcher_pattern(config.str("allTestPattern")),
            pattern: matcher_pattern(config.str("pattern")),
            pattern_source: config.str("pattern").map_or(r".*\.test\.[tj]sx?$", source_of).to_owned(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        let path = file.path();
        let is_match = |matcher: &Matcher, is_default: fn(&[u8]) -> bool| match matcher {
            Matcher::Default => kind_of_test(path).is_some_and(is_default),
            Matcher::Pattern(pattern) => pattern.as_ref().is_some_and(|it| it.test(path)),
        };
        if is_match(&self.all_test_pattern, |_| true) && !is_match(&self.pattern, |kind| kind == b"test") {
            on.finish(|rule, cx| {
                let file_name = bun_lint::paths::file_name(cx.file().path());
                cx.report_file(CONSISTENT_TEST_FILENAME)
                    .data("file_path", file_name)
                    .data("pattern", rule.pattern_source.clone());
            });
        }
    }
}
