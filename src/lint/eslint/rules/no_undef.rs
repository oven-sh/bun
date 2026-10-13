use bun_lint::prelude::*;
use bun_lint::source::ByName;

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

impl Rule for NoUndef {
    const META: Meta = Meta::eslint("no-undef", Kind::Problem).recommended().reports_at_the_end();
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
            Some(e) => !e.is_parenthesized() && matches!(e.parent(), Node::Stmt(it) if it.tag() == StmtTag::ExportDefault),
        };
        let file = cx.file();
        // Whether a global variable of a name is one for a value, and for a type.
        let (for_value, for_type) = (1, 2);
        let mut globals: ByName<u8> = ByName::default();
        for reference in file.unresolved_references() {
            let is_in_parentheses = || reference.expr().is_some_and(Expr::is_parenthesized);
            if is_oxlint && (reference.is_type() && !is_in_parentheses() || is_none_for_oxc(reference))
                || !self.considers_typeof && has_typeof_operator(reference)
            {
                continue;
            }
            let name = reference.name();
            let global = globals.get_or_insert_with(name, || match file.global_named(name) {
                Some(global) => {
                    (u8::from(global.accepts(false)) * for_value) | (u8::from(global.accepts(true)) * for_type)
                }
                None => 0,
            });
            // `reference.global().is_some()`
            if reference.is_value() && global & for_value != 0 || reference.is_type() && global & for_type != 0 {
                continue;
            }
            if file.is_declared_by_types(name.bytes()) {
                continue;
            }
            cx.report(reference, UNDEF).data("name", reference.name());
        }
    }
}
