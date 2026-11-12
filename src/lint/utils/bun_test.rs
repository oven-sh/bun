//! What `bun test` does with some calls on `jest`, `vi` and `vitest` depends on how the file gets the object. If the
//! object is a global or a named import from `bun:test`, `vitest` or `@jest/globals`, `bun test`
//! - moves a top-level `jest.mock()`, `jest.unmock()` or `vi.hoisted()` above the rest of the file,
//! - keeps the caller's frame for `return jest.requireActual()`, which finds the caller's file in it,
//! - reads the path from `vi.doMock(import("./a"))`.
//!
//! It does none of that if the object comes from `require()` or from another module, or is a member of a namespace
//! import. `P::mock_api`, `is_hoisted_mock_stmt`, `reads_frame_of_caller` and `visit_import_in_mock_path` in
//! `src/js_parser/lower/hoist_test_mocks.rs` decide it, and the lists here are theirs.
//!
//! So a fix that moves one of these names from one group to the other changes what the tests do, if the file has such
//! a call. These functions find one, for [`Report::fix_where_safe`].
//!
//! [`Report::fix_where_safe`]: crate::context::Report::fix_where_safe

use crate::ast::{
    BinOp, Chain, Expr, ExprKind, ExprTag, File, Flags, FnBody, Node, PatTag, Stmt, StmtKind,
    StmtTag, UnOp, VarKind,
};
use crate::semantic::{Declaration, Reference, Symbol};
use crate::utils::ast_utils::get_static_property_name;
use std::borrow::Cow;

/// `bun:test`, `vitest` and `@jest/globals`.
pub use bun_ast::import_record::is_test_module;

/// The exports of a test module that have such calls.
pub const MOCK_APIS: [&str; 3] = ["jest", "vi", "vitest"];

/// `MockApi`
#[derive(Clone, Copy, PartialEq, Eq)]
enum Api {
    Jest,
    Vi,
}

impl Api {
    fn of(export: &[u8]) -> Option<Api> {
        match export {
            b"jest" => Some(Api::Jest),
            b"vi" | b"vitest" => Some(Api::Vi),
            _ => None,
        }
    }

    /// `is_hoisted_mock_stmt`
    fn hoists(self, method: &[u8]) -> bool {
        matches!(method, b"mock" | b"unmock") || (method == b"hoisted" && self == Api::Vi)
    }

    /// `reads_frame_of_caller`
    fn keeps_frame(self, method: &[u8]) -> bool {
        match method {
            b"mock" | b"doMock" | b"unmock" => true,
            b"doUnmock" | b"importActual" | b"importMock" => self == Api::Vi,
            b"dontMock" | b"requireActual" | b"requireMock" | b"createMockFromModule" => {
                self == Api::Jest
            }
            _ => false,
        }
    }

    /// `visit_import_in_mock_path`
    fn reads_path(method: &[u8]) -> bool {
        matches!(method, b"mock" | b"unmock" | b"doMock" | b"doUnmock")
    }
}

/// True if `name` is one of [`MOCK_APIS`].
pub fn is_mock_api(name: &[u8]) -> bool {
    Api::of(name).is_some()
}

/// True if `bun test` takes a named import of `imported` from `source` for one of [`MOCK_APIS`].
pub fn is_known_import(source: &[u8], imported: &[u8]) -> bool {
    is_test_module(source) && is_mock_api(imported)
}

/// True for a declaration that is gone when the file runs: `declare const vi: Vi`, a type, a type-only import.
fn is_erased(declaration: Declaration<'_>) -> bool {
    match declaration {
        Declaration::Var(pattern) => {
            matches!(pattern.parent(), Node::VarDecl(it) if it.flags().contains(Flags::AMBIENT))
        }
        Declaration::Fn(function) => !function.has_body(),
        Declaration::Interface(_) | Declaration::TypeAlias(_) | Declaration::TypeParam(_) => true,
        Declaration::ImportSpec(specifier) => {
            specifier.is_type_only() || specifier.import().is_type_only()
        }
        Declaration::ImportDefault(import) | Declaration::ImportNamespace(import) => {
            import.is_type_only()
        }
        _ => false,
    }
}

/// What `bun test` takes `name` for where it resolves to `symbol`. A name that nothing declares when the file runs is
/// the global.
fn api_of(name: &[u8], symbol: Option<Symbol<'_>>) -> Option<Api> {
    match symbol.and_then(|it| it.declarations().find(|it| !is_erased(*it))) {
        None => Api::of(name),
        Some(Declaration::ImportSpec(specifier)) => {
            let source = specifier.import().spec();
            Api::of(specifier.imported().bytes()).filter(|_| is_test_module(source.bytes()))
        }
        Some(_) => None,
    }
}

/// True if `bun test` takes `name` for one of [`MOCK_APIS`] where it resolves to `symbol`.
pub fn is_known(name: &[u8], symbol: Option<Symbol<'_>>) -> bool {
    api_of(name, symbol).is_some()
}

/// `e`, or the outermost type syntax around it: the `(e as T)!` of `e`. It is gone when the file runs.
fn with_type_syntax(e: Expr<'_>) -> Expr<'_> {
    let mut at = e;
    while let Node::Expr(parent) = at.parent()
        && is_type_syntax(parent)
    {
        at = parent;
    }
    at
}

fn without_type_syntax(e: Expr<'_>) -> Expr<'_> {
    let mut at = e;
    while is_type_syntax(at)
        && let Some(operand) = at.operand()
    {
        at = operand;
    }
    at
}

fn is_type_syntax(e: Expr<'_>) -> bool {
    matches!(
        e.tag(),
        ExprTag::As
            | ExprTag::AsConst
            | ExprTag::Satisfies
            | ExprTag::NonNull
            | ExprTag::Instantiation
    )
}

/// The call `object.method(..)` or `object["method"](..)`. The method is `None` if the key isn't a literal.
fn method_call<'a>(object: Expr<'a>) -> Option<(Option<Cow<'a, [u8]>>, Expr<'a>)> {
    let object = with_type_syntax(object);
    let Node::Expr(member) = object.parent() else {
        return None;
    };
    if member.object() != Some(object) || member.is_private_member() {
        return None;
    }
    let callee = with_type_syntax(member);
    let Node::Expr(call) = callee.parent() else {
        return None;
    };
    (call.as_call()?.callee() == callee).then(|| (get_static_property_name(member), call))
}

/// [`is_object_of_module_mock_call`]
fn is_object_of(object: Expr<'_>, api: Api) -> bool {
    let is_listed = |it: &[u8]| api.hoists(it) || api.keeps_frame(it) || Api::reads_path(it);
    method_call(object).is_some_and(|(method, _)| method.is_none_or(|it| is_listed(&it)))
}

/// [`has_module_mock_call`]
fn has_call<'a>(references: impl IntoIterator<Item = Reference<'a>>, api: Api) -> bool {
    let mut objects = references.into_iter().filter_map(Reference::expr);
    objects.any(|it| is_object_of(it, api))
}

/// True if `object` is the object of a module mock call: a call that `bun test` treats as the module says if it takes
/// `object` for `export`, one of [`MOCK_APIS`]. A method whose key isn't a literal can be any of them.
pub fn is_object_of_module_mock_call(object: Expr<'_>, export: &[u8]) -> bool {
    Api::of(export).is_some_and(|it| is_object_of(object, it))
}

/// True if one of `references` is the [object of a module mock call](is_object_of_module_mock_call).
pub fn has_module_mock_call<'a>(
    references: impl IntoIterator<Item = Reference<'a>>,
    export: &[u8],
) -> bool {
    Api::of(export).is_some_and(|it| has_call(references, it))
}

/// True if the global `name` is the [object of a module mock call](is_object_of_module_mock_call).
#[cold]
pub fn global_has_module_mock_call<'a>(file: &'a File<'a>, name: &[u8]) -> bool {
    has_module_mock_call(file.unresolved_references_to(name), name)
}

/// True if `bun test` treats a call on `symbol` in another way once nothing declares its name, which makes the name a
/// global: `const { vi } = require("vitest")` and `vi.mock("./a")` once a fix removes the declaration. Only a name
/// that [`is_mock_api`], or that is imported under such a name, can change.
#[cold]
pub fn changes_as_global(symbol: Symbol<'_>) -> bool {
    let name = symbol.name().bytes();
    let (before, after) = (api_of(name, Some(symbol)), Api::of(name));
    let mut apis = [before, after].into_iter().flatten();
    before != after && apis.any(|it| has_call(symbol.references(), it))
}

/// The identifier that a top-level statement starts with, if `bun test` moves the statement above the rest of the
/// file: `jest.mock("./a")`, `jest.mock("./a").unmock("./b")`, `const mocks = vi.hoisted(..)`, each also with `await`.
fn object_of_hoisted<'a>(statement: Stmt<'a>) -> Option<Expr<'a>> {
    let chain_of = |value: Expr<'a>| {
        let value = without_type_syntax(value);
        let mut call = match value.kind() {
            ExprKind::Await(awaited) => without_type_syntax(awaited),
            _ => value,
        };
        let mut last: Option<&[u8]> = None;
        loop {
            let callee = call.as_call().filter(|it| it.chain() == Chain::No)?;
            let callee = without_type_syntax(callee.callee());
            let (object, method, chain) = callee.as_dot()?;
            let method = method.bytes();
            // Like babel-jest, one call that isn't hoisted keeps the whole chain in place.
            let is_chain = last.is_some();
            if chain != Chain::No
                || callee.is_private_member()
                || (is_chain && !matches!(method, b"mock" | b"unmock"))
            {
                return None;
            }
            let last = *last.get_or_insert(method);
            let object = without_type_syntax(object);
            match object.tag() {
                ExprTag::Ident => return Some((object, last, is_chain)),
                ExprTag::Call => call = object,
                _ => return None,
            }
        }
    };
    let is_declaration = statement.tag() != StmtTag::Expr;
    let is_moved = |(object, method, is_chain): (Expr<'a>, &'a [u8], bool)| {
        let api = api_of(object.as_ident()?.bytes(), object.symbol())?;
        let is_hoisted = match is_declaration {
            true => method == b"hoisted" && api == Api::Vi,
            false => api.hoists(method),
        };
        (is_hoisted && (!is_chain || api == Api::Jest)).then_some(object)
    };
    match statement.kind() {
        StmtKind::Expr(value) => chain_of(value).and_then(is_moved),
        StmtKind::Var(declarations) => {
            let mut values = declarations.iter().filter_map(|it| {
                let is_using = matches!(it.var_kind(), VarKind::Using | VarKind::AwaitUsing);
                it.init().filter(|_| !is_using)
            });
            values.find_map(|it| chain_of(it).and_then(is_moved))
        }
        _ => None,
    }
}

/// `is_primitive_literal_declaration`: `bun test` moves `const a = "a"` along with the hoisted statements.
fn is_literal_declaration(statement: Stmt<'_>) -> bool {
    let is_literal = |value: Expr<'_>| {
        let value = without_type_syntax(value);
        match value.kind() {
            ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null => true,
            ExprKind::Template(template) => template.exprs().is_empty(),
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => matches!(
                without_type_syntax(operand).tag(),
                ExprTag::Number | ExprTag::BigInt
            ),
            ExprKind::Ident(name) => name.is("undefined") && value.symbol().is_none(),
            _ => false,
        }
    };
    let StmtKind::Var(declarations) = statement.kind() else {
        return false;
    };
    declarations.iter().all(|it| {
        matches!(it.var_kind(), VarKind::Const | VarKind::Let)
            && it.pat().tag() == PatTag::Ident
            && it.init().is_some_and(is_literal)
    })
}

/// True if `bun test` can make `call` the last call of a function, a tail call, which drops the function's frame:
/// the function returns `call`, or `call` initializes a variable that it returns. `bun test` writes the call in the
/// place of such a variable.
fn can_be_tail_call(call: Expr<'_>) -> bool {
    fn is_returned(value: Expr<'_>, variables: u8) -> bool {
        let mut value = with_type_syntax(value);
        loop {
            match value.parent() {
                Node::Expr(parent) => {
                    let ends_in_value = match parent.kind() {
                        ExprKind::Cond { yes, no, .. } => yes == value || no == value,
                        ExprKind::Binary {
                            op: BinOp::Comma | BinOp::And | BinOp::Or | BinOp::Nullish,
                            right,
                            ..
                        } => right == value,
                        _ => false,
                    };
                    if !ends_in_value {
                        return false;
                    }
                    value = with_type_syntax(parent);
                }
                Node::Stmt(statement) => return statement.tag() == StmtTag::Return,
                Node::Func(function) => {
                    return matches!(function.body(), FnBody::Expr(body) if body == value);
                }
                Node::VarDecl(declarator) => {
                    let variable = declarator.pat().symbol();
                    let Some(variable) = variable.filter(|_| declarator.init() == Some(value))
                    else {
                        return false;
                    };
                    let mut uses = variable.references().filter_map(Reference::expr);
                    return variables == 0 || uses.any(|it| is_returned(it, variables - 1));
                }
                _ => return false,
            }
        }
    }
    is_returned(call, 4)
}

/// True if the first argument of `call` is `import("./a")` or `await import("./a")`.
fn has_import_for_path(call: Expr<'_>) -> bool {
    let path = call.as_call().and_then(|it| it.args().first());
    path.map(without_type_syntax)
        .is_some_and(|it| match it.kind() {
            ExprKind::Await(awaited) => without_type_syntax(awaited).tag() == ExprTag::ImportCall,
            _ => it.tag() == ExprTag::ImportCall,
        })
}

/// True if `bun test` runs `file` in another way once `names`, which are globals of [`MOCK_APIS`], are names that a
/// `require()` in the file's first statement gives. Unlike [`global_has_module_mock_call`] it goes by where the calls
/// are. The file runs the same if
/// - every top-level `jest.mock()`, and every `const a = "a"`, which `bun test` moves with them, already stands above
///   the statements that stay in place,
/// - no call that reads the caller's frame can be the last call of a function,
/// - and no call has an `import()` for its path.
#[cold]
pub fn changes_once_required<'a>(file: &'a File<'a>, names: &[&str]) -> bool {
    if names.is_empty() {
        return false;
    }
    let changes = |name: &str| {
        let Some(api) = Api::of(name.as_bytes()) else {
            return false;
        };
        let globals = file.unresolved_references_to(name.as_bytes());
        let mut calls = globals.filter_map(Reference::expr).filter_map(method_call);
        calls.any(|(method, call)| {
            let is = |list: &dyn Fn(&[u8]) -> bool| method.as_deref().is_none_or(list);
            (is(&|it| api.keeps_frame(it)) && can_be_tail_call(call))
                || (is(&Api::reads_path) && has_import_for_path(call))
        })
    };
    if names.iter().any(|it| changes(it)) {
        return true;
    }

    // A function declaration is there before the first statement runs, and a type or a `declare` never runs.
    let runs_in_place = |it: &Stmt<'a>| {
        let never_runs = matches!(it.tag(), StmtTag::Interface | StmtTag::TypeAlias)
            || it.flags().contains(Flags::AMBIENT);
        it.directive().is_none() && !never_runs && !matches!(it.tag(), StmtTag::Fn | StmtTag::Empty)
    };
    let statements = || file.body().iter().filter(runs_in_place);
    let is_required = |object: Expr<'a>| {
        object.symbol().is_none() && object.as_ident().is_some_and(|it| it.is_any(names))
    };
    let (mut leaves, mut stays) = (false, false);
    for object in statements().filter_map(object_of_hoisted) {
        match is_required(object) {
            true => leaves = true,
            false => stays = true,
        }
    }
    if !leaves {
        return false;
    }
    // With a statement that stays hoisted, `bun test` still moves statements. It also turns the imports of a file
    // with a hoisted statement into `await import()`.
    if stays || file.has_stmts([StmtTag::Import]) {
        return true;
    }
    let is_moved = |it: &Stmt<'a>| object_of_hoisted(*it).is_some() || is_literal_declaration(*it);
    statements().skip_while(is_moved).any(|it| is_moved(&it))
}
