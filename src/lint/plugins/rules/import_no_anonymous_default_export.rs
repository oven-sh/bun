use bun_lint_oxlint::import::export_declaration_span;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid anonymous values as default exports.
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
    const META: Meta = Meta::plugin(Plugin::Import, "no-anonymous-default-export", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::Fn, StmtTag::Class, StmtTag::ExportDefault]);
    no_state!();

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

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::Fn | StmtTag::Class => {
                let message = match stmt.kind() {
                    // A signature is a `TSDeclareFunction`. oxlint takes it for a function.
                    StmtKind::Fn(func) if !func.has_body() && !cx.language().is_oxlint => return,
                    StmtKind::Fn(func) if func.name().is_none() && !self.allow_anonymous_function => ANONYMOUS_FUNCTION,
                    StmtKind::Class(class) if class.name().is_none() && !self.allow_anonymous_class => ANONYMOUS_CLASS,
                    _ => return,
                };
                if stmt.is_default_export() {
                    cx.report(export_declaration_span(stmt), message);
                }
            }
            StmtTag::ExportDefault => self.export_default(stmt, cx),
            _ => {}
        }
    }
}

impl NoAnonymousDefaultExport {
    fn export_default<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::ExportDefault(e) = stmt.kind() else {
            return;
        };
        // oxlint takes parentheses for a node.
        if e.is_parenthesized() && cx.language().is_oxlint {
            return;
        }
        let (is_allowed, message) = match e.kind() {
            ExprKind::Fn(func) if func.is_arrow() => (self.allow_arrow_function, ARROW_FUNCTION),
            ExprKind::Object(_) => (self.allow_object, OBJECT),
            ExprKind::Call(_) if !e.is_chain_root() => (self.allow_call_expression, CALL),
            ExprKind::New(_) => (self.allow_new, NEW),
            ExprKind::Array(_) => (self.allow_array, ARRAY),
            ExprKind::True
            | ExprKind::False
            | ExprKind::Null
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_)
            | ExprKind::String(_)
            | ExprKind::Template(_) => (self.allow_literal, LITERAL),
            _ => return,
        };
        if !is_allowed {
            cx.report(stmt, message);
        }
    }
}
