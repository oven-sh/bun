use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::tokens::token_len;
use bun_lint::utils::text;
use smallvec::SmallVec;

/// Disallow specified modules when loaded by `import`.
pub struct NoRestrictedImports {
    restrictions: Restrictions,
}

/// A message, and the same with `{{customMessage}}` after it.
type Messages = (Message, Message);

const PATH: Messages = (
    Message::new("path", "'{{importSource}}' import is restricted from being used."),
    Message::new(
        "pathWithCustomMessage",
        "'{{importSource}}' import is restricted from being used. {{customMessage}}",
    ),
);
const PATTERNS: Messages = (
    Message::new(
        "patterns",
        "'{{importSource}}' import is restricted from being used by a pattern.",
    ),
    Message::new(
        "patternWithCustomMessage",
        "'{{importSource}}' import is restricted from being used by a pattern. {{customMessage}}",
    ),
);
const PATTERN_AND_IMPORT_NAME: Messages = (
    Message::new(
        "patternAndImportName",
        "'{{importName}}' import from '{{importSource}}' is restricted from being used by a pattern.",
    ),
    Message::new(
        "patternAndImportNameWithCustomMessage",
        "'{{importName}}' import from '{{importSource}}' is restricted from being used by a pattern. {{customMessage}}",
    ),
);
const PATTERN_AND_EVERYTHING: Messages = (
    Message::new(
        "patternAndEverything",
        "* import is invalid because {{importNames}} from '{{importSource}}' {{isOrAre}} restricted from being used by a pattern.",
    ),
    Message::new(
        "patternAndEverythingWithCustomMessage",
        "* import is invalid because {{importNames}} from '{{importSource}}' {{isOrAre}} restricted from being used by a pattern. {{customMessage}}",
    ),
);
const PATTERN_AND_EVERYTHING_WITH_REGEX_IMPORT_NAME: Messages = (
    Message::new(
        "patternAndEverythingWithRegexImportName",
        "* import is invalid because import name matching '{{importNames}}' pattern from '{{importSource}}' is restricted from being used.",
    ),
    Message::new(
        "patternAndEverythingWithRegexImportNameAndCustomMessage",
        "* import is invalid because import name matching '{{importNames}}' pattern from '{{importSource}}' is restricted from being used. {{customMessage}}",
    ),
);
const EVERYTHING: Messages = (
    Message::new(
        "everything",
        "* import is invalid because {{importNames}} from '{{importSource}}' {{isOrAre}} restricted.",
    ),
    Message::new(
        "everythingWithCustomMessage",
        "* import is invalid because {{importNames}} from '{{importSource}}' {{isOrAre}} restricted. {{customMessage}}",
    ),
);
const IMPORT_NAME: Messages = (
    Message::new(
        "importName",
        "'{{importName}}' import from '{{importSource}}' is restricted.",
    ),
    Message::new(
        "importNameWithCustomMessage",
        "'{{importName}}' import from '{{importSource}}' is restricted. {{customMessage}}",
    ),
);
const ALLOWED_IMPORT_NAME: Messages = (
    Message::new(
        "allowedImportName",
        "'{{importName}}' import from '{{importSource}}' is restricted because only {{allowedImportNames}} {{isOrAre}} allowed.",
    ),
    Message::new(
        "allowedImportNameWithCustomMessage",
        "'{{importName}}' import from '{{importSource}}' is restricted because only {{allowedImportNames}} {{isOrAre}} allowed. {{customMessage}}",
    ),
);
const EVERYTHING_WITH_ALLOW_IMPORT_NAMES: Messages = (
    Message::new(
        "everythingWithAllowImportNames",
        "* import is invalid because only {{allowedImportNames}} from '{{importSource}}' {{isOrAre}} allowed.",
    ),
    Message::new(
        "everythingWithAllowImportNamesAndCustomMessage",
        "* import is invalid because only {{allowedImportNames}} from '{{importSource}}' {{isOrAre}} allowed. {{customMessage}}",
    ),
);
const ALLOWED_IMPORT_NAME_PATTERN: Messages = (
    Message::new(
        "allowedImportNamePattern",
        "'{{importName}}' import from '{{importSource}}' is restricted because only imports that match the pattern '{{allowedImportNamePattern}}' are allowed from '{{importSource}}'.",
    ),
    Message::new(
        "allowedImportNamePatternWithCustomMessage",
        "'{{importName}}' import from '{{importSource}}' is restricted because only imports that match the pattern '{{allowedImportNamePattern}}' are allowed from '{{importSource}}'. {{customMessage}}",
    ),
);
const EVERYTHING_WITH_ALLOWED_IMPORT_NAME_PATTERN: Messages = (
    Message::new(
        "everythingWithAllowedImportNamePattern",
        "* import is invalid because only imports that match the pattern '{{allowedImportNamePattern}}' from '{{importSource}}' are allowed.",
    ),
    Message::new(
        "everythingWithAllowedImportNamePatternWithCustomMessage",
        "* import is invalid because only imports that match the pattern '{{allowedImportNamePattern}}' from '{{importSource}}' are allowed. {{customMessage}}",
    ),
);

// ───────────────────────────── the npm package `ignore` ─────────────────────────────

/// Which major version of the npm package `ignore` to behave as. ESLint depends on 5,
/// typescript-eslint on 7.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum IgnoreVersion {
    V5,
    V7,
}

/// `ignore({ allowRelativePaths: true, ignoreCase }).add(patterns)` of the npm package `ignore`:
/// the patterns of a `.gitignore` file.
// TODO(api): replace by utils::ignore::Ignore
pub struct Ignore {
    rules: Vec<IgnoreRule>,
    version: IgnoreVersion,
}

struct IgnoreRule {
    is_negative: bool,
    regex: Regex,
}

impl Ignore {
    pub fn new(patterns: &[&str], ignores_case: bool, version: IgnoreVersion) -> Ignore {
        let mut rules = Vec::with_capacity(patterns.len());
        for &pattern in patterns {
            let bytes = pattern.as_bytes();
            let has_trailing_backslash = bytes.ends_with(b"\\") && !bytes.ends_with(b"\\\\");
            if text::is_blank(bytes) || has_trailing_backslash || bytes.starts_with(b"#") {
                continue;
            }
            let (is_negative, body) = match pattern.strip_prefix('!') {
                Some(rest) => (true, rest),
                None => (false, pattern),
            };
            let body = match body.strip_prefix('\\') {
                Some(rest) if rest.starts_with(['!', '#']) => rest,
                _ => body,
            };
            let flags = if ignores_case { "i" } else { "" };
            if let Ok(regex) = Regex::new(&ignore_regex_source(body, version), flags) {
                rules.push(IgnoreRule { is_negative, regex });
            }
        }
        Ignore { rules, version }
    }

    /// `_testOne(path, false).ignored`
    fn test_one(&self, path: &[u8]) -> bool {
        let mut is_ignored = false;
        for rule in &self.rules {
            if rule.is_negative == is_ignored && rule.regex.test(path) {
                is_ignored = !rule.is_negative;
            }
        }
        is_ignored
    }

    /// `ignores(path)`: whether a pattern matches `path` or a directory that it is in.
    pub fn ignores(&self, path: &[u8]) -> bool {
        match self.version {
            IgnoreVersion::V5 => {
                let mut at = 0;
                while let Some(slash) = strings::index_of_char_usize(&path[at..], b'/') {
                    at += slash + 1;
                    if self.test_one(&path[..at]) {
                        return true;
                    }
                }
            }
            // Empty segments are left out of the directories.
            IgnoreVersion::V7 => {
                let mut segments = strings::split(path, b"/").filter(|it| !it.is_empty()).peekable();
                let mut parent = Vec::with_capacity(path.len());
                while let Some(segment) = segments.next() {
                    if segments.peek().is_none() {
                        break;
                    }
                    parent.extend_from_slice(segment);
                    parent.push(b'/');
                    if self.test_one(&parent) {
                        return true;
                    }
                }
            }
        }
        self.test_one(path)
    }
}

fn has_at(s: &[char], at: usize, literal: &str) -> bool {
    let mut rest = s.get(at..).unwrap_or_default().iter();
    literal.chars().all(|c| rest.next() == Some(&c))
}

fn is_space(c: char) -> bool {
    text::is_js_whitespace(c as u32)
}

/// The number of `\` that `s` starts with.
fn leading_backslashes(s: &[char]) -> usize {
    s.iter().take_while(|c| **c == '\\').count()
}

/// The number of `\` that `s` ends with.
fn trailing_backslashes(s: &[char]) -> usize {
    s.iter().rev().take_while(|c| **c == '\\').count()
}

/// `sanitizeRange`: without the `b-a` that a regular expression rejects.
fn sanitize_range(range: &[char]) -> Vec<char> {
    let is_bound = |c: Option<&char>| c.is_some_and(|c| ('0'..='z').contains(c));
    let mut out = Vec::with_capacity(range.len());
    let mut i = 0;
    while i < range.len() {
        if is_bound(range.get(i)) && range.get(i + 1) == Some(&'-') && is_bound(range.get(i + 2)) {
            if range[i] <= range[i + 2] {
                out.extend_from_slice(&range[i..i + 3]);
            }
            i += 3;
        } else {
            out.push(range[i]);
            i += 1;
        }
    }
    out
}

/// `makeRegex(pattern).source`: each block is one or several of the `REPLACERS`, in their order.
fn ignore_regex_source(pattern: &str, version: IgnoreVersion) -> String {
    let pattern: Vec<char> = pattern.chars().collect();
    let mut s = pattern.clone();

    if s.first() == Some(&'\u{FEFF}') {
        s.remove(0);
    }

    // Trailing spaces are ignored unless they are quoted with a backslash.
    let end = s.len() - s.iter().rev().take_while(|c| is_space(**c)).count();
    if end < s.len() {
        s.truncate(end);
        if trailing_backslashes(&s) % 2 == 1 {
            s.pop();
            s.push(' ');
        }
    }

    // `\ ` is a space.
    let mut out = Vec::with_capacity(s.len() * 2);
    let mut i = 0;
    while i < s.len() {
        let backslashes = leading_backslashes(&s[i..]);
        if backslashes == 0 {
            out.push(s[i]);
            i += 1;
            continue;
        }
        i += backslashes;
        let is_before_space = s.get(i).is_some_and(|c| is_space(*c));
        let kept = if is_before_space { backslashes - backslashes % 2 } else { backslashes };
        out.extend(std::iter::repeat_n('\\', kept));
        if is_before_space {
            out.push(' ');
            i += 1;
        }
    }
    s = out;

    // Metacharacters are escaped, `?` is any character of a name, a leading `/` is the start.
    let mut out = Vec::with_capacity(s.len() * 2);
    for (i, &c) in s.iter().enumerate() {
        match c {
            '\\' | '$' | '.' | '|' | '*' | '+' | '(' | ')' | '{' | '^' => out.extend(['\\', c]),
            '?' => out.extend("[^\\/]".chars()),
            '/' if i == 0 => out.push('^'),
            '/' => out.extend(['\\', '/']),
            _ => out.push(c),
        }
    }
    s = out;

    // A leading `**/` is any directory.
    let carets = s.iter().take_while(|c| **c == '^').count();
    let mut end = carets;
    while has_at(&s, end, "\\*\\*\\/") {
        end += 6;
        if version == IgnoreVersion::V5 {
            break;
        }
    }
    if end > carets {
        s = "^(?:.*\\/)?".chars().chain(s[end..].iter().copied()).collect();
    }

    // A pattern with a `/` that is not its last character is relative to the root.
    if s.first().is_some_and(|c| *c != '^') {
        let has_inner_slash = pattern.iter().rev().skip(1).any(|c| *c == '/');
        let start = if has_inner_slash { "^" } else { "(?:^|\\/)" };
        s = start.chars().chain(s.iter().copied()).collect();
    }

    // `/**/` is any number of directories, a trailing `/**` everything inside.
    let mut out = Vec::with_capacity(s.len() * 2);
    let mut i = 0;
    while i < s.len() {
        if has_at(&s, i, "\\/\\*\\*") && (i + 6 == s.len() || has_at(&s, i + 6, "\\/")) {
            out.extend(if i + 6 < s.len() { "(?:\\/[^\\/]+)*" } else { "\\/.+" }.chars());
            i += 6;
        } else {
            out.push(s[i]);
            i += 1;
        }
    }
    s = out;

    // Other `*` that are neither escaped nor the last character: anything but a `/`.
    let end_of_stars = |at: usize| {
        let mut count = 0;
        while has_at(&s, at + 2 * count, "\\*") {
            count += 1;
        }
        let mut ends = (1..=count).rev().map(|n| at + 2 * n);
        ends.find(|&end| s.get(end).is_some_and(|c| !text::is_line_terminator(*c as u32)))
    };
    let mut out = Vec::with_capacity(s.len() * 2);
    let (mut copied, mut i) = (0, 0);
    while i < s.len() {
        let mut stars = i;
        let mut end = if i == 0 { end_of_stars(0) } else { None };
        if end.is_none() {
            stars += s[i..].iter().take_while(|c| **c != '\\').count();
            if stars > i {
                end = end_of_stars(stars);
            }
        }
        match end {
            Some(end) => {
                out.extend_from_slice(&s[copied..stars]);
                out.extend("[^\\/]*".chars());
                copied = end;
                i = end;
            }
            None => i = stars.max(i + 1),
        }
    }
    out.extend_from_slice(&s[copied..]);
    s = out;

    // What the pattern itself escapes was escaped twice.
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let is_escaped_twice = has_at(&s, i, "\\\\\\")
            && matches!(s.get(i + 3), Some('$' | '.' | '|' | '*' | '+' | '(' | ')' | '{' | '^'));
        out.push(s[i]);
        i += if is_escaped_twice { 3 } else { 1 };
    }
    s = out;
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        out.push(s[i]);
        i += if has_at(&s, i, "\\\\") { 2 } else { 1 };
    }
    s = out;

    // `[a-z]`
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let is_escaped = s[i] == '\\' && s.get(i + 1) == Some(&'[');
        let inside = i + usize::from(is_escaped) + 1;
        let close = inside
            + (s.get(inside..).unwrap_or_default().iter())
                .take_while(|c| !matches!(**c, ']' | '/'))
                .count();
        if s.get(inside - 1) != Some(&'[') || s.get(close) == Some(&'/') {
            out.push(s[i]);
            i += 1;
            continue;
        }
        let escapes = trailing_backslashes(&s[inside..close]);
        let range = &s[inside..close - escapes];
        let is_closed = close < s.len();
        if is_escaped {
            out.extend(['\\', '[']);
            out.extend_from_slice(range);
            out.extend(std::iter::repeat_n('\\', escapes - escapes % 2));
            if is_closed {
                out.push(']');
            }
        } else if is_closed && escapes % 2 == 0 {
            let mut range = sanitize_range(range);
            if version == IgnoreVersion::V7 {
                if range.first() == Some(&'!') {
                    range[0] = '^';
                } else if range.starts_with(&['\\', '^']) {
                    range.remove(0);
                }
            }
            out.push('[');
            out.extend(range);
            out.extend(std::iter::repeat_n('\\', escapes));
            out.push(']');
        } else {
            out.extend(['[', ']']);
        }
        i = close + usize::from(is_closed);
    }
    s = out;

    // `a` matches `a` and `a/`, `a/` only the latter.
    match s.last().copied() {
        None | Some('*') => {}
        Some('/') => s.push('$'),
        Some(_) => s.extend("(?=$|\\/$)".chars()),
    }

    // A trailing `*`
    if s.ends_with(&['\\', '*']) {
        s.truncate(s.len() - 2);
        let is_whole_name =
            s.ends_with(&['\\', '/']) || version == IgnoreVersion::V5 && s.last() == Some(&'^');
        s.extend(if is_whole_name { "[^/]+" } else { "[^/]*" }.chars());
        s.extend("(?=$|\\/$)".chars());
    }

    s.into_iter().collect()
}

// ───────────────────────────── the options ─────────────────────────────

/// `new RegExp(source, "u")`
struct NamePattern {
    regex: Regex,
    /// `String(regex)`
    text: Vec<u8>,
}

impl NamePattern {
    fn new(source: &str) -> Option<NamePattern> {
        let regex = Regex::new(source, "u").ok()?;
        let mut text = vec![b'/'];
        let (mut is_escaped, mut is_in_class) = (false, false);
        for c in source.chars() {
            let escape = match c {
                '\n' => "n",
                '\r' => "r",
                '\u{2028}' => "u2028",
                '\u{2029}' => "u2029",
                _ => "",
            };
            if !is_escaped && (!escape.is_empty() || c == '/' && !is_in_class) {
                text.push(b'\\');
            }
            match escape {
                "" => text.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes()),
                _ => text.extend_from_slice(escape.as_bytes()),
            }
            match c {
                _ if is_escaped => is_escaped = false,
                '\\' => is_escaped = true,
                '[' => is_in_class = true,
                ']' => is_in_class = false,
                _ => {}
            }
        }
        text.extend_from_slice(b"/u");
        Some(NamePattern { regex, text })
    }
}

/// Which modules a restriction is about.
enum Matcher {
    /// An element of `paths`.
    Path(Box<[u8]>),
    /// `regex` of an element of `patterns`.
    Regex(Regex),
    /// `group` of an element of `patterns`.
    Ignore(Ignore),
}

type Names = Vec<Box<[u8]>>;

/// An element of `paths` or of `patterns`.
struct Restriction {
    matcher: Matcher,
    message: Option<Box<[u8]>>,
    import_names: Option<Names>,
    import_name_pattern: Option<NamePattern>,
    allow_import_names: Option<Names>,
    allow_import_name_pattern: Option<NamePattern>,
    allow_type_imports: bool,
}

/// The elements of `paths`.
pub fn restricted_paths<'o>(options: &Options<'o>) -> &'o [Json] {
    let first = options.object(0);
    match first.has("paths") || first.has("patterns") {
        true => first.array("paths"),
        false => options.all(),
    }
}

/// The elements of `patterns`.
pub fn restricted_patterns<'o>(options: &Options<'o>) -> &'o [Json] {
    options.object(0).array("patterns")
}

impl Restriction {
    fn new(matcher: Matcher, options: Object) -> Restriction {
        let names = |key: &str| -> Option<Names> {
            let names = options.has(key).then(|| options.strings(key))?;
            Some(names.iter().map(|it| it.as_bytes().into()).collect())
        };
        let pattern = |key: &str| NamePattern::new(options.str(key).filter(|it| !it.is_empty())?);
        Restriction {
            matcher,
            message: (options.str("message").filter(|it| !it.is_empty())).map(|it| it.as_bytes().into()),
            import_names: names("importNames"),
            import_name_pattern: pattern("importNamePattern"),
            allow_import_names: names("allowImportNames"),
            allow_import_name_pattern: pattern("allowImportNamePattern"),
            allow_type_imports: options.bool_or("allowTypeImports", false),
        }
    }

    fn applies_to(&self, source: &[u8]) -> bool {
        match &self.matcher {
            Matcher::Path(name) => **name == *source,
            Matcher::Regex(regex) => regex.test(source),
            Matcher::Ignore(ignore) => ignore.ignores(source),
        }
    }
}

// ───────────────────────────── imports ─────────────────────────────

/// How `import a = require("m")` is looked at.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Dialect {
    /// It imports no name.
    Eslint,
    /// As `import a from "m"`.
    TypeScript,
}

/// The statements that import from a module.
pub const STATEMENTS: [StmtTag; 4] = [
    StmtTag::Import,
    StmtTag::ExportNamed,
    StmtTag::ExportStar,
    StmtTag::ImportEquals,
];

/// The module that `statement` imports from.
pub fn import_source<'a>(statement: Stmt<'a>, dialect: Dialect) -> Option<&'a [u8]> {
    match statement.kind() {
        StmtKind::Import(import) => Some(text::trim(import.spec().bytes())),
        StmtKind::ExportNamed(export) => Some(text::trim(export.spec()?.bytes())),
        StmtKind::ExportStar { spec, .. } => Some(text::trim(spec?.bytes())),
        StmtKind::ImportEquals(import) => match (import.target(), dialect) {
            (ImportEqualsTarget::Require(spec), Dialect::Eslint) => Some(spec?.bytes()),
            (ImportEqualsTarget::Require(spec), Dialect::TypeScript) => Some(text::trim(spec?.bytes())),
            (ImportEqualsTarget::Entity(_), _) => None,
        },
        _ => None,
    }
}

/// ESLint's `isTypeOnlyImport` and `isTypeOnlyExport`.
pub fn is_type_only(statement: Stmt) -> bool {
    match statement.kind() {
        StmtKind::Import(import) => {
            import.is_type_only()
                || import.default().is_none()
                    && import.namespace().is_none()
                    && !import.named().is_empty()
                    && import.named().iter().all(ImportSpec::is_type_only)
        }
        StmtKind::ImportEquals(import) => import.flags().contains(Flags::TYPE_ONLY),
        StmtKind::ExportNamed(export) => {
            export.is_type_only()
                || !export.items().is_empty() && export.items().iter().all(ExportSpec::is_type_only)
        }
        StmtKind::ExportStar { type_only, .. } => type_only,
        _ => false,
    }
}

struct Specifier<'a> {
    /// The name in the other module. `*` for all of it.
    name: &'a [u8],
    span: Span,
    is_type_only: bool,
}

/// What a statement imports.
struct Imported<'a> {
    node: Span,
    source: &'a [u8],
    is_type_only: bool,
    specifiers: SmallVec<[Specifier<'a>; 8]>,
}

impl<'a> Imported<'a> {
    fn new(statement: Stmt<'a>, dialect: Dialect, source: &'a [u8]) -> Imported<'a> {
        let mut specifiers = SmallVec::new();
        let mut add = |name: &'a [u8], span: Span, is_type_only: bool| {
            specifiers.push(Specifier {
                name,
                span,
                is_type_only,
            });
        };
        let mut node = statement.span();
        match statement.kind() {
            StmtKind::Import(import) => {
                if let Some(default) = import.default() {
                    add(b"default", default.span(), false);
                }
                if let Some(namespace) = import.namespace_span() {
                    add(b"*", namespace, false);
                }
                for it in import.named() {
                    add(it.imported().bytes(), it.span(), it.is_type_only());
                }
            }
            StmtKind::ExportNamed(export) => {
                for it in export.items() {
                    add(it.local().bytes(), it.span(), it.is_type_only());
                }
            }
            // ESLint reports the second token, which is the `type` of `export type *`.
            StmtKind::ExportStar { .. } => {
                let text = statement.file().text();
                let start = skip_trivia(text, node.start + "export".len() as u32);
                let len = token_len(text.get(start as usize..).unwrap_or_default());
                add(b"*", Span::new(start, start + len as u32), false);
            }
            StmtKind::ImportEquals(import) => {
                node = statement.span_without_export();
                if dialect == Dialect::TypeScript {
                    add(b"default", import.name().span(), false);
                }
            }
            _ => {}
        }
        Imported {
            node,
            source,
            is_type_only: is_type_only(statement),
            specifiers,
        }
    }
}

// ───────────────────────────── reports ─────────────────────────────

/// `new Intl.ListFormat("en-US").format(..)` of the names in quotes.
fn format_import_names(names: &[Box<[u8]>]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, name) in names.iter().enumerate() {
        let separator: &[u8] = match (i, i + 1 == names.len()) {
            (0, _) => b"",
            (1, true) => b" and ",
            (_, true) => b", and ",
            (_, false) => b", ",
        };
        out.extend_from_slice(separator);
        out.push(b'\'');
        out.extend_from_slice(name);
        out.push(b'\'');
    }
    out
}

fn is_or_are(names: &[Box<[u8]>]) -> &'static str {
    if names.len() == 1 { "is" } else { "are" }
}

fn includes(names: &[Box<[u8]>], name: &[u8]) -> bool {
    names.iter().any(|it| **it == *name)
}

impl Restriction {
    /// ESLint's `checkRestrictedPathAndReport` for one entry, and `reportPathForPatterns`.
    fn check<'a, R: Rule>(&self, cx: &Cx<'a, R>, imported: &Imported<'a>) {
        if self.allow_type_imports && imported.is_type_only {
            return;
        }
        let report = |at: Span, (plain, with_custom_message): Messages| -> Report<'a> {
            match &self.message {
                Some(message) => (cx.report(at, with_custom_message))
                    .data("customMessage", message.to_vec()),
                None => cx.report(at, plain),
            }
            .data("importSource", imported.source)
        };
        let is_path = matches!(self.matcher, Matcher::Path(_));
        let restricted = self.import_names.as_deref();
        let restricted_pattern = self.import_name_pattern.as_ref();
        let allowed = self.allow_import_names.as_deref();
        let allowed_pattern = self.allow_import_name_pattern.as_ref();

        if restricted.is_none()
            && restricted_pattern.is_none()
            && allowed.is_none()
            && allowed_pattern.is_none()
        {
            report(imported.node, if is_path { PATH } else { PATTERNS });
            return;
        }

        for (i, first) in imported.specifiers.iter().enumerate() {
            let name = first.name;
            // It was handled with the first specifier of that name.
            if imported.specifiers[..i].iter().any(|it| it.name == name) {
                continue;
            }

            if name == b"*" {
                if let Some(names) = restricted {
                    report(first.span, if is_path { EVERYTHING } else { PATTERN_AND_EVERYTHING })
                        .data("importNames", format_import_names(names))
                        .data("isOrAre", is_or_are(names));
                } else if let Some(names) = allowed {
                    report(first.span, EVERYTHING_WITH_ALLOW_IMPORT_NAMES)
                        .data("allowedImportNames", format_import_names(names))
                        .data("isOrAre", is_or_are(names));
                } else if let Some(pattern) = allowed_pattern {
                    report(first.span, EVERYTHING_WITH_ALLOWED_IMPORT_NAME_PATTERN)
                        .data("allowedImportNamePattern", pattern.text.clone());
                } else if let Some(pattern) = restricted_pattern {
                    report(first.span, PATTERN_AND_EVERYTHING_WITH_REGEX_IMPORT_NAME)
                        .data("importNames", pattern.text.clone());
                }
                continue;
            }

            let specifiers = || {
                (imported.specifiers[i..].iter())
                    .filter(|it| it.name == name && !(self.allow_type_imports && it.is_type_only))
            };

            if restricted.is_some_and(|names| includes(names, name))
                || restricted_pattern.is_some_and(|pattern| pattern.regex.test(name))
            {
                for specifier in specifiers() {
                    report(specifier.span, if is_path { IMPORT_NAME } else { PATTERN_AND_IMPORT_NAME })
                        .data("importName", name);
                }
            }

            if let Some(names) = allowed.filter(|names| !includes(names, name)) {
                for specifier in specifiers() {
                    report(specifier.span, ALLOWED_IMPORT_NAME)
                        .data("importName", name)
                        .data("allowedImportNames", format_import_names(names))
                        .data("isOrAre", is_or_are(names));
                }
            } else if let Some(pattern) = allowed_pattern.filter(|it| !it.regex.test(name)) {
                for specifier in specifiers() {
                    report(specifier.span, ALLOWED_IMPORT_NAME_PATTERN)
                        .data("importName", name)
                        .data("allowedImportNamePattern", pattern.text.clone());
                }
            }
        }
    }
}

/// The options of the rule: `paths`, then `patterns`.
pub struct Restrictions {
    all: Vec<Restriction>,
}

impl Restrictions {
    pub fn new(options: &Options) -> Restrictions {
        let mut all = Vec::new();
        for path in restricted_paths(options) {
            let object = Object::of(Some(path));
            if let Some(name) = path.as_str().or_else(|| object.get("name")?.as_str()) {
                all.push(Restriction::new(Matcher::Path(name.into()), object));
            }
        }

        let patterns = restricted_patterns(options);
        if patterns.first().is_some_and(|it| it.as_str().is_some()) {
            let strings = patterns.iter().filter_map(|it| std::str::from_utf8(it.as_str()?).ok());
            let group: Vec<&str> = strings.collect();
            let ignore = Ignore::new(&group, true, IgnoreVersion::V5);
            all.push(Restriction::new(Matcher::Ignore(ignore), Object::default()));
            return Restrictions { all };
        }
        for pattern in patterns {
            let object = Object::of(Some(pattern));
            let is_case_sensitive = object.bool_or("caseSensitive", false);
            let matcher = match object.str("regex") {
                Some(regex) => {
                    Regex::new(regex, if is_case_sensitive { "u" } else { "iu" }).ok().map(Matcher::Regex)
                }
                None => object.has("group").then(|| {
                    let group = object.strings("group");
                    Matcher::Ignore(Ignore::new(&group, !is_case_sensitive, IgnoreVersion::V5))
                }),
            };
            if let Some(matcher) = matcher {
                all.push(Restriction::new(matcher, object));
            }
        }
        Restrictions { all }
    }

    /// Nothing is restricted.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.all.is_empty()
    }

    /// ESLint's `checkNode`, for one of the [`STATEMENTS`].
    pub fn check<'a, R: Rule>(&self, cx: &Cx<'a, R>, statement: Stmt<'a>, dialect: Dialect) {
        let Some(source) = import_source(statement, dialect) else {
            return;
        };
        let mut imported = None;
        for restriction in &self.all {
            if restriction.applies_to(source) {
                let imported = imported.get_or_insert_with(|| Imported::new(statement, dialect, source));
                restriction.check(cx, imported);
            }
        }
    }
}

impl Rule for NoRestrictedImports {
    const META: Meta = Meta::eslint("no-restricted-imports", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoRestrictedImports {
            restrictions: Restrictions::new(options),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if !self.restrictions.is_empty() {
            on.stmts(STATEMENTS, |rule, statement, cx| {
                rule.restrictions.check(cx, statement, Dialect::Eslint);
            });
        }
    }
}
