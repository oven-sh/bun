use bun_lint_oxlint::ast_util::{
    get_inner_expression, get_inner_expression_unless_chain, get_member_expr, is_global_reference, static_property_name,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};

/// Disallows mutating a variable immediately after initialization.
pub struct NoImmediateMutation;

const ARRAY_MUTATION: Message = Message::new("", "Do not call `{{method}}()` immediately after initializing an array.");
const OBJECT_ASSIGN: Message = Message::new("", "Do not call `Object.assign()` immediately after initializing an object.");
const OBJECT_PROPERTY: Message = Message::new("", "Do not assign a property immediately after initializing an object literal.");
const SET_ADD: Message = Message::new("", "Do not call `.add()` immediately after initializing a Set.");
const MAP_SET: Message = Message::new("", "Do not call `.set()` immediately after initializing a Map.");

#[derive(Copy, Clone, PartialEq, Eq)]
enum InitType {
    Array,
    Object,
    Set,
    Map,
}

impl Rule for NoImmediateMutation {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-immediate-mutation", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoImmediateMutation
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Expr], |_, statement, cx| {
            let StmtKind::Expr(expr) = statement.kind() else {
                return;
            };
            let Some(expr) = get_inner_expression_unless_chain(expr) else {
                return;
            };
            // The variable that is changed, how it has to be initialized, and what is reported then.
            let Some(mutation) = (match expr.kind() {
                ExprKind::Call(call) => call_mutation(call),
                ExprKind::Assign { op: None, target, value } => property_assignment(target, value),
                _ => None,
            }) else {
                return;
            };
            let statements = match statement.parent() {
                Node::File(file) => Some(file.body()),
                Node::Func(func) => func.body_statements(),
                Node::Stmt(block) => block.as_block(),
                Node::Case(case) => Some(case.body()),
                _ => None,
            };
            let prev_stmt = statements.and_then(|it| it.before(statement.span().start));
            if prev_stmt.and_then(get_prev_declaration) == Some((mutation.variable, mutation.init_type)) {
                let report = cx.report(expr, mutation.message);
                if let Some(method) = mutation.method {
                    report.data("method", method);
                }
            }
        });
    }
}

struct Mutation<'a> {
    variable: Name<'a>,
    init_type: InitType,
    message: Message,
    method: Option<Name<'a>>,
}

fn is_spread(e: Expr) -> bool {
    e.tag() == ExprTag::Spread
}

fn call_mutation(call: Call<'_>) -> Option<Mutation<'_>> {
    let member = get_member_expr(call.callee()).filter(|it| !it.is_optional())?;
    let method_name = static_property_name(member)?;
    let object = get_inner_expression(member.object()?);
    let args = call.args();
    let references = |variable| args.iter().filter(|it| !is_spread(*it)).any(|it| expression_references_variable(it, variable));
    if method_name.is("assign") && object.is_ident("Object") && is_global_reference(object) {
        // `Object.assign(obj, ...spread)` cannot be moved.
        let variable = get_inner_expression(args.first()?).as_ident()?;
        let is_valid = args.len() >= 2
            && !args.get(1).is_some_and(is_spread)
            && !args.iter().skip(1).filter(|it| !is_spread(*it)).any(|it| expression_references_variable(it, variable));
        return is_valid.then_some(Mutation { variable, init_type: InitType::Object, message: OBJECT_ASSIGN, method: None });
    }
    let variable = object.as_ident()?;
    let (init_type, message, method) = match method_name.bytes() {
        b"push" | b"unshift" if !args.is_empty() => (InitType::Array, ARRAY_MUTATION, Some(method_name)),
        b"add" if args.len() == 1 && !args.iter().any(is_spread) => (InitType::Set, SET_ADD, None),
        b"set" if args.len() == 2 && !args.iter().any(is_spread) => (InitType::Map, MAP_SET, None),
        _ => return None,
    };
    (!references(variable)).then_some(Mutation { variable, init_type, message, method })
}

/// `obj.a = value`, `obj[a] = value`
fn property_assignment<'a>(target: Expr<'a>, value: Expr<'a>) -> Option<Mutation<'a>> {
    if target.is_private_member() {
        return None;
    }
    let variable = get_inner_expression(target.object()?).as_ident()?;
    let is_self_reference = target.index().is_some_and(|it| expression_references_variable(it, variable))
        || expression_references_variable(value, variable);
    (!is_self_reference).then_some(Mutation { variable, init_type: InitType::Object, message: OBJECT_PROPERTY, method: None })
}

/// The variable that `prev_stmt` gives a new array, object, set or map.
fn get_prev_declaration(prev_stmt: Stmt<'_>) -> Option<(Name<'_>, InitType)> {
    match prev_stmt.kind() {
        // The last declarator only. An exported declaration is another kind of statement for oxlint.
        StmtKind::Var(declarations) if !prev_stmt.is_exported() => {
            let declarator = declarations.last()?;
            Some((declarator.pat().as_ident()?, get_expression_init_type(declarator.init()?)?))
        }
        // `foo = [1, 2]`
        StmtKind::Expr(e) if !e.is_parenthesized() => match e.kind() {
            ExprKind::Assign { op: None, target, value } => Some((target.as_ident()?, get_expression_init_type(value)?)),
            _ => None,
        },
        _ => None,
    }
}

fn get_expression_init_type(expr: Expr) -> Option<InitType> {
    match get_inner_expression(expr).kind() {
        ExprKind::Array(_) => Some(InitType::Array),
        ExprKind::Object(_) => Some(InitType::Object),
        ExprKind::New(new_expr) => {
            let callee = get_inner_expression(new_expr.callee());
            let init_type = match callee.as_ident()?.bytes() {
                b"Set" | b"WeakSet" => InitType::Set,
                b"Map" | b"WeakMap" => InitType::Map,
                _ => return None,
            };
            is_global_reference(callee).then_some(init_type)
        }
        _ => None,
    }
}

/// Whether the name `var_name` is in `expr`, where oxlint looks: not in an optional chain, a spread argument, a class, JSX, nor in the
/// statements of a function but for the expressions and what is returned at its top level.
fn expression_references_variable<'a>(expr: Expr<'a>, var_name: Name<'a>) -> bool {
    let mut pending: SmallVec<[Expr<'a>; 16]> = smallvec![expr];
    while let Some(e) = pending.pop() {
        let Some(e) = get_inner_expression_unless_chain(e) else {
            continue;
        };
        match e.kind() {
            ExprKind::Ident(name) if name == var_name => return true,
            ExprKind::Dot { obj, .. } if !e.is_private_member() => pending.push(obj),
            ExprKind::Index { obj, index, .. } => pending.extend([obj, index]),
            ExprKind::Call(call) | ExprKind::New(call) => {
                pending.push(call.callee());
                pending.extend(call.args().iter().filter(|it| !is_spread(*it)));
            }
            ExprKind::TaggedTemplate(call) => {
                pending.push(call.callee());
                pending.extend(call.template());
            }
            ExprKind::Array(elements) => {
                pending.extend(elements.iter().map(|it| it.operand().filter(|_| is_spread(it)).unwrap_or(it)));
            }
            ExprKind::Object(properties) => {
                for property in properties {
                    pending.extend(property.value());
                    if let Some(KeyKind::Computed(key)) = property.key().map(Key::kind) {
                        pending.push(key);
                    }
                }
            }
            ExprKind::Fn(func) => {
                let is_shadowed = func.params().iter().any(|it| !it.is_rest() && it.pat().as_ident() == Some(var_name));
                match func.body() {
                    _ if is_shadowed => {}
                    FnBody::Expr(body) => pending.push(body),
                    FnBody::Block(statements) => pending.extend(statements.iter().filter_map(|it| match it.kind() {
                        StmtKind::Expr(e) => Some(e),
                        StmtKind::Return(argument) => argument,
                        _ => None,
                    })),
                    FnBody::None => {}
                }
            }
            ExprKind::Assign { target, value, .. } => {
                pending.push(value);
                if matches!(target.tag(), ExprTag::Ident | ExprTag::Dot | ExprTag::Index) {
                    pending.push(target);
                }
            }
            ExprKind::Cond { test, yes, no } => pending.extend([test, yes, no]),
            ExprKind::Binary { left, right, .. } if left.tag() != ExprTag::PrivateIdentifier => pending.extend([left, right]),
            ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, operand } => {
                if operand.as_ident() == Some(var_name) {
                    return true;
                }
            }
            ExprKind::Unary { operand, .. } | ExprKind::Await(operand) => pending.push(operand),
            ExprKind::Template(template) => pending.extend(template.exprs()),
            ExprKind::Yield { value, .. } => pending.extend(value),
            _ => {}
        }
    }
    false
}
