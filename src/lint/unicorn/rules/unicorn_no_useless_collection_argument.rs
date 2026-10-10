use bun_core::strings;
use bun_lint_oxlint::ast_util::{get_inner_expression, is_new_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow useless values or fallbacks in `Set`, `Map`, `WeakSet`, or `WeakMap`.
pub struct NoUselessCollectionArgument;

const NO_USELESS_COLLECTION_ARGUMENT: Message = Message::new("", "The {{expr_type}} is useless");

impl Rule for NoUselessCollectionArgument {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "no-useless-collection-argument", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUselessCollectionArgument
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions_any(&["Set", "Map", "WeakSet", "WeakMap"]) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::New(new_expr) = e.kind() else {
            return;
        };
        if !is_new_expression(new_expr, &["Set", "Map", "WeakSet", "WeakMap"], Some(1), Some(1)) {
            return;
        }
        let Some(first_arg_expr) = new_expr.args().first().filter(|it| it.tag() != ExprTag::Spread) else {
            return;
        };
        let first_arg_expr_inner = get_inner_expression(first_arg_expr);
        // `a ?? []`
        let (useless_expr, left_of_logical_expr) = match first_arg_expr_inner.kind() {
            ExprKind::Binary { op: BinOp::Nullish, left, right } => (get_inner_expression(right), Some(left)),
            _ => (first_arg_expr_inner, None),
        };
        let description = match useless_expr.kind() {
            ExprKind::Array(elements) if elements.is_empty() => "empty array",
            ExprKind::String(value) if value.bytes().is_empty() => "empty string",
            ExprKind::Null => "null",
            ExprKind::Ident(name) if name.is("undefined") => "undefined",
            _ => return,
        };
        cx.report(useless_expr, NO_USELESS_COLLECTION_ARGUMENT).data("expr_type", description).suggest_with(
            NO_USELESS_COLLECTION_ARGUMENT,
            &[("expr_type", description.as_bytes())],
            |fixer| match left_of_logical_expr {
                Some(left) => remove_fallback(fixer, first_arg_expr, first_arg_expr_inner, left),
                None => remove_argument(fixer, first_arg_expr),
            },
        );
    }
}

/// With the comma after it.
fn remove_argument<'a>(fixer: Fixer<'a>, first_arg: Expr<'a>) -> Fix {
    let span = first_arg.outer_span();
    let after_arg = fixer.file().text().get(span.end as usize..).unwrap_or_default();
    let trimmed = strings::trim_unicode_whitespace_start(after_arg);
    let delete_end = match trimmed.starts_with(b",") {
        true => span.end + (after_arg.len() - trimmed.len()) as u32 + 1,
        false => span.end,
    };
    fixer.remove(Span::new(span.start, delete_end))
}

fn remove_fallback<'a>(fixer: Fixer<'a>, arg_expr: Expr<'a>, logical_expr: Expr<'a>, left: Expr<'a>) -> Fix {
    let (file, arg, logical) = (fixer.file(), arg_expr.outer_span(), logical_expr.span());
    if arg == logical {
        return fixer.remove(Span::new(left.outer_span().end, logical.end));
    }
    // The parentheses around it go as well.
    let before_logical = file.slice(Span::new(arg.start, logical.start));
    let after_logical = file.slice(Span::new(logical.end, arg.end));
    let open = before_logical.iter().take_while(|it| **it == b'(').count();
    let close = after_logical.iter().rev().take_while(|it| **it == b')').count();
    let before_cleaned = before_logical.get(open..).unwrap_or_default();
    let after_cleaned = after_logical.get(..after_logical.len() - close).unwrap_or_default();
    fixer.replace(arg, [before_cleaned, file.slice(left.outer_span()), after_cleaned].concat())
}
