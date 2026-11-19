//! The helpers that oxlint's rules are written with, ported to our AST handles: its `ast_util.rs`, the `oxc_ast` and
//! `LintContext` methods the rules call most, and the `utils` functions shared by more than one plugin. Each function
//! keeps its oxlint name.
//!
//! Two of oxc's node kinds aren't nodes in our tree:
//! - `ParenthesizedExpression`. `without_parentheses()` is a no-op here. Where an oxlint rule matches on an
//!   expression's kind without first calling it or `get_inner_expression()`, a parenthesized expression doesn't match,
//!   so the port checks `!e.is_parenthesized()`.
//! - `ChainExpression`, which wraps a whole optional chain. The port checks `e.is_chain_root()`.

use bun_core::strings;
use bun_lint::prelude::*;

/// `Expression::get_inner_expression`: strips `as T`, `satisfies T`, `!`, a leading `<T>` and a trailing `<T>`. It
/// doesn't look inside a `ChainExpression`, so `a?.b!` is returned unchanged.
#[inline]
pub fn get_inner_expression(e: Expr<'_>) -> Expr<'_> {
    match is_type_wrapper(e) {
        true => without_type_wrappers(e),
        false => e,
    }
}

#[inline]
fn is_type_wrapper(e: Expr) -> bool {
    matches!(
        e.tag(),
        ExprTag::As
            | ExprTag::AsConst
            | ExprTag::Satisfies
            | ExprTag::NonNull
            | ExprTag::Instantiation
    )
}

#[inline(never)]
fn without_type_wrappers(e: Expr<'_>) -> Expr<'_> {
    let mut at = e;
    while is_type_wrapper(at)
        && !at.is_chain_root()
        && let Some(operand) = at.operand()
    {
        at = operand;
    }
    at
}

/// `e.get_inner_expression()`, if that isn't a `ChainExpression`.
#[inline]
pub fn get_inner_expression_unless_chain(e: Expr<'_>) -> Option<Expr<'_>> {
    Some(get_inner_expression(e)).filter(|it| !it.is_chain_root())
}

/// True if `e` is neither parenthesized nor a whole optional chain.
fn is_plain(e: Expr) -> bool {
    !e.is_parenthesized() && !e.is_chain_root()
}

/// Returns `e` if oxlint sees the same node kind that we do, which means it's neither parenthesized nor a whole
/// optional chain.
#[inline]
pub fn plain(e: Expr<'_>) -> Option<Expr<'_>> {
    is_plain(e).then_some(e)
}

/// `e`'s parent in oxc's tree, if it's also a node in ours. `None` if it's a `ParenthesizedExpression` or a
/// `ChainExpression`.
#[inline]
pub fn parent_node(e: Expr<'_>) -> Option<Node<'_>> {
    is_plain(e).then(|| e.parent())
}

/// `Expression::as_member_expression`: `e` if it's a `Dot` or an `Index`, and neither parenthesized nor a whole
/// optional chain.
#[inline]
pub fn as_member_expression(e: Expr<'_>) -> Option<Expr<'_>> {
    (matches!(e.tag(), ExprTag::Dot | ExprTag::Index) && is_plain(e)).then_some(e)
}

/// `Expression::is_null_or_undefined`
pub fn is_null_or_undefined(e: Expr) -> bool {
    !e.is_parenthesized()
        && (e.tag() == ExprTag::Null || e.is_ident("undefined") || e.unary_op() == Some(UnOp::Void))
}

/// `Expression::CallExpression`
#[inline]
pub fn as_call_expression(e: Expr<'_>) -> Option<Call<'_>> {
    e.as_call().filter(|_| is_plain(e))
}

/// `Expression::FunctionExpression` or `Expression::ArrowFunctionExpression`
#[inline]
pub fn as_function_expression(e: Expr<'_>) -> Option<Func<'_>> {
    e.as_fn().filter(|_| !e.is_parenthesized())
}

/// `Expression::ObjectExpression`: the properties, if `e` is an object literal that isn't parenthesized.
#[inline]
pub fn as_object_expression(e: Expr<'_>) -> Option<List<'_, Prop<'_>>> {
    e.as_object().filter(|_| !e.is_parenthesized())
}

/// `Expression::is_specific_id`
#[inline]
pub fn is_specific_id(e: Expr, name: &str) -> bool {
    get_inner_expression(e).is_ident(name)
}

/// The value of a string, or of a template without substitutions.
pub fn static_string(e: Expr<'_>) -> Option<Name<'_>> {
    match e.as_string() {
        Some(value) => Some(value),
        None => e.as_template()?.as_static(),
    }
}

/// `Expression::get_member_expr`: `e` if it's a `Dot` or an `Index`, optional or not.
#[inline]
pub fn get_member_expr(e: Expr<'_>) -> Option<Expr<'_>> {
    Some(get_inner_expression(e)).filter(|it| matches!(it.tag(), ExprTag::Dot | ExprTag::Index))
}

/// The `"b"` in `a["b"]` or the `` `b` `` in `` a[`b`] ``, and its value.
fn static_index(member: Expr<'_>) -> Option<(Expr<'_>, Name<'_>)> {
    let index = member.index().filter(|it| !it.is_parenthesized())?;
    Some((index, static_string(index)?))
}

/// `MemberExpression::static_property_info`: the property name's span and the name. `None` for `a.#b`.
pub fn static_property_info(member: Expr<'_>) -> Option<(Span, Name<'_>)> {
    match member.member_name() {
        Some(name) => (!member.is_private_member()).then(|| (name.span(), name.name())),
        None => static_index(member).map(|(index, name)| (index.span(), name)),
    }
}

/// `MemberExpression::static_property_name`
#[inline]
pub fn static_property_name(member: Expr<'_>) -> Option<Name<'_>> {
    match member.member_name() {
        Some(name) => (!member.is_private_member()).then(|| name.name()),
        None => static_index(member).map(|it| it.1),
    }
}

/// The full `MemberExpression::static_property_name`, where the name of `a[/b/]` is `/b/`. Use it where names are
/// compared with each other.
pub fn static_property_name_or_regex(member: Expr<'_>) -> Option<&[u8]> {
    match member
        .index()
        .filter(|it| it.tag() == ExprTag::Regex && !it.is_parenthesized())
    {
        Some(regex) => Some(regex.text()),
        None => static_property_name(member).map(Name::bytes),
    }
}

/// `CallExpression::callee_name`: the `a` in `a()`, `b.a()` and `b["a"]()`
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

#[inline]
fn has_arg_count(call: Call, min_arg_count: Option<usize>, max_arg_count: Option<usize>) -> bool {
    let count = call.args().len();
    min_arg_count.is_none_or(|min| count >= min) && max_arg_count.is_none_or(|max| count <= max)
}

/// `objects` lists the identifiers the method may be called on. `None` allows any object.
#[inline(always)]
pub fn is_method_call(
    call: Call,
    objects: Option<&[&str]>,
    methods: Option<&[&str]>,
    min_arg_count: Option<usize>,
    max_arg_count: Option<usize>,
) -> bool {
    has_arg_count(call, min_arg_count, max_arg_count) && calls_method_of(call, objects, methods)
}

#[inline(never)]
fn calls_method_of(call: Call, objects: Option<&[&str]>, methods: Option<&[&str]>) -> bool {
    get_member_expr(call.callee()).is_some_and(|it| is_method_of(it, objects, methods))
}

/// True if `member`, a `Dot` or an `Index`, accesses one of `methods` on one of `objects`.
#[inline]
fn is_method_of(member: Expr, objects: Option<&[&str]>, methods: Option<&[&str]>) -> bool {
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

/// `new_expr` must come from a `New` expression.
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

/// The called method's name span and name.
pub fn call_expr_method_callee_info(call: Call<'_>) -> Option<(Span, Name<'_>)> {
    let callee = get_inner_expression(call.callee());
    // A `ChainExpression` isn't a member expression.
    if callee.is_chain_root() {
        return None;
    }
    static_property_info(callee)
}

/// `IdentifierReference::is_global_reference`: an identifier that nothing in the file declares.
pub fn is_global_reference(e: Expr) -> bool {
    e.tag() == ExprTag::Ident && symbol_of(e).is_none()
}

/// The variable that `ident`, an identifier in value position, refers to. In oxc that's never a type-only declaration:
/// an interface, a type alias or an `import type` binding.
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

/// `Expression::is_global_reference_name`. A parenthesized identifier doesn't count as an identifier in oxc.
pub fn is_global_reference_name(e: Expr, name: &str) -> bool {
    e.is_ident(name) && !e.is_parenthesized() && symbol_of(e).is_none()
}

/// `ctx.globals().get(name)`: the config's setting for a global variable.
fn configured_global(file: &File, name: &[u8]) -> Option<Global> {
    let globals = &file.language().globals;
    globals
        .binary_search_by(|it| (*it.0).cmp(name))
        .ok()
        .and_then(|at| globals.get(at))
        .map(|it| it.1)
}

/// `ctx.globals().get(name) == Some(GlobalValue::Off)`: the config turns this global variable off.
pub fn is_global_turned_off(file: &File, name: &str) -> bool {
    configured_global(file, name.as_bytes()) == Some(Global::Off)
}

/// `ctx.globals().is_enabled(name)`: the config's `globals` has a variable with that name. Globals defined by an `env`
/// don't count.
pub fn is_enabled_global(file: &File, name: &[u8]) -> bool {
    file.language().is_enabled_own_global(name)
}

/// `LintContext::is_reference_to_global_variable`: nothing in the file declares it, and the config doesn't turn it off.
pub fn is_reference_to_global_variable(ident: Expr) -> bool {
    is_global_reference(ident)
        && ident
            .as_ident()
            .and_then(|name| configured_global(ident.file(), name.bytes()))
            != Some(Global::Off)
}

/// The first declaration of the variable that the identifier `ident` refers to.
pub fn get_declaration_of_variable(ident: Expr<'_>) -> Option<Declaration<'_>> {
    symbol_of(ident)?.declarations().next()
}

/// The initializer of the `const` that the identifier `ident` refers to.
pub fn get_const_variable_initializer(ident: Expr<'_>) -> Option<Expr<'_>> {
    let Declaration::Var(pat) = get_declaration_of_variable(ident)? else {
        return None;
    };
    let Node::VarDecl(declarator) = pat.parent() else {
        return None;
    };
    declarator
        .init()
        .filter(|_| declarator.var_kind() == VarKind::Const)
}

/// `iter_outer_expressions`: `e`'s ancestors from the inside out, without the wrappers that [`get_inner_expression`]
/// strips.
pub fn iter_outer_expressions(e: Expr<'_>) -> impl Iterator<Item = Node<'_>> {
    Node::Expr(e).ancestors().filter(|it| {
        !matches!(it, Node::Expr(e) if matches!(
            e.tag(),
            ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies | ExprTag::NonNull | ExprTag::Instantiation
        ))
    })
}

/// True if `e` is the expression of a decorator `@e` on a class, a class member or a parameter. Decorators come before
/// everything else in their parent.
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

/// If `parent` creates the `oxc_semantic` scope that its child `child` is in, returns the node that owns the scope.
/// Every block and every `for` creates one. Use it to walk up to the innermost scope around a node.
pub fn scope_owner<'a>(child: Node<'a>, parent: Node<'a>) -> Option<Node<'a>> {
    match parent {
        Node::Func(_) => Some(parent),
        // All cases of a `switch` share one scope. The discriminant is outside it.
        Node::Case(_) => Some(parent.parent()),
        Node::Class(_) => {
            (!matches!(child, Node::Expr(e) if is_decorator_expression(e))).then_some(parent)
        }
        Node::Stmt(statement) => match statement.tag() {
            StmtTag::For | StmtTag::ForIn | StmtTag::ForOf | StmtTag::Module | StmtTag::Enum => {
                Some(parent)
            }
            StmtTag::Block => match statement.kind() {
                StmtKind::With { object, .. } => (Node::Expr(object) != child).then_some(parent),
                _ => Some(parent),
            },
            _ => None,
        },
        _ => None,
    }
}

/// True if the identifier `ident` refers to the binding of `import { imported_name } from "module_name"`, whatever its
/// local name.
pub fn is_import_symbol(ident: Expr, module_name: &str, imported_name: &str) -> bool {
    matches!(get_declaration_of_variable(ident), Some(Declaration::ImportSpec(specifier))
        if specifier.import().spec().is(module_name) && specifier.imported().name().is(imported_name))
}

/// True if the identifier `ident` refers to anything imported from `module_name`: a named, default or namespace import.
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

/// `PropertyKey::static_name`, for comparing with a property name. Returns the name of `a`, `"a"`, `["a"]` and `` [`a`]
/// ``, but not of `#a`.
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

/// True if the name starts with an ASCII capital letter.
pub fn is_react_component_name(name: &[u8]) -> bool {
    name.first().is_some_and(u8::is_ascii_uppercase)
}

/// True for `use`, or `use` followed by a capital letter or a digit.
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

/// True if replacing `node` with text that starts with `[`, `(`, `/`, `+`, `-` or a backtick would continue the
/// previous statement.
pub fn could_be_asi_hazard(node: Expr) -> bool {
    let start = node.span().start;
    let mut statement = None;
    for ancestor in Node::Expr(node).ancestors() {
        match ancestor {
            Node::Stmt(stmt) if stmt.tag() == StmtTag::Expr => {
                statement = Some(stmt);
                break;
            }
            // Expressions that can start with the node.
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

/// `get_precedence` in `utils/unicorn.rs`, with the numbers of `oxc_syntax::precedence::Precedence`. `None` means it
/// never needs parentheses, which includes a parenthesized expression and a whole optional chain.
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
