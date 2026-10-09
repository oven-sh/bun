use bun_lint::prelude::*;
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap};
use bun_lint_oxlint::ast_util::{
    as_member_expression, get_inner_expression, get_inner_expression_unless_chain, is_method_call,
    is_reference_to_global_variable,
};

/// Disallow using `Object.assign` with an object literal as the first argument and prefer the use
/// of object spread instead.
pub struct PreferObjectSpread;

const USE_SPREAD_MESSAGE: Message = Message::new(
    "useSpreadMessage",
    "Use an object spread instead of `Object.assign` eg: `{ ...foo }`.",
);
const USE_LITERAL_MESSAGE: Message = Message::new(
    "useLiteralMessage",
    "Use an object literal instead of `Object.assign`. eg: `{ foo: bar }`.",
);

const TRACE_MAP: TraceMap<'static, ()> =
    TraceMap::new(&[("Object", TraceMap::new(&[("assign", TraceMap::EMPTY.call(()))]))]);

fn properties(e: Expr<'_>) -> Option<List<'_, Prop<'_>>> {
    match e.kind() {
        ExprKind::Object(properties) => Some(properties),
        _ => None,
    }
}

/// ESLint's `hasAccessors`.
fn has_accessors<'a>(properties: List<'a, Prop<'a>>) -> bool {
    properties.iter().any(|it| matches!(it.kind(), PropKind::Getter | PropKind::Setter))
}

/// ESLint's `hasProtoProperty`.
fn has_proto_property<'a>(properties: List<'a, Prop<'a>>) -> bool {
    properties.iter().any(|it| {
        it.kind() != PropKind::Spread
            && ast_utils::get_static_property_name(it).as_deref() == Some(&b"__proto__"[..])
    })
}

/// What is reported for `call` if it calls `Object.assign`. It depends on the arguments only.
fn message_for(call: Call) -> Option<Message> {
    let args = call.args();
    if args.first()?.tag() != ExprTag::Object || args.iter().any(|it| it.tag() == ExprTag::Spread) {
        return None;
    }
    if args.len() == 1 {
        return Some(USE_LITERAL_MESSAGE);
    }
    let cannot_be_inlined = args.iter().filter_map(properties).any(has_accessors)
        || args.iter().skip(1).filter_map(properties).any(has_proto_property);
    (!cannot_be_inlined).then_some(USE_SPREAD_MESSAGE)
}

/// What oxlint reports for `call`. It follows no variable: `Object.assign` or `globalThis.Object.assign` is written out.
fn message_for_oxlint(call: Call) -> Option<Message> {
    if !is_method_call(call, None, Some(&["assign"]), Some(1), None) {
        return None;
    }
    let is_global = |e: Expr, name: &str| e.is_ident(name) && is_reference_to_global_variable(e);
    let object = get_inner_expression_unless_chain(as_member_expression(call.callee())?.object()?)?;
    let is_object = match object.kind() {
        ExprKind::Dot { obj, name, .. } => {
            name.bytes() == b"Object" && is_global(get_inner_expression(obj), "globalThis")
        }
        _ => is_global(object, "Object"),
    };
    let args = call.args();
    if !is_object
        || get_inner_expression(args.first()?).tag() != ExprTag::Object
        || args.iter().any(|it| it.tag() == ExprTag::Spread)
    {
        return None;
    }
    if args.len() == 1 {
        return Some(USE_LITERAL_MESSAGE);
    }
    let cannot_be_inlined = args.iter().map(get_inner_expression).filter_map(properties).any(has_accessors);
    (!cannot_be_inlined).then_some(USE_SPREAD_MESSAGE)
}

/// ESLint's `needsParens`: whether an object literal in the place of `node` has to be in
/// parentheses.
fn needs_parens(node: Expr) -> bool {
    let is_safe = !node.is_chain_root()
        && match node.parent() {
            Node::VarDecl(_) => true,
            Node::Stmt(parent) => parent.tag() == StmtTag::Return,
            Node::Prop(prop) => prop.kind() != PropKind::Spread && !prop.is_jsx_attribute(),
            Node::PatProp(prop) => prop.default() != Some(node),
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Array(_) | ExprKind::Call(_) => true,
                // Not the default value in a pattern.
                ExprKind::Assign { op, target, .. } => {
                    target != node && !(op.is_none() && utils::is_assignment_target(parent))
                }
                _ => false,
            },
            _ => false,
        };
    !is_safe && !ast_utils::is_parenthesised(node)
}

/// ESLint's `argNeedsParens`.
fn arg_needs_parens(node: Expr) -> bool {
    let is_loose = match node.kind() {
        ExprKind::Assign { .. } | ExprKind::Cond { .. } => true,
        ExprKind::Fn(func) => func.is_arrow(),
        _ => false,
    };
    is_loose && !ast_utils::is_parenthesised(node)
}

/// ESLint's `getStartWithSpaces`: the start of `token` and the whitespace before it.
fn get_start_with_spaces<'a>(file: &'a File<'a>, token: Span) -> u32 {
    // What follows a line comment would become part of it.
    let before = file.tokens_before(token).with_comments().next();
    if before.is_some_and(|it| it.kind() == TokenKind::Line) {
        return token.start;
    }
    text::trim_end(file.slice(Span::before(0, token))).len() as u32
}

/// ESLint's `getEndWithSpaces`: the end of `token` and the whitespace after it.
fn get_end_with_spaces(file: &File, token: Span) -> u32 {
    let rest = file.slice(Span::new(token.end, file.span().end));
    token.end + (rest.len() - text::trim_start(rest).len()) as u32
}

/// ESLint's `defineFixer`.
fn define_fixer<'a>(fixer: Fixer<'a>, node: Expr<'a>, call: Call<'a>) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let left_paren = file.tokens_after(call.callee()).find(ast_utils::is_opening_paren_token)?;
    let right_paren = file.last_token(node)?;

    // The callee, type arguments, and the whitespace before the `(`.
    let mut fixes = vec![fixer.remove(Span::new(node.span().start, left_paren.start()))];

    if needs_parens(node) {
        let needs_semicolon =
            ast_utils::is_start_of_expression_statement(node) && ast_utils::needs_preceding_semicolon(node);
        fixes.push(fixer.replace(left_paren, if needs_semicolon { ";({" } else { "({" }));
        fixes.push(fixer.replace(right_paren, "})"));
    } else {
        fixes.push(fixer.replace(left_paren, "{"));
        fixes.push(fixer.replace(right_paren, "}"));
    }

    for arg in call.args() {
        let (inner, outer) = (arg.span(), arg.outer_span());
        let Some(properties) = properties(arg) else {
            if arg_needs_parens(arg) {
                fixes.push(fixer.insert_before(outer, "...("));
                fixes.push(fixer.insert_after(outer, ")"));
            } else {
                fixes.push(fixer.insert_before(outer, "..."));
            }
            continue;
        };

        // The braces and the parentheses go, the outermost pair with the whitespace inside of it.
        let parens = arg.parens();
        let count = parens.len();
        let pairs = (count > 0).then_some(inner).into_iter().chain(parens.take(count.saturating_sub(1)));
        for pair in pairs {
            fixes.push(fixer.remove(Span::new(pair.start, pair.start + 1)));
            fixes.push(fixer.remove(Span::new(pair.end - 1, pair.end)));
        }
        let left = Span::new(outer.start, outer.start + 1);
        let right = Span::new(outer.end - 1, outer.end);
        let left_end = get_end_with_spaces(file, left);
        fixes.push(fixer.remove(Span::new(left.start, left_end)));
        fixes.push(fixer.remove(Span::new(get_start_with_spaces(file, right).max(left_end), right.end)));

        // The comma after this argument would be a second one.
        let ends_with_comma = properties.is_empty()
            || file.tokens_in(arg).nth_back(1).is_some_and(|it| ast_utils::is_comma_token(&it));
        if ends_with_comma
            && let Some(comma) = file.token_after(right)
            && ast_utils::is_comma_token(&comma)
        {
            fixes.push(fixer.remove(comma));
        }
    }
    Some(fixes)
}

impl PreferObjectSpread {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        if !cx.state {
            return;
        }
        for reference in ReferenceTracker::new(cx.file()).iterate_global_references(&TRACE_MAP) {
            if let (Some(node), Some(call)) = (reference.expr(), reference.call())
                && let Some(message) = message_for(call)
            {
                cx.report(node, message).fix(|fixer| define_fixer(fixer, node, call));
            }
        }
    }
}

impl Rule for PreferObjectSpread {
    const META: Meta = Meta::eslint("prefer-object-spread", Kind::Suggestion).fixable(Fixable::Code);
    /// Whether some call has the arguments that are reported for `Object.assign`.
    type State<'a> = bool;

    fn new(_: &Options) -> Self {
        PreferObjectSpread
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> bool {
        if file.language().is_oxlint {
            on.exprs([ExprTag::Call], |_, e, cx| {
                if let Some(call) = e.as_call()
                    && let Some(message) = message_for_oxlint(call)
                {
                    cx.report(e, message).fix(|fixer| define_fixer(fixer, e, call));
                }
            });
            return false;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            cx.state = cx.state || e.as_call().and_then(message_for).is_some();
        });
        on.finish(Self::check);
        false
    }
}
