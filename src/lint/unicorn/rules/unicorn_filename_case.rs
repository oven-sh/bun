use bun_lint_oxlint::regex_flags::regex_of_option;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Enforce a consistent case style for filenames.
pub struct FilenameCase {
    /// Those that are allowed, in the order of the message.
    cases: Vec<Case>,
    ignore: Vec<Regex>,
    multiple_file_extensions: bool,
}

const FILENAME_CASE: Message = Message::new("", "Filename should be in {{cases}}");

#[derive(Copy, Clone, PartialEq, Eq)]
enum Case {
    Camel,
    Kebab,
    Snake,
    Pascal,
    Lowercase,
    ScreamingSnake,
}

const CASES: [(Case, &str, &str); 6] = [
    (Case::Camel, "camelCase", "camelCase"),
    (Case::Kebab, "kebabCase", "kebab-case"),
    (Case::Snake, "snakeCase", "snake_case"),
    (Case::Pascal, "pascalCase", "PascalCase"),
    (Case::Lowercase, "lowercase", "lowercase"),
    (Case::ScreamingSnake, "screamingSnakeCase", "SCREAMING_SNAKE_CASE"),
];

/// Whether `c` belongs to the letter before it. Not all that Unicode says about that: the marks that names which are
/// decomposed have.
fn extends_grapheme(c: char) -> bool {
    matches!(
        u32::from(c),
        0x300..=0x36F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE00..=0xFE0F | 0xFE20..=0xFE2F | 0x200D
    )
}

fn is_cased(grapheme: &str) -> bool {
    !grapheme.chars().flat_map(char::to_uppercase).eq(grapheme.chars().flat_map(char::to_lowercase))
}

fn is_uppercase(grapheme: &str) -> bool {
    grapheme.chars().flat_map(char::to_uppercase).eq(grapheme.chars()) && is_cased(grapheme)
}

fn is_lowercase(grapheme: &str) -> bool {
    grapheme.chars().flat_map(char::to_lowercase).eq(grapheme.chars()) && is_cased(grapheme)
}

fn is_digit(grapheme: &str) -> bool {
    grapheme.bytes().all(|it| it.is_ascii_digit())
}

impl Case {
    /// `name` in this case, as the crate `convert_case` makes it: words end at `_`, `-`, a blank, between `a` and `B`,
    /// between `A` and `Bc`, and between a capital letter and a digit. A word can be empty.
    fn convert(self, name: &str) -> String {
        if self == Case::Lowercase || name.is_empty() {
            return name.to_lowercase();
        }
        // Where each grapheme starts, and the end.
        let mut starts: SmallVec<[usize; 64]> =
            name.char_indices().filter(|it| it.0 == 0 || !extends_grapheme(it.1)).map(|it| it.0).collect();
        starts.push(name.len());
        let grapheme = |i: usize| name.get(*starts.get(i)?..*starts.get(i + 1)?);
        let is = |i: usize, test: fn(&str) -> bool| grapheme(i).is_some_and(test);

        let mut converted = String::with_capacity(name.len() + 4);
        let mut is_first = true;
        let mut add = |word: &str| {
            if !is_first {
                converted.push_str(match self {
                    Case::Kebab => "-",
                    Case::Snake | Case::ScreamingSnake => "_",
                    _ => "",
                });
            }
            match self {
                Case::ScreamingSnake => converted.push_str(&word.to_uppercase()),
                Case::Pascal | Case::Camel if self == Case::Pascal || !is_first => {
                    let rest = word.char_indices().find(|it| it.0 != 0 && !extends_grapheme(it.1));
                    let (first, rest) = word.split_at_checked(rest.map_or(word.len(), |it| it.0)).unwrap_or((word, ""));
                    converted.push_str(&first.to_uppercase());
                    converted.push_str(&rest.to_lowercase());
                }
                _ => converted.push_str(&word.to_lowercase()),
            }
            is_first = false;
        };
        let mut word_start = 0;
        for i in 0..starts.len().saturating_sub(1) {
            let (Some(&start), Some(&end)) = (starts.get(i), starts.get(i + 1)) else {
                break;
            };
            if matches!(name.get(start..end), Some("_" | "-" | " ")) {
                add(name.get(word_start..start).unwrap_or_default());
                word_start = end;
            } else if is(i, is_lowercase) && is(i + 1, is_uppercase)
                || is(i, is_uppercase) && is(i + 1, is_uppercase) && is(i + 2, is_lowercase)
                || self != Case::ScreamingSnake
                    && (is(i, is_uppercase) && is(i + 1, is_digit) || is(i, is_digit) && is(i + 1, is_uppercase))
            {
                add(name.get(word_start..end).unwrap_or_default());
                word_start = end;
            }
        }
        add(name.get(word_start..).unwrap_or_default());
        converted
    }
}

/// What is before the element at `i` of a list of `len`.
fn separator(i: usize, len: usize) -> &'static str {
    match i {
        0 => "",
        _ if i + 1 == len => ", or ",
        _ => ", ",
    }
}

impl FilenameCase {
    /// The name of the file, and the part of it that has to be in one of the cases. `None`: nothing is asked of it.
    fn checked_part<'p>(&self, path: &'p [u8]) -> Option<(&'p [u8], &'p str)> {
        let raw_filename = bun_lint::paths::file_name(path);
        if raw_filename.is_empty()
            || raw_filename.starts_with(b".")
            || self.ignore.iter().any(|it| it.test(raw_filename))
        {
            return None;
        }
        let dot = match self.multiple_file_extensions {
            true => strings::index_of_char_usize(raw_filename, b'.'),
            false => strings::last_index_of_char(raw_filename, b'.'),
        };
        let filename = std::str::from_utf8(dot.and_then(|it| raw_filename.get(..it)).unwrap_or(raw_filename)).ok()?;
        if filename.eq_ignore_ascii_case("index") {
            return None;
        }
        Some((raw_filename, filename.trim_matches('_')))
    }

    /// The cases that the name of the file should be in, as the message lists them. `None` if it is in one.
    fn expected_cases(&self, path: &[u8]) -> Option<String> {
        let (_, trimmed_filename) = self.checked_part(path)?;
        if self.cases.iter().any(|it| it.convert(trimmed_filename) == trimmed_filename) {
            return None;
        }
        let mut expected = String::new();
        for (i, case) in self.cases.iter().enumerate() {
            expected.push_str(separator(i, self.cases.len()));
            expected.push_str(CASES.iter().find(|it| it.0 == *case).map_or("", |it| it.2));
        }
        Some(expected)
    }

    /// The name of the file in each of the cases.
    fn help(&self, path: &[u8]) -> String {
        let Some((raw_filename, trimmed_filename)) = self.checked_part(path) else {
            return String::new();
        };
        let around: Vec<&[u8]> = strings::split(raw_filename, trimmed_filename.as_bytes()).collect();
        let mut help = b"Rename the file to ".to_vec();
        for (i, case) in self.cases.iter().enumerate() {
            help.extend_from_slice(separator(i, self.cases.len()).as_bytes());
            help.push(b'\'');
            help.extend_from_slice(&around.join(case.convert(trimmed_filename).as_bytes()));
            help.push(b'\'');
        }
        bstr::BStr::new(&help).to_string()
    }
}

impl Rule for FilenameCase {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "filename-case", Kind::Suggestion);
    const ON: On = On::new().finish();
    /// See [`FilenameCase::expected_cases`].
    type State<'a> = Option<String>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let is_allowed = |case: &(Case, &str, &str)| match (options.str("case"), options.has("cases")) {
            (Some(name), _) => name == case.1,
            (None, true) => options.object("cases").bool_or(case.1, false),
            (None, false) => case.0 == Case::Kebab,
        };
        FilenameCase {
            cases: CASES.iter().filter(|it| is_allowed(it)).map(|it| it.0).collect(),
            ignore: options.strings("ignore").into_iter().filter_map(regex_of_option).collect(),
            multiple_file_extensions: options.bool_or("multipleFileExtensions", true),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Option<String>> {
        let expected = self.expected_cases(file.path()).filter(|_| !file.vue_script().is_second)?;
        Some(Some(expected))
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if let Some(cases) = &cx.state {
            cx.report(Span::empty(0), FILENAME_CASE)
                .data("cases", cases.clone())
                .help_with(|| self.help(cx.file().path()));
        }
    }
}
