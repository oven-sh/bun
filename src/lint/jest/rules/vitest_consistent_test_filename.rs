use bun_lint_oxlint::regex_flags::rust_regex;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule triggers an error when a file is considered a test file, but its name does not match an expected filename format.
pub struct ConsistentTestFilename {
    all_test_pattern: Option<Regex>,
    pattern: Option<Regex>,
}

const CONSISTENT_TEST_FILENAME: Message =
    Message::new("", "The file {{file_path}} is a test file, but its name does not match the expected pattern.");

/// `/pattern/flags`, of which the flags are ignored, or a pattern.
fn matcher_pattern(configured: Option<&str>, default: &str) -> Option<Regex> {
    let pattern = configured.unwrap_or(default);
    let literal = pattern.strip_prefix('/').and_then(|it| it.get(..strings::last_index_of_char(it.as_bytes(), b'/')?));
    rust_regex(literal.unwrap_or(pattern), false)
}

impl Rule for ConsistentTestFilename {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "consistent-test-filename", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        ConsistentTestFilename {
            all_test_pattern: matcher_pattern(config.str("allTestPattern"), r".*\.(test|spec)\.[tj]sx?$"),
            pattern: matcher_pattern(config.str("pattern"), r".*\.test\.[tj]sx?$"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        let is_match = |pattern: &Option<Regex>| pattern.as_ref().is_some_and(|it| it.test(file.path()));
        if is_match(&self.all_test_pattern) && !is_match(&self.pattern) {
            on.finish(|_, cx| {
                let file_path = cx.file().path();
                let file_name = strings::last_index_of_any(file_path, b"/\\").and_then(|at| file_path.get(at + 1..));
                cx.report_at(0, CONSISTENT_TEST_FILENAME).data("file_path", file_name.unwrap_or(file_path));
            });
        }
    }
}
