use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::tokens::token_len;
pub use bun_lint::utils::ignore::{Ignore, IgnoreVersion};
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

/// Which modules a restriction is about.
enum Matcher {
    /// An element of `paths`.
    Path(Box<[u8]>),
    /// `regex` of an element of `patterns`.
    Regex(Box<Regex>),
    /// `group` of an element of `patterns`.
    Group(Ignore, Globs),
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
            Matcher::Group(ignore, _) => ignore.ignores(source),
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

        if !self.is_about_names() {
            report(imported.node, if is_path { PATH } else { PATTERNS });
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
                        .data("importNames", format_import_names(names))
                        .data("isOrAre", is_or_are(names));
                } else if let Some(names) = allowed {
                    report(specifier.span, EVERYTHING_WITH_ALLOW_IMPORT_NAMES)
                        .data("allowedImportNames", format_import_names(names))
                        .data("isOrAre", is_or_are(names));
                } else if let Some(pattern) = allowed_pattern {
                    report(specifier.span, EVERYTHING_WITH_ALLOWED_IMPORT_NAME_PATTERN)
                        .data("allowedImportNamePattern", pattern.text.clone());
                } else if let Some(pattern) = restricted_pattern {
                    report(specifier.span, PATTERN_AND_EVERYTHING_WITH_REGEX_IMPORT_NAME)
                        .data("importNames", pattern.text.clone());
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
                    .data("allowedImportNames", format_import_names(names))
                    .data("isOrAre", is_or_are(names));
            } else if let Some(pattern) = allowed_pattern.filter(|it| !it.regex.test(name)) {
                report(specifier.span, ALLOWED_IMPORT_NAME_PATTERN)
                    .data("importName", name)
                    .data("allowedImportNamePattern", pattern.text.clone());
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
            let ignore = Ignore::new(&group, true, IgnoreVersion::V5);
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
                    let ignore = Ignore::new(&group, !is_case_sensitive, IgnoreVersion::V5);
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
    pub fn check<'a, R: Rule>(&self, cx: &Cx<'a, R>, statement: Stmt<'a>, dialect: Dialect) {
        let Some(source) = import_source(statement, dialect) else {
            return;
        };
        let mut imported = None;
        for restriction in self.applying_to(source, cx.language().is_oxlint) {
            let imported = imported.get_or_insert_with(|| Imported::new(statement, dialect, source));
            restriction.check(cx, imported);
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
        for restriction in self.applying_to(imported.source, cx.language().is_oxlint) {
            if !restriction.is_about_names() {
                restriction.check(cx, &imported);
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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !self.restrictions.is_empty() {
            on.stmts(STATEMENTS, |rule, statement, cx| {
                rule.restrictions.check(cx, statement, Dialect::Eslint);
            });
            if file.language().is_oxlint {
                on.exprs([ExprTag::ImportCall], |rule, call, cx| rule.restrictions.check_import_call(cx, call));
            }
        }
    }
}
