use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require `Array.isArray()` instead of `instanceof Array`.
pub struct NoInstanceofArray;

const NO_INSTANCEOF_ARRAY: Message = Message::new("", "Use `Array.isArray()` instead of `instanceof Array`.");

impl Rule for NoInstanceofArray {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-instanceof-array", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoInstanceofArray
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.binaries([BinOp::Instanceof], |_, e, cx| {
            if let ExprKind::Binary { left, right, .. } = e.kind()
                && right.is_ident("Array")
            {
                cx.report(e, NO_INSTANCEOF_ARRAY).fix(|fixer| {
                    let argument = fixer.file().slice(left.outer_span());
                    fixer.replace(e, [&b"Array.isArray("[..], argument, b")"].concat())
                });
            }
        });
    }
}
