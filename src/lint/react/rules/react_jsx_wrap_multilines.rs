use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow missing parentheses around multiline JSX.
pub struct JsxWrapMultilines {
    declaration: Wrap,
    assignment: Wrap,
    return_: Wrap,
    arrow: Wrap,
    condition: Wrap,
    logical: Wrap,
    prop: Wrap,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Wrap {
    Ignore,
    Parens,
    ParensNewLine,
    Never,
}

/// upstream's `type`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Place {
    Declaration,
    Assignment,
    Return,
    Arrow,
    Condition,
    Logical,
    Prop,
}

const MISSING_PARENS: Message = Message::new("missingParens", "Missing parentheses around multilines JSX");
const EXTRA_PARENS: Message = Message::new("extraParens", "Expected no parentheses around multilines JSX");
const PARENS_ON_NEW_LINES: Message =
    Message::new("parensOnNewLines", "Parentheses around JSX should be on separate lines");

impl Rule for JsxWrapMultilines {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-wrap-multilines", Kind::Layout).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let user_options = options.object(0);
        let get_option = |place, default| match (user_options.str(place), user_options.bool(place)) {
            (Some("parens"), _) | (_, Some(true)) => Wrap::Parens,
            (Some("parens-new-line"), _) => Wrap::ParensNewLine,
            (Some("never"), _) => Wrap::Never,
            _ if user_options.has(place) => Wrap::Ignore,
            _ => default,
        };
        JsxWrapMultilines {
            declaration: get_option("declaration", Wrap::Parens),
            assignment: get_option("assignment", Wrap::Parens),
            return_: get_option("return", Wrap::Parens),
            arrow: get_option("arrow", Wrap::Parens),
            condition: get_option("condition", Wrap::Ignore),
            logical: get_option("logical", Wrap::Ignore),
            prop: get_option("prop", Wrap::Ignore),
        }
    }

    /// upstream's `check`. Where it looks, a `(` before the JSX is one around it.
    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(place) = self.place_of(node) else {
            return;
        };
        let (file, span) = (cx.file(), node.span());
        let report = |message| cx.report(node, message).on_exit(place == Place::Arrow);
        match self.get_option(place) {
            Wrap::Ignore => {}
            Wrap::Parens => {
                if !node.is_parenthesized() && !ast_utils::is_on_one_line(file, span) {
                    report(MISSING_PARENS).fix(|fixer| fixer.replace(node, [&b"("[..], node.text(), b")"].concat()));
                }
            }
            Wrap::ParensNewLine => {
                if ast_utils::is_on_one_line(file, span) {
                    return;
                }
                let Some(parens) = node.parens().next() else {
                    report(MISSING_PARENS).fix(|fixer| wrap_on_new_lines(fixer, node));
                    return;
                };
                let inside = parens.shrink(1, 1);
                let needs_opening = ast_utils::is_on_one_line(file, Span::before(inside.start, span));
                let needs_closing = ast_utils::is_on_one_line(file, Span::after(span, inside.end));
                if needs_opening || needs_closing {
                    report(PARENS_ON_NEW_LINES).fix(|fixer| {
                        let new_line = |is_needed| if is_needed { &b"\n"[..] } else { &b""[..] };
                        fixer.replace(node, [new_line(needs_opening), node.text(), new_line(needs_closing)].concat())
                    });
                }
            }
            Wrap::Never => {
                if let Some(parens) = node.parens().next() {
                    report(EXTRA_PARENS).fix(|fixer| fixer.replace(parens, node.text()));
                }
            }
        }
    }
}

impl JsxWrapMultilines {
    fn get_option(&self, place: Place) -> Wrap {
        match place {
            Place::Declaration => self.declaration,
            Place::Assignment => self.assignment,
            Place::Return => self.return_,
            Place::Arrow => self.arrow,
            Place::Condition => self.condition,
            Place::Logical => self.logical,
            Place::Prop => self.prop,
        }
    }

    /// As what one of upstream's listeners hands `node` to `check`.
    fn place_of(&self, node: Expr<'_>) -> Option<Place> {
        match node.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Jsx(_) => None,
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, right, .. } => {
                    (right == node).then_some(Place::Logical)
                }
                ExprKind::Cond { test, .. } if test == node => None,
                ExprKind::Cond { .. } if self.condition != Wrap::Ignore => Some(Place::Condition),
                // Without `condition`, the branches of what is declared or assigned are checked as that.
                ExprKind::Cond { .. } => declaration_or_assignment(parent),
                _ => declaration_or_assignment(node),
            },
            Node::Stmt(parent) => (parent.tag() == StmtTag::Return).then_some(Place::Return),
            // Only an arrow function has an expression as its body.
            Node::Func(_) => Some(Place::Arrow),
            Node::Prop(parent) => {
                let is_in_container = parent.is_jsx_attribute() && parent.kind() != PropKind::Spread;
                (is_in_container && node.jsx_container_span().is_some()).then_some(Place::Prop)
            }
            _ => declaration_or_assignment(node),
        }
    }
}

/// `node` is the `init` of a `VariableDeclarator` or the `right` of an `AssignmentExpression`.
fn declaration_or_assignment(node: Expr<'_>) -> Option<Place> {
    match node.parent() {
        Node::VarDecl(_) => Some(Place::Declaration),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Assign { value, .. } => {
                (value == node && !parent.is_assignment_target()).then_some(Place::Assignment)
            }
            _ => None,
        },
        _ => None,
    }
}

/// The fix of `parens-new-line` for JSX without parentheses.
#[cold]
#[inline(never)]
fn wrap_on_new_lines<'a>(fixer: Fixer<'a>, node: Expr<'a>) -> Option<Fix> {
    let (file, span) = (fixer.file(), node.span());
    let token_before = file.tokens_before(node).with_comments().next()?;
    if ast_utils::is_on_one_line(file, token_before.span().between(span)) {
        return Some(fixer.replace(node, [&b"(\n"[..], node.text(), b"\n)"].concat()));
    }
    let end = match file.tokens_after(node).with_comments().next() {
        Some(token_after) if matches!(token_after.value(), b";" | b"}") => token_after.start(),
        _ => span.end,
    };
    let column = file.position(span.start).column as usize;
    // In column 1 upstream throws: `" ".repeat(-1)`.
    let closing_column = if column > 0 { column.checked_sub(2)? } else { 0 };
    // Of a comment that is its text, without `//` or `/*`.
    let value = token_before.value();
    let mut fixed = strings::trim_js_whitespace(value).to_vec();
    if !matches!(value, b"{" | b"[") {
        fixed.push(b' ');
    }
    fixed.extend_from_slice(b"(\n");
    fixed.resize(fixed.len() + column, b' ');
    fixed.extend_from_slice(node.text());
    fixed.push(b'\n');
    fixed.resize(fixed.len() + closing_column, b' ');
    fixed.push(b')');
    Some(fixer.replace(Span::new(token_before.start(), end), fixed))
}
