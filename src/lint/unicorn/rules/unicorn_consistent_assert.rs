use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces consistent usage of the `assert` module.
pub struct ConsistentAssert;

const INCONSISTENT_ASSERT_USAGE: Message = Message::new("", "Inconsistent assert usage.");

impl Rule for ConsistentAssert {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "consistent-assert", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ConsistentAssert
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["assert", "node:assert", "assert/strict", "node:assert/strict"]) {
            return;
        }
        on.stmts([StmtTag::Import], |_, stmt, cx| {
            let StmtKind::Import(import) = stmt.kind() else {
                return;
            };
            let is_assert_module = import.spec().is_any(&["assert", "node:assert"]);
            if !is_assert_module && !import.spec().is_any(&["assert/strict", "node:assert/strict"]) {
                return;
            }
            let file = cx.file();
            let is_assert = |declaration: Declaration<'a>| match declaration {
                Declaration::ImportDefault(it) => it.stmt() == stmt,
                Declaration::ImportSpec(specifier) => {
                    let imported = specifier.imported();
                    specifier.import().stmt() == stmt
                        && (imported.name().is("default") || is_assert_module && imported.name().is("strict"))
                        // Not `{ "strict" as assert }`.
                        && !matches!(file.slice(imported.span()).first(), Some(b'\'' | b'"'))
                }
                _ => false,
            };
            for symbol in Node::Stmt(stmt).declared_symbols() {
                if !symbol.declarations().any(is_assert) {
                    continue;
                }
                for reference in symbol.references().filter_map(Reference::expr) {
                    // oxlint reports the callee of the call that the reference is directly in: also the `foo` of
                    // `foo(assert)`.
                    let ident = match reference.parent() {
                        _ if reference.is_parenthesized() => reference,
                        Node::Expr(call) if call.tag() == ExprTag::Call => match call.callee() {
                            Some(callee) if callee.tag() == ExprTag::Ident && !callee.is_parenthesized() => callee,
                            _ => continue,
                        },
                        _ => continue,
                    };
                    cx.report(ident, INCONSISTENT_ASSERT_USAGE)
                        .data("assert_identifier", ident.text())
                        .fix(|fixer| fixer.insert_after(ident, ".ok"));
                }
            }
        });
    }
}
