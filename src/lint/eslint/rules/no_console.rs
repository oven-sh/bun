use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::{parent_node, static_property_name};
use bun_lint::utils::ts_scope::reference_contains_type_query;

/// Disallow the use of `console`.
pub struct NoConsole {
    allowed: Vec<Box<[u8]>>,
}

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected console statement.");
const LIMITED: Message = Message::new(
    "limited",
    "Unexpected console statement. Only these console methods are allowed: {{ allowed }}.",
);
const REMOVE_CONSOLE: Message =
    Message::new("removeConsole", "Remove the console.{{ propertyName }}().");
const REMOVE_METHOD_CALL: Message =
    Message::new("removeMethodCall", "Remove the console method call.");

/// Whether removing `statement` could make what follows it a continuation of what precedes it.
fn maybe_asi_hazard(statement: Stmt<'_>) -> bool {
    let file = statement.file();
    let (Some(before), Some(after)) = (file.token_before(statement), file.token_after(statement))
    else {
        return false;
    };
    matches!(after.text().first(), Some(b'-' | b'[' | b'(' | b'/' | b'+' | b'`'))
        && !after.is("++")
        && !after.is("--")
        && !matches!(before.text(), b":" | b";" | b"{")
}

/// The statement that consists of a call of `member`, if it can be removed.
fn removable_statement(member: Expr<'_>) -> Option<Stmt<'_>> {
    let call = member.parent().as_expr()?;
    if call.as_call()?.callee() != member || call.is_in_optional_chain() {
        return None;
    }
    let statement = call.parent().as_stmt()?;
    (matches!(statement.kind(), StmtKind::Expr(_))
        && ast_utils::is_statement_list_parent(statement.parent())
        && !maybe_asi_hazard(statement))
    .then_some(statement)
}

/// oxlint's `remove_console`: what it puts where, for a `member` that is directly in a call. Nothing in the place of a
/// statement, a block where there has to be a statement or a body, and `undefined` where there has to be a value.
fn change_of_oxlint(member: Expr) -> Option<(Span, &'static str)> {
    let call = parent_node(member)?.as_expr().filter(|it| it.tag() == ExprTag::Call)?;
    if call.is_chain_root() {
        return Some((call.span(), ""));
    }
    let needs_statement = |it: Stmt| {
        matches!(it.tag(), StmtTag::If | StmtTag::While | StmtTag::For | StmtTag::ForIn | StmtTag::ForOf)
    };
    let text = match call.parent() {
        Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Expr(_)) => {
            let is_body = matches!(statement.parent(), Node::Stmt(parent) if needs_statement(parent));
            return Some((statement.span(), if is_body { "{}" } else { "" }));
        }
        Node::Stmt(parent) if needs_statement(parent) => "{}",
        Node::Func(func) if func.is_arrow() => "{}",
        Node::Expr(parent) if parent.tag() == ExprTag::Cond || parent.binary_op() == Some(BinOp::Comma) => "undefined",
        Node::Prop(prop) if prop.kind() == PropKind::Init && !prop.is_jsx_attribute() => "undefined",
        _ => "",
    };
    Some((call.outer_span(), text))
}

impl NoConsole {
    fn is_allowed(&self, member: Expr) -> bool {
        !self.allowed.is_empty()
            && ast_utils::get_static_property_name(member)
                .is_some_and(|name| !name.is_empty() && self.allowed.iter().any(|it| **it == *name))
    }

    fn check<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = member.kind() else {
            return;
        };
        if !obj.is_ident("console") || self.is_allowed(member) || member.is_jsx_tag_name() {
            return;
        }
        // oxlint says nothing about `console[a]` and `console[0]`.
        if cx.language().is_oxlint && member.tag() == ExprTag::Index && static_property_name(member).is_none() {
            return;
        }
        let Some(reference) = obj.reference() else {
            return;
        };
        if reference.symbol().is_some() || reference_contains_type_query(reference) {
            return;
        }
        // For oxlint it ends with the name: before the `]`.
        let place = match member.kind() {
            ExprKind::Index { index, .. } if cx.language().is_oxlint => member.span().to(index.span()),
            _ => member.span(),
        };
        let report = match self.allowed.is_empty() {
            true => cx.report(place, UNEXPECTED),
            false => cx.report(place, LIMITED).data("allowed", self.allowed.join(&b", "[..])),
        };
        if cx.language().is_oxlint {
            if let Some((at, text)) = change_of_oxlint(member) {
                match text {
                    "undefined" => report.suggest_dangerously(REMOVE_METHOD_CALL, |fixer| fixer.replace(at, text)),
                    _ => report.suggest(REMOVE_METHOD_CALL, |fixer| fixer.replace(at, text)),
                };
            }
            return;
        }
        let remove = |fixer: Fixer<'a>| removable_statement(member).map(|it| fixer.remove(it));
        match member.kind() {
            ExprKind::Dot { name, .. } => {
                let name = name.bytes();
                let name = name.strip_prefix(b"#").unwrap_or(name);
                report.suggest_with(REMOVE_CONSOLE, &[("propertyName", name)], remove);
            }
            _ => {
                report.suggest(REMOVE_METHOD_CALL, remove);
            }
        }
    }
}

impl Rule for NoConsole {
    const META: Meta = Meta::eslint("no-console", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let allowed = options.object(0).strings("allow");
        NoConsole {
            allowed: allowed.into_iter().map(|it| it.as_bytes().into()).collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.mentions("console") {
            on.exprs([ExprTag::Dot, ExprTag::Index], Self::check);
        }
    }
}
