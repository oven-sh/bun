//! typescript-eslint's `util/explicitReturnTypeUtils.ts`.
//!
//! Every function takes the [`Func`] of an arrow function, a function expression (which in ESTree
//! includes the value of a method or an accessor) or a function declaration, with a body.

use super::estree::is_expression_statement;
use crate::ast::{
    Expr, ExprKind, ExprTag, Flags, FnBody, Func, Member, MemberKind, Node, Prop, PropKind, Stmt,
    StmtTag,
};
use crate::span::Span;
use crate::utils::ast_utils::is_property_definition;
use crate::utils::ts_utils::get_function_head_loc;

/// typescript-eslint's `FunctionInfo`. A function's `return` statements are [`Func::returns`], so
/// no rule has to collect them, and the info is just the function.
pub type FunctionInfo<'a> = Func<'a>;

/// typescript-eslint's `Options` of `explicitReturnTypeUtils`: the options shared by
/// `explicit-function-return-type` and `explicit-module-boundary-types`. An option that a rule
/// doesn't have is `false`.
#[derive(Copy, Clone, Debug, Default)]
pub struct ReturnTypeOptions {
    pub allow_direct_const_assertion_in_arrow_functions: bool,
    pub allow_expressions: bool,
    pub allow_higher_order_functions: bool,
    pub allow_typed_function_expressions: bool,
}

/// An expression's ESTree parent, as far as this module distinguishes them.
#[derive(Copy, Clone)]
enum Parent<'a> {
    /// `TSAsExpression`, `TSTypeAssertion`
    TypeAssertion,
    VariableDeclarator {
        is_typed: bool,
    },
    /// A parameter's default.
    AssignmentPattern {
        is_typed: bool,
    },
    PropertyDefinition {
        is_typed: bool,
    },
    MethodDefinition(Member<'a>),
    CallExpression {
        is_callee: bool,
    },
    NewExpression,
    /// `JSXExpressionContainer`, `JSXSpreadAttribute`
    Jsx,
    /// In an object literal.
    Property(Prop<'a>),
    ExportDefaultDeclaration,
    ReturnStatement(Stmt<'a>),
    /// The expression is the body of this arrow function.
    ArrowFunctionExpression(Func<'a>),
    Other,
}

fn parent_of_expr(e: Expr<'_>) -> Parent<'_> {
    if e.jsx_container_span().is_some() {
        return Parent::Jsx;
    }
    match e.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::As { .. } | ExprKind::AsConst(_) => Parent::TypeAssertion,
            ExprKind::Call(call) => Parent::CallExpression {
                is_callee: call.callee() == e,
            },
            ExprKind::New(_) => Parent::NewExpression,
            _ => Parent::Other,
        },
        Node::VarDecl(declaration) => Parent::VariableDeclarator {
            is_typed: declaration.ty().is_some(),
        },
        Node::Param(param) if param.default() == Some(e) => Parent::AssignmentPattern {
            is_typed: param.ty().is_some(),
        },
        Node::Member(member) if member.decorators().any(|decorator| decorator == e) => {
            Parent::Other
        }
        Node::Member(member) if is_property_definition(member) => Parent::PropertyDefinition {
            is_typed: member.ty().is_some(),
        },
        Node::Member(member) => parent_of_method(member),
        Node::Prop(prop) => match (prop.parent(), prop.kind()) {
            (Node::Expr(owner), PropKind::Spread) if matches!(owner.tag(), ExprTag::Jsx) => {
                Parent::Jsx
            }
            (Node::Expr(owner), kind)
                if kind != PropKind::Spread && matches!(owner.tag(), ExprTag::Object) =>
            {
                Parent::Property(prop)
            }
            _ => Parent::Other,
        },
        Node::Stmt(parent) => match parent.tag() {
            StmtTag::Return => Parent::ReturnStatement(parent),
            StmtTag::ExportDefault => Parent::ExportDefaultDeclaration,
            _ => Parent::Other,
        },
        Node::Func(func) if func.is_arrow() => Parent::ArrowFunctionExpression(func),
        _ => Parent::Other,
    }
}

fn parent_of_method(member: Member<'_>) -> Parent<'_> {
    let is_method = matches!(
        member.kind(),
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor
    );
    match is_method
        && !member.flags().contains(Flags::ABSTRACT)
        && matches!(member.parent(), Node::Class(_))
    {
        true => Parent::MethodDefinition(member),
        false => Parent::Other,
    }
}

fn parent_of(func: Func<'_>) -> Parent<'_> {
    match func.owner() {
        Node::Expr(e) => parent_of_expr(e),
        Node::Member(member) => parent_of_method(member),
        _ => Parent::Other,
    }
}

/// `is_function`: the parent is a function's parent. A function that's the callee isn't an
/// argument.
fn is_typed_parent(parent: Parent, is_function: bool) -> bool {
    match parent {
        Parent::TypeAssertion | Parent::Jsx => true,
        Parent::VariableDeclarator { is_typed }
        | Parent::AssignmentPattern { is_typed }
        | Parent::PropertyDefinition { is_typed } => is_typed,
        Parent::CallExpression { is_callee } => !(is_function && is_callee),
        _ => false,
    }
}

/// `const x: Foo = { bar: { prop: () => {} } }`
fn is_property_of_object_with_type(mut parent: Parent) -> bool {
    while let Parent::Property(prop) = parent
        && let Node::Expr(object) = prop.parent()
    {
        parent = parent_of_expr(object);
        if is_typed_parent(parent, false) {
            return true;
        }
    }
    false
}

/// typescript-eslint's `doesImmediatelyReturnFunctionExpression`: `() => () => ..`, or the function
/// has at least one `return` and every `return` returns a function.
pub fn does_immediately_return_function_expression(func: FunctionInfo) -> bool {
    if func.is_arrow()
        && let FnBody::Expr(body) = func.body()
        && body.as_fn().is_some()
    {
        return true;
    }
    let mut returns = func.returns().peekable();
    returns.peek().is_some()
        && returns.all(|statement| {
            matches!(statement.as_return(), Some(Some(value)) if value.as_fn().is_some())
        })
}

/// typescript-eslint's `isTypedFunctionExpression`: with `allowTypedFunctionExpressions`, the
/// function expression gets a type from its context.
pub fn is_typed_function_expression(func: Func, options: ReturnTypeOptions) -> bool {
    if !options.allow_typed_function_expressions {
        return false;
    }
    let parent = parent_of(func);
    is_typed_parent(parent, true)
        || is_property_of_object_with_type(parent)
        || matches!(parent, Parent::NewExpression)
}

/// typescript-eslint's `isValidFunctionExpressionReturnType`: the function expression is typed, or
/// the options allow it to omit the return type.
pub fn is_valid_function_expression_return_type(func: Func, options: ReturnTypeOptions) -> bool {
    if is_typed_function_expression(func, options) {
        return true;
    }
    if options.allow_expressions
        && !matches!(
            parent_of(func),
            Parent::VariableDeclarator { .. }
                | Parent::MethodDefinition(_)
                | Parent::ExportDefaultDeclaration
                | Parent::PropertyDefinition { .. }
        )
    {
        return true;
    }
    if !options.allow_direct_const_assertion_in_arrow_functions || !func.is_arrow() {
        return false;
    }
    let FnBody::Expr(mut body) = func.body() else {
        return false;
    };
    while let Some((expr, _)) = body.as_satisfies() {
        body = expr;
    }
    matches!(body.tag(), ExprTag::AsConst)
}

fn is_valid_function_return_type(func: FunctionInfo, options: ReturnTypeOptions) -> bool {
    if options.allow_higher_order_functions && does_immediately_return_function_expression(func) {
        return true;
    }
    func.return_type().is_some()
        || match parent_of(func) {
            // `static constructor() {}` is a method.
            Parent::MethodDefinition(member) => match member.kind() {
                MemberKind::Constructor => !member.is_static(),
                kind => kind == MemberKind::Setter,
            },
            Parent::Property(prop) => prop.kind() == PropKind::Setter,
            _ => false,
        }
}

/// typescript-eslint's `checkFunctionReturnType`. Calls `report` with the function's
/// `getFunctionHeadLoc` if it needs a return type and has none.
pub fn check_function_return_type(
    func: FunctionInfo,
    options: ReturnTypeOptions,
    report: impl FnOnce(Span),
) {
    if !is_valid_function_return_type(func, options) {
        report(get_function_head_loc(func));
    }
}

/// typescript-eslint's `checkFunctionExpressionReturnType`:
/// [`is_valid_function_expression_return_type`], then [`check_function_return_type`].
pub fn check_function_expression_return_type(
    func: FunctionInfo,
    options: ReturnTypeOptions,
    report: impl FnOnce(Span),
) {
    if !is_valid_function_expression_return_type(func, options) {
        check_function_return_type(func, options, report);
    }
}

/// typescript-eslint's `ancestorHasReturnType`: the function is returned from a function that has a
/// return type, or from one that initializes a typed variable or class property.
pub fn ancestor_has_return_type(func: Func) -> bool {
    let is_concise_arrow = |f: &Func| f.is_arrow() && matches!(f.body(), FnBody::Expr(_));
    let first = match parent_of(func) {
        // Upstream continues from the property's value, which is the function itself.
        Parent::Property(prop) => match prop.value().and_then(Expr::as_fn) {
            Some(value) if is_concise_arrow(&value) => Node::Func(value),
            _ => return false,
        },
        Parent::ReturnStatement(statement) => Node::Stmt(statement),
        Parent::ArrowFunctionExpression(arrow) if is_concise_arrow(&arrow) => Node::Func(arrow),
        _ => return false,
    };
    for ancestor in std::iter::once(first).chain(first.ancestors()) {
        match ancestor {
            Node::Func(f) if f.return_type().is_some() => return true,
            Node::VarDecl(declaration) => return declaration.ty().is_some(),
            Node::Member(member) if is_property_definition(member) => return member.ty().is_some(),
            Node::Stmt(statement) if is_expression_statement(statement) => return false,
            _ => {}
        }
    }
    false
}
