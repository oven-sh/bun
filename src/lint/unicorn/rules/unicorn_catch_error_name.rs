use bun_lint_oxlint::ast_util::{as_member_expression, static_property_name};
use bun_lint_oxlint::regex_flags::option_regex;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces consistent and descriptive naming for error variables in `catch` statements, preventing the use
/// of vague names like `badName` or `_` when the error is used.
pub struct CatchErrorName {
    ignore: Vec<Regex>,
    name: String,
    lowercase_name: String,
}

const CATCH_ERROR_NAME: Message =
    Message::new("", "The catch parameter \"{{caught_ident}}\" should be named \"{{expected_name}}\"");

impl CatchErrorName {
    /// Allows the name itself, with trailing underscores, or qualified: `error_`, `diagnosticError`,
    /// `diagnostic_error`.
    fn is_name_allowed(&self, name: &[u8]) -> bool {
        if name == self.name.as_bytes() {
            return true;
        }
        let stripped_len = name.len() - name.iter().rev().take_while(|it| **it == b'_').count();
        let stripped_name = name.get(..stripped_len).unwrap_or(name);
        let expected = self.lowercase_name.as_bytes();
        let is_qualified = match std::str::from_utf8(stripped_name) {
            Ok(stripped_name) if !stripped_name.is_ascii() => {
                stripped_name.to_lowercase().as_bytes().ends_with(expected)
            }
            _ => (stripped_name.len().checked_sub(expected.len()).and_then(|it| stripped_name.get(it..)))
                .is_some_and(|it| it.eq_ignore_ascii_case(expected)),
        };
        is_qualified || self.ignore.iter().any(|it| it.test(name))
    }

    /// True if renaming `symbol` can't collide with another binding. oxlint doesn't check this.
    fn can_rename(&self, symbol: Symbol<'_>) -> bool {
        utils::names::is_free(self.name.as_bytes(), symbol.scope(), symbol.references().map(Reference::scope))
    }

    fn check_binding_identifier<'a>(&self, pat: Pat<'a>, cx: &Cx<'a, Self>) {
        let Some(name) = pat.as_ident().filter(|it| !self.is_name_allowed(it.bytes())) else {
            return;
        };
        let Some(symbol) = pat.symbol() else {
            return;
        };
        // Excludes the write reference that a parameter's default value creates.
        let references = || symbol.references().filter(|it| !matches!(it.node(), Node::Pat(_)));
        if name.bytes().starts_with(b"_") && references().next().is_none() {
            return;
        }
        let caught = std::str::from_utf8(name.bytes()).unwrap_or_default();
        cx.report(pat, CATCH_ERROR_NAME)
            .data("caught_ident", name)
            .data("expected_name", self.name.clone())
            // For a fix with a single replacement, oxlint prints its generic help instead.
            .help_with(|| match references().next() {
                Some(_) if self.can_rename(symbol) => format!("Rename `{caught}` to `{}`", self.name),
                _ => String::new(),
            })
            .fix(|fixer| {
                let uses = references().map(|it| match it.expr().map(Expr::parent) {
                    // `{ e }` becomes `{ e: error }`, so the key stays the same.
                    Some(Node::Prop(prop)) if prop.kind() == PropKind::Shorthand => {
                        fixer.replace(it, format!("{caught}: {}", self.name))
                    }
                    _ => fixer.replace(it, self.name.as_str()),
                });
                let fixes = std::iter::once(fixer.replace(pat, self.name.as_str())).chain(uses);
                self.can_rename(symbol).then(|| fixes.collect::<Vec<_>>())
            });
    }

    /// `argument` is the callback that receives the error.
    fn check_function_arguments<'a>(&self, argument: Option<Expr<'a>>, cx: &Cx<'a, Self>) {
        if let Some(param) = argument.and_then(Expr::as_fn).and_then(|it| it.params().first())
            && !param.is_rest()
        {
            self.check_binding_identifier(param.pat(), cx);
        }
    }
}

impl Rule for CatchErrorName {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "catch-error-name", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::Try]).method_calls(&["catch", "then"]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let name = options.str("name").map(str::trim).filter(|it| text::is_identifier_name(it.as_bytes()));
        let name = name.unwrap_or("error");
        CatchErrorName {
            ignore: options.strings("ignore").into_iter().filter_map(option_regex).collect(),
            name: name.to_owned(),
            lowercase_name: name.to_lowercase(),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.mentions_any(&["catch", "then"]) { Self::ON } else { On::new().stmts(&[StmtTag::Try]) }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Try { param: Some(param), .. } = stmt.kind() {
            self.check_binding_identifier(param.pat(), cx);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        match as_member_expression(call.callee()).and_then(static_property_name).map(Name::bytes) {
            Some(b"catch") => self.check_function_arguments(call.args().first(), cx),
            Some(b"then") => self.check_function_arguments(call.args().get(1), cx),
            _ => {}
        }
    }
}
