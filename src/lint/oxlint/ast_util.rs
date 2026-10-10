//! What the rules of oxlint are written with, on the handles: its `ast_util.rs`, the methods of `oxc_ast` and of
//! `LintContext` that they call most, and what the rules of more than one plugin take from its `utils`. Each function has
//! the name that it has there.
//!
//! Two kinds of node of oxc are not nodes here:
//! - `ParenthesizedExpression`. `without_parentheses()` is nothing here. Where a rule of oxlint looks at the kind of an expression
//!   and has not called it, nor `get_inner_expression()`, what is in parentheses does not match: `!e.is_parenthesized()`.
//! - `ChainExpression`, which is around the whole of an optional chain: `e.is_chain_root()`.

use bun_core::strings;
use bun_lint::prelude::*;

/// `Expression::get_inner_expression`: without the `as T`, `satisfies T`, `!`, `<T>` before and `<T>` after it. It does not look
/// into a `ChainExpression`: `a?.b!` stays what it is.
pub fn get_inner_expression(e: Expr<'_>) -> Expr<'_> {
    let mut at = e;
    while matches!(
        at.tag(),
        ExprTag::As
            | ExprTag::AsConst
            | ExprTag::Satisfies
            | ExprTag::NonNull
            | ExprTag::Instantiation
    ) && !at.is_chain_root()
        && let Some(operand) = at.operand()
    {
        at = operand;
    }
    at
}

/// `e.get_inner_expression()`, if that is not a `ChainExpression`.
pub fn get_inner_expression_unless_chain(e: Expr<'_>) -> Option<Expr<'_>> {
    Some(get_inner_expression(e)).filter(|it| !it.is_chain_root())
}

/// `e`, if for oxlint it is of the kind that it is here: it is neither in parentheses nor the whole of an optional
/// chain.
pub fn plain(e: Expr<'_>) -> Option<Expr<'_>> {
    Some(e).filter(|it| !it.is_parenthesized() && !it.is_chain_root())
}

/// What oxc has around `e`, if that is a node here: not parentheses and not a `ChainExpression`.
pub fn parent_node(e: Expr<'_>) -> Option<Node<'_>> {
    (!e.is_parenthesized() && !e.is_chain_root()).then(|| e.parent())
}

/// `Expression::as_member_expression`: `e` if it is a `Dot` or an `Index`. What is in parentheses is not, nor is the
/// whole of an optional chain.
pub fn as_member_expression(e: Expr<'_>) -> Option<Expr<'_>> {
    (matches!(e.tag(), ExprTag::Dot | ExprTag::Index)
        && !e.is_parenthesized()
        && !e.is_chain_root())
    .then_some(e)
}

/// `Expression::CallExpression`
pub fn as_call_expression(e: Expr<'_>) -> Option<Call<'_>> {
    e.as_call()
        .filter(|_| !e.is_parenthesized() && !e.is_chain_root())
}

/// `Expression::FunctionExpression` or `Expression::ArrowFunctionExpression`
pub fn as_function_expression(e: Expr<'_>) -> Option<Func<'_>> {
    e.as_fn().filter(|_| !e.is_parenthesized())
}

/// `Expression::ObjectExpression`: the properties, if it is an object literal that is not in parentheses.
pub fn as_object_expression(e: Expr<'_>) -> Option<List<'_, Prop<'_>>> {
    match e.kind() {
        ExprKind::Object(properties) if !e.is_parenthesized() => Some(properties),
        _ => None,
    }
}

/// `Expression::is_specific_id`
pub fn is_specific_id(e: Expr, name: &str) -> bool {
    get_inner_expression(e).is_ident(name)
}

/// The value of a string, or of a template without substitutions.
pub fn static_string(e: Expr<'_>) -> Option<Name<'_>> {
    match e.kind() {
        ExprKind::String(value) => Some(value),
        ExprKind::Template(template) => template.as_static(),
        _ => None,
    }
}

/// `Expression::get_member_expr`: the `Dot` or the `Index` that it is, optional or not.
pub fn get_member_expr(e: Expr<'_>) -> Option<Expr<'_>> {
    Some(get_inner_expression(e)).filter(|it| matches!(it.tag(), ExprTag::Dot | ExprTag::Index))
}

/// `MemberExpression::static_property_info`: where the name of the property is written, and the name. Nothing for `a.#b`.
pub fn static_property_info(member: Expr<'_>) -> Option<(Span, Name<'_>)> {
    match member.kind() {
        ExprKind::Dot { name, .. } if !member.is_private_member() => {
            Some((name.span(), name.name()))
        }
        ExprKind::Index { index, .. } if !index.is_parenthesized() => match index.kind() {
            ExprKind::String(value) => Some((index.span(), value)),
            ExprKind::Template(template) => Some((index.span(), template.as_static()?)),
            _ => None,
        },
        _ => None,
    }
}

/// `MemberExpression::static_property_name`
pub fn static_property_name(member: Expr<'_>) -> Option<Name<'_>> {
    static_property_info(member).map(|it| it.1)
}

/// `MemberExpression::static_property_name` in full: the name of `a[/b/]` is `/b/`. For where names are compared with
/// each other.
pub fn static_property_name_or_regex(member: Expr<'_>) -> Option<&[u8]> {
    match member
        .index()
        .filter(|it| it.tag() == ExprTag::Regex && !it.is_parenthesized())
    {
        Some(regex) => Some(regex.text()),
        None => static_property_name(member).map(Name::bytes),
    }
}

/// `CallExpression::callee_name`: the `a` of `a()`, `b.a()` and `b["a"]()`
pub fn callee_name(call: Call<'_>) -> Option<Name<'_>> {
    let callee = call.callee();
    match callee.as_ident() {
        Some(name) => (!callee.is_parenthesized()).then_some(name),
        None => as_member_expression(callee).and_then(static_property_name),
    }
}

/// `MemberExpression::is_computed`
pub fn is_computed(member: Expr) -> bool {
    member.tag() == ExprTag::Index
}

fn has_arg_count(call: Call, min_arg_count: Option<usize>, max_arg_count: Option<usize>) -> bool {
    let count = call.args().len();
    min_arg_count.is_none_or(|min| count >= min) && max_arg_count.is_none_or(|max| count <= max)
}

/// `objects`: the identifiers that the method is called on. `None`: whatever.
pub fn is_method_call(
    call: Call,
    objects: Option<&[&str]>,
    methods: Option<&[&str]>,
    min_arg_count: Option<usize>,
    max_arg_count: Option<usize>,
) -> bool {
    if !has_arg_count(call, min_arg_count, max_arg_count) {
        return false;
    }
    let Some(member) = get_member_expr(call.callee()) else {
        return false;
    };
    let is_on = |objects: &[&str]| {
        (member
            .object()
            .map(get_inner_expression)
            .and_then(Expr::as_ident))
        .is_some_and(|it| it.is_any(objects))
    };
    objects.is_none_or(is_on)
        && methods
            .is_none_or(|methods| static_property_name(member).is_some_and(|it| it.is_any(methods)))
}

/// `new_expr`: of a `New`.
pub fn is_new_expression(
    new_expr: Call,
    names: &[&str],
    min_arg_count: Option<usize>,
    max_arg_count: Option<usize>,
) -> bool {
    has_arg_count(new_expr, min_arg_count, max_arg_count)
        && new_expr
            .callee()
            .as_ident()
            .is_some_and(|it| it.is_any(names))
}

/// Where the name of the method that is called is written, and the name.
pub fn call_expr_method_callee_info(call: Call<'_>) -> Option<(Span, Name<'_>)> {
    let callee = get_inner_expression(call.callee());
    // A `ChainExpression` is not a member expression.
    if callee.is_chain_root() {
        return None;
    }
    static_property_info(callee)
}

/// `IdentifierReference::is_global_reference`: an identifier that nothing in the file declares.
pub fn is_global_reference(e: Expr) -> bool {
    e.tag() == ExprTag::Ident && symbol_of(e).is_none()
}

/// The variable that the identifier `ident`, which is a value, refers to. For oxc that is never what only declares a type: an
/// interface, a type alias, what `import type` imports.
pub fn symbol_of(ident: Expr<'_>) -> Option<Symbol<'_>> {
    let is_type_only = |symbol: &Symbol| match symbol.declarations().next() {
        Some(Declaration::ImportDefault(import) | Declaration::ImportNamespace(import)) => {
            import.is_type_only()
        }
        Some(Declaration::ImportSpec(specifier)) => {
            specifier.is_type_only() || specifier.import().is_type_only()
        }
        _ => !symbol.is_value_variable(),
    };
    ident.symbol().filter(|it| !is_type_only(it))
}

/// `Expression::is_global_reference_name`. What is in parentheses is not an identifier there.
pub fn is_global_reference_name(e: Expr, name: &str) -> bool {
    e.is_ident(name) && !e.is_parenthesized() && symbol_of(e).is_none()
}

/// `ctx.globals().get(name)`: what the configuration says about a global variable.
fn global_of_configuration(file: &File, name: &[u8]) -> Option<Global> {
    let globals = &file.language().globals;
    globals
        .binary_search_by(|it| (*it.0).cmp(name))
        .ok()
        .and_then(|at| globals.get(at))
        .map(|it| it.1)
}

/// `ctx.globals().get(name) == Some(GlobalValue::Off)`: the configuration says that there is no such global variable.
pub fn is_global_turned_off(file: &File, name: &str) -> bool {
    global_of_configuration(file, name.as_bytes()) == Some(Global::Off)
}

/// `ctx.globals().is_enabled(name)`: `globals` of the configuration has a variable of that name. What an `env` defines does not
/// count.
pub fn is_enabled_global(file: &File, name: &[u8]) -> bool {
    file.language().is_written_global(name)
}

/// `LintContext::is_reference_to_global_variable`: nothing in the file declares it, and the configuration does not turn it off.
pub fn is_reference_to_global_variable(ident: Expr) -> bool {
    is_global_reference(ident)
        && ident
            .as_ident()
            .and_then(|name| global_of_configuration(ident.file(), name.bytes()))
            != Some(Global::Off)
}

/// The first declaration of the variable that the identifier `ident` refers to.
pub fn get_declaration_of_variable(ident: Expr<'_>) -> Option<Declaration<'_>> {
    symbol_of(ident)?.declarations().next()
}

/// `iter_outer_expressions`: what it is part of, from the inside, without what [`get_inner_expression`] skips.
pub fn iter_outer_expressions(e: Expr<'_>) -> impl Iterator<Item = Node<'_>> {
    Node::Expr(e).ancestors().filter(|it| {
        !matches!(it, Node::Expr(e) if matches!(
            e.tag(),
            ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies | ExprTag::NonNull | ExprTag::Instantiation
        ))
    })
}

/// The `e` of `@e` before a class, a member of a class or a parameter. These come before all else that their parent has.
pub fn is_decorator_expression(e: Expr) -> bool {
    let modifiers = match e.parent() {
        Node::Class(class) => class.modifiers(),
        Node::Member(member) => member.modifiers(),
        Node::Param(param) => param.modifiers(),
        _ => return false,
    };
    modifiers
        .last()
        .is_some_and(|last| e.span().start < last.span().end)
}

/// What makes the scope of `oxc_semantic` that `child` is in, if its parent `parent` does. A block makes one, and every
/// `for`. For a walk to the innermost scope around a node.
pub fn scope_made_by<'a>(child: Node<'a>, parent: Node<'a>) -> Option<Node<'a>> {
    match parent {
        Node::Func(_) => Some(parent),
        // The cases of a `switch` are in one scope, what is switched on is not in it.
        Node::Case(_) => Some(parent.parent()),
        Node::Class(_) => {
            (!matches!(child, Node::Expr(e) if is_decorator_expression(e))).then_some(parent)
        }
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Block(_)
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::Module(_)
            | StmtKind::Enum(_) => Some(parent),
            StmtKind::With { object, .. } => (Node::Expr(object) != child).then_some(parent),
            _ => None,
        },
        _ => None,
    }
}

/// Whether the identifier `ident` refers to what `import { imported_name } from "module_name"` imports, under whatever
/// name.
pub fn is_import_symbol(ident: Expr, module_name: &str, imported_name: &str) -> bool {
    matches!(get_declaration_of_variable(ident), Some(Declaration::ImportSpec(specifier))
        if specifier.import().spec().is(module_name) && specifier.imported().name().is(imported_name))
}

/// Whether the identifier `ident` refers to something that is imported from `module_name`: a name, the default or the namespace.
pub fn is_import_from_module(ident: Expr, module_name: &str) -> bool {
    if !ident.file().mentions(module_name) {
        return false;
    }
    let import = match get_declaration_of_variable(ident) {
        Some(Declaration::ImportDefault(import) | Declaration::ImportNamespace(import)) => import,
        Some(Declaration::ImportSpec(specifier)) => specifier.import(),
        _ => return false,
    };
    import.spec().is(module_name)
}

/// `PropertyKey::static_name`, for a comparison with the name of a property: that of `a`, `"a"`, `["a"]`, `` [`a`] ``,
/// not of `#a`.
pub fn static_name(key: Key<'_>) -> Option<Name<'_>> {
    key.name().filter(|_| !key.is_private())
}

/// `AstKind::ObjectProperty`
pub fn as_object_property(node: Node<'_>) -> Option<Prop<'_>> {
    match node {
        Node::Prop(prop) if prop.kind() != PropKind::Spread && !prop.is_jsx_attribute() => {
            Some(prop)
        }
        _ => None,
    }
}

/// `AstKind::MethodDefinition`
pub fn as_method_definition(node: Node<'_>) -> Option<Member<'_>> {
    match node {
        Node::Member(member)
            if matches!(
                member.kind(),
                MemberKind::Method
                    | MemberKind::Getter
                    | MemberKind::Setter
                    | MemberKind::Constructor
            ) && !member.is_signature() =>
        {
            Some(member)
        }
        _ => None,
    }
}

/// `AstKind::PropertyDefinition`
pub fn as_property_definition(node: Node<'_>) -> Option<Member<'_>> {
    match node {
        Node::Member(member)
            if member.kind() == MemberKind::Property
                && !member.is_signature()
                && !member.flags().contains(Flags::ACCESSOR) =>
        {
            Some(member)
        }
        _ => None,
    }
}

/// `AstKind::Function` or `AstKind::ArrowFunctionExpression`
pub fn as_function(node: Node<'_>) -> Option<Func<'_>> {
    match node {
        Node::Func(func)
            if matches!(
                func.kind(),
                FnKind::Decl
                    | FnKind::Expr
                    | FnKind::Arrow
                    | FnKind::Method
                    | FnKind::Getter
                    | FnKind::Setter
                    | FnKind::Constructor
            ) && !matches!(func.owner(), Node::Member(member) if member.is_signature()) =>
        {
            Some(func)
        }
        _ => None,
    }
}

/// `JSXElementName::get_identifier_name`: the name of `<a>`, `<A>` and `<a-b>`. Not of `<a.b>`, `<a:b>` and `<this>`.
pub fn get_identifier_name(jsx: Jsx<'_>) -> Option<Name<'_>> {
    match jsx.tag()?.kind() {
        ExprKind::Ident(name) => Some(name),
        ExprKind::String(name) => Some(name).filter(|it| !strings::contains_char(it.bytes(), b':')),
        _ => None,
    }
}

/// A name that starts with a capital letter of ASCII.
pub fn is_react_component_name(name: &[u8]) -> bool {
    name.first().is_some_and(u8::is_ascii_uppercase)
}

/// `use`, or `use` and a capital letter or a digit.
fn is_react_hook_name(name: &[u8]) -> bool {
    name.strip_prefix(b"use")
        .is_some_and(|rest| match rest.first() {
            None => true,
            Some(first) if first.is_ascii() => first.is_ascii_uppercase() || first.is_ascii_digit(),
            Some(_) => strings::wtf8_first_codepoint(rest)
                .and_then(char::from_u32)
                .is_some_and(char::is_uppercase),
        })
}

/// `useState`, `React.useState`
pub fn is_react_hook(expr: Expr) -> bool {
    if expr.is_parenthesized() || expr.is_chain_root() {
        return false;
    }
    match expr.kind() {
        ExprKind::Dot { obj, name, .. } => {
            is_react_hook_name(name.bytes())
                && !obj.is_parenthesized()
                && obj
                    .as_ident()
                    .is_some_and(|it| is_react_component_name(it.bytes()))
        }
        ExprKind::Ident(name) => is_react_hook_name(name.bytes()),
        _ => false,
    }
}

/// Whether text that starts with `[`, `(`, `/`, `+`, `-` or a backtick, in the place
/// of `node`, would continue the statement before.
pub fn could_be_asi_hazard(node: Expr) -> bool {
    let start = node.span().start;
    let mut statement = None;
    for ancestor in Node::Expr(node).ancestors() {
        match ancestor {
            Node::Stmt(stmt) if stmt.tag() == StmtTag::Expr => {
                statement = Some(stmt);
                break;
            }
            // What can start with the node.
            Node::Expr(e) if e.outer_span().start == start => match e.tag() {
                ExprTag::Call
                | ExprTag::Index
                | ExprTag::Dot
                | ExprTag::TaggedTemplate
                | ExprTag::Binary
                | ExprTag::Assign
                | ExprTag::Cond
                | ExprTag::Await
                | ExprTag::As
                | ExprTag::AsConst
                | ExprTag::Satisfies
                | ExprTag::NonNull
                | ExprTag::Instantiation => {}
                _ => return false,
            },
            _ => return false,
        }
    }
    let Some(statement) = statement.filter(|it| it.span().start == start && start != 0) else {
        return false;
    };
    // The body of one of these follows a `)` or a keyword.
    let is_body = matches!(statement.parent(), Node::Stmt(parent) if matches!(
        parent.kind(),
        StmtKind::If { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::With { .. }
            | StmtKind::Labeled { .. }
    ));
    if is_body {
        return false;
    }
    let file = node.file();
    let before = file
        .text()
        .get(..file.end_of_token_before(start) as usize)
        .unwrap_or_default();
    let continuation_bytes = before
        .iter()
        .rev()
        .take(3)
        .take_while(|it| **it & 0xC0 == 0x80)
        .count();
    let last = before
        .get(before.len().saturating_sub(continuation_bytes + 1)..)
        .unwrap_or_default();
    std::str::from_utf8(last)
        .ok()
        .and_then(|it| it.chars().next())
        .is_some_and(|last| {
            matches!(
                last,
                ')' | ']' | '}' | '"' | '\'' | '`' | '+' | '-' | '/' | '.' | '_' | '$'
            ) || last.is_alphanumeric()
        })
}

/// `oxc_syntax::precedence::Precedence::Member`, as a number.
pub const PRECEDENCE_MEMBER: u8 = 22;
/// `Precedence::Exponentiation`
pub const PRECEDENCE_EXPONENTIATION: u8 = 17;

/// `get_precedence` of `utils/unicorn.rs`, with the numbers of `oxc_syntax::precedence::Precedence`. `None`: it never
/// needs parentheses. What is in parentheses and the whole of an optional chain are among these.
pub fn get_precedence(expr: Expr) -> Option<u8> {
    get_precedence_without_parentheses(expr).filter(|_| !expr.is_parenthesized())
}

/// `get_precedence(expr.without_parentheses())`
pub fn get_precedence_without_parentheses(expr: Expr) -> Option<u8> {
    if expr.is_chain_root() {
        return None;
    }
    Some(match expr.kind() {
        ExprKind::Binary { left, .. } if left.tag() == ExprTag::PrivateIdentifier => return None,
        ExprKind::Binary { op, .. } => match op {
            BinOp::Comma => 1,
            BinOp::Nullish => 6,
            BinOp::Or => 7,
            BinOp::And => 8,
            BinOp::BitOr => 9,
            BinOp::BitXor => 10,
            BinOp::BitAnd => 11,
            BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => 12,
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Instanceof | BinOp::In => 13,
            BinOp::Shl | BinOp::Shr | BinOp::UShr => 14,
            BinOp::Add | BinOp::Sub => 15,
            BinOp::Mul | BinOp::Div | BinOp::Rem => 16,
            BinOp::Pow => PRECEDENCE_EXPONENTIATION,
        },
        ExprKind::Yield { .. } => 3,
        ExprKind::Assign { .. } => 4,
        ExprKind::Cond { .. } => 5,
        ExprKind::Unary {
            op: UnOp::PostInc | UnOp::PostDec,
            ..
        } => 19,
        ExprKind::Unary { .. } | ExprKind::Await(_) => 18,
        ExprKind::New(_) | ExprKind::Call(_) => 21,
        ExprKind::Dot { .. } | ExprKind::Index { .. } => PRECEDENCE_MEMBER,
        ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. } => 0,
        ExprKind::Fn(func) if func.is_arrow() => 0,
        _ => return None,
    })
}
