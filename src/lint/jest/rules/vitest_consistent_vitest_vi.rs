use bun_lint_oxlint::ast_util::as_member_expression;
use bun_lint_oxlint::import::{ImportEntry, ImportImportName, import_entries_of};
use crate::jest::{self, JestFnKind, JestGeneralFnKind, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::bun_test;
use smallvec::SmallVec;

/// This rule triggers an error when an unexpected Vitest accessor is used.
pub struct ConsistentVitestVi {
    function: &'static str,
    opposite: &'static str,
}

const CONSISTENT_VITEST_VI: &Message = &Message::new("", "The vitest function accessor used is not allowed");

impl Rule for ConsistentVitestVi {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "consistent-vitest-vi", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]).stmts(&[StmtTag::Import]);
    /// `opposite`, looked up in the file's names.
    type State<'a> = Name<'a>;

    fn new(options: &Options) -> Self {
        match options.object(0).str("fn") {
            Some("vitest") => ConsistentVitestVi { function: "vitest", opposite: "vi" },
            _ => ConsistentVitestVi { function: "vi", opposite: "vitest" },
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Name<'a>> {
        file.find_name(self.opposite)
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Import(import) = statement.kind()
            && jest::is_vitest_import_source(import.spec().bytes())
        {
            self.check_import(import, cx);
        }
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(object) = self.renamed_object(cx.file(), cx.state, node) {
            let (file, function) = (cx.file(), self.function);
            // The fix of an import that declares the name renames the calls too, so that no file is renamed in part.
            let has_import = || self.renamed_import(file).is_some();
            cx.report(object.outer_span(), CONSISTENT_VITEST_VI)
                .data("function", function)
                .data("opposite", self.opposite)
                .fix_where_safe(|| has_import() || !self.changes_module_mock_call(object), |fixer| (!has_import()).then(|| fixer.replace(object.outer_span(), function)));
        }
    }
}

fn span_of(specifier: &ImportEntry) -> Span {
    match specifier.import_name {
        ImportImportName::Name(specifier) => specifier.span(),
        ImportImportName::Default(local) => local.span(),
        ImportImportName::NamespaceObject(local) => specifier.declaration.namespace_span().unwrap_or_else(|| local.span()),
    }
}

impl ConsistentVitestVi {
    /// The object of a call that the rule renames: the `vitest` of `vitest.fn()`.
    fn renamed_object<'a>(&self, file: &'a File<'a>, opposite: Name<'a>, node: Expr<'a>) -> Option<Expr<'a>> {
        let member_expression = node.callee().and_then(as_member_expression)?;
        if jest::first_identifier_of_chain(member_expression) != Some(opposite) {
            return None;
        }
        let vitest_fn = jest::parse_general_jest_fn_call(file, PossibleJestNode::new(node, jest::Runner::Vitest))?;
        let is_renamed = vitest_fn.kind == JestFnKind::General(JestGeneralFnKind::Vitest) && vitest_fn.name == self.opposite.as_bytes();
        member_expression.object().filter(|_| is_renamed)
    }

    /// The objects of all the calls that the rule renames.
    fn renamed_objects<'a>(&self, file: &'a File<'a>) -> impl Iterator<Item = Expr<'a>> {
        let opposite = file.find_name(self.opposite);
        let calls = opposite.into_iter().flat_map(move |_| file.exprs_of_kind(ExprTag::Call));
        calls.filter_map(move |it| self.renamed_object(file, opposite?, it))
    }

    /// The import from Vitest that declares the name that the rule renames.
    fn renamed_import<'a>(&self, file: &'a File<'a>) -> Option<Import<'a>> {
        let declares = |it: Import<'a>| import_entries_of(it).any(|it| it.local_name().bytes() == self.opposite.as_bytes());
        let mut imports = file.stmts_of_kind(StmtTag::Import).filter_map(|it| match it.kind() {
            StmtKind::Import(import) => Some(import),
            _ => None,
        });
        imports.find(|it| jest::is_vitest_import_source(it.spec().bytes()) && declares(*it))
    }

    fn check_import<'a>(&self, import: Import<'a>, cx: &Cx<'a, Self>) {
        let is_named = |specifier: &ImportEntry, name: &str| specifier.local_name().bytes() == name.as_bytes();
        let Some(vitest_import) = import_entries_of(import).find(|it| is_named(it, self.opposite)) else {
            return;
        };
        let file = cx.file();
        let report = cx.report(span_of(&vitest_import), CONSISTENT_VITEST_VI);
        report.data("function", self.function).data("opposite", self.opposite).fix_where_safe(|| !self.changes_module_mock_calls(file, import), |fixer| {
            let specifiers: SmallVec<[ImportEntry; 8]> = import_entries_of(import).collect();
            let mut import_text = Vec::new();
            for specifier in specifiers.iter().filter(|it| !is_named(it, self.opposite)) {
                import_text.extend_from_slice(if import_text.is_empty() { "" } else { ", " }.as_bytes());
                import_text.extend_from_slice(fixer.file().slice(span_of(specifier)));
            }
            let renamed_import = if import_text.is_empty() {
                fixer.replace(vitest_import.local_name().span(), self.function)
            } else {
                if !specifiers.iter().any(|it| is_named(it, self.function)) {
                    import_text.extend_from_slice(b", ");
                    import_text.extend_from_slice(self.function.as_bytes());
                }
                fixer.replace(Span::new(span_of(specifiers.first()?).start, span_of(specifiers.last()?).end), import_text)
            };
            // The calls get the new name in the same fix: a file with the import renamed and a call not, or the other way round, runs differently.
            let mut calls: SmallVec<[Span; 8]> = self.renamed_objects(file).map(Expr::outer_span).collect();
            calls.sort_unstable_by_key(|it| (it.start, it.end));
            let mut end = import.stmt().span().end;
            calls.retain(|it| {
                let is_after = it.start >= end;
                end = end.max(it.end);
                is_after
            });
            let mut fixes = vec![renamed_import];
            fixes.extend(calls.iter().map(|it| fixer.replace(*it, self.function)));
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

    /// True if the new name of `import` and of the calls changes what `bun test` does with a module mock call: see [`bun_test`].
    #[cold]
    fn changes_module_mock_calls<'a>(&self, file: &'a File<'a>, import: Import<'a>) -> bool {
        let function = self.function.as_bytes();
        let declares = import_entries_of(import).any(|it| it.local_name().bytes() == function);
        // The import then declares `function`, which takes the calls on the global of that name.
        if !declares && !self.declares_known(import) && bun_test::global_has_module_mock_call(file, function) {
            return true;
        }
        let mut mocks = self.renamed_objects(file).filter(|it| bun_test::is_object_of_module_mock_call(*it, function));
        mocks.any(|object| {
            // Where nothing declares `function`, the call is then on what the import declares.
            let after = match Node::Expr(object).scope().resolve_bytes(function) {
                None => self.declares_known(import),
                declared => bun_test::is_known(function, declared),
            };
            object.as_ident().is_some_and(|it| bun_test::is_known(it.bytes(), object.symbol()) != after)
        })
    }

    /// True if `object` and the `function` that replaces it are of different kinds for `bun test`, which changes what it does with the call.
    #[cold]
    fn changes_module_mock_call(&self, object: Expr<'_>) -> bool {
        let function = self.function.as_bytes();
        // The rule doesn't resolve the file's names for any other call.
        if !bun_test::is_object_of_module_mock_call(object, function) {
            return false;
        }
        let replacement = Node::Expr(object).scope().resolve_bytes(function);
        object.as_ident().is_some_and(|it| bun_test::is_known(it.bytes(), object.symbol()) != bun_test::is_known(function, replacement))
    }
}
