use bun_lint::linter::globals::config_globals_in_order;
use bun_lint::prelude::*;
use bun_lint::source::ByName;
use bun_lint_oxlint::hash_order::UnresolvedOrder;
use std::cell::OnceCell;

/// Disallow the use of undeclared variables unless mentioned in `/*global */` comments.
pub struct NoUndef {
    considers_typeof: bool,
}

const UNDEF: Message = Message::new("undef", "'{{name}}' is not defined.");

/// ESLint's `hasTypeOfOperator`.
fn has_typeof_operator(reference: Reference) -> bool {
    matches!(
        reference.expr().map(Expr::parent),
        Some(Node::Expr(parent)) if parent.unary_op() == Some(UnOp::Typeof)
    )
}

/// Globals that `bun test` defines in test files.
const OF_BUN_TEST: [&str; 12] = [
    "afterAll",
    "afterEach",
    "beforeAll",
    "beforeEach",
    "describe",
    "expect",
    "it",
    "jest",
    "mock",
    "spyOn",
    "test",
    "vi",
];

fn hint(reference: Reference) -> String {
    let (name, language) = (reference.name(), reference.node().file().language());
    if name.is_any(&OF_BUN_TEST) {
        return "With bun test, import it from \"bun:test\".".to_owned();
    }
    let globals = config_globals_in_order(language);
    let globals = globals
        .iter()
        .filter(|it| it.1 != Global::Off)
        .map(|it| &*it.0);
    let declared = reference
        .scope()
        .chain()
        .flat_map(Scope::symbols)
        .map(|it| it.name().bytes());
    match text::spelling_suggestion(name.bytes(), declared.chain(globals)) {
        Some(close) => format!("Did you mean \"{}\"?", bstr::BStr::new(close)),
        None => {
            "If it is a global variable, declare it in [lint.globals] in bunfig.toml.".to_owned()
        }
    }
}

impl Rule for NoUndef {
    const META: Meta = Meta::eslint("no-undef", Kind::Problem)
        .recommended()
        .reports_at_the_end()
        .hints();
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        NoUndef {
            considers_typeof: options.object(0).bool_or("typeof", false),
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        // oxlint says nothing about a name that can be that of a type. And for oxc only an expression and the `a` of
        // `export { a }` refer to a variable: not the `a` of `import b = a.c`, of `export as namespace a`, of `a is T`, of `<a:b />`.
        let is_oxlint = cx.language().is_oxlint;
        let is_none_for_oxc = |it: Reference| match it.expr() {
            None => !matches!(it.node(), Node::ExportSpec(_)),
            // The `a` of `export default a` can be a type, in JavaScript too.
            Some(e) => {
                !e.is_parenthesized()
                    && matches!(e.parent(), Node::Stmt(it) if it.tag() == StmtTag::ExportDefault)
            }
        };
        let file = cx.file();
        // Whether a global variable of a name is one for a value, and for a type.
        let (for_value, for_type) = (1, 2);
        let mut globals: ByName<u8> = ByName::default();
        // With no config file, a name that the file tests with `typeof` isn't reported anywhere in it. The author knows that it may
        // be missing: `if (typeof define === "function" && define.amd) define(factory);`
        let trusts_typeof = cx.language().stands_alone && !self.considers_typeof;
        let tested: OnceCell<Vec<Name>> = OnceCell::new();
        let names_with_typeof = || {
            file.unresolved_references()
                .filter(|it| has_typeof_operator(*it))
                .map(|it| it.name())
                .collect()
        };
        let mut found: Vec<Reference> = Vec::new();
        for reference in file.unresolved_references() {
            let is_in_parentheses = || reference.expr().is_some_and(Expr::is_parenthesized);
            if is_oxlint
                && (reference.is_type() && !is_in_parentheses() || is_none_for_oxc(reference))
                || !self.considers_typeof && has_typeof_operator(reference)
            {
                continue;
            }
            let name = reference.name();
            let global = globals.get_or_insert_with(name, || match file.global_named(name) {
                Some(global) => {
                    (u8::from(global.accepts(false)) * for_value)
                        | (u8::from(global.accepts(true)) * for_type)
                }
                None => 0,
            });
            // `reference.global().is_some()`
            if reference.is_value() && global & for_value != 0
                || reference.is_type() && global & for_type != 0
            {
                continue;
            }
            if file.is_declared_by_types(name.bytes())
                || trusts_typeof && tested.get_or_init(names_with_typeof).contains(&name)
            {
                continue;
            }
            found.push(reference);
        }
        // oxlint's rule goes through oxc's table of the names that resolve to nothing, name by name.
        if is_oxlint && found.len() > 1 {
            let order = UnresolvedOrder::new(file);
            // Those of one name stay in the order of the text.
            utils::sort::sort_by_cached_key(&mut found, |it| order.rank(it.name()));
        }
        for reference in found {
            cx.report(reference, UNDEF)
                .data("name", reference.name())
                .hint_with(|| Some(hint(reference)));
        }
    }
}
