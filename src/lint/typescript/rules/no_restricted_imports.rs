use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_restricted_imports::{
    Dialect, Ignore, IgnoreVersion, Restrictions, STATEMENTS, import_source, is_type_only,
    restricted_paths, restricted_patterns,
};

/// Disallow specified modules when loaded by `import`.
pub struct NoRestrictedImports {
    base: Restrictions,
    /// What `allowTypeImports` is set for. A type-only import of one of these is not checked at
    /// all, not even against the restrictions that do not set it.
    allowed_type_import_paths: Vec<Box<[u8]>>,
    allowed_type_import_matchers: Vec<Ignore>,
    allowed_type_import_regexes: Vec<Regex>,
}

impl NoRestrictedImports {
    fn is_allowed_type_import(&self, source: &[u8]) -> bool {
        self.allowed_type_import_paths.iter().any(|it| **it == *source)
            || self.allowed_type_import_matchers.iter().any(|it| it.ignores(source))
            || self.allowed_type_import_regexes.iter().any(|it| it.test(source))
    }
}

impl Rule for NoRestrictedImports {
    const META: Meta = Meta::typescript("no-restricted-imports", Kind::Suggestion)
        .deprecated()
        .extends_base_rule("no-restricted-imports");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let allows_type_imports = |it: &Object| it.bool_or("allowTypeImports", false);
        let mut rule = NoRestrictedImports {
            base: Restrictions::new(options),
            allowed_type_import_paths: Vec::new(),
            allowed_type_import_matchers: Vec::new(),
            allowed_type_import_regexes: Vec::new(),
        };
        for path in restricted_paths(options).iter().map(|it| Object::of(Some(it))) {
            if allows_type_imports(&path)
                && let Some(name) = path.str("name")
            {
                rule.allowed_type_import_paths.push(name.as_bytes().into());
            }
        }
        for pattern in restricted_patterns(options).iter().map(|it| Object::of(Some(it))) {
            if !allows_type_imports(&pattern) {
                continue;
            }
            let is_case_sensitive = pattern.bool_or("caseSensitive", false);
            if pattern.has("group") {
                let group = pattern.strings("group");
                let matcher = Ignore::new(&group, !is_case_sensitive, IgnoreVersion::V7);
                rule.allowed_type_import_matchers.push(matcher);
            }
            if let Some(regex) = pattern.str("regex").filter(|it| !it.is_empty())
                && let Ok(regex) = Regex::new(regex, if is_case_sensitive { "u" } else { "iu" })
            {
                rule.allowed_type_import_regexes.push(regex);
            }
        }
        rule
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if self.base.is_empty() {
            return;
        }
        // In oxlint `allowTypeImports` is about the restriction that it is set for, as in ESLint's rule.
        if file.language().is_oxlint {
            on.stmts(STATEMENTS, |rule, statement, cx| rule.base.check(cx, statement, Dialect::TypeScript));
            on.exprs([ExprTag::ImportCall], |rule, call, cx| rule.base.check_import_call(cx, call));
            return;
        }
        on.stmts(STATEMENTS, |rule, statement, cx| {
            let is_allowed = statement.tag() != StmtTag::ExportStar
                && is_type_only(statement)
                && import_source(statement, Dialect::TypeScript)
                    .is_some_and(|source| rule.is_allowed_type_import(source));
            if !is_allowed {
                rule.base.check(cx, statement, Dialect::TypeScript);
            }
        });
    }
}
