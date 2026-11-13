use bun_lint_oxlint::ast_util::as_member_expression;
use bun_lint_oxlint::import::{ImportEntry, ImportImportName, import_entries_of};
use crate::jest::{self, JestFnKind, JestGeneralFnKind, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::bun_test;
use std::cell::OnceCell;

/// This rule triggers an error when an unexpected Vitest accessor is used.
pub struct ConsistentVitestVi {
    function: &'static str,
    opposite: &'static str,
}

const CONSISTENT_VITEST_VI: &Message = &Message::new("", "The vitest function accessor used is not allowed");

pub struct State<'a> {
    /// `opposite`, looked up in the file's names.
    opposite: Name<'a>,
    /// [`ConsistentVitestVi::renamed_import`], looked up at the first call on the name.
    import: OnceCell<Option<(Import<'a>, bool)>>,
}

impl Rule for ConsistentVitestVi {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "consistent-vitest-vi", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]).stmts(&[StmtTag::Import]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        match options.object(0).str("fn") {
            Some("vitest") => ConsistentVitestVi { function: "vitest", opposite: "vi" },
            _ => ConsistentVitestVi { function: "vi", opposite: "vitest" },
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        Some(State { opposite: file.find_name(self.opposite)?, import: OnceCell::new() })
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Import(import) = statement.kind()
            && jest::is_vitest_import_source(import.spec().bytes())
        {
            self.check_import(import, cx);
        }
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some((object, name)) = self.renamed(cx.file(), cx.state.opposite, node) {
            let (file, function) = (cx.file(), self.function);
            let import = *cx.state.import.get_or_init(|| self.renamed_import(file));
            // oxlint also reports a call on a default import, a namespace or another export that has the name. None of them is the helper object.
            if let Some((import, false)) = import
                && self.declared(import).is_some_and(|it| Node::Expr(name).scope().resolve_bytes(self.opposite.as_bytes()) == Some(it))
            {
                return;
            }
            // The fix of an import that declares the name renames its uses too, so that no file is renamed in part.
            let has_import = import.is_some();
            cx.report(object.outer_span(), CONSISTENT_VITEST_VI)
                .data("function", function)
                .data("opposite", self.opposite)
                .fix_where_safe(|| has_import || !self.changes_call(file, name), |fixer| (!has_import).then(|| fixer.replace(name.span(), function)));
        }
    }
}

impl ConsistentVitestVi {
    /// A call that the rule reports: the object of its callee, where the report is, and the name that the fix renames. oxlint's fix replaces the object, which is the first call of `vitest.spyOn(a, "b").mockReturnValue(1)`.
    fn renamed<'a>(&self, file: &'a File<'a>, opposite: Name<'a>, node: Expr<'a>) -> Option<(Expr<'a>, Expr<'a>)> {
        let member_expression = node.callee().and_then(as_member_expression)?;
        let name = jest::start_of_chain(member_expression).filter(|it| it.as_ident() == Some(opposite))?;
        let vitest_fn = jest::parse_general_jest_fn_call(file, PossibleJestNode::new(node, jest::Runner::Vitest))?;
        let is_renamed = vitest_fn.kind == JestFnKind::General(JestGeneralFnKind::Vitest) && vitest_fn.name == self.opposite.as_bytes();
        member_expression.object().filter(|_| is_renamed).map(|object| (object, name))
    }

    /// What `import` declares under the name that the rule renames.
    fn declared<'a>(&self, import: Import<'a>) -> Option<Symbol<'a>> {
        Node::Stmt(import.stmt()).scope().resolve_bytes(self.opposite.as_bytes())
    }

    /// The helper object under the name that the rule renames: `vi` or `vitest`, imported by name. A default import, a namespace or another export is another thing.
    fn accessor<'a>(&self, import: Import<'a>) -> Option<ImportSpec<'a>> {
        let is_helper = |it: &ImportSpec<'a>| it.local().bytes() == self.opposite.as_bytes() && matches!(it.imported().bytes(), b"vi" | b"vitest");
        import.named().iter().find(is_helper)
    }

    /// The import from Vitest that declares the name that the rule renames, and whether the name is then the helper object: see [`Self::accessor`].
    fn renamed_import<'a>(&self, file: &'a File<'a>) -> Option<(Import<'a>, bool)> {
        let declares = |it: Import<'a>| import_entries_of(it).any(|it| it.local_name().bytes() == self.opposite.as_bytes());
        let mut imports = file.stmts_of_kind(StmtTag::Import).filter_map(|it| match it.kind() {
            StmtKind::Import(import) => Some(import),
            _ => None,
        });
        let import = imports.find(|it| jest::is_vitest_import_source(it.spec().bytes()) && declares(*it))?;
        Some((import, self.accessor(import).is_some()))
    }

    fn check_import<'a>(&self, import: Import<'a>, cx: &Cx<'a, Self>) {
        // oxlint also reports a default import, a namespace or another export that has the name, and its fix gives it the name of the helper object.
        let Some(vitest_import) = self.accessor(import) else {
            return;
        };
        let file = cx.file();
        let report = cx.report(vitest_import.span(), CONSISTENT_VITEST_VI);
        report.data("function", self.function).data("opposite", self.opposite).fix_where_safe(|| !self.changes_uses(file, import), |fixer| {
            let (specifiers, is_named) = (import.named(), |it: Ident<'a>, name: &str| it.bytes() == name.as_bytes());
            // The calls would be on a default import that has the new name.
            if import.default().is_some_and(|it| is_named(it, self.function)) {
                return None;
            }
            // Only an import of nothing else keeps its specifier. Otherwise the names in the braces lose the name and get the new one.
            let renamed_import = if import_entries_of(import).count() == 1 {
                fixer.replace(vitest_import.local().span(), self.function)
            } else {
                let others = specifiers.iter().filter(|it| !is_named(it.local(), self.opposite)).map(|it| file.slice(it.span()));
                let new_name = (!specifiers.iter().any(|it| is_named(it.local(), self.function))).then_some(self.function.as_bytes());
                let mut import_text = Vec::new();
                for name in others.chain(new_name) {
                    import_text.extend_from_slice(if import_text.is_empty() { "" } else { ", " }.as_bytes());
                    import_text.extend_from_slice(name);
                }
                let names = Span::new(specifiers.first()?.span().start, specifiers.last()?.span().end);
                Some(fixer.replace(names, import_text)).filter(|it| fixer.keeps_comments(it))?
            };
            // Every use of the name gets the new name in the same fix: a file with the import renamed and a use not, or the other way round, runs differently.
            let mut fixes = vec![renamed_import];
            for reference in self.declared(import)?.references() {
                let is_shorthand = |it: Expr<'a>| matches!(it.parent(), Node::Prop(prop) if prop.kind() == PropKind::Shorthand);
                fixes.push(match (reference.expr(), reference.node()) {
                    // `{ vitest }` becomes `{ vitest: vi }`, so the key stays the same.
                    (Some(it), _) if is_shorthand(it) => fixer.replace(reference, format!("{}: {}", self.opposite, self.function)),
                    (Some(_), _) | (None, Node::Type(_)) if !reference.is_write() => fixer.replace(reference, self.function),
                    // An `export { vitest }` and a JSX tag need more than a new name.
                    _ => return None,
                });
            }
            Some(fixes)
        });
    }

    /// True if `bun test` takes the `function` that the fix makes `import` declare for the mock API: see [`bun_test`].
    fn declares_known(&self, import: Import<'_>) -> bool {
        let source = import.spec().bytes();
        let is_renamed = |it: &ImportEntry| it.local_name().bytes() == self.opposite.as_bytes();
        // An import of nothing else keeps its specifier under the new name. Otherwise the fix writes a named import of `function`.
        match import_entries_of(import).all(|it| is_renamed(&it)) {
            true => import_entries_of(import)
                .all(|it| matches!(it.import_name, ImportImportName::Name(it) if bun_test::is_known_import(source, it.imported().bytes()))),
            false => bun_test::is_known_import(source, self.function.as_bytes()),
        }
    }

    /// True if `target`, which is what `function` is at a use of the name that `declared` is, is another thing than the name: not the global, not a mock API that `bun test` knows, and not declared together with the name, as in `const { vi, vitest } = require("vitest")`.
    fn is_other(&self, target: Option<Symbol<'_>>, declared: Option<Symbol<'_>>) -> bool {
        // The declarator of a variable, and the statement of an import.
        let origin = |it: Symbol<'_>| match it.declarations().next()? {
            declaration @ Declaration::Var(_) => declaration.node().map(|it| it.span()),
            declaration => declaration.parent().map(|it| it.span()),
        };
        let is_together = |it: Symbol<'_>| origin(it).is_some_and(|it| Some(it) == declared.and_then(origin));
        target.is_some_and(|it| !bun_test::is_known(self.function.as_bytes(), Some(it)) && !is_together(it))
    }

    /// True if the new name changes what runs: a use of the name is then on another `function`, or on one that `bun test` doesn't treat as it treats the name: see [`bun_test`].
    #[cold]
    fn changes_uses<'a>(&self, file: &'a File<'a>, import: Import<'a>) -> bool {
        let (function, opposite) = (self.function.as_bytes(), self.opposite.as_bytes());
        let (declares, declares_known) = (import_entries_of(import).any(|it| it.local_name().bytes() == function), self.declares_known(import));
        // The import then declares `function`, which takes the calls on the global of that name.
        if !declares && !declares_known && bun_test::global_has_module_mock_call(file, function) {
            return true;
        }
        let Some(declared) = self.declared(import) else {
            return false;
        };
        let before = bun_test::is_known(opposite, Some(declared));
        declared.references().any(|it| {
            let target = it.scope().resolve_bytes(function);
            // Where nothing declares `function`, the use is then on what the import declares. Another `function` of the import, like `test as vi`, is another thing.
            let after = match target {
                None => declares_known,
                target => bun_test::is_known(function, target),
            };
            before != after || self.is_other(target, Some(declared))
        })
    }

    /// True if the new name changes what runs: the call is then on another `function`, or `bun test` treats a module mock call in another way: see [`bun_test`].
    #[cold]
    fn changes_call<'a>(&self, file: &'a File<'a>, name: Expr<'a>) -> bool {
        let function = self.function.as_bytes();
        let is_mock = bun_test::is_object_of_module_mock_call(name, function);
        // The rule resolves the file's names for a module mock call and in a file that has a `function` only.
        if !is_mock && file.find_name(self.function).is_none() {
            return false;
        }
        let (declared, target) = (name.symbol(), Node::Expr(name).scope().resolve_bytes(function));
        let changes_kind = || bun_test::is_known(self.opposite.as_bytes(), declared) != bun_test::is_known(function, target);
        self.is_other(target, declared) || is_mock && changes_kind()
    }
}
