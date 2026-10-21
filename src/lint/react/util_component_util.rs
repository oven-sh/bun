//! `lib/util/componentUtil.js` of eslint-plugin-react.
//!
//! A whole optional chain is treated as the `MemberExpression` or `CallExpression`, not as the
//! `ChainExpression` around it.

use crate::util_is_create_element::is_member_called;
use crate::util_pragma::{get_create_class_from_context, get_from_context, mentions_create_class};
use bun_core::strings;
use bun_lint::language::Parser;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_compat::{estree_parent, estree_span, normalize};

/// The values componentUtil.js memoizes per context.
#[derive(Copy, Clone)]
pub(crate) struct Pragmas<'a> {
    pub(crate) pragma: &'a [u8],
    pub(crate) create_class: &'a [u8],
}

impl<'a> Pragmas<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Pragmas<'a> {
        Pragmas {
            pragma: get_from_context(file),
            create_class: get_create_class_from_context(file),
        }
    }

    fn create_class_name(&self) -> &'a str {
        std::str::from_utf8(self.create_class).unwrap_or_default()
    }

    /// `object.name === pragma`
    fn is_pragma(&self, object: Expr<'_>) -> bool {
        object
            .as_ident()
            .is_some_and(|it| it.bytes() == self.pragma)
    }
}

/// An ESTree ancestor of an expression or statement. Upstream counts `.parent` steps, so nodes that
/// this AST doesn't have are represented too. Nodes inside types aren't counted the way ESTree has
/// them.
#[derive(Copy, Clone)]
enum Ancestor<'a> {
    /// A node that exists in this AST, [`normalize`]d.
    Node(Node<'a>),
    /// The `ChainExpression` around this expression.
    Chain(Expr<'a>),
    /// A node that this AST doesn't have: its start and its parent.
    Part(u32, Node<'a>),
}

impl<'a> Ancestor<'a> {
    /// A child of `parent` that this AST doesn't have and that starts at `start`, or `parent`
    /// itself if `start` is `None`.
    fn part(start: Option<u32>, parent: Node<'a>) -> Ancestor<'a> {
        match start {
            Some(start) => Ancestor::Part(start, parent),
            None => Ancestor::Node(parent),
        }
    }

    /// The parent of `e`, or of the `ChainExpression` around `e` if there is one.
    fn parent_of_expr(e: Expr<'a>) -> Ancestor<'a> {
        let parent = estree_parent(Node::Expr(e));
        let modifiers = match parent {
            Node::Class(class) => Some(class.modifiers()),
            Node::Member(member) => Some(member.modifiers()),
            Node::Param(param) => Some(param.modifiers()),
            _ => None,
        };
        let decorator = modifiers.and_then(|it| it.iter().find(|it| it.decorator() == Some(e)));
        let start = match parent {
            _ if decorator.is_some() => decorator.map(|it| it.span().start),
            // The `AssignmentPattern` in a `TSParameterProperty` or in a `Property`.
            Node::Param(param) if param.is_parameter_property() => {
                Some(param.span_without_modifiers().start)
            }
            Node::PatProp(prop) if prop.default() == Some(e) => Some(prop.value().span().start),
            // The inner `TSNonNullExpression` of `e!!`.
            Node::Expr(above) if above.inner_non_null_spans().len() > 0 => Some(above.span().start),
            // In `{...e}` the braces belong to the `JSXSpreadChild`, which is the `Spread` itself.
            _ if e.tag() == ExprTag::Spread => None,
            _ => e.jsx_container_span().map(|it| it.start),
        };
        Ancestor::part(start, parent)
    }

    /// The parent of `statement`, taken together with any `export` before it.
    fn parent_of_stmt(statement: Stmt<'a>) -> Ancestor<'a> {
        let parent = statement.parent();
        // A function's `BlockStatement`, or the `TSModuleBlock`.
        let block = match parent {
            Node::Func(func) if func.kind() == FnKind::StaticBlock => {
                return Ancestor::Node(func.owner());
            }
            Node::Func(func) => func.body_span(),
            Node::Stmt(above) => match above.kind() {
                StmtKind::Module(module) => module.innermost().body_span(),
                _ => None,
            },
            _ => None,
        };
        Ancestor::part(block.map(|it| it.start), parent)
    }

    /// `node.parent`
    fn parent(self) -> Ancestor<'a> {
        let node = match self {
            Ancestor::Node(node) => node,
            Ancestor::Chain(e) => return Ancestor::parent_of_expr(e),
            Ancestor::Part(_, parent) => return Ancestor::Node(parent),
        };
        // The expression, statement or member that a function or class appears as. A static block
        // is its `Member`.
        let source_node = match node {
            Node::Func(func) => match func.owner() {
                owner @ Node::Member(_) if func.kind() != FnKind::StaticBlock => {
                    return Ancestor::Node(owner);
                }
                owner => owner,
            },
            Node::Class(class) => class.owner(),
            _ => node,
        };
        match source_node {
            Node::Expr(e) if e.is_chain_root() => Ancestor::Chain(e),
            Node::Expr(e) => Ancestor::parent_of_expr(e),
            Node::Stmt(statement) => match statement.export_span() {
                Some(export) => Ancestor::Part(export.start, statement.parent()),
                None => Ancestor::parent_of_stmt(statement),
            },
            // The `ClassBody`.
            Node::Member(member) => match member.parent() {
                Node::Class(class) => Ancestor::Part(class.body_span().start, Node::Class(class)),
                parent => Ancestor::Node(parent),
            },
            // The `TSEnumBody`.
            Node::EnumMember(member) => match member.parent().as_stmt().map(Stmt::kind) {
                Some(StmtKind::Enum(it)) => Ancestor::Part(it.body_span().start, member.parent()),
                _ => Ancestor::Node(member.parent()),
            },
            // The `JSXOpeningElement`.
            Node::Prop(prop) if prop.is_jsx_attribute() => {
                Ancestor::Part(prop.parent().span().start, prop.parent())
            }
            _ => Ancestor::Node(estree_parent(source_node)),
        }
    }

    /// `node.range[0]`
    fn start(self) -> u32 {
        match self {
            // espree's `Program` spans the whole text, typescript-estree's starts at the first token.
            Ancestor::Node(Node::File(file)) => match file.language().parser {
                Parser::Espree if file.is_javascript() => 0,
                _ => file.program_span().start,
            },
            Ancestor::Node(node) => estree_span(node).start,
            Ancestor::Chain(e) => e.span().start,
            Ancestor::Part(start, _) => start,
        }
    }

    fn as_expr(self) -> Option<Expr<'a>> {
        match self {
            Ancestor::Node(Node::Expr(e)) | Ancestor::Chain(e) => Some(e),
            Ancestor::Node(Node::Func(func)) => func.owner().as_expr(),
            Ancestor::Node(Node::Class(class)) => class.owner().as_expr(),
            _ => None,
        }
    }

    /// `isES5Component`
    fn is_es5_component(self, pragmas: &Pragmas<'_>) -> bool {
        // A type argument is in a `TSTypeParameterInstantiation`.
        if matches!(self, Ancestor::Node(Node::Type(_))) {
            return false;
        }
        let Ancestor::Node(Node::Expr(parent)) = self.parent() else {
            return false;
        };
        let Some(callee) = parent.callee() else {
            return false;
        };
        // React.createClass({})
        if let Some(object) = callee.object()
            && !callee.is_chain_root()
        {
            return pragmas.is_pragma(object)
                && is_member_called(callee, pragmas.create_class_name());
        }
        // createClass({})
        callee
            .as_ident()
            .is_some_and(|it| it.bytes() == pragmas.create_class)
    }
}

/// `isES5Component`. True if `node` is the callee or an argument of a `createClass` call or `new`.
pub(crate) fn is_es5_component(node: Node<'_>, pragmas: &Pragmas<'_>) -> bool {
    Ancestor::Node(normalize(node)).is_es5_component(pragmas)
}

/// `findJSDocComment` of @eslint/compat, for a node that starts at `start`.
fn find_jsdoc_comment<'a>(file: &'a File<'a>, start: u32) -> Option<Token<'a>> {
    let before = file.comments_before(Span::empty(start)).next_back()?;
    let lines = file
        .line_of(start)
        .saturating_sub(file.line_of(before.end()));
    (before.kind() == TokenKind::Block && before.comment_value().starts_with(b"*") && lines <= 1)
        .then_some(before)
}

/// `getJSDocComment` of @eslint/compat, for a class.
fn get_jsdoc_comment(class: Class<'_>) -> Option<Token<'_>> {
    let start = match class.owner() {
        Node::Stmt(statement) => {
            (statement.export_span())
                .unwrap_or_else(|| class.estree_span())
                .start
        }
        _ => Ancestor::Node(Node::Class(class)).parent().parent().start(),
    };
    find_jsdoc_comment(class.file(), start)
}

/// `isExplicitComponent`, for a class.
pub(crate) fn is_explicit_component(class: Class<'_>) -> bool {
    get_jsdoc_comment(class).is_some_and(|it| has_component_tag(class.file(), it))
}

/// `isExplicitComponent`, for a function. `documented_at` is one cache for all of a file's functions.
pub(crate) fn is_explicit_component_function<'a>(
    func: Func<'a>,
    documented_at: &mut AncestorMemo<'a, Option<u32>>,
) -> bool {
    ast_utils::get_jsdoc_comment_of_function(func, documented_at)
        .is_some_and(|it| has_component_tag(func.file(), it))
}

/// Returns false only if no comment in the file can mark what it documents as a component.
pub(crate) fn may_have_explicit_components<'a>(file: &'a File<'a>) -> bool {
    let mut comments = file.comments().map(|it| it.comment_value());
    comments.any(|it| strings::contains(it, b"React."))
}

/// The test `isExplicitComponent` applies to the comment. The tags come from [`File::jsdoc`]. Known
/// difference: doctrine, which upstream parses them with, gives up at the first tag it can't parse
/// and misses the tags after it. That isn't reproduced here.
fn has_component_tag<'a>(file: &'a File<'a>, comment: Token<'a>) -> bool {
    let value = comment.comment_value();
    if !strings::contains(value, b"React.") {
        return false;
    }
    let Some(comment_ast) = file.jsdoc().at(comment.start()) else {
        return false;
    };
    // doctrine treats the `*` of a `**/` on a line by itself as text of the last tag.
    let has_text_at_the_end = value.strip_suffix(b"*").is_some_and(|rest| {
        let blanks = rest.get(rest.trim_ascii_end().len()..);
        strings::contains_js_line_break(blanks.unwrap_or_default())
    });
    let tags = comment_ast.tags();
    let count = tags.len().saturating_sub(usize::from(has_text_at_the_end));
    tags.take(count).any(|tag| {
        let (_, name, rest) = tag.type_name_comment();
        matches!(tag.kind.parsed(), b"extends" | b"augments")
            && name
                .is_some_and(|it| matches!(it.raw(), b"React.Component" | b"React.PureComponent"))
            && rest.is_empty()
    })
}

/// `isES6Component`'s check of `node.superClass`.
fn has_component_as_super_class(class: Class<'_>, pragmas: &Pragmas<'_>) -> bool {
    let Some(super_class) = class.extends().filter(|it| !it.is_chain_root()) else {
        return false;
    };
    if let Some(object) = super_class.object() {
        return pragmas.is_pragma(object)
            && (is_member_called(super_class, "Component")
                || is_member_called(super_class, "PureComponent"));
    }
    super_class
        .as_ident()
        .is_some_and(|it| it.is_any(&["Component", "PureComponent"]))
}

/// `isES6Component`. Upstream checks the comment first, which gives the same answer.
pub(crate) fn is_es6_component(class: Class<'_>, pragmas: &Pragmas<'_>) -> bool {
    has_component_as_super_class(class, pragmas) || is_explicit_component(class)
}

/// `getParentES5Component`. Returns the node inside the call, which is almost always the object literal.
pub(crate) fn get_parent_es5_component<'a>(
    node: Node<'a>,
    pragmas: &Pragmas<'_>,
) -> Option<Expr<'a>> {
    use ScopeKind::{Catch, ConditionalType, FunctionType, MappedType};
    if !mentions_create_class(node.file(), pragmas.create_class) {
        return None;
    }
    node.scope().chain().find_map(|scope| {
        // A `CatchClause` isn't a node in this AST, and it's never directly in a call. Type scopes are skipped.
        if matches!(
            scope.kind(),
            Catch | ConditionalType | FunctionType | MappedType
        ) {
            return None;
        }
        let node = Ancestor::Node(normalize(scope.node())).parent().parent();
        node.as_expr().filter(|_| node.is_es5_component(pragmas))
    })
}

/// `getParentES6Component`. Only checks the innermost class.
pub(crate) fn get_parent_es6_component<'a>(
    node: Node<'a>,
    pragmas: &Pragmas<'_>,
) -> Option<Class<'a>> {
    let mut scopes = node.scope().chain();
    match scopes.find(|it| it.kind() == ScopeKind::Class)?.node() {
        Node::Class(class) if is_es6_component(class, pragmas) => Some(class),
        _ => None,
    }
}

/// `isPureComponent`, which matches on the superclass's text. Upstream puts the pragma into a
/// regular expression unescaped, where a `$` before the `.` never matches.
pub(crate) fn is_pure_component(class: Class<'_>, pragmas: &Pragmas<'_>) -> bool {
    let super_class = class.extends().map(Expr::text);
    super_class
        .and_then(|it| it.strip_suffix(b"PureComponent"))
        .is_some_and(|before| {
            before.is_empty()
                || (before.strip_suffix(b".") == Some(pragmas.pragma)
                    && !strings::contains_char(pragmas.pragma, b'$'))
        })
}

/// `isStateMemberExpression`. Also matches `this[state]` and `this.#state`.
pub(crate) fn is_state_member_expression(e: Expr<'_>) -> bool {
    is_member_called(e, "state") && e.object().is_some_and(|it| it.tag() == ExprTag::This)
}
