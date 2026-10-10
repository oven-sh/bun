use bun_core::strings;
pub use bun_glob::ignore::{IgnoreOptions, IgnoreRules, IgnoreSyntax};
use bun_lint::prelude::*;
use bun_lint::tokens::token_len;
use rustc_hash::FxHashSet;
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
                '\n' => Some("n"),
                '\r' => Some("r"),
                '\u{2028}' => Some("u2028"),
                '\u{2029}' => Some("u2029"),
                _ => None,
            };
            if !is_escaped && (escape.is_some() || c == '/' && !is_in_class) {
                text.push(b'\\');
            }
            match escape {
                Some(escape) => text.extend_from_slice(escape.as_bytes()),
                None => text.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes()),
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

/// `group` as oxlint 1.87 reads it: globs that are matched with the whole specifier, where ESLint has the patterns of a
/// `.gitignore`. So `a/*` is not about `a/b/c`, `a` is not about `b/a/c`, and `!a/b/c` takes something out of `a/**`.
struct Globs {
    /// Whether it starts with `!`, and the rest. One without a slash matches below every directory.
    patterns: Vec<(bool, Box<[u8]>)>,
    ignores_case: bool,
    /// They are the strings in `patterns`, each of which oxlint takes for a group.
    is_each_a_group: bool,
}

enum GlobResult {
    Found,
    /// No group restricts the module, and the groups and regular expressions after this one are not looked at.
    Whitelist,
    None,
}

impl Globs {
    /// The strings in `patterns`.
    fn of_strings(strings: &[&str]) -> Globs {
        let ignores_case = true;
        Globs { is_each_a_group: true, ..Globs::of_group(strings, ignores_case) }
    }

    fn of_group(group: &[&str], ignores_case: bool) -> Globs {
        let pattern = |raw: &&str| {
            let (is_negated, rest) = match raw.as_bytes().strip_prefix(b"!") {
                Some(rest) => (true, rest),
                None => (false, raw.as_bytes()),
            };
            let everywhere: &[u8] = if strings::contains_char(rest, b'/') { b"" } else { b"**/" };
            let mut pattern = [everywhere, rest].concat();
            if ignores_case {
                pattern.make_ascii_lowercase();
            }
            (is_negated, pattern.into_boxed_slice())
        };
        Globs {
            patterns: group.iter().map(pattern).collect(),
            ignores_case,
            is_each_a_group: false,
        }
    }

    /// oxlint's `get_group_glob_result`: the last pattern that matches decides.
    fn result(&self, source: &[u8]) -> GlobResult {
        let lowercase: SmallVec<[u8; 64]>;
        let source = match self.ignores_case && source.iter().any(u8::is_ascii_uppercase) {
            true => {
                lowercase = source.iter().map(u8::to_ascii_lowercase).collect();
                &lowercase[..]
            }
            false => source,
        };
        let mut result = GlobResult::None;
        for (is_negated, pattern) in &self.patterns {
            if bun_glob::r#match(pattern, source).matches() {
                result = if *is_negated { GlobResult::Whitelist } else { GlobResult::Found };
                if *is_negated && self.is_each_a_group {
                    break;
                }
            }
        }
        result
    }
}

/// `ignore({ allowRelativePaths: true, ignoreCase }).add(group)` of the version of the package that `syntax` names.
pub fn ignore_rules(group: &[&str], ignores_case: bool, syntax: IgnoreSyntax) -> IgnoreRules {
    IgnoreRules::from_lines(group.iter().map(|it| it.as_bytes()), IgnoreOptions { syntax, ignores_case })
}

/// Which modules a restriction is about.
enum Matcher {
    /// An element of `paths`.
    Path(Box<[u8]>),
    /// `regex` of an element of `patterns`.
    Regex(Box<Regex>),
    /// `group` of an element of `patterns`.
    Group(Box<IgnoreRules>, Globs),
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

/// oxlint's `NameSpanAllowedResult`: what a restriction says about a name that is imported.
enum NameResult {
    Allowed,
    /// Nothing may be imported from the module.
    GeneralDisallowed,
    NameDisallowed,
}

/// What oxlint takes for the name that `import a = require("m")` imports.
const NAME_THAT_CANNOT_BE_USED: &[u8] = b"__<>import_name_that_cant_be_used<>__";

/// With a configuration of oxlint: the modules that an `import "m"` has been seen of. It looks at the first of each.
pub type SideEffectImports<'a> = FxHashSet<&'a [u8]>;

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
            Matcher::Group(ignore, _) => ignore.ignores(source),
        }
    }

    /// oxlint's `is_name_span_allowed`.
    fn is_name_allowed_by_oxlint(&self, name: &[u8]) -> NameResult {
        let is_in = |names: &Option<Names>| names.as_deref().is_some_and(|it| includes(it, name));
        let is_like = |pattern: &Option<NamePattern>| pattern.as_ref().is_some_and(|it| it.regex.test(name));
        if is_in(&self.allow_import_names) || is_like(&self.allow_import_name_pattern) {
            return NameResult::Allowed;
        }
        if self.import_names.is_none() && self.import_name_pattern.is_none() {
            return match self.allow_import_names.is_some() || self.allow_import_name_pattern.is_some() {
                true => NameResult::NameDisallowed,
                false => NameResult::GeneralDisallowed,
            };
        }
        match is_in(&self.import_names) || is_like(&self.import_name_pattern) {
            true => NameResult::NameDisallowed,
            false => NameResult::Allowed,
        }
    }

    /// It is about some of the names of a module only.
    fn is_about_names(&self) -> bool {
        self.import_names.is_some()
            || self.import_name_pattern.is_some()
            || self.allow_import_names.is_some()
            || self.allow_import_name_pattern.is_some()
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
    // oxlint takes it as it is.
    let is_oxlint = statement.file().language().is_oxlint;
    let trim = |it: &'a [u8]| if is_oxlint { it } else { strings::trim_js_whitespace(it) };
    match statement.kind() {
        StmtKind::Import(import) => Some(trim(import.spec().bytes())),
        StmtKind::ExportNamed(export) => Some(trim(export.spec()?.bytes())),
        StmtKind::ExportStar { spec, .. } => Some(trim(spec?.bytes())),
        StmtKind::ImportEquals(import) => match (import.target(), dialect) {
            (ImportEqualsTarget::Require(spec), Dialect::Eslint) => Some(spec?.bytes()),
            (ImportEqualsTarget::Require(spec), Dialect::TypeScript) => Some(trim(spec?.bytes())),
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
        // What oxlint says about a `*`, it says about the statement, and what it says about `a as b`, about the `a`.
        let is_oxlint = statement.file().language().is_oxlint;
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
                    add(b"*", if is_oxlint { node } else { namespace }, false);
                }
                for it in import.named() {
                    let span = if is_oxlint { it.imported().span() } else { it.span() };
                    add(it.imported().bytes(), span, it.is_type_only());
                }
            }
            StmtKind::ExportNamed(export) => {
                for it in export.items() {
                    let span = if is_oxlint { it.local().span() } else { it.span() };
                    add(it.local().bytes(), span, it.is_type_only());
                }
            }
            StmtKind::ExportStar { .. } if is_oxlint => add(b"*", node, false),
            // ESLint reports the second token, which is the `type` of `export type *`.
            StmtKind::ExportStar { .. } => {
                let text = statement.file().text();
                let start = skip_trivia(text, node.start + "export".len() as u32);
                let len = token_len(text.get(start as usize..).unwrap_or_default());
                add(b"*", Span::new(start, start + len as u32), false);
            }
            StmtKind::ImportEquals(import) => {
                node = statement.span_without_export();
                // What oxlint says about the name, it says about the module.
                if let Some(specifier) = statement.module_specifier_span().filter(|_| is_oxlint) {
                    add(NAME_THAT_CANNOT_BE_USED, specifier, false);
                } else if dialect == Dialect::TypeScript {
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

type ReportAt<'r, 'a> = &'r dyn Fn(Span, Message) -> Report<'a>;

impl Restriction {
    /// ESLint's `checkRestrictedPathAndReport` for one entry, and `reportPathForPatterns`.
    /// `report_at`: [`Cx::report`] of the rule, of which there are two. This is compiled once.
    #[inline(never)]
    fn check<'a>(&self, report_at: ReportAt<'_, 'a>, is_oxlint: bool, imported: &Imported<'a>) {
        if self.allow_type_imports && imported.is_type_only {
            return;
        }
        let report = |at: Span, (plain, with_custom_message): Messages| -> Report<'a> {
            match &self.message {
                Some(message) => (report_at(at, with_custom_message))
                    .data("customMessage", message.to_vec()),
                None => report_at(at, plain),
            }
            .data("importSource", imported.source)
        };
        // oxlint has the names with commas between them, and a pattern as it is in the configuration.
        let list = |names: &[Box<[u8]>]| match is_oxlint {
            true => names.join(&b", "[..]),
            false => format_import_names(names),
        };
        let written = |pattern: &NamePattern| match is_oxlint {
            true => pattern.text.get(1..pattern.text.len().saturating_sub(2)).unwrap_or_default().to_vec(),
            false => pattern.text.clone(),
        };
        let is_path = matches!(self.matcher, Matcher::Path(_));
        let restricted = self.import_names.as_deref();
        let restricted_pattern = self.import_name_pattern.as_ref();
        let allowed = self.allow_import_names.as_deref();
        let allowed_pattern = self.allow_import_name_pattern.as_ref();

        let is_about_all = match is_oxlint {
            true => imported.specifiers.is_empty(),
            false => !self.is_about_names(),
        };
        if is_about_all {
            report(imported.node, if is_path { PATH } else { PATTERNS });
            return;
        }
        if is_oxlint {
            // It goes through what the statement imports, and each is restricted with all the others, by its name, or
            // not. A `*` always is.
            let mut has_said_it_of_all = false;
            for specifier in &imported.specifiers {
                let name = specifier.name;
                if self.allow_type_imports && specifier.is_type_only {
                    continue;
                }
                if name == b"*" {
                    if let Some(names) = restricted {
                        report(imported.node, if is_path { EVERYTHING } else { PATTERN_AND_EVERYTHING })
                            .data("importNames", list(names))
                            .data("isOrAre", is_or_are(names));
                    } else if let Some(pattern) = restricted_pattern {
                        report(imported.node, PATTERN_AND_EVERYTHING_WITH_REGEX_IMPORT_NAME)
                            .data("importNames", written(pattern));
                    } else if let Some(pattern) = allowed_pattern {
                        report(imported.node, EVERYTHING_WITH_ALLOWED_IMPORT_NAME_PATTERN)
                            .data("allowedImportNamePattern", written(pattern));
                    } else if let Some(names) = allowed {
                        report(imported.node, EVERYTHING_WITH_ALLOW_IMPORT_NAMES)
                            .data("allowedImportNames", list(names))
                            .data("isOrAre", is_or_are(names));
                    } else {
                        report(imported.node, if is_path { PATH } else { PATTERNS });
                    }
                    continue;
                }
                let shown = if name == NAME_THAT_CANNOT_BE_USED { imported.source } else { name };
                match self.is_name_allowed_by_oxlint(name) {
                    NameResult::Allowed => {}
                    NameResult::GeneralDisallowed => {
                        if !std::mem::replace(&mut has_said_it_of_all, true) {
                            report(imported.node, if is_path { PATH } else { PATTERNS });
                        }
                    }
                    NameResult::NameDisallowed => {
                        if let Some(names) = allowed {
                            report(specifier.span, ALLOWED_IMPORT_NAME)
                                .data("importName", shown)
                                .data("allowedImportNames", list(names))
                                .data("isOrAre", is_or_are(names));
                        } else if let Some(pattern) = allowed_pattern {
                            report(specifier.span, ALLOWED_IMPORT_NAME_PATTERN)
                                .data("importName", shown)
                                .data("allowedImportNamePattern", written(pattern));
                        } else {
                            report(specifier.span, if is_path { IMPORT_NAME } else { PATTERN_AND_IMPORT_NAME })
                                .data("importName", shown);
                        }
                    }
                }
            }
            return;
        }

        let mut has_seen_everything = false;
        for specifier in &imported.specifiers {
            let name = specifier.name;
            if name == b"*" {
                // Only the first of `import { "*" as a, "*" as b } from "m"`.
                if std::mem::replace(&mut has_seen_everything, true) {
                    continue;
                }
                if let Some(names) = restricted {
                    report(specifier.span, if is_path { EVERYTHING } else { PATTERN_AND_EVERYTHING })
                        .data("importNames", list(names))
                        .data("isOrAre", is_or_are(names));
                } else if let Some(names) = allowed {
                    report(specifier.span, EVERYTHING_WITH_ALLOW_IMPORT_NAMES)
                        .data("allowedImportNames", list(names))
                        .data("isOrAre", is_or_are(names));
                } else if let Some(pattern) = allowed_pattern {
                    report(specifier.span, EVERYTHING_WITH_ALLOWED_IMPORT_NAME_PATTERN)
                        .data("allowedImportNamePattern", written(pattern));
                } else if let Some(pattern) = restricted_pattern {
                    report(specifier.span, PATTERN_AND_EVERYTHING_WITH_REGEX_IMPORT_NAME)
                        .data("importNames", written(pattern));
                }
                continue;
            }
            if self.allow_type_imports && specifier.is_type_only {
                continue;
            }

            if restricted.is_some_and(|names| includes(names, name))
                || restricted_pattern.is_some_and(|pattern| pattern.regex.test(name))
            {
                report(specifier.span, if is_path { IMPORT_NAME } else { PATTERN_AND_IMPORT_NAME })
                    .data("importName", name);
            }

            if let Some(names) = allowed.filter(|names| !includes(names, name)) {
                report(specifier.span, ALLOWED_IMPORT_NAME)
                    .data("importName", name)
                    .data("allowedImportNames", list(names))
                    .data("isOrAre", is_or_are(names));
            } else if let Some(pattern) = allowed_pattern.filter(|it| !it.regex.test(name)) {
                report(specifier.span, ALLOWED_IMPORT_NAME_PATTERN)
                    .data("importName", name)
                    .data("allowedImportNamePattern", written(pattern));
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
            // The schema lets `[{}]` through, whose `name` upstream takes as a key: `undefined`.
            let name = path.as_str().or_else(|| object.get("name")?.as_str()).unwrap_or(b"undefined");
            all.push(Restriction::new(Matcher::Path(name.into()), object));
        }

        let patterns = restricted_patterns(options);
        if patterns.first().is_some_and(|it| it.as_str().is_some()) {
            let strings = patterns.iter().filter_map(|it| std::str::from_utf8(it.as_str()?).ok());
            let group: Vec<&str> = strings.collect();
            let ignore = Box::new(ignore_rules(&group, true, IgnoreSyntax::Npm5));
            let matcher = Matcher::Group(ignore, Globs::of_strings(&group));
            all.push(Restriction::new(matcher, Object::default()));
            return Restrictions { all };
        }
        for pattern in patterns {
            let object = Object::of(Some(pattern));
            let is_case_sensitive = object.bool_or("caseSensitive", false);
            let matcher = match object.str("regex") {
                Some(regex) => {
                    Regex::new(regex, if is_case_sensitive { "u" } else { "iu" }).ok().map(|it| Matcher::Regex(Box::new(it)))
                }
                None => object.has("group").then(|| {
                    let group = object.strings("group");
                    let ignore = Box::new(ignore_rules(&group, !is_case_sensitive, IgnoreSyntax::Npm5));
                    Matcher::Group(ignore, Globs::of_group(&group, !is_case_sensitive))
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
    pub fn check<'a, R: Rule<State<'a> = SideEffectImports<'a>>>(
        &self,
        cx: &mut Cx<'a, R>,
        statement: Stmt<'a>,
        dialect: Dialect,
    ) {
        let Some(source) = import_source(statement, dialect) else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let applying = self.applying_to(source, is_oxlint);
        if applying.is_empty() {
            return;
        }
        let imported = Imported::new(statement, dialect, source);
        if !is_oxlint || !imported.specifiers.is_empty() {
            for restriction in applying {
                restriction.check(&|at, message| cx.report(at, message), is_oxlint, &imported);
            }
            return;
        }
        // oxlint's `report_side_effects`. It says nothing about `export {} from "m"`. A restriction of some names does
        // not hold, but for a `group`, and of these only the last.
        if statement.tag() != StmtTag::Import || !cx.state.insert(source) {
            return;
        }
        let last_group = applying.iter().rposition(|it| matches!(it.matcher, Matcher::Group(..)));
        for (i, restriction) in applying.iter().enumerate() {
            let holds = match restriction.matcher {
                Matcher::Path(_) => restriction.import_names.is_none(),
                Matcher::Regex(_) => restriction.import_names.is_none() && restriction.import_name_pattern.is_none(),
                Matcher::Group(..) => Some(i) == last_group,
            };
            if holds {
                restriction.check(&|at, message| cx.report(at, message), is_oxlint, &imported);
            }
        }
    }

    /// The restrictions that are about the module `source`.
    fn applying_to(&self, source: &[u8], is_oxlint: bool) -> SmallVec<[&Restriction; 4]> {
        let mut found: SmallVec<[&Restriction; 4]> = SmallVec::new();
        for restriction in &self.all {
            let applies = match &restriction.matcher {
                Matcher::Group(_, globs) if is_oxlint => match globs.result(source) {
                    GlobResult::Found => true,
                    GlobResult::None => false,
                    GlobResult::Whitelist => {
                        found.retain(|it| !matches!(it.matcher, Matcher::Group(..)));
                        break;
                    }
                },
                _ => restriction.applies_to(source),
            };
            if applies {
                found.push(restriction);
            }
        }
        found
    }

    /// What oxlint does with `import("m")`: as with `import "m"`, without the restrictions that are about names.
    pub fn check_import_call<'a, R: Rule>(&self, cx: &Cx<'a, R>, call: Expr<'a>) {
        let ExprKind::ImportCall { args } = call.kind() else {
            return;
        };
        let Some(source) = args.first().and_then(Expr::as_string) else {
            return;
        };
        let imported = Imported {
            node: call.span(),
            source: source.bytes(),
            is_type_only: false,
            specifiers: SmallVec::new(),
        };
        let is_oxlint = cx.language().is_oxlint;
        for restriction in self.applying_to(imported.source, is_oxlint) {
            if !restriction.is_about_names() {
                restriction.check(&|at, message| cx.report(at, message), is_oxlint, &imported);
            }
        }
    }
}

impl Rule for NoRestrictedImports {
    const META: Meta = Meta::eslint("no-restricted-imports", Kind::Suggestion);
    const ON: On = On::new().stmts(&STATEMENTS).exprs(&[ExprTag::ImportCall]);
    type State<'a> = SideEffectImports<'a>;

    fn new(options: &Options) -> Self {
        NoRestrictedImports {
            restrictions: Restrictions::new(options),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().stmts(&STATEMENTS);
        if file.language().is_oxlint {
            on = on.exprs(&[ExprTag::ImportCall]);
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<SideEffectImports<'a>> {
        (!self.restrictions.is_empty()).then(SideEffectImports::default)
    }

    fn expr<'a>(&self, call: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.restrictions.check_import_call(cx, call);
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        self.restrictions.check(cx, statement, Dialect::Eslint);
    }
}
