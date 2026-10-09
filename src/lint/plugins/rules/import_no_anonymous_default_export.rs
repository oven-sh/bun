use bun_lint_oxlint::import::export_declaration_span;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow anonymous default exports in modules.
pub struct NoAnonymousDefaultExport {
    allow_array: bool,
    allow_arrow_function: bool,
    allow_anonymous_class: bool,
    allow_anonymous_function: bool,
    allow_call_expression: bool,
    allow_new: bool,
    allow_literal: bool,
    allow_object: bool,
}

const ANONYMOUS_FUNCTION: Message = Message::new("", "Unexpected default export of anonymous function");
const ANONYMOUS_CLASS: Message = Message::new("", "Unexpected default export of anonymous class");
const ARROW_FUNCTION: Message = Message::new("", "Assign arrow function to a variable before exporting as module default");
const OBJECT: Message = Message::new("", "Assign object to a variable before exporting as module default");
const CALL: Message = Message::new("", "Assign call result to a variable before exporting as module default");
const NEW: Message = Message::new("", "Assign instance to a variable before exporting as module default");
const ARRAY: Message = Message::new("", "Assign array to a variable before exporting as module default");
const LITERAL: Message = Message::new("", "Assign literal to a variable before exporting as module default");

impl Rule for NoAnonymousDefaultExport {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-anonymous-default-export", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoAnonymousDefaultExport {
            allow_array: options.bool_or("allowArray", false),
            allow_arrow_function: options.bool_or("allowArrowFunction", false),
            allow_anonymous_class: options.bool_or("allowAnonymousClass", false),
            allow_anonymous_function: options.bool_or("allowAnonymousFunction", false),
            allow_call_expression: options.bool_or("allowCallExpression", true),
            allow_new: options.bool_or("allowNew", false),
            allow_literal: options.bool_or("allowLiteral", false),
            allow_object: options.bool_or("allowObject", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Fn, StmtTag::Class], |rule, stmt, cx| {
            let message = match stmt.kind() {
                StmtKind::Fn(func) if func.name().is_none() && !rule.allow_anonymous_function => ANONYMOUS_FUNCTION,
                StmtKind::Class(class) if class.name().is_none() && !rule.allow_anonymous_class => ANONYMOUS_CLASS,
                _ => return,
            };
            if stmt.is_default_export() {
                cx.report(export_declaration_span(stmt), message);
            }
        });
        on.stmts([StmtTag::ExportDefault], |rule, stmt, cx| {
            let StmtKind::ExportDefault(e) = stmt.kind() else {
                return;
            };
            if e.is_parenthesized() {
                return;
            }
            let (is_allowed, message) = match e.kind() {
                ExprKind::Fn(func) if func.is_arrow() => (rule.allow_arrow_function, ARROW_FUNCTION),
                ExprKind::Object(_) => (rule.allow_object, OBJECT),
                ExprKind::Call(_) if !e.is_chain_root() => (rule.allow_call_expression, CALL),
                ExprKind::New(_) => (rule.allow_new, NEW),
                ExprKind::Array(_) => (rule.allow_array, ARRAY),
                ExprKind::True
                | ExprKind::False
                | ExprKind::Null
                | ExprKind::Number(_)
                | ExprKind::BigInt(_)
                | ExprKind::Regex(_)
                | ExprKind::String(_)
                | ExprKind::Template(_) => (rule.allow_literal, LITERAL),
                _ => return,
            };
            if !is_allowed {
                cx.report(stmt, message);
            }
        });
    }
}
