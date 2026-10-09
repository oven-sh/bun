use bun_lint_oxlint::ast_util::is_global_reference;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows the deprecated `new Buffer()` constructor.
pub struct NoNewBuffer;

const NO_NEW_BUFFER: Message = Message::new(
    "",
    "Use `Buffer.alloc()` or `Buffer.from()` instead of the deprecated `new Buffer()` constructor.",
);
const USE_ALLOC_OR_FROM: Message =
    Message::new("", "`new Buffer()` is deprecated, use `Buffer.alloc()` or `Buffer.from()` instead.");

/// `alloc` for a number, `from` for an array or a string. `None` if it cannot be told.
fn determine_buffer_method<'a>(args: List<'a, Expr<'a>>) -> Option<&'static str> {
    if args.iter().any(|it| it.tag() == ExprTag::Spread) {
        return None;
    }
    match args.first()?.tag() {
        ExprTag::Number => Some("alloc"),
        ExprTag::String | ExprTag::Template | ExprTag::Array => Some("from"),
        _ => None,
    }
}

impl Rule for NoNewBuffer {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-new-buffer", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewBuffer
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Buffer") {
            return;
        }
        on.exprs([ExprTag::New], |_, e, cx| {
            let ExprKind::New(new) = e.kind() else {
                return;
            };
            let callee = new.callee();
            if !callee.is_ident("Buffer") || !is_global_reference(callee) {
                return;
            }
            cx.report(callee, NO_NEW_BUFFER).suggest(USE_ALLOC_OR_FROM, |fixer| {
                let method = determine_buffer_method(new.args())?;
                let mut replacement = [&b"Buffer."[..], method.as_bytes(), b"("].concat();
                for (i, argument) in new.args().iter().enumerate() {
                    if i != 0 {
                        replacement.extend_from_slice(b", ");
                    }
                    replacement.extend_from_slice(fixer.file().slice(argument.outer_span()));
                }
                replacement.push(b')');
                Some(fixer.replace(e, replacement))
            });
        });
    }
}
