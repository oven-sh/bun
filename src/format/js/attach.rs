//! Which node each comment belongs to.
//!
//! Before anything is printed, every comment gets exactly one owner, and is leading, trailing or dangling there. Whoever
//! prints a node prints the comments that it owns. Nothing is decided while printing.
//!
//! The rules are Prettier's: `attachComments` (`src/main/comments/attach.js`) and the handlers of
//! `src/language-js/comments/`, under the same names, so that the two can be read side by side.
//!
//! The nodes are the formatter's own, [`AstNodes`]. Where that tree has a node that Prettier's has not (`FormalParameters`, the
//! `FunctionBody` around the expression of an arrow function, `ChainExpression`), a comment cannot be attached to it:
//! [`Tree::can_attach_comment`]. A name that is a node for Prettier and a token here is an [`Owner::Name`].
//!
//! Most comments are between two statements, members or properties. [`NodeLocator::locate`] finds those by a search in the list,
//! and no handler has anything to say about them. Only for the rest are the nodes around the comment looked at one by one.

use super::ast_nodes::{
    AsAstNodes, AstNodes as N, ChainElement, ExpressionStatement, inner_of_stmt, is_inner_comma,
    node_as_ast_nodes,
};
use super::comments::Comment;
use bun_core::strings;
use bun_lint::ast::{
    BinOp, Expr, ExprKind, File, FnBody, FnKind, Func, Handle, List, Member, Node, PatKind,
    PropKind, Stmt, StmtKind, StmtTag, TypeKind, TypeNode,
};
use bun_lint::span::{Span, Spanned};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Placement {
    Leading,
    Trailing,
    Dangling,
}

/// Prettier's `comment.marker`: which of the dangling comments of a node it is.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Marker {
    None,
    CommentBeforeArrow,
    Implements,
    Extends,
    /// Prettier attaches it to nothing. It is in a node that is ignored, so it is part of the text that is copied.
    InIgnoredNode,
}

/// A name or a key: a token here, an `Identifier` or a `Literal` for Prettier.
#[derive(Copy, Clone, Debug)]
pub(crate) struct Name<'a> {
    pub(crate) span: Span,
    /// The node that the name belongs to.
    parent: Node<'a>,
}

impl PartialEq for Name<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.span.start == other.span.start
    }
}
impl Eq for Name<'_> {}

/// What a comment can be attached to.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Owner<'a> {
    Node(N<'a>),
    Name(Name<'a>),
    /// The parentheses around the expression that open here and follow `/** @type {T} */`: Babel's
    /// `ParenthesizedExpression`.
    CastParentheses(Expr<'a>, u32),
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct Attachment<'a> {
    pub(crate) owner: Owner<'a>,
    pub(crate) placement: Placement,
    pub(crate) marker: Marker,
    /// Prettier's `comment.unignore`: it says `prettier-ignore`, and what it is about is not its owner.
    pub(crate) is_unignored: bool,
}

#[derive(Default)]
pub(crate) struct Attached<'a> {
    /// One for each comment, in the same order.
    pub(crate) attachments: Vec<Attachment<'a>>,
    /// Prettier's `node.prettierIgnore`: nodes that are ignored without owning the comment that says so.
    pub(crate) ignored: Vec<Owner<'a>>,
    /// Where the nodes start that own a comment which is not next to them or in them. Sorted.
    pub(crate) relocated_owner_starts: Vec<u32>,
}

#[derive(Copy, Clone)]
pub(crate) struct Options {
    pub(crate) has_tree_of_babel: bool,
    pub(crate) experimental_ternaries: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum TextPosition {
    OwnLine,
    EndOfLine,
    Remaining,
}

#[derive(Copy, Clone, Default)]
struct DecoratedComment<'a> {
    enclosing_node: Option<Owner<'a>>,
    preceding_node: Option<Owner<'a>>,
    following_node: Option<Owner<'a>>,
    /// It is directly in a list of statements, members or properties.
    is_between_list_elements: bool,
}

/// Prettier's `CommentContext`.
#[derive(Copy, Clone)]
struct Context<'a> {
    comment: Comment,
    enclosing_node: Option<Owner<'a>>,
    preceding_node: Option<Owner<'a>>,
    following_node: Option<Owner<'a>>,
    text_position: TextPosition,
    is_last_comment: bool,
}

impl<'a> Context<'a> {
    /// The node that the comment is in.
    fn enclosing_node(&self) -> Option<N<'a>> {
        match self.enclosing_node {
            Some(Owner::Node(node)) => Some(node),
            _ => None,
        }
    }
}

type Handled<'a> = Option<(Owner<'a>, Placement, Marker)>;

#[expect(clippy::unnecessary_wraps)]
fn leading(owner: Owner<'_>) -> Handled<'_> {
    Some((owner, Placement::Leading, Marker::None))
}

#[expect(clippy::unnecessary_wraps)]
fn trailing(owner: Owner<'_>) -> Handled<'_> {
    Some((owner, Placement::Trailing, Marker::None))
}

#[expect(clippy::unnecessary_wraps)]
fn dangling(owner: Owner<'_>) -> Handled<'_> {
    Some((owner, Placement::Dangling, Marker::None))
}

/// The file, its text and its comments: everything that is only read.
struct Tree<'a, 'ctx> {
    file: &'a File<'a>,
    text: &'a [u8],
    comments: &'ctx [Comment],
    options: Options,
    /// Where the `(` are that follow a type cast comment, if they are nodes.
    cast_paren_starts: Vec<u32>,
    /// There is an `@` somewhere.
    may_have_decorators: bool,
}

// ───────────────────────────── the text ─────────────────────────────

fn ends_with_newline(text: &[u8]) -> bool {
    matches!(text, [.., b'\n' | b'\r'] | [.., 0xE2, 0x80, 0xA8 | 0xA9])
}

fn starts_with_newline(text: &[u8]) -> bool {
    matches!(text, [b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..])
}

fn is_blank(b: u8) -> bool {
    matches!(b, b' ' | b'\t')
}

impl<'a> Tree<'a, '_> {
    fn text_between(&self, from: u32, to: u32) -> &'a [u8] {
        self.text
            .get(from as usize..to as usize)
            .unwrap_or_default()
    }

    /// `hasNewline(text, at, { backwards: true })`
    fn has_newline_before(&self, at: u32) -> bool {
        let before = self.text_between(0, at);
        let blanks = before.iter().rev().take_while(|b| is_blank(**b)).count();
        ends_with_newline(&before[..before.len() - blanks])
    }

    /// `hasNewline(text, at)`
    fn has_newline_after(&self, at: u32) -> bool {
        let after = self.text.get(at as usize..).unwrap_or_default();
        let blanks = after.iter().take_while(|b| is_blank(**b)).count();
        starts_with_newline(&after[blanks..])
    }

    /// `hasNewlineInRange`
    fn has_newline_between(&self, from: u32, to: u32) -> bool {
        strings::contains_char(self.text_between(from, to), b'\n')
    }

    /// `isAllEmptyAndNoLineBreak`. A `\r` is not a text_position break to it.
    fn is_all_empty_and_no_line_break(&self, from: u32, to: u32) -> bool {
        let between = self.text_between(from, to);
        !strings::contains_char(between, b'\n')
            && strings::trim_js_whitespace_start(between).is_empty()
            && !strings::contains(between, b"\xE2\x80\xA8")
            && !strings::contains(between, b"\xE2\x80\xA9")
    }

    /// The comment that `at` is in.
    fn comment_around(&self, at: u32) -> Option<&Comment> {
        let index = self
            .comments
            .partition_point(|comment| comment.span.end <= at);
        self.comments
            .get(index)
            .filter(|comment| comment.span.start <= at)
    }

    /// `getNextNonSpaceNonCommentCharacterIndex`
    fn next_character_index(&self, mut at: u32) -> u32 {
        loop {
            let rest = self.text.get(at as usize..).unwrap_or_default();
            at += (rest.len() - strings::trim_js_whitespace_start(rest).len()) as u32;
            match self.comment_around(at) {
                Some(comment) if comment.span.start == at => at = comment.span.end,
                _ => return at,
            }
        }
    }

    /// `getNextNonSpaceNonCommentCharacter`
    fn next_character(&self, at: u32) -> Option<u8> {
        self.text
            .get(self.next_character_index(at) as usize)
            .copied()
    }

    /// Where the code ends that is before `at`: without the whitespace and the comments at its end. Not before `floor`.
    fn end_of_code_before(&self, mut at: u32, floor: u32) -> u32 {
        loop {
            at = floor + strings::trim_js_whitespace_end(self.text_between(floor, at)).len() as u32;
            match at.checked_sub(1).and_then(|last| self.comment_around(last)) {
                Some(comment) if comment.span.end == at && comment.span.start >= floor => {
                    at = comment.span.start;
                }
                _ => return at,
            }
        }
    }

    /// `stripComments(options).indexOf(needle, from)`. -1 if there is none.
    fn index_of(&self, needle: &[u8], from: u32) -> i64 {
        let mut from = from as usize;
        loop {
            let Some(found) = self
                .text
                .get(from..)
                .and_then(|text| strings::index_of(text, needle))
            else {
                return -1;
            };
            match self.comment_around((from + found) as u32) {
                Some(comment) => from = comment.span.end as usize,
                None => return (from + found) as i64,
            }
        }
    }

    /// `stripComments(options).lastIndexOf(needle, from)`. -1 if there is none.
    fn last_index_of(&self, needle: &[u8], from: u32) -> i64 {
        let mut until = (from as usize + needle.len()).min(self.text.len());
        loop {
            let Some(found) = self
                .text
                .get(..until)
                .and_then(|text| strings::last_index_of(text, needle))
            else {
                return -1;
            };
            match self.comment_around(found as u32) {
                Some(comment) => until = comment.span.start as usize,
                None => return found as i64,
            }
        }
    }

    /// `stripComments(options).slice(from, to).trim()`, if that is one word.
    fn only_code_between(&self, from: u32, to: u32) -> &'a [u8] {
        let from = self.next_character_index(from).min(to);
        self.text_between(from, self.end_of_code_before(to, from))
    }

    fn is_single_line_block_comment(&self, comment: Comment) -> bool {
        comment.is_block() && !comment.is_multiline_block()
    }

    fn is_single_line_comment(&self, comment: Comment) -> bool {
        !comment.is_multiline_block()
    }
}

// ───────────────────────────── the tree ─────────────────────────────

/// The expression that `node` is, if it is one: what parentheses can be written around.
pub(crate) fn as_parenthesizable_expr(node: N<'_>) -> Option<Expr<'_>> {
    match node {
        N::Function(func) | N::ArrowFunctionExpression(func) => func.owner().as_expr(),
        N::Class(class) => class.owner().as_expr(),
        N::SpreadElement(_)
        | N::JSXExpressionContainer(_)
        | N::JSXSpreadChild(_)
        | N::JSXOpeningElement(_)
        | N::Decorator(_)
        | N::ChainExpression(_)
        | N::AssignmentTargetRest(_) => None,
        _ => match node.raw() {
            Node::Expr(e) => Some(e),
            _ => None,
        },
    }
}

/// The types of a union or an intersection.
fn union_members(ty: TypeNode<'_>) -> Option<List<'_, TypeNode<'_>>> {
    match ty.kind() {
        TypeKind::Union(types) | TypeKind::Intersection(types) => Some(types),
        _ => None,
    }
}

/// The function that has the parameters and the body of `node`, which is a function, a method or a signature.
fn function_of_node(node: N<'_>) -> Option<Func<'_>> {
    match node {
        N::Function(func) | N::ArrowFunctionExpression(func) => Some(func),
        N::MethodDefinition(member)
        | N::TSMethodSignature(member)
        | N::TSCallSignatureDeclaration(member)
        | N::TSConstructSignatureDeclaration(member) => member.func(),
        N::ObjectProperty(prop) => prop.func(),
        N::TSFunctionType(ty) | N::TSConstructorType(ty) => match ty.kind() {
            TypeKind::Fn(func) => Some(func),
            _ => None,
        },
        _ => None,
    }
}

/// The member or the property that `func` is the function of, if it is a method, a getter or a setter.
fn method_owning(func: Func<'_>) -> Option<Node<'_>> {
    match func.owner() {
        owner @ Node::Member(_) => Some(owner),
        Node::Expr(e) => match e.parent() {
            Node::Prop(prop) if prop.func() == Some(func) => Some(Node::Prop(prop)),
            _ => None,
        },
        _ => None,
    }
}

/// Calls `visit` with the nodes that are made of `node` and can have nothing in them.
fn for_each_synthetic_child<'a>(node: Node<'a>, visit: &mut dyn FnMut(N<'a>)) {
    match node {
        Node::Func(func)
            if matches!(func.body(), FnBody::Block(_)) && func.kind() != FnKind::StaticBlock =>
        {
            visit(N::FunctionBody(func));
        }
        Node::Class(class) => visit(N::ClassBody(class)),
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Interface(_) => visit(N::TSInterfaceBody(statement)),
            StmtKind::Enum(_) => visit(N::TSEnumBody(statement)),
            StmtKind::Module(module) if module.innermost().has_body() => {
                visit(N::TSModuleBlock(statement));
            }
            _ => {}
        },
        _ => {}
    }
}

fn has_parameters(func: Func<'_>) -> bool {
    func.this_param().is_some() || !func.params().is_empty()
}

impl<'a> Tree<'a, '_> {
    fn is_babel(&self) -> bool {
        self.options.has_tree_of_babel
    }

    fn program(&self) -> Owner<'a> {
        Owner::Node(node_as_ast_nodes(Node::File(self.file)))
    }

    fn name(&self, span: Span, parent: impl Into<Node<'a>>) -> Owner<'a> {
        Owner::Name(Name {
            span,
            parent: parent.into(),
        })
    }

    fn is_cast_paren(&self, open: u32) -> bool {
        self.cast_paren_starts.binary_search(&open).is_ok()
    }

    /// What is where the expression `e` is written: with the outermost of the parentheses that are a node.
    fn owner_of_expr(&self, e: Expr<'a>) -> Owner<'a> {
        if !self.cast_paren_starts.is_empty() && e.is_parenthesized() {
            if let Some(paren) = e
                .parens()
                .rev()
                .find(|paren| self.is_cast_paren(paren.start))
            {
                return Owner::CastParentheses(e, paren.start);
            }
        }
        Owner::Node(e.as_chain_element())
    }

    fn owner_of_stmt(&self, statement: Stmt<'a>) -> Owner<'a> {
        Owner::Node(statement.as_ast_nodes())
    }

    /// What is where the type `ty` is written. `postprocess` takes a union or an intersection of one type out of the tree.
    fn owner_of_type(&self, mut ty: TypeNode<'a>) -> Owner<'a> {
        while let Some(types) = union_members(ty)
            && types.len() == 1
            && let Some(only) = types.first()
        {
            ty = only;
        }
        Owner::Node(ty.as_ast_nodes())
    }

    /// The innermost of the nodes that are made of `node`.
    fn owner_of_node(&self, node: Node<'a>) -> Owner<'a> {
        Owner::Node(node_as_ast_nodes(node))
    }

    fn parent(&self, owner: Owner<'a>) -> Option<Owner<'a>> {
        let mut node = match owner {
            Owner::Name(name) => match name.parent {
                Node::Stmt(statement) => inner_of_stmt(statement),
                Node::TypeParam(param) if matches!(param.parent(), Node::Type(_)) => {
                    N::TSTypeParameter(param).parent()
                }
                parent => node_as_ast_nodes(parent),
            },
            Owner::CastParentheses(e, open) => {
                let outer = e
                    .parens()
                    .find(|paren| paren.start < open && self.is_cast_paren(paren.start));
                match outer {
                    Some(outer) => return Some(Owner::CastParentheses(e, outer.start)),
                    None => e.ast_parent(),
                }
            }
            Owner::Node(N::Program(_)) => return None,
            Owner::Node(node) => {
                if !self.cast_paren_starts.is_empty()
                    && let Some(e) = as_parenthesizable_expr(node).filter(|e| e.is_parenthesized())
                    && let Some(paren) = e.parens().find(|paren| self.is_cast_paren(paren.start))
                {
                    return Some(Owner::CastParentheses(e, paren.start));
                }
                node.parent()
            }
        };
        while !self.can_attach_comment(Owner::Node(node)) {
            node = node.parent();
        }
        Some(Owner::Node(node))
    }

    fn loc_start(&self, owner: Owner<'a>) -> u32 {
        let node = match owner {
            Owner::Name(name) => return name.span.start,
            Owner::CastParentheses(_, open) => return open,
            Owner::Node(N::Program(_)) => return 0,
            Owner::Node(N::JSXEmptyExpression(e)) => {
                return e
                    .jsx_container_span()
                    .map_or_else(|| e.span().start, |container| container.start + 1);
            }
            Owner::Node(node) => node,
        };
        let start = node.span().start;
        if !self.may_have_decorators {
            return start;
        }
        let class = match node {
            N::Class(class) => Some(class),
            N::ExportNamedDeclaration(statement) | N::ExportDefaultDeclaration(statement) => {
                match statement.kind() {
                    StmtKind::Class(class) => Some(class),
                    StmtKind::ExportDefault(e) => e.as_class(),
                    _ => None,
                }
            }
            _ => None,
        };
        match class.and_then(|class| class.decorators().next()) {
            Some(first) => N::Decorator(first).span().start.min(start),
            None => start,
        }
    }

    fn loc_end(&self, owner: Owner<'a>) -> u32 {
        let mut node = match owner {
            Owner::Name(name) => return name.span.end,
            Owner::CastParentheses(e, open) => {
                return e
                    .parens()
                    .find(|paren| paren.start == open)
                    .map_or(open, |paren| paren.end);
            }
            Owner::Node(N::JSXEmptyExpression(e)) => {
                return e
                    .jsx_container_span()
                    .map_or_else(|| e.span().end, |container| container.end - 1);
            }
            Owner::Node(node) => node,
        };
        loop {
            let inner = match node {
                N::Program(_) => return self.text.len() as u32,
                N::IfStatement(statement) => match statement.kind() {
                    StmtKind::If { yes, no, .. } => no.unwrap_or(yes),
                    _ => return node.span().end,
                },
                N::ForStatement(statement)
                | N::ForInStatement(statement)
                | N::ForOfStatement(statement)
                | N::WhileStatement(statement)
                | N::WithStatement(statement)
                | N::LabeledStatement(statement) => match statement.kind() {
                    StmtKind::For { body, .. }
                    | StmtKind::ForIn { body, .. }
                    | StmtKind::ForOf { body, .. }
                    | StmtKind::While { body, .. }
                    | StmtKind::With { body, .. }
                    | StmtKind::Labeled { body, .. } => body,
                    _ => return node.span().end,
                },
                N::VariableDeclaration(statement) => {
                    let last = statement.as_var().and_then(List::last);
                    return last
                        .map_or_else(|| node.span().end, |declarator| declarator.span().end);
                }
                N::BreakStatement(statement) | N::ContinueStatement(statement) => {
                    let keyword = if matches!(node, N::BreakStatement(_)) {
                        5
                    } else {
                        8
                    };
                    let label = statement.label().map(|ident| ident.span().end);
                    return label.unwrap_or_else(|| node.span().start + keyword);
                }
                N::DebuggerStatement(_) => return node.span().start + 8,
                N::ExpressionStatement(ExpressionStatement::Stmt(_))
                | N::Directive(_)
                | N::ImportDeclaration(_)
                | N::ExportDefaultDeclaration(_)
                | N::ExportNamedDeclaration(_)
                | N::ExportAllDeclaration(_)
                | N::ReturnStatement(_)
                | N::ThrowStatement(_)
                | N::DoWhileStatement(_) => return self.content_end(node.span()),
                _ => return node.span().end,
            };
            node = inner.as_ast_nodes();
        }
    }

    /// `setContentEnd`: where a statement ends without its `;`.
    fn content_end(&self, span: Span) -> u32 {
        match self.text_between(span.start, span.end) {
            // Neither whitespace nor the end of a comment.
            [
                ..,
                b')'
                | b']'
                | b'}'
                | b'"'
                | b'\''
                | b'`'
                | b'0'..=b'9'
                | b'a'..=b'z'
                | b'A'..=b'Z'
                | b'_'
                | b'$',
                b';',
            ] => span.end - 1,
            [.., b';'] => self.end_of_code_before(span.end - 1, span.start),
            _ => span.end,
        }
    }

    fn loc(&self, owner: Owner<'a>) -> Span {
        Span::new(self.loc_start(owner), self.loc_end(owner))
    }

    /// Prettier's `isMethod`, for a property of an object.
    fn is_object_method(&self, node: N<'a>) -> bool {
        matches!(node, N::ObjectProperty(prop)
            if matches!(prop.kind(), PropKind::Method | PropKind::Getter | PropKind::Setter))
    }

    /// Babel's `ClassPrivateMethod` and `ClassPrivateProperty`, which none of Prettier's lists of types have.
    fn is_private_member_of_babel(&self, member: Member<'a>) -> bool {
        self.is_babel() && member.key().is_some_and(|key| key.is_private())
    }

    /// Prettier's `canAttachComment`, and what is a node only here.
    fn can_attach_comment(&self, owner: Owner<'a>) -> bool {
        let Owner::Node(node) = owner else {
            return true;
        };
        match node {
            N::ChainExpression(_)
            | N::FormalParameters(_)
            | N::Elision(_)
            | N::ExpressionStatement(ExpressionStatement::ArrowBody(_)) => false,
            N::FunctionBody(func) => matches!(func.body(), FnBody::Block(_)),
            // The function in a method. Babel has none, and typescript-estree's cannot have comments if it has no
            // body, or in a class if it has nothing before the body.
            N::Function(func) => match method_owning(func) {
                Some(_) if self.is_babel() || !func.has_body() => false,
                Some(Node::Member(_)) => has_parameters(func) || func.return_type().is_some(),
                _ => true,
            },
            // The name of a parameter is the parameter, unless there is more to it.
            N::BindingIdentifier(pat) => match pat.parent() {
                Node::Param(param) => param.default().is_some() || param.is_parameter_property(),
                _ => true,
            },
            // `isMeaningfulEmptyStatement`
            N::EmptyStatement(statement) => match statement.parent() {
                Node::Stmt(parent) => !matches!(
                    parent.tag(),
                    StmtTag::Block | StmtTag::Module | StmtTag::Try | StmtTag::Switch
                ),
                _ => false,
            },
            N::TSTypeAnnotation(ty) => !matches!(ty.parent(), Node::Member(member)
                if matches!(member.as_ast_nodes(), N::TSPropertySignature(_))),
            N::TSUnionType(ty) | N::TSIntersectionType(ty) => {
                union_members(ty).is_none_or(|types| types.len() != 1)
            }
            _ => true,
        }
    }
}

// ───────────────────────────── where a comment is ─────────────────────────────

/// Calls `visit` with the names in `node` that are nodes for Prettier.
fn for_each_name_token<'a>(node: Node<'a>, visit: &mut dyn FnMut(Span)) {
    let file = node.file();
    let mut key = |key: Option<bun_lint::ast::Key<'a>>| {
        if let Some(key) = key.filter(|key| !key.is_computed()) {
            visit(key.span(file));
        }
    };
    match node {
        Node::Func(func) => func
            .name()
            .into_iter()
            .for_each(|ident| visit(ident.span())),
        Node::Class(class) => class
            .name()
            .into_iter()
            .for_each(|ident| visit(ident.span())),
        Node::Member(member) => key(member.key()),
        Node::Prop(prop) if !matches!(prop.kind(), PropKind::Shorthand | PropKind::Spread) => {
            key(prop.key());
        }
        Node::PatProp(prop) if !prop.is_shorthand() => key(prop.key()),
        Node::EnumMember(member) => key(member.key()),
        Node::ImportSpec(spec) => {
            visit(spec.imported().span());
            if spec.is_renamed() {
                visit(spec.local().span());
            }
        }
        Node::ExportSpec(spec) => {
            visit(spec.local().span());
            if spec.is_renamed() {
                visit(spec.exported().span());
            }
        }
        Node::TypeParam(param) => visit(param.name().span()),
        Node::TupleElem(element) => element
            .name()
            .into_iter()
            .for_each(|ident| visit(ident.span())),
        Node::Expr(e) => {
            if let ExprKind::Dot { name, .. } = e.kind() {
                visit(name.span());
            }
        }
        Node::Type(ty) => match ty.kind() {
            TypeKind::Ref { name, .. } => visit(name.span()),
            TypeKind::Predicate { .. } => {
                ty.predicate_param()
                    .into_iter()
                    .for_each(|ident| visit(ident.span()));
            }
            _ => {}
        },
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Interface(interface) => visit(interface.name().span()),
            StmtKind::TypeAlias(alias) => visit(alias.name().span()),
            StmtKind::Enum(enum_decl) => visit(enum_decl.name().span()),
            StmtKind::Module(module) => visit(module.name_span()),
            StmtKind::ImportEquals(import) => visit(import.name().span()),
            StmtKind::Labeled { .. } | StmtKind::Break(_) | StmtKind::Continue(_) => {
                statement
                    .label()
                    .into_iter()
                    .for_each(|ident| visit(ident.span()));
            }
            StmtKind::Import(import) => {
                import
                    .default()
                    .into_iter()
                    .for_each(|ident| visit(ident.span()));
                import.namespace_span().into_iter().for_each(&mut *visit);
                import.spec_span().into_iter().for_each(&mut *visit);
            }
            StmtKind::ExportNamed(export) => export.spec_span().into_iter().for_each(&mut *visit),
            StmtKind::ExportStar { alias, .. } => {
                alias.into_iter().for_each(|ident| visit(ident.span()));
                statement
                    .module_specifier_span()
                    .into_iter()
                    .for_each(&mut *visit);
            }
            _ => {}
        },
        _ => {}
    }
}

/// Where a comment is, as far as the nodes of `bun_lint::ast` tell.
enum Location<'a> {
    /// Directly in `list`, which is a block, the body of a class or the like.
    Between {
        list: N<'a>,
        before: Option<Node<'a>>,
        after: Option<Node<'a>>,
        /// Everything in here is between the same two.
        same_neighbors_span: Span,
    },
    /// In this node and in none of its children.
    In(Node<'a>),
}

enum ListSearch<'a> {
    Inside(Node<'a>),
    Between(Option<Node<'a>>, Option<Node<'a>>),
    Unknown,
}

fn search_list<'a, T>(list: List<'a, T>, comment: Span) -> ListSearch<'a>
where
    T: Handle<'a> + Spanned + Into<Node<'a>> + Copy,
{
    match list.neighbors(comment.start) {
        None => ListSearch::Unknown,
        Some((Some(before), _)) if before.span().contains(comment) => {
            ListSearch::Inside(before.into())
        }
        Some((Some(before), _)) if before.span().end > comment.start => ListSearch::Unknown,
        Some((before, after)) => ListSearch::Between(before.map(T::into), after.map(T::into)),
    }
}

fn is_empty_statement(node: Option<Node<'_>>) -> bool {
    matches!(node, Some(Node::Stmt(statement)) if statement.tag() == StmtTag::Empty)
}

/// Finds the node of `bun_lint::ast` that a comment is in.
struct NodeLocator<'a> {
    file: &'a File<'a>,
    /// The nodes that the last comment was in, each in the one before. The first is the file. The next comment is behind
    /// the last one, so a node that is left is never come back to.
    path: Vec<Node<'a>>,
}

impl<'a> NodeLocator<'a> {
    fn locate(&mut self, comment: Span) -> Location<'a> {
        while self.path.len() > 1
            && let Some(last) = self.path.last()
            && !last.span().contains(comment)
        {
            self.path.pop();
        }
        loop {
            let node = self.path.last().copied().unwrap_or(Node::File(self.file));
            // The list, the node that is nothing but the list, and where its `{` is if that is not where `node` starts.
            let (search_list, list, open) = match node {
                Node::File(file) => (
                    search_list(file.body(), comment),
                    Some(node_as_ast_nodes(node)),
                    None,
                ),
                Node::Stmt(statement) => match statement.kind() {
                    StmtKind::Block(statements) => (
                        search_list(statements, comment),
                        Some(N::BlockStatement(statement)),
                        None,
                    ),
                    StmtKind::Interface(interface) => (
                        search_list(interface.members(), comment),
                        Some(N::TSInterfaceBody(statement)),
                        Some(interface.body_span().start),
                    ),
                    StmtKind::Enum(enum_decl) => (
                        search_list(enum_decl.members(), comment),
                        Some(N::TSEnumBody(statement)),
                        Some(enum_decl.body_span().start),
                    ),
                    _ => (ListSearch::Unknown, None, None),
                },
                Node::Func(func) => match func.body() {
                    FnBody::Block(statements) => (
                        search_list(statements, comment),
                        Some(match func.kind() {
                            FnKind::StaticBlock => func.as_ast_nodes(),
                            _ => N::FunctionBody(func),
                        }),
                        func.body_span().map(|body| body.start),
                    ),
                    _ => (ListSearch::Unknown, None, None),
                },
                Node::Class(class) => (
                    search_list(class.members(), comment),
                    Some(N::ClassBody(class)),
                    Some(class.body_span().start),
                ),
                Node::Expr(e) => match e.kind() {
                    ExprKind::Object(properties) => (
                        search_list(properties, comment),
                        Some(e.as_chain_element()),
                        None,
                    ),
                    _ => (ListSearch::Unknown, None, None),
                },
                Node::Type(ty) => match ty.kind() {
                    TypeKind::Object(members) => (
                        search_list(members, comment),
                        Some(N::TSTypeLiteral(ty)),
                        None,
                    ),
                    _ => (ListSearch::Unknown, None, None),
                },
                _ => (ListSearch::Unknown, None, None),
            };
            let inner = match search_list {
                ListSearch::Inside(child) => Some(child),
                // Before the first element it can be in the head.
                ListSearch::Between(before, after)
                    if (before.is_some() || open.is_none_or(|open| open < comment.start))
                        && !is_empty_statement(before)
                        && !is_empty_statement(after) =>
                {
                    if let Some(list) = list {
                        return Location::Between {
                            list,
                            before,
                            after,
                            same_neighbors_span: Span::new(
                                before.map_or(comment.start, |node| node.span().end),
                                after.map_or_else(|| node.span().end, |node| node.span().start),
                            ),
                        };
                    }
                    None
                }
                _ => {
                    let mut inner = None;
                    node.for_each_child_near(comment.start, |child| {
                        if inner.is_none() && child.span().contains(comment) {
                            inner = Some(child);
                        }
                    });
                    inner
                }
            };
            match inner {
                Some(child) => self.path.push(child),
                None => return Location::In(node),
            }
        }
    }
}

impl<'a> Tree<'a, '_> {
    /// Calls `visit` with what is in `node`, can have comments and could be next to `comment`, and where it is. Returns
    /// whether something has been left out that cannot have comments, so that what is next to it counts.
    fn for_each_attachable_child(
        &self,
        node: Node<'a>,
        comment: Span,
        only_nearby: bool,
        visit: &mut dyn FnMut(Owner<'a>, Span),
    ) -> bool {
        let mut skipped_unattachable = false;
        let mut child = |child: Node<'a>| {
            let owner = self.owner_of_node(child);
            let span = self.loc(owner);
            // What cannot have comments gives way to what is in it. So does what is one node with `node`: a signature and
            // its function, the operands of commas.
            if !self.can_attach_comment(owner)
                || span.contains(comment)
                || matches!(child, Node::Expr(e) if is_inner_comma(e))
            {
                skipped_unattachable |= matches!(owner, Owner::Node(N::EmptyStatement(_)))
                    | self.for_each_attachable_child(child, comment, only_nearby, visit);
            } else {
                visit(owner, span);
            }
        };
        match only_nearby {
            true => node.for_each_child_around(comment.start, &mut child),
            false => node.for_each_child(&mut child),
        }
        for_each_synthetic_child(node, &mut |part| {
            let span = part.span();
            if !span.contains(comment) {
                visit(Owner::Node(part), span);
            }
        });
        for_each_name_token(node, &mut |span| visit(self.name(span, node), span));
        skipped_unattachable
    }

    /// What is in `node` and the closest to `comment` on either side.
    fn closest_children(
        &self,
        node: Node<'a>,
        comment: Span,
    ) -> (Option<Owner<'a>>, Option<Owner<'a>>) {
        for only_nearby in [true, false] {
            let (mut before, mut after) = (None::<(u32, Owner<'a>)>, None::<(u32, Owner<'a>)>);
            let skipped_unattachable =
                self.for_each_attachable_child(node, comment, only_nearby, &mut |owner, span| {
                    if span.end <= comment.start
                        && before.is_none_or(|closest| span.end >= closest.0)
                    {
                        before = Some((span.end, owner));
                    } else if span.start >= comment.end
                        && after.is_none_or(|closest| span.start < closest.0)
                    {
                        after = Some((span.start, owner));
                    }
                });
            if !skipped_unattachable || !only_nearby {
                return (
                    before.map(|closest| closest.1),
                    after.map(|closest| closest.1),
                );
            }
        }
        (None, None)
    }

    /// From `owner`, which `comment` is not in, up to the node that `comment` is in: that node, and its child on the way.
    fn ascend_to_enclosing_node(
        &self,
        mut owner: Owner<'a>,
        comment: Span,
    ) -> Option<(Owner<'a>, Owner<'a>)> {
        loop {
            let parent = self.parent(owner)?;
            if self.loc(parent).contains(comment) {
                return Some((owner, parent));
            }
            owner = parent;
        }
    }

    fn is_descendant_of(&self, mut owner: Owner<'a>, ancestor: Owner<'a>) -> bool {
        while let Some(parent) = self.parent(owner) {
            if parent == ancestor {
                return true;
            }
            owner = parent;
        }
        false
    }

    /// `decorateComment`, for a comment that is in `node` and in none of its children.
    fn decorate_comment_in_node(&self, mut node: Node<'a>, comment: Span) -> DecoratedComment<'a> {
        loop {
            node = match node {
                // A comment before the `;` of a statement is behind the statement.
                Node::Stmt(statement)
                    if !self.loc(self.owner_of_stmt(statement)).contains(comment) =>
                {
                    node.parent()
                }
                // A method starts where its function starts.
                Node::Func(func) => match method_owning(func) {
                    Some(method) => method,
                    None => break,
                },
                _ => break,
            };
        }
        // `{/* comment */}` in JSX is left out of the children.
        if let Some(empty) = self.jsx_empty_expression_containing(node, comment) {
            return DecoratedComment {
                enclosing_node: Some(empty),
                ..DecoratedComment::default()
            };
        }
        let (before, after) = self.closest_children(node, comment);
        let before = before.and_then(|node| self.ascend_to_enclosing_node(node, comment));
        let after = after.and_then(|node| self.ascend_to_enclosing_node(node, comment));
        let (enclosing_node, preceding_node, following_node) = match (before, after) {
            (Some(before), Some(after)) if before.1 == after.1 => {
                (before.1, Some(before.0), Some(after.0))
            }
            (Some(before), Some(after)) if self.is_descendant_of(before.1, after.1) => {
                (before.1, Some(before.0), None)
            }
            (Some(_) | None, Some(after)) => (after.1, None, Some(after.0)),
            (Some(before), None) => (before.1, Some(before.0), None),
            (None, None) => {
                let mut owner = self.owner_of_node(node);
                while !self.can_attach_comment(owner) || !self.loc(owner).contains(comment) {
                    match self.parent(owner) {
                        Some(parent) => owner = parent,
                        None => break,
                    }
                }
                (owner, None, None)
            }
        };
        DecoratedComment {
            enclosing_node: Some(enclosing_node),
            preceding_node,
            following_node,
            is_between_list_elements: false,
        }
    }

    fn jsx_empty_expression_containing(&self, node: Node<'a>, comment: Span) -> Option<Owner<'a>> {
        let is_around = |e: &Expr<'a>| {
            e.is_missing()
                && e.jsx_container_span()
                    .is_some_and(|container| container.contains(comment))
        };
        let empty = match node {
            Node::Expr(e) => match e.kind() {
                ExprKind::Jsx(jsx) => jsx.children().iter().find(is_around),
                _ => None,
            },
            Node::Prop(prop) => prop.value().filter(is_around),
            _ => None,
        };
        empty.map(|e| Owner::Node(N::JSXEmptyExpression(e)))
    }
}

// ───────────────────────────── kinds of nodes ─────────────────────────────

impl<'a> Tree<'a, '_> {
    fn is_union_type(&self, owner: Option<Owner<'a>>) -> bool {
        matches!(owner, Some(Owner::Node(N::TSUnionType(_))))
    }

    fn types(&self, owner: Owner<'a>) -> impl DoubleEndedIterator<Item = Owner<'a>> {
        let types = match owner {
            Owner::Node(N::TSUnionType(ty) | N::TSIntersectionType(ty)) => union_members(ty),
            _ => None,
        };
        types.into_iter().flatten().map(|ty| self.owner_of_type(ty))
    }

    fn is_conditional(&self, owner: Option<Owner<'a>>) -> bool {
        matches!(
            owner,
            Some(Owner::Node(
                N::ConditionalExpression(_) | N::TSConditionalType(_)
            ))
        )
    }

    /// An `Identifier`.
    fn is_identifier(&self, owner: Option<Owner<'a>>) -> bool {
        match owner {
            Some(Owner::Node(N::IdentifierReference(_) | N::BindingIdentifier(_))) => true,
            Some(Owner::Node(N::FormalParameter(param))) => {
                matches!(param.pat().kind(), PatKind::Ident(_))
                    && param.default().is_none()
                    && !param.is_parameter_property()
            }
            Some(Owner::Name(name)) => !matches!(
                self.text.get(name.span.start as usize),
                Some(b'#' | b'"' | b'\'' | b'`' | b'0'..=b'9' | b'.')
            ),
            _ => false,
        }
    }

    fn is_block_statement(&self, owner: Owner<'a>) -> bool {
        matches!(
            owner,
            Owner::Node(N::BlockStatement(_) | N::FunctionBody(_))
        )
    }

    fn is_property_like(&self, node: Option<N<'a>>) -> bool {
        match node {
            Some(
                N::PropertyDefinition(member)
                | N::MethodDefinition(member)
                | N::AccessorProperty(member),
            ) => !self.is_private_member_of_babel(member),
            Some(N::FormalParameter(param)) => param.is_parameter_property(),
            _ => false,
        }
    }

    fn is_function_like(&self, node: N<'a>) -> bool {
        match node {
            N::Function(func) => func.has_body() || !matches!(func.owner(), Node::Stmt(_)),
            N::MethodDefinition(member) => !self.is_private_member_of_babel(member),
            N::ObjectProperty(_) => self.is_babel() && self.is_object_method(node),
            _ => false,
        }
    }

    fn is_real_function_like(&self, node: N<'a>) -> bool {
        match node {
            N::ArrowFunctionExpression(_)
            | N::Function(_)
            | N::TSCallSignatureDeclaration(_)
            | N::TSConstructSignatureDeclaration(_)
            | N::TSMethodSignature(_)
            | N::TSConstructorType(_)
            | N::TSFunctionType(_) => true,
            N::MethodDefinition(member) => {
                self.is_babel() && !self.is_private_member_of_babel(member)
            }
            N::ObjectProperty(_) => self.is_babel() && self.is_object_method(node),
            _ => false,
        }
    }

    /// The `{ .. }` of a function.
    fn body_of_function(&self, func: Func<'a>) -> Option<Owner<'a>> {
        matches!(func.body(), FnBody::Block(_)).then_some(Owner::Node(N::FunctionBody(func)))
    }

    /// The first of the statements of a block or of the members of the body of a class or an interface that is not an
    /// empty statement. Babel has the directives somewhere else.
    fn first_child_of_block(&self, owner: Owner<'a>) -> Option<Owner<'a>> {
        let first_statement = |statements: List<'a, Stmt<'a>>| {
            (statements.iter())
                .find(|statement| {
                    statement.tag() != StmtTag::Empty
                        && !(self.is_babel() && statement.directive().is_some())
                })
                .map(|statement| self.owner_of_stmt(statement))
        };
        let first_member = |members: List<'a, Member<'a>>| {
            members
                .first()
                .map(|member| Owner::Node(member.as_ast_nodes()))
        };
        match owner {
            Owner::Node(N::BlockStatement(statement)) => first_statement(statement.as_block()?),
            Owner::Node(N::FunctionBody(func)) => first_statement(func.body_statements()?),
            Owner::Node(N::ClassBody(class)) => first_member(class.members()),
            Owner::Node(N::TSInterfaceBody(statement)) => {
                first_member(statement.as_interface()?.members())
            }
            _ => None,
        }
    }

    fn add_block_statement_first_comment(&self, owner: Owner<'a>) -> Handled<'a> {
        match self.first_child_of_block(owner) {
            Some(first) => leading(first),
            None => dangling(owner),
        }
    }

    fn add_block_or_not_comment(&self, owner: Owner<'a>) -> Handled<'a> {
        match self.is_block_statement(owner) {
            true => self.add_block_statement_first_comment(owner),
            false => leading(owner),
        }
    }
}

// ───────────────────────────── attach.js ─────────────────────────────

struct Attacher<'a, 'ctx> {
    tree: Tree<'a, 'ctx>,
    locator: NodeLocator<'a>,
    decorated_comments: Vec<DecoratedComment<'a>>,
    attached: Attached<'a>,
    is_unignored: bool,
    is_program_empty: bool,
    /// From the end of what precedes the last comment to the start of what follows it. Every comment in there has the same
    /// nodes around it.
    same_neighbors_span: Span,
}

/// Attaches `comments`, which are those of `file` in the order of the source.
pub(crate) fn attach<'a>(
    file: &'a File<'a>,
    comments: &[Comment],
    options: Options,
) -> Attached<'a> {
    if comments.is_empty() {
        return Attached::default();
    }
    let text = file.text();
    let cast_paren_starts = (comments.iter())
        .filter(|comment| comment.is_type_cast())
        .filter_map(|comment| {
            let after = text.get(comment.span.end as usize..)?;
            let after = strings::trim_js_whitespace_start(after);
            (after.starts_with(b"(")).then(|| (text.len() - after.len()) as u32)
        })
        .collect();
    let mut attacher = Attacher {
        tree: Tree {
            file,
            text,
            comments,
            options,
            cast_paren_starts,
            may_have_decorators: strings::contains_char(text, b'@'),
        },
        locator: NodeLocator {
            file,
            path: vec![Node::File(file)],
        },
        decorated_comments: Vec::with_capacity(comments.len()),
        attached: Attached::default(),
        is_unignored: false,
        is_program_empty: file.body().is_empty(),
        same_neighbors_span: Span::default(),
    };
    attacher.run();
    attacher.attached
}

impl<'a> Attacher<'a, '_> {
    fn decorate_comment(&mut self, comment: Span) -> DecoratedComment<'a> {
        if self.same_neighbors_span.contains(comment)
            && let Some(last) = self.decorated_comments.last()
        {
            return *last;
        }
        let tree = &self.tree;
        let mut decorated_comments = match self.locator.locate(comment) {
            Location::Between {
                list,
                before,
                after,
                same_neighbors_span,
            } => {
                self.same_neighbors_span = same_neighbors_span;
                DecoratedComment {
                    enclosing_node: Some(Owner::Node(list)),
                    preceding_node: before.map(|closest| tree.owner_of_node(closest)),
                    following_node: after.map(|closest| tree.owner_of_node(closest)),
                    is_between_list_elements: !matches!(list, N::ObjectAssignmentTarget(_)),
                }
            }
            Location::In(node) => {
                let decorated_comments = tree.decorate_comment_in_node(node, comment);
                self.same_neighbors_span = Span::new(
                    decorated_comments
                        .preceding_node
                        .map_or(comment.start, |owner| tree.loc_end(owner)),
                    decorated_comments
                        .following_node
                        .map_or(comment.end, |owner| tree.loc_start(owner)),
                );
                decorated_comments
            }
        };
        // A comment in one `${}` of a template does not move to another.
        if let Some(Owner::Node(N::TemplateLiteral(e))) = decorated_comments.enclosing_node
            && let ExprKind::Template(template) = e.kind()
        {
            self.same_neighbors_span = Span::default();
            let expression_index = |start: u32| {
                (1..template.quasi_count())
                    .position(|i| start <= template.quasi_span(i).start + 1)
                    .unwrap_or(0)
            };
            let is_in_same = |owner: &Owner<'a>| {
                expression_index(tree.loc_start(*owner)) == expression_index(comment.start)
            };
            decorated_comments.preceding_node =
                decorated_comments.preceding_node.filter(is_in_same);
            decorated_comments.following_node =
                decorated_comments.following_node.filter(is_in_same);
        }
        // With typescript-estree a comment outside of every statement is in nothing.
        if !tree.is_babel()
            && matches!(
                decorated_comments.enclosing_node,
                Some(Owner::Node(N::Program(_)))
            )
        {
            decorated_comments.enclosing_node = None;
        }
        decorated_comments
    }

    fn is_own_line_comment(&self, index: usize) -> bool {
        let (comments, tree) = (self.tree.comments, &self.tree);
        let mut start = comments[index].span.start;
        let preceding_node = self.decorated_comments[index].preceding_node;
        if preceding_node.is_some() {
            for before in (0..index).rev() {
                if self.decorated_comments[before].preceding_node != preceding_node
                    || !tree.is_all_empty_and_no_line_break(comments[before].span.end, start)
                {
                    break;
                }
                start = comments[before].span.start;
            }
        }
        tree.has_newline_before(start)
    }

    fn is_end_of_line_comment(&self, index: usize) -> bool {
        let (comments, tree) = (self.tree.comments, &self.tree);
        let mut end = comments[index].span.end;
        let following_node = self.decorated_comments[index].following_node;
        if following_node.is_some() {
            for after in index + 1..comments.len() {
                if self.decorated_comments[after].following_node != following_node
                    || !tree.is_all_empty_and_no_line_break(end, comments[after].span.start)
                {
                    break;
                }
                end = comments[after].span.end;
            }
        }
        tree.has_newline_after(end)
    }

    fn run(&mut self) {
        let comments = self.tree.comments;
        let program = self.tree.program();
        for comment in comments {
            let decorated_comments = self.decorate_comment(comment.span);
            self.decorated_comments.push(decorated_comments);
        }
        let unattached = Attachment {
            owner: program,
            placement: Placement::Dangling,
            marker: Marker::None,
            is_unignored: false,
        };
        self.attached.attachments = vec![unattached; comments.len()];

        let mut ties_to_break: Vec<usize> = Vec::new();
        for (index, comment) in comments.iter().enumerate() {
            let DecoratedComment {
                enclosing_node,
                preceding_node,
                following_node,
                is_between_list_elements,
            } = self.decorated_comments[index];
            let text_position = if self.is_own_line_comment(index) {
                TextPosition::OwnLine
            } else if self.is_end_of_line_comment(index) {
                TextPosition::EndOfLine
            } else {
                TextPosition::Remaining
            };
            let context = Context {
                comment: *comment,
                enclosing_node,
                preceding_node,
                following_node,
                text_position,
                is_last_comment: index + 1 == comments.len(),
            };
            self.is_unignored = false;
            // No handler has anything to say about a comment between two elements of a list: each asks for another kind of
            // node around the comment, or for a type next to it.
            let skips_handlers = is_between_list_elements
                && !comment.looks_like_type_cast()
                && !self.is_program_empty;
            let handled = match text_position {
                _ if skips_handlers => None,
                TextPosition::OwnLine => self.handle_own_line_comment(&context),
                TextPosition::EndOfLine => self.handle_end_of_line_comment(&context),
                TextPosition::Remaining => self.handle_remaining_comment(&context),
            };
            let in_enclosing = || dangling(enclosing_node.unwrap_or(program));
            let handled = handled.or_else(|| match text_position {
                TextPosition::OwnLine => (following_node.and_then(leading))
                    .or_else(|| preceding_node.and_then(trailing))
                    .or_else(in_enclosing),
                TextPosition::EndOfLine => (preceding_node.and_then(trailing))
                    .or_else(|| following_node.and_then(leading))
                    .or_else(in_enclosing),
                TextPosition::Remaining if preceding_node.is_some() && following_node.is_some() => {
                    None
                }
                TextPosition::Remaining => (preceding_node.and_then(trailing))
                    .or_else(|| following_node.and_then(leading))
                    .or_else(in_enclosing),
            });
            match handled {
                Some((owner, placement, marker)) => {
                    let only_nearby =
                        [enclosing_node, preceding_node, following_node].contains(&Some(owner));
                    if !only_nearby && owner != program {
                        self.attached
                            .relocated_owner_starts
                            .push(self.tree.loc_start(owner));
                    }
                    self.attached.attachments[index] = Attachment {
                        owner,
                        placement,
                        marker,
                        is_unignored: self.is_unignored,
                    };
                }
                None => {
                    if let Some(last) = ties_to_break.last()
                        && self.decorated_comments[*last].following_node != following_node
                    {
                        self.break_ties(&mut ties_to_break);
                    }
                    self.attached.attachments[index].is_unignored = self.is_unignored;
                    ties_to_break.push(index);
                }
            }
        }
        self.break_ties(&mut ties_to_break);
        for owner in &self.attached.ignored {
            self.attached
                .relocated_owner_starts
                .push(self.tree.loc_start(*owner));
        }
        if !self.attached.relocated_owner_starts.is_sorted() {
            crate::sort::sort(&mut self.attached.relocated_owner_starts);
        }
    }

    fn break_ties(&mut self, ties_to_break: &mut Vec<usize>) {
        let Some(first) = ties_to_break.first() else {
            return;
        };
        let DecoratedComment {
            preceding_node: Some(preceding_node),
            following_node: Some(following_node),
            ..
        } = self.decorated_comments[*first]
        else {
            ties_to_break.clear();
            return;
        };
        let mut gap_end = self.tree.loc_start(following_node);
        let mut first_leading = ties_to_break.len();
        while first_leading > 0 {
            let comment = self.tree.comments[ties_to_break[first_leading - 1]];
            let same_neighbors_span = self.tree.text_between(comment.span.end, gap_end);
            let is_gap = strings::split(same_neighbors_span, b"(")
                .all(|piece| strings::trim_js_whitespace_start(piece).is_empty());
            if !is_gap {
                break;
            }
            gap_end = comment.span.start;
            first_leading -= 1;
        }
        for (i, index) in ties_to_break.iter().enumerate() {
            let attachment = &mut self.attached.attachments[*index];
            (attachment.owner, attachment.placement) = match i < first_leading {
                true => (preceding_node, Placement::Trailing),
                false => (following_node, Placement::Leading),
            };
        }
        ties_to_break.clear();
    }
}

// ───────────────────────────── handle-comments.js ─────────────────────────────

impl<'a> Attacher<'a, '_> {
    fn handle_own_line_comment(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        self.handle_comment_in_empty_parens(ctx)
            .or_else(|| self.handle_ignore_comments(ctx))
            .or_else(|| self.handle_closure_type_cast_comments(ctx))
            .or_else(|| self.handle_conditional_expression_comments(ctx))
            .or_else(|| self.handle_last_function_parameter_comments(ctx))
            .or_else(|| self.handle_member_expression_comments(ctx))
            .or_else(|| self.handle_if_statement_comments(ctx))
            .or_else(|| self.handle_while_like_comments(ctx))
            .or_else(|| self.handle_switch_statement_comments(ctx))
            .or_else(|| self.handle_try_statement_comments(ctx))
            .or_else(|| self.handle_class_comments(ctx))
            .or_else(|| self.handle_for_x_statement_comments(ctx))
            .or_else(|| self.handle_union_type_comments(ctx))
            .or_else(|| self.handle_only_comments(ctx))
            .or_else(|| self.handle_module_specifiers_comments(ctx))
            .or_else(|| self.handle_assignment_pattern_comments(ctx))
            .or_else(|| self.handle_method_name_comments(ctx))
            .or_else(|| self.handle_labeled_statement_comments(ctx))
            .or_else(|| self.handle_nested_conditional_expression_comments(ctx))
            .or_else(|| self.handle_comments_in_destructuring_pattern(ctx))
            .or_else(|| self.handle_ts_mapped_type_comments(ctx))
            .or_else(|| self.handle_binary_cast_expression_comment(ctx))
            .or_else(|| self.handle_union_type_leading_comments(ctx))
            .or_else(|| self.handle_sequence_expression_leading_comment(ctx))
    }

    fn handle_end_of_line_comment(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        self.handle_comment_in_empty_parens(ctx)
            .or_else(|| self.handle_closure_type_cast_comments(ctx))
            .or_else(|| self.handle_last_function_parameter_comments(ctx))
            .or_else(|| self.handle_conditional_expression_comments(ctx))
            .or_else(|| self.handle_module_specifiers_comments(ctx))
            .or_else(|| self.handle_if_statement_comments(ctx))
            .or_else(|| self.handle_while_like_comments(ctx))
            .or_else(|| self.handle_switch_statement_comments(ctx))
            .or_else(|| self.handle_try_statement_comments(ctx))
            .or_else(|| self.handle_class_comments(ctx))
            .or_else(|| self.handle_for_x_statement_comments(ctx))
            .or_else(|| self.handle_labeled_statement_comments(ctx))
            .or_else(|| self.handle_call_expression_comments(ctx))
            .or_else(|| self.handle_property_comments(ctx))
            .or_else(|| self.handle_only_comments(ctx))
            .or_else(|| self.handle_assignment_like_comments(ctx))
            .or_else(|| self.handle_switch_default_case_comments(ctx))
            .or_else(|| self.handle_last_union_element_in_expression(ctx))
            .or_else(|| self.handle_last_binary_operator_operand(ctx))
            .or_else(|| self.handle_comments_in_destructuring_pattern(ctx))
            .or_else(|| self.handle_ts_mapped_type_comments(ctx))
            .or_else(|| self.handle_arrow_expression_comments(ctx))
            .or_else(|| self.handle_parenthesized_expression_trailing_comment(ctx))
            .or_else(|| self.handle_property_signature_comments(ctx))
            .or_else(|| self.handle_binary_cast_expression_comment(ctx))
            .or_else(|| self.handle_tagged_template_expression_comments(ctx))
            .or_else(|| self.handle_sequence_expression_leading_comment(ctx))
    }

    fn handle_remaining_comment(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        self.handle_comment_in_empty_parens(ctx)
            .or_else(|| self.handle_ignore_comments(ctx))
            .or_else(|| self.handle_closure_type_cast_comments(ctx))
            .or_else(|| self.handle_if_statement_comments(ctx))
            .or_else(|| self.handle_while_like_comments(ctx))
            .or_else(|| self.handle_switch_statement_comments(ctx))
            .or_else(|| self.handle_for_x_statement_comments(ctx))
            .or_else(|| self.handle_method_name_comments(ctx))
            .or_else(|| self.handle_only_comments(ctx))
            .or_else(|| self.handle_assignment_like_comments(ctx))
            .or_else(|| self.handle_ts_mapped_type_comments(ctx))
            .or_else(|| self.handle_comment_after_arrow_params(ctx))
            .or_else(|| self.handle_function_name_comments(ctx))
            .or_else(|| self.handle_ts_function_trailing_comments(ctx))
            .or_else(|| self.handle_parenthesized_expression_trailing_comment(ctx))
            .or_else(|| self.handle_property_signature_comments(ctx))
            .or_else(|| self.handle_binary_cast_expression_comment(ctx))
            .or_else(|| self.handle_union_type_leading_comments(ctx))
            .or_else(|| self.handle_sequence_expression_leading_comment(ctx))
    }

    /// `node.prettierIgnore = true; comment.unignore = true;`
    fn ignore_instead_of_owner(&mut self, owner: Owner<'a>) {
        self.attached.ignored.push(owner);
        self.is_unignored = true;
    }

    fn is_prettier_ignore_comment(&self, ctx: &Context<'a>) -> bool {
        ctx.comment.is_ignore_comment() && !self.is_unignored
    }

    fn handle_closure_type_cast_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let following_node = ctx
            .following_node
            .filter(|_| ctx.comment.looks_like_type_cast())?;
        if let (Some(N::ConditionalExpression(_)), Owner::Node(N::LogicalExpression(e))) =
            (ctx.enclosing_node(), following_node)
            && let ExprKind::Binary {
                op: BinOp::Nullish,
                left,
                ..
            } = e.kind()
        {
            return leading(self.tree.owner_of_expr(left));
        }
        leading(following_node)
    }

    fn handle_try_statement_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let following_node = ctx.following_node?;
        match ctx.enclosing_node()? {
            N::TryStatement(_) => {}
            N::CatchClause(_) => {
                if let Some(preceding_node) = ctx.preceding_node {
                    return trailing(preceding_node);
                }
            }
            _ => return None,
        }
        match following_node {
            _ if tree.is_block_statement(following_node) => {
                tree.add_block_statement_first_comment(following_node)
            }
            Owner::Node(N::CatchClause(statement)) => match statement.kind() {
                StmtKind::Try {
                    handler: Some(handler),
                    ..
                } => tree.add_block_or_not_comment(tree.owner_of_stmt(handler)),
                _ => None,
            },
            _ => None,
        }
    }

    fn handle_member_expression_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let is_member_expression = matches!(
            ctx.enclosing_node(),
            Some(
                N::StaticMemberExpression(_)
                    | N::ComputedMemberExpression(_)
                    | N::PrivateFieldExpression(_)
            )
        );
        (is_member_expression && self.tree.is_identifier(ctx.following_node)).then_some(())?;
        leading(ctx.enclosing_node?)
    }

    fn handle_nested_conditional_expression_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let is_nested = tree.options.experimental_ternaries
            && tree.is_conditional(ctx.enclosing_node)
            && tree.is_conditional(ctx.following_node);
        is_nested.then_some(())?;
        dangling(ctx.enclosing_node?)
    }

    fn handle_conditional_expression_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        if !tree.is_conditional(ctx.enclosing_node) {
            return None;
        }
        let is_same_line_as_preceding_node = ctx.preceding_node.is_some_and(|preceding_node| {
            !tree.has_newline_between(tree.loc_end(preceding_node), ctx.comment.span.start)
        });
        if is_same_line_as_preceding_node {
            return None;
        }
        let (enclosing_node, following_node) = (ctx.enclosing_node?, ctx.following_node?);
        let alternate = match ctx.enclosing_node()? {
            N::ConditionalExpression(e) => match e.kind() {
                ExprKind::Cond { no, .. } => Some(tree.owner_of_expr(no)),
                _ => None,
            },
            N::TSConditionalType(ty) => match ty.kind() {
                TypeKind::Cond { no, .. } => Some(tree.owner_of_type(no)),
                _ => None,
            },
            _ => None,
        };
        if tree.options.experimental_ternaries
            && alternate == Some(following_node)
            && !tree.is_single_line_block_comment(ctx.comment)
        {
            return dangling(enclosing_node);
        }
        leading(following_node)
    }

    fn handle_class_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing_node = ctx.enclosing_node?;
        struct Head<'a> {
            last_decorator: Option<Owner<'a>>,
            id: Option<Owner<'a>>,
            type_parameters: Option<Owner<'a>>,
            super_class: Option<Owner<'a>>,
            implements: Option<Owner<'a>>,
            extends: Option<Owner<'a>>,
            body: Owner<'a>,
        }
        let head = match ctx.enclosing_node()? {
            N::Class(class) => Head {
                last_decorator: class
                    .decorators()
                    .last()
                    .map(|e| Owner::Node(N::Decorator(e))),
                id: class.name().map(|ident| tree.name(ident.span(), class)),
                type_parameters: (!class.type_params().is_empty()).then_some(Owner::Node(
                    N::TSTypeParameterDeclaration(Node::Class(class)),
                )),
                super_class: class.extends().map(|e| tree.owner_of_expr(e)),
                implements: class
                    .implements()
                    .first()
                    .map(|ty| Owner::Node(ty.as_ast_nodes())),
                extends: None,
                body: Owner::Node(N::ClassBody(class)),
            },
            N::TSInterfaceDeclaration(statement) => {
                let interface = statement.as_interface()?;
                Head {
                    last_decorator: None,
                    id: Some(tree.name(interface.name().span(), statement)),
                    type_parameters: (!interface.type_params().is_empty()).then_some(Owner::Node(
                        N::TSTypeParameterDeclaration(Node::Stmt(statement)),
                    )),
                    super_class: None,
                    implements: None,
                    extends: interface
                        .extends()
                        .first()
                        .map(|ty| Owner::Node(ty.as_ast_nodes())),
                    body: Owner::Node(N::TSInterfaceBody(statement)),
                }
            }
            _ => return None,
        };
        if let Some(last) = head.last_decorator
            && !matches!(ctx.following_node, Some(Owner::Node(N::Decorator(_))))
        {
            return trailing(last);
        }
        if ctx.following_node == Some(head.body) {
            return tree.add_block_statement_first_comment(head.body);
        }
        let (preceding_node, following_node) = (ctx.preceding_node?, ctx.following_node?);
        let is_head =
            Some(preceding_node) == head.id || Some(preceding_node) == head.type_parameters;
        if Some(following_node) == head.super_class && is_head {
            return trailing(preceding_node);
        }
        let clauses = [
            (head.implements, &b"implements"[..], Marker::Implements),
            (head.extends, b"extends", Marker::Extends),
        ];
        for (first, keyword, marker) in clauses {
            let Some(first) = first.filter(|owner| *owner == following_node) else {
                continue;
            };
            if !is_head && Some(preceding_node) != head.super_class {
                return Some((enclosing_node, Placement::Dangling, marker));
            }
            if tree.only_code_between(ctx.comment.span.end, tree.loc_start(first)) == keyword {
                return trailing(preceding_node);
            }
        }
        None
    }

    /// The `key` of a member or a property.
    fn key_owner(&self, node: N<'a>) -> Option<Owner<'a>> {
        let (key, computed, of) = match node {
            N::MethodDefinition(member)
            | N::PropertyDefinition(member)
            | N::AccessorProperty(member)
            | N::TSPropertySignature(member)
            | N::TSMethodSignature(member) => {
                (member.key(), member.computed_key(), Node::Member(member))
            }
            N::ObjectProperty(prop) => (prop.key(), prop.computed_key(), Node::Prop(prop)),
            _ => return None,
        };
        match computed {
            Some(e) => Some(self.tree.owner_of_expr(e)),
            None => Some(self.tree.name(key?.span(self.tree.file), of)),
        }
    }

    fn handle_method_name_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let next_character = || tree.next_character(ctx.comment.span.end);
        let enclosing_node = ctx.enclosing_node();
        // Only the trees of ESTree need this: `obj = { fn /*comment*/() {} };`
        if let (Some(enclosing_node), Some(preceding_node)) = (enclosing_node, ctx.preceding_node)
            && match enclosing_node {
                N::ObjectProperty(_) => !tree.is_babel(),
                N::MethodDefinition(member) => member.func().is_some_and(|func| !func.has_body()),
                _ => false,
            }
            && tree.is_identifier(Some(preceding_node))
            && self.key_owner(enclosing_node) == Some(preceding_node)
            && next_character() == Some(b'(')
            && tree.next_character(tree.loc_end(preceding_node)) != Some(b':')
        {
            return trailing(preceding_node);
        }
        if tree.is_property_like(enclosing_node)
            && ctx.following_node.is_none()
            && ctx.text_position == TextPosition::Remaining
        {
            return match next_character() {
                Some(b'(') => trailing(ctx.preceding_node?),
                _ => trailing(ctx.enclosing_node?),
            };
        }
        if matches!(ctx.preceding_node, Some(Owner::Node(N::Decorator(_))))
            && tree.is_property_like(enclosing_node)
            && (ctx.comment.is_line() || ctx.text_position == TextPosition::OwnLine)
        {
            return trailing(ctx.preceding_node?);
        }
        None
    }

    fn handle_function_name_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing_node, preceding_node) = (ctx.enclosing_node()?, ctx.preceding_node?);
        let is_before_parameters = tree.next_character(ctx.comment.span.end) == Some(b'(');
        (is_before_parameters && tree.is_function_like(enclosing_node)).then_some(())?;
        trailing(preceding_node)
    }

    fn handle_comment_after_arrow_params(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        matches!(ctx.enclosing_node()?, N::ArrowFunctionExpression(_)).then_some(())?;
        let index = tree.next_character_index(ctx.comment.span.end);
        (tree.text_between(index, index + 2) == b"=>").then_some((
            ctx.enclosing_node?,
            Placement::Dangling,
            Marker::CommentBeforeArrow,
        ))
    }

    fn is_in_argument_or_parameter_parentheses(&self, owner: Owner<'a>, comment: Span) -> bool {
        let tree = &self.tree;
        comment.start < tree.loc_end(owner)
            && comment.end > tree.loc_start(owner)
            && tree
                .text_between(0, tree.end_of_code_before(comment.start, 0))
                .ends_with(b"(")
            && tree.next_character(comment.end) == Some(b')')
    }

    fn handle_comment_in_empty_parens(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing_node, node) = (ctx.enclosing_node?, ctx.enclosing_node()?);
        if let N::CallExpression(e) | N::NewExpression(e) = node
            && let ExprKind::Call(call) | ExprKind::New(call) = e.kind()
            && call.args().is_empty()
            && self.is_in_argument_or_parameter_parentheses(enclosing_node, ctx.comment.span)
        {
            return dangling(enclosing_node);
        }
        let func = function_of_node(node).filter(|func| !has_parameters(*func))?;
        let function = match tree.is_real_function_like(node) {
            true => enclosing_node,
            false if matches!(node, N::MethodDefinition(_)) || tree.is_object_method(node) => {
                Owner::Node(N::Function(func))
            }
            false => return None,
        };
        self.is_in_argument_or_parameter_parentheses(function, ctx.comment.span)
            .then_some(())?;
        dangling(function)
    }

    fn handle_last_function_parameter_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let enclosing_node = ctx.enclosing_node()?;
        let has_no_body = || matches!(enclosing_node, N::MethodDefinition(member) if member.func().is_some_and(|func| !func.has_body()));
        if let Some(preceding_node) = ctx.preceding_node
            && matches!(
                preceding_node,
                Owner::Node(
                    N::FormalParameter(_) | N::FormalParameterRest(_) | N::TSThisParameter(_)
                )
            )
            && (tree.is_real_function_like(enclosing_node) || has_no_body())
            && tree.next_character(ctx.comment.span.end) == Some(b')')
        {
            return trailing(preceding_node);
        }
        // Between the `)` of the parameters and the body.
        let following_node = ctx.following_node?;
        if !ctx.comment.is_block()
            && tree.is_function_like(enclosing_node)
            && function_of_node(enclosing_node).and_then(|func| tree.body_of_function(func))
                == Some(following_node)
            && tree.next_character_index(ctx.comment.span.end) == tree.loc_start(following_node)
        {
            return tree.add_block_statement_first_comment(following_node);
        }
        None
    }

    fn handle_labeled_statement_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        matches!(ctx.enclosing_node()?, N::LabeledStatement(_)).then_some(())?;
        leading(ctx.enclosing_node?)
    }

    fn handle_call_expression_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (N::CallExpression(e) | N::NewExpression(e)) = ctx.enclosing_node()? else {
            return None;
        };
        let (ExprKind::Call(call) | ExprKind::New(call)) = e.kind() else {
            return None;
        };
        if ctx.preceding_node != Some(tree.owner_of_expr(call.callee())) {
            return None;
        }
        let first = call.args().first()?;
        // `isInsideCallOrNewExpressionParentheses`
        let closing = e.span().end.checked_sub(1)?;
        if tree.text.get(closing as usize) != Some(&b')') || ctx.comment.span.end > closing {
            return None;
        }
        let before_parenthesis = (call.type_args().angle_brackets_span()).map_or_else(
            || tree.loc_end(tree.owner_of_expr(call.callee())),
            |brackets| brackets.end,
        );
        let opening = tree.index_of(b"(", before_parenthesis);
        (opening != -1 && i64::from(ctx.comment.span.start) > opening).then_some(())?;
        leading(tree.owner_of_expr(first))
    }

    fn handle_union_type_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        if self.tree.is_union_type(ctx.enclosing_node) {
            if self.is_prettier_ignore_comment(ctx)
                && let Some(following_node) = ctx.following_node
            {
                self.ignore_instead_of_owner(following_node);
            }
            return trailing(ctx.preceding_node?);
        }
        if self.tree.is_union_type(ctx.following_node) && self.is_prettier_ignore_comment(ctx) {
            let first = self.tree.types(ctx.following_node?).next()?;
            self.ignore_instead_of_owner(first);
        }
        None
    }

    fn handle_property_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let node = ctx.enclosing_node()?;
        let is_object_property = matches!(
            node,
            N::ObjectProperty(_)
                | N::BindingProperty(_)
                | N::AssignmentTargetPropertyIdentifier(_)
                | N::AssignmentTargetPropertyProperty(_)
        ) && !self.tree.is_object_method(node);
        is_object_property.then_some(())?;
        leading(ctx.enclosing_node?)
    }

    fn handle_only_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        if !self.is_program_empty {
            return None;
        }
        let program = self.tree.program();
        match ctx.is_last_comment {
            true => dangling(program),
            false => leading(program),
        }
    }

    fn handle_module_specifiers_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let is_after_specifier = match ctx.enclosing_node()? {
            N::ImportSpecifier(_) | N::ExportSpecifier(_) => return leading(ctx.enclosing_node?),
            N::ImportDeclaration(_) => {
                matches!(ctx.preceding_node, Some(Owner::Node(N::ImportSpecifier(_))))
            }
            N::ExportNamedDeclaration(_) => {
                matches!(ctx.preceding_node, Some(Owner::Node(N::ExportSpecifier(_))))
            }
            _ => false,
        };
        (is_after_specifier && self.tree.has_newline_after(ctx.comment.span.end)).then_some(())?;
        trailing(ctx.preceding_node?)
    }

    fn handle_assignment_pattern_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let is_assignment_pattern = match ctx.enclosing_node()? {
            N::AssignmentPattern(_) | N::AssignmentTargetWithDefault(_) => true,
            N::FormalParameter(param) => {
                param.default().is_some() && !param.is_parameter_property()
            }
            _ => false,
        };
        is_assignment_pattern.then_some(())?;
        leading(ctx.enclosing_node?)
    }

    fn should_attach_to_union_type_first_element(
        &self,
        owner: Owner<'a>,
        ctx: &Context<'a>,
    ) -> bool {
        let tree = &self.tree;
        tree.is_union_type(Some(owner))
            && tree.is_single_line_block_comment(ctx.comment)
            && !self.is_prettier_ignore_comment(ctx)
            && (ctx.comment.span.end..tree.loc_start(owner)).all(|at| {
                tree.comment_around(at).is_some()
                    || tree.text.get(at as usize).is_some_and(|b| is_blank(*b))
            })
    }

    fn add_leading_comment_to_possible_union_type(
        &self,
        owner: Owner<'a>,
        ctx: &Context<'a>,
    ) -> Handled<'a> {
        match self.should_attach_to_union_type_first_element(owner, ctx) {
            true => leading(self.tree.types(owner).next()?),
            false => leading(owner),
        }
    }

    fn handle_assignment_like_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing_node, following_node) = (ctx.enclosing_node()?, ctx.following_node?);
        let alias = match enclosing_node {
            N::TSTypeAliasDeclaration(statement) => match statement.kind() {
                StmtKind::TypeAlias(alias) => Some(alias),
                _ => None,
            },
            N::VariableDeclarator(_) | N::AssignmentExpression(_) => None,
            _ => return None,
        };
        let is_complex = matches!(
            following_node,
            Owner::Node(
                N::ObjectExpression(_)
                    | N::ArrayExpression(_)
                    | N::TemplateLiteral(_)
                    | N::TaggedTemplateExpression(_)
                    | N::TSTypeLiteral(_)
            )
        );
        if ctx.text_position == TextPosition::EndOfLine && (is_complex || ctx.comment.is_block()) {
            return self.add_leading_comment_to_possible_union_type(following_node, ctx);
        }
        let equals = tree.index_of(b"=", alias?.name().span().end);
        (i64::from(ctx.comment.span.start) >= equals).then_some(())?;
        self.add_leading_comment_to_possible_union_type(following_node, ctx)
    }

    fn handle_tagged_template_expression_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let N::TaggedTemplateExpression(e) = ctx.enclosing_node()? else {
            return None;
        };
        let ExprKind::TaggedTemplate(call) = e.kind() else {
            return None;
        };
        let quasi = self.tree.owner_of_expr(call.template()?);
        leading(ctx.following_node.filter(|owner| *owner == quasi)?)
    }

    fn handle_ts_function_trailing_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        if ctx.following_node.is_some() {
            return None;
        }
        let node = ctx.enclosing_node()?;
        let func = match node {
            N::TSMethodSignature(member) => member.func()?,
            N::MethodDefinition(member) => member.func().filter(|func| !func.has_body())?,
            N::Function(func) if !func.has_body() && matches!(func.owner(), Node::Stmt(_)) => func,
            _ => return None,
        };
        // `TSAbstractMethodDefinition` has no `returnType` of its own.
        let return_type = (func.return_type())
            .filter(|_| !matches!(node, N::MethodDefinition(_)))
            .map(|ty| Owner::Node(N::TSTypeAnnotation(ty)));
        let is_after_head = (ctx.preceding_node.is_none() || ctx.preceding_node != return_type)
            && tree.next_character(ctx.comment.span.end) == Some(b';');
        is_after_head.then_some(())?;
        trailing(ctx.enclosing_node?)
    }

    fn handle_ignore_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let N::TSMappedType(ty) = ctx.enclosing_node()? else {
            return None;
        };
        let TypeKind::Mapped(mapped) = ty.kind() else {
            return None;
        };
        let key = self.tree.name(mapped.param().name().span(), mapped.param());
        if !self.is_prettier_ignore_comment(ctx) || ctx.following_node != Some(key) {
            return None;
        }
        self.ignore_instead_of_owner(ctx.enclosing_node?);
        Some((
            ctx.enclosing_node?,
            Placement::Dangling,
            Marker::InIgnoredNode,
        ))
    }

    fn handle_ts_mapped_type_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        matches!(ctx.enclosing_node()?, N::TSMappedType(_)).then_some(())?;
        let bracket = tree.index_of(b"[", tree.loc_start(ctx.enclosing_node?));
        (i64::from(ctx.comment.span.end) < bracket).then_some(())?;
        dangling(ctx.enclosing_node?)
    }

    fn handle_switch_default_case_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let N::SwitchCase(case) = ctx.enclosing_node()? else {
            return None;
        };
        let following_node = ctx.following_node?;
        if case.test().is_some()
            || case
                .body()
                .first()
                .map(|statement| tree.owner_of_stmt(statement))
                != Some(following_node)
        {
            return None;
        }
        match tree.is_block_statement(following_node) && ctx.comment.is_line() {
            true => tree.add_block_statement_first_comment(following_node),
            false => dangling(ctx.enclosing_node?),
        }
    }

    fn handle_last_union_element_in_expression(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let preceding_node = ctx
            .preceding_node
            .filter(|owner| tree.is_union_type(Some(*owner)))?;
        match ctx.enclosing_node()? {
            N::TSArrayType(_) if ctx.following_node.is_none() => {}
            N::TSIntersectionType(_) | N::TSUnionType(_) => {}
            _ => return None,
        }
        trailing(tree.types(preceding_node).next_back()?)
    }

    fn handle_comments_in_destructuring_pattern(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        // Here the type annotation of a pattern is behind the pattern, not in it. So a comment before the `}` is in the
        // pattern alone, and goes where Prettier puts it without a handler.
        let is_between = matches!(
            ctx.preceding_node?,
            Owner::Node(N::ObjectPattern(_) | N::ArrayPattern(_))
        ) && matches!(ctx.following_node?, Owner::Node(N::TSTypeAnnotation(_)));
        is_between.then_some(())?;
        leading(ctx.following_node?)
    }

    fn handle_last_binary_operator_operand(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let N::UnaryExpression(unary) = ctx.enclosing_node()? else {
            return None;
        };
        let Owner::Node(N::LogicalExpression(e) | N::BinaryExpression(e)) = ctx.preceding_node?
        else {
            return None;
        };
        if ctx.following_node.is_some() {
            return None;
        }
        let ExprKind::Binary { right, .. } = e.kind() else {
            return None;
        };
        let ExprKind::Unary { operand, .. } = unary.kind() else {
            return None;
        };
        let right = tree.owner_of_expr(right);
        let right_start = tree.loc_start(right);
        let argument_start = tree.loc_start(tree.owner_of_expr(operand));
        let is_on_line_of_right = tree.has_newline_between(argument_start, right_start)
            && tree.is_single_line_comment(ctx.comment)
            && !tree.has_newline_between(right_start, ctx.comment.span.start);
        is_on_line_of_right.then_some(())?;
        trailing(right)
    }

    fn handle_property_signature_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (enclosing_node, following_node) = (ctx.enclosing_node()?, ctx.following_node?);
        let (key_end, has_value) = match enclosing_node {
            N::TSPropertySignature(member) => (
                self.key_owner(enclosing_node).map(|key| tree.loc_end(key)),
                member.ty().is_some(),
            ),
            N::TSMappedType(ty) => match ty.kind() {
                TypeKind::Mapped(mapped) => (
                    (mapped.name_type())
                        .or_else(|| mapped.param().constraint())
                        .map(|ty| ty.span().end),
                    mapped.ty().is_some(),
                ),
                _ => return None,
            },
            _ => return None,
        };
        if ctx.text_position == TextPosition::EndOfLine
            && matches!(
                following_node,
                Owner::Node(N::TSUnionType(_) | N::TSIntersectionType(_))
            )
        {
            return leading(following_node);
        }
        if has_value && ctx.comment.is_block() {
            let colon = tree.index_of(b":", key_end?);
            if colon < i64::from(ctx.comment.span.start) {
                return self.add_leading_comment_to_possible_union_type(following_node, ctx);
            }
        }
        None
    }

    fn handle_binary_cast_expression_comment(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (N::TSAsExpression(e) | N::TSSatisfiesExpression(e)) = ctx.enclosing_node()? else {
            return None;
        };
        let (ExprKind::As { expr, .. }
        | ExprKind::Satisfies { expr, .. }
        | ExprKind::AsConst(expr)) = e.kind()
        else {
            return None;
        };
        if ctx.preceding_node != Some(tree.owner_of_expr(expr))
            || tree.is_single_line_comment(ctx.comment)
        {
            return None;
        }
        match ctx.following_node {
            Some(following_node) => leading(following_node),
            None => trailing(ctx.enclosing_node?),
        }
    }

    /// The `body` of an arrow function.
    fn body_of_arrow(&self, func: Func<'a>) -> Owner<'a> {
        match func.body() {
            FnBody::Expr(e) => self.tree.owner_of_expr(e),
            _ => Owner::Node(N::FunctionBody(func)),
        }
    }

    fn handle_arrow_expression_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let N::ArrowFunctionExpression(func) = ctx.enclosing_node()? else {
            return None;
        };
        let following_node = ctx
            .following_node
            .filter(|_| ctx.preceding_node.is_some())?;
        let body_start = tree.loc_start(self.body_of_arrow(func));
        let is_before_arrow =
            i64::from(ctx.comment.span.end) < tree.last_index_of(b"=>", body_start);
        match is_before_arrow {
            true => None,
            false => tree.add_block_or_not_comment(following_node),
        }
    }

    fn right_of_assignment(&self, node: N<'a>) -> Option<Owner<'a>> {
        match node {
            N::AssignmentExpression(e) => match e.kind() {
                ExprKind::Assign { value, .. } => Some(self.tree.owner_of_expr(value)),
                _ => None,
            },
            _ => None,
        }
    }

    fn enclosing_assignment_chain_expression_statement(
        &self,
        owner: Owner<'a>,
    ) -> Option<Owner<'a>> {
        let mut child = owner;
        loop {
            let ancestor = self.tree.parent(child)?;
            let Owner::Node(node) = ancestor else {
                return None;
            };
            match node {
                N::AssignmentExpression(_) if self.right_of_assignment(node) == Some(child) => {}
                N::ArrowFunctionExpression(func) if self.body_of_arrow(func) == child => {}
                N::ExpressionStatement(ExpressionStatement::Stmt(_)) => return Some(ancestor),
                _ => return None,
            }
            child = ancestor;
        }
    }

    fn handle_sequence_expression_leading_comment(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        matches!(ctx.enclosing_node()?, N::SequenceExpression(_)).then_some(())?;
        (ctx.preceding_node.is_none() && ctx.following_node.is_some()).then_some(())?;
        leading(ctx.enclosing_node?)
    }

    fn handle_parenthesized_expression_trailing_comment(
        &mut self,
        ctx: &Context<'a>,
    ) -> Handled<'a> {
        let tree = &self.tree;
        if ctx.following_node.is_some() {
            return None;
        }
        let (enclosing_node, node, preceding_node) = (
            ctx.enclosing_node?,
            ctx.enclosing_node()?,
            ctx.preceding_node?,
        );
        if matches!(node, N::ExpressionStatement(ExpressionStatement::Stmt(_))) {
            return trailing(enclosing_node);
        }
        let is_assignment = matches!(preceding_node, Owner::Node(N::AssignmentExpression(_)));
        let is_arrow = matches!(preceding_node, Owner::Node(N::ArrowFunctionExpression(_)));
        let is_right = self.right_of_assignment(node) == Some(preceding_node);
        let is_body = matches!(node, N::ArrowFunctionExpression(func) if self.body_of_arrow(func) == preceding_node);
        if ((is_assignment && is_right) || (is_arrow && is_body))
            && let Some(statement) =
                self.enclosing_assignment_chain_expression_statement(enclosing_node)
        {
            return trailing(statement);
        }
        let is_whole_right_side = is_right
            || is_body
            || match node {
                N::VariableDeclarator(declaration) => {
                    declaration.init().map(|e| tree.owner_of_expr(e)) == Some(preceding_node)
                }
                N::ReturnStatement(_) => true,
                _ => false,
            };
        if !is_whole_right_side {
            return None;
        }
        match preceding_node {
            Owner::Node(N::SequenceExpression(e)) => match e.kind() {
                ExprKind::Binary { right, .. } => trailing(tree.owner_of_expr(right)),
                _ => None,
            },
            Owner::Node(assignment @ N::AssignmentExpression(_)) => {
                trailing(self.right_of_assignment(assignment)?)
            }
            _ => None,
        }
    }

    fn handle_union_type_leading_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let following_node = ctx.following_node?;
        (self.should_attach_to_union_type_first_element(following_node, ctx)).then_some(())?;
        leading(self.tree.types(following_node).next()?)
    }

    // ── attach/*.js ──

    fn handle_for_x_statement_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (N::ForStatement(statement)
        | N::ForInStatement(statement)
        | N::ForOfStatement(statement)) = ctx.enclosing_node()?
        else {
            return None;
        };
        let (StmtKind::For { body, .. }
        | StmtKind::ForIn { body, .. }
        | StmtKind::ForOf { body, .. }) = statement.kind()
        else {
            return None;
        };
        let following_node = ctx
            .following_node
            .filter(|owner| *owner == tree.owner_of_stmt(body))?;
        let closing = tree.last_index_of(b")", tree.loc_start(following_node));
        (i64::from(ctx.comment.span.start) > closing).then_some(())?;
        leading(following_node)
    }

    fn handle_if_statement_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let N::IfStatement(statement) = ctx.enclosing_node()? else {
            return None;
        };
        let StmtKind::If { yes, no, .. } = statement.kind() else {
            return None;
        };
        let following_node = ctx.following_node?;
        if tree.next_character(ctx.comment.span.end) == Some(b')') {
            return trailing(ctx.preceding_node?);
        }
        let consequent = tree.owner_of_stmt(yes);
        if following_node == consequent {
            return leading(following_node);
        }
        let preceding_node = ctx.preceding_node.filter(|owner| *owner == consequent)?;
        if Some(following_node) != no.map(|statement| tree.owner_of_stmt(statement)) {
            return None;
        }
        // `handleCommentsBetween`
        let else_token = tree.index_of(b"else", tree.loc_end(preceding_node));
        if i64::from(ctx.comment.span.start) >= else_token {
            return leading(following_node);
        }
        if !tree.is_block_statement(preceding_node)
            && tree.is_single_line_comment(ctx.comment)
            && !tree.has_newline_between(tree.loc_end(preceding_node), ctx.comment.span.start)
        {
            return trailing(preceding_node);
        }
        dangling(ctx.enclosing_node?)
    }

    fn handle_switch_statement_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let N::SwitchStatement(statement) = ctx.enclosing_node()? else {
            return None;
        };
        let StmtKind::Switch { expr, cases } = statement.kind() else {
            return None;
        };
        let is_in_empty_braces = cases.is_empty()
            && ctx.following_node.is_none()
            && ctx.preceding_node == Some(tree.owner_of_expr(expr))
            && tree.next_character(ctx.comment.span.end) == Some(b'}');
        is_in_empty_braces.then_some(())?;
        dangling(ctx.enclosing_node?)
    }

    fn handle_while_like_comments(&mut self, ctx: &Context<'a>) -> Handled<'a> {
        let tree = &self.tree;
        let (N::WhileStatement(statement) | N::WithStatement(statement)) = ctx.enclosing_node()?
        else {
            return None;
        };
        let (StmtKind::While { body, .. } | StmtKind::With { body, .. }) = statement.kind() else {
            return None;
        };
        let following_node = ctx.following_node?;
        if tree.next_character(ctx.comment.span.end) == Some(b')') {
            return trailing(ctx.preceding_node?);
        }
        (following_node == tree.owner_of_stmt(body)).then_some(())?;
        leading(following_node)
    }
}

// ───────────────────────────── for the tests ─────────────────────────────

/// A text_position for each comment: where it is, and what it is attached to. And one for each node that is ignored without owning
/// the comment that says so. The tests compare this with what Prettier does.
pub(crate) fn list<'a>(
    file: &'a File<'a>,
    comments: &[Comment],
    options: Options,
    out: &mut Vec<u8>,
) {
    use std::io::Write;
    let attached = attach(file, comments, options);
    let tree = Tree {
        file,
        text: file.text(),
        comments,
        options,
        cast_paren_starts: Vec::new(),
        may_have_decorators: true,
    };
    let describe = |owner: Owner<'a>| {
        let name = match owner {
            Owner::Node(node) => format!("{node:?}"),
            Owner::Name(_) => "Name".to_owned(),
            Owner::CastParentheses(..) => "ParenthesizedExpression".to_owned(),
        };
        let len = strings::index_of_char_usize(name.as_bytes(), b'(').unwrap_or(name.len());
        (
            name.get(..len).unwrap_or_default().to_owned(),
            tree.loc(owner),
        )
    };
    let mut lines: Vec<(u32, Vec<u8>)> = Vec::new();
    for (comment, attachment) in comments.iter().zip(&attached.attachments) {
        if attachment.marker == Marker::InIgnoredNode {
            continue;
        }
        let (name, span) = describe(attachment.owner);
        let placement = match attachment.placement {
            Placement::Leading => "L",
            Placement::Trailing => "T",
            Placement::Dangling => "D",
        };
        let marker = match attachment.marker {
            Marker::None | Marker::InIgnoredNode => "-",
            Marker::CommentBeforeArrow => "commentBeforeArrow",
            Marker::Implements => "implements",
            Marker::Extends => "extends",
        };
        let mut text_position = Vec::new();
        let _ = write!(
            text_position,
            "C {} {} {placement} {name} {} {} {marker}{}",
            comment.span.start,
            comment.span.end,
            span.start,
            span.end,
            if attachment.is_unignored {
                " unignore"
            } else {
                ""
            },
        );
        lines.push((comment.span.start, text_position));
    }
    for owner in &attached.ignored {
        let (name, span) = describe(*owner);
        let mut text_position = Vec::new();
        let _ = write!(text_position, "I {name} {} {}", span.start, span.end);
        lines.push((span.start, text_position));
    }
    crate::sort::sort_by_key(&mut lines, |text_position| text_position.0);
    for (_, text_position) in lines {
        out.extend_from_slice(&text_position);
        out.push(b'\n');
    }
}
