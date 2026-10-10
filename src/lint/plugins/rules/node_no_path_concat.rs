use bun_lint_oxlint::ast_util::{get_inner_expression, is_global_reference_name, is_specific_id, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};

/// Disallows string concatenation with `__dirname` and `__filename`.
pub struct NoPathConcat;

const NO_PATH_CONCAT: Message = Message::new("", "Use `path.join()` or `path.resolve()` instead of string concatenation");

impl Rule for NoPathConcat {
    const META: Meta = Meta::oxlint(Plugin::Node, "no-path-concat", Kind::Suggestion);
    const ON: On = On::new().binaries(&[BinOp::Add]).exprs(&[ExprTag::Template]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoPathConcat
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions_any(&["__dirname", "__filename"]) {
            return None;
        }
        Some(())
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Binary { left, right, .. } = e.kind()
            && is_dirname_or_filename(left)
            && starts_with_path_separator(Start::Expr(right))
        {
            cx.report(e, NO_PATH_CONCAT);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Template(template) = e.kind() else {
            return;
        };
        for (i, expr) in template.exprs().iter().enumerate() {
            if is_dirname_or_filename(expr) && starts_with_path_separator(Start::TemplateElement(template, i + 1)) {
                cx.report(e, NO_PATH_CONCAT);
            }
        }
    }
}

fn is_dirname_or_filename(expr: Expr) -> bool {
    is_global_reference_name(expr, "__dirname") || is_global_reference_name(expr, "__filename")
}

/// `path.sep`
fn is_path_sep(expr: Expr) -> bool {
    let member = get_inner_expression(expr);
    static_property_name(member).is_some_and(|it| it.is("sep")) && member.object().is_some_and(|it| is_specific_id(it, "path"))
}

/// What a text can start with.
#[derive(Copy, Clone)]
enum Start<'a> {
    Expr(Expr<'a>),
    /// A template from its piece of text with this number on.
    TemplateElement(Template<'a>, usize),
}

/// `starts_with_path_separator`, `template_element_starts_with_path_separator`
fn starts_with_path_separator(start: Start) -> bool {
    let is_path_separator = |text: Name| matches!(text.bytes().first(), Some(b'/' | b'\\'));
    let mut pending: SmallVec<[Start; 8]> = smallvec![start];
    while let Some(start) = pending.pop() {
        let expr = match start {
            Start::Expr(expr) => expr,
            Start::TemplateElement(template, i) => {
                if i < template.quasi_count() {
                    if template.cooked(i).is_some_and(is_path_separator) {
                        return true;
                    }
                    pending.extend(template.exprs().get(i).map(Start::Expr));
                }
                continue;
            }
        };
        match expr.kind() {
            ExprKind::String(value) if is_path_separator(value) => return true,
            ExprKind::String(_) => {}
            ExprKind::Template(template) => pending.push(Start::TemplateElement(template, 0)),
            ExprKind::Binary { op: BinOp::Add, left, .. } => pending.push(Start::Expr(left)),
            ExprKind::Cond { yes, no, .. } => pending.extend([Start::Expr(yes), Start::Expr(no)]),
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } => {
                pending.extend([Start::Expr(left), Start::Expr(right)]);
            }
            ExprKind::Assign { value: last, .. } | ExprKind::Binary { op: BinOp::Comma, right: last, .. } => {
                pending.push(Start::Expr(last));
            }
            _ if is_path_sep(expr) => return true,
            _ => {}
        }
    }
    false
}
